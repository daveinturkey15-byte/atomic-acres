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
import { buildStandardSkeleton, REST_OFFSETS, UPPER_BODY, type StandardBoneName } from './skeleton';
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
  /**
   * Weapon-carry layer strength, 0..1. Leave undefined for the automatic
   * value: 1 while the figure is upright and holding its weapon, ramped to 0
   * through death and hit-react. Set it explicitly only to photograph the raw
   * clip data with the layer off.
   */
  carryWeight?: number;
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
/** Aim-pitch and recoil twists, rebuilt once per frame rather than per bone. */
const _qPitch = new THREE.Quaternion();
const _qRecoil = new THREE.Quaternion();
const _eScratch = new THREE.Euler();

// ---------------------------------------------------------------------------
// Weapon-carry layer
// ---------------------------------------------------------------------------
//
// WHY IT EXISTS. The rifle is baked to the RightHand bone inside the figure's
// single skinned mesh (mesh.ts), so wherever the animation puts the right hand,
// the rifle goes. The left hand is not attached to anything, and no clip the
// motion model produced ever brings it to the weapon: across the shipped set the
// left hand sits by the hip in walk and points off to the side in aim. The
// figure carries a rifle one-handed in every frame of the game.
//
// No re-roll fixes that, because it is not a bad clip - it is a missing
// constraint. A two-handed carry is a KINEMATIC relationship between the two
// hands, and the only honest way to hold it is to solve it every frame:
//
//   1. place the RIGHT hand (and therefore the rifle) at a carry anchor
//      expressed in CHEST space, lerped between a chest carry and a shouldered
//      aim by the existing aim weight, and orient it so the barrel points where
//      that state wants it;
//   2. read the rifle's forestock straight out of the RightHand's world matrix
//      using the offset mesh.ts baked, and solve the LEFT arm onto it.
//
// Everything below the Chest is untouched: the layer writes six bone
// quaternions and nothing else, so the gait, the plant solve and every
// foot-slide number are exactly what they were.
//
// Allocation: none per frame. Every vector, quaternion and matrix here is
// module scope, and the solver takes bones rather than building descriptors.

/**
 * The rifle's forestock in RightHand LOCAL space.
 *
 * mesh.ts lays the receiver along +z at y -0.046 with its barrel continuing to
 * z 0.442; 0.25 m out is the handguard, which is where a support hand goes. If
 * the rifle geometry in mesh.ts ever moves, this moves with it - it is the one
 * number this file borrows from that module and it is asserted by the in-game
 * surface audit, not assumed.
 */
const FORESTOCK_LOCAL = new THREE.Vector3(0, -0.055, 0.25);
/** The barrel axis in RightHand LOCAL space (mesh.ts: "a receiver laid along +z"). */
const BARREL_LOCAL = new THREE.Vector3(0, 0, 1);

/** RightHand bone origin in CHEST space: rifle held across the chest. */
const CARRY_HAND = new THREE.Vector3(0.10, 0.02, 0.15);
/** RightHand bone origin in CHEST space: rifle up on the shoulder, aiming. */
const AIM_HAND = new THREE.Vector3(0.08, 0.26, 0.20);
/** Barrel direction in CHEST space at rest carry - forward, across, a little up. */
const CARRY_BARREL = new THREE.Vector3(-0.30, 0.12, 0.95).normalize();
/** Where each elbow should fall, in CHEST space. Only the direction matters. */
const POLE_RIGHT = new THREE.Vector3(0.70, -1.0, -0.50).normalize();
const POLE_LEFT = new THREE.Vector3(-0.70, -1.0, -0.30).normalize();

/** Bone-local axis that points down the limb toward the child. */
const LIMB_AXIS = new THREE.Vector3(0, -1, 0);
const UPPER_LEN = Math.abs(REST_OFFSETS.LeftForeArm[1]);
const FORE_LEN = Math.abs(REST_OFFSETS.LeftHand[1]);

