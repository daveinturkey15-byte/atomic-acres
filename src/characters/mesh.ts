/**
 * CharacterMesh: the pluggable mesh seam.
 *
 * The rig (blend.ts) animates bones; this file clothes them. Any mesh that
 * follows a standard skeleton qualifies - the procedural implementation below
 * today, a generated or Quaternius skinned mesh tomorrow - without touching
 * the skeleton, the clips or the blend tree.
 *
 * Materials are caller-owned and passed in: the game passes ctx.mat singletons
 * (no new shader programs), the demo page passes its own. This module never
 * constructs a material for the game world.
 */
import * as THREE from 'three';
import type { StandardBoneName } from './skeleton';

export interface CharacterMesh {
  /** Skeleton root, already dressed. Add to the scene, hand to the rig. */
  root: THREE.Object3D;
  /** Detach from parent. Shared geometries and caller materials are kept. */
  dispose(): void;
}

export interface CharacterDress {
  skin: THREE.Material;
  cloth: THREE.Material;
  dark: THREE.Material;
}

/** Module-level geometry cache: one copy per part for every character. */
const geoCache = new Map<string, THREE.BufferGeometry>();

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = geoCache.get(key);
  if (hit) return hit as T;
  const g = make();
  geoCache.set(key, g);
  return g;
}

function capsule(r: number, len: number): THREE.CapsuleGeometry {
  return geo(`cap-${r}-${len}`, () => new THREE.CapsuleGeometry(r, len, 3, 10));
}

function jointBall(r: number): THREE.SphereGeometry {
  return geo(`j-${r}`, () => new THREE.SphereGeometry(r, 10, 8));
}

function torsoGeo(wTop: number, wBot: number, h: number, d: number): THREE.CylinderGeometry {
  void d;
  // Tapered 8-sided torso pressing, mannequin-family read. Depth is carried
  // by non-uniform mesh scale so one geometry serves pelvis and chest.
  return geo(`tor-${wTop}-${wBot}-${h}`, () => new THREE.CylinderGeometry(wTop, wBot, h, 8));
}

function headGeo(): THREE.IcosahedronGeometry {
  return geo('head', () => new THREE.IcosahedronGeometry(0.5, 1));
}

/**
 * Procedural implementation: capsule limbs and joint balls bound as children
 * of the given bones, in the mannequin visual family (moulded-plastic people,
 * not bare rigs) but hierarchical, so every clip drives them.
 */
export function dressProcedural(
  root: THREE.Object3D,
  bones: Record<StandardBoneName, THREE.Bone>,
  dress: CharacterDress,
): CharacterMesh {
  const added: THREE.Object3D[] = [];
  const put = (
    bone: StandardBoneName,
    g: THREE.BufferGeometry,
    m: THREE.Material,
    x = 0, y = 0, z = 0,
    sx = 1, sy = 1, sz = 1,
    rx = 0,
  ): void => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.x = rx;
    mesh.castShadow = true;
    bones[bone].add(mesh);
    added.push(mesh);
  };
  // Pelvis + torso pressings (8-sided taper, depth via z scale). The abdomen
  // bridges pelvis-top to chest-bottom: without it the waist is background.
  put('Hips', torsoGeo(0.1, 0.13, 0.16, 0), dress.cloth, 0, 0.06, 0, 1, 1, 0.72);
  put('Spine', torsoGeo(0.105, 0.1, 0.2, 0), dress.cloth, 0, 0.02, 0, 1, 1, 0.66);
  put('Chest', torsoGeo(0.15, 0.1, 0.42, 0), dress.cloth, 0, 0.1, 0, 1, 1, 0.62);
  put('Neck', capsule(0.045, 0.05), dress.skin, 0, 0.03, 0);
  // Head: unit icosahedron scaled to skull + jaw slightly forward.
  put('Head', headGeo(), dress.skin, 0, 0.14, 0.01, 0.24, 0.3, 0.26);

  // Shoulders read as balls under the sleeve, like the mannequins.
  for (const side of ['Left', 'Right'] as const) {
    const arm = `${side}Arm` as StandardBoneName;
    const fore = `${side}ForeArm` as StandardBoneName;
    const hand = `${side}Hand` as StandardBoneName;
    const up = `${side}UpLeg` as StandardBoneName;
    const leg = `${side}Leg` as StandardBoneName;
    const foot = `${side}Foot` as StandardBoneName;
    const toe = `${side}Toe` as StandardBoneName;
    put(`${side}Shoulder` as StandardBoneName, jointBall(0.07), dress.cloth);
    // Upper arm hangs 0.294: capsule r0.05 len 0.19 centred at -0.147.
    put(arm, capsule(0.052, 0.19), dress.cloth, 0, -0.147, 0);
    put(fore, jointBall(0.05), dress.skin, 0, 0, 0);
    put(fore, capsule(0.042, 0.19), dress.skin, 0, -0.138, 0);
    put(hand, jointBall(0.05), dress.skin, 0, -0.03, 0);
    put(up, jointBall(0.075), dress.cloth, 0, 0, 0);
    put(up, capsule(0.068, 0.3), dress.cloth, 0, -0.218, 0);
    put(leg, jointBall(0.06), dress.skin, 0, 0, 0);
    put(leg, capsule(0.052, 0.3), dress.skin, 0, -0.2, 0);
    // Foot: heel ball at the ankle, toe box spanning ankle -> tip. The box
    // hangs off the Foot bone (not the Toe tip joint) so flex never detaches
    // it mid-pose.
    put(foot, jointBall(0.055), dress.dark, 0, -0.01, 0.02);
    put(foot, torsoGeo(0.05, 0.055, 0.18, 0), dress.dark, 0, -0.015, 0.09, 1, 1, 1, Math.PI / 2);
  }

  return {
    root,
    dispose(): void {
      for (const m of added) m.parent?.remove(m);
      root.parent?.remove(root);
    },
  };
}

/**
 * External-skin seam (Quaternius, generated meshes, anything rigged).
 * A downloaded rigged mesh arrives with its own bone names and proportions;
 * bind it by mapping its joints onto the standard skeleton and playing the
 * same clips through retarget.ts - the mesh never touches the blend tree
 * directly. Implemented on first use with a real file; the interface above
 * is what it will satisfy, which is the seam this lane has to prove.
 */
export type { StandardBoneName };
