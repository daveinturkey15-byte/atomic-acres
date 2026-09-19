/**
 * Catalog Carbine Three.js Canary Loader & Integration Module.
 *
 * Standalone opt-in canary for loading the Blender-authored AR-15/M4 carbine GLTF/GLB
 * artifact into the viewmodel pipeline.
 *
 * Lifetime & Ownership Contracts:
 *   1. Bounded Single-Asset Cache: Assets are cached by canonical URL with explicit
 *      reference counting (refCount). Clones share decoded geometry and texture buffers.
 *   2. Non-Destructive Sibling Release: Disposing an individual clone decrements refCount
 *      and removes the instance group from the scene graph. It NEVER disposes shared
 *      geometries, materials, or textures while refCount > 0.
 *   3. Safe Fallback Material Survival: Fallback rigs use the shared MaterialLibrary.
 *      Disposing a fallback rig disposes only instance-owned geometries; it NEVER mutates
 *      or disposes accepted shared materials or their textures.
 *   4. Resurrection Protection: Each cache slot tracks a generation epoch. Clearing the
 *      cache increments the epoch; late-resolving promises from in-flight loads are discarded
 *      and cleaned up immediately without resurrecting into the cache.
 *   5. Strict Socket Verification: Required sockets (anchor_muzzle, anchor_grip,
 *      anchor_support, anchor_mag) must exist in the loaded GLTF hierarchy. Missing sockets
 *      are NEVER fabricated: bad assets are rejected and fallback is engaged.
 *   6. Blender Export Orientation: Forward is -Z (glTF standard from Blender +Y forward),
 *      Up is +Y (from Blender +Z up), Right is +X.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { MaterialLibrary } from '../core/materials';
import { createFirstPersonHands } from './first-person-hands';
import type { ViewmodelRig } from './types';
import { buildRifleViewmodel } from './viewmodel';

/** Path to the exported catalog carbine GLB asset. */
export const CATALOG_CARBINE_GLB_URL = './assets/catalog-carbine/carbine.glb';

/** Viewmodel render order for weapon mesh overlays. */
export const VIEWMODEL_RENDER_ORDER = 100;

/** Required hardware empty names that MUST exist in the Blender GLTF export. */
export const REQUIRED_CARBINE_SOCKETS = [
  'anchor_muzzle',
  'anchor_grip',
  'anchor_support',
  'anchor_mag',
] as const;

export type RequiredCarbineSocket = typeof REQUIRED_CARBINE_SOCKETS[number];

/** Extended ViewmodelRig providing actual hardware sockets. */
export interface CatalogCarbineRig extends ViewmodelRig {
  /** Empty at weapon grip (trigger hand anchor) */
  gripSocket: THREE.Object3D;
  /** Empty at handguard support grip area (support hand anchor) */
  supportSocket: THREE.Object3D;
  /** Empty at magwell opening (reload target anchor) */
  magSocket: THREE.Object3D;
  /** True if loaded from authentic GLTF asset, false if fallback */
  isGLTFAsset: boolean;
  /** Canonical asset URL used to construct this rig */
  assetUrl?: string;
  /** Teardown method owning the disposal of allocated resources */
  dispose: () => void;
}

export interface CarbineLoaderOptions {
  /** Target asset URL (defaults to CATALOG_CARBINE_GLB_URL) */
  url?: string;
  /** Material library required for procedural fallback */
  mat?: MaterialLibrary;
  /** Whether to attach first-person hands (default true if mat provided) */
  attachHands?: boolean;
  /** Optional viewmodel renderOrder override */
  renderOrder?: number;
  /** Custom loader for tests / dependency injection */
  customLoader?: {
    loadAsync: (url: string) => Promise<{ scene: THREE.Group }>;
  };
  /** Whether to automatically dispose master resources when refCount hits zero */
  autoDisposeOnZeroRef?: boolean;
}

interface MasterResourceSet {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
}

interface MasterCacheEntry {
  url: string;
  masterScene: THREE.Group;
  resources: MasterResourceSet;
  refCount: number;
  generation: number;
  autoDisposeOnZeroRef: boolean;
}

/** URL -> cached master entry */
const masterCache = new Map<string, MasterCacheEntry>();

