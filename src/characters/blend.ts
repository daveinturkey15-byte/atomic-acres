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
import {
  THROW_BODY_HOLD_MAX_S, THROW_BODY_HOLD_S, THROW_BODY_THROWN_ENTRY_S,
  type ClipLibrary, type ClipName, type LocomotionName,
} from './clips';
import { authoredGripLocal, type AuthoredWeaponArchetype } from './authored-weapon';

export interface RigInput {
  /** Forward speed in m/s. The rig picks the gait and match its timeScale. */
  speed: number;
  /**
   * Explicit gameplay gait state. When supplied, this owns the walk/jog/sprint
   * semantic choice even when a baked clip advertises a lower authored speed.
   * Omit it for the legacy measured-speed fallback used by offline QA callers.
   */
  sprinting?: boolean;
  /** Yaw rate in rad/s (+ = turning left). Drives a procedural lean. */
  turnRate: number;
  crouch: boolean;
  /** Optional face-down stance; optional keeps existing callers compatible. */
  prone?: boolean;
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

/** Coverage of the legacy skate estimator, not a contact-quality verdict. */
export interface SkateCoverage {
  state: 'unmeasured' | 'incomplete' | 'measured';
  reason: 'no-samples' | 'no-admitted-stance' | 'no-eligible-completed-stance' | 'eligible-completed-stance';
  /** Calls to measureSkate, not unique rendered frames. */
  sampleCount: number;
  /** Completed stances that pass the estimator's existing duration/warm-up gates. */
  eligibleCompletedStances: number;
  /** Currently admitted feet; their unfinished drift is not in worstCm yet. */
  pendingStances: number;
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
  /** Throw anticipation: advance but pin at THROW_BODY_HOLD_S until released. */
  hold?: boolean;
  /** Seconds spent in the anticipation hold (for its bounded watchdog). */
  heldFor?: number;
}

const _q = new THREE.Quaternion();
// Aim pitch and recoil are uniform across the three twisted upper-body bones.
// Build the two rotations once per rig update instead of constructing a pair of
// quaternions and Eulers inside that bone loop.
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
/**
 * RightHand origins for the face-down carry. In the prone clip the chest's
 * local +Y points along the body toward the head and local -Z points up from
 * the lawn. Reusing the standing anchors therefore sends the rifle toward the
 * feet; these anchors keep the grip ahead of the shoulder and above the floor.
 */
const PRONE_CARRY_HAND = new THREE.Vector3(0.10, 0.20, -0.14);
const PRONE_AIM_HAND = new THREE.Vector3(0.08, 0.32, -0.16);
/** Barrel direction in CHEST space at rest carry - forward, across, a little up. */
const CARRY_BARREL = new THREE.Vector3(-0.30, 0.12, 0.95).normalize();
/** In prone, forward belongs to the actor root, not the floor-facing chest frame. */
const PRONE_BARREL = new THREE.Vector3(0, 0.05, 1).normalize();
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

export function pickLocomotion(
  speed: number,
  crouch: boolean,
  prone: boolean,
  sprinting: boolean | undefined,
  library: ClipLibrary,
): LocomotionName {
  if (prone) return speed < 0.25 ? 'prone-idle' : 'prone-crawl';
  if (crouch) return speed < 0.25 ? 'crouch-idle' : 'crouch-walk';
  if (speed < 0.25) return 'idle';
  // A baked source speed is a playback calibration, not a gameplay-state
  // boundary. Use the measured walk/run band for explicit non-sprint movement:
  // the player's 4.8 m/s normal pace should read as a jog/run, not walk at
  // 2.44x cadence. Explicit sprint still owns the sprint clip. The measured
  // fallback below remains for old QA/demo callers without the flag.
  const walk = Math.max(0.01, library.walk.speed);
  const run = Math.max(walk + 0.01, library.run.speed);
  const sprint = Math.max(run + 0.01, library.sprint.speed);
  if (sprinting === false) return speed < (walk + run) * 0.5 ? 'walk' : 'run';
  if (sprinting === true) return 'sprint';
  // Use the measured speeds of the loaded clips. The baked sprint is 2.84 m/s
  // while the procedural fallback is 5.5 m/s. This fallback is only for callers
  // that have not supplied the gameplay gait flag.
  if (speed < (walk + run) * 0.5) return 'walk';
  if (speed < (run + sprint) * 0.5) return 'run';
  return 'sprint';
}

/**
 * Match root travel to the clip's measured authored speed. A zero or malformed
 * rate is an in-place/invalid clip and must never freeze a moving action or
 * inject Infinity into AnimationMixer.
 */
export function locomotionTimeScale(speed: number, clipSpeed: number): number {
  if (!Number.isFinite(speed) || !Number.isFinite(clipSpeed) || clipSpeed <= 0.01) return 1;
  return Math.max(0, Math.abs(speed)) / clipSpeed;
}

/**
 * Carry the source loop's gait phase into a replacement action.
 *
 * A cross-fade only blends weights; `reset()` still starts the incoming clip at
 * frame zero. That made a stance change (especially run -> crouch/prone) show a
 * second, unrelated foot strike at the fade boundary. Looping clips all expose
 * the same phase contract, so preserving the normalized source time removes
 * that restart without touching root travel, authored clip speeds, or the
 * existing 0.25 s fade.
 */
function syncLoopPhase(prev: THREE.AnimationAction, next: THREE.AnimationAction): void {
  const prevDuration = prev.getClip().duration;
  const nextDuration = next.getClip().duration;
  if (!Number.isFinite(prevDuration) || prevDuration <= 1e-6
    || !Number.isFinite(nextDuration) || nextDuration <= 1e-6) return;
  const phase = ((prev.time / prevDuration) % 1 + 1) % 1;
  next.time = phase * nextDuration;
}

export class CharacterRig {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private locomotion: LocomotionName = 'idle';
  private air: Overlay | null = null;
  private dead = false;
  private upper: Overlay | null = null;
  private recoil = 0;
  /** Smoothed weapon-carry weight, PER SIDE. Ramped, never stepped: a carry
   *  that snaps to 0 on death teleports the arms out of the weapon. Two sides
   *  because the grenade throw releases the LEFT arm to the authored clip
   *  while the right keeps the rifle in stable carry — the rifle is baked to
   *  the RightHand bone (mesh.ts), so a right-hand throw would flail the
   *  weapon with the throwing hand. */
  private carryRight = 1;
  private carryLeft = 1;
  /** Support-hand target in RightHand LOCAL space. FORESTOCK_LOCAL until an
   *  authored archetype is set: the rifle numbers stay this file's, every
   *  other archetype's grip comes from authored-weapon.ts data. Written only
   *  at spawn/swap — never per frame. */
  private carryLocal = FORESTOCK_LOCAL.clone();
  /** Which archetype carryLocal aims at; null = legacy/procedural rifle. */
  private carried: AuthoredWeaponArchetype | null = null;
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
  private skateSampleCount = 0;
  private eligibleSkateStances = 0;
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

