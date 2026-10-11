/**
 * Nuketown 2025 — AC-130 Gunship proof. Same dependency-free rules as
 * `mortar.test.ts`: bundle with the repo's esbuild, run the bundle, a
 * thrown check is the failure. See docs/HANDOFF-PARITY.md for the command.
 */

import { STREAK_CATALOG, streakById } from '../catalog';
import { StreakRuntime } from '../runtime';
import {
  AC130_105_BLAST_M,
  AC130_105_MAX_DAMAGE,
  AC130_105_RELOAD_MS,
  AC130_25_CADENCE_MS,
  AC130_25_COOL_MS,
  AC130_25_MAX_DAMAGE,
  AC130_25_OVERHEAT_ROUNDS,
  AC130_40_BLAST_M,
  AC130_40_CADENCE_MS,
  AC130_40_CLIP,
  AC130_40_MAX_DAMAGE,
  AC130_40_RELOAD_MS,
  AC130_ALTITUDE_M,
  AC130_AUTOPILOT_CADENCE_MS,
  AC130_PERIOD_MS,
  AC130_RADIUS_M,
  AC130_ZOOM_FOVS,
  ac130AngleAt,
  ac130Fov,
  ac130PoseAt,
  createAc130,
  selectAc130Caliber,
  setAc130Possessed,
  setAc130Thermal,
  setAc130Zoom,
  stepAc130,
  type Ac130State,
} from './ac130';
import type { SentryTarget } from './sentry';
import type { GameEvent, WorldQuery } from '../../events';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`ac130 proof failed: ${name}`);
  passed += 1;
}

/** Admitted damage, or null for any other event. Narrows; never casts. */
function damageOf(e: GameEvent): number | null {
  return e.type === 'damage' ? e.amount : null;
}

function world(lineOfSight: boolean): WorldQuery {
  const los = lineOfSight;
  return Object.freeze({
    lineOfSight: () => los,
    groundY: () => 0,
    inBounds: (x: number, z: number) => Math.abs(x) <= 40 && Math.abs(z) <= 40,
  });
}
const OPEN = world(true);

function target(overrides: Partial<SentryTarget> = {}): SentryTarget {
  return Object.freeze({
    id: 'victim', team: 1, alive: true, health: 100, x: 5, y: 0, z: 5, ...overrides,
  });
}

// The chest rides 1.35 m over the boots, so put the boots 1.35 m down and the
// 3D distance to the impact is 0: a true centre hit (mortar proof, same rule).
function bullseye(overrides: Partial<SentryTarget> = {}): SentryTarget {
  return target({ y: -1.35, ...overrides });
}

function gunsOf(rt: StreakRuntime): Ac130State[] {
  return rt.liveInstances().filter((i): i is Ac130State => i.kind === 'ac130');
}

const CENTRE = { x: 5, y: 0, z: 5 };
const fresh = () => createAc130(1, 'owner', 0, 'ac130-gunship', 40_000, CENTRE, 77);

// 1. The orbit is closed-form: one period returns to the same phase.
const s0 = fresh();
check('orbit starts at phase 0', ac130AngleAt(s0) === 0);
const p0 = ac130PoseAt(s0);
check('orbit starts east of the column at 65 m AGL',
  Math.abs(p0.x - (CENTRE.x + AC130_RADIUS_M)) < 1e-9
  && Math.abs(p0.z - CENTRE.z) < 1e-9
  && Math.abs(p0.y - AC130_ALTITUDE_M) < 1e-9);
const full = ac130AngleAt(s0, AC130_PERIOD_MS);
check('one period is one full turn', Math.abs(full - Math.PI * 2) < 1e-9);
const p1 = ac130PoseAt(s0, AC130_PERIOD_MS);
check('one period returns to the same gun position',
  Math.abs(p1.x - p0.x) < 1e-6 && Math.abs(p1.z - p0.z) < 1e-6 && Math.abs(p1.y - p0.y) < 1e-9);
