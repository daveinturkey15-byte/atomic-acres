/**
 * THIRD HOUSE - the out-of-bounds landmark beyond the cul-de-sac.
 *
 * Sits on the street centreline just past the boundary fence, so the player never
 * reaches it. Its whole job is to tell the +x end of the map apart at
 * 25-40 m (SPEC section 3, NT02): the ONE building with a real pitched roof - a dark
 * gable whose triangular end faces the turning head - over pale walls with two big
 * white window bands, with a red 1950s saloon on the hardstanding beside it.
 * Silhouette only, no interior; one solid collider so nothing can be entered.
 *
 * ---------------------------------------------------------------- what reads, and why
 * A WHITE BAND PAINTED ON A WHITE WALL IS NOT A WINDOW. PAL.windowBand (0xf2f4f3) on
 * PAL.thirdWall (0xd8d2c6) is about 5% contrast: measured from the turningHead frame it
 * read as nothing at all, two blank pale bars close up and invisible at 30 m. Every
 * opening here is therefore a white SURROUND standing REVEAL proud of the wall with
 * DARK glazing (ctx.mat.windowDark) flat on the wall behind it. The read is the dark
 * glass and the shadow the surround throws across it; the white only frames it. Do not
 * "fix" this by repainting the wall - the reference wants white bands on a DARK-ROOFED
 * PALE house, and the roof is the other half of that contrast.
 *
 * The camera at the turningHead station sits at z = +1 with the house centred on z = 0,
 * so BOTH long faces are back-facing from there: only the -x gable is ever seen from
 * the street. The long-face bands are for the aerial. The coach and the box truck on
 * the head mask the gable outside roughly z = -4.3 .. +3.5, so the door, the bands and
 * the car are all kept inside that window.
 *
 * Brightwork uses ctx.mat.painted(PAL.chrome, 0.24, 0.4), never raw ctx.mat.chrome:
 * world.ts DOES have a PMREM environment map now, so full metals reflect properly -
 * but check in a frame rather than assuming, and prefer painted chrome for large
 * bright trim faces if real chrome reads too dark (brief Rules chrome note).
 */
import * as THREE from 'three';
import { PAL } from '../core/palette';
import {
  THIRD_HOUSE_X, KERB_HEIGHT, ROAD_X_MAX,
  HOUSE_HALF_LEN, HOUSE_DEPTH, FLOOR_H, UPPER_H,
} from '../core/layout';
import { aabbSlab, extrude, group, slab } from '../core/kit';
import type { AABB, Builder } from '../core/kit';

/** Collects axis-aligned boxes and emits ONE InstancedMesh per material. */
class Batch {
  private rows: number[][] = [];
  add(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): void {
    if (w <= 0 || h <= 0 || d <= 0) return;
    this.rows.push([w, h, d, x, y, z, rotY]);
  }
  mesh(material: THREE.Material, name: string): THREE.InstancedMesh | null {
    const n = this.rows.length;
    if (!n) return null;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, n);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const r = this.rows[i];
      q.setFromAxisAngle(up, r[6]);
      pos.set(r[3], r[4], r[5]);
      scl.set(r[0], r[1], r[2]);
      im.setMatrixAt(i, mtx.compose(pos, q, scl));
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = im.receiveShadow = true;
    im.name = name;
    return im;
  }
  /** Smallest x any primitive in this batch reaches, yaw included. Used by the
   *  region guard at the end of the builder. */
  minX(): number {
    let m = Infinity;
    for (const r of this.rows) {
      const c = Math.abs(Math.cos(r[6])), s = Math.abs(Math.sin(r[6]));
      m = Math.min(m, r[3] - (c * r[0] + s * r[2]) / 2);
    }
    return m;
  }
}
// ------------------------------------------------------------------ siting
// This house is scenery beyond the east boundary fence, never cover. Twice it has
// been re-derived locally because THIRD_HOUSE_X was stale; the contract now carries
// the right value, so take it from there and let layout.ts stay the single source.
const HOUSE_X = THIRD_HOUSE_X;
/** A face moved this far off a plane it shared with another part is out of the depth tie. */
const TUCK = 0.005;

