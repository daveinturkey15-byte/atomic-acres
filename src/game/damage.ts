/**
 * Nuketown 2025 — damage resolution, and nothing else.
 *
 * `resolveDamage()` takes a description of a hit and returns a number and, if
 * the hit did not land, the reason. It **mutates nothing, emits nothing, and
 * knows no HUD**. That sentence is the whole design: the old project's
 * `legacy-main.ts:applyDamage()` (line 15186, ~100 lines) mutated health, applied
 * a handicap, recorded a diagnostic, released a care-package capture, pushed a
 * feed row, played audio, pulsed the gamepad, drew the damage direction, added
 * camera trauma, pushed a HUD impact, replayed a CSS flash, told the killstreak
 * runtime, broadcast a death, scheduled a respawn and exited pointer lock.
 * IMPORT-PLAN §5.2 keeps it as a warning. Each of those fifteen effects is a
 * subscriber to a `GameEvent` here; if this file ever imports `ui/` or `THREE`,
 * the rule has been broken.
 *
 * **One damage curve.** Range falloff is `weapons/catalog.ts:damageAt()`, the
 * curve the weapons lane already ships and the viewmodel already feels. This
 * file adds only what a weapon table cannot know: who was shooting, where they
 * hit, and whether the target was allowed to be hurt. A second falloff curve
 * here would be the stale mirror of IMPORT-PLAN §5.5.
 *
 * **Every refusal is named.** A blocked hit returns `blocked`, never a bare 0:
 * the caller has to be able to tell "you hit a team-mate" from "you missed"
 * (IMPORT-PLAN §5.4).
 */

import { damageAt, type WeaponDef } from '../weapons/catalog';
import type { DamageCause, HitZone, TeamId } from './events';
import { MAX_HEALTH } from './health';

// ---------------------------------------------------------------------------
// Tuned numbers, with their history (IMPORT-PLAN §5.9)
// ---------------------------------------------------------------------------
//
// Every value below is the one the old project shipped and the owner played.
// They are a starting band, not a conclusion: a change is a balance request and
// should replace the sentence beside the number, not just the number.

/** Old `HEADSHOT_DAMAGE_MULTIPLIER = 1.5`. */
export const HEADSHOT_MULTIPLIER = 1.5;

/** Old `SNIPER_HEADSHOT_DAMAGE_MULTIPLIER = 3` — a scoped headshot always kills. */
export const SNIPER_HEADSHOT_MULTIPLIER = 3;

/**
 * Limbs take full damage. BO2's Nuketown-era assault rifles and SMGs have no
 * extremity penalty, and `vocab.ts` says the `limb` zone "exists so a damage
 * table can down-weight it later" — this is that hook, deliberately at 1 so
 * nobody has to guess whether a 0.9 they found was measured or invented.
 */
export const LIMB_MULTIPLIER = 1;

/**
 * Bots deal a quarter of a player's damage. Old `BOT_DAMAGE_MULTIPLIER = 0.25`,
 * halved from the Pass 30 value of 0.5 because a full-damage bot on a map this
 * tight kills before a player can react to being shot at.
 */
export const BOT_DAMAGE_MULTIPLIER = 0.25;

/**
 * A landed hit always does at least this much. Old `admittedPlayerDamage(d,
 * min = 1)`. It is why `zero-hit-feedback.ts` (157 lines, a whole HUD surface
 * for "your hit did nothing") is REFERENCE-ONLY here: if we ever need it we
 * have a bug, not a missing feature (IMPORT-PLAN §1.4).
 */
export const MIN_LANDED_DAMAGE = 1;

/** Fall damage starts here. Old `FALL_DAMAGE_SAFE_SPEED = 9.5` m/s. */
export const FALL_SAFE_SPEED = 9.5;
/** Fall damage saturates here. Old `FALL_DAMAGE_LETHAL_SPEED = 22` m/s. */
export const FALL_LETHAL_SPEED = 22;
/**
 * Old `FALL_DAMAGE_MULTIPLIER = 0.5` (Pass 72 halved the envelope) with the
 * curve `100 * t^1.35 * 0.5`. So terminal is 50, not 100: the map's roofs and
 * decks are meant to hurt, not to be a second way to die.
 */
export const FALL_DAMAGE_SCALE = 0.5;
export const FALL_DAMAGE_EXPONENT = 1.35;

