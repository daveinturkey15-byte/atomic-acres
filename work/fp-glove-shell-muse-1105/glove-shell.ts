/**
 * First-person glove shells (canary lane `glove-shell=canary`).
 *
 * What this is: a fitted tactical-glove READ over the accepted grip volumes in
 * `src/weapons/first-person-hands.ts` — shaped dorsal + metacarpal knuckle bar,
 * four curled finger volumes, a thumb volume, a wrist transition that swallows
 * the cuff end, and restrained pad/welt relief. The old palm + digit-bundle
 * meshes stay exactly where they are (they are the accepted contacts); the
 * shells contain them with millimetres to spare so nothing z-fights and nothing
 * pokes through.
 *
 * What this is NOT: no socket, timing, handedness or muzzle change. Shells are
 * added as rigid children of the existing `TriggerHand` / `SupportHand` groups,
 * so `updateReload` / `resetReload` move them for free and the bind pose is
 * untouched. Default behaviour is unchanged: `attachGloveShells` adds nothing
 * unless `?glove-shell=canary` is present.
 *
 * Budgets (pair, both hands): <= 3500 triangles, <= 4 draws (2 meshes per
 * hand: shell + pad), 0 new material singletons — both meshes borrow the two
 * `mat.painted(PAL.opBoot, …)` singletons `createFirstPersonHands` already
 * owns, so no new program appears. No per-frame work: everything happens
 * inside `attachGloveShells`; the reload path still writes only the two
 * pre-existing group transforms.
 *
 * Merge discipline follows `src/characters/mesh.ts`: own tiny indexed merge,
 * never `BufferGeometryUtils.mergeGeometries` (null on attribute mismatch).
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../../src/core/materials';
import { PAL } from '../../src/core/palette';
import type { FirstPersonHandsRig } from '../../src/weapons/types';

/** URL gate: `?glove-shell=canary`. Any other value (or absent) = off. */
export const GLOVE_SHELL_PARAM = 'glove-shell';
export const GLOVE_SHELL_CANARY = 'canary';

/** Pair budgets. Asserted by `check-glove-shell.mjs` against real geometry. */
export const GLOVE_SHELL_TRI_BUDGET = 3500;
export const GLOVE_SHELL_DRAW_BUDGET = 4;
/** New material singletons the pair may create. Borrows only, so this is 0. */
export const GLOVE_SHELL_NEW_MATERIAL_BUDGET = 0;

/**
 * The two borrowed singletons, stated as data so the check script can assert
 * `attachGloveShells` requests exactly these tuples and nothing else.
 * Same tuples `createFirstPersonHands` passes (first-person-hands.ts:88-91).
 */
export const GLOVE_SHELL_MATERIALS = [
  { color: PAL.opBoot, rough: 0.78, metal: 0.01 },
  { color: PAL.opBoot, rough: 0.66, metal: 0.01 },
] as const;

/**
 * Sight line floor (weapon-local y). Rifle rail bottom is 0.065, sights live
 * 0.075–0.10; nothing swept may reach above 0.055. 10 mm below the rail.
 */
export const GLOVE_SIGHT_FLOOR_Y = 0.055;

/**
 * Muzzle keep-out: swept shell must stay this far behind each muzzle plane.
 * Own guard (generous): the accepted hands already sit well behind it.
 */
export const GLOVE_MUZZLE_KEEPOUT = 0.03;

/** Muzzle planes per weapon (viewmodel.ts rifle:130 pistol:177 smg:231 shotgun:278 sniper:336). */
export const GLOVE_MUZZLES: Record<string, { muzzleZ: number; supportY: number; supportZ: number }> = {
  rifle: { muzzleZ: -0.615, supportY: -0.055, supportZ: -0.36 },
  pistol: { muzzleZ: -0.19, supportY: -0.055, supportZ: -0.08 },
  smg: { muzzleZ: -0.37, supportY: -0.05, supportZ: -0.22 },
  shotgun: { muzzleZ: -0.56, supportY: -0.045, supportZ: -0.3 },
  sniper: { muzzleZ: -0.745, supportY: -0.045, supportZ: -0.32 },
};

/**
 * Accepted reload travel of `SupportHand`, read off `updateReload`
 * (first-person-hands.ts:149-190): release dips (−0.010, −0.010, −0.022),
 * reach targets x 0.014, y −0.038 (rifle supportY −0.055 → targetY −0.038),
 * z = reachZ ≤ 0.18, seat pause −0.004/+0.006. Bounds below widen each axis
 * by 4 mm so the sweep stays conservative for every weapon. TriggerHand never
 * moves, so its sweep is zero; ADS/hip move the whole rig rigidly and need no
 * per-hand term.
 */