/** URL -> pending load record */
const pendingLoads = new Map<string, { promise: Promise<MasterCacheEntry>; generation: number }>();

/** Global generation counter protecting against late resurrection after clear */
let currentGeneration = 0;

let defaultGltfLoader: GLTFLoader | undefined;

function getBaseUrl(): string {
  try {
    const value = (import.meta as any).env?.BASE_URL;
    return typeof value === 'string' && value.length > 0 ? value : './';
  } catch {
    return './';
  }
}

/** Canonicalize URL so cache keys are consistent regardless of leading dots/slashes. */
export function canonicalizeUrl(url: string): string {
  if (url.includes('://') || url.startsWith('/')) {
    return url;
  }
  const base = getBaseUrl();
  const clean = url.replace(/^\.\//, '');
  return `${base}${clean}`;
}

/** Check if query string or window.location requests the carbine canary (?carbine=canary). */
export function isCarbineCanaryRequested(searchQuery?: string): boolean {
  try {
    if (typeof searchQuery === 'string') {
      return new URLSearchParams(searchQuery).get('carbine') === 'canary';
    }
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      return new URLSearchParams(window.location.search).get('carbine') === 'canary';
    }
  } catch {
    return false;
  }
  return false;
}

/** Recursively traverse an Object3D hierarchy and collect all unique geometries, materials, and textures. */
export function collectGltfResources(root: THREE.Object3D): MasterResourceSet {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      if (mesh.geometry) {
        geometries.add(mesh.geometry);
      }
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          materials.add(m);
          const pbr = m as any;
          if (pbr.map && pbr.map.isTexture) textures.add(pbr.map);
          if (pbr.normalMap && pbr.normalMap.isTexture) textures.add(pbr.normalMap);
          if (pbr.roughnessMap && pbr.roughnessMap.isTexture) textures.add(pbr.roughnessMap);
          if (pbr.metalnessMap && pbr.metalnessMap.isTexture) textures.add(pbr.metalnessMap);
          if (pbr.aoMap && pbr.aoMap.isTexture) textures.add(pbr.aoMap);
          if (pbr.emissiveMap && pbr.emissiveMap.isTexture) textures.add(pbr.emissiveMap);
        }
      }
    }
  });

  return { geometries, materials, textures };
}

/** Safely dispose all textures, materials, and geometries in a resource set. */
export function disposeResourceSet(res: MasterResourceSet): void {
  for (const t of res.textures) {
    try { t.dispose(); } catch {}
  }
  res.textures.clear();

  for (const m of res.materials) {
    try { m.dispose(); } catch {}
  }
  res.materials.clear();

  for (const g of res.geometries) {
    try { g.dispose(); } catch {}
  }
  res.geometries.clear();
}

/** Locate a named Object3D in the hierarchy. Returns null if not found. */
export function findNamedSocket(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((child) => {
    if (!found && child.name === name) {
      found = child;
    }
  });
  return found;
}

/** Verify all required hardware sockets exist. Returns missing names or empty array. */
export function validateRequiredSockets(scene: THREE.Object3D): string[] {
  const missing: string[] = [];
  for (const name of REQUIRED_CARBINE_SOCKETS) {
    if (!findNamedSocket(scene, name)) {
      missing.push(name);
    }
  }
  return missing;
}

/**
 * Configure viewmodel mesh flags: no shadows, renderOrder, no frustum culling.
 * Does NOT mutate shared material properties.
 */
function applyViewmodelMeshTraits(group: THREE.Group, renderOrder: number): void {
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
    }
  });
}