// A stalled tab rejoins the circle: one 24 s jump equals 96 quarter-second steps.
const jumped = stepAc130(s0, AC130_PERIOD_MS, { now: AC130_PERIOD_MS, world: OPEN, targets: [], gunner: null });
let walked = s0;
for (let i = 0; i < 96; i += 1) walked = stepAc130(walked, 250, { now: (i + 1) * 250, world: OPEN, targets: [], gunner: null }).state;
check('jump and walk agree on elapsed time', jumped.state.elapsedMs === walked.elapsedMs);
check('jump and walk agree on the angle', Math.abs(ac130AngleAt(jumped.state) - ac130AngleAt(walked)) < 1e-9);

// 2. 105 mm: one 400 centre hit, then the 4.5 s reload holds.
const aimCentre = { firing: true as const, caliber: '105mm' as const, aimX: 5, aimZ: 5 };
const boom = stepAc130(s0, 0, { now: 0, world: OPEN, targets: [bullseye()], gunner: aimCentre });
const boomFirst = boom.events[0];
check('105 mm centre hit does 400', boom.events.length === 1 && boomFirst !== undefined && damageOf(boomFirst) === AC130_105_MAX_DAMAGE);
check('105 mm fires once', boom.state.shots105 === 1);
const held = stepAc130(boom.state, 100, { now: 100, world: OPEN, targets: [target()], gunner: aimCentre });
check('105 mm reload blocks the second shell', held.events.length === 0 && held.state.shots105 === 1);
const reloaded = stepAc130(boom.state, AC130_105_RELOAD_MS, { now: AC130_105_RELOAD_MS, world: OPEN, targets: [bullseye()], gunner: aimCentre });
check('105 mm fires again after 4.5 s', reloaded.events.length === 1 && reloaded.state.shots105 === 2);
// 105 mm blast reaches 12 m, not 13 m.
const edge = stepAc130(s0, 0, {
  now: 0, world: OPEN,
  targets: [target({ x: 5 + AC130_105_BLAST_M + 1, z: 5 })],
  gunner: aimCentre,
});
check('outside 12 m is safe from the 105', edge.events.length === 0);

// 3. 40 mm: five shells, then the clip holds until the 2.5 s reload.
let clip = s0;
for (let i = 0; i < AC130_40_CLIP; i += 1) {
  clip = stepAc130(clip, AC130_40_CADENCE_MS, { now: i * AC130_40_CADENCE_MS, world: OPEN, targets: [target()], gunner: { firing: true, caliber: '40mm', aimX: 5, aimZ: 5 } }).state;
}
check('40 mm empties a 5-round clip', clip.shots40 === AC130_40_CLIP && clip.clip40 === 0 && clip.reload40Ms > 0);
const dry = stepAc130(clip, AC130_40_CADENCE_MS, { now: 9_999, world: OPEN, targets: [target()], gunner: { firing: true, caliber: '40mm', aimX: 5, aimZ: 5 } });
check('40 mm dry clip fires nothing', dry.events.length === 0 && dry.state.shots40 === AC130_40_CLIP);
const refilled = stepAc130(clip, AC130_40_RELOAD_MS, { now: 20_000, world: OPEN, targets: [target()], gunner: { firing: true, caliber: '40mm', aimX: 5, aimZ: 5 } });
check('40 mm refills after 2.5 s and fires', refilled.state.clip40 === AC130_40_CLIP - 1 && refilled.state.shots40 === AC130_40_CLIP + 1);
// 40 mm blast reaches 5 m, not 6 m.
const short = stepAc130(s0, 0, {
  now: 0, world: OPEN,
  targets: [target({ x: 5 + AC130_40_BLAST_M + 1, z: 5 })],
  gunner: { firing: true, caliber: '40mm', aimX: 5, aimZ: 5 },
});
check('outside 5 m is safe from the 40', short.events.length === 0);

