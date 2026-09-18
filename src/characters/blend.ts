/**
 * Blend tree + upper-body layer + foot-skate measurement.
 *
 * Locomotion (idle/walk/run/sprint/crouch-*) runs on one AnimationMixer with
 * crossfades; speed-matched timeScale (timeScale = speed / clipSpeed) is what
 * kills foot skate rather than any IK. Jump/land/death are full-body
 * one-shots that take the mixer over while they play.
 *
 * THREE mixer actions have no per-bone mask, so the upper-body layer
 * (aim/fire/reload/hit-react) does NOT run as mixer actions. Instead an
 * OverlaySampler plays those authored clips on a detached scratch rig and the
 * rig slerps only the upper-body bones toward the sampled pose. Exact mask,
 * no weight-normalisation surprise, and the pose data lives in exactly one
 * place (clips.ts).
 */
import * as THREE from 'three';
import { buildStandardSkeleton, UPPER_BODY, type StandardBoneName } from './skeleton';
import type { ClipLibrary, ClipName, LocomotionName } from './clips';

export interface RigInput {
  /** Forward speed in m/s. The rig picks the gait and match its timeScale. */
  speed: number;
  /** Yaw rate in rad/s (+ = turning left). Drives a procedural lean. */
  turnRate: number;
  crouch: boolean;
  /** -1..1, + looks up. Added to the chest and arms under aim. */
  aimPitch: number;
  /** 0 = arms swing with the gait, 1 = full rifle carry. */
  aimWeight: number;
}

/** Scratch rig that samples authored clips without touching any live bones. */
export class OverlaySampler {
  private readonly bones: Record<StandardBoneName, THREE.Bone>;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();

  constructor(private readonly library: ClipLibrary) {
    const std = buildStandardSkeleton();
    this.bones = std.bones;
    this.mixer = new THREE.AnimationMixer(std.root);
    for (const [name, spec] of Object.entries(library)) {
      const action = this.mixer.clipAction(spec.clip);
      action.enabled = false;
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      this.actions.set(name, action);
    }
  }

  /** Sample `clip` at `time` seconds; returns live quaternion references. */
  sample(clip: ClipName, time: number): Record<StandardBoneName, THREE.Quaternion> {
    this.mixer.stopAllAction();
    const action = this.actions.get(clip);
    if (action) {
      action.enabled = true;
      action.play();
      this.mixer.setTime(THREE.MathUtils.clamp(time, 0, action.getClip().duration - 1e-4));
    }
    const out = {} as Record<StandardBoneName, THREE.Quaternion>;
    for (const [name, bone] of Object.entries(this.bones)) {
      out[name as StandardBoneName] = bone.quaternion;
    }
    return out;
  }
}

interface Overlay {
  clip: ClipName;
  elapsed: number;
  /** Fade the overlay in/out over this long at each end (seconds). */
  fade: number;
}

const _q = new THREE.Quaternion();

function pickLocomotion(speed: number, crouch: boolean): LocomotionName {
  if (crouch) return speed < 0.25 ? 'crouch-idle' : 'crouch-walk';
  if (speed < 0.25) return 'idle';
  if (speed < 2.3) return 'walk';
  if (speed < 4.1) return 'run';
  return 'sprint';
}

export class CharacterRig {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private locomotion: LocomotionName = 'idle';
  private air: Overlay | null = null;
  private dead = false;
  private upper: Overlay | null = null;
  private recoil = 0;
  private sampler: OverlaySampler;
  /** Last sampled aim pose, refreshed while aimWeight > 0. */
  private aimPose: Record<StandardBoneName, THREE.Quaternion> | null = null;
  private external: { action: THREE.AnimationAction; speed: number } | null = null;
  // ---- skate measurement: per-foot stance tracking in world space
  private readonly footPrev = new Map<string, THREE.Vector3>();
  private stanceActive = new Map<string, boolean>();
  private strideSkate = new Map<string, number>();
  private worstStrideCm = 0;
  private stridesDone = 0;
  private stanceSince = new Map<string, number>();
  private footPrevY = new Map<string, number>();
  private footPrevT = new Map<string, number>();
  private lastSkateT = 0;
  private readonly rootPrev = new THREE.Vector3();
  private readonly footWorld = new THREE.Vector3();

