/**
 * Authored sand operator — additive GLB dress behind `?operator=authored`.
 *
 * Frozen asset: work/operator-sand/operator-sand.glb
 * (SHA-256 ae0521210cc469d3c81fa220898223431e34ff347e6848f2e7ad25112843c8ea,
 * strict validator ALLPASS: 21 identity bones in BONE_NAMES order, IBM exact,
 * 2 skinned primitives / 2 materials / 3 PNG, 13596 tris, +Y up +Z forward).
 * Recipe + validator are FROZEN — this module never rebuilds the asset, it
 * only adopts the shipped GLB at its runtime URL.
 *
 * Contract (immutable scope agy-operator-runtime-0002, lifecycle hardened
 * 2026-09-20 after the runtime-0016 review):
 * - Default OFF: without `?operator=authored` nothing here runs and every
 *   figure is the procedural dress via CharacterSystem.spawn, byte-for-byte.
 * - Same rig, same clips: each authored figure builds a FRESH standard
 *   skeleton (buildStandardSkeleton) and a standard CharacterRig over the
 *   system's clip library, so rig/throw/H3 guidance, contacts, teams and
 *   gameplay are untouched. No alternate skeleton path, no animation engine
 *   migration, no duplicated game/bot authority.
 * - Shared immutable, per-actor pose: GLB geometries/materials/textures load
 *   ONCE and are shared by every authored figure; each figure owns its bones,
 *   its Skeleton and its SkinnedMesh instances, so poses never leak across
 *   actors. Shared geometries and GLB materials are kept on actor dispose.
 * - Exact lifetime: per-actor dispose removes its meshes, disposes its
 *   Skeleton (the per-figure bone texture) and drops its scene root.
 *   disposeAuthoredCache refuses while actors are live or a load is pending.
 *   Every rejected load — validation failure, cancellation (generation bump),
 *   timeout — disposes the freshly loaded GLTF scene exactly once; a timed-out
 *   result that resolves late is caught by the orphan sweeper, so no path
 *   leaks source geometry/material/textures.
 * - Bounded preload, explicit fallback: a missing/invalid/cancelled/timed-out
 *   GLB resolves null and the caller keeps the procedural dress. Never
 *   throws, never retries in a loop, never hangs startup.
 * - Per-primitive materials are captured at load exactly as authored — no
 *   modulo redistribution.
 * - Hand-held weapon: the GLB is body-only (non-skinned meshes such as the
 *   corrected GLB's 372-tri baked hand-prop are never adopted and never
 *   attached — adopting them would double the gun — so each figure carries
 *   one third-person weapon from `authored-weapon.ts` on its RightHand bone,
 *   resolved from the actor's real weapon id with a rifle fallback. Forward
 *   is +z like the procedural rifle, so the carry/aim solver is undisturbed.
 * - Budgets: 2 skinned primitives per actor, geometry within 12k–22k tris,
 *   no per-frame allocation on the update path (spawn-time only). The weapon
 *   adds 5 shared-geometry boxes + muzzle in the caller material (+5 draws,
 *   +60–72 tris per figure; sniper scope included).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BONE_NAMES, buildStandardSkeleton, type StandardBoneName } from './skeleton';
import { CharacterRig } from './blend';
import type { ClipLibrary } from './clips';
import type { CharacterDress, CharacterMesh } from './mesh';
import type { CharacterHandle } from './system';
import {
  attachAuthoredWeapon,
  authoredWeaponOf,
  buildAuthoredWeapon,
  detachAuthoredWeapon,
  resolveAuthoredArchetype,
  type AuthoredWeaponArchetype,
} from './authored-weapon';

/** Runtime URL. Root copies the frozen GLB here when this slice is accepted. */
export const OPERATOR_SAND_URL = '/assets/operators/operator-sand.glb';
/** Canary URL. Root copies the shape-0800 GLB here ONLY if this slice is accepted. */
export const OPERATOR_SAND_SHAPE_URL = '/assets/operators/operator-sand-shape-0800.glb';

/** Bounded preload: a hanging server must never stall startup adoption. */
export const OPERATOR_LOAD_TIMEOUT_MS = 8000;

export const OPERATOR_BUDGETS = {
  bones: 21,
  minPrimitives: 1,
  maxPrimitives: 2,
  maxMaterials: 2,
  minTriangles: 12000,
  maxTriangles: 22000,
} as const;

