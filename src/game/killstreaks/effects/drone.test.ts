/**
 * Nuketown 2025 — Drone Swarm proof. Dependency-free: no test runner, no
 * node builtins (this file must stay clean under the repo's `tsc --noEmit`,
 * which has no @types/node). Run by bundling with the repo's own esbuild
 * and executing the bundle; any failed check throws, so a silent pass IS
 * the pass. See docs/HANDOFF-PARITY.md for the command.
 */

import { STREAK_CATALOG, streakById, validateStreakLoadout } from '../catalog';
import { StreakRuntime } from '../runtime';
import {
  DRONE_COUNT,
  DRONE_HEIGHT_ABOVE_ANCHOR_M,
  DRONE_MIN_SEPARATION_RAD,
  DRONE_ORBIT_RAD_S,
  DRONE_ORBIT_RADIUS_M,
  DRONE_ZAP_DAMAGE,
  DRONE_ZAP_INTERVAL_MS,
  DRONE_ZAP_RANGE_M,
  MAX_DRONE_ZAPS_PER_STEP,
  createDrone,
  droneMinSeparationRad,
  dronePositionAt,
  stepDrone,
} from './drone';
import type { SentryTarget } from './sentry';
import type { WorldQuery } from '../../events';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`drone proof failed: ${name}`);
  passed += 1;
}

const WORLD: WorldQuery = Object.freeze({
  lineOfSight: () => true,
  groundY: () => 0,
  inBounds: (x: number, z: number) => Math.abs(x) <= 40 && Math.abs(z) <= 40,
});

function target(overrides: Partial<SentryTarget> = {}): SentryTarget {
  return Object.freeze({
    id: 'victim', team: 1, alive: true, health: 100, x: 0, y: 0, z: 0, ...overrides,
  });
}

function circularDiff(a: number, b: number): number {
  const tau = Math.PI * 2;
  const d = Math.abs(a - b) % tau;
  return d > Math.PI ? tau - d : d;
}

// 1. Tuning is what the lane specifies: five drones, one shared orbit.
check('swarm flies five drones', DRONE_COUNT === 5);
check('orbit radius is 12 m', DRONE_ORBIT_RADIUS_M === 12);
check('station height is anchor + 9 m', DRONE_HEIGHT_ABOVE_ANCHOR_M === 9);
check('orbit rate is 0.5 rad/s', DRONE_ORBIT_RAD_S === 0.5);
check('zap cadence is 2.0 s', DRONE_ZAP_INTERVAL_MS === 2_000);
check('zap leash is 15 m', DRONE_ZAP_RANGE_M === 15);
check('zap damage is 15', DRONE_ZAP_DAMAGE === 15);
check('minimum is 0.8 of the even fan', DRONE_MIN_SEPARATION_RAD === ((Math.PI * 2) / DRONE_COUNT) * 0.8);
check('one zap per drone per step', MAX_DRONE_ZAPS_PER_STEP === DRONE_COUNT);

// 2. THE spacing rule: five bearings, shared radius and height, minimum
// separation held across 200 seeds. The anchor-centred victim below sits
// 12 m flat from every drone, inside the leash whatever the deal.
let worst = Infinity;
for (let seed = 1; seed <= 200; seed += 1) {
  const swarm = createDrone(seed, 'owner', 0, 'drone-swarm', 30_000, { x: 0, y: 0, z: 0 }, seed);
  if (swarm.drones.length !== DRONE_COUNT) throw new Error(`drone proof failed: seed ${seed} dealt ${swarm.drones.length} drones`);
  passed += 1;
  const gap = droneMinSeparationRad(swarm);
  if (gap < DRONE_MIN_SEPARATION_RAD) throw new Error(`drone proof failed: seed ${seed} clumped at ${gap}`);
  passed += 1;
  if (gap < worst) worst = gap;
  for (const d of swarm.drones) {
    if (d.radiusM !== DRONE_ORBIT_RADIUS_M || d.heightM !== DRONE_HEIGHT_ABOVE_ANCHOR_M) {
      throw new Error(`drone proof failed: seed ${seed} left the shared orbit`);
    }
    passed += 1;
  }
}
check('200 seeds clear the minimum with margin', worst > DRONE_MIN_SEPARATION_RAD);

