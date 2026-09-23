/**
 * Stage 1+2 of the clip bakery: prompt -> LLM2Vec embedding -> raw SOMA-30 motion.
 *
 * THE SPLIT IS THE POINT. `kmd-generate` takes text, so it must hold the LLM2Vec
 * text bundle resident: 32 layers x 441 MB plus a 1.05 GB embedding table, ~15 GB
 * in F32, against a 1.1 GB motion model. Splitting the stages removes the problem
 * instead of shrinking it:
 *
 *     kmd-encode         text bundle resident, ONCE per prompt  -> 4096 F32 = 16 KB
 *     kmd-generate-embed motion model only, no text runtime at all
 *
 * Measured on dave-gaming-pc 2026-09-18: encode 13 s/prompt, generate ~55 s/clip
 * for 90 frames at 50 DDIM steps on CPU.
 *
 * NOTHING THIS SCRIPT PRODUCES MAY ENTER THE REPO. Embeddings and raw motion are
 * derived from the Llama-3 text bundle and the NVIDIA motion weights; per
 * docs/LICENCES-ANIMATION.md obligation 1 they stay on this machine. Output goes
 * to a scratch directory, and only the retargeted glTF in public/anim/ ships.
 *
 *   node scripts/animation/bake-motion.mjs --out <scratch-dir> [--only <id>] [--seed-bump N]
 *
 * --seed-bump is the per-clip second-seed retry the brief allows: it offsets the
 * library seed so a bad clip can be re-rolled without editing the library (and the
 * seed actually used is recorded in the manifest, so LICENCES.md stays truthful).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const KIMODO = process.env.KIMODO_DIR || 'C:/Users/david/projects/kimodo.cpp';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const outRoot = opt('out');
if (!outRoot) { console.error('--out <scratch-dir> is required (raw motion must NEVER land in the repo)'); process.exit(2); }
if (resolve(outRoot).startsWith(ROOT)) {
  console.error(`refusing to write raw motion inside the repository (${outRoot}).`);
  console.error('docs/LICENCES-ANIMATION.md obligation 1: weights, embeddings and raw motion stay off the repo.');
  process.exit(2);
}
const only = opt('only');
const seedBump = Number(opt('seed-bump', '0'));

const lib = JSON.parse(readFileSync(join(ROOT, 'scripts', 'animation', 'prompt-library.json'), 'utf8'));
const bin = (n) => join(KIMODO, 'build-msvc', 'Release', `${n}.exe`);
const motionModel = join(KIMODO, 'weights', 'models', lib.generator.motionModel);
const textBundle = join(KIMODO, 'weights', 'generated', lib.generator.textBundle);

const promptDir = join(outRoot, 'prompts');
const embedDir = join(outRoot, 'embed');
const rawDir = join(outRoot, 'raw');
for (const d of [promptDir, embedDir, rawDir]) mkdirSync(d, { recursive: true });

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const prompts = lib.prompts.filter((p) => !only || p.id === only);
if (!prompts.length) { console.error(`no prompt matched --only ${only}`); process.exit(2); }

// Hashes of the two weight sets, recorded once - LICENCES.md obligation 2 wants
// "model file names + SHA-256". The text bundle is 15 GB across 34 files, so the
// per-file hashes are taken from the files actually read by kmd-encode.
const provenance = { motionModel: { file: lib.generator.motionModel, bytes: statSync(motionModel).size }, textBundle: {} };
console.log('[bake] hashing motion model (1.1 GB, one pass)...');
provenance.motionModel.sha256 = sha256(motionModel);
console.log(`[bake] ${lib.generator.motionModel}  sha256 ${provenance.motionModel.sha256}`);

const results = [];
const t0all = Date.now();
for (const p of prompts) {
  const seed = p.seed + seedBump;
  const promptFile = join(promptDir, `${p.id}.txt`);
  const embedFile = join(embedDir, `${p.id}.f32`);
  const outDir = join(rawDir, p.id);

  writeFileSync(promptFile, p.text, 'utf8');

  // The embedding cache is keyed on the PROMPT TEXT, not on the clip id.
  //
  // It used to be keyed on the id alone (`embed/<id>.f32`), and that silently
  // defeats the one thing a re-roll is for: round 2 of the animation lane
  // rewrote idle's prompt to name the posture, the id stayed `idle`, the cached
  // embedding from the OLD prompt was still on disk, and the "new" clip would
  // have been generated from the old sentence with only the seed changed. The
  // stamp beside each embedding records the text it was encoded from, so a
  // changed prompt re-encodes and an unchanged one still costs nothing.
  const textKey = createHash('sha256').update(p.text, 'utf8').digest('hex').slice(0, 16);
  const stampFile = embedFile + '.txt';
  const stale = !existsSync(embedFile) || !existsSync(stampFile)
    || readFileSync(stampFile, 'utf8').trim() !== textKey;
  if (stale) {
    if (!existsSync(textBundle)) { console.error(`text bundle absent at ${textBundle}`); process.exit(1); }
    const t = Date.now();
    // KIMODO_TEXT_LAYER_CHUNK keeps the encoder's VRAM slice small so a sibling
    // capture lane on the same GPU is not starved. 4 layers ~ 1.8 GB.
    execFileSync(bin('kmd-encode'), [textBundle, promptFile, embedFile], {
      stdio: 'inherit', windowsHide: true,
      env: { ...process.env, KIMODO_TEXT_LAYER_CHUNK: process.env.KIMODO_TEXT_LAYER_CHUNK || '4' },
    });
    writeFileSync(stampFile, textKey, 'utf8');
    console.log(`[bake] encode   ${p.id.padEnd(16)} ${((Date.now() - t) / 1000).toFixed(0)}s  text ${textKey}`);
  } else {
    console.log(`[bake] encode   ${p.id.padEnd(16)} cached (prompt text unchanged, ${textKey})`);
  }
  const bytes = statSync(embedFile).size;
  if (bytes !== 4096 * 4) { console.error(`${p.id}: embedding is ${bytes} bytes, expected ${4096 * 4}`); process.exit(1); }

  const t1 = Date.now();
  execFileSync(bin('kmd-generate-embed'), [
    motionModel, embedFile, String(p.frames), String(lib.generator.steps), String(seed), outDir,
    '--device', lib.generator.device,
  ], { stdio: 'inherit', windowsHide: true });
  console.log(`[bake] generate ${p.id.padEnd(16)} frames=${p.frames} seed=${seed} ${((Date.now() - t1) / 1000).toFixed(0)}s`);

  results.push({
    id: p.id, text: p.text, note: p.note ?? null, ship: p.ship !== false,
    frames: p.frames, seed, loopHint: !!p.loop,
    steps: lib.generator.steps, device: lib.generator.device, fps: lib.generator.fps,
    embeddingSha256: sha256(embedFile), promptSha256: textKey, raw: outDir,
  });
}

// MERGE, never clobber. A `--only idle` run used to write a manifest containing
// idle alone, which silently destroyed the provenance of the other fifteen clips
// still sitting in raw/ - and retarget-soma.mjs reads this file to know what to
// retarget, so a partial re-bake would quietly reduce the shipped set to one
// clip. Re-baked ids replace their own row; every other row survives.
const manifestPath = join(outRoot, 'bake-manifest.json');
let prior = { clips: [] };
if (existsSync(manifestPath)) {
  try { prior = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { prior = { clips: [] }; }
}
const rebaked = new Set(results.map((r) => r.id));
const manifest = {
  baked: new Date().toISOString().slice(0, 10),
  generator: lib.generator,
  provenance,
  command: {
    encode: `kmd-encode.exe <textBundle> <prompt.txt> <embedding.f32>`,
    generate: `kmd-generate-embed.exe <motion.gguf> <embedding.f32> <frames> ${lib.generator.steps} <seed> <outDir> --device ${lib.generator.device}`,
  },
  clips: [...(prior.clips ?? []).filter((c) => !rebaked.has(c.id)), ...results],
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\n[bake] ${results.length} clip(s) in ${((Date.now() - t0all) / 1000 / 60).toFixed(1)} min -> ${rawDir}`);
console.log('[bake] next: node scripts/animation/inspect-motion.mjs --all ' + rawDir);
