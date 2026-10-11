/**
 * Nuketown 2025 — the `WorldQuery` port, built from the collider set.
 *
 * This is the ONE adapter between `src/game/` (DOM-free, scene-free) and the
 * world `main.ts` assembled. IMPORT-PLAN §2 says the host may learn about the
 * world through exactly three methods and nothing else; this file implements
 * exactly those three over `AABB[]` and holds no other state.
 *
 * It is deliberately NOT in `main.ts`. `main.ts` is the only file that touches
 * the scene, and this touches no scene — it takes the collider array the
 * builders returned and answers geometry questions about it. Keeping it here
 * means the same three answers can be produced from a synthetic collider set
 * in a headless proof, which is how the numbers in this lane's report were
 * measured.
 *
 * ## Cost, measured rather than assumed
 *
 * Every method is a linear scan. With the map's collider count (printed by
 * `main.ts` at boot) that is a few hundred slab tests per call. The callers
 * are: spawn selection (a few times a second), bot sensing (one per bot per
 * host tick, 20 Hz), the sentry (one per live turret per tick) and one per
 * admitted shot. A uniform grid was written and then deleted — at this
 * collider count it measured slower than the scan it replaced, because the
 * cell walk costs more than the early-exit it saves. If the map grows an order
 * of magnitude, index it then, not now.
 */

import type { AABB } from '../core/kit';
import { BOUND_X_MAX, BOUND_X_MIN, BOUND_Z } from '../core/layout';
import type { ActorId, SmokeKind, Vec3, WorldQuery } from './events';

/**
 * A collider top at or below this counts as standable ground.
 *
 * `core/layout.ts:DECK_Y` is 3.15 and the first-floor deck is a place a player
 * stands, so the ceiling has to clear it; the rail on top of that deck is
 * 1.05 m more and must NOT read as a floor. 3.6 is the gap between the two.
 * Anything taller — a wall, a roof, a fence — is an obstacle, and a spawn or a
 * sentry placed on top of one would be placed inside the map's geometry.
 */
export const STANDABLE_MAX_Y = 3.6;

/**
 * Horizontal slack when asking "is this point on that slab".
 *
 * The pavement is authored as abutting slabs. Exactly on a seam, a strict test
 * finds both or neither depending on floating-point luck; 1 cm of slack makes
 * the answer the same from either side.
 */
export const GROUND_SLACK_M = 0.01;

/** Ray/AABB slab intersection over the segment [0,1]. `true` = the box is hit.
 *
 * `out` is the wallbang lane's read-out and nothing else: on a hit it carries
 * the entry/exit parameters (`near`/`far`, clipped to [0,1]) so the caller can
 * measure chord length without re-deriving the slab math below. Untouched on a
 * miss — read it only when this returns true. Omitted on the `lineOfSight`
 * path, which stays allocation-free.
 */
function segmentHitsBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  box: AABB,
  out?: { near: number; far: number },
): boolean {
  let near = 0;
  let far = 1;
  // One axis at a time. A zero component means the segment is parallel to that
  // pair of planes, so it either lies inside the slab for its whole length or
  // misses the box entirely — there is no crossing to clip against.
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = axis === 0 ? box.min.x : axis === 1 ? box.min.y : box.min.z;
    const hi = axis === 0 ? box.max.x : axis === 1 ? box.max.y : box.max.z;
    if (d === 0) {
      if (o < lo || o > hi) return false;
      continue;
    }
    const inv = 1 / d;
    let t0 = (lo - o) * inv;
    let t1 = (hi - o) * inv;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    if (t0 > near) near = t0;
    if (t1 < far) far = t1;
    if (near > far) return false;
  }
  if (out !== undefined) {
    out.near = near;
    out.far = far;
  }
  return true;
}

// ---------------------------------------------------------------------------
// What obscures sight: smoke volumes and flash blindness
// ---------------------------------------------------------------------------

/**
 * One live smoke volume, as announced on the bus by `smoke-volume`. The field
 * holds the same numbers the event carries and nothing more; the atmosphere
 * lane renders from the event, bots read from here, and both see one sphere.
 */
export interface SmokeVolume {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly bornAt: number;
  readonly diesAt: number;
  readonly kind: SmokeKind;
}

/**
 * Chord length through smoke, density-weighted, above which a line of sight
 * is blocked. 1.5 m: a bot sees a target standing at the very skin of a
 * cloud, and nothing through the middle of one.
 */
export const SMOKE_LOS_THRESHOLD_M = 1.5;
/** Density per kind. A blast puff is thin; a smoke grenade is the real thing. */
export const SMOKE_DENSITY: Readonly<Record<SmokeKind, number>> = Object.freeze({ grenade: 1, blast: 0.6 });
/** Over the last this-many ms a volume thins to nothing, and sight returns with it. */
export const SMOKE_DISSOLVE_MS = 5_000;
/** The first this-many ms a volume is still filling, and sight leaves with it. */
export const SMOKE_FILL_MS = 1_500;

