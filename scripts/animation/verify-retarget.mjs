/**
 * Is the baked clip the SAME POSE as the model produced, or my arithmetic?
 *
 * Every other check in this lane measures the clip against expectations - toe
 * height, foot slide, loop seam. None of them can tell "the retarget is wrong"
 * from "the model generated an odd pose", and that distinction decides whether
 * to fix code or re-roll a seed. This one compares the baked rig against the raw
 * SOMA export directly: for every bone, the angle between OUR world bone
 * direction and the SOURCE's world bone direction, per frame.
 *
 * For a bone whose direction target is its immediate child the two must agree to
 * within floating point - the transfer is exact by construction, so anything
 * above ~1 degree is a bug. Shoulders and the neck aim at a GRANDCHILD (our
 * shoulder->arm offset is a 2 cm stub whose direction is numerical noise), so an
 * intermediate joint's own rotation legitimately sits between them; those rows
 * are marked and judged loosely.
 *
 *   node scripts/animation/verify-retarget.mjs --raw <scratch>/raw/walk --clip public/anim/walk.glb
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOMA30_INDEX, SOMA30_JOINTS, somaForwardKinematics } from './soma30.mjs';
import { readGlb } from './glb-read.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const rawDir = opt('raw'); const clipFile = opt('clip');
if (!rawDir || !clipFile) { console.error('--raw <rawClipDir> --clip <clip.glb> required'); process.exit(2); }

/** our bone -> [our direction child, soma joint, soma direction child, immediate?] */
const PAIRS = [
  ['Hips', 'Spine', 'Hips', 'Spine2', false],
  ['Spine', 'Chest', 'Spine2', 'Chest', true],
  ['Chest', 'Neck', 'Chest', 'Neck1', true],
  ['Neck', 'Head', 'Neck1', 'Head', false],
  ['LeftShoulder', 'LeftForeArm', 'LeftShoulder', 'LeftForeArm', false],
  ['LeftArm', 'LeftForeArm', 'LeftArm', 'LeftForeArm', true],
  ['LeftForeArm', 'LeftHand', 'LeftForeArm', 'LeftHand', true],
  ['RightShoulder', 'RightForeArm', 'RightShoulder', 'RightForeArm', false],
  ['RightArm', 'RightForeArm', 'RightArm', 'RightForeArm', true],
  ['RightForeArm', 'RightHand', 'RightForeArm', 'RightHand', true],
  ['LeftUpLeg', 'LeftLeg', 'LeftLeg', 'LeftShin', true],
  ['LeftLeg', 'LeftFoot', 'LeftShin', 'LeftFoot', true],
  ['LeftFoot', 'LeftToe', 'LeftFoot', 'LeftToeBase', true],
  ['RightUpLeg', 'RightLeg', 'RightLeg', 'RightShin', true],
  ['RightLeg', 'RightFoot', 'RightShin', 'RightFoot', true],
  ['RightFoot', 'RightToe', 'RightFoot', 'RightToeBase', true],
];

