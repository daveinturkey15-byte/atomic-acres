/**
 * Cosmetic industrial-barrel canary placements.
 *
 * Root preloads the asset before builders run. A missing preload is a clean empty
 * result so the builder never starts asynchronous work in a synchronous world build.
 * Returned colliders are honest rotated AABBs around the measured source envelope;
 * there is no hidden mesh collider or per-frame placement work.
 */
import * as THREE from 'three';
import type { AABB, Builder } from '../core/kit';
import { aabbSlab, group } from '../core/kit';
import { KERB_HEIGHT } from '../core/layout';
import { getIndustrialBarrel, INDUSTRIAL_BARREL_SIZE } from '../props/industrial-barrel';

export interface IndustrialBarrelPlacement {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly name: string;
}

/** Four measured map-space suggestions; root must still run the live route check. */
export const INDUSTRIAL_BARREL_PLACEMENTS: readonly IndustrialBarrelPlacement[] = Object.freeze([
  Object.freeze({ x: 11.6, z: 34.8, yaw: 0.18, name: 'white-east-fence' }),
  Object.freeze({ x: -10.8, z: 31.8, yaw: -0.24, name: 'white-west-fence' }),
  Object.freeze({ x: 11.3, z: -33.0, yaw: -0.12, name: 'orange-east-fence' }),
  Object.freeze({ x: -10.6, z: -34.2, yaw: 0.28, name: 'orange-west-fence' }),
]);

/**
 * The GLB is centred in x/z and sits on y≈0. A y rotation changes only the x/z
 * AABB; the measured y height and ground base remain unchanged.
 */
export function industrialBarrelCollider(p: IndustrialBarrelPlacement): AABB {
  const c = Math.abs(Math.cos(p.yaw));
  const s = Math.abs(Math.sin(p.yaw));
  const width = c * INDUSTRIAL_BARREL_SIZE.x + s * INDUSTRIAL_BARREL_SIZE.z;
  const depth = s * INDUSTRIAL_BARREL_SIZE.x + c * INDUSTRIAL_BARREL_SIZE.z;
  return aabbSlab(p.x, KERB_HEIGHT + 0.001, p.z,
    width, INDUSTRIAL_BARREL_SIZE.y, depth);
}

/** Build the cached clones and their collision report; no async or frame work. */
export const buildIndustrialBarrels: Builder = () => {
  const root = group('industrial-barrels');
  const source = getIndustrialBarrel();
  if (!source) return { group: root, colliders: [] };

  const colliders: AABB[] = [];
  for (const [index, placement] of INDUSTRIAL_BARREL_PLACEMENTS.entries()) {
    const barrel = index === 0 ? source : source.clone(true);
    barrel.name = placement.name;
    barrel.position.set(placement.x, KERB_HEIGHT + 0.001, placement.z);
    barrel.rotation.y = placement.yaw;
    barrel.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    root.add(barrel);
    colliders.push(industrialBarrelCollider(placement));
  }
  return { group: root, colliders };
};
