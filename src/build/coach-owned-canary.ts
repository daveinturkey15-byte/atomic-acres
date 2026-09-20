/**
 * OWNED COACH CANARY (?coach=canary) - the baked coach GLB as an exclusively
 * owned resource root.
 *
 * Why this file exists: the muse0418 lane handed `loadAsset('coach')` clones
 * (which SHARE geometry/materials with the cached master) to the vehicles
 * builder, and `batchStatic` then disposed the merged source geometries - the
 * cached master with them. This lane replaces that approach with a small,
 * coach-specific ownership boundary instead of another blind patch:
 *
 *  - the file is fetched and parsed HERE, through this module's own loader;
 *    `core/assets.ts` and its cache are never involved (its `coach` URL also
 *    still names a file that was never baked);
 *  - the parsed scene is the ONLY live copy: nothing else references it, so
 *    explicit disposal can only ever touch this root's own GPU resources;
 *  - the visual never merges into the static batch (vehicles.ts passes a
 *    `keep` predicate keyed on the `coachOwnedCanary` marker set in `adopt`),
 *    so `batchStatic`'s source-geometry disposal cannot reach it either;
 *  - `releaseCoachOwnedCanary()` is idempotent and single-shot per instance;
 *    a fresh `preloadCoachOwnedCanary()` after a release remounts from a new
 *    parse (two sequential instances share nothing by reference).
 *
 * Conventions kept from the registry it deliberately bypasses: metre scale,
 * origin at ground centre, nose +x (set by the Blender file); sRGB/linear
 * handling is left to the glTF loader defaults; no scene/camera/renderer
 * access; no fetch at import time; a miss resolves 'fallback' and the
 * vehicles builder keeps the procedural coach - the map is complete and
 * finite whether or not this lane is on, and never retries per frame.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** The baked candidate. ROOT copies asset sources, not this lane. */
const CANARY_URL_SEGMENT = 'assets/coach-geometry-0824.consolidated.glb';

export type CoachOwnedCanaryState = 'off' | 'loading' | 'ready' | 'fallback';

/** Loader seam: production resolves the glTF scene; falsifiers inject one. */
export type LoadCoachScene = (url: string) => Promise<THREE.Group>;

let state: CoachOwnedCanaryState = 'off';
let flight: Promise<CoachOwnedCanaryState> | null = null;
/** The one owned instance. Null once released (or before the first load). */
let owned: OwnedInstance | null = null;
/** The visual is handed out exactly once; vehicles.ts is the only taker. */
let taken = false;

interface OwnedInstance {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

/** Vite `base` is relative, so this stays correct under Pages subpaths.
 *  Duplicated from core/assets.ts on purpose: this lane is not the registry. */
function baseUrl(): string {
  try {
    const base: unknown = import.meta.env.BASE_URL;
    if (typeof base === 'string' && base.length > 0) return base;
  } catch {
    /* Non-vite unit context: fall through to the relative default. */
  }
  return './';
}

/** Opt-in: ?coach=canary only, or the QA override global. Same shape as
 *  isFacadeDetailCanaryOptIn() in main.ts / isMountainTerrainOptIn(). */
export function isCoachOwnedCanaryOptIn(): boolean {
  const g = globalThis as { __NT_OVERRIDE_COACH_OWNED__?: boolean };
  if (typeof g.__NT_OVERRIDE_COACH_OWNED__ === 'boolean') return g.__NT_OVERRIDE_COACH_OWNED__;
  if (typeof window !== 'undefined' && window.location?.search) {
    const v = new URLSearchParams(window.location.search).get('coach')?.toLowerCase();
    return v === 'canary';
  }
  return false;
}

/** Current lane state. 'ready' is the only value the visual factory honours. */
export function coachOwnedCanaryState(): CoachOwnedCanaryState {
  return state;
}
/** Read-only actual-adoption status. ROOT verifies REAL geometry, not fetch
 * alone: `mounted` is true only while the owned root is handed out and still
 * live (not released), with live mesh/material counts from the adopted scene.
 * `taken` distinguishes "ready but not yet placed" from "placed in vehicles".
 * Counts are from the owned sets collected in adopt(); batchStatic never merges
 * this root (vehicles.ts passes `keep`), so mesh count is the GLB mesh count
 * and material count is the <=6 draw-group target. No scene/renderer access. */
export interface CoachOwnedCanaryReport {
  optIn: boolean;
  state: CoachOwnedCanaryState;
  mounted: boolean;
  taken: boolean;
  meshes: number;
  materials: number;
  geometries: number;
  textures: number;
}
export function coachOwnedCanaryReport(): CoachOwnedCanaryReport {
  let meshes = 0;
  if (owned) {
    owned.group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes++;
    });
  }
  return {
    optIn: isCoachOwnedCanaryOptIn(),
    state,
    mounted: owned !== null,
    taken,
    meshes,
    materials: owned ? owned.materials.length : 0,
    geometries: owned ? owned.geometries.length : 0,
    textures: owned ? owned.textures.length : 0,
  };
}

