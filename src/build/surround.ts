/**
 * NUKETOWN 2025 - SURROUND: the public realm on the paved flanks.
 *
 * The concrete either side of the house plots is the biggest surface in the aerial
 * and it was empty, which made the town read as an architectural model on a slab.
 * The BO2-2025 aerial (SPEC s3 / NT02) does not leave it empty: a 1960s show town
 * puts a fountain basin, teal parasols, seating and planted beds out here.
 *
 * Three PLACES, not an even scatter - even scatter reads as clutter:
 *   1. FOUNTAIN PLAZA  west flank, +z  kerbed basin, atom finial, curved seat
 *                                      wall, two bench pairs, beds, flagpole
 *   2. SHADED TERRACE  east flank, -z  raised kerbed deck off two shallow steps,
 *                                      retaining wall, 4 parasols, 4 benches,
 *                                      bins, beds
 *   3. PLANTED WALK    west flank, -z  L of low retaining wall, three beds, a
 *                                      bench, a bin and a fingerpost
 *
 * -------------------------------------------------------------- what it stands on
 * ground.ts lays the BASE APRON at y = 0 and raises the kerb / pavement / lawn
 * PLATEAU to KERB_HEIGHT; yards.ts lost every flat feature it owned by authoring
 * from y = 0 inside that plateau. Nothing here assumes - surfaceY() reconstructs
 * the surface under a point from the layout constants and every place takes its
 * base from it. All three land on the apron, being outside the plateau, which is
 * the point: they are on the flanks.
 *
 * ----------------------------- clearances (metres), measured off every primitive
 *   place            x span           z span          tightest gap
 *   fountain plaza   -44.9 .. -29.1   15.9 .. 31.7    8.7 to the pavement edge
 *   shaded terrace    21.5 ..  33.3  -27.9 ..-19.7    1.5 to the yard side fence
 *   planted walk     -40.1 .. -27.5  -23.2 ..-17.2    3.6 to the house front line
 *
 * Nothing comes nearer the street than FRONT_LAWN_OUTER, the house front line, so
 * the road, both pavements, both turning-head approaches, every lawn, every back
 * yard and both garage aprons are untouched - and nothing is within 3 m of a house
 * or garage wall, because the nearest of those is 9 m inside the nearest place.
 *
 * Colliders: the basin kerb, the seat wall, both retaining walls, the terrace and
 * its steps, every bench, bin and planter. Parasol canopies clear head height by
 * 0.45 m and are not collided.
 */
import * as THREE from 'three';
import type { AABB, BuildContext, Builder, BuildResult } from '../core/kit';
import { aabbSlab, group } from '../core/kit';
import { PAL } from '../core/palette';
import {
  BACK_FENCE, BOUND_X_MIN, BOUND_Z, FRONT_LAWN_OUTER, HEAD_CENTER_X, HEAD_RADIUS,
  KERB_HEIGHT, PAVEMENT_OUTER, ROAD_HALF_WIDTH, ROAD_X_MIN, YARD_X_MAX, YARD_X_MIN,
} from '../core/layout';

// ---------------------------------------------------------------- derived frame
/** Middle of each flank. East stops at the bulb's kerb line - the boundary fence
 *  is just outside it - so nothing here depends on where the third house sits. */
const WEST_X = (BOUND_X_MIN + YARD_X_MIN) / 2;                 // -37.0
const EAST_LIMIT = HEAD_CENTER_X + HEAD_RADIUS;                //  35.6
const EAST_X = (YARD_X_MAX + EAST_LIMIT) / 2;                  //  27.8
/** Both hero places share the house plots' z band, so the town lines through. */
const FLANK_Z = (FRONT_LAWN_OUTER + BACK_FENCE) / 2;           //  23.8
/** The walk sits shallower, so the west flank is not a mirror of itself. */
const WALK_X = WEST_X + 2.5;
const WALK_Z = -(PAVEMENT_OUTER + BOUND_Z) / 2;                // -22.6
/** Outer edge of the ring of pavement round the turning head. */
const HEAD_PAVE_R = HEAD_RADIUS + (PAVEMENT_OUTER - ROAD_HALF_WIDTH);

/**
 * Which surface does this point stand on? Reconstructed from the layout contract
 * rather than assumed, so a place authored near a plateau edge cannot end up buried
 * in it the way the yard dressing once was.
 */
