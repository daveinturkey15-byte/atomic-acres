/**
 * YARDS - fences, planting and all the yard / lawn dressing.
 *
 * The two back yards are deliberately DIFFERENT, not mirrored dressing (SPEC s2):
 *   ORANGE (-z): glasshouse, propped cold frames + red flowers, white curved-roof carport,
 *                crate store, circular patio off the deck, STRAIGHT stone run, 2 holes.
 *   WHITE  (+z): rounded garden pod, sand pit, aqua shuffleboard court, CURVED stone run
 *                out to the near gate, 3 holes. Front lawns: RED bank on orange, BLUE on white.
 * Everything goes through three instancers (box / cylinder / icosphere), so the module
 * costs one draw call per geometry+material pair.
 *
 * -------------------------------------------------------------- y ladder
 * ground.ts stands the lawns and both back yards on a plateau whose TOP is
 * KERB_HEIGHT + 0.001. Every flat feature here was once authored from y=0 as a
 * 60-140 mm THICKNESS, so patio, slab ring, court, markings, sand fill and both
 * stone runs were all built inside the grass: every measurement fine, every frame
 * bare striped lawn. A flat feature is now a TOP, not a thickness - a slab rising
 * from y=0 to its rung, never a floating plate, so the step down to the lawn is
 * always closed by the slab's own side face.
 *
 *   0.141  T_LAWN ... ground.ts's plateau. NOT ours - it is the floor we dress.
 *   0.171  T_STEP ... stepping stones, and the pale surrounds (patio ring, court apron)
 *   0.186  T_SAND ... sand pit fill, held 114 mm below its timber kerb
 *   0.201  T_SURF ... what those surrounds frame: the patio disc and the court bed
 *   0.226  T_MARK ... court markings, over the bed
 *
 * Rungs are >= 15 mm apart: the aerial reads this yard from ~95 m, where a 24-bit
 * buffer resolves about 7 mm (ground.ts derives it), so 15 mm is two resolvable
 * steps. Overlapping footprints never share a rung; things that only abut (the sand
 * fill and its kerb) may. Nothing flat here is collided - the player's floor is the
 * plateau top at KERB_HEIGHT, and a 60 mm patio is dressing, not a step.
 */
import * as THREE from 'three';
import type { AABB, BuildContext, Builder, BuildResult } from '../core/kit';
import { aabbSlab, group } from '../core/kit';
import { PAL } from '../core/palette';
import type { HouseSide } from '../core/layout';
import {
  BACK_FENCE, BOUND_X_MIN, BOUND_Z, CANOPY_LEN, DECK_LEN, DECK_OUT, FENCE_H,
  FRONT_LAWN_OUTER, GARAGE_LEN, HEAD_CENTER_X, HEAD_RADIUS, HOUSES, HOUSE_BACK,
  HOUSE_HALF_LEN, KERB_HEIGHT, KERB_WIDTH, ORANGE, PAVEMENT_OUTER, ROAD_HALF_WIDTH,
  ROAD_X_MAX, ROAD_X_MIN, WHITE, YARD_X_MAX, YARD_X_MIN,
} from '../core/layout';

// ---------------------------------------------------------------- derived frame
const YARD_W = YARD_X_MAX - YARD_X_MIN;
const YARD_D = BACK_FENCE - HOUSE_BACK;
const LAWN_D = FRONT_LAWN_OUTER - PAVEMENT_OUTER;
const PAVE_MID = (ROAD_HALF_WIDTH + KERB_WIDTH + PAVEMENT_OUTER) / 2;

// ---------------------------------------------------------------- y ladder
const T_LAWN = KERB_HEIGHT + 0.001;   // ground.ts's lawn / yard plateau top
const T_STEP = T_LAWN + 0.030;        // stepping stones, patio ring, court apron
const T_SAND = T_LAWN + 0.045;        // sand pit fill
const T_SURF = T_LAWN + 0.060;        // patio disc, court bed
const T_MARK = T_LAWN + 0.085;        // court markings

