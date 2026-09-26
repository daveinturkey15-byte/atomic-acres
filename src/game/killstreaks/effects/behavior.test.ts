/**
 * Focused, dependency-free killstreak behavior proof.
 *
 * Bundle this file with the repository's esbuild and run the output with Node.
 * It intentionally exercises pure steppers and the host-owned runtime only;
 * browser/render checks belong to the parent integration lane.
 */

import { STREAK_CATALOG } from '../catalog';
import { StreakRuntime, WIRED_STREAK_IDS, type StreakTarget } from '../runtime';
import type { WorldQuery } from '../../events';
import {
  DART_PULSE_MS, createDart, dartPaints, stepDart,
} from './dart';
import {
  FALLOUT_RADIUS_M, createFallout, falloutHides, stepFallout,
} from './fallout';
import {
  STRIKE_RELAY_FIRST_MS, STRIKE_RELAY_INTERVAL_MS, STRIKE_RELAY_MAX_DAMAGE,
  createStrikeRelay, stepStrikeRelay,
} from './strike-relay';
import {
  CRATE_CAPTURE_ENEMY_MS, CRATE_CAPTURE_OWN_MS, crateGrantFits,
  crateRewardForSeed, createSupplyCrate, stepSupplyCrate,
} from './supply-crate';
import {
  DEFAULT_MAX_HEALTH, FIELD_REPAIR_HEAL, fieldRepairHealth, lastResortEvents,
} from './rewards';
import type { ReconState } from './recon';

let passed = 0;
function check(name: string, condition: boolean): void {
  if (!condition) throw new Error(`killstreak proof failed: ${name}`);
  passed += 1;
}

const OPEN: WorldQuery = Object.freeze({
  lineOfSight: () => true,
  groundY: () => 0,
  inBounds: (x: number, z: number) => Math.abs(x) <= 40 && Math.abs(z) <= 40,
});

function target(overrides: Partial<StreakTarget> = {}): StreakTarget {
  return Object.freeze({
    id: 'enemy', team: 1, alive: true, health: 100, x: 0, y: 0, z: 0, ...overrides,
  });
}

// All selectable rows are backed by a real stepper or an explicit runtime
// reward adapter. This catches a catalog row being added without wiring it.
check('all eight selectable rows are wired', WIRED_STREAK_IDS.length === 8
  && STREAK_CATALOG.definitions.filter((entry) => entry.availability === 'selectable')
    .every((entry) => WIRED_STREAK_IDS.includes(entry.id)));

// Tracker Dart snapshots a target at pulse time and does not continuously
// follow it between pulses.
const dart = createDart(1, 'owner', 0, 'tracker-dart', 20_000, { x: 0, y: 0, z: 0 }, 0);
const dartPulse = stepDart(dart, DART_PULSE_MS, {
  now: DART_PULSE_MS, world: OPEN, targets: [target({ x: 3 })],
});
check('dart latches a visible hostile', dartPaints(dartPulse.state, 'enemy'));
check('dart stores the pulse position', dartPulse.state.samples[0]?.x === 3);
const dartMoved = stepDart(dartPulse.state, 250, {
  now: DART_PULSE_MS + 250, world: OPEN, targets: [target({ x: 9 })],
});
check('dart does not wallhack between pulses', dartMoved.state.samples[0]?.x === 3);

// Fallout is team-local and expires cleanly.
const fallout = createFallout(2, 'screen', 1, 'fallout-screen', 1_000, { x: 0, y: 0, z: 0 });
check('fallout hides its own team from enemies', falloutHides(fallout, 0, 1, FALLOUT_RADIUS_M, 0));
check('fallout does not hide friendlies from themselves', !falloutHides(fallout, 1, 1, 0, 0));
check('fallout radius gates cover', !falloutHides(fallout, 0, 1, FALLOUT_RADIUS_M + 0.01, 0));
check('fallout expiry removes the field', !falloutHides(stepFallout(fallout, 1_000).state, 0, 1, 0, 0));