function surfaceY(x: number, z: number): number {
  const az = Math.abs(z);
  const onRoadRun = x >= ROAD_X_MIN && x <= HEAD_CENTER_X;   // kerb + pavement strip
  if (onRoadRun && az >= ROAD_HALF_WIDTH && az <= PAVEMENT_OUTER) return KERB_HEIGHT;
  // front lawns, frontage pads, the house band and both back yards
  if (x >= YARD_X_MIN && x <= YARD_X_MAX && az >= PAVEMENT_OUTER && az <= BACK_FENCE) {
    return KERB_HEIGHT;
  }
  const r = Math.hypot(x - HEAD_CENTER_X, z);                // the bulb's pavement ring
  return r >= HEAD_RADIUS && r <= HEAD_PAVE_R ? KERB_HEIGHT : 0;
}

// ---------------------------------------------------------------- instancer
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Collects unit-primitive transforms and emits one InstancedMesh per material. */
class Batch {
  private byMat = new Map<THREE.Material, THREE.Matrix4[]>();
  constructor(private geo: THREE.BufferGeometry) {}
  put(m: THREE.Material, w: number, h: number, d: number,
      x: number, y: number, z: number, ry = 0): void {
    _e.set(0, ry, 0, 'YXZ');
    const mx = _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(w, h, d));
    const a = this.byMat.get(m) ?? this.byMat.set(m, []).get(m)!;
    a.push(mx.clone());
  }
  flush(parent: THREE.Group, tag: string): void {
    let n = 0;
    for (const [m, arr] of this.byMat) {
      const im = new THREE.InstancedMesh(this.geo, m, arr.length);
      for (let i = 0; i < arr.length; i++) im.setMatrixAt(i, arr[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = tag + n++;
      parent.add(im);
    }
  }
}

// ---------------------------------------------------------------- curved shapes
function extrudeFlat(s: THREE.Shape, h: number, m: THREE.Material,
                     x: number, y: number, z: number): THREE.Mesh {
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 40 });
  g.rotateX(-Math.PI / 2);      // shape plane -> xz, extrusion -> +y
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Full extruded ring: top face plus BOTH walls in one draw call (basin kerb). */
function ringWall(x: number, y: number, z: number, rIn: number, rOut: number,
                  h: number, m: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return extrudeFlat(s, h, m, x, y, z);
}

/** Extruded annular SECTOR. Shape y maps to world -z, so world angles are negated. */
function arcWall(x: number, y: number, z: number, rIn: number, rOut: number, h: number,
                 a0: number, a1: number, m: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, -a1, -a0, false);
  s.absarc(0, 0, rIn, -a0, -a1, true);
  s.closePath();
  return extrudeFlat(s, h, m, x, y, z);
}

/** A flat disc or annulus lying on the xz plane. rIn = 0 gives a disc. */
function inlay(x: number, y: number, z: number, rIn: number, rOut: number,
               m: THREE.Material): THREE.Mesh {
  const g = rIn > 0
    ? new THREE.RingGeometry(rIn, rOut, 56)
    : new THREE.CircleGeometry(rOut, 56);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  return mesh;
}

/** Approximate a curved wall with N tight AABBs sampled off the true arc. */
function arcColliders(out: AABB[], cx: number, cz: number, rIn: number, rOut: number,
                      yBase: number, h: number, a0: number, a1: number, n: number): void {
  for (let i = 0; i < n; i++) {
    let xn = Infinity, xx = -Infinity, zn = Infinity, zx = -Infinity;
    for (let k = 0; k <= 3; k++) {
      const a = a0 + (a1 - a0) * ((i + k / 3) / n);
      for (const r of [rIn, rOut]) {
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        xn = Math.min(xn, x); xx = Math.max(xx, x); zn = Math.min(zn, z); zx = Math.max(zx, z);
      }
    }
    out.push(aabbSlab((xn + xx) / 2, yBase, (zn + zx) / 2, xx - xn, h, zx - zn));
  }
}

