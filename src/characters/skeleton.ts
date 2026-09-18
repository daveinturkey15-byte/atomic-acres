/**
 * Standard humanoid skeleton definition - data only, no three.js scene state.
 *
 * Everything in src/characters keys off this: procedural clips author tracks
 * against these bone names, retarget.ts maps external (CMU/BVH/Quaternius)
 * joints onto them, and mesh.ts binds geometry to the hierarchy built here.
 *
 * Naming follows the common humanoid convention (Hips, Spine, Chest, Neck,
 * Head, Left/Right Shoulder/Arm/ForeArm/Hand, UpLeg/Leg/Foot/Toe) so any
 * future source retargets without inventing a new mapping.
 *
 * Proportions are the mannequin rig's (src/build/mannequins.ts P, fractions
 * of height) scaled to an adult H of 1.78 m. Same family, same read - but a
 * real joint hierarchy instead of a pose table, so BVH and glTF clips drive it.
 */
import * as THREE from 'three';

/** Adult reference height in metres. All offsets below are metres. */
export const STANDARD_HEIGHT = 1.78;

/** Every bone in the standard skeleton, in parent-before-child order. */
export const BONE_NAMES = [
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToe',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToe',
] as const;

export type StandardBoneName = (typeof BONE_NAMES)[number];

/** Parent of each bone; null for the root. */
export const BONE_PARENTS: Record<StandardBoneName, StandardBoneName | null> = {
  Hips: null,
  Spine: 'Hips',
  Chest: 'Spine',
  Neck: 'Chest',
  Head: 'Neck',
  LeftShoulder: 'Chest',
  LeftArm: 'LeftShoulder',
  LeftForeArm: 'LeftArm',
  LeftHand: 'LeftForeArm',
  RightShoulder: 'Chest',
  RightArm: 'RightShoulder',
  RightForeArm: 'RightArm',
  RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips',
  LeftLeg: 'LeftUpLeg',
  LeftFoot: 'LeftLeg',
  LeftToe: 'LeftFoot',
  RightUpLeg: 'Hips',
  RightLeg: 'RightUpLeg',
  RightFoot: 'RightLeg',
  RightToe: 'RightFoot',
};

/**
 * Rest offset of each bone from its parent, in metres (adult 1.78 m).
 * Forward is +z. Derived from the mannequin proportions so the two populations
 * match; see module comment.
 */
export const REST_OFFSETS: Record<StandardBoneName, [number, number, number]> = {
  Hips: [0, 0.877, 0],
  Spine: [0, 0.195, 0],
  Chest: [0, 0.2, 0],
  Neck: [0, 0.27, 0],
  Head: [0, 0.14, 0],
  LeftShoulder: [-0.18, 0.18, 0],
  LeftArm: [0, -0.02, 0],
  LeftForeArm: [0, -0.294, 0],
  LeftHand: [0, -0.276, 0],
  RightShoulder: [0.18, 0.18, 0],
  RightArm: [0, -0.02, 0],
  RightForeArm: [0, -0.294, 0],
  RightHand: [0, -0.276, 0],
  LeftUpLeg: [-0.098, 0, 0],
  LeftLeg: [0, -0.436, 0],
  LeftFoot: [0, -0.401, 0],
  LeftToe: [0, -0.02, 0.16],
  RightUpLeg: [0.098, 0, 0],
  RightLeg: [0, -0.436, 0],
  RightFoot: [0, -0.401, 0],
  RightToe: [0, -0.02, 0.16],
};

/** Bones that belong to the upper body (aim/fire/reload overlay touches only these). */
export const UPPER_BODY: Record<string, true> = {
  Chest: true,
  Neck: true,
  Head: true,
  LeftShoulder: true,
  LeftArm: true,
  LeftForeArm: true,
  LeftHand: true,
  RightShoulder: true,
  RightArm: true,
  RightForeArm: true,
  RightHand: true,
};

/** Bones that belong to one leg chain, root-first. Laterality by prefix. */
export function legChain(side: 'Left' | 'Right'): StandardBoneName[] {
  return [`${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}Toe`] as StandardBoneName[];
}

export interface StandardSkeleton {
  /** Root object to add to the scene and to hand to AnimationMixer. */
  root: THREE.Object3D;
  bones: Record<StandardBoneName, THREE.Bone>;
  skeleton: THREE.Skeleton;
  /** World-space rest height of the head top, metres. */
  height: number;
}

/**
 * Build a fresh standard-skeleton hierarchy. Call once per character.
 *
 * The returned root is a plain Group ABOVE the Hips bone, and it is the
 * mixer root and the object the game moves. This separation is load-bearing:
 * locomotion clips author Hips.position tracks, so translating the Hips bone
 * itself would be overwritten by the mixer every frame. The game (and the
 * crowd system) moves only the wrapper; ground height reads off
 * root.position.y, which no clip touches.
 */
export function buildStandardSkeleton(): StandardSkeleton {
  const bones = {} as Record<StandardBoneName, THREE.Bone>;
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    const [x, y, z] = REST_OFFSETS[name];
    b.position.set(x, y, z);
    bones[name] = b;
  }
  for (const name of BONE_NAMES) {
    const parent = BONE_PARENTS[name];
    if (parent) bones[parent].add(bones[name]);
  }
  const root = new THREE.Group();
  root.name = 'CharacterRoot';
  root.add(bones.Hips);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(Object.values(bones));
  const headTop = new THREE.Vector3();
  bones.Head.getWorldPosition(headTop);
  return { root, bones, skeleton, height: headTop.y + 0.15 };
}
