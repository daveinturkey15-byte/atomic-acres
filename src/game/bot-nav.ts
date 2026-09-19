/**
 * Nuketown 2025 — bot navigation: which half of the map, which goal, one step.
 *
 * Moved out of `bots.ts` unchanged (the 400-line cap) when the director grew
 * difficulty presets and the ordnance port. Three pure-ish functions over one
 * `BotRuntime` record: nothing here submits to the host, and nothing here
 * decides a shot.
 *
 * ## What the navigation actually is, stated plainly
 *
 * There is no path graph. A bot walks straight at its goal and, when the chest
 * segment to the next step is blocked, tries the two axis-aligned slides
 * before giving up for that tick. On a map 44 m across with wide flanks this
 * reads as competent; in a corridor maze it would not. `scripts/paths.mjs`
 * already floods the collision world and emits line-of-sight-simplified
 * waypoints — that is the upgrade path when this stops being enough, and it is
 * deliberately not taken yet.
 */

import type { Vec3, WorldQuery } from './events';
import { SPAWN_POINTS } from './spawns';
import {
  BOT_CHEST_Y, BOT_FALLBACK_HP, BOT_SIDE_HYSTERESIS_MS, BOT_SPEED_MS, BOT_STEP_UP_M,
  type BotIntent, type BotRuntime,
} from './bot-sense';

/**
 * Which half of the map this bot wants, with the 1.2 s sustain. Without the
 * hysteresis a bot sitting on the health threshold, or flickering in and out
 * of contact, oscillates between advance and fall-back every tick and walks
 * on the spot — which is exactly what the old project's sustain window was
 * added to stop.
 */
export function updateSide(b: BotRuntime, now: number, hp: number): void {
  const want: 1 | -1 = hp <= BOT_FALLBACK_HP
    ? (b.team === 0 ? -1 : 1)     // hurt: back toward its own spawn end
    : (b.team === 0 ? 1 : -1);    // healthy: push toward the enemy end
  if (want !== b.sideWant) {
    b.sideWant = want;
    b.sideSince = now;
    return;
  }
  if (want !== b.side && now - b.sideSince >= BOT_SIDE_HYSTERESIS_MS) {
    b.side = want;
    b.goalAt = 0;
  }
}

/**
 * A patrol goal, taken from `game/spawns.ts:SPAWN_POINTS` on the favoured
 * side. Derived, not authored: the spawn table is already a projection of
 * `core/layout.ts`, so bots walk to places the map says are places.
 *
 * BIASED TOWARD THE MIDDLE, and here is why. Sorted by |z| the enemy-side
 * pool runs from the street (z = 0) out to that team's back fence (z = 34),
 * and picking uniformly sends bots to the far end of an 84 m map: measured
 * over a 60 s match, 4,465 live bot-ticks produced 131 with an enemy in
 * sight — 2.9%. `r * r` is the square-biased pick, so the contested middle
 * is drawn several times more often than the enemy back yard while every
 * point stays reachable. This is a heuristic about ONE map's shape; it is
 * not a substitute for the real waypoint graph `scripts/paths.mjs` can emit.
 */
export function pickGoal(b: BotRuntime, now: number, rand: () => number): void {
  const wanted = SPAWN_POINTS.filter((p) => Math.sign(p.z) === b.side || p.z === 0);
  const pool = (wanted.length > 0 ? wanted : SPAWN_POINTS)
    .slice().sort((p, q) => Math.abs(p.z) - Math.abs(q.z));
  const r = rand();
  const p = pool[Math.min(pool.length - 1, Math.floor(r * r * pool.length))];
  b.goalX = p.x;
  b.goalZ = p.z;
  b.goalAt = now;
}

/**
 * Movement. Straight at the wish, then the two axis slides. The blocking
 * test is the chest segment through the `WorldQuery` port — the same
 * colliders the player hits, so a bot cannot walk through something the
 * human cannot. Returns true when the step taken was a slide, not the wish.
 */
export function stepBot(b: BotRuntime, intent: BotIntent, dt: number, world: WorldQuery): boolean {
  const dist = BOT_SPEED_MS * dt;
  if (dist <= 0 || (intent.moveX === 0 && intent.moveZ === 0)) { b.speed = 0; return false; }
  const tries: [number, number][] = [
    [intent.moveX, intent.moveZ],
    [intent.moveX, 0],
    [0, intent.moveZ],
  ];
  for (const [mx, mz] of tries) {
    if (mx === 0 && mz === 0) continue;
    const len = Math.hypot(mx, mz);
    const nx = b.x + (mx / len) * dist;
    const nz = b.z + (mz / len) * dist;
    if (!world.inBounds(nx, nz)) continue;
    const ny = world.groundY(nx, nz);
    if (ny - b.y > BOT_STEP_UP_M) continue;
    const from: Vec3 = { x: b.x, y: b.y + BOT_CHEST_Y, z: b.z };
    const to: Vec3 = { x: nx, y: ny + BOT_CHEST_Y, z: nz };
    if (!world.lineOfSight(from, to)) continue;
    const slid = mx !== intent.moveX || mz !== intent.moveZ;
    b.x = nx; b.y = ny; b.z = nz;
    b.speed = BOT_SPEED_MS * (len > 1 ? 1 : len);
    return slid;
  }
  b.speed = 0;
  return false;
}
