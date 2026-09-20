/**
 * Authored-operator third-person weapon — the hand-held gun the sand GLB lacks.
 *
 * The procedural dress bakes a 5-box rifle onto the RightHand bone (mesh.ts),
 * so the carry/aim solver (blend.ts FORESTOCK_LOCAL/BARREL_LOCAL, +z forward)
 * always has a forestock to solve the left hand onto. The authored GLB is a
 * body-only skin: 2 skinned primitives, no hand-held gun — and the corrected
 * GLB's 372 static tris are a baked hand-prop the loader correctly rejects
 * (never adopted, never attached; see operator-authored.ts), so without this
 * adapter every authored figure holds empty space.
 *
 * What this file does, narrowly:
 * - resolves a real actor weapon id to one of the five shipped third-person
 *   archetypes, mirroring `weapons/families.ts` FAMILY_FALLBACK without
 *   importing the crossbow lane's files (this lane must not move under them):
 *   rifle <- rifle/lmg/exotic, smg <- smg, shotgun <- shotgun, sniper <-
 *   dmr/sniper, pistol <- pistol. Unknown/null ids fall back to rifle.
 * - builds the archetype from SHARED BoxGeometries in the caller-owned weapon
 *   material (dress.dark — the same near-black slot the procedural rifle
 *   wears), positioned in RightHand LOCAL space at the exact mesh.ts offsets
 *   for the rifle archetype so the existing forestock solve lands on metal.
 *   Other archetypes keep the grip at the hand and the barrel on +z with a
 *   per-archetype muzzle; all spawn-time allocation, nothing per frame.
 * - attaches to the RightHand bone (never the scene, never another builder's
 *   file), exposing the muzzle Object3D for tracers/QA. Forward is +z, the
 *   same axis blend.ts asserts — NOT the viewmodel -z (first-person rigs are
 *   camera-local and are never attached here).
 *
 * Lifetime: geometries are module-frozen like the team-patch geometry and are
 * never disposed per actor; per-actor dispose only removes the Group from the
 * hand. Caller materials are kept. No new programs, no new textures, no
 * lighting change, no recolor.
 *
 * The carry solve is per-archetype through GRIPS/authoredGripLocal: blend.ts
 * aims the support hand at the archetype's grip (the pistol target inside its
 * 0.175 muzzle), fed at spawn/swap by CharacterSystem.spawn/rearm and
 * spawnAuthoredOperator. FORESTOCK_LOCAL remains the rifle row verbatim.
 */
import * as THREE from 'three';
import type { StandardBoneName } from './skeleton';

export type AuthoredWeaponArchetype = 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'pistol';

/**
 * Minimal weapon-id -> archetype projection. Mirrors WEAPON_FAMILY +
 * FAMILY_FALLBACK in `weapons/families.ts` (rifle stands in for lmg and
 * exotic; dmr stands in as sniper) so a roster20 id renders as its family
 * archetype instead of one fixed renamed gun. Deliberately local: importing
 * the weapons lane would drag this lane under crossbow-lane ownership.
 */
const ID_TO_ARCHETYPE: Readonly<Record<string, AuthoredWeaponArchetype>> = Object.freeze({
  longhorn: 'rifle',
  rattler: 'smg',
  coachman: 'shotgun',
  deadeye: 'sniper',
  duster: 'pistol',
  mp5: 'smg',
  'mini-uzi': 'smg',
  'machine-pistol': 'smg',
  m4a1: 'rifle',
  'ak-47': 'rifle',
  lmg: 'rifle',
  minigun: 'rifle',
  'm14-ebr': 'sniper',
  'slug-shotgun': 'shotgun',
  magnum: 'pistol',
  'flashlight-pistol': 'pistol',
  railgun: 'rifle',
  'explosive-crossbow': 'rifle',
  flamethrower: 'rifle',
  'flare-gun': 'rifle',
});

/** Real actor selection -> archetype; unknown/null falls back to rifle. Pure. */
export function resolveAuthoredArchetype(weaponId: unknown): AuthoredWeaponArchetype {
  if (typeof weaponId !== 'string') return 'rifle';
  return ID_TO_ARCHETYPE[weaponId] ?? 'rifle';
}

/** The barrel axis in RightHand LOCAL space. Same +z the procedural rifle wears. */
export const AUTHORED_BARREL_LOCAL = Object.freeze(
  new THREE.Vector3(0, 0, 1),
) as unknown as THREE.Vector3;

/** Left-hand solve target in RightHand LOCAL space (blend.ts FORESTOCK_LOCAL). */
export const AUTHORED_FORESTOCK_LOCAL = Object.freeze(
  new THREE.Vector3(0, -0.055, 0.25),
) as unknown as THREE.Vector3;

interface BoxSpec {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  rx?: number;
}