export interface AuthoredOperatorStatus {
  /** `?operator=authored` was requested in this page. */
  enabled: boolean;
  /** The real GLB was adopted (not the fallback). */
  loaded: boolean;
  /** True when the procedural dress must be used instead. */
  fallback: boolean;
  reason: string | null;
  bones: number;
  primitives: number;
  triangles: number;
  materials: number;
  live: number;
  pending: boolean;
}

/** One authored primitive: its geometry plus exactly the materials it wore. */
interface AuthoredPrimitive {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
}

interface AuthoredShared {
  primitives: AuthoredPrimitive[];
  /** Every distinct material across primitives, load order. */
  materials: THREE.Material[];
  /** GLB inverse-bind matrices, frozen — shared like mesh.ts REST_INVERSES. */
  inverses: THREE.Matrix4[];
  /** Every texture embedded in the GLB materials, for exactly-once release. */
  textures: THREE.Texture[];
  triangles: number;
}

/** Minimal shape this module needs from a loaded GLTF (real or injected). */
export type OperatorGltf = { scene: THREE.Object3D };

let shared: AuthoredShared | null = null;
let loadPromise: Promise<AuthoredShared | null> | null = null;
/** Pending-cancellation token: clearAuthoredOperator bumps it. */
let generation = 0;
let live = 0;
let pending = false;
let fallbackReason: string | null = null;

/** Injectable load step — QA seam for the node lifetime harness. Never set by the game. */
let loadOperatorGltf: (url: string) => Promise<OperatorGltf> = (url) =>
  new GLTFLoader().loadAsync(url) as unknown as Promise<OperatorGltf>;

/** True only behind `?operator=authored`. Safe in non-browser runtimes. */
export function isAuthoredOperatorEnabled(): boolean {
  try {
    if (typeof location === 'undefined' || !location.search) return false;
    return new URLSearchParams(location.search).get('operator') === 'authored';
  } catch {
    return false;
  }
}

/** True only behind `?operator-shape=canary`. Never enables the authored path alone. */
export function isShapeCanaryEnabled(): boolean {
  try {
    if (typeof location === 'undefined' || !location.search) return false;
    return new URLSearchParams(location.search).get('operator-shape') === 'canary';
  } catch {
    return false;
  }
}

/** Resolve the sand GLB URL. Baseline untouched unless BOTH flags are present. */
export function resolveOperatorSandUrl(): string {
  try {
    if (isAuthoredOperatorEnabled() && isShapeCanaryEnabled()) return OPERATOR_SAND_SHAPE_URL;
  } catch {
    /* fall through to baseline */
  }
  return OPERATOR_SAND_URL;
}

/**
 * Dispose one loaded GLTF scene exactly once per source object. Geometries,
 * materials and embedded textures are deduped through Sets, so shared
 * instances between primitives release a single time.
 */
