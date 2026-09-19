/**
 * ORANGE HOUSE - the -z house (SPEC NT03 / NT04). Cream undercroft under a
 * panelised terracotta upper storey, wrapped by a clerestory band of tall narrow
 * lights that curves around the free-end corner. The signature is the butterfly
 * roof: a thin cream wing sweeping up toward the garage end with a deep cantilever
 * over three dark barrel-vault bays, solar laid on the low end of the sweep.
 * Every placement derives from ORANGE - the garage end is read, never assumed.
 */
import * as THREE from 'three';
import type { AABB, Builder } from '../core/kit';
import { aabb, aabbSlab, box, extrude, group, slab } from '../core/kit';
import { PAL } from '../core/palette';
import {
  CANOPY_LEN, CANOPY_OUT, CANOPY_Y, DECK_LEN, DECK_OUT, DECK_Y, EAVE_Y, FLOOR_H,
  GARAGE_BAYS, GARAGE_DEPTH, GARAGE_H, GARAGE_LEN, HOUSE_DEPTH, HOUSE_HALF_LEN,
  KERB_HEIGHT, ORANGE, RAIL_H, UPPER_H, DOOR_APRON_HALF_W,
} from '../core/layout';

type P2 = [number, number];
interface Hole { c: number; w: number; sill: number; head: number }
/** A hole resolved onto the wall that carries it, so it can be glazed afterwards. */
interface Opening extends Hole { along: 'x' | 'z'; fixed: number; out: number }
/** [w, h, d, x, y, z, rotY] - one oriented box for a shared InstancedMesh. */
type Row = [number, number, number, number, number, number, number];

// ---------------------------------------------------------------- frame
const H = ORANGE;
const S = H.side;                 // -1 : the back yard lies at -z
const OUT = -S;                   // +1 : outward, toward the street
const GE = H.garageEnd;           // -1 : the garage end in x
const FE = -GE;                   // +1 : the free (deck / porch) end in x

const HHL = HOUSE_HALF_LEN;
const frontZ = H.frontZ;
const backZ = H.backZ;
const midZ = (frontZ + backZ) / 2;

// ---------------------------------------------------------------- derived dims
const WALL_T = 0.28;
const RECESS = HOUSE_DEPTH * 0.06;          // undercroft setback on the street face
const CORNER_R = HOUSE_DEPTH * 0.185;       // radius of the wrapped corner
const ROOF_T = 0.32;                        // the wing stays thin
const ROOF_RISE = UPPER_H * 0.78;           // sweep above the low eave
const ROOF_OVER = HOUSE_DEPTH * 0.125;      // street / yard overhang
const CANTI = CANOPY_OUT * 1.1;             // cantilever past the garage-end wall
const ROOF_TILT = 0.34;                     // fall across the depth toward the street
const ROOF_HALF_Z = HOUSE_DEPTH / 2 + ROOF_OVER;
const TILT_K = (-ROOF_TILT * OUT) / ROOF_HALF_Z;
const HI_X = GE * (HHL + CANTI);            // high end of the sweep (over the garage)
const LO_X = FE * (HHL + ROOF_OVER);        // low end of the sweep (over the deck end)
const BAND_SILL = FLOOR_H + UPPER_H * 0.18;
const BAND_HEAD = EAVE_Y - UPPER_H * 0.21;
const GND_FRONT = frontZ + S * RECESS;      // recessed ground-floor street plane
const STAIR_W = 1.25;
const STEPS = 14;

// -------------------------------------------------- rear deck + external stair
// The flight runs ALONG the back wall, parallel to it, leaving the deck at its FREE
// end and descending sideways - docs/HANDEDNESS.md s2 / s8.1, six frames across three
// clips, both houses (g-tB35IKluv0g-148 and g-1icNQzMgLUM-102 are the orange reads).
// It used to run yard-ward in z, which is the one thing every one of those frames
// rules out. Direction is FE - the free end, derived from ORANGE.garageEnd - never a
// bare sign: the two houses are a 180-degree ROTATIONAL pair, so the white flight and
// this one are point reflections of each other through the origin.
const DECK_X = H.deckX;
const DECK_OUT_Z = backZ + S * DECK_OUT;             // outer (yard-ward) deck edge
const DECK_CZ = backZ + S * (DECK_OUT / 2 - 0.05);   // deck centre in z
const STAIR_GOING = 0.28;
const STAIR_RUN = STEPS * STAIR_GOING;               // 3.92 m along x
const STAIR_FOOT_Y = 0.2;
const STAIR_HEAD_X = DECK_X + FE * (DECK_LEN / 2);   // the deck's free-end edge
const STAIR_FOOT_X = STAIR_HEAD_X + FE * STAIR_RUN;
/** landing a player needs past the bottom tread, and clearance either side */
const STAIR_LANDING = 0.8;
const STAIR_SIDE = 0.3;

/**
 * The ground this house's external rear stair owns, as an AABB in world x/z.
 *
 * yards.ts imports this and keeps every prop out of it. It exists because the deck
 * keep-out yards.ts already had (DECK_LEN / DECK_OUT) stops at the deck, and both
 * flights run PAST that volume - so a planter could be, and was, built into the
 * bottom four treads of the white stair with no module being wrong about it.
 * Derived from the SAME constants that build the treads below, so a re-proportioning
 * moves the keep-out with the stair instead of separating them.
 */
export const ORANGE_STAIR_FOOTPRINT = {
  minX: Math.min(STAIR_HEAD_X, STAIR_FOOT_X + FE * STAIR_LANDING),
  maxX: Math.max(STAIR_HEAD_X, STAIR_FOOT_X + FE * STAIR_LANDING),
  minZ: DECK_CZ - STAIR_W / 2 - STAIR_SIDE,
  maxZ: DECK_CZ + STAIR_W / 2 + STAIR_SIDE,
};

// glazing: a pane sits BEHIND the outer wall face so the jamb casts a reveal shadow
const PANE_T = 0.04;                        // leaf thickness
const REVEAL = 0.075;                       // setback of the pane from the outer face
const FRAME_W = 0.11;                       // frame face width around an aperture
const FRAME_D = 0.1;                        // frame depth (0.075 of it stands proud)
const DECK_T = KERB_HEIGHT + 0.1;           // entry deck top, clear of the lawn plateau

// ---------------------------------------------------------------- interior plan
// INTERIORS-TOPOLOGY s2/s6, expressed as fractions of layout.ts dimensions and signed
// by S / GE / FE, so flipping ORANGE.garageEnd or ORANGE.side re-lays the whole plan.
const IN_GE = GE * (HHL - WALL_T);                    // garage-end inner face
const IN_FE = FE * (HHL - WALL_T);                    // free-end inner face
const IN_FRONT = GND_FRONT + S * WALL_T;              // street-side inner face
const IN_BACK = backZ - S * WALL_T;                   // yard-side inner face
const Z_SPLIT = frontZ + S * (HOUSE_DEPTH * 0.518);   // street rooms | yard rooms
const X_SPLIT = GE * (HHL * 0.156);                   // kitchen | living room
const Z_CASED = frontZ + S * (HOUSE_DEPTH * 0.241);   // the one wide cased opening
const CASED_W = 2.6;
const CASED_HEAD = 2.3;
const Z_GAR_DOOR = frontZ + S * (HOUSE_DEPTH * 0.25); // garage -> kitchen door
const DOOR_W_IN = 1.1;
const DOOR_HEAD_IN = 2.25;
const HALL_DOOR_X = GE * (HHL * 0.14);                // back room -> living doorway
const HALL_DOOR_W = 1.9;
// internal straight flight: 12 risers of FLOOR_H/12 = 0.2625 m, inside STEP_UP (0.38)
const RISERS = 12;
const RISE = FLOOR_H / RISERS;
const GOING = 0.27;
const ST_W = 1.4;
const ST_X = IN_FE - FE * (ST_W / 2);                 // flight centre, against the free end
const ST_Z0 = Z_SPLIT + S * 0.4;                      // foot
const ST_Z1 = ST_Z0 + S * RISERS * GOING;             // head
// the stairwell opens early enough that a climber keeps 1.78 m under the slab
const WELL_Z0 = frontZ + S * (HOUSE_DEPTH * 0.59);
// two-storey void over the living room (f-mGpZaLy5_hM-058: rail, then the street wall)
const VOID_X = FE * (HHL * 0.281);
const VOID_Z = frontZ + S * (HOUSE_DEPTH * 0.446);
const SLAB_T = 0.22;                                  // upper floor slab
const RAIL_IN = 1.0;                                  // internal balustrade
const UP_DOOR_W = 1.6;                                // deck -> upper floor doorway
const UP_DOOR_H = 2.1;
// garage wing, hollow: two street-facing bays per INTERIORS-TOPOLOGY s3
const GT = 0.25;                                      // garage wall thickness
const G_FLOOR = KERB_HEIGHT + 0.01;                   // level with the lawn plateau
const BAY_W = 2.4;
const BAY_H = 2.3;
const BAY_JAMB = (GARAGE_LEN - GARAGE_BAYS * BAY_W) / (GARAGE_BAYS + 1);
const OPEN_BAY = GARAGE_BAYS - 1;                     // the bay nearest the house stands open

const UP = new THREE.Vector3(0, 1, 0);
const NOROT = new THREE.Quaternion();

/**
 * Two faces built on ONE plane tie in the depth buffer and the rasteriser picks a
 * winner per pixel: clean from one viewpoint, a dither patch from the next. Every
 * dressed part below that used to share a plane with the structure it sits on now
 * stands TUCK off it - proud when it is the surface that should be seen, tucked
 * inside when the structure should. Meshes only; every collider keeps its nominal
 * box (`scripts/coplanar.mjs` lists the pairs, `--colliders` proves the boxes).
 */
const TUCK = 0.005;

/** The sweep: roof upper surface before the depth tilt, flat-ish then swooping. */
function baseY(x: number): number {
  const u = Math.min(1, Math.max(0, (x - LO_X) / (HI_X - LO_X)));
  return EAVE_Y + ROOF_T + ROOF_RISE * Math.pow(u, 1.6);
}
const roofTopY = (x: number, z: number): number => baseY(x) + TILT_K * (z - midZ);

/**
 * Interior |x| limit of the UPPER shell at this z, honouring the wrapped free-end
 * corner. A plain rectangle for the upper floor overhangs that curve by 0.75 m at the
 * yard corner - a tongue of slab sticking out of the elevation three metres up. The
 * floor is banded in z and clipped with this instead, and the SAME boxes are the
 * colliders, so mesh and collision cannot drift apart.
 */
