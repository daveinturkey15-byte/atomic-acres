/**
 * Nuketown 2025 — Supply Crate proof. Dependency-free: no test runner, no
 * node builtins (this file must stay clean under the repo's `tsc --noEmit`,
 * which has no @types/node). Run by bundling with the repo's own esbuild
 * and executing the bundle; any failed check throws, so a silent pass IS
 * the pass. See docs/HANDOFF-PARITY.md for the command.
 */

import { REWARD_SOURCE_ID, STREAK_CATALOG, streakById, type StreakLoadout } from '../catalog';
import { MAX_CHARGES_PER_STREAK, StreakRuntime, WIRED_STREAK_IDS } from '../runtime';
import {
  SUPPLY_TOUCH_RANGE_M,
  createSupply,
  stepSupply,
  supplyFallbackGrantId,
  supplyGrantFor,
  supplyGrantPool,
} from './supply';
import type { SentryTarget } from './sentry';
import type { WorldQuery } from '../../events';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`supply proof failed: ${name}`);
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

const OWNER_LOADOUT: StreakLoadout = Object.freeze(['recon-sweep', 'signal-jam', 'supply-crate', 'blast-mortar']);
const OPENER_LOADOUT: StreakLoadout = Object.freeze(['recon-sweep', 'signal-jam', 'sentry-post', 'blast-mortar']);

// 1. Catalog still declares the row the runtime just wired.
check('catalog declares supply-crate mid/5/60s', (() => {
  const def = streakById('supply-crate', STREAK_CATALOG);
  return def !== null && def.cost === 5 && def.tier === 'mid' && def.durationMs === 60_000
    && def.activation === 'target-point' && def.availability === 'selectable';
})());
check('supply-crate is wired', WIRED_STREAK_IDS.includes('supply-crate'));
check('touch ring is 2.5 m', SUPPLY_TOUCH_RANGE_M === 2.5);

// 2. Layout: placed where validated, alive for the catalog window, holding one
// grant from the owner's loadout that is never the crate itself.
const laid = createSupply(7, 'owner', 0, 'supply-crate', 60_000, { x: 10, y: 0, z: 10 }, 11, OWNER_LOADOUT);
check('laid kind is supply', laid.kind === 'supply');
check('laid position holds', laid.x === 10 && laid.y === 0 && laid.z === 10);
check('laid window is the catalog 60 s', laid.remainingMs === 60_000);
check('laid grant is in the owner pool', supplyGrantPool(OWNER_LOADOUT).includes(laid.grantId));
check('laid grant is never the crate', laid.grantId !== REWARD_SOURCE_ID);

// 3. Grant-pool determinism: the seed and the loadout decide, nothing else.
const gA = createSupply(1, 'owner', 0, 'supply-crate', 60_000, { x: 0, y: 0, z: 0 }, 77, OWNER_LOADOUT);
const gB = createSupply(2, 'owner', 0, 'supply-crate', 60_000, { x: 9, y: 0, z: 9 }, 77, OWNER_LOADOUT);
check('same seed and loadout grant the same streak', gA.grantId === gB.grantId);
check('instance id does not leak into the grant', gA.grantId === gB.grantId && gA.instanceId !== gB.instanceId);
const pool = supplyGrantPool(OWNER_LOADOUT);
check('pool is the loadout minus the crate',
  pool.length === 3 && !pool.includes(REWARD_SOURCE_ID)
  && pool.includes('recon-sweep') && pool.includes('signal-jam') && pool.includes('blast-mortar'));
const seen = new Set<string>();
for (let s = 1; s <= 200; s += 1) seen.add(supplyGrantFor(s, OWNER_LOADOUT));
check('seed rolls stay inside the pool', [...seen].every((id) => pool.includes(id)));
check('seed rolls reach more than one pool member', seen.size >= 2);
check('empty pool falls back to recon-sweep',
  supplyGrantFor(99, ['supply-crate']) === 'recon-sweep' && supplyFallbackGrantId() === 'recon-sweep');