export const SUPPORT_SWEEP = {
  min: new THREE.Vector3(-0.014, -0.046, -0.026),
  max: new THREE.Vector3(0.018, 0.012, 0.2),
} as const;

/** Trigger palm centre (first-person-hands.ts:118). */
const TRIGGER_PALM: readonly [number, number, number] = [0.01, -0.112, 0.012];
/** Trigger cuff top, the wrist-shell anchor (first-person-hands.ts:114-117). */
const TRIGGER_CUFF_TOP: readonly [number, number, number] = [0.015, -0.15, 0.025];
/** Support cuff top relative to its palm (first-person-hands.ts:128-132). */
const SUPPORT_CUFF_TOP: readonly [number, number, number] = [-0.017, -0.048, 0.014];

export function isGloveShellEnabled(search?: string): boolean {
  const query =
    search ??
    (typeof window === 'undefined' ? '' : window.location.search);
  if (!query) return false;
  return new URLSearchParams(query).get(GLOVE_SHELL_PARAM) === GLOVE_SHELL_CANARY;
}

type Side = 'trigger' | 'support';

interface PartSpec {
  name: string;
  /** 'shell' reads glove matte, 'pad' reads the rougher detail singleton. */
  layer: 'shell' | 'pad';
  geom: THREE.BufferGeometry;
  pos: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

function sphere(w: number, h: number): THREE.SphereGeometry {
  return new THREE.SphereGeometry(1, w, h);
}

function capsule(r: number, len: number): THREE.CapsuleGeometry {
  return new THREE.CapsuleGeometry(r, len, 2, 6);
}

/**
 * Authored part list for one hand, in its hand-group frame. Palm centre P is
 * the accepted palm position for that side; the wrist anchor A is the accepted
 * cuff-top point. Every part intersects at least one other part (single
 * connected component — enforced at build, re-checked by the harness).
 */
export function buildGloveShellParts(
  side: Side,
  supportY = -0.055,
  supportZ = -0.36,
): PartSpec[] {
  /** +1 trigger (outer +x), −1 support: mirrors the fan, never handedness. */
  const s: 1 | -1 = side === 'trigger' ? 1 : -1;
  const P: [number, number, number] =
    side === 'trigger' ? [...TRIGGER_PALM] : [-0.01, supportY, supportZ];
  const A: [number, number, number] =
    side === 'trigger'
      ? [...TRIGGER_CUFF_TOP]
      : [SUPPORT_CUFF_TOP[0], supportY + SUPPORT_CUFF_TOP[1], supportZ + SUPPORT_CUFF_TOP[2]];
  const tiltZ = s * -0.16; // matches the accepted palm rz (−0.16 / +0.15)
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [
    P[0] + s * dx,
    P[1] + dy,
    P[2] + dz,
  ];

  const parts: PartSpec[] = [
    // Dorsal shell: contains the old palm (r 0.032/0.043/0.050) and the old
    // digit bundle (outer +x) with ≥2 mm to spare — no coplanar faces.
    { name: 'dorsal', layer: 'shell', geom: sphere(12, 9), pos: at(0.002, -0.002, 0), scale: [0.037, 0.046, 0.053] },
    // Metacarpal knuckle bar across the top of the shell.
    { name: 'knuckles', layer: 'shell', geom: sphere(10, 7), pos: at(0.004, 0.036, -0.012), rot: [0, 0, tiltZ], scale: [0.03, 0.012, 0.026] },
  ];

  // Four curled finger volumes wrapping the grip front. 11 mm spacing at
  // 14.4 mm diameter: neighbours always intersect; tops stay inside the
  // dorsal, bottoms curl ahead of the old bundle so it reads covered.
  for (let i = 0; i < 4; i++) {
    parts.push({
      name: 'finger' + i,
      layer: 'shell',
      geom: capsule(0.0072, 0.02 - i * 0.0015),
      pos: at(-0.0165 + i * 0.011, -0.006, -0.02),
      rot: [1.05, 0, s * -0.1],
    });
  }

  // Thumb volume pressing the inner grip wall.
  parts.push({
    name: 'thumb', layer: 'shell', geom: capsule(0.008, 0.022),
    pos: at(-0.028, 0.01, 0.002), rot: [0.4, 0, s * 0.72],
  });

  // Wrist transition: tapered tube from the cuff-top anchor into the palm
  // heel. Radii swallow the cuff end (r 0.033/0.031) with ≥2 mm to spare.
  const heel: [number, number, number] = [P[0], P[1] - 0.01, P[2] + 0.002];
  const a = new THREE.Vector3(...A);
  const b = new THREE.Vector3(...heel);
  const seg = b.clone().sub(a);
  const wristLen = seg.length();
  const wrist = new THREE.CylinderGeometry(0.032, 0.0355, wristLen, 10, 1);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), seg.clone().normalize(),
  );
  const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
  parts.push({
    name: 'wrist', layer: 'shell', geom: wrist,
    pos: [mid.x, mid.y, mid.z], rot: [euler.x, euler.y, euler.z],
  });

  // ---- pad layer: relief that reads as armour/seams, all embedded at base.
  // Knuckle pad sits 2.5 mm proud of the knuckle bar — a plate, not a block.
  parts.push({
    name: 'knucklePad', layer: 'pad', geom: sphere(10, 6),
    pos: at(0.004, 0.0445, -0.012), rot: [0, 0, tiltZ], scale: [0.027, 0.006, 0.023],
  });
  // Two dorsal seam welts, half-sunk so the middles read as stitch lines.
  // Centres sit at ~0.95× the dorsal surface along their direction.
  for (const sx of [-1, 1]) {
    parts.push({
      name: 'seam' + (sx < 0 ? 'L' : 'R'), layer: 'pad', geom: capsule(0.0018, 0.02),
      pos: at(sx * 0.0218 + 0.002, 0.0333 - 0.002, -0.0051), rot: [0.25, 0, 0],
    });
  }
  // Cuff welt cord ringing the wrist shell at the cuff-top anchor.
  const ringR = side === 'trigger' ? 0.0355 : 0.0335;
  const welt = new THREE.TorusGeometry(ringR, 0.0028, 6, 16);
  parts.push({
    name: 'cuffWelt', layer: 'pad', geom: welt,
    pos: [a.x, a.y, a.z], rot: [euler.x, euler.y, euler.z],
  });

  return parts;
}

