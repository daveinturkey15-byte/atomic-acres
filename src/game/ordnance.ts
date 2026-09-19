/**
 * Nuketown 2025 — the authored ordnance table: three grenades, one knife, the
 * throw, and the death-drop rules. Numbers only, plus the pure functions that
 * turn them into damage and blindness. Nothing here mutates, emits or knows a
 * host.
 *
 * ONE authored list per content family (IMPORT-PLAN §5.5). The grenade IDS are
 * `game/loadout.ts:GRENADE_IDS` — that file declared them as labels before
 * anything threw one — and this table is asserted at load to cover exactly
 * that list, so a fourth id added in one place and not the other throws on
 * boot instead of shipping a kit that names a grenade nobody can throw.
 *
 * Every number names where it came from (§5.9). "Old" is the previous
 * project, whose values the owner played; a change is a balance request and
 * should replace the sentence beside the number.
 *
 * ## How a claim reaches this table
 *
 * A grenade throw, a knife swing and a pickup reach are all "an action at an
 * origin along a direction at a time" — exactly the shape of a shot claim.
 * They travel as a `ShotMsg` whose `weaponId` is one of `ORDNANCE_IDS`, pass
 * the SAME eight admission rules in `host-shot.ts` (exactly-once window, life
 * epoch, fire age, muzzle) and are routed by `GameHost.submitShot` to
 * `host-ordnance.ts` instead of the hit test. One claim shape, one window, one
 * set of refusals; the ordnance-specific ones are `ORDNANCE_REJECT_REASONS`.
 */

import { GRENADE_IDS, type GrenadeId } from './loadout';
import { MELEE_DAMAGE } from './damage';

export type { GrenadeId } from './loadout';

// ---------------------------------------------------------------------------
// Grenades
// ---------------------------------------------------------------------------

export type GrenadeSlot = 'lethal' | 'tactical';

export interface GrenadeDef {
  readonly id: GrenadeId;
  readonly name: string;
  readonly slot: GrenadeSlot;
  /** Fuse length. */
  readonly fuseMs: number;
  /** `arm`: the fuse runs from the pin pull (cookable). `release`: from the throw. */
  readonly fuseFrom: 'arm' | 'release';
  /** Goes off on its first world contact, whatever the fuse says. */
  readonly impact: boolean;
  /** Blast envelope: `fragDamageAt` is the curve; every grenade does a little. */
  readonly blastRadius: number;
  readonly blastMaxDamage: number;
  /** The smoke it leaves: radius in metres, lifetime in ms. */
  readonly smokeRadius: number;
  readonly smokeMs: number;
  /** Flash envelope, or null. */
  readonly flashRadius: number | null;
}

/**
 * The smoke grenade's volume. 5 m is a whole doorway-to-kerb on this map;
 * the old project's `SMOKE_VOLUME_RADIUS_M` was 4.2·√3 = 7.3 m on a map 2.8×
 * longer along the street. Lifetime is the owner's brief ("~20-30 s"); the old
 * project ran 10 s.
 */
export const SMOKE_RADIUS_M = 5.0;
export const SMOKE_LIFETIME_MS = 25_000;
/**
 * The puff any detonation leaves: ONE TENTH of a smoke grenade BY VOLUME
 * (radius ratio ∛0.1 = 0.464), gone in a fifth of the time. Owner: "any
 * grenade that goes off should ... leave a little bit of smoke, but the smoke
 * grenade should be five or ten x that".
 */
export const BLAST_SMOKE_RADIUS_M = +(SMOKE_RADIUS_M * 0.464).toFixed(2);
export const BLAST_SMOKE_LIFETIME_MS = SMOKE_LIFETIME_MS / 5;

