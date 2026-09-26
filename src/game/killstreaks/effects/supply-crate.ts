/**
 * Supply Crate: a landed, contestable reward box.
 *
 * The reward is rolled once from the catalog at activation.  Capture is
 * host-admitted from the actor table: the owning team holds for 1.25 s and an
 * enemy steals for 2.5 s, provided the holder remains close and visible.  The
 * runtime performs the bank-cap admission; a full bank resets the hold so the
 * box remains claimable.
 */

import type { ActorId, GameEvent, TeamId, WorldQuery } from '../../events';
import { rewardForUnit, type StreakCatalog } from '../catalog';
import type { SentryTarget } from './sentry';

export const CRATE_PICKUP_RADIUS_M = 2.75;
export const CRATE_CAPTURE_OWN_MS = 1_250;
export const CRATE_CAPTURE_ENEMY_MS = 2_500;

export interface SupplyCrateState {
  readonly kind: 'supply-crate';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly elapsedMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly seed: number;
  readonly reward: string;
  readonly rollUnit: number;
  readonly captureActorId: ActorId | null;
  readonly captureProgressMs: number;
  /** Runtime consumes an opened state exactly once or resets it on a full bank. */
  readonly opened: boolean;
}

export interface SupplyCrateTickContext {
  readonly now: number;
  readonly world: WorldQuery;
  readonly targets: readonly SentryTarget[];
}

export interface SupplyCrateTick { readonly state: SupplyCrateState; readonly events: readonly GameEvent[] }

export type CratePlacement =
  | { readonly ok: true; readonly x: number; readonly y: number; readonly z: number }
  | { readonly ok: false; readonly reason: 'out-of-bounds' | 'no-ground' };

export function validateCratePlacement(x: number, z: number, world: WorldQuery): CratePlacement {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !world.inBounds(x, z)) return { ok: false, reason: 'out-of-bounds' };
  const y = world.groundY(x, z);
  return Number.isFinite(y) ? { ok: true, x, y, z } : { ok: false, reason: 'no-ground' };
}

export function createSupplyCrate(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
  catalog: StreakCatalog<string>,
): SupplyCrateState {
  const normalized = seed >>> 0;
  const rollUnit = normalized % catalog.rewardPool.totalUnits;
  return Object.freeze({
    kind: 'supply-crate' as const, instanceId, actorId, team, streakId,
    remainingMs: Math.max(0, durationMs), elapsedMs: 0,
    x: place.x, y: place.y, z: place.z, seed: normalized,
    reward: rewardForUnit(catalog, rollUnit), rollUnit,
    captureActorId: null, captureProgressMs: 0, opened: false,
  });
}

export function crateRewardForSeed(seed: number, catalog: StreakCatalog<string>): { reward: string; rollUnit: number } {
  const rollUnit = (seed >>> 0) % catalog.rewardPool.totalUnits;
  return { reward: rewardForUnit(catalog, rollUnit), rollUnit };
}

export function crateGrantFits(
  charges: ReadonlyMap<string, number>, rewardId: string, maxBanked: number, maxCharges: number,
): boolean {
  const held = charges.get(rewardId) ?? 0;
  return held < maxCharges && (held > 0 || charges.size < maxBanked);
}

function candidate(state: SupplyCrateState, ctx: SupplyCrateTickContext): SentryTarget | null {
  let best: SentryTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of ctx.targets) {
    if (!target.alive || target.health <= 0) continue;
    const distance = Math.hypot(target.x - state.x, target.y - state.y, target.z - state.z);
    if (distance > CRATE_PICKUP_RADIUS_M || !ctx.world.lineOfSight(
      { x: target.x, y: target.y, z: target.z }, { x: state.x, y: state.y, z: state.z },
    )) continue;
    if (distance < bestDistance || (distance === bestDistance && (best === null || target.id < best.id))) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

export function stepSupplyCrate(state: SupplyCrateState, dt: number, ctx: SupplyCrateTickContext): SupplyCrateTick {
  const step = dt > 0 ? dt : 0;
  const next = candidate(state, ctx);
  let captureActorId = state.captureActorId;
  let captureProgressMs = state.captureProgressMs;
  let opened = false;
  if (next === null) {
    captureActorId = null;
    captureProgressMs = 0;
  } else if (next.id !== captureActorId) {
    captureActorId = next.id;
    captureProgressMs = step;
  } else {
    captureProgressMs += step;
  }
  if (next !== null) {
    const required = next.team === state.team ? CRATE_CAPTURE_OWN_MS : CRATE_CAPTURE_ENEMY_MS;
    opened = captureProgressMs >= required;
  }
  return {
    state: Object.freeze({
      ...state, remainingMs: state.remainingMs - step, elapsedMs: state.elapsedMs + step,
      captureActorId, captureProgressMs, opened,
    }),
    events: [],
  };
}
