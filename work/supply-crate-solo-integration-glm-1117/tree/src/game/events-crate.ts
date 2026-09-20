/**
 * Nuketown 2025 — the SUPPLY CRATE slice of the event vocabulary.
 *
 * A leaf, exactly like `events-crossbow.ts`: imports `vocab` only, no THREE,
 * no `net/`, no core, no DOM, and is folded into `GameEvent` by `events.ts`
 * WITHOUT entering `OrdnanceEvent`, so `ordnance-view.ts` stays untouched and
 * a future `CrateView` owns exactly these two shapes (the mortar precedent).
 *
 * Why NOT the existing `PickupEvent` (`events-ordnance.ts`): that shape is
 * weapon-shaped on purpose — `dropId` + `kind: 'scavenge' | 'swap'` +
 * `weaponId` + `rounds`. A crate pickup grants a ROLLED STREAK charge, which
 * that vocabulary cannot say without lying (`weaponId: ''`, `rounds: 0`, a
 * kind that means the opposite of what happened). Forcing it would be an
 * empty successful activation wearing another event's clothes. Guests never
 * author one; a guest claim naming these ids is data, never an instruction.
 */

import type { ActorId, TeamId } from './vocab';

/** Host admitted the crate into the world: draw the box NOW. */
export interface CrateLandedEvent {
  readonly type: 'crate-landed';
  readonly at: number;
  readonly instanceId: number;
  /** The actor whose activation dropped it. */
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Admission radius, metres — `CRATE_PICKUP_RADIUS_M` from the module. */
  readonly radius: number;
  /** Lifetime from admission, ms — the catalog row's `durationMs`. */
  readonly expiresAt: number;
  /**
   * The ROLLED REWARD IS NOT HERE, on purpose. The old project stores the
   * roll on the crate and never announces it before pickup; contents are
   * host-secret until a collector opens it.
   */
}

/** Host admitted a pickup: the rolled charge is already in the collector's bank. */
export interface CrateOpenedEvent {
  readonly type: 'crate-opened';
  readonly at: number;
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly collectorId: ActorId;
  readonly collectorTeam: TeamId;
  /** The rolled reward, granted as one banked charge beside this event. */
  readonly reward: string;
  /** The exact pool unit the reward rolled from — audit trail, `rewardForUnit`. */
  readonly rollUnit: number;
  /** True when the collector is not on the owner's team (the old theft hold). */
  readonly contested: boolean;
}

export type CrateEvent = CrateLandedEvent | CrateOpenedEvent;

export const CRATE_EVENT_TYPES = ['crate-landed', 'crate-opened'] as const;
