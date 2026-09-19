/**
 * NUKETOWN 2025 - GROUND
 *
 * Every horizontal surface in the map: the desert floor, the concrete surround,
 * the street and its off-map tail, the central turning circle,
 * kerbs, pavements, lawns, back yards, garage aprons and the perimeter.
 *
 * The town stands on a TIGHT paved apron in open desert. The apron runs only
 * APRON_MARGIN past the bounds, and ends on a RAGGED edge rather than a ruled
 * rectangle - far enough out that the berm and the fences hide it from inside
 * the map, near enough that the aerial reads as a test town in the desert
 * rather than an architectural model on a white table.
 *
 * -------------------------------------------------------------- y ladder
 * Nothing shares a y with anything it overlaps. Abutting (edge-to-edge)
 * surfaces MAY share a y - only overlapping footprints need separating.
 *
 *   0.000  desert floor .................... dirt     (abuts the apron and the tail)
 *   0.000  desert fringe ................... dirt     (abuts the ragged edge)
 *   0.000  base apron ...................... paving   (ragged, inside the fringe)
 *   0.030  road strip ...................... asphalt  (apron rect -> bulb centre)
 *   0.030  desert road tail (slab top) ..... asphalt  (apron rect -> ROAD_TAIL_X)
 *   0.044  turning-head disc ............... asphalt  (sits over the strip end)
 *   0.058  manhole covers .................. painted steel
 *   0.072  painted centre line + bulb ring . painted white (over road/head, clear of covers)
 *   0.086  gutter lines + drain gratings ... painted asphaltLight/steel (offset footprints)
 *   0.100  tyre scuffs + oil marks ......... painted dark (over the bulb asphalt)
 *   0.138  circular kerb + circular pavement          (overlap the straight run)
 *   0.140  straight kerb + straight pavement = KERB_HEIGHT
 *   0.141  front lawns, frontage corner pads, house band, back yards
 *   0.144  house interior floors ........... concrete (over the lawn pad)
 *   0.146  garage aprons ................... concrete (overlay lawn + head pavement)
 *   0.154  paving joints/cracks, dropped kerbs, tactile pads, utility covers
 *           (14 mm over the kerb/pavement plateau; joints skip the driveway spans
 *           and the dropped-kerb quads abut the aprons, so nothing overlaps T_DRIVE)
 *   0.000..0.550  out-of-bounds perimeter berm
 *
 * A rung has to clear the DEPTH BUFFER, not just the rung below. With 24 bits,
 * near 0.08 and far 1400, the resolvable step is about z^2 * 7.5e-7 m: 7 mm at
 * 100 m, 17 mm at 150 m. The aerial reads the street from 85-115 m, so the old
 * 8 mm road rung was already inside the noise and the map only had to move for
 * the asphalt to break out in paving-coloured stipple. The road rungs are now
 * >= 14 mm apart, and the three y=0 surfaces never overlap at all: apron and
 * fringe are cut from one contour, and the desert is cut around the road tail.
 * The PLATEAU rungs are still inside the noise and do fight at aerial range -
 * the 3 mm between a garage apron and the lawn under it puts a wedge of green
 * dither on the white house's drive at ~95 m. Raising T_DRIVE alone would lift
 * the cars off it: vehicles.ts hardcodes KERB_HEIGHT + 0.004 to track it, so
 * that pair has to move together.
 *
 * Collider tops all sit at KERB_HEIGHT (or the pad's own top) - the player
 * controller derives floor height from collider tops, so the whole plateau is
 * collided even though it is only a 0.14 m step. Everything at y=0 is already
 * groundUnder()'s default and needs none.
 *
 * Every raised surface is a SLAB (box) rising from y=0, never a floating
 * plane, so the 0.14 m plateau edge is always closed by its own side face.
 *
 * The turning circle is centred on x=0: a single road stem runs off-map
 * at -x, and the east side is bulb tangent + driveway apron, not a road.
 */
import * as THREE from 'three';
import type { AABB, BuildResult, Builder } from '../core/kit';
import { aabb, aabbSlab, box, group, slab } from '../core/kit';
import { PAL } from '../core/palette';
import {
  BACK_FENCE, BOUND_X_MAX, BOUND_X_MIN, BOUND_Z, FRONT_LAWN_OUTER, GARAGE_DEPTH,
  GARAGE_LEN, HEAD_CENTER_X, HEAD_RADIUS, HOUSES, HOUSE_BACK, HOUSE_HALF_LEN,
  KERB_HEIGHT, KERB_WIDTH,
  PAVEMENT_OUTER, ROAD_HALF_WIDTH, ROAD_X_MAX, ROAD_X_MIN, YARD_X_MAX, YARD_X_MIN,
} from '../core/layout';

// ---------------------------------------------------------------- y ladder
const Y_BASE = 0.0;
const Y_ROAD = 0.030;                // 30 mm over the apron: resolves out to 200 m
const Y_HEAD = 0.044;
const Y_MANHOLE = 0.058;
const Y_LINE = 0.072;                // painted centre dashes + bulb circulation ring
const Y_GUTTER = 0.086;              // gutter/camber lines + drain gratings (offset)
const Y_SCUFF = 0.100;               // tyre scuffs + oil marks on the bulb
const Y_PAVE_MARK = 0.154;           // paving joints/cracks, dropped kerbs, tactile pads
const T_ARC = KERB_HEIGHT - 0.002; // circular kerb + circular pavement ring (overlaps straight run)
const T_PAVE = KERB_HEIGHT;          // straight kerb + straight pavement
const T_LAWN = KERB_HEIGHT + 0.001;  // lawns and yards, flush with the pavement
const T_FLOOR = KERB_HEIGHT + 0.004; // house interior floor, over the lawn pad
const T_DRIVE = KERB_HEIGHT + 0.006; // garage aprons ride over whatever is beneath

// ---------------------------------------------------------------- tiling
// Shared textures carry a fixed `repeat`, so world-consistent tiling has to come
// from the geometry's UVs. These are metres of world per one UV unit, picked so
// paving slabs land near 1.2 m and mow stripes near 1.2 m.
const UV_PAVING = 67.2;
const UV_ASPHALT = 40.0;
const UV_LAWN = 96.0;
const UV_FLAT = 1.0;                 // materials with no map

// ---------------------------------------------------------------- derived plan
/**
 * The nominal paving rectangle: bounds + APRON_MARGIN. Tight on purpose. The
 * berm, the back fences and the boundary fence hide the edge from every
 * ground-level view but two - the -x street mouth, and the two gaps the skyline
 * leaves in its pavilion row - and from those it is 15 m or more away.
 *
 * The concrete does not reach that rectangle: RAGGED_* pulls the edge back by a
 * multi-scale wobble, so the paving runs out between 14.8 and 21.4 m past the
 * bounds and the desert bites into it irregularly. Harmonics are whole numbers
 * of waves per perimeter, so the edge closes instead of stepping at the corner.
 */
const APRON_MARGIN = 22.0;
const APRON_X_MIN = BOUND_X_MIN - APRON_MARGIN;
const APRON_X_MAX = BOUND_X_MAX + APRON_MARGIN;
const APRON_Z = BOUND_Z + APRON_MARGIN;
const RAGGED_MEAN = 3.4;
const RAGGED_MIN = 0.6;              // never 0: the fringe must stay a closed ring
const RAGGED_MAX = 7.2;
const EDGE_STEP = 2.5;               // metres of apron edge per outline sample
const RAGGED_WAVES: [number, number][] = [[7, 2.0], [17, 1.3], [41, 0.7]];

/** Desert reach. The skyline rings its mountains at 300-500 m; the floor has to
 *  run well past them, and the fog saturates long before it ends. */