  /**
   * Third-person grenade-throw BODY presentation, on the same masked
   * upper-body layer as reload/hit-react — deliberately NOT playAir. A
   * full-body one-shot stops the mixer, which froze stance, locomotion and
   * the plant solve for 0.9 s on every throw; a figure may throw while
   * standing, crouched, prone or running and must keep doing all of those.
   *
   * The clip is a mirrored LEFT-hand authored adaptation of the H3 right-hand
   * reference: the left arm throws, the right arm stays at carry holding the
   * rifle. Phases, driven by the observed ordnance events (`throw-body.ts`),
   * never by the throw itself:
   * - 'anticipation' — `grenade-armed`: windup plays to THROW_BODY_HOLD_S and
   *   holds the coil until the authoritative release arrives.
   * - 'release' — `grenade-thrown`: the release is authoritative and the
   *   projectile already spawned, so the clip enters AT the release beat
   *   (THROW_BODY_THROWN_ENTRY_S == THROW_BODY_RELEASE_S). Any run-up before
   *   the beat is lag, not lead. With an anticipation hold live it releases
   *   the hold and jumps to the same entry. No anticipation held (late
   *   network notification)? Same entry.
   * - 'full' — raw clip playthrough for the demo/photography path only;
   *   never wired to a game event.
   *
   * No-ops while dead: playDeath has cleared the overlay and a corpse does
   * not start winding up on a stale queue entry.
   */
  playThrowBody(phase: 'anticipation' | 'release' | 'full'): void {
    if (this.dead) return;
    if (phase === 'release') {
      const held = this.upper?.clip === 'throw' && this.upper.hold === true ? this.upper : null;
      if (held) {
        held.hold = false;
        held.elapsed = THROW_BODY_THROWN_ENTRY_S;
        return;
      }
    }
    this.upper = phase === 'anticipation'
      ? { clip: 'throw', elapsed: 0, fade: 0.12, hold: true, heldFor: 0 }
      : { clip: 'throw', elapsed: phase === 'release' ? THROW_BODY_THROWN_ENTRY_S : 0, fade: 0.12 };
  }

