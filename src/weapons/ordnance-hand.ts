/**
 * Atomic Acres — the off hand: grenade arm/hold/throw, the knife swing and the
 * pickup reach, as procedural poses in the camera frame.
 *
 * Owned by `WeaponsController`, which mounts the gun; this class mounts the
 * knife and the held grenade beside it and tells the controller how far to
 * lower the gun while the hand is busy. Every pose is arithmetic over a phase
 * in `[0, 1]` with a handful of key positions — no clips, no allocation after
 * construction (three scratch vectors, one euler, one quaternion).
 *
 * The CLAIM moments are exposed as one-shot flags (`consumeRelease`,
 * `consumeStrike`) rather than callbacks: the controller reads them once per
 * frame and authors the claim through the same `onShot` path a bullet takes,
 * so this file knows nothing about the host and cannot drift from it.
 *
 * Nothing here is authority. The host decides whether a grenade was armed;
 * `setHeld` is the level the controller pushes back so a refused arm cancels
 * the raise instead of leaving a phantom grenade in the hand.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { KNIFE_RECOVERY_MS } from '../game/ordnance';
import { buildGrenadeViewmodel, buildKnifeViewmodel } from './viewmodel';
import type { ViewmodelRig } from './types';

export type HandAction = 'idle' | 'arm' | 'held' | 'throw' | 'knife' | 'pickup';

/** Pin pull to a settled hold. */
export const ARM_S = 0.22;
/** Whole throw; the grenade leaves the hand at `THROW_RELEASE_S`. */
export const THROW_S = 0.42;
export const THROW_RELEASE_S = 0.12;
/** Whole swing; the strike lands at `KNIFE_STRIKE_S`. Recovery is the host's 0.8 s. */
export const KNIFE_S = 0.45;
export const KNIFE_STRIKE_S = 0.14;
/** The reach-down while a pickup is taken. */
export const PICKUP_S = 0.5;
/** A refused arm is known within two host ticks; past this the raised hand is a phantom. */
export const ARM_CONFIRM_S = 0.35;

