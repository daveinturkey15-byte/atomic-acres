/**
 * Nuketown 2025 — the ORDNANCE half of the vocabulary: grenades, smoke,
 * flash, the knife, death drops and pickups.
 *
 * ADDITIVE to `events.ts`, and a sibling file for the same reason `vocab.ts`
 * is: the event union plus these fourteen shapes passed the AGENTS.md 400-line
 * cap. `events.ts` re-exports everything here and folds `OrdnanceEvent` into
 * `GameEvent`, so the import target is still `./events` and nothing downstream
 * knows the vocabulary is three files.
 *
 * A LEAF. Imports its own primitives from `./vocab` and nothing else — no
 * `weapons/`, no `loadout.ts`, no THREE. That is why `grenadeId` and
 * `weaponId` are plain strings here: the authored grenade table lives in
 * `game/ordnance.ts` and the weapon table in `weapons/catalog.ts`, and a leaf
 * cannot import either without ceasing to be one. The host validates ids
 * against the authored lists at the claim boundary; the event carries what
 * was validated.
 *
 * Two rules from `events.ts` apply unchanged:
 *  - nothing derivable is a field (no `fatal`, no `friendly`, no label),
 *  - every refusal is enumerated and labelled (`ORDNANCE_REJECT_LABELS`).
 *
 * ## THE SMOKE CONTRACT
 *
 * `SmokeVolumeEvent` / `SmokeVolumeEndEvent` are the whole interface between
 * gameplay and whatever renders smoke. The atmosphere lane draws real
 * volumetric fog from these two events and nothing else; the placeholder in
 * `weapons/grenades.ts` reads the same two events. Swapping one renderer for
 * the other touches no gameplay file. Documented again in `src/game/README.md`.
 */

import type { ActorId, TeamId } from './vocab';

// ---------------------------------------------------------------------------
// Frozen enumerations — authored once, types derived
// ---------------------------------------------------------------------------

/** Where a smoke volume came from. A `blast` puff is a tenth of a grenade's. */
export const SMOKE_KINDS = ['grenade', 'blast'] as const;
export type SmokeKind = (typeof SMOKE_KINDS)[number];

/** Walk-over ammo/grenade top-up vs the held-key weapon swap. */
export const PICKUP_KINDS = ['scavenge', 'swap'] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];

/** Why a drop left the ground. */
export const DROP_END_REASONS = ['expired', 'culled', 'match-end'] as const;
export type DropEndReason = (typeof DROP_END_REASONS)[number];

/** The player-initiated ordnance actions a refusal can name. */
export const ORDNANCE_ACTIONS = ['arm', 'throw', 'melee', 'pickup'] as const;
export type OrdnanceAction = (typeof ORDNANCE_ACTIONS)[number];

/**
 * Refusals specific to ordnance. A claim that fails the SHARED admission
 * (exactly-once window, life epoch, fire-age, muzzle) is refused with a
 * `ShotRejectReason` on a `shot-rejected` event exactly as a bullet is; these
 * are only the reasons a bullet cannot have.
 */
export const ORDNANCE_REJECT_REASONS = [
  'no-grenade',
  'already-armed',
  'melee-cooldown',
  'no-drop',
  'too-far',
  'drop-empty',
] as const;
export type OrdnanceRejectReason = (typeof ORDNANCE_REJECT_REASONS)[number];

export const ORDNANCE_REJECT_LABELS: Readonly<Record<OrdnanceRejectReason, string>> = Object.freeze({
  'no-grenade': 'NO GRENADE LEFT',
  'already-armed': 'THROW WHAT YOU ARE HOLDING FIRST',
  'melee-cooldown': 'KNIFE RECOVERING',
  'no-drop': 'NOTHING TO PICK UP',
  'too-far': 'TOO FAR FROM THE WEAPON',
  'drop-empty': 'THAT WEAPON IS EMPTY',
});

// ---------------------------------------------------------------------------
// Grenades
// ---------------------------------------------------------------------------

/** Pin pulled. For a cooked grenade the fuse is already running (`detonatesAt`). */
export interface GrenadeArmedEvent {
  readonly type: 'grenade-armed';
  readonly at: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly grenadeId: string;
  /** null when the fuse only starts at release (flash, smoke). */
  readonly detonatesAt: number | null;
}

/**
 * Released. Carries the LAUNCH STATE, not a trajectory: presentation replays
 * the same pure stepper (`game/ordnance-physics.ts`) against the same
 * `WorldQuery`, and the detonation event snaps it to the authoritative point.
 */
export interface GrenadeThrownEvent {
  readonly type: 'grenade-thrown';
  readonly at: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly grenadeId: string;
  /** Host-assigned handle for this live grenade. */
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly detonatesAt: number;
}