// 3. Seeded determinism: same seed deals the same orbit, another seed another.
const detA = createDrone(1, 'owner', 0, 'drone-swarm', 30_000, { x: 0, y: 0, z: 0 }, 11);
const detB = createDrone(2, 'owner', 0, 'drone-swarm', 30_000, { x: 0, y: 0, z: 0 }, 11);
const detC = createDrone(3, 'owner', 0, 'drone-swarm', 30_000, { x: 0, y: 0, z: 0 }, 12);
check('same seed deals the same bearings',
  detA.drones.every((d, i) => d.angleRad === detB.drones[i].angleRad));
check('another seed deals another orbit',
  detA.drones.some((d, i) => d.angleRad !== detC.drones[i].angleRad));

// 4. The orbit advances at 0.5 rad/s; positions ride the anchor at radius 12.
const anchor = createDrone(4, 'owner', 0, 'drone-swarm', 30_000, { x: 10, y: 0, z: -6 }, 77);
const moved = stepDrone(anchor, 2_000, { now: 2_000, world: WORLD, targets: [] });
check('quiet step zaps nobody', moved.events.length === 0);
check('step consumes its own duration', moved.state.remainingMs === 28_000);
for (let i = 0; i < DRONE_COUNT; i += 1) {
  const before = anchor.drones[i].angleRad;
  const after = moved.state.drones[i].angleRad;
  if (circularDiff(after, before + DRONE_ORBIT_RAD_S * 2) > 1e-9) {
    throw new Error(`drone proof failed: drone ${i} did not advance at 0.5 rad/s`);
  }
  passed += 1;
  const p = dronePositionAt(moved.state, i);
  if (Math.abs(Math.hypot(p.x - 10, p.z + 6) - DRONE_ORBIT_RADIUS_M) > 1e-9 || p.y !== DRONE_HEIGHT_ABOVE_ANCHOR_M) {
    throw new Error(`drone proof failed: drone ${i} left the shared orbit`);
  }
  passed += 1;
}
const frozen = stepDrone(anchor, -500, { now: 0, world: WORLD, targets: [] });
check('negative dt neither moves nor consumes', frozen.state.remainingMs === 30_000
  && frozen.state.drones.every((d, i) => d.angleRad === anchor.drones[i].angleRad));

const pool = createDrone(5, 'owner', 0, 'drone-swarm', 30_000, { x: 0, y: 0, z: 0 }, 9);
const early = stepDrone(pool, 1_999, { now: 1_999, world: WORLD, targets: [target()] });
check('no zap before 2.0 s', early.events.length === 0);
const volley = stepDrone(early.state, 1, { now: 2_000, world: WORLD, targets: [target()] });
check('first volley is five zaps', volley.events.length === DRONE_COUNT);
{
  const after: number[] = [];
  for (const e of volley.events) {
    if (e.type !== 'damage') throw new Error('drone proof failed: volley event is not damage');
    after.push(e.healthAfter);
    if (e.amount !== DRONE_ZAP_DAMAGE || e.cause !== 'streak' || e.zone !== 'body' || e.weaponId !== '') {
      throw new Error('drone proof failed: zap carries the wrong shape');
    }
    passed += 1;
  }
  check('health falls across the volley', after.join(',') === '85,70,55,40,25');
}
const first = volley.events[0];
check('zap stamps its time and source', first !== undefined && first.type === 'damage' && first.at === 2_000
  && first.sourceX === dronePositionAt(volley.state, 0).x
  && first.sourceZ === dronePositionAt(volley.state, 0).z);

// 6. A volley that kills stops on the same tick: 30 HP takes two zaps, not five.
const frail = stepDrone(pool, 2_000, { now: 2_000, world: WORLD, targets: [target({ health: 30 })] });
check('drained corpse takes no more zaps', frail.events.length === 2);
const last = frail.events[1];
check('second zap finishes the victim', last !== undefined && last.type === 'damage' && last.healthAfter === 0);