// 4. Touch grant: nearest alive opener in the ring, ties on id.
const crate = createSupply(3, 'owner', 0, 'supply-crate', 60_000, { x: 10, y: 0, z: 10 }, 11, OWNER_LOADOUT);
const opened = stepSupply(crate, 100, { now: 100, targets: [target({ id: 'opener', x: 11, y: 0, z: 10 })] });
check('touch opens the crate', opened.grant !== null && opened.grant.openerId === 'opener');
check('opened grant carries the laid grant', opened.grant !== null && opened.grant.grantId === crate.grantId);
check('opened crate retires', opened.state.remainingMs === 0);
check('opening emits nothing itself', opened.events.length === 0);
const tie = stepSupply(crate, 100, {
  now: 100,
  targets: [target({ id: 'b-id', x: 10, y: 0, z: 11 }), target({ id: 'a-id', x: 10, y: 0, z: 9 })],
});
check('equidistant touch prefers the lower id', tie.grant !== null && tie.grant.openerId === 'a-id');
const edge = stepSupply(crate, 100, { now: 100, targets: [target({ x: 12.5, y: 0, z: 10 })] });
check('the 2.5 m ring is inclusive', edge.grant !== null);
const justOut = stepSupply(crate, 100, { now: 100, targets: [target({ x: 12.51, y: 0, z: 10 })] });
check('past 2.5 m is untouched', justOut.grant === null && justOut.state.remainingMs === crate.remainingMs - 100);
const far = stepSupply(crate, 100, { now: 100, targets: [target({ x: 20, y: 0, z: 10 })] });
check('far actor does not open', far.grant === null);
const dead = stepSupply(crate, 100, { now: 100, targets: [target({ alive: false, x: 10, y: 0, z: 10 })] });
check('the dead do not open', dead.grant === null);
const drained = stepSupply(crate, 100, { now: 100, targets: [target({ health: 0, x: 10, y: 0, z: 10 })] });
check('the drained do not open', drained.grant === null);
const above = stepSupply(crate, 100, { now: 100, targets: [target({ x: 10, y: 10, z: 10 })] });
check('the deck above does not open', above.grant === null);
const spent = stepSupply({ ...crate, remainingMs: 0 }, 100, {
  now: 100, targets: [target({ x: 10, y: 0, z: 10 })],
});
check('a spent crate cannot be reopened', spent.grant === null);

// 5. Expiry is silent: the stepper carries nothing, the runtime retires it.
const short = createSupply(4, 'owner', 0, 'supply-crate', 500, { x: 0, y: 0, z: 0 }, 11, OWNER_LOADOUT);
const lapsed = stepSupply(short, 600, { now: 600, targets: [] });
check('expiry grants nothing', lapsed.grant === null);
check('expiry emits nothing', lapsed.events.length === 0);
check('expiry spends the window', lapsed.state.remainingMs <= 0);

// 6. End to end through the runtime: earn, place, touch, claim, expire.
const rt = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt.registerActor('owner', 0, OWNER_LOADOUT);
for (let k = 1; k <= 8; k += 1) rt.recordElimination('owner', k, k * 1_000);
const press = {
  actorId: 'owner', slot: 3, seq: 0, claimId: 'parity-supply-1', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: 5, y: 0, z: 5 },
  context: {
    alive: true, matchPhase: 'active' as const, inputEnabled: true,
    menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
  },
};
const placed = rt.activate(press, 9_000, WORLD);
check('supply activation accepted', placed.accepted === true);
check('supply placement spends the charge', rt.chargesOf('owner', 'supply-crate') === 0);
const live = rt.liveInstances();
check('one crate is live', live.length === 1 && live[0] !== undefined && live[0].kind === 'supply');
const liveCrate = live[0];
if (liveCrate === undefined || liveCrate.kind !== 'supply') throw new Error('supply proof failed: live crate mistyped');
const grantId = liveCrate.grantId;
const grantSlot = OWNER_LOADOUT.findIndex((id) => id === grantId) + 1;
const heldBefore = rt.chargesOf('owner', grantId);
const claimed = rt.advance(9_000, WORLD, [target({ id: 'owner', team: 0, x: 5, y: 0, z: 5 })]);
const earned = claimed.find((e) => e.type === 'streak-earned');
const endedClaim = claimed.find((e) => e.type === 'streak-ended');
check('touch banks one bonus charge',
  earned !== undefined && earned.type === 'streak-earned' && earned.actorId === 'owner'
  && earned.team === 0 && earned.streakId === grantId && earned.slot === grantSlot
  && earned.charges === heldBefore + 1);
check('claimed crate retires destroyed',
  endedClaim !== undefined && endedClaim.type === 'streak-ended' && endedClaim.reason === 'destroyed');
check('bank holds the bonus', rt.chargesOf('owner', grantId) === heldBefore + 1);
check('claimed crate leaves the world', rt.liveInstances().length === 0);

