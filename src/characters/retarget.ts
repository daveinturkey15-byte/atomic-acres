/**
 * Retarget: BVH / glTF clip -> standard skeleton (skeleton.ts) -> blend tree.
 *
 * Path: BVH text -> BVHLoader.parse -> resample 120->30 fps -> Z-up to Y-up
 * (when the source needs it) -> SkeletonUtils.retargetClip onto the standard
 * hierarchy -> rebase track names so the clip plays on a plain Bone root.
 *
 * CMU captures are 120 fps in a Z-up skeleton; three.js wants 30 fps Y-up.
 * Both conversions happen once, offline (scripts/fetch-anim.mjs does them at
 * fetch time); the runtime functions here redo them idempotently so a raw BVH
 * dropped into public/anim still plays.
 */
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BONE_NAMES, buildStandardSkeleton, type StandardBoneName } from './skeleton';

/**
 * CMU BVH joint name -> standard bone. CMU mirror joints carry side prefixes
 * (Left/Right) and segment names (UpLeg/Leg/Foot/ToeBase, Arm/ForeArm/Hand);
 * the axial chain is Hips/LowerBack/Spine/Spine1/Neck/Neck1/Head.
 */
export const CMU_BONE_MAP: Record<string, StandardBoneName> = {
  Hips: 'Hips',
  LowerBack: 'Spine',
  Spine: 'Chest',
  Spine1: 'Chest',
  Neck: 'Neck',
  Neck1: 'Neck',
  Head: 'Head',
  LeftShoulder: 'LeftShoulder',
  LeftArm: 'LeftArm',
  LeftForeArm: 'LeftForeArm',
  LeftHand: 'LeftHand',
  RightShoulder: 'RightShoulder',
  RightArm: 'RightArm',
  RightForeArm: 'RightForeArm',
  RightHand: 'RightHand',
  LeftUpLeg: 'LeftUpLeg',
  LeftLeg: 'LeftLeg',
  LeftFoot: 'LeftFoot',
  LeftToeBase: 'LeftToe',
  RightUpLeg: 'RightUpLeg',
  RightLeg: 'RightLeg',
  RightFoot: 'RightFoot',
  RightToeBase: 'RightToe',
};

export interface ParsedBVH {
  clip: THREE.AnimationClip;
  bones: THREE.Bone[];
  fps: number;
}

const loader = new BVHLoader();

/** Parse BVH text. Frame rate comes from the file header (CMU: 120 fps). */
export function parseBVH(text: string): ParsedBVH {
  const result = loader.parse(text);
  const fps = result.clip.tracks.length
    ? result.clip.tracks[0].times.length / result.clip.duration
    : 120;
  return { clip: result.clip, bones: result.skeleton.bones, fps };
}

/**
 * Resample every track to `toFps` by sampling the clip on its source rig.
 * CMU 120 fps -> 30 fps quarters every track with no visible loss (human
 * motion has nothing above 15 Hz) and quarters the bytes we commit.
 */
export function resampleClip(
  sourceRoot: THREE.Object3D,
  clip: THREE.AnimationClip,
  fromFps: number,
  toFps = 30,
): THREE.AnimationClip {
  if (fromFps <= toFps + 1) return clip;
  const mixer = new THREE.AnimationMixer(sourceRoot);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.update(0);
  const duration = clip.duration;
  const frames = Math.max(2, Math.round(duration * toFps) + 1);
  const out: THREE.KeyframeTrack[] = [];
  const pos: Record<string, { times: number[]; values: number[] }> = {};
  const quat: Record<string, { times: number[]; values: number[] }> = {};
  sourceRoot.updateMatrixWorld(true);
  for (let f = 0; f < frames; f++) {
    const t = Math.min((f / (frames - 1)) * duration, duration);
    mixer.setTime(t);
    sourceRoot.updateMatrixWorld(true);
    sourceRoot.traverse((o) => {
      if (o.name === '') return;
      const p = pos[o.name] ?? (pos[o.name] = { times: [], values: [] });
      const q = quat[o.name] ?? (quat[o.name] = { times: [], values: [] });
      p.times.push(t);
      p.values.push(o.position.x, o.position.y, o.position.z);
      q.times.push(t);
      q.values.push(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w);
    });
  }
  for (const [name, p] of Object.entries(pos)) {
    out.push(
      new THREE.VectorKeyframeTrack(
        `${name}.position`, new Float32Array(p.times), new Float32Array(p.values),
      ),
    );
    const q = quat[name];
    out.push(
      new THREE.QuaternionKeyframeTrack(
        `${name}.quaternion`, new Float32Array(q.times), new Float32Array(q.values),
      ),
    );
  }
  mixer.uncacheAction(clip);
  return new THREE.AnimationClip(clip.name, duration, out);
}