  constructor(
    readonly root: THREE.Object3D,
    readonly bones: Record<StandardBoneName, THREE.Bone>,
    private readonly library: ClipLibrary,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [name, spec] of Object.entries(library)) {
      const action = this.mixer.clipAction(spec.clip);
      if (spec.loop) {
        action.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(name as ClipName, action);
    }
    this.actions.get('idle')?.play();
    this.sampler = new OverlaySampler(library);
  }

  get currentLocomotion(): LocomotionName {
    return this.locomotion;
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** Full-body one-shot that owns the mixer until it finishes. */
  playAir(clip: 'jump' | 'land'): void {
    this.mixer.stopAllAction();
    this.actions.get(this.locomotion)?.stop();
    const action = this.actions.get(clip);
    if (!action) return;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.play();
    this.air = { clip, elapsed: 0, fade: 0.08 };
    this.external = null;
  }

  playDeath(): void {
    this.mixer.stopAllAction();
    const action = this.actions.get('death');
    if (!action) return;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    this.dead = true;
    this.air = null;
    this.upper = null;
    this.external = null;
  }

  revive(): void {
    this.dead = false;
    this.air = null;
    this.external = null;
    this.mixer.stopAllAction();
    this.actions.get(this.locomotion)?.reset().play();
  }

  /** Upper-body one-shot (reload, hit-react): sampled, masked, timed. */
  playUpper(clip: 'reload' | 'hit-react'): void {
    const spec = this.library[clip];
    this.upper = { clip, elapsed: 0, fade: Math.min(0.12, spec.clip.duration / 4) };
  }

  /**
   * External clip (CMU retarget, glTF import) played looped at a matched
   * speed instead of the procedural locomotion. Proves the retarget path on
   * a live character; the overlay, lean, plant solve and skate measurement
   * all keep running on top.
   */
  playExternal(clip: THREE.AnimationClip, speed: number): void {
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    this.external = { action, speed };
  }

  stopExternal(): void {
    if (!this.external) return;
    this.mixer.stopAllAction();
    this.external.action.stop();
    this.mixer.uncacheAction(this.external.action.getClip());
    this.external = null;
    this.actions.get(this.locomotion)?.reset().play();
  }

  /** Aim is continuous: weight-driven, not a one-shot. */
  fire(): void {
    this.recoil = 1;
  }

  update(dt: number, input: RigInput): void {
    if (this.dead) {
      this.mixer.update(dt);
      return;
    }
    // ---- locomotion select + crossfade + speed match (skipped in external
    // clip mode: the retarget owns the mixer until stopExternal)
    if (this.external) {
      this.external.action.timeScale = input.speed / this.external.speed;
    } else if (this.air) {
      this.air.elapsed += dt;
      const dur = this.library[this.air.clip].clip.duration;
      if (this.air.elapsed >= dur) {
        this.air = null;
        this.actions.get(this.locomotion)?.reset().play();
      }
    } else {
      const want = pickLocomotion(input.speed, input.crouch);
      if (want !== this.locomotion) {
        const prev = this.actions.get(this.locomotion);
        const next = this.actions.get(want);
        this.locomotion = want;
        if (next) {
          next.enabled = true;
          next.reset();
          next.setLoop(THREE.LoopRepeat, Infinity);
          next.play();
          if (prev) next.crossFadeFrom(prev, 0.25, true);
        }
      }
      const spec = this.library[this.locomotion];
      const action = this.actions.get(this.locomotion);
      if (action && spec.speed > 0.01) {
        action.timeScale = input.speed / spec.speed;
      } else if (action) {
        action.timeScale = 1;
      }
    }
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt / 0.22);

    this.mixer.update(dt);

    // ---- plant solve: seat the body on the lowest planted foot. The authored
    // bob and the leg sweep are authored independently and disagree by
    // centimetres; this trims the residual every frame (max 3 cm) instead of
    // letting it read as skate. Corrections over 15 cm are refused - that is
    // an authoring bug and the measurement must catch it, not hide it.
    this.solvePlants();

    // ---- procedural turn lean (no clip: it must compose with any gait)
    const lean = THREE.MathUtils.clamp(input.turnRate * 0.12, -0.2, 0.2);
    this.bones.Hips.rotateZ(lean * 0.4);
    this.bones.Chest.rotateY(THREE.MathUtils.clamp(input.turnRate * 0.18, -0.3, 0.3));

    // ---- upper-body layer, sampled then masked onto upper bones only
    if (this.upper) {
      this.upper.elapsed += dt;
      const dur = this.library[this.upper.clip].clip.duration;
      if (this.upper.elapsed >= dur) this.upper = null;
    }
    const w = input.aimWeight;
    if (w > 0.001 || this.upper || this.recoil > 0.001) {
      this.aimPose = this.sampler.sample('aim', 0.5);
      for (const [name, bone] of Object.entries(this.bones)) {
        if (UPPER_BODY[name] !== true) continue;
        const target = this.aimPose[name as StandardBoneName];
        _q.copy(target);
        if (name === 'Chest' || name === 'LeftArm' || name === 'RightArm') {
          _q.multiply(new THREE.Quaternion().setFromEuler(
            new THREE.Euler(input.aimPitch * 0.7, 0, 0),
          ));
        }
        if (this.recoil > 0.001 && (name === 'Chest' || name === 'LeftArm' || name === 'RightArm')) {
          _q.multiply(new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0.22 * this.recoil, 0, 0),
          ));
        }
        bone.quaternion.slerp(_q, Math.max(w, this.recoil * 0.85));
      }
      if (this.upper) {
        const dur = this.library[this.upper.clip].clip.duration;
        const t = this.upper.elapsed;
        const env = Math.min(1, t / this.upper.fade, (dur - t) / this.upper.fade);
        const pose = this.sampler.sample(this.upper.clip, t);
        for (const [name, bone] of Object.entries(this.bones)) {
          if (UPPER_BODY[name] !== true) continue;
          bone.quaternion.slerp(pose[name as StandardBoneName], THREE.MathUtils.clamp(env, 0, 1));
        }
      }
    }
  }
  /** Standing-surface height under the wrapper root. The game sets this. */
  groundY = 0;

  private solvePlants(): void {
    let need = 0;
    let constrained = false;
    for (const side of ['Left', 'Right'] as const) {
      this.bones[`${side}Foot`].getWorldPosition(this.footWorld);
      const y = this.footWorld.y - this.root.position.y - this.groundY;
      if (y > 0.12) continue;
      const delta = 0.02 - y;
      if (!constrained || delta > need) {
        need = delta;
        constrained = true;
      }
    }
    if (constrained && Math.abs(need) < 0.15) {
      this.bones.Hips.position.y += THREE.MathUtils.clamp(need, -0.03, 0.03);
    }
  }

  /**
   * Track both feet in world space. While a foot is in stance (low and slow
   * vertically) any horizontal motion is skate. Returns the worst completed
   * stride in cm since the last reset.
   *
   * Hysteresis (enter under 7 cm, leave over 12) plus a minimum 80 ms stance
   * stop threshold flicker around the boundary from counting as strides.
   * The first stride after a reset is never recorded: it always contains the
   * crossfade/blend transient, not the gait.
   */
  measureSkate(): number {
    this.root.updateMatrixWorld(true);
    const now = performance.now() / 1000;
    const dt = Math.max(1e-3, now - this.lastSkateT);
    this.lastSkateT = now;
    const bdx = this.root.position.x - this.rootPrev.x;
    const bdz = this.root.position.z - this.rootPrev.z;
    this.rootPrev.copy(this.root.position);
    const body2 = (bdx * bdx + bdz * bdz) / (dt * dt);
    for (const side of ['Left', 'Right'] as const) {
      const foot = this.bones[`${side}Foot`];
      foot.getWorldPosition(this.footWorld);
      const prev = this.footPrev.get(side);
      const prevT = this.footPrevT.get(side) ?? now;
      const y = this.footWorld.y - this.root.position.y - this.groundY;
      const wasStance = this.stanceActive.get(side) ?? false;
      // A planted foot is nearly still in the WORLD (body speed minus sweep
      // cancel). Late swing arrives through the gate at 3+ m/s and toe-off
      // whips out the same way: speed gates both better than any height.
      const wSpeed = prev && now > prevT ? Math.hypot(
        this.footWorld.x - prev.x, this.footWorld.z - prev.z) / (now - prevT) : 0;
      const vy = prev && now > prevT ? (y - (this.footPrevY.get(side) ?? y)) / (now - prevT) : 0;
      const inStance = wasStance
        ? y < 0.12 && wSpeed < 1.2
        : y < 0.07 && Math.abs(vy) < 0.45 && wSpeed < 0.6;
      if (inStance && prev) {
        const dx = this.footWorld.x - prev.x;
        const dz = this.footWorld.z - prev.z;
        const step = Math.sqrt(dx * dx + dz * dz);
        // A stance foot moves opposite the body (the body walks over it).
        // Anything travelling WITH the body is late-swing arrival or liftoff,
        // not plant, and must not count. Idle (body ~still) counts everything.
        const relDot = body2 > 0.04 ? ((dx - bdx) * bdx + (dz - bdz) * bdz) / (dt * dt) : -1;
        const sliding = relDot < -0.1 * body2;
        // Ignore the touchdown frame itself (aerial -> stance impact).
        if (wasStance && sliding) {
          this.strideSkate.set(side, (this.strideSkate.get(side) ?? 0) + step);
        } else if (!wasStance) {
          this.stanceSince.set(side, now);
        }
      }
      if (!inStance && wasStance) {
        const dur = now - (this.stanceSince.get(side) ?? now);
        const total = (this.strideSkate.get(side) ?? 0) * 100;
        this.stridesDone++;
        if (dur >= 0.08 && this.stridesDone > 2) {
          if (total > this.worstStrideCm) this.worstStrideCm = total;
        }
        this.strideSkate.set(side, 0);
      }
      this.stanceActive.set(side, inStance);
      this.footPrev.set(side, this.footWorld.clone());
      this.footPrevY.set(side, y);
      this.footPrevT.set(side, now);
    }
    return this.worstStrideCm;

  }
  resetSkate(): void {
    this.worstStrideCm = 0;
    this.stridesDone = 0;
    this.footPrev.clear();
    this.footPrevY.clear();
    this.footPrevT.clear();
    this.stanceActive.clear();
    this.stanceSince.clear();
  }

  /** Completed strides, live foot heights and stance flags. */
  debugSkate(): Record<string, number> {
    this.root.updateMatrixWorld(true);
    const out: Record<string, number> = {
      strides: this.stridesDone,
      worstCm: Math.round(this.worstStrideCm * 100) / 100,
    };
    const hips = new THREE.Vector3();
    this.bones.Hips.getWorldPosition(hips);
    out.hipsY = Math.round((hips.y - this.root.position.y) * 1000) / 1000;
    for (const side of ['Left', 'Right'] as const) {
      const y = new THREE.Vector3();
      this.bones[`${side}Foot`].getWorldPosition(y);
      out[`footY${side}`] = Math.round((y.y - this.root.position.y) * 1000) / 1000;
      out[`footX${side}`] = Math.round(y.x * 1000) / 1000;
      out[`footZ${side}`] = Math.round(y.z * 1000) / 1000;
      out[`stance${side}`] = (this.stanceActive.get(side) ?? false) ? 1 : 0;
      out[`accum${side}`] = Math.round((this.strideSkate.get(side) ?? 0) * 10000) / 10000;
    }
    out.bodyZ = Math.round(this.root.position.z * 1000) / 1000;
    return out;
  }
}
