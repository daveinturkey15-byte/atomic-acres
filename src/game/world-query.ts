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
import type { Vec3, WorldQuery } from './events';

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

/** Ray/AABB slab intersection over the segment [0,1]. `true` = the box is hit. */
function segmentHitsBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  box: AABB,
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
  return true;
}

/**
 * The port. Three methods, and only three — a fourth would be the callback bag
 * IMPORT-PLAN §5.3 forbids, and every extra answer the host is allowed to ask
 * for is a piece of the world it then depends on.
 */
export function createWorldQuery(colliders: readonly AABB[]): WorldQuery {
  return {
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
