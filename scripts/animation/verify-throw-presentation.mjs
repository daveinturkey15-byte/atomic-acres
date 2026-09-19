#!/usr/bin/env node
/**
 * CPU-only proof: grenade ordnance EVENTS → third-person throw BODY wiring.
 *
 * No browser, renderer, server, or GPU. Bundles the real `ordnance-view.ts`,
 * `throw-body.ts`, `blend.ts`, `clips.ts` and `skeleton.ts` with esbuild and
 * drives the actual presentation chain headless — the same objects main.ts
 * wires, minus the renderer:
 *
 *   1. wiring       - real `grenade-armed` / `grenade-thrown` events folded
 *                     through `OrdnanceView.apply` reach the rig as the right
 *                     playThrowBody phase, exactly once each.
 *   2. release time - the thrown event enters the clip AT the release beat
 *                     (THROW_BODY_THROWN_ENTRY_S == THROW_BODY_RELEASE_S):
 *                     the projectile already spawned when the event arrives,
 *                     so any run-up before the beat is LAG, not lead.
 *                     An anticipation hold releases into the same entry; a
 *                     late notification with no armed cue takes it too, and
 *                     the left-hand forward beat lands within ~0.05 s.
 *   3. stance       - stand / crouch / prone / running all keep their
 *                     locomotion and floor contact under the overlay, with the
 *                     right-side carry stable and the left released.
 *   4. yaw          - the throw reads along the ACTOR's forward: rotate the
 *                     root and the LEFT-hand path rotates with it.
 *   5. weapon       - the rifle is baked to RightHand (mesh.ts): the RIGHT
 *                     hand keeps it in stable carry (bounded position +
 *                     barrel) while the LEFT hand leaves the forestock for the
 *                     toss and returns. No hand-off is claimed or tested.
 *                     Tests reject rifle flailing and self-intersection, not
 *                     merely a reachable grip.
 *   6. interruption - death cancels a held windup, revive leaves no stale
 *                     hold, dead rigs ignore stale cues, the hold watchdog
 *                     CANCELS (never a fake release), a rebinding (match
 *                     reset) re-seats the cursor and cancels held overlays.
 *
 * The clip is a mirrored LEFT-hand authored adaptation of the H3 right-hand
 * reference: no skeleton extraction is claimed.
 */
import { build } from 'esbuild';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(tmpdir(), `nuketown-throw-presentation-${process.pid}.mjs`);

const ENTRY = `
  import * as THREE from ${JSON.stringify(join(ROOT, 'node_modules/three'))};
  import { buildStandardSkeleton, REST_OFFSETS } from ${JSON.stringify(join(ROOT, 'src/characters/skeleton'))};
  import { buildClipLibrary, THROW_BODY_S, THROW_BODY_RELEASE_S, THROW_BODY_HOLD_S, THROW_BODY_THROWN_ENTRY_S, THROW_BODY_HOLD_MAX_S } from ${JSON.stringify(join(ROOT, 'src/characters/clips'))};
  import { CharacterRig } from ${JSON.stringify(join(ROOT, 'src/characters/blend'))};
  import { OrdnanceView } from ${JSON.stringify(join(ROOT, 'src/game/ordnance-view'))};
  import { ThrowBodyPresentation } from ${JSON.stringify(join(ROOT, 'src/characters/throw-body'))};
  export { THREE, buildStandardSkeleton, REST_OFFSETS, buildClipLibrary, THROW_BODY_S, THROW_BODY_RELEASE_S, THROW_BODY_HOLD_S, THROW_BODY_THROWN_ENTRY_S, THROW_BODY_HOLD_MAX_S, CharacterRig, OrdnanceView, ThrowBodyPresentation };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'throw-presentation-entry.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: OUT,
  logLevel: 'warning',
});

const api = await import(`file://${OUT}`);
const {
  THREE, buildStandardSkeleton, REST_OFFSETS, buildClipLibrary,
  THROW_BODY_S, THROW_BODY_RELEASE_S, THROW_BODY_HOLD_S, THROW_BODY_THROWN_ENTRY_S, THROW_BODY_HOLD_MAX_S,
  CharacterRig, OrdnanceView, ThrowBodyPresentation,
} = api;

const assert = (ok, message) => { if (!ok) throw new Error(`throw-presentation: ${message}`); };
const DT = 1 / 60;
const _tv = new THREE.Vector3();

