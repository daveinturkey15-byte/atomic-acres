/**
 * Roster Heroes loader — bounded GLB viewmodel integration for the three
 * authored hero guns (MP5, M14 EBR, LMG). Opt-in via ?heroes=canary; the
 * default roster is untouched until looked-at acceptance.
 *
 * This module mirrors the proven catalog-carbine-loader contracts (bounded
 * single-asset cache, refCount + generation epoch + orphan-on-clear, strict
 * socket verification, procedural fallback on any error, shared-material
 * survival) for THREE assets instead of one. It changes nothing in the
 * carbine lane and reuses its exported primitives.
 *
 * Lifetime & Ownership Contracts (bounded, three assets):
 *   1. Bounded cache: at most MAX_ROSTER_HERO_CACHE_ENTRIES (3) master
 *      entries, one per hero URL — the URL table is closed, so the bound is
 *      structural; getRosterHeroCacheStats() exposes it for QA.
 *   2. refCount sharing: clones share decoded geometry/texture buffers;
 *      per-instance dispose releases its reference only.
 *   3. Orphan-on-clear: clearing while clones are live never disposes shared
 *      master resources out from under siblings; the entry is orphaned and
 *      disposes on last release. Generation epochs discard late in-flight
 *      loads; pending-map removal is promise-identity guarded.
 *   4. Strict verification: the SAME four anchor_* sockets as the carbine
 *      PLUS the authored magazine/ammo-box node MUST exist. Missing anything
 *      rejects the asset and engages the procedural fallback — sockets are
 *      never fabricated on the GLB path.
 *   5. Reload pivot: the authored magazine node is re-parented under
 *      anchor_mag via Object3D.attach (world transform preserved = baked
 *      offset kept); reload swings it about the anchor, never about its own
 *      origin. Mag meshes are at identity transforms in the GLB, so this is
 *      transform-only and safe across clones sharing buffers.
 *   6. Hands connect to ACTUAL anchors: support hand at anchor_support
 *      (loaded coords), reload target = anchor_mag (loaded coords). No
 *      hardcoded carbine numbers.
 *   7. Orientation: forward -Z, up +Y, right +X (Blender +Y forward via
 *      export_yup) — identical to the carbine lane.
 *   8. Material survival: GLB materials stay inside the asset and are
 *      disposed only by the master entry lifecycle. MaterialLibrary
 *      singletons (fallback rigs, hands) are NEVER disposed here.
 *
 * `eject` is the one synthesized anchor (as in the carbine lane): it is a
 * presentation-only shell-spawn frame at a fixed receiver offset, NOT an
 * authored socket, and its absence never rejects an asset.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { MaterialLibrary } from '../core/materials';
import {
  canonicalizeUrl,
  collectGltfResources,
  disposeOwnedGeometries,
  disposeResourceSet,
  findNamedSocket,
  validateRequiredSockets,
  VIEWMODEL_RENDER_ORDER,
} from './catalog-carbine-loader';
import { createFirstPersonHands } from './first-person-hands';
import { FAMILY_FALLBACK, weaponFamily, type FallbackRig } from './families';
import type { FirstPersonHandsRig, ViewmodelRig } from './types';
import {
  buildPistolViewmodel,
  buildRifleViewmodel,
  buildShotgunViewmodel,
  buildSmgViewmodel,
  buildSniperViewmodel,
} from './viewmodel';

/** Authored hero GLB URLs, keyed by their own playable catalog ids. */
export const ROSTER_HERO_GLB_URLS = {
  mp5: './assets/roster-heroes/mp5.glb',
  'm14-ebr': './assets/roster-heroes/m14-ebr.glb',
  lmg: './assets/roster-heroes/lmg.glb',
} as const;

export type RosterHeroWeaponId = keyof typeof ROSTER_HERO_GLB_URLS;

/** Playable ids served by this lane, in catalog order. */
export const ROSTER_HERO_WEAPON_IDS: readonly RosterHeroWeaponId[] = [
  'mp5',
  'm14-ebr',
  'lmg',
];

/** The cache never holds more than the three known hero URLs. */
export const MAX_ROSTER_HERO_CACHE_ENTRIES = ROSTER_HERO_WEAPON_IDS.length;

