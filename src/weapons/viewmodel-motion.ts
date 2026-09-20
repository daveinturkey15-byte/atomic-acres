import * as THREE from 'three';
import type { FallbackRig } from './families';

/** Review switch; construction-time only. The accepted pose remains the default. */
export function isMotionCanaryRequested(): boolean {
  return typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('motion') === 'canary';
}

export function poseEase(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Presentation envelope only; the controller's reload clock remains authoritative. */
export function reloadPresentation(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) return 0;
  return poseEase(progress / 0.18) * (1 - poseEase((progress - 0.73) / 0.27));
}

/** One instance per controller. No vectors, curves or arrays are created in update. */
export class ViewmodelMotion {
  readonly offset = new THREE.Vector3();
  readonly rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  crouch = 0;
  prone = 0;
  private lagYaw = 0;
  private lagPitch = 0;
  private previousYaw = 0;
  private previousPitch = 0;
  private initialized = false;
  private recoil = 0;

  reset(): void {
    this.initialized = false;
    this.lagYaw = this.lagPitch = this.recoil = 0;
    this.crouch = this.prone = 0;
  }

  update(
    dt: number, time: number, family: FallbackRig, ads: number, sprint: number,
    bobPhase: number, bobScale: number, reload: number, offHand: number,
    kickPitch: number, lookPitch: number, lookYaw: number,
    crouched: boolean, prone: boolean,
  ): void {
    const follow = 1 - Math.exp(-14 * dt);
    // Switching/resuming while already prone must not briefly restore standing elbows.
    if (!this.initialized) {
      this.crouch = crouched ? 1 : 0;
      this.prone = prone ? 1 : 0;
    }
    this.crouch += ((crouched ? 1 : 0) - this.crouch) * follow;
    this.prone += ((prone ? 1 : 0) - this.prone) * follow;
    if (!this.initialized) {
      this.previousYaw = lookYaw;
      this.previousPitch = lookPitch;
      this.initialized = true;
    }
    const yawDelta = Math.atan2(Math.sin(lookYaw - this.previousYaw), Math.cos(lookYaw - this.previousYaw));
    const pitchDelta = lookPitch - this.previousPitch;
    this.previousYaw = lookYaw;
    this.previousPitch = lookPitch;
    // Input inertia is bounded and disappears at settled ADS: it cannot move the sight line.
    this.lagYaw = THREE.MathUtils.clamp((this.lagYaw - yawDelta * 0.22) * Math.exp(-12 * dt), -0.045, 0.045);
    this.lagPitch = THREE.MathUtils.clamp((this.lagPitch - pitchDelta * 0.18) * Math.exp(-12 * dt), -0.035, 0.035);
    this.recoil += (Math.min(0.08, Math.max(0, kickPitch)) - this.recoil) * (1 - Math.exp(-28 * dt));
    const aim = poseEase(ads);
    const free = 1 - aim;
    const action = reloadPresentation(reload) * (1 - offHand);
    const low = this.crouch * 0.35 + this.prone * 0.65;
    const stride = bobScale * (1 - aim * 0.92) * (1 - low * 0.65);
    const breath = (1 - bobScale * 0.7) * free;
    const pistol = family === 'pistol';
    const heavy = family === 'sniper' || family === 'shotgun';
    const sprintPose = sprint * free * (1 - action) * (1 - offHand);
    // A slightly further hip mount reveals more of the connected support arm.
    // ADS endpoint remains exactly (0, -.148, -.3), including all hero corrections.
    this.offset.set(
      0.195 * free + Math.sin(time * 1.16) * 0.0025 * breath
        + Math.sin(bobPhase) * 0.005 * stride - 0.065 * action - (0.12 + 0.68 * low) * offHand,
      -0.18 + 0.032 * aim + Math.sin(time * 1.71) * 0.0018 * breath
        + Math.sin(bobPhase * 2) * 0.005 * stride - 0.065 * sprintPose
        + 0.04 * action + 0.016 * low * free - 0.24 * (1 - low) * offHand,
      -0.50 + 0.20 * aim + 0.035 * action + 0.10 * offHand
        + this.recoil * (heavy ? 0.65 : 0.45),
    );
    this.rotation.set(
      0.24 * sprintPose + (pistol ? 0.16 : 0.09) * action
        + 0.20 * (1 - low) * offHand + this.lagPitch * free + this.recoil * 0.60,
      -0.12 * sprintPose + 0.18 * action + 0.6 * low * offHand + this.lagYaw * free,
      -0.16 * sprintPose - (pistol ? 0.36 : 0.29) * action
        - 0.42 * (1 - low) * offHand + Math.sin(bobPhase) * 0.011 * stride,
    );
  }
}
