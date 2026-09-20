/**
 * world-weapon-art — canary third-person weapon art for authored operators.
 *
 * Lane: world-weapon-agy-repair1-0941 (2026-09-20). Opt-in ONLY via the exact query
 * flag `?world-weapon=canary` (same convention as street-lamps/foliage);
 * absent, misspelled, or wrong-valued flags keep the baseline box rifle.
 *
 * What this owns: per-archetype ADDED silhouette parts (stock furniture,
 * handguards, magazines, trigger guards, muzzle devices, optics), one shared
 * furniture material, and a bounded per-archetype cache of merged static
 * geometry. The baseline SPECS boxes of `authored-weapon.ts` are passed in by
 * the seam and form the metal core of every weapon, so the existing contact
 * contracts are preserved by construction:
 *   - barrel axis stays +Z (AUTHORED_BARREL_LOCAL untouched);
 *   - muzzle Object3D sits at the unchanged per-archetype MUZZLES offsets;
 *   - blend.ts solve points (FORESTOCK_LOCAL / authoredGripLocal) land inside
 *     solid geometry for all five archetypes (verified by checks).
 *
 * Budgets: 2 draw calls per weapon (one merged metal mesh in the caller
 * material + one merged furniture mesh in the shared furniture material),
 * well under the 3-draw cap; each archetype merges to well under 2500 tris.
 * All numbers are literal — deterministic, no Math.random. Spawn-time only;
 * nothing allocates per frame. Caller-owned materials are never disposed.
 * `disposeWorldWeaponArt()` tears down self-owned geometry/material exactly
 * once; per-actor detach keeps shared geometry (same lifetime as baseline).
 *
 * Lifecycle & Ownership Guards:
 * - Cache shares finite 5 archetypes (rifle, smg, shotgun, sniper, pistol).
 * - Detaching actors retains shared cache.
 * - Global teardown must NOT invalidate live actors unless explicitly terminal.
 * - Caller-owned material is never disposed.
 * - Guard rejects disposing borrowed resources or shared geometries twice.
 *
 * Provenance: parametric parts authored in this lane against the silhouette
 * targets in docs/reference/production-catalog/weapons (catalog-weapons-a/b:
 * m4a1, ak-47, mp5, smg, lmg sheets — broad-family cues only: carbine stock +
 * handguard, AK-style curved mag, MP5-style slim receiver, SAW-style boxy
 * chassis). No meshes, textures, or modules were copied from any project.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** AuthoredWeaponArchetype mirrored structurally (no import cycle). */
export type WorldWeaponArchetype = 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'pistol';

/** Group/muzzle names — must equal AUTHORED_WEAPON_NAME/AUTHORED_MUZZLE_NAME. */
export const WORLD_WEAPON_GROUP_NAME = 'operator-weapon';
export const WORLD_WEAPON_MUZZLE_NAME = 'operator-muzzle';

/** Exact-flag opt-in; pass a search string for pure testing. SSR-safe. */
export function isWorldWeaponArtEnabled(search?: string): boolean {
  try {
    let q = search;
    if (q === undefined) {
      if (typeof location === 'undefined' || !location.search) return false;
      q = location.search;
    }
    if (!q) return false;
    return new URLSearchParams(q).get('world-weapon') === 'canary';
  } catch {
    return false;
  }
}

export type Part =
  | { k: 'box'; w: number; h: number; d: number; x: number; y: number; z: number; rx?: number }
  /** Cylinder along +Z (pre-rotated from three's Y axis). */
  | { k: 'cyl'; r: number; h: number; x: number; y: number; z: number; seg?: number };

function partGeometry(p: Part): THREE.BufferGeometry {
  const g =
    p.k === 'box'
      ? new THREE.BoxGeometry(p.w, p.h, p.d)
      : new THREE.CylinderGeometry(p.r, p.r, p.h, p.seg ?? 8, 1, true);
  if (p.k === 'cyl') g.rotateX(Math.PI / 2);
  g.translate(p.x, p.y, p.z);
  return g;
}

/**
 * Added metal parts per archetype (caller/dress.dark material). Muzzle
 * devices end exactly at the unchanged MUZZLES z so tracers stay on the tip.
 */
