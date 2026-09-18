/**
 * Procedural game clip set - every animation the game needs, authored in code
 * against the standard skeleton (skeleton.ts). No downloads, no licences.
 *
 * Why procedural first: CMU (see scripts/fetch-anim.mjs) has walk, run, jump,
 * crouch-walk and turns, but no standing idle, no rifle aim/fire/reload, no
 * hit-react and no death. Rather than ship wrong clips for those, the whole
 * set is authored here with one gait generator, and CMU clips retarget
 * (retarget.ts) onto the same bones as drop-in replacements where they exist.
 *
 * Skate control is by construction: each locomotion clip declares the forward
 * speed its cycle matches (SPEED). The rig (blend.ts) moves the character at
 * the blended speed and sets action timeScale = speed / clipSpeed, so at the
 * authored speed the stance foot moves backward exactly as fast as the body
 * moves forward. Verification measures the residual in cm per stride.
 */
import * as THREE from 'three';
import { REST_OFFSETS, type StandardBoneName } from './skeleton';

/**
 * Mixer position tracks REPLACE the bone position, so every Hips Y key in
 * this file is an offset from rest (drop/bob/jump), added onto HIPS_Y here
 * in exactly one place per builder.
 */
const HIPS_Y = REST_OFFSETS.Hips[1];
export type ClipName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'crouch-idle'
  | 'crouch-walk'
  | 'jump'
  | 'land'
  | 'turn-left'
  | 'turn-right'
  | 'aim'
  | 'fire'
  | 'reload'
  | 'hit-react'
  | 'death';
/** Locomotion clips the rig crossfades between. Everything else is a layer or one-shot. */
export type LocomotionName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'crouch-idle'
  | 'crouch-walk';

/** One shared library per scene; every character references the same clips. */
export type ClipLibrary = Record<ClipName, ClipSpec>;

export interface ClipSpec {
  clip: THREE.AnimationClip;
  /** Forward speed (m/s) the cycle matches. 0 for in-place clips. */
  speed: number;
  /** Metres travelled per cycle at `speed`. */
  stride: number;
  loop: boolean;
}

type EulerKey = [number, number, number, number]; // t, rx, ry, rz (radians, XYZ)
type Pose = Partial<Record<StandardBoneName, EulerKey[]>> & { __hipsY?: unknown };

/**
 * Forward swing of a hanging limb is -rx (rotation about +x sends -y toward +z).
 *
 * Duty-factor shaping is what keeps feet planted: each leg spends `sigma`
 * of the cycle in stance, sweeping front-to-back at near-constant angular
 * velocity so the foot moves backward exactly as fast as the body moves
 * forward, then returns quickly through the air with the knee folded. A
 * plain sinusoid peaks mid-stance at ~1.6x body speed and measured 80 cm of
 * skate per stride; this shape exists to kill that number.
 */
