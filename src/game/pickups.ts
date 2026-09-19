/**
 * Nuketown 2025 — death drops: the pure rules.
 *
 * What a body leaves behind and who may take what from it. Every function
 * here takes data and returns data (IMPORT-PLAN §5.3); `host-ordnance.ts`
 * owns the list, calls these, and emits the events. Nothing here knows an
 * actor record, a bus or a mesh.
 *
 * Ported as RULES from the old `death-drops.ts` (269 lines) and NOT as its
 * shape: that file's consumer, `mp-pickup-authority.ts`, took a 16-field
 * context with 11 callbacks back into a 37k-line main — the exact thing §5.3
 * names as not-a-module. The numbers are its; the owner played them.
 */

import { WEAPONS, type WeaponDef } from '../weapons/catalog';

// ---------------------------------------------------------------------------
// Tuned numbers (§5.9) — old `death-drops.ts`, unchanged
// ---------------------------------------------------------------------------

/** `DEATH_DROP_LIFETIME_MS`. A swap refreshes it so the gun you left can be taken back. */
export const DROP_LIFETIME_MS = 30_000;
/** `MAX_DEATH_DROPS`. Past it the OLDEST is culled, never the newest refused. */
export const DROP_MAX_LIVE = 12;
/** `DEATH_DROP_INTERACTION_RANGE`: the held-key swap, a 3-D distance. */
export const DROP_SWAP_RANGE_M = 2.35;
/** `DEATH_DROP_SCAVENGE_HORIZONTAL_RANGE`: walking over it takes ammo. */
export const DROP_SCAVENGE_RANGE_M = 1.05;
/** `DEATH_DROP_SCAVENGE_VERTICAL_RANGE`: a drop on the deck is not under the deck. */
export const DROP_SCAVENGE_VERTICAL_M = 2.4;
/**
 * Beyond the swap range but inside this, a pickup press is refused `too-far`
 * rather than `no-drop`, so the player learns there IS something there.
 */
export const DROP_PROMPT_RANGE_M = 6;
/** Grenade pouches on a fresh drop. Old `replenishGrenadeFromCorpse`: one corpse, one grenade. */
export const DROP_GRENADE_POUCHES = 1;

const WEAPON_BY_ID: ReadonlyMap<string, WeaponDef> = new Map(WEAPONS.map((w) => [w.id, w]));

/** A weapon's whole issue, magazine plus reserve. The ceiling any drop can hold. */
export function fullRounds(weaponId: string): number {
  const w = WEAPON_BY_ID.get(weaponId);
  return w === undefined ? 0 : w.magSize + w.startReserve;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Drop {
  readonly id: number;
  readonly ownerId: string;
  weaponId: string;
  rounds: number;
  grenades: number;
  x: number; y: number; z: number;
  readonly bornAt: number;
  diesAt: number;
}

export function createDrop(
  id: number, ownerId: string, weaponId: string, rounds: number,
  x: number, y: number, z: number, now: number,
): Drop {
  const cap = fullRounds(weaponId);
  return {
    id, ownerId, weaponId,
    rounds: Math.max(0, Math.min(cap, Math.floor(Number.isFinite(rounds) ? rounds : 0))),
    grenades: DROP_GRENADE_POUCHES,
    x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, z: Number.isFinite(z) ? z : 0,
    bornAt: now, diesAt: now + DROP_LIFETIME_MS,
  };
}

export function dropExpired(d: Drop, now: number): boolean {
  return now >= d.diesAt;
}

/** Oldest first, for the cap. Ties by id so the order is total. */
export function oldestDrop(drops: readonly Drop[]): Drop | null {
  let best: Drop | null = null;
  for (const d of drops) {
    if (best === null || d.bornAt < best.bornAt || (d.bornAt === best.bornAt && d.id < best.id)) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------

/** Nearest drop within a 3-D range of a point. */
export function nearestDrop(drops: readonly Drop[], x: number, y: number, z: number, range: number): Drop | null {
  let best: Drop | null = null;
  let bestD = range;
  for (const d of drops) {
    const dist = Math.hypot(d.x - x, d.y - y, d.z - z);
    if (dist <= bestD) { best = d; bestD = dist; }
  }
  return best;
}

/** In scavenge reach: horizontal ring, vertical band. Feet position in, feet position stored. */
export function inScavengeReach(d: Drop, x: number, y: number, z: number): boolean {
  return Math.abs(d.y - y) <= DROP_SCAVENGE_VERTICAL_M && Math.hypot(d.x - x, d.z - z) <= DROP_SCAVENGE_RANGE_M;
}

// ---------------------------------------------------------------------------
// Taking
// ---------------------------------------------------------------------------

export interface Carry {
  readonly primaryId: string | null;
  readonly rounds: number;
  readonly lethal: number;
  readonly tactical: number;
}

export interface Taken {
  /** Rounds granted to the carrier. 0 when the weapons did not match or the drop was dry. */
  readonly rounds: number;
  /** Grenade charges granted: lethal first, then tactical, from one pouch. */
  readonly lethal: number;
  readonly tactical: number;
}

const NOTHING: Taken = Object.freeze({ rounds: 0, lethal: 0, tactical: 0 });

/**
 * The walk-over. Ammo only for a MATCHING weapon (owner's brief), capped at
 * the weapon's full issue; one pouch fills whichever grenade slots are empty.
 * Mutates the drop; returns what to add to the carrier. `NOTHING` means the
 * caller should emit nothing — a drop that has nothing for you is not an
 * event.
 */
export function scavenge(d: Drop, carry: Carry, lethalCap: number, tacticalCap: number): Taken {
  let rounds = 0;
  if (carry.primaryId !== null && d.weaponId === carry.primaryId && d.rounds > 0) {
    const room = Math.max(0, fullRounds(carry.primaryId) - carry.rounds);
    rounds = Math.min(room, d.rounds);
    d.rounds -= rounds;
  }
  let lethal = 0;
  let tactical = 0;
  if (d.grenades > 0) {
    lethal = Math.max(0, lethalCap - carry.lethal);
    tactical = Math.max(0, tacticalCap - carry.tactical);
    if (lethal > 0 || tactical > 0) d.grenades -= 1;
  }
  if (rounds === 0 && lethal === 0 && tactical === 0) return NOTHING;
  return { rounds, lethal, tactical };
}

export interface Swapped {
  /** What the carrier now holds. */
  readonly weaponId: string;
  readonly rounds: number;
  /** What went into the drop in its place. */
  readonly leftWeaponId: string;
}

/**
 * The held-key swap: the drop's gun for yours, IN PLACE. The old project's
 * owner requirement (HF-315a): the gun you swapped out goes INTO this drop
 * with its magazine and reserve, at your feet, with a fresh lifetime, so you
 * can swap straight back. Mutates the drop. `null` when the carrier has no
 * primary to leave — a swap that deletes a weapon from the world is a bug.
 */
export function swap(d: Drop, carry: Carry, feetX: number, feetY: number, feetZ: number, now: number): Swapped | null {
  if (carry.primaryId === null) return null;
  const taken: Swapped = { weaponId: d.weaponId, rounds: d.rounds, leftWeaponId: carry.primaryId };
  d.weaponId = carry.primaryId;
  d.rounds = Math.max(0, Math.min(fullRounds(carry.primaryId), Math.floor(carry.rounds)));
  d.x = feetX; d.y = feetY; d.z = feetZ;
  d.diesAt = now + DROP_LIFETIME_MS;
  return taken;
}
