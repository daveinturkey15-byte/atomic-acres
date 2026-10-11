/**
 * Nuketown 2025 — Chopper Gunner proof. Dependency-free: no test runner, no
 * node builtins (this file must stay clean under the repo's `tsc --noEmit`,
 * which has no @types/node). Run by bundling with the repo's own esbuild
 * and executing the bundle; any failed check throws, so a silent pass IS
 * the pass. See docs/HANDOFF-PARITY.md for the command.
 */

import { StreakRuntime, type StreakIntent } from '../runtime';
import { STREAK_CATALOG, streakById } from '../catalog';
import { GameClient } from '../../client';
import { isGameMessage, type StreakPoseMsg } from '../../../net/protocol-game';
import {
  CHOPPER_AI_ROCKET_BUDGET,
  CHOPPER_ALTITUDE_M,
  CHOPPER_ARM_MS,
  CHOPPER_BOB_M,
  CHOPPER_CANNON_CADENCE_MS,
  CHOPPER_CANNON_DAMAGE,
  CHOPPER_CANNON_RANGE_M,
  CHOPPER_DURATION_MS,
  CHOPPER_INBOUND_SHARE,
  CHOPPER_OUTBOUND_SHARE,
  CHOPPER_REVOLUTIONS,
  CHOPPER_ROCKETS,
  CHOPPER_ROCKET_BLAST_M,
  CHOPPER_ROCKET_CADENCE_MS,
  CHOPPER_ROCKET_MAX_DAMAGE,
  CHOPPER_ROCKET_RANGE_M,
  MAX_CHOPPER_CANNON_PER_STEP,
  MAX_CHOPPER_ROCKETS_PER_STEP,
  chopperClampCentre,
  chopperPhaseAt,
  chopperPoseAt,
  chopperRadii,
  createChopper,
  stepChopper,
} from './chopper';
import type { SentryTarget } from './sentry';
import type { WorldQuery } from '../../events';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`chopper proof failed: ${name}`);
  passed += 1;
}

const WORLD: WorldQuery = Object.freeze({
  lineOfSight: () => true,
  groundY: () => 0,
  inBounds: (x: number, z: number) => Math.abs(x) <= 40 && Math.abs(z) <= 40,
});
const BLIND: WorldQuery = Object.freeze({
  lineOfSight: () => false,
  groundY: () => 0,
  inBounds: (x: number, z: number) => Math.abs(x) <= 40 && Math.abs(z) <= 40,
});

function target(overrides: Partial<SentryTarget> = {}): SentryTarget {
  return Object.freeze({
    id: 'victim', team: 1, alive: true, health: 100, x: 0, y: 0, z: 0, ...overrides,
  });
}

const LOADOUT = ['recon-sweep', 'signal-jam', 'sentry-post', 'chopper-gunner'] as const;

function press(overrides: Partial<StreakIntent> = {}): StreakIntent {
  return {
    actorId: 'owner', slot: 4, seq: 0, claimId: 'parity-chopper-1', life: 0, matchEpoch: 1,
    toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: 5, y: 0, z: 5 },
    context: {
      alive: true, matchPhase: 'active' as const, inputEnabled: true,
      menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
    },
    ...overrides,
  };
}

// 1. Catalog declares the row the runtime wires.
check('catalog declares chopper-gunner high/9/possession', (() => {
  const def = streakById('chopper-gunner', STREAK_CATALOG);
  return def !== null && def.cost === 9 && def.tier === 'high' && def.activation === 'possession'
    && def.durationMs === 30_000 && def.repeatable === false && def.baseWeightUnits === 2;
})());

// 2. Radii are 36% of the arena half-extents (44.5 x 84 m map).
const radii = chopperRadii();
check('radius x is 36% of half width', Math.abs(radii.rx - 0.36 * 22.25) < 1e-9);
check('radius z is 36% of half depth', Math.abs(radii.rz - 0.36 * 42) < 1e-9);

// 3. The centre clamp keeps the whole ellipse in-bounds.
const inner = chopperClampCentre(5, 5);
check('in-bounds centre unchanged', inner.x === 5 && inner.z === 5);
const edge = chopperClampCentre(24, 41);
check('edge centre clamped inside', edge.x <= 25 - radii.rx && edge.z <= 42 - radii.rz);

