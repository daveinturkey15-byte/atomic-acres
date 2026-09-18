/**
 * Inspect a raw Kimodo export BEFORE anything retargets it.
 *
 * `kmd-generate-embed` writes two headerless float32 arrays and nothing else:
 *
 *     root_positions.f32        T x 3
 *     local_rotations_xyzw.f32  T x J x 4   (parent-local quaternions, xyzw)
 *
 * No shape metadata exists in either file, so J is RECOVERED from the two byte
 * counts, never assumed. That is the point of this stage: the licence file and
 * the brief both warn that the port's README promises SMPL-X (22 joints) while
 * the checkpoint we are allowed to use emits SOMA-30. Batch-retargeting a set
 * of clips on the wrong assumption is the failure this gate exists to stop, so
 * a joint count other than 30 is a HARD FAILURE here, not a warning.
 *
 *   node scripts/animation/inspect-motion.mjs <raw-dir> [<raw-dir> ...]
 *   node scripts/animation/inspect-motion.mjs --all <parent-dir>
 *
 * Exit 0 only if every clip passes every assertion.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { SOMA30_JOINTS, SOMA30_NAMES, somaForwardKinematics } from './soma30.mjs';

/** A joint further than this from the pelvis is not a human pose. */
const MAX_LIMB_REACH_M = 1.3;
/** Loop seam tolerance, degrees of worst-joint first->last difference. */
const LOOP_SEAM_DEG = 12;

const argv = process.argv.slice(2);
let dirs = [];
if (argv[0] === '--all') {
  const parent = argv[1];
  dirs = readdirSync(parent, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(parent, d.name, 'root_positions.f32')))
    .map((d) => join(parent, d.name));
} else {
  dirs = argv.filter((a) => !a.startsWith('--'));
}
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
if (dirs.length === 0) {
  console.error('usage: node scripts/animation/inspect-motion.mjs <raw-dir>... | --all <parent-dir>');
  process.exit(2);
}