const METAL_ADDS: Readonly<Record<WorldWeaponArchetype, readonly Part[]>> = Object.freeze({
  rifle: Object.freeze<readonly Part[]>([
    { k: 'cyl', r: 0.012, h: 0.142, x: 0, y: -0.062, z: 0.371 }, // barrel
    { k: 'cyl', r: 0.017, h: 0.05, x: 0, y: -0.062, z: 0.417 }, // muzzle device, tip 0.442
    { k: 'box', w: 0.018, h: 0.03, d: 0.02, x: 0, y: -0.028, z: 0.38 }, // gas block
    { k: 'box', w: 0.006, h: 0.005, d: 0.035, x: 0, y: -0.092, z: 0.037 }, // guard bottom
    { k: 'box', w: 0.005, h: 0.022, d: 0.005, x: 0, y: -0.08, z: 0.02 }, // guard front post
    { k: 'cyl', r: 0.014, h: 0.09, x: 0, y: -0.035, z: -0.075 }, // buffer tube
  ]),
  smg: Object.freeze<readonly Part[]>([
    { k: 'cyl', r: 0.011, h: 0.078, x: 0, y: -0.06, z: 0.279 }, // barrel, tip 0.318
    { k: 'cyl', r: 0.014, h: 0.03, x: 0, y: -0.06, z: 0.303 }, // muzzle nut
    { k: 'box', w: 0.012, h: 0.024, d: 0.012, x: 0, y: -0.03, z: 0.28 }, // front sight
    { k: 'box', w: 0.006, h: 0.004, d: 0.032, x: 0, y: -0.092, z: 0.042 }, // guard bottom
    { k: 'box', w: 0.005, h: 0.02, d: 0.005, x: 0, y: -0.081, z: 0.026 }, // guard post
    { k: 'box', w: 0.014, h: 0.01, d: 0.11, x: 0, y: -0.032, z: -0.075 }, // stock rails
  ]),
  shotgun: Object.freeze<readonly Part[]>([
    { k: 'box', w: 0.008, h: 0.008, d: 0.29, x: 0, y: -0.038, z: 0.33 }, // barrel rib
    { k: 'box', w: 0.006, h: 0.01, d: 0.006, x: 0, y: -0.03, z: 0.475 }, // bead, tip 0.482
    { k: 'box', w: 0.006, h: 0.005, d: 0.04, x: 0, y: -0.092, z: 0.04 }, // guard bottom
    { k: 'box', w: 0.005, h: 0.02, d: 0.005, x: 0, y: -0.081, z: 0.022 }, // guard post
  ]),
  sniper: Object.freeze<readonly Part[]>([
    { k: 'cyl', r: 0.016, h: 0.055, x: 0, y: -0.058, z: 0.593 }, // muzzle brake, tip 0.62
    { k: 'cyl', r: 0.016, h: 0.16, x: 0, y: 0.045, z: 0.09 }, // scope tube
    { k: 'cyl', r: 0.02, h: 0.03, x: 0, y: 0.045, z: 0.005 }, // eyepiece
    { k: 'cyl', r: 0.021, h: 0.04, x: 0, y: 0.045, z: 0.185 }, // objective
    { k: 'box', w: 0.01, h: 0.03, d: 0.014, x: 0, y: 0.02, z: 0.05 }, // ring front
    { k: 'box', w: 0.01, h: 0.03, d: 0.014, x: 0, y: 0.02, z: 0.14 }, // ring rear
    { k: 'box', w: 0.006, h: 0.005, d: 0.04, x: 0, y: -0.092, z: 0.05 }, // guard bottom
    { k: 'box', w: 0.005, h: 0.02, d: 0.005, x: 0, y: -0.081, z: 0.03 }, // guard post
    { k: 'box', w: 0.036, h: 0.05, d: 0.07, x: 0, y: -0.1, z: 0.08, rx: 0.15 }, // mag box
  ]),
  pistol: Object.freeze<readonly Part[]>([
    { k: 'box', w: 0.005, h: 0.004, d: 0.035, x: 0, y: -0.078, z: 0.0725 }, // guard bottom
    { k: 'box', w: 0.005, h: 0.018, d: 0.004, x: 0, y: -0.068, z: 0.091 }, // guard front
    { k: 'box', w: 0.008, h: 0.014, d: 0.008, x: 0, y: -0.005, z: -0.008 }, // hammer
    { k: 'cyl', r: 0.008, h: 0.015, x: 0, y: -0.038, z: 0.168 }, // barrel tip 0.175
    { k: 'box', w: 0.036, h: 0.008, d: 0.05, x: 0, y: -0.152, z: 0.028, rx: 0.22 }, // mag base
  ]),
});

