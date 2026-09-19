/**
 * SOMA-30 -> standard skeleton retarget, and the baked glTF the game ships.
 *
 * Every decision this file makes is a CALIBRATION, recorded in the manifest it
 * writes, because each one has a plausible-looking wrong answer:
 *
 * 1. REST POSE. SOMA rests in a T-pose (arms along X); our rig rests with the
 *    arms hanging (-Y). Copying local quaternions therefore puts our arms
 *    straight out sideways. The fix is a per-bone constant `C` that rotates our
 *    bone's rest direction onto the source's rest direction, so the transferred
 *    world rotation is `Q_target(t) = Q_source(t) * C`. Then our bone's rest
 *    direction lands exactly where the source bone points, and the source's
 *    twist about the bone transfers unchanged.
 *
 * 2. AXIS. The brief says "Kimodo Z-up -> glTF Y-up". MEASURED, that is false for
 *    soma-rp-v1.1: the root band sits at ~0.93 m on Y with only centimetres of
 *    travel, and X and Z carry metres. The data is already Y-up, so there is no
 *    -90 degree X rotation to apply, and applying one would lay every figure on
 *    its face. inspect-motion.mjs prints the measured axis per clip.
 *
 * 3. HANDEDNESS. SOMA's rest skeleton puts the LEFT shoulder, LEFT eye and LEFT
 *    hip at +X while the face and both toes point +Z and the spine runs +Y. In a
 *    right-handed Y-up frame a figure facing +Z has its left at -X, so the raw
 *    data is MIRRORED. A mirror is not a rotation and cannot be fixed by a root
 *    quaternion: we reflect X (positions negate x, quaternions (x,y,z,w) ->
 *    (x,-y,-z,w)) and read SOMA's Left chain onto our Right bones. Both halves
 *    or neither - one alone leaves a figure whose arm swings with the same-side
 *    leg. `calib-right-arm` is the falsifier and its result is in the manifest.
 *
 * 4. SCALE. Rotations are dimensionless, so only the root needs scaling. SOMA's
 *    rest pelvis sits 0.989 m above its toe; ours sits 0.857 m. Vertical motion
 *    is transferred as a DEVIATION FROM REST times that ratio, never as an
 *    absolute height, so a jump keeps its shape instead of being clamped.
 *
 * 5. HIP OWNERSHIP. For locomotion the CONTROLLER owns root XZ - `CharacterSystem
 *    .update` advances the root at `input.speed`. Root XZ is therefore STRIPPED
 *    from the clip and re-published as `speed`/`stride` metadata; root Y is kept
 *    so bob, crouch and jump survive. Leaving XZ in is the defect the brief warns
 *    about: every figure slides across the map at clip speed on top of the
 *    controller's own motion.
 *
 * 6. GROUNDING. After the rotations are on OUR rig, forward kinematics gives the
 *    real toe heights. The clip is shifted vertically so the 10th-percentile toe
 *    height matches the rig's resting toe height - percentile, not minimum, so a
 *    single bad frame cannot bury the whole clip.
 *
 *   node scripts/animation/retarget-soma.mjs --raw <scratch>/raw --manifest <scratch>/bake-manifest.json \
 *        [--only walk] [--out public/anim]
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOMA30_NAMES, SOMA30_PARENTS, SOMA30_OFFSETS, SOMA30_JOINTS, SOMA30_INDEX, SOMA30_TO_STANDARD, somaForwardKinematics } from './soma30.mjs';
import { loadStandardSkeleton } from './std-skeleton.mjs';
import { writeClipGlb } from './glb.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const rawRoot = opt('raw');
const manifestPath = opt('manifest');
const only = opt('only');
const outDir = resolve(opt('out', join(ROOT, 'public', 'anim')));
if (!rawRoot || !manifestPath) { console.error('--raw <dir> and --manifest <file> are required'); process.exit(2); }

const bake = JSON.parse(readFileSync(manifestPath, 'utf8'));
const STD = loadStandardSkeleton(ROOT);
const FPS = bake.generator.fps;

// ---------------------------------------------------------------- quaternions
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (a) => [-a[0], -a[1], -a[2], a[3]];
const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const norm = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
/** Shortest-arc quaternion taking unit a to unit b. */
function minArc(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) {
    let ax = [1, 0, 0];
    if (Math.abs(a[0]) > 0.9) ax = [0, 1, 0];
    const c = norm([a[1] * ax[2] - a[2] * ax[1], a[2] * ax[0] - a[0] * ax[2], a[0] * ax[1] - a[1] * ax[0]]);
    return [c[0], c[1], c[2], 0];
  }
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const q = [c[0], c[1], c[2], 1 + d];
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
const qyaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

