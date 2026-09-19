/**
 * NUKETOWN 2025 - PERIMETER: the line that closes the map, and the test site beyond it.
 *
 * OWNER BRIEF (2026-09-18): "Make the borders of the map much clearer rather than any
 * kind of invisible walls." The rule this file is built to: **every collider that stops
 * a player has a visible reason at eye height.**
 *
 * ---------------------------------------------------------------- what was here before
 * This file used to hold three "places" on the paved flanks - a fountain plaza, a shaded
 * terrace and a planted walk - plus a fringe of street cover. All of it was authored
 * against the PRE-2026-09-18 proportions, when the flanks were 20 m wide. The minimap
 * re-proportioning moved YARD_X to +/-14.8 and BOUND_X to -19.5 / +25, and every one of
 * those places is derived from YARD_X / BOUND_X - so they all slid INTO the map:
 *
 *   fountain plaza   centre (-17.15, 26.2) r 7.9  -> 5.5 x 7.5 m of it inside the WHITE
 *                    house's back yard; the basin kerb reached x -12.85, 1.95 m inside
 *   shaded terrace   centre (12.0, -26.2) 11 x 8.2 -> the whole ORANGE east flank, with
 *                    a 1.39 m retaining wall running x 6.7..17.3 across the back yard
 *   planted walk     an 11 m x 0.9 m wall at z -24.5 laid across the ORANGE west squeeze
 *   fringe           every piece hard-coded at |x| 24..43, i.e. out in the desert past
 *                    the boundary shell, or inside plaza.ts's ground
 *
 * The keep-out clip at the old return hid the damage from the collision world but not
 * from the renderer: it clipped the COLLIDERS to the play-space edge and left the MESHES
 * where they were, so the fountain basin, the terrace deck and the retaining wall were
 * walk-through geometry standing in two other lanes' regions. Measured 2026-09-18 from
 * __NT.collidersAt: 10 surround colliders ended exactly on x = +/-14.80, which is the
 * signature of a clip, not of a design. base0-aerial.png and base0-yardWhite.png show
 * the fountain sitting in the white house's lawn.
 *
 * None of it is recoverable at the new scale - the west flank is now 4.7 m wide and the
 * east 10.2 m - so it is gone rather than shuffled, and this file does the one job the
 * out-of-bounds band actually needs.
 *
 * ---------------------------------------------------------------- the measured problem
 * ground.ts section 10 closes the map with four 12 m tall collider slabs and shows a
 * 0.55 m berm. Inner faces, read back from the live collision world:
 *
 *   west   x = -19.50      east  x = +25.00      north / south  |z| = 42.00
 *
 * paths.mjs floods the whole band inside those faces as REACHABLE: the 4.7 m strip
 * between the yard edge (-14.8) and the west shell, and the 5 m strip behind both back
 * fences (which yards.ts punches gameplay holes through). The east is already closed at
 * x = 16.6 by the yards boundary fence, and that one is visible. So the invisible walls
 * were: the whole west face outside the road gate, and both back faces.
 *
 * ---------------------------------------------------------------- what this builds
 *   1. A test-site SECURITY FENCE - concrete plinth, hazard band, steel palisade, posts,
 *      cranked top strands, RESTRICTED boards facing in - standing STANDOFF metres inside
 *      the hard shell on the west face and on both back faces. Its own collider is what
 *      stops the player, 0.55 m before the shell, so the shell is now only a backstop and
 *      is never the thing you touch.
 *   2. The WEST ROAD CLOSURE: two stone wing piers carrying TEST SITE / NO ENTRY boards
 *      behind the existing steel gate (ground.ts section 13), plus a staggered jersey
 *      barrier row across the carriageway beyond it. The road is visibly continued and
 *      visibly shut.
 *   3. The EAST APRON END: a jersey barrier row and a hazard board across the carriageway
 *      at x = 16.1, in front of the yards boundary fence, so the road ends as a closed
 *      road and not as a garden fence.
 *   4. TEST SITE dressing beyond the fence - container rows, crate stacks, drums, spoil
 *      mounds, floodlight masts - so looking out through the palisade reads as the plant
 *      the town was built to test, not as white nothing.
 *
 * Nothing in 4 gets a collider: it all stands outside the hard shell, exactly as
 * plaza.ts's out-of-bounds dressing does. Nothing in 4 casts or receives a shadow - the
 * cascade is a 96 m square fitted to the playable area and this would only waste it.
 *
 * ---------------------------------------------------------------- region discipline
 * This lane owns |x| >= YARD_X_MAX where |z| > PAVEMENT_OUTER, x <= BOUND_X_MIN,
 * x >= ROAD_X_MAX, and |z| >= BACK_FENCE. inMyRegion() below encodes exactly that and
 * every primitive is checked against it at build time, so the failure that produced the
 * fountain-in-the-lawn cannot recur silently: it prints a count and the worst offender.
 */