// 7. Nearest wins, ties break on id: two victims on the same spot, all five pick 'a-victim'.
const tied = stepDrone(pool, 2_000, {
  now: 2_000, world: WORLD,
  targets: [target({ id: 'm-victim' }), target({ id: 'a-victim' })],
});
check('tied victims break on id', tied.events.length === DRONE_COUNT
  && tied.events.every((e) => e.type === 'damage' && e.victimId === 'a-victim'));

// 8. Who is skipped: friendlies, the owner, the dead, the drained, the distant.
const gated = stepDrone(pool, 2_000, {
  now: 2_000, world: WORLD,
  targets: [
    target({ id: 'friend', team: 0 }),
    target({ id: 'owner', team: 1 }),
    target({ id: 'corpse', alive: false }),
    target({ id: 'drained', health: 0 }),
    target({ id: 'far', x: 30, z: 0 }),
  ],
});
check('no friendly, owner, corpse, drained or distant damage', gated.events.length === 0);

// 9. Cadence repeats, and a stalled tab banks nothing: one zap per drone per step.
const second = stepDrone(volley.state, 2_000, { now: 4_000, world: WORLD, targets: [target()] });
check('second volley is five zaps', second.events.length === DRONE_COUNT);
const stall = stepDrone(pool, 30_000, { now: 30_000, world: WORLD, targets: [target()] });
check('per-step zap cap holds', stall.events.length === MAX_DRONE_ZAPS_PER_STEP);

// 10. Expiry retires the swarm.
check('spent swarm retires', stall.state.remainingMs <= 0);

// 11. Catalog declares the row the runtime just wired, in the mid family.
check('catalog declares drone-swarm mid/6', (() => {
  const def = streakById('drone-swarm', STREAK_CATALOG);
  return def !== null && def.cost === 6 && def.tier === 'mid' && def.activation === 'target-point'
    && def.durationMs === 30_000 && def.availability === 'selectable' && def.baseWeightUnits === 7;
})());
check('mid family accepts the swarm in slot 3', STREAK_CATALOG.slotFamilies[2].includes('drone-swarm'));
check('default loadout still validates', validateStreakLoadout(['recon-sweep', 'signal-jam', 'sentry-post', 'blast-mortar']).valid);
check('swarm loadout validates', validateStreakLoadout(
  ['recon-sweep', 'signal-jam', 'drone-swarm', 'blast-mortar']).valid);

// 12. End to end through the runtime: earn, place, zap, expire.
const rt = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt.registerActor('owner', 0, ['recon-sweep', 'signal-jam', 'drone-swarm', 'blast-mortar']);
for (let k = 1; k <= 6; k += 1) rt.recordElimination('owner', k, k * 1_000);
const press = {
  actorId: 'owner', slot: 3, seq: 0, claimId: 'parity-drone-1', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: 5, y: 0, z: 5 },
  context: {
    alive: true, matchPhase: 'active' as const, inputEnabled: true,
    menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
  },
};
const fired = rt.activate(press, 9_000, WORLD);
check('drone activation accepted', fired.accepted === true);
let t = 9_000;
let damage = 0;
let ended = false;
for (let i = 0; i < 140 && !ended; i += 1) {
  t += 250;
  for (const e of rt.advance(t, WORLD, [target({ x: 5, y: 0, z: 5 })])) {
    if (e.type === 'damage') damage += 1;
    if (e.type === 'streak-ended') ended = true;
  }
}
check('swarm zaps through the runtime', damage > 0);
check('swarm instance retires after 30 s', ended);

// 13. A blocked marker refuses BEFORE the charge moves: same claim retries.
const rt2 = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt2.registerActor('owner', 0, ['recon-sweep', 'signal-jam', 'drone-swarm', 'blast-mortar']);
for (let k = 1; k <= 6; k += 1) rt2.recordElimination('owner', k, k * 1_000);
const before = rt2.chargesOf('owner', 'drone-swarm');
const badPress = { ...press, claimId: 'parity-drone-2', anchor: { x: 500, y: 0, z: 500 } };
const refused = rt2.activate(badPress, 9_000, WORLD);
check('out-of-bounds marker refused as no-placement',
  !refused.accepted && refused.reason === 'no-placement');
check('refused placement keeps the charge', rt2.chargesOf('owner', 'drone-swarm') === before);

console.log(`drone proof: ${passed} checks passed`);