// ---- source
const asF = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const rootRaw = asF(join(rawDir, 'root_positions.f32'));
const rotRaw = asF(join(rawDir, 'local_rotations_xyzw.f32'));
const srcFrames = rootRaw.length / 3;
const { pos: sPos } = somaForwardKinematics(rootRaw, rotRaw, srcFrames);
const sDir = (jName, cName, t) => {
  const j = SOMA30_INDEX[jName], c = SOMA30_INDEX[cName];
  const a = (t * SOMA30_JOINTS + j) * 3, b = (t * SOMA30_JOINTS + c) * 3;
  // mirrored in X, matching the retarget
  const v = [-(sPos[b] - sPos[a]), sPos[b + 1] - sPos[a + 1], sPos[b + 2] - sPos[a + 2]];
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

// ---- baked
const { json, acc } = readGlb(clipFile);
const nameOf = json.nodes.map((n) => n.name);
const parentOf = new Array(json.nodes.length).fill(-1);
json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => { parentOf[c] = i; }));
const anim = json.animations[0];
const times = acc(anim.samplers[0].input);
const frames = times.length;
const rot = {}, trans = {};
for (const ch of anim.channels) {
  const out = acc(anim.samplers[ch.sampler].output);
  if (ch.target.path === 'rotation') rot[nameOf[ch.target.node]] = out;
  else trans[nameOf[ch.target.node]] = out;
}
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot = (q, v) => { const [x, y, z, w] = q; const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]; };
const P = {}, Q = {};
for (const n of nameOf) { P[n] = new Float64Array(frames * 3); Q[n] = new Float64Array(frames * 4); }
for (let t = 0; t < frames; t++) {
  for (let i = 0; i < json.nodes.length; i++) {
    const n = nameOf[i], p = parentOf[i];
    const r = rot[n] ? [rot[n][t * 4], rot[n][t * 4 + 1], rot[n][t * 4 + 2], rot[n][t * 4 + 3]] : [0, 0, 0, 1];
    const lt = trans[n] ? [trans[n][t * 3], trans[n][t * 3 + 1], trans[n][t * 3 + 2]] : json.nodes[i].translation ?? [0, 0, 0];
    if (p < 0) { Q[n].set(r, t * 4); P[n].set(lt, t * 3); continue; }
    const pn = nameOf[p];
    const pq = [Q[pn][t * 4], Q[pn][t * 4 + 1], Q[pn][t * 4 + 2], Q[pn][t * 4 + 3]];
    Q[n].set(qmul(pq, r), t * 4);
    const o = qrot(pq, lt);
    P[n][t * 3] = P[pn][t * 3] + o[0]; P[n][t * 3 + 1] = P[pn][t * 3 + 1] + o[1]; P[n][t * 3 + 2] = P[pn][t * 3 + 2] + o[2];
  }
}
const oDir = (a, b, t) => { const v = [P[b][t * 3] - P[a][t * 3], P[b][t * 3 + 1] - P[a][t * 3 + 1], P[b][t * 3 + 2] - P[a][t * 3 + 2]]; const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

// The baked clip may be a TRIMMED window of the source, and the yaw fix rotated
// it. Recover both by brute force on the hips: the offset with the lowest error
// is the true alignment, and reporting it proves the trim is what it claims.
let bestOff = 0, bestYaw = 0, bestErr = Infinity;
for (let off = 0; off + frames <= srcFrames; off++) {
  for (let deg = -180; deg < 180; deg += 1) {
    const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    let e = 0;
    for (let t = 0; t < frames; t += Math.max(1, Math.floor(frames / 6))) {
      const s = sDir('LeftLeg', 'LeftShin', t + off);
      const sr = [ca * s[0] + sa * s[2], s[1], -sa * s[0] + ca * s[2]];
      const o = oDir('LeftUpLeg', 'LeftLeg', t);
      e += Math.acos(Math.max(-1, Math.min(1, sr[0] * o[0] + sr[1] * o[1] + sr[2] * o[2])));
    }
    if (e < bestErr) { bestErr = e; bestOff = off; bestYaw = a; }
  }
}
const ca = Math.cos(bestYaw), sa = Math.sin(bestYaw);
console.log(`aligned: source frame offset ${bestOff}, yaw ${(bestYaw * 180 / Math.PI).toFixed(1)} deg  (recovered, not assumed)`);
console.log('');
console.log('bone'.padEnd(15) + 'mean deg'.padStart(10) + 'max deg'.padStart(10) + '   exact?');
console.log('-'.repeat(48));
let worstExact = 0;
for (const [ourB, ourC, somaJ, somaC, immediate] of PAIRS) {
  let sum = 0, mx = 0;
  for (let t = 0; t < frames; t++) {
    const s = sDir(somaJ, somaC, t + bestOff);
    const sr = [ca * s[0] + sa * s[2], s[1], -sa * s[0] + ca * s[2]];
    const o = oDir(ourB, ourC, t);
    const d = (Math.acos(Math.max(-1, Math.min(1, sr[0] * o[0] + sr[1] * o[1] + sr[2] * o[2]))) * 180) / Math.PI;
    sum += d; if (d > mx) mx = d;
  }
  if (immediate) worstExact = Math.max(worstExact, mx);
  console.log(ourB.padEnd(15) + (sum / frames).toFixed(2).padStart(10) + mx.toFixed(2).padStart(10) + (immediate ? '   exact' : '   via a joint'));
}
console.log('-'.repeat(48));
console.log(`worst exact-pair error ${worstExact.toFixed(3)} deg -> ${worstExact < 1 ? 'the transfer is faithful; any odd pose is the MODEL, not the retarget' : 'RETARGET BUG'}`);
process.exit(worstExact < 1 ? 0 : 1);
