/** Static aperture visibility approximation for the orange lounge's indirect light.
 * Not GI or a baked ray trace. Only ambient/IBL is attenuated; direct sun and
 * shadow maps retain their existing response. Outside this room the factor is 1.
 */
import { float, positionWorld, smoothstep, vec3 } from 'three/tsl';
import { FLOOR_H, HOUSE_DEPTH, HOUSE_HALF_LEN, ORANGE } from './layout';

export function orangeRoomAmbientNode() {
  const freeEnd = -ORANGE.garageEnd;
  const front = ORANGE.frontZ + ORANGE.side * HOUSE_DEPTH * .06;
  const depth = HOUSE_DEPTH * (.518 - .06);
  const x = positionWorld.x.mul(freeEnd), y = positionWorld.y;
  const d = positionWorld.z.sub(front).mul(ORANGE.side);
  const inside = smoothstep(-HOUSE_HALF_LEN * .156, -HOUSE_HALF_LEN * .156 + .14, x)
    .mul(float(1).sub(smoothstep(HOUSE_HALF_LEN - .20, HOUSE_HALF_LEN - .06, x)))
    .mul(smoothstep(.02, .16, d)).mul(float(1).sub(smoothstep(depth - .12, depth + .02, d)))
    .mul(smoothstep(.04, .12, y)).mul(float(1).sub(smoothstep(FLOOR_H - .05, FLOOR_H + .04, y)));
  // Centres/half-extents follow orange-house.ts's real holes, including the
  // window centred between the porch opening and the free-end corner pier.
  const doorX = ORANGE.frontDoorX * freeEnd;
  const windowX = (doorX + 1.5 + HOUSE_HALF_LEN - .55) / 2;
  const frontWindow = vec3(x.sub(windowX).abs().sub(1.05).max(0), y.sub(1.7).abs().sub(.75).max(0), d.sub(.28)).div(1.35);
  const door = vec3(x.sub(doorX).abs().sub(.75).max(0), y.sub(1.175).abs().sub(1.175).max(0), d.sub(.28)).div(1.25);
  const sideWindow = vec3(x.sub(HOUSE_HALF_LEN - .28), y.sub(1.7).abs().sub(.75).max(0),
    d.sub(HOUSE_DEPTH * (.5 - .06)).abs().sub(1.05).max(0)).div(1.35);
  const visibility = float(1).div(frontWindow.dot(frontWindow).add(1))
    .max(float(1).div(door.dot(door).add(1)))
    .max(float(1).div(sideWindow.dot(sideWindow).add(1)));
  return float(1).sub(inside.mul(float(1).sub(visibility)).mul(.76));
}
