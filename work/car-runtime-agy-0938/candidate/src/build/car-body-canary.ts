/**
 * OWNED CAR-BODY CANARY (?car-body=canary) - the baked sedan GLB as an exclusively
 * owned resource root.
 *
 * Pattern derived from src/build/coach-owned-canary.ts with full runtime lifecycle
 * and adoption hardening:
 *  - Exclusive module loader: core/assets.ts and its shared cache are never touched.
 *  - Deduplicated disposal: unique geometries, materials, and textures are tracked in Sets
 *    and each disposed exactly once, preventing double disposal of shared resources.
 *  - Strict budget and envelope validation: bounds/finite/ground/noseaxis/<=14k tris/
 *    <=6 meshes/<=6 materials validated BEFORE adoption; bad or oversized models are
 *    refused (never silently autoscaled) and disposed cleanly without leaks.
 *  - Raw GLB fallback budget enforcement: raw fallback is refused if it exceeds draw/mesh/
 *    material/tri budgets.
 *  - Cancellation generation: pending loads track flight generation; release increments
 *    generation, detaches any mounted root from its parent, and causes late-arriving
 *    loads to be discarded and disposed immediately without flipping state or adopting.
 *  - Sync loader throw-safe: synchronous throws from loaders are safely converted into
 *    asynchronous fallback resolutions without unhandled exceptions.
 *  - Single-flight preload: concurrent calls share a single Promise.
 *  - Exact-once visual handoff: carBodyCanaryVisual() returns the root once, then null.
 *  - Batcher exclusion: meshes carry userData.carBodyCanary = true for batchStatic keep.
 *  - Read-only QA status: carBodyCanaryReport() exposes live geometry/material/texture/
 *    triangle/mesh adoption metrics.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** The baked candidate. ROOT copies asset sources, not this lane. */
const CANARY_URL_SEGMENT = 'assets/car-body-agy-0923.consolidated.glb';
const CANARY_URL_RAW = 'assets/car-body-agy-0923.glb';

export type CarBodyCanaryState = 'off' | 'loading' | 'ready' | 'fallback';

/** Loader seam: production resolves the glTF scene; falsifiers inject one. */
export type LoadCarBodyScene = (url: string) => Promise<THREE.Group>;

let state: CarBodyCanaryState = 'off';
let flight: Promise<CarBodyCanaryState> | null = null;
let owned: OwnedInstance | null = null;
let taken = false;
let generation = 0;

interface OwnedInstance {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  triangles: number;
}

/** Vite `base` is relative, so this stays correct under Pages subpaths. */
function baseUrl(): string {
  try {
    const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
    const base = meta?.env?.BASE_URL;
    if (typeof base === 'string' && base.length > 0) return base;
  } catch {
    /* Non-vite unit context: fall through to relative default. */
  }
  return './';
}

/** Opt-in: ?car-body=canary only, or the QA override global. */
export function isCarBodyCanaryOptIn(): boolean {
  const g = globalThis as { __NT_OVERRIDE_CAR_BODY__?: boolean };
  if (typeof g.__NT_OVERRIDE_CAR_BODY__ === 'boolean') return g.__NT_OVERRIDE_CAR_BODY__;
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      return new URLSearchParams(window.location.search).get('car-body') === 'canary';
    }
  } catch {
    /* Non-browser unit context */
  }
  return false;
}

export function carBodyCanaryState(): CarBodyCanaryState {
  return state;
}

export interface CarBodyCanaryReport {
  optIn: boolean;
  state: CarBodyCanaryState;
  mounted: boolean;
  taken: boolean;
  meshes: number;
  materials: number;
  geometries: number;
  textures: number;
  triangles: number;
}

/** Read-only actual-adoption status. Exposes live geometries, materials, textures, triangles. */
export function carBodyCanaryReport(): CarBodyCanaryReport {
  let meshes = 0;
  if (owned) {
    owned.group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes++;
    });
  }
  return {
    optIn: isCarBodyCanaryOptIn(),
    state,
    mounted: owned !== null,
    taken,
    meshes,
    materials: owned ? owned.materials.length : 0,
    geometries: owned ? owned.geometries.length : 0,
    textures: owned ? owned.textures.length : 0,
    triangles: owned ? owned.triangles : 0,
  };
}

function defaultLoad(url: string): Promise<THREE.Group> {
  return new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
}

function isTexture(value: unknown): value is THREE.Texture {
  return typeof value === 'object' && value !== null
    && 'isTexture' in value
    && value.isTexture === true;
}