// 4. 25 mm: hoses at 80 ms, overheats after 100, cools for 4 s.
let hose = s0;
for (let i = 0; i < AC130_25_OVERHEAT_ROUNDS; i += 1) {
  hose = stepAc130(hose, AC130_25_CADENCE_MS, { now: i * AC130_25_CADENCE_MS, world: OPEN, targets: [], gunner: { firing: true, caliber: '25mm', aimX: 5, aimZ: 5 } }).state;
}
check('25 mm fires 100 before overheating', hose.shots25 === AC130_25_OVERHEAT_ROUNDS && hose.overheat25Ms > 0);
const hot = stepAc130(hose, AC130_25_CADENCE_MS, { now: 99_999, world: OPEN, targets: [], gunner: { firing: true, caliber: '25mm', aimX: 5, aimZ: 5 } });
check('25 mm overheated gun stays silent', hot.state.shots25 === AC130_25_OVERHEAT_ROUNDS);
const cooled = stepAc130(hose, AC130_25_COOL_MS, { now: 199_999, world: OPEN, targets: [], gunner: { firing: true, caliber: '25mm', aimX: 5, aimZ: 5 } });
check('25 mm cools after 4 s and fires', cooled.state.heat25 === 1 && cooled.state.shots25 === AC130_25_OVERHEAT_ROUNDS + 1);
// A stalled tab lands at most 4 shells in one step, never the backlog.
const stall = stepAc130(s0, 30_000, { now: 30_000, world: OPEN, targets: [target()], gunner: { firing: true, caliber: '25mm', aimX: 5, aimZ: 5 } });
check('per-step shell cap holds', stall.state.shots25 <= 4);

// 5. Who is skipped: friendlies, the owner, the dead, the drained.
const mixed = stepAc130(s0, 0, {
  now: 0, world: OPEN, targets: [
    target({ id: 'friend', team: 0 }),
    target({ id: 'owner', team: 1 }),
    target({ id: 'corpse', team: 1, alive: false }),
    target({ id: 'drained', team: 1, health: 0 }),
  ], gunner: aimCentre,
});
check('no friendly, owner, corpse or drained damage', mixed.events.length === 0);
// Out-of-bounds aim never fires.
const oob = stepAc130(s0, 0, { now: 0, world: OPEN, targets: [target()], gunner: { firing: true, caliber: '105mm', aimX: 500, aimZ: 500 } });
check('out-of-bounds aim holds fire', oob.events.length === 0 && oob.state.shots105 === 0);

// 6. Zoom: three FOV steps, 60/24/12, default wide.
check('zoom FOVs are 60/24/12', AC130_ZOOM_FOVS.length === 3 && AC130_ZOOM_FOVS[0] === 60 && AC130_ZOOM_FOVS[1] === 24 && AC130_ZOOM_FOVS[2] === 12);
check('default zoom is wide', s0.zoomStep === 0 && ac130Fov(s0.zoomStep) === 60);
check('zoom steps resolve', ac130Fov(1) === 24 && ac130Fov(2) === 12);
check('zoom clamps', setAc130Zoom(s0, 9).zoomStep === 2 && setAc130Zoom(s0, -1).zoomStep === 0);

// 7. Thermal defaults off; caliber switch is free.
check('thermal defaults off', s0.thermal === false);
check('thermal toggles', setAc130Thermal(s0, true).thermal === true);
check('caliber switches free', selectAc130Caliber(s0, '105mm').caliber === '105mm' && selectAc130Caliber(s0, '25mm').caliber === '25mm');
check('possession flips', setAc130Possessed(s0, false).possessed === false);

// 8. Autopilot: 40 mm only, 3 s cadence, visible hostiles.
const idle = stepAc130(s0, AC130_AUTOPILOT_CADENCE_MS, { now: AC130_AUTOPILOT_CADENCE_MS, world: OPEN, targets: [bullseye()], gunner: null });
const idleFirst = idle.events[0];
check('autopilot fires the 40 at 3 s', idle.events.length === 1 && idle.state.shots40 === 1 && idle.state.shots105 === 0 && idle.state.shots25 === 0);
check('autopilot 40 does 140 centre', idleFirst !== undefined && damageOf(idleFirst) === AC130_40_MAX_DAMAGE);
const blind = stepAc130(s0, AC130_AUTOPILOT_CADENCE_MS, { now: AC130_AUTOPILOT_CADENCE_MS, world: world(false), targets: [target()], gunner: null });
check('autopilot holds without line of sight', blind.events.length === 0 && blind.state.shots40 === 0);
const calm = stepAc130(s0, AC130_AUTOPILOT_CADENCE_MS, { now: AC130_AUTOPILOT_CADENCE_MS, world: OPEN, targets: [], gunner: null });
check('autopilot holds with no hostiles', calm.events.length === 0 && calm.state.shots40 === 0);