function smooth(u: number): number {
  const c = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

/**
 * Hip angle (radians, + = leg forward) and knee fold for one leg at cycle
 * position a in [0, 2PI). Stance starts at a = 0 (heel strike, leg front).
 */
function legDuty(a: number, swing: number, knee: number, sigma: number): [number, number] {
  const u = a / (Math.PI * 2);
  if (u < sigma) {
    // Stance: linear front-to-back sweep, knee locked nearly straight. Flex
    // here shortens the leg mid-plant and reads as skate, so the fold lives
    // in swing only. The cubic term quickens the sweep at both ends to
    // compensate the cos(theta) arc loss of a rigid leg (~11% slow at a
    // 0.45 rad strike); without it the ends smear ~4 cm per stride.
    const s = u / sigma;
    const shaped = 1 - 2 * s - 0.035 * Math.sin(2 * Math.PI * s);
    return [swing * shaped, knee * 0.15];
  }
  // Swing: quick smooth return, knee folded hard so the foot clears instead
  // of dragging through the plant band. A fold under ~1.0 rad never lifts
  // the toe past 12 cm and the whole return counts as stance slide. The fold
  // holds late (v^1.4) and extends in the last instants so the foot drops
  // steeply onto the strike: a gradual descent skims in flat at 7 cm with
  // low vertical speed and no height gate can tell it from early stance.
  const v = (u - sigma) / (1 - sigma);
  return [-swing + 2 * swing * smooth(v), knee * Math.sin(Math.PI * Math.pow(v, 1.4))];
}
function gaitKeys(period: number, o: GaitParams): Pose {
  const N = 12;
  const upLegL: EulerKey[] = [];
  const upLegR: EulerKey[] = [];
  const legL: EulerKey[] = [];
  const legR: EulerKey[] = [];
  const footL: EulerKey[] = [];
  const footR: EulerKey[] = [];
  const armL: EulerKey[] = [];
  const armR: EulerKey[] = [];
  const foreL: EulerKey[] = [];
  const foreR: EulerKey[] = [];
  const hipsY: number[] = [];
  const hipsRoll: EulerKey[] = [];
  const chestYaw: EulerKey[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * period;
    const a = (i / N) * Math.PI * 2;
    // Right leg half a cycle behind the left.
    const [swL, knL0] = legDuty(a, o.swing, o.knee, o.sigma);
    const [swR, knR0] = legDuty((a + Math.PI) % (Math.PI * 2), o.swing, o.knee, o.sigma);
    const thL = swL + o.bendT;
    const thR = swR + o.bendT;
    const knL = knL0 + o.bendK;
    const knR = knR0 + o.bendK;
    upLegL.push([t, -thL, 0, 0.03]);
    upLegR.push([t, -thR, 0, -0.03]);
    legL.push([t, knL, 0, 0]);
    legR.push([t, knR, 0, 0]);
    // Foot stays level: counter the chain above it.
    footL.push([t, (thL - knL) * 0.85, 0, 0]);
    footR.push([t, (thR - knR) * 0.85, 0, 0]);
    // Arms mirror the same-side leg (counter-swing); guard carries them up.
    armL.push([t, (thL / o.swing) * o.armSwing - o.armGuard, 0, -0.08 - o.armGuard * 0.4]);
    armR.push([t, (thR / o.swing) * o.armSwing - o.armGuard, 0, 0.08 + o.armGuard * 0.4]);
    foreL.push([t, -0.25 - o.armGuard * 0.5, 0, 0]);
    foreR.push([t, -0.25 - o.armGuard * 0.5, 0, 0]);
    hipsY.push(o.drop + o.bob * (0.5 - 0.5 * Math.cos(2 * a)));
    hipsRoll.push([t, 0, 0, 0.035 * Math.sin(a)]);
    chestYaw.push([t, o.lean, 0.09 * Math.sin(a), 0]);
  }
  return {
    LeftUpLeg: upLegL,
    RightUpLeg: upLegR,
    LeftLeg: legL,
    RightLeg: legR,
    LeftFoot: footL,
    RightFoot: footR,
    LeftArm: armL,
    RightArm: armR,
    LeftForeArm: foreL,
    RightForeArm: foreR,
    Chest: chestYaw,
    Hips: hipsRoll,
    // Hips vertical bob rides on the position track; rotation keys above carry sway.
    __hipsY: hipsY as unknown as EulerKey[],
  };
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

function eulerTrack(bone: string, keys: EulerKey[], order: THREE.EulerOrder = 'XYZ'): THREE.QuaternionKeyframeTrack {
  const times = new Float32Array(keys.length);
  const values = new Float32Array(keys.length * 4);
  for (let i = 0; i < keys.length; i++) {
    times[i] = keys[i][0];
    _e.set(keys[i][1], keys[i][2], keys[i][3], order);
    _q.setFromEuler(_e);
    _q.toArray(values, i * 4);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

/** Repeat first key at the end so the loop wraps without a pop. */
function closeLoop(period: number, keys: EulerKey[]): EulerKey[] {
  const first = keys[0];
  return [...keys, [period, first[1], first[2], first[3]]];
}

interface GaitParams {
  period: number;
  swing: number;
  knee: number;
  armSwing: number;
  bob: number;
  drop: number;
  lean: number;
  armGuard: number;
  /** Stance fraction of the cycle. Walk ~0.6, run ~0.45, sprint ~0.35. */
  sigma: number;
  /** Crouched base bend: thigh forward / knee fold the cycle rides on. */
  bendT: number;
  bendK: number;
  speed: number;
  stride: number;
}

function gaitClip(name: string, p: GaitParams): ClipSpec {
  const pose = gaitKeys(p.period, p);
  const hipsY = pose.__hipsY as unknown as number[];
  delete (pose as Record<string, unknown>).__hipsY;
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone, keys] of Object.entries(pose)) {
    tracks.push(eulerTrack(bone, closeLoop(p.period, keys as EulerKey[])));
  }
  // Hips position: authored drop + double-frequency bob. In place (x/z fixed).
  const N = hipsY.length;
  const times = new Float32Array(N + 1);
  const values = new Float32Array((N + 1) * 3);
  for (let i = 0; i < N; i++) {
    times[i] = (i / N) * p.period;
    values[i * 3] = 0;
    values[i * 3 + 1] = HIPS_Y + hipsY[i];
    values[i * 3 + 2] = 0;
  }
  times[N] = p.period;
  values[N * 3 + 1] = HIPS_Y + hipsY[0];
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, values));
  const clip = new THREE.AnimationClip(name, p.period, tracks);
  return { clip, speed: p.speed, stride: p.stride, loop: true };
}

