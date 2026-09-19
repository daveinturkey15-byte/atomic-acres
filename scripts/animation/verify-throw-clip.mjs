#!/usr/bin/env node
/**
 * CPU-only proof for the authored third-person grenade-throw body clip.
 *
 * No browser, renderer, server, or GPU. Bundles the real `clips.ts`,
 * `skeleton.ts` and `blend.ts` with esbuild and exercises them headless:
 *
 *   1. track validity  - every track addresses a real rig bone, times are
 *      strictly increasing, values are finite, quaternions are unit length.
 *      (A typo'd bone name parses perfectly and animates nothing.)
 *   2. forward axis    - +z is forward: the LEFT throwing hand is high and
 *      back at windup, snapped forward at the release beat, settled at carry
 *      by the end. Chest coil reverses sign through release (mirrored from
 *      the H3 right-hand reference). The RIGHT hand stays at carry: it has
 *      no windup/release keys, so a right-hand-throw regression fails here.
 *   3. contact         - feet/toes never penetrate the floor beyond 3 cm, the
 *      hips dip is bounded, and the final frame recovers to zero.
 *   4. event timing    - duration and release beat match the exported markers;
 *      the clip claims no root travel (speed/stride 0) and does not loop.
 *   5. rig/disposal  - the game path playThrowBody runs finite on a live
 *      CharacterRig with locomotion still ticking under the overlay, the
 *      carry layer releases the LEFT side while the RIGHT keeps the rifle in
 *      stable carry, the rifle never flails, hands never intersect the torso,
 *      and a scratch mixer can uncache the clip cleanly.
 *
 * The clip is a mirrored LEFT-hand authored adaptation of the H3 right-hand
 * reference (clips.ts): no skeleton extraction is claimed.
 */
import { build } from 'esbuild';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(tmpdir(), `nuketown-throw-clip-${process.pid}.mjs`);

const ENTRY = `
  import * as THREE from ${JSON.stringify(join(ROOT, 'node_modules/three'))};
  import { buildStandardSkeleton, BONE_NAMES, REST_OFFSETS } from ${JSON.stringify(join(ROOT, 'src/characters/skeleton'))};
  import { buildClipLibrary, THROW_BODY_S, THROW_BODY_RELEASE_S } from ${JSON.stringify(join(ROOT, 'src/characters/clips'))};
  import { CharacterRig } from ${JSON.stringify(join(ROOT, 'src/characters/blend'))};
  export { THREE, buildStandardSkeleton, BONE_NAMES, REST_OFFSETS, buildClipLibrary, THROW_BODY_S, THROW_BODY_RELEASE_S, CharacterRig };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'throw-clip-entry.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: OUT,
  logLevel: 'warning',
});

const api = await import(`file://${OUT}`);
const { THREE, buildStandardSkeleton, BONE_NAMES, REST_OFFSETS, buildClipLibrary } = api;
const { THROW_BODY_S, THROW_BODY_RELEASE_S, CharacterRig } = api;

const assert = (ok, message) => { if (!ok) throw new Error(`throw-clip: ${message}`); };
const bones = new Set(BONE_NAMES);
const trackBone = (name) => name.slice(0, name.lastIndexOf('.'));

const lib = buildClipLibrary();
const EXPECTED = ['idle', 'walk', 'run', 'sprint', 'crouch-idle', 'crouch-walk', 'prone-idle',
  'prone-crawl', 'jump', 'land', 'turn-left', 'turn-right', 'aim', 'fire', 'reload', 'throw',
  'hit-react', 'death'];
for (const name of EXPECTED) assert(lib[name], `library missing '${name}'`);
assert(Object.keys(lib).length === EXPECTED.length, `library has ${Object.keys(lib).length} clips, expected ${EXPECTED.length}`);

const spec = lib.throw;
assert(spec.loop === false, 'throw must be a one-shot (loop false)');
assert(spec.speed === 0 && spec.stride === 0, 'throw claims no root travel (speed/stride 0)');
assert(Math.abs(spec.clip.duration - THROW_BODY_S) < 1e-6, `duration ${spec.clip.duration} != THROW_BODY_S ${THROW_BODY_S}`);
assert(Math.abs(THROW_BODY_RELEASE_S - 0.45) < 1e-9, `release beat moved: ${THROW_BODY_RELEASE_S}`);

