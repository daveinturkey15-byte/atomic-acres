/**
 * Async glTF hero-asset registry (the Blender pipeline lane owns the `.glb` bytes).
 *
 * Builder wiring (one line): `const coach = await loadAsset('coach'); group.add(coach);`
 * Sync builders, which cannot `await`, should run after the orchestrator has
 * preloaded and then call `getAsset('coach')` — both accessors hand out an
 * owned clone per call, so each builder can `group.add()` it freely.
 *
 * Main.ts orchestrator note (do NOT wire assets from here — `main.ts` stays the
 * orchestrator): before building, `await gateReadiness();`. It flips
 * `window.__NT.ready` to `false` while the preload is in flight and restores it
 * to `true` afterwards, so the capture harness never photographs the scene with
 * the coach missing.
 *
 * Conventions: metre scale with origin at ground centre and nose +x (set by the
 * Blender file); sRGB/linear handling is left to the glTF loader defaults
 * (texture `colourSpace` is never overridden); no scene/camera/renderer access;
 * no fetch happens at import time.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

declare global {
  interface ImportMetaEnv {
    BASE_URL: string;
    [key: string]: unknown;
  }
  interface ImportMeta {
    env: ImportMetaEnv;
  }
}

/** Asset names produced by the Blender pipeline lane. */
export type AssetName = 'coach' | 'authored-mountains' | 'mountain-terrain';

/** Vite `base` is relative, so this stays correct under Pages subpaths. */
export const ASSET_URLS: Record<AssetName, string> = {
  coach: `${baseUrl()}assets/coach.glb`,
  'authored-mountains': `${baseUrl()}assets/authored-mountains/authored-mountains.glb`,
  'mountain-terrain': `${baseUrl()}assets/mountain-terrain/mountain-terrain.glb`,
};

function baseUrl(): string {
  try {
    const base: unknown = import.meta.env.BASE_URL;
    if (typeof base === 'string' && base.length > 0) return base;
  } catch {
    /* Non-vite unit context: fall through to the relative default. */
  }
  return './';
}

let loader: GLTFLoader | undefined;
/** Pristine decoded scenes. Never handed out directly — see the clone policy. */
const masters = new Map<AssetName, THREE.Group>();
/** In-flight loads, so concurrent callers share one fetch + decode. */
const pending = new Map<AssetName, Promise<THREE.Group>>();
/** Names released for the rest of the page lifetime (pagehide lane). */
const released = new Set<AssetName>();


/** Resolves when the latest gated preload settles; initially resolved. */
export let assetsReady: Promise<void> = Promise.resolve();

function assertKnown(name: string): asserts name is AssetName {
  if (!(name in ASSET_URLS)) throw new RangeError(`unknown asset: ${name}`);
}

/**
 * Ensure `name` is loaded, sharing one in-flight fetch between concurrent
 * callers, and resolve to the cached master scene.
 */
function ensureLoaded(name: AssetName): Promise<THREE.Group> {
  if (released.has(name)) {
    return Promise.reject(new Error(`asset released for page lifetime: ${name}`));
  }
  const hit = masters.get(name);
  if (hit) return Promise.resolve(hit);
  const flight = pending.get(name);
  if (flight) return flight;
  loader ??= new GLTFLoader();
  const started = loader
    .loadAsync(ASSET_URLS[name])
    .then((gltf) => {
      pending.delete(name);
      const master = gltf.scene;
      master.updateMatrixWorld(true);
      master.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      if (released.has(name)) {
        disposeScene(master);
        return master;
      }
      masters.set(name, master);
      return master;
    })
    .catch((err: unknown) => {
      pending.delete(name);
      throw err;
    });
  pending.set(name, started);
  return started;
}

/**
 * Load `name` and resolve to an owned deep clone of the cached scene.
 *
 * Clone policy: every call returns a fresh `clone(true)`; clones share
 * geometries/materials/textures with the cached master, so there is no extra
 * GPU upload. A scene node can only have one parent, hence clones rather than
 * the shared master. Detach clones from the scene before `disposeAssets()`.
 */
export function loadAsset(name: AssetName): Promise<THREE.Group> {
  assertKnown(name);
  return ensureLoaded(name).then((master) => master.clone(true));
}

/** Preload assets (default: all). Resolves once every requested scene is cached. */
export function preloadAssets(names?: string[]): Promise<void> {
  const wanted: AssetName[] =
    names === undefined
      ? (Object.keys(ASSET_URLS) as AssetName[])
      : names.map((entry) => {
          assertKnown(entry);
          return entry;
        });
  return Promise.all(wanted.map((name) => ensureLoaded(name))).then(() => undefined);
}

