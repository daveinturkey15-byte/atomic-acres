/**
 * Hand-geometry canary — fitted forearm + gloved gripping-hand BufferGeometry
 * factories for the standalone Nuketown project.
 *
 * Scope: geometry ONLY. No materials, no textures, no scene/camera/renderer
 * access, no per-frame work. Root materializes the returned geometries with
 * the existing viewmodel material singletons (sleeve / darkGlove /
 * gloveDetail) and keeps the TriggerHand / SupportHand group names plus the
 * current reload trajectories untouched.
 *
 * What this replaces: the baseline straight tapered cylinder sleeves
 * (CylinderGeometry) and mitten palm spheres (scaled SphereGeometry) plus the
 * single capsule finger bundle in src/weapons/first-person-hands.ts.
 * Reference ONLY — nothing here imports that file.
 *
 * Design (all deterministic, seeded where a phase is needed):
 * - Forearm: tapered tube fitted exactly elbow -> wrist with a restrained
 *   elliptical section (rx != rz), a 2.5 mm anterior bow, and two subtle
 *   circumferential cloth-fold ridges (1.2 mm) near the cuff. Closed caps.
 * - Palm: superellipsoid fist volume (boxier than a sphere) with a dorsal
 *   knuckle ridge and two inter-finger grooves. Closed poles.
 * - Thumb: tapered tube along a quadratic grip curve (thenar -> opposition).
 * - Fingers: three tapered curl tubes (index / middle / ring+pinky) merged
 *   into ONE geometry with real gaps between digits. Tips stop below the
 *   iron-sight corridor; bases are embedded in the palm volume.
 *
 * Budgets: whole two-arm addition <= 4000 tris, <= 12 meshes. Materialized
 * layout is 4 meshes per side (forearm / palm / thumb / fingers) = 8 total.
 * Measured default: 1784 tris two-arm (see docs/hand-geometry-canary.md).
 *
 * Envelope rule: no silhouette growth beyond 5 mm from the baseline
 * joint/silhouette envelope per part (forearm vs sleeve+cuff cylinders,
 * hand parts vs palm sphere + finger capsule). Defaults grow ~0-2.5 mm.
 *
 * Visual status: OPEN — CPU proof only, never rendered. Root compares
 * idle / ADS / all-five-weapons / reload frames before any acceptance.
 */

import * as THREE from 'three';

export type Vec3 = readonly [number, number, number];

export const CANARY_MAX_TRIANGLES = 4000;
export const CANARY_MAX_MESHES = 12;
/** 5 mm silhouette slack vs the baseline envelope, per axis, per part. */
export const CANARY_ENVELOPE_SLACK = 0.005;
/** 1 mm joint-endpoint tolerance for fitted tube ends. */
export const CANARY_ENDPOINT_TOLERANCE = 0.001;

/** Group names mirror createFirstPersonHands so a swap keeps QA hooks. */
export const CANARY_GROUP_NAMES = {
  root: 'FirstPersonHands',
  trigger: 'TriggerHand',
  support: 'SupportHand',
  triggerForearm: 'TriggerForearm',
  supportForearm: 'SupportForearm',
} as const;

// ---------------------------------------------------------------- helpers

function sq(v: number): number {
  return v * v;
}