// Entry is AT the release beat: the projectile already exists on `thrown`.
assert(Math.abs(THROW_BODY_THROWN_ENTRY_S - THROW_BODY_RELEASE_S) < 1e-9,
  `thrown entry ${THROW_BODY_THROWN_ENTRY_S} is not at the release beat ${THROW_BODY_RELEASE_S} (run-up is lag)`);

// ---- fixtures: one rig per scenario, resolved by id like main.ts's botBodies
const lib = buildClipLibrary();

function makeBot(id) {
  const std = buildStandardSkeleton();
  const rig = new CharacterRig(std.root, std.bones, lib);
  return { id, std, rig, input: { speed: 0, turnRate: 0, crouch: false, aimWeight: 0, aimPitch: 0 } };
}

function armedEvent(at, actorId = 'bot-1') {
  return { type: 'grenade-armed', at, actorId, team: 0, grenadeId: 'frag', detonatesAt: null };
}
function thrownEvent(at, actorId = 'bot-1') {
  return {
    type: 'grenade-thrown', at, actorId, team: 0, grenadeId: 'frag', id: 1,
    x: 1, y: 1.4, z: 1, vx: 12, vy: 3, vz: 4, detonatesAt: at + 1800,
  };
}

const UPPER_LEN = Math.abs(REST_OFFSETS.LeftForeArm[1]);
const FORE_LEN = Math.abs(REST_OFFSETS.LeftHand[1]);
const REACH = UPPER_LEN + FORE_LEN;

// ---- 1 + 2. real events through the real projection onto a real rig
{
  const view = new OrdnanceView('self');
  const pres = new ThrowBodyPresentation();
  pres.bind(view);
  const bot = makeBot('bot-1');
  const resolve = (id) => (id === bot.id ? bot.rig : null);

  view.apply(armedEvent(1000));
  view.apply(thrownEvent(1200));
  pres.update(resolve);
  // armed and thrown consumed in ONE drain: the release beat is
  // authoritative, so the overlay must be in the release phase right away.
  assert(bot.rig.throwBodyPhase === 'release', `armed+thrown in one drain landed in '${bot.rig.throwBodyPhase}'`);

  // Entry AT the release beat: the LEFT hand is already at the forward snap
  // within ~0.05 s of the event. A run-up entry would still be winding up.
  const stdProbe = buildStandardSkeleton();
  const rigProbe = new CharacterRig(stdProbe.root, stdProbe.bones, lib);
  rigProbe.playThrowBody('release');
  const idleInput = { speed: 0, turnRate: 0, crouch: false, aimWeight: 0, aimPitch: 0 };
  const hand = new THREE.Vector3();
  for (let i = 0; i < 3; i++) rigProbe.update(DT, idleInput);
  stdProbe.root.updateMatrixWorld(true);
  stdProbe.bones.LeftHand.getWorldPosition(hand);
  assert(hand.z > 0.25 && hand.y < 1.5,
    `release left hand not forward within 0.05 s of entry: z=${hand.z.toFixed(2)} y=${hand.y.toFixed(2)}`);
  // Right hand never leaves carry for the toss.
  stdProbe.bones.RightHand.getWorldPosition(hand);
  const anchor = new THREE.Vector3(0.10, 0.02, 0.15);
  stdProbe.bones.Chest.updateWorldMatrix(true, false);
  anchor.applyMatrix4(stdProbe.bones.Chest.matrixWorld);
  assert(hand.distanceTo(anchor) < 0.18,
    `right hand left carry on release entry (d=${hand.distanceTo(anchor).toFixed(3)} m)`);
}