/** One-shot pose-to-pose clip. Each bone gets keys through the given eulers. */
function onceClip(
  name: string,
  duration: number,
  bones: Record<string, EulerKey[]>,
  hipsDY?: number[],
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone, keys] of Object.entries(bones)) {
    tracks.push(eulerTrack(bone, keys));
  }
  if (hipsDY) {
    const times = new Float32Array(hipsDY.length);
    const values = new Float32Array(hipsDY.length * 3);
    for (let i = 0; i < hipsDY.length; i++) {
      times[i] = (i / (hipsDY.length - 1)) * duration;
      values[i * 3 + 1] = HIPS_Y + hipsDY[i];
    }
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, values));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Static pose held for `duration` (breathing added for idle variants). */
function poseClip(
  name: string,
  duration: number,
  rest: Partial<Record<StandardBoneName, [number, number, number]>>,
  breathe: number,
  hipsDrop: number,
): ClipSpec {
  const N = 4;
  const bones: Record<string, EulerKey[]> = {};
  for (const [bone, r] of Object.entries(rest)) {
    const keys: EulerKey[] = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * duration;
      // Breathing rides on the chest; everything else is dead still.
      const br = bone === 'Chest' ? breathe * Math.sin((i / N) * Math.PI * 2) : 0;
      keys.push([t, r[0] + br, r[1], r[2]]);
    }
    bones[bone] = keys;
  }
  const hipsDY = Array.from({ length: N + 1 }, (_, i) => hipsDrop + 0.008 * Math.sin((i / N) * Math.PI * 2));
  return { clip: onceClip(name, duration, bones, hipsDY), speed: 0, stride: 0, loop: true };
}

function buildAimPose(pitch: number): Record<string, EulerKey[]> {
  // Rifle carry: both arms forward, elbows tucked, chest square behind them.
  const at = (rx: number, ry = 0, rz = 0): EulerKey[] => [[0, rx, ry, rz]];
  return {
    Chest: [[0, 0.08 + pitch, 0, 0]],
    Neck: [[0, -0.05 - pitch * 0.5, 0, 0]],
    LeftArm: at(-1.15 + pitch, 0.25, -0.15),
    LeftForeArm: at(-0.5, -0.35, 0),
    RightArm: at(-1.05 + pitch, -0.2, 0.15),
    RightForeArm: at(-0.65, 0.3, 0),
  };
}