/**
 * Per-archetype boxes in RightHand LOCAL space. The rifle row is byte-identical
 * to mesh.ts's five RightHand boxes (receiver, barrel, grip, stock, top rail)
 * so the existing carry solve is undisturbed. Siblings keep the grip at the
 * hand and the barrel on +z; muzzles below match each row's barrel tip.
 */
const SPECS: Readonly<Record<AuthoredWeaponArchetype, readonly BoxSpec[]>> = Object.freeze({
  rifle: Object.freeze([
    { w: 0.046, h: 0.076, d: 0.3, x: 0, y: -0.046, z: 0.128 },
    { w: 0.034, h: 0.038, d: 0.26, x: 0, y: -0.062, z: 0.312 },
    { w: 0.03, h: 0.1, d: 0.056, x: 0, y: -0.112, z: 0.082, rx: 0.22 },
    { w: 0.042, h: 0.064, d: 0.165, x: 0, y: -0.03, z: -0.1 },
    { w: 0.032, h: 0.034, d: 0.072, x: 0, y: 0.006, z: 0.108 },
  ]),
  smg: Object.freeze([
    { w: 0.046, h: 0.076, d: 0.22, x: 0, y: -0.046, z: 0.088 },
    { w: 0.03, h: 0.034, d: 0.14, x: 0, y: -0.06, z: 0.248 },
    { w: 0.03, h: 0.1, d: 0.056, x: 0, y: -0.112, z: 0.082, rx: 0.22 },
    { w: 0.042, h: 0.064, d: 0.12, x: 0, y: -0.03, z: -0.078 },
    { w: 0.032, h: 0.034, d: 0.06, x: 0, y: 0.006, z: 0.068 },
  ]),
  shotgun: Object.freeze([
    { w: 0.05, h: 0.08, d: 0.3, x: 0, y: -0.046, z: 0.128 },
    { w: 0.04, h: 0.042, d: 0.3, x: 0, y: -0.062, z: 0.332 },
    { w: 0.03, h: 0.1, d: 0.056, x: 0, y: -0.112, z: 0.082, rx: 0.22 },
    { w: 0.05, h: 0.07, d: 0.18, x: 0, y: -0.03, z: -0.108 },
    { w: 0.056, h: 0.05, d: 0.1, x: 0, y: -0.062, z: 0.22 },
  ]),
  sniper: Object.freeze([
    { w: 0.046, h: 0.076, d: 0.32, x: 0, y: -0.046, z: 0.138 },
    { w: 0.028, h: 0.03, d: 0.4, x: 0, y: -0.058, z: 0.42 },
    { w: 0.03, h: 0.1, d: 0.056, x: 0, y: -0.112, z: 0.082, rx: 0.22 },
    { w: 0.042, h: 0.07, d: 0.2, x: 0, y: -0.028, z: -0.118 },
    { w: 0.034, h: 0.04, d: 0.14, x: 0, y: 0.03, z: 0.08 },
  ]),
  pistol: Object.freeze([
    { w: 0.038, h: 0.055, d: 0.17, x: 0, y: -0.038, z: 0.085 },
    { w: 0.034, h: 0.1, d: 0.05, x: 0, y: -0.105, z: 0.03, rx: 0.22 },
    { w: 0.006, h: 0.03, d: 0.06, x: 0, y: -0.07, z: 0.06 },
    { w: 0.03, h: 0.015, d: 0.02, x: 0, y: -0.005, z: 0.01 },
    { w: 0.008, h: 0.015, d: 0.008, x: 0, y: -0.005, z: 0.155 },
  ]),
});

/** Muzzle tip in RightHand LOCAL space, per archetype (barrel tip of each row). */
const MUZZLES: Readonly<Record<AuthoredWeaponArchetype, readonly [number, number, number]>> =
  Object.freeze({
    rifle: [0, -0.062, 0.442],
    smg: [0, -0.06, 0.318],
    shotgun: [0, -0.062, 0.482],
    sniper: [0, -0.058, 0.62],
    pistol: [0, -0.038, 0.175],
  });

export function authoredMuzzleLocal(archetype: AuthoredWeaponArchetype): THREE.Vector3 {
  const m = MUZZLES[archetype];
  return new THREE.Vector3(m[0], m[1], m[2]);
}

/**
 * Left-hand support grip in RightHand LOCAL space, per archetype. The rifle
 * row is blend.ts's FORESTOCK_LOCAL verbatim, so the legacy solve point is a
 * data row, not a special case. Short barrels get SHORT targets: the support
 * hand wraps the pump (shotgun, its row-4 center z 0.22), the handguard
 * (smg 0.20, sniper 0.28) or the grip wrap itself (pistol 0.055 — well
 * inside its 0.175 muzzle, never a floating hand beyond the barrel).
 */
const GRIPS: Readonly<Record<AuthoredWeaponArchetype, readonly [number, number, number]>> =
  Object.freeze({
    rifle: [0, -0.055, 0.25],
    smg: [0, -0.06, 0.2],
    shotgun: [0, -0.062, 0.22],
    sniper: [0, -0.056, 0.28],
    pistol: [0, -0.075, 0.055],
  });