/**
 * Boundary fence at the cul-de-sac, hard against the turning head's kerb ring.
 * Halfway to THIRD_HOUSE_X put it at x 37.8, inside that house's body (36.69-43.31):
 * the aerial had the fence going into the roof one side and out the other.
 */
const BOUNDARY_X = HEAD_CENTER_X + HEAD_RADIUS + KERB_WIDTH;

/** x at fraction t across a back yard */
const yx = (t: number): number => YARD_X_MIN + t * YARD_W;
/** z at fraction t from a house's back wall (0) to its back fence (1) */
const yz = (h: HouseSide, t: number): number => h.side * (HOUSE_BACK + t * YARD_D);
/** z at fraction t from the pavement edge (0) to a house's front wall (1) */
const fz = (h: HouseSide, t: number): number => h.side * (PAVEMENT_OUTER + t * LAWN_D);
/** x at fraction t of the house half-length */
const hx = (t: number): number => t * HOUSE_HALF_LEN;
/** x at fraction t along the road stem */
const rx = (t: number): number => ROAD_X_MIN + t * (ROAD_X_MAX - ROAD_X_MIN);
/** a gap punched through a fence run: t = fraction along it, w = width in metres */
interface Hole { t: number; w: number }

// ---------------------------------------------------------------- instancer
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Collects unit-primitive transforms and emits one InstancedMesh per material. */
class Batch {
  private byMat = new Map<THREE.Material, THREE.Matrix4[]>();
  constructor(private geo: THREE.BufferGeometry) {}