/** Added wood/polymer parts per archetype (shared furniture material). */
const FURNITURE_ADDS: Readonly<Record<WorldWeaponArchetype, readonly Part[]>> = Object.freeze({
  rifle: Object.freeze<readonly Part[]>([
    { k: 'cyl', r: 0.026, h: 0.13, x: 0, y: -0.062, z: 0.25, seg: 8 }, // handguard (solve point)
    { k: 'box', w: 0.004, h: 0.08, d: 0.05, x: -0.02, y: -0.108, z: 0.084, rx: 0.22 }, // grip L
    { k: 'box', w: 0.004, h: 0.08, d: 0.05, x: 0.02, y: -0.108, z: 0.084, rx: 0.22 }, // grip R
    { k: 'box', w: 0.032, h: 0.06, d: 0.05, x: 0, y: -0.115, z: 0.1, rx: 0.25 }, // mag upper
    { k: 'box', w: 0.032, h: 0.055, d: 0.048, x: 0, y: -0.158, z: 0.117, rx: 0.45 }, // mag lower
    { k: 'box', w: 0.04, h: 0.07, d: 0.06, x: 0, y: -0.032, z: -0.155 }, // buttstock
    { k: 'box', w: 0.044, h: 0.075, d: 0.012, x: 0, y: -0.03, z: -0.183 }, // butt pad
  ]),
  smg: Object.freeze<readonly Part[]>([
    { k: 'box', w: 0.044, h: 0.042, d: 0.11, x: 0, y: -0.06, z: 0.225 }, // handguard (solve point 0.20)
    { k: 'box', w: 0.004, h: 0.08, d: 0.05, x: -0.02, y: -0.108, z: 0.084, rx: 0.22 }, // grip L
    { k: 'box', w: 0.004, h: 0.08, d: 0.05, x: 0.02, y: -0.108, z: 0.084, rx: 0.22 }, // grip R
    { k: 'box', w: 0.03, h: 0.09, d: 0.04, x: 0, y: -0.13, z: 0.075, rx: 0.12 }, // straight mag
    { k: 'box', w: 0.04, h: 0.06, d: 0.014, x: 0, y: -0.03, z: -0.135 }, // butt plate
  ]),
  shotgun: Object.freeze<readonly Part[]>([
    { k: 'box', w: 0.062, h: 0.056, d: 0.11, x: 0, y: -0.062, z: 0.22 }, // pump cap (solve point)
    { k: 'box', w: 0.004, h: 0.08, d: 0.05, x: -0.02, y: -0.108, z: 0.084, rx: 0.22 }, // grip L
    { k: 'box', w: 0.004, h: 0.08, d: 0.05, x: 0.02, y: -0.108, z: 0.084, rx: 0.22 }, // grip R
    { k: 'box', w: 0.048, h: 0.068, d: 0.09, x: 0, y: -0.032, z: -0.145 }, // buttstock
    { k: 'box', w: 0.052, h: 0.074, d: 0.012, x: 0, y: -0.03, z: -0.196 }, // butt pad
  ]),
  sniper: Object.freeze<readonly Part[]>([
    { k: 'box', w: 0.005, h: 0.04, d: 0.16, x: -0.0255, y: -0.05, z: 0.22 }, // chassis L
    { k: 'box', w: 0.005, h: 0.04, d: 0.16, x: 0.0255, y: -0.05, z: 0.22 }, // chassis R
    { k: 'box', w: 0.04, h: 0.03, d: 0.1, x: 0, y: 0.008, z: -0.11 }, // cheek riser
    { k: 'box', w: 0.004, h: 0.08, d: 0.05, x: -0.02, y: -0.108, z: 0.084, rx: 0.22 }, // grip L
    { k: 'box', w: 0.004, h: 0.08, d: 0.05, x: 0.02, y: -0.108, z: 0.084, rx: 0.22 }, // grip R
    { k: 'box', w: 0.046, h: 0.074, d: 0.014, x: 0, y: -0.028, z: -0.222 }, // butt pad
  ]),
  pistol: Object.freeze<readonly Part[]>([
    { k: 'box', w: 0.004, h: 0.085, d: 0.06, x: -0.02, y: -0.105, z: 0.032, rx: 0.22 }, // wrap L
    { k: 'box', w: 0.004, h: 0.085, d: 0.06, x: 0.02, y: -0.105, z: 0.032, rx: 0.22 }, // wrap R
    { k: 'box', w: 0.028, h: 0.05, d: 0.006, x: 0, y: -0.09, z: 0.056, rx: 0.22 }, // front strap
  ]),
});

