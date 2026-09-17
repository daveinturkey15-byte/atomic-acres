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

  const batches: [Batch, string][] = [[B, 'surroundBox'], [C, 'surroundCyl'],
    [S, 'surroundSph'], [K, 'surroundCone']];
  for (const [b, tag] of batches) b.flush(g, tag);

  // Nothing moves: compose each matrix once (three r185 recomposes every
  // matrixAutoUpdate node every frame).
  g.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });

  return { group: g, colliders };
};
