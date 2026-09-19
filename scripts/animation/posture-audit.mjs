/**
 * Posture audit of a BAKED clip - the offline twin of the in-game acceptance.
 *
 * WHY IT EXISTS. The Wave 4 set shipped an idle whose figure stands 1.565 m tall
 * with a 40-degree stoop, and every offline number the bakery printed (foot
 * slide, loop seam, transfer fidelity) was green. Those numbers answer "did the
 * retarget carry the model's pose faithfully"; none of them answers "is the pose
 * a soldier standing up". This one does, and it is deliberately the SAME three
 * quantities the game-side verifier reads off the skinned surface, so a seed can
 * be rejected in 40 ms instead of after a three-minute browser run.
 *
 * It is a PROXY, not the acceptance. The acceptance is measured in the game from
 * the SkinnedMesh vertices (scripts/animation/surface-audit.mjs). This reads the
 * bone FK and pushes the helmet's own dome through it, which is the same
 * arithmetic the skinning shader does for a rigid weight-1 part - so the two
 * agree to millimetres on the head, and where they disagree the game wins.
 *
 *   surface top   highest point of the helmet dome / skull ball, metres
 *   torso lean    shoulder-centre -> hip-centre against vertical, degrees
 *   L/R abduction upper arm away from the body IN THE FRONTAL PLANE, degrees
 *                 (pure forward reach is flexion and scores 0, as it must:
 *                  a two-handed rifle carry is all flexion and no abduction)
 *
 *   node scripts/animation/posture-audit.mjs public/anim/idle.glb [more.glb ...]
 *   node scripts/animation/posture-audit.mjs --all
 */