function disposeGltfScene(scene: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      materials.add(m);
      // material.dispose() does NOT release textures — sweep the slots.
      for (const value of Object.values(m as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const t of textures) t.dispose();
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

/**
 * Bounded single-flight preload of the frozen sand GLB. Resolves the shared
 * cache, or null when the asset is missing/invalid/cancelled/timed out — the
 * caller then keeps the procedural dress. Never throws.
 *
 * @param timeoutMs bounds the load; the default keeps the game safe against a
 *   hanging server. A timed-out load bumps the generation: when its result
 *   still arrives, the orphan sweeper disposes it instead of adopting.
 */
export function preloadAuthoredOperator(
  url: string = resolveOperatorSandUrl(),
  timeoutMs: number = OPERATOR_LOAD_TIMEOUT_MS,
): Promise<AuthoredShared | null> {
  if (shared) return Promise.resolve(shared);
  if (loadPromise) return loadPromise;
  const gen = generation;
  pending = true;
  loadPromise = (async (): Promise<AuthoredShared | null> => {
    const raw = Promise.resolve().then(() => loadOperatorGltf(url));
    try {
      let timer: number | undefined;
      let gltf: OperatorGltf | null = null;
      try {
        gltf = await Promise.race([
          raw,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`load timed out after ${timeoutMs}ms`)), timeoutMs);
          }),
        ]);
      } catch (err) {
        // The race was lost (timeout, or the load itself failed). Any result
        // that still lands is an orphan: dispose it, never adopt it.
        void raw.then(
          (late) => { if (late) disposeGltfScene(late.scene); },
          () => { /* already failed once; nothing further to release */ },
        );
        throw err;
      } finally {
        clearTimeout(timer);
      }
      // This promise owns the result from here on; rejection paths below
      // dispose it exactly once via fail()/the cancellation branch.
      if (gen !== generation) {
        disposeGltfScene(gltf.scene); // cancelled while in flight: no orphan
        return null;
      }
      const fail = (reason: string): null => {
        disposeGltfScene(gltf.scene); // validation failure must not leak
        fallbackReason = reason;
        return null;
      };
      const skinned: THREE.SkinnedMesh[] = [];
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) skinned.push(o);
      });
      if (
        skinned.length < OPERATOR_BUDGETS.minPrimitives ||
        skinned.length > OPERATOR_BUDGETS.maxPrimitives
      ) {
        return fail(`expected 1-2 skinned primitives, saw ${skinned.length}`);
      }
      const first = skinned[0];
      const names = first.skeleton.bones.map((b) => b.name);
      if (
        names.length !== OPERATOR_BUDGETS.bones ||
        !BONE_NAMES.every((n, i) => names[i] === n)
      ) {
        return fail(`joint order mismatch: [${names.join(',')}]`);
      }
      for (const m of skinned) {
        const g = m.geometry;
        if (!g.getAttribute('skinIndex') || !g.getAttribute('skinWeight')) {
          return fail('primitive missing skinIndex/skinWeight');
        }
      }
      // Per-primitive material capture — exactly as the GLB authored them.
      const primitives: AuthoredPrimitive[] = skinned.map((m) => ({
        geometry: m.geometry,
        materials: (Array.isArray(m.material) ? m.material : [m.material]).slice(),
      }));
      const materials: THREE.Material[] = [];
      for (const prim of primitives) {
        for (const mat of prim.materials) if (!materials.includes(mat)) materials.push(mat);
      }
      if (materials.length < 1 || materials.length > OPERATOR_BUDGETS.maxMaterials) {
        return fail(`expected 1-2 materials, saw ${materials.length}`);
      }
      const triangles = primitives.reduce((total, prim) => {
        const index = prim.geometry.getIndex();
        if (index) return total + Math.floor(index.count / 3);
        const pos = prim.geometry.getAttribute('position');
        return total + (pos ? Math.floor(pos.count / 3) : 0);
      }, 0);
      if (
        triangles < OPERATOR_BUDGETS.minTriangles ||
        triangles > OPERATOR_BUDGETS.maxTriangles
      ) {
        return fail(`expected 12000-22000 tris, saw ${triangles}`);
      }
      const textures: THREE.Texture[] = [];
      const seen = new Set<THREE.Texture>();
      for (const mat of materials) {
        for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
          if (value instanceof THREE.Texture && !seen.has(value)) {
            seen.add(value);
            textures.push(value);
          }
        }
      }
      shared = {
        primitives,
        materials,
        inverses: first.skeleton.boneInverses.map((m) => m.clone()),
        textures,
        triangles,
      };
      fallbackReason = null;
      return shared;
    } catch (err) {
      if (gen === generation) {
        const msg = err instanceof Error ? err.message : String(err);
        fallbackReason = msg.slice(0, 160);
      }
      return null;
    } finally {
      if (gen === generation) {
        pending = false;
        loadPromise = null;
      }
    }
  })();
  return loadPromise;
}

/**
 * Cancel a pending preload. The shared cache survives while actors are live —
 * cancellation only stops adoption of a not-yet-loaded asset. Any result that
 * still arrives is disposed, never adopted and never leaked.
 */
export function clearAuthoredOperator(reason = 'cleared'): void {
  generation += 1;
  pending = false;
  loadPromise = null;
  if (fallbackReason === null) fallbackReason = reason;
}

/**
 * Dispose the shared GLB cache. Refuses while actors are live or a load is
 * pending (exact lifetime) — per-actor dispose never touches shared state.
 * Returns true when the cache is gone (or was never loaded): every source
 * geometry, material and embedded texture released exactly once.
 */