/** The full game set. Built once, shared by every character. */
export function buildClipLibrary(): Record<ClipName, ClipSpec> {
  const lib = {} as Record<ClipName, ClipSpec>;

  lib['idle'] = poseClip('idle', 2.4, {
    LeftArm: [0.05, 0, -0.09],
    RightArm: [0.05, 0, 0.09],
    LeftForeArm: [-0.15, 0, 0],
    RightForeArm: [-0.15, 0, 0],
    Chest: [0.02, 0, 0],
    Neck: [0, 0, 0],
    Head: [0, 0.15, 0],
  }, 0.02, 0);

  lib['walk'] = gaitClip('walk', {
    period: 1.1, swing: 0.45, knee: 1.0, armSwing: 0.35,
    bob: -0.03, drop: 0, lean: 0.06, armGuard: 0, sigma: 0.6,
    bendT: 0, bendK: 0, speed: 1.1, stride: 1.21,
  });
  lib['run'] = gaitClip('run', {
    period: 0.7, swing: 0.75, knee: 1.5, armSwing: 0.6,
    bob: -0.045, drop: -0.02, lean: 0.14, armGuard: 0.25, sigma: 0.5,
    bendT: 0, bendK: 0, speed: 3.4, stride: 2.38,
  });
  lib['sprint'] = gaitClip('sprint', {
    period: 0.55, swing: 0.95, knee: 1.9, armSwing: 0.85,
    bob: -0.055, drop: -0.04, lean: 0.22, armGuard: 0.35, sigma: 0.45,
    bendT: 0, bendK: 0, speed: 5.5, stride: 3.03,
  });
  lib['crouch-idle'] = poseClip('crouch-idle', 2.0, {
    LeftUpLeg: [-1.15, 0, -0.06],
    RightUpLeg: [-1.15, 0, 0.06],
    LeftLeg: [1.9, 0, 0],
    RightLeg: [1.9, 0, 0],
    LeftFoot: [-0.75, 0, 0],
    RightFoot: [-0.75, 0, 0],
    Chest: [0.35, 0, 0],
    Neck: [-0.25, 0, 0],
    LeftArm: [-0.7, 0, -0.2],
    RightArm: [-0.7, 0, 0.2],
    LeftForeArm: [-0.5, 0, 0],
    RightForeArm: [-0.5, 0, 0],
  }, 0.025, -0.42);
  lib['crouch-walk'] = gaitClip('crouch-walk', {
    period: 0.9, swing: 0.55, knee: 0.9, armSwing: 0.2,
    bob: -0.02, drop: -0.42, lean: 0.35, armGuard: 0.55, sigma: 0.65,
    bendT: 1.0, bendK: 1.75, speed: 0.85, stride: 0.77,
  });

  // Jump: anticipate, launch, tuck, pre-land. Hips rise 0.45 m mid-flight.
  lib['jump'] = {
    clip: onceClip('jump', 0.85, {
      LeftUpLeg: [[0, 0, 0, 0], [0.17, -0.5, 0, 0], [0.34, 0.25, 0, 0], [0.55, -0.55, 0, 0], [0.85, -0.25, 0, 0]],
      RightUpLeg: [[0, 0, 0, 0], [0.17, -0.5, 0, 0], [0.34, 0.25, 0, 0], [0.55, -0.55, 0, 0], [0.85, -0.25, 0, 0]],
      LeftLeg: [[0, 0, 0, 0], [0.17, 0.9, 0, 0], [0.34, 0.15, 0, 0], [0.55, 1.1, 0, 0], [0.85, 0.35, 0, 0]],
      RightLeg: [[0, 0, 0, 0], [0.17, 0.9, 0, 0], [0.34, 0.15, 0, 0], [0.55, 1.1, 0, 0], [0.85, 0.35, 0, 0]],
      LeftArm: [[0, 0, 0, 0], [0.34, -0.9, 0, -0.5], [0.85, 0.3, 0, -0.2]],
      RightArm: [[0, 0, 0, 0], [0.34, -0.9, 0, 0.5], [0.85, 0.3, 0, 0.2]],
      Chest: [[0, 0, 0, 0], [0.34, 0.1, 0, 0], [0.85, 0.15, 0, 0]],
    }, [0, -0.22, 0.1, 0.45, 0.12]),
    speed: 0, stride: 0, loop: false,
  };

  // Land: absorb from a shallow crouch back to stand.
  lib['land'] = {
    clip: onceClip('land', 0.35, {
      LeftUpLeg: [[0, -0.5, 0, 0], [0.18, -0.85, 0, 0], [0.35, 0, 0, 0]],
      RightUpLeg: [[0, -0.5, 0, 0], [0.18, -0.85, 0, 0], [0.35, 0, 0, 0]],
      LeftLeg: [[0, 0.7, 0, 0], [0.18, 1.3, 0, 0], [0.35, 0, 0, 0]],
      RightLeg: [[0, 0.7, 0, 0], [0.18, 1.3, 0, 0], [0.35, 0, 0, 0]],
      Chest: [[0, 0.25, 0, 0], [0.18, 0.4, 0, 0], [0.35, 0.02, 0, 0]],
      LeftArm: [[0, -0.4, 0, -0.4], [0.35, 0.05, 0, -0.09]],
      RightArm: [[0, -0.4, 0, 0.4], [0.35, 0.05, 0, 0.09]],
    }, [-0.1, -0.3, 0]),
    speed: 0, stride: 0, loop: false,
  };

  // Turns: in-place lean + weight shift, played while the rig yaws the body.
  const turn = (dir: 1 | -1, name: string): ClipSpec => ({
    clip: onceClip(name, 0.5, {
      Hips: [[0, 0, 0, 0], [0.25, 0, 0, dir * 0.1], [0.5, 0, 0, 0]],
      Chest: [[0, 0, 0, 0], [0.25, 0.05, dir * 0.35, dir * 0.12], [0.5, 0, 0, 0]],
      Head: [[0, 0, 0, 0], [0.25, 0, dir * 0.45, 0], [0.5, 0, 0, 0]],
      LeftUpLeg: [[0, 0, 0, 0], [0.25, -0.25, 0, dir * -0.06], [0.5, 0, 0, 0]],
      RightUpLeg: [[0, 0, 0, 0], [0.25, -0.25, 0, dir * -0.06], [0.5, 0, 0, 0]],
    }, [0, -0.03, 0]),
    speed: 0, stride: 0, loop: true,
  });
  lib['turn-left'] = turn(1, 'turn-left');
  lib['turn-right'] = turn(-1, 'turn-right');

  // Aim: looped rifle carry. CMU has no rifle aim; this is authored, not wrong.
  lib['aim'] = {
    clip: onceClip('aim', 1.0, {
      ...buildAimPose(0),
      Hips: [[0, 0, 0, 0], [1.0, 0, 0, 0]],
    }, [0, 0]),
    speed: 0, stride: 0, loop: true,
  };

  // Fire: recoil impulse away from the aim pose, decays back.
  lib['fire'] = {
    clip: onceClip('fire', 0.22, {
      Chest: [[0, 0.08, 0, 0], [0.06, -0.06, 0, 0], [0.22, 0.08, 0, 0]],
      LeftArm: [[0, -1.15, 0.25, -0.15], [0.06, -0.95, 0.25, -0.15], [0.22, -1.15, 0.25, -0.15]],
      RightArm: [[0, -1.05, -0.2, 0.15], [0.06, -0.85, -0.2, 0.15], [0.22, -1.05, -0.2, 0.15]],
      Neck: [[0, -0.05, 0, 0], [0.06, -0.14, 0, 0], [0.22, -0.05, 0, 0]],
    }),
    speed: 0, stride: 0, loop: false,
  };

  // Reload: right hand to the chest, head dips to check, back to carry.
  lib['reload'] = {
    clip: onceClip('reload', 1.6, {
      RightArm: [[0, -1.05, -0.2, 0.15], [0.4, -0.5, -0.35, 0.3], [0.9, -0.5, -0.35, 0.3], [1.3, -0.7, -0.3, 0.25], [1.6, -1.05, -0.2, 0.15]],
      RightForeArm: [[0, -0.65, 0.3, 0], [0.4, -1.5, 0.4, 0], [0.9, -1.5, 0.4, 0], [1.6, -0.65, 0.3, 0]],
      LeftArm: [[0, -1.15, 0.25, -0.15], [1.6, -1.15, 0.25, -0.15]],
      LeftForeArm: [[0, -0.5, -0.35, 0], [1.6, -0.5, -0.35, 0]],
      Neck: [[0, -0.05, 0, 0], [0.5, 0.3, 0, 0], [1.1, 0.3, 0, 0], [1.6, -0.05, 0, 0]],
      Chest: [[0, 0.08, 0, 0], [0.5, 0.22, 0, 0], [1.1, 0.22, 0, 0], [1.6, 0.08, 0, 0]],
    }),
    speed: 0, stride: 0, loop: false,
  };

  // Hit-react: chest snaps back, head jerks, settles.
  lib['hit-react'] = {
    clip: onceClip('hit-react', 0.4, {
      Chest: [[0, 0.02, 0, 0], [0.1, -0.3, 0.15, 0], [0.4, 0.02, 0, 0]],
      Neck: [[0, 0, 0, 0], [0.1, -0.35, 0, 0], [0.4, 0, 0, 0]],
      Head: [[0, 0, 0, 0], [0.1, -0.2, 0.2, 0], [0.4, 0, 0, 0]],
      LeftArm: [[0, 0.05, 0, -0.09], [0.1, -0.5, 0, -0.5], [0.4, 0.05, 0, -0.09]],
      RightArm: [[0, 0.05, 0, 0.09], [0.1, -0.5, 0, 0.5], [0.4, 0.05, 0, 0.09]],
    }),
    speed: 0, stride: 0, loop: false,
  };

  // Death: collapse to the ground, held prone. Ends near the mannequin 'fallen'
  // read (flat on the surface, limbs near the body, nothing spearing the sky).
  lib['death'] = {
    clip: onceClip('death', 1.2, {
      Hips: [[0, 0, 0, 0], [0.5, -0.5, 0, 0.4], [1.2, -1.5, 0, 0.12]],
      Chest: [[0, 0.02, 0, 0], [0.5, 0.35, 0, 0], [1.2, 0.15, 0, 0]],
      Neck: [[0, 0, 0, 0], [1.2, 0.45, 0, 0]],
      LeftUpLeg: [[0, 0, 0, 0], [0.5, -0.9, 0, -0.15], [1.2, -0.15, 0, -0.3]],
      RightUpLeg: [[0, 0, 0, 0], [0.5, -0.7, 0, 0.15], [1.2, -0.1, 0, 0.35]],
      LeftLeg: [[0, 0, 0, 0], [0.5, 1.1, 0, 0], [1.2, 0.25, 0, 0]],
      RightLeg: [[0, 0, 0, 0], [0.5, 1.0, 0, 0], [1.2, 0.2, 0, 0]],
      LeftArm: [[0, 0.05, 0, -0.09], [1.2, 0.3, 0, -1.1]],
      RightArm: [[0, 0.05, 0, 0.09], [1.2, 0.3, 0, 1.2]],
    }, [0, -0.35, -0.72]),
    speed: 0, stride: 0, loop: false,
  };

  return lib;
}