import * as THREE from 'three';
import type { AABB, BuildContext, Builder, BuildResult } from '../core/kit';
import { aabbSlab, group } from '../core/kit';
import { PAL } from '../core/palette';
import {
  BACK_FENCE, BOUND_X_MAX, BOUND_X_MIN, BOUND_Z, PAVEMENT_OUTER,
  ROAD_HALF_WIDTH, ROAD_X_MAX, YARD_X_MAX,
} from '../core/layout';

// ---------------------------------------------------------------- derived frame
/**
 * How far INSIDE the hard shell the visible barrier stands. It has to be more than the
 * barrier's own half-thickness or the shell would still be the first thing you hit, and
 * small enough that no playable ground is lost. 0.55 m puts the palisade face 0.32 m
 * proud of the shell.
 */
const STANDOFF = 0.55;
/** West barrier centre-line, and the two back barrier centre-lines. */
const WEST_X = BOUND_X_MIN + STANDOFF;          // -18.95
const BACK_Z = BOUND_Z - STANDOFF;              //  41.45
/**
 * The east face needs no barrier of mine: yards.ts already runs a 2.1 m boarded fence
 * the full length of the map at ROAD_X_MAX + 0.6 and it is visible. This is a LOCAL
 * duplicate of that file's BOUNDARY_X, used only to know where my runs must stop and
 * where the apron closure goes - it is not a new dimension and not a new decision.
 */
const EAST_FENCE_X = ROAD_X_MAX + 0.6;          //  16.6
/**
 * Where the west runs start. PAVEMENT_OUTER is the region edge itself, so the run has
 * to begin a hair outside it or its end cap sits exactly on the line.
 */
const WEST_RUN_Z0 = PAVEMENT_OUTER + 0.12;      //   7.12 (clears the end post's 0.075)
/** Carriageway closure lines. */
const GATE_PIER_X = BOUND_X_MIN - 0.62;         // -20.12, pier face clears -19.5
const JERSEY_WEST_X = BOUND_X_MIN - 1.5;        // -21.0, clear of plaza.ts's NEAR_X
/**
 * East apron end. yards.ts's boarded boundary fence occupies x 16.29..16.91, and this
 * lane's region starts at ROAD_X_MAX, so there are exactly 0.29 m of my ground in front
 * of it. Everything I put across the carriageway has to fit in that slot - see the
 * closure block for what that cost.
 */
const APRON_STOP_X = ROAD_X_MAX + 0.14;         //  16.14

// ---------------------------------------------------------------- fence section
const PLINTH_H = 0.34;
const PLINTH_W = 0.46;
const PALI_H = 2.42;                            // palisade above the plinth
const FENCE_TOP = PLINTH_H + PALI_H;            // 2.76
const STRAND_TOP = FENCE_TOP + 0.34;            // cranked top strands
const BAR_PITCH = 0.235;
const BAR_W = 0.055;
const POST_PITCH = 2.5;
const POST_W = 0.15;
/** Collider depth: plinth plus the boards bolted to the map face, so the box is honest. */
const RUN_T = 0.66;
/** A face moved this far off a plane it shared with another part is out of the depth tie. */
const TUCK = 0.005;