export function disposeAuthoredCache(): boolean {
  if (live > 0 || pending) return false;
  if (!shared) return true;
  for (const t of shared.textures) t.dispose();
  for (const prim of shared.primitives) prim.geometry.dispose();
  for (const m of shared.materials) m.dispose();
  shared = null;
  fallbackReason = 'disposed';
  return true;
}

/** QA status proving the REAL gltf was adopted (loaded, not fallback). */
export function authoredOperatorStatus(): AuthoredOperatorStatus {
  return {
    enabled: isAuthoredOperatorEnabled(),
    loaded: shared !== null,
    fallback: shared === null,
    reason: fallbackReason,
    bones: shared ? OPERATOR_BUDGETS.bones : 0,
    primitives: shared ? shared.primitives.length : 0,
    triangles: shared ? shared.triangles : 0,
    materials: shared ? shared.materials.length : 0,
    live,
    pending,
  };
}

/** One shared team-patch geometry for every figure; never disposed per actor. */
let markerGeo: THREE.BufferGeometry | null = null;

/**
 * Dress caller-built standard bones in the shared authored skin — the same
 * seam as dressProcedural (root, bones, dress) -> CharacterMesh. Returns null
 * when the GLB is not loaded so the caller falls back explicitly. Each
 * primitive wears exactly the material(s) captured at load — no modulo
 * redistribution — and owns a fresh Skeleton over the shared frozen inverses,
 * so poses are per-actor by construction.
 *
 * The hand-held weapon rides the caller's RightHand bone: `weaponId` is the
 * actor's real primary (host kit / bot arsenal / loadout declaration) and is
 * resolved to its family archetype with a rifle fallback — never one fixed
 * renamed gun. Omit it and the figure carries the rifle archetype.
 */
export function dressAuthored(
  root: THREE.Object3D,
  bones: Record<StandardBoneName, THREE.Bone>,
  dress: CharacterDress,
  faction: 0 | 1 | null = null,
  weaponId?: string,
): CharacterMesh | null {
  if (!shared) return null;
  const cache = shared;
  const ordered = BONE_NAMES.map((n) => bones[n]);
  if (ordered.some((b) => !b)) return null;
  // One Skeleton per figure over the SHARED frozen inverses: poses are
  // per-actor, bind data is immutable. No shared pose is possible.
  const skeleton = new THREE.Skeleton(ordered, cache.inverses);
  const meshes: THREE.SkinnedMesh[] = cache.primitives.map((prim) => {
    const mat =
      prim.materials.length === 1 ? prim.materials[0] : (prim.materials as THREE.Material[]);
    const m = new THREE.SkinnedMesh(prim.geometry, mat);
    m.name = 'operator-authored';
    m.castShadow = true;
    m.receiveShadow = true;
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.45);
    m.bind(skeleton, new THREE.Matrix4());
    root.add(m);
    return m;
  });
  // Team identification: the sand GLB is one dress, so a tiny instance-owned
  // chest patch rides the Chest bone in a caller-owned singleton material —
  // dark for faction 0, cloth for faction 1. No new programs, no new textures.
  if (!markerGeo) markerGeo = new THREE.BoxGeometry(0.1, 0.14, 0.02);
  const marker = new THREE.Mesh(markerGeo, faction === 1 ? dress.cloth : dress.dark);
  marker.name = 'operator-team-patch';
  marker.position.set(0.14, 0.1, 0.16);
  bones.Chest.add(marker);
  // Third-person weapon on the authored RightHand: shared geometries in the
  // caller-owned dark material (the procedural rifle's slot), +z forward, the
  // muzzle at the archetype tip. Rides the bone, so animation moves it.
  const resolvedId = weaponId ?? 'longhorn';
  const archetype = resolveAuthoredArchetype(resolvedId);
  const weapon = buildAuthoredWeapon(dress.dark, archetype, resolvedId);
  let weaponAttached = false;
  if (bones.RightHand) {
    attachAuthoredWeapon(bones, weapon);
    weaponAttached = true;
  }
  live += 1;
  let disposed = false;
  const handle: CharacterMesh = {
    root,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      live -= 1;
      marker.removeFromParent();
      if (weaponAttached) detachAuthoredWeapon(bones.RightHand);
      for (const m of meshes) m.removeFromParent();
      // Per-figure only: the Skeleton's bone texture. Shared geometries, GLB
      // materials/textures, the shared marker/weapon geometries and the
      // caller's marker/weapon singletons are kept — releasing them would
      // black out the crowd.
      skeleton.dispose();
      root.parent?.remove(root);
    },
  };
  return handle;
}