// 4. Seeded determinism: same seed, same orbit; different seeds, different phases.
const cA = createChopper(1, 'owner', 0, 'chopper-gunner', CHOPPER_DURATION_MS, { x: 5, y: 0, z: 5 }, 77);
const cB = createChopper(2, 'owner', 0, 'chopper-gunner', CHOPPER_DURATION_MS, { x: 5, y: 0, z: 5 }, 77);
const cC = createChopper(3, 'owner', 0, 'chopper-gunner', CHOPPER_DURATION_MS, { x: 5, y: 0, z: 5 }, 78);
const pA = chopperPoseAt(cA, 15_000, CHOPPER_DURATION_MS);
const pB = chopperPoseAt(cB, 15_000, CHOPPER_DURATION_MS);
const pC = chopperPoseAt(cC, 15_000, CHOPPER_DURATION_MS);
check('same seed flies the same pose', pA.x === pB.x && pA.y === pB.y && pA.z === pB.z && pA.yaw === pB.yaw);
check('different seeds offset the orbit', pA.x !== pC.x || pA.z !== pC.z);
check('fresh gunship is unpossessed', cA.ownerPossessing === false && cA.ammoRockets === CHOPPER_ROCKETS);

// 5. No integration drift: 1 × 30 s lands exactly where 120 × 250 ms do.
const one = stepChopper(cA, 30_000, { now: 30_000, world: WORLD, targets: [] });
let many = cA;
for (let i = 0; i < 120; i += 1) many = stepChopper(many, 250, { now: (i + 1) * 250, world: WORLD, targets: [] }).state;
check('elapsed agrees', one.state.elapsedMs === many.elapsedMs);
check('remaining agrees', one.state.remainingMs === many.remainingMs);
check('rocket timer agrees', one.state.rocketTimerMs === many.rocketTimerMs);
const poseOne = chopperPoseAt(one.state, one.state.elapsedMs, CHOPPER_DURATION_MS);
const poseMany = chopperPoseAt(many, many.elapsedMs, CHOPPER_DURATION_MS);
check('closed-form pose agrees', poseOne.x === poseMany.x && poseOne.y === poseMany.y && poseOne.z === poseMany.z);

// 6. Phase timing: 8% inbound, 10% outbound.
check('1 s is inbound', chopperPhaseAt(1_000, CHOPPER_DURATION_MS) === 'inbound');
check('15 s is orbit', chopperPhaseAt(15_000, CHOPPER_DURATION_MS) === 'orbit');
check('29 s is outbound', chopperPhaseAt(29_000, CHOPPER_DURATION_MS) === 'outbound');
check('phase shares sum', Math.abs(CHOPPER_INBOUND_SHARE + CHOPPER_OUTBOUND_SHARE - 0.18) < 1e-9);
check('1.35 revolutions per window', CHOPPER_REVOLUTIONS === 1.35);

// 7. Orbit band: ±4.5% radial wobble, 22 ± 1.25 m altitude.
let bandOk = true;
let altOk = true;
for (let i = 0; i <= 100; i += 1) {
  const t = 2_400 + (i / 100) * 24_600;
  const p = chopperPoseAt(cA, t, CHOPPER_DURATION_MS);
  const flat = Math.hypot((p.x - cA.centreX) / radii.rx, (p.z - cA.centreZ) / radii.rz);
  if (Math.abs(flat - 1) > 0.046) bandOk = false;
  if (Math.abs(p.y - (cA.centreY + CHOPPER_ALTITUDE_M)) > CHOPPER_BOB_M + 0.01) altOk = false;
}
check('orbit holds the wobble band', bandOk);
check('altitude holds 22 ± 1.25 m', altOk);

// 8. Autopilot: armed at 2 s, 2.6 s cadence, budget 6 of 12.
let auto = createChopper(1, 'owner', 0, 'chopper-gunner', CHOPPER_DURATION_MS, { x: 0, y: 0, z: 0 }, 11);
const centreTarget = target({ x: auto.centreX, y: 0, z: auto.centreZ });
const pre = stepChopper(auto, 1_900, { now: 1_900, world: WORLD, targets: [centreTarget] });
check('no rockets before the 2 s arm', pre.state.aiRocketsSpent === 0 && pre.events.length === 0);
const armed = stepChopper(pre.state, 100, { now: 2_000, world: WORLD, targets: [centreTarget] });
check('first rocket at the arm', armed.state.aiRocketsSpent === 1);
const firstHit = armed.events[0];
check('centre rocket does 240', armed.events.length >= 1 && firstHit !== undefined
  && firstHit.type === 'damage' && firstHit.amount === CHOPPER_ROCKET_MAX_DAMAGE);