// ------------------------------------------------- SOMA rest, mirrored into our frame
/** Rest world position of a SOMA joint, X negated (the mirror). */
const somaRestWorld = (() => {
  const w = [];
  for (let j = 0; j < SOMA30_JOINTS; j++) {
    const p = SOMA30_PARENTS[j];
    const base = p < 0 ? [0, 0, 0] : w[p];
    const o = SOMA30_OFFSETS[j];
    w.push([base[0] + o[0], base[1] + o[1], base[2] + o[2]]);
  }
  return w.map((v) => [-v[0], v[1], v[2]]);
})();

/**
 * Which descendant defines each bone's direction, in BOTH rigs.
 * Shoulders use the fore-arm, not the upper arm: our shoulder->arm offset is
 * [0,-0.02,0], a 2 cm stub whose direction is numerical noise, and calibrating
 * a correction against noise rotates the whole arm chain by a random amount.
 */
const DIRECTION_PAIRS = {
  Hips: ['Spine', 'Spine2'],
  Spine: ['Chest', 'Chest'],
  Chest: ['Neck', 'Neck1'],
  Neck: ['Head', 'Head'],
  LeftShoulder: ['LeftForeArm', 'LeftForeArm'],
  LeftArm: ['LeftForeArm', 'LeftForeArm'],
  LeftForeArm: ['LeftHand', 'LeftHand'],
  RightShoulder: ['RightForeArm', 'RightForeArm'],
  RightArm: ['RightForeArm', 'RightForeArm'],
  RightForeArm: ['RightHand', 'RightHand'],
  LeftUpLeg: ['LeftLeg', 'LeftShin'],
  LeftLeg: ['LeftFoot', 'LeftFoot'],
  LeftFoot: ['LeftToe', 'LeftToeBase'],
  RightUpLeg: ['RightLeg', 'RightShin'],
  RightLeg: ['RightFoot', 'RightFoot'],
  RightFoot: ['RightToe', 'RightToeBase'],
};
/** Leaves take their parent's correction; hand and toe orientation carry no game read. */
const LEAF_FROM_PARENT = { Head: 'Neck', LeftHand: 'LeftForeArm', RightHand: 'RightForeArm', LeftToe: 'LeftFoot', RightToe: 'RightFoot' };

/** standard bone -> soma joint index (the Left/Right crossing lives in soma30.mjs). */
const STD_TO_SOMA = {};
for (const [soma, std] of Object.entries(SOMA30_TO_STANDARD)) if (std) STD_TO_SOMA[std] = SOMA30_INDEX[soma];

/** Constant rest correction per bone. */
const CORRECTION = (() => {
  const C = {};
  for (const [bone, [ourChild, somaChild]] of Object.entries(DIRECTION_PAIRS)) {
    const u = norm([
      STD.restWorld[ourChild][0] - STD.restWorld[bone][0],
      STD.restWorld[ourChild][1] - STD.restWorld[bone][1],
      STD.restWorld[ourChild][2] - STD.restWorld[bone][2],
    ]);
    const sj = STD_TO_SOMA[bone];
    const sc = SOMA30_INDEX[somaChild];
    const v = norm([
      somaRestWorld[sc][0] - somaRestWorld[sj][0],
      somaRestWorld[sc][1] - somaRestWorld[sj][1],
      somaRestWorld[sc][2] - somaRestWorld[sj][2],
    ]);
    C[bone] = minArc(u, v);
  }
  for (const [leaf, parent] of Object.entries(LEAF_FROM_PARENT)) C[leaf] = C[parent];
  return C;
})();