  /** Drop a live throw overlay (death cleared it already; match teardown). */
  cancelThrowBody(): void {
    if (this.upper?.clip === 'throw') this.upper = null;
  }

  /**
   * Throw-body overlay state, for the QA surface and proofs: 'hold' pins the
   * authored windup awaiting the authoritative release; 'release' covers the
   * entry beat through settle.
   */
  get throwBodyPhase(): 'none' | 'hold' | 'release' {
    if (this.upper?.clip !== 'throw') return 'none';
    return this.upper.hold === true ? 'hold' : 'release';
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
    this.upper = null;
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
    return Math.min(this.carryRight, this.carryLeft);
  }

  /** The archetype the carry solve currently aims the support hand at, or
   *  null for the legacy rifle forestock (procedural figures). The swap
   *  short-circuit in CharacterSystem.rearm reads this to skip a rebuild
   *  whose archetype would not change a vertex. */
  get carriedArchetype(): AuthoredWeaponArchetype | null {
    return this.carried;
  }

  /**
   * Aim the support-hand solve at `archetype`'s authored grip, or back at the
   * legacy rifle forestock for null. Spawn/swap-time only — never per frame.
   * The rifle row is FORESTOCK_LOCAL verbatim, so rifle figures solve exactly
   * what they always did; the pistol target is its grip wrap, inside the
   * muzzle, instead of a floating hand beyond the barrel.
   */
  setCarriedArchetype(archetype: AuthoredWeaponArchetype | null): void {
    this.carried = archetype;
    if (archetype === null) this.carryLocal.copy(FORESTOCK_LOCAL);
    else this.carryLocal.copy(authoredGripLocal(archetype));
  }

  /** Per-side reads: the throw releases the LEFT side while the right keeps the rifle. */
  get carryRightWeight(): number {
    return this.carryRight;
  }

  get carryLeftWeight(): number {
    return this.carryLeft;
  }