/**
 * The authored magazine object per gun, straight from
 * work/roster-heroes/manifest.json. Required: a hero asset without its real
 * magazine node is a bad asset and falls back (anchor_mag must parent a real
 * reload object — a mag-less hero would animate an invisible pivot).
 */
const ROSTER_HERO_MAGAZINE_NODES: Readonly<
  Record<RosterHeroWeaponId, string>
> = Object.freeze({
  mp5: 'mp5_magazine',
  'm14-ebr': 'ebr_magazine',
  lmg: 'lmg_ammo_box',
});

/**
 * Family fallback builders, resolved through families.ts
 * (`FAMILY_FALLBACK[weaponFamily(id)]`) so the stand-in rig is exactly the
 * one the controller rendered before adoption: mp5 → smg → buildSmgViewmodel;
 * m14-ebr → dmr → buildSniperViewmodel; lmg → rifle → buildRifleViewmodel.
 * All five rows are shipped builders; heroes only reach rifle/smg/sniper today.
 */
const HERO_FALLBACK_BUILDERS: Readonly<
  Record<FallbackRig, (mat: MaterialLibrary) => ViewmodelRig>
> = Object.freeze({
  rifle: buildRifleViewmodel,
  smg: buildSmgViewmodel,
  shotgun: buildShotgunViewmodel,
  sniper: buildSniperViewmodel,
  pistol: buildPistolViewmodel,
});

/** Reload swing of the magazine about anchor_mag, radians at mid-reload. */
const MAG_SWING_RADIANS = 0.85;

/** Presentation-only shell-spawn offset (see module doc, contract 8 note). */
const EJECT_FALLBACK_OFFSET = new THREE.Vector3(0.035, 0.03, -0.1);

/** Extended ViewmodelRig for an authored hero gun. */
export interface RosterHeroRig extends ViewmodelRig {
  /** Loaded hero id — one of ROSTER_HERO_WEAPON_IDS. */
  weaponId: RosterHeroWeaponId;
  /** Empty at the grip (trigger hand anchor). */
  gripSocket: THREE.Object3D;
  /** Empty at the support-grip area (support hand anchor). */
  supportSocket: THREE.Object3D;
  /** Empty at the magwell / ammo-box chute interface (reload anchor). */
  magSocket: THREE.Object3D;
  /** True if built from the authentic GLB, false if procedural fallback. */
  isGLTFAsset: boolean;
  /** Canonical asset URL (GLB path only). */
  assetUrl?: string;
  /** Teardown owning disposal of allocated resources; idempotent. */
  dispose: () => void;
}

export interface RosterHeroLoaderOptions {
  /** Material library required for the procedural fallback. */
  mat?: MaterialLibrary;
  /** Whether to attach first-person hands (default true if mat provided). */
  attachHands?: boolean;
  /** Optional viewmodel renderOrder override. */
  renderOrder?: number;
  /** Custom loader for tests / dependency injection. */
  customLoader?: {
    loadAsync: (url: string) => Promise<{ scene: THREE.Group }>;
  };
  /** Auto-dispose master resources when refCount hits zero (default true). */
  autoDisposeOnZeroRef?: boolean;
}

/** Structurally identical to the carbine loader's MasterResourceSet (private
 * there), so collectGltfResources/disposeResourceSet accept it unchanged. */
interface HeroResourceSet {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
}

interface HeroCacheEntry {
  url: string;
  masterScene: THREE.Group;
  resources: HeroResourceSet;
  refCount: number;
  generation: number;
  autoDisposeOnZeroRef: boolean;
  orphaned: boolean;
}

/** URL -> cached master entry (bounded by MAX_ROSTER_HERO_CACHE_ENTRIES). */
const masterCache = new Map<string, HeroCacheEntry>();

/** URL -> pending load record, generation-guarded. */
const pendingLoads = new Map<
  string,
  { promise: Promise<HeroCacheEntry>; generation: number }
>();

/** Global generation epoch protecting against late resurrection after clear. */
let currentGeneration = 0;

/** Check if the query string requests the heroes canary (?heroes=canary). */
export function isRosterHeroesCanaryRequested(searchQuery?: string): boolean {
  try {
    if (typeof searchQuery === 'string') {
      return new URLSearchParams(searchQuery).get('heroes') === 'canary';
    }
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      return new URLSearchParams(window.location.search).get('heroes') === 'canary';
    }
  } catch {
    return false;
  }
  return false;
}

