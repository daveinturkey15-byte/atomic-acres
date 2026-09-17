/**
 * NUKETOWN 2025 - ENTRANCE PLAZA (the -x open end, beyond the boundary)
 *
 * SPEC s3 / NT05 reads the load screen as a dressed visitor entrance to a "city of
 * the future" show town, not a car park: a teal 1950s classic on a display plinth
 * with an info placard, a maroon 50s car behind it, barrier rope, benches, bins,
 * planters, a ticket kiosk and bunting. skyline.ts already owns the pylon sign, the
 * needle, the hypar, the saucer, the dome and the flag rows out here - this module
 * dresses the GROUND between them and touches none of that.
 *
 * Everything sits between x = BOUND_X_MIN - 2 and the apron's ragged concrete edge.
 * That edge is not a straight line: ground.ts bites 0.6-7.2 m back from APRON_X_MIN,
 * and evaluating its (deterministic) contour puts the -x edge between x = -75.4 near
 * the road and x = -69.9 around z = +16. Nothing that must stand on CONCRETE goes
 * past x = -73; past that is desert, and only poles and pavilions go there.
 *
 * NO COLLIDERS and NO SHADOWS. All of it is outside the playable boundary (the
 * ground module walls the player in) and outside the shadow camera, which world.ts
 * fits to the playable area only - casting here would spend the cascade on nothing.
 */
import * as THREE from 'three';
import type { BuildContext, Builder, BuildResult } from '../core/kit';
import { group, aabbSlab, type AABB } from '../core/kit';
import { PAL } from '../core/palette';
import { BOUND_X_MIN, BOUND_Z, PAVEMENT_OUTER, ROAD_HALF_WIDTH } from '../core/layout';

// ---------------------------------------------------------------- derived frame
const NEAR_X = BOUND_X_MIN - 2;          // nothing here comes nearer the map
const VERGE_Z = ROAD_HALF_WIDTH + 2.6;   // walkway lines; no kerbs exist out here
/** The display line. Measured: at |z| = 12.6 the first capture put the plinth car
 *  exactly behind skyline.ts's flag row (|z| = PAVEMENT_OUTER + 5.5 = 12.7) and six
 *  poles sliced it into strips. Everything on show now stands outside that row. */
const DISPLAY_Z = ROAD_HALF_WIDTH + 12.4;
const DEEP_Z = ROAD_HALF_WIDTH + BOUND_Z * 0.47;   // back of the display apron
/** 50 mm over the base apron (ground.ts puts that at y = 0). The inlay never
 *  reaches the carriageway, which is its own rung at y = 0.030. */
const Y_INLAY = 0.05;
const DAIS_X = BOUND_X_MIN - 8, DAIS_W = 8.6, DAIS_D = 5.8;
const DAIS_TOP = 0.62;                   // deck: deep enough that the kerb reads
const KIOSK_X = BOUND_X_MIN - 6, KIOSK_Z = ROAD_HALF_WIDTH + 5.0;
// radial inlay, +z side: centre and radius clear the ragged concrete edge above
const INLAY_X = BOUND_X_MIN - 9.5, INLAY_Z = ROAD_HALF_WIDTH + 8.0, INLAY_R = 7.0;
// pylon island: foot of skyline.ts's pylon sign (SX/SZ shared seam, do not move)
const ISL_X = BOUND_X_MIN - 12, ISL_Z = -(PAVEMENT_OUTER + 1.6);
const ISL_W = 7.6, ISL_D = 5.6, ISL_H = 0.18;
// entrance-rhythm line on the +z half: continues the verge planter row west of the
// inlay disc, staying clear of BOUND_X_MIN, the flag row and the hypar footprint
const RHY_Z = VERGE_Z + 0.8;

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
  /** axis-aligned primitive: yaw about y, then tilt about its own x */
  put(m: THREE.Material, w: number, h: number, d: number,
      x: number, y: number, z: number, ry = 0, tilt = 0): void {
    _e.set(tilt, ry, 0, 'YXZ');
    this.push(m, _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(w, h, d)));
  }
  /** stretch the unit primitive between two points (rope, cord, wheels) */
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
      im.computeBoundingSphere();
      im.name = tag + n++;
      parent.add(im);
    }
  }
}