/** Allocate the archetype's support-grip point (spawn/swap cadence only). */
export function authoredGripLocal(archetype: AuthoredWeaponArchetype): THREE.Vector3 {
  const g = GRIPS[archetype];
  return new THREE.Vector3(g[0], g[1], g[2]);
}

/** Shared per-archetype geometries, frozen like the team-patch geometry. */
const sharedGeos = new Map<AuthoredWeaponArchetype, THREE.BufferGeometry[]>();

function geosFor(archetype: AuthoredWeaponArchetype): THREE.BufferGeometry[] {
  let geos = sharedGeos.get(archetype);
  if (geos) return geos;
  geos = SPECS[archetype].map((s) => new THREE.BoxGeometry(s.w, s.h, s.d));
  sharedGeos.set(archetype, geos);
  return geos;
}

export interface AuthoredWeaponBuild {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  archetype: AuthoredWeaponArchetype;
  weaponId: string;
}

export const AUTHORED_WEAPON_NAME = 'operator-weapon';
export const AUTHORED_MUZZLE_NAME = 'operator-muzzle';

/**
 * Build one third-person weapon in the caller-owned material. Spawn-time only.
 * Geometries are shared and kept; the Group is per-actor and removed on dispose.
 */
export function buildAuthoredWeapon(
  material: THREE.Material,
  archetype: AuthoredWeaponArchetype,
  weaponId: string,
): AuthoredWeaponBuild {
  const specs = SPECS[archetype];
  const geos = geosFor(archetype);
  const group = new THREE.Group();
  group.name = AUTHORED_WEAPON_NAME;
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const mesh = new THREE.Mesh(geos[i], material);
    mesh.position.set(s.x, s.y, s.z);
    if (s.rx !== undefined) mesh.rotation.x = s.rx;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = AUTHORED_MUZZLE_NAME;
  const m = MUZZLES[archetype];
  muzzle.position.set(m[0], m[1], m[2]);
  group.add(muzzle);
  group.userData.archetype = archetype;
  group.userData.weaponId = weaponId;
  return { group, muzzle, archetype, weaponId };
}

/** Remove any authored weapon riding the hand. Shared geos and caller mats kept. */
export function detachAuthoredWeapon(hand: THREE.Object3D): void {
  const prev = hand.getObjectByName(AUTHORED_WEAPON_NAME);
  if (prev) prev.removeFromParent();
}

/** Attach a built weapon to the RightHand bone (replaces any previous one). */
export function attachAuthoredWeapon(
  bones: Record<StandardBoneName, THREE.Bone>,
  built: AuthoredWeaponBuild,
): void {
  const hand = bones.RightHand;
  if (!hand) return;
  detachAuthoredWeapon(hand);
  hand.add(built.group);
}

/** Find the RightHand bone under an actor root (swap path has no bones dict). */
export function findRightHand(root: THREE.Object3D): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((o) => {
    if (!found && o instanceof THREE.Bone && o.name === 'RightHand') found = o;
  });
  return found;
}

/**
 * Swap the actor's weapon in place: resolve the id to its archetype, rebuild
 * in the caller material, ride the RightHand. Returns the archetype worn, or
 * null when the root carries no authored weapon socket (procedural fallback).
 */
export function setAuthoredWeapon(
  root: THREE.Object3D,
  material: THREE.Material,
  weaponId: string,
): AuthoredWeaponArchetype | null {
  const hand = findRightHand(root);
  if (!hand) return null;
  // three r180 getObjectByName returns undefined on miss (Object3D.js), not
  // null — strict null checks misread every miss. Falsy covers both.
  if (!hand.getObjectByName(AUTHORED_WEAPON_NAME)) {
    // No authored socket (procedural figures bake the rifle into the skin).
    if (!root.getObjectByName('operator-authored')) return null;
  }
  const archetype = resolveAuthoredArchetype(weaponId);
  detachAuthoredWeapon(hand);
  hand.add(buildAuthoredWeapon(material, archetype, weaponId).group);
  return archetype;
}

/** QA read: what the actor's hand carries, or null. Never allocates on miss. */
export function authoredWeaponOf(root: THREE.Object3D): {
  archetype: AuthoredWeaponArchetype;
  weaponId: string;
  group: THREE.Group;
  muzzle: THREE.Object3D;
} | null {
  const group = root.getObjectByName(AUTHORED_WEAPON_NAME) as THREE.Group | null;
  if (!group) return null;
  const muzzle = group.getObjectByName(AUTHORED_MUZZLE_NAME) as THREE.Object3D | null;
  if (!muzzle) return null;
  return {
    archetype: (group.userData.archetype as AuthoredWeaponArchetype) ?? 'rifle',
    weaponId: (group.userData.weaponId as string) ?? '',
    group,
    muzzle,
  };
}