// Anticipation: windup plays in and HOLDS; the authoritative release moves it
// into the release phase; a hold whose event never comes CANCELS (watchdog),
// never an autonomous fake throw.
{
  const view = new OrdnanceView('self');
  const pres = new ThrowBodyPresentation();
  pres.bind(view);
  const bot = makeBot('bot-1');
  const resolve = () => bot.rig;

  view.apply(armedEvent(1000));
  pres.update(resolve);
  assert(bot.rig.throwBodyPhase === 'hold', `armed cue did not start the anticipation (${bot.rig.throwBodyPhase})`);
  for (let i = 0; i < 30; i++) bot.rig.update(DT, bot.input);
  assert(bot.rig.throwBodyPhase === 'hold', 'anticipation did not hold the windup');

  view.apply(thrownEvent(1200));
  pres.update(resolve);
  assert(bot.rig.throwBodyPhase === 'release', `thrown cue did not release the hold (${bot.rig.throwBodyPhase})`);
  for (let i = 0; i < 60; i++) bot.rig.update(DT, bot.input); // 0.45 → 0.9 + settle
  assert(bot.rig.throwBodyPhase === 'none', 'release overlay never finished');

  // Watchdog: an armed windup whose release never comes cancels to none. It
  // must NEVER pass through 'release' — that would be a fake throw with no
  // projectile, mislabelled as a real one.
  const botW = makeBot('bot-w');
  view.apply(armedEvent(2000, 'bot-w'));
  pres.update((id) => (id === 'bot-w' ? botW.rig : null));
  assert(botW.rig.throwBodyPhase === 'hold', 'watchdog fixture did not arm');
  let sawRelease = false;
  for (let i = 0; i < Math.ceil(THROW_BODY_HOLD_MAX_S / DT) + 40; i++) {
    botW.rig.update(DT, botW.input);
    if (botW.rig.throwBodyPhase === 'release') sawRelease = true;
  }
  assert(sawRelease === false, 'watchdog played an autonomous fake release (must cancel, not throw)');
  assert(botW.rig.throwBodyPhase === 'none', 'watchdog never cancelled the abandoned hold');
  for (let i = 0; i < 20; i++) botW.rig.update(DT, botW.input);
  assert(botW.rig.carryRightWeight > 0.9 && botW.rig.carryLeftWeight > 0.9,
    `carry did not recover after watchdog cancel (R ${botW.rig.carryRightWeight.toFixed(2)} L ${botW.rig.carryLeftWeight.toFixed(2)})`);

  // Late notification: no armed cue at all, still enters at the release beat.
  const bot2 = makeBot('bot-2');
  view.apply(thrownEvent(3000, 'bot-2'));
  pres.update((id) => (id === 'bot-2' ? bot2.rig : null));
  assert(bot2.rig.throwBodyPhase === 'release', `late thrown cue did not start the release (${bot2.rig.throwBodyPhase})`);
}

// ---- 3. stance variants: locomotion selection untouched by the overlay
const STANCES = [
  // [label, input, wantLoco, hipsAnimate] — the idle loop breathes without
  // rotating the hips, so only the gaiting clips prove the mixer still runs.
  ['stand idle', { speed: 0, turnRate: 0, crouch: false, aimWeight: 0, aimPitch: 0 }, 'idle', false],
  ['stand run', { speed: 3.4, turnRate: 0, crouch: false, aimWeight: 0, aimPitch: 0 }, 'run', true],
  ['crouch walk', { speed: 0.8, turnRate: 0, crouch: true, aimWeight: 0, aimPitch: 0 }, 'crouch-walk', true],
  ['prone crawl', { speed: 0.5, turnRate: 0, crouch: false, prone: true, aimWeight: 0, aimPitch: 0 }, 'prone-crawl', true],
];
for (const [label, input, wantLoco, hipsAnimate] of STANCES) {
  const bot = makeBot('bot-' + label);
  bot.input = { ...bot.input, ...input };
  bot.rig.playThrowBody('release');
  let hipsMoved = false;
  const hipsBefore = bot.std.bones.Hips.quaternion.clone();
  let footMinY = Infinity;
  let rightMin = Infinity;
  let leftMin = Infinity;
  for (let i = 0; i < 40; i++) { // 0.67 s: through release and follow-through
    bot.rig.update(DT, bot.input);
    if (!bot.std.bones.Hips.quaternion.equals(hipsBefore)) hipsMoved = true;
    rightMin = Math.min(rightMin, bot.rig.carryRightWeight);
    leftMin = Math.min(leftMin, bot.rig.carryLeftWeight);
    if (label !== 'prone crawl') { // the prone clips ride low by authoring
      for (const b of ['LeftFoot', 'RightFoot']) {
        bot.std.bones[b].getWorldPosition(_tv);
        footMinY = Math.min(footMinY, _tv.y - bot.std.root.position.y);
      }
    }
    for (const name of Object.keys(bot.std.bones)) {
      const q = bot.std.bones[name].quaternion;
      assert(Number.isFinite(q.x + q.y + q.z + q.w), `${label}: bone ${name} non-finite`);
    }
  }
  assert(bot.rig.currentLocomotion === wantLoco,
    `${label}: locomotion became ${bot.rig.currentLocomotion}, want ${wantLoco}`);
  if (hipsAnimate) assert(hipsMoved, `${label}: hips frozen — locomotion stopped under the overlay`);
  if (footMinY !== Infinity) {
    assert(footMinY > -0.06, `${label}: feet sank ${footMinY.toFixed(3)} m under the throw`);
  }
  // Split holds in every stance: right keeps the rifle (0.9 in prone by
  // authoring, 1 elsewhere), left is released to the clip.
  assert(rightMin > 0.8, `${label}: right carry dipped (${rightMin.toFixed(2)}): rifle unstable`);
  assert(leftMin < 0.1, `${label}: left side never released (min ${leftMin.toFixed(2)})`);
}