import { readdirSync } from 'node:fs';
import { basename, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from './glb-read.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

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

/**
 * The helmet dome exactly as mesh.ts bakes it: dome(PI*0.62) scaled
 * [0.121, 0.130, 0.130] at [0, 0.046, -0.004] on the Head bone, plus the skull
 * ball for the cap faction. Sampled rather than reduced to an apex because a
 * tilted head does not present its apex to the sky.
 */
const HEAD_SHELL = (() => {
  const pts = [];
  const push = (cx, cy, cz, sx, sy, sz, thetaMax) => {
    for (let i = 0; i <= 10; i++) {
      const th = (i / 10) * thetaMax;
      for (let j = 0; j < 16; j++) {
        const ph = (j / 16) * Math.PI * 2;
        pts.push([
          cx + sx * Math.sin(th) * Math.cos(ph),
          cy + sy * Math.cos(th),
          cz + sz * Math.sin(th) * Math.sin(ph),
        ]);
      }
    }
  };
  push(0, 0.046, -0.004, 0.121, 0.130, 0.130, Math.PI * 0.62); // ballistic helmet
  push(0, 0.045, 0.006, 0.098, 0.115, 0.108, Math.PI * 0.5);   // skull (cap faction's crown)
  return pts;
})();

export function auditClip(file) {
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

  const P = {}, Q = {};
  for (const n of nameOf) { P[n] = new Float64Array(frames * 3); Q[n] = new Float64Array(frames * 4); }
  for (let t = 0; t < frames; t++) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nameOf[i], p = parentOf[i];
      const r = rot[n] ? [rot[n][t * 4], rot[n][t * 4 + 1], rot[n][t * 4 + 2], rot[n][t * 4 + 3]] : [0, 0, 0, 1];
      const lt = trans[n] ? [trans[n][t * 3], trans[n][t * 3 + 1], trans[n][t * 3 + 2]] : nodes[i].translation ?? [0, 0, 0];
      if (p < 0) { Q[n].set(r, t * 4); P[n].set(lt, t * 3); continue; }
      const pn = nameOf[p];
      const pq = [Q[pn][t * 4], Q[pn][t * 4 + 1], Q[pn][t * 4 + 2], Q[pn][t * 4 + 3]];
      Q[n].set(qmul(pq, r), t * 4);
      const o = qrot(pq, lt);
      P[n][t * 3] = P[pn][t * 3] + o[0];
      P[n][t * 3 + 1] = P[pn][t * 3 + 1] + o[1];
      P[n][t * 3 + 2] = P[pn][t * 3 + 2] + o[2];
    }
  }

  const at = (n, t) => [P[n][t * 3], P[n][t * 3 + 1], P[n][t * 3 + 2]];
  const qat = (n, t) => [Q[n][t * 4], Q[n][t * 4 + 1], Q[n][t * 4 + 2], Q[n][t * 4 + 3]];

  const out = { file: basename(file), frames, duration: +times[frames - 1].toFixed(3), per: [] };
  for (let t = 0; t < frames; t++) {
    // ---- surface top: the head shell pushed through the Head bone's world matrix
    const hq = qat('Head', t), hp = at('Head', t);
    let top = -Infinity;
    for (const v of HEAD_SHELL) {
      const w = qrot(hq, v);
      const y = hp[1] + w[1];
      if (y > top) top = y;
    }
    // ---- torso lean: hip centre -> shoulder centre against vertical
    const ls = at('LeftShoulder', t), rs = at('RightShoulder', t), hips = at('Hips', t);
    const sc = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2, (ls[2] + rs[2]) / 2];
    const v = [sc[0] - hips[0], sc[1] - hips[1], sc[2] - hips[2]];
    const vlen = Math.hypot(v[0], v[1], v[2]) || 1;
    const lean = (Math.acos(Math.max(-1, Math.min(1, v[1] / vlen))) * 180) / Math.PI;
    // signed forward component, so a backward arch is not reported as a stoop
    const leanFwd = (Math.atan2(v[2], v[1]) * 180) / Math.PI;
    // ---- abduction, in the FRONTAL plane only (X against -Y). Forward reach is
    // flexion and must score zero: a rifle held at the chest is all flexion.
    const abd = (side) => {
      const a = at(`${side}Arm`, t), b = at(`${side}ForeArm`, t);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const n = Math.hypot(u[0], u[1], u[2]) || 1;
      const lat = (side === 'Left' ? -u[0] : u[0]) / n;   // + = away from the body
      return (Math.atan2(lat, -u[1] / n) * 180) / Math.PI;
    };
    out.per.push({
      t: +times[t].toFixed(3),
      top: +top.toFixed(4),
      lean: +lean.toFixed(2),
      leanFwd: +leanFwd.toFixed(2),
      abdL: +abd('Left').toFixed(2),
      abdR: +abd('Right').toFixed(2),
      hipsY: +hips[1].toFixed(4),
      headY: +hp[1].toFixed(4),
    });
  }
  const col = (k) => out.per.map((p) => p[k]);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  out.summary = {
    topMin: +Math.min(...col('top')).toFixed(3),
    topMed: +med(col('top')).toFixed(3),
    leanMed: +med(col('lean')).toFixed(1),
    leanMax: +Math.max(...col('lean')).toFixed(1),
    leanFwdMed: +med(col('leanFwd')).toFixed(1),
    abdLMed: +med(col('abdL')).toFixed(1),
    abdLMax: +Math.max(...col('abdL')).toFixed(1),
    abdRMed: +med(col('abdR')).toFixed(1),
    abdRMax: +Math.max(...col('abdR')).toFixed(1),
    hipsYMean: +mean(col('hipsY')).toFixed(3),
  };
  // ---- loop seam, per joint, in centimetres: the brief's "< 2 cm per joint".
  let worstSeamCm = 0, worstSeamBone = '';
  for (const n of nameOf) {
    const d = Math.hypot(
      P[n][0] - P[n][(frames - 1) * 3],
      P[n][1] - P[n][(frames - 1) * 3 + 1],
      P[n][2] - P[n][(frames - 1) * 3 + 2],
    ) * 100;
    if (d > worstSeamCm) { worstSeamCm = d; worstSeamBone = n; }
  }
  out.summary.seamWorstCm = +worstSeamCm.toFixed(2);
  out.summary.seamWorstBone = worstSeamBone;
  return out;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
  || process.argv[1].endsWith('posture-audit.mjs')) {
  const argv = process.argv.slice(2);
  let files = argv.filter((a) => !a.startsWith('--'));
  if (argv.includes('--all') || files.length === 0) {
    const dir = join(ROOT, 'public', 'anim');
    files = readdirSync(dir).filter((f) => f.endsWith('.glb')).map((f) => join(dir, f));
  }
  const pad = (s, n) => String(s).padEnd(n);
  const rp = (s, n) => String(s).padStart(n);
  console.log(pad('clip', 18) + rp('topMed', 8) + rp('topMin', 8) + rp('leanMed', 9) + rp('leanMax', 9)
    + rp('abdL', 7) + rp('abdLmx', 8) + rp('abdR', 7) + rp('seam cm', 9) + '  worst');
  console.log('-'.repeat(93));
  for (const f of files) {
    try {
      const a = auditClip(f);
      const s = a.summary;
      console.log(pad(basename(f, '.glb'), 18) + rp(s.topMed.toFixed(3), 8) + rp(s.topMin.toFixed(3), 8)
        + rp(s.leanMed.toFixed(1), 9) + rp(s.leanMax.toFixed(1), 9)
        + rp(s.abdLMed.toFixed(1), 7) + rp(s.abdLMax.toFixed(1), 8) + rp(s.abdRMed.toFixed(1), 7)
        + rp(s.seamWorstCm.toFixed(2), 9) + '  ' + s.seamWorstBone);
    } catch (e) {
      console.log(pad(basename(f, '.glb'), 18) + '  ERROR ' + e.message);
    }
  }
}