/** Rest pelvis height above the toe, in each rig. Only the ratio is used. */
const SOMA_HIP_ABOVE_TOE = somaRestWorld[SOMA30_INDEX.Hips][1] - somaRestWorld[SOMA30_INDEX.LeftToeBase][1];
const OUR_HIP_ABOVE_TOE = STD.restWorld.Hips[1] - STD.restWorld.LeftToe[1];
const LEG_SCALE = OUR_HIP_ABOVE_TOE / SOMA_HIP_ABOVE_TOE;
const OUR_REST_TOE_Y = STD.restWorld.LeftToe[1];

// ---------------------------------------------------------------- our own FK
function ourForwardKinematics(localQ, hipsPos, frames) {
  const N = STD.names.length;
  const pos = {}; const wq = {};
  for (const n of STD.names) { pos[n] = new Float64Array(frames * 3); wq[n] = new Float64Array(frames * 4); }
  for (let t = 0; t < frames; t++) {
    for (const n of STD.names) {
      const p = STD.parents[n];
      const lq = [localQ[n][t * 4], localQ[n][t * 4 + 1], localQ[n][t * 4 + 2], localQ[n][t * 4 + 3]];
      if (!p) {
        wq[n].set(lq, t * 4);
        pos[n][t * 3] = hipsPos[t * 3]; pos[n][t * 3 + 1] = hipsPos[t * 3 + 1]; pos[n][t * 3 + 2] = hipsPos[t * 3 + 2];
        continue;
      }
      const pq = [wq[p][t * 4], wq[p][t * 4 + 1], wq[p][t * 4 + 2], wq[p][t * 4 + 3]];
      const w = qmul(pq, lq);
      wq[n].set(w, t * 4);
      const off = qrot(pq, STD.offsets[n]);
      pos[n][t * 3] = pos[p][t * 3] + off[0];
      pos[n][t * 3 + 1] = pos[p][t * 3 + 1] + off[1];
      pos[n][t * 3 + 2] = pos[p][t * 3 + 2] + off[2];
    }
  }
  return { pos, wq };
}
const percentile = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };

/**
 * Prompt id -> the ClipName `src/characters/clips.ts` substitutes on.
 *
 * The prompt library names clips for the MODEL ("aim-rifle-idle" tells it what
 * body to produce); the game names them for the BLEND TREE. The two sets are
 * almost the same and diverge on exactly two entries, which is the worst case:
 * a re-run of this script without the mapping writes `aim-rifle-idle.glb` and
 * `fire-recoil.glb`, `clips.ts` looks up `aim` and `fire`, finds nothing, and
 * silently ships the procedural aim and fire while every other clip is baked.
 * Nothing fails, nothing logs, and the aim pose the whole upper-body overlay
 * samples is quietly the authored one. The shipped manifest carried this
 * mapping and the script did not; it does now.
 */
const CLIP_NAME = { 'aim-rifle-idle': 'aim', 'fire-recoil': 'fire' };

