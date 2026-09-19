/**
 * Nuketown 2025 — a grenade's flight: gravity, bounce, roll, settle.
 *
 * PURE, and written against the three-method `WorldQuery` port rather than a
 * collider array on purpose. The host has no colliders — it has the port —
 * and the presentation in `weapons/grenades.ts` replays the same flight from
 * the `grenade-thrown` event with the same function against the same port,
 * so the mesh a player watches and the point the host detonates at come from
 * one piece of arithmetic. Divergence is bounded to the step size and the
 * detonation event snaps the mesh anyway.
 *
 * How a segment test becomes a bounce: `lineOfSight(from, to)` says only
 * "blocked". The normal is recovered by re-testing the three axis-only moves
 * — whichever single axis cannot advance is the face that was hit, and that
 * velocity component reflects. A corner that blocks nothing singly but blocks
 * the diagonal reflects everything. On an axis-aligned map this is exact.
 *
 * Mutates the record it is given and allocates nothing: this runs for every
 * live grenade every tick on the host and every frame in presentation.
 */

import type { Vec3, WorldQuery } from './events';

/**
 * `core/player.ts:GRAVITY` — BO2's 800 units/s². A grenade under 9.81 in a
 * world where the player falls at 20.32 floats visibly. A MIRROR of a private
 * constant, flagged: it belongs in `core/layout.ts` when that file has a
 * physics section.
 */
export const GRENADE_GRAVITY = 20.32;
/** Casing radius: keeps the rest point off the floor and out of a wall's skin. */
export const GRENADE_RADIUS_M = 0.08;
/** Energy kept normal to the surface on a bounce. A frag is dense and dead; it does not skip. */
export const GRENADE_RESTITUTION = 0.38;
/**
 * Tangential speed kept on a bounce, and the rolling decay per second on the
 * ground. Before: 0.78 and 3.2 - a 10 m lob then skated another 8-14 m
 * (measured 23.8 m from a bot's 10 m throw in the `bots` proof), which is a
 * puck, not a grenade. 0.6 / 4.0 lands the same throw 2-3 m past its mark.
 */
export const GRENADE_BOUNCE_FRICTION = 0.6;
export const GRENADE_ROLL_DECAY = 4.0;
/** Below this speed on the ground it is at rest and stops integrating. */
export const GRENADE_REST_SPEED = 0.25;
/** A vertical impact slower than this does not bounce; it lands. */
export const GRENADE_LAND_SPEED = 1.0;
/** Impacts faster than this count as a contact for an impact-fused grenade. */
export const GRENADE_CONTACT_SPEED = 1.5;
/** Longest step integrated at once; a stalled tab owes no tunnelling. */
export const GRENADE_MAX_DT = 0.1;

export interface Ballistic {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** On the ground and slower than `GRENADE_REST_SPEED`. Nothing moves it again. */
  resting: boolean;
}

export interface StepResult {
  /** A contact this step fast enough to count (`GRENADE_CONTACT_SPEED`). */
  readonly contact: boolean;
}

const STEP_CONTACT: StepResult = Object.freeze({ contact: true });
const STEP_QUIET: StepResult = Object.freeze({ contact: false });

// Scratch for the segment tests. Two records, reused; never escape this module.
const FROM: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
const TO: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

function clear(world: WorldQuery, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  FROM.x = ax; FROM.y = ay; FROM.z = az;
  TO.x = bx; TO.y = by; TO.z = bz;
  return world.lineOfSight(FROM as Vec3, TO as Vec3);
}

/** Place a grenade at a launch point with a velocity. */
export function launch(b: Ballistic, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
  b.x = x; b.y = y; b.z = z;
  b.vx = vx; b.vy = vy; b.vz = vz;
  b.resting = false;
}

/** Advance `dt` seconds. Returns whether a contact worth hearing happened. */
export function stepBallistic(b: Ballistic, dt: number, world: WorldQuery): StepResult {
  if (b.resting || !(dt > 0)) return STEP_QUIET;
  if (dt > GRENADE_MAX_DT) dt = GRENADE_MAX_DT;

  b.vy -= GRENADE_GRAVITY * dt;
  let nx = b.x + b.vx * dt;
  let ny = b.y + b.vy * dt;
  let nz = b.z + b.vz * dt;
  let contact = false;
  let grounded = false;

  // The playable rectangle is a wall too: a grenade never leaves the arena.
  if (!world.inBounds(nx, nz)) {
    if (!world.inBounds(nx, b.z)) { b.vx = -b.vx * GRENADE_RESTITUTION; nx = b.x; }
    if (!world.inBounds(b.x, nz)) { b.vz = -b.vz * GRENADE_RESTITUTION; nz = b.z; }
    contact = true;
  }

  // Walls, roofs, furniture: the segment test, then the axis split for the normal.
  if (!clear(world, b.x, b.y, b.z, nx, ny, nz)) {
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const xBlocked = nx !== b.x && !clear(world, b.x, b.y, b.z, nx, b.y, b.z);
    const yBlocked = ny !== b.y && !clear(world, b.x, b.y, b.z, b.x, ny, b.z);
    const zBlocked = nz !== b.z && !clear(world, b.x, b.y, b.z, b.x, b.y, nz);
    const corner = !xBlocked && !yBlocked && !zBlocked;
    if (xBlocked || corner) { b.vx = -b.vx * GRENADE_RESTITUTION; nx = b.x; }
    if (zBlocked || corner) { b.vz = -b.vz * GRENADE_RESTITUTION; nz = b.z; }
    if (yBlocked || corner) {
      if (b.vy < 0 && -b.vy < GRENADE_LAND_SPEED) {
        // Too slow to bounce off a roof or a table: it has landed on it.
        b.vy = 0;
        grounded = true;
      } else {
        b.vy = -b.vy * GRENADE_RESTITUTION;
      }
      ny = b.y;
    }
    if (xBlocked || zBlocked || corner) {
      b.vx *= GRENADE_BOUNCE_FRICTION;
      b.vz *= GRENADE_BOUNCE_FRICTION;
    }
    if (speed > GRENADE_CONTACT_SPEED) contact = true;
  }

  // The ground: highest standable surface under the column, plus the casing.
  const floor = world.groundY(nx, nz) + GRENADE_RADIUS_M;
  if (ny <= floor) {
    if (b.vy < 0) {
      if (-b.vy > GRENADE_CONTACT_SPEED) contact = true;
      b.vy = -b.vy < GRENADE_LAND_SPEED ? 0 : -b.vy * GRENADE_RESTITUTION;
      b.vx *= GRENADE_BOUNCE_FRICTION;
      b.vz *= GRENADE_BOUNCE_FRICTION;
    }
    ny = floor;
    grounded = b.vy === 0;
  }

  if (grounded) {
    const k = Math.exp(-GRENADE_ROLL_DECAY * dt);
    b.vx *= k;
    b.vz *= k;
    if (Math.hypot(b.vx, b.vz) < GRENADE_REST_SPEED) {
      b.vx = 0; b.vz = 0; b.vy = 0;
      b.resting = true;
    }
  }

  b.x = nx; b.y = ny; b.z = nz;
  return contact ? STEP_CONTACT : STEP_QUIET;
}
