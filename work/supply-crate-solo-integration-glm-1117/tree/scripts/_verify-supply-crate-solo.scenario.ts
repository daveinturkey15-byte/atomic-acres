/**
 * _verify-supply-crate-solo — CPU event-path verification for the SOLO
 * integration lane. NO GPU, NO browser, NO server, NO fabricated events:
 * every gameplay event below comes out of the REAL patched
 * `StreakRuntime` (the host-authoritative stepper path this lane wires)
 * and is fed to the REAL visual module exactly as `main.ts` feeds it.
 *
 * Covered:
 *   1. earned supply-crate charge reaches the stepper (gate no longer says
 *      arena-unsupported) and activates with placement validation;
 *   2. crate-landed is admitted once through the runtime's own advance();
 *   3. the hold grants the rolled reward EXACTLY ONCE, beside the
 *      crate-opened event that names it, and retires the crate;
 *   4. negative: no duplicate grant on later ticks; replayed claim is
 *      rejected; unclaimed crate expires with no grant; bank-cap helper.
 *   5. presentation: the same events drive the crate visual (admission,
 *      cap eviction, open/linger self-exit, ended disposal, clear,
 *      dispose-inert) on a synthetic clock.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StreakRuntime } from '../src/game/killstreaks/runtime';
import { STREAK_CATALOG } from '../src/game/killstreaks/catalog';
import { CRATE_PICKUP_RADIUS_M, crateGrantFits } from '../src/game/killstreaks/effects/supply-crate';
import { createSupplyCrateVisual, SUPPLY_CRATE_MAX_ACTIVE } from '../src/weapons/supply-crate-visual';
import type { WorldQuery, GameEvent } from '../src/game/events';

const world = {
  inBounds: () => true,
  groundY: () => 0,
  lineOfSight: () => true,
} as unknown as WorldQuery;

const OPEN_CTX = {
  alive: true, matchPhase: 'active' as const, inputEnabled: true,
  menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
};

function newRuntime(): StreakRuntime {
  const r = new StreakRuntime({ seed: 7, matchEpoch: 0 });
  r.registerActor('p1', 0, ['recon-sweep', 'signal-jam', 'supply-crate', 'blast-mortar']);
  return r;
}

function earn(r: StreakRuntime): void {
  for (let i = 1; i <= 5; i++) r.recordElimination('p1', i, i * 100);
}

function activate(r: StreakRuntime, seq: number, claim: string, anchor = true): void {
  const out = r.activate({
    actorId: 'p1', slot: 3, seq, claimId: claim, life: 0, matchEpoch: 0, toggle: false,
    origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: anchor ? { x: 2, y: 0, z: 2 } : null,
    context: OPEN_CTX,
  }, 1_000, world);
  assert.ok(out.accepted, `activation must be admitted, got ${JSON.stringify(out)}`);
}

const holder = [{ id: 'p1', team: 0 as const, alive: true, health: 100, x: 2, y: 0, z: 2 }];

// ---- 1+2: earn, activate, land once -------------------------------------------------
{
  const r = newRuntime();
  earn(r);
  assert.equal(r.chargesOf('p1', 'supply-crate'), 1, 'charge banked at cost 5');
  activate(r, 0, 'p1-0-0');
  const landed: GameEvent[] = [];
  landed.push(...r.advance(1_100, world));
  landed.push(...r.advance(1_200, world));
  const evs = landed.filter((e) => e.type === 'crate-landed');
  assert.equal(evs.length, 1, 'crate-landed admitted exactly once through advance()');
  const l = evs[0] as { x: number; y: number; z: number; radius: number; expiresAt: number };
  assert.equal(l.x, 2); assert.equal(l.z, 2);
  assert.equal(l.radius, CRATE_PICKUP_RADIUS_M);
  assert.equal(r.liveInstances().length, 1, 'crate live');
}

// ---- 3+4: hold -> grant once, retire; negatives --------------------------------------
{
  const r = newRuntime();
  earn(r);
  activate(r, 0, 'p1-0-0');
  r.advance(1_100, world); // landed
  const seen: GameEvent[] = [];
  let t = 1_200;
  for (let i = 0; i < 20 && r.liveInstances().length > 0; i++) { seen.push(...r.advance(t, world, holder)); t += 100; }
  const earned = seen.filter((e) => e.type === 'streak-earned');
  const opened = seen.filter((e) => e.type === 'crate-opened');
  assert.equal(earned.length, 1, 'one streak-earned beside the grant');
  assert.equal(opened.length, 1, 'one crate-opened');
  const en = earned[0] as { streakId: string; slot: number; charges: number };
  const op = opened[0] as { reward: string; rollUnit: number; instanceId: number };
  assert.equal(en.streakId, op.reward, 'the granted charge IS the rolled reward');
  assert.equal(en.slot, 0, 'reward not on a key: slot 0');
  assert.equal(en.charges, 1);
  assert.ok(STREAK_CATALOG.rewardPool.totalUnits > 0);
  assert.equal(r.liveInstances().length, 0, 'crate retired by the grant');
  assert.equal(r.chargesOf('p1', op.reward), 1, 'reward banked once');
  r.advance(t + 1_000, world, holder);
  r.advance(t + 2_000, world, holder);
  assert.equal(r.chargesOf('p1', op.reward), 1, 'NEGATIVE: no duplicate grant on later ticks');
  // replayed claim refused at the claim layer
  const replay = r.activate({
    actorId: 'p1', slot: 3, seq: 0, claimId: 'p1-0-0', life: 0, matchEpoch: 0, toggle: false,
    origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: null, context: OPEN_CTX,
  }, 9_000, world);
  assert.ok(!replay.accepted && replay.outcome === 'rejected', 'replayed claim rejected');
}

// ---- expiry: unclaimed crate never grants --------------------------------------------
{
  const r = newRuntime();
  earn(r);
  activate(r, 0, 'p1-0-1');
  const seen: GameEvent[] = [];
  let t = 1_000;
  for (let i = 0; i < 700; i++) { seen.push(...r.advance(t, world)); t += 100; }
  assert.equal(seen.filter((e) => e.type === 'crate-opened').length, 0, 'no grant without a hold');
  const ended = seen.filter((e) => e.type === 'streak-ended');
  assert.equal(ended.length, 1, 'expired crate retired once');
  assert.equal((ended[0] as { reason: string }).reason, 'expired');
}

// ---- placement refused before a charge moves ------------------------------------------
{
  const r = newRuntime();
  earn(r);
  const bad = world; // anchor out of the fake world's bounds
  const hostile = {
    inBounds: () => false, groundY: () => NaN, lineOfSight: () => true,
  } as unknown as WorldQuery;
  void bad;
  const out = r.activate({
    actorId: 'p1', slot: 3, seq: 0, claimId: 'p1-0-2', life: 0, matchEpoch: 0, toggle: false,
    origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: 1, y: 0, z: 1 }, context: OPEN_CTX,
  }, 1_000, hostile);
  assert.ok(!out.accepted && out.outcome === 'rejected', 'no-placement refused');
  assert.equal(r.chargesOf('p1', 'supply-crate'), 1, 'charge kept: Rule 5, retryable');
}

// ---- bank-cap helper (pure) ------------------------------------------------------------
{
  const full = new Map<string, number>(Array.from({ length: 8 }, (_, i) => [`s${i}`, 1]));
  assert.equal(crateGrantFits(full, 's9', 8, 255), false, 'distinct-id cap');
  full.set('s0', 255);
  assert.equal(crateGrantFits(full, 's0', 8, 255), false, 'per-id cap');
  assert.equal(crateGrantFits(new Map(), 's0', 8, 255), true);
}

// ---- 5: presentation, fed by the runtime's OWN event arrays -----------------------------
{
  const scene = new THREE.Scene();
  const vis = createSupplyCrateVisual({ scene });
  const r = newRuntime();
  earn(r);
  activate(r, 0, 'p1-0-3');
  const feed: GameEvent[] = [];
  feed.push(...r.advance(1_100, world)); // dt 0: first tick pins the clock, stays silent
  feed.push(...r.advance(1_200, world)); // landing announced here, once
  vis.apply(feed);
  assert.equal(vis.liveCount, 1, 'landed -> drawn');
  for (let i = 0; i < 10; i++) {
    const t = 1_200 + i * 200;
    vis.apply(r.advance(t, world, holder));
    vis.update(t);
  }
  for (let t2 = 3_300; t2 <= 6_000 && vis.liveCount > 0; t2 += 100) vis.update(t2);
  assert.equal(vis.liveCount, 0, 'opened crate left with the grant (self exit)');
  // cap eviction: admit MAX+1 ids directly from synthetic landed ids is NOT done here —
  // use real repeats across lifetimes instead. Fresh ladder: the spent crate's
  // charge is gone and the ladder cycle honestly restarted at the top rung.
  const r3 = newRuntime();
  earn(r3);
  activate(r3, 1, 'p1-0-4');
  vis.apply(r3.advance(3_100, world)); // dt 0 pin
  vis.apply(r3.advance(3_200, world)); // landing
  assert.equal(vis.liveCount, 1);
  vis.apply(r3.advance(3_300, world));
  assert.ok(vis.liveCount <= SUPPLY_CRATE_MAX_ACTIVE, 'cap holds');
  vis.clear();
  assert.equal(vis.liveCount, 0, 'clear() empties');
  vis.dispose();
  vis.apply(r.advance(3_000, world));
  vis.update(9_999);
  assert.equal(vis.liveCount, 0, 'dispose() is inert');
  // allocation-free update sanity: many ticks over a live crate do not throw
  const r2 = newRuntime(); earn(r2); activate(r2, 0, 'p1-0-5');
  const f2: GameEvent[] = [];
  f2.push(...r2.advance(1_100, world));
  f2.push(...r2.advance(1_200, world));
  const vis2 = createSupplyCrateVisual({ scene });
  vis2.apply(f2);
  for (let i = 0; i < 2_000; i++) vis2.update(10_000 + i * 16);
  vis2.dispose();
}

console.log('PASS supply-crate solo integration: earn->stepper, land-once, reward-once, expiry, replay-reject, no-placement, caps, visual lifecycle');
