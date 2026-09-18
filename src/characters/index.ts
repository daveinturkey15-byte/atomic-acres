/**
 * Characters lane - single entry point. The orchestrator wires this into
 * main.ts; this module never touches the scene itself beyond what it is
 * handed.
 *
 * Wiring (5 lines in main.ts, next to the weapons/UI wiring):
 *
 *   import { createCharacterSystem } from './characters';
 *   const characters = createCharacterSystem(scene, {
 *     skin: mat.painted(PAL.mannequin, 0.72, 0),
 *     cloth: mat.painted(PAL.signTeal, 0.62, 0.04),
 *     dark: mat.painted(PAL.truckCab, 0.8, 0),
 *   });
 *   // per frame, inside frame(): characters.update(dt, world.camera.position);
 *
 * Materials MUST be ctx.mat singletons (painted() with new uniform sets is
 * fine - new programs are not). Clips are built once per system; spawning
 * twelve costs bones and meshes, never programs.
 *
 * Demo (no main.ts change needed): serve `public/characters/index.html` from
 * a dev server and drive it headlessly - see DEMO.md in that folder.
 */
import * as THREE from 'three';
import { CharacterSystem } from './system';
import type { CharacterDress } from './mesh';

export { CharacterSystem, type CharacterHandle, type SystemBudget } from './system';
export { CharacterRig, OverlaySampler, type RigInput } from './blend';
export {
  buildClipLibrary,
  type ClipLibrary,
  type ClipName,
  type ClipSpec,
  type LocomotionName,
} from './clips';
export {
  BONE_NAMES,
  BONE_PARENTS,
  REST_OFFSETS,
  UPPER_BODY,
  STANDARD_HEIGHT,
  buildStandardSkeleton,
  legChain,
  type StandardBoneName,
  type StandardSkeleton,
} from './skeleton';
export {
  CMU_BONE_MAP,
  animJsonToClip,
  parseBVH,
  resampleClip,
  retargetToStandard,
  trimClip,
  zUpToYUpRoot,
  type AnimJsonDoc,
} from './retarget';
export {
  dressProcedural,
  type CharacterDress,
  type CharacterMesh,
} from './mesh';

export function createCharacterSystem(
  scene: THREE.Scene,
  dress: CharacterDress,
): CharacterSystem {
  return new CharacterSystem(scene, dress);
}