function smooth01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Deterministic [0,1) hash from two integers; no Math.random anywhere. */
function hash01(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function basisFromAxis(dir: THREE.Vector3): { n: THREE.Vector3; b: THREE.Vector3 } {
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3().crossVectors(dir, up).normalize();
  const b = new THREE.Vector3().crossVectors(dir, n).normalize();
  return { n, b };
}

function finishGeometry(positions: number[], uvs: number[], indices: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function triangleCountOf(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex();
  return index === null ? 0 : index.count / 3;
}

/** FNV-1a over quantized positions + indices; proves exact determinism. */
export function geometryHash(geo: THREE.BufferGeometry): string {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v & 0xffffffff;
    h = Math.imul(h, 0x01000193);
  };
  for (let i = 0; i < pos.count; i++) {
    mix(Math.round(pos.getX(i) * 1e6));
    mix(Math.round(pos.getY(i) * 1e6));
    mix(Math.round(pos.getZ(i) * 1e6));
  }
  if (idx !== null) for (let i = 0; i < idx.count; i++) mix(idx.getX(i));
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- forearm

export interface ForearmOptions {
  /** Exact elbow joint centre (camera-local, metres). */
  elbow: Vec3;
  /** Exact wrist joint centre (camera-local, metres). */
  wrist: Vec3;
  elbowRx?: number;
  elbowRz?: number;
  wristRx?: number;
  wristRz?: number;
  radialSegments?: number;
  lengthSegments?: number;
  /** Anterior bow amplitude (m). Default 0.0025. */
  bowAmp?: number;
  /** Cloth-fold ridge amplitude (m). Default 0.0012. */
  foldAmp?: number;
  seed?: number;
}

/**
 * Fitted forearm tube, elbow ring centroid == elbow, wrist ring == wrist.
 * Ring-major layout: [elbow cap centre, rings 0..rows, wrist cap centre].
 */
export function createForearmGeometry(opts: ForearmOptions): THREE.BufferGeometry {
  const elbow = new THREE.Vector3(...opts.elbow);
  const wrist = new THREE.Vector3(...opts.wrist);
  const axis = wrist.clone().sub(elbow);
  const dir = axis.clone().normalize();
  const { n, b } = basisFromAxis(dir);
  const elbowRx = opts.elbowRx ?? 0.045;
  const elbowRz = opts.elbowRz ?? 0.04;
  const wristRx = opts.wristRx ?? 0.03;
  const wristRz = opts.wristRz ?? 0.027;
  const radial = Math.max(8, Math.floor(opts.radialSegments ?? 14));
  const rows = Math.max(4, Math.floor(opts.lengthSegments ?? 10));
  const bowAmp = opts.bowAmp ?? 0.0025;
  const foldAmp = opts.foldAmp ?? 0.0012;
  const phase = (hash01(opts.seed ?? 1, 7) - 0.5) * Math.PI;

  const positions: number[] = [elbow.x, elbow.y, elbow.z];
  const uvs: number[] = [0.5, 0];
  const indices: number[] = [];
  const stride = radial + 1;
  const ring0 = 1;

  for (let iy = 0; iy <= rows; iy++) {
    const t = iy / rows;
    const e = smooth01(t);
    const center = elbow.clone().addScaledVector(axis, t).addScaledVector(n, bowAmp * Math.sin(Math.PI * t));
    const rx = elbowRx + (wristRx - elbowRx) * e;
    const rz = elbowRz + (wristRz - elbowRz) * e;
    const avg = 0.5 * (rx + rz);
    const foldEnv = Math.exp(-sq((t - 0.68) / 0.035)) + 0.8 * Math.exp(-sq((t - 0.8) / 0.03));
    for (let j = 0; j <= radial; j++) {
      const u = j / radial;
      const th = u * Math.PI * 2;
      const wob = 1 + (foldAmp / avg) * foldEnv * (0.65 + 0.35 * Math.cos(2 * th + phase));
      positions.push(
        center.x + (Math.cos(th) * rx * n.x + Math.sin(th) * rz * b.x) * wob,
        center.y + (Math.cos(th) * rx * n.y + Math.sin(th) * rz * b.y) * wob,
        center.z + (Math.cos(th) * rx * n.z + Math.sin(th) * rz * b.z) * wob,
      );
      uvs.push(u, t);
    }
  }

  for (let iy = 0; iy < rows; iy++) {
    for (let j = 0; j < radial; j++) {
      const a = ring0 + iy * stride + j;
      const b2 = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b2, c, b2, d, c);
    }
  }
  for (let j = 0; j < radial; j++) indices.push(0, ring0 + j + 1, ring0 + j);
  const wristCap = ring0 + rows * stride + radial + 1;
  positions.push(wrist.x, wrist.y, wrist.z);
  uvs.push(0.5, 1);
  const lastRing = ring0 + rows * stride;
  for (let j = 0; j < radial; j++) indices.push(wristCap, lastRing + j, lastRing + j + 1);

  return finishGeometry(positions, uvs, indices);
}

// ---------------------------------------------------------------- palm

export interface PalmOptions {
  center: Vec3;
  /** Radii (sx, sy, sz); defaults sit just inside the baseline sphere. */
  size?: Vec3;
  rotationZ?: number;
  radialSegments?: number;
  heightSegments?: number;
  /** Dorsal knuckle-ridge amplitude (m). Default 0.002. */
  knuckleAmp?: number;
  /** Inter-finger groove depth (m). Default 0.0015. */
  grooveDepth?: number;
  /** Superellipsoid exponent <1 = boxier. Default 0.8. */
  exponent?: number;
}

/** Fist volume with knuckle ridge + finger grooves. Distal edge is local -Z. */
export function createPalmGeometry(opts: PalmOptions): THREE.BufferGeometry {
  const [sx, sy, sz] = opts.size ?? [0.03, 0.041, 0.048];
  const radial = Math.max(8, Math.floor(opts.radialSegments ?? 12));
  const height = Math.max(4, Math.floor(opts.heightSegments ?? 8));
  const knuckleAmp = opts.knuckleAmp ?? 0.002;
  const grooveDepth = opts.grooveDepth ?? 0.0015;
  const e = opts.exponent ?? 0.8;
  const rz = opts.rotationZ ?? 0;

  const shape = (dx: number, dy: number, dz: number): [number, number, number] => {
    const s = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);
    let lx = sx * s(dx);
    let ly = sy * s(dy);
    const lz = sz * s(dz);
    if (ly > 0) {
      ly += knuckleAmp * Math.exp(-sq((lz + 0.55 * sz) / (0.3 * sz)));
      const groove =
        Math.exp(-sq((lx - 0.33 * sx) / (0.12 * sx))) + Math.exp(-sq((lx + 0.33 * sx) / (0.12 * sx)));
      ly -= grooveDepth * groove * Math.exp(-sq((lz + 0.7 * sz) / (0.25 * sz)));
    }
    return [lx, ly, lz];
  };

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cosR = Math.cos(rz);
  const sinR = Math.sin(rz);
  const emit = (lx: number, ly: number, lz: number, u: number, v: number): number => {
    const wx = lx * cosR - ly * sinR + opts.center[0];
    const wy = lx * sinR + ly * cosR + opts.center[1];
    positions.push(wx, wy, lz + opts.center[2]);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  const [npx, npy, npz] = shape(0, 1, 0);
  const north = emit(npx, npy, npz, 0.5, 1);
  const rings: number[][] = [];
  for (let iy = 1; iy < height; iy++) {
    const v = iy / height;
    const phi = v * Math.PI;
    const ring: number[] = [];
    for (let j = 0; j <= radial; j++) {
      const u = j / radial;
      const th = u * Math.PI * 2;
      const [lx, ly, lz] = shape(
        Math.sin(phi) * Math.cos(th),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(th),
      );
      ring.push(emit(lx, ly, lz, u, 1 - v));
    }
    rings.push(ring);
  }
  const [spx, spy, spz] = shape(0, -1, 0);
  const south = emit(spx, spy, spz, 0.5, 0);

  for (let j = 0; j < radial; j++) indices.push(north, rings[0][j + 1], rings[0][j]);
  for (let iy = 0; iy < rings.length - 1; iy++) {
    for (let j = 0; j < radial; j++) {
      const a = rings[iy][j];
      const b2 = rings[iy][j + 1];
      const c = rings[iy + 1][j];
      const d = rings[iy + 1][j + 1];
      indices.push(a, b2, c, b2, d, c);
    }
  }
  const last = rings[rings.length - 1];
  for (let j = 0; j < radial; j++) indices.push(south, last[j], last[j + 1]);

  return finishGeometry(positions, uvs, indices);
}

// ---------------------------------------------------------------- digits

export interface DigitCurve {
  base: Vec3;
  mid: Vec3;
  tip: Vec3;
  baseRadius?: number;
  tipRadius?: number;
}

export interface ThumbOptions extends DigitCurve {
  radialSegments?: number;
  lengthSegments?: number;
  /** Cross-section flattening (0..1 multiplies the binormal radius). */
  flatten?: number;
}

export interface FingerSetOptions {
  digits: DigitCurve[];
  radialSegments?: number;
  lengthSegments?: number;
  flatten?: number;
}

function tubeArrays(
  base: Vec3,
  mid: Vec3,
  tip: Vec3,
  r0: number,
  r1: number,
  radial: number,
  rows: number,
  flatten: number,
  capTip: boolean,
): { positions: number[]; uvs: number[]; indices: number[] } {
  const p0 = new THREE.Vector3(...base);
  const p1 = new THREE.Vector3(...mid);
  const p2 = new THREE.Vector3(...tip);
  const t0 = p1.clone().sub(p0).normalize();
  const { n, b } = basisFromAxis(t0);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const stride = radial + 1;
  for (let iy = 0; iy <= rows; iy++) {
    const t = iy / rows;
    const a = p0.clone().lerp(p1, t);
    const c = p1.clone().lerp(p2, t);
    const center = a.lerp(c, t);
    const r = r0 + (r1 - r0) * smooth01(t);
    for (let j = 0; j <= radial; j++) {
      const u = j / radial;
      const th = u * Math.PI * 2;
      positions.push(
        center.x + Math.cos(th) * r * n.x + Math.sin(th) * r * flatten * b.x,
        center.y + Math.cos(th) * r * n.y + Math.sin(th) * r * flatten * b.y,
        center.z + Math.cos(th) * r * n.z + Math.sin(th) * r * flatten * b.z,
      );
      uvs.push(u, t);
    }
  }
  for (let iy = 0; iy < rows; iy++) {
    for (let j = 0; j < radial; j++) {
      const a = iy * stride + j;
      const b2 = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b2, c, b2, d, c);
    }
  }
  if (capTip) {
    const tipIndex = positions.length / 3;
    positions.push(p2.x, p2.y, p2.z);
    uvs.push(0.5, 1);
    const lastRing = rows * stride;
    for (let j = 0; j < radial; j++) indices.push(tipIndex, lastRing + j, lastRing + j + 1);
  }
  return { positions, uvs, indices };
}