function texturesOf(m: THREE.Material): THREE.Texture[] {
  const found: THREE.Texture[] = [];
  for (const value of Object.values(m as unknown as Record<string, unknown>)) {
    if (isTexture(value)) found.push(value);
  }
  return found;
}

/** Deduplicated disposal of any scene (candidate, race loser, or rejected). */
export function disposeScene(scene: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      if (m) {
        materials.add(m);
        for (const tex of texturesOf(m)) textures.add(tex);
      }
    }
  });

  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const t of textures) t.dispose();
}

function disposeOwned(): void {
  const instance = owned;
  owned = null;
  taken = false;
  if (!instance) return;
  if (instance.group.parent) instance.group.removeFromParent();
  for (const g of instance.geometries) g.dispose();
  for (const m of instance.materials) m.dispose();
  for (const t of instance.textures) t.dispose();
}

export interface CandidateValidation {
  valid: boolean;
  reason?: string;
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  triangles: number;
}

/**
 * Strict validation of candidate sedan visual before adoption:
 * - non-empty and finite coordinates
 * - expected envelope bounds (len <= 5.12, wid <= 2.12, hgt <= 1.56)
 * - nose axis along +x (len > wid and len > hgt)
 * - ground alignment (rest at y=0, within 0.12m)
 * - draw/complexity budgets: <= 6 meshes, <= 6 materials, <= 14,000 triangles.
 *
 * Does not hide bad assets by autoscaling; returns valid: false so caller can
 * cleanly dispose and fallback.
 */
export function validateCandidateScene(scene: THREE.Group): CandidateValidation {
  const meshes: THREE.Mesh[] = [];
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let triangles = 0;

  scene.traverse((child) => {
    const m = child as THREE.Mesh;
    if (!m.isMesh) return;
    meshes.push(m);
    if (m.geometry) {
      geometries.add(m.geometry);
      if (m.geometry.index) {
        triangles += Math.round(m.geometry.index.count / 3);
      } else if (m.geometry.attributes?.position) {
        triangles += Math.round(m.geometry.attributes.position.count / 3);
      }
    }
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (mat) {
        materials.add(mat);
        for (const tex of texturesOf(mat)) textures.add(tex);
      }
    }
  });

  const geosList = [...geometries];
  const matsList = [...materials];
  const texsList = [...textures];

  if (meshes.length === 0) {
    return { valid: false, reason: 'scene contains zero meshes', meshes, geometries: geosList, materials: matsList, textures: texsList, triangles: 0 };
  }
  if (meshes.length > 6) {
    return { valid: false, reason: `mesh count exceeds budget: ${meshes.length} > 6`, meshes, geometries: geosList, materials: matsList, textures: texsList, triangles };
  }
  if (materials.size > 6) {
    return { valid: false, reason: `material count exceeds budget: ${materials.size} > 6`, meshes, geometries: geosList, materials: matsList, textures: texsList, triangles };
  }
  if (triangles > 14000) {
    return { valid: false, reason: `triangle count exceeds budget: ${triangles} > 14000`, meshes, geometries: geosList, materials: matsList, textures: texsList, triangles };
  }

  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);

  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.min.y) || !Number.isFinite(box.min.z) ||
      !Number.isFinite(box.max.x) || !Number.isFinite(box.max.y) || !Number.isFinite(box.max.z)) {
    return { valid: false, reason: 'non-finite coordinates in bounding box', meshes, geometries: geosList, materials: matsList, textures: texsList, triangles };
  }

  if (box.isEmpty() || box.min.x >= box.max.x || box.min.y >= box.max.y || box.min.z >= box.max.z) {
    return { valid: false, reason: 'empty or inverted bounding box', meshes, geometries: geosList, materials: matsList, textures: texsList, triangles };
  }

  const size = box.getSize(new THREE.Vector3());

  // Collider envelope: len 5.04, wid 2.04, hgt 1.48 (nominal 4.8 / 1.95 / 1.48).
  // Strictly bounded envelope:
  if (size.x < 3.8 || size.x > 5.12 || size.y < 1.0 || size.y > 1.56 || size.z < 1.5 || size.z > 2.12) {
    return {
      valid: false,
      reason: `envelope out of bounds: size [${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}] outside expected bounds`,
      meshes, geometries: geosList, materials: matsList, textures: texsList, triangles,
    };
  }

  // Nose axis is +x: length must be longest axis (greater than width z and height y)
  if (size.x <= size.z || size.x <= size.y) {
    return {
      valid: false,
      reason: `nose axis mismatch: length along x (${size.x.toFixed(2)}) must exceed width z (${size.z.toFixed(2)}) and height y (${size.y.toFixed(2)})`,
      meshes, geometries: geosList, materials: matsList, textures: texsList, triangles,
    };
  }

  // Ground resting alignment: wheels rest at y=0, min.y within 0.12m
  if (Math.abs(box.min.y) > 0.12) {
    return {
      valid: false,
      reason: `ground alignment error: box.min.y = ${box.min.y.toFixed(3)} is not resting near y=0`,
      meshes, geometries: geosList, materials: matsList, textures: texsList, triangles,
    };
  }

  return {
    valid: true,
    meshes,
    geometries: geosList,
    materials: matsList,
    textures: texsList,
    triangles,
  };
}