const _cS = new THREE.Vector3();
const _cT = new THREE.Vector3();
const _cD = new THREE.Vector3();
const _cU = new THREE.Vector3();
const _cAxis = new THREE.Vector3();
const _cCur = new THREE.Vector3();
const _cE = new THREE.Vector3();
const _cPole = new THREE.Vector3();
const _cUp = new THREE.Vector3();
const _cDir = new THREE.Vector3();
const _cDir2 = new THREE.Vector3();
const _cZero = new THREE.Vector3();
const _cWorldUp = new THREE.Vector3(0, 1, 0);
const _cChestQ = new THREE.Quaternion();
const _cRootQ = new THREE.Quaternion();
const _cqA = new THREE.Quaternion();
const _cqB = new THREE.Quaternion();
const _cqC = new THREE.Quaternion();
const _cMat = new THREE.Matrix4();
const _cIdent = new THREE.Quaternion();

/**
 * Point a bone's limb axis at `dirWorld` while keeping the twist the animation
 * gave it, and blend the result in by `w`. Writes the bone's LOCAL quaternion,
 * which is the only thing the mixer will overwrite next frame - so the layer
 * can never accumulate.
 */
function aimBone(bone: THREE.Bone, dirWorld: THREE.Vector3, w: number): void {
  bone.getWorldQuaternion(_cqA);
  _cCur.copy(LIMB_AXIS).applyQuaternion(_cqA).normalize();
  _cqB.setFromUnitVectors(_cCur, dirWorld).multiply(_cqA);
  if (bone.parent) {
    (bone.parent as THREE.Bone).getWorldQuaternion(_cqC);
    _cqB.premultiply(_cqC.invert());
  }
  bone.quaternion.slerp(_cqB, w);
  bone.updateWorldMatrix(false, true);
}

/**
 * Analytic two-bone IK. `poleWorld` is a direction, not a point: the elbow is
 * swung toward it in the plane the shoulder-to-target line defines, which is
 * what stops the solve from picking a physically possible but grotesque elbow.
 * Over-reach is clamped rather than failed - a target beyond the arm's length
 * must straighten the arm, never produce NaN.
 */
