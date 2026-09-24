/**
 * Nuketown 2025 — Blast Mortar proof. Dependency-free: no test runner, no
 * node builtins (this file must stay clean under the repo's `tsc --noEmit`,
 * which has no @types/node). Run by bundling with the repo's own esbuild
 * and executing the bundle; any failed check throws, so a silent pass IS
 * the pass. See docs/HANDOFF-PARITY.md for the command.
 */

import { STREAK_CATALOG, streakById } from '../catalog';
import { StreakRuntime } from '../runtime';
import {
  MORTAR_BLAST_M,
  MORTAR_FIRST_IMPACT_MS,
  MORTAR_IMPACT_CADENCE_MS,
  MORTAR_MAX_DAMAGE,
  MORTAR_MIN_DAMAGE,
  MORTAR_SCATTER_M,
  MORTAR_SHELL_COUNT,
  MAX_MORTAR_SHELLS_PER_STEP,
  createMortar,
  mortarImpactAt,
  mortarImpactTimeMs,
  stepMortar,
} from './mortar';
import type { SentryTarget } from './sentry';
import type { WorldQuery } from '../../events';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`mortar proof failed: ${name}`);
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

// 1. The schedule is six shells, first at 600 ms, every 800 ms after.
check('shell count is 6', MORTAR_SHELL_COUNT === 6);
check('first impact at 600 ms', mortarImpactTimeMs(0) === MORTAR_FIRST_IMPACT_MS);
for (let i = 1; i < MORTAR_SHELL_COUNT; i += 1) {
  check(`cadence holds for shell ${i}`, mortarImpactTimeMs(i) - mortarImpactTimeMs(i - 1) === MORTAR_IMPACT_CADENCE_MS);
}

// 2. Scatter is seed-deterministic and inside the 4 m disc.
const mA = createMortar(1, 'owner', 0, 'blast-mortar', 15_000, { x: 0, y: 0, z: 0 }, 1234);
const mB = createMortar(2, 'owner', 0, 'blast-mortar', 15_000, { x: 0, y: 0, z: 0 }, 1234);
const mC = createMortar(3, 'owner', 0, 'blast-mortar', 15_000, { x: 0, y: 0, z: 0 }, 999);
for (let i = 0; i < MORTAR_SHELL_COUNT; i += 1) {
  const a = mortarImpactAt(mA, i);
  const b = mortarImpactAt(mB, i);
  check(`same seed lands shell ${i} together`, a.x === b.x && a.z === b.z);
  check(`shell ${i} inside scatter disc`, Math.hypot(a.x, a.z) <= MORTAR_SCATTER_M + 1e-9);
}
const differs = [0, 1, 2, 3, 4, 5].some((i) => {
  const a = mortarImpactAt(mA, i);
  const c = mortarImpactAt(mC, i);
  return a.x !== c.x || a.z !== c.z;
});
const early = stepMortar(mA, 500, { now: 500, targets: [target()] });
check('no damage before 600 ms', early.events.length === 0 && early.state.landed === 0);

// 4. Centre hit does exactly 55. The chest rides 1.35 m over the boots, so
// put the boots 1.35 m down and the 3D distance is 0.
const mD = createMortar(4, 'owner', 0, 'blast-mortar', 15_000, { x: 10, y: 0, z: 10 }, 7);
const hit0 = mortarImpactAt(mD, 0);
const centre = stepMortar(mD, 600, {
  now: 600,
  targets: [target({ x: hit0.x, y: hit0.y - 1.35, z: hit0.z })],
});
check('first shell lands at 600 ms', centre.state.landed === 1);
const firstHit = centre.events[0];
check('centre hit does 55', centre.events.length === 1 && firstHit !== undefined
  && firstHit.type === 'damage' && firstHit.amount === MORTAR_MAX_DAMAGE);

