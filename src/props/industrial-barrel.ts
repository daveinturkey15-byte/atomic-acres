/**
 * Reusable loader for the Poly Haven industrial barrel canary.
 *
 * The module owns no scene, camera, renderer, collider, or frame-loop work.
 * The decoded master is cached once; clones share its geometry and materials.
 * Callers remove their clones before calling disposeIndustrialBarrel().
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const INDUSTRIAL_BARREL_URL = `${baseUrl()}assets/industrial-barrel/industrial-barrel.glb`;
export const INDUSTRIAL_BARREL_SIZE = Object.freeze({ x: 0.634, y: 0.930, z: 0.639 });

let loader: GLTFLoader | undefined;
let master: THREE.Group | undefined;
let pending: Promise<THREE.Group> | undefined;
let pendingGeneration: number | undefined;
let generation = 0;

/** Resolves after the shared barrel has been decoded, when preloaded. */
export let industrialBarrelReady: Promise<void> = Promise.resolve();

function baseUrl(): string {
  try {
    const value = import.meta.env.BASE_URL;
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
        if ((value as THREE.Texture | undefined)?.isTexture) textures.add(value as THREE.Texture);
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
  const request = loader.loadAsync(INDUSTRIAL_BARREL_URL).then((gltf) => {
    if (requestGeneration !== generation) {
      disposeObjectResources(gltf.scene);
      throw new Error('Industrial barrel load was disposed before decode completed');
    }
    master = gltf.scene;
    master.name = 'IndustrialBarrelMaster';
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
export function preloadIndustrialBarrel(): Promise<void> {
  const ready = loadMaster().then(() => undefined);
  industrialBarrelReady = ready;
  return ready;
}

/** Resolve a shared-buffer clone ready to add to a scene or builder group. */
export function loadIndustrialBarrel(): Promise<THREE.Group> {
  return loadMaster().then((source) => source.clone(true));
}

/** Return a shared-buffer clone if the asset has already finished loading. */
export function getIndustrialBarrel(): THREE.Group | undefined {
  return master?.clone(true);
}

/**
 * Dispose decoded master resources after every clone has been removed.
 * Shared clone geometry and materials become invalid after this call.
 */
export function disposeIndustrialBarrel(): void {
  generation += 1;
  if (!master) {
    pending = undefined;
    pendingGeneration = undefined;
    industrialBarrelReady = Promise.resolve();
    return;
  }
  disposeObjectResources(master);
  master = undefined;
  pending = undefined;
  pendingGeneration = undefined;
  industrialBarrelReady = Promise.resolve();
}
