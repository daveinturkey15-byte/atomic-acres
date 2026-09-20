import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { FirstPersonHandsRig } from './types';
import { createHandMotion } from './first-person-hands-motion';
import { isMotionCanaryRequested } from './viewmodel-motion';
import { createRiggedPistolHands, isRiggedPistolRequested } from './rigged-pistol-hands';
import { createRiggedRifleHands, isRiggedRifleRequested } from './rigged-rifle-hands';
import {
  buildCanarySideGeometries,
  materializeCanarySide,
  supportJointsFor,
  TRIGGER_SPEC,
  WEAPON_ANCHORS,
} from './hand-geometry-canary';

type ArmPoint = readonly [number, number, number];

/** Static limb fitted between actual joint centres; no disconnected offsets. */
function armSegment(
  wristRadius: number,
  elbowRadius: number,
  material: THREE.Material,
  elbow: ArmPoint,
  wrist: ArmPoint,
): THREE.Mesh {
  const start = new THREE.Vector3(...elbow);
  const end = new THREE.Vector3(...wrist);
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(wristRadius, elbowRadius, direction.length(), 10, 1),
    material,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, direction.normalize());
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Build the shared camera-local hands. The eight meshes are grouped by named
 * trigger/support containers so the reload pass can move the support hand
 * independently while leaving the rifle and planted trigger hand stable.
 *
 * Geometry and materials are all construction-time work. `updateReload` only
 * writes transforms on existing groups and returns to the exact bind pose at
 * progress 0 or 1, including a cancelled/invalid phase.
 */
export function createFirstPersonHands(
  parent: THREE.Group,
  mat: MaterialLibrary,
  supportZ: number,
  supportY = -0.055,
  reloadTarget: readonly [number, number, number] = [0.014, -0.038, Math.min(0.18, Math.max(0.08, -supportZ * 0.52))],
  motionCanary = isMotionCanaryRequested(),
): FirstPersonHandsRig {
  if (supportZ === -0.08 && supportY === -0.055 && isRiggedPistolRequested()) {
    return createRiggedPistolHands(parent, mat);
  }
  if (supportZ === -0.36 && supportY === -0.055 && isRiggedRifleRequested()) {
    return createRiggedRifleHands(parent, mat);
  }
  const sleeve = mat.viewmodel.sleeve;
  const cuff = mat.painted(PAL.opWebbingDark, 0.99, 0);
  const glove = mat.viewmodel.darkGlove;
  const gloveDetail = mat.viewmodel.gloveDetail;

  const root = new THREE.Group();
  root.name = 'FirstPersonHands';
  const triggerSide = materializeCanarySide(
    buildCanarySideGeometries({
      side: 'trigger',
      elbow: TRIGGER_SPEC.elbow,
      wrist: TRIGGER_SPEC.wrist,
      palmCenter: TRIGGER_SPEC.palm,
      palmRz: TRIGGER_SPEC.palmRz,
    }),
    { sleeve, glove, gloveDetail },
    'trigger',
  );
  const anchor = WEAPON_ANCHORS.find((candidate) =>
    candidate.supportZ === supportZ
    && candidate.supportY === supportY
    && candidate.reloadTarget[0] === reloadTarget[0]
    && candidate.reloadTarget[1] === reloadTarget[1]
    && candidate.reloadTarget[2] === reloadTarget[2])
    ?? {
      weapon: 'rifle' as const,
      supportZ,
      supportY,
      reloadTarget: [reloadTarget[0], reloadTarget[1], reloadTarget[2]] as readonly [number, number, number],
    };
  const supportJoints = supportJointsFor(anchor);
  const supportSide = materializeCanarySide(
    buildCanarySideGeometries({
      side: 'support',
      elbow: supportJoints.elbow,
      wrist: supportJoints.wrist,
      palmCenter: supportJoints.palm,
      palmRz: 0.15,
    }),
    { sleeve, glove, gloveDetail },
    'support',
  );
  const triggerHand = triggerSide.hand;
  const triggerForearm = triggerSide.forearm;
  const supportHand = supportSide.hand;
  const supportForearm = supportSide.forearm;
  root.add(triggerHand, supportHand);
  parent.add(root);

  // Trigger hand: the canary supplies the connected sleeve and articulated
  // palm/digits. Keep the separate dark cuff transition from the accepted rig.
  triggerHand.add(armSegment(
    0.033, 0.034, cuff,
    [0.039, -0.17, 0.066], [0.015, -0.135, 0.025],
  ));

  // Support hand: fitted to the helper's per-weapon joints. During reload only
  // the named SupportHand group moves toward the magazine.
  supportHand.add(armSegment(
    0.031, 0.033, cuff,
    [-0.034, supportY - 0.073, supportZ + 0.040],
    [-0.017, supportY - 0.030, supportZ + 0.013],
  ));

  // The reach is deliberately short and weapon-local. Builders pass the
  // measured palm target for their magazine, grip well, loading port, or
  // breech rather than relying on one generic depth for every firearm.
  const targetX = reloadTarget[0];
  const targetY = reloadTarget[1];
  const targetZ = reloadTarget[2];

  const resetReload = (): void => {
    supportHand.position.set(0, 0, 0);
    supportHand.rotation.set(0, 0, 0);
  };

  const updateReload = (progress: number): void => {
    // NaN and out-of-band values are treated as cancellation. This also makes
    // completion deterministic for callers that advance past one.
    if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) {
      resetReload();
      return;
    }

    let x = 0;
    let y = 0;
    let z = 0;
    let rz = 0;
    if (progress < 0.14) {
      const t = smoothStep(progress / 0.14);
      x = -0.010 * t;
      y = -0.010 * t;
      z = -0.022 * t;
      rz = 0.045 * t;
    } else if (progress < 0.50) {
      const t = smoothStep((progress - 0.14) / 0.36);
      x = mix(-0.010, targetX, t);
      y = mix(-0.010, targetY, t);
      z = mix(-0.022, targetZ, t);
      rz = mix(0.045, -0.075, t);
    } else if (progress < 0.64) {
      // A small seated pause gives the thumb/index volume time to read as
      // contacting the magazine or breech before the hand returns.
      const t = smoothStep((progress - 0.50) / 0.14);
      x = targetX;
      y = targetY - 0.004 * t;
      z = targetZ + 0.006 * t;
      rz = mix(-0.075, -0.060, t);
    } else {
      const t = smoothStep((progress - 0.64) / 0.36);
      x = mix(targetX, 0, t);
      y = mix(targetY - 0.004, 0, t);
      z = mix(targetZ + 0.006, 0, t);
      rz = mix(-0.060, 0, t);
    }
    supportHand.position.set(x, y, z);
    supportHand.rotation.set(0, 0, rz);
  };

  if (motionCanary) {
    const motion = createHandMotion(
      { triggerHand, supportHand, supportForearm }, triggerForearm,
      TRIGGER_SPEC, supportJoints, reloadTarget,
    );
    motion.resetReload();
    return { root, triggerHand, supportHand, supportForearm, ...motion };
  }
  resetReload();
  return { root, triggerHand, supportHand, supportForearm, updateReload, resetReload };
}