// Fixed-step schedule: fires at steps 8, 19, 30 (…+11) of 250 ms.
let rocket = createChopper(1, 'owner', 0, 'chopper-gunner', CHOPPER_DURATION_MS, { x: 0, y: 0, z: 0 }, 11);
const rocketCentre = target({ x: rocket.centreX, y: 0, z: rocket.centreZ });
for (let i = 0; i < 8; i += 1) rocket = stepChopper(rocket, 250, { now: (i + 1) * 250, world: WORLD, targets: [rocketCentre] }).state;
check('one rocket after 2 s', rocket.aiRocketsSpent === 1);
for (let i = 8; i < 19; i += 1) rocket = stepChopper(rocket, 250, { now: (i + 1) * 250, world: WORLD, targets: [rocketCentre] }).state;
check('cadence holds to the second rocket', rocket.aiRocketsSpent === 2);
// Full window with a permanent victim: budget stops at 6, the manual reserve untouched.
let siege = createChopper(1, 'owner', 0, 'chopper-gunner', CHOPPER_DURATION_MS, { x: 0, y: 0, z: 0 }, 11);
const siegeCentre = target({ x: siege.centreX, y: 0, z: siege.centreZ });
for (let i = 0; i < 120; i += 1) {
  siege = stepChopper(siege, 250, {
    now: (i + 1) * 250, world: WORLD, targets: [target({ ...siegeCentre, health: 100 })],
  }).state;
}
check('autopilot budget is 6 of 12', siege.aiRocketsSpent === CHOPPER_AI_ROCKET_BUDGET);
check('arm and cadence constants', CHOPPER_ARM_MS === 2_000 && CHOPPER_ROCKET_CADENCE_MS === 2_600);

// 9. Autopilot gates: range, cover, team.
const far = stepChopper(auto, 2_000, {
  now: 2_000, world: WORLD, targets: [target({ x: auto.centreX + CHOPPER_ROCKET_RANGE_M + 30, y: 0, z: auto.centreZ })],
});
check('out-of-range target holds fire', far.state.aiRocketsSpent === 0);
const hidden = stepChopper(auto, 2_000, { now: 2_000, world: BLIND, targets: [centreTarget] });
check('cover holds fire', hidden.state.aiRocketsSpent === 0);
const friendly = stepChopper(auto, 2_000, {
  now: 2_000, world: WORLD, targets: [target({ x: auto.centreX, y: 0, z: auto.centreZ, team: 0 })],
});
check('friendlies hold fire', friendly.state.aiRocketsSpent === 0);
const edgeBlast = stepChopper(auto, 2_000, {
  now: 2_000, world: WORLD,
  targets: [target({ x: auto.centreX, y: 0, z: auto.centreZ }), target({ x: auto.centreX + CHOPPER_ROCKET_BLAST_M + 2, y: 0, z: auto.centreZ })],
});
check('outside the 4.5 m blast is safe', edgeBlast.events.length === 1);

// 10. Cannon: possessed fire only, 240 ms cadence, 12.75 direct.
const gunOff = stepChopper({ ...auto, rocketTimerMs: 60_000 }, 250, { now: 250, world: WORLD, targets: [centreTarget] });
check('unpossessed cannon stays silent', gunOff.events.length === 0);
let gun = stepChopper(
  { ...createChopper(1, 'owner', 0, 'chopper-gunner', CHOPPER_DURATION_MS, { x: 0, y: 0, z: 0 }, 11), ownerPossessing: true },
  100, { now: 100, world: WORLD, targets: [target({ x: 0, y: 0, z: 0 })] },
);
const gunHit = gun.events[0];
check('possessed cannon fires at once', gun.events.length >= 1 && gunHit !== undefined
  && gunHit.type === 'damage' && gunHit.amount === CHOPPER_CANNON_DAMAGE);
check('cannon cadence is 240 ms', CHOPPER_CANNON_CADENCE_MS === 240 && CHOPPER_CANNON_RANGE_M === 60);
// Per-step caps hold under a stalled tab.
const stall = stepChopper(auto, 30_000, { now: 30_000, world: WORLD, targets: [centreTarget] });
const stallRockets = stall.state.aiRocketsSpent;
check('per-step rocket cap holds', stallRockets <= MAX_CHOPPER_ROCKETS_PER_STEP);
const stallGun = stepChopper(
  { ...createChopper(1, 'owner', 0, 'chopper-gunner', CHOPPER_DURATION_MS, { x: 0, y: 0, z: 0 }, 11), ownerPossessing: true },
  30_000, { now: 30_000, world: WORLD, targets: [target({ x: 0, y: 0, z: 0 })] },
);
check('per-step cannon cap holds', stallGun.events.length <= MAX_CHOPPER_CANNON_PER_STEP);