export interface TransformedPart {
  name: string;
  layer: 'shell' | 'pad';
  /** World-sphere in the hand-group frame (centre, radius). */
  center: THREE.Vector3;
  radius: number;
  box: THREE.Box3;
  triCount: number;
}

/** Place every part, measure it. Pure: no scene, no allocation past build. */
export function placeGloveShellParts(parts: PartSpec[]): TransformedPart[] {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  return parts.map((p) => {
    e.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
    q.setFromEuler(e);
    v.set(p.pos[0], p.pos[1], p.pos[2]);
    m.compose(
      v,
      q,
      new THREE.Vector3(p.scale?.[0] ?? 1, p.scale?.[1] ?? 1, p.scale?.[2] ?? 1),
    );
    const g = p.geom.clone().applyMatrix4(m);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const box = g.boundingBox!.clone();
    const sphereBound = g.boundingSphere!;
    const index = g.getIndex();
    const triCount = (index ? index.count : g.getAttribute('position').count) / 3;
    g.dispose();
    return {
      name: p.name, layer: p.layer,
      center: sphereBound.center.clone(), radius: sphereBound.radius,
      box, triCount,
    };
  });
}

/**
 * Single-component check: every part must touch another part (1 mm
 * tolerance). Throws on a disconnected floater — a floating capsule fails
 * the build, not the review.
 */
export function assertGloveShellConnected(placed: TransformedPart[]): void {
  const parent = placed.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const d = placed[i].center.distanceTo(placed[j].center);
      if (d <= placed[i].radius + placed[j].radius + 0.001) {
        parent[find(i)] = find(j);
      }
    }
  }
  const seen: number[] = [];
  for (let i = 0; i < placed.length; i++) {
    const r = find(i);
    if (seen.indexOf(r) === -1) seen.push(r);
  }
  if (seen.length !== 1) {
    const alone = placed.filter((_, i) => {
      const r = find(i);
      return placed.filter((_, k) => find(k) === r).length === 1;
    }).map((p) => p.name);
    throw new Error('[glove-shell] disconnected parts: ' + alone.join(', '));
  }
}

/**
 * Own indexed merge (same reason as `src/characters/mesh.ts`): every part
 * carries position/normal/uv, so concatenation with re-based indices cannot
 * fail; anything unexpected throws instead of returning null.
 */