const asFloats = (p) => {
  const b = readFileSync(p);
  if (b.byteLength % 4 !== 0) throw new Error(`${p}: not a whole number of float32 values`);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

const rows = [];
let failures = 0;

for (const dir of dirs) {
  const name = basename(dir);
  const rootPath = join(dir, 'root_positions.f32');
  const rotPath = join(dir, 'local_rotations_xyzw.f32');
  const fail = (msg) => { failures++; rows.push({ name, ok: false, error: msg }); console.log(`FAIL ${name}: ${msg}`); };

  if (!existsSync(rootPath) || !existsSync(rotPath)) { fail('missing raw f32 files'); continue; }
  const root = asFloats(rootPath);
  const rot = asFloats(rotPath);
  if (root.length % 3 !== 0) { fail('root_positions.f32 is not a multiple of 3'); continue; }
  const frames = root.length / 3;
  if (frames < 2 || rot.length % (frames * 4) !== 0) { fail(`rotation buffer ${rot.length} does not divide by frames*4`); continue; }
  const joints = rot.length / (frames * 4);

  // ---- the gate the brief names explicitly.
  if (joints !== SOMA30_JOINTS) {
    fail(`joint count is ${joints}, expected ${SOMA30_JOINTS}. `
      + (joints === 22
        ? 'TWENTY-TWO means the SMPL-X RP checkpoint is loaded - that checkpoint is forbidden by docs/LICENCES-ANIMATION.md. STOP.'
        : 'Wrong weights or a truncated write. STOP.'));
    continue;
  }

  // ---- finiteness and quaternion normalisation. Drift means a bad read stride.
  let nonFinite = 0, minNorm = Infinity, maxNorm = -Infinity;
  for (let i = 0; i < rot.length; i += 4) {
    const x = rot[i], y = rot[i + 1], z = rot[i + 2], w = rot[i + 3];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(w))) { nonFinite++; continue; }
    const n = Math.hypot(x, y, z, w);
    if (n < minNorm) minNorm = n;
    if (n > maxNorm) maxNorm = n;
  }
  for (let i = 0; i < root.length; i++) if (!Number.isFinite(root[i])) nonFinite++;

  // ---- root trajectory per axis. Which axis is up is a MEASUREMENT.
  const axes = ['x', 'y', 'z'].map((axName, c) => {
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < frames; t++) { const v = root[t * 3 + c]; if (v < lo) lo = v; if (v > hi) hi = v; }
    return { axName, lo, hi, span: hi - lo, net: root[(frames - 1) * 3 + c] - root[c], mid: (lo + hi) / 2 };
  });
  // The vertical axis sits in a narrow band WELL off zero; travel axes are wide,
  // and the lateral axis of a straight walk is narrow but centred on zero. Score
  // by offset-from-floor relative to movement, not by span alone.
  const up = [...axes].sort((p, q) => Math.abs(q.mid) / (q.span + 1e-6) - Math.abs(p.mid) / (p.span + 1e-6))[0];
  const planar = axes.filter((a) => a.axName !== up.axName);
  const planarNet = Math.hypot(...planar.map((a) => a.net));

  // ---- pose sanity: no joint absurdly far from the pelvis, in any frame.
  const { pos } = somaForwardKinematics(root, rot, frames);
  let worstReach = 0, worstJoint = '', worstFrame = -1;
  for (let t = 0; t < frames; t++) {
    const hx = pos[(t * SOMA30_JOINTS) * 3], hy = pos[(t * SOMA30_JOINTS) * 3 + 1], hz = pos[(t * SOMA30_JOINTS) * 3 + 2];
    for (let j = 1; j < SOMA30_JOINTS; j++) {
      const b = (t * SOMA30_JOINTS + j) * 3;
      const d = Math.hypot(pos[b] - hx, pos[b + 1] - hy, pos[b + 2] - hz);
      if (d > worstReach) { worstReach = d; worstJoint = SOMA30_NAMES[j]; worstFrame = t; }
    }
  }

  // ---- loop seam, reported for every clip and asserted for none (most prompts
  // are not loops; the trimmer in bake-clips.mjs is what makes them loop).
  let seam = 0;
  for (let j = 0; j < SOMA30_JOINTS; j++) {
    const a = j * 4, b = (frames - 1) * SOMA30_JOINTS * 4 + j * 4;
    const dot = Math.abs(rot[a] * rot[b] + rot[a + 1] * rot[b + 1] + rot[a + 2] * rot[b + 2] + rot[a + 3] * rot[b + 3]);
    seam = Math.max(seam, 2 * Math.acos(Math.min(1, dot)));
  }
  const seamDeg = (seam * 180) / Math.PI;

  const problems = [];
  if (nonFinite > 0) problems.push(`${nonFinite} non-finite values`);
  if (maxNorm - minNorm > 1e-3) problems.push(`quaternion norms drift ${minNorm.toFixed(5)}..${maxNorm.toFixed(5)}`);
  if (worstReach > MAX_LIMB_REACH_M) problems.push(`${worstJoint} is ${worstReach.toFixed(2)} m from the pelvis at frame ${worstFrame} (limit ${MAX_LIMB_REACH_M})`);

  const ok = problems.length === 0;
  if (!ok) failures++;
  rows.push({
    name, ok, frames, joints,
    upAxis: up.axName,
    hipHeight: +up.mid.toFixed(3),
    rootSpan: Object.fromEntries(axes.map((a) => [a.axName, +a.span.toFixed(3)])),
    rootNet: Object.fromEntries(axes.map((a) => [a.axName, +a.net.toFixed(3)])),
    planarNet: +planarNet.toFixed(3),
    quatNorm: [+minNorm.toFixed(5), +maxNorm.toFixed(5)],
    worstReach: +worstReach.toFixed(3),
    worstJoint,
    loopSeamDeg: +seamDeg.toFixed(1),
    loopable: seamDeg < LOOP_SEAM_DEG,
    problems,
  });
}

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
console.log('');
console.log(pad('clip', 16) + rpad('frames', 7) + rpad('joints', 7) + rpad('up', 4)
  + rpad('hip m', 7) + rpad('travel m', 10) + rpad('reach m', 9) + rpad('seam deg', 10) + '  status');
console.log('-'.repeat(90));
for (const r of rows) {
  if (r.error) { console.log(pad(r.name, 16) + '  ' + r.error); continue; }
  console.log(pad(r.name, 16) + rpad(r.frames, 7) + rpad(r.joints, 7) + rpad(r.upAxis, 4)
    + rpad(r.hipHeight.toFixed(3), 7) + rpad(r.planarNet.toFixed(3), 10)
    + rpad(r.worstReach.toFixed(3), 9) + rpad(r.loopSeamDeg.toFixed(1), 10)
    + '  ' + (r.ok ? 'ok' : 'PROBLEM: ' + r.problems.join('; ')));
}
console.log('-'.repeat(90));
console.log(`${rows.length - failures}/${rows.length} clips pass every assertion`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
process.exit(failures ? 1 : 0);