/** Tapered thumb tube; base ring stays open (root embeds it in the palm). */
export function createThumbGeometry(opts: ThumbOptions): THREE.BufferGeometry {
  const radial = Math.max(6, Math.floor(opts.radialSegments ?? 8));
  const rows = Math.max(3, Math.floor(opts.lengthSegments ?? 6));
  const { positions, uvs, indices } = tubeArrays(
    opts.base,
    opts.mid,
    opts.tip,
    opts.baseRadius ?? 0.0105,
    opts.tipRadius ?? 0.0075,
    radial,
    rows,
    opts.flatten ?? 0.85,
    true,
  );
  return finishGeometry(positions, uvs, indices);
}

/**
 * Merged curled-finger geometry: one mesh, disjoint tubes, real gaps.
 * Bases stay open (embedded in the palm); tips are capped.
 */
export function createFingerSetGeometry(opts: FingerSetOptions): THREE.BufferGeometry {
  const radial = Math.max(6, Math.floor(opts.radialSegments ?? 8));
  const rows = Math.max(3, Math.floor(opts.lengthSegments ?? 6));
  const flatten = opts.flatten ?? 0.8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  opts.digits.forEach((digit, di) => {
    const part = tubeArrays(
      digit.base,
      digit.mid,
      digit.tip,
      digit.baseRadius ?? 0.0095 - Math.min(2, Math.abs(di - 1)) * 0.0005,
      digit.tipRadius ?? 0.007,
      radial,
      rows,
      flatten,
      true,
    );
    const offset = positions.length / 3;
    positions.push(...part.positions);
    uvs.push(...part.uvs);
    for (const ix of part.indices) indices.push(ix + offset);
  });
  return finishGeometry(positions, uvs, indices);
}