/** rotate a local offset into world space about (x, z) by yaw ry */
function l2w(x: number, z: number, ry: number, ox: number, oz: number): [number, number] {
  return [x + ox * Math.cos(ry) + oz * Math.sin(ry), z - ox * Math.sin(ry) + oz * Math.cos(ry)];
}

/** Radial paving inlay as ONE geometry: alternating wedges, so the whole sunburst
 *  is a single draw call. Wound CCW from above so the single face points +y. */
function sunburst(rIn: number, rOut: number, wedges: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const p = (a: number, r: number): number[] => [Math.cos(a) * r, 0, Math.sin(a) * r];
  for (let k = 0; k < wedges; k += 2) {
    const t0 = (k / wedges) * Math.PI * 2, t1 = ((k + 1) / wedges) * Math.PI * 2;
    const a = p(t0, rIn), b = p(t1, rIn), c = p(t1, rOut), d = p(t0, rOut);
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ================================================================= builder
export const buildPlaza: Builder = (ctx: BuildContext): BuildResult => {
  const { mat, rand } = ctx;
  const g = group('plaza');
  const rr = (a: number, b: number): number => a + rand() * (b - a);

  const B = new Batch(new THREE.BoxGeometry(1, 1, 1));
  const C = new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1));
  const S = new Batch(new THREE.IcosahedronGeometry(0.5, 1));
  const P = new Batch(new THREE.ConeGeometry(0.5, 1, 3));   // bunting pennants

  // Signatures reused from the other modules where they match, so the library
  // hands back the SAME singleton rather than compiling another program.
  const pnt = (c: number, r: number, m = 0): THREE.Material => mat.painted(c, r, m);
  const PAVE = pnt(PAL.concreteDark, 0.95), SLAB = pnt(PAL.concrete, 0.95);
  const IRON = pnt(PAL.rooftopDrum, 0.5, 0.35), CREAM = pnt(PAL.coachCream, 0.6, 0.08);
  const TEAL = pnt(PAL.signTeal, 0.55, 0.12), MAROON = pnt(PAL.signMaroon, 0.55, 0.12);
  const TIMB = pnt(PAL.timber, 0.88), SOIL = pnt(PAL.dirt, 1), TYRE = pnt(PAL.asphalt, 0.9);
  const FLAG = pnt(PAL.flagstone, 0.95), WARM = pnt(PAL.pavingWarm, 0.95);
  const STAIN = pnt(PAL.pavingStain, 0.95), BRONZE = pnt(PAL.fenceRail, 0.5, 0.45);
  const CORD = pnt(PAL.timberDark, 0.95);
  const colliders: AABB[] = [];

  // ---------------------------------------------------------------- show car
  /** Blocky 1950s finned saloon, ~4.9 x 1.95 x 1.7 m, authored for a 60 m read:
   *  silhouette, two-tone and brightwork only. Deliberately NOT vehicles.ts - the
   *  street cars are that module's. Local +x is the nose; wheels rest on yBase. */
  function showCar(colour: number, x: number, z: number, ry: number, yBase: number): void {
    const paint = mat.painted(colour, 0.36, 0.34);
    const at = (ox: number, oz: number): [number, number] => l2w(x, z, ry, ox, oz);
    const part = (m: THREE.Material, w: number, h: number, d: number,
                  ox: number, y: number, oz: number): void => {
      const [wx, wz] = at(ox, oz); B.put(m, w, h, d, wx, yBase + y, wz, ry);
    };
    part(paint, 4.9, 0.52, 1.95, 0, 0.60, 0);                  // rocker-to-belt slab
    part(paint, 1.9, 0.30, 1.86, 1.42, 1.00, 0);               // bonnet
    part(paint, 1.5, 0.34, 1.86, -1.66, 1.02, 0);              // boot lid
    // Greenhouse in CREAM: with a body-colour cabin the first capture read as one
    // teal brick at 66 m. Pale cabin over coloured mass is what makes it a car.
    part(CREAM, 2.15, 0.62, 1.74, -0.18, 1.34, 0);             // cabin
    part(mat.windowDark, 1.95, 0.26, 1.80, -0.14, 1.36, 0);    // wraparound glass band
    part(CREAM, 2.25, 0.12, 1.80, -0.22, 1.71, 0);             // roof cap
    for (const s of [-1, 1]) part(paint, 1.25, 0.58, 0.12, -1.85, 1.30, s * 0.9);  // fins
    part(mat.chrome, 3.5, 0.07, 2.0, 0.1, 0.86, 0);            // side spear
    part(mat.chrome, 0.24, 0.20, 1.98, 2.36, 0.52, 0);         // front bumper
    part(mat.chrome, 0.24, 0.20, 1.92, -2.36, 0.54, 0);        // rear bumper
    part(mat.chrome, 0.12, 0.26, 1.45, 2.40, 0.80, 0);         // grille
    for (const s of [-1, 1]) {
      const [hx, hz] = at(2.38, s * 0.62);
      S.put(mat.chrome, 0.28, 0.28, 0.28, hx, yBase + 0.82, hz);
    }
    // wheels as hub-to-hub spans, so one instanced cylinder covers every car
    for (const ax of [1.55, -1.55]) for (const s of [-1, 1]) {
      const [ix, iz] = at(ax, s * 0.80), [ox, oz] = at(ax, s * 0.97);
      C.span(TYRE, 0.36, ix, yBase + 0.36, iz, ox, yBase + 0.36, oz);
    }
  }

  // ------------------------------------------------------------- rope barrier
  /** Stanchions on a superellipse - it clears a rectangular dais at the corners
   *  where an ellipse would cut inside it - with rope draped between them. */
  function ropeRing(cx: number, cz: number, rx: number, rz: number, n: number): void {
    const pt = (i: number): [number, number] => {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      return [cx + rx * Math.sign(c) * Math.abs(c) ** 0.6,
        cz + rz * Math.sign(s) * Math.abs(s) ** 0.6];
    };
    for (let i = 0; i < n; i++) {
      const [px, pz] = pt(i);
      const [qx, qz] = pt(i + 1);
      C.put(IRON, 0.10, 0.90, 0.10, px, 0.45, pz);
      S.put(mat.chrome, 0.19, 0.19, 0.19, px, 0.95, pz);
      let lx = px, ly = 0.84, lz = pz;
      for (let k = 1; k <= 3; k++) {
        const u = k / 3;
        const nx = px + (qx - px) * u, nz = pz + (qz - pz) * u;
        const ny = 0.84 - 0.17 * Math.sin(Math.PI * u);
        C.span(MAROON, 0.035, lx, ly, lz, nx, ny, nz);
        lx = nx; ly = ny; lz = nz;
      }
    }
  }

  // ---------------------------------------------------------------- 1. the plinth
  // The NT05 centrepiece: a low kerbed concrete dais with the teal classic on it.
  {
    // dark kerb, pale deck: the kerb is the line that makes it read as a plinth
    B.put(PAVE, DAIS_W, 0.46, DAIS_D, DAIS_X, 0.23, -DISPLAY_Z);
    B.put(SLAB, DAIS_W - 0.7, DAIS_TOP, DAIS_D - 0.7, DAIS_X, DAIS_TOP / 2, -DISPLAY_Z);
    showCar(PAL.carTeal, DAIS_X, -DISPLAY_Z, 0.62, DAIS_TOP);
    // rope stays inside |z| 13.1 and x -67.9..-56.1: clear of the flag row, and of
    // BOUND_X_MIN, which nothing here may cross
    ropeRing(DAIS_X, -DISPLAY_Z, DAIS_W / 2 + 1.6, DAIS_D / 2 + 1.0, 14);

    // Angled placard on a post, reading back down the street (+x), outside the
    // rope at the FAR corner: at the near corner it stood in front of the exhibit.
    const px = DAIS_X + DAIS_W / 2 + 1.0;
    const pz = -DISPLAY_Z - DAIS_D / 2 - 0.9;
    C.put(IRON, 0.12, 1.30, 0.12, px, 0.65, pz);
    B.put(CREAM, 1.32, 0.90, 0.10, px, 1.40, pz, Math.PI / 2, -0.5);
    B.put(TEAL, 1.12, 0.72, 0.12, px + 0.04, 1.41, pz, Math.PI / 2, -0.5);
    for (const [dy, w] of [[0.16, 0.86], [0.01, 0.62]]) {
      B.put(CREAM, w, 0.09, 0.14, px + 0.07, 1.41 + dy, pz, Math.PI / 2, -0.5);
    }
  }

  // ---------------------------------------------------------------- 2. second car
  // "a maroon 50s car behind it" - on the apron, no plinth, its own short rope run.
  {
    // x = -61 keeps car and rope clear of the skyline hypar's footprint (centre
    // -68 / -28.5, a 10.6 m half-diagonal diamond once it is yawed 45 deg)
    const x = BOUND_X_MIN - 7;
    showCar(PAL.coachMaroon, x, -DEEP_Z, -0.38, 0);
    ropeRing(x, -DEEP_Z, 4.4, 3.2, 10);
  }

  // ---------------------------------------------------------------- 3. paving inlay
  // A radial sunburst on the +z half so the plaza floor is not one blank slab. Two
  // draw calls, dead flat, 50 mm proud of the apron (see Y_INLAY). Wedges in
  // PAL.steel, not concreteDark: a 15% tonal step vanished at a 2 degree grazing
  // angle. It reads from the AERIAL station; from eye level it is a 5 px band.
  {
    const burst = new THREE.Mesh(sunburst(INLAY_R * 0.32, INLAY_R, 20),
      mat.painted(PAL.steel, 0.95, 0));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(INLAY_R * 0.3, 28), TEAL);
    disc.rotation.x = -Math.PI / 2;
    for (const m of [burst, disc]) { m.position.set(INLAY_X, Y_INLAY, INLAY_Z); g.add(m); }
  }

  // ---------------------------------------------------------------- 4. kiosk
  // Retro ticket / information booth: glazed front under a deep teal canopy.
  {
    const kx = KIOSK_X, kz = KIOSK_Z;
    B.put(PAVE, 4.0, 0.18, 3.6, kx, 0.09, kz);                       // plinth
    B.put(mat.painted(PAL.capsuleWhite, 0.5, 0.05), 3.3, 2.5, 2.9, kx, 1.43, kz);
    B.put(mat.glass, 0.12, 1.45, 2.4, kx + 1.66, 1.62, kz);          // glazed front
    B.put(mat.chrome, 0.55, 0.10, 2.5, kx + 1.88, 1.00, kz);         // counter shelf
    B.put(TEAL, 5.0, 0.26, 4.4, kx + 0.55, 3.05, kz);                // canopy
    B.put(mat.emissive(PAL.signMaroon, 1.1), 0.14, 0.52, 2.2, kx + 2.98, 2.58, kz);
    for (const s of [-1, 1]) C.put(mat.steel, 0.12, 2.92, 0.12, kx + 2.9, 1.46, kz + s * 1.9);
    // sign blade over the canopy - the only thing on the +z half with any height,
    // and what stops the kiosk disappearing into the pale band at 65 m
    B.put(CREAM, 0.18, 2.0, 1.9, kx + 1.6, 4.18, kz);
    B.put(mat.emissive(PAL.signTeal, 1.2), 0.22, 1.5, 1.4, kx + 1.6, 4.18, kz);
    S.put(MAROON, 0.62, 0.62, 0.62, kx + 1.6, 5.35, kz);             // finial
  }

  // ---------------------------------------------------------------- 5. furniture
  function bench(x: number, z: number, face: number): void {
    B.put(TIMB, 1.9, 0.10, 0.54, x, 0.46, z);
    B.put(TIMB, 1.9, 0.40, 0.09, x, 0.74, z - face * 0.24);
    for (const s of [-1, 1]) B.put(IRON, 0.09, 0.44, 0.50, x + s * 0.78, 0.22, z);
  }
  function bin(x: number, z: number): void {
    C.put(TEAL, 0.56, 0.86, 0.56, x, 0.43, z);
    C.put(mat.chrome, 0.62, 0.09, 0.62, x, 0.90, z);
  }
  function planter(x: number, z: number): void {
    B.put(SLAB, 1.7, 0.66, 1.7, x, 0.33, z);
    B.put(SOIL, 1.5, 0.06, 1.5, x, 0.68, z);
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2, d = rr(0, 0.45), q = rr(0.5, 0.85);
      S.put(mat.leaf, q * 2, q * 1.7, q * 2,
        x + Math.cos(a) * d, 0.70 + q * 0.72, z + Math.sin(a) * d);
    }
    colliders.push(aabbSlab(x, 0, z, 1.7, 0.75, 1.7));
  }
  // Rows along both edges, stopping before the ragged concrete edge: a bench
  // standing in open sand reads as a mistake.
  {
    for (const [side, x0, n] of [[-1, 3, 6], [1, 11, 3]] as const) {
      for (let i = 0; i < n; i++) {
        const x = BOUND_X_MIN - x0 - i * 3.5 - rr(0, 0.5);
        const z = side < 0 ? -VERGE_Z : VERGE_Z + 0.8;
        if (i % 3 === 0) bench(x, z, -side);
        else if (i % 3 === 1) bin(x, z);
        else planter(x, z);
      }
    }
    planter(BOUND_X_MIN - 9.5, VERGE_Z + 0.8);        // flanking the kiosk
  }

  // ---------------------------------------------------------------- 6. bunting
  // Pennant strings on slim masts. The -z run stops at x = -64 on purpose: the
  // skyline's pylon sign panel hangs from y = 5 at x = -66.5 and a garland would
  // pass straight through it.
  {
    const MAST_Y = 6.8, SAG = 1.4;
    const masts: [number, number][] = [
      [NEAR_X - 0.5, -(ROAD_HALF_WIDTH + 5.9)], [NEAR_X - 0.5, ROAD_HALF_WIDTH + 5.9],
      [BOUND_X_MIN - 10, -(ROAD_HALF_WIDTH + 5.9)],
      [BOUND_X_MIN - 14, ROAD_HALF_WIDTH + 5.9],
      [BOUND_X_MIN - 25.5, ROAD_HALF_WIDTH + 5.9],
    ];
    for (const [mx, mz] of masts) {
      C.put(mat.steel, 0.14, MAST_Y, 0.14, mx, MAST_Y / 2, mz);
      S.put(MAROON, 0.34, 0.34, 0.34, mx, MAST_Y + 0.17, mz);
    }
    const cols = [MAROON, TEAL, CREAM];
    let flag = 0;
    for (const [a, b] of [[0, 1], [0, 2], [1, 3], [3, 4]] as const) {
      const [ax, az] = masts[a], [bx, bz] = masts[b];
      const len = Math.hypot(bx - ax, bz - az);
      const segs = Math.max(8, Math.round(len / 1.4));
      const yAt = (u: number): number => MAST_Y - 0.2 - SAG * Math.sin(Math.PI * u);
      for (let k = 0; k < segs; k++) {
        const u0 = k / segs, u1 = (k + 1) / segs, um = (u0 + u1) / 2;
        C.span(CORD, 0.03, ax + (bx - ax) * u0, yAt(u0), az + (bz - az) * u0,
          ax + (bx - ax) * u1, yAt(u1), az + (bz - az) * u1);
        // apex down: tilt PI flips the cone, so its base sits on the cord
        P.put(cols[flag++ % 3], 0.42, 0.46, 0.42,
          ax + (bx - ax) * um, yAt(um) - 0.23, az + (bz - az) * um, rand() * 3, Math.PI);
      }
    }
  }

  // ---------------------------------------------------------------- 7. pavilions
  // skyline.ts only closes the -x side past |z| = 28, so the corridor straight
  // down the street was still bare from x = -76 out. Four low show pavilions fill
  // it - NOT that pale ring repeated: each carries a coloured roof band, which is
  // what separates them at 85 m. All clear the needle plinth (-98 / +17.1, r 15.5).
  {
    const WALLP = mat.painted(PAL.thirdWall, 0.9, 0);
    const spots: [number, number, number, THREE.Material][] = [
      [BOUND_X_MIN - 24, BOUND_Z * 0.45, 11, TEAL],
      [BOUND_X_MIN - 30, BOUND_Z * 0.70, 14, MAROON],
      [BOUND_X_MIN - 26, -BOUND_Z * 0.52, 13, MAROON],
      [BOUND_X_MIN - 36, -BOUND_Z * 0.70, 15, TEAL],
    ];
    for (const [x, z, w, roof] of spots) {
      const h = rr(4.2, 5.8), d = rr(8, 12);
      B.put(WALLP, w, h, d, x, h / 2, z);
      B.put(roof, w + 1.2, 0.5, d + 1.2, x, h + 0.25, z);
    }
  }

  // ---------------------------------------------------------------- 8. pylon island
  // Paved pad at the foot of skyline.ts's pylon sign (SX/SZ seam, do not move):
  // flagstone deck with a pavingStain kerb, a maroon/teal base plinth echoing the
  // sign bands, a small atom-motif sculpture, and two bronze interpretive boards
  // with illegible body lines (in-world text in the same spirit, never a copy).
  // Planter pair at the west corners; the centre strip stays open so a mannequin
  // vignette at the base never blocks the pad. Pad edge |z| >= 5.0: clear of the
  // carriageway (|z| < ROAD_HALF_WIDTH).
  {
    B.put(FLAG, ISL_W, ISL_H, ISL_D, ISL_X, ISL_H / 2, ISL_Z);
    B.put(WARM, ISL_W - 1.4, 0.03, ISL_D - 1.4, ISL_X, ISL_H + 0.005, ISL_Z);
    colliders.push(aabbSlab(ISL_X, 0, ISL_Z, ISL_W, ISL_H, ISL_D));
    // kerb ring: long sides overlap the short sides at the corners
    for (const s of [-1, 1]) {
      B.put(STAIN, ISL_W + 0.6, 0.24, 0.3, ISL_X, 0.12, ISL_Z + s * (ISL_D / 2 + 0.15));
      B.put(STAIN, 0.3, 0.24, ISL_D, ISL_X + s * (ISL_W / 2 + 0.15), 0.12, ISL_Z);
    }
    // maroon base plinth with a teal cap band, under the sign between its legs
    const bx = ISL_X - 0.6;
    B.put(MAROON, 4.6, 0.85, 2.6, bx, ISL_H + 0.425, ISL_Z);
    B.put(TEAL, 4.8, 0.16, 2.8, bx, ISL_H + 0.93, ISL_Z);
    colliders.push(aabbSlab(bx, ISL_H, ISL_Z, 4.8, 1.01, 2.8));
    // atom motif: maroon nucleus on a steel mast over the cap, teal orbit chord
    // ring (an octagon of spans - no new geometry) with two cream electrons
    const ax = bx, az = ISL_Z, ay = ISL_H + 2.35;
    C.put(mat.steel, 0.12, 1.35, 0.12, ax, ISL_H + 1.0 + 0.675, az);
    S.put(MAROON, 1.1, 1.1, 1.1, ax, ay, az);
    const tilt = 0.5, ro = 1.0;
    const op = (t: number): [number, number, number] => [
      ax + Math.cos(t) * ro, ay + Math.sin(t) * ro * Math.sin(tilt),
      az + Math.sin(t) * ro * Math.cos(tilt)];
    for (let k = 0; k < 8; k++) {
      const [x0, y0, z0] = op((k / 8) * Math.PI * 2);
      const [x1, y1, z1] = op(((k + 1) / 8) * Math.PI * 2);
      C.span(TEAL, 0.035, x0, y0, z0, x1, y1, z1);
    }
    for (const t of [0.6, 2.7]) {
      const [ex, ey, ez] = op(t);
      S.put(CREAM, 0.22, 0.22, 0.22, ex, ey, ez);
    }
    // interpretive boards: 0.6 x 0.9 m bronze-look panels on posts at the east
    // edge, facing back down the street (+x); three pale lines stand in for the
    // illegible body text
    for (const s of [-1, 1]) {
      const px = ISL_X + 2.7, pz = ISL_Z + s * 1.3;
      C.put(IRON, 0.1, 1.0, 0.1, px, 0.5, pz);
      B.put(BRONZE, 0.62, 0.92, 0.08, px, 1.15, pz, Math.PI / 2, -0.3);
      for (let k = 0; k < 3; k++) {
        B.put(CREAM, 0.44 - k * 0.06, 0.07, 0.1, px + 0.05, 1.28 - k * 0.2, pz, Math.PI / 2, -0.3);
      }
      colliders.push(aabbSlab(px, 0, pz, 0.5, 1.5, 0.9));
    }
    planter(ISL_X - 2.5, ISL_Z - 1.8);
    planter(ISL_X - 2.5, ISL_Z + 1.8);
  }

  // ---------------------------------------------------------------- 9. entrance rhythm
  // Planter / AC-louvred-box / twin-head-plinth + placard stations continuing the
  // verge row west past the kiosk on the +z half. All west of the inlay disc
  // (KIOSK_X offsets clear its radius), south of the flag row (|z| = 12.7) and on
  // the +z half, so the hypar footprint (-z) is never touched. The plinths carry
  // paired steel stubs: footings a twin-head column can reuse, not columns
  // themselves (columns are the ground lane's).
  {
    const acBox = (x: number, z: number): void => {
      B.put(SLAB, 1.7, 0.16, 1.1, x, 0.08, z);
      B.put(PAVE, 1.5, 0.95, 0.9, x, 0.635, z);
      for (let k = 0; k < 4; k++) {
        B.put(IRON, 1.54, 0.07, 0.05, x, 0.42 + k * 0.18, z + 0.45);
      }
      colliders.push(aabbSlab(x, 0, z, 1.7, 1.15, 1.1));
    };
    const lampPlinth = (x: number, z: number): void => {
      B.put(SLAB, 1.0, 0.5, 1.0, x, 0.25, z);
      for (const s of [-1, 1]) C.put(mat.steel, 0.09, 0.35, 0.09, x + s * 0.22, 0.675, z);
      colliders.push(aabbSlab(x, 0, z, 1.0, 0.85, 1.0));
    };
    const placard = (x: number, z: number): void => {
      C.put(IRON, 0.1, 1.1, 0.1, x, 0.55, z);
      B.put(CREAM, 0.85, 0.6, 0.08, x, 1.25, z - 0.05, 0, -0.35);
      B.put(TEAL, 0.7, 0.12, 0.1, x, 1.42, z - 0.08, 0, -0.35);
      B.put(STAIN, 0.6, 0.07, 0.1, x, 1.2, z - 0.03, 0, -0.35);
      B.put(STAIN, 0.44, 0.07, 0.1, x, 1.06, z - 0.01, 0, -0.35);
    };
    for (const dx of [12, 16, 20]) {
      const x = KIOSK_X - dx;
      planter(x - 2.9, RHY_Z);
      acBox(x, RHY_Z);
      lampPlinth(x + 2.9, RHY_Z);
      placard(x + 2.9, RHY_Z - 1.15);
    }
  }

  B.flush(g, 'plazaBox');
  C.flush(g, 'plazaCyl');
  S.flush(g, 'plazaSph');
  P.flush(g, 'plazaPennant');

  // Outside the boundary AND the shadow camera: no shadows either way, and nothing
  // moves, so compose each matrix once and stop the renderer redoing it per frame.
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.castShadow = mesh.receiveShadow = false;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });

  return { group: g, colliders };
};