// ================================================================= builder
export const buildSurround: Builder = (ctx: BuildContext): BuildResult => {
  const { mat, rand } = ctx;
  const g = group('surround');
  const colliders: AABB[] = [];
  const rr = (a: number, b: number): number => a + rand() * (b - a);

  const B = new Batch(new THREE.BoxGeometry(1, 1, 1));
  const C = new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1));
  const S = new Batch(new THREE.IcosahedronGeometry(0.5, 1));
  const K = new Batch(new THREE.ConeGeometry(0.5, 1, 8));      // parasol canopies

  // Signatures reused from yards.ts / plaza.ts where they match, so the library
  // hands back the SAME singleton rather than compiling another program.
  const SLAB = mat.painted(PAL.concrete, 0.95, 0);
  const PAVE = mat.painted(PAL.concreteDark, 0.95, 0);
  const IRON = mat.painted(PAL.rooftopDrum, 0.5, 0.35);
  const TEAL = mat.painted(PAL.signTeal, 0.55, 0.12);
  const CREAM = mat.painted(PAL.coachCream, 0.6, 0.08);
  const MAROON = mat.painted(PAL.signMaroon, 0.55, 0.12);
  const TIMB = mat.painted(PAL.timber, 0.88, 0);
  const SOIL = mat.painted(PAL.dirt, 1, 0);
  const WATER = mat.painted(PAL.glass, 0.07, 0.3);

  /** rotate a local offset into world space about (x, z) by yaw ry */
  const l2w = (x: number, z: number, ry: number, ox: number, oz: number): [number, number] =>
    [x + ox * Math.cos(ry) + oz * Math.sin(ry), z - ox * Math.sin(ry) + oz * Math.cos(ry)];

  // ---------------------------------------------------------------- furniture
  /** Slatted bench, long axis local +x, seat facing local +z. Real cover. */
  function bench(x: number, z: number, ry: number, y0: number): void {
    const L = 1.95, D = 0.62;
    B.put(TIMB, L, 0.09, D * 0.82, x, y0 + 0.45, z, ry);
    const [bx, bz] = l2w(x, z, ry, 0, -D * 0.44);
    B.put(TIMB, L, 0.44, 0.09, bx, y0 + 0.73, bz, ry);
    for (const s of [-1, 1]) {
      const [lx, lz] = l2w(x, z, ry, s * (L / 2 - 0.15), 0);
      B.put(IRON, 0.10, 0.45, D * 0.8, lx, y0 + 0.225, lz, ry);   // sits ON, not in
    }
    const c = Math.abs(Math.cos(ry)), t = Math.abs(Math.sin(ry));
    colliders.push(aabbSlab(x, y0, z, c * L + t * D, 0.95, t * L + c * D));
  }

  function bin(x: number, z: number, y0: number): void {
    C.put(TEAL, 0.54, 0.82, 0.54, x, y0 + 0.41, z);
    C.put(mat.chrome, 0.62, 0.08, 0.62, x, y0 + 0.86, z);
    colliders.push(aabbSlab(x, y0, z, 0.62, 0.9, 0.62));
  }

  /** Raised kerbed bed: pale kerb, coping rails, soil, clipped shrubs. */
  function planter(x: number, z: number, w: number, d: number, y0: number): void {
    const h = 0.52, top = y0 + h;
    B.put(SLAB, w, h, d, x, y0 + h / 2, z);
    for (const s of [-1, 1]) {
      B.put(PAVE, w + 0.08, 0.09, 0.22, x, top + 0.045, z + s * (d / 2 - 0.03));
      B.put(PAVE, 0.22, 0.09, d + 0.08, x + s * (w / 2 - 0.03), top + 0.045, z);
    }
    B.put(SOIL, w - 0.30, 0.12, d - 0.30, x, top, z);
    // Planted on a JITTERED GRID, not scattered: the first pass placed w*d*0.5
    // shrubs at random and every bed read from the air as a tray of bare soil
    // with one blob in it. A bed is a green mass or it is not planting.
    const nx = Math.max(2, Math.round(w / 0.62)), nz = Math.max(2, Math.round(d / 0.62));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const q = rr(0.58, 0.88);
        S.put(mat.hedge, q, q * 0.8, q,
          x + ((i + 0.5) / nx - 0.5) * (w - 0.46) + rr(-0.09, 0.09),
          top + 0.02 + q * 0.38,
          z + ((j + 0.5) / nz - 0.5) * (d - 0.46) + rr(-0.09, 0.09));
      }
    }
    colliders.push(aabbSlab(x, y0, z, w + 0.08, h + 0.09, d + 0.08));
  }

  /** Teal / cream sun umbrella. Canopy underside at 2.26 m - no collider. */
  function parasol(x: number, z: number, y0: number, cloth: THREE.Material): void {
    const H = 2.55, R = 1.6;
    C.put(mat.steel, 0.09, H, 0.09, x, y0 + H / 2, z);
    K.put(cloth, R * 2, 0.55, R * 2, x, y0 + H - 0.02, z);
    S.put(CREAM, 0.20, 0.20, 0.20, x, y0 + H + 0.30, z);
  }

  function flagpole(x: number, z: number, y0: number): void {
    const H = 7.2;
    C.put(SLAB, 0.92, 0.22, 0.92, x, y0 + 0.11, z);
    C.put(mat.steel, 0.14, H, 0.14, x, y0 + H / 2, z);
    S.put(mat.chrome, 0.26, 0.26, 0.26, x, y0 + H + 0.08, z);
    B.put(TEAL, 1.70, 0.92, 0.05, x + 0.86, y0 + H - 0.78, z);   // broadside to -z
    colliders.push(aabbSlab(x, y0, z, 0.92, 0.22, 0.92));
  }

  /** Fingerpost: two blades on a post, one per axis. */
  function signpost(x: number, z: number, y0: number): void {
    C.put(IRON, 0.14, 2.60, 0.14, x, y0 + 1.30, z);
    B.put(CREAM, 1.50, 0.28, 0.07, x + 0.62, y0 + 2.28, z);
    B.put(TEAL, 0.07, 0.24, 1.30, x, y0 + 1.94, z - 0.56);
    S.put(MAROON, 0.30, 0.30, 0.30, x, y0 + 2.62, z);
  }

  // ======================================== PLACE 1: the fountain plaza (west, +z)
  {
    const cx = WEST_X, cz = FLANK_Z, y0 = surfaceY(cx, cz);
    const R_DISC = 7.9, R_RIM = 7.35, R_IN = 6.0, R_KERB = 4.3, R_BOWL = 3.7;

    // Paving: a dark rim band, a concreteDark field, a pale inner apron. THREE
    // tones and no more - the first pass put a teal course between them and at
    // 95 m the plaza read as a painted bullseye, the loudest thing on the flank,
    // pulling the eye clean off the houses. Teal belongs on the parasols and bins,
    // as an accent, not a target. The rim is PAL.steel because plaza.ts measured
    // concreteDark's 15% step against concrete vanishing at range, and a disc with
    // no edge reads as a smudge. Flat, 25-50 mm proud: nothing to trip over, and
    // 25 mm resolves at aerial range (ground.ts derives ~7 mm of buffer noise).
    g.add(inlay(cx, y0 + 0.025, cz, 0, R_RIM, PAVE));
    g.add(inlay(cx, y0 + 0.025, cz, R_RIM, R_DISC, mat.painted(PAL.steel, 0.95, 0)));
    g.add(inlay(cx, y0 + 0.05, cz, 0, R_IN, SLAB));

    // Basin: kerb ring, coping, floor, water. The kerb stands 0.65 m, over the
    // controller's 0.38 m step, so the basin is a real obstacle and real cover.
    g.add(ringWall(cx, y0, cz, R_BOWL, R_KERB, 0.55, SLAB));
    g.add(ringWall(cx, y0 + 0.55, cz, R_BOWL - 0.07, R_KERB + 0.10, 0.10, PAVE));
    C.put(PAVE, R_BOWL * 2, 0.14, R_BOWL * 2, cx, y0 + 0.07, cz);
    g.add(inlay(cx, y0 + 0.40, cz, 0, R_BOWL - 0.08, WATER));
    arcColliders(colliders, cx, cz, R_BOWL, R_KERB + 0.10, y0, 0.65, 0, Math.PI * 2, 16);

    // Central plinth, stepped, with the atom finial the pylon sign uses (NT05).
    C.put(PAVE, 3.00, 0.44, 3.00, cx, y0 + 0.36, cz);
    C.put(SLAB, 2.00, 0.40, 2.00, cx, y0 + 0.78, cz);
    C.put(SLAB, 2.70, 0.16, 2.70, cx, y0 + 1.06, cz);
    C.put(mat.chrome, 0.22, 1.30, 0.22, cx, y0 + 1.79, cz);
    S.put(MAROON, 0.78, 0.78, 0.78, cx, y0 + 2.65, cz);
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.055, 8, 28), mat.chrome);
    orbit.position.set(cx, y0 + 2.65, cz);
    orbit.rotation.set(Math.PI / 2 - 0.45, 0, 0.35);
    orbit.castShadow = true; g.add(orbit);
    colliders.push(aabbSlab(cx, y0, cz, 3.0, 1.14, 3.0));

    // Curved seat wall closing the plaza on the boundary side, bookended by beds.
    const A0 = 0.52, A1 = Math.PI - 0.52, WI = R_IN + 0.55, WO = R_IN + 1.25;
    g.add(arcWall(cx, y0, cz, WI, WO, 0.62, A0, A1, SLAB));
    arcColliders(colliders, cx, cz, WI, WO, y0, 0.62, A0, A1, 8);
    for (const a of [A0 - 0.19, A1 + 0.19]) {
      planter(cx + Math.cos(a) * 6.6, cz + Math.sin(a) * 6.6, 1.9, 1.6, y0);
    }

    // Seating in two clusters facing the water, with the bins beside them.
    for (const a of [-1.33, -0.98, 3.52, 3.87]) {
      const bx = cx + Math.cos(a) * 5.5, bz = cz + Math.sin(a) * 5.5;
      bench(bx, bz, Math.atan2(-Math.cos(a), -Math.sin(a)), y0);
    }
    for (const a of [-1.80, 4.24]) {
      bin(cx + Math.cos(a) * 5.3, cz + Math.sin(a) * 5.3, y0);
    }
    flagpole(cx + Math.cos(-0.62) * 6.6, cz + Math.sin(-0.62) * 6.6, y0);
  }

  // ====================================== PLACE 2: the shaded terrace (east, -z)
  {
    const cx = EAST_X, cz = -FLANK_Z, y0 = surfaceY(cx, cz);
    const W = 11.0, D = 8.2, TOP = 0.32, DECK = y0 + TOP + 0.025;

    // Dark kerb band round a pale deck - what makes a plinth read from the air.
    // One collider, top at the DECK, 0.345 m: inside the controller's 0.38 m
    // step-up, so the terrace is walkable from any edge and traps nobody.
    B.put(PAVE, W, TOP, D, cx, y0 + TOP / 2, cz);
    B.put(SLAB, W - 0.9, TOP + 0.025, D - 0.9, cx, y0 + (TOP + 0.025) / 2, cz);
    colliders.push(aabbSlab(cx, y0, cz, W, TOP + 0.025, D));

    // Two shallow steps on the map side, where players actually arrive.
    for (let i = 0; i < 2; i++) {
      const h = (TOP * (2 - i)) / 3, sx = cx - W / 2 - 0.42 * (i + 0.5);
      B.put(PAVE, 0.42, h, 3.6, sx, y0 + h / 2, cz);
      colliders.push(aabbSlab(sx, y0, cz, 0.42, h, 3.6));
    }

    // Retaining wall along the boundary edge: chest-high cover, 1.39 m overall.
    const wz = cz - D / 2 + 0.28;
    B.put(SLAB, W - 0.6, 0.95, 0.36, cx, y0 + TOP + 0.475, wz);
    B.put(PAVE, W - 0.4, 0.12, 0.50, cx, y0 + TOP + 1.01, wz);
    colliders.push(aabbSlab(cx, y0, wz, W - 0.4, TOP + 1.07, 0.50));

    // Two parasol clusters, each shading a pair of benches.
    const cluster = (ox: number, a: THREE.Material, b: THREE.Material): void => {
      parasol(cx + ox, cz + 0.6, DECK, a);
      parasol(cx + ox + 2.1, cz - 0.9, DECK, b);
      bench(cx + ox - 0.6, cz + 2.0, 0, DECK);
      bench(cx + ox + 2.3, cz + 1.4, Math.PI * 0.12, DECK);
    };
    cluster(-3.3, TEAL, CREAM);
    cluster(1.6, CREAM, TEAL);
    bin(cx - 4.5, cz + 3.0, DECK);
    bin(cx + 4.6, cz + 2.6, DECK);
    planter(cx - 4.3, cz - 2.2, 2.0, 1.7, DECK);
    planter(cx + 4.2, cz - 2.3, 2.2, 1.7, DECK);
    planter(cx + 0.4, cz + 3.3, 3.2, 1.3, DECK);
  }

  // ======================================== PLACE 3: the planted walk (west, -z)
  {
    // An L, not a line: the first pass ran one straight wall with three beds
    // along it and read from the air as a bus stop.
    const cx = WALK_X, cz = WALK_Z, y0 = surfaceY(cx, cz);
    const L = 11.0, RET = 5.4;
    B.put(SLAB, L, 0.78, 0.40, cx, y0 + 0.39, cz);
    B.put(PAVE, L + 0.24, 0.12, 0.56, cx, y0 + 0.84, cz);
    colliders.push(aabbSlab(cx, y0, cz, L + 0.24, 0.90, 0.56));
    const rx = cx - L / 2 + 0.2, rz = cz + RET / 2;
    B.put(SLAB, 0.40, 0.78, RET, rx, y0 + 0.39, rz);
    B.put(PAVE, 0.56, 0.12, RET, rx, y0 + 0.84, rz);
    colliders.push(aabbSlab(rx, y0, rz, 0.56, 0.90, RET));
    planter(cx - 2.4, cz + 1.9, 3.0, 1.9, y0);
    planter(cx + 1.7, cz + 1.9, 2.4, 1.9, y0);
    planter(cx + 4.3, cz + 3.6, 1.8, 2.4, y0);
    bench(cx + 0.6, cz + 4.4, Math.PI, y0);
    bin(cx - 4.4, cz + 3.5, y0);
    signpost(cx + 5.6, cz + 0.6, y0);
  }
  // ====================== PLACE 4: fringe / street cover (REAL-REFERENCE 8/9/10)
  // Designed cover rhythm on the paved flanks, never a wall: barrier-plus-plaque
  // pairs, planter/louvre/bin groupings and crate/turf pairs at 8-15 m rhythm
  // with permeable slots between pieces. Every piece sits on surfaceY();
  // nothing enters the carriageway (|z| < ROAD_HALF_WIDTH), the bulb's pavement
  // ring, or the yards band (YARD_X_MIN..YARD_X_MAX x PAVEMENT_OUTER..BACK_FENCE,
  // which is yards.ts territory - the fringe stays west of YARD_X_MIN and east
  // of YARD_X_MAX toward the boundary). One signText face for the whole file.
  {
    const STONE = mat.painted(PAL.rubbleStone, 0.95, 0);
    const BRONZE = mat.painted(PAL.interiorGold, 0.5, 0.6);
    const YEL = mat.painted(PAL.hazardYellow, 0.7, 0.05);
    const NOTICE = mat.signText({ text: 'NOTICE', color: PAL.busBlack,
      background: PAL.interiorGold, aspect: 1.4 });
    const rot = (ry: number): [number, number] => [Math.abs(Math.cos(ry)), Math.abs(Math.sin(ry))];

    /** Curved steel blast barrier ~1.3 h x ~2.4 chord on a concrete foot. */
    function barrierArc(x: number, z: number, a0: number, y0: number): void {
      const A1 = a0 + 2.3;
      g.add(arcWall(x, y0, z, 1.15, 1.45, 1.32, a0, A1, mat.steel));
      g.add(arcWall(x, y0, z, 1.05, 1.55, 0.16, a0 - 0.08, A1 + 0.08, PAVE));
      arcColliders(colliders, x, z, 1.05, 1.55, y0, 1.32, a0, A1, 4);
    }

    /** Straight concrete barrier 2.8 x 1.3 with coping and foot. Real cover. */
    function barrierStraight(x: number, z: number, ry: number, y0: number): void {
      const L = 2.8;
      B.put(PAVE, L + 0.3, 0.16, 0.6, x, y0 + 0.08, z, ry);
      B.put(SLAB, L, 1.16, 0.34, x, y0 + 0.58, z, ry);
      B.put(PAVE, L + 0.16, 0.14, 0.48, x, y0 + 1.23, z, ry);
      const [c, t] = rot(ry);
      colliders.push(aabbSlab(x, y0, z, c * (L + 0.3) + t * 0.6, 1.3, t * (L + 0.3) + c * 0.6));
    }

    /** Stone pier + bronze plaque; only the west-south pier carries NOTICE. */
    function plaquePier(x: number, z: number, ry: number, y0: number, withNotice: boolean): void {
      B.put(STONE, 0.52, 1.06, 0.52, x, y0 + 0.53, z, ry);
      B.put(STONE, 0.66, 0.12, 0.66, x, y0 + 1.12, z, ry);
      const [px, pz] = l2w(x, z, ry, 0, 0.28);
      B.put(BRONZE, 0.50, 0.40, 0.05, px, y0 + 0.72, pz, ry);
      if (withNotice) {
        const [fx, fz] = l2w(x, z, ry, 0, 0.315);
        B.put(NOTICE, 0.44, 0.34, 0.02, fx, y0 + 0.72, fz, ry);
      }
      colliders.push(aabbSlab(x, y0, z, 0.66, 1.18, 0.66));
    }

    /** Louvred utility box: body, 3 vent slats, cap. Street-furniture cover. */
    function louvreBox(x: number, z: number, ry: number, y0: number): void {
      B.put(mat.steel, 1.40, 0.95, 0.80, x, y0 + 0.475, z, ry);
      for (let i = 0; i < 3; i++) {
        const [sx, sz] = l2w(x, z, ry, 0, 0.42);
        B.put(IRON, 1.10, 0.06, 0.06, sx, y0 + 0.35 + i * 0.18, sz, ry);
      }
      B.put(PAVE, 1.52, 0.08, 0.92, x, y0 + 0.99, z, ry);
      const [c, t] = rot(ry);
      colliders.push(aabbSlab(x, y0, z, c * 1.52 + t * 0.92, 1.03, t * 1.52 + c * 0.92));
    }

    /** Crate pair, side by side and NEVER stacked: painted boxes, no text. */
    function crates(x: number, z: number, ry: number, y0: number): void {
      const [ax, az] = l2w(x, z, ry, -0.55, 0);
      const [bx, bz] = l2w(x, z, ry, 0.55, 0.1);
      B.put(YEL, 1.0, 0.85, 0.9, ax, y0 + 0.425, az, ry);
      B.put(YEL, 0.9, 0.65, 0.8, bx, y0 + 0.325, bz, ry);
      colliders.push(aabbSlab(ax, y0, az, 1.0, 0.85, 0.9));
      colliders.push(aabbSlab(bx, y0, bz, 0.9, 0.65, 0.8));
    }

    /** Turf rolls: low leaf blobs, walkable (under the 0.38 m step), no collider. */
    function turfRolls(x: number, z: number, ry: number, y0: number): void {
      const [ax, az] = l2w(x, z, ry, -0.6, 0);
      const [bx, bz] = l2w(x, z, ry, 0.6, 0.15);
      S.put(mat.leaf, 1.15, 0.38, 0.52, ax, y0 + 0.19, az, ry);
      S.put(mat.leaf, 1.0, 0.34, 0.48, bx, y0 + 0.17, bz, ry);
    }

    /** Hydrant, 5 instanced primitives, existing materials only. */
    function hydrant(x: number, z: number, y0: number): void {
      C.put(PAVE, 0.34, 0.14, 0.34, x, y0 + 0.07, z);
      C.put(MAROON, 0.26, 0.62, 0.26, x, y0 + 0.45, z);
      S.put(MAROON, 0.30, 0.30, 0.30, x, y0 + 0.82, z);
      S.put(mat.chrome, 0.13, 0.13, 0.13, x - 0.17, y0 + 0.52, z);
      S.put(mat.chrome, 0.13, 0.13, 0.13, x + 0.17, y0 + 0.52, z);
      colliders.push(aabbSlab(x, y0, z, 0.4, 1.0, 0.4));
    }

    /** Round vent: concrete curb, steel drum, dark cap. 3 primitives. */
    function vent(x: number, z: number, y0: number): void {
      C.put(PAVE, 0.80, 0.30, 0.80, x, y0 + 0.15, z);
      C.put(mat.steel, 0.62, 0.18, 0.62, x, y0 + 0.39, z);
      C.put(mat.windowDark, 0.50, 0.06, 0.50, x, y0 + 0.51, z);
      colliders.push(aabbSlab(x, y0, z, 0.8, 0.54, 0.8));
    }

    /** Stepping discs, 0.07 proud and walkable. 3 primitives, no collider. */
    function stepDiscs(x: number, z: number, ry: number, y0: number): void {
      for (let i = 0; i < 3; i++) {
        const [dx, dz] = l2w(x, z, ry, (i - 1) * 0.95, (i % 2) * 0.25);
        C.put(PAVE, 0.70, 0.07, 0.70, dx, y0 + 0.035, dz);
      }
    }

    /** Shelter-mound hint: flattened soil mound with a grass cap. */
    function mound(x: number, z: number, y0: number): void {
      S.put(SOIL, 3.4, 0.75, 2.6, x, y0 + 0.18, z);
      S.put(mat.leaf, 2.9, 0.55, 2.2, x, y0 + 0.42, z);
      colliders.push(aabbSlab(x, y0, z, 3.4, 0.7, 2.6));
    }

    /** Trefoil-ish warning board: yellow plate + dark hub on a post, no text. */
    function trefoil(x: number, z: number, ry: number, y0: number): void {
      C.put(IRON, 0.12, 1.70, 0.12, x, y0 + 0.85, z);
      B.put(YEL, 0.52, 0.52, 0.06, x, y0 + 1.62, z, ry);
      B.put(IRON, 0.18, 0.18, 0.10, x, y0 + 1.62, z, ry);
      colliders.push(aabbSlab(x, y0, z, 0.55, 1.9, 0.55));
    }

    /** Blank Security board: twin posts + dark plate. Text skipped - the file's
     *  single signText face is spent on the NOTICE pier. */
    function security(x: number, z: number, ry: number, y0: number): void {
      for (const s of [-1, 1]) {
        const [px, pz] = l2w(x, z, ry, s * 0.55, 0);
        B.put(TIMB, 0.10, 1.50, 0.10, px, y0 + 0.75, pz, ry);
      }
      B.put(mat.windowDark, 1.30, 0.70, 0.06, x, y0 + 1.25, z, ry);
      B.put(TIMB, 1.42, 0.08, 0.10, x, y0 + 1.64, z, ry);
      const [c, t] = rot(ry);
      colliders.push(aabbSlab(x, y0, z, c * 1.42 + t * 0.2, 1.68, t * 1.42 + c * 0.2));
    }

    // West flank, south: curved barrier + NOTICE pier. Moved 3 m north of the
    // first siting: a pre-existing yard tree at (-38.9,-13.0) stood 1.1 m in
    // front of the pier and occluded it entirely (fencechk-barrier.png).
    barrierArc(-42, -10.8, 2.4, surfaceY(-42, -10.8));
    plaquePier(-39.4, -9.7, -0.5, surfaceY(-39.4, -9.7), true);
    // West flank, north: straight barrier + blank pier, ~5 m off the plaza disc.
    barrierStraight(-43, 12.5, 0.35, surfaceY(-43, 12.5));
    plaquePier(-40.3, 13.1, -0.4, surfaceY(-40.3, 13.1), false);
    // West rhythm south: louvre box + bin + planter, 12 m east of the barrier.
    louvreBox(-30, -13, 0.1, surfaceY(-30, -13));
    bin(-27.2, -11.2, surfaceY(-27.2, -11.2));
    planter(-30.4, -9.6, 1.8, 1.3, surfaceY(-30.4, -9.6));
    // West rhythm north: crates + turf rolls, 13 m east of the barrier.
    crates(-30, 13, -0.15, surfaceY(-30, 13));
    turfRolls(-29.4, 16.0, 0.2, surfaceY(-29.4, 16.0));
    stepDiscs(-36.5, 9.5, 0.5, surfaceY(-36.5, 9.5));
    // East flank, north: shelter mound + trefoil + blank Security board. Moved
    // west of the first siting: a pre-existing tree at (31.8,14.3) stood inside
    // the mound footprint and trunk-blocked the whole cluster (fencechk-mound.png).
    mound(27.5, 15.5, surfaceY(27.5, 15.5));
    trefoil(24.3, 16.3, 0.5, surfaceY(24.3, 16.3));
    security(28.6, 18.8, -0.3, surfaceY(28.6, 18.8));
    // East flank, south: planter + bin + hydrant + vent, clear of terrace + bulb.
    planter(32.5, -13.5, 2.0, 1.4, surfaceY(32.5, -13.5));
    bin(35.1, -14.7, surfaceY(35.1, -14.7));
    hydrant(29.6, -12.9, surfaceY(29.6, -12.9));
    vent(31.9, -16.9, surfaceY(31.9, -16.9));
  }

  const batches: [Batch, string][] = [[B, 'surroundBox'], [C, 'surroundCyl'],
    [S, 'surroundSph'], [K, 'surroundCone']];
  for (const [b, tag] of batches) b.flush(g, tag);

  // Nothing moves: compose each matrix once (three r185 recomposes every
  // matrixAutoUpdate node every frame).
  g.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });

  // ---------------------------------------------------------------- keep-out
  // This module is OUT-OF-BOUNDS scenery. A comment further up has claimed since it
  // was written that "the fringe stays west of YARD_X_MIN and east of YARD_X_MAX" -
  // prose, enforced by nothing, and untrue: arcColliders() approximates a curved wall
  // with axis-aligned boxes, and a box fitted to an arc BULGES inward off it. One of
  // those bulges reached x -13.39..-10.91 beside the orange house and sealed the west
  // flanking squeeze - a 0.61 m step, just above the controller's 0.38 m STEP_UP, so
  // it read as an invisible wall rather than as scenery.
  //
  // Clipping is the right repair here and not a cover-up: the arc MESH is outside the
  // play space, so there is nothing to walk through - only its coarse collider
  // approximation was ever inside. Clip in x, drop if nothing survives, and say so.
  const PLAY_X0 = YARD_X_MIN;
  const PLAY_X1 = YARD_X_MAX;
  let clipped = 0;
  let dropped = 0;
  const kept: AABB[] = [];
  for (const c of colliders) {
    const inZ = Math.abs(c.min.z) <= BACK_FENCE || Math.abs(c.max.z) <= BACK_FENCE
      || (c.min.z < 0 && c.max.z > 0);
    if (!inZ || c.max.x <= PLAY_X0 || c.min.x >= PLAY_X1) { kept.push(c); continue; }
    if (c.min.x < PLAY_X0) { c.max.x = Math.min(c.max.x, PLAY_X0); clipped++; kept.push(c); }
    else if (c.max.x > PLAY_X1) { c.min.x = Math.max(c.min.x, PLAY_X1); clipped++; kept.push(c); }
    else { dropped++; }                       // wholly inside the play space
  }
  if (clipped || dropped) {
    console.warn('[surround] %d collider(s) clipped out of the play space, %d dropped '
      + 'entirely. Out-of-bounds scenery must not reach inside x %s..%s.',
      clipped, dropped, PLAY_X0, PLAY_X1);
  }

  return { group: g, colliders: kept };
};