// ------------------------------------------------------- side + anchors

export interface CanarySideSpec {
  side: 'trigger' | 'support';
  elbow: Vec3;
  wrist: Vec3;
  palmCenter: Vec3;
  palmRz?: number;
}

export interface CanarySideGeometries {
  forearm: THREE.BufferGeometry;
  palm: THREE.BufferGeometry;
  thumb: THREE.BufferGeometry;
  fingers: THREE.BufferGeometry;
  meta: {
    side: 'trigger' | 'support';
    forearmRadial: number;
    forearmRows: number;
    thumbBase: Vec3;
    thumbTip: Vec3;
    digitBases: Vec3[];
    digitTips: Vec3[];
  };
}

function add3(p: Vec3, d: readonly [number, number, number]): Vec3 {
  return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
}

/** Grip contact layout derived from the palm centre; root overrides freely. */
export function defaultGripForSide(
  side: 'trigger' | 'support',
  palm: Vec3,
): { thumb: DigitCurve; digits: DigitCurve[] } {
  const s = side === 'trigger' ? 1 : -1;
  const thumb: DigitCurve = {
    base: add3(palm, [s * 0.02, 0.004, 0.014]),
    mid: add3(palm, [s * 0.03, 0.012, 0.0]),
    tip: add3(palm, [s * 0.028, 0.006, -0.016]),
    baseRadius: 0.0105,
    tipRadius: 0.0075,
  };
  const digits: DigitCurve[] = [-1, 0, 1].map((k) => ({
    base: add3(palm, [k * 0.011 + s * 0.004, 0.018, -0.028]),
    mid: add3(palm, [k * 0.011 + s * 0.005, 0.01, -0.041]),
    tip: add3(palm, [k * 0.0105 + s * 0.004, -0.003, -0.036]),
    baseRadius: 0.0095 - Math.abs(k) * 0.0005,
    tipRadius: 0.007,
  }));
  return { thumb, digits };
}