const DESERT_R = 900.0;
/** The road tail runs until the haze and the skyline's city band swallow it. */
const ROAD_TAIL_X = BOUND_X_MIN - 640.0;

const JOIN = 0.05;                   // overlap at the straight/curved junction
const DRIVE_FLARE = 0.6;             // apron is a little wider than the garage
const ARC_SEGS = 64;
const PERIM_H = 0.55;
const PERIM_W = 0.6;
/**
 * Out-of-bounds shell height. This shell is a BACKSTOP, not the map's border.
 *
 * Until 2026-09-18 it WAS the border: 12 m of collider behind a 0.55 m berm, so a
 * player walking west out of the front lawns, or out through one of the back-fence
 * gameplay holes, was stopped in open ground by nothing they could see. That is the
 * defect the owner named ("make the borders of the map much clearer rather than any
 * kind of invisible walls").
 *
 * surround.ts now stands a visible test-site fence 0.55 m INSIDE these faces on the
 * west and on both back faces, and the east is closed by yards.ts's boundary fence at
 * ROAD_X_MAX + 0.6, so the shell should never be the thing a player touches. Verified
 * with scripts/_perimeter.mjs: 0 of 20 boundary stop points ended on the shell.
 *
 * If you move a boundary, move the visible barrier with it - and if you punch a hole in
 * a fence that currently keeps the player off one of these faces (the east one is the
 * exposed case), give that face a visible barrier first.
 */
const WALL_H = 12.0;
const WALL_T = 1.2;
const MANHOLE_R = 0.42;
/** Black steel gate closing the -x carriageway mouth: full 2.2 m leaf. */
const GATE_H = 2.2;
const GATE_BAR_STEP = 0.32;
/** Twin-head verge lamps: plinth + ~5 m steel column, arms reaching roadward. */
const LAMP_PLINTH = 0.5;
const LAMP_H = 5.0;
const LAMP_ARM = 1.5;
const LAMP_SPLAY = 0.42;
/** Verge furniture line all stands on the pavement, just inside the lawn edge. */
const VERGE_Z = PAVEMENT_OUTER - 0.4;
const RING_SECTORS = 32;             // AABBs approximating the bulb's kerb + pavement
const RING_SAMPLES = 4;              // arc samples per sector when fitting each AABB

/** Outer radius of the ring of pavement around the bulb. */
const HEAD_PAVE_R = HEAD_RADIUS + (PAVEMENT_OUTER - ROAD_HALF_WIDTH);

/** x where the bulb's kerb line crosses the straight kerb line. */
const KERB_JOIN_X =
  HEAD_CENTER_X - Math.sqrt(HEAD_RADIUS * HEAD_RADIUS - ROAD_HALF_WIDTH * ROAD_HALF_WIDTH);
/** x where the bulb's pavement edge crosses the straight pavement edge. */
const PAVE_JOIN_X =
  HEAD_CENTER_X - Math.sqrt(HEAD_PAVE_R * HEAD_PAVE_R - PAVEMENT_OUTER * PAVEMENT_OUTER);

/**
 * The ring overlaps the frontage on the circle side: past this x the lawn
 * band would land on the turning head's pavement, so the front lawns stop here.
 */
const LAWN_X_MAX = PAVE_JOIN_X;

/**
 * ...which leaves a wedge of frontage between the lawn edge and the circle
 * that the ring only partly covers. Two paving pads fill it, each sized so its
 * corner nearest the bulb still clears the kerb (r >= HEAD_RADIUS + KERB_WIDTH).
 * When the yard edge sits outside the kerb circle the far pad spans the full
 * frontage depth instead of stepping in to a crossing that is not there.
 */
const BULB_KERB_R = HEAD_RADIUS + KERB_WIDTH;
const CORNER_X = HEAD_CENTER_X - Math.sqrt(BULB_KERB_R * BULB_KERB_R - PAVEMENT_OUTER * PAVEMENT_OUTER);
const CORNER_Z = Math.max(
  PAVEMENT_OUTER,
  Math.sqrt(Math.max(0, BULB_KERB_R * BULB_KERB_R - (HEAD_CENTER_X - YARD_X_MAX) * (HEAD_CENTER_X - YARD_X_MAX))),
);

/** The strip runs under the disc to ROAD_X_MAX (the bulb's east tangent) with no seam. */
const ROAD_STRIP_X_MAX = Math.max(ROAD_X_MAX, HEAD_CENTER_X);

/** Angular gap in the ring where the road stem enters, centred on -x. */
const GAP_HALF = Math.asin(ROAD_HALF_WIDTH / HEAD_RADIUS);
const ARC_SPAN = 2 * (Math.PI - GAP_HALF);
const ARC_START = GAP_HALF - Math.PI;

/**
 * The ring ends on a RADIAL cut, which swings away from the straight road edge
 * as it runs outward - so the straight pavement has to overlap past its own
 * tangent point to reach that cut. This is the far end of the cut, at the
 * pavement's inner edge.
 */
const RING_CUT_X = HEAD_CENTER_X - (ROAD_HALF_WIDTH + KERB_WIDTH) / Math.tan(GAP_HALF);
const PAVE_END_X = Math.max(PAVE_JOIN_X, RING_CUT_X) + JOIN;

// ---------------------------------------------------------------- helpers

/** Ground never casts - it only receives. */
function flat(m: THREE.Mesh): THREE.Mesh {
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/** Rescale a geometry's UVs so a shared texture tiles at world scale. */
function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}

/** A flat quad on the xz plane given by its x and z extents (order-insensitive). */
function quad(
  x0: number, x1: number, z0: number, z1: number,
  y: number, material: THREE.Material, uvM: number,
): THREE.Mesh {
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z1 - z0);
  const g = new THREE.PlaneGeometry(w, d);
  scaleUV(g, w / uvM, d / uvM);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, material);
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  return flat(m);
}

/**
 * A raised pad: a slab rising from y=0 to `top`, given by its x and z extents.
 * The side faces close the plateau lip so nothing ever floats over the apron.
 *
 * Every pad the player can reach emits its own collider. Player.groundUnder()
 * resolves floor height from collider TOPS (defaulting to y=0), not from a
 * raycast, so an uncollided pad would leave the player walking 0.14 m sunk into
 * it. Pass `out = null` ONLY for geometry outside the hard shell.
 */
/**
 * `tuck` moves the MESH's four side faces in from the nominal footprint - [minX,
 * maxX, minZ, maxZ] in metres, negative pushes a face OUT - while the collider always
 * keeps the nominal box, so a plateau edge can be hidden 5 mm inside a wall that
 * stands on it without moving the floor the player walks on. A pad edge that shares
 * a plane with something built on it (a house wall on the floor pad's edge, a garage
 * apron's end on the frontage pad's end) is a z-fight at that plane, clean from one
 * viewpoint and a dither patch from the next; `scripts/coplanar.mjs` lists them.
 */
type Tuck = [number, number, number, number];
function pad(
  out: AABB[] | null,
  x0: number, x1: number, z0: number, z1: number,
  top: number, material: THREE.Material, uvM: number,
  tuck: Tuck = [0, 0, 0, 0],
): THREE.Mesh {
  const [xa, xb] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [za, zb] = z0 < z1 ? [z0, z1] : [z1, z0];
  const w = xb - xa;
  const d = zb - za;
  const mx0 = xa + tuck[0], mx1 = xb - tuck[1], mz0 = za + tuck[2], mz1 = zb - tuck[3];
  const g = new THREE.BoxGeometry(mx1 - mx0, top, mz1 - mz0);
  scaleUV(g, w / uvM, d / uvM);
  const m = new THREE.Mesh(g, material);
  m.position.set((mx0 + mx1) / 2, top / 2, (mz0 + mz1) / 2);
  if (out) out.push(aabbSlab((xa + xb) / 2, Y_BASE, (za + zb) / 2, w, top, d));
  return flat(m);
}
/** A face moved this far off a plane it shared is out of the depth tie and invisible. */
const TUCK = 0.005;
const TUCK_ALL: Tuck = [TUCK, TUCK, TUCK, TUCK];