// ---- 4. forward yaw axis: the LEFT-hand release path rotates with the actor
{
  const bot = makeBot('bot-yaw');
  bot.std.root.rotation.y = Math.PI / 2; // actor faces +X now
  bot.rig.playThrowBody('release');
  for (let i = 0; i < 3; i++) bot.rig.update(DT, bot.input); // at the release beat
  bot.std.root.updateMatrixWorld(true);
  const hand = new THREE.Vector3();
  bot.std.bones.LeftHand.getWorldPosition(hand);
  const fwd = hand.clone().sub(bot.std.root.position);
  assert(fwd.x > 0.25 && fwd.x > fwd.z,
    `release left hand not along rotated forward: x=${fwd.x.toFixed(2)} z=${fwd.z.toFixed(2)}`);
}

// ---- 5. weapon bounds: right hand keeps the rifle, left throws and returns.
// Rejects the old workaround (rifle swinging with the throwing hand) and any
// self-intersection, over the REAL release path — not a hand-reach check.
{
  const bot = makeBot('bot-weapon');
  // Settle to steady idle carry BEFORE baselines: the fresh skeleton sits at
  // rest, and the first updates snap it into the solved carry — that snap is
  // not throw motion and must not be blamed on the rifle.
  for (let i = 0; i < 30; i++) bot.rig.update(DT, bot.input);
  bot.rig.playThrowBody('release');
  const fore = new THREE.Vector3();
  const barrel = new THREE.Vector3();
  const barrel0 = new THREE.Vector3();
  const lh = new THREE.Vector3();
  const rh = new THREE.Vector3();
  const chest = new THREE.Vector3();
  bot.std.root.updateMatrixWorld(true);
  bot.std.bones.RightHand.getWorldPosition(_tv);
  const rStart = _tv.clone();
  bot.rig.weaponProbe(fore, barrel0);
  let rightWorst = 0;
  let barrelWorst = 0;
  let leftGapMax = 0;
  let handGapMin = Infinity;
  let chestGapMin = Infinity;
  for (let i = 0; i < 34; i++) { // 0.45 → ~1.0: release through settle
    bot.rig.update(DT, bot.input);
    bot.std.root.updateMatrixWorld(true);
    bot.rig.weaponProbe(fore, barrel);
    bot.std.bones.LeftHand.getWorldPosition(lh);
    bot.std.bones.RightHand.getWorldPosition(rh);
    bot.std.bones.Chest.getWorldPosition(chest);
    assert(Number.isFinite(fore.x + fore.y + fore.z + barrel.x + barrel.y + barrel.z + lh.x + lh.y + lh.z + rh.x + rh.y + rh.z),
      `weapon probe non-finite at step ${i}`);
    rightWorst = Math.max(rightWorst, rh.distanceTo(rStart));
    barrelWorst = Math.max(barrelWorst, barrel.angleTo(barrel0));
    leftGapMax = Math.max(leftGapMax, lh.distanceTo(fore));
    handGapMin = Math.min(handGapMin, lh.distanceTo(rh));
    chestGapMin = Math.min(chestGapMin, Math.min(lh.distanceTo(chest), rh.distanceTo(chest)));
  }
  // Rifle stays put: the baked RightHand never flails with the left-hand toss.
  assert(rightWorst < 0.25, `rifle flailing: right hand wandered ${rightWorst.toFixed(3)} m from carry`);
  assert(barrelWorst < 0.55, `rifle flailing: barrel swung ${(barrelWorst * 180 / Math.PI).toFixed(1)} deg during throw`);
  // Left hand actually throws: it leaves the forestock, then comes back. A
  // grip that merely tracks the moving gun (old workaround) never detaches.
  assert(leftGapMax > 0.35, `left hand never left the rifle (max gap ${leftGapMax.toFixed(3)} m): no throw`);
  bot.std.root.updateMatrixWorld(true);
  bot.rig.weaponProbe(fore, barrel);
  bot.std.bones.LeftHand.getWorldPosition(lh);
  assert(lh.distanceTo(fore) < REACH * 1.15, `left support never returned to the rifle (gap ${lh.distanceTo(fore).toFixed(3)} m)`);
  // No self-intersection through the toss.
  assert(handGapMin > 0.08, `self-intersection: hands closed to ${handGapMin.toFixed(3)} m`);
  assert(chestGapMin > 0.08, `self-intersection: hand entered chest (${chestGapMin.toFixed(3)} m)`);
}

