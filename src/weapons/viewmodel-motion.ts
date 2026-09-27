import * as THREE from 'three';
import type { WeaponFamily } from './families';

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
  // Keep the receiver presented until the support hand clears the seat/return
  // waypoint at .79. Only the last .21 raises it; no reload event is generated.
  return poseEase(progress / 0.18) * (1 - poseEase((progress - 0.79) / 0.21));
}

/** Original carry weights, not measured physical masses. */
const CARRY_WEIGHT: Readonly<Record<WeaponFamily, number>> = {
  pistol: 0.7, smg: 0.85, rifle: 1, lmg: 1.7, dmr: 1.3,
  sniper: 1.45, shotgun: 1.3, special: 1.2, exotic: 1.2,
};

/** Fixed landing gesture: downstroke then recovery, never inferred impact force. */
export function landingPresentation(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds >= .275) return 0;
  return poseEase(seconds / .065) * (1 - poseEase((seconds - .065) / .21));
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
  private carry = 0;
  private airborneFor = 0;
  private previousGrounded = true;
  private landingAge = 1;

  reset(): void {
    this.initialized = false;
    this.lagYaw = this.lagPitch = this.recoil = 0;
    this.crouch = this.prone = 0;
    this.carry = this.airborneFor = 0;
    this.previousGrounded = true;
    this.landingAge = 1;
  }

  update(
    dt: number, time: number, family: WeaponFamily, ads: number, sprint: number,
    bobPhase: number, bobScale: number, reload: number, offHand: number,
    kickPitch: number, lookPitch: number, lookYaw: number,
    crouched: boolean, prone: boolean, grounded = true,
  ): void {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(.05, dt)) : 0;
    const weight = CARRY_WEIGHT[family];
    if (!this.initialized) this.previousGrounded = grounded;
    if (!grounded) this.airborneFor += step;
    else {
      if (!this.previousGrounded && this.airborneFor >= .08) this.landingAge = 0;
      this.airborneFor = 0;
    }
    this.previousGrounded = grounded;
    this.landingAge = Math.min(1, this.landingAge + step);
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
    this.lagYaw = THREE.MathUtils.clamp((this.lagYaw - yawDelta * 0.22) * Math.exp(-12 * step / weight), -0.045, 0.045);
    this.lagPitch = THREE.MathUtils.clamp((this.lagPitch - pitchDelta * 0.18) * Math.exp(-12 * step / weight), -0.035, 0.035);
    const recoilTarget = Math.min(0.08, Math.max(0, kickPitch));
    this.recoil += (recoilTarget - this.recoil)
      * (1 - Math.exp(-(recoilTarget > this.recoil ? 42 : 20 / weight) * step));
    this.carry += (sprint - this.carry)
      * (1 - Math.exp(-(sprint > this.carry ? 12 : 18) * step / weight));
    const aim = poseEase(ads);
    const free = 1 - aim;
    const action = reloadPresentation(reload) * (1 - offHand);
    const low = this.crouch * 0.35 + this.prone * 0.65;
    const stride = bobScale * (1 - aim * 0.92) * (1 - low * 0.65);
    const breath = (1 - bobScale * 0.7) * free;
    const pistol = family === 'pistol';
    const heavy = family === 'sniper' || family === 'shotgun' || family === 'lmg' || family === 'dmr';
    const sprintPose = this.carry * free * (1 - action) * (1 - offHand);
    const landing = landingPresentation(this.landingAge) * free * (1 - offHand)
      * (1 - action) * (1 - low * .7);
    // A slightly further hip mount reveals more of the connected support arm.
    // ADS endpoint remains exactly (0, -.148, -.3), including all hero corrections.
    this.offset.set(
      0.195 * free + Math.sin(time * 1.16) * 0.0025 * breath
        + Math.sin(bobPhase) * 0.005 * stride - 0.065 * action - (0.12 + 0.68 * low) * offHand,
      -0.18 + 0.032 * aim + Math.sin(time * 1.71) * 0.0018 * breath
        + Math.sin(bobPhase * 2) * 0.005 * stride - 0.065 * sprintPose
        + 0.04 * action + 0.016 * low * free - 0.24 * (1 - low) * offHand - .009 * landing,
      -0.50 + 0.20 * aim + 0.035 * action + 0.10 * offHand
        + this.recoil * (heavy ? 0.65 : 0.45),
    );
    this.rotation.set(
      0.24 * sprintPose + (pistol ? 0.16 : 0.09) * action
        + 0.20 * (1 - low) * offHand + this.lagPitch * free + this.recoil * 0.60 + .018 * landing,
      -0.12 * sprintPose + 0.18 * action + 0.6 * low * offHand + this.lagYaw * free,
      -0.16 * sprintPose - (pistol ? 0.36 : 0.29) * action
        - 0.42 * (1 - low) * offHand + Math.sin(bobPhase) * 0.011 * stride,
    );
  }
}