/**
 * The map's east boundary fence, a LOCAL duplicate of yards.ts's BOUNDARY_X. It is not
 * a new dimension and not a new decision - this file needs to know where the fence is
 * in order to stand behind it, and layout.ts does not carry it.
 *
 * Everything this module owns must sit at x >= ROAD_X_MAX: the perimeter lane's region
 * starts there and the street beyond belongs to another lane. Two things did not, and
 * are fixed in this pass:
 *   - the FORECOURT ran from the turning head's east tangent (x 9.2) to the gable,
 *     i.e. 7 m of paved slab laid across the playable east apron, with two 0.8 m
 *     hedges on it that had no colliders. It is removed: after the re-proportioning
 *     there is no room for a front drive between the fence and the house, and a
 *     walk-through hedge on the apron is a defect either way.
 *   - the +z plot fence started at the white garage's east face (x 13.0) at z 9.45,
 *     1.8 m inside the map, again with no collider. It now starts behind the boundary
 *     fence.
 */
const FENCE_LINE = ROAD_X_MAX + 0.6;            // 16.6

// ------------------------------------------------------------------ dimensions
/**
 * Depth toward the map. Was HOUSE_DEPTH * 0.72 = 8.06, which put the near wall at
 * x 16.97 - 0.06 m off the back of the boundary fence, so the house was pressed flat
 * against it and read as a wall rather than as a building on its own plot. At 0.59 the
 * wall stands at 17.70, leaving a 0.8 m garden strip, and the rear clears the
 * out-of-bounds shell at x = 25.0 instead of poking through it.
 */
const BODY_X = HOUSE_DEPTH * 0.59;              // extent along x (toward the map)
const BODY_Z = HOUSE_HALF_LEN * 1.25;           // extent along z (the long faces)
const WALL_H = FLOOR_H + UPPER_H * 0.28;
const RIDGE = HOUSE_DEPTH * 0.33;               // rise from eave to ridge
const EAVE_OUT = 0.45;
const FACE_X = HOUSE_X - BODY_X * 0.5;          // the wall plane looking at the map
const GABLE_X = FACE_X - EAVE_OUT;              // the roof's overhanging gable plane

// ------------------------------------------------------------------ openings
const REVEAL = 0.17;        // how far the white surround stands proud of the wall
const FRAME_T = 0.20;       // depth of a head/jamb member
const RAIL = 0.32;          // width of a head/jamb member - fat enough to read WHITE
const SILL_T = 0.34;        // the sill is deeper and prouder - it throws the shadow
const SILL_OUT = 0.30;
const GLAZE_OUT = 0.015;    // glazing barely clears the wall, 0.155 behind the frame
const GLAZE_T = 0.07;
const MULL_W = 0.18;

/** The plane an opening is cut into: which axis it faces, where, and outward sign. */
interface Face { axis: 'x' | 'z'; at: number; out: 1 | -1 }

const GABLE: Face = { axis: 'x', at: FACE_X, out: -1 };
const VENT_FACE: Face = { axis: 'x', at: GABLE_X, out: -1 };
const LONG = (s: 1 | -1): Face => ({ axis: 'z', at: s * BODY_Z * 0.5, out: s });

/**
 * One window: dark glazing on the wall face inside a proud white surround.
 * `along` is the position across the face (z for an x-facing wall, x for a z-facing
 * one), `y` and `h` the glazing's centre and height, `w` its width, `panes` the
 * number of lights the mullions split it into.
 */
function opening(
  bFrame: Batch, bGlaze: Batch, f: Face,
  along: number, y: number, w: number, h: number, panes: number,
): void {
  const put = (
    b: Batch, depth: number, t: number, a: number, yy: number, ww: number, hh: number,
  ): void => {
    if (f.axis === 'x') b.add(t, hh, ww, depth, yy, a);
    else b.add(ww, hh, t, a, yy, depth);
  };
  const fd = f.at + f.out * (REVEAL - FRAME_T * 0.5);
  put(bGlaze, f.at + f.out * (GLAZE_OUT - GLAZE_T * 0.5), GLAZE_T, along, y, w, h);
  put(bFrame, fd, FRAME_T, along, y + (h + RAIL) * 0.5, w + RAIL * 2, RAIL);
  put(bFrame, f.at + f.out * (SILL_OUT - SILL_T * 0.5), SILL_T,
    along, y - (h + RAIL * 1.15) * 0.5, w + RAIL * 2, RAIL * 1.15);
  for (const s of [-1, 1]) {
    put(bFrame, fd, FRAME_T, along + s * (w + RAIL) * 0.5, y, RAIL, h);
  }
  for (let i = 1; i < panes; i++) {
    put(bFrame, fd, FRAME_T * 0.8, along - w * 0.5 + (w * i) / panes, y, MULL_W, h);
  }
}