export const GRENADES: readonly GrenadeDef[] = Object.freeze([
  {
    id: 'frag', name: 'Frag', slot: 'lethal',
    // Old legacy-main.ts `fuseMs = 2_300`; the cook runs from the pin pull.
    fuseMs: 2_300, fuseFrom: 'arm', impact: false,
    // Old `GRENADE_RADIUS = 16` / `GRENADE_MAX_DAMAGE = 230`, quadratic falloff.
    blastRadius: 16, blastMaxDamage: 230,
    smokeRadius: BLAST_SMOKE_RADIUS_M, smokeMs: BLAST_SMOKE_LIFETIME_MS,
    flashRadius: null,
  },
  {
    id: 'flash', name: 'Flashbang', slot: 'tactical',
    // Old runtime kind `impact-flash`: pops on first contact; 1.5 s is the
    // ceiling if it never touches anything.
    fuseMs: 1_500, fuseFrom: 'release', impact: true,
    // "Any grenade that goes off should do a little bit of damage": 15 at the
    // centre, gone at 2 m.
    blastRadius: 2, blastMaxDamage: 15,
    smokeRadius: BLAST_SMOKE_RADIUS_M * 0.5, smokeMs: BLAST_SMOKE_LIFETIME_MS * 0.6,
    // Old legacy-main.ts `maximumRadiusM: 14` at both flash sites.
    flashRadius: 14,
  },
  {
    id: 'smoke', name: 'Smoke', slot: 'tactical',
    fuseMs: 1_500, fuseFrom: 'release', impact: false,
    blastRadius: 2, blastMaxDamage: 15,
    smokeRadius: SMOKE_RADIUS_M, smokeMs: SMOKE_LIFETIME_MS,
    flashRadius: null,
  },
] as const);

/** id → definition. Derived. */
export const GRENADE_BY_ID: ReadonlyMap<string, GrenadeDef> = new Map(GRENADES.map((g) => [g.id, g]));

// Fail loud: the table and loadout.ts's id list must be the same set.
for (const id of GRENADE_IDS) {
  if (!GRENADE_BY_ID.has(id)) throw new Error('[ordnance] loadout.ts names grenade "' + id + '" and ordnance.ts does not define it');
}
for (const g of GRENADES) {
  if (!(GRENADE_IDS as readonly string[]).includes(g.id)) throw new Error('[ordnance] "' + g.id + '" is not in loadout.ts:GRENADE_IDS');
}

export function isGrenadeId(v: unknown): v is GrenadeId {
  return typeof v === 'string' && GRENADE_BY_ID.has(v);
}

/** The tactical ids, derived, for a client that lets the player choose one. */
export const TACTICAL_IDS: readonly GrenadeId[] = Object.freeze(GRENADES.filter((g) => g.slot === 'tactical').map((g) => g.id));
export const LETHAL_IDS: readonly GrenadeId[] = Object.freeze(GRENADES.filter((g) => g.slot === 'lethal').map((g) => g.id));

/** A life starts with one of each. Old `GRENADE_SPAWN_COUNT = 1`, `GRENADE_CARRY_CAP = 1`. */
export const LETHAL_PER_LIFE = 1;
export const TACTICAL_PER_LIFE = 1;

// ---------------------------------------------------------------------------
// The throw
// ---------------------------------------------------------------------------

/**
 * Release speed. Old `REMOTE_GRENADE_MAX_VELOCITY = 20` was the admission
 * ceiling; 18 under this world's gravity lands a 25° lob at ~12 m and a 45°
 * one at ~16 m, which covers the bots' 7–18 m window with a bounce.
 */
export const THROW_SPEED_MS = 18;
/** Added to the release velocity so a flat throw still arcs. */
export const THROW_LIFT_MS = 1.5;
/** Release point is this far ahead of the eye, so the mesh clears the camera. */
export const THROW_FORWARD_M = 0.35;

// ---------------------------------------------------------------------------
// Blast
// ---------------------------------------------------------------------------

/**
 * Old `gameplay.ts:grenadeDamage`: `max · (1 − d/R)²`, rounded. Quadratic, not
 * the linear envelope `damage.ts:blastDamage` ships for streaks — at 8 m the
 * linear curve on these numbers is 115 (lethal from across a yard), the
 * quadratic is 57. The owner played the quadratic. 2 m → 176, 12 m → 14,
 * 15 m → 1, 16 m → 0.
 */
export function fragDamageAt(distance: number, def: GrenadeDef): number {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
  if (d >= def.blastRadius) return 0;
  const n = 1 - d / def.blastRadius;
  return Math.round(def.blastMaxDamage * n * n);
}