// ---------------------------------------------------------------- region guard
/**
 * The perimeter lane's coordinate region, stated as code. A point is mine if it is
 * outside the yard band with the street excluded, or beyond either road end, or behind
 * a back fence. Everything else belongs to the interiors or dressing lanes.
 */
function inMyRegion(x: number, z: number): boolean {
  if (Math.abs(x) >= YARD_X_MAX && Math.abs(z) > PAVEMENT_OUTER) return true;
  if (x <= BOUND_X_MIN) return true;
  if (x >= ROAD_X_MAX) return true;
  return Math.abs(z) >= BACK_FENCE;
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
  constructor(private geo: THREE.BufferGeometry, private shadows: boolean) {}
  put(m: THREE.Material, w: number, h: number, d: number,
      x: number, y: number, z: number, ry = 0): void {
    checkRegion(x, z, Math.abs(Math.cos(ry)) * w + Math.abs(Math.sin(ry)) * d,
      Math.abs(Math.sin(ry)) * w + Math.abs(Math.cos(ry)) * d);
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
      im.castShadow = im.receiveShadow = this.shadows;
      im.computeBoundingSphere();
      im.name = tag + n++;
      parent.add(im);
    }
  }
}

// Region violations are collected, not thrown: a builder that throws takes the whole
// map down (main.ts catches and skips the module). A count plus the worst offender is
// what a lane actually needs to fix it.
let strayCount = 0;
let strayWorst = 0;
let strayAt: [number, number] = [0, 0];
function checkRegion(x: number, z: number, w: number, d: number): void {
  let worst = 0;
  for (const sx of [-0.5, 0.5]) {
    for (const sz of [-0.5, 0.5]) {
      const px = x + sx * w, pz = z + sz * d;
      if (inMyRegion(px, pz)) continue;
      // how far inside the play space this corner reaches, in the shallower axis
      const dx = Math.max(0, YARD_X_MAX - Math.abs(px));
      const dz = Math.max(0, PAVEMENT_OUTER - Math.abs(pz));
      worst = Math.max(worst, Math.max(dx, dz));
    }
  }
  if (worst <= 0) return;
  strayCount++;
  if (worst > strayWorst) { strayWorst = worst; strayAt = [x, z]; }
}