// ---- 1. track validity
let quatTracks = 0;
for (const track of spec.clip.tracks) {
  const bone = trackBone(track.name);
  assert(bones.has(bone), `track '${track.name}' addresses no rig bone`);
  const { times, values } = track;
  assert(times.length >= 2, `track '${track.name}' has fewer than 2 keys`);
  for (let i = 0; i < times.length; i++) {
    assert(Number.isFinite(times[i]), `track '${track.name}' time ${i} not finite`);
    if (i > 0) assert(times[i] > times[i - 1], `track '${track.name}' times not increasing at ${i}`);
  }
  const stride = values.length / times.length;
  for (let i = 0; i < times.length; i++) {
    for (let k = 0; k < stride; k++) assert(Number.isFinite(values[i * stride + k]), `track '${track.name}' value not finite at key ${i}`);
    if (track.name.endsWith('.quaternion')) {
      const x = values[i * 4], y = values[i * 4 + 1], z = values[i * 4 + 2], w = values[i * 4 + 3];
      assert(Math.abs(Math.hypot(x, y, z, w) - 1) < 1e-3, `track '${track.name}' key ${i} not unit length`);
      quatTracks++;
    }
  }
}
assert(quatTracks > 0, 'no quaternion tracks found');
// Release beat is a real key on the THROWING (left) arm, not an interpolated
// crossing. The right arm stays at carry: no windup/release keys allowed, so a
// right-hand-throw regression (excursion back on RightArm) fails here.
const leftTrack = spec.clip.tracks.find((t) => t.name === 'LeftArm.quaternion');
assert(leftTrack, 'no LeftArm track');
assert([...leftTrack.times].some((t) => Math.abs(t - THROW_BODY_RELEASE_S) < 1e-6), 'LeftArm has no key at the release beat');
assert([...leftTrack.times].some((t) => Math.abs(t - 0.18) < 1e-6), 'LeftArm has no key at the windup coil (0.18)');
const rightTrack = spec.clip.tracks.find((t) => t.name === 'RightArm.quaternion');
assert(rightTrack, 'no RightArm track');
assert(![...rightTrack.times].some((t) => Math.abs(t - THROW_BODY_RELEASE_S) < 1e-6), 'RightArm has a release key: rifle would flail with the throwing hand');
assert(![...rightTrack.times].some((t) => Math.abs(t - 0.18) < 1e-6), 'RightArm has a windup key: rifle would flail with the throwing hand');

// ---- 2/3. forward-axis read + floor contact, sampled on a scratch skeleton
const std = buildStandardSkeleton();
const mixer = new THREE.AnimationMixer(std.root);
const action = mixer.clipAction(spec.clip);
action.setLoop(THREE.LoopOnce, 1);
action.clampWhenFinished = true;
action.play();

const _v = new THREE.Vector3();
const _lh = new THREE.Vector3();
const _rh = new THREE.Vector3();
const _rs = new THREE.Vector3();
const _ls = new THREE.Vector3();
function sample(t) {
  mixer.setTime(t);
  std.root.updateMatrixWorld(true);
  std.bones.LeftHand.getWorldPosition(_lh);
  std.bones.RightHand.getWorldPosition(_rh);
  std.bones.RightShoulder.getWorldPosition(_rs);
  std.bones.LeftShoulder.getWorldPosition(_ls);
  let minY = Infinity;
  for (const b of ['LeftFoot', 'RightFoot', 'LeftToe', 'RightToe']) {
    std.bones[b].getWorldPosition(_v);
    minY = Math.min(minY, _v.y);
  }
  return {
    lhx: _lh.x, lhy: _lh.y, lhz: _lh.z,
    rhx: _rh.x, rhy: _rh.y, rhz: _rh.z,
    coil: _rs.z - _ls.z, minY,
  };
}

const windup = sample(0.18);
const release = sample(THROW_BODY_RELEASE_S);
const follow = sample(0.62);
const end = sample(0.899);
const start = sample(0);