function innerX(z: number): number {
  const ri = CORNER_R - WALL_T;
  const c1 = frontZ + S * CORNER_R;
  const c2 = backZ - S * CORNER_R;
  const d = S * (z - c1) < 0 ? Math.abs(z - c1)
    : S * (z - c2) > 0 ? Math.abs(z - c2) : 0;
  return d === 0 ? HHL - WALL_T : (HHL - CORNER_R) + Math.sqrt(Math.max(0, ri * ri - d * d));
}

/** [lo,hi] minus sorted cut intervals; used for floor bands and for wall apertures. */
function subtract(lo: number, hi: number, cuts: [number, number][]): [number, number][] {
  let spans: [number, number][] = [[lo, hi]];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [a, b] of spans) {
      if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }
      if (c0 > a) next.push([a, c0]);
      if (c1 < b) next.push([c1, b]);
    }
    spans = next;
  }
  return spans;
}

/** Sorted [min,max] from two unordered bounds. */
const span = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean =>
  Math.max(a0, b0) < Math.min(a1, b1) - 1e-6;

const inst =(geo: THREE.BufferGeometry, m: THREE.Material, n: number): THREE.InstancedMesh => {
  const im = new THREE.InstancedMesh(geo, m, n);
  im.castShadow = im.receiveShadow = true;
  return im;
};

/** Tilt a built geometry about a z pivot so every roof-borne part stays coplanar. */
function shear(m: THREE.Mesh, pivotZ: number): THREE.Mesh {
  const p = m.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + TILT_K * (p.getZ(i) - pivotZ));
  p.needsUpdate = true;
  m.geometry.computeVertexNormals();
  return m;
}

/**
 * Plan outline of the upper storey, running street face -> wrapped corner ->
 * end elevation -> wrapped corner -> yard face. The window band reuses it with a
 * shorter start/end so the glazing sits exactly on the wall it wraps.
 */
function outline(xs: number, xe: number, r: number, n: number): P2[] {
  const cx = FE * (HHL - r);
  const p: P2[] = [[xs, frontZ], [cx, frontZ]];
  const c1z = frontZ + S * r;
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2);
    p.push([cx + FE * r * Math.sin(t), c1z + OUT * r * Math.cos(t)]);
  }
  const c2z = backZ - S * r;
  p.push([FE * HHL, c2z]);
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2);
    p.push([cx + FE * r * Math.cos(t), c2z + S * r * Math.sin(t)]);
  }
  p.push([xe, backZ]);
  return p;
}