/** Pure part data (checks reuse this for provenance/budget review). */
export function worldWeaponAddedParts(archetype: WorldWeaponArchetype): {
  metal: readonly Part[];
  furniture: readonly Part[];
} {
  return { metal: METAL_ADDS[archetype], furniture: FURNITURE_ADDS[archetype] };
}

/** The one shared original material this lane owns (wood/polymer tone). */
let furnitureMat: THREE.MeshStandardMaterial | null = null;
function furnitureMaterial(): THREE.MeshStandardMaterial {
  if (!furnitureMat) {
    furnitureMat = new THREE.MeshStandardMaterial({
      name: 'world-weapon-furniture',
      color: new THREE.Color(0x4a3220),
      roughness: 0.85,
      metalness: 0.05,
    });
  }
  return furnitureMat;
}

interface CacheEntry {
  metal: THREE.BufferGeometry;
  furniture: THREE.BufferGeometry;
}

/** Bounded by the five shipped archetypes. Shared across actors like baseline. */
const cache = new Map<WorldWeaponArchetype, CacheEntry>();

/** Track active weapon groups to prevent global teardown from invalidating live actors. */
const trackedWeapons = new Set<THREE.Group>();

/** Track disposed geometries so guard rejects duplicate disposal attempts. */
const disposedGeometries = new WeakSet<THREE.BufferGeometry>();

interface BaseBoxSpec {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  rx?: number;
}

function mergeParts(specs: readonly BaseBoxSpec[], adds: readonly Part[]): THREE.BufferGeometry {
  const temps: THREE.BufferGeometry[] = [];
  for (const s of specs) temps.push(partGeometry({ k: 'box', ...s }));
  for (const p of adds) temps.push(partGeometry(p));
  const merged = mergeGeometries(temps, false);
  for (const t of temps) t.dispose(); // steady state owns exactly the merged geometry
  if (!merged) throw new Error('world-weapon-art: mergeGeometries returned null');
  merged.userData.source = 'world-weapon-agy-repair1-0941 parametric parts';
  return merged;
}

function entryFor(
  archetype: WorldWeaponArchetype,
  baseSpecs: readonly BaseBoxSpec[],
): CacheEntry {
  let e = cache.get(archetype);
  if (e) return e;
  e = {
    metal: mergeParts(baseSpecs, METAL_ADDS[archetype]),
    furniture: mergeParts([], FURNITURE_ADDS[archetype]),
  };
  cache.set(archetype, e);
  return e;
}

/** Check whether any tracked weapon is currently mounted on an actor hand / hierarchy. */
export function hasLiveWorldWeapons(): boolean {
  for (const g of trackedWeapons) {
    if (g.parent !== null) return true;
  }
  return false;
}

export interface WorldWeaponBuild {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  archetype: WorldWeaponArchetype;
  weaponId: string;
}

/**
 * Build the canary weapon. `muzzleLocal` is the unchanged per-archetype
 * muzzle offset from authored-weapon.ts; `baseSpecs` are its baseline boxes.
 * Caller material paints the metal bucket and is never disposed here.
 */