// ------------------------------------------------------------------ front door
const DOOR_W = 1.15;
const DOOR_H = 2.05;
const STEP_H = 0.12;
const DOOR_Z = -BODY_Z * 0.333;

// ------------------------------------------------------------------ driveway
// The side drive down the +z flank, on the T_DRIVE rung (KERB_HEIGHT + 0.006) like the
// garage aprons. It starts behind the boundary fence and runs to the rear of the plot,
// so the "its own driveway" read in NT02 survives the forecourt's removal - from the
// AERIAL the drive and the red saloon are what say "a house on a plot", and from the
// STREET the house itself is the landmark.
const DRIVE_TOP = KERB_HEIGHT + 0.006;
const DRIVE_W = HOUSE_HALF_LEN * 0.68;                    // z extent, across the drive
const DRIVE_CZ = BODY_Z * 0.5 + DRIVE_W * 0.5 + 0.5;      // clear of the +z wall's sills
const DRIVE_X0 = Math.max(GABLE_X, FENCE_LINE + 0.4);     // behind the boundary fence
const DRIVE_LEN = HOUSE_X + BODY_X * 0.5 - DRIVE_X0;
const DRIVE_CX = DRIVE_X0 + DRIVE_LEN * 0.5;

// ------------------------------------------------------------------ the side wing
// A single-storey wing on the -z flank, which is the one the turning head looks at.
// The brief's note is that this house "reads as a box"; one mass with one roof is a
// box whatever is drawn on it, and a lower wing with its own flat roof and its own
// eave line is the cheapest thing that makes it a house on a plot.
const WING_X = 5.0;
const WING_Z = 4.4;
const WING_H = 2.95;
const WING_CX = HOUSE_X + 0.55;
const WING_CZ = -(BODY_Z * 0.5 + WING_Z * 0.5 + 0.35);

// ------------------------------------------------------------------ the saloon
/**
 * A 1950s saloon is long and LOW: about 4.7 x 1.9 x 1.5 m on 0.67 m wheels, with a
 * cabin shorter and narrower than the body it sits on. The previous shape was 2.22 m
 * tall with a full-width cabin - a skip lorry. Three stepped boxes (bonnet, midbody,
 * boot) give the three-box saloon profile for the price of one instanced draw call.
 */
const CAR_L = 4.72, CAR_W = 1.88, CAR_H = 1.51;
const WHEEL_R = 0.335, WHEEL_W = 0.22;
const AXLE_X = 1.48, TRACK_H = 0.80;
const CAR_YAW = -0.11;                          // parked nose-in, nearly along the drive
const CAR_CX = DRIVE_CX - 0.3;                  // held back from the rear of the plot
/**
 * Parked on the OUTER half of the drive. world.ts's sun sits in the -z sky, so the
 * whole +z flank is in the house's shadow out to about z = 11.6; a car tucked against
 * the wall renders as a dark maroon lump. At this offset the shadow edge runs through
 * it and the flank the aerial station looks at is the lit one.
 */
const CAR_CZ = DRIVE_CZ + DRIVE_W * 0.2;

