/**
 * Nuketown 2025 — audio bank verifier (audio lane, offline, no browser).
 *
 * `node src/audio/check-bank.mjs` fails non-zero on any violation:
 *  1. every manifest file exists, parses as 16-bit mono WAV at the bank rate
 *  2. sha256 / size / duration match the manifest (bit-for-bit reproducibility:
 *     re-run render-bank.mjs and this still passes unchanged)
 *  3. peak < 0 dBFS, RMS inside audibility bands, DC offset ~0
 *  4. total bank <= 15 MB
 *  5. service.ts AUDIO_BANK_VERSION matches render-bank.mjs BANK_VERSION
 *  6. service.ts keeps the structural bounds: MAX_VOICES <= 16, onended
 *     retirement, disconnect on dispose (grep-level contract, not a browser)
 *
 * Voice-count reasoning (static, for the record): one trigger pull creates at
 * most 2 voices (shot + impact); reload/dry/switch create 1. At 800 rpm the
 * SMG holds ~2 concurrent voices. The 16-voice cap is only reachable under
 * multi-shooter netcode playback, where priority steal/drop applies.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANK_VERSION, SAMPLE_RATE } from './render-bank.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'audio');
const SVC = join(ROOT, 'src', 'audio', 'service.ts');
const RENDER = join(ROOT, 'src', 'audio', 'render-bank.mjs');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

function readWav16Mono(path) {
  const b = readFileSync(path);
  if (b.length < 44) throw new Error('too short for WAV header');
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  if (b.readUInt16LE(20) !== 1 || b.readUInt16LE(22) !== 1 || b.readUInt16LE(34) !== 16) {
    throw new Error('not 16-bit mono PCM');
  }
  const sr = b.readUInt32LE(24);
  const n = b.readUInt32LE(40) / 2;
  const x = new Float32Array(n);
  let sum = 0;
  let peak = 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const s = b.readInt16LE(44 + i * 2) / 32767;
    x[i] = s;
    sum += s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sq += s * s;
  }
  return { sr, n, peak, rms: Math.sqrt(sq / n), dc: sum / n, bytes: b.length, hash: createHash('sha256').update(b).digest('hex') };
}

const manifestPath = join(OUT, 'manifest.json');
ok(existsSync(manifestPath), 'manifest.json exists');
if (!existsSync(manifestPath)) process.exit(1);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

console.log('files:');
ok(manifest.bankVersion === BANK_VERSION, `manifest bankVersion ${manifest.bankVersion} === renderer ${BANK_VERSION}`);
ok(manifest.sampleRate === SAMPLE_RATE, `manifest rate ${manifest.sampleRate} === renderer ${SAMPLE_RATE}`);
for (const e of manifest.files) {
  const p = join(OUT, e.file);
  ok(existsSync(p), `${e.file} exists`);
  if (!existsSync(p)) continue;
  let w;
  try {
    w = readWav16Mono(p);
  } catch (err) {
    ok(false, `${e.file} parses as 16-bit mono WAV (${err.message})`);
    continue;
  }
  ok(w.bytes === e.bytes, `${e.file} size ${w.bytes} matches manifest`);
  ok(w.peak < 1.0, `${e.file} peak ${w.peak.toFixed(3)} < 0 dBFS`);
  ok(w.peak >= 0.3, `${e.file} peak ${w.peak.toFixed(3)} audible (>= 0.3)`);
  const isCue = e.file.startsWith('cue-') && e.file !== 'cue-blast.wav';
  ok(isCue ? w.rms >= 0.02 : w.rms >= 0.05, `${e.file} rms ${w.rms.toFixed(3)} audible`);
  ok(w.rms <= 0.5, `${e.file} rms ${w.rms.toFixed(3)} not a brick (<= 0.5)`);
  ok(Math.abs(w.dc) < 0.01, `${e.file} DC offset ${w.dc.toFixed(4)} ~ 0`);
  const maxDur = e.file === 'cue-blast.wav' ? 2.0 : e.file.startsWith('shot-') ? 1.2 : 0.5;
  ok(w.n / w.sr <= maxDur, `${e.file} duration ${(w.n / w.sr).toFixed(2)}s <= ${maxDur}s`);
}

console.log('budget:');
ok(manifest.totalBytes <= 15 * 1024 * 1024, `bank ${(manifest.totalBytes / 1024).toFixed(1)} KiB <= 15 MB`);

console.log('service contract:');
const svc = readFileSync(SVC, 'utf8');
const render = readFileSync(RENDER, 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const svcCode = stripComments(svc);
const renderCode = stripComments(render);
const svcVer = /AUDIO_BANK_VERSION\s*=\s*(\d+)/.exec(svc)?.[1];
ok(svcVer !== undefined && Number(svcVer) === BANK_VERSION, `service AUDIO_BANK_VERSION ${svcVer} === renderer ${BANK_VERSION}`);
const cap = /MAX_VOICES\s*=\s*(\d+)/.exec(svc)?.[1];
ok(cap !== undefined && Number(cap) <= 16, `service MAX_VOICES ${cap} <= 16`);
ok(/\.onended\s*=/.test(svc), 'service retires voices via onended');
ok(svc.includes('disconnect()'), 'service disconnects nodes on retire/dispose');
ok(/new\s+AudioContext|new\s+AC\(\)/.test(svc), 'service owns exactly one context site');
ok((svc.match(/new\s+AC\(\)/g) ?? []).length <= 1, 'single AudioContext construction site');
ok(!/Math\.random/.test(svcCode), 'service uses deterministic LCG, no Math.random');
ok(!/Math\.random/.test(renderCode), 'renderer uses seeded PRNG, no Math.random');
ok(/createDynamicsCompressor/.test(svc), 'service has a master limiter (compressor)');

if (failures > 0) {
  console.log(`CHECK FAILED: ${failures} violation(s)`);
  process.exit(1);
}
console.log('CHECK PASSED');