/** Went off. The damage it did is a `DamageEvent` per victim with cause `explosion`. */
export interface GrenadeDetonatedEvent {
  readonly type: 'grenade-detonated';
  readonly at: number;
  /** null when the thrower has left the match. */
  readonly actorId: ActorId | null;
  readonly team: TeamId | null;
  readonly grenadeId: string;
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Actors that took blast damage. */
  readonly victims: number;
}

/** Someone was flashed. `durationMs` is the white-out AND the bot's blindness. */
export interface FlashHitEvent {
  readonly type: 'flash-hit';
  readonly at: number;
  readonly victimId: ActorId;
  readonly sourceId: ActorId | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 0..1 — facing and distance folded in. */
  readonly intensity: number;
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Smoke — THE CONTRACT
// ---------------------------------------------------------------------------

export interface SmokeVolumeEvent {
  readonly type: 'smoke-volume';
  readonly at: number;
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Metres. The volume is a sphere; it fills to this over ~1.5 s. */
  readonly radius: number;
  readonly bornAt: number;
  /** Host time it is gone. It dissolves over the last 5 s. */
  readonly diesAt: number;
  readonly kind: SmokeKind;
}

export interface SmokeVolumeEndEvent {
  readonly type: 'smoke-volume-end';
  readonly at: number;
  readonly id: number;
}

// ---------------------------------------------------------------------------
// Knife
// ---------------------------------------------------------------------------

/** A swing. A landed one is also a `DamageEvent` with cause `melee`. */
export interface MeleeEvent {
  readonly type: 'melee';
  readonly at: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly victimId: ActorId | null;
}

// ---------------------------------------------------------------------------
// Death drops and pickups
// ---------------------------------------------------------------------------

export interface DropSpawnedEvent {
  readonly type: 'drop-spawned';
  readonly at: number;
  readonly id: number;
  readonly ownerId: ActorId;
  readonly weaponId: string;
  /** Rounds left in it, magazine and reserve together. */
  readonly rounds: number;
  /** Grenade pouches still on it; a scavenge takes one. */
  readonly grenades: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly diesAt: number;
}

/** A drop's contents changed: scavenged, or holding the gun a swapper left. */
export interface DropChangedEvent {
  readonly type: 'drop-changed';
  readonly at: number;
  readonly id: number;
  readonly weaponId: string;
  readonly rounds: number;
  readonly grenades: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly diesAt: number;
}

export interface DropRemovedEvent {
  readonly type: 'drop-removed';
  readonly at: number;
  readonly id: number;
  readonly reason: DropEndReason;
}

export interface PickupEvent {
  readonly type: 'pickup';
  readonly at: number;
  readonly actorId: ActorId;
  readonly dropId: number;
  readonly kind: PickupKind;
  /** The weapon the actor now holds (`swap`) or was topped up for (`scavenge`). */
  readonly weaponId: string;
  readonly rounds: number;
  /** Grenade charges granted. */
  readonly grenades: number;
  /** `swap` only: the gun left in the drop. */
  readonly leftWeaponId: string | null;
}

/** An actor's ordnance ledger, whenever it moves. The HUD renders this level. */
export interface OrdnanceInventoryEvent {
  readonly type: 'ordnance-inventory';
  readonly at: number;
  readonly actorId: ActorId;
  readonly lethal: number;
  readonly tactical: number;
  readonly primaryId: string | null;
  readonly rounds: number;
  /** The grenade in hand, pin pulled; null otherwise. */
  readonly armed: string | null;
}

/** An ordnance action refused. Label is `ORDNANCE_REJECT_LABELS[reason]`. */
export interface OrdnanceRejectedEvent {
  readonly type: 'ordnance-rejected';
  readonly at: number;
  readonly actorId: ActorId;
  readonly seq: number;
  readonly action: OrdnanceAction;
  readonly reason: OrdnanceRejectReason;
}

export type OrdnanceEvent =
  | GrenadeArmedEvent
  | GrenadeThrownEvent
  | GrenadeDetonatedEvent
  | FlashHitEvent
  | SmokeVolumeEvent
  | SmokeVolumeEndEvent
  | MeleeEvent
  | DropSpawnedEvent
  | DropChangedEvent
  | DropRemovedEvent
  | PickupEvent
  | OrdnanceInventoryEvent
  | OrdnanceRejectedEvent;

/** Every ordnance discriminant, frozen. `events.ts` spreads it into the full list. */
export const ORDNANCE_EVENT_TYPES = [
  'grenade-armed',
  'grenade-thrown',
  'grenade-detonated',
  'flash-hit',
  'smoke-volume',
  'smoke-volume-end',
  'melee',
  'drop-spawned',
  'drop-changed',
  'drop-removed',
  'pickup',
  'ordnance-inventory',
  'ordnance-rejected',
] as const;
export type OrdnanceEventType = (typeof ORDNANCE_EVENT_TYPES)[number];

export function isOrdnanceEventType(v: unknown): v is OrdnanceEventType {
  return typeof v === 'string' && (ORDNANCE_EVENT_TYPES as readonly string[]).includes(v);
}
