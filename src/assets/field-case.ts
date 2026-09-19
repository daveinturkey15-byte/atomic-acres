/**
 * Loader for the original Blender-authored field case canary.
 *
 * The registry is intentionally isolated from the production asset registry:
 * this lane can be reviewed and mounted by the root agent without changing the
 * scene graph or adding work to the frame loop.  Clones share decoded buffers.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const FIELD_CASE_URL = `${baseUrl()}assets/field-case/field-case.glb`;
export const FIELD_CASE_SIZE = Object.freeze({ x: 0.919, y: 0.515, z: 0.564 });
export const FIELD_CASE_COLLIDER = Object.freeze({ x: 0.9, y: 0.5, z: 0.48 });

let loader: GLTFLoader | undefined;
let master: THREE.Group | undefined;
let pending: Promise<THREE.Group> | undefined;

function baseUrl(): string {
  try {
    const value = import.meta.env.BASE_URL;
    return typeof value === 'string' && value.length > 0 ? value : './';
  } catch {
    return './';
  }
}

function loadMaster(): Promise<THREE.Group> {
  if (master) return Promise.resolve(master);
  if (pending) return pending;
  loader ??= new GLTFLoader();
  pending = loader.loadAsync(FIELD_CASE_URL).then((gltf) => {
    master = gltf.scene;
    master.name = 'FieldCaseMaster';
    master.updateMatrixWorld(true);
    master.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    pending = undefined;
    return master;
  }, (error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

/** Resolve a shared-buffer clone ready to add to a scene or builder group. */
export function loadFieldCase(): Promise<THREE.Group> {
  return loadMaster().then((source) => source.clone(true));
}

/** Return a clone if the asset has already finished loading. */
export function getFieldCase(): THREE.Group | undefined {
  return master?.clone(true);
}

/**
 * Dispose the decoded master. Callers must remove all clones first because
 * clone geometry, materials and textures are deliberately shared.
 */
export function disposeFieldCase(): void {
  if (!master) {
    pending = undefined;
    return;
  }
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  master.traverse((node) => {
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
  master = undefined;
  pending = undefined;
}