// Key poses, camera-local (x right, y up, z toward the viewer).
const K_HOME = new THREE.Vector3(0.26, -0.24, -0.34);
const K_HIGH = new THREE.Vector3(0.18, -0.02, -0.28);
const K_STRIKE = new THREE.Vector3(0.02, -0.12, -0.58);
const G_HOME = new THREE.Vector3(0.3, -0.34, -0.4);
const G_HOLD = new THREE.Vector3(0.2, -0.16, -0.4);
const G_BACK = new THREE.Vector3(0.3, -0.04, -0.22);
const G_FORE = new THREE.Vector3(0.06, -0.06, -0.62);

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export class OrdnanceHand {
  readonly knife: ViewmodelRig;
  readonly grenade: THREE.Group;
  /** The grenade id the raise was started with; the release claim names it. */
  grenadeId = 'frag';

  private action: HandAction = 'idle';
  private t = 0;
  private releasePending = false;
  private strikePending = false;
  private lastSwingAt = -Infinity;
  private visible = true;

  private readonly pos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly quat = new THREE.Quaternion();

  constructor(mat: MaterialLibrary, overlay: THREE.Scene) {
    this.knife = buildKnifeViewmodel(mat);
    this.grenade = buildGrenadeViewmodel(mat);
    this.knife.group.visible = false;
    this.grenade.visible = false;
    overlay.add(this.knife.group);
    overlay.add(this.grenade);
  }

  get current(): HandAction { return this.action; }
  /** A throw, swing or reach is in progress: the trigger waits. */
  get busy(): boolean { return this.action === 'throw' || this.action === 'knife' || this.action === 'pickup'; }
  /** A grenade is raised, pin out. */
  get holding(): boolean { return this.action === 'arm' || this.action === 'held'; }
  /** Seconds since the current action began. */
  get phase(): number { return this.t; }

  private start(a: HandAction): void {
    this.action = a;
    this.t = 0;
  }

  /** Pin out. False when the hand is mid-action or already holding one. */
  arm(grenadeId: string): boolean {
    if (this.action !== 'idle') return false;
    this.grenadeId = grenadeId;
    this.grenade.visible = this.visible;
    this.start('arm');
    return true;
  }

  /** Let it go. True when a throw began; the claim fires at `THROW_RELEASE_S`. */
  release(): boolean {
    if (!this.holding) return false;
    this.start('throw');
    return true;
  }

  /** Swing, unless recovering or busy. Recovery mirrors the host's number so a refused swing is rare, not silent. */
  swing(nowMs: number): boolean {
    if (this.busy || nowMs - this.lastSwingAt < KNIFE_RECOVERY_MS) return false;
    this.lastSwingAt = nowMs;
    if (this.holding) this.grenade.visible = false;
    this.knife.group.visible = this.visible;
    this.start('knife');
    return true;
  }

  /** The reach-down. Presentation only; the pickup claim is the controller's. */
  reach(): boolean {
    if (this.busy) return false;
    if (this.holding) this.grenade.visible = false;
    this.start('pickup');
    return true;
  }

  /** Drop whatever the hand is doing: respawn, or the host said nothing is armed. */
  cancel(): void {
    this.grenade.visible = false;
    this.knife.group.visible = false;
    this.start('idle');
  }

  /**
   * The host's level for what is armed. A raise the host refused (`armed`
   * still null past `ARM_CONFIRM_S`) is cancelled; a grenade the host says
   * went off in the hand (armed null while `held`) likewise.
   */
  setHeld(armed: string | null): void {
    if (armed === null && this.holding && this.t > ARM_CONFIRM_S) this.cancel();
  }

  consumeRelease(): boolean {
    const r = this.releasePending;
    this.releasePending = false;
    return r;
  }

  consumeStrike(): boolean {
    const r = this.strikePending;
    this.strikePending = false;
    return r;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (!v) this.cancel();
  }

  /**
   * Advance and place. Returns how far (0..1) the controller should lower and
   * tilt the gun this frame. `bobX`/`bobY` are the controller's walk-bob
   * terms so the off hand bobs with the gun rather than floating beside it.
   */
  update(dt: number, camPos: THREE.Vector3, camQuat: THREE.Quaternion, time: number, bobX: number, bobY: number): number {
    const before = this.t;
    this.t += dt;
    let lower = 0;
    switch (this.action) {
      case 'idle':
        return 0;
      case 'arm': {
        const f = smooth(this.t / ARM_S);
        this.pos.lerpVectors(G_HOME, G_HOLD, f);
        this.euler.set(0.2 * f, 0.4 * f, 0);
        lower = 0.35 * f;
        // Not `start('held')`: the clock keeps running from the pin pull, so
        // `setHeld(null)` measures ARM_CONFIRM_S from the arm claim as it says,
        // not from the end of the raise. (Reset, a refused arm stayed up 0.57 s.)
        if (this.t >= ARM_S) this.action = 'held';
        break;
      }
      case 'held':
        this.pos.copy(G_HOLD);
        this.pos.y += Math.sin(time * 2.3) * 0.004;
        this.euler.set(0.2, 0.4, Math.sin(time * 1.7) * 0.05);
        lower = 0.35;
        break;
      case 'throw': {
        if (before < THROW_RELEASE_S && this.t >= THROW_RELEASE_S) {
          this.releasePending = true;
          this.grenade.visible = false;
        }
        if (this.t < THROW_RELEASE_S) {
          const f = smooth(this.t / THROW_RELEASE_S);
          this.pos.lerpVectors(G_HOLD, G_BACK, f);
          this.euler.set(-0.4 * f, 0.4, 0);
        } else {
          const f = smooth((this.t - THROW_RELEASE_S) / (THROW_S - THROW_RELEASE_S));
          this.pos.lerpVectors(G_BACK, G_FORE, Math.min(1, f * 2));
          this.euler.set(-0.4 + 0.9 * f, 0.4 - 0.4 * f, 0);
        }
        lower = 0.7 * (1 - smooth((this.t - THROW_RELEASE_S) / (THROW_S - THROW_RELEASE_S)));
        if (this.t >= THROW_S) this.start('idle');
        break;
      }
      case 'knife': {
        if (before < KNIFE_STRIKE_S && this.t >= KNIFE_STRIKE_S) this.strikePending = true;
        const f = this.t < KNIFE_STRIKE_S
          ? smooth(this.t / KNIFE_STRIKE_S)
          : 1 - smooth((this.t - KNIFE_STRIKE_S) / (KNIFE_S - KNIFE_STRIKE_S));
        // Raise then lunge: home -> high on the way in, high -> strike at the moment.
        if (this.t < KNIFE_STRIKE_S * 0.5) this.pos.lerpVectors(K_HOME, K_HIGH, f * 2);
        else this.pos.lerpVectors(K_HIGH, K_STRIKE, Math.min(1, (f - 0.5) * 2));
        if (this.t >= KNIFE_STRIKE_S) this.pos.lerpVectors(K_HOME, K_STRIKE, f);
        this.euler.set(-0.35 + 0.2 * f, 0.55 - 0.9 * f, -0.3 * f);
        lower = 1;
        if (this.t >= KNIFE_S) {
          this.knife.group.visible = false;
          this.start('idle');
        }
        break;
      }
      case 'pickup': {
        const f = Math.sin(Math.min(1, this.t / PICKUP_S) * Math.PI);
        lower = f;
        if (this.t >= PICKUP_S) this.start('idle');
        return lower;
      }
    }
    const rig = this.action === 'knife' ? this.knife.group : this.grenade;
    if (!rig.visible) return lower;
    this.tmp.copy(this.pos);
    this.tmp.x += bobX;
    this.tmp.y += bobY;
    this.tmp.applyQuaternion(camQuat).add(camPos);
    rig.position.copy(this.tmp);
    this.quat.setFromEuler(this.euler);
    rig.quaternion.copy(camQuat).multiply(this.quat);
    return lower;
  }
}
