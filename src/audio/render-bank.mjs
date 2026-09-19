/**
 * Nuketown 2025 — authored audio bank renderer (audio lane, canonical mix).
 *
 * Deterministic offline synthesis: `node src/audio/render-bank.mjs` writes
 * 44.1 kHz mono 16-bit WAVs to `public/audio/` plus `manifest.json`
 * (sha256, peak, RMS, duration, seed). Re-running reproduces every sample
 * bit-for-bit: the manifest hash is the proof.
 *
 * Voice (modern, weighty — never arcade):
 *  - transient: 3-8 ms highpassed noise crack (the "snap" of the muzzle)
 *  - body: lowpassed noise blast, per-family cutoff/decay (rifle bark,
 *    SMG yap, shotgun boom, sniper cannon, pistol pop)
 *  - thump: sine that falls 90->40 Hz-ish (chest weight; it never rises,
 *    so it never reads as a pew-pew sweep)
 *  - mechanical: two low-level bolt/handle clicks baked into every shot
 *  - tail: decaying lowpassed wash + two sparse echoes (space, no reverb DSP)
 *
 * No external samples, no downloads, no licensed material: every byte is
 * authored here. Total bank target <= 15 MB (actual ~1 MB).
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BANK_VERSION = 2;
export const SAMPLE_RATE = 44100;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'audio');

/** Deterministic PRNG: same seed -> same bytes on every machine. */
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cascaded one-pole lowpass (12 dB/oct), in place. */
function lowpass(x, cutoff, sr, passes = 2) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      y += a * (x[i] - y);
      x[i] = y;
    }
  }
}

/** Highpass as original-minus-lowpassed, in place. */
function highpass(x, cutoff, sr) {
  const copy = Float32Array.from(x);
  lowpass(copy, cutoff, sr, 1);
  for (let i = 0; i < x.length; i++) x[i] -= copy[i];
}

function expDecay(n, sr, tau) {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = Math.exp(-i / (sr * tau));
  return e;
}

function burst(rand, n, gain) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (rand() * 2 - 1) * gain;
  return x;
}

function mix(dst, src, atSamples = 0, gain = 1) {
  const end = Math.min(dst.length, atSamples + src.length);
  for (let i = Math.max(0, atSamples), j = 0; i < end; i++, j++) dst[i] += src[j] * gain;
}

/** Falling sine thump: f0 -> f1 over dur, exponential level decay. */
function thump(n, sr, f0, f1, dur, gain) {
  const x = new Float32Array(n);
  let phase = 0;
  const m = Math.min(n, Math.floor(sr * dur));
  for (let i = 0; i < m; i++) {
    const k = i / m;
    const f = f0 + (f1 - f0) * k;
    phase += (2 * Math.PI * f) / sr;
    x[i] = Math.sin(phase) * Math.exp(-i / (sr * dur * 0.45)) * gain;
  }
  return x;
}