/** Configure viewmodel mesh flags; never mutates shared material properties. */
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

/** Load or retrieve a cached master entry for a hero URL. */
async function getOrLoadHeroEntry(
  url: string,
  customLoader?: RosterHeroLoaderOptions['customLoader'],
  autoDisposeOnZeroRef = true,
): Promise<HeroCacheEntry> {
  const key = canonicalizeUrl(url);

  const existing = masterCache.get(key);
  if (existing) return existing;

  const inFlight = pendingLoads.get(key);
  if (inFlight) return inFlight.promise;

  if (masterCache.size >= MAX_ROSTER_HERO_CACHE_ENTRIES && !masterCache.has(key)) {
    // Unreachable while the URL table is closed (3 URLs); guards the bound
    // explicitly so a future URL addition cannot silently grow the cache.
    throw new Error(
      `[RosterHeroesLoader] cache bound exceeded (${MAX_ROSTER_HERO_CACHE_ENTRIES}) refusing to load '${key}'`,
    );
  }

  const generationAtStart = currentGeneration;

  let loadPromise!: Promise<HeroCacheEntry>;
  loadPromise = (async (): Promise<HeroCacheEntry> => {
    try {
      const loader = customLoader ?? (defaultHeroGltfLoader ??= new GLTFLoader());
      const gltf = await loader.loadAsync(key);

      if (generationAtStart !== currentGeneration) {
        const stale = collectGltfResources(gltf.scene);
        disposeResourceSet(stale);
        throw new Error(`[RosterHeroesLoader] Load of '${key}' cancelled: cache was cleared during load`);
      }

      const scene = gltf.scene;
      scene.name = 'RosterHeroMaster';
      scene.updateMatrixWorld(true);

      // Strict: the same four anchors as the carbine, no fabrication.
      const missingSockets = validateRequiredSockets(scene);
      if (missingSockets.length > 0) {
        const err = new Error(
          `[RosterHeroesLoader] GLTF asset at '${key}' rejected: missing required socket(s): ${missingSockets.join(', ')}`,
        );
        disposeResourceSet(collectGltfResources(scene));
        throw err;
      }

      // Strict: the authored magazine/ammo-box node must exist (contract 4).
      const heroId = heroIdForUrl(key);
      if (!heroId) {
        const err = new Error(`[RosterHeroesLoader] URL '${key}' is not a roster hero asset`);
        disposeResourceSet(collectGltfResources(scene));
        throw err;
      }
      if (!findNamedSocket(scene, ROSTER_HERO_MAGAZINE_NODES[heroId])) {
        const err = new Error(
          `[RosterHeroesLoader] GLTF asset at '${key}' rejected: missing magazine node '${ROSTER_HERO_MAGAZINE_NODES[heroId]}'`,
        );
        disposeResourceSet(collectGltfResources(scene));
        throw err;
      }

      const resources = collectGltfResources(scene);
      const entry: HeroCacheEntry = {
        url: key,
        masterScene: scene,
        resources,
        refCount: 0,
        generation: generationAtStart,
        autoDisposeOnZeroRef,
        orphaned: false,
      };

      // A clear+reload may have installed a newer entry while we validated.
      const winner = masterCache.get(key);
      if (winner) {
        disposeResourceSet(resources);
        return winner;
      }
      if (generationAtStart !== currentGeneration) {
        disposeResourceSet(resources);
        throw new Error(`[RosterHeroesLoader] Load of '${key}' cancelled: cache was cleared during load`);
      }

      masterCache.set(key, entry);
      return entry;
    } finally {
      const pending = pendingLoads.get(key);
      if (pending && pending.promise === loadPromise) {
        pendingLoads.delete(key);
      }
    }
  })();

  pendingLoads.set(key, { promise: loadPromise, generation: generationAtStart });
  return loadPromise;
}

let defaultHeroGltfLoader: GLTFLoader | undefined;

/** Reverse lookup: canonical URL -> hero id, or null for foreign URLs. */
function heroIdForUrl(key: string): RosterHeroWeaponId | null {
  for (const id of ROSTER_HERO_WEAPON_IDS) {
    if (canonicalizeUrl(ROSTER_HERO_GLB_URLS[id]) === key) return id;
  }
  return null;
}

