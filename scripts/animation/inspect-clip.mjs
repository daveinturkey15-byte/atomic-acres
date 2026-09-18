/**
 * Inspect a BAKED clip (.glb) - the last stage before the game sees it.
 *
 * inspect-motion.mjs checks what the model produced; this checks what the
 * retarget produced, on OUR rig, in metres, and draws it. It reads the glb back
 * rather than trusting the retargeter's in-memory numbers, so a bug in the glTF
 * writer (wrong accessor, wrong node order, a mis-scaled buffer) shows up here
 * instead of in the game.
 *
 *   node scripts/animation/inspect-clip.mjs public/anim/walk.glb [--sheet captures/anim/walk.png]
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { writePoseSheet } from './pose-sheet.mjs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const sheet = argv.includes('--sheet') ? argv[argv.indexOf('--sheet') + 1] : null;
if (!file) { console.error('usage: node scripts/animation/inspect-clip.mjs <clip.glb> [--sheet out.png]'); process.exit(2); }

import { readGlb } from './glb-read.mjs';

const { json, acc } = readGlb(file);
const nodes = json.nodes;
const nameOf = nodes.map((n) => n.name);
const parentOf = new Array(nodes.length).fill(-1);
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => { parentOf[c] = i; }));
const anim = json.animations[0];
const times = acc(anim.samplers[0].input);
const frames = times.length;

const rot = {}, trans = {};
for (const ch of anim.channels) {
  const out = acc(anim.samplers[ch.sampler].output);
  if (ch.target.path === 'rotation') rot[nameOf[ch.target.node]] = out;
  else if (ch.target.path === 'translation') trans[nameOf[ch.target.node]] = out;
}

// ------------------------------------------------------------------ FK
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};

const P = {}, Q = {};
for (const n of nameOf) { P[n] = new Float64Array(frames * 3); Q[n] = new Float64Array(frames * 4); }
for (let t = 0; t < frames; t++) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nameOf[i], p = parentOf[i];
    const r = rot[n] ? [rot[n][t * 4], rot[n][t * 4 + 1], rot[n][t * 4 + 2], rot[n][t * 4 + 3]] : [0, 0, 0, 1];
    const localT = trans[n] ? [trans[n][t * 3], trans[n][t * 3 + 1], trans[n][t * 3 + 2]] : nodes[i].translation ?? [0, 0, 0];
    if (p < 0) { Q[n].set(r, t * 4); P[n].set(localT, t * 3); continue; }
    const pn = nameOf[p];
    const pq = [Q[pn][t * 4], Q[pn][t * 4 + 1], Q[pn][t * 4 + 2], Q[pn][t * 4 + 3]];
    Q[n].set(qmul(pq, r), t * 4);
    const off = qrot(pq, localT);
    P[n][t * 3] = P[pn][t * 3] + off[0];
    P[n][t * 3 + 1] = P[pn][t * 3 + 1] + off[1];
    P[n][t * 3 + 2] = P[pn][t * 3 + 2] + off[2];
  }
}
const at = (n, f) => [P[n][f * 3], P[n][f * 3 + 1], P[n][f * 3 + 2]];

// ------------------------------------------------------------------ report
const name = basename(file);
const dur = times[frames - 1];
console.log(`${name}`);
console.log(`  nodes ${nodes.length}   frames ${frames}   duration ${dur.toFixed(3)} s   fps ${((frames - 1) / dur).toFixed(1)}`);
console.log(`  channels ${anim.channels.length}   extras ${JSON.stringify(json.extras ?? {})}`);

const span = (n, c) => {
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < frames; t++) { const v = P[n][t * 3 + c]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
};
const [hipLo, hipHi] = span('Hips', 1);
console.log(`  hips y      ${hipLo.toFixed(3)} .. ${hipHi.toFixed(3)} m   (bob ${((hipHi - hipLo) * 100).toFixed(1)} cm)`);
for (const n of ['LeftToe', 'RightToe']) {
  const [lo, hi] = span(n, 1);
  console.log(`  ${n.padEnd(10)} y ${lo.toFixed(3)} .. ${hi.toFixed(3)} m   lift ${((hi - lo) * 100).toFixed(1)} cm`);
}
const headY = span('Head', 1);
console.log(`  head y      ${headY[0].toFixed(3)} .. ${headY[1].toFixed(3)} m`);

// facing: the hips' +Z in world, at the first and last frame
const f0 = qrot([Q.Hips[0], Q.Hips[1], Q.Hips[2], Q.Hips[3]], [0, 0, 1]);
const fN = qrot([Q.Hips[(frames - 1) * 4], Q.Hips[(frames - 1) * 4 + 1], Q.Hips[(frames - 1) * 4 + 2], Q.Hips[(frames - 1) * 4 + 3]], [0, 0, 1]);
console.log(`  facing      first ${(Math.atan2(f0[0], f0[2]) * 180 / Math.PI).toFixed(1)} deg   last ${(Math.atan2(fN[0], fN[2]) * 180 / Math.PI).toFixed(1)} deg   (0 = +Z, the rig's forward)`);

// handedness falsifier: which hand went highest, and is the shoulder line correct?
let lhMax = -Infinity, rhMax = -Infinity;
for (let t = 0; t < frames; t++) { lhMax = Math.max(lhMax, P.LeftHand[t * 3 + 1]); rhMax = Math.max(rhMax, P.RightHand[t * 3 + 1]); }
const shoulderX = P.LeftShoulder[0] - P.RightShoulder[0];
console.log(`  hands       left peak ${lhMax.toFixed(3)} m   right peak ${rhMax.toFixed(3)} m   -> ${lhMax > rhMax + 0.08 ? 'LEFT raised' : rhMax > lhMax + 0.08 ? 'RIGHT raised' : 'neither clearly raised'}`);
console.log(`  shoulders   LeftShoulder.x - RightShoulder.x = ${shoulderX.toFixed(3)} m  (must be NEGATIVE: our rig puts Left at -X)`);

// root travel must be zero - the controller owns XZ
const rx = span('Hips', 0), rz = span('Hips', 2);
console.log(`  root xz     x ${rx[0].toFixed(3)}..${rx[1].toFixed(3)}   z ${rz[0].toFixed(3)}..${rz[1].toFixed(3)}   -> ${Math.max(rx[1] - rx[0], rz[1] - rz[0]) < 1e-5 ? 'STRIPPED (controller owns it)' : 'ROOT MOTION STILL PRESENT'}`);

// limb length constancy - proves the FK and the rest offsets agree
const seg = (a, b) => { let lo = Infinity, hi = -Infinity; for (let t = 0; t < frames; t++) { const d = Math.hypot(P[a][t * 3] - P[b][t * 3], P[a][t * 3 + 1] - P[b][t * 3 + 1], P[a][t * 3 + 2] - P[b][t * 3 + 2]); if (d < lo) lo = d; if (d > hi) hi = d; } return [lo, hi]; };
const thigh = seg('LeftUpLeg', 'LeftLeg'), shin = seg('LeftLeg', 'LeftFoot');
console.log(`  thigh ${thigh[0].toFixed(3)}-${thigh[1].toFixed(3)} m   shin ${shin[0].toFixed(3)}-${shin[1].toFixed(3)} m  (must be constant)`);

let nan = 0;
for (const n of nameOf) for (let i = 0; i < frames * 3; i++) if (!Number.isFinite(P[n][i])) nan++;
console.log(`  non-finite  ${nan}`);

if (sheet) {
  const pick = Array.from({ length: Math.min(8, frames) }, (_, i) => Math.round((i * (frames - 1)) / Math.min(7, frames - 1)));
  writePoseSheet(sheet, at, [...new Set(pick)], name);
  console.log(`  sheet       ${sheet}`);
}