// Left hand throws: high/back at windup, snapped forward at release.
assert(windup.lhy > 1.7 && windup.lhz < 0.1, `windup left hand not high/back: y=${windup.lhy.toFixed(2)} z=${windup.lhz.toFixed(2)}`);
assert(release.lhz > 0.3 && release.lhy < 1.5, `release left hand not snapped forward: y=${release.lhy.toFixed(2)} z=${release.lhz.toFixed(2)}`);
// Mirrored coil: left shoulder back at windup, uncoiled at release.
assert(windup.coil > 0.05, `windup chest not coiled left-back: ${windup.coil.toFixed(3)}`);
assert(release.coil < 0, `release chest not uncoiled: ${release.coil.toFixed(3)}`);
assert(Math.hypot(end.lhx - start.lhx, end.lhy - start.lhy, end.lhz - start.lhz) < 0.05, 'end pose does not settle to the start (carry) pose');
assert(follow.lhy < windup.lhy && follow.lhy > 0.8, `follow-through left hand off path: y=${follow.lhy.toFixed(2)}`);
// Right hand is authored flat at carry: start and end agree. Mid-clip it rides
// the torso coil in the RAW clip (no carry layer here) — the live rig below
// re-pins it to the chest anchor every frame, and that is where stability is
// asserted. A right-hand-throw regression would still fail the track check
// above (release/windup keys on RightArm) and the live-rig bounds below.
assert(Math.hypot(end.rhx - start.rhx, end.rhy - start.rhy, end.rhz - start.rhz) < 0.05, 'right hand does not stay at carry (rifle would flail)');

for (const [label, s] of [['windup', windup], ['release', release], ['follow', follow], ['end', end]]) {
  assert(s.minY >= -0.03, `${label}: foot/toe penetrates floor (${s.minY.toFixed(3)} m)`);
}

const hipsTrack = spec.clip.tracks.find((t) => t.name === 'Hips.position');
assert(hipsTrack, 'no Hips.position track');
{
  const { times, values } = hipsTrack;
  const restY = REST_OFFSETS.Hips[1];
  for (let i = 0; i < times.length; i++) {
    const dy = values[i * 3 + 1] - restY;
    assert(Math.abs(dy) <= 0.08, `hips dip ${dy.toFixed(3)} m exceeds 8 cm at key ${i}`);
  }
  const lastDy = values[(times.length - 1) * 3 + 1] - restY;
  const firstDy = values[1] - restY;
  assert(Math.abs(firstDy) < 1e-6 && Math.abs(lastDy) < 1e-6, 'hips dip does not start/end at zero (residual crouch)');
}

// ---- 5. live rig: the game path is playThrowBody (masked upper overlay),
// NOT playAir — a full-body one-shot stops the mixer, freezing stance and
// locomotion on every throw. Verify: the overlay runs finite, locomotion
// keeps ticking underneath, the carry layer's RIGHT side stays at full grip
// on the rifle while the LEFT side releases to the clip.
const std2 = buildStandardSkeleton();
const rig = new CharacterRig(std2.root, std2.bones, lib);
const input = { speed: 3.4, turnRate: 0, crouch: false, aimWeight: 0, aimPitch: 0 };
const walkBefore = std2.bones.Hips.quaternion.clone();
rig.playThrowBody('full');
const dt = 1 / 60;
let rightMin = Infinity;
let leftMin = Infinity;
let hipsMovedUnder = false;
for (let i = 0; i < 90; i++) {
  rig.update(dt, input);
  if (i * dt > 0.25 && i * dt < 0.7) {
    rightMin = Math.min(rightMin, rig.carryRightWeight);
    leftMin = Math.min(leftMin, rig.carryLeftWeight);
  }
  if (!std2.bones.Hips.quaternion.equals(walkBefore)) hipsMovedUnder = true;
  for (const name of BONE_NAMES) {
    const q = std2.bones[name].quaternion;
    assert(Number.isFinite(q.x + q.y + q.z + q.w), `rig bone ${name} non-finite at step ${i}`);
  }
}
// Hips animate ⇒ the locomotion mixer never stopped under the overlay — the
// full-body freeze this path replaces would leave them bit-identical.
assert(hipsMovedUnder, 'hips frozen during throw overlay: locomotion stopped (full-body regression)');
assert(!rig.isDead && rig.currentLocomotion === 'run', `rig did not keep running under the throw (got ${rig.currentLocomotion})`);
// LEFT side released to the clip; RIGHT side keeps the rifle pinned — the
// inverse of the rejected workaround, which flailed the rifle with the throw.
assert(leftMin < 0.1, `left side never released during throw (min ${leftMin.toFixed(2)})`);
assert(rightMin > 0.9, `right-side carry dipped during throw (min ${rightMin.toFixed(2)}): rifle unstable`);