// 5. Falloff: half radius lands between edge and centre; outside 6 m is safe.
const edge = stepMortar(mD, 600, {
  now: 600,
  targets: [target({ x: hit0.x + MORTAR_BLAST_M, y: hit0.y - 1.35, z: hit0.z })],
});
check('blast edge is untouched', edge.events.length === 0);
const half = stepMortar(mD, 600, {
  now: 600,
  targets: [target({ x: hit0.x + MORTAR_BLAST_M / 2, y: hit0.y - 1.35, z: hit0.z })],
});
const halfFirst = half.events[0];
const halfAmount = half.events.length === 1 && halfFirst !== undefined && halfFirst.type === 'damage'
  ? halfFirst.amount : -1;
check('half-radius wounds between edge and centre', halfAmount > MORTAR_MIN_DAMAGE && halfAmount < MORTAR_MAX_DAMAGE);

// 6. Who is skipped: friendlies, the owner, the dead, the already-drained.
const mixed = stepMortar(mD, 600, {
  now: 600,
  targets: [
    target({ id: 'friend', team: 0, x: hit0.x, y: hit0.y - 1.35, z: hit0.z }),
    target({ id: 'owner', team: 0, x: hit0.x, y: hit0.y - 1.35, z: hit0.z }),
    target({ id: 'corpse', x: hit0.x, y: hit0.y - 1.35, z: hit0.z, alive: false }),
    target({ id: 'drained', x: hit0.x, y: hit0.y - 1.35, z: hit0.z, health: 0 }),
  ],
});
check('no friendly, owner, corpse or drained damage', mixed.events.length === 0);

// 7. A stalled tab lands at most 2 shells in one step, never the remainder.
const stall = stepMortar(mD, 30_000, { now: 30_000, targets: [] });
check('per-step shell cap holds', stall.state.landed <= MAX_MORTAR_SHELLS_PER_STEP);

// 8. Out of shells ends the call.
let volley = mD;
let now = 0;
for (let i = 0; i < 40 && volley.landed < MORTAR_SHELL_COUNT; i += 1) {
  now += 500;
  volley = stepMortar(volley, 500, { now, targets: [] }).state;
}
check('volley completes', volley.landed === MORTAR_SHELL_COUNT);
check('spent volley retires', volley.remainingMs === 0);

// 9. Catalog still declares the row the runtime just wired.
check('catalog declares blast-mortar high/8', (() => {
  const def = streakById('blast-mortar', STREAK_CATALOG);
  return def !== null && def.cost === 8 && def.tier === 'high' && def.activation === 'target-point';
})());

// 10. End to end through the runtime: earn, place, fire, expire.
const rt = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt.registerActor('owner', 0);
for (let k = 1; k <= 8; k += 1) rt.recordElimination('owner', k, k * 1_000);
const press = {
  actorId: 'owner', slot: 4, seq: 0, claimId: 'parity-mortar-1', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: 5, y: 0, z: 5 },
  context: {
    alive: true, matchPhase: 'active' as const, inputEnabled: true,
    menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
  },
};
const fired = rt.activate(press, 9_000, WORLD);
check('mortar activation accepted', fired.accepted === true);
let t = 9_000;
let damage = 0;
let ended = false;
for (let i = 0; i < 40; i += 1) {
  t += 250;
  for (const e of rt.advance(t, WORLD, [target({ x: 5, y: -1.35, z: 5 })])) {
    if (e.type === 'damage') damage += 1;
    if (e.type === 'streak-ended') ended = true;
  }
  if (ended) break;
}
check('mortar volley damages through the runtime', damage > 0);
check('mortar instance retires after the volley', ended);

// 11. A blocked marker refuses BEFORE the charge moves: same claim retries.
const rt2 = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt2.registerActor('owner', 0);
for (let k = 1; k <= 8; k += 1) rt2.recordElimination('owner', k, k * 1_000);
const before = rt2.chargesOf('owner', 'blast-mortar');
const badPress = { ...press, claimId: 'parity-mortar-2', anchor: { x: 500, y: 0, z: 500 } };
const refused = rt2.activate(badPress, 9_000, WORLD);
check('out-of-bounds marker refused as no-placement',
  !refused.accepted && refused.reason === 'no-placement');
check('refused placement keeps the charge', rt2.chargesOf('owner', 'blast-mortar') === before);

console.log(`mortar proof: ${passed} checks passed`);