/**
 * CMU Z-up -> three.js Y-up, applied once to a parsed clip's root: rotate the
 * whole source rig -90 degrees about X, bake the rotation into the first
 * frame, and re-express. Detection is the caller's job (fetch-anim records
 * what it found); this is the transform, not the guess.
 */
export function zUpToYUpRoot(sourceRoot: THREE.Object3D): void {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  sourceRoot.quaternion.premultiply(q);
  sourceRoot.updateMatrixWorld(true);
}

/** Trim dead frames off both ends: first/last frames whose Hips moved < eps. */
export function trimClip(
  clip: THREE.AnimationClip,
  hipsTrackName: string,
  eps = 0.004,
): THREE.AnimationClip {
  const hips = clip.tracks.find((t) => t.name === hipsTrackName) as
    | THREE.VectorKeyframeTrack
    | undefined;
  if (!hips || hips.times.length < 8) return clip;
  const v = hips.values;
  const dist = (i: number, j: number): number => {
    const dx = v[i * 3] - v[j * 3];
    const dy = v[i * 3 + 1] - v[j * 3 + 1];
    const dz = v[i * 3 + 2] - v[j * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  let start = 0;
  let end = hips.times.length - 1;
  while (start < end - 2 && dist(start, start + 1) < eps) start++;
  while (end > start + 2 && dist(end, end - 1) < eps) end--;
  if (start === 0 && end === hips.times.length - 1) return clip;
  const t0 = hips.times[start];
  const t1 = hips.times[end];
  const out: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const keep: number[] = [];
    for (let i = 0; i < track.times.length; i++) {
      if (track.times[i] >= t0 - 1e-6 && track.times[i] <= t1 + 1e-6) keep.push(i);
    }
    if (keep.length < 2) continue;
    const times = new Float32Array(keep.map((i) => track.times[i] - t0));
    const itemSize = track.values.length / track.times.length;
    const values = new Float32Array(keep.length * itemSize);
    for (let k = 0; k < keep.length; k++) {
      for (let c = 0; c < itemSize; c++) {
        values[k * itemSize + c] = track.values[keep[k] * itemSize + c];
      }
    }
    const fresh = track.clone();
    (fresh as THREE.KeyframeTrack).times = times;
    (fresh as THREE.KeyframeTrack).values = values;
    out.push(fresh);
  }
  return new THREE.AnimationClip(clip.name, t1 - t0, out);
}

/**
 * Retarget a source clip (played on sourceRoot) onto the standard skeleton.
 * `nameMap` translates standard-bone -> source-joint (CMU_BONE_MAP inverted
 * at the call site: retargetClip wants names[targetBone] = sourceBone, and
 * CMU_BONE_MAP is source -> standard, so invert it).
 *
 * retargetClip emits tracks as `.bones[Name].quaternion` (SkeletonHelper
 * addressing); rebase renames them to `Name.quaternion` so they play on a
 * plain Bone hierarchy root.
 */
export function retargetToStandard(
  sourceRoot: THREE.Object3D,
  sourceClip: THREE.AnimationClip,
  sourceToStandard: Record<string, StandardBoneName>,
  fps = 30,
): THREE.AnimationClip {
  const names: Record<string, string> = {};
  for (const [src, std] of Object.entries(sourceToStandard)) names[std] = src;
  const std = buildStandardSkeleton();
  // retargetClip is written for SkinnedMesh (Object3D + .skeleton). The rig
  // is throwaway, so the scratch root carries it; game roots stay clean.
  const target = std.root as THREE.Object3D & { skeleton: THREE.Skeleton };
  target.skeleton = std.skeleton;
  const src = sourceRoot as THREE.Object3D & { skeleton?: THREE.Skeleton };
  if (!src.skeleton) {
    const list: THREE.Bone[] = [];
    sourceRoot.traverse((o) => {
      if ((o as THREE.Bone).isBone) list.push(o as THREE.Bone);
    });
    src.skeleton = new THREE.Skeleton(list);
  }
  const converted = retargetClip(target, sourceRoot, sourceClip, {
    names,
    hip: 'Hips',
    fps,
  });
  const rebased = converted.tracks.map((track) => {
    const m = /\.bones\[(.+)\]\.(position|quaternion)/.exec(track.name);
    if (!m) return track;
    const fresh = track.clone();
    (fresh as THREE.KeyframeTrack).name = `${m[1]}.${m[2]}`;
    return fresh;
  });
  // Drop tracks for bones outside the standard set (fingers, toes extras).
  const kept = rebased.filter((t) => (BONE_NAMES as readonly string[]).includes(t.name.split('.')[0]));
  return new THREE.AnimationClip(sourceClip.name, converted.duration, kept);
}

/** One clip document as written by scripts/fetch-anim.mjs. */
export interface AnimJsonDoc {
  name: string;
  fps: number;
  joints: {
    name: string;
    parent: number;
    offset: [number, number, number];
    channels: string[];
  }[];
  /** Flat channel values per frame, column-aligned with joints. */
  motion: number[][];
}

/**
 * Offline-converted JSON -> playable standard-skeleton clip. Rebuilds the
 * source rig from the stored offsets, binds the stored channels, then
 * retargets (same path as raw BVH). `inPlace` zeroes root travel so the
 * blend tree - which moves the root itself at the matched speed - is the
 * only thing translating the character.
 */
export function animJsonToClip(
  doc: AnimJsonDoc,
  nameMap: Record<string, StandardBoneName> = CMU_BONE_MAP,
  inPlace = true,
): THREE.AnimationClip {
  const bones: THREE.Bone[] = [];
  const indexOf: number[] = [];
  for (const def of doc.joints) {
    if (def.channels.length === 0) {
      indexOf.push(-1);
      continue;
    }
    const b = new THREE.Bone();
    b.name = def.name;
    b.position.set(def.offset[0], def.offset[1], def.offset[2]);
    indexOf.push(bones.length);
    bones.push(b);
  }
  let sourceRoot: THREE.Object3D = bones[0];
  for (let j = 0; j < doc.joints.length; j++) {
    if (indexOf[j] < 0) continue;
    const parent = doc.joints[j].parent;
    if (parent < 0) sourceRoot = bones[indexOf[j]];
    else if (indexOf[parent] >= 0) bones[indexOf[parent]].add(bones[indexOf[j]]);
  }
  sourceRoot.updateMatrixWorld(true);
  const colOffset: number[] = [];
  let acc = 0;
  for (const def of doc.joints) {
    colOffset.push(acc);
    acc += def.channels.length;
  }
  const orderOf = (channels: string[]): THREE.EulerOrder => {
    const seq = channels
      .filter((c) => /rotation/i.test(c))
      .map((c) => c[0].toUpperCase())
      .join('');
    return (seq || 'XYZ') as THREE.EulerOrder;
  };
  const frames = doc.motion.length;
  const dt = 1 / doc.fps;
  const tracks: THREE.KeyframeTrack[] = [];
  for (let j = 0; j < doc.joints.length; j++) {
    if (indexOf[j] < 0) continue;
    const def = doc.joints[j];
    const times = new Float32Array(frames);
    const isRoot = def.parent < 0;
    const order = orderOf(def.channels);
    const qv = new Float32Array(frames * 4);
    const hasPos = def.channels.some((c) => /position/i.test(c));
    const pv = hasPos ? new Float32Array(frames * 3) : null;
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    for (let f = 0; f < frames; f++) {
      times[f] = f * dt;
      const row = doc.motion[f];
      const rot: Record<string, number> = {};
      const posVals: number[] = [];
      for (let c = 0; c < def.channels.length; c++) {
        const ch = def.channels[c];
        const v = row[colOffset[j] + c];
        if (/rotation/i.test(ch)) rot[ch[0].toUpperCase()] = (v * Math.PI) / 180;
        else if (isRoot && inPlace && ch !== 'Yposition') posVals.push(0);
        else posVals.push(v);
      }
      e.set(rot.X ?? 0, rot.Y ?? 0, rot.Z ?? 0, order);
      q.setFromEuler(e);
      q.toArray(qv, f * 4);
      if (pv) {
        pv[f * 3] = posVals[0] ?? 0;
        pv[f * 3 + 1] = posVals[1] ?? 0;
        pv[f * 3 + 2] = posVals[2] ?? 0;
      }
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${def.name}.quaternion`, times, qv));
    if (pv) tracks.push(new THREE.VectorKeyframeTrack(`${def.name}.position`, times, pv));
  }
  const duration = (frames - 1) * dt;
  const sourceClip = new THREE.AnimationClip(doc.name, duration, tracks);
  return retargetToStandard(sourceRoot, sourceClip, nameMap, doc.fps);
}
