/**
 * Nuketown 2025 — a bot's aim line, and the error cone a difficulty preset
 * puts on it. PURE: two functions that write into a scratch vector and
 * allocate nothing. Split out of `bots.ts` when the ordnance intents (knife,
 * grenade) joined the trigger there and the file met the 400-line cap.
 */

import type { Vec3 } from './events';

export interface Dir { x: number; y: number; z: number }

/** Unit vector from `from` to `to`, into `out`. False when the two coincide. */
export function aimVector(from: Vec3, to: Vec3, out: Dir): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return false;
  out.x = dx / len; out.y = dy / len; out.z = dz / len;
  return true;
}

/**
 * Aim error: a uniform cone of half-angle `errRad` around `out`, drawn from
 * the host's own RNG so a seeded replay misses the same way. Zero leaves the
 * line untouched, which is the aim bots have always had on `regular`.
 */
export function scatter(out: Dir, errRad: number, rand: () => number): void {
  if (errRad <= 0) return;
  const ang = errRad * Math.sqrt(rand());
  const rot = rand() * Math.PI * 2;
  const { x: dx, y: dy, z: dz } = out;
  // u, v: two unit vectors perpendicular to the aim line.
  const px = Math.abs(dy) < 0.9 ? 0 : 1;
  const py = Math.abs(dy) < 0.9 ? 1 : 0;
  let ux = py * dz, uy = -px * dz, uz = px * dy - py * dx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  const sn = Math.sin(ang), cs = Math.cos(ang);
  const a = Math.cos(rot) * sn, b = Math.sin(rot) * sn;
  out.x = dx * cs + ux * a + vx * b;
  out.y = dy * cs + uy * a + vy * b;
  out.z = dz * cs + uz * a + vz * b;
}