function defaultLoad(url: string): Promise<THREE.Group> {
  return new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
}

/** Narrow an unknown material property slot to a texture without casting. */
function isTexture(value: unknown): value is THREE.Texture {
  return typeof value === 'object' && value !== null
    && 'isTexture' in value
    && value.isTexture === true;
}

/** Every texture a material references, in stable property order. */
function texturesOf(m: THREE.Material): THREE.Texture[] {
  const found: THREE.Texture[] = [];
  for (const value of Object.values(m as unknown as Record<string, unknown>)) {
    if (isTexture(value)) found.push(value);
  }
  return found;
}

/**
 * Load, adopt and own the canary visual. Resolves 'off' without touching the
 * network when the lane is not opted in; resolves 'fallback' (warn once) on
 * fetch error or after `timeoutMs`, and disposes a late-arriving scene so a
 * loser of the timeout race can never leak or flip the state back. Concurrent
 * callers share one flight; callers after a release start a fresh parse.
 */
export function preloadCoachOwnedCanary(
  timeoutMs = 8000,
  load: LoadCoachScene = defaultLoad,
): Promise<CoachOwnedCanaryState> {
  if (!isCoachOwnedCanaryOptIn()) {
    state = 'off';
    return Promise.resolve(state);
  }
  if (state === 'ready' && owned && !taken) return Promise.resolve(state);
  if (flight) return flight;

  state = 'loading';
  const begun = load(baseUrl() + CANARY_URL_SEGMENT).then((scene) => ({ scene }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`coach canary load exceeded ${timeoutMs}ms`)), timeoutMs);
  });
  // True once this flight's winner has been adopted. The finally-block loser
  // disposal must only free a scene that LOST the race: unconditionally
  // disposing `begun` also disposed the just-adopted owned instance (the
  // preserved 0556 partial did exactly that), leaving ready-state GPU
  // resources disposed while still mounted.
  let adopted = false;

  flight = Promise.race([begun, timeout])
    .then(({ scene }) => {
      adopt(scene);
      adopted = true;
      state = 'ready';
      return state;
    })
    .catch((err: unknown) => {
      console.warn('[coach-owned-canary] unavailable, procedural fallback', err);
      state = 'fallback';
      return state;
    })
    .finally(() => {
      clearTimeout(timer);
      flight = null;
      // The timeout loser may still be in flight. Dispose it whenever it
      // lands; it must never be adopted and never flip the settled state.
      // Skipped when this flight already adopted `begun` (adopted === true).
      void begun.then(
        ({ scene }) => { if (!adopted) disposeScene(scene); },
        () => { /* the load itself failed; nothing was created */ },
      );
    });
  return flight;
}

/**
 * The owned visual root, handed out exactly once. Null unless a preload has
 * resolved 'ready' and vehicles.ts has not taken it yet. After `release` a
 * new preload builds a fresh instance; the previous one is gone for good.
 */
export function coachOwnedCanaryVisual(): THREE.Group | null {
  if (!owned || taken) return null;
  taken = true;
  return owned.group;
}

/**
 * Explicit disposal of the owned instance. Idempotent: the first call frees
 * every geometry, material and texture exactly once; later calls are no-ops.
 * Never touches the shared asset cache (it was never involved) and never
 * touches scene-external singletons (ctx.mat stays live; rendering continues).
 */
export function releaseCoachOwnedCanary(): void {
  if (!owned) return;
  disposeOwned();
  state = 'fallback';
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

/** Free one scene we own but never adopted (timeout race loser). */
function disposeScene(scene: THREE.Object3D): void {
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      for (const tex of texturesOf(m)) tex.dispose();
      m.dispose();
    }
  });
}

/**
 * Take exclusive ownership of a freshly parsed scene: shadow flags to the
 * registry convention, the batcher-exclusion marker on every mesh, unique
 * GPU resource lists for explicit disposal, and the skyline-style
 * `userData.dispose` handle (idempotent, so pagehide and QA share it).
 */
function adopt(scene: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.coachOwnedCanary = true;
    geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      materials.add(m);
      for (const tex of texturesOf(m)) textures.add(tex);
    }
  });
  scene.name = 'coach_owned_canary';
  scene.userData.dispose = releaseCoachOwnedCanary;
  owned = {
    group: scene,
    geometries: [...geometries],
    materials: [...materials],
    textures: [...textures],
  };
  taken = false;
}
