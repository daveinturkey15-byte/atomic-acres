import * as THREE from 'three';
import { poseEase } from './viewmodel-motion';
import type { FirstPersonHandsRig } from './types';

type Point = readonly [number, number, number];
interface Bind { elbow: Point; wrist: Point; palm: Point }
type MotionKey = readonly [number, number, number, number, number, number, number];

/** Maps the existing sleeve between its real joint centres, preserving length. */
class SleeveAttachment {
  private readonly wrist: THREE.Vector3;
  private readonly elbow: THREE.Vector3;
  private readonly direction: THREE.Vector3;
  private readonly length: number;
  private readonly liveWrist = new THREE.Vector3();
  private readonly liveElbow = new THREE.Vector3();
  private readonly liveDirection = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly inverseHand = new THREE.Matrix4();
  private readonly sleeveMatrix = new THREE.Matrix4();
  private readonly bindInverse: THREE.Matrix4;

  constructor(private hand: THREE.Group, private sleeve: THREE.Group, bind: Bind) {
    this.wrist = new THREE.Vector3(...bind.wrist);
    this.elbow = new THREE.Vector3(...bind.elbow);
    this.direction = this.wrist.clone().sub(this.elbow);
    this.length = this.direction.length();
    this.direction.normalize();
    this.bindInverse = new THREE.Matrix4().makeTranslation(-this.wrist.x, -this.wrist.y, -this.wrist.z);
    // Geometry stays untouched. Only the existing sleeve group's transform changes.
    this.sleeve.matrixAutoUpdate = false;
  }

  update(prone: number, crouch: number, reach: number): void {
    this.hand.updateMatrix();
    this.liveWrist.copy(this.wrist).applyMatrix4(this.hand.matrix);
    this.liveElbow.copy(this.elbow);
    this.liveElbow.x += this.elbow.x < 0 ? -0.035 * prone : 0.025 * prone;
    this.liveElbow.y += 0.17 * prone + 0.035 * crouch;
    // The upper arm follows the reach, but the sleeve never scales or detaches.
    this.liveElbow.z += reach * 0.10;
    this.liveDirection.subVectors(this.liveWrist, this.liveElbow).normalize();
    this.liveElbow.copy(this.liveWrist).addScaledVector(this.liveDirection, -this.length);
    this.turn.setFromUnitVectors(this.direction, this.liveDirection);
    this.sleeveMatrix.makeRotationFromQuaternion(this.turn);
    this.sleeveMatrix.setPosition(this.liveWrist).multiply(this.bindInverse);
    this.inverseHand.copy(this.hand.matrix).invert();
    this.sleeve.matrix.multiplyMatrices(this.inverseHand, this.sleeveMatrix);
    this.sleeve.matrix.decompose(this.sleeve.position, this.sleeve.quaternion, this.sleeve.scale);
    this.sleeve.matrixWorldNeedsUpdate = true;
  }

  reset(): void {
    this.sleeve.matrix.identity();
    this.sleeve.position.set(0, 0, 0);
    this.sleeve.quaternion.identity();
    this.sleeve.scale.set(1, 1, 1);
    this.sleeve.matrixWorldNeedsUpdate = true;
  }
}

/**
 * Original authored reach, release, seat, return. Coordinates are weapon-local.
 * The palm is the contact constraint; the wrist pivots around it and the sleeve
 * follows the wrist. No ammo, clip event, timer or shot is authored here.
 */
export function createHandMotion(
  rig: Pick<FirstPersonHandsRig, 'triggerHand' | 'supportHand' | 'supportForearm'>,
  triggerForearm: THREE.Group, trigger: Bind, support: Bind, reloadDelta: Point,
  contactPath?: readonly MotionKey[],
): Pick<FirstPersonHandsRig, 'updateReload' | 'resetReload' | 'updatePose'> {
  const triggerSleeve = new SleeveAttachment(rig.triggerHand, triggerForearm, trigger);
  const supportSleeve = new SleeveAttachment(rig.supportHand, rig.supportForearm, support);
  const palm = new THREE.Vector3(...support.palm);
  const rotatedPalm = new THREE.Vector3();
  const desiredPalm = new THREE.Vector3();
  const angles = new THREE.Euler(0, 0, 0, 'YXZ');
  let phase = 0;
  let stanceProne = 0;
  let stanceCrouch = 0;
  let offHand = 0;
  // Time, translation delta, wrist pitch/yaw/roll. Existing five weapon anchors
  // supply the seat position; the path clears the receiver on its outside.
  const keys: readonly MotionKey[] = contactPath ?? [
    [0, 0, 0, 0, 0, 0, 0],
    [0.12, -0.030, -0.015, 0.015, -0.16, -0.08, -0.12],
    [0.34, -0.070, reloadDelta[1] - 0.065, reloadDelta[2] * 0.72, -0.35, -0.16, -0.23],
    [0.50, reloadDelta[0], reloadDelta[1], reloadDelta[2], -0.10, 0.12, -0.12],
    [0.62, reloadDelta[0], reloadDelta[1] + 0.007, reloadDelta[2], -0.04, 0.10, -0.09],
    [0.79, -0.040, -0.008, reloadDelta[2] * 0.45, -0.14, -0.04, -0.10],
    [1, 0, 0, 0, 0, 0, 0],
  ];
  const apply = (): void => {
    // New wrapped-hand paths must return along their clear route when an offhand
    // action takes ownership. A straight pose blend cuts through the weapon.
    // Legacy rigs retain their established blend and exact timing behaviour.
    const pathPhase = contactPath ? phase * (1 - offHand) : phase;
    let index = 0;
    while (index < keys.length - 2 && pathPhase > keys[index + 1][0]) index++;
    const a = keys[index];
    const b = keys[index + 1];
    const t = poseEase((pathPhase - a[0]) / (b[0] - a[0]));
    const weight = contactPath ? 1 : 1 - offHand;
    const x = (a[1] + (b[1] - a[1]) * t) * weight;
    const y = (a[2] + (b[2] - a[2]) * t) * weight;
    const z = (a[3] + (b[3] - a[3]) * t) * weight;
    angles.set(
      (a[4] + (b[4] - a[4]) * t) * weight,
      (a[5] + (b[5] - a[5]) * t) * weight,
      (a[6] + (b[6] - a[6]) * t) * weight,
    );
    rig.supportHand.quaternion.setFromEuler(angles);
    desiredPalm.copy(palm);
    desiredPalm.x += x; desiredPalm.y += y; desiredPalm.z += z;
    rotatedPalm.copy(palm).applyQuaternion(rig.supportHand.quaternion);
    rig.supportHand.position.subVectors(desiredPalm, rotatedPalm);
    supportSleeve.update(stanceProne, stanceCrouch, Math.sin(pathPhase * Math.PI) * weight);
    triggerSleeve.update(stanceProne, stanceCrouch, 0);
  };
  return {
    updateReload(progress: number): void {
      phase = Number.isFinite(progress) && progress > 0 && progress < 1 ? progress : 0;
      apply();
    },
    resetReload(): void {
      phase = 0;
      rig.supportHand.position.set(0, 0, 0);
      rig.supportHand.quaternion.identity();
      supportSleeve.reset();
      triggerSleeve.reset();
    },
    updatePose(crouch: number, prone: number, handLower: number): void {
      stanceCrouch = crouch; stanceProne = prone; offHand = handLower;
      apply();
    },
  };
}