/** Old `MELEE_DAMAGE = 100` — one hit, always fatal from full health. */
export const MELEE_DAMAGE = 100;
/** Old `MELEE_RANGE = 1.75` m. */
export const MELEE_RANGE_M = 1.75;
/** Old `MELEE_COOLDOWN_MS = 650`. Enforced by the host, stated here with its pair. */
export const MELEE_COOLDOWN_MS = 650;

/** Old `GRENADE_RADIUS = 16` m and `GRENADE_MAX_DAMAGE = 230` at the centre. */
export const BLAST_RADIUS_M = 16;
export const BLAST_MAX_DAMAGE = 230;

/**
 * A weapon counts as scoped — and so earns `SNIPER_HEADSHOT_MULTIPLIER` —
 * when its aimed FOV is this narrow or narrower.
 *
 * DERIVED, not an id list. `catalog.ts` has no weapon-class field, so the
 * alternative was a second roster of "which guns are snipers", which goes stale
 * the moment a sixth weapon lands (IMPORT-PLAN §5.5). Today the catalog reads
 * 24° (Deadeye) then 55°/58°/58°/60°, so any threshold in that gap picks out the
 * same one weapon; 40 is the middle of it. A future scoped rifle gets the
 * multiplier by being scoped, which is the intent.
 */
export const SNIPER_OPTIC_FOV_MAX = 40;

// ---------------------------------------------------------------------------
// Derivations over the weapon catalog
// ---------------------------------------------------------------------------

/** True for a scoped weapon. See `SNIPER_OPTIC_FOV_MAX` for why this is a threshold. */
export function isScoped(def: WeaponDef): boolean {
  return def.adsFov <= SNIPER_OPTIC_FOV_MAX;
}

/** The zone multiplier this weapon applies. Head depends on the optic; limb does not. */
export function zoneMultiplier(def: WeaponDef, zone: HitZone): number {
  if (zone === 'head') return isScoped(def) ? SNIPER_HEADSHOT_MULTIPLIER : HEADSHOT_MULTIPLIER;
  if (zone === 'limb') return LIMB_MULTIPLIER;
  return 1;
}

/**
 * Clamp a raw number into the admitted band: at least `MIN_LANDED_DAMAGE`,
 * never more than a full-health player. Old `admittedPlayerDamage`.
 */
export function admitted(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_LANDED_DAMAGE;
  return Math.min(MAX_HEALTH, Math.max(MIN_LANDED_DAMAGE, raw));
}

/**
 * Landing damage from vertical impact speed, in m/s. Below the safe speed it is
 * exactly zero — a fall that does 1 damage would still break a regen window,
 * which is why this is the one path that may return 0 without being "blocked".
 */
export function fallDamage(impactSpeedMs: number): number {
  const speed = Number.isFinite(impactSpeedMs) ? Math.max(0, impactSpeedMs) : 0;
  if (speed <= FALL_SAFE_SPEED) return 0;
  if (speed >= FALL_LETHAL_SPEED) return Math.round(MAX_HEALTH * FALL_DAMAGE_SCALE);
  const t = (speed - FALL_SAFE_SPEED) / (FALL_LETHAL_SPEED - FALL_SAFE_SPEED);
  return Math.max(1, Math.round(MAX_HEALTH * Math.pow(t, FALL_DAMAGE_EXPONENT) * FALL_DAMAGE_SCALE));
}

/**
 * Blast damage at a distance from the centre. Linear to zero at the radius,
 * which is the old project's envelope; beyond the radius it is 0 and the caller
 * gets `out-of-range` rather than a 1-damage tickle from across the map.
 */