// Strike Relay has three spaced, deterministic pulses and hostile-only damage.
const relay = createStrikeRelay(3, 'owner', 0, 'strike-relay', 18_000, { x: 0, y: 0, z: 0 }, 0);
const relayFirst = stepStrikeRelay(relay, STRIKE_RELAY_FIRST_MS, {
  now: STRIKE_RELAY_FIRST_MS,
  targets: [target(), target({ id: 'friend', team: 0 }), target({ id: 'far', x: 0, z: 10 })],
});
check('relay first pulse fires on schedule', relayFirst.state.fired === 1);
check('relay centre hit uses full damage', relayFirst.events.length === 1
  && relayFirst.events[0]?.type === 'damage'
  && relayFirst.events[0].amount === STRIKE_RELAY_MAX_DAMAGE);
const relaySecond = stepStrikeRelay(relayFirst.state, STRIKE_RELAY_INTERVAL_MS, {
  now: STRIKE_RELAY_FIRST_MS + STRIKE_RELAY_INTERVAL_MS,
  targets: [target({ z: -7 }), target({ id: 'friend', team: 0, z: -7 })],
});
check('relay second pulse advances independently', relaySecond.state.fired === 2);
check('relay second pulse remains hostile-only', relaySecond.events.length === 1);

// Supply Crate rolls once, uses distinct own/enemy capture windows, and leaves
// bank-cap admission to the runtime adapter.
const crateA = createSupplyCrate(4, 'owner', 0, 'supply-crate', 60_000, { x: 0, y: 0, z: 0 }, 77, STREAK_CATALOG);
const crateB = createSupplyCrate(5, 'owner', 0, 'supply-crate', 60_000, { x: 0, y: 0, z: 0 }, 77, STREAK_CATALOG);
check('crate reward is seed-deterministic', crateA.reward === crateB.reward && crateA.rollUnit === crateB.rollUnit
  && crateRewardForSeed(77, STREAK_CATALOG).reward === crateA.reward);
const ownAlmost = stepSupplyCrate(crateA, CRATE_CAPTURE_OWN_MS - 1, {
  now: CRATE_CAPTURE_OWN_MS - 1, world: OPEN, targets: [target({ team: 0 })],
});
check('own capture waits for the full hold', !ownAlmost.state.opened);
const ownOpen = stepSupplyCrate(ownAlmost.state, 1, {
  now: CRATE_CAPTURE_OWN_MS, world: OPEN, targets: [target({ team: 0 })],
});
check('own capture opens at the threshold', ownOpen.state.opened);
const enemyAlmost = stepSupplyCrate(crateA, CRATE_CAPTURE_ENEMY_MS - 1, {
  now: CRATE_CAPTURE_ENEMY_MS - 1, world: OPEN, targets: [target({ team: 1 })],
});
check('enemy steal waits for the longer hold', !enemyAlmost.state.opened);
const enemyOpen = stepSupplyCrate(enemyAlmost.state, 1, {
  now: CRATE_CAPTURE_ENEMY_MS, world: OPEN, targets: [target({ team: 1 })],
});
check('enemy steal opens at its threshold', enemyOpen.state.opened);
check('crate cap admits a new reward slot', crateGrantFits(new Map(), crateA.reward, 8, 255));
check('crate cap rejects a full bank', !crateGrantFits(new Map([['x', 1], ['y', 1]]), 'z', 2, 255));

// Reward-only rows have bounded, explicit host adapters.
check('field repair is capped at max health', fieldRepairHealth(80) === DEFAULT_MAX_HEALTH);
check('field repair adds its authored amount', fieldRepairHealth(20) === 20 + FIELD_REPAIR_HEAL);
const lastResort = lastResortEvents('owner', 0, 100, [
  target({ id: 'enemy-b', x: 1 }), target({ id: 'friend', team: 0 }), target({ id: 'enemy-a', x: 2 }),
]);
check('last resort hits hostile targets only', lastResort.length === 2
  && lastResort[0]?.victimId === 'enemy-a' && lastResort[1]?.victimId === 'enemy-b');