function solveTwoBone(
  upper: THREE.Bone,
  fore: THREE.Bone,
  targetWorld: THREE.Vector3,
  poleWorld: THREE.Vector3,
  w: number,
): void {
  upper.updateWorldMatrix(true, false);
  _cS.setFromMatrixPosition(upper.matrixWorld);
  _cD.copy(targetWorld).sub(_cS);
  let len = _cD.length();
  if (len < 1e-5) return;
  _cD.divideScalar(len);
  len = Math.min(Math.max(len, Math.abs(UPPER_LEN - FORE_LEN) + 1e-3), (UPPER_LEN + FORE_LEN) * 0.999);
  const cos = (UPPER_LEN * UPPER_LEN + len * len - FORE_LEN * FORE_LEN) / (2 * UPPER_LEN * len);
  const a1 = Math.acos(Math.min(1, Math.max(-1, cos)));
  _cAxis.copy(_cD).cross(poleWorld);
  if (_cAxis.lengthSq() < 1e-8) _cAxis.set(1, 0, 0);
  else _cAxis.normalize();
  // Rotating d about (d x pole) by +a1 tips d TOWARD the pole, which is where
  // the elbow has to end up; the sign is the whole difference between an elbow
  // and a chicken wing.
  _cU.copy(_cD).applyAxisAngle(_cAxis, a1).normalize();
  aimBone(upper, _cU, w);

  fore.updateWorldMatrix(true, false);
  _cE.setFromMatrixPosition(fore.matrixWorld);
  _cU.subVectors(targetWorld, _cE);
  if (_cU.lengthSq() < 1e-8) return;
  aimBone(fore, _cU.normalize(), w);
}

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
  /** Smoothed weapon-carry weight. Ramped, never stepped: a carry that snaps
   *  to 0 on death teleports the arms out of the weapon. */
  private carry = 1;
  private sampler: OverlaySampler;
  /** Last sampled aim pose, refreshed while aimWeight > 0. */
  private aimPose: Record<StandardBoneName, THREE.Quaternion> | null = null;
  private external: { action: THREE.AnimationAction; speed: number; loop: boolean } | null = null;
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
   * External clip (CMU retarget, glTF import) played instead of the procedural
   * locomotion. Proves the retarget path on a live character; the overlay,
   * lean, plant solve, carry layer and skate measurement all keep running.
   *
   * `loop` follows the CLIP, not the caller's convenience. It used to be
   * hard-wired to LoopRepeat, so `death` - a 3.6 s collapse - restarted from
   * standing every 3.6 s instead of settling on the ground, and a one-shot
   * could never be photographed in its final pose.
   */
  playExternal(clip: THREE.AnimationClip, speed: number, loop = true): void {
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    if (loop) {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.timeScale = 1;
    action.play();
    this.external = { action, speed, loop };
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

  /** Live weapon-carry weight, for the QA surface and the surface audit. */
  get carryWeight(): number {
    return this.carry;
  }

  update(dt: number, input: RigInput): void {
    if (this.dead) {
      this.carry = Math.max(0, this.carry - dt * 4);
      this.mixer.update(dt);
      return;
    }
    // ---- locomotion select + crossfade + speed match (skipped in external
    // clip mode: the retarget owns the mixer until stopExternal)
    if (this.external) {
      // THE FREEZE, AND WHY IT LOOKED LIKE EVERY CLIP WAS BROKEN.
      //
      // This line used to read `timeScale = input.speed / this.external.speed`
      // with no guard. `RigInput.speed` starts at 0 and the QA surface only sets
      // it through drive(), so `__NTANIM.external(i, name)` on its own gave
      // timeScale 0 - on EVERY clip, locomotion and one-shot alike. The action
      // still evaluated once at t=0, which moved the pose off rest, and then the
      // mixer advanced it by 0 s per frame forever. Twenty samples over three
      // seconds came back bit-identical, for `walk` and for `death`, and it read
      // as "playExternal is broken" rather than "the instrument divided by the
      // thing it forgot to set".
      //
      // A clip's own authored rate is the only sane default: timeScale 1 unless
      // the caller is deliberately speed-matching a LOCOMOTION clip to a moving
      // body. Zero is never a rate, it is an off switch, and nothing should be
      // able to reach it by omission.
      const ex = this.external;
      ex.action.timeScale = ex.loop && ex.speed > 0.01 && input.speed > 0.001
        ? input.speed / ex.speed
        : 1;
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
      // The pitch and recoil twists are the same for every bone in the frame,
      // so they are built ONCE here rather than per bone. They used to be four
      // `new THREE.Quaternion()` / `new THREE.Euler()` inside the loop, which on
      // eleven aiming figures is ~29,000 objects a second for two values that
      // never differ between bones. That is the only thing the budget run found
      // over its line (post-GC floor +0.54 MB/min against a 0.5 budget).
      const pitchOn = Math.abs(input.aimPitch) > 1e-4;
      const recoilOn = this.recoil > 0.001;
      if (pitchOn) _qPitch.setFromEuler(_eScratch.set(input.aimPitch * 0.7, 0, 0));
      if (recoilOn) _qRecoil.setFromEuler(_eScratch.set(0.22 * this.recoil, 0, 0));
      const blend = Math.max(w, this.recoil * 0.85);
      for (const [name, bone] of Object.entries(this.bones)) {
        if (UPPER_BODY[name] !== true) continue;
        const target = this.aimPose[name as StandardBoneName];
        _q.copy(target);
        const twisted = name === 'Chest' || name === 'LeftArm' || name === 'RightArm';
        if (twisted && pitchOn) _q.multiply(_qPitch);
        if (twisted && recoilOn) _q.multiply(_qRecoil);
        bone.quaternion.slerp(_q, blend);
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

    // ---- weapon carry. LAST, because it is a constraint rather than a pose:
    // whatever the gait and the aim overlay decided, the rifle ends up at the
    // chest and both hands end up on it.
    const wantCarry = this.upper?.clip === 'hit-react'
      ? 0
      : THREE.MathUtils.clamp(input.carryWeight ?? 1, 0, 1);
    this.carry += THREE.MathUtils.clamp(wantCarry - this.carry, -dt * 4, dt * 4);
    if (this.carry > 0.001) this.applyCarry(input, this.carry);
  }

  /**
   * Put the rifle at the chest (or on the shoulder, under aim) and both hands
   * on it. See the block comment above FORESTOCK_LOCAL for why this is a solve
   * and not a clip.
   *
   * Writes six bone quaternions - both arms, both forearms, both hands - and
   * touches nothing below the Chest, which the Chest is used as the anchor
   * FRAME for rather than rotated: the locomotion clips' torso motion is what
   * keeps a figure alive at 20 m, and no acceptance number here needs it.
   */
  private applyCarry(input: RigInput, w: number): void {
    const chest = this.bones.Chest;
    chest.updateWorldMatrix(true, false);
    const aim = THREE.MathUtils.clamp(input.aimWeight, 0, 1);

    // ---- right hand: the carry anchor, in CHEST space, lerped by aim weight.
    _cT.copy(CARRY_HAND).lerp(AIM_HAND, aim).applyMatrix4(chest.matrixWorld);
    // _cChestQ, not a shared scratch: solveTwoBone clobbers every _cq* it can
    // reach, and the chest frame has to outlive all three solves below.
    chest.getWorldQuaternion(_cChestQ);
    _cPole.copy(POLE_RIGHT).applyQuaternion(_cChestQ).normalize();
    solveTwoBone(this.bones.RightArm, this.bones.RightForeArm, _cT, _cPole, w);

    // ---- barrel direction.
    //
    // Carried, the rifle rides the TORSO: its direction is chest-relative, so a
    // figure leaning into a run sweeps the muzzle with it, which is what a
    // carried weapon does.
    //
    // Aimed, it must follow the AIM RAY, which is a property of the character
    // and not of the animation: yaw from the root, pitch from `aimPitch`. The
    // first cut of this took the aim line off the chest too and measured a
    // barrel 22.6 degrees below horizontal on a figure aiming at pitch 0 -
    // because the idle clip under it pitched the chest forward by exactly that
    // much. A rifle that points where the animation's spine happens to point is
    // not aiming at anything.
    const pitch = input.aimPitch * 0.7;
    this.root.getWorldQuaternion(_cRootQ);
    _cDir.set(0, Math.sin(pitch), Math.cos(pitch)).applyQuaternion(_cRootQ);
    _cDir2.copy(CARRY_BARREL).applyQuaternion(_cChestQ);
    _cDir.lerpVectors(_cDir2, _cDir, aim).normalize();
    _cUp.set(0, 1, 0).applyQuaternion(_cChestQ).lerp(_cWorldUp, aim).normalize();
    _cMat.lookAt(_cDir, _cZero, _cUp);        // +Z of the result IS the barrel
    _cqB.setFromRotationMatrix(_cMat);
    this.bones.RightForeArm.getWorldQuaternion(_cqC);
    _cqB.premultiply(_cqC.invert());
    this.bones.RightHand.quaternion.slerp(_cqB, w);
    this.bones.RightHand.updateWorldMatrix(false, true);

    // ---- left hand: onto the forestock, read out of the rifle's own bone.
    _cT.copy(FORESTOCK_LOCAL).applyMatrix4(this.bones.RightHand.matrixWorld);
    _cPole.copy(POLE_LEFT).applyQuaternion(_cChestQ).normalize();
    solveTwoBone(this.bones.LeftArm, this.bones.LeftForeArm, _cT, _cPole, w);
    // Glove straight on from the wrist - a support hand on a handguard, not a
    // hand that happens to be near one.
    this.bones.LeftHand.quaternion.slerp(_cIdent, w);
  }

  /**
   * World position of the rifle's forestock, and its barrel axis. The audit
   * harness reads these instead of re-deriving mesh.ts's offsets, so the
   * acceptance measures the same point the solver aimed at.
   */
  weaponProbe(outForestock: THREE.Vector3, outBarrel: THREE.Vector3): void {
    this.bones.RightHand.updateWorldMatrix(true, false);
    outForestock.copy(FORESTOCK_LOCAL).applyMatrix4(this.bones.RightHand.matrixWorld);
    this.bones.RightHand.getWorldQuaternion(_cqA);
    outBarrel.copy(BARREL_LOCAL).applyQuaternion(_cqA).normalize();
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
      // Reuse the stored vector. This runs on the frame loop for the whole of a
      // skate measurement, so a `.clone()` here was two Vector3s per frame for
      // the lifetime of the instrument - measuring the heap with the measurement.
      const slot = this.footPrev.get(side);
      if (slot) slot.copy(this.footWorld);
      else this.footPrev.set(side, this.footWorld.clone());
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