export function blastDamage(distance: number, maxDamage = BLAST_MAX_DAMAGE, radius = BLAST_RADIUS_M): number {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
  if (!(radius > 0) || d >= radius) return 0;
  return maxDamage * (1 - d / radius);
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

/** Why a hit did not land. Each one is a distinct sentence a player can be told. */
export type DamageBlock = 'friendly' | 'invulnerable' | 'out-of-range';

export interface DamageInput {
  /** The firing weapon. Range falloff is `damageAt(def, distance)` and nothing else. */
  readonly def: WeaponDef;
  /** Metres from muzzle to hit, or from blast centre to victim for `explosion`. */
  readonly distance: number;
  readonly zone: HitZone;
  /** null for world damage: a fall, an unowned blast. */
  readonly attackerTeam: TeamId | null;
  readonly victimTeam: TeamId;
  /** `health.ts:ActorHealth.invulnerableUntil`. */
  readonly victimInvulnUntil: number;
  readonly now: number;
  /** Defaults to `'bullet'`. */
  readonly cause?: DamageCause;
  /** From `MatchRules.friendlyFire`. Off in both shipped modes. */
  readonly friendlyFire?: boolean;
  /** Applies `BOT_DAMAGE_MULTIPLIER`. */
  readonly attackerIsBot?: boolean;
  /** Required by `cause: 'fall'`; ignored otherwise. Vertical impact speed, m/s. */
  readonly impactSpeed?: number;
  /** Optional blast envelope for `cause: 'explosion'` / `'streak'`. */
  readonly blastMaxDamage?: number;
  readonly blastRadius?: number;
}

export interface DamageResult {
  /** Admitted damage. Always 0 when `blocked` is set, never 0 otherwise except a soft fall. */
  readonly damage: number;
  /** Absent when the hit landed. */
  readonly blocked?: DamageBlock;
}

const NO_DAMAGE_FRIENDLY: DamageResult = Object.freeze({ damage: 0, blocked: 'friendly' as const });
const NO_DAMAGE_INVULN: DamageResult = Object.freeze({ damage: 0, blocked: 'invulnerable' as const });
const NO_DAMAGE_RANGE: DamageResult = Object.freeze({ damage: 0, blocked: 'out-of-range' as const });

/**
 * Resolve one hit.
 *
 * Precedence is fixed and is the order below, because the reason a player is
 * shown must be the first true one rather than whichever branch happened to run:
 *
 *  1. `invulnerable` — the spawn-protection window is open. Checked first so a
 *     protected player is protected from a team-mate's grenade too, and so the
 *     reason never depends on who fired.
 *  2. `friendly` — same team and friendly fire off. World damage
 *     (`attackerTeam === null`) is never friendly; a fall is nobody's fault.
 *  3. `out-of-range` — only causes with a hard reach can say this: melee past
 *     `MELEE_RANGE_M`, a blast past its radius. A bullet has no hard range in a
 *     hitscan model — `damageAt` floors at the weapon's far-range damage — so a
 *     long shot is weak, not refused.
 *
 * Then the amount: the cause's base, times the zone, times the bot scalar,
 * clamped into `[MIN_LANDED_DAMAGE, MAX_HEALTH]`.
 */
export function resolveDamage(input: DamageInput): DamageResult {
  const cause: DamageCause = input.cause ?? 'bullet';

  if (input.now < input.victimInvulnUntil) return NO_DAMAGE_INVULN;

  if (
    input.attackerTeam !== null &&
    input.attackerTeam === input.victimTeam &&
    input.friendlyFire !== true
  ) {
    return NO_DAMAGE_FRIENDLY;
  }

  const distance = Number.isFinite(input.distance) ? Math.max(0, input.distance) : Infinity;

  let base: number;
  switch (cause) {
    case 'fall': {
      // The one path allowed to return a landed 0: a survivable drop.
      const amount = fallDamage(input.impactSpeed ?? 0);
      return { damage: amount === 0 ? 0 : admitted(amount) };
    }
    case 'melee': {
      if (distance > MELEE_RANGE_M) return NO_DAMAGE_RANGE;
      base = MELEE_DAMAGE;
      break;
    }
    case 'explosion':
    case 'streak': {
      const radius = input.blastRadius ?? BLAST_RADIUS_M;
      if (distance >= radius) return NO_DAMAGE_RANGE;
      base = blastDamage(distance, input.blastMaxDamage ?? BLAST_MAX_DAMAGE, radius);
      break;
    }
    case 'bullet':
    default: {
      base = damageAt(input.def, distance);
      break;
    }
  }

  // Zone applies to aimed fire only. A blast and a fall do not care where they
  // caught you, and a melee is scripted — giving any of them a headshot
  // multiplier would make the zone a lottery on a ragdoll's pose.
  const zoned = cause === 'bullet' ? base * zoneMultiplier(input.def, input.zone) : base;
  const scaled = input.attackerIsBot === true ? zoned * BOT_DAMAGE_MULTIPLIER : zoned;

  return { damage: admitted(scaled) };
}