export function mergeShellParts(parts: PartSpec[], layer: 'shell' | 'pad'): THREE.BufferGeometry {
  const subset = parts.filter((p) => p.layer === layer);
  if (subset.length === 0) throw new Error('[glove-shell] empty layer ' + layer);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let vCount = 0;
  let iCount = 0;
  const prepared = subset.map((p) => {
    e.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
    q.setFromEuler(e);
    m.compose(
      new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
      q,
      new THREE.Vector3(p.scale?.[0] ?? 1, p.scale?.[1] ?? 1, p.scale?.[2] ?? 1),
    );
    const g = p.geom.clone().applyMatrix4(m);
    const keys = Object.keys(g.attributes).sort().join(',');
    if (keys !== 'normal,position,uv' || !g.getIndex()) {
      throw new Error('[glove-shell] unmergeable part ' + p.name + ': ' + keys);
    }
    vCount += g.getAttribute('position').count;
    iCount += g.getIndex()!.count;
    return g;
  });
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of prepared) {
    pos.set(g.getAttribute('position').array as Float32Array, vo * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, vo * 3);
    uv.set(g.getAttribute('uv').array as Float32Array, vo * 2);
    const gi = g.getIndex()!.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += g.getAttribute('position').count;
    io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export interface GloveShellMeshes {
  group: THREE.Group;
  shell: THREE.Mesh;
  pad: THREE.Mesh;
  bounds: THREE.Box3;
  triCount: number;
}

function buildSide(
  side: Side,
  shellMat: THREE.Material,
  padMat: THREE.Material,
  supportY: number,
  supportZ: number,
): GloveShellMeshes {
  const parts = buildGloveShellParts(side, supportY, supportZ);
  assertGloveShellConnected(placeGloveShellParts(parts));
  const shellGeom = mergeShellParts(parts, 'shell');
  const padGeom = mergeShellParts(parts, 'pad');
  const shell = new THREE.Mesh(shellGeom, shellMat);
  const pad = new THREE.Mesh(padGeom, padMat);
  for (const mesh of [shell, pad]) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  shell.name = 'GloveShell' + (side === 'trigger' ? 'Trigger' : 'Support');
  pad.name = 'GlovePad' + (side === 'trigger' ? 'Trigger' : 'Support');
  const group = new THREE.Group();
  group.name = shell.name + 'Group';
  group.add(shell, pad);
  const bounds = new THREE.Box3().union(shellGeom.boundingBox!).union(padGeom.boundingBox!);
  const triCount =
    shellGeom.getIndex()!.count / 3 + padGeom.getIndex()!.count / 3;
  return { group, shell, pad, bounds, triCount };
}

export interface AttachOptions {
  supportY?: number;
  supportZ?: number;
  /** Test override for `window.location.search`. */
  search?: string;
}

/**
 * Attach both shells to the live rig. Gate-closed (default): returns null and
 * touches nothing — zero draws, zero transforms, zero materials. Gate-open:
 * two meshes per hand borrowing the existing glove singletons.
 */
export function attachGloveShells(
  hands: Pick<FirstPersonHandsRig, 'triggerHand' | 'supportHand'>,
  mat: MaterialLibrary,
  opts: AttachOptions & { supportZ: number },
): { trigger: GloveShellMeshes; support: GloveShellMeshes } | null {
  if (!isGloveShellEnabled(opts.search)) return null;
  const supportY = opts.supportY ?? -0.055;
  const shellMat = mat.painted(
    GLOVE_SHELL_MATERIALS[0].color, GLOVE_SHELL_MATERIALS[0].rough, GLOVE_SHELL_MATERIALS[0].metal,
  );
  const padMat = mat.painted(
    GLOVE_SHELL_MATERIALS[1].color, GLOVE_SHELL_MATERIALS[1].rough, GLOVE_SHELL_MATERIALS[1].metal,
  );
  const trigger = buildSide('trigger', shellMat, padMat, supportY, opts.supportZ);
  const support = buildSide('support', shellMat, padMat, supportY, opts.supportZ);
  hands.triggerHand.add(trigger.group);
  hands.supportHand.add(support.group);
  return { trigger, support };
}

/** Remove shells added by `attachGloveShells` and release their geometry. */
export function disposeGloveShells(
  hands: Pick<FirstPersonHandsRig, 'triggerHand' | 'supportHand'>,
): number {
  let removed = 0;
  for (const parent of [hands.triggerHand, hands.supportHand]) {
    for (const child of [...parent.children]) {
      if (child.name.endsWith('Group') && child.name.startsWith('GloveShell')) {
        child.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) (mesh.geometry as THREE.BufferGeometry).dispose();
        });
        parent.remove(child);
        removed++;
      }
    }
  }
  return removed;
}