export function buildWorldWeaponArt(
  material: THREE.Material,
  archetype: WorldWeaponArchetype,
  weaponId: string,
  baseSpecs: readonly BaseBoxSpec[],
  muzzleLocal: readonly [number, number, number],
): WorldWeaponBuild {
  const e = entryFor(archetype, baseSpecs);
  const group = new THREE.Group();
  group.name = WORLD_WEAPON_GROUP_NAME;
  const metalMesh = new THREE.Mesh(e.metal, material);
  metalMesh.castShadow = true;
  metalMesh.receiveShadow = true;
  group.add(metalMesh);
  const furnitureMesh = new THREE.Mesh(e.furniture, furnitureMaterial());
  furnitureMesh.castShadow = true;
  furnitureMesh.receiveShadow = true;
  group.add(furnitureMesh);
  const muzzle = new THREE.Object3D();
  muzzle.name = WORLD_WEAPON_MUZZLE_NAME;
  muzzle.position.set(muzzleLocal[0], muzzleLocal[1], muzzleLocal[2]);
  group.add(muzzle);
  group.userData.archetype = archetype;
  group.userData.weaponId = weaponId;
  group.userData.art = 'world-weapon-canary';
  group.userData.dispose = () => {
    group.removeFromParent();
    trackedWeapons.delete(group);
  };
  trackedWeapons.add(group);
  return { group, muzzle, archetype, weaponId };
}

export interface DisposeWorldWeaponArtOptions {
  /** Force disposal even if live actors are still mounted (e.g. pagehide / terminal teardown). */
  terminal?: boolean;
}

/**
 * Global cache teardown: disposes every self-owned merged geometry and the
 * shared furniture material exactly once, then clears.
 *
 * Contract:
 * - Refuses while live actors are mounted unless explicitly terminal (`terminal: true`).
 * - Idempotent one-shot guard: a second call is a no-op and returns false.
 * - Caller-owned materials are never disposed.
 */
export function disposeWorldWeaponArt(
  options?: boolean | DisposeWorldWeaponArtOptions,
): boolean {
  const isTerminal = typeof options === 'boolean' ? options : Boolean(options?.terminal);
  if (!isTerminal && hasLiveWorldWeapons()) {
    return false; // Guard: must not invalidate live actors unless explicitly terminal
  }
  if (cache.size === 0 && furnitureMat === null) {
    return false; // Guard: one-shot idempotent no-op
  }
  for (const e of cache.values()) {
    if (!disposedGeometries.has(e.metal)) {
      e.metal.dispose();
      disposedGeometries.add(e.metal);
    }
    if (!disposedGeometries.has(e.furniture)) {
      e.furniture.dispose();
      disposedGeometries.add(e.furniture);
    }
  }
  cache.clear();
  trackedWeapons.clear();
  if (furnitureMat) {
    furnitureMat.dispose();
    furnitureMat = null;
  }
  return true;
}

/**
 * Guarded resource disposal helper.
 * - Rejects borrowed resources (caller-owned material).
 * - Rejects direct disposal of shared cache geometry while active in cache.
 * - Rejects double-disposal of already-disposed geometry.
 * Returns true if resource was owned and disposed; false if rejected by guard.
 */
export function disposeWorldWeaponResource(resource: unknown): boolean {
  if (!resource || typeof resource !== 'object') return false;
  // Guard 1: Borrowed material rejection
  if ('isMaterial' in resource) {
    if (resource !== furnitureMat) {
      // Caller-owned (borrowed) material must never be disposed by world-weapon-art
      return false;
    }
    furnitureMat.dispose();
    furnitureMat = null;
    return true;
  }
  // Guard 2: Shared geometry rejection & double disposal guard
  if ('isBufferGeometry' in resource) {
    const geo = resource as THREE.BufferGeometry;
    if (disposedGeometries.has(geo)) {
      // Already disposed: guard rejects double-dispose
      return false;
    }
    // Check if it is currently in active shared cache
    for (const e of cache.values()) {
      if (e.metal === geo || e.furniture === geo) {
        // Shared cached geometry cannot be disposed individually; must go through teardown
        return false;
      }
    }
    // Owned unshared geometry
    geo.dispose();
    disposedGeometries.add(geo);
    return true;
  }
  return false;
}