export const buildThirdHouse: Builder = (ctx) => {
  const g = group('third-house');
  const colliders: AABB[] = [];
  const bWall = new Batch(), bFrame = new Batch(), bGlaze = new Batch();
  const bDark = new Batch(), bDoor = new Batch();
  const bCar = new Batch(), bChrome = new Batch();
  const bTimber = new Batch(), bHedge = new Batch();

  // --- driveway slab ---------------------------------------------------------
  // PAL.concreteDark, not ctx.mat.concrete: the whole out-of-bounds surround is
  // PAL.concrete, so a concrete drive on it is invisible from the aerial and the
  // "its own driveway" read in NT02 disappears. The darker slab plus its 0.146 lip
  // reads as a drive and gives the red car something to sit against.
  g.add(slab(DRIVE_LEN, DRIVE_TOP, DRIVE_W,
    ctx.mat.painted(PAL.concreteDark, 0.94, 0), DRIVE_CX, 0, DRIVE_CZ));
  colliders.push(aabbSlab(DRIVE_CX, 0, DRIVE_CZ, DRIVE_LEN, DRIVE_TOP, DRIVE_W));

  // --- body + chimney --------------------------------------------------------
  bWall.add(BODY_X, WALL_H, BODY_Z, HOUSE_X, WALL_H * 0.5, 0);
  const chX = HOUSE_X + BODY_X * 0.22;
  const chZ = BODY_Z * 0.24;
  const chH = RIDGE + 1.0;
  bWall.add(0.85, chH, 0.85, chX, WALL_H + chH * 0.5, chZ);
  bDark.add(1.02, 0.16, 1.02, chX, WALL_H + chH + 0.08, chZ);   // dark cap, reads on sky
  bDark.add(0.30, 0.55, 0.30, chX, WALL_H + chH + 0.43, chZ); // chimney pot on the cap
  bDark.add(0.42, 0.10, 0.42, chX, WALL_H + chH + 0.75, chZ); // pot cap, reads on sky

  // --- dark pitched roof: gable triangle swept along x -----------------------
  const half = BODY_Z * 0.5 + EAVE_OUT;
  const roofMat = ctx.mat.painted(PAL.thirdRoof, 0.78, 0.04);
  const roof = extrude([[-half, 0], [half, 0], [0, RIDGE]], BODY_X + EAVE_OUT * 2, roofMat);
  roof.rotation.y = Math.PI * 0.5;              // sweep axis -> world x, gable faces +/-x
  roof.position.set(HOUSE_X, WALL_H, 0);
  g.add(roof);
  // eave fascia under the roof edge, both long faces
  for (const s of [-1, 1]) {
    bWall.add(BODY_X + EAVE_OUT * 2, 0.2, 0.16, HOUSE_X, WALL_H - 0.1, s * half);
  }
  // ridge cap along the apex; gutters hung off both eaves just under the fascia
  const ridgeLen = BODY_X + EAVE_OUT * 2;
  bDark.add(ridgeLen, 0.12, 0.34, HOUSE_X, WALL_H + RIDGE + 0.02, 0);
  for (const s of [-1, 1] as const) {
    bChrome.add(ridgeLen, 0.11, 0.11, HOUSE_X, WALL_H - 0.24, s * (half + 0.08));
  }
  // barge boards: Batch only yaws, so each sloped gable edge is stepped pale trim,
  // both slopes of both gables (only the -x one is ever seen from the street)
  const slopeN = 6, slopeSeg = Math.hypot(half, RIDGE) / slopeN;
  // Segments overlap their neighbours by 0.12 and the two slopes meet at the ridge, so
  // consecutive boards shared their gable faces and the two ridge boards their tops:
  // each board is stepped TUCK / 2 off the last in x, and one slope TUCK up.
  for (const gx of [-1, 1]) {
    const bx = HOUSE_X + gx * (ridgeLen * 0.5 + 0.02);
    for (const s of [-1, 1]) {
      for (let i = 0; i < slopeN; i++) {
        const t = (i + 0.5) / slopeN;
        const step = TUCK * ((i % 2) + (s > 0 ? 0.5 : 0));
        bFrame.add(0.14, 0.24, slopeSeg + 0.12, bx + gx * step,
          WALL_H + RIDGE * t - 0.10 + (s > 0 ? TUCK : 0), s * half * (1 - t));
      }
    }
  }

  // --- the two big window bands on the gable face toward the map -------------
  // The boundary fence is 2.1 m tall and only 0.8 m off this wall, so from the
  // turningHead station everything below y = 2.09 is masked: the lower band is held
  // high enough that its head and the top of its glass clear the fence, and the upper
  // band - which runs nearly the full gable - is the one that carries the read.
  opening(bFrame, bGlaze, GABLE, BODY_Z * 0.085, FLOOR_H * 0.60, BODY_Z * 0.467, 1.16, 4);
  opening(bFrame, bGlaze, GABLE, 0, FLOOR_H * 1.05, BODY_Z * 0.683, 0.84, 6);
  // a louvred vent in the gable itself - the cheapest "this is a house" cue there is
  opening(bFrame, bDark, VENT_FACE, 0, WALL_H + 0.95, 1.05, 0.60, 3);
  // a band and a small light per long face, so it still reads as a house from above.
  // Nothing smaller goes on the gable: the door hood needs that wall clear.
  for (const s of [-1, 1] as const) {
    opening(bFrame, bGlaze, LONG(s), HOUSE_X - 0.4,
      FLOOR_H * 0.62, BODY_X * 0.50, 1.15, 3);
    opening(bFrame, bGlaze, LONG(s), HOUSE_X + BODY_X * 0.37,
      FLOOR_H * 0.62, 0.70, 0.85, 2);
  }

  // --- front door: dark leaf, white surround, hood and step ------------------
  const doorMid = STEP_H + DOOR_H * 0.5;
  bDoor.add(0.08, DOOR_H, DOOR_W, FACE_X - 0.03, doorMid, DOOR_Z);
  const dFd = FACE_X - (REVEAL - FRAME_T * 0.5);
  bFrame.add(FRAME_T, RAIL, DOOR_W + RAIL * 2, dFd, STEP_H + DOOR_H + RAIL * 0.5, DOOR_Z);
  for (const s of [-1, 1]) {   // jambs stop under the head; they used to run through it
    bFrame.add(FRAME_T, DOOR_H, RAIL, dFd, doorMid, DOOR_Z + s * (DOOR_W + RAIL) * 0.5);
  }
  // porch: the hood deepened to a slab roof on two white posts. The 0.8 m fence gap
  // caps protrusion at ~0.77, and the top must stay under the upper band's sill (~2.70)
  const porchY = STEP_H + DOOR_H + RAIL + 0.07;
  bWall.add(0.78, 0.14, DOOR_W + 1.5, FACE_X - 0.38, porchY, DOOR_Z);
  for (const s of [-1, 1]) {
    bFrame.add(0.12, porchY - 0.07, 0.12, FACE_X - 0.68, (porchY - 0.07) * 0.5, DOOR_Z + s * (DOOR_W * 0.5 + 0.55));
    bFrame.add(0.10, 0.30, 0.10, FACE_X - 0.08, porchY - 0.22, DOOR_Z + s * (DOOR_W * 0.5 + 0.45));
  }
  // the step stays short: the boundary fence is only ~0.8 m off this wall now
  bWall.add(0.62, STEP_H, DOOR_W + 0.8, FACE_X - 0.31, STEP_H * 0.5, DOOR_Z);

  // --- single-storey side wing on the -z flank -------------------------------
  // Own eave line, own flat roof, own window band, set back 0.6 m from the main gable
  // plane so the two masses step rather than line up.
  {
    const wx = WING_CX, wz = WING_CZ;
    bWall.add(WING_X, WING_H, WING_Z, wx, WING_H * 0.5, wz);
    bDark.add(WING_X + 0.5, 0.22, WING_Z + 0.5, wx, WING_H + 0.11, wz);   // flat roof lip
    bWall.add(WING_X + 0.36, 0.14, WING_Z + 0.36, wx, WING_H + 0.29, wz); // parapet cap
    // a band on the map-facing wall and one on the -z flank, same surround treatment
    opening(bFrame, bGlaze, { axis: 'x', at: wx - WING_X * 0.5, out: -1 },
      wz, WING_H * 0.54, WING_Z * 0.48, 0.88, 3);
    opening(bFrame, bGlaze, { axis: 'z', at: wz - WING_Z * 0.5, out: -1 },
      wx + 0.5, WING_H * 0.54, WING_X * 0.42, 0.82, 2);
    colliders.push(aabbSlab(wx, 0, wz, WING_X + 0.5, WING_H + 0.36, WING_Z + 0.5));
  }

  // --- roof aerial: the single cheapest "this is a lived-in house" cue on a skyline
  {
    const ax = HOUSE_X - BODY_X * 0.18, az = BODY_Z * 0.30;
    bChrome.add(0.07, 2.6, 0.07, ax, WALL_H + RIDGE + 1.3, az);
    for (let i = 0; i < 4; i++) {
      bChrome.add(0.05, 0.05, 1.5 - i * 0.22, ax, WALL_H + RIDGE + 1.5 + i * 0.28, az);
    }
    bChrome.add(0.05, 0.9, 0.05, ax, WALL_H + RIDGE + 1.05, az + 0.42);   // stay
  }

  // house slab widened 0.77 toward the map so the porch roof/posts collide honestly
  colliders.push(aabbSlab(HOUSE_X - 0.38, 0, 0, BODY_X + 0.77, WALL_H + RIDGE, BODY_Z));
  // downpipes: rear corners, gutter to ground + shoe; clear of the drive's 0.5 m offset
  for (const s of [-1, 1] as const) {
    const px = HOUSE_X + BODY_X * 0.5 - 0.15, pz = s * (BODY_Z * 0.5 + 0.10);
    bChrome.add(0.09, WALL_H - 0.2, 0.09, px, (WALL_H - 0.2) * 0.5, pz);
    bChrome.add(0.09 + 2 * TUCK, 0.22, 0.30, px, 0.11, pz + s * 0.08);   // shoe proud of the pipe
  }

  // --- red 1950s saloon on the drive -----------------------------------------
  // Authored nose-along-local-+x with the wheels resting at 0, then yawed and lifted
  // onto DRIVE_TOP. Parts go straight into the shared batches with the yaw baked in,
  // so the whole car costs three draw calls and shares the house's glazing.
  const yaw = CAR_YAW + (ctx.rand() - 0.5) * 0.1;      // nobody parks square
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const wx = (lx: number, lz: number): number => CAR_CX + lx * cy + lz * sy;
  const wz = (lx: number, lz: number): number => CAR_CZ - lx * sy + lz * cy;
  const part = (
    b: Batch, w: number, h: number, d: number, lx: number, y: number, lz: number,
  ): void => b.add(w, h, d, wx(lx, lz), DRIVE_TOP + y, wz(lx, lz), yaw);

  // bonnet and boot BUTT the midbody (they used to overlap it by 20 mm, tying the
  // underside and both flanks on the seam)
  part(bCar, 1.60, 0.60, CAR_W, 1.56, 0.60, 0);              // bonnet   0.30 - 0.90, x 0.76..2.36
  part(bCar, 2.10, 0.72, CAR_W, -0.29, 0.66, 0);             // midbody  0.30 - 1.02, x -1.34..0.76
  part(bCar, 1.02, 0.66, CAR_W, -1.85, 0.63, 0);             // boot     0.30 - 0.96, x -2.36..-1.34
  part(bCar, 2.00, 0.42, CAR_W * 0.80, -0.30, 1.23, 0);      // cabin    1.02 - 1.44
  part(bCar, 1.84, 0.07, CAR_W * 0.82, -0.32, 1.475, 0);     // roof     1.44 - 1.51
  part(bGlaze, 1.92, 0.32, CAR_W * 0.83, -0.30, 1.235, 0);   // glass band in the cabin
  for (const s of [-1, 1]) {
    part(bCar, 0.62, 0.30, 0.10, -1.95, 1.05, s * (CAR_W * 0.5 - 0.06));   // tailfin
  }
  for (const s of [-1, 1]) {
    part(bChrome, 0.20, 0.20, CAR_W * 0.98, s * CAR_L * 0.5, 0.46, 0);     // bumpers
  }
  part(bChrome, 3.40, 0.07, CAR_W + 0.04, 0.15, 0.80, 0);    // side spear
  part(bChrome, 0.09, 0.24, CAR_W * 0.68, 2.42, 0.64, 0);    // grille
  for (const s of [-1, 1]) {
    part(bChrome, 0.10, 0.18, 0.22, 2.40, 0.72, s * 0.68);   // headlamps
    part(bChrome, 0.10, 0.15, 0.24, -2.40, 0.80, s * 0.72);  // tail lamps
  }

  // wheels: one instanced cylinder, axle rotated onto local z then yawed with the car
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 14);
  wheelGeo.rotateX(Math.PI * 0.5);
  const wheels = new THREE.InstancedMesh(
    wheelGeo, ctx.mat.painted(PAL.asphalt, 0.95, 0), 4);
  const wq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const wOne = new THREE.Vector3(1, 1, 1);
  const wPos = new THREE.Vector3(), wm = new THREE.Matrix4();
  let wi = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = sx * AXLE_X, lz = sz * TRACK_H;
      wPos.set(wx(lx, lz), DRIVE_TOP + WHEEL_R, wz(lx, lz));
      wheels.setMatrixAt(wi++, wm.compose(wPos, wq, wOne));
    }
  }
  wheels.instanceMatrix.needsUpdate = true;
  wheels.castShadow = wheels.receiveShadow = true;
  wheels.name = 'th-wheels';
  g.add(wheels);

  colliders.push(aabbSlab(
    CAR_CX, DRIVE_TOP, CAR_CZ,
    CAR_L * Math.abs(cy) + CAR_W * Math.abs(sy), CAR_H,
    CAR_L * Math.abs(sy) + CAR_W * Math.abs(cy),
  ));

  // plot boundary: hedge down the -z flank, low timber fence beyond the drive on +z.
  // both run front (bulb-clear DRIVE_X0) to rear, clear of the drive and the car.
  const plotX0 = DRIVE_X0, plotX1 = HOUSE_X + BODY_X * 0.5;
  const plotLen = plotX1 - plotX0, plotCX = (plotX0 + plotX1) * 0.5;
  const hedgeN = Math.max(1, Math.round(plotLen / 1.5));
  // consecutive blocks overlap 0.06 along the run; alternate ones sit TUCK further out
  // so the shared flank plane is broken at every joint
  for (let i = 0; i < hedgeN; i++) {
    const hh = 0.85 + (ctx.rand() - 0.5) * 0.12;
    bHedge.add(plotLen / hedgeN + 0.06, hh, 0.6, plotX0 + plotLen * (i + 0.5) / hedgeN, hh * 0.5,
      -(BODY_Z * 0.5 + 1.0 + (i % 2) * TUCK));
  }
  // the +z fence starts BEHIND the map's boundary fence - it used to start at the white
  // garage's east face (x 13.0), which is 1.8 m inside the playable east alley, and it
  // carries no collider; the rear return is a hedge across the back of the house only,
  // so the drive stays open.
  const fenceZ = DRIVE_CZ + DRIVE_W * 0.5 + 0.6;
  const fenceX0 = FENCE_LINE + 0.5;
  const fenceLen = plotX1 - fenceX0, fenceCX = (fenceX0 + plotX1) * 0.5;
  const postN = Math.max(2, Math.round(fenceLen / 1.8) + 1);
  for (let i = 0; i < postN; i++) {
    bTimber.add(0.12, 1.0, 0.12, fenceX0 + fenceLen * i / (postN - 1), 0.5, fenceZ);
  }
  for (const ry of [0.5, 0.85]) bTimber.add(fenceLen, 0.10, 0.06, fenceCX, ry, fenceZ);
  const rearZ0 = -(BODY_Z * 0.5 + 1.0), rearZ1 = BODY_Z * 0.5 - 0.3;
  const rearN = Math.max(2, Math.round((rearZ1 - rearZ0) / 1.5));
  // the rear hedge's outer face was the back wall's own plane (plotX1): TUCK proud of
  // it, and alternate blocks a further TUCK so neighbours do not share a face either
  for (let i = 0; i < rearN; i++) {
    const hh = 0.85 + (ctx.rand() - 0.5) * 0.12;
    bHedge.add(0.6, hh, (rearZ1 - rearZ0) / rearN + 0.06,
      plotX1 - 0.3 + TUCK * (1 + (i % 2)), hh * 0.5, rearZ0 + (rearZ1 - rearZ0) * (i + 0.5) / rearN);
  }
  // planting: faceted shrubs flanking the door gap + down the -z flank, all on y = 0
  const shrub = (x: number, z: number, s: number): void => {
    bHedge.add(s, s * 0.85, s, x, s * 0.425, z);
    bHedge.add(s * 0.62, s * 0.5, s * 0.62, x, s * 1.1, z);
  };
  shrub(FACE_X - 0.42, DOOR_Z - 1.7, 0.55);
  shrub(FACE_X - 0.42, DOOR_Z + 1.7, 0.55);
  shrub(FACE_X - 0.42, BODY_Z * 0.125, 0.5);
  shrub(HOUSE_X + 1.5, -(BODY_Z * 0.5 + 0.55), 0.65);

  // --- one garden tree, taller than the eaves ---------------------------------
  // The house reads over a 2.1 m fence, so its bottom 2 m never shows. What sells "a
  // house on a plot seen over a fence" from the street is something GROWING beside it
  // that breaks the roofline - the fence cannot crop a 7.6 m tree.
  //
  // The canopy is faceted spheres in PAL.treeLeaf, not boxes in PAL.hedge: a first pass
  // used the hedge batch, and a stack of dark-green BOXES at 22 m reads as a dark blob
  // parked beside the coach, not as a tree (see the turningHead crop that caught it).
  {
    const tx = FENCE_LINE + 2.0, tz = -(BODY_Z * 0.5 + 3.2);
    const trunk = ctx.mat.painted(PAL.treeTrunk, 0.95, 0);
    const trunkMesh = slab(0.44, 4.2, 0.44, trunk, tx, 0, tz);
    g.add(trunkMesh);
    const blobs: [number, number, number, number][] = [
      [tx, 5.1, tz, 4.5], [tx + 0.5, 6.3, tz - 0.5, 3.4], [tx - 0.45, 6.9, tz + 0.5, 2.6],
    ];
    const canopy = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 1),
      ctx.mat.painted(PAL.treeLeaf, 0.95, 0), blobs.length);
    const cm = new THREE.Matrix4(), cq = new THREE.Quaternion();
    for (let i = 0; i < blobs.length; i++) {
      const [bx, by, bz, s] = blobs[i];
      cq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.1);
      canopy.setMatrixAt(i, cm.compose(
        new THREE.Vector3(bx, by, bz), cq, new THREE.Vector3(s, s * 0.82, s)));
    }
    canopy.instanceMatrix.needsUpdate = true;
    canopy.castShadow = canopy.receiveShadow = true;
    canopy.name = 'th-tree';
    g.add(canopy);
  }

  // --- one draw call per material --------------------------------------------
  const batched: [Batch, THREE.Material, string][] = [
    [bWall, ctx.mat.painted(PAL.thirdWall, 0.9, 0), 'th-walls'],
    [bFrame, ctx.mat.painted(PAL.windowBand, 0.7, 0), 'th-window-frames'],
    [bGlaze, ctx.mat.windowDark, 'th-glazing'],
    [bDark, roofMat, 'th-roof-detail'],
    [bDoor, ctx.mat.painted(PAL.timberDark, 0.85, 0), 'th-door'],
    // low metalness: PAL.carRed at 0.35 washed out to salmon pink in the sun
    [bCar, ctx.mat.painted(PAL.carRed, 0.45, 0.06), 'th-car'],
    [bChrome, ctx.mat.painted(PAL.chrome, 0.24, 0.4), 'th-car-chrome'],
    [bTimber, ctx.mat.painted(PAL.timber, 0.9, 0), 'th-fence'],
    [bHedge, ctx.mat.painted(PAL.hedge, 0.95, 0), 'th-planting'],
  ];
  for (const [b, m, n] of batched) {
    const im = b.mesh(m, n);
    if (im) g.add(im);
  }

  // Region guard. This module is out-of-bounds scenery east of the boundary fence, so
  // nothing it owns may reach west of ROAD_X_MAX - and twice now something has, without
  // a collider, which is geometry the player walks through. Reported, not thrown:
  // main.ts skips a module that throws, and losing the landmark is worse than a warning.
  {
    let west = Infinity;
    for (const [b] of batched) west = Math.min(west, b.minX());
    for (const c of colliders) west = Math.min(west, c.min.x);
    if (west < ROAD_X_MAX) {
      console.warn('[third-house] geometry reaches x %.2f, which is %.2f m west of '
        + 'ROAD_X_MAX (%s). This module is scenery beyond the boundary fence and must '
        + 'stay east of it.', west, ROAD_X_MAX - west, ROAD_X_MAX);
    }
  }
  return { group: g, colliders };
};
