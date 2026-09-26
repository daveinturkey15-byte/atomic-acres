/** Host-owned aircraft collision. Claims never supply an aircraft handle or damage amount. */
import type { ShotMsg } from '../net/protocol';
import type { AircraftTarget } from './killstreaks/pilot-types';

export function nearestAircraft(ray: ShotMsg, targets: readonly AircraftTarget[], maxDistance: number):
  { target: AircraftTarget; distance: number } | null {
  let nearest: { target: AircraftTarget; distance: number } | null = null;
  for (const target of targets) {
    if (target.health <= 0 || target.radius <= 0) continue;
    const x = target.x - ray.ox, y = target.y - ray.oy, z = target.z - ray.oz;
    const along = x * ray.dx + y * ray.dy + z * ray.dz;
    const radius2 = target.radius * target.radius;
    const across2 = x * x + y * y + z * z - along * along;
    if (across2 > radius2) continue;
    const halfChord = Math.sqrt(Math.max(0, radius2 - across2));
    if (along + halfChord < 0) continue;
    const distance = Math.max(0, along - halfChord);
    if (distance < maxDistance && (nearest === null || distance < nearest.distance)) nearest = { target, distance };
  }
  return nearest;
}