/**
 * A point at arc length `s` round the nominal apron outline, with its outward normal,
 * as [x, z, nx, nz]. The outline is the apron rectangle with its four corners ROUNDED
 * to CORNER_R. It was a sharp rectangle: each edge was offset inward along its own
 * normal, so where the bite differed between two edges the contour jumped at the
 * corner and crossed itself, and earcut filled the crossing on BOTH the paving and the
 * desert fringe - 16.6 m2 of the two y=0 sheets on top of each other (coplanar.mjs,
 * patches at (-36, 60) and (44, -61)). An inward offset of a convex arc whose radius
 * exceeds the largest bite cannot fold, so the corners are arcs of CORNER_R > RAGGED_MAX.
 */
const CORNER_R = 8.0;
const STRAIGHT_X = (APRON_X_MAX - APRON_X_MIN) - 2 * CORNER_R;
const STRAIGHT_Z = 2 * APRON_Z - 2 * CORNER_R;
const CORNER_L = (Math.PI / 2) * CORNER_R;
const APRON_PERIM = 2 * STRAIGHT_X + 2 * STRAIGHT_Z + 4 * CORNER_L;
function edgeSample(s: number): [number, number, number, number] {
  const arc = (cx: number, cz: number, a0: number, t: number): [number, number, number, number] => {
    const a = a0 + (t / CORNER_L) * (Math.PI / 2);
    const nx = Math.cos(a), nz = Math.sin(a);
    return [cx + CORNER_R * nx, cz + CORNER_R * nz, nx, nz];
  };
  // -z edge, +x arc, +x edge, +z arc, +z edge, -x arc, -x edge, -z arc
  if (s < STRAIGHT_X) return [APRON_X_MIN + CORNER_R + s, -APRON_Z, 0, -1];
  s -= STRAIGHT_X;
  if (s < CORNER_L) return arc(APRON_X_MAX - CORNER_R, -APRON_Z + CORNER_R, -Math.PI / 2, s);
  s -= CORNER_L;
  if (s < STRAIGHT_Z) return [APRON_X_MAX, -APRON_Z + CORNER_R + s, 1, 0];
  s -= STRAIGHT_Z;
  if (s < CORNER_L) return arc(APRON_X_MAX - CORNER_R, APRON_Z - CORNER_R, 0, s);
  s -= CORNER_L;
  if (s < STRAIGHT_X) return [APRON_X_MAX - CORNER_R - s, APRON_Z, 0, 1];
  s -= STRAIGHT_X;
  if (s < CORNER_L) return arc(APRON_X_MIN + CORNER_R, APRON_Z - CORNER_R, Math.PI / 2, s);
  s -= CORNER_L;
  if (s < STRAIGHT_Z) return [APRON_X_MIN, APRON_Z - CORNER_R - s, -1, 0];
  s -= STRAIGHT_Z;
  return arc(APRON_X_MIN + CORNER_R, -APRON_Z + CORNER_R, Math.PI, s);
}

/**
 * The ragged paving edge, as a closed contour in SHAPE space (x, -z), wound
 * counter-clockwise so that after rotateX(-90) the face points up. ONE point
 * list builds both the concrete and the desert fringe that fills the rest of
 * the rectangle, so they abut exactly: no coplanar overlap to z-fight, no crack
 * between them, and no extra y rung. Patches laid ON the paving need all three,
 * and read as spilled paint from above besides.
 */
function raggedOutline(rand: () => number): THREE.Vector2[] {
  const waves = RAGGED_WAVES.map(([n, amp]) => ({
    k: (Math.PI * 2 * n) / APRON_PERIM, amp, phase: rand() * Math.PI * 2,
  }));
  const pts: THREE.Vector2[] = [];
  const steps = Math.round(APRON_PERIM / EDGE_STEP);
  for (let i = 0; i < steps; i++) {
    const s = (i / steps) * APRON_PERIM;
    let bite = RAGGED_MEAN;
    for (const w of waves) bite += w.amp * Math.sin(w.k * s + w.phase);
    bite = Math.min(RAGGED_MAX, Math.max(RAGGED_MIN, bite));
    const [x, z, nx, nz] = edgeSample(s);
    pts.push(new THREE.Vector2(x - nx * bite, -(z - nz * bite)));
  }
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  return pts;
}

/** A flat shape on the xz plane, UV-scaled to the shared texture's world scale. */
function shapeMesh(
  shape: THREE.Shape, y: number, material: THREE.Material, uvM: number,
): THREE.Mesh {
  const g = new THREE.ShapeGeometry(shape);
  scaleUV(g, 1 / uvM, 1 / uvM);   // ShapeGeometry emits UVs in metres
  g.rotateX(-Math.PI / 2);        // shape (x, y) -> world (x, -z)
  const m = new THREE.Mesh(g, material);
  m.position.y = y;
  return flat(m);
}

/**
 * Annular sector around the turning head, extruded upward from y=0.
 *
 * Built as ONE closed contour - outer arc, radial jump in, inner arc back,
 * closePath - so ExtrudeGeometry gives us the top face, the inner (road-facing)
 * kerb wall with its normals pointing at the bulb centre, and the outer wall
 * that closes the lip, in a single draw call. A Cylinder tube would have its
 * normals the wrong way round and a RingGeometry would have no wall at all.
 */
function arcPad(
  rInner: number, rOuter: number, top: number,
  material: THREE.Material, uvM: number,
): THREE.Mesh {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOuter, ARC_START, ARC_START + ARC_SPAN, false);
  s.absarc(0, 0, rInner, ARC_START + ARC_SPAN, ARC_START, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: top, bevelEnabled: false, curveSegments: ARC_SEGS,
  });
  // ExtrudeGeometry emits UVs in metres; bring them to the shared texture's scale.
  scaleUV(g, 1 / uvM, 1 / uvM);
  g.rotateX(-Math.PI / 2);   // shape plane -> xz, extrusion -> +y
  const m = new THREE.Mesh(g, material);
  m.position.set(HEAD_CENTER_X, Y_BASE, 0);
  return flat(m);
}
/**
 * One draw call for a whole family of flat decals: a unit quad instanced with
 * per-instance position, yaw and (w, d) scale at a fixed rung `y`. Decal
 * materials are all unmapped (painted/kerb/concrete) so no UV scaling needed.
 * Emits no colliders - groundUnder() already defaults to y=0 and the plateau
 * colliders cover everything up here.
 */
interface DecalSpec { x: number; z: number; w: number; d: number; rot?: number }
function decalMesh(material: THREE.Material, specs: DecalSpec[], y: number): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, specs.length));
  const m4 = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    pos.set(s.x, y, s.z);
    q.setFromAxisAngle(up, s.rot ?? 0);
    scl.set(s.w, 1, s.d);
    mesh.setMatrixAt(i, m4.compose(pos, q, scl));
  }
  mesh.count = specs.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- builder