// ================================================================= builder
export const buildSurround: Builder = (ctx: BuildContext): BuildResult => {
  const { mat, rand } = ctx;
  const g = group('surround');
  const colliders: AABB[] = [];
  const rr = (a: number, b: number): number => a + rand() * (b - a);
  strayCount = 0; strayWorst = 0; strayAt = [0, 0];

  const unit = new THREE.BoxGeometry(1, 1, 1);
  /** In-reach: the barrier line itself, inside the shadow cascade, so it casts. */
  const B = new Batch(unit, true);
  /** Out-of-reach: everything beyond the shell. No shadows, per plaza.ts's contract. */
  const F = new Batch(unit, false);
  const FC = new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1), false);
  const FS = new Batch(new THREE.IcosahedronGeometry(0.5, 1), false);

  const CONC = mat.painted(PAL.concreteDark, 0.95, 0);
  const PALE = mat.painted(PAL.concrete, 0.95, 0);
  const STONE = mat.painted(PAL.rubbleStone, 0.95, 0);
  const HAZ = mat.painted(PAL.hazardYellow, 0.7, 0.05);
  const IRON = mat.painted(PAL.rooftopDrum, 0.55, 0.35);
  const RUST = mat.painted(PAL.trailerTrim, 0.9, 0.05);
  const CRATE = mat.painted(PAL.timber, 0.92, 0);
  const SOIL = mat.painted(PAL.dirt, 1, 0);
  const CONTAINER = [
    mat.painted(PAL.signTeal, 0.85, 0.06),
    mat.painted(PAL.coachCream, 0.85, 0.04),
    mat.painted(PAL.trailerTrim, 0.85, 0.05),
  ];

  // Three sign faces for the whole module. Each signText is its own canvas texture, so
  // they are spent deliberately: two on the road closures, one repeated along the fence.
  const SIGN_TEST = mat.signText({
    text: 'TEST SITE', color: PAL.signMaroon, background: PAL.coachCream, aspect: 3.2,
  });
  const SIGN_NOENTRY = mat.signText({
    text: 'NO ENTRY', color: PAL.coachCream, background: PAL.signMaroon, aspect: 3.4,
  });
  const SIGN_RESTRICT = mat.signText({
    text: 'RESTRICTED', color: PAL.busBlack, background: PAL.hazardYellow, aspect: 2.6,
  });

  /** rotate a local offset into world space about (x, z) by yaw ry */
  const l2w = (x: number, z: number, ry: number, ox: number, oz: number): [number, number] =>
    [x + ox * Math.cos(ry) + oz * Math.sin(ry), z - ox * Math.sin(ry) + oz * Math.cos(ry)];

  // ======================================================== 1. the security fence
  /**
   * One straight axis-aligned run of test-site fence, A to B, with `facing` giving the
   * map side (+1 or -1 along the run's normal) so the boards and the hazard band face
   * the player rather than the desert.
   *
   * ONE collider for the whole run. The run is axis-aligned and continuous, so a single
   * AABB is exactly the mesh - segmenting it would only multiply boxes that describe the
   * same wall. It spans the plinth and the boards (RUN_T), so nothing sticks out of it.
   */
  function securityRun(ax: number, az: number, bx: number, bz: number, facing: 1 | -1, trimA = 0): void {
    // The collider is the NOMINAL run A -> B. The meshes start `trimA` metres in from A:
    // the two back runs begin on the west run's corner, and untrimmed their plinth,
    // capping, rails and strands all reached into the corner square the west run
    // already fills - the same six faces built twice there.
    const LC = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / LC, uz = (bz - az) / LC;
    const ry = Math.atan2(ux, uz);          // run direction -> local +z (yards.ts's convention)
    const kx = (ax + bx) / 2, kz = (az + bz) / 2;
    ax += ux * trimA; az += uz * trimA;
    const L = LC - trimA;
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    /** local +x is the run's normal; `facing` points it at the map */
    const nx = -uz * facing, nz = ux * facing;

    B.put(CONC, PLINTH_W, PLINTH_H, L, cx, PLINTH_H / 2, cz, ry);
    B.put(PALE, PLINTH_W + 0.10, 0.08, L, cx, PLINTH_H + 0.04, cz, ry);   // capping course

    // hazard band: short yellow blocks on the map face of the plinth, 1.15 m pitch
    const hazN = Math.max(2, Math.round(L / 1.15));
    for (let i = 0; i < hazN; i++) {
      const t = ((i + 0.5) / hazN) * L - L / 2;
      B.put(HAZ, 0.05, 0.19, 0.52,
        cx + ux * t + nx * (PLINTH_W / 2), PLINTH_H * 0.52, cz + uz * t + nz * (PLINTH_W / 2), ry);
    }

    // palisade bars: the thing that makes it read as a security fence and not a wall,
    // and see-through, which the west face needs - the plaza, the pylon sign and the
    // needle all sit behind it and are the vista from the turning head.
    const barN = Math.max(2, Math.floor(L / BAR_PITCH));
    for (let i = 0; i < barN; i++) {
      const t = ((i + 0.5) / barN) * L - L / 2;
      B.put(IRON, BAR_W, PALI_H, BAR_W, cx + ux * t, PLINTH_H + PALI_H / 2, cz + uz * t, ry);
    }
    // three rails behind the bars, then posts proud of everything
    for (const y of [PLINTH_H + 0.28, PLINTH_H + PALI_H * 0.55, PLINTH_H + PALI_H - 0.12]) {
      B.put(IRON, 0.07, 0.11, L, cx - nx * 0.06, y, cz - nz * 0.06, ry);
    }
    const postN = Math.max(2, Math.round(L / POST_PITCH));
    for (let i = 0; i <= postN; i++) {
      const t = (i / postN) * L - L / 2;
      const px = cx + ux * t, pz = cz + uz * t;
      B.put(IRON, POST_W, PALI_H + 0.16, POST_W, px, PLINTH_H + (PALI_H + 0.16) / 2, pz, ry);
      // cranked arm leaning AWAY from the map, carrying three strands
      B.put(IRON, 0.08, 0.42, 0.08, px - nx * 0.12, FENCE_TOP + 0.21, pz - nz * 0.12, ry);
    }
    for (let k = 0; k < 3; k++) {
      B.put(IRON, 0.045, 0.045, L,
        cx - nx * (0.06 + k * 0.07), FENCE_TOP + 0.12 + k * 0.11, cz - nz * (0.06 + k * 0.07), ry);
    }

    // RESTRICTED boards on the map face, ~17 m apart, plus one at each end
    const signN = Math.max(1, Math.round(L / 17));
    for (let i = 0; i <= signN; i++) {
      const t = (i / signN) * (L - 3.0) - (L - 3.0) / 2;
      B.put(SIGN_RESTRICT, 0.04, 0.42, 1.09,
        cx + ux * t + nx * (PLINTH_W / 2 + 0.06), 1.62, cz + uz * t + nz * (PLINTH_W / 2 + 0.06), ry);
    }

    colliders.push(aabbSlab(kx, 0, kz,
      Math.abs(ux) * LC + Math.abs(uz) * RUN_T, FENCE_TOP,
      Math.abs(uz) * LC + Math.abs(ux) * RUN_T));
  }

  // West face, both sides of the road mouth. Stops at the pavement edge, which is where
  // the region ends and where the gate's wing piers take over.
  securityRun(WEST_X, -BACK_Z, WEST_X, -WEST_RUN_Z0, 1);
  securityRun(WEST_X, WEST_RUN_Z0, WEST_X, BACK_Z, 1);
  // Both back faces, running from the west line to the yards boundary fence.
  securityRun(WEST_X, -BACK_Z, EAST_FENCE_X, -BACK_Z, 1, PLINTH_W / 2 + POST_W / 2);
  securityRun(WEST_X, BACK_Z, EAST_FENCE_X, BACK_Z, -1, PLINTH_W / 2 + POST_W / 2);

  // ======================================================== 2. west road closure
  // The steel gate across the carriageway is ground.ts section 13 at x = -19.35. These
  // are the wing piers either side of it, the two boards it is read against, and the
  // barrier row beyond - all at x <= BOUND_X_MIN, so nothing of mine enters the street
  // band the dressing lane owns. The gate is open-barred, so everything here reads
  // THROUGH it from the turning head.
  {
    const PIER_H = 4.6, PIER_W = 0.9, PIER_Z = ROAD_HALF_WIDTH + 1.05;
    for (const s of [-1, 1] as const) {
      const pz = s * PIER_Z;
      F.put(STONE, PIER_W, PIER_H, 2.9, GATE_PIER_X, PIER_H / 2, pz);
      F.put(PALE, PIER_W + 0.18, 0.22, 3.1, GATE_PIER_X, PIER_H + 0.11, pz);
      F.put(HAZ, 0.06, 2.0, 0.34, GATE_PIER_X + PIER_W / 2 + 0.03, 1.4, pz);   // pier stripe
    }
    // Sign GANTRY across the carriageway, carried on the two piers. A board bolted to a
    // pier is 79 degrees off axis from a player standing at the gate and is never in
    // frame - measured in perim-west-road.png, where the closure read but said nothing.
    // Over the road it reads from the turning head, 16 m back, and through the gate bars.
    const GANTRY_Y = 3.55, GANTRY_W = PIER_Z * 2 + PIER_W;
    F.put(STONE, 0.7, 0.42, GANTRY_W, GATE_PIER_X, GANTRY_Y + 1.05, 0);
    F.put(PALE, 0.9, 0.16, GANTRY_W, GATE_PIER_X, GANTRY_Y + 1.34, 0);
    F.put(PALE, 0.34, 1.9, GANTRY_W - 1.4, GATE_PIER_X + 0.1, GANTRY_Y, 0);
    const face = GATE_PIER_X + 0.29;
    F.put(SIGN_TEST, 0.04, 0.92, (GANTRY_W - 1.9) * 0.94, face, GANTRY_Y + 0.44, 0);
    F.put(SIGN_NOENTRY, 0.04, 0.72, (GANTRY_W - 1.9) * 0.82, face, GANTRY_Y - 0.44, 0);
    // staggered jersey barriers across the carriageway behind the gate
    for (let i = -2; i <= 2; i++) {
      const bz = i * 2.05;
      const bx = JERSEY_WEST_X - (i % 2 === 0 ? 0 : 1.25);
      jersey(bx, bz);
    }
    // a light mast either side so the closure has a silhouette from the street
    mast(GATE_PIER_X - 3.4, -(ROAD_HALF_WIDTH + 5.2));
    mast(GATE_PIER_X - 3.4, ROAD_HALF_WIDTH + 5.2);
  }

  // ======================================================== 3. east apron closure
  // The road dies on the apron at ROAD_X_MAX and yards.ts's boarded fence crosses it at
  // 16.6 - a garden fence across a carriageway, which reads as scenery rather than as an
  // edge. Only 0.29 m of this lane's region lies in front of that fence, so a jersey
  // barrier row (0.62 m deep) will NOT fit without reaching into the dressing lane's
  // street region; it is not placed. What does fit, and what the road end gets instead:
  // a row of hazard-striped wheel stops at 0.26 m deep, and a chevron board on posts
  // standing 2.3 m tall against the boarded fence, both seen from the whole east apron.
  {
    for (const bz of [-3.3, -1.1, 1.1, 3.3]) {
      B.put(PALE, 0.26, 0.42, 1.65, APRON_STOP_X, 0.21, bz);
      // the yellow band stands TUCK proud of the stop's map face (it was flush with it)
      B.put(HAZ, 0.28, 0.13, 0.5, APRON_STOP_X + 0.01 - TUCK, 0.36, bz);
      colliders.push(aabbSlab(APRON_STOP_X, 0, bz, 0.28, 0.42, 1.65));
    }
    for (const s of [-1, 1]) {
      B.put(IRON, 0.13, 2.3, 0.13, APRON_STOP_X + 0.04, 1.15, s * 2.0);
      colliders.push(aabbSlab(APRON_STOP_X + 0.04, 0, s * 2.0, 0.16, 2.3, 0.16));
    }
    B.put(HAZ, 0.09, 0.66, 4.5, APRON_STOP_X + 0.06 - TUCK, 2.06, 0);   // back face clear of the posts'
    B.put(SIGN_NOENTRY, 0.04, 0.56, 3.8, APRON_STOP_X + 0.01, 2.06, 0);
  }

  // ======================================================== 4. the test site beyond
  /**
   * Jersey barrier, long axis along z so a row of them closes a carriageway. Three
   * stacked boxes give the splayed profile. Out-of-shell only, so no collider.
   */
  function jersey(x: number, z: number): void {
    F.put(PALE, 0.62, 0.20, 2.0, x, 0.10, z);
    F.put(PALE, 0.40, 0.42, 2.0, x, 0.41, z);
    F.put(PALE, 0.26, 0.33, 2.0, x, 0.79, z);
    F.put(HAZ, 0.28, 0.10, 0.42, x, 0.90, z);
  }

  /** Lattice-ish floodlight mast: tapered column, head frame, four lamp boxes. */
  function mast(x: number, z: number): void {
    const H = 11.5;
    FC.put(CONC, 1.5, 0.34, 1.5, x, 0.17, z);
    F.put(IRON, 0.46, H * 0.55, 0.46, x, 0.34 + H * 0.275, z);
    F.put(IRON, 0.3, H * 0.5, 0.3, x, 0.34 + H * 0.72, z);
    F.put(IRON, 2.9, 0.16, 0.5, x, 0.34 + H, z);
    for (let i = 0; i < 4; i++) {
      F.put(IRON, 0.52, 0.34, 0.44, x - 1.2 + i * 0.8, 0.34 + H - 0.28, z);
      F.put(PALE, 0.44, 0.06, 0.38, x - 1.2 + i * 0.8, 0.34 + H - 0.46, z);
    }
    // two guys, suggested by struts rather than wires - a wire is 1 px at this range
    for (const s of [-1, 1]) {   // the two overlap at the column; one sits TUCK up and over
      const o = s > 0 ? TUCK : 0;
      F.put(IRON, 0.14, 0.14, H * 0.62, x + o, 0.34 + H * 0.3 + o, z + s * H * 0.26);
    }
  }

  /** Shipping container, colour picked off the rng so a row is not a stripe. */
  function container(x: number, z: number, ry: number, stacked: boolean): void {
    const m = CONTAINER[Math.floor(rand() * CONTAINER.length) % CONTAINER.length];
    F.put(m, 2.44, 2.59, 6.06, x, 1.30, z, ry);
    F.put(IRON, 2.5, 0.12, 6.12, x, 2.62, z, ry);
    if (!stacked) return;
    const m2 = CONTAINER[Math.floor(rand() * CONTAINER.length) % CONTAINER.length];
    F.put(m2, 2.44, 2.59, 6.06, x + rr(-0.3, 0.3), 3.95, z + rr(-0.5, 0.5), ry + rr(-0.05, 0.05));
  }

  /** Crate stack: two or three boxes, never a neat tower. */
  function crateStack(x: number, z: number, ry: number): void {
    const n = 2 + Math.floor(rand() * 2);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const w = rr(1.1, 1.7), h = rr(0.7, 1.0), d = rr(1.1, 1.7);
      F.put(CRATE, w, h, d, x + rr(-0.25, 0.25), y + h / 2, z + rr(-0.25, 0.25), ry + rr(-0.25, 0.25));
      y += h;
    }
  }

  /** Drum cluster: oil drums, some on their side. Overlapping drums - within a cluster
   *  or between two neighbouring scatter clusters - never share a lid: each drum in
   *  the module takes the next of 24 heights, a TUCK apart. */
  let drumSeq = 0;
  function drums(x: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand();
      const r = rr(0.3, 1.9);
      const h = 0.88 + (drumSeq++ % 24) * TUCK;
      FC.put(i % 3 === 0 ? RUST : IRON, 0.58, h, 0.58,
        x + Math.cos(a) * r, h / 2, z + Math.sin(a) * r);
    }
  }

  /** Spoil heap: soil mass with a graded cap, so the desert looks worked. */
  function spoil(x: number, z: number, w: number, d: number): void {
    FS.put(SOIL, w, 1.5, d, x, 0.25, z);
    FS.put(SOIL, w * 0.66, 1.9, d * 0.66, x + rr(-0.8, 0.8), 0.5, z + rr(-0.8, 0.8));
  }

  /**
   * One works compound. Placed only outside the shell, so none of it is reachable and
   * none of it needs a collider - the fence and the shell are between it and the player.
   */
  function compound(cx: number, cz: number, ry: number, withMast: boolean): void {
    const at = (ox: number, oz: number): [number, number] => l2w(cx, cz, ry, ox, oz);
    F.put(CONC, 14.0, 0.14, 11.0, cx, 0.07, cz, ry);           // hardstanding
    let p = at(-4.2, -3.4); container(p[0], p[1], ry, true);
    p = at(-4.2, 3.2); container(p[0], p[1], ry + 0.04, false);
    p = at(2.2, -3.0); crateStack(p[0], p[1], ry);
    p = at(3.4, -0.4); crateStack(p[0], p[1], ry + 0.7);
    p = at(2.6, 2.8); drums(p[0], p[1], 7);
    p = at(5.6, 4.6); spoil(p[0], p[1], 7.0, 5.0);
    if (withMast) { p = at(5.4, -4.4); mast(p[0], p[1]); }
  }

  // WEST, either side of the road: past plaza.ts's display ground (its DEEP_Z is 24.1)
  // and short of the skyline's -x pavilion rows (x <= -41.5). No mast in these two: the
  // maroon hypar saddle (skyline section 3) floats at y 6.2..9.6 over x -44..-23 around
  // z = -31.5, and an 11.8 m mast inside that footprint would spear it. The masts that
  // give this side its silhouette are placed clear of it, below.
  compound(BOUND_X_MIN - 7.0, -31.5, Math.PI / 2, false);
  compound(BOUND_X_MIN - 7.0, 31.5, Math.PI / 2, false);
  mast(BOUND_X_MIN - 4.5, -41.0);
  mast(BOUND_X_MIN - 4.5, 41.0);
  // Behind both back fences, beyond the shell at |z| = 42/43.2 and short of the skyline
  // pavilion rows at |z| = 55.
  compound(-6.0, -48.5, 0, true);
  compound(4.0, 48.5, Math.PI, true);
  // East, past the third house's plot and the east shell face.
  compound(BOUND_X_MAX + 7.0, -16.0, -Math.PI / 2, true);
  compound(BOUND_X_MAX + 7.0, 17.5, -Math.PI / 2, true);

  // A thin scatter of loose plant in the 2 m slot between the shell and plaza.ts's
  // NEAR_X, so the west palisade has something standing behind it at eye height along
  // its whole length rather than bare apron.
  for (let i = 0; i < 9; i++) {
    const z = -38 + i * 9.4;
    if (Math.abs(z) < PAVEMENT_OUTER + 4) continue;
    crateStack(BOUND_X_MIN - 1.8, z + rr(-1.4, 1.4), rr(0, 3.1));
  }
  for (let i = 0; i < 8; i++) {
    const x = -17 + i * 4.6;
    for (const s of [-1, 1] as const) {
      if (rand() < 0.35) continue;
      drums(x + rr(-1.2, 1.2), s * (BOUND_Z + 2.2 + rr(0, 1.0)), 4);
    }
  }

  // ---------------------------------------------------------------- emit
  const batches: [Batch, string][] = [
    [B, 'perimBox'], [F, 'oobBox'], [FC, 'oobCyl'], [FS, 'oobSph'],
  ];
  for (const [b, tag] of batches) b.flush(g, tag);

  // Nothing moves: compose each matrix once (three r185 recomposes every
  // matrixAutoUpdate node every frame).
  g.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });

  // Colliders are checked too, not just meshes. The clip this replaced only ever looked
  // at colliders, which is exactly why the meshes it left behind went unnoticed for a
  // day; checking one and not the other is how that happens in either direction.
  for (const c of colliders) {
    checkRegion((c.min.x + c.max.x) / 2, (c.min.z + c.max.z) / 2,
      c.max.x - c.min.x, c.max.z - c.min.z);
  }

  if (strayCount) {
    console.warn('[surround] %d primitive(s) outside the perimeter lane\'s region; worst '
      + 'reaches %.2f m inside the play space near (%.1f, %.1f). Out-of-bounds scenery '
      + 'must not enter |x| < %s with |z| > %s.',
      strayCount, strayWorst, strayAt[0], strayAt[1], YARD_X_MAX, PAVEMENT_OUTER);
  }

  return { group: g, colliders };
};
