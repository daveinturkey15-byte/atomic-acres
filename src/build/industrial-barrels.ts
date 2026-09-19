/**
 * Cosmetic industrial-barrel canary placements.
 *
 * Root preloads the asset before builders run. A missing preload is a clean empty
 * result so the builder never starts asynchronous work in a synchronous world build.
 * The four placements render as ONE InstancedMesh sharing the decoded master's
 * geometry and material: one draw call instead of four, identical world transforms.
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

/** Four measured map-space suggestions; root must still run the live route check.
 *  Cleared against work/collider-snapshot.json by scripts/assets/verify-barrel-instances.mjs:
 *  >= 0.45 m walking gap to every overlapping collider, outside door aprons and spawns. */
export const INDUSTRIAL_BARREL_PLACEMENTS: readonly IndustrialBarrelPlacement[] = Object.freeze([
  Object.freeze({ x: 10.41, z: 34.97, yaw: 0.18, name: 'white-east-fence' }),
  Object.freeze({ x: -12.46, z: 32.15, yaw: -0.24, name: 'white-west-fence' }),
  Object.freeze({ x: 11.58, z: -31.83, yaw: -0.12, name: 'orange-east-fence' }),
  Object.freeze({ x: -11.84, z: -34.03, yaw: 0.28, name: 'orange-west-fence' }),
]);

const GROUND_Y = KERB_HEIGHT + 0.001;

/**
 * The GLB is centred in x/z and sits on y≈0. A y rotation changes only the x/z
 * AABB; the measured y height and ground base remain unchanged.
 */
export function industrialBarrelCollider(p: IndustrialBarrelPlacement): AABB {
  const c = Math.abs(Math.cos(p.yaw));
  const s = Math.abs(Math.sin(p.yaw));
  const width = c * INDUSTRIAL_BARREL_SIZE.x + s * INDUSTRIAL_BARREL_SIZE.z;
  const depth = s * INDUSTRIAL_BARREL_SIZE.x + c * INDUSTRIAL_BARREL_SIZE.z;
  return aabbSlab(p.x, GROUND_Y, p.z, width, INDUSTRIAL_BARREL_SIZE.y, depth);
}

const UP_Y = new THREE.Vector3(0, 1, 0);

/**
 * Build one InstancedMesh over the shared master geometry; no async or frame work.
 * The scratch clone shares the master's buffers and is discarded after its
 * geometry, material and master-space transform are read, so nothing is copied.
 */
export const buildIndustrialBarrels: Builder = () => {
  const root = group('industrial-barrels');
  const source = getIndustrialBarrel();
  if (!source) return { group: root, colliders: [] };

  let mesh: THREE.Mesh | undefined;
  source.traverse((node) => {
    const candidate = node as THREE.Mesh;
    if (!mesh && candidate.isMesh) mesh = candidate;
  });
  if (!mesh) return { group: root, colliders: [] };

  source.updateMatrixWorld(true);
  // The exact chain the previous four clones rendered under: each instance matrix is
  // the placement transform applied to the mesh's transform relative to the master
  // root. The clone root itself is never transformed, so this reproduces the old
  // world transform per placement exactly.
  const base = new THREE.Matrix4().copy(source.matrixWorld).invert().multiply(mesh.matrixWorld);

  const instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, INDUSTRIAL_BARREL_PLACEMENTS.length);
  instances.name = 'industrial-barrel-instances';
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const unit = new THREE.Vector3(1, 1, 1);
  INDUSTRIAL_BARREL_PLACEMENTS.forEach((placement, index) => {
    position.set(placement.x, GROUND_Y, placement.z);
    quaternion.setFromAxisAngle(UP_Y, placement.yaw);
    instances.setMatrixAt(index, matrix.compose(position, quaternion, unit).multiply(base));
  });
  instances.instanceMatrix.needsUpdate = true;
  instances.computeBoundingBox();
  instances.computeBoundingSphere();
  instances.castShadow = true;
  instances.receiveShadow = true;
  root.add(instances);

  return { group: root, colliders: INDUSTRIAL_BARREL_PLACEMENTS.map(industrialBarrelCollider) };
};