// 7. A capped opener keeps the crate for the next toucher.
const rt2 = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt2.registerActor('owner', 0, OWNER_LOADOUT);
rt2.registerActor('opener', 0, OPENER_LOADOUT);
for (let k = 1; k <= 8; k += 1) rt2.recordElimination('owner', k, k * 1_000);
const placed2 = rt2.activate({ ...press, claimId: 'parity-supply-2' }, 9_000, WORLD);
check('second crate placed', placed2.accepted === true);
const live2 = rt2.liveInstances();
const second = live2[0];
if (second === undefined || second.kind !== 'supply') {
  throw new Error('supply proof failed: second crate mistyped');
}
const grantId2 = second.grantId;
if (live2.length !== 1) {
  throw new Error('supply proof failed: second crate count');
}
for (let k = 1; k <= MAX_CHARGES_PER_STREAK * 8; k += 1) rt2.recordElimination('opener', k, 10_000 + k);
check('opener is capped on the grant', rt2.chargesOf('opener', grantId2) === MAX_CHARGES_PER_STREAK);
const refused2 = rt2.advance(20_000, WORLD, [target({ id: 'opener', team: 0, x: 5, y: 0, z: 5 })]);
check('capped touch banks nothing', refused2.every((e) => e.type !== 'streak-earned' && e.type !== 'streak-ended'));
check('capped touch keeps the crate', (() => {
  const kept = rt2.liveInstances()[0];
  return kept !== undefined && kept.kind === 'supply' && kept.remainingMs > 0;
})());

// 8. An unopened crate expires through the runtime: ended, never earned.
const rt3 = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt3.registerActor('owner', 0, OWNER_LOADOUT);
for (let k = 1; k <= 8; k += 1) rt3.recordElimination('owner', k, k * 1_000);
const placed3 = rt3.activate({ ...press, claimId: 'parity-supply-3' }, 9_000, WORLD);
check('third crate placed', placed3.accepted === true);
let t = 9_000;
let expired: { reason: string } | null = null;
let earnedOnExpiry = false;
for (let i = 0; i < 300 && expired === null; i += 1) {
  t += 250;
  for (const e of rt3.advance(t, WORLD, [])) {
    if (e.type === 'streak-ended') expired = { reason: e.reason };
    if (e.type === 'streak-earned') earnedOnExpiry = true;
  }
}
check('unopened crate expires', expired !== null && expired.reason === 'expired');
check('expiry banks nothing', !earnedOnExpiry);

// 9. A blocked marker refuses BEFORE the charge moves: same claim retries.
const rt4 = new StreakRuntime({ seed: 42, matchEpoch: 1 });
rt4.registerActor('owner', 0, OWNER_LOADOUT);
for (let k = 1; k <= 8; k += 1) rt4.recordElimination('owner', k, k * 1_000);
const before = rt4.chargesOf('owner', 'supply-crate');
const refused = rt4.activate({ ...press, claimId: 'parity-supply-4', anchor: { x: 500, y: 0, z: 500 } }, 9_000, WORLD);
check('out-of-bounds marker refused as no-placement',
  !refused.accepted && refused.reason === 'no-placement');
check('refused placement keeps the charge', rt4.chargesOf('owner', 'supply-crate') === before);
// 10. A foreign opener is remapped into their own bank, not refused.
// Opener ladder drops whatever the crate stocked (tier-legal swaps only:
// tracker-dart is low like the slot it fills, fallout-screen high like its).
function openerAgainst(stocked: string): StreakLoadout {
  if (stocked === 'recon-sweep') return Object.freeze(['tracker-dart', 'signal-jam', 'sentry-post', 'blast-mortar']);
  if (stocked === 'blast-mortar') return Object.freeze(['recon-sweep', 'signal-jam', 'sentry-post', 'strike-relay']);
  return Object.freeze(['recon-sweep', 'tracker-dart', 'sentry-post', 'blast-mortar']);
}
function openForeign(seed: number): string | null {
  const r = new StreakRuntime({ seed, matchEpoch: 1 });
  r.registerActor('owner', 0, OWNER_LOADOUT);
  for (let k = 1; k <= 8; k += 1) r.recordElimination('owner', k, k * 1_000);
  const ok = r.activate({ ...press, claimId: `parity-supply-x-${seed}` }, 9_000, WORLD);
  if (ok.accepted !== true) return null;
  const one = r.liveInstances()[0];
  if (one === undefined || one.kind !== 'supply') return null;
  const alt = openerAgainst(one.grantId);
  r.registerActor('opener', 1, alt);
  const out = r.advance(9_500, WORLD, [target({ id: 'opener', team: 1, x: 5, y: 0, z: 5 })]);
  const got = out.find((e) => e.type === 'streak-earned');
  if (got === undefined || got.type !== 'streak-earned') return null;
  const rotated = alt.findIndex((entry) => entry === got.streakId) + 1;
  if (rotated < 1 || got.slot !== rotated || got.actorId !== 'opener') return null;
  if (r.chargesOf('opener', got.streakId) !== 1) return null;
  if (r.liveInstances().length !== 0) return null;
  return got.streakId;
}
const foreignA = openForeign(42);
const foreignB = openForeign(42);
check('foreign opener banks in their own loadout', foreignA !== null);
check('foreign remap is deterministic', foreignA !== null && foreignA === foreignB);

console.log(`supply proof: ${passed} checks passed`);