// 9. Catalog still declares the row the runtime just wired, pool total 100.
check('catalog declares ac130-gunship high/9/possession/40s', (() => {
  const d = streakById('ac130-gunship', STREAK_CATALOG);
  return d !== null && d.cost === 9 && d.tier === 'high' && d.activation === 'possession'
    && d.durationMs === 40_000 && d.availability === 'selectable' && d.repeatable === false
    && d.displayName === 'AC-130 Gunship' && d.baseWeightUnits === 0;
})());
check('pool base total still 100', STREAK_CATALOG.rewardPool.baseWeightTotal === 100);

// 10. End to end through the runtime: earn 9, fly, autopilot kills, toggle fold.
const rt = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt.registerActor('owner', 0, ['recon-sweep', 'signal-jam', 'sentry-post', 'ac130-gunship']);
for (let k = 1; k <= 9; k += 1) rt.recordElimination('owner', k, k * 1_000);
const press = {
  actorId: 'owner', slot: 4, seq: 0, claimId: 'parity-ac130-1', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 5, y: 0, z: 5 }, aimYaw: 0, anchor: { x: 5, y: 0, z: 5 },
  context: {
    alive: true, matchPhase: 'active' as const, inputEnabled: true,
    menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
  },
};
const flown = rt.activate(press, 10_000, OPEN);
check('ac130 activation accepted', flown.accepted === true);
const live0 = gunsOf(rt);
check('one gunship live and possessed', live0.length === 1 && live0[0] !== undefined && live0[0].possessed === true);
const gunId = flown.accepted === true ? flown.instanceId : -1;
// The slot press while possessing folds to a dismount: same instance, no charge.
const fold1 = rt.activate({ ...press, seq: 1, claimId: 'parity-ac130-2' }, 10_500, OPEN);
check('slot repress dismounts without a new instance',
  fold1.accepted === true && (fold1.accepted === true ? fold1.instanceId : -1) === gunId);
check('no charge on the flip', rt.chargesOf('owner', 'ac130-gunship') === 0);
const live1 = gunsOf(rt);
check('dismount flips possessed, keeps the gun', live1.length === 1 && live1[0] !== undefined && live1[0].possessed === false);
// And back on: remount, still no charge.
const fold2 = rt.activate({ ...press, seq: 2, claimId: 'parity-ac130-3' }, 11_000, OPEN);
check('third press remounts', fold2.accepted === true && (fold2.accepted === true ? fold2.instanceId : -1) === gunId);
const live2 = gunsOf(rt);
check('remount flips possessed back', live2.length === 1 && live2[0] !== undefined && live2[0].possessed === true);
// Autopilot kills through the runtime.
let t = 11_000;
let damage = 0;
let ended = false;
for (let i = 0; i < 200 && !ended; i += 1) {
  t += 250;
  for (const e of rt.advance(t, OPEN, [target()])) {
    const amount = damageOf(e);
    if (amount !== null) damage += amount;
    if (e.type === 'streak-ended') ended = true;
  }
}
check('autopilot damages through the runtime', damage > 0);
check('gunship retires after 40 s', ended);