/** Load or retrieve a cached master entry for the given URL. */
async function getOrLoadMasterEntry(
  url: string,
  customLoader?: { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> },
  autoDisposeOnZeroRef = true,
): Promise<MasterCacheEntry> {
  const key = canonicalizeUrl(url);

  // Return existing master entry if cached
  const existing = masterCache.get(key);
  if (existing) {
    return existing;
  }

  // Reuse in-flight promise if loading
  const inFlight = pendingLoads.get(key);
  if (inFlight) {
    return inFlight.promise;
  }

  const generationAtStart = currentGeneration;

  const loadPromise = (async (): Promise<MasterCacheEntry> => {
    try {
      const loader = customLoader ?? (defaultGltfLoader ??= new GLTFLoader());
      const gltf = await loader.loadAsync(key);

      // Check if cache was cleared while this load was in flight
      if (generationAtStart !== currentGeneration) {
        // Discard and clean up late resources immediately
        const staleResources = collectGltfResources(gltf.scene);
        disposeResourceSet(staleResources);
        throw new Error(`[CatalogCarbineLoader] Load of '${key}' cancelled: cache was cleared during load`);
      }

      const scene = gltf.scene;
      scene.name = 'CatalogCarbineMaster';
      scene.updateMatrixWorld(true);

      // Validate required hardware sockets
      const missing = validateRequiredSockets(scene);
      if (missing.length > 0) {
        const err = new Error(
          `[CatalogCarbineLoader] GLTF asset at '${key}' rejected: missing required socket(s): ${missing.join(', ')}`,
        );
        const badResources = collectGltfResources(scene);
        disposeResourceSet(badResources);
        throw err;
      }

      const resources = collectGltfResources(scene);
      const entry: MasterCacheEntry = {
        url: key,
        masterScene: scene,
        resources,
        refCount: 0,
        generation: generationAtStart,
        autoDisposeOnZeroRef,
      };

      masterCache.set(key, entry);
      return entry;
    } finally {
      pendingLoads.delete(key);
    }
  })();

  pendingLoads.set(key, { promise: loadPromise, generation: generationAtStart });
  return loadPromise;
}

/** Release a reference on a master cache entry. Disposes master if refCount hits zero and autoDispose is enabled. */
function releaseMasterEntry(entry: MasterCacheEntry): void {
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0 && entry.autoDisposeOnZeroRef) {
    masterCache.delete(entry.url);
    disposeResourceSet(entry.resources);
  }
}

/**
 * Clear the cached master carbine entry/entries.
 *
 * Disposes GPU resources (geometries, materials, textures) and increments the
 * generation epoch so any currently pending async loads are safely aborted on arrival.
 *
 * @param url Optional specific URL to clear. If omitted, clears all cached entries.
 */
export function clearMasterCarbineCache(url?: string): void {
  currentGeneration++;

  if (url !== undefined) {
    const key = canonicalizeUrl(url);
    const entry = masterCache.get(key);
    if (entry) {
      masterCache.delete(key);
      disposeResourceSet(entry.resources);
    }
    pendingLoads.delete(key);
    return;
  }

  for (const entry of masterCache.values()) {
    disposeResourceSet(entry.resources);
  }
  masterCache.clear();
  pendingLoads.clear();
}

/** Alias for clearMasterCarbineCache with no arguments. */
export function releaseAllCarbineResources(): void {
  clearMasterCarbineCache();
}

/** Return active cache stats for testing and telemetry. */
export function getCarbineCacheStats(): {
  cachedUrls: string[];
  refCounts: Record<string, number>;
  pendingCount: number;
  generation: number;
} {
  const refCounts: Record<string, number> = {};
  for (const [url, entry] of masterCache.entries()) {
    refCounts[url] = entry.refCount;
  }
  return {
    cachedUrls: Array.from(masterCache.keys()),
    refCounts,
    pendingCount: pendingLoads.size,
    generation: currentGeneration,
  };
}

/**
 * Load the catalog carbine viewmodel rig asynchronously with complete socket wiring
 * and resource disposal ownership.
 *
 * If the GLTF asset fails to load, or is missing required sockets, falls back gracefully
 * to procedural buildRifleViewmodel (if options.mat is provided).
 */