function adopt(scene: THREE.Group, validation: CandidateValidation): void {
  for (const mesh of validation.meshes) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.carBodyCanary = true;
    mesh.userData.carBodySource = 'canary';
  }
  scene.name = 'car_body_canary';
  scene.userData.dispose = releaseCarBodyCanary;
  owned = {
    group: scene,
    geometries: validation.geometries,
    materials: validation.materials,
    textures: validation.textures,
    triangles: validation.triangles,
  };
  taken = false;
}

/**
 * Load, validate, adopt and own the canary visual.
 * - Resolves 'off' without network when opted out;
 * - Synchronous loader throw-safe;
 * - Race-safe against timeout and cancellation generation;
 * - Losers of timeout/races are disposed and never flip state;
 * - Raw fallback tested ONLY if it passes all budgets.
 */
export function preloadCarBodyCanary(
  timeoutMs = 8000,
  load: LoadCarBodyScene = defaultLoad,
): Promise<CarBodyCanaryState> {
  if (!isCarBodyCanaryOptIn()) {
    state = 'off';
    return Promise.resolve(state);
  }
  if (state === 'ready' && owned && !taken) return Promise.resolve(state);
  if (flight) return flight;

  state = 'loading';
  const thisGen = ++generation;
  let adopted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const safeLoad = (url: string): Promise<THREE.Group> => {
    try {
      return Promise.resolve(load(url));
    } catch (err) {
      return Promise.reject(err);
    }
  };

  const attemptLoad = (url: string): Promise<{ scene: THREE.Group; validation: CandidateValidation }> => {
    return safeLoad(url).then((scene) => {
      if (thisGen !== generation) {
        disposeScene(scene);
        throw new Error('cancelled by generation change');
      }
      const val = validateCandidateScene(scene);
      if (!val.valid) {
        console.warn(`[car-body-canary] candidate from ${url} rejected: ${val.reason}`);
        disposeScene(scene);
        throw new Error(`validation failed: ${val.reason}`);
      }
      return { scene, validation: val };
    });
  };

  // Primary: consolidated GLB. Fallback: raw GLB (strictly budget-validated).
  const begun = attemptLoad(baseUrl() + CANARY_URL_SEGMENT).catch((err: unknown) => {
    if (thisGen !== generation) throw err;
    return attemptLoad(baseUrl() + CANARY_URL_RAW);
  });

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`car body canary load exceeded ${timeoutMs}ms`)), timeoutMs);
  });

  flight = Promise.race([begun, timeout])
    .then(({ scene, validation }) => {
      if (thisGen !== generation) {
        disposeScene(scene);
        return state;
      }
      adopt(scene, validation);
      adopted = true;
      state = 'ready';
      return state;
    })
    .catch((err: unknown) => {
      if (thisGen === generation) {
        console.warn('[car-body-canary] unavailable, procedural fallback', err);
        state = 'fallback';
      }
      return state;
    })
    .finally(() => {
      clearTimeout(timer);
      flight = null;
      void begun.then(
        ({ scene }) => {
          if (!adopted || thisGen !== generation) {
            disposeScene(scene);
          }
        },
        () => { /* load/validation rejected; already disposed or failed to construct */ },
      );
    });

  return flight;
}

/** The owned visual root, handed out exactly once. */
export function carBodyCanaryVisual(): THREE.Group | null {
  if (!owned || taken) return null;
  taken = true;
  return owned.group;
}

/**
 * Explicit disposal of the owned instance and cancellation of pending loads.
 * Idempotent, detach root from parent, deduped GPU cleanup.
 */
export function releaseCarBodyCanary(): void {
  generation++;
  disposeOwned();
  state = 'off';
}