  update(dt: number, input: RigInput): void {
    if (this.dead) {
      this.carryRight = Math.max(0, this.carryRight - dt * 4);
      this.carryLeft = Math.max(0, this.carryLeft - dt * 4);
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
      ex.action.timeScale = ex.loop && input.speed > 0.001
        ? locomotionTimeScale(input.speed, ex.speed)
        : 1;
    } else if (this.air) {
      this.air.elapsed += dt;
      const dur = this.library[this.air.clip].clip.duration;
      if (this.air.elapsed >= dur) {
        this.air = null;
        this.actions.get(this.locomotion)?.reset().play();
      }
    } else {
      const want = pickLocomotion(input.speed, input.crouch, input.prone === true, input.sprinting, this.library);
      if (want !== this.locomotion) {
        const prev = this.actions.get(this.locomotion);
        const next = this.actions.get(want);
        this.locomotion = want;
        if (next) {
          next.enabled = true;
          next.reset();
          next.setLoop(THREE.LoopRepeat, Infinity);
          syncLoopPhase(prev ?? next, next);
          next.play();
          if (prev) next.crossFadeFrom(prev, 0.25, true);
        }
      }
      const spec = this.library[this.locomotion];
      const action = this.actions.get(this.locomotion);
      if (action && spec.speed > 0.01) {
        action.timeScale = locomotionTimeScale(input.speed, spec.speed);
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
      if (this.upper.hold === true) {
        // Anticipation: play the windup in, then pin at the coil until the
        // authoritative release event advances us. The watchdog CANCELS a hold
        // whose event never comes (death cut the observer queue, match ended
        // mid-windup) — a body must never freeze mid-coil, and must never
        // play an autonomous fake throw masquerading as a release. A recovery
        // that plays anything must label itself as recovery, not release.
        this.upper.elapsed = Math.min(this.upper.elapsed + dt, THROW_BODY_HOLD_S);
        this.upper.heldFor = (this.upper.heldFor ?? 0) + dt;
        if (this.upper.heldFor >= THROW_BODY_HOLD_MAX_S) {
          this.upper = null;
        }
      } else if (this.upper) {
        this.upper.elapsed += dt;
      }
      if (!this.upper) {
        // Watchdog cancelled the hold: skip overlay expiry this frame; the
        // carry layer below ramps both sides back to stable carry.
      } else {
        const dur = this.library[this.upper.clip].clip.duration;
        if (this.upper.elapsed >= dur) this.upper = null;
      }
    }
    const w = input.aimWeight;
    if (w > 0.001 || this.upper || this.recoil > 0.001) {
      this.aimPose = this.sampler.sample('aim', 0.5);
      const recoilOn = this.recoil > 0.001;
      _qPitch.setFromEuler(_eScratch.set(input.aimPitch * 0.7, 0, 0));
      if (recoilOn) _qRecoil.setFromEuler(_eScratch.set(0.22 * this.recoil, 0, 0));
      const blend = Math.max(w, this.recoil * 0.85);
      for (const [name, bone] of Object.entries(this.bones)) {
        if (UPPER_BODY[name] !== true) continue;
        const target = this.aimPose[name as StandardBoneName];
        _q.copy(target);
        const twisted = name === 'Chest' || name === 'LeftArm' || name === 'RightArm';
        if (twisted) _q.multiply(_qPitch);
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
      : input.prone
        // The prone locomotion clips intentionally leave the arms available for
        // this constraint. Zero carry here made the right-hand baked orientation
        // rotate the rifle back across the torso toward the feet.
        ? 0.9
      // Reload is a hand action. Leave just enough carry to keep the rifle
      // stable while allowing the authored right-arm/forearm excursion to
      // read instead of being overwritten by the IK solve.
      : this.upper?.clip === 'reload'
        ? 0.28
        : THREE.MathUtils.clamp(input.carryWeight ?? 1, 0, 1);
    // Throw is NOT a single weight. The rifle is baked to the RightHand bone,
    // so any authored RIGHT-arm excursion would flail the weapon with the
    // throwing hand — the rejected workaround. The clip throws LEFT-handed:
    // release the LEFT side to 0 (the excursion reads; the left hand leaves
    // the forestock for the toss and returns) while the RIGHT side keeps
    // solving at full weight, pinning the rifle in stable carry at the chest.
    const throwing = this.upper?.clip === 'throw';
    const wantRight = wantCarry;
    const wantLeft = throwing ? 0 : wantCarry;
    this.carryRight += THREE.MathUtils.clamp(wantRight - this.carryRight, -dt * 4, dt * 4);
    this.carryLeft += THREE.MathUtils.clamp(wantLeft - this.carryLeft, -dt * 4, dt * 4);
    if (this.carryRight > 0.001 || this.carryLeft > 0.001) {
      this.applyCarry(input, this.carryRight, this.carryLeft);
    }
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
  private applyCarry(input: RigInput, wr: number, wl: number): void {
    const chest = this.bones.Chest;
    chest.updateWorldMatrix(true, false);
    const aim = THREE.MathUtils.clamp(input.aimWeight, 0, 1);
    const prone = input.prone === true;

    // ---- right hand: the carry anchor, in CHEST space, lerped by aim weight.
    _cT.copy(prone ? PRONE_CARRY_HAND : CARRY_HAND)
      .lerp(prone ? PRONE_AIM_HAND : AIM_HAND, aim)
      .applyMatrix4(chest.matrixWorld);
    // _cChestQ, not a shared scratch: solveTwoBone clobbers every _cq* it can
    // reach, and the chest frame has to outlive all three solves below.
    chest.getWorldQuaternion(_cChestQ);
    _cPole.copy(POLE_RIGHT).applyQuaternion(_cChestQ).normalize();
    solveTwoBone(this.bones.RightArm, this.bones.RightForeArm, _cT, _cPole, wr);

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
    this.root.getWorldQuaternion(_cRootQ);
    const pitch = input.aimPitch * 0.7;
    _cDir.set(0, Math.sin(pitch), Math.cos(pitch)).applyQuaternion(_cRootQ).normalize();
    if (prone) {
      // The prone chest frame is rotated onto the ground by the hips clip. A
      // chest-relative barrel therefore points down into the lawn; the weapon
      // must follow actor-forward (+Z) in the root frame instead.
      _cDir2.copy(PRONE_BARREL).applyQuaternion(_cRootQ).normalize();
      _cDir.lerpVectors(_cDir2, _cDir, aim).normalize();
      _cUp.set(0, 1, 0).applyQuaternion(_cRootQ).lerp(_cWorldUp, aim).normalize();
    } else {
      _cDir2.copy(CARRY_BARREL).applyQuaternion(_cChestQ);
      _cDir.lerpVectors(_cDir2, _cDir, aim).normalize();
      _cUp.set(0, 1, 0).applyQuaternion(_cChestQ).lerp(_cWorldUp, aim).normalize();
    }
    _cMat.lookAt(_cDir, _cZero, _cUp);        // +Z of the result IS the barrel
    _cqB.setFromRotationMatrix(_cMat);
    this.bones.RightForeArm.getWorldQuaternion(_cqC);
    _cqB.premultiply(_cqC.invert());
    this.bones.RightHand.quaternion.slerp(_cqB, wr);
    this.bones.RightHand.updateWorldMatrix(false, true);

    // ---- left hand: onto the carried archetype's grip, read out of the
    // weapon's own bone. The rifle row is FORESTOCK_LOCAL verbatim.
    _cT.copy(this.carryLocal).applyMatrix4(this.bones.RightHand.matrixWorld);
    _cPole.copy(POLE_LEFT).applyQuaternion(_cChestQ).normalize();
    solveTwoBone(this.bones.LeftArm, this.bones.LeftForeArm, _cT, _cPole, wl);
    // Glove straight on from the wrist - a support hand on a handguard, not a
    // hand that happens to be near one.
    this.bones.LeftHand.quaternion.slerp(_cIdent, wl);
  }

  /**
   * World position of the carried weapon's support point (the archetype grip;
   * the rifle forestock by default), and its barrel axis. The audit harness
   * reads these instead of re-deriving the offsets, so the acceptance
   * measures the same point the solver aimed at.
   */
  weaponProbe(outForestock: THREE.Vector3, outBarrel: THREE.Vector3): void {
    this.bones.RightHand.updateWorldMatrix(true, false);
    outForestock.copy(this.carryLocal).applyMatrix4(this.bones.RightHand.matrixWorld);
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
    this.skateSampleCount++;
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
          this.eligibleSkateStances++;
          if (total > this.worstStrideCm) this.worstStrideCm = total;
        }
        this.strideSkate.set(side, 0);
      }
      this.stanceActive.set(side, inStance);
      const slot = this.footPrev.get(side);
      if (slot) slot.copy(this.footWorld);
      else this.footPrev.set(side, this.footWorld.clone());
      this.footPrevY.set(side, y);
      this.footPrevT.set(side, now);
    }
    return this.worstStrideCm;

  }
  resetSkate(): void {
    this.skateSampleCount = 0;
    this.eligibleSkateStances = 0;
    this.worstStrideCm = 0;
    this.stridesDone = 0;
    this.footPrev.clear();
    this.footPrevY.clear();
    this.footPrevT.clear();
    this.stanceActive.clear();
    this.stanceSince.clear();
  }

  /** Read-only coverage. A measured completed prefix may still have pending feet.
   * No admitted stance (including fast motion excluded by the legacy predicate)
   * is unmeasured, never evidence that a returned zero means no foot sliding. */
  skateCoverage(): SkateCoverage {
    const pendingStances = Number(this.stanceActive.get('Left') === true)
      + Number(this.stanceActive.get('Right') === true);
    const measured = this.eligibleSkateStances > 0;
    const incomplete = this.stridesDone > 0 || pendingStances > 0;
    return {
      state: measured ? 'measured' : incomplete ? 'incomplete' : 'unmeasured',
      reason: this.skateSampleCount === 0 ? 'no-samples' : measured ? 'eligible-completed-stance'
        : incomplete ? 'no-eligible-completed-stance' : 'no-admitted-stance',
      sampleCount: this.skateSampleCount,
      eligibleCompletedStances: this.eligibleSkateStances,
      pendingStances,
    };
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