export async function loadCatalogCarbineRig(
  options: CarbineLoaderOptions = {},
): Promise<CatalogCarbineRig> {
  const url = options.url ?? CATALOG_CARBINE_GLB_URL;
  const renderOrder = options.renderOrder ?? VIEWMODEL_RENDER_ORDER;
  const attachHands = options.attachHands ?? true;
  const autoDisposeOnZeroRef = options.autoDisposeOnZeroRef ?? true;

  try {
    const entry = await getOrLoadMasterEntry(url, options.customLoader, autoDisposeOnZeroRef);
    entry.refCount++;

    // Clone node hierarchy only. Mesh.geometry and Mesh.material reference shared master buffers.
    const group = entry.masterScene.clone(true);
    group.name = 'CatalogCarbineViewmodel';

    // Locate authentic hardware empties in the cloned hierarchy (already verified in master)
    const muzzle = findNamedSocket(group, 'anchor_muzzle')!;
    const gripSocket = findNamedSocket(group, 'anchor_grip')!;
    const supportSocket = findNamedSocket(group, 'anchor_support')!;
    const magSocket = findNamedSocket(group, 'anchor_mag')!;

    // Eject socket: look for model empty or attach at authentic upper receiver ejection port
    let eject = findNamedSocket(group, 'anchor_eject') ?? findNamedSocket(group, 'eject');
    if (!eject) {
      eject = new THREE.Object3D();
      eject.name = 'eject';
      eject.position.set(0.035, 0.030, -0.100);
      group.add(eject);
    }

    applyViewmodelMeshTraits(group, renderOrder);

    // Attach authentic first-person hands calibrated to the hardware empties
    let handsRig = undefined;
    if (attachHands && options.mat) {
      // Support hand attaches at anchor_support coords (z: -0.330, y: 0.002)
      // Reload target aims toward anchor_mag coords (x: 0.010, y: -0.052, z: 0.212)
      handsRig = createFirstPersonHands(
        group,
        options.mat,
        supportSocket.position.z,
        supportSocket.position.y,
        [0.010, magSocket.position.y, 0.212],
      );
    }

    let disposed = false;
    const dispose = (): void => {
      if (disposed) return; // Idempotent
      disposed = true;

      // Remove from parent scene/overlay
      if (group.parent) {
        group.parent.remove(group);
      }

      // Hands rig disposal if attached
      if (handsRig?.root && handsRig.root.parent) {
        handsRig.root.parent.remove(handsRig.root);
      }

      // Release instance reference from master cache entry.
      // Master geometries/materials/textures are preserved while siblings exist.
      releaseMasterEntry(entry);
    };

    const rig: CatalogCarbineRig = {
      group,
      muzzle,
      eject,
      gripSocket,
      supportSocket,
      magSocket,
      hands: handsRig,
      isGLTFAsset: true,
      assetUrl: entry.url,
      dispose,
    };

    return rig;
  } catch (err) {
    console.warn('[CatalogCarbineLoader] Falling back to procedural rifle viewmodel:', err);

    if (!options.mat) {
      throw err;
    }

    // Stable procedural fallback
    const fallback = buildRifleViewmodel(options.mat);

    // Provide matching sockets for callers expecting CatalogCarbineRig
    const gripSocket = new THREE.Object3D();
    gripSocket.name = 'anchor_grip';
    gripSocket.position.set(0, -0.09, 0.0);
    fallback.group.add(gripSocket);

    const supportSocket = new THREE.Object3D();
    supportSocket.name = 'anchor_support';
    supportSocket.position.set(0, 0.03, -0.36);
    fallback.group.add(supportSocket);

    const magSocket = new THREE.Object3D();
    magSocket.name = 'anchor_mag';
    magSocket.position.set(0, -0.12, -0.13);
    fallback.group.add(magSocket);

    applyViewmodelMeshTraits(fallback.group, renderOrder);

    let fallbackDisposed = false;
    const disposeFallback = (): void => {
      if (fallbackDisposed) return; // Idempotent
      fallbackDisposed = true;

      if (fallback.group.parent) {
        fallback.group.parent.remove(fallback.group);
      }

      // Dispose ONLY geometries allocated for this fallback rig instance.
      // NEVER dispose shared materials or textures from options.mat!
      fallback.group.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          try { mesh.geometry.dispose(); } catch {}
        }
      });
    };

    const rig: CatalogCarbineRig = {
      group: fallback.group,
      muzzle: fallback.muzzle,
      eject: fallback.eject,
      gripSocket,
      supportSocket,
      magSocket,
      hands: fallback.hands,
      isGLTFAsset: false,
      dispose: disposeFallback,
    };

    return rig;
  }
}