// 11. Death dismounts the gunner but keeps the gun flying.
const rt2 = new StreakRuntime({ seed: 9, matchEpoch: 1 });
rt2.registerActor('owner', 0, ['recon-sweep', 'signal-jam', 'sentry-post', 'ac130-gunship']);
for (let k = 1; k <= 9; k += 1) rt2.recordElimination('owner', k, k * 1_000);
rt2.activate(press, 10_000, OPEN);
rt2.recordDeath('owner', 12_000);
const live3 = gunsOf(rt2);
check('death dismounts, gun keeps flying', live3.length === 1 && live3[0] !== undefined && live3[0].possessed === false);
// A blocked column refuses BEFORE the charge moves: same claim retries.
const rt3 = new StreakRuntime({ seed: 11, matchEpoch: 1 });
rt3.registerActor('owner', 0, ['recon-sweep', 'signal-jam', 'sentry-post', 'ac130-gunship']);
for (let k = 1; k <= 9; k += 1) rt3.recordElimination('owner', k, k * 1_000);
const before = rt3.chargesOf('owner', 'ac130-gunship');
const refused = rt3.activate({ ...press, claimId: 'parity-ac130-oob', anchor: { x: 500, y: 0, z: 500 } }, 13_000, OPEN);
check('ac130 earned a charge', before === 1);
check('out-of-bounds column refused as no-placement',
  refused.accepted === false && refused.reason === 'no-placement');
check('refused column keeps the charge', rt3.chargesOf('owner', 'ac130-gunship') === before);

// 12. 25 mm centre hit does 35; three kill.
const hoseHit = stepAc130(s0, 0, { now: 0, world: OPEN, targets: [bullseye()], gunner: { firing: true, caliber: '25mm', aimX: 5, aimZ: 5 } });
const hoseFirst = hoseHit.events[0];
check('25 mm centre hit does 35', hoseHit.events.length === 1 && hoseFirst !== undefined && damageOf(hoseFirst) === AC130_25_MAX_DAMAGE);

// 13. Gunner fire missions: anchored, calibered presses steer the guns.
const rt5 = new StreakRuntime({ seed: 21, matchEpoch: 1 });
rt5.registerActor('owner', 0, ['recon-sweep', 'signal-jam', 'sentry-post', 'ac130-gunship']);
for (let k = 1; k <= 9; k += 1) rt5.recordElimination('owner', k, k * 1_000);
const flown5 = rt5.activate({ ...press, claimId: 'parity-ac130-5' }, 10_000, OPEN);
check('fifth gunship possessed', flown5.accepted === true);
const mission = {
  ...press, slot: 4, seq: 1, claimId: 'parity-ac130-5-fire', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 5, y: 0, z: 5 }, aimYaw: 0,
  anchor: { x: 5, y: 0, z: 5 }, gun: '25mm',
  context: {
    alive: true, matchPhase: 'active' as const, inputEnabled: true,
    menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
  },
};
const fired = rt5.activate(mission, 10_100, OPEN);
check('fire mission accepted without spending',
  fired.accepted === true && rt5.chargesOf('owner', 'ac130-gunship') === 0);
let shell = 0;
for (const e of rt5.advance(10_350, OPEN, [target({ id: 'victim', team: 1, x: 5, y: -1.35, z: 5 })])) {
  const amount = damageOf(e);
  if (amount !== null) shell += amount;
}
check('25 mm stream lands at once, autopilot still counting', shell >= 35);
const quiet = rt5.advance(10_600, OPEN, [target({ id: 'victim', team: 1, x: 5, y: -1.35, z: 5 })]);
check('lapsed latch starves the guns', quiet.every((e) => e.type !== 'damage'));
const badGun = rt5.activate({ ...mission, seq: 2, claimId: 'parity-ac130-5-badgun', gun: '9mm' }, 10_700, OPEN);
check('unknown caliber is malformed',
  badGun.accepted === false && badGun.reason === 'malformed-claim');
const badAnchor = rt5.activate({ ...mission, seq: 3, claimId: 'parity-ac130-5-badanchor', gun: '40mm', anchor: { x: 500, y: 0, z: 500 } }, 10_800, OPEN);
check('off-arena mission is no-placement',
  badAnchor.accepted === false && badAnchor.reason === 'no-placement');
console.log(`ac130 proof: ${passed} checks passed`);