/**
 * THE FIELD. Level state the host writes (`host-ordnance.ts`) and bots read
 * (`bot-sense.ts`), carried on the same object as the three-method port so a
 * `BotDirector` handed `world` sees the smoke the host put in it with no
 * fourth callback and no second wiring. It is data — a list of spheres and a
 * map of blind-until times — not a door back into the host (§5.3).
 *
 * `now` is the host clock at the last `prune`. The host prunes every tick, so
 * the fill and dissolve ramps below read the clock without a caller passing
 * one. A volume added and read before any prune reads as still filling,
 * i.e. thin: a harness that adds a volume by hand must `prune(now)` first,
 * exactly as the host does.
 */
export class SightField {
  private readonly volumes: SmokeVolume[] = [];
  private readonly blind = new Map<ActorId, number>();
  private now = 0;

  add(v: SmokeVolume): void {
    this.remove(v.id);
    this.volumes.push(v);
  }

  remove(id: number): boolean {
    for (let i = 0; i < this.volumes.length; i++) {
      if (this.volumes[i].id === id) {
        this.volumes.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** Advance the clock; drop expired volumes and blindness. Ended volume ids go into `ended`. */
  prune(now: number, ended?: number[]): void {
    this.now = now;
    for (let i = this.volumes.length - 1; i >= 0; i--) {
      if (now >= this.volumes[i].diesAt) {
        if (ended !== undefined) ended.push(this.volumes[i].id);
        this.volumes.splice(i, 1);
      }
    }
    for (const [id, until] of this.blind) if (now >= until) this.blind.delete(id);
  }

  clear(): void {
    this.volumes.length = 0;
    this.blind.clear();
  }

  activeSmokeVolumes(): readonly SmokeVolume[] {
    return this.volumes;
  }

  /** 0..1 how thick a volume is right now: filling in, full, dissolving out. */
  densityOf(v: SmokeVolume): number {
    const fill = Math.min(1, Math.max(0, (this.now - v.bornAt) / SMOKE_FILL_MS));
    const fade = Math.min(1, Math.max(0, (v.diesAt - this.now) / SMOKE_DISSOLVE_MS));
    return SMOKE_DENSITY[v.kind] * Math.min(fill, fade);
  }

  /**
   * Ray against the sphere list: the density-weighted length of the segment
   * inside smoke, tested against `SMOKE_LOS_THRESHOLD_M`. A tangent grazes
   * zero chord and is not blocked; through the centre is the full diameter.
   */
  losBlockedBySmoke(a: Vec3, b: Vec3): boolean {
    if (this.volumes.length === 0) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    let weighted = 0;
    for (let i = 0; i < this.volumes.length; i++) {
      const v = this.volumes[i];
      const density = this.densityOf(v);
      if (density <= 0) continue;
      // Nearest point on the segment to the centre, clamped to the segment.
      const t = len2 <= 1e-9 ? 0 : Math.min(1, Math.max(0, ((v.x - a.x) * dx + (v.y - a.y) * dy + (v.z - a.z) * dz) / len2));
      const px = a.x + dx * t - v.x;
      const py = a.y + dy * t - v.y;
      const pz = a.z + dz * t - v.z;
      const off2 = px * px + py * py + pz * pz;
      const r2 = v.radius * v.radius;
      if (off2 >= r2) continue;
      // Half-chord at the nearest point, bounded by how much segment lies each side of it.
      const half = Math.sqrt(r2 - off2);
      const len = Math.sqrt(len2);
      const chord = Math.min(half, t * len) + Math.min(half, (1 - t) * len);
      weighted += chord * density;
      if (weighted > SMOKE_LOS_THRESHOLD_M) return true;
    }
    return false;
  }

  setBlind(id: ActorId, until: number): void {
    const cur = this.blind.get(id) ?? 0;
    if (until > cur) this.blind.set(id, until);
  }

  clearBlind(id: ActorId): void {
    this.blind.delete(id);
  }

  blindUntil(id: ActorId): number {
    return this.blind.get(id) ?? 0;
  }

  /** Level: pruned by the host every tick, so no clock is needed to read it. */
  isBlinded(id: ActorId): boolean {
    return this.blind.has(id);
  }
}

/** The port plus the collider set it was built from. Structurally still a `WorldQuery`. */
export interface WorldQueryWithColliders extends WorldQuery {
  readonly colliders: readonly AABB[];
}

/** The port plus the field it carries. Structurally still a `WorldQuery`. */
export interface WorldQueryWithSight extends WorldQuery {
  readonly sight: SightField;
}

/** The field on a world, or null for a port built elsewhere without one. */
export function sightOf(world: WorldQuery): SightField | null {
  const s = (world as Partial<WorldQueryWithSight>).sight;
  return s instanceof SightField ? s : null;
}

/** THE SMOKE CONTRACT's two queries, as free functions over any world. */
export function activeSmokeVolumes(world: WorldQuery): readonly SmokeVolume[] {
  return sightOf(world)?.activeSmokeVolumes() ?? [];
}

export function losBlockedBySmoke(world: WorldQuery, a: Vec3, b: Vec3): boolean {
  return sightOf(world)?.losBlockedBySmoke(a, b) ?? false;
}

/** The collider set on a world, or null for a port built elsewhere without one. */
export function collidersOf(world: WorldQuery): readonly AABB[] | null {
  const c = (world as Partial<WorldQueryWithColliders>).colliders;
  return Array.isArray(c) ? c : null;
}

/**
 * Metres of collider interior along the segment from→to — the wallbang
 * budget's measure of "how much wall is in the way".
 *
 * The same AABB set `lineOfSight` answers from, so cover and sight cannot
 * disagree about what a wall is; each chord comes out of `segmentHitsBox`
 * (no second copy of the ray-box math). Overlapping chords merge, so two
 * boxes sharing interior count once, and abutting boxes count end to end.
 *
 * Pure. The 0/1-chord fast path allocates nothing; two or more chords take
 * one small scratch array for the merge. The host calls this only for a
 * LOS-blocked ray with a penetrating gun, never on the LOS-clear path.
 *
 * Returns null when the port carries no collider set, or when the segment is
 * not measurable (a non-finite endpoint): the caller cannot prove the budget
 * covers the wall, so it must read null as a miss. A measurable segment that
 * touches no interior is exactly 0, and a zero-length segment is 0 too.
 */
export function wallThicknessM(world: WorldQuery, from: Vec3, to: Vec3): number | null {
  const colliders = collidersOf(world);
  if (colliders === null) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(from.z)) return null;
  const segLen = Math.hypot(dx, dy, dz);
  if (!(segLen > 0)) return 0;
  const chord = { near: 0, far: 1 };
  let firstNear = 0;
  let firstFar = -1;
  let rest: number[] | null = null;
  for (let i = 0; i < colliders.length; i++) {
    chord.near = 0;
    chord.far = 1;
    if (!segmentHitsBox(from.x, from.y, from.z, dx, dy, dz, colliders[i], chord)) continue;
    if (firstFar < 0) {
      firstNear = chord.near;
      firstFar = chord.far;
    } else {
      if (rest === null) rest = [firstNear, firstFar];
      rest.push(chord.near, chord.far);
    }
  }
  if (firstFar < 0) return 0;
  if (rest === null) return (firstFar - firstNear) * segLen;
  // Insertion sort on packed (start, end) pairs, then a one-pass merge.
  for (let i = 2; i < rest.length; i += 2) {
    const s = rest[i];
    const e = rest[i + 1];
    let j = i - 2;
    while (j >= 0 && rest[j] > s) {
      rest[j + 2] = rest[j];
      rest[j + 3] = rest[j + 1];
      j -= 2;
    }
    rest[j + 2] = s;
    rest[j + 3] = e;
  }
  let total = 0;
  let curNear = rest[0];
  let curFar = rest[1];
  for (let i = 2; i < rest.length; i += 2) {
    const s = rest[i];
    const e = rest[i + 1];
    if (s > curFar) {
      total += curFar - curNear;
      curNear = s;
      curFar = e;
    } else if (e > curFar) {
      curFar = e;
    }
  }
  return (total + curFar - curNear) * segLen;
}

/**
 * The port. Three methods, and only three — a fourth would be the callback bag
 * IMPORT-PLAN §5.3 forbids, and every extra answer the host is allowed to ask
 * for is a piece of the world it then depends on. The `sight` field beside
 * them is not a method and not a callback: it is the smoke the host put in the
 * world, carried where every reader of the world already looks. The
 * `colliders` field is the same kind of thing: the set this port answers
 * from, carried so `wallThicknessM` can measure over it without a fourth
 * method. Neither field is callable, so neither is a door back into a caller.
 */
export function createWorldQuery(colliders: readonly AABB[]): WorldQueryWithSight & WorldQueryWithColliders {
  return {
    sight: new SightField(),
    colliders,

    /**
     * Clear line between two world points. Colliders only: this is the same
     * set the player collides with, so "I can see you" and "I can walk there"
     * cannot disagree about what a wall is.
     */
    lineOfSight(from: Vec3, to: Vec3): boolean {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return false;
      for (let i = 0; i < colliders.length; i++) {
        if (segmentHitsBox(from.x, from.y, from.z, dx, dy, dz, colliders[i])) return false;
      }
      return true;
    },

    /**
     * Height of the highest standable surface under (x, z), or 0 — the road
     * and lawn planes are not colliders (`build/ground.ts` says so: its own
     * default is y = 0), so a point over bare ground legitimately finds
     * nothing and must answer 0 rather than `-Infinity`.
     */
    groundY(x: number, z: number): number {
      let best = 0;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (x < c.min.x - GROUND_SLACK_M || x > c.max.x + GROUND_SLACK_M) continue;
        if (z < c.min.z - GROUND_SLACK_M || z > c.max.z + GROUND_SLACK_M) continue;
        if (c.max.y > STANDABLE_MAX_Y || c.max.y <= best) continue;
        best = c.max.y;
      }
      return best;
    },

    /** The playable rectangle from `core/layout.ts`. No second copy of it. */
    inBounds(x: number, z: number): boolean {
      return x >= BOUND_X_MIN && x <= BOUND_X_MAX && z >= -BOUND_Z && z <= BOUND_Z;
    },
  };
}
