/**
 * Nuketown 2025 — Supply Crate: a dropped box that rolls the reward pool.
 *
 * Pure stepper, same contract as the other four: `step(state, dt, ctx)` returns
 * a NEW state and the events that happened, owns no mesh, no material, no
 * light (§5.8, §5.10). It cannot reach a renderer and cannot yield to one.
 *
 * ## Behavioural reference (old project, never copied)
 *
 * `atomic-acres-production-27e0858/src/killstreak-runtime.ts`:
 *  - the reward is rolled ONCE AT SPAWN from the host seed
 *    (`rollUnit = seed % pool.totalWeightUnits`, line 1216) and stored on the
 *    entity, NOT at pickup — same crate, same reward, every replay;
 *  - the crate lives 60 s (line 1249) — this catalog row's `durationMs`;
 *  - pickup is a HOLD under host authority: 1.25 s own team, 2.5 s enemy
 *    theft (line 1811), admitted inside 2.75 m with line of sight
 *    (lines 1802-1804), reset when the collector leaves, dies or loses sight;
 *  - a full recipient bank leaves the crate claimable (lines 56, 1813) —
 *    the grant is refused, the capture resets, nothing is discarded.
 *
 * ## What this module deliberately does NOT have
 *
 * No capture PRESS: the host's port carries no per-tick button state, so the
 * hold is admitted from the host's own target table alone — an actor standing
 * in the radius IS the capture claim (host-admitted, never client-claimed).
 * No reveal event: the roll is host-secret until `crate-opened`.
 */

import type { ActorId, GameEvent, TeamId, WorldQuery } from '../../events';
import type { CrateLandedEvent } from '../../events-crate';
import { rewardForUnit, type StreakCatalog } from '../catalog';
import type { SentryTarget } from './sentry';

// ---------------------------------------------------------------------------
// Tuning. Each names the old-project number it ports (§5.9).
// ---------------------------------------------------------------------------

/** Capture admission radius. Old project line 1803: `> 2.75` interrupts. */
export const CRATE_PICKUP_RADIUS_M = 2.75;
/** Own-team hold, ms. Old project line 1811. */
export const CRATE_CAPTURE_OWN_MS = 1_250;
/** Enemy-theft hold, ms. Old project line 1811 — stealing takes twice as long. */
export const CRATE_CAPTURE_ENEMY_MS = 2_500;

export interface SupplyCrateState {
  readonly kind: 'supply-crate';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly elapsedMs: number;
  /** Stored, not derived: the landing event reports it once. */
  readonly durationMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly seed: number;
  /** Rolled at create, seed-only. Host-secret until opened. */
  readonly reward: string;
  /** The exact pool unit behind `reward` — audit trail on the opened event. */
  readonly rollUnit: number;
  /** The one actor currently holding the capture, or null. */
  readonly captureActorId: ActorId | null;
  /** Held ms by `captureActorId`. Reset on candidate change, not accumulated. */
  readonly captureProgressMs: number;
  /** True once the first stepped tick announced the landing. Idempotent. */
  readonly landed: boolean;
  /**
   * Set by the step when a hold completes; the RUNTIME admits or refuses the
   * grant (bank caps) and only then retires the crate as `collected`. A
   * refused grant resets this — the crate stays claimable.
   */
  readonly opened: boolean;
}

export interface CrateTickContext {
  readonly now: number;
  /** The runtime's own actor table with current health — the same list a sentry aims with. */
  readonly targets: readonly SentryTarget[];
  /** The host's world, for the line-of-sight half of the old admission rule. */
  readonly world: WorldQuery;
}

export interface CrateTick {
  readonly state: SupplyCrateState;
  readonly events: readonly GameEvent[];
}

export type CratePlacement =
  | { readonly ok: true; readonly x: number; readonly y: number; readonly z: number }
  | { readonly ok: false; readonly reason: 'out-of-bounds' | 'no-ground' };

/**
 * Placement is validated BEFORE a charge is consumed (the Rule-5 shape
 * `validateSentryPlacement` pins): a blocked anchor leaves the earned streak
 * retryable, exactly, with the same claim.
 */
export function validateCratePlacement(x: number, z: number, world: WorldQuery): CratePlacement {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: 'out-of-bounds' };
  if (!world.inBounds(x, z)) return { ok: false, reason: 'out-of-bounds' };
  const y = world.groundY(x, z);
  if (!Number.isFinite(y)) return { ok: false, reason: 'no-ground' };
  return { ok: true, x, y, z };
}

export function createSupplyCrate(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  anchor: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
  catalog: StreakCatalog<string>,
): SupplyCrateState {
  const s = seed >>> 0;
  const rollUnit = catalog.rewardPool.totalUnits > 0 ? s % catalog.rewardPool.totalUnits : 0;
  return Object.freeze({
    kind: 'supply-crate' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    elapsedMs: 0,
    durationMs: Math.max(0, durationMs),
    x: anchor.x,
    y: anchor.y,
    z: anchor.z,
    seed: s,
    reward: rewardForUnit(catalog, rollUnit),
    rollUnit,
    captureActorId: null,
    captureProgressMs: 0,
    landed: false,
    opened: false,
  });
}

/**
 * Deterministic roll exposure for tests and hosts: the SAME seed, ordinal and
 * id always produce the same reward, because the roll is `seed % totalUnits`
 * through the catalog's own projection — never a second weight table here.
 */
