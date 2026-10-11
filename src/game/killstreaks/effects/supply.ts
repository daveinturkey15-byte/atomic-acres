/**
 * Nuketown 2025 — Supply Crate: a placed cache anyone alive can touch to open.
 *
 * The crate holds ONE bonus charge, fixed at creation from the OWNER's loadout
 * by the activation seed hash — never the crate itself, so a crate cannot
 * contain a crate (the recursion `catalog.ts:REWARD_SOURCE_ID` keeps out of
 * the reward pool). The first alive actor inside the touch ring opens it;
 * the runtime applies the +1 to the OPENER's bank, so a capped, full-banked
 * or ineligible opener leaves the crate for the next toucher and time keeps
 * decaying. An unopened crate simply expires. PURE: takes data, returns data
 * (§5.3) — the stepper never touches the ledger, it reports the touch and the
 * runtime in `runtime.ts` writes the charge down.
 */

import { REWARD_SOURCE_ID, STREAK_CATALOG } from '../catalog';
import type { ActorId, GameEvent, TeamId } from '../../events';
import type { SentryTarget } from './sentry';

// ---------------------------------------------------------------------------
// Tuning. FIRST VALUES for this project: the old project had no crate, so
// none of these has a before-value to carry. Each names what it was reasoned
// against, which is the reviewable thing until play moves it (§5.9).
// ---------------------------------------------------------------------------

/**
 * Touch radius, metres horizontal. Wider than the ammo-scavenge ring
 * (`pickups.ts:DROP_SCAVENGE_RANGE_M`, 1.05 m): a crate is opened, not
 * stepped over, so the ring must survive foot traffic without pixel hunting.
 */
export const SUPPLY_TOUCH_RANGE_M = 2.5;
/**
 * Vertical band, feet to feet. Mirrors `pickups.ts:DROP_SCAVENGE_VERTICAL_M`
 * (2.4 m) so a crate on the deck cannot be opened from under it — the same
 * feet-consistent semantics as the scavenge reach.
 */
export const SUPPLY_TOUCH_VERTICAL_M = 2.4;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface SupplyState {
  readonly kind: 'supply';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The one bonus charge this crate holds. Fixed at creation, never the crate itself. */
  readonly grantId: string;
  readonly seed: number;
}

export interface SupplyTickContext {
  readonly now: number;
  readonly targets: readonly SentryTarget[];
}

/** The touch the runtime must apply to the ledger. Data, not a write (§5.3). */
export interface SupplyGrant {
  readonly openerId: ActorId;
  readonly grantId: string;
}

export interface SupplyTick {
  readonly state: SupplyState;
  readonly events: readonly GameEvent[];
  /** Non-null exactly when a touch opened the crate this tick. */
  readonly grant: SupplyGrant | null;
}

// ---------------------------------------------------------------------------
// Determinism. One integer hash, no allocation, no Math.random: the same
// (seed, loadout) grants the same streak on every host and every replay.
// ---------------------------------------------------------------------------

function hash1(seed: number, salt: number): number {
  let h = (seed >>> 0) ^ Math.imul(salt >>> 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/**
 * What this crate may grant, in owner-loadout order: everything but the crate
 * itself. Exported so the proof can pin the pool without re-deriving it.
 */
export function supplyGrantPool(ownerLoadout: readonly string[]): readonly string[] {
  return Object.freeze(ownerLoadout.filter((id) => id !== REWARD_SOURCE_ID));
}

/**
 * Fallback when the owner loadout offers nothing grantable (only reachable
 * with a custom catalog — a legal loadout always carries other streaks):
 * the lowest-cost selectable non-crate id, ties on id so the answer is total.
 * Exported so the proof can pin it without re-deriving it.
 */
export function supplyFallbackGrantId(): string {
  let best: string | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const d of STREAK_CATALOG.definitions) {
    if (d.availability !== 'selectable' || d.id === REWARD_SOURCE_ID) continue;
    if (best === null || d.cost < bestCost || (d.cost === bestCost && d.id < best)) {
      best = d.id;
      bestCost = d.cost;
    }
  }
  if (best === null) throw new Error('supply crate needs one selectable non-crate streak');
  return best;
}

/** The one deterministic answer for a (seed, owner loadout) pair. */
export function supplyGrantFor(seed: number, ownerLoadout: readonly string[]): string {
  const pool = supplyGrantPool(ownerLoadout);
  if (pool.length === 0) return supplyFallbackGrantId();
  const pick = pool[hash1(seed >>> 0, 0x5eed) % pool.length];
  if (pick === undefined) throw new Error('supply grant pool rolled out of range');
  return pick;
}

export function createSupply(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
  ownerLoadout: readonly string[],
): SupplyState {
  return Object.freeze({
    kind: 'supply' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    x: place.x,
    y: place.y,
    z: place.z,
    grantId: supplyGrantFor(seed, ownerLoadout),
    seed: seed >>> 0,
  });
}

export function stepSupply(state: SupplyState, dt: number, ctx: SupplyTickContext): SupplyTick {
  const step = dt > 0 ? dt : 0;
  // First touch wins: nearest in the horizontal ring, ties on id (sentry
  // rule), so two hosts stepping the same state with the same actors open
  // for the same opener. An already-spent crate cannot be reopened.
  let opener: SentryTarget | null = null;
  let bestD = SUPPLY_TOUCH_RANGE_M;
  if (state.remainingMs > 0) {
    for (const t of ctx.targets) {
      if (!t.alive || t.health <= 0) continue;
      if (Math.abs(t.y - state.y) > SUPPLY_TOUCH_VERTICAL_M) continue;
      const dist = Math.hypot(t.x - state.x, t.z - state.z);
      if (dist > bestD) continue;
      if (opener !== null && !(dist < bestD || t.id < opener.id)) continue;
      opener = t;
      bestD = dist;
    }
  }
  if (opener !== null) {
    // Opened: remainingMs 0 is the retire signal (mortar rule — an effect
    // never ends itself). The runtime emits the `streak-earned` and retires
    // the crate; this tick itself carries nothing on the bus.
    return {
      state: Object.freeze({ ...state, remainingMs: 0 }),
      events: Object.freeze([]),
      grant: Object.freeze({ openerId: opener.id, grantId: state.grantId }),
    };
  }
  // Untouched: decay. Expiry emits nothing — the runtime retires the crate
  // with the standard `streak-ended`, and that is the whole sound it makes.
  return {
    state: Object.freeze({ ...state, remainingMs: state.remainingMs - step }),
    events: Object.freeze([]),
    grant: null,
  };
}
