import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { FirstPersonHandsRig } from './types';

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

function palm(
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rz = 0,
  sx = 0.032,
  sy = 0.043,
  sz = 0.050,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.z = rz;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** Low-profile curled digit bundle kept separate from the palm silhouette. */
function fingerBundle(
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rz = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.022, 2, 6), material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rz;
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
): FirstPersonHandsRig {
  const sleeve = mat.viewmodel.sleeve;
  const cuff = mat.painted(PAL.opWebbingDark, 0.99, 0);
  const glove = mat.viewmodel.darkGlove;
  const gloveDetail = mat.viewmodel.gloveDetail;

  const root = new THREE.Group();
  root.name = 'FirstPersonHands';
  const triggerHand = new THREE.Group();
  triggerHand.name = 'TriggerHand';
  const triggerForearm = new THREE.Group();
  triggerForearm.name = 'TriggerForearm';
  const supportHand = new THREE.Group();
  supportHand.name = 'SupportHand';
  const supportForearm = new THREE.Group();
  supportForearm.name = 'SupportForearm';
  triggerHand.add(triggerForearm);
  supportHand.add(supportForearm);
  root.add(triggerHand, supportHand);
  parent.add(root);

  // Trigger hand: the connected sleeve follows the measured elbow-to-wrist
  // segment, with a smaller thumb/index mass instead of a second mitten palm.
  triggerForearm.add(armSegment(
    0.031, 0.047, sleeve,
    [0.19, -0.39, 0.28], [0.025, -0.15, 0.045],
  ));
  triggerHand.add(armSegment(
    0.033, 0.034, cuff,
    [0.039, -0.17, 0.066], [0.015, -0.135, 0.025],
  ));
  triggerHand.add(palm(glove, 0.010, -0.112, 0.012, -0.16));
  triggerHand.add(fingerBundle(gloveDetail, 0.039, -0.092, -0.014, -0.22));

  // Support hand: these points remain tied to the weapon's handguard frame.
  // During reload only the named SupportHand group moves toward the magazine.
  supportForearm.add(armSegment(
    0.030, 0.045, sleeve,
    [-0.16, -0.39, supportZ + 0.20],
    [-0.024, supportY - 0.047, supportZ + 0.025],
  ));
  supportHand.add(armSegment(
    0.031, 0.033, cuff,
    [-0.034, supportY - 0.073, supportZ + 0.040],
    [-0.017, supportY - 0.030, supportZ + 0.013],
  ));
  supportHand.add(palm(glove, -0.010, supportY, supportZ, 0.15));
  supportHand.add(fingerBundle(gloveDetail, -0.036, supportY + 0.012, supportZ - 0.018, 0.22));

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

  resetReload();
  return { root, triggerHand, supportHand, supportForearm, updateReload, resetReload };
}