// ---------------------------------------------------------------- one clip
function retargetClip(entry) {
  const clipName = CLIP_NAME[entry.id] ?? entry.id;
  const dir = join(rawRoot, entry.id);
  const asF = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const rootRaw = asF(join(dir, 'root_positions.f32'));
  const rotRaw = asF(join(dir, 'local_rotations_xyzw.f32'));
  const frames = rootRaw.length / 3;
  if (rotRaw.length / (frames * 4) !== SOMA30_JOINTS) throw new Error(`${entry.id}: not ${SOMA30_JOINTS} joints`);

  const { wq: somaWq } = somaForwardKinematics(rootRaw, rotRaw, frames);

  // --- mirror (reflect X): positions negate x, rotations (x,y,z,w)->(x,-y,-z,w).
  const mq = (t, j) => { const i = (t * SOMA30_JOINTS + j) * 4; return [somaWq[i], -somaWq[i + 1], -somaWq[i + 2], somaWq[i + 3]]; };
  const mRoot = (t) => [-rootRaw[t * 3], rootRaw[t * 3 + 1], rootRaw[t * 3 + 2]];

  // --- global yaw so the clip starts facing, and travels, +Z (our rig's forward).
  const p0 = mRoot(0); const p1 = mRoot(frames - 1);
  const travel = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  //
  // Align a LOCOMOTION LOOP by where it travels, because the controller will
  // push the root along +Z and the two must agree. Align everything else by
  // where the BODY faces at frame 0.
  //
  // Using travel for a one-shot is wrong and it was wrong here: `hit-react`
  // staggers BACKWARD, so its travel vector points behind the figure, and
  // aligning that to +Z spun the clip 180 degrees - the shipped clip had
  // LeftShoulder.x - RightShoulder.x at +0.318 m when our rig requires it
  // negative. A one-shot's root XZ is stripped anyway, so travel buys nothing
  // and costs the facing.
  let heading;
  if (entry.loopHint && travel > 0.30) heading = Math.atan2(p1[0] - p0[0], p1[2] - p0[2]);
  else { const f = qrot(mq(0, 0), [0, 0, 1]); heading = Math.atan2(f[0], f[2]); }
  const yawFix = qyaw(-heading);

  // --- transfer rotations onto our bones, then convert world -> local.
  const worldQ = {};
  for (const n of STD.names) worldQ[n] = new Float64Array(frames * 4);
  for (let t = 0; t < frames; t++) {
    for (const n of STD.names) {
      const q = qmul(qmul(yawFix, mq(t, STD_TO_SOMA[n])), CORRECTION[n]);
      worldQ[n].set(q, t * 4);
    }
  }
  const localQ = {};
  for (const n of STD.names) localQ[n] = new Float32Array(frames * 4);
  for (let t = 0; t < frames; t++) {
    for (const n of STD.names) {
      const p = STD.parents[n];
      const w = [worldQ[n][t * 4], worldQ[n][t * 4 + 1], worldQ[n][t * 4 + 2], worldQ[n][t * 4 + 3]];
      const l = p ? qmul(qconj([worldQ[p][t * 4], worldQ[p][t * 4 + 1], worldQ[p][t * 4 + 2], worldQ[p][t * 4 + 3]]), w) : w;
      localQ[n].set(l, t * 4);
    }
  }

  // --- root. XZ stripped (the controller owns it); Y kept as a scaled deviation.
  const yawedRoot = [];
  for (let t = 0; t < frames; t++) yawedRoot.push(qrot(yawFix, mRoot(t)));
  const hipsPos = new Float32Array(frames * 3);
  for (let t = 0; t < frames; t++) {
    hipsPos[t * 3] = 0;
    hipsPos[t * 3 + 1] = STD.restWorld.Hips[1] + (yawedRoot[t][1] - SOMA_HIP_ABOVE_TOE) * LEG_SCALE;
    hipsPos[t * 3 + 2] = 0;
  }

  // --- ground on OUR rig's measured toe heights.
  let fk = ourForwardKinematics(localQ, hipsPos, frames);
  const minToe = [];
  for (let t = 0; t < frames; t++) minToe.push(Math.min(fk.pos.LeftToe[t * 3 + 1], fk.pos.RightToe[t * 3 + 1]));
  const lift = OUR_REST_TOE_Y - percentile(minToe, 0.10);
  for (let t = 0; t < frames; t++) hipsPos[t * 3 + 1] += lift;
  fk = ourForwardKinematics(localQ, hipsPos, frames);

  // --- SPEED AND STANCE, from foot VELOCITY rather than foot height.
  //
  // Height looked like the obvious stance test and is not. In this walk the
  // swinging toe dips to 3.4 cm mid-swing while the planted toe sits at 2.0 cm,
  // so every height threshold either splits one plant into three or calls half
  // the swing a plant. Measured consequence: 4 "strides" inside a single gait
  // cycle and 39.6 cm of reported skate, on a clip whose planted foot actually
  // holds world position to 0.4 cm.
  //
  // Velocity has no such ambiguity, and it also yields the speed. A planted toe
  // moves backward through clip-local space at exactly the locomotion speed, and
  // in a walk or a jog at least one foot is planted at any instant. So the true
  // speed v is the value minimising, over the window, the sum of
  // min(|b_left - v|, |b_right - v|) where b is a toe's backward velocity. L1,
  // so the airborne minority of a jump cannot drag it. An in-place clip has both
  // feet at b = 0 and falls out at v = 0 with no special case.
  const bvel = {};
  for (const side of ['Left', 'Right']) {
    const toe = fk.pos[`${side}Toe`];
    const b = new Float64Array(frames);
    for (let t = 1; t < frames; t++) b[t] = -(toe[t * 3 + 2] - toe[(t - 1) * 3 + 2]) * FPS;
    b[0] = b[1];
    bvel[side] = b;
  }
  let speedFeet = 0, bestCost = Infinity;
  for (let v = 0; v <= 8.0; v += 0.01) {
    let c = 0;
    for (let t = 1; t < frames; t++) c += Math.min(Math.abs(bvel.Left[t] - v), Math.abs(bvel.Right[t] - v));
    if (c < bestCost) { bestCost = c; speedFeet = v; }
  }
  const vTol = Math.max(0.25, speedFeet * 0.15);
  const stanceOf = (side) => {
    const toe = fk.pos[`${side}Toe`];
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < frames; t++) { const y = toe[t * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
    const ceil = lo + Math.max(0.02, (hi - lo) * 0.5);
    const on = new Array(frames).fill(false);
    for (let t = 0; t < frames; t++) on[t] = Math.abs(bvel[side][t] - speedFeet) < vTol && toe[t * 3 + 1] <= ceil;
    // Drop plants too short to be real, and bridge single-frame dropouts.
    for (let t = 1; t < frames - 1; t++) if (!on[t] && on[t - 1] && on[t + 1]) on[t] = true;
    const minRun = Math.max(2, Math.round(FPS * 0.08));
    for (let t = 0; t < frames;) {
      if (!on[t]) { t++; continue; }
      let e = t; while (e < frames && on[e]) e++;
      if (e - t < minRun) for (let k = t; k < e; k++) on[k] = false;
      t = e;
    }
    return on;
  };
  const stance = { Left: stanceOf('Left'), Right: stanceOf('Right') };

  // --- loop window. The descriptor is deliberately leg-weighted: the hands and
  // head of a walk are nearly periodic at HALF the gait period, so a descriptor
  // that averages the whole body happily returns a half cycle with the legs
  // swapped. Measured here: an unweighted search picked 23 frames when foot
  // contacts said the cycle was 30, and that mis-scaled speed produced 80 cm of
  // apparent skate.
  const desc = (t) => {
    const d = [];
    for (const n of ['LeftToe', 'RightToe', 'LeftFoot', 'RightFoot']) {
      d.push(3 * (fk.pos[n][t * 3] - fk.pos.Hips[t * 3]), 3 * (fk.pos[n][t * 3 + 1] - fk.pos.Hips[t * 3 + 1]), 3 * (fk.pos[n][t * 3 + 2] - fk.pos.Hips[t * 3 + 2]));
    }
    for (const n of ['LeftHand', 'RightHand', 'Head']) {
      d.push(fk.pos[n][t * 3] - fk.pos.Hips[t * 3], fk.pos[n][t * 3 + 1] - fk.pos.Hips[t * 3 + 1], fk.pos[n][t * 3 + 2] - fk.pos.Hips[t * 3 + 2]);
    }
    d.push(fk.pos.Hips[t * 3 + 1]);
    return d;
  };
  const D = []; for (let t = 0; t < frames; t++) D.push(desc(t));
  const dist = (a, b) => { let s = 0; for (let i = 0; i < D[a].length; i++) s += (D[a][i] - D[b][i]) ** 2; return Math.sqrt(s); };

  // Period by AUTOCORRELATION, not by counting foot contacts. Contacts looked
  // like the obvious clock and are not: a toe crosses any height band several
  // times per step (heel strike, flat, toe-off, a scuff), which here reported a
  // 14-frame "cycle" for a gait whose real period is 30. Autocorrelation over
  // the whole leg-weighted pose has no such threshold to get wrong.
  // A STATIONARY loop has no gait period, and asking autocorrelation for one
  // gets the shortest lag it is allowed to return - measured here, an 11-frame
  // "cycle" that turned a four-second idle into a 0.33 s twitch. Idles are
  // therefore windowed by a different rule: take the LONGEST window that still
  // closes, never the most self-similar one.
  const stationary = speedFeet < 0.25;
  let cycleFrames = 0;
  if (entry.loopHint && !stationary) {
    let best = Infinity;
    for (let p = Math.round(0.50 * FPS); p <= Math.min(frames - 2, Math.round(2.2 * FPS)); p++) {
      let s = 0, n = 0;
      for (let t = 0; t + p < frames; t++) { s += dist(t, t + p); n++; }
      const mean = s / Math.max(1, n);
      if (mean < best) { best = mean; cycleFrames = p; }
    }
  }

  let s0 = 0, e0 = frames - 1, seam = Infinity;
  if (entry.loopHint) {
    const minP = stationary
      ? Math.min(frames - 1, Math.round(1.6 * FPS))
      : Math.max(8, Math.round(cycleFrames * 0.85));
    const maxP = stationary
      ? frames - 1
      : Math.min(frames - 1, Math.round(cycleFrames * 1.18));
    const maxStart = Math.max(0, frames - 1 - minP);
    for (let s = 0; s <= maxStart; s++) {
      for (let e = s + minP; e < frames && e - s <= maxP; e++) {
        // Stationary clips trade a slightly worse seam for real duration: a
        // two-second idle with a 2 cm seam reads far better than a half-second
        // one with a perfect seam, because the eye sees the repeat, not the cut.
        const d = stationary ? dist(s, e) - (e - s) * 0.0006 : dist(s, e);
        if (d < seam) { seam = d; s0 = s; e0 = e; }
      }
    }
    if (stationary) seam = dist(s0, e0);
  } else {
    seam = dist(0, frames - 1);
  }
  const outFrames = entry.loopHint ? e0 - s0 + 1 : frames;
  const duration = (outFrames - 1) / FPS;

  // --- the root's own arc length, as an INDEPENDENT second opinion on speed.
  // Arc, not chord: a walk that curves has a shorter chord and the shortfall
  // would reappear as skate. The feet win when the two disagree, because the
  // feet are what the eye reads, and both numbers ship in the manifest.
  let arc = 0;
  for (let t = s0 + 1; t <= (entry.loopHint ? e0 : frames - 1); t++) {
    arc += Math.hypot(yawedRoot[t][0] - yawedRoot[t - 1][0], yawedRoot[t][2] - yawedRoot[t - 1][2]);
  }
  const speedRoot = duration > 0 ? (arc * LEG_SCALE) / duration : 0;
  const speed = speedFeet;
  const strideRaw = speed * duration;

  // --- foot slide over the trimmed window. With root XZ stripped the
  // controller advances the root at `speed`, so a planted toe must be
  // world-stationary; whatever it does move is skate, in centimetres.
  let worstSlideCm = 0; let strides = 0;
  for (const side of ['Left', 'Right']) {
    const toe = fk.pos[`${side}Toe`];
    let inStance = false, ax = 0, az = 0, run = 0;
    for (let k = 0; k < outFrames; k++) {
      const t = s0 + k;
      const wx = toe[t * 3];                           // clip-local X (root XZ is 0)
      const wz = toe[t * 3 + 2] + speed * (k / FPS);   // plus the controller's advance
      if (stance[side][t] && !inStance) { inStance = true; ax = wx; az = wz; run = 0; }
      else if (stance[side][t]) { run = Math.max(run, Math.hypot(wx - ax, wz - az)); }
      else if (inStance) { inStance = false; strides++; worstSlideCm = Math.max(worstSlideCm, run * 100); }
    }
    if (inStance) { strides++; worstSlideCm = Math.max(worstSlideCm, run * 100); }
  }

  // --- emit. A looping clip repeats its first key at t=duration so the mixer's
  // wrap is exact rather than "close".
  const keyCount = entry.loopHint ? outFrames : frames;
  const times = new Float32Array(keyCount);
  for (let k = 0; k < keyCount; k++) times[k] = k / FPS;
  const rotations = {}; const translations = {};
  for (const n of STD.names) {
    const r = new Float32Array(keyCount * 4);
    for (let k = 0; k < keyCount; k++) {
      const t = Math.min(frames - 1, s0 + k);
      r.set([localQ[n][t * 4], localQ[n][t * 4 + 1], localQ[n][t * 4 + 2], localQ[n][t * 4 + 3]], k * 4);
    }
    rotations[n] = r;
  }
  const tr = new Float32Array(keyCount * 3);
  for (let k = 0; k < keyCount; k++) {
    const t = Math.min(frames - 1, s0 + k);
    tr.set([0, hipsPos[t * 3 + 1], 0], k * 3);
  }
  translations.Hips = tr;

  const bones = STD.names.map((n) => ({
    name: n,
    parent: STD.parents[n] ? STD.names.indexOf(STD.parents[n]) : null,
    translation: STD.offsets[n],
  }));

  // A clip the library marks `"ship": false` is still generated, retargeted and
  // MEASURED - the rejection has to stay falsifiable, and a number nobody can
  // reproduce is not evidence - but it is written to a scratch file and kept out
  // of the manifest, so `clips.ts` never substitutes it and the game keeps the
  // authored clip for that name. This is how a clip gets rejected without being
  // quietly deleted.
  const shipped = entry.ship !== false;
  // A rejected clip is written beside the RAW motion, never into outDir: the
  // evidence stays on the machine and public/anim keeps only what ships.
  const writeDir = shipped ? outDir : join(rawRoot, '..', '_rejected');
  mkdirSync(writeDir, { recursive: true });
  const file = join(writeDir, `${clipName}.glb`);
  const bytes = writeClipGlb(file, {
    name: clipName, bones, times, rotations, translations,
    extras: { source: 'kimodo-soma-rp-v1.1', seed: entry.seed, fps: FPS, speed, stride: strideRaw, loop: !!entry.loopHint },
  });

  // Foot slide is only a defect in a LOOP. A pivot has to step its feet round,
  // a death has to fall over, and reporting their footfall as "skate" would
  // make the one number that matters unreadable across the set.
  const slideMeaningful = !!entry.loopHint;

  return {
    id: clipName, promptId: entry.id, prompt: entry.text, seedNote: entry.note ?? null,
    ship: shipped, file: shipped ? `${clipName}.glb` : null, bytes,
    frames: keyCount, duration: +duration.toFixed(3), fps: FPS,
    trimmed: entry.loopHint ? [s0, e0] : null,
    loop: !!entry.loopHint,
    loopSeam: +seam.toFixed(4),
    speed: +speed.toFixed(3), speedRoot: +speedRoot.toFixed(3), speedFeet: +speedFeet.toFixed(3),
    cycleFrames, stride: +strideRaw.toFixed(3),
    footSlideCm: slideMeaningful ? +worstSlideCm.toFixed(1) : null,
    footTravelCm: slideMeaningful ? null : +worstSlideCm.toFixed(1), strides,
    hipYRange: [+percentile(Array.from({ length: keyCount }, (_, k) => hipsPos[(s0 + k) * 3 + 1]), 0).toFixed(3),
      +percentile(Array.from({ length: keyCount }, (_, k) => hipsPos[(s0 + k) * 3 + 1]), 1).toFixed(3)],
    headingDeg: +((heading * 180) / Math.PI).toFixed(1),
    seed: entry.seed,
  };
}

// ---------------------------------------------------------------- run
const entries = bake.clips.filter((c) => (!only || c.id === only) && existsSync(join(rawRoot, c.id)));
if (!entries.length) { console.error('no raw clips matched'); process.exit(2); }

console.log(`rest correction calibrated against ${Object.keys(CORRECTION).length} bones`);
console.log(`leg scale  ours ${OUR_HIP_ABOVE_TOE.toFixed(3)} m / soma ${SOMA_HIP_ABOVE_TOE.toFixed(3)} m = ${LEG_SCALE.toFixed(4)}`);
console.log('');
const out = [];
for (const e of entries) {
  try { out.push(retargetClip(e)); }
  catch (err) { console.log(`FAIL ${e.id}: ${err.message}`); out.push({ id: e.id, error: String(err.message) }); }
}
const pad = (s, n) => String(s).padEnd(n); const rp = (s, n) => String(s).padStart(n);
console.log(pad('clip', 17) + rp('keys', 6) + rp('dur s', 7) + rp('speed', 7) + rp('stride', 8) + rp('slide cm', 10) + rp('seam', 8) + rp('kB', 7));
console.log('-'.repeat(70));
for (const r of out) {
  if (r.error) { console.log(pad(r.id, 17) + '  ' + r.error); continue; }
  console.log(pad(r.id, 17) + rp(r.frames, 6) + rp(r.duration.toFixed(2), 7) + rp(r.speed.toFixed(2), 7)
    + rp(r.stride.toFixed(2), 8) + rp(r.footSlideCm === null ? 'n/a' : r.footSlideCm.toFixed(1), 10) + rp(r.loopSeam.toFixed(3), 8) + rp((r.bytes / 1024).toFixed(0), 7));
}
// MERGE with whatever is already shipped in outDir. `--only idle` used to write
// a manifest holding idle alone; kimodo-clips.ts loads exactly what the manifest
// lists, so a one-clip re-roll would have silently un-shipped the other fifteen
// baked clips and the game would have fallen back to procedural for all of them
// with nothing but a console line to say so.
mkdirSync(outDir, { recursive: true });
const outManifest = join(outDir, 'manifest.json');
let priorOut = { clips: [] };
if (existsSync(outManifest)) {
  try { priorOut = JSON.parse(readFileSync(outManifest, 'utf8')); } catch { priorOut = { clips: [] }; }
}
const replaced = new Set(out.filter((r) => !r.error).map((r) => r.id));
const mergedClips = [...(priorOut.clips ?? []).filter((c) => !replaced.has(c.id)),
  ...out.filter((r) => !r.error && r.ship !== false)];
const rejected = out.filter((r) => !r.error && r.ship === false).map((r) => r.id);
if (rejected.length) console.log(`NOT SHIPPED (library says ship:false): ${rejected.join(', ')} - the game keeps the authored clip for those names`);
writeFileSync(outManifest, JSON.stringify({
  // Spread the prior manifest first so any key a later pass added (`renamed`,
  // `dropped`, an owner note) survives a one-clip re-roll.
  ...priorOut,
  dropped: [...new Set([...(priorOut.dropped ?? []), ...rejected])],
  baked: bake.baked, generator: bake.generator, provenance: bake.provenance,
  calibration: {
    upAxis: 'y (measured, not assumed - see inspect-motion.mjs)',
    mirrored: true,
    mirrorNote: 'SOMA rest puts Left at +X with the face at +Z; reflected in X and Left/Right relabelled',
    legScale: +LEG_SCALE.toFixed(4),
    ourHipAboveToe: +OUR_HIP_ABOVE_TOE.toFixed(4),
    somaHipAboveToe: +SOMA_HIP_ABOVE_TOE.toFixed(4),
    rootXZ: 'stripped - the controller owns it; speed/stride published instead',
    rootY: 'kept, scaled deviation from rest, then grounded on the 10th-percentile toe height',
  },
  clips: mergedClips,
}, null, 2));
console.log(`\nwrote ${out.filter((r) => !r.error).length} clip(s) to ${outDir}`);