export function buildCanarySideGeometries(spec: CanarySideSpec): CanarySideGeometries {
  const forearm = createForearmGeometry({
    elbow: spec.elbow,
    wrist: spec.wrist,
    seed: spec.side === 'trigger' ? 11 : 23,
  });
  const palm = createPalmGeometry({ center: spec.palmCenter, rotationZ: spec.palmRz ?? 0 });
  const grip = defaultGripForSide(spec.side, spec.palmCenter);
  const thumb = createThumbGeometry(grip.thumb);
  const fingers = createFingerSetGeometry({ digits: grip.digits });
  return {
    forearm,
    palm,
    thumb,
    fingers,
    meta: {
      side: spec.side,
      forearmRadial: 14,
      forearmRows: 10,
      thumbBase: grip.thumb.base,
      thumbTip: grip.thumb.tip,
      digitBases: grip.digits.map((d) => d.base),
      digitTips: grip.digits.map((d) => d.tip),
    },
  };
}

/** Exact trigger joints from first-person-hands.ts (bind pose). */
export const TRIGGER_SPEC = {
  elbow: [0.19, -0.39, 0.28] as Vec3,
  wrist: [0.025, -0.15, 0.045] as Vec3,
  palm: [0.01, -0.112, 0.012] as Vec3,
  palmRz: -0.16,
} as const;

export interface WeaponAnchor {
  weapon: 'rifle' | 'pistol' | 'smg' | 'shotgun' | 'sniper';
  supportZ: number;
  supportY: number;
  reloadTarget: Vec3;
}

/** Exact per-weapon support anchors from viewmodel.ts builders. */
export const WEAPON_ANCHORS: readonly WeaponAnchor[] = [
  { weapon: 'rifle', supportZ: -0.36, supportY: -0.055, reloadTarget: [0.01, -0.065, 0.23] },
  { weapon: 'pistol', supportZ: -0.08, supportY: -0.055, reloadTarget: [0.01, -0.02, 0.08] },
  { weapon: 'smg', supportZ: -0.22, supportY: -0.05, reloadTarget: [0.01, -0.04, 0.13] },
  { weapon: 'shotgun', supportZ: -0.3, supportY: -0.045, reloadTarget: [0.01, 0.02, 0.28] },
  { weapon: 'sniper', supportZ: -0.32, supportY: -0.045, reloadTarget: [0.01, 0.0, 0.22] },
];

export function supportJointsFor(anchor: WeaponAnchor): { elbow: Vec3; wrist: Vec3; palm: Vec3 } {
  return {
    elbow: [-0.16, -0.39, anchor.supportZ + 0.2],
    wrist: [-0.024, anchor.supportY - 0.047, anchor.supportZ + 0.025],
    palm: [-0.01, anchor.supportY, anchor.supportZ],
  };
}

// ------------------------------------------------------- materialization

export interface CanaryMaterials {
  sleeve: THREE.Material;
  glove: THREE.Material;
  gloveDetail: THREE.Material;
}

/**
 * Wrap canary geometries in the preserved group names using ONLY caller-owned
 * materials (identity-checked by the verifier). Adds nothing to any scene;
 * root parents the returned groups exactly like the current rig. Bind pose is
 * identity so existing reload trajectories apply unchanged. No per-frame code.
 */
export function materializeCanarySide(
  geos: CanarySideGeometries,
  mats: CanaryMaterials,
  side: 'trigger' | 'support',
): { hand: THREE.Group; forearm: THREE.Group; meshes: THREE.Mesh[] } {
  const hand = new THREE.Group();
  hand.name = side === 'trigger' ? CANARY_GROUP_NAMES.trigger : CANARY_GROUP_NAMES.support;
  const forearmGroup = new THREE.Group();
  forearmGroup.name =
    side === 'trigger' ? CANARY_GROUP_NAMES.triggerForearm : CANARY_GROUP_NAMES.supportForearm;
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  };
  const forearmMesh = mk(geos.forearm, mats.sleeve);
  const palmMesh = mk(geos.palm, mats.glove);
  const thumbMesh = mk(geos.thumb, mats.gloveDetail);
  const fingerMesh = mk(geos.fingers, mats.gloveDetail);
  forearmGroup.add(forearmMesh);
  hand.add(forearmGroup, palmMesh, thumbMesh, fingerMesh);
  return { hand, forearm: forearmGroup, meshes: [forearmMesh, palmMesh, thumbMesh, fingerMesh] };
}
