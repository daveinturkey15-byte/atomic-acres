/**
 * Two bounded Quiver Tree 02 hero props for the standalone desert-yard canary.
 *
 * The decoded GLB has one mesh primitive. The builder uses one InstancedMesh
 * over that shared geometry/material, so the two placements are one additional
 * scene draw and both instances cast/receive shadows. It is synchronous: root
 * preloads the asset before invoking builders, and a missing preload produces
 * an empty result rather than starting asynchronous work during world build.
 */
import * as THREE from 'three';
import type { AABB, Builder } from '../core/kit';
import { group } from '../core/kit';
import { KERB_HEIGHT } from '../core/layout';
import {
  getQuiverTree,
  QUIVER_TREE_LOCAL_BOUNDS,
} from '../props/quiver-tree';

export interface DesertTreePlacement {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly name: string;
}

/**
 * Candidate map-space positions measured against the recovery collider snapshot.
 * Root still owns the live traversal and visual admission decision.
 */
export const DESERT_TREE_PLACEMENTS: readonly DesertTreePlacement[] = Object.freeze([
  Object.freeze({ x: -3, z: 34, yaw: 0, name: 'quiver-tree-white-yard' }),
  Object.freeze({ x: 6.25, z: -34, yaw: 1.4, name: 'quiver-tree-orange-yard' }),
]);

const GROUND_Y = KERB_HEIGHT + 0.001;
const UP_Y = new THREE.Vector3(0, 1, 0);
const INSTANCE_SCALE = new THREE.Vector3(1, 1, 1);

function rotatedSceneBounds(placement: DesertTreePlacement): AABB {
  const { min, max } = QUIVER_TREE_LOCAL_BOUNDS;
  const c = Math.cos(placement.yaw);
  const s = Math.sin(placement.yaw);
  const corners: readonly [number, number][] = [
    [min.x, min.z],
    [min.x, max.z],
    [max.x, min.z],
    [max.x, max.z],
  ];

  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const [x, z] of corners) {
    // Match THREE.Matrix4.makeRotationY / Quaternion.setFromAxisAngle(Y, yaw):
    // x' = c*x + s*z, z' = -s*x + c*z.
    const worldX = placement.x + c * x + s * z;
    const worldZ = placement.z - s * x + c * z;
    xMin = Math.min(xMin, worldX);
    xMax = Math.max(xMax, worldX);
    zMin = Math.min(zMin, worldZ);
    zMax = Math.max(zMax, worldZ);
  }

  return {
    min: new THREE.Vector3(xMin, GROUND_Y + min.y, zMin),
    max: new THREE.Vector3(xMax, GROUND_Y + max.y, zMax),
  };
}

/** Honest full-canopy AABB, including the authored local GLTF bounds. */
export function desertTreeCollider(placement: DesertTreePlacement): AABB {
  return rotatedSceneBounds(placement);
}

/**
 * Build one shared InstancedMesh. The authored node chain is retained by
 * extracting the mesh-to-scene transform from the decoded GLTF clone; no
 * geometry, UVs, or materials are rewritten here.
 */
export const buildDesertTrees: Builder = () => {
  const root = group('desert-trees');
  const source = getQuiverTree();
  if (!source) return { group: root, colliders: [] };

  let mesh: THREE.Mesh | undefined;
  source.traverse((node) => {
    const candidate = node as THREE.Mesh;
    if (!mesh && candidate.isMesh) mesh = candidate;
  });
  if (!mesh) return { group: root, colliders: [] };

  source.updateMatrixWorld(true);
  // Preserve any future authored mesh-to-root transform instead of flattening
  // it into the asset or silently replacing it with a hand-tuned scale.
  const base = new THREE.Matrix4()
    .copy(source.matrixWorld)
    .invert()
    .multiply(mesh.matrixWorld);
  const instances = new THREE.InstancedMesh(
    mesh.geometry,
    mesh.material,
    DESERT_TREE_PLACEMENTS.length,
  );
  instances.name = 'quiver-tree-instances';
  instances.castShadow = true;
  instances.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  for (const [index, placement] of DESERT_TREE_PLACEMENTS.entries()) {
    position.set(placement.x, GROUND_Y, placement.z);
    quaternion.setFromAxisAngle(UP_Y, placement.yaw);
    instances.setMatrixAt(
      index,
      matrix.compose(position, quaternion, INSTANCE_SCALE).multiply(base),
    );
  }
  instances.instanceMatrix.needsUpdate = true;
  instances.computeBoundingBox();
  instances.computeBoundingSphere();
  root.add(instances);

  return {
    group: root,
    colliders: DESERT_TREE_PLACEMENTS.map(desertTreeCollider),
  };
};
