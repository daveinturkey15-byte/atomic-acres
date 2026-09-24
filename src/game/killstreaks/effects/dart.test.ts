/**
 * Nuketown 2025 — Tracker Dart proof. Same dependency-free rules as
 * `mortar.test.ts`: bundle with the repo's esbuild, run the bundle, a
 * thrown check is the failure. See docs/HANDOFF-PARITY.md for the command.
 */

import { STREAK_CATALOG, streakById } from '../catalog';
import { StreakRuntime } from '../runtime';
import {
  DART_PULSE_MS,
  DART_RADIUS_M,
  createDart,
  dartPaints,
  stepDart,
} from './dart';
import type { SentryTarget } from './sentry';
import type { WorldQuery } from '../../events';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`dart proof failed: ${name}`);
  passed += 1;
}

function world(lineOfSight: boolean): WorldQuery {
  const los = lineOfSight;
  return Object.freeze({
    lineOfSight: () => los,
    groundY: () => 0,
    inBounds: (x: number, z: number) => Math.abs(x) <= 40 && Math.abs(z) <= 40,
  });
}

function target(overrides: Partial<SentryTarget> = {}): SentryTarget {
  return Object.freeze({
    id: 'victim', team: 1, alive: true, health: 100, x: 0, y: 0, z: 0, ...overrides,
  });
}

const OPEN = world(true);
const BLIND = world(false);

// 1. Nothing is painted before the first pulse completes.
const fresh = createDart(1, 'owner', 0, 'tracker-dart', 20_000, { x: 0, y: 0, z: 0 }, 5);
check('fresh dart paints nobody', !dartPaints(fresh, 'victim'));

// 2. A hostile inside the bubble with line of sight is latched.
const near = target({ x: 5, z: 0 });
const pulsed = stepDart(fresh, DART_PULSE_MS, { now: DART_PULSE_MS, world: OPEN, targets: [near] });
check('first pulse latches the hostile', pulsed.state.painted.includes('victim'));
check('latched hostile reads painted', dartPaints(pulsed.state, 'victim'));

// 3. Radius gates: 14 m in, 20 m out.
const far = stepDart(fresh, DART_PULSE_MS, {
  now: DART_PULSE_MS, world: OPEN, targets: [target({ x: DART_RADIUS_M + 6, z: 0 })],
});
check('radius excludes the far target', !far.state.painted.includes('victim'));

// 4. Cover gates: no line of sight, no paint.
const hidden = stepDart(fresh, DART_PULSE_MS, {
  now: DART_PULSE_MS, world: BLIND, targets: [near],
});
check('cover protects from the dart', hidden.state.painted.length === 0);

// 5. Team gates: friendlies, the owner, the dead and the drained stay clean.
const gated = stepDart(fresh, DART_PULSE_MS, {
  now: DART_PULSE_MS,
  world: OPEN,
  targets: [
    target({ id: 'friend', team: 0, x: 5, z: 0 }),
    target({ id: 'owner', team: 0, x: 5, z: 1 }),
    target({ id: 'corpse', x: 5, z: 2, alive: false }),
    target({ id: 'drained', x: 5, z: 3, health: 0 }),
  ],
});
check('team and life gates hold', gated.state.painted.length === 0);

// 6. Pulses recompute: leaving the bubble unpaints.
const left = stepDart(pulsed.state, DART_PULSE_MS, {
  now: DART_PULSE_MS * 2, world: OPEN, targets: [target({ x: DART_RADIUS_M + 6, z: 0 })],
});
check('leaving the bubble unpaints', !dartPaints(left.state, 'victim'));

// 7. Expiry ends the paint even with a latched set.
const dying = { ...pulsed.state, remainingMs: 0 };
check('expired dart paints nobody', !dartPaints(dying, 'victim'));

// 8. Two darts on one seed do not pulse in lockstep with another seed.
// Same seed, same cadence; different seeds offset the first pulse.
const sA = createDart(1, 'owner', 0, 'tracker-dart', 20_000, { x: 0, y: 0, z: 0 }, 5);
const sB = createDart(2, 'owner', 0, 'tracker-dart', 20_000, { x: 0, y: 0, z: 0 }, 5);
const sC = createDart(3, 'owner', 0, 'tracker-dart', 20_000, { x: 0, y: 0, z: 0 }, 500);
check('same seed shares first-pulse offset', sA.pulseMs === sB.pulseMs);
check('different seeds offset the first pulse', sA.pulseMs !== sC.pulseMs);

// 9. Catalog still declares the row the runtime just wired.
check('catalog declares tracker-dart low/4', (() => {
  const def = streakById('tracker-dart', STREAK_CATALOG);
  return def !== null && def.cost === 4 && def.tier === 'low' && def.activation === 'target-point';
})());

// 10. End to end: earn, throw, paint, read through the runtime.
const rt = new StreakRuntime({ seed: 7, matchEpoch: 1 });
rt.registerActor('owner', 0, ['tracker-dart', 'signal-jam', 'sentry-post', 'blast-mortar']);
for (let k = 1; k <= 4; k += 1) rt.recordElimination('owner', k, k * 1_000);
const press = {
  actorId: 'owner', slot: 1, seq: 0, claimId: 'parity-dart-1', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: 0, y: 0, z: 0 },
  context: {
    alive: true, matchPhase: 'active' as const, inputEnabled: true,
    menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
  },
};
const thrown = rt.activate(press, 5_000, OPEN);
check('dart activation accepted', thrown.accepted === true);
// The runtime's first advance always carries dt 0 (it establishes the clock),
// so drive a real tick train: twelve 250 ms steps cover a full pulse period.
let t = 5_000;
for (let i = 0; i < 12; i += 1) {
  t += 250;
  rt.advance(t, OPEN, [near]);
}
const painted = rt.paintedTargetIds();
check('runtime reports the painted hostile', painted.includes('victim'));
for (let i = 0; i < 12; i += 1) {
  t += 250;
  rt.advance(t, OPEN, [target({ x: DART_RADIUS_M + 6, z: 0 })]);
}
check('runtime unpaints the leaver', !rt.paintedTargetIds().includes('victim'));

console.log(`dart proof: ${passed} checks passed`);