// 11. Runtime end to end: earn, fly, possess, fight, dismount, expire.
const rt = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt.registerActor('owner', 0, [...LOADOUT]);
for (let k = 1; k <= 9; k += 1) rt.recordElimination('owner', k, k * 1_000);
const fired = rt.activate(press(), 9_000, WORLD);
check('chopper activation accepted', fired.accepted === true);
if (!fired.accepted) throw new Error('chopper proof failed: activation blocked the rest');
const live0 = rt.liveInstances().find((i) => i.instanceId === fired.instanceId);
check('fresh airframe unpossessed', live0 !== undefined && live0.kind === 'chopper'
  && (live0.kind === 'chopper' ? live0.ownerPossessing === false : false));
// A plain slot press while the airframe lives possesses — no toggle bit, no charge.
const possess = rt.activate(press({ seq: 1, claimId: 'parity-chopper-2' }), 9_500, WORLD);
check('second press possesses without spending', possess.accepted === true
  && possess.instanceId === fired.instanceId && possess.chargesLeft === 0);
const live1 = rt.liveInstances().find((i) => i.instanceId === fired.instanceId);
check('possession flips on the instance', live1 !== undefined && live1.kind === 'chopper'
  && (live1.kind === 'chopper' ? live1.ownerPossessing === true : false));
// The possessed gunship fights through the runtime.
let t = 9_500;
let cannonDamage = 0;
for (let i = 0; i < 12; i += 1) {
  t += 250;
  for (const e of rt.advance(t, WORLD, [target({ x: 5, y: 0, z: 5 })])) {
    if (e.type === 'damage') cannonDamage += 1;
  }
}
check('possessed gunship damages through the runtime', cannonDamage > 0);
// Third press dismounts, still without spending.
const dismount = rt.activate(press({ seq: 2, claimId: 'parity-chopper-3' }), t + 500, WORLD);
check('third press dismounts', dismount.accepted === true && dismount.events.length === 1
  && dismount.events[0] !== undefined && dismount.events[0].type === 'streak-ended');
const live2 = rt.liveInstances().find((i) => i.instanceId === fired.instanceId);
check('dismount flips back', live2 !== undefined && live2.kind === 'chopper'
  && (live2.kind === 'chopper' ? live2.ownerPossessing === false : false));
// Exactly-once still holds on the toggle path.
const replay = rt.activate(press({ seq: 2, claimId: 'parity-chopper-3b' }), t + 600, WORLD);
check('replayed sequence refused', !replay.accepted && replay.reason === 'replayed-sequence');
const dupe = rt.activate(press({ seq: 3, claimId: 'parity-chopper-3' }), t + 700, WORLD);
check('duplicate claim refused', !dupe.accepted && dupe.reason === 'duplicate-claim');
// Death dismounts silently; the airframe keeps flying.
rt.activate(press({ seq: 4, claimId: 'parity-chopper-4' }), t + 800, WORLD);
rt.recordDeath('owner', t + 900);
const live3 = rt.liveInstances().find((i) => i.instanceId === fired.instanceId);
check('death dismounts, airframe survives', live3 !== undefined && live3.kind === 'chopper'
  && (live3.kind === 'chopper' ? live3.ownerPossessing === false : false));
// Expiry retires the instance.
let ended = false;
for (let i = 0; i < 130 && !ended; i += 1) {
  t += 250;
  for (const e of rt.advance(t, WORLD, [])) if (e.type === 'streak-ended') ended = true;
}
check('airframe retires at expiry', ended && rt.chopperPoses().length === 0);

// 12. Blocked anchor refuses BEFORE the charge moves; dead toggles denied.
const rt2 = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt2.registerActor('owner', 0, [...LOADOUT]);
for (let k = 1; k <= 9; k += 1) rt2.recordElimination('owner', k, k * 1_000);
const before = rt2.chargesOf('owner', 'chopper-gunner');
const refused = rt2.activate(press({ claimId: 'parity-chopper-9', anchor: { x: 500, y: 0, z: 500 } }), 9_000, WORLD);
check('out-of-bounds anchor refused as no-placement', !refused.accepted && refused.reason === 'no-placement');
check('refused anchor keeps the charge', rt2.chargesOf('owner', 'chopper-gunner') === before);
const ok = rt2.activate(press({ claimId: 'parity-chopper-10' }), 9_000, WORLD);
check('good anchor spends', ok.accepted === true);
const deadToggle = rt2.activate(press({
  seq: 1, claimId: 'parity-chopper-11',
  context: {
    alive: false, matchPhase: 'active' as const, inputEnabled: true,
    menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
  },
}), 9_500, WORLD);
check('dead toggle denied', !deadToggle.accepted && deadToggle.reason === 'dead');