/** Release one reference; last release disposes (see carbine contracts 2/3/5/6). */
function releaseHeroEntry(entry: HeroCacheEntry): void {
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount !== 0) return;
  const cached = masterCache.get(entry.url);
  if (entry.orphaned) {
    disposeResourceSet(entry.resources);
    return;
  }
  if (cached === entry && entry.autoDisposeOnZeroRef) {
    masterCache.delete(entry.url);
    disposeResourceSet(entry.resources);
    return;
  }
  if (cached !== entry) {
    if (entry.resources.geometries.size > 0 || entry.resources.materials.size > 0) {
      disposeResourceSet(entry.resources);
    }
  }
  // Else: still cached with autoDispose disabled — keep for manual reuse.
}

/** Clear the hero master cache (all entries or one URL). See carbine contract 5. */
export function clearRosterHeroCache(url?: string): void {
  currentGeneration++;
  if (url !== undefined) {
    const key = canonicalizeUrl(url);
    const entry = masterCache.get(key);
    if (entry) {
      if (entry.refCount > 0) {
        masterCache.delete(key);
        entry.orphaned = true;
      } else {
        masterCache.delete(key);
        disposeResourceSet(entry.resources);
      }
    }
    pendingLoads.delete(key);
    return;
  }
  for (const entry of masterCache.values()) {
    if (entry.refCount > 0) {
      entry.orphaned = true;
    } else {
      disposeResourceSet(entry.resources);
    }
  }
  masterCache.clear();
  pendingLoads.clear();
}

/** Alias for clearRosterHeroCache with no arguments. */
export function releaseAllRosterHeroResources(): void {
  clearRosterHeroCache();
}

/** Active cache stats for tests and telemetry. */
export function getRosterHeroCacheStats(): {
  cachedUrls: string[];
  refCounts: Record<string, number>;
  pendingCount: number;
  generation: number;
  maxEntries: number;
} {
  const refCounts: Record<string, number> = {};
  for (const [url, entry] of masterCache.entries()) refCounts[url] = entry.refCount;
  return {
    cachedUrls: Array.from(masterCache.keys()),
    refCounts,
    pendingCount: pendingLoads.size,
    generation: currentGeneration,
    maxEntries: MAX_ROSTER_HERO_CACHE_ENTRIES,
  };
}

/** Present anchor sockets under a rig group (read-only QA helper). */
export function getPresentRosterHeroSockets(group: THREE.Object3D): string[] {
  const names = ['anchor_muzzle', 'anchor_grip', 'anchor_support', 'anchor_mag'];
  return names.filter((name) => findNamedSocket(group, name));
}

/**
 * Load an authored hero viewmodel rig by its own playable weapon id.
 * Falls back to that weapon's family procedural rig on ANY error (bad asset,
 * missing sockets/magazine, cancelled load) when options.mat is provided;
 * without mat the error propagates.
 */