export const buildGround: Builder = (ctx) => {
  const g = group('ground');
  const colliders: AABB[] = [];
  // Warm tan paving family (REAL-REFERENCE paving): straight runs, bulb ring,
  // frontage wedges and garage aprons all read sunlit tan against the dark road.
  // Kerbs stay pale (ctx.mat.kerb) and every asphalt surface stays dark neutral.
  const warmPave = ctx.mat.painted(PAL.pavingWarm, 0.95, 0);
  const warmFlag = ctx.mat.painted(PAL.flagstone, 0.95, 0);
  const warmStain = ctx.mat.painted(PAL.pavingStain, 0.95, 0);
  const desert = ctx.mat.painted(PAL.dirt, 0.98, 0);

  // ---- 1. desert floor: everything outside the apron, out past the mountains.
  // Six rects that ABUT the apron rectangle and the road tail rather than
  // running under them, so they can share y=0 with no z-fighting at any range.
  {
    const R = DESERT_R;
    const rects: [number, number, number, number][] = [
      [-R, APRON_X_MIN, -R, -ROAD_HALF_WIDTH],                // -x, -z of the tail
      [-R, APRON_X_MIN, ROAD_HALF_WIDTH, R],                  // -x, +z of the tail
      [-R, ROAD_TAIL_X, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH],   // -x, beyond its end
      [APRON_X_MAX, R, -R, R],                                // +x
      [APRON_X_MIN, APRON_X_MAX, -R, -APRON_Z],               // -z
      [APRON_X_MIN, APRON_X_MAX, APRON_Z, R],                 // +z
    ];
    for (const [x0, x1, z0, z1] of rects) {
      g.add(quad(x0, x1, z0, z1, Y_BASE, desert, UV_FLAT));
    }
  }

  // ---- 2. base apron: the pale concrete surround everything sits in, ending
  // on a ragged edge, plus the desert fringe that fills the rest of the
  // rectangle. Same contour, opposite sides of it - they cannot come apart.
  {
    const edge = raggedOutline(ctx.rand);
    g.add(shapeMesh(new THREE.Shape(edge), Y_BASE, ctx.mat.paving, UV_PAVING));

    const rect = [
      new THREE.Vector2(APRON_X_MIN, -APRON_Z),
      new THREE.Vector2(APRON_X_MAX, -APRON_Z),
      new THREE.Vector2(APRON_X_MAX, APRON_Z),
      new THREE.Vector2(APRON_X_MIN, APRON_Z),
    ];
    if (THREE.ShapeUtils.isClockWise(rect)) rect.reverse();
    const fringe = new THREE.Shape(rect);
    fringe.holes.push(new THREE.Path(edge.slice().reverse()));
    g.add(shapeMesh(fringe, Y_BASE, desert, UV_FLAT));
  }

  // ---- 3. road strip along z=0, carried right across the paving at -x...
  g.add(quad(
    APRON_X_MIN, ROAD_STRIP_X_MAX, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH,
    Y_ROAD, ctx.mat.asphalt, UV_ASPHALT,
  ));
  // ...and on into the desert, so the street reads as LEAVING the map rather
  // than being cut off mid-apron. Visual only - the kerbs, the pavements and
  // every collider still stop at ROAD_X_MIN. A slab, not a plane, because 8 mm
  // of clearance over the sand would z-fight from about 100 m out.
  g.add(pad(
    null, ROAD_TAIL_X, APRON_X_MIN, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH,
    Y_ROAD, ctx.mat.asphalt, UV_ASPHALT,
  ));

  // ---- 4. central turning circle: a filled disc fused over the strip, which
  // runs beneath it to ROAD_X_MAX (the bulb's east tangent) so the join has no seam.
  {
    const geo = new THREE.CircleGeometry(HEAD_RADIUS, ARC_SEGS);
    scaleUV(geo, (2 * HEAD_RADIUS) / UV_ASPHALT, (2 * HEAD_RADIUS) / UV_ASPHALT);
    geo.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(geo, ctx.mat.asphalt);
    disc.position.set(HEAD_CENTER_X, Y_HEAD, 0);
    g.add(flat(disc));
  }

  // ---- 5/6. kerbs and pavements: straight runs, then the ring round the bulb.
  // The kerb is a 0.14 m step; the pavement behind it is the same plateau, so
  // both get collider tops at KERB_HEIGHT and the player steps up onto them.
  for (const s of [-1, 1] as const) {
    g.add(pad(
      colliders, ROAD_X_MIN, KERB_JOIN_X + JOIN,
      s * ROAD_HALF_WIDTH, s * (ROAD_HALF_WIDTH + KERB_WIDTH),
      T_PAVE, ctx.mat.kerb, UV_FLAT,
    ));
    g.add(pad(
      colliders, ROAD_X_MIN, PAVE_END_X,
      s * (ROAD_HALF_WIDTH + KERB_WIDTH), s * PAVEMENT_OUTER,
      T_PAVE, warmPave, UV_PAVING,
    ));
  }
  g.add(arcPad(HEAD_RADIUS, HEAD_RADIUS + KERB_WIDTH, T_ARC, ctx.mat.kerb, UV_FLAT));
  g.add(arcPad(HEAD_RADIUS + KERB_WIDTH, HEAD_PAVE_R, T_ARC, warmPave, UV_PAVING));

  // Colliders for the bulb's kerb + pavement band: one tight AABB per annular
  // sector, sampled off the true arc rather than a naive chord box so the step
  // does not bulge out into the asphalt at 45 degrees.
  for (let i = 0; i < RING_SECTORS; i++) {
    let xn = Infinity, xx = -Infinity, zn = Infinity, zx = -Infinity;
    for (let k = 0; k <= RING_SAMPLES; k++) {
      const a = ARC_START + ARC_SPAN * ((i + k / RING_SAMPLES) / RING_SECTORS);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (const r of [HEAD_RADIUS, HEAD_PAVE_R]) {
        const x = HEAD_CENTER_X + r * ca;
        const z = r * sa;
        xn = Math.min(xn, x); xx = Math.max(xx, x);
        zn = Math.min(zn, z); zx = Math.max(zx, z);
      }
    }
    colliders.push(aabbSlab((xn + xx) / 2, Y_BASE, (zn + zx) / 2, xx - xn, T_PAVE, zx - zn));
  }

  // ---- 7/8/9. per-house ground: front lawn, house band, back yard, apron
  for (const h of HOUSES) {
    const s = h.side;

    // front lawn, pavement edge out to the house front wall. Stops short of the
    // circle's pavement ring on the circle side rather than climbing onto it.
    g.add(pad(
      colliders, YARD_X_MIN, LAWN_X_MAX,
      s * PAVEMENT_OUTER, s * FRONT_LAWN_OUTER,
      T_LAWN, ctx.mat.lawn, UV_LAWN,
    ));

    // frontage wedge between the lawn edge and the circle, stepped in twice;
    // the near pad clears the turning head's kerb, the far pad rides over the
    // ring where the circle overlaps the frontage.
    g.add(pad(
      colliders, LAWN_X_MAX, CORNER_X,
      s * PAVEMENT_OUTER, s * FRONT_LAWN_OUTER,
      T_LAWN, warmPave, UV_PAVING,
    ));
    g.add(pad(
      colliders, CORNER_X, YARD_X_MAX,
      s * CORNER_Z, s * FRONT_LAWN_OUTER,
      T_LAWN, warmPave, UV_PAVING,
    ));

    // ground beside the house, front wall to rear wall. This is the SIDE STRIPS -
    // the house footprint itself gets a floor below, because a lawn running through
    // the interior is exactly what you see from inside otherwise.
    g.add(pad(
      colliders, YARD_X_MIN, YARD_X_MAX,
      s * FRONT_LAWN_OUTER, s * HOUSE_BACK,
      T_LAWN, ctx.mat.lawn, UV_LAWN,
    ));

    // interior floor: main block, laid just over the lawn pad. Its edges are the
    // house's outer wall planes (|x| = HOUSE_HALF_LEN, |z| = HOUSE_BACK), so the pad's
    // 3 mm lip above the lawn shared those planes with the stucco: tucked 5 mm inside.
    g.add(pad(
      colliders, -HOUSE_HALF_LEN, HOUSE_HALF_LEN,
      s * FRONT_LAWN_OUTER, s * HOUSE_BACK,
      T_FLOOR, ctx.mat.concrete, UV_PAVING, TUCK_ALL,
    ));

    // interior floor: garage wing, read off the house descriptor; same tuck, the
    // garage's outer and back walls stand exactly on its nominal edge
    g.add(pad(
      colliders,
      h.garageX - GARAGE_LEN / 2, h.garageX + GARAGE_LEN / 2,
      s * FRONT_LAWN_OUTER, s * (FRONT_LAWN_OUTER + GARAGE_DEPTH),
      T_FLOOR, ctx.mat.concrete, UV_PAVING, TUCK_ALL,
    ));

    // back yard, rear wall out to the timber back fence
    g.add(pad(
      colliders, YARD_X_MIN, YARD_X_MAX,
      s * HOUSE_BACK, s * BACK_FENCE,
      T_LAWN, ctx.mat.lawn, UV_LAWN,
    ));

    // garage apron: read the garage end off the house descriptor, never assumed.
    // Warm flagstone, not cool concrete, so the drive reads as part of the paving.
    // It rides over the frontage pad, and both end on the pavement line - two lips,
    // 0.146 and 0.141 tall, on one plane, open to the east apron where the ring runs
    // out. The apron's road-side face is pushed 5 mm proud so it alone is seen.
    g.add(pad(
      colliders,
      h.garageX - GARAGE_LEN / 2 - DRIVE_FLARE,
      h.garageX + GARAGE_LEN / 2 + DRIVE_FLARE,
      s * PAVEMENT_OUTER, s * FRONT_LAWN_OUTER,
      T_DRIVE, warmFlag, UV_FLAT, s < 0 ? [0, 0, 0, -TUCK] : [0, 0, -TUCK, 0],
    ));
  }

  // ---- 10. out-of-bounds: a low berm on the apron, backed by hard colliders.
  // The -x end is left open so the street reads as running away to the plaza;
  // the collider there is solid all the same.
  // The berm is a kerb at the apron edge, not the border - see WALL_H. The border the
  // player meets is surround.ts's fence line, which stands just inside these faces.
  {
    const berm = ctx.mat.painted(PAL.concreteDark, 0.95, 0);
    const zEdge = BOUND_Z + PERIM_W / 2;
    const xSpan = BOUND_X_MAX - BOUND_X_MIN + 2 * PERIM_W;
    const xMid = (BOUND_X_MIN + BOUND_X_MAX) / 2;
    const zSpan = 2 * BOUND_Z + 2 * PERIM_W;
    for (const s of [-1, 1] as const) {
      g.add(slab(xSpan, PERIM_H, PERIM_W, berm, xMid, Y_BASE, s * zEdge));
    }
    // the x runs BUTT the z runs (which carry the corners); both used to reach the
    // corner and stack the same six faces there
    g.add(slab(PERIM_W, PERIM_H, 2 * BOUND_Z, berm, BOUND_X_MAX + PERIM_W / 2, Y_BASE, 0));
    // -x wall, split around the street mouth
    const mouth = PAVEMENT_OUTER;
    const wingLen = BOUND_Z - mouth;
    for (const s of [-1, 1] as const) {
      g.add(slab(
        PERIM_W, PERIM_H, wingLen, berm,
        BOUND_X_MIN - PERIM_W / 2, Y_BASE, s * (mouth + wingLen / 2),
      ));
    }

    // hard shell: four tall boxes just outside the bounds, no geometry needed
    const cy = WALL_H / 2;
    colliders.push(aabb(BOUND_X_MIN - WALL_T / 2, cy, 0, WALL_T, WALL_H, zSpan + 2 * WALL_T));
    colliders.push(aabb(BOUND_X_MAX + WALL_T / 2, cy, 0, WALL_T, WALL_H, zSpan + 2 * WALL_T));
    for (const s of [-1, 1] as const) {
      colliders.push(aabb(xMid, cy, s * (BOUND_Z + WALL_T / 2), xSpan + 2 * WALL_T, WALL_H, WALL_T));
    }
  }

  // ---- 11. ground detail: cast-iron manhole covers on the road and the bulb
  {
    const spots: [number, number][] = [
      [ROAD_X_MIN + (ROAD_X_MAX - ROAD_X_MIN) * 0.34, -ROAD_HALF_WIDTH * 0.5],
      [ROAD_X_MIN + (ROAD_X_MAX - ROAD_X_MIN) * 0.72, ROAD_HALF_WIDTH * 0.42],
      [HEAD_CENTER_X, 0],
      [ROAD_X_MIN + (ROAD_X_MAX - ROAD_X_MIN) * 0.12, ROAD_HALF_WIDTH * 0.35],
      [HEAD_CENTER_X + HEAD_RADIUS * 0.45, -HEAD_RADIUS * 0.4],
      // boundary cover on the -x mouth, 0.8 m dia at (ROAD_X_MIN + 1.2, 0)
      [ROAD_X_MIN + 1.2, 0],
    ];
    // A disc at Y_MANHOLE would be a plane hovering over the asphalt; a short
    // cylinder rising from y=0 is buried in the road and stands a couple of
    // centimetres proud of it, which is what a cast-iron cover actually does.
    const geo = new THREE.CylinderGeometry(MANHOLE_R, MANHOLE_R, Y_MANHOLE, 20);
    const covers = new THREE.InstancedMesh(
      geo, ctx.mat.painted(PAL.steel, 0.72, 0.45), spots.length,
    );
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const jitter = (ctx.rand() - 0.5) * MANHOLE_R;
      p.set(spots[i][0] + jitter, Y_MANHOLE / 2, spots[i][1] + jitter);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ctx.rand() * Math.PI);
      covers.setMatrixAt(i, m4.compose(p, q, one));
    }
    covers.instanceMatrix.needsUpdate = true;
    covers.computeBoundingSphere();
    covers.castShadow = false;
    covers.receiveShadow = true;
    g.add(covers);
  }
  // ---- 12. painted + paved surface detail, one InstancedMesh per family.
  // All quads sit on their own rungs (Y_LINE/Y_GUTTER/Y_SCUFF over the road and
  // Y_PAVE_MARK over the plateau) with footprints that never overlap a sibling
  // rung's neighbour: centre dashes steer clear of the manhole spots, drains sit
  // kerb-side of the gutter lines, scuffs keep to the bulb, and paving joints
  // skip the driveway spans so nothing fights T_DRIVE at aerial range.
  {
    const paintWhite = ctx.mat.painted(PAL.windowBand, 0.6, 0);
    const gutterMat = ctx.mat.painted(PAL.asphaltLight, 0.96, 0);
    const ironMat = ctx.mat.painted(PAL.steel, 0.72, 0.45);
    const jointMat = warmStain;
    const scuffMat = ctx.mat.painted(PAL.truckCab, 0.97, 0);
    const tactileMat = ctx.mat.painted(PAL.sand, 0.9, 0);
    const coverKeep: [number, number][] = [
      [ROAD_X_MIN + (ROAD_X_MAX - ROAD_X_MIN) * 0.34, -ROAD_HALF_WIDTH * 0.5],
      [ROAD_X_MIN + (ROAD_X_MAX - ROAD_X_MIN) * 0.72, ROAD_HALF_WIDTH * 0.42],
      [ROAD_X_MIN + (ROAD_X_MAX - ROAD_X_MIN) * 0.12, ROAD_HALF_WIDTH * 0.35],
      [ROAD_X_MIN + 1.2, 0],
    ];
    const lineSpecs: DecalSpec[] = [];
    // The stem's centre line ends where the bulb begins: carried on to ROAD_X_MAX it
    // crossed the circulation ring on the same rung (a dash on a dash at x = 7). The
    // loop still runs to ROAD_X_MAX and draws its two rands per dash - section 13's
    // lamp and furniture colliders come from the same stream - it just stops pushing.
    for (let x = ROAD_X_MIN + 1.5; x < ROAD_X_MAX - 1.0; x += 5.0) {
      let clear = true;
      for (const s of coverKeep) {
        if (Math.abs(s[0] - x - 1.0) < 1.6 && Math.abs(s[1]) < 0.8) { clear = false; break; }
      }
      if (!clear) continue;
      const dash = { x: x + (ctx.rand() - 0.5) * 0.2, z: (ctx.rand() - 0.5) * 0.06, w: 2.0, d: 0.15 };
      if (x < KERB_JOIN_X - 1.0) lineSpecs.push(dash);
    }
    // Stop bar where the stem meets the bulb.
    lineSpecs.push({ x: ROAD_X_MAX - 1.2, z: 0, w: 0.45, d: ROAD_HALF_WIDTH * 1.3 });
    // Circulation dashes round the bulb + two entry chevrons.
    const ringR = HEAD_RADIUS - 2.2;
    const ringN = 18;
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2 + ctx.rand() * 0.05;
      lineSpecs.push({
        x: HEAD_CENTER_X + Math.cos(a) * ringR,
        z: Math.sin(a) * ringR,
        w: 1.5, d: 0.16, rot: -a + Math.PI / 2,
      });
    }
    if (lineSpecs.length) g.add(decalMesh(paintWhite, lineSpecs, Y_LINE));

    // Gutter/camber hint: stem edges up to the kerb join + an arc round the bulb.
    const gutterSpecs: DecalSpec[] = [];
    for (const s of [-1, 1] as const) {
      gutterSpecs.push({
        x: (ROAD_X_MIN + KERB_JOIN_X) / 2, z: s * (ROAD_HALF_WIDTH - 0.55),
        w: KERB_JOIN_X - ROAD_X_MIN, d: 0.22,
      });
    }
    const gutR = HEAD_RADIUS - 0.75;
    const gutN = 16;
    for (let i = 0; i < gutN; i++) {
      const a = ARC_START + ARC_SPAN * ((i + 0.5) / gutN);
      gutterSpecs.push({
        x: HEAD_CENTER_X + Math.cos(a) * gutR, z: Math.sin(a) * gutR,
        w: 1.7, d: 0.2, rot: -a + Math.PI / 2,
      });
    }
    if (gutterSpecs.length) g.add(decalMesh(gutterMat, gutterSpecs, Y_GUTTER));

    // Drain gratings: kerb-side of the gutter lines so the footprints abut.
    const drainSpecs: DecalSpec[] = [];
    for (const s of [-1, 1] as const) {
      for (const t of [0.25, 0.55, 0.85]) {
        drainSpecs.push({
          x: ROAD_X_MIN + (KERB_JOIN_X - ROAD_X_MIN) * t + (ctx.rand() - 0.5) * 0.6,
          z: s * (ROAD_HALF_WIDTH - 0.2), w: 0.65, d: 0.4,
        });
      }
    }
    for (const a of [0.6, 2.5, 4.2]) {
      drainSpecs.push({
        x: HEAD_CENTER_X + Math.cos(a) * (HEAD_RADIUS - 0.3),
        z: Math.sin(a) * (HEAD_RADIUS - 0.3),
        w: 0.65, d: 0.45, rot: -a + Math.PI / 2,
      });
    }
    if (drainSpecs.length) g.add(decalMesh(ironMat, drainSpecs, Y_GUTTER));

    // Tyre scuff arcs + oil spots on the bulb. All on one rung, so two that land on
    // each other fight; a scuff that overlaps an earlier one is swung round the bulb
    // (deterministically - every ctx.rand() call below is kept, because the lamp and
    // furniture colliders in section 13 are drawn from the same stream).
    const scuffSpecs: DecalSpec[] = [];
    const scuffFree = (x: number, z: number, w: number, d: number): boolean =>
      scuffSpecs.every((o) => Math.hypot(o.x - x, o.z - z) > (Math.hypot(w, d) + Math.hypot(o.w, o.d)) / 2);
    const placeScuff = (a: number, r: number, w: number, d: number, rot: number): void => {
      for (let k = 0; k < 12; k++) {
        const aa = a + k * 0.37;
        const x = HEAD_CENTER_X + Math.cos(aa) * r, z = Math.sin(aa) * r;
        if (!scuffFree(x, z, w, d)) continue;
        scuffSpecs.push({ x, z, w, d, rot: rot + (aa - a) * -1 });
        return;
      }
    };
    for (let i = 0; i < 16; i++) {
      const a = ctx.rand() * Math.PI * 2;
      const r = 2.0 + ctx.rand() * (HEAD_RADIUS - 3.0);
      const w = 1.2 + ctx.rand() * 1.2, d = 0.22 + ctx.rand() * 0.13;
      placeScuff(a, r, w, d, -a + Math.PI / 2 + (ctx.rand() - 0.5) * 0.5);
    }
    for (let i = 0; i < 6; i++) {
      const a = ctx.rand() * Math.PI * 2;
      const r = ctx.rand() * (HEAD_RADIUS - 2.5);
      const s = 0.35 + ctx.rand() * 0.45;
      const d = s * (0.7 + ctx.rand() * 0.5), rot = ctx.rand() * Math.PI;
      placeScuff(a, r, s, d, rot);
    }
    if (scuffSpecs.length) g.add(decalMesh(scuffMat, scuffSpecs, Y_SCUFF));

    // Paving joints across both straight bands, skipping the driveway spans,
    // plus radial control joints fanning across the bulb's pavement ring.
    const paveSpecs: DecalSpec[] = [];
    const bandMid = (ROAD_HALF_WIDTH + KERB_WIDTH + PAVEMENT_OUTER) / 2;
    const bandD = PAVEMENT_OUTER - (ROAD_HALF_WIDTH + KERB_WIDTH);
    const overDrive = (s: -1 | 1, x: number, pad: number): boolean => {
      for (const h of HOUSES) {
        if (h.side !== s) continue;
        if (Math.abs(x - h.garageX) < GARAGE_LEN / 2 + DRIVE_FLARE + pad) return true;
      }
      return false;
    };
    // Everything on the Y_PAVE_MARK rung shares it with the four tactile pads (placed
    // below); a joint or a stain laid across one is two colours on one plane. Specs
    // are still DRAWN from ctx.rand() exactly as before and dropped afterwards, so the
    // stream feeding section 13's colliders is untouched.
    const tactileAt: [number, number][] = [
      [KERB_JOIN_X - 0.9, PAVEMENT_OUTER - 0.55], [KERB_JOIN_X - 0.9, -(PAVEMENT_OUTER - 0.55)],
      [ROAD_X_MIN + 0.9, PAVEMENT_OUTER - 0.55], [ROAD_X_MIN + 0.9, -(PAVEMENT_OUTER - 0.55)],
    ];
    const onTactile = (sp: DecalSpec): boolean => {
      const c = Math.abs(Math.cos(sp.rot ?? 0)), sn = Math.abs(Math.sin(sp.rot ?? 0));
      const hw = (c * sp.w + sn * sp.d) / 2 + 0.35 + 0.05;   // pad half-size 0.35 + a hair
      const hd = (sn * sp.w + c * sp.d) / 2 + 0.35 + 0.05;
      return tactileAt.some(([tx, tz]) => Math.abs(sp.x - tx) < hw && Math.abs(sp.z - tz) < hd);
    };
    const keep = (arr: DecalSpec[], sp: DecalSpec): void => { if (!onTactile(sp)) arr.push(sp); };
    for (const s of [-1, 1] as const) {
      for (let x = ROAD_X_MIN + 1.0; x < KERB_JOIN_X; x += 3.0) {
        if (overDrive(s, x, 0.4)) continue;
        keep(paveSpecs, { x: x + (ctx.rand() - 0.5) * 0.15, z: s * bandMid, w: 0.09, d: bandD });
      }
    }
    const ringMid = HEAD_RADIUS + KERB_WIDTH + (HEAD_PAVE_R - HEAD_RADIUS - KERB_WIDTH) / 2;
    const ringD = HEAD_PAVE_R - HEAD_RADIUS - KERB_WIDTH;
    const ringJoints = 14;
    for (let i = 0; i < ringJoints; i++) {
      const a = ARC_START + ARC_SPAN * ((i + 0.5) / ringJoints);
      paveSpecs.push({
        x: HEAD_CENTER_X + Math.cos(a) * ringMid, z: Math.sin(a) * ringMid,
        w: 0.09, d: ringD - 0.15, rot: -a + Math.PI / 2,
      });
    }
    // Stained-slab variation + tar strips: one cell-centred slab per 3 m bay,
    // half-grid off the joints so footprints never share the rung.
    const stainSpecs: DecalSpec[] = [];
    const flagSpecs: DecalSpec[] = [];
    const tarSpecs: DecalSpec[] = [];
    const stainRects: [number, number, number, number][] = [];
    for (const s of [-1, 1] as const) {
      const h = HOUSES.find((hh) => hh.side === s)!;
      const inward = h.garageX > 0 ? -1 : 1;
      const utilX = h.garageX + inward * (GARAGE_LEN / 2 + DRIVE_FLARE + 2.5);
      for (let jx = ROAD_X_MIN + 1.0; jx < KERB_JOIN_X - 1.5; jx += 3.0) {
        const cx = jx + 1.5 + (ctx.rand() - 0.5) * 0.3;
        if (overDrive(s, cx, 1.3)) continue;
        if (Math.abs(cx - utilX) < 1.3) continue;
        if (ctx.rand() < 0.25) continue;
        const w = 1.1 + ctx.rand() * 0.5;
        const cz = s * (bandMid + (ctx.rand() - 0.5) * 0.4);
        const spec = { x: cx, z: cz, w, d: bandD * 0.62 };
        if (ctx.rand() < 0.5) keep(stainSpecs, spec); else keep(flagSpecs, spec);
        stainRects.push([cx, cz, w / 2 + 0.15, (bandD * 0.62) / 2 + 0.15]);
        // tar strip: short transverse bead tucked against the bay's joint end,
        // clear of the stained slab in the same bay and the utility cover.
        let tx = jx + 0.3 + ctx.rand() * 2.2;
        if (tx > cx - w / 2 - 0.15 && tx < cx + w / 2 + 0.15) tx = jx + 0.32;
        const tz = s * (bandMid + (ctx.rand() - 0.5) * bandD * 0.4);
        if (Math.abs(tx - utilX) < 0.6 && Math.abs(tz - s * bandMid) < 0.7) continue;
        if (!overDrive(s, tx, 0.6)) {
          keep(tarSpecs, { x: tx, z: tz, w: 0.13, d: 0.9 + ctx.rand() * 1.0 });
        }
      }
    }
    // A few jittered cracks on the straight pavements, kept off the stained
    // slabs and the driveway spans.
    let placed = 0;
    for (let i = 0; i < 24 && placed < 12; i++) {
      const s = placed % 2 === 0 ? 1 : -1;
      const cx = ROAD_X_MIN + ctx.rand() * (KERB_JOIN_X - ROAD_X_MIN);
      const cz = s * (bandMid + (ctx.rand() - 0.5) * bandD * 0.5);
      let hit = overDrive(s, cx, 0.5);
      if (!hit) {
        for (const r of stainRects) {
          if (Math.abs(cx - r[0]) < r[2] + 0.5 && Math.abs(cz - r[1]) < r[3] + 0.5) { hit = true; break; }
        }
      }
      if (hit) continue;
      keep(paveSpecs, {
        x: cx, z: cz,
        w: 0.07, d: 0.8 + ctx.rand() * 1.0, rot: (ctx.rand() - 0.5) * 1.2,
      });
      placed++;
    }
    if (paveSpecs.length) g.add(decalMesh(jointMat, paveSpecs, Y_PAVE_MARK));
    if (stainSpecs.length) g.add(decalMesh(warmStain, stainSpecs, Y_PAVE_MARK));
    if (flagSpecs.length) g.add(decalMesh(warmFlag, flagSpecs, Y_PAVE_MARK));
    if (tarSpecs.length) g.add(decalMesh(scuffMat, tarSpecs, Y_PAVE_MARK));

    // Dropped kerbs: one quad per garage over the kerb strip, abutting the apron.
    const dropSpecs: DecalSpec[] = [];
    for (const h of HOUSES) {
      dropSpecs.push({
        x: h.garageX, z: h.side * (ROAD_HALF_WIDTH + KERB_WIDTH / 2),
        w: GARAGE_LEN + DRIVE_FLARE * 2, d: KERB_WIDTH,
      });
    }
    if (dropSpecs.length) g.add(decalMesh(ctx.mat.kerb, dropSpecs, Y_PAVE_MARK));

    // Tactile pad hints at the bulb junction + the -x street mouth corners.
    const tactileSpecs: DecalSpec[] = tactileAt.map(([x, z]) => ({ x, z, w: 0.7, d: 0.7 }));
    g.add(decalMesh(tactileMat, tactileSpecs, Y_PAVE_MARK));

    // Pavement utility covers: small steel squares clear of the driveway spans.
    const utilSpecs: DecalSpec[] = [];
    for (const s of [-1, 1] as const) {
      const h = HOUSES.find((hh) => hh.side === s)!;
      const inward = h.garageX > 0 ? -1 : 1;
      const clearX = h.garageX + inward * (GARAGE_LEN / 2 + DRIVE_FLARE + 2.5);
      utilSpecs.push({ x: clearX, z: s * bandMid, w: 0.7, d: 0.7, rot: (ctx.rand() - 0.5) * 0.4 });
    }
    if (utilSpecs.length) g.add(decalMesh(ironMat, utilSpecs, Y_PAVE_MARK));
  }

  // ---- 13. -x street closure + verge rhythm: a black steel gate across the
  // carriageway mouth, then twin-head lamps alternating with planter / AC /
  // placard boxes down both verges. Everything stands on the pavement plateau
  // at VERGE_Z or the kerb line, so the carriageway stays clear for large
  // vehicles. Repeated parts go out as InstancedMesh families, one per
  // geometry/material pair; every piece gets an aabb/aabbSlab collider.
  {
    const iron = ctx.mat.painted(PAL.busBlack, 0.62, 0.35);
    const steel = ctx.mat.steel;
    const paleHead = ctx.mat.painted(PAL.windowBand, 0.55, 0.05);
    const lampLens = ctx.mat.emissive(PAL.sunColor, 1.1);
    const kerbPale = ctx.mat.kerb;
    const soil = ctx.mat.painted(PAL.dirt, 1, 0);
    const shrub = ctx.mat.painted(PAL.hedge, 0.95, 0);
    const boardFace = ctx.mat.painted(PAL.coachCream, 0.7, 0);

    interface Item { p: [number, number, number]; ry?: number; s?: [number, number, number] }
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Item[]): void => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const v = new THREE.Vector3();
      const sv = new THREE.Vector3();
      const one = new THREE.Vector3(1, 1, 1);
      list.forEach((it, i) => {
        q.setFromEuler(e.set(0, it.ry ?? 0, 0));
        if (it.s) sv.set(it.s[0], it.s[1], it.s[2]); else sv.copy(one);
        im.setMatrixAt(i, m4.compose(v.set(it.p[0], it.p[1], it.p[2]), q, sv));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true;
      im.receiveShadow = true;
      g.add(im);
    };

    // Gate across the carriageway at the -x mouth: posts, rails, bars + mesh.
    const gateX = ROAD_X_MIN + 0.15;
    const gateSpan = ROAD_HALF_WIDTH * 2 + 0.7;
    for (const s of [-1, 1] as const) {
      const pz = s * (ROAD_HALF_WIDTH + 0.35);
      g.add(slab(0.18, GATE_H + 0.2, 0.18, iron, gateX, T_PAVE, pz));
      colliders.push(aabbSlab(gateX, T_PAVE, pz, 0.3, GATE_H + 0.2, 0.3));
    }
    for (const ry of [0.35, 1.2, GATE_H]) {
      g.add(box(0.1, 0.09, gateSpan, iron, gateX, ry, 0));
    }
    const barH = GATE_H - 0.17;
    const barN = Math.floor(gateSpan / GATE_BAR_STEP);
    const bars: Item[] = [];
    for (let i = 0; i <= barN; i++) {
      bars.push({ p: [gateX, 0.12 + barH / 2, -gateSpan / 2 + ((i + 0.5) * gateSpan) / (barN + 1)] });
    }
    inst(new THREE.BoxGeometry(0.05, barH, 0.05), iron, bars);
    g.add(box(0.03, 0.9, gateSpan - 0.3, steel, gateX, 0.62, 0));
    colliders.push(aabbSlab(gateX, Y_BASE, 0, 0.7, GATE_H + 0.2, gateSpan + 0.4));

    // Twin-head lamp columns + alternating verge boxes, both sides.
    const plinths: Item[] = [];
    const columns: Item[] = [];
    const arms: Item[] = [];
    const heads: Item[] = [];
    const lenses: Item[] = [];
    const planterBodies: Item[] = [];
    const soils: Item[] = [];
    const shrubs: Item[] = [];
    const acBodies: Item[] = [];
    const trim: Item[] = [];
    const posts: Item[] = [];
    const boards: Item[] = [];
    const colGeo = new THREE.CylinderGeometry(0.07, 0.11, LAMP_H, 10);
    const armGeo = new THREE.BoxGeometry(0.09, 0.09, LAMP_ARM);
    const headGeo = new THREE.BoxGeometry(0.22, 0.12, 0.55);
    const lensGeo = new THREE.BoxGeometry(0.16, 0.04, 0.4);
    for (const s of [-1, 1] as const) {
      const h = HOUSES.find((hh) => hh.side === s)!;
      const lampXs: number[] = [];
      for (let x = ROAD_X_MIN + 2.0; x < KERB_JOIN_X - 1.0;) {
        let lx = x + (ctx.rand() - 0.5) * 1.0;
        const half = GARAGE_LEN / 2 + DRIVE_FLARE + 0.8;
        if (Math.abs(lx - h.garageX) < half) {
          lx = h.garageX + (lx >= h.garageX ? half : -half);
        }
        lampXs.push(lx);
        x += 8.0 + ctx.rand() * 7.0;
      }
      const topY = T_PAVE + LAMP_PLINTH + LAMP_H - 0.15;
      for (const lx of lampXs) {
        const pz = s * (VERGE_Z + (ctx.rand() - 0.5) * 0.2);
        plinths.push({ p: [lx, T_PAVE + LAMP_PLINTH / 2, pz], s: [0.55, LAMP_PLINTH, 0.55] });
        columns.push({ p: [lx, T_PAVE + LAMP_PLINTH + LAMP_H / 2, pz] });
        colliders.push(aabbSlab(lx, T_PAVE, pz, 0.6, LAMP_PLINTH + LAMP_H + 0.2, 0.6));
        for (const sg of [-1, 1]) {
          const a = sg * LAMP_SPLAY + (ctx.rand() - 0.5) * 0.08;
          const dx = Math.sin(a);
          const dz = -s * Math.cos(a);
          // both arms pass over the column and their top/bottom faces met there
          arms.push({ p: [lx + dx * LAMP_ARM * 0.45, topY + (sg > 0 ? TUCK : 0), pz + dz * LAMP_ARM * 0.45], ry: Math.atan2(dx, dz) });
          heads.push({ p: [lx + dx * (LAMP_ARM - 0.1), topY - 0.08, pz + dz * (LAMP_ARM - 0.1)], ry: Math.atan2(dx, dz) });
          lenses.push({ p: [lx + dx * (LAMP_ARM - 0.1), topY - 0.16, pz + dz * (LAMP_ARM - 0.1)], ry: Math.atan2(dx, dz) });
        }
      }
      // furniture between the lamps: planter -> AC utility -> placard, cycling
      let bi = 0;
      for (let li = 0; li + 1 < lampXs.length; li++) {
        const a = lampXs[li];
        const b = lampXs[li + 1];
        const cands = [(a + b) / 2, a + 2.4, b - 2.4];
        let cx = 0;
        let found = false;
        for (const c of cands) {
          if (c < a + 1.3 || c > b - 1.3) continue;
          if (Math.abs(c - h.garageX) < GARAGE_LEN / 2 + DRIVE_FLARE + 1.3) continue;
          cx = c;
          found = true;
          break;
        }
        if (!found) continue;
        const cz = s * (VERGE_Z - 0.05 + (ctx.rand() - 0.5) * 0.2);
        const kind = bi % 3;
        bi++;
        if (kind === 0) {
          planterBodies.push({ p: [cx, T_PAVE + 0.275, cz], s: [1.7, 0.55, 0.7] });
          soils.push({ p: [cx, T_PAVE + 0.58, cz], s: [1.5, 0.1, 0.5] });
          for (let k = 0; k < 3; k++) {
            const sh = 0.3 + ctx.rand() * 0.18;
            shrubs.push({
              p: [cx - 0.5 + k * 0.5 + (ctx.rand() - 0.5) * 0.12, T_PAVE + 0.63 + sh / 2, cz + (ctx.rand() - 0.5) * 0.2],
              s: [sh, sh, sh],
            });
          }
          colliders.push(aabbSlab(cx, T_PAVE, cz, 1.7, 0.95, 0.7));
        } else if (kind === 1) {
          acBodies.push({ p: [cx, T_PAVE + 0.525, cz], s: [1.3, 1.05, 0.75] });
          trim.push({ p: [cx, T_PAVE + 1.08, cz], s: [1.36, 0.06, 0.81] });
          for (let k = 0; k < 4; k++) {
            trim.push({ p: [cx, T_PAVE + 0.3 + k * 0.2, cz - s * 0.395], s: [1.1, 0.05, 0.04] });
          }
          colliders.push(aabbSlab(cx, T_PAVE, cz, 1.3, 1.15, 0.75));
        } else {
          posts.push({ p: [cx - 0.4, T_PAVE + 0.85, cz], s: [0.07, 1.7, 0.07] });
          posts.push({ p: [cx + 0.4, T_PAVE + 0.85, cz], s: [0.07, 1.7, 0.07] });
          boards.push({ p: [cx, T_PAVE + 1.45, cz], s: [1.0, 0.7, 0.06] });
          trim.push({ p: [cx, T_PAVE + 1.84, cz], s: [1.06, 0.08, 0.1] });
          colliders.push(aabbSlab(cx, T_PAVE, cz, 1.0, 1.9, 0.3));
        }
      }
    }
    inst(colGeo, steel, columns);
    inst(armGeo, steel, arms);
    inst(headGeo, paleHead, heads);
    inst(lensGeo, lampLens, lenses);
    inst(unitBox, kerbPale, plinths);
    inst(unitBox, kerbPale, planterBodies);
    inst(unitBox, soil, soils);
    inst(unitBox, shrub, shrubs);
    inst(unitBox, steel, acBodies);
    inst(unitBox, iron, trim);
    inst(unitBox, iron, posts);
    inst(unitBox, boardFace, boards);
  }

  const result: BuildResult = { group: g, colliders };
  return result;
};