/** Blast point is lifted off the surface so the ground itself never occludes it. */
export const BLAST_LIFT_M = 0.25;
/** Where on a body the blast and the flash are tested: the chest. */
export const BLAST_TARGET_Y = 0.95;

// ---------------------------------------------------------------------------
// Flash
// ---------------------------------------------------------------------------

/** Longest white-out. Old `calculateFlashExposure`: 220 + 2580 ms. */
export const FLASH_MAX_MS = 2_800;
/** Inside this the distance term is 1; it falls to `FLASH_EDGE_FRACTION` at the radius. */
export const FLASH_NEAR_M = 4;
export const FLASH_EDGE_FRACTION = 0.25;
/** Facing: full inside this half-angle ... */
export const FLASH_FULL_DEG = 30;
/** ... half from this angle round to directly behind. */
export const FLASH_BEHIND_DEG = 120;
export const FLASH_BEHIND_FRACTION = 0.5;
/** Eye height for the flash line-of-sight and facing test. `core/layout.ts:EYE_HEIGHT` is 1.68. */
export const FLASH_EYE_Y = 1.68;

export interface FlashExposure {
  /** 0..1 — the white-out's peak opacity and the bot's blindness weight. */
  readonly intensity: number;
  readonly durationMs: number;
}

const NO_FLASH: FlashExposure = Object.freeze({ intensity: 0, durationMs: 0 });

/**
 * Flash falloff by distance, facing and line of sight. `cosFacing` is the dot
 * of the victim's look direction with the unit vector from their eyes to the
 * flash: 1 = looking straight at it, −1 = directly away. Behind a wall is
 * nothing at all — old `solidOccluded` — because the whole point of a wall is
 * that it works.
 */
export function flashExposure(distance: number, cosFacing: number, hasLos: boolean, radius: number): FlashExposure {
  if (!hasLos || !(radius > 0) || !Number.isFinite(distance) || distance > radius) return NO_FLASH;
  const near = distance <= FLASH_NEAR_M
    ? 1
    : 1 - (1 - FLASH_EDGE_FRACTION) * Math.min(1, (distance - FLASH_NEAR_M) / Math.max(1e-6, radius - FLASH_NEAR_M));
  const deg = Math.acos(Math.max(-1, Math.min(1, cosFacing))) * 180 / Math.PI;
  const facing = deg <= FLASH_FULL_DEG
    ? 1
    : deg >= FLASH_BEHIND_DEG
      ? FLASH_BEHIND_FRACTION
      : 1 - (1 - FLASH_BEHIND_FRACTION) * (deg - FLASH_FULL_DEG) / (FLASH_BEHIND_DEG - FLASH_FULL_DEG);
  const intensity = near * facing;
  return { intensity, durationMs: Math.round(FLASH_MAX_MS * intensity) };
}

// ---------------------------------------------------------------------------
// Knife
// ---------------------------------------------------------------------------

export const KNIFE_ID = 'knife';
/** Reach. Owner's brief: 1.6 m. (Old `MELEE_RANGE = 1.75`, `meleeActionHitsPoint` 1.85.) */
export const KNIFE_REACH_M = 1.6;
/** Old `remote-melee-admission.ts:minimumFacingDot = 0.72` (~44° half-cone). */
export const KNIFE_FACING_DOT = 0.72;
/** Recovery between swings, host-enforced. Owner's brief: 0.8 s. (Old 650/500 ms.) */
export const KNIFE_RECOVERY_MS = 800;
/**
 * Always the full `damage.ts:MELEE_DAMAGE` (100): a knife is a one-hit kill
 * whoever holds it, so the bot handicap does not apply to it — a bot's blade
 * at 25 is a shove, not a knife.
 */
export const KNIFE_DAMAGE = MELEE_DAMAGE;

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

export const PICKUP_ID = 'pickup';

/** Every id `submitShot` routes to the ordnance path instead of the hit test. */
export const ORDNANCE_IDS: ReadonlySet<string> = new Set<string>([...GRENADE_IDS, KNIFE_ID, PICKUP_ID]);

export function isOrdnanceId(v: unknown): v is string {
  return typeof v === 'string' && ORDNANCE_IDS.has(v);
}