export const buildOrangeHouse: Builder = (ctx) => {
  const g = group('orange-house');
  const colliders: AABB[] = [];
  const mat = ctx.mat;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qj = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  const frameMat = mat.painted(PAL.houseCream, 0.6, 0.05);
  // Interior partitions do NOT share the exterior frame cream. frameMat still dresses
  // the window frames, jamb liners, rails and mullions - all of which are seen from
  // outside in daylight - so it cannot be repointed wholesale without recolouring the
  // street elevations. Only the partition leaves and headers move.
  const partMat = mat.interiorWall;

  /** Emit one InstancedMesh from collected rows. Panes never cast shadow. */
  const emit = (rows: Row[], m: THREE.Material, shadow: boolean) => {
    if (!rows.length) return;
    const im = inst(unit, m, rows.length);
    im.castShadow = shadow;
    rows.forEach((r, i) => im.setMatrixAt(i, m4.compose(
      v.set(r[3], r[4], r[5]), q.setFromAxisAngle(UP, r[6]), sc.set(r[0], r[1], r[2]))));
    g.add(im);
  };
  /** One box + optional honest collider in a single line; keeps dressing compact. */
  const put = (w: number, h: number, d: number, m: THREE.Material,
    x: number, y: number, z: number, solid = false): void => {
    g.add(box(w, h, d, m, x, y, z));
    if (solid) colliders.push(aabb(x, y, z, w, h, d));
  };

  // -------------------------------------------------- ground floor, walls + holes
  const openings: Opening[] = [];
  const wallRun = (
    along: 'x' | 'z', fixed: number, a: number, b: number, out: number, holes: Hole[],
    meshClip?: [number, number],
  ) => {
    const add = (p0: number, p1: number, y0: number, y1: number, solid: boolean) => {
      if (p1 - p0 < 0.02 || y1 - y0 < 0.02) return;
      const cy = (y0 + y1) / 2, L = p1 - p0, hh = y1 - y0;
      // `meshClip` bounds the MESH along the run (the collider keeps p0..p1): the end
      // walls ran the full depth and the front/back walls the full length, so every
      // corner square was two stucco boxes with all their faces tied.
      const m0 = meshClip ? Math.max(p0, meshClip[0]) : p0;
      const m1 = meshClip ? Math.min(p1, meshClip[1]) : p1;
      const c = (p0 + p1) / 2, mc = (m0 + m1) / 2, mL = m1 - m0;
      // A wall that reaches FLOOR_H would put its top face on the upper slab's top
      // (and the deck's): the mesh stops TUCK short, inside the slab where the slab
      // covers it and a shadow gap under the upper storey where it does not.
      const y1m = Math.abs(y1 - FLOOR_H) < 1e-6 ? y1 - TUCK : y1;
      const cym = (y0 + y1m) / 2, hhm = y1m - y0;
      if (along === 'x') {
        if (mL > 0.02) g.add(box(mL, hhm, WALL_T, mat.stuccoCream, mc, cym, fixed));
        if (solid) colliders.push(aabb(c, cy, fixed, L, hh, WALL_T));
      } else {
        if (mL > 0.02) g.add(box(WALL_T, hhm, mL, mat.stuccoCream, fixed, cym, mc));
        if (solid) colliders.push(aabb(fixed, cy, c, WALL_T, hh, L));
      }
    };
    let cur = Math.min(a, b);
    for (const h of [...holes].sort((p, r) => p.c - r.c)) {
      // Overlapping holes silently eat each other: the pier between them collapses to
      // nothing, and whichever hole is processed FIRST gets to lay its spandrel across
      // the other. That is how the front door ended up 0.59 m wide - a window centred
      // on a fraction of HOUSE_HALF_LEN slid on top of a door positioned at
      // HOUSE_HALF_LEN minus absolute terms when the house was re-proportioned, and a
      // 0.95 m window sill was laid across most of the doorway. It read as "this house
      // has no door" three probes later. Fail loudly instead.
      if (h.c - h.w / 2 < cur - 1e-6) {
        throw new Error(`[orange-house] overlapping holes on the ${along} wall at `
          + `fixed=${fixed.toFixed(2)}: a hole spanning ${(h.c - h.w / 2).toFixed(2)}..`
          + `${(h.c + h.w / 2).toFixed(2)} starts before the previous one ends at `
          + `${cur.toFixed(2)}. Space them apart - see holesAround().`);
      }
      add(cur, h.c - h.w / 2, 0, FLOOR_H, true);                    // pier (solid)
      // The spandrel under a sill is WALL. Leaving it hollow let the player walk
      // through every window and made the traverse door scan count one as a door.
      add(h.c - h.w / 2, h.c + h.w / 2, 0, h.sill, true);
      add(h.c - h.w / 2, h.c + h.w / 2, h.head, FLOOR_H, false);    // lintel, overhead
      openings.push({ ...h, along, fixed, out });
      cur = h.c + h.w / 2;
    }
    add(cur, Math.max(a, b), 0, FLOOR_H, true);
  };

  const DOOR: Omit<Hole, 'c'> = { w: 1.5, sill: 0, head: 2.35 };
  const WIN: Omit<Hole, 'c'> = { w: 2.1, sill: 0.95, head: 2.45 };
  // Door centres come from the layout contract now, so the yard builder can keep its
  // aprons clear of them. The canopy follows the door rather than the door following
  // the canopy - which is what it was doing when it was derived from CORNER_R.
  const porchX = H.frontDoorX;
  const backDoorX = H.backDoorX;

  /**
   * Lay a door plus as many windows as fit, centred in the wall left over on each side.
   *
   * The windows used to sit at their own fractions of HOUSE_HALF_LEN while the door sat
   * at HOUSE_HALF_LEN minus the corner radius and half the canopy - a mix of relative
   * and absolute that happened not to collide at the old 19.2 m house width and did
   * collide at the measured 17.6 m one. Deriving the windows FROM the door means the
   * two cannot cross however the house is re-proportioned.
   */
  const holesAround = (doorC: number): Hole[] => {
    const out: Hole[] = [{ c: doorC, ...DOOR }];
    const MARGIN = 0.55;                       // pier left at the house corner
    const PIER = 0.75;                         // minimum wall between two apertures
    for (const dir of [-1, 1] as const) {
      const from = doorC + dir * (DOOR.w / 2 + PIER);
      const to = dir < 0 ? -HHL + MARGIN : HHL - MARGIN;
      const run = Math.abs(to - from);
      const n = Math.floor((run + PIER) / (WIN.w + PIER));   // how many actually fit
      for (let i = 0; i < n; i++) {
        // centre the row of windows in the run so the piers come out even
        const used = n * WIN.w + (n - 1) * PIER;
        const start = from + dir * (run - used) / 2;
        out.push({ c: start + dir * (WIN.w / 2 + i * (WIN.w + PIER)), ...WIN });
      }
    }
    return out;
  };

  wallRun('x', GND_FRONT + S * WALL_T / 2, GE * HHL, FE * HHL, OUT, holesAround(porchX));
  wallRun('x', backZ + OUT * WALL_T / 2, GE * HHL, FE * HHL, S, holesAround(backDoorX));
  const endClip = span(IN_FRONT, IN_BACK);   // the end walls butt the front/back walls
  wallRun('z', FE * (HHL - WALL_T / 2), GND_FRONT, backZ, FE, [{ c: midZ, ...WIN }], endClip);
  // The garage-end wall carries the door from the GARAGE into the KITCHEN
  // (INTERIORS-TOPOLOGY s3.3, g-tB35IKluv0g-023: camera in the garage doorway looking
  // past the yellow units and the dining table into the living room).
  wallRun('z', GE * (HHL - WALL_T / 2), GND_FRONT, backZ, GE,
    [{ c: Z_GAR_DOOR, w: DOOR_W_IN, sill: 0, head: DOOR_HEAD_IN }], endClip);

  // -------------------------------------------------- ground-floor glazing
  // Every aperture was an empty cut: the street read straight through the house to
  // the back fence. Each window now carries a pane set back in a reveal behind a
  // cream frame with a cill, two mullions and a transom; doors get the frame only.
  const paneRows: Row[] = [];
  const frameRows: Row[] = [];
  for (const o of openings) {
    const hh = o.head - o.sill, cy = (o.sill + o.head) / 2;
    const faceN = o.fixed + o.out * WALL_T / 2;          // outer plane of this wall
    const rot = o.along === 'x' ? 0 : Math.PI / 2;
    const at = (rows: Row[], u: number, y: number, n: number, w: number, t: number, d: number) => {
      rows.push(o.along === 'x' ? [w, t, d, u, y, n, rot] : [w, t, d, n, y, u, rot]);
    };
    const frameN = faceN + o.out * (FRAME_D / 2 - 0.025);
    // The frame is 25 mm INTO the wall, so its jambs' inner faces lay on the piers'
    // reveals and its head's soffit on the lintel's: it overlaps the aperture by TUCK
    // instead, the way a real frame covers the reveal edge.
    at(frameRows, o.c, o.head + FRAME_W / 2 - TUCK, frameN, o.w + 2 * FRAME_W, FRAME_W, FRAME_D);
    for (const s of [-1, 1]) {
      at(frameRows, o.c + s * ((o.w + FRAME_W) / 2 - TUCK), cy, frameN, FRAME_W, hh, FRAME_D);
    }
    if (o.sill < 0.05) continue;                         // a door: frame, no glass
    const paneN = faceN - o.out * (REVEAL + PANE_T / 2);
    at(paneRows, o.c, cy, paneN, o.w - 0.015, hh - 0.015, PANE_T);
    at(frameRows, o.c, o.sill - 0.06, frameN + o.out * 0.03,
      o.w + 2 * FRAME_W, 0.12, FRAME_D + 0.06);          // projecting cill
    const barN = faceN - o.out * 0.035;                  // bars ride inside the reveal
    for (const s of [-1, 1]) at(frameRows, o.c + s * o.w / 6, cy, barN, 0.075, hh, 0.11);
    at(frameRows, o.c, o.sill + hh * 0.62, barN, o.w, 0.08, 0.11);
    for (const s of [-1, 1]) {   // jamb liners: visible reveal depth, doors keep 1.36 m clear
      at(frameRows, o.c + s * (o.w / 2 - 0.035), cy, faceN - o.out * 0.01, 0.07, hh, WALL_T * 0.85);
    }
  }

  // Deck -> upper floor doorway. This used to be a 0.55 m spandrel panel filling the
  // gap under the clerestory: it read as a door and no player could ever pass it. It is
  // now a real aperture cut out of the upper shell below (see `subtract` there), so the
  // external back stair is a genuine second route to the upper floor - which is the
  // single thing INTERIORS-TOPOLOGY s4.3 says our build was missing.
  const ddY = DECK_Y + UP_DOOR_H / 2;
  const ddZ = backZ + S * (WALL_T / 2 + 0.03);
  const DD_T = 0.15 + 2 * TUCK;   // 0.15 put its outer face on the clerestory rails' plane
  frameRows.push([UP_DOOR_W + 0.26, 0.14, DD_T, H.deckX, DECK_Y + UP_DOOR_H + 0.07 - TUCK, ddZ, 0]);
  for (const s of [-1, 1]) {
    frameRows.push([0.13, UP_DOOR_H, DD_T, H.deckX + s * (UP_DOOR_W + 0.13) / 2, ddY, ddZ, 0]);
  }

  emit(paneRows, mat.glass, false);
  emit(frameRows, frameMat, true);

  const gndCz = (GND_FRONT + backZ) / 2;
  const gndD = HOUSE_DEPTH - RECESS;
  g.add(slab(HHL * 2, 0.12, gndD, mat.concrete, 0, -0.09, gndCz));
  // (the ground-floor ceiling is now the UPPER FLOOR SLAB, built further down: it has
  //  to be a real walkable surface with a void and a stairwell cut out of it, and it
  //  has to be honest, so the mesh and the collider are literally the same boxes.)
  // rubble base course where the house meets the ground: painted() geometry only,
  // no colliders (inside the wall-collider line) — wants a proper veneer material later.
  const stoneM = mat.painted(PAL.rubbleStone, 0.9, 0);
  const skirt = (z: number, c0: number, c1: number): void => {
    g.add(box(c1 - c0, 0.4, 0.08, stoneM, (c0 + c1) / 2, 0.2, z));
    g.add(box(c1 - c0, 0.06, 0.1, mat.painted(PAL.rubbleMortar, 0.9, 0), (c0 + c1) / 2, 0.43, z));
  };
  // the street skirt ends TUCK short of the garage corner: at GE * HHL its end face
  // was the garage return wall's inner face, seen from inside the garage
  skirt(GND_FRONT + OUT * 0.05, GE * (HHL - TUCK), porchX - 0.85); skirt(GND_FRONT + OUT * 0.05, porchX + 0.85, FE * HHL);
  skirt(backZ + S * 0.05, GE * HHL, backDoorX - 0.85); skirt(backZ + S * 0.05, backDoorX + 0.85, FE * HHL);
  // ==================================================== ground floor, interior
  // Plan per INTERIORS-TOPOLOGY s2.1/s6.1. Street half: KITCHEN at the garage end and
  // LIVING ROOM at the free end, joined by ONE wide cased opening and not a door
  // (f-mGpZaLy5_hM-005). Yard half: BACK ROOM at the garage end, STAIR HALL at the free
  // end. Both real door lanes - porchX on the street face, backDoorX on the yard face -
  // stay clear end to end, and the doorway in the cross partition sits on the line
  // between them so the house is a through-route, not a pair of pockets.
  const darkIn = mat.timberDark, topIn = mat.painted(PAL.concreteDark, 0.6, 0.05);
  const oliveM = mat.painted(PAL.treeLeaf, 0.94, 0);        // olive living-room wall
  const carpetM = mat.painted(PAL.interiorTeal, 0.96, 0);   // grey-green carpet
  const yellowM = mat.painted(PAL.hazardYellow, 0.72, 0);   // the yellow kitchen
  const orangeM = mat.painted(PAL.terracotta, 0.8, 0);
  const glowM = mat.emissive(PAL.sunColor);

  /** Partition along x at fixed z, with cut-outs; colliders only where the leaf is. */
  // Partition MESHES stop TUCK under FLOOR_H so their tops sit inside the slab above
  // instead of on its top face (same interiorWall map, different UVs: a dither strip
  // across the upstairs floor over every wall). Colliders keep the full height.
  const PART_TOP = FLOOR_H - TUCK;
  const partX = (z: number, a: number, b: number, cuts: [number, number][], head: number): void => {
    const [lo, hi] = span(a, b);
    for (const [p0, p1] of subtract(lo, hi, cuts)) {
      if (p1 - p0 < 0.06) continue;
      g.add(box(p1 - p0, PART_TOP, 0.14, partMat, (p0 + p1) / 2, PART_TOP / 2, z));
      colliders.push(aabb((p0 + p1) / 2, FLOOR_H / 2, z, p1 - p0, FLOOR_H, 0.14));
    }
    for (const [c0, c1] of cuts) {   // header over the opening - overhead, never solid
      if (head < FLOOR_H - 0.02) {
        g.add(box(c1 - c0, PART_TOP - head, 0.14, partMat, (c0 + c1) / 2, (head + PART_TOP) / 2, z));
      }
    }
  };
  /** The same, running along z at fixed x. */
  const partZ = (x: number, a: number, b: number, cuts: [number, number][], head: number): void => {
    const [lo, hi] = span(a, b);
    for (const [p0, p1] of subtract(lo, hi, cuts)) {
      if (p1 - p0 < 0.06) continue;
      g.add(box(0.14, PART_TOP, p1 - p0, partMat, x, PART_TOP / 2, (p0 + p1) / 2));
      colliders.push(aabb(x, FLOOR_H / 2, (p0 + p1) / 2, 0.14, FLOOR_H, p1 - p0));
    }
    for (const [c0, c1] of cuts) {
      if (head < FLOOR_H - 0.02) {
        g.add(box(0.14, PART_TOP - head, c1 - c0, partMat, x, (head + PART_TOP) / 2, (c0 + c1) / 2));
      }
    }
  };

  partZ(X_SPLIT, IN_FRONT, Z_SPLIT, [span(Z_CASED - S * CASED_W / 2, Z_CASED + S * CASED_W / 2)], CASED_HEAD);
  partX(Z_SPLIT, IN_GE, VOID_X, [span(HALL_DOOR_X - HALL_DOOR_W / 2, HALL_DOOR_X + HALL_DOOR_W / 2)], DOOR_HEAD_IN);

  // ---- internal straight flight, 12 risers of 0.2625 m against the free-end wall.
  // f-mGpZaLy5_hM-049: one straight flight, grey-green carpet, YELLOW painted nosings,
  // a posted timber balustrade open over the room on one side and plain wall the other.
  const railX = ST_X - FE * (ST_W / 2);              // the open side
  const stTread: Row[] = [], stNose: Row[] = [], stRail: Row[] = [], stPost: Row[] = [];
  for (let i = 0; i < RISERS; i++) {
    const top = (i + 1) * RISE;
    const zc = ST_Z0 + S * (i + 0.5) * GOING;
    stTread.push([ST_W, top, GOING, ST_X, top / 2, zc, 0]);
    colliders.push(aabbSlab(ST_X, 0, zc, ST_W, top, GOING));
    // the nosing stands TUCK proud of the tread top and of the riser face - both were
    // on the tread's own planes (yellow on grey-green, every step)
    stNose.push([ST_W, 0.05, 0.09, ST_X, top - 0.025 + TUCK, zc - S * (GOING / 2 - 0.045 + TUCK), 0]);
    // Balustrade: one bay per tread, so the collider is exactly the mesh run and the
    // barrier climbs with the flight instead of being one wrong AABB over a slope.
    stRail.push([0.1, RAIL_IN, GOING, railX, top + RAIL_IN / 2, zc, 0]);
    colliders.push(aabb(railX, top + RAIL_IN / 2, zc, 0.1, RAIL_IN, GOING));
    // 0.12, not 0.11: the upper-floor rail below is 0.11 on the same line, so at the
    // stair head the two shared both side faces
    if (i % 3 === 0) stPost.push([0.12, RAIL_IN + 0.1 + TUCK, 0.12, railX, top + (RAIL_IN + 0.1 - TUCK) / 2, zc, 0]);
  }
  emit(stTread, carpetM, true);
  emit(stNose, yellowM, false);
  emit(stRail, mat.painted(PAL.timber, 0.88, 0), true);
  emit(stPost, darkIn, true);
  // red wall-art disc at the head of the flight (f-mGpZaLy5_hM-049)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20),
    mat.painted(PAL.trailerTrim, 0.6, 0));
  disc.rotation.x = Math.PI / 2;
  disc.position.set(ST_X, FLOOR_H + 1.5, IN_BACK - S * 0.05);
  g.add(disc);

  // ---- UPPER FLOOR SLAB. Banded in z and clipped to the wrapped free-end corner by
  // innerX(); the boxes pushed here are BOTH the mesh and the colliders, so the floor
  // a player stands on is exactly the floor they can see. Two holes: the two-storey
  // void over the living room, and the stairwell.
  const BAND = 0.4;
  const nBand = Math.max(1, Math.round(HOUSE_DEPTH / BAND));
  const slabRows: Row[] = [];
  const [voidZ0, voidZ1] = span(frontZ, VOID_Z);
  const [wellZ0, wellZ1] = span(WELL_Z0, ST_Z1);
  const voidCut = span(VOID_X, FE * (HHL + 1));
  const wellCut = span(railX, FE * (HHL + 1));
  for (let b = 0; b < nBand; b++) {
    const za = frontZ + S * b * BAND, zb = frontZ + S * (b + 1) * BAND;
    const [z0, z1] = span(za, zb);
    const [x0, x1] = span(IN_GE, FE * Math.min(innerX(za), innerX(zb)));
    const cuts: [number, number][] = [];
    if (overlaps(z0, z1, voidZ0, voidZ1)) cuts.push(voidCut);
    if (overlaps(z0, z1, wellZ0, wellZ1)) cuts.push(wellCut);
    cuts.sort((p, q) => p[0] - q[0]);
    // The last band ran to backZ, the back wall's OUTER face, so from the yard the
    // slab's edge was a 0.22 m band on the stucco's plane. The MESH stops at the inner
    // face; the collider keeps the nominal band (the wall is solid there anyway).
    const [inA, inB] = span(frontZ, IN_BACK);
    const mz0 = Math.max(z0, inA), mz1 = Math.min(z1, inB);
    for (const [a, c] of subtract(x0, x1, cuts)) {
      if (c - a < 0.06) continue;
      if (mz1 - mz0 > 0.01) {
        slabRows.push([c - a, SLAB_T, mz1 - mz0, (a + c) / 2, FLOOR_H - SLAB_T / 2, (mz0 + mz1) / 2, 0]);
      }
      colliders.push(aabb((a + c) / 2, FLOOR_H - SLAB_T / 2, (z0 + z1) / 2, c - a, SLAB_T, z1 - z0));
    }
  }
  emit(slabRows, mat.interiorWall, true);

  /**
   * A 1.0 m balustrade run on the upper floor. The collider is the nominal box; the
   * MESH may be cut back by `trim0` / `trim1` at its two ends (a run that starts on
   * the upper wall line had its foot on the wall's soffit plane; one that ends on the
   * stair rail had its end face on the rail's). The dark cap is TUCK taller than 0.08
   * so its top clears the stair rail's top, and a run along x rides TUCK higher so the
   * two caps that meet at a corner share neither lid nor foot.
   */
  const upRail = (x0: number, z0: number, x1: number, z1: number, trim0 = 0, trim1 = 0): void => {
    const [a0, a1] = span(x0, x1), [b0, b1] = span(z0, z1);
    const alongX = a1 - a0 > b1 - b0;
    const [m0, m1] = alongX ? [a0 + trim0, a1 - trim1] : [b0 + trim0, b1 - trim1];
    const w = alongX ? m1 - m0 : 0.11, d = alongX ? 0.11 : m1 - m0;
    const mx = alongX ? (m0 + m1) / 2 : (a0 + a1) / 2, mz = alongX ? (b0 + b1) / 2 : (m0 + m1) / 2;
    const lift = alongX ? TUCK : 0, capH = 0.08 + TUCK;
    g.add(box(w, RAIL_IN - 0.08 + lift, d, mat.painted(PAL.timber, 0.88, 0), mx, FLOOR_H + (RAIL_IN - 0.08 + lift) / 2, mz));
    g.add(box(w + 0.06, capH, d + 0.06, darkIn, mx, FLOOR_H + RAIL_IN - 0.08 + lift + capH / 2, mz));
    const cx = (a0 + a1) / 2, cz = (b0 + b1) / 2;
    colliders.push(aabb(cx, FLOOR_H + RAIL_IN / 2, cz, Math.max(a1 - a0, 0.11), RAIL_IN, Math.max(b1 - b0, 0.11)));
  };
  // the void rail starts under the upper front wall's overhang: its first 0.14 m of
  // foot lay on that wall's soffit plane
  upRail(VOID_X, frontZ, VOID_X, VOID_Z, S < 0 ? 0 : 0.14, S < 0 ? 0.14 : 0);
  upRail(VOID_X, VOID_Z, FE * innerX(VOID_Z), VOID_Z);
  upRail(railX, WELL_Z0, railX, ST_Z1, S < 0 ? TUCK : 0, S < 0 ? 0 : TUCK);
  upRail(railX, WELL_Z0, FE * innerX(WELL_Z0), WELL_Z0);

  // ---- ground-floor dressing. Every collider below is off both door lanes and off
  // the back-door -> HALL_DOOR_X -> front-door line.
  // Kitchen: yellow wall and base units along the garage-end wall, split around the
  // garage door; orange counter top, wall cupboards, fridge (f-aICKIbuo8zQ-148).
  const kX = IN_GE - GE * 0.31;
  for (const [ka, kb] of subtract(...span(IN_FRONT, Z_SPLIT), [span(Z_GAR_DOOR - 0.85, Z_GAR_DOOR + 0.85)])) {
    const L = kb - ka;
    if (L < 0.5) continue;
    put(0.62, 0.9, L - 0.25, yellowM, kX, 0.45, (ka + kb) / 2, true);
    g.add(box(0.7, 0.06, L - 0.25, topIn, kX, 0.93, (ka + kb) / 2));
    g.add(box(0.36, 0.72, L - 0.45, yellowM, IN_GE - GE * 0.18, 1.95, (ka + kb) / 2));
  }
  put(0.68, 1.75, 0.72, mat.painted(PAL.capsuleWhite, 0.55, 0.1), kX, 0.875, Z_SPLIT - S * 0.55, true);
  const tblX = X_SPLIT + GE * 2.4, tblZ = Z_SPLIT - S * 1.9;
  const tblTop = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 20), topIn);
  tblTop.position.set(tblX, 0.74, tblZ); g.add(tblTop);
  const tblPed = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.18, 0.72, 10), darkIn);
  tblPed.position.set(tblX, 0.37, tblZ); g.add(tblPed);
  colliders.push(aabb(tblX, 0.37, tblZ, 0.6, 0.74, 0.6));
  const chairAt = (cx: number, cz: number, ry: number): void => {
    const shellM = mat.painted(PAL.applianceRed, 0.7, 0);
    const seat = box(0.45, 0.07, 0.45, shellM, cx, 0.46, cz); seat.rotation.y = ry; g.add(seat);
    const back = box(0.45, 0.5, 0.07, shellM, cx - Math.sin(ry) * 0.2, 0.75, cz - Math.cos(ry) * 0.2);
    back.rotation.y = ry; g.add(back);
    const trumpet = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.2, 0.44, 10), darkIn);
    trumpet.position.set(cx, 0.22, cz); g.add(trumpet);
    colliders.push(aabb(cx, 0.4, cz, 0.5, 0.8, 0.5));
  };
  chairAt(tblX - GE * 1.05, tblZ, Math.PI / 2);
  chairAt(tblX, tblZ + S * 1.05, 0);
  chairAt(tblX + GE * 1.05, tblZ, -Math.PI / 2);
  // Living room: olive wall with tan panel strips, orange three-seat sofa against the
  // free-end wall, egg chair, low table, white shag rug, tall closet, TV, starburst
  // clock (g-1icNQzMgLUM-106/-116).
  g.add(box(0.05, 2.1, Math.abs(Z_SPLIT - IN_FRONT) - 0.4, oliveM, IN_FE - FE * 0.04, 1.35, (IN_FRONT + Z_SPLIT) / 2));
  for (let p = 0; p < 4; p++) {
    g.add(box(0.06, 2.1 + 2 * TUCK, 0.34, darkIn, IN_FE - FE * 0.05, 1.35, IN_FRONT + S * (0.9 + p * 1.15)));
  }
  const sofaX = IN_FE - FE * 0.48, sofaZ = (IN_FRONT + Z_SPLIT) / 2;
  put(0.85, 0.42, 2.2, mat.painted(PAL.terracotta, 0.9, 0), sofaX, 0.21, sofaZ, true);
  g.add(box(0.28, 0.45, 2.2, orangeM, IN_FE - FE * 0.2, 0.62, sofaZ));
  g.add(box(0.7, 0.05, 1.5, mat.painted(PAL.capsuleWhite, 0.98, 0), sofaX - FE * 1.4, 0.03, sofaZ));
  const eggAt = (ex: number, ez: number, yBase: number): void => {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.44, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      mat.painted(PAL.capsuleWhite, 0.6, 0));
    shell.position.set(ex, yBase + 0.62, ez); g.add(shell);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.22, 0.42, 12), darkIn);
    stem.position.set(ex, yBase + 0.21, ez); g.add(stem);
    colliders.push(aabbSlab(ex, yBase, ez, 0.8, 0.95, 0.8));
  };
  eggAt(sofaX - FE * 2.1, sofaZ - S * 1.4, 0.16);
  put(0.6, FLOOR_H, 1.3, mat.painted(PAL.timber, 0.85, 0), IN_FE - FE * 0.35, FLOOR_H / 2, IN_FRONT + S * 0.7, true);
  put(0.5, 0.55, 1.1, darkIn, sofaX - FE * 3.2, 0.275, IN_FRONT + S * 0.85, true);
  g.add(box(0.42, 0.42, 0.7, mat.windowDark, sofaX - FE * 3.2, 0.78, IN_FRONT + S * 0.85));
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), mat.painted(PAL.hazardYellow, 0.5, 0.2));
  clock.rotation.x = Math.PI / 2; clock.position.set(sofaX - FE * 2.6, 2.15, IN_FRONT - S * 0.04); g.add(clock);
  // Back room: yellow walls, a chair, a wall clock (f-aICKIbuo8zQ-179).
  for (const [ya, yb] of subtract(...span(IN_GE, VOID_X), [[backDoorX - 1.05, backDoorX + 1.05]])) {
    if (yb - ya < 0.3) continue;
    g.add(box(yb - ya, 1.9, 0.05, yellowM, (ya + yb) / 2, 1.3, IN_BACK - S * 0.04));
  }
  chairAt(backDoorX - GE * 2.0, IN_BACK - S * 1.0, 0);
  // Ceiling diffusers - emissive only, never a scene light (PASS 82 light-set freeze).
  for (const [lx, lz] of [[X_SPLIT - GE * 2.0, Z_CASED], [HALL_DOOR_X, Z_SPLIT + S * 2.6]] as P2[]) {
    g.add(box(0.1, 0.1, 0.1, darkIn, lx, FLOOR_H - 0.12, lz));
    g.add(box(0.6, 0.06, 0.6, glowM, lx, FLOOR_H - 0.2, lz));
  }
  for (const [px, pz] of [[tblX, tblZ], [sofaX - FE * 1.4, sofaZ]] as P2[]) {
    g.add(box(0.04, 0.6, 0.04, darkIn, px, FLOOR_H - 0.35, pz));
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), glowM);
    globe.position.set(px, FLOOR_H - 0.72, pz); g.add(globe);
  }
  const floorAt = (m: THREE.Material, x0: number, x1: number, z0: number, z1: number): void => {
    const [a0, a1] = span(x0, x1), [b0, b1] = span(z0, z1);
    g.add(slab(a1 - a0 - 0.2, 0.05, b1 - b0 - 0.2, m, (a0 + a1) / 2, 0.115, (b0 + b1) / 2));
  };
  floorAt(carpetM, X_SPLIT, IN_FE, IN_FRONT, Z_SPLIT);          // living room
  floorAt(carpetM, VOID_X, IN_FE, Z_SPLIT, IN_BACK);            // stair hall
  floorAt(mat.painted(PAL.pavingWarm, 0.6, 0), IN_GE, X_SPLIT, IN_FRONT, Z_SPLIT);  // kitchen
  floorAt(mat.painted(PAL.dirt, 0.9, 0), IN_GE, VOID_X, Z_SPLIT, IN_BACK);          // back room

  // ==================================================== upper storey
  // Shell: hollow. The whole upper volume used to be ONE solid AABB, so the map had no
  // second floor at all - the deck, the deck door and the stair all led into rock.
  // Walls run FLOOR_H -> clerestory sill and clerestory head -> the sheared eave; the
  // band between them is the glazing the exterior code already draws. The deck doorway
  // is subtracted from BOTH the wall boxes and the collider boxes from one span list.
  const upRing = outline(GE * HHL, GE * HHL, CORNER_R, 5);
  const upWall: Row[] = [];
  const COL_STEP = 0.55;
  for (let i = 0; i < upRing.length; i++) {
    const [x0, z0] = upRing[i];
    const [x1, z1] = upRing[(i + 1) % upRing.length];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const ux = dx / len, uz = dz / len;
    const a = Math.atan2(-uz, ux);
    const closing = i === upRing.length - 1;         // the garage-end wall: no clerestory
    // deck doorway, projected onto this segment
    const cuts: [number, number][] = [];
    if (!closing && Math.abs(dz) < 1e-6 && Math.abs(z0 - backZ) < 1e-6) {
      const tA = (H.deckX - UP_DOOR_W / 2 - x0) * ux, tB = (H.deckX + UP_DOOR_W / 2 - x0) * ux;
      const c0 = Math.max(0, Math.min(tA, tB)), c1 = Math.min(len, Math.max(tA, tB));
      if (c1 > c0) cuts.push([c0, c1]);
    }
    // Each segment is WALL_T/2 longer than its chord so the mitres close, which puts a
    // WALL_T x WALL_T square of two boxes at every vertex: bottoms at FLOOR_H, tops at
    // BAND_SILL and bottoms at BAND_HEAD tied there (the porch soffit, the sill line).
    // Odd segments step TUCK off each of those planes; the collider chunks below are
    // built from the nominal spans and do not move.
    const dip = (i % 2) * TUCK;
    const put3 = (t0: number, t1: number, y0: number, y1: number): void => {
      if (t1 - t0 < 0.02 || y1 - y0 < 0.03) return;
      const tm = (t0 + t1) / 2;
      upWall.push([t1 - t0 + WALL_T * 0.5, y1 - y0, WALL_T,
        x0 + ux * tm, (y0 + y1) / 2, z0 + uz * tm, a]);
    };
    const headYAt = (t: number): number => EAVE_Y + TILT_K * (z0 + uz * t - midZ);
    for (const [t0, t1] of subtract(0, len, cuts)) {
      const hy = headYAt((t0 + t1) / 2);
      if (closing) put3(t0, t1, FLOOR_H - dip, hy);
      else { put3(t0, t1, FLOOR_H - dip, BAND_SILL - dip); put3(t0, t1, BAND_HEAD + dip, hy); }
      // colliders: chunked so an arc chord is a tight AABB, not one huge diagonal box
      const n = Math.max(1, Math.ceil((t1 - t0) / COL_STEP));
      const st = (t1 - t0) / n;
      for (let k = 0; k < n; k++) {
        const tm = t0 + (k + 0.5) * st;
        colliders.push(aabb(x0 + ux * tm, (FLOOR_H + headYAt(tm)) / 2, z0 + uz * tm,
          st * Math.abs(ux) + WALL_T * Math.abs(uz), headYAt(tm) - FLOOR_H,
          st * Math.abs(uz) + WALL_T * Math.abs(ux)));
      }
    }
    for (const [c0, c1] of cuts) {                    // head over the doorway
      // between the neighbours' WALL_T/4 extensions, not over them: overlapped, the
      // head's faces lay on theirs from the yard and above
      const hy = headYAt((c0 + c1) / 2), tm = (c0 + c1) / 2;
      upWall.push([c1 - c0 - WALL_T * 0.5, hy - (FLOOR_H + UP_DOOR_H), WALL_T,
        x0 + ux * tm, (FLOOR_H + UP_DOOR_H + hy) / 2, z0 + uz * tm, a]);
    }
  }
  emit(upWall, mat.stuccoTerracotta, true);

  // ---- upper rooms (INTERIORS-TOPOLOGY s6.2). Terracotta front room with the picture
  // window, a rear sitting room behind it, and the gallery landing running from the
  // void rail round past the built-in shelving to the stair head and the deck door.
  const UP_X = GE * (HHL * 0.078);
  const UP_Z = frontZ + S * (HOUSE_DEPTH * 0.464);
  const upPartZ = (x: number, a: number, b: number, cuts: [number, number][]): void => {
    const [lo, hi] = span(a, b);
    for (const [p0, p1] of subtract(lo, hi, cuts)) {
      if (p1 - p0 < 0.06) continue;
      g.add(box(0.14, UPPER_H - 0.25, p1 - p0, mat.stuccoTerracotta, x,
        FLOOR_H + (UPPER_H - 0.25) / 2, (p0 + p1) / 2));
      colliders.push(aabbSlab(x, FLOOR_H, (p0 + p1) / 2, 0.14, UPPER_H - 0.25, p1 - p0));
    }
  };
  const doorA = span(frontZ + S * (HOUSE_DEPTH * 0.18), frontZ + S * (HOUSE_DEPTH * 0.286));
  const doorB = span(frontZ + S * (HOUSE_DEPTH * 0.67), frontZ + S * (HOUSE_DEPTH * 0.777));
  upPartZ(UP_X, frontZ, IN_BACK, [doorA, doorB].sort((p, q) => p[0] - q[0]));
  {
    const [q0, q1] = span(IN_GE, UP_X);
    g.add(box(q1 - q0, UPPER_H - 0.25, 0.14, mat.stuccoTerracotta, (q0 + q1) / 2,
      FLOOR_H + (UPPER_H - 0.25) / 2, UP_Z));
    colliders.push(aabbSlab((q0 + q1) / 2, FLOOR_H, UP_Z, q1 - q0, UPPER_H - 0.25, 0.14));
  }
  // dark timber floor + patterned rugs upstairs (f-mGpZaLy5_hM-051/-053)
  g.add(box(Math.abs(UP_X - IN_GE) - 0.3, 0.03, HOUSE_DEPTH - 0.6, darkIn,
    (IN_GE + UP_X) / 2, FLOOR_H + 0.02, midZ));
  g.add(box(2.6, 0.03, 1.9, mat.painted(PAL.trailerTrim, 0.92, 0),
    (IN_GE + UP_X) / 2, FLOOR_H + 0.04, frontZ + S * (HOUSE_DEPTH * 0.28)));
  // built-in geometric open shelving - the only waist-high hard cover upstairs (s6.2)
  const shZ = frontZ + S * (HOUSE_DEPTH * 0.59);
  put(0.45, 2.2, 2.0, mat.painted(PAL.terracottaDk, 0.85, 0), UP_X - GE * 0.3, FLOOR_H + 1.1, shZ, true);
  for (let r = 0; r < 4; r++) {
    g.add(box(0.4, 0.05, 1.9, darkIn, UP_X - GE * 0.32, FLOOR_H + 0.35 + r * 0.55, shZ));
  }
  // orange chaise + egg chair in the rear sitting room (f-mGpZaLy5_hM-045)
  put(1.9, 0.44, 0.75, orangeM, (IN_GE + UP_X) / 2, FLOOR_H + 0.22,
    frontZ + S * (HOUSE_DEPTH * 0.82), true);
  eggAt(IN_GE - GE * 1.3, frontZ + S * (HOUSE_DEPTH * 0.72), FLOOR_H);
  for (const lz of [frontZ + S * (HOUSE_DEPTH * 0.28), frontZ + S * (HOUSE_DEPTH * 0.82)]) {
    g.add(box(0.55, 0.05, 0.55, glowM, (IN_GE + UP_X) / 2, FLOOR_H + UPPER_H - 0.35, lz));
  }
  g.add(box(0.5, 0.05, 0.5, glowM, H.deckX, FLOOR_H + UPPER_H - 0.35, IN_BACK - S * 1.2));

  // -------------------------------------------------- butterfly roof + cream upstand
  const NS = 30;
  const rp: P2[] = [];
  for (let i = 0; i <= NS; i++) {
    const x = HI_X + (LO_X - HI_X) * (i / NS);
    rp.push([x, baseY(x) - ROOF_T]);
  }
  for (let i = NS; i >= 0; i--) {
    const x = HI_X + (LO_X - HI_X) * (i / NS);
    rp.push([x, baseY(x)]);
  }
  const roof = extrude(rp, ROOF_HALF_Z * 2, mat.roofWhite);
  roof.position.z = midZ;
  g.add(shear(roof, 0));

  const ux0 = GE * HHL, ux1 = FE * (HHL - CORNER_R);
  const up: P2[] = [];
  for (let i = 0; i <= NS; i++) up.push([ux0 + (ux1 - ux0) * (i / NS), EAVE_Y - 0.04]);
  for (let i = NS; i >= 0; i--) {
    const x = ux0 + (ux1 - ux0) * (i / NS);
    up.push([x, baseY(x) - ROOF_T]);
  }
  const upstand = extrude(up, HOUSE_DEPTH, mat.roofWhite);
  upstand.position.z = midZ;
  g.add(shear(upstand, 0));

  // -------------------------------------------------- grey concrete pilaster
  const pilX = GE * HHL * 0.66;
  const pilZ = frontZ + OUT * (0.3 - (0.3 + RECESS) / 2);
  const pilD = 0.3 + RECESS;
  const pilTop = roofTopY(pilX, pilZ) - ROOF_T - 0.02;
  g.add(box(1.15, pilTop, pilD, mat.concrete, pilX, pilTop / 2, pilZ));
  colliders.push(aabb(pilX, FLOOR_H / 2, pilZ, 1.15, FLOOR_H, pilD));

  // -------------------------------------------------- clerestory band, wrapped corner
  // Now that the upper storey is hollow this band is REAL glazing in a real opening,
  // not a decal on a solid block, so it runs the full ring (front face, both wrapped
  // corners, free end, back face) and sits on the OUTER wall face - buried at the wall
  // centreline it was invisible from inside and the reveal read as a slot. The deck
  // doorway is subtracted from it with the same span list the wall uses.
  const bandRing = outline(GE * HHL, GE * HHL, CORNER_R, 5);
  const bandRuns: { x0: number; z0: number; x1: number; z1: number }[] = [];
  for (let i = 0; i < bandRing.length - 1; i++) {
    const [x0, z0] = bandRing[i];
    const [x1, z1] = bandRing[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const ux = dx / len, uz = dz / len;
    const cuts: [number, number][] = [];
    if (Math.abs(dz) < 1e-6 && Math.abs(z0 - backZ) < 1e-6) {
      const tA = (H.deckX - UP_DOOR_W / 2 - x0) * ux, tB = (H.deckX + UP_DOOR_W / 2 - x0) * ux;
      // TUCK wider than the doorway: the pane and rail ends lay on the door jambs'
      // inner faces (glass over cream, at the one door a player uses upstairs)
      const c0 = Math.max(0, Math.min(tA, tB) - TUCK), c1 = Math.min(len, Math.max(tA, tB) + TUCK);
      if (c1 > c0) cuts.push([c0, c1]);
    }
    for (const [t0, t1] of subtract(0, len, cuts)) {
      if (t1 - t0 < 0.05) continue;
      bandRuns.push({ x0: x0 + ux * t0, z0: z0 + uz * t0, x1: x0 + ux * t1, z1: z0 + uz * t1 });
    }
  }
  const nSeg = bandRuns.length;
  // mat.glass, not mat.windowDark: with the storey hollow this band is the only way
  // to see out of the upper floor, and every window-camping position in
  // INTERIORS-TOPOLOGY s4.2 depends on it being transparent from the inside.
  const glass = inst(unit, mat.glass, nSeg);
  const rails = inst(unit, frameMat, nSeg * 3);
  const bandCy = (BAND_SILL + BAND_HEAD) / 2;
  const bandH = BAND_HEAD - BAND_SILL;
  const TRANSOM_Y = BAND_SILL + bandH * 0.62;   // splits the band so it is not one void
  const stations: { x: number; z: number; a: number }[] = [];
  const FACE = WALL_T / 2;                      // outer plane of the upper wall
  let ri = 0;
  for (let i = 0; i < nSeg; i++) {
    const { x0, z0, x1, z1 } = bandRuns[i];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const a = Math.atan2(-uz, ux);
    const nx = -uz, nz = ux;                       // outward face normal
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    q.setFromAxisAngle(UP, a);
    glass.setMatrixAt(i, m4.compose(
      v.set(mx + nx * (FACE - 0.05), bandCy, mz + nz * (FACE - 0.05)), q, sc.set(len, bandH, 0.09)));
    // the sill rail's top and the head rail's soffit were the wall boxes' own planes;
    // each now overlaps its wall by TUCK (a rail sits ON a sill, not flush with it)
    for (const [yy, th] of [[BAND_HEAD + 0.07 - TUCK, 0.14], [BAND_SILL - 0.07 + TUCK, 0.14],
      [TRANSOM_Y, 0.11]] as P2[]) {
      rails.setMatrixAt(ri++, m4.compose(
        v.set(mx + nx * (FACE + 0.02), yy, mz + nz * (FACE + 0.02)), q, sc.set(len, th, 0.17)));
    }
    const nm = Math.max(1, Math.round(len / 0.62));
    for (let k = i === 0 ? 0 : 1; k <= nm; k++) {
      const t = k / nm;
      stations.push({
        x: x0 + dx * t + nx * (FACE + 0.03), z: z0 + dz * t + nz * (FACE + 0.03), a,
      });
    }
  }
  g.add(glass, rails);

  // every fourth station is a wide pier, so the band reads as bays, not one ribbon
  const mullions = inst(new THREE.BoxGeometry(0.08, bandH + 0.14, 0.13), frameMat, stations.length);
  stations.forEach((s, i) => {
    const pier = i % 4 === 0;
    mullions.setMatrixAt(i, m4.compose(v.set(s.x, bandCy, s.z),
      q.setFromAxisAngle(UP, s.a), sc.set(pier ? 3.1 : 1, 1, pier ? 1.6 : 1)));
  });
  g.add(mullions);

  // -------------------------------------------------- panelising fins
  const finN = 7;
  const fins = inst(unit, mat.painted(PAL.terracottaDk, 0.85, 0), finN * 2);
  let fi = 0;
  for (let f = 0; f < finN; f++) {
    const x = ux0 + (ux1 - ux0) * ((f + 0.5) / finN);
    for (const face of [[frontZ, OUT], [backZ, S]] as [number, number][]) {
      // a fin landing across the deck doorway stands as a terracotta post in the
      // middle of the opening - the frame showed exactly that before this guard
      if (face[0] === backZ && Math.abs(x - H.deckX) < UP_DOOR_W / 2 + 0.25) continue;
      const head = EAVE_Y + TILT_K * (face[0] - midZ);
      // TUCK lower than the wall it stands against: a fin's foot on the recess soffit
      // was on the upper wall's own bottom plane
      fins.setMatrixAt(fi++, m4.compose(
        v.set(x, (FLOOR_H + head) / 2 - TUCK, face[0] + face[1] * 0.075),
        NOROT, sc.set(0.16, head - FLOOR_H, 0.18)));
    }
  }
  g.add(fins);

  // -------------------------------------------------- solar field on the low sweep
  const SNX = 6, SNZ = 4;
  const solar = inst(new THREE.BoxGeometry(1.2, 0.07, 1.4), mat.solar, SNX * SNZ);
  const sx0 = FE * HHL * 0.17, sx1 = FE * HHL * 0.875;
  const sz0 = midZ - HOUSE_DEPTH * 0.26, sz1 = midZ + HOUSE_DEPTH * 0.26;
  let pi = 0;
  for (let ix = 0; ix < SNX; ix++) {
    const x = sx0 + (sx1 - sx0) * (ix / (SNX - 1));
    const slope = (baseY(x + 0.25) - baseY(x - 0.25)) / 0.5;
    q.setFromUnitVectors(UP, v.set(-slope, 1, -TILT_K).normalize());
    qj.setFromAxisAngle(UP, (ctx.rand() - 0.5) * 0.03);
    for (let iz = 0; iz < SNZ; iz++) {
      const z = sz0 + (sz1 - sz0) * (iz / (SNZ - 1));
      solar.setMatrixAt(pi++, m4.compose(
        v.set(x, roofTopY(x, z) + 0.06, z), qj.clone().multiply(q), sc.set(1, 1, 1)));
    }
  }
  g.add(solar);

  // -------------------------------------------------- garage wing + barrel vaults
  const gx = H.garageX;
  const gz = frontZ + S * (GARAGE_DEPTH / 2);
  // HOLLOW. This wing used to be one solid box - mesh AND collider - so the garage was
  // not a room at all and the bays were paint on a wall. INTERIORS-TOPOLOGY s3 is
  // emphatic: the bays face the STREET, there are TWO of them with one shut behind a
  // ribbed sectional door, and the garage is enterable from the street AND from the
  // kitchen. It is also the best ground-floor firing position on the map
  // (f-FKQOEO-1ceE-090 puts a Guardian turret in exactly this spot).
  const xOuter = gx + GE * (GARAGE_LEN / 2);          // free end of the wing
  const xHouse = gx - GE * (GARAGE_LEN / 2);          // shared with the house
  const gBack = frontZ + S * GARAGE_DEPTH;
  const bayCx = (d: number): number =>
    xOuter - GE * (BAY_JAMB + BAY_W / 2 + d * (BAY_W + BAY_JAMB));
  const cream = mat.stuccoCream;
  /**
   * `proud` grows the MESH by that much on every face; the collider keeps the nominal
   * box. The end wall gets it: the back wall and the street piers both ran out to the
   * wing's corner, so their end faces lay on the end wall's outer face and their
   * street/yard faces on its end faces - 0.25 x 3.65 m of stucco on stucco at both
   * corners, and their tops on its top. Proud by TUCK, the end wall alone is seen.
   */
  const wallBox = (w: number, h: number, d: number, x: number, yBase: number, z: number, proud = 0): void => {
    g.add(slab(w + 2 * proud, h + proud, d + 2 * proud, cream, x, yBase, z));
    colliders.push(aabbSlab(x, yBase, z, w, h, d));
  };
  const [gzA, gzB] = span(frontZ, gBack);
  wallBox(GT, GARAGE_H, gzB - gzA, xOuter - GE * (GT / 2), 0, (gzA + gzB) / 2, TUCK);
  wallBox(GARAGE_LEN, GARAGE_H, GT, gx, 0, gBack - S * (GT / 2));
  // short return closing the gap between the garage face and the recessed house face
  wallBox(GT, GARAGE_H, Math.abs(GND_FRONT - frontZ) + GT,
    xHouse - GE * (GT / 2), 0, (frontZ + GND_FRONT) / 2, TUCK);   // proud: the front wall's end face was on its inner face
  // street face: piers between the bays, header over them
  const [fwA, fwB] = span(xOuter, xHouse);
  const bayCuts: [number, number][] = [];
  for (let d = 0; d < GARAGE_BAYS; d++) bayCuts.push(span(bayCx(d) - BAY_W / 2, bayCx(d) + BAY_W / 2));
  bayCuts.sort((p, q) => p[0] - q[0]);
  const gFz = frontZ + S * (GT / 2);
  for (const [p0, p1] of subtract(fwA, fwB, bayCuts)) {
    if (p1 - p0 < 0.05) continue;
    wallBox(p1 - p0, GARAGE_H, GT, (p0 + p1) / 2, 0, gFz);
  }
  for (const [c0, c1] of bayCuts) {
    wallBox(c1 - c0, GARAGE_H - BAY_H, GT, (c0 + c1) / 2, BAY_H, gFz);
  }
  // concrete floor, top level with the house's own ground plane - no step at the
  // kitchen door and none at the bay mouth
  // Floor finish sits at 0.165: ground.ts tops its lawn plateau at KERB_HEIGHT+0.001
  // and that plateau is what the player actually stands on indoors (the probe settles
  // at y = 0.15 in every room), so a finish laid at y = 0 is buried and invisible.
  g.add(slab(GARAGE_LEN - GT * 2, 0.05, GARAGE_DEPTH - GT * 2, mat.concrete, gx, 0.115, gz));
  // roof slab INSIDE the wall ring and TUCK under the wall tops: full-size it put its
  // four edges on the walls' outer faces and its top on theirs
  g.add(slab(GARAGE_LEN - 2 * TUCK, 0.12, GARAGE_DEPTH - 2 * TUCK, cream, gx, GARAGE_H - 0.12 - TUCK, gz));

  const br = GARAGE_LEN / (2 * GARAGE_BAYS);
  const bgeo = new THREE.CylinderGeometry(br, br, GARAGE_DEPTH, 16, 1, false,
    Math.PI / 2, Math.PI);
  bgeo.rotateX(Math.PI / 2);
  const barrels = inst(bgeo, mat.barrelRoof, GARAGE_BAYS);
  for (let i = 0; i < GARAGE_BAYS; i++) {
    barrels.setMatrixAt(i, m4.compose(
      v.set(gx - GARAGE_LEN / 2 + br * (2 * i + 1), GARAGE_H, gz), NOROT, sc.set(1, 1, 1)));
  }
  g.add(barrels);

  // garage face: one open bay, one shut behind a ribbed pale-green sectional door.
  // f-FKQOEO-1ceE-060 ribs/cabinets/pillar stripe; f-FKQOEO-1ceE-205 open bay;
  // f-aICKIbuo8zQ-030/-055/-115 canopy + banner.
  const doorMat = mat.painted(PAL.interiorMint, 0.7, 0);   // pale-green sectional
  const ribs = inst(unit, mat.painted(PAL.capsuleWhite, 0.7, 0), 8);
  let bi = 0;
  for (let d = 0; d < GARAGE_BAYS; d++) {
    const dxp = bayCx(d);
    if (d === OPEN_BAY) continue;                     // genuinely open - no dark pane
    g.add(box(BAY_W, BAY_H, 0.1, doorMat, dxp, BAY_H / 2, frontZ));
    colliders.push(aabb(dxp, BAY_H / 2, frontZ, BAY_W, BAY_H, 0.1));
    for (let r = 0; r < 8; r++) {
      ribs.setMatrixAt(bi++, m4.compose(
        v.set(dxp, BAY_H * ((r + 0.5) / 8), frontZ + OUT * 0.055), NOROT,
        sc.set(BAY_W - 0.1, 0.05, 0.04)));
    }
  }
  g.add(ribs);
  // flat canopy slab on slim columns; pale painted() stands in for glazing (wants glass later).
  g.add(box(GARAGE_LEN + 0.8, 0.12, 3.2, mat.painted(PAL.glass, 0.35, 0.1), gx, GARAGE_H - 0.35, frontZ + OUT * 2.1));
  for (const cx of [gx - GARAGE_LEN / 2 - 0.2, gx + GARAGE_LEN / 2 + 0.2]) {
    put(0.14, GARAGE_H - 0.41, 0.14, mat.steel, cx, (GARAGE_H - 0.41) / 2, frontZ + OUT * 3.5, true);
  }
  g.add(box(3.6, 0.6, 0.05, mat.signText({ text: 'Hail, wayfarer! Tour the homes of tomorrow', color: PAL.signMaroon, background: PAL.houseCream, aspect: 6 }), gx, 2.9, frontZ + OUT * 3.68));
  const pierX = (bayCx(OPEN_BAY) + bayCx(OPEN_BAY - 1 < 0 ? 1 : OPEN_BAY - 1)) / 2;
  g.add(box(0.34, 0.45, 0.05, mat.signText({ text: '13', color: PAL.signMaroon, background: PAL.houseCream, aspect: 0.75 }), pierX, 1.7, frontZ + OUT * 0.06));
  // one 0.4 m band + pinstripe + plaque on the numbered pier ONLY (f-FKQOEO-1ceE-060, f-FKQOEO-1ceE-190) — nowhere else in this house.
  g.add(box(0.46, 0.4, 0.04, mat.painted(PAL.terracotta, 0.8, 0), pierX, 2.52, frontZ + OUT * 0.05));
  g.add(box(0.46, 0.05, 0.04, mat.painted(PAL.hazardYellow, 0.6, 0), pierX, 2.76, frontZ + OUT * 0.05));
  g.add(box(0.4, 0.24, 0.03, mat.signText({ text: 'Wash bay — leave it tidy', color: PAL.signTeal, background: PAL.houseCream, aspect: 1.7 }), pierX, 1.02, frontZ + OUT * 0.05));

  // ---- garage interior (f-FKQOEO-1ceE-070/-089/-090, g-tB35IKluv0g-011): a wall of
  // white built-in cupboards, exposed rustic beams, a strip light and a ball hanging in
  // a net. NO pool - that is the WHITE house, and mixing them was the single most
  // likely way to get this wrong (INTERIORS-TOPOLOGY s3).
  const cupX = xOuter - GE * (GT + 0.3);
  put(0.6, 2.05, GARAGE_DEPTH - 2.2, mat.painted(PAL.capsuleWhite, 0.6, 0.05), cupX, 1.025, gz, true);
  for (let c = 0; c < 4; c++) {
    g.add(box(0.05, 1.85, 0.95, darkIn, cupX - GE * 0.32, 1.0,
      gz - S * (GARAGE_DEPTH / 2 - 1.8 - c * 1.1)));
  }
  for (let bm = 0; bm < 4; bm++) {
    g.add(box(GARAGE_LEN - GT * 2, 0.2, 0.16, mat.timberDark, gx, GARAGE_H - 0.32,
      gz - S * (GARAGE_DEPTH / 2 - 1.2 - bm * 1.7)));
  }
  g.add(box(2.2, 0.07, 0.22, glowM, gx, GARAGE_H - 0.48, gz));
  g.add(box(0.03, 0.95, 0.03, darkIn, bayCx(OPEN_BAY), GARAGE_H - 1.0, gz + S * 1.9));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10),
    mat.painted(PAL.applianceRed, 0.8, 0));
  ball.position.set(bayCx(OPEN_BAY), GARAGE_H - 1.6, gz + S * 1.9);
  g.add(ball);
  // steel locker bank against the back wall - cover inside the garage, off the
  // drive-in lane and off the kitchen door
  put(1.4, 1.9, 0.62, mat.steel, gx + GE * 1.3, 0.95, gBack - S * 0.62, true);

  // Every timberDark post shares one InstancedMesh. (The 'garage service door' that
  // used to be the first row is gone: it was a 1.0 x 2.1 panel with no collider
  // standing in the middle of the open bay - you walked straight through a door.)
  const postRows: Row[] = [];

  // -------------------------------------------------- porch canopy (cantilevered eave)
  const canZ = frontZ + OUT * (CANOPY_OUT / 2 - 0.06);
  g.add(box(CANOPY_LEN, 0.22, CANOPY_OUT + 0.12, mat.roofWhite,
    porchX, CANOPY_Y - 0.11, canZ));
  g.add(box(CANOPY_LEN + 2 * TUCK, 0.36, 0.12, mat.roofWhite,
    porchX, CANOPY_Y - 0.18 + TUCK, frontZ + OUT * CANOPY_OUT));   // fascia lip proud of the slab, returned past its ends

  // NT04: the eave cantilevers over a CONCRETE DECK, not bare lawn. ground.ts tops
  // the lawn plateau at KERB_HEIGHT + 0.001, so the slab rises from y=0 and stands
  // proud of it; its collider gives the player a step, well inside STEP_UP.
  const pdW = CANOPY_LEN + 1.2;
  const pdZ = frontZ + OUT * (CANOPY_OUT / 2 - 0.15);
  g.add(slab(pdW, DECK_T, CANOPY_OUT, mat.concrete, porchX, 0, pdZ));
  colliders.push(aabbSlab(porchX, 0, pdZ, pdW, DECK_T, CANOPY_OUT));

  // -------------------------------------------------- rear deck at upper-floor level
  const dX = DECK_X;
  const dOut = DECK_OUT_Z;
  const dCz = DECK_CZ;
  // The deck MESH stops at the wall face: carried 0.1 m into the house its top lay on
  // the slab's and the wall tops' plane and its end face on the free-end wall's.
  // The collider keeps the nominal box (the wall is solid where it overlaps).
  g.add(box(DECK_LEN, 0.18, DECK_OUT, mat.deckBoards, dX, DECK_Y - 0.09, backZ + S * (DECK_OUT / 2)));
  colliders.push(aabb(dX, DECK_Y - 0.09, dCz, DECK_LEN, 0.18, DECK_OUT + 0.1));
  const dL = dX - DECK_LEN / 2, dR = dX + DECK_LEN / 2;
  // The deck's four legs used to flank a gap at the OUTER edge's centre, because that
  // is where the old yard-ward flight left. That gap has moved to the free-end edge,
  // so the legs space evenly again.
  const deckLegX = [dL + 0.3, dX - DECK_LEN * 0.18, dX + DECK_LEN * 0.18, dR - 0.3];
  for (const px of deckLegX) {
    postRows.push([0.2, DECK_Y - 0.18, 0.2, px, (DECK_Y - 0.18) / 2, dOut + OUT * 0.18, 0]);
  }

  // The balustrade is continuous except where the flight meets it: the gap is now in
  // the FREE-END edge (x = STAIR_HEAD_X), spanning exactly the flight's own width in
  // z, and the outer yard-ward edge is unbroken.
  const gapLo = dCz - STAIR_W / 2, gapHi = dCz + STAIR_W / 2;
  const edgeLo = Math.min(backZ, dOut), edgeHi = Math.max(backZ, dOut);
  const dNear = dX - FE * (DECK_LEN / 2);   // the garage-ward end, opposite the flight
  const runs: [number, number, number, number][] = [
    [dL, dOut, dR, dOut],
    [dNear, backZ, dNear, dOut],
    [STAIR_HEAD_X, edgeLo, STAIR_HEAD_X, gapLo],
    [STAIR_HEAD_X, gapHi, STAIR_HEAD_X, edgeHi],
  ];
  const railY = DECK_Y + RAIL_H;
  const bal: { x: number; z: number; a: number }[] = [];
  for (const [x0, z0, x1, z1] of runs) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const a = Math.atan2(-dz / len, dx / len);
    q.setFromAxisAngle(UP, a);
    const top = box(len, 0.09, 0.11, mat.painted(PAL.timber, 0.88, 0),
      (x0 + x1) / 2, railY, (z0 + z1) / 2);
    top.quaternion.copy(q);
    g.add(top);
    const n = Math.max(1, Math.round(len / 0.16));
    for (let k = 1; k < n; k++) {   // the ends are posts; a baluster inside one tied its foot
      const t = k / n;
      bal.push({ x: x0 + dx * t, z: z0 + dz * t, a });
    }
  }
  const balusters = inst(new THREE.BoxGeometry(0.05, RAIL_H - 0.07, 0.05),
    mat.painted(PAL.timberDark, 0.9, 0), bal.length);
  bal.forEach((b, i) => {
    balusters.setMatrixAt(i, m4.compose(
      v.set(b.x, DECK_Y + (RAIL_H - 0.07) / 2, b.z),
      q.setFromAxisAngle(UP, b.a), sc.set(1, 1, 1)));
  });
  g.add(balusters);
  // [dNear, dOut] is one of [dL, dOut] / [dR, dOut] whichever way the flight runs -
  // the same post was built twice, every face on every face
  const railPosts: P2[] = [[dL, dOut], [dR, dOut], [dNear, backZ],
    [STAIR_HEAD_X, gapLo], [STAIR_HEAD_X, gapHi], [STAIR_HEAD_X, backZ]];
  for (const [nx, nz] of railPosts) {
    // a post on the wall line straddles deck and wall; its foot sits TUCK into the
    // deck so it is not on the upper wall's own bottom plane
    const dz = Math.abs(nz - backZ) < 1e-6 ? TUCK : 0;
    postRows.push([0.14, RAIL_H + 0.1 + dz, 0.14, nx, DECK_Y + (RAIL_H + 0.1 - dz) / 2, nz, 0]);
  }

  // -------------------------------------------------- exterior timber stair
  // Flight ALONG the back wall, in the deck's own depth band, leaving the free-end
  // edge and descending in FE. See the ORANGE_STAIR_FOOTPRINT block at the top of
  // this file for the evidence; the white house's flight is this one point-reflected.
  const topX = STAIR_HEAD_X, botX = STAIR_FOOT_X;
  const footY = STAIR_FOOT_Y, yAt = (t: number): number => DECK_Y + (footY - DECK_Y) * t;
  const slopeA = Math.atan2(DECK_Y - footY, STAIR_RUN);
  const stringHyp = Math.hypot(STAIR_RUN, DECK_Y - footY);
  const railM = mat.painted(PAL.timber, 0.88, 0);
  // stringers TUCK proud of the flight's width: at STAIR_W / 2 their outer faces were
  // the tread ends' planes, deck boards dithering with dark timber down both sides
  for (const sz of [dCz - (STAIR_W / 2 - 0.05 + TUCK), dCz + (STAIR_W / 2 - 0.05 + TUCK)]) {
    // A box is symmetric about its own centre, so -FE * slopeA gives the right LINE
    // for either hand; the tread boxes below carry the direction.
    const st = box(stringHyp + 0.3, 0.34, 0.1,
      mat.timberDark, (topX + botX) / 2, (DECK_Y + footY) / 2 - 0.1, sz);
    st.rotation.z = -FE * slopeA;
    g.add(st);
    const hr = box(stringHyp + 0.2, 0.08, 0.08,
      railM, (topX + botX) / 2, (DECK_Y + footY) / 2 + RAIL_H, sz + Math.sign(sz - dCz) * 0.05);
    hr.rotation.z = -FE * slopeA;
    g.add(hr);
  }
  for (const t of [0.08, 0.5, 0.92]) {
    for (const sz of [dCz - STAIR_W / 2, dCz + STAIR_W / 2]) {
      postRows.push([0.07, RAIL_H, 0.07, topX + (botX - topX) * t, yAt(t) + RAIL_H / 2, sz, 0]);
    }
  }
  emit(postRows, mat.timberDark, true);
  // CLIMBABLE. This flight used to carry two big AABBs - a 2.0 m block and a 1.18 m
  // block - clipped to a headroom line, so from the yard a player faced a 1.18 m step
  // (STEP_UP is 0.38) and above it three metres of nothing. It was decoration: the
  // "second way up" INTERIORS-TOPOLOGY s4.3 calls the most important thing about these
  // houses did not exist. One solid box PER TREAD now, 14 risers over 2.95 m = 0.211 m
  // a step, and the deck top is another 0.21 m from the last tread. The undercroft
  // (x inboard of the deck's free-end edge) is untouched - only the flight's own
  // footprint past that edge is solid, which is what a closed-string stair does.
  const stepRows: Row[] = [];
  for (let i = 0; i < STEPS; i++) {
    const y = yAt((i + 1) / STEPS);
    const xc = topX + FE * (i + 0.5) * STAIR_GOING;
    stepRows.push([STAIR_GOING, y, STAIR_W, xc, y / 2, dCz, 0]);
    colliders.push(aabbSlab(xc, 0, dCz, STAIR_GOING, y, STAIR_W));
  }
  emit(stepRows, mat.deckBoards, true);
  // deck balustrade and the posts carrying the deck: honest, not walk-through
  for (const [x0, z0, x1, z1] of runs) {
    const [ra0, ra1] = span(x0, x1), [rb0, rb1] = span(z0, z1);
    colliders.push(aabb((ra0 + ra1) / 2, DECK_Y + RAIL_H / 2, (rb0 + rb1) / 2,
      Math.max(0.12, ra1 - ra0), RAIL_H, Math.max(0.12, rb1 - rb0)));
  }
  for (const px of deckLegX) {
    colliders.push(aabbSlab(px, 0, dOut + OUT * 0.18, 0.2, DECK_Y - 0.18, 0.2));
  }
  // -------------------------------------------------- exterior close-up detail
  // Gutters ride the constant-height garage eaves (no straight gutter can follow
  // the butterfly sweep); downpipes pin the garage corners and the free-end back
  // corner. Number plate is paint, porch lights are emissive - no scene lights.
  const steelM = mat.steel, chromeM = mat.chrome;
  put(GARAGE_LEN, 0.1, 0.12, steelM, gx, GARAGE_H - 0.02, gz - GARAGE_DEPTH / 2);
  put(GARAGE_LEN, 0.1, 0.12, steelM, gx, GARAGE_H - 0.02, gz + GARAGE_DEPTH / 2);
  put(0.09, GARAGE_H, 0.09, steelM, gx - GARAGE_LEN / 2 + 0.15, GARAGE_H / 2, gz + GARAGE_DEPTH / 2 + 0.08);
  put(0.09, GARAGE_H, 0.09, steelM, gx + GARAGE_LEN / 2 - 0.15, GARAGE_H / 2, gz - GARAGE_DEPTH / 2 - 0.08);
  put(0.1, EAVE_Y, 0.1, steelM, FE * (HHL + 0.05), EAVE_Y / 2, backZ + S * 0.12);
  put(0.55, 0.75, 0.16, topIn, porchX + 1.6, 1.5, GND_FRONT + OUT * 0.08, true);
  put(0.5, 0.35, 0.12, steelM, GE * HHL * 0.55, 2.65, backZ + S * 0.06);
  put(0.5, 0.35, 0.12, steelM, FE * HHL * 0.5, 2.65, backZ + S * 0.06);
  put(0.4, 0.25, 0.05, mat.painted(PAL.signMaroon, 0.5, 0.1), porchX - 1.25, 1.7, GND_FRONT + OUT * 0.03);
  put(0.05, 0.24, 0.04, chromeM, porchX + 0.55, 1.05, GND_FRONT + OUT * 0.05);
  put(0.05, 0.24, 0.04, chromeM, backDoorX + 0.55, 1.05, backZ + S * 0.05);
  put(0.05, 0.24, 0.04, chromeM, gx + GARAGE_LEN / 2 - 1.0, 1.05, frontZ + OUT * 0.05);
  g.add(slab(1.7, 0.09, 0.7, mat.concrete, porchX, 0, GND_FRONT + OUT * 0.35));
  colliders.push(aabbSlab(porchX, 0, GND_FRONT + OUT * 0.35, 1.7, 0.09, 0.7));
  g.add(slab(1.7, 0.09, 0.7, mat.concrete, backDoorX, 0, backZ + S * 0.35));
  colliders.push(aabbSlab(backDoorX, 0, backZ + S * 0.35, 1.7, 0.09, 0.7));
  const porchGlow = mat.emissive(PAL.sunColor);
  put(0.12, 0.2, 0.12, porchGlow, porchX + 0.95, 2.0, GND_FRONT + OUT * 0.1);
  put(0.2, 0.05, 0.18, steelM, porchX + 0.95, 2.14, GND_FRONT + OUT * 0.1);
  put(0.12, 0.2, 0.12, porchGlow, backDoorX - 0.95, 2.0, backZ + S * 0.1);
  put(0.2, 0.05, 0.18, steelM, backDoorX - 0.95, 2.14, backZ + S * 0.1);

  return { group: g, colliders };
};