// LEFT side released to the authored clip: the left hand must LEAVE the carry
// anchor for the toss while the right hand STAYS pinned to it.
{
  const std3 = buildStandardSkeleton();
  const rig3 = new CharacterRig(std3.root, std3.bones, lib);
  std3.root.updateMatrixWorld(true);
  std3.bones.LeftHand.getWorldPosition(_v);
  const leftStart = _v.clone();
  rig3.playThrowBody('full');
  for (let i = 0; i < 12; i++) rig3.update(dt, input); // ~0.2 s: at/near the coil
  std3.root.updateMatrixWorld(true);
  std3.bones.RightHand.getWorldPosition(_rh);
  std3.bones.LeftHand.getWorldPosition(_lh);
  const carryAnchor = new THREE.Vector3(0.10, 0.02, 0.15);
  std3.bones.Chest.updateWorldMatrix(true, false);
  carryAnchor.applyMatrix4(std3.bones.Chest.matrixWorld);
  assert(_rh.distanceTo(carryAnchor) < 0.15,
    `right hand left carry anchor during throw (d=${_rh.distanceTo(carryAnchor).toFixed(3)} m): rifle flailing`);
  assert(_lh.distanceTo(leftStart) > 0.30,
    `left hand never left carry for the toss (d=${_lh.distanceTo(leftStart).toFixed(3)} m): no throw`);
}

// Rifle bounds + self-intersection over the live overlay: right-hand path
// stays short (no flail), barrel stays near its start direction, hands stay
// out of the chest and apart from each other.
{
  const std4 = buildStandardSkeleton();
  const rig4 = new CharacterRig(std4.root, std4.bones, lib);
  // Settle locomotion to a steady run BEFORE baselines: capturing at rest
  // then measuring under run would blame the idle→run transition on the throw.
  for (let i = 0; i < 30; i++) rig4.update(dt, input);
  rig4.playThrowBody('full');
  const fore = new THREE.Vector3();
  const barrel = new THREE.Vector3();
  const barrel0 = new THREE.Vector3();
  const rh0 = new THREE.Vector3();
  const lh = new THREE.Vector3();
  const rh = new THREE.Vector3();
  const chest = new THREE.Vector3();
  std4.root.updateMatrixWorld(true);
  std4.bones.RightHand.getWorldPosition(rh0);
  rig4.weaponProbe(fore, barrel0);
  const rStart = rh0.clone();
  let rightWorst = 0;
  let barrelWorst = 0;
  let handGapMin = Infinity;
  let chestGapMin = Infinity;
  for (let i = 0; i < 54; i++) {
    rig4.update(dt, input);
    std4.root.updateMatrixWorld(true);
    std4.bones.LeftHand.getWorldPosition(lh);
    std4.bones.RightHand.getWorldPosition(rh);
    std4.bones.Chest.getWorldPosition(chest);
    rig4.weaponProbe(fore, barrel);
    rightWorst = Math.max(rightWorst, rh.distanceTo(rStart));
    barrelWorst = Math.max(barrelWorst, barrel.angleTo(barrel0));
    handGapMin = Math.min(handGapMin, lh.distanceTo(rh));
    chestGapMin = Math.min(chestGapMin, Math.min(lh.distanceTo(chest), rh.distanceTo(chest)));
    for (const name of BONE_NAMES) {
      const q = std4.bones[name].quaternion;
      assert(Number.isFinite(q.x + q.y + q.z + q.w), `bounds rig bone ${name} non-finite at step ${i}`);
    }
  }
  assert(rightWorst < 0.25, `rifle flailing: right hand wandered ${rightWorst.toFixed(3)} m from carry`);
  assert(barrelWorst < 0.55, `rifle flailing: barrel swung ${(barrelWorst * 180 / Math.PI).toFixed(1)} deg from carry`);
  assert(handGapMin > 0.08, `self-intersection: hands closed to ${handGapMin.toFixed(3)} m`);
  assert(chestGapMin > 0.08, `self-intersection: hand entered chest (${chestGapMin.toFixed(3)} m)`);
}

// Disposal: scratch mixer sheds the clip; the clip owns no GPU resources
mixer.stopAllAction();
mixer.uncacheClip(spec.clip);
for (const track of spec.clip.tracks) {
  for (const v of Object.values(track)) {
    assert(!(v && typeof v.dispose === 'function'), `track '${track.name}' holds a disposable resource`);
  }
}

console.log(JSON.stringify({
  verdict: 'PASS',
  duration: spec.clip.duration,
  release: THROW_BODY_RELEASE_S,
  tracks: spec.clip.tracks.length,
  windupHand: [windup.lhx, windup.lhy, windup.lhz].map((n) => +n.toFixed(3)),
  releaseHand: [release.lhx, release.lhy, release.lhz].map((n) => +n.toFixed(3)),
  carryRightMin: +rightMin.toFixed(3),
  carryLeftMin: +leftMin.toFixed(3),
}));