export async function loadRosterHeroRig(
  weaponId: string,
  options: RosterHeroLoaderOptions = {},
): Promise<RosterHeroRig> {
  const url = ROSTER_HERO_GLB_URLS[weaponId as RosterHeroWeaponId];
  if (!url) {
    throw new Error(
      `[RosterHeroesLoader] '${weaponId}' is not a roster hero id (expected one of ${ROSTER_HERO_WEAPON_IDS.join(', ')})`,
    );
  }
  const renderOrder = options.renderOrder ?? VIEWMODEL_RENDER_ORDER;
  const attachHands = options.attachHands ?? true;
  const autoDisposeOnZeroRef = options.autoDisposeOnZeroRef ?? true;

  try {
    const entry = await getOrLoadHeroEntry(url, options.customLoader, autoDisposeOnZeroRef);
    entry.refCount++;

    let cloneOk = false;
    try {
      // Clone node hierarchy only; geometry/materials reference shared master buffers.
      const group = entry.masterScene.clone(true);
      group.name = 'RosterHeroViewmodel';

      const muzzle = findNamedSocket(group, 'anchor_muzzle')!;
      const gripSocket = findNamedSocket(group, 'anchor_grip')!;
      const supportSocket = findNamedSocket(group, 'anchor_support')!;
      const magSocket = findNamedSocket(group, 'anchor_mag')!;

      // Presentation-only eject frame (never an authored socket; contract 8 note).
      let eject = findNamedSocket(group, 'anchor_eject') ?? findNamedSocket(group, 'eject');
      if (!eject) {
        eject = new THREE.Object3D();
        eject.name = 'eject';
        eject.position.copy(EJECT_FALLBACK_OFFSET);
        group.add(eject);
      }

      // Reload pivot: anchor_mag -> pivot -> magazine (attach keeps the baked
      // world pose as the pivot-local offset). Transform-only; shared buffers
      // are untouched, so clones stay independent.
      const magNode = findNamedSocket(group, ROSTER_HERO_MAGAZINE_NODES[weaponId as RosterHeroWeaponId])!;
      const magPivot = new THREE.Object3D();
      magPivot.name = 'hero_mag_pivot';
      magSocket.add(magPivot);
      magPivot.attach(magNode);
      const setMagSwing = (progress: number): void => {
        const p = Math.min(1, Math.max(0, progress));
        magPivot.rotation.x = Math.sin(p * Math.PI) * MAG_SWING_RADIANS;
      };

      applyViewmodelMeshTraits(group, renderOrder);

      // Hands attach to the ACTUAL loaded anchors (contract 6): support hand
      // at anchor_support, reload target at anchor_mag, both as authored.
      let handsRig: FirstPersonHandsRig | undefined;
      if (attachHands && options.mat) {
        const inner = createFirstPersonHands(
          group,
          options.mat,
          supportSocket.position.z,
          supportSocket.position.y,
          [magSocket.position.x, magSocket.position.y, magSocket.position.z],
        );
        // One wrapper per rig: hands animation AND the mag swing move on the
        // same reload phase; resetReload restores both to the bind pose.
        handsRig = {
          root: inner.root,
          triggerHand: inner.triggerHand,
          supportHand: inner.supportHand,
          supportForearm: inner.supportForearm,
          updateReload: (progress: number) => {
            inner.updateReload(progress);
            setMagSwing(progress);
          },
          resetReload: () => {
            inner.resetReload();
            setMagSwing(0);
          },
        };
      }

      let disposed = false;
      const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        if (group.parent) group.parent.remove(group);
        // Hands own freshly allocated geometries with SHARED library materials:
        // dispose owned geometry only. The GLB clone shares master buffers;
        // releaseHeroEntry owns master disposal on last release.
        if (handsRig) {
          disposeOwnedGeometries(handsRig.root);
          if (handsRig.root.parent) handsRig.root.parent.remove(handsRig.root);
        }
        releaseHeroEntry(entry);
      };

      const rig: RosterHeroRig = {
        group,
        muzzle,
        eject,
        gripSocket,
        supportSocket,
        magSocket,
        hands: handsRig,
        weaponId: weaponId as RosterHeroWeaponId,
        isGLTFAsset: true,
        assetUrl: entry.url,
        dispose,
      };

      cloneOk = true;
      return rig;
    } finally {
      // A throw after refCount++ must not leak the reference (carbine contract 7).
      if (!cloneOk) releaseHeroEntry(entry);
    }
  } catch (err) {
    console.warn(`[RosterHeroesLoader] Hero '${weaponId}' falling back to procedural viewmodel:`, err);
    if (!options.mat) throw err;

    // Exactly the stand-in the controller rendered before adoption.
    const fallback = HERO_FALLBACK_BUILDERS[FAMILY_FALLBACK[weaponFamily(weaponId)]](options.mat);

    // Procedural stand-in sockets (carbine fallback coords). These are NOT
    // authored hardware — they only keep callers' socket expectations valid.
    const gripSocket = new THREE.Object3D();
    gripSocket.name = 'anchor_grip';
    gripSocket.position.set(0, -0.09, 0);
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
      if (fallbackDisposed) return;
      fallbackDisposed = true;
      if (fallback.group.parent) fallback.group.parent.remove(fallback.group);
      // Fallback geometries are all per-instance owned (procedural boxes +
      // hands). NEVER dispose shared MaterialLibrary singletons here.
      disposeOwnedGeometries(fallback.group);
    };

    const rig: RosterHeroRig = {
      group: fallback.group,
      muzzle: fallback.muzzle,
      eject: fallback.eject,
      gripSocket,
      supportSocket,
      magSocket,
      hands: fallback.hands,
      weaponId: weaponId as RosterHeroWeaponId,
      isGLTFAsset: false,
      dispose: disposeFallback,
    };
    return rig;
  }
}