// End-to-end radar proof: both sensors latch positions, the API filters teams,
// and Signal Jam suppresses the opposing observer without exposing state.
const radar = new StreakRuntime({ seed: 1, matchEpoch: 1 });
radar.registerActor('observer', 0, ['recon-sweep', 'tracker-dart', 'sentry-post', 'fallout-screen']);
for (let kill = 1; kill <= 4; kill += 1) radar.recordElimination('observer', kill, kill * 100);
const permissive = {
  alive: true, matchPhase: 'active' as const, inputEnabled: true,
  menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
};
const reconPress = radar.activate({
  actorId: 'observer', slot: 1, seq: 0, claimId: 'radar-recon', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, context: permissive,
}, 0, OPEN);
const dartPress = radar.activate({
  actorId: 'observer', slot: 2, seq: 1, claimId: 'radar-dart', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: 0, y: 0, z: 0 }, context: permissive,
}, 0, OPEN);
check('runtime accepts recon and dart charges', reconPress.accepted && dartPress.accepted);
const radarEnemy = target({ id: 'radar-enemy', x: 4 });
const radarFriend = target({ id: 'radar-friend', team: 0, x: 4 });
radar.advance(0, OPEN, [radarEnemy, radarFriend]);
let radarTime = 0;
for (let i = 0; i < 10; i += 1) {
  radarTime += 250;
  radar.advance(radarTime, OPEN, [radarEnemy, radarFriend]);
}
const samples = radar.radarFor(0, [target({ id: 'radar-enemy', x: 9 }), radarFriend]);
check('radar returns both sensor sources', samples.some((sample) => sample.source === 'recon')
  && samples.some((sample) => sample.source === 'dart'));
check('radar keeps pulse coordinates', samples.every((sample) => sample.x === 4));
check('radar carries the capturing pulse', samples.every((sample) => sample.pulse === 1));
check('radar excludes friendly ids', !samples.some((sample) => sample.id === 'radar-friend'));
check('radar IDs are team-scoped', radar.revealedTargetIds(1, [radarEnemy]).length === 0);
check('dart projection is source-scoped', radar.paintedTargetIds(0, [radarEnemy]).includes('radar-enemy'));
check('recon boolean waits for a pulse', radar.revealedFor(0));

const screen = 'radar-screen';
radar.registerActor(screen, 1, ['recon-sweep', 'tracker-dart', 'sentry-post', 'fallout-screen']);
for (let kill = 1; kill <= 7; kill += 1) radar.recordElimination(screen, kill, 3_000 + kill * 100);
const screenPlaced = radar.activate({
  actorId: screen, slot: 4, seq: 0, claimId: 'radar-screen-claim', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: 0, y: 0, z: 0 }, context: permissive,
}, 4_000, OPEN);
check('fallout screen activation accepts', screenPlaced.accepted);
check('fallout suppresses an enemy inside its field', radar.radarFor(0, [radarEnemy]).length === 0);

radar.registerActor('jammer', 1);
for (let kill = 1; kill <= 4; kill += 1) radar.recordElimination('jammer', kill, 4_000 + kill * 100);
const jammed = radar.activate({
  actorId: 'jammer', slot: 2, seq: 0, claimId: 'radar-jam', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, context: permissive,
}, 5_000, OPEN);
check('signal jam activation accepts', jammed.accepted);
check('jammer suppresses the opposing observer team', radar.radarFor(0, [radarEnemy]).length === 0);

// Keep ReconState imported in the proof's type surface so a stale compile-time
// discriminant cannot silently turn the sensor into an untyped object.
const reconShape: ReconState | undefined = radar.liveInstances().find((instance): instance is ReconState => instance.kind === 'recon');
check('recon state carries latched samples', reconShape !== undefined && Array.isArray(reconShape.latched));

console.log(`killstreak behavior proof: ${passed} checks passed`);
