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
export type AssetName = 'coach';

/** Vite `base` is relative, so this stays correct under Pages subpaths. */
export const ASSET_URLS: Record<AssetName, string> = {
  coach: `${baseUrl()}assets/coach.glb`,
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
  const hit = masters.get(name);
  if (hit) return Promise.resolve(hit);
  const flight = pending.get(name);
  if (flight) return flight;
  loader ??= new GLTFLoader();
  const started = loader
    .loadAsync(ASSET_URLS[name])
    .then((gltf) => {
      const master = gltf.scene;
      master.updateMatrixWorld(true);
      master.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      masters.set(name, master);
      pending.delete(name);
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
    master.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const material of materials) {
        const record = material as unknown as Record<string, unknown>;
        for (const key of Object.keys(record)) {
          const value = record[key] as { isTexture?: boolean; dispose?: () => void };
          if (
            value !== null &&
            typeof value === 'object' &&
            value.isTexture === true &&
            typeof value.dispose === 'function'
          ) {
            value.dispose();
          }
        }
        material.dispose();
      }
    });
  }
  masters.clear();
  pending.clear();
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