export function crateRewardForSeed(seed: number, catalog: StreakCatalog<string>): { reward: string; rollUnit: number } {
  const rollUnit = (seed >>> 0) % catalog.rewardPool.totalUnits;
  return { reward: rewardForUnit(catalog, rollUnit), rollUnit };
}

/**
 * Bank caps for a granted charge, as pure data so the RUNTIME stays the only
 * ledger writer. Mirrors the elimination path's backpressure exactly
 * (`MAX_BANKED_STREAKS` distinct ids, `MAX_CHARGES_PER_STREAK` per id).
 */
export function crateGrantFits(
  charges: ReadonlyMap<string, number>,
  rewardId: string,
  maxBanked: number,
  maxCharges: number,
): boolean {
  const held = charges.get(rewardId) ?? 0;
  if (held >= maxCharges) return false;
  return held > 0 || charges.size < maxBanked;
}

/**
 * The two admission events, BUILT here but only after the runtime has applied
 * the grant — an event that names a reward the bank never took is the empty
 * successful activation this slice refuses to ship. `slot: 0` on the earned
 * event means "granted, not on a key": the reward may be reward-only or off
 * the collector's loadout, so no slot number would be honest.
 */
export function crateEarnedEvent(
  collector: { readonly actorId: ActorId; readonly team: TeamId },
  reward: string,
  charges: number,
  now: number,
): GameEvent {
  return Object.freeze({ type: 'streak-earned', at: now, actorId: collector.actorId, team: collector.team, streakId: reward, slot: 0, charges });
}

export function crateOpenedEvent(
  instanceId: number,
  crate: SupplyCrateState,
  collector: { readonly actorId: ActorId; readonly team: TeamId },
  now: number,
): GameEvent {
  return Object.freeze({
    type: 'crate-opened',
    at: now,
    instanceId,
    actorId: crate.actorId,
    team: crate.team,
    streakId: crate.streakId,
    collectorId: collector.actorId,
    collectorTeam: collector.team,
    reward: crate.reward,
    rollUnit: crate.rollUnit,
    contested: collector.team !== crate.team,
  });
}

/** Nearest eligible holder: alive, inside the radius, with sight to the crate. Distance first, then id — deterministic under ties. */
function captureCandidate(state: SupplyCrateState, ctx: CrateTickContext): SentryTarget | null {
  const crate = { x: state.x, y: state.y, z: state.z };
  let best: SentryTarget | null = null;
  let bestD = 0;
  for (const t of ctx.targets) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - crate.x, t.y - crate.y, t.z - crate.z);
    if (d > CRATE_PICKUP_RADIUS_M) continue;
    if (!ctx.world.lineOfSight({ x: t.x, y: t.y, z: t.z }, crate)) continue;
    if (best === null || d < bestD || (d === bestD && t.id < best.id)) { best = t; bestD = d; }
  }
  return best;
}

export function stepSupplyCrate(state: SupplyCrateState, dt: number, ctx: CrateTickContext): CrateTick {
  const step = dt > 0 ? dt : 0;
  const elapsedMs = state.elapsedMs + step;
  const remainingMs = state.remainingMs - step;
  const events: GameEvent[] = [];
  let landed = state.landed;
  // The landing is announced on the FIRST stepped tick, once, like the
  // mortar's telegraph. Gated on step > 0 so a zero-dt probe stays silent.
  if (!landed && step > 0) {
    landed = true;
    events.push(Object.freeze({
      type: 'crate-landed',
      at: ctx.now,
      instanceId: state.instanceId,
      actorId: state.actorId,
      team: state.team,
      streakId: state.streakId,
      x: state.x,
      y: state.y,
      z: state.z,
      radius: CRATE_PICKUP_RADIUS_M,
      expiresAt: ctx.now + Math.max(0, remainingMs),
    }) as CrateLandedEvent);
  }
  let captureActorId = state.captureActorId;
  let captureProgressMs = state.captureProgressMs;
  let opened = state.opened;
  if (opened) {
    // An opened crate the runtime could not yet grant (full bank) stays
    // claimable, but only while its holder is still holding: walking away
    // re-opens the capture and the countdown keeps running toward expiry.
    const candidate = captureCandidate(state, ctx);
    if (candidate === null || candidate.id !== state.captureActorId) {
      opened = false;
      captureActorId = null;
      captureProgressMs = 0;
    }
  } else {
    const candidate = captureCandidate(state, ctx);
    if (candidate === null) {
      captureActorId = null;
      captureProgressMs = 0;
    } else if (candidate.id !== captureActorId) {
      captureActorId = candidate.id;
      captureProgressMs = step;
    } else {
      captureProgressMs += step;
    }
    const requiredMs = candidate !== null && candidate.team !== state.team ? CRATE_CAPTURE_ENEMY_MS : CRATE_CAPTURE_OWN_MS;
    if (candidate !== null && captureProgressMs >= requiredMs) opened = true;
  }
  // `remainingMs` KEEPS COUNTING while a hold is open or completed: an opened
  // crate the bank could not take yet is still a live box, and an unclaimed
  // one expires honestly as `expired`. The runtime retires `collected` only
  // through its own grant admission.
  return {
    state: Object.freeze({ ...state, remainingMs, elapsedMs, captureActorId, captureProgressMs, landed, opened }),
    events,
  };
}