/**
 * Return an owned clone of the cached scene, or `undefined` when `name` has
 * not finished loading. Unknown names also yield `undefined` (never throws).
 */
export function getAsset(name: string): THREE.Group | undefined {
  if (!(name in ASSET_URLS)) return undefined;
  const master = masters.get(name as AssetName);
  return master?.clone(true);
}

/**
 * Release GPU resources of all cached scenes (geometries, materials and their
 * textures). Callers must detach clones from the scene first — clones share
 * the master's buffers, so disposing while a clone is still mounted corrupts
 * it. Afterwards the registry is empty and the next load fetches afresh.
 */
export function disposeAssets(): void {
  for (const master of masters.values()) {
    disposeScene(master);
  }
  masters.clear();
  pending.clear();
}

const disposedMasters = new WeakSet<THREE.Object3D>();

/**
 * Deep-dispose one scene's GPU resources (geometries, materials, textures)
 * with Set-based deduplication per release. Meshes sharing geometry,
 * materials sharing textures, or packed ORM textures wired to multiple
 * slots (roughnessMap, metalnessMap, aoMap) are disposed exactly once.
 */
export function disposeScene(master: THREE.Object3D): void {
  if (disposedMasters.has(master)) return;
  disposedMasters.add(master);

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  master.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      geometries.add(mesh.geometry);
    }
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const mat of mats) {
      if (mat && typeof mat.dispose === 'function') {
        materials.add(mat);
      }
    }
  });

  for (const mat of materials) {
    const record = mat as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const val = record[key];
      if (
        val !== null &&
        typeof val === 'object' &&
        (val as { isTexture?: boolean }).isTexture === true &&
        typeof (val as { dispose?: () => void }).dispose === 'function'
      ) {
        textures.add(val as THREE.Texture);
      }
    }
  }

  for (const tex of textures) {
    try {
      tex.dispose();
    } catch {
      /* idempotent dispose */
    }
  }
  for (const mat of materials) {
    try {
      mat.dispose();
    } catch {
      /* idempotent dispose */
    }
  }
  for (const geom of geometries) {
    try {
      geom.dispose();
    } catch {
      /* idempotent dispose */
    }
  }
}

/**
 * Release ONE cached scene for the rest of the page lifetime. The pagehide
 * lane for opt-in assets (authored-mountains). Never touches other cached
 * assets (coach) or scene objects, and is exactly-once:
 * - never loaded: the name is retired, so nothing fetches it afterwards;
 * - pending: the in-flight load completes safely, then the late master is
 *   dropped from the cache and disposed without being retained;
 * - cached: disposed once. Callers detach clones FIRST (clones share the
 *   master's buffers; disposing under a mounted clone corrupts it).
 * Unknown names are a silent no-op. Repeat calls after the first do nothing.
 */
export function releaseAsset(name: string): void {
  if (!(name in ASSET_URLS)) return;
  const key = name as AssetName;
  if (released.has(key)) return;
  released.add(key);

  const master = masters.get(key);
  if (master) {
    masters.delete(key);
    disposeScene(master);
  }

  const flight = pending.get(key);
  if (flight) {
    pending.delete(key);
    void flight.then(
      (late) => {
        masters.delete(key);
        disposeScene(late);
      },
      () => {
        /* a failed pending load has nothing to dispose; caught to avoid unhandled rejection */
      },
    );
  }
}

function readinessSlot(): { ready: boolean } | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return (window as unknown as { __NT?: { ready: boolean } }).__NT;
  } catch {
    return undefined;
  }
}

/**
 * Preload assets while holding the capture-harness gate: sets
 * `window.__NT.ready = false` first and restores `true` once the preload
 * settles (success or failure — the harness must never hang). Never throws for
 * a missing `__NT` (e.g. unit context); load failures still propagate to the
 * caller after the flag is restored. Also refreshes `assetsReady`.
 */
export function gateReadiness(names?: string[]): Promise<void> {
  const slot = readinessSlot();
  if (slot) slot.ready = false;
  const run = preloadAssets(names).then(
    () => {
      if (slot) slot.ready = true;
    },
    (err: unknown) => {
      if (slot) slot.ready = true;
      throw err;
    },
  );
  assetsReady = run;
  return run;
}