// 13. Pose projection for the wire: counters, centre, closed-form.
const poses = rt2.chopperPoses();
check('one live pose', poses.length === 1 && poses[0] !== undefined && poses[0].instanceId === 1);
const pose0 = poses[0];
check('pose carries centre and counters', pose0 !== undefined && pose0.cx !== undefined && pose0.rocketsLeft === CHOPPER_ROCKETS && pose0.remainingMs > 0);

// 14. Pose message validation: finite numbers in, NaN and negatives out.
const goodPose: StreakPoseMsg = {
  type: 'streak-pose', instanceId: 1, streakId: 'chopper-gunner',
  x: 1, y: 22, z: 2, yaw: 0, cx: 0, cz: 0, remainingMs: 1000, rocketsLeft: 12, cooldownMs: 0,
};
check('valid pose admitted', isGameMessage({ ...goodPose }));
check('NaN pose refused', !isGameMessage({ ...goodPose, x: Number.NaN }));
check('negative counter refused', !isGameMessage({ ...goodPose, remainingMs: -1 }));
check('missing yaw refused', !isGameMessage({ ...goodPose, yaw: undefined }));
check('unknown tag refused', !isGameMessage({ ...goodPose, type: 'streak-pose-2' }));

// 15. Client projection: possession tracking is idempotent under edge replays.
const client = new GameClient('owner');
client.setStreakNames([['chopper-gunner', 'Chopper Gunner']]);
const created = {
  type: 'streak-activated' as const, at: 9_000, actorId: 'owner', team: 0 as const,
  streakId: 'chopper-gunner', slot: 4, chargesLeft: 0, instanceId: 1,
};
client.applyEvent(created);
check('creation does not possess', client.view().gunner === null);
client.applyEvent(created);
check('creation replay is a no-op', client.view().gunner === null);
client.applyEvent({ ...created, at: 9_500 });
const gunner = client.view().gunner;
check('newer activation possesses', gunner !== null && gunner.instanceId === 1);
client.applyEvent({ ...created, at: 9_500 });
check('possess replay holds', client.view().gunner !== null);
client.applyEvent({ type: 'streak-ended', at: 9_600, actorId: 'owner', streakId: 'chopper-gunner', instanceId: 1, reason: 'expired' });
check('dismount clears', client.view().gunner === null);
client.applyEvent({ ...created, at: 9_700 });
check('re-possess after dismount works', client.view().gunner !== null);
client.applyEvent({
  type: 'death', at: 9_800, victimId: 'owner', victimTeam: 0 as const,
  killerId: null, cause: 'fall' as const, streakLost: 0, respawnAt: null,
});
check('death clears possession', client.view().gunner === null);
client.applyEvent({ ...created, at: 9_900 });
client.applyEvent({
  type: 'match-phase', at: 10_000, phase: 'ended' as const, endsAt: 10_000,
  winner: null, winnerId: null, endReason: 'time' as const,
});
check('match end clears possession', client.view().gunner === null);
client.applyEvent({ ...created, at: 40_000, instanceId: 1 });
check('new match creation does not possess', client.view().gunner === null);
// Another actor's gunship never possesses this client.
client.applyEvent({ ...created, at: 41_000, actorId: 'enemy', instanceId: 2 });
check('foreign gunship ignored', client.view().gunner === null);

// 16. Client aircraft projection: poses in, stale poses out.
client.applySnapshot({ at: 50_000, poses: [goodPose] });
const aircraft = client.view().aircraft;
check('pose projects to aircraft', aircraft.length === 1 && aircraft[0] !== undefined
  && aircraft[0].instanceId === 1 && aircraft[0].rocketsLeft === 12 && aircraft[0].remainingMs === 1000);
client.tick(50_400);
check('fresh pose survives the tick', client.view().aircraft.length === 1);
client.tick(50_501);
check('stale pose pruned', client.view().aircraft.length === 0);

console.log(`chopper proof: ${passed} checks passed`);