/**
 * Swap the actor's hand-held weapon in place (weapon swap without respawn).
 * Resolves the real weapon id to its archetype with a rifle fallback.
 * Returns the archetype worn, or null when the root has no authored socket.
 */
export function swapAuthoredWeapon(
  root: THREE.Object3D,
  dress: CharacterDress,
  weaponId: string,
): AuthoredWeaponArchetype | null {
  const current = authoredWeaponOf(root);
  if (!current) return null;
  const next = resolveAuthoredArchetype(weaponId);
  const hand = current.group.parent;
  if (!hand) return null;
  detachAuthoredWeapon(hand);
  hand.add(buildAuthoredWeapon(dress.dark, next, weaponId).group);
  return next;
}

export interface AuthoredSpawn {
  scene: THREE.Scene;
  library: ClipLibrary;
  dress: CharacterDress;
  x: number;
  z: number;
  yaw?: number;
  scale?: number;
  faction?: 0 | 1;
  /** Actor's real primary; resolved to its archetype with a rifle fallback. */
  weaponId?: string;
}

/**
 * Spawn one authored figure: fresh standard hierarchy + shared skin + standard
 * rig over the caller's clip library. Returns null when the GLB is not loaded
 * (explicit fallback). Retained as the direct seam for harnesses and callers
 * that manage their own lists; the game path is CharacterSystem.spawn.
 */
export function spawnAuthoredOperator(opts: AuthoredSpawn): CharacterHandle | null {
  if (!shared) return null;
  const std = buildStandardSkeleton();
  const mesh = dressAuthored(std.root, std.bones, opts.dress, opts.faction ?? null, opts.weaponId);
  if (!mesh) return null;
  const rig = new CharacterRig(std.root, std.bones, opts.library);
  // Same carry contract as CharacterSystem.spawn: the support hand aims at
  // this archetype's authored grip, not the rifle forestock.
  rig.setCarriedArchetype(resolveAuthoredArchetype(opts.weaponId ?? 'longhorn'));
  std.root.position.set(opts.x, 0, opts.z);
  std.root.rotation.y = opts.yaw ?? 0;
  std.root.scale.setScalar(opts.scale ?? 1);
  opts.scene.add(std.root);
  return {
    rig,
    mesh,
    root: std.root,
    input: {
      speed: 0,
      turnRate: 0,
      crouch: false,
      prone: false,
      aimPitch: 0,
      aimWeight: 0,
    },
    yaw: opts.yaw ?? 0,
    scale: opts.scale ?? 1,
    faction: opts.faction ?? null,
  };
}

// ---- QA seams (node lifetime harness only — never called by the game) ----

/** Swap the load step (e.g. a controllable fake GLTF). Pass null to restore. */
export function __testSetOperatorLoader(fn: ((url: string) => Promise<OperatorGltf>) | null): void {
  loadOperatorGltf =
    fn ?? ((url) => new GLTFLoader().loadAsync(url) as unknown as Promise<OperatorGltf>);
}

/** Hard-reset module state between harness scenarios (disposes any cache). */
export function __testResetOperatorState(): void {
  if (shared) {
    for (const t of shared.textures) t.dispose();
    for (const prim of shared.primitives) prim.geometry.dispose();
    for (const m of shared.materials) m.dispose();
    shared = null;
  }
  generation += 1;
  loadPromise = null;
  pending = false;
  live = 0;
  fallbackReason = null;
}

/**
 * `window.__NTOPERATOR` — harness-only, additive, never read by the game.
 * status() proves the real gltf was adopted: loaded true with 21 bones,
 * 2 primitives and in-budget triangles, rather than a silent fallback.
 */
try {
  (globalThis as unknown as { __NTOPERATOR?: unknown }).__NTOPERATOR = {
    status: () => authoredOperatorStatus(),
    url: OPERATOR_SAND_URL,
    budgets: { ...OPERATOR_BUDGETS },
  };
} catch {
  /* a QA surface must never break a spawn */
}