function peak(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

function normalize(x, targetPeak) {
  const p = peak(x) || 1;
  const g = targetPeak / p;
  for (let i = 0; i < x.length; i++) x[i] *= g;
}

function makeShot(rand, p) {
  const sr = SAMPLE_RATE;
  const n = Math.floor(sr * p.len);
  const out = new Float32Array(n);
  // Body: lowpassed noise blast.
  const body = burst(rand, n, 1);
  lowpass(body, p.cutoff, sr, 2);
  const benv = expDecay(n, sr, p.decay);
  for (let i = 0; i < n; i++) body[i] *= benv[i];
  mix(out, body, 0, p.bodyGain);
  // Transient: highpassed crack over the first milliseconds.
  const tn = Math.floor(sr * p.transientDur);
  const tr = burst(rand, tn, 1);
  highpass(tr, 1500, sr);
  const tenv = expDecay(tn, sr, p.transientDur * 0.35);
  for (let i = 0; i < tn; i++) tr[i] *= tenv[i];
  mix(out, tr, 0, p.transientGain);
  // Weight: falling thump, never a rising sweep.
  mix(out, thump(n, sr, p.thumpF0, p.thumpF1, p.thumpDur, p.thumpGain));
  // Mechanical: bolt/handle clicks baked in, low level.
  for (const [atMs, g] of p.mech) {
    const cn = Math.floor(sr * 0.004);
    const c = burst(rand, cn, 1);
    highpass(c, 3000, sr);
    const cenv = expDecay(cn, sr, 0.0012);
    for (let i = 0; i < cn; i++) c[i] *= cenv[i];
    mix(out, c, Math.floor((sr * atMs) / 1000), g);
  }
  // Tail: dull wash + two sparse echoes for space.
  const tail = burst(rand, n, 1);
  lowpass(tail, Math.max(220, p.cutoff * 0.35), sr, 2);
  const tailEnv = expDecay(n, sr, p.decay * 2.6);
  for (let i = 0; i < n; i++) tail[i] *= tailEnv[i];
  mix(out, tail, 0, p.tailGain);
  const tailCopy = Float32Array.from(out);
  mix(out, tailCopy, Math.floor(sr * 0.09), 0.22);
  mix(out, tailCopy, Math.floor(sr * 0.19), 0.11);
  normalize(out, p.peak);
  return out;
}

const SHOTS = {
  // id: [file, seed, params]
  longhorn: ['shot-longhorn.wav', 1101, {
    len: 0.55, cutoff: 1900, decay: 0.055, bodyGain: 1.0,
    transientDur: 0.006, transientGain: 0.9, thumpF0: 82, thumpF1: 44,
    thumpDur: 0.14, thumpGain: 0.75, mech: [[6, 0.22], [55, 0.14]], tailGain: 0.3, peak: 0.89,
  }],
  rattler: ['shot-rattler.wav', 1102, {
    len: 0.4, cutoff: 2500, decay: 0.038, bodyGain: 1.0,
    transientDur: 0.005, transientGain: 1.0, thumpF0: 100, thumpF1: 55,
    thumpDur: 0.1, thumpGain: 0.6, mech: [[5, 0.2], [42, 0.12]], tailGain: 0.22, peak: 0.89,
  }],
  coachman: ['shot-coachman.wav', 1103, {
    len: 0.8, cutoff: 1150, decay: 0.09, bodyGain: 1.0,
    transientDur: 0.008, transientGain: 1.1, thumpF0: 64, thumpF1: 34,
    thumpDur: 0.2, thumpGain: 0.9, mech: [[8, 0.26], [90, 0.2]], tailGain: 0.36, peak: 0.89,
  }],
  deadeye: ['shot-deadeye.wav', 1104, {
    len: 1.1, cutoff: 850, decay: 0.14, bodyGain: 1.0,
    transientDur: 0.008, transientGain: 0.9, thumpF0: 54, thumpF1: 28,
    thumpDur: 0.3, thumpGain: 1.0, mech: [[10, 0.24], [140, 0.18]], tailGain: 0.42, peak: 0.89,
  }],
  duster: ['shot-duster.wav', 1105, {
    len: 0.35, cutoff: 2700, decay: 0.032, bodyGain: 1.0,
    transientDur: 0.004, transientGain: 0.9, thumpF0: 118, thumpF1: 62,
    thumpDur: 0.08, thumpGain: 0.5, mech: [[4, 0.18], [36, 0.1]], tailGain: 0.18, peak: 0.89,
  }],
};

function makeMech(rand, recipe) {
  const sr = SAMPLE_RATE;
  const out = new Float32Array(Math.floor(sr * recipe.len));
  for (const [atMs, durMs, hp, g] of recipe.clicks) {
    const cn = Math.floor((sr * durMs) / 1000);
    const c = burst(rand, cn, 1);
    highpass(c, hp, sr);
    const e = expDecay(cn, sr, durMs / 1000 / 3);
    for (let i = 0; i < cn; i++) c[i] *= e[i];
    mix(out, c, Math.floor((sr * atMs) / 1000), g);
  }
  if (recipe.rattle) {
    const [atMs, durMs, hp, g] = recipe.rattle;
    const rn = Math.floor((sr * durMs) / 1000);
    const r = burst(rand, rn, 1);
    highpass(r, hp, sr);
    mix(out, r, Math.floor((sr * atMs) / 1000), g * 0.3);
  }
  if (recipe.thud) {
    mix(out, thump(out.length, sr, recipe.thud[0], recipe.thud[1], recipe.len * 0.5, recipe.thud[2]));
  }
  normalize(out, recipe.peak);
  return out;
}

const CUES = {
  reloadStart: ['cue-reload-start.wav', 2101, {
    len: 0.35, clicks: [[5, 12, 1800, 0.8], [120, 18, 2400, 0.6]],
    rattle: [40, 90, 3500, 0.5], peak: 0.55,
  }],
  reloadEnd: ['cue-reload-end.wav', 2102, {
    len: 0.4, clicks: [[5, 10, 1500, 0.9], [150, 22, 1200, 0.8]],
    rattle: [160, 120, 2800, 0.5], thud: [120, 70, 0.3], peak: 0.65,
  }],
  dryFire: ['cue-dryfire.wav', 2103, {
    len: 0.15, clicks: [[5, 8, 2800, 0.9]], peak: 0.5,
  }],
  switch: ['cue-switch.wav', 2104, {
    len: 0.25, clicks: [[5, 10, 2000, 0.6], [90, 14, 1600, 0.7]],
    rattle: [30, 60, 4000, 0.3], peak: 0.45,
  }],
  impactDirt: ['cue-impact-dirt.wav', 2105, {
    len: 0.3, clicks: [[2, 6, 3000, 0.5]], thud: [110, 55, 0.8], peak: 0.6,
  }],
  impactHard: ['cue-impact-hard.wav', 2106, {
    len: 0.25, clicks: [[2, 5, 3500, 0.9], [18, 10, 2200, 0.5]],
    thud: [160, 90, 0.45], peak: 0.6,
  }],
  hitmark: ['cue-hitmark.wav', 2107, {
    len: 0.08, clicks: [[2, 6, 4200, 0.8]], peak: 0.4,
  }],
  blast: null, // built by makeBlast below
};

function makeBlast(rand) {
  const sr = SAMPLE_RATE;
  const n = Math.floor(sr * 1.6);
  const out = new Float32Array(n);
  // Sub weight: long falling sine, 46 -> 26 Hz.
  mix(out, thump(n, sr, 46, 26, 0.9, 1.0));
  // Blast body: noise with a coarse lowpass stepped down (no filter
  // automation: three overlapping bands crossfaded by envelopes).
  const b1 = burst(rand, n, 1);
  lowpass(b1, 2800, sr, 1);
  const e1 = expDecay(n, sr, 0.06);
  for (let i = 0; i < n; i++) b1[i] *= e1[i];
  mix(out, b1, 0, 0.9);
  const b2 = burst(rand, n, 1);
  lowpass(b2, 700, sr, 2);
  const e2 = expDecay(n, sr, 0.28);
  for (let i = 0; i < n; i++) b2[i] *= e2[i];
  mix(out, b2, 0, 0.8);
  // Debris crackle: sparse highpassed pops in the first 300 ms.
  for (let k = 0; k < 14; k++) {
    const at = Math.floor(rand() * sr * 0.3);
    const cn = Math.floor(sr * 0.006);
    const c = burst(rand, cn, 1);
    highpass(c, 2500, sr);
    mix(out, c, at, 0.12 + rand() * 0.15);
  }
  const tailCopy = Float32Array.from(out);
  mix(out, tailCopy, Math.floor(sr * 0.16), 0.3);
  mix(out, tailCopy, Math.floor(sr * 0.38), 0.14);
  normalize(out, 0.89);
  return out;
}

function writeWav(path, x, sr) {
  const n = x.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return buf;
}


// ---- entry: render every sample, then write manifest.json ----
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const runOne = (key, file, seed, samples) => {
    const buf = writeWav(join(OUT, file), samples, SAMPLE_RATE);
    void buf;
    return { key, file, seed, peak: +peak(samples).toFixed(4), rms: +rms(samples).toFixed(4) };
  };
  mkdirSync(OUT, { recursive: true });
  const entries = [];
  for (const [name, [file, seed, params]] of Object.entries(SHOTS)) {
    entries.push(runOne(name, file, seed, makeShot(mulberry32(seed), params)));
  }
  for (const [name, spec] of Object.entries(CUES)) {
    if (spec === null) continue;
    const [file, seed, recipe] = spec;
    entries.push(runOne(name, file, seed, makeMech(mulberry32(seed), recipe)));
  }
  const blastX = makeBlast(mulberry32(2108));
  entries.push(runOne('blast', 'cue-blast.wav', 2108, blastX));
  let totalBytes = 0;
  for (const e of entries) {
    const data = readFileSync(join(OUT, e.file));
    e.bytes = data.length;
    e.sha256 = createHash('sha256').update(data).digest('hex');
    e.durationS = +(((data.length - 44) / 2 / SAMPLE_RATE).toFixed(3));
    totalBytes += data.length;
  }
  const manifest = {
    bankVersion: BANK_VERSION,
    sampleRate: SAMPLE_RATE,
    channels: 1,
    bitDepth: 16,
    provenance: 'authored offline by src/audio/render-bank.mjs (deterministic synthesis, no external samples)',
    license: 'original work in this repository, same terms as the project',
    files: entries,
    totalBytes,
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`bank v${BANK_VERSION}: ${entries.length} files, ${(totalBytes / 1024).toFixed(1)} KiB`);
  for (const e of entries) {
    console.log(`  ${e.file} seed=${e.seed} dur=${e.durationS}s peak=${e.peak} rms=${e.rms} sha=${e.sha256.slice(0, 12)}`);
  }
}