// ---- 6. interruption: death, revive, stale cues, match reset
{
  const view = new OrdnanceView('self');
  const pres = new ThrowBodyPresentation();
  pres.bind(view);
  const bot = makeBot('bot-1');
  const resolve = () => bot.rig;

  view.apply(armedEvent(1000));
  pres.update(resolve);
  assert(bot.rig.throwBodyPhase === 'hold', 'interruption fixture did not arm');
  for (let i = 0; i < 10; i++) bot.rig.update(DT, bot.input);
  bot.rig.playDeath();
  assert(bot.rig.throwBodyPhase === 'none', 'death left the throw overlay live');
  for (let i = 0; i < 20; i++) bot.rig.update(DT, bot.input); // carry ramps out while dead
  assert(bot.rig.carryRightWeight < 0.01 && bot.rig.carryLeftWeight < 0.01, 'death left carry live');
  // Stale armed + thrown cues for a dead rig: no overlay, no windup.
  view.apply(armedEvent(1100));
  view.apply(thrownEvent(1150));
  pres.update(resolve);
  assert(bot.rig.throwBodyPhase === 'none', 'dead rig started winding up on a stale cue');
  bot.rig.revive();
  for (let i = 0; i < 12; i++) bot.rig.update(DT, bot.input);
  assert(bot.rig.carryRightWeight > 0.5 && bot.rig.carryLeftWeight > 0.5,
    `carry never recovered after revive (R ${bot.rig.carryRightWeight.toFixed(2)} L ${bot.rig.carryLeftWeight.toFixed(2)})`);
  assert(bot.rig.throwBodyPhase === 'none', 'revive resurrected a stale hold');

  // Match reset: a NEW view (new client). A windup the presentation drove in
  // the old match is cancelled, and the old cursor must not shadow new cues.
  const view2 = new OrdnanceView('self');
  const botR = makeBot('bot-reset');
  view.apply(armedEvent(4000, 'bot-reset'));
  pres.update((id) => (id === 'bot-reset' ? botR.rig : null));
  assert(botR.rig.throwBodyPhase === 'hold', 'reset fixture did not arm');
  pres.bind(view2);
  assert(pres.qa().bound === true, 'rebind lost the view');
  assert(botR.rig.throwBodyPhase === 'none', 'rebind left a held windup running');
  view2.apply(thrownEvent(6000));
  pres.update(resolve); // seq 1 on the NEW view must fire despite the old cursor
  assert(bot.rig.throwBodyPhase === 'release', 'new-view cue shadowed by the old cursor');

  pres.bind(null);
  assert(pres.qa().bound === false && pres.qa().drivenRigs === 0, 'unbind left presentation state');
  view2.apply(thrownEvent(7000));
  pres.update(resolve); // must be a no-op, not a crash
  assert(bot.rig.throwBodyPhase === 'none', 'unbind left a live overlay on the rig');
}

console.log(JSON.stringify({
  verdict: 'PASS',
  entryBeat: THROW_BODY_THROWN_ENTRY_S,
  releaseBeat: THROW_BODY_RELEASE_S,
  holdPin: THROW_BODY_HOLD_S,
  holdMax: THROW_BODY_HOLD_MAX_S,
  duration: THROW_BODY_S,
}));