  /** axis-aligned box/cyl/sphere: yaw about y, then tilt about its own x */
  put(m: THREE.Material, w: number, h: number, d: number,
      x: number, y: number, z: number, ry = 0, tilt = 0): void {
    _e.set(tilt, ry, 0, 'YXZ');
    this.push(m, _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(w, h, d)));
  }

  /** stretch the unit primitive between two points (chain links, curved lamp arms) */
  span(m: THREE.Material, r: number, ax: number, ay: number, az: number,
       bx: number, by: number, bz: number): void {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1e-5;
    _q.setFromUnitVectors(UP, _p.set(dx / len, dy / len, dz / len));
    this.push(m, _m.compose(
      _p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(r * 2, len, r * 2)));
  }

  private push(m: THREE.Material, mx: THREE.Matrix4): void {
    const a = this.byMat.get(m) ?? this.byMat.set(m, []).get(m)!;
    a.push(mx.clone());
  }

  flush(parent: THREE.Group, tag: string): void {
    let n = 0;
    for (const [m, arr] of this.byMat) {
      const im = new THREE.InstancedMesh(this.geo, m, arr.length);
      for (let i = 0; i < arr.length; i++) im.setMatrixAt(i, arr[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = !m.transparent;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = `${tag}${n++}`;
      parent.add(im);
    }
  }
}

// ================================================================= builder
export const buildYards: Builder = (ctx: BuildContext): BuildResult => {
  const { mat, rand } = ctx;
  const g = group('yards');
  const colliders: AABB[] = [];
  const rr = (a: number, b: number): number => a + rand() * (b - a);

  const B = new Batch(new THREE.BoxGeometry(1, 1, 1));
  const C = new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1));
  const S = new Batch(new THREE.IcosahedronGeometry(0.5, 1));

  const IRON = mat.painted(PAL.rooftopDrum, 0.5, 0.35);   // chain posts and chain
  const WHITEP = mat.painted(PAL.capsuleWhite, 0.5, 0.05);
  const LINE = mat.painted(PAL.windowBand, 0.85, 0);      // court markings
  const PAVE = mat.painted(PAL.concreteDark, 0.95, 0);    // patio / stepping stones
  const SLAB = mat.painted(PAL.concrete, 0.95, 0);        // pale dwarf walls / plinths
  const SOIL = mat.painted(PAL.dirt, 1, 0);
  const FLOWER = mat.painted(PAL.carRed, 0.8, 0);
  // treeLeaf (0x3f6b30) on lawn (0x4c7a33) was the same hue at the same value -
  // invisible even raised. carTeal is the greenest blue-green in the palette: still
  // SPEC's "green court", but it separates from mown grass in hue AND value, and
  // unlike a darker green it survives the tree shadow across this yard.
  const COURT = mat.painted(PAL.carTeal, 0.85, 0);        // painted shuffleboard surface
  const LAMP = mat.painted(PAL.terracotta, 0.45, 0.2);    // orange lamp head

  /** rotate a local offset into world space about (x,z) by yaw ry */
  const l2w = (x: number, z: number, ry: number, ox: number, oz: number): [number, number] =>
    [x + ox * Math.cos(ry) + oz * Math.sin(ry), z - ox * Math.sin(ry) + oz * Math.cos(ry)];

  /** A flat feature: a slab from y=0 to a rung. `top` is a T_* rung, NOT a thickness. */
  const padBox = (m: THREE.Material, w: number, d: number,
                  x: number, z: number, top: number, ry = 0): void =>
    B.put(m, w, top, d, x, top / 2, z, ry);
  const padDisc = (m: THREE.Material, dia: number,
                   x: number, z: number, top: number): void =>
    C.put(m, dia, top, dia, x, top / 2, z);

  // ---------------------------------------------------------------- fences
  const BOARD_P = 0.2, BOARD_W = 0.17, BOARD_T = 0.06, POST_P = 2.45;

  /** tan board fence between two points, with holes punched clean through it */
  function fence(ax: number, az: number, bx: number, bz: number, holes: Hole[]): void {
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const ry = Math.atan2(ux, uz);
    const at = (t: number): [number, number] => [ax + ux * t, az + uz * t];
    const holed = (t: number, pad: number): boolean =>
      holes.some((o) => Math.abs(t - o.t * L) < o.w / 2 + pad);

    const nb = Math.floor(L / BOARD_P);
    const off = (L - (nb - 1) * BOARD_P) / 2;
    for (let i = 0; i < nb; i++) {
      const d = off + i * BOARD_P;
      if (holed(d, 0)) continue;
      const bh = FENCE_H * rr(0.955, 1);
      const [x, z] = at(d);
      B.put(mat.timber, BOARD_T, bh, BOARD_W, x, bh / 2, z, ry);
    }
    const np = Math.max(2, Math.round(L / POST_P));
    for (let j = 0; j <= np; j++) {
      const d = (j / np) * L;
      if (holed(d, BOARD_P)) continue;
      const [x, z] = at(d);
      B.put(mat.timberDark, 0.16, FENCE_H + 0.18, 0.16, x, (FENCE_H + 0.18) / 2, z, ry);
    }
    // the cap rail runs straight over the holes, so each hole reads as knocked-out boards
    const [mx, mz] = at(L / 2);
    B.put(mat.timber, 0.27, 0.08, L, mx, FENCE_H + 0.06, mz, ry);

    // solid runs -> back rails and colliders; the holes are left open for traversal
    const segs: [number, number][] = [];
    let cur = 0;
    for (const o of holes.slice().sort((p, q) => p.t - q.t)) {
      const s0 = o.t * L - o.w / 2;
      if (s0 > cur) segs.push([cur, s0]);
      cur = Math.max(cur, o.t * L + o.w / 2);
    }
    if (cur < L) segs.push([cur, L]);
    for (const [s0, s1] of segs) {
      const len = s1 - s0;
      const [cx, cz] = at((s0 + s1) / 2);
      for (const y of [FENCE_H * 0.27, FENCE_H * 0.74]) {
        B.put(mat.timberDark, 0.08, 0.1, len, cx - uz * 0.07, y, cz + ux * 0.07, ry);
      }
      colliders.push(aabbSlab(cx, 0, cz,
        Math.abs(ux) * len + Math.abs(uz) * 0.24, FENCE_H,
        Math.abs(uz) * len + Math.abs(ux) * 0.24));
    }
  }

  for (const h of HOUSES) {
    const zf = h.side * BACK_FENCE;
    const holes = h.side === ORANGE.side
      ? [{ t: 0.30, w: 1.6 }, { t: 0.74, w: 1.35 }]
      : [{ t: 0.21, w: 1.5 }, { t: 0.57, w: 1.35 }, { t: 0.86, w: 1.6 }];
    fence(YARD_X_MIN, zf, YARD_X_MAX, zf, holes);
    fence(YARD_X_MIN, zf, YARD_X_MIN, h.side * HOUSE_BACK, []);   // side returns
    fence(YARD_X_MAX, zf, YARD_X_MAX, h.side * HOUSE_BACK, []);
  }
  fence(BOUNDARY_X, -BOUND_Z, BOUNDARY_X, BOUND_Z, []);           // cul-de-sac boundary

  // ---------------------------------------------------------------- hedges
  function hedge(ax: number, az: number, bx: number, bz: number, hgt: number): void {
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const ry = Math.atan2(ux, uz);
    const n = Math.max(2, Math.round(L / 2.6));
    const w = rr(0.74, 0.92);
    for (let i = 0; i < n; i++) {
      const s0 = (i / n) * L, s1 = ((i + 1) / n) * L;
      const len = s1 - s0, hh = hgt * rr(0.92, 1.08), body = hh - w / 2;
      const cx = ax + ux * (s0 + s1) / 2, cz = az + uz * (s0 + s1) / 2;
      B.put(mat.hedge, w, body, len, cx, body / 2, cz, ry);
      C.span(mat.hedge, w / 2, ax + ux * s0, body, az + uz * s0, ax + ux * s1, body, az + uz * s1);
      colliders.push(aabbSlab(cx, 0, cz, Math.abs(ux) * len + Math.abs(uz) * w, hh,
        Math.abs(uz) * len + Math.abs(ux) * w));
    }
    for (const e of [0, L]) S.put(mat.hedge, w, w, w, ax + ux * e, hgt - w / 2, az + uz * e);
  }

  for (const h of HOUSES) {
    const zin = h.side * (BACK_FENCE - 0.9);
    const [a, b] = h.side === ORANGE.side ? [0.40, 0.68] : [0.28, 0.50];
    hedge(yx(a), zin, yx(b), zin, rr(1.0, 1.2));                              // inside back fence
    hedge(YARD_X_MIN + 0.9, zin, YARD_X_MIN + 0.9, yz(h, 0.45), 1.15);        // yard edges
    hedge(YARD_X_MAX - 0.9, zin, YARD_X_MAX - 0.9, yz(h, 0.35), 1.05);
    const ve = -h.garageEnd;                                                  // never the drive side
    hedge(ve * (HOUSE_HALF_LEN + GARAGE_LEN * 0.1), fz(h, 0.08),
      ve * (HOUSE_HALF_LEN + GARAGE_LEN), fz(h, 0.08), rr(0.95, 1.1));
  }

  // ---------------------------------------------------------------- chain-and-post edging
  function chain(ax: number, az: number, bx: number, bz: number): void {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.round(L / 2.3));
    const top = 0.52, sag = 0.17;
    const at = (i: number): [number, number] => [ax + (bx - ax) * i / n, az + (bz - az) * i / n];
    for (let i = 0; i <= n; i++) {
      const [x, z] = at(i);
      C.put(IRON, 0.09, top, 0.09, x, top / 2, z);
      S.put(IRON, 0.13, 0.13, 0.13, x, top + 0.05, z);
    }
    for (let i = 0; i < n; i++) {
      const [x0, z0] = at(i), [x1, z1] = at(i + 1);
      let px = x0, py = top, pz = z0;
      for (let k = 1; k <= 3; k++) {
        const u = k / 3;
        const nx = x0 + (x1 - x0) * u, nz = z0 + (z1 - z0) * u;
        const ny = top - sag * Math.sin(Math.PI * u);
        C.span(IRON, 0.022, px, py, pz, nx, ny, nz);
        px = nx; py = ny; pz = nz;
      }
    }
  }

  for (const h of HOUSES) {
    const z0 = h.side * (PAVEMENT_OUTER + 0.35);
    const pc = -h.garageEnd * hx(0.45), pw = CANOPY_LEN * 0.2;   // gap for the porch path
    chain(-HOUSE_HALF_LEN, z0, pc - pw, z0);
    chain(pc + pw, z0, HOUSE_HALF_LEN, z0);
  }

  // ---------------------------------------------------------------- trees
  function tree(x: number, z: number): void {
    const s = rr(0.85, 1.25);
    const th = rr(2.5, 3.5) * s, tr = 0.27 * s;
    C.put(mat.bark, tr * 2, th, tr * 2, x, th / 2, z);
    C.put(mat.bark, tr * 2.9, 0.6 * s, tr * 2.9, x, 0.26 * s, z);      // root flare
    const R = rr(2.0, 2.7) * s;
    S.put(mat.leaf, R * 2, R * 1.75, R * 2, x, th + R * 0.5, z);
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2, d = R * rr(0.45, 0.78), q = R * rr(0.5, 0.78);
      S.put(mat.leaf, q * 2, q * 1.8, q * 2, x + Math.cos(a) * d, th + R * rr(0.25, 0.85),
        z + Math.sin(a) * d);
    }
    colliders.push(aabbSlab(x, 0, z, tr * 2.6, th, tr * 2.6));
  }

  for (const [tx, tz] of [
    [yx(0.10), -(BACK_FENCE + 2.6)], [yx(0.52), -(BACK_FENCE + 3.4)],
    [yx(0.90), -(BACK_FENCE + 2.2)], [yx(0.16), BACK_FENCE + 3.0],
    [yx(0.58), BACK_FENCE + 2.3], [yx(0.93), BACK_FENCE + 3.6],
    [HEAD_CENTER_X - HEAD_RADIUS * 0.5, -(HEAD_RADIUS + PAVE_MID * 0.9)],
    [HEAD_CENTER_X + HEAD_RADIUS * 0.6, HEAD_RADIUS + PAVE_MID * 0.8],
    [BOUND_X_MIN * 0.72, -(PAVEMENT_OUTER + hx(0.6))],
    [BOUND_X_MIN * 0.55, PAVEMENT_OUTER + hx(0.8)],
  ]) tree(tx, tz);

  // ---------------------------------------------------------------- street lamps
  function lamp(x: number, z: number, dx: number, dz: number): void {
    const ph = 5.0, R = 1.45;
    const n = Math.hypot(dx, dz) || 1;
    dx /= n; dz /= n;
    C.put(mat.steel, 0.38, 0.26, 0.38, x, 0.13, z);
    C.put(mat.steel, 0.17, ph, 0.17, x, ph / 2, z);
    let px = x, py = ph, pz = z;
    for (let i = 1; i <= 4; i++) {
      const th = (i / 4) * (Math.PI / 2);
      const nx = x + dx * R * (1 - Math.cos(th)), nz = z + dz * R * (1 - Math.cos(th));
      const ny = ph + R * Math.sin(th);
      C.span(mat.steel, 0.075, px, py, pz, nx, ny, nz);
      px = nx; py = ny; pz = nz;
    }
    S.put(LAMP, 0.72, 0.36, 0.72, px + dx * 0.24, py - 0.02, pz + dz * 0.24);
    S.put(mat.emissive(PAL.sunColor, 0.5), 0.36, 0.14, 0.36, px + dx * 0.24, py - 0.2, pz + dz * 0.24);
  }

  for (const h of HOUSES) for (const t of [0.34, 0.60, 0.86]) lamp(rx(t), h.side * PAVE_MID, 0, -h.side);
  for (const a of [-0.62, 0.55]) {
    const lx = HEAD_CENTER_X + Math.cos(a) * (HEAD_RADIUS + 1.3);
    const lz = Math.sin(a) * (HEAD_RADIUS + 1.3);
    lamp(lx, lz, HEAD_CENTER_X - lx, -lz);
  }

  // ---------------------------------------------------------------- appliance banks
  /** three-unit retro cooker bank on a white cabinet - the front-lawn chirality anchor */
  function applianceBank(x: number, z: number, ry: number, top: number): void {
    const w = 2.78, d = 0.76, cab = 0.92, foot = 0.14;
    const TOP = mat.painted(top, 0.38, 0.12);
    const at = (ox: number, oz: number): [number, number] => l2w(x, z, ry, ox, oz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [fx, fzz] = at(sx * (w / 2 - 0.12), sz * (d / 2 - 0.1));
      C.put(mat.chrome, 0.08, foot, 0.08, fx, foot / 2, fzz);
    }
    B.put(WHITEP, w, cab, d, x, foot + cab / 2, z, ry);
    for (const i of [-1, 0, 1]) {                 // three distinct units, white gaps between
      const [ux, uz] = at(i * 0.96, 0);
      B.put(TOP, 0.8, 0.5, d, ux, foot + cab + 0.25, uz, ry);
      B.put(mat.chrome, 0.84, 0.05, d + 0.03, ux, foot + cab + 0.52, uz, ry);   // hob trim
    }
    const [bx, bz] = at(0, -d / 2 + 0.05);
    B.put(mat.chrome, w, 0.28, 0.07, bx, foot + cab + 0.42, bz, ry);           // splashback
    for (const i of [-1, 0, 1]) {       // control dials on the cabinet front
      const [kx, kz] = at(i * 0.5, d / 2 + 0.02);
      C.put(mat.chrome, 0.11, 0.05, 0.11, kx, foot + cab * 0.72, kz, ry, Math.PI / 2);
    }
    B.put(mat.chrome, w + 0.04, 0.06, d + 0.04, x, foot + 0.05, z, ry);        // plinth trim
    colliders.push(aabbSlab(x, 0, z, w + 0.1, foot + cab + 0.56, d + 0.12));   // chest height
  }

  for (const h of HOUSES) applianceBank(h.garageEnd * hx(0.42), fz(h, 0.4),
    h.side > 0 ? Math.PI : 0, h.side === ORANGE.side ? PAL.applianceRed : PAL.applianceBlue);

  // ---------------------------------------------------------------- stepping stones
  /** a run of n stones along f(u); instanced, never collided, sits on T_STEP */
  function stones(n: number, f: (u: number) => [number, number]): void {
    for (let i = 0; i < n; i++) {
      const [sx, sz] = f(i / (n - 1));
      C.put(PAVE, rr(0.62, 0.8), T_STEP, rr(0.56, 0.72), sx, T_STEP / 2, sz,
        rand() * Math.PI);
    }
  }

  // ================================ ORANGE back yard (-z) ================================
  {
    const H = ORANGE;
    // circular patio off the rear deck (the deck and its stair are another module)
    const pr = DECK_LEN * 0.36;
    const pxx = H.deckX, pzz = yz(H, (DECK_OUT + pr * 1.12) / YARD_D);  // clear of the deck
    padDisc(SLAB, pr * 2.2, pxx, pzz, T_STEP);   // pale kerb ring, 30 mm proud of the lawn
    padDisc(PAVE, pr * 2, pxx, pzz, T_SURF);     // the terrace itself, 30 mm over the ring

    // glasshouse, tucked behind the garage end
    const gxx = yx(0.16), gzz = yz(H, 0.62), gw = 3.5, gd = 2.7, gwall = 1.75, grise = 1.0;
    B.put(SLAB, gw + 0.16, 0.44, gd + 0.16, gxx, 0.22, gzz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) C.put(mat.steel, 0.1, gwall + grise,
      0.1, gxx + sx * gw / 2, (gwall + grise) / 2, gzz + sz * gd / 2);
    const gy = 0.44 + (gwall - 0.44) / 2, gh = gwall - 0.44;
    const slope = Math.atan2(grise, gd / 2), plen = Math.hypot(grise, gd / 2);
    for (const s of [-1, 1]) {
      B.put(mat.glass, gw, gh, 0.06, gxx, gy, gzz + s * gd / 2);
      B.put(mat.glass, 0.06, gh, gd, gxx + s * gw / 2, gy, gzz);
      B.put(mat.glass, gw, 0.05, plen, gxx, gwall + grise / 2, gzz + s * gd / 4, 0, s * slope);
    }
    C.span(mat.steel, 0.05, gxx - gw / 2, gwall + grise, gzz, gxx + gw / 2, gwall + grise, gzz);
    colliders.push(aabbSlab(gxx, 0, gzz, gw + 0.2, gwall + grise, gd + 0.2));

    // cold frames with red flowers
    for (const i of [-1, 1]) {
      const cx = yx(0.30) + i * 1.2, cz = yz(H, 0.8), cw = 1.9, cd = 0.95, ch = 0.4;
      B.put(mat.timberDark, cw, ch, cd, cx, ch / 2, cz);
      B.put(SOIL, cw - 0.16, 0.08, cd - 0.16, cx, ch - 0.02, cz);
      B.put(mat.glass, cw, 0.05, cd * 1.1, cx, ch + 0.34, cz, 0, -0.5);
      for (let k = 0; k < 8; k++) {
        const fx = cx + rr(-0.8, 0.8), fzz2 = cz + rr(-0.32, 0.32);
        S.put(mat.leaf, 0.2, 0.14, 0.2, fx, ch + 0.05, fzz2);
        S.put(FLOWER, 0.14, 0.13, 0.14, fx, ch + 0.15, fzz2);
      }
    }

    // white curved-roof carport
    const kx = yx(0.86), kz = yz(H, 0.45), kw = 5.8, kd = 4.6, kph = 2.5;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const ppx = kx + sx * (kw / 2 - 0.2), ppz = kz + sz * (kd / 2 - 0.2);
      C.put(mat.steel, 0.16, kph, 0.16, ppx, kph / 2, ppz);
      colliders.push(aabbSlab(ppx, 0, ppz, 0.36, kph, 0.36));
    }
    for (let i = 0; i < 7; i++) {
      const u0 = i / 7 - 0.5, u1 = (i + 1) / 7 - 0.5;
      const y0 = kph + 0.6 * (1 - 4 * u0 * u0), y1 = kph + 0.6 * (1 - 4 * u1 * u1);
      const dzz = (u1 - u0) * kd, dy = y1 - y0;
      B.put(mat.roofWhite, kw, 0.12, Math.hypot(dzz, dy), kx, (y0 + y1) / 2,
        kz + (u0 + u1) / 2 * kd, 0, -Math.atan2(dy, dzz));
    }

    // crate store
    const cxx = yx(0.38), czz = yz(H, 0.26), cu = 0.72;
    for (const [ox, oy, oz] of [[-0.5, 0, -0.5], [0.5, 0, -0.5], [-0.5, 0, 0.5], [0.5, 0, 0.5],
                                [-0.44, 1, 0.04], [0.47, 1, 0.16], [0.02, 2, 0.1]]) {
      B.put(oy === 1 ? mat.timber : mat.timberDark, cu, cu, cu, cxx + ox * cu,
        oy * cu + cu / 2, czz + oz * cu, rr(-0.13, 0.13));
    }
    colliders.push(aabbSlab(cxx, 0, czz, cu * 2.2, cu * 3, cu * 2.2));

    // a straight stone run: patio rim -> glasshouse door. It starts OUTSIDE the ring,
    // not at the disc centre, so no stone is ever laid on top of the patio.
    const dx0 = gxx - pxx, dz0 = (gzz + gd / 2 + 0.7) - pzz;
    const run = Math.hypot(dx0, dz0);
    const u0 = (pr * 1.1 + 0.65) / run;
    stones(15, (u) => {
      const t = u0 + (1 - u0) * u;
      return [pxx + dx0 * t, pzz + dz0 * t];
    });
  }

  // ================================ WHITE back yard (+z) ================================
  {
    const H = WHITE;
    // rounded modernist garden pod
    const pxx = yx(0.20), pzz = yz(H, 0.55), pr = 2.0;
    C.put(SLAB, pr * 2.3, 0.36, pr * 2.3, pxx, 0.18, pzz);
    S.put(mat.capsuleWhite, pr * 2, 2.5, pr * 2, pxx, 1.4, pzz);
    C.put(mat.windowDark, pr * 2.04, 0.72, pr * 2.04, pxx, 1.45, pzz);
    C.put(mat.painted(PAL.capsuleTrim, 0.5, 0.2), pr * 2.1, 0.09, pr * 2.1, pxx, 1.85, pzz);
    B.put(mat.windowDark, 0.92, 1.4, 0.14, pxx, 1.06, pzz - pr * 0.97);
    colliders.push(aabbSlab(pxx, 0, pzz, pr * 2.1, 2.65, pr * 2.1));

    // sand pit: fill on T_SAND, kerb still founded at y=0 so it frames the sand
    const sx0 = yx(0.62), sz0 = yz(H, 0.78), sw = 4.0, sd = 3.0, kb = 0.24;
    padBox(mat.sand, sw, sd, sx0, sz0, T_SAND);
    for (const s of [-1, 1]) {
      B.put(mat.timber, kb, 0.3, sd + kb * 2, sx0 + s * (sw / 2 + kb / 2), 0.15, sz0);
      B.put(mat.timber, sw, 0.3, kb, sx0, 0.15, sz0 + s * (sd / 2 + kb / 2));
    }

    // shuffleboard court, long axis along x: pale apron, aqua bed, white markings
    const qx = yx(0.5), qz = yz(H, 0.44), qL = 10.4, qW = 2.3, qIn = 0.09;
    padBox(SLAB, qL + 0.7, qW + 0.7, qx, qz, T_STEP);
    padBox(COURT, qL, qW, qx, qz, T_SURF);
    /** a painted line; inset from the bed edge so no face is coplanar with it */
    const seg = (x0: number, z0: number, x1: number, z1: number, wdt: number): void => {
      padBox(LINE, wdt, Math.hypot(x1 - x0, z1 - z0), (x0 + x1) / 2, (z0 + z1) / 2,
        T_MARK, Math.atan2(x1 - x0, z1 - z0));
    };
    const qHL = qL / 2 - qIn, qHW = qW / 2 - qIn;
    for (const s of [-1, 1]) {
      seg(qx - qHL, qz + s * qHW, qx + qHL, qz + s * qHW, 0.08);   // side lines
      seg(qx + s * qL * 0.49, qz - qHW, qx + s * qL * 0.49, qz + qHW, 0.08);
      const tip = qx + s * qL * 0.29, bse = qx + s * qL * 0.47, hw = qW * 0.4;
      seg(tip, qz, bse, qz - hw, 0.07);
      seg(tip, qz, bse, qz + hw, 0.07);
      for (const f of [0.38, 0.43]) {
        const w2 = hw * (Math.abs(qx + s * qL * f - tip) / Math.abs(bse - tip));
        seg(qx + s * qL * f, qz - w2, qx + s * qL * f, qz + w2, 0.07);
      }
    }

    // A curved stone run: deck foot -> round the garden pod -> the NEAR fence hole.
    // Aimed at the FAR hole it crossed the court and stood in the sand pit - invisible
    // while everything was buried, a row of slabs in the sand once it is not, and the
    // corridor between court apron and pit kerb is only 0.57 m. So it goes the other way.
    const ax = H.deckX - DECK_LEN * 0.15, az = yz(H, (DECK_OUT + 0.9) / YARD_D);
    const bx = yx(0.21), bz = yz(H, 0.94);
    stones(9, (u) => {
      const mx = yx(0.30), mz = yz(H, 0.79);                       // bezier control
      const k = (1 - u) * (1 - u), j = 2 * (1 - u) * u, i2 = u * u;
      return [k * ax + j * mx + i2 * bx, k * az + j * mz + i2 * bz];
    });
  }

  B.flush(g, 'yard-box');
  C.flush(g, 'yard-cyl');
  S.flush(g, 'yard-sph');
  return { group: g, colliders };
};
