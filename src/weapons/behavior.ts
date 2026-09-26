/**
 * Authoritative behavior vocabulary for the designed weapon roster.
 *
 * `catalog.ts` owns cadence, ammo and damage bands. This file owns the
 * delivery shape that a host must admit: ordinary guns are hitscan, while the
 * four exotic rows keep an explicit special mechanic until their host seams
 * are promoted. Keeping this axis separate prevents a new exotic from being
 * accidentally treated as a rifle just because it has a damage curve.
 *
 * The profiles are intentionally THREE-free and allocation-free on the query
 * path. They are shared by host integration, browser QA and menu projections.
 */

import { WEAPONS } from './catalog';

export type WeaponBehaviorKind = 'hitscan' | 'piercing' | 'projectile' | 'cone';

export interface WeaponBehaviorProfile {
  readonly kind: WeaponBehaviorKind;
  /** Maximum world reach for special delivery, in metres. */
  readonly range?: number;
  /** Maximum opaque surfaces a piercing shot may cross. */
  readonly maxPenetrations?: number;
  /** Fraction of energy retained after each accepted surface. */
  readonly surfaceRetention?: number;
  /** Projectile launch speed, in metres per second. */
  readonly speed?: number;
  /** Projectile acceleration due to gravity, in metres per second squared. */
  readonly gravity?: number;
  /** Projectile lifetime, in seconds. */
  readonly lifetime?: number;
  /** Flame cone half-angle, in radians. */
  readonly halfAngle?: number;
  /** Flame tick cadence, in seconds. */
  readonly tickInterval?: number;
  /** Burn continuation after the last cone tick, in seconds. */
  readonly burnDuration?: number;
}

const DEG = Math.PI / 180;

/**
 * Four rows deliberately describe delivery mechanics that are not plain
 * bullets. They remain roster prototypes in `roster.ts` until the parent
 * integrates their host/network paths. Values are authored against this
 * restart's catalog rows and `crossbow-runtime.ts`, not copied from the old
 * project.
 */
export const SPECIAL_WEAPON_BEHAVIORS: Readonly<Record<string, WeaponBehaviorProfile>> = Object.freeze({
  railgun: Object.freeze({
    kind: 'piercing', range: 120, maxPenetrations: 2, surfaceRetention: 0.62,
  }),
  'explosive-crossbow': Object.freeze({
    kind: 'projectile', range: 90, speed: 60, gravity: 9.81, lifetime: 2.5,
  }),
  flamethrower: Object.freeze({
    kind: 'cone', range: 17, halfAngle: 5 * DEG, tickInterval: 0.045, burnDuration: 1.25,
  }),
  'flare-gun': Object.freeze({
    kind: 'projectile', range: 60, speed: 24, gravity: 9.81, lifetime: 2.0,
  }),
});

const SPECIAL_IDS = new Set(Object.keys(SPECIAL_WEAPON_BEHAVIORS));

const HITSCAN: WeaponBehaviorProfile = Object.freeze({ kind: 'hitscan' });

/** Return the explicit delivery profile for a catalog weapon id. */
export function behaviorFor(id: string): WeaponBehaviorProfile {
  const special = SPECIAL_WEAPON_BEHAVIORS[id];
  if (special !== undefined) return special;
  const known = WEAPONS.some((w) => w.id === id);
  if (!known) throw new Error(`weapon behavior: unknown catalog id '${id}'`);
  return HITSCAN;
}

/** True only for the ordinary one-ray-per-pellet delivery path. */
export function isHitscanBehavior(id: string): boolean {
  return behaviorFor(id).kind === 'hitscan';
}

/**
 * Test a target against a flame cone without allocating vectors. `direction`
 * is expected to be unit length; callers that own an untrusted wire vector
 * should normalize and validate it before reaching this query.
 */
export function insideCone(
  originX: number, originY: number, originZ: number,
  directionX: number, directionY: number, directionZ: number,
  targetX: number, targetY: number, targetZ: number,
  profile: WeaponBehaviorProfile = SPECIAL_WEAPON_BEHAVIORS.flamethrower,
): boolean {
  if (profile.kind !== 'cone' || profile.range === undefined || profile.halfAngle === undefined) return false;
  const dx = targetX - originX;
  const dy = targetY - originY;
  const dz = targetZ - originZ;
  const distSq = dx * dx + dy * dy + dz * dz;
  if (!(distSq <= profile.range * profile.range)) return false;
  if (distSq <= 1e-12) return true;
  const invDist = 1 / Math.sqrt(distSq);
  const dot = (dx * directionX + dy * directionY + dz * directionZ) * invDist;
  return dot >= Math.cos(profile.halfAngle);
}

/** Linear falloff for a cone tick. Out of range returns zero. */
export function coneDamageAt(distance: number, nearDamage: number, farDamage: number, range: number): number {
  if (!Number.isFinite(distance) || distance < 0 || distance >= range) return 0;
  if (distance <= 0) return nearDamage;
  const t = distance / range;
  return nearDamage + (farDamage - nearDamage) * t;
}

export interface RailgunSurface {
  /** Distance from the muzzle, metres. Input must be ordered near-to-far. */
  readonly distance: number;
  /** Opaque thickness in metres; zero denotes a target hit. */
  readonly thickness: number;
}

export interface RailgunTrace {
  readonly accepted: boolean;
  readonly penetrations: number;
  readonly remainingEnergy: number;
  /** Number of target surfaces reached before energy or range ended. */
  readonly targetsReached: number;
}

/**
 * Resolve the bounded piercing budget for an ordered trace. This is a pure
 * admission helper; the host still owns LOS, target identity and damage.
 */
export function traceRailgun(
  surfaces: readonly RailgunSurface[],
  profile: WeaponBehaviorProfile = SPECIAL_WEAPON_BEHAVIORS.railgun,
): RailgunTrace {
  if (profile.kind !== 'piercing') return { accepted: false, penetrations: 0, remainingEnergy: 0, targetsReached: 0 };
  const maxRange = profile.range ?? 0;
  const maxPenetrations = profile.maxPenetrations ?? 0;
  const retention = Math.min(1, Math.max(0, profile.surfaceRetention ?? 0));
  let energy = 1;
  let penetrations = 0;
  let targetsReached = 0;
  for (const surface of surfaces) {
    if (!Number.isFinite(surface.distance) || surface.distance < 0 || surface.distance > maxRange) continue;
    if (surface.thickness <= 0) {
      if (energy > 0) targetsReached++;
      continue;
    }
    if (penetrations >= maxPenetrations) break;
    penetrations++;
    energy *= retention;
    if (energy <= 0.05) break;
  }
  return { accepted: true, penetrations, remainingEnergy: energy, targetsReached };
}

// Fail loudly if the special table drifts from the catalog. This keeps the
// host seam closed: an unprofiled special cannot quietly become a hitscan gun.
for (const id of SPECIAL_IDS) {
  if (!WEAPONS.some((w) => w.id === id)) throw new Error(`weapon behavior: special '${id}' is not in catalog.ts`);
}
