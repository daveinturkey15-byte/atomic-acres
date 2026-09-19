/**
 * Cached loader for the Poly Haven Quiver Tree 02 hero canary.
 *
 * The GLB is authored at its measured metre scale and its scene hierarchy is
 * deliberately kept intact. Callers receive clones that share the decoded
 * geometry, material, and embedded textures. This module owns only the
 * decoded master; callers remove scene clones before disposing the master.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const QUIVER_TREE_URL = `${baseUrl()}assets/quiver-tree/quiver-tree.glb`;

/** Bounds of the exported scene-local mesh after its GLTF node chain. */
export const QUIVER_TREE_LOCAL_BOUNDS = Object.freeze({
  min: Object.freeze({ x: -0.4359820783, y: 0, z: -0.4402450323 }),
  max: Object.freeze({ x: 0.4359820783, y: 1.4688606262, z: 0.4402450323 }),
});

export const QUIVER_TREE_SIZE = Object.freeze({
  x: QUIVER_TREE_LOCAL_BOUNDS.max.x - QUIVER_TREE_LOCAL_BOUNDS.min.x,
  y: QUIVER_TREE_LOCAL_BOUNDS.max.y - QUIVER_TREE_LOCAL_BOUNDS.min.y,
  z: QUIVER_TREE_LOCAL_BOUNDS.max.z - QUIVER_TREE_LOCAL_BOUNDS.min.z,
});

let loader: GLTFLoader | undefined;
let master: THREE.Group | undefined;
let pending: Promise<THREE.Group> | undefined;
let pendingGeneration: number | undefined;
let generation = 0;

function baseUrl(): string {
  try {
    const value = (import.meta as ImportMeta & {
      env?: { BASE_URL?: unknown };
    }).env?.BASE_URL;
    return typeof value === 'string' && value.length > 0 ? value : './';
  } catch {
    return './';
  }
}

function disposeObjectResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if ((value as THREE.Texture | undefined)?.isTexture) {
          textures.add(value as THREE.Texture);
        }
      }
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}

function loadMaster(): Promise<THREE.Group> {
  if (master) return Promise.resolve(master);
  if (pending) return pending;

  loader ??= new GLTFLoader();
  const requestGeneration = generation;
  const request = loader.loadAsync(QUIVER_TREE_URL).then((gltf) => {
    if (requestGeneration !== generation) {
      disposeObjectResources(gltf.scene);
      throw new Error('Quiver tree load was disposed before decode completed');
    }

    master = gltf.scene;
    master.name = 'QuiverTreeMaster';
    master.updateMatrixWorld(true);
    master.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    if (pendingGeneration === requestGeneration) {
      pending = undefined;
      pendingGeneration = undefined;
    }
    return master;
  }, (error: unknown) => {
    if (pendingGeneration === requestGeneration) {
      pending = undefined;
      pendingGeneration = undefined;
    }
    throw error;
  });

  pending = request;
  pendingGeneration = requestGeneration;
  return pending;
}

/** Begin one shared decode without adding anything to the scene. */
export function preloadQuiverTree(): Promise<void> {
  return loadMaster().then(() => undefined);
}

/** Resolve a shared-buffer clone ready for a builder or scene. */
export function loadQuiverTree(): Promise<THREE.Group> {
  return loadMaster().then((source) => source.clone(true));
}

/** Return a shared-buffer clone when the asset has already finished loading. */
export function getQuiverTree(): THREE.Group | undefined {
  return master?.clone(true);
}

/**
 * Dispose the decoded master after every scene clone has been removed.
 * A late completion from an invalidated request is disposed by loadMaster().
 */
export function disposeQuiverTree(): void {
  generation += 1;
  if (!master) {
    pending = undefined;
    pendingGeneration = undefined;
    return;
  }

  disposeObjectResources(master);
  master = undefined;
  pending = undefined;
  pendingGeneration = undefined;
}
