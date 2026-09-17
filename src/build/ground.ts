/**
 * NUKETOWN 2025 - GROUND
 *
 * Every horizontal surface in the map: the desert floor, the concrete surround,
 * the street and its off-map tail, the lollipop turning head at the +x end,
 * kerbs, pavements, lawns, back yards, garage aprons and the perimeter.
 *
 * The town stands on a TIGHT paved apron in open desert. The apron runs only
 * APRON_MARGIN past the bounds - far enough that the berm and the fences hide
 * its edge from inside the map, near enough that the aerial reads as a test town
 * in the desert rather than an architectural model on a white table.
 *
 * -------------------------------------------------------------- y ladder
 * Nothing shares a y with anything it overlaps. Abutting (edge-to-edge)
 * surfaces MAY share a y - only overlapping footprints need separating.
 *
 *   0.000  desert floor .................... dirt     (abuts the apron and the tail)
 *   0.000  base apron plane ................ paving   (bounds + APRON_MARGIN)
 *   0.030  road strip ...................... asphalt  (apron edge -> bulb centre)
 *   0.030  desert road tail (slab top) ..... asphalt  (apron edge -> ROAD_TAIL_X)
 *   0.044  turning-head disc ............... asphalt  (sits over the strip end)
 *   0.050  sand drifts ..................... sand     (straddle the paving edge)
 *   0.058  manhole covers .................. painted steel
 *   0.138  circular kerb + circular pavement          (overlap the straight run)
 *   0.140  straight kerb + straight pavement = KERB_HEIGHT
 *   0.141  front lawns, frontage corner pads, house band, back yards
 *   0.144  garage aprons ................... concrete (overlay lawn + head pavement)
 *   0.000..0.550  out-of-bounds perimeter berm
 *
 * The rungs have to clear the DEPTH BUFFER, not just each other. With 24 bits,
 * near 0.08 and far 1400, the resolvable step is about z^2 * 7.5e-7 m: 2 mm at
 * 50 m, 7 mm at 100 m, 17 mm at 150 m. The aerial station reads the street from
 * 85-115 m, so the old 8 mm road rung was already inside the noise - the town
 * only had to move for the asphalt to break out in paving-coloured stipple.
 * Every rung that overlaps another is now >= 14 mm, the drifts are 50 mm up,
 * and the desert is CUT around the road tail so that pair never overlaps at all.
 *
 * Collider tops all sit at KERB_HEIGHT (or the pad's own top) - the player
 * controller derives floor height from collider tops, so the whole plateau is
 * collided even though it is only a 0.14 m step. The desert and the apron are
 * both y=0, which is groundUnder()'s default, so neither needs one.
 *
 * Every raised surface is a SLAB (box) rising from y=0, never a floating
 * plane, so the 0.14 m plateau edge is always closed by its own side face.
 *
 * The turning head is at +x. The road stem runs off-map at -x. Nothing here
 * is centred on x=0.
 */
import * as THREE from 'three';
import type { AABB, BuildResult, Builder } from '../core/kit';
import { aabb, aabbSlab, group, slab } from '../core/kit';
import { PAL } from '../core/palette';
import {
  BACK_FENCE, BOUND_X_MAX, BOUND_X_MIN, BOUND_Z, FRONT_LAWN_OUTER, GARAGE_LEN,
  HEAD_CENTER_X, HEAD_RADIUS, HOUSES, HOUSE_BACK, KERB_HEIGHT, KERB_WIDTH,
  PAVEMENT_OUTER, ROAD_HALF_WIDTH, ROAD_X_MAX, ROAD_X_MIN, YARD_X_MAX, YARD_X_MIN,
} from '../core/layout';

// ---------------------------------------------------------------- y ladder
const Y_BASE = 0.0;
const Y_ROAD = 0.030;                // 30 mm over the apron: resolves out to 200 m
const Y_HEAD = 0.044;
const Y_MANHOLE = 0.058;
const T_DUNE = 0.05;                 // drift slabs: 50 mm still resolves at 250 m
const T_ARC = KERB_HEIGHT - 0.002;   // circular kerb + circular pavement
const T_PAVE = KERB_HEIGHT;          // straight kerb + straight pavement
const T_LAWN = KERB_HEIGHT + 0.001;  // lawns and yards, flush with the pavement
const T_DRIVE = KERB_HEIGHT + 0.004; // garage aprons ride over whatever is beneath

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
 * How far the PAVING runs past the bounds. Tight on purpose: the berm, the back
 * fences and the boundary fence hide the edge from every ground-level view
 * except straight out of the -x street mouth, where the road tail and the drifts
 * carry the eye across it. Anything past this is desert.
 */
const APRON_MARGIN = 20.0;
const APRON_X_MIN = BOUND_X_MIN - APRON_MARGIN;
const APRON_X_MAX = BOUND_X_MAX + APRON_MARGIN;
const APRON_Z = BOUND_Z + APRON_MARGIN;

/**
 * Desert reach. The skyline module rings its mountains at 300-500 m, so the
 * floor has to run comfortably past them; the scene fog is fully saturated long
 * before this, so the far edge can never be seen from anywhere in the map.
 */
const DESERT_R = 900.0;
/** The road tail ends past the fog's far distance from any point inside the map. */
const ROAD_TAIL_X = BOUND_X_MIN - 640.0;

const DRIFT_COUNT = 180;             // sand blobs breaking the paving edge
const DRIFT_IN = 9.0;                // how far a drift may bite back onto the paving
const DRIFT_OUT = 58.0;              // ...and how far out it may blow

const JOIN = 0.05;                   // overlap at the straight/curved junction
const DRIVE_FLARE = 0.6;             // apron is a little wider than the garage
const ARC_SEGS = 64;
const PERIM_H = 0.55;
const PERIM_W = 0.6;
const WALL_H = 12.0;                 // invisible out-of-bounds collider height
const WALL_T = 1.2;
const MANHOLE_R = 0.42;
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
 * The bulb eats the +x corner of the frontage: past this x the lawn band would
 * land on the turning head's pavement, so the front lawns stop here.
 */
const LAWN_X_MAX = PAVE_JOIN_X;

/**
 * ...which leaves a wedge of frontage between the lawn edge and the bulb that
 * the ring only partly covers. Two paving pads fill it, each sized so its
 * corner nearest the bulb still clears the kerb (r >= HEAD_RADIUS + KERB_WIDTH).
 */
const BULB_KERB_R = HEAD_RADIUS + KERB_WIDTH;
const CORNER_X = HEAD_CENTER_X - Math.sqrt(BULB_KERB_R * BULB_KERB_R - PAVEMENT_OUTER * PAVEMENT_OUTER);
const CORNER_Z = Math.sqrt(
  BULB_KERB_R * BULB_KERB_R - (HEAD_CENTER_X - YARD_X_MAX) * (HEAD_CENTER_X - YARD_X_MAX),
);

/** The strip is carried past ROAD_X_MAX to the bulb centre so the join has no seam. */
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
function pad(
  out: AABB[] | null,
  x0: number, x1: number, z0: number, z1: number,
  top: number, material: THREE.Material, uvM: number,
): THREE.Mesh {
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z1 - z0);
  const g = new THREE.BoxGeometry(w, top, d);
  scaleUV(g, w / uvM, d / uvM);
  const m = new THREE.Mesh(g, material);
  m.position.set((x0 + x1) / 2, top / 2, (z0 + z1) / 2);
  if (out) out.push(aabbSlab((x0 + x1) / 2, Y_BASE, (z0 + z1) / 2, w, top, d));
  return flat(m);
}

/**
 * A point at arc length `s` round the apron's edge, with its outward normal,
 * as [x, z, nx, nz]. Scattering the drifts along the EDGE rather than inside a
 * box is what makes them break the paving line instead of dusting the desert.
 */
function edgeSample(s: number): [number, number, number, number] {
  const w = APRON_X_MAX - APRON_X_MIN;
  const d = 2 * APRON_Z;
  if (s < w) return [APRON_X_MIN + s, -APRON_Z, 0, -1];
  if (s < w + d) return [APRON_X_MAX, -APRON_Z + (s - w), 1, 0];
  if (s < 2 * w + d) return [APRON_X_MAX - (s - w - d), APRON_Z, 0, 1];
  return [APRON_X_MIN, APRON_Z - (s - 2 * w - d), -1, 0];
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

// ---------------------------------------------------------------- builder

export const buildGround: Builder = (ctx) => {
  const g = group('ground');
  const colliders: AABB[] = [];

  // ---- 1. desert floor: everything outside the apron, out past the mountains.
  // Six rects that ABUT the apron and the road tail rather than running under
  // them, so they can share y=0 with no z-fighting at any range.
  {
    const desert = ctx.mat.painted(PAL.dirt, 0.98, 0);
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

  // ---- 2. base apron: the pale concrete surround everything sits in
  g.add(quad(
    APRON_X_MIN, APRON_X_MAX, -APRON_Z, APRON_Z,
    Y_BASE, ctx.mat.paving, UV_PAVING,
  ));

  // ---- 2b. sand drifts over the apron edge, so the paving stops raggedly
  // instead of as a rectangle. Slabs rising from y=0, never floating planes;
  // no colliders, because every one of them is 11 m or more outside the hard
  // shell and the player can never stand on one.
  {
    const perim = 2 * (APRON_X_MAX - APRON_X_MIN) + 4 * APRON_Z;
    const xf: THREE.Matrix4[] = [];
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < DRIFT_COUNT; i++) {
      const [ex, ez, nx, nz] = edgeSample(ctx.rand() * perim);
      // biased to the edge: most drifts land just outside it, a third bite in
      const t = -DRIFT_IN + (DRIFT_IN + DRIFT_OUT) * Math.pow(ctx.rand(), 1.7);
      const z = ez + nz * t;
      // sand lying across the tail reads as a bug, not as weather - keep it clear
      if (nx < 0 && Math.abs(z) < ROAD_HALF_WIDTH + 6) continue;
      p.set(ex + nx * t, T_DUNE / 2, z);
      q.setFromAxisAngle(up, ctx.rand() * Math.PI);
      s.set(2.5 + ctx.rand() * 9.5, T_DUNE, 2.5 + ctx.rand() * 9.5);
      xf.push(new THREE.Matrix4().compose(p, q, s));
    }
    const drifts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 7), ctx.mat.sand, xf.length,
    );
    for (let i = 0; i < xf.length; i++) drifts.setMatrixAt(i, xf[i]);
    drifts.instanceMatrix.needsUpdate = true;
    // without this the cull test uses the UNIT cylinder's bounds at the world
    // origin, and the whole ring vanishes whenever x=0,z=0 is off screen
    drifts.computeBoundingSphere();
    g.add(flat(drifts));
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

  // ---- 4. lollipop turning head: a filled disc fused onto the strip end.
  // The strip is carried to HEAD_CENTER_X so the crescent either side of
  // ROAD_X_MAX where the bulb has not yet widened to ROAD_HALF_WIDTH is covered.
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
      T_PAVE, ctx.mat.paving, UV_PAVING,
    ));
  }
  g.add(arcPad(HEAD_RADIUS, HEAD_RADIUS + KERB_WIDTH, T_ARC, ctx.mat.kerb, UV_FLAT));
  g.add(arcPad(HEAD_RADIUS + KERB_WIDTH, HEAD_PAVE_R, T_ARC, ctx.mat.paving, UV_PAVING));

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
    // bulb's pavement ring at +x rather than climbing onto it.
    g.add(pad(
      colliders, YARD_X_MIN, LAWN_X_MAX,
      s * PAVEMENT_OUTER, s * FRONT_LAWN_OUTER,
      T_LAWN, ctx.mat.lawn, UV_LAWN,
    ));

    // frontage wedge between the lawn edge and the bulb, stepped in twice so
    // neither pad climbs onto the turning head's kerb
    g.add(pad(
      colliders, LAWN_X_MAX, CORNER_X,
      s * PAVEMENT_OUTER, s * FRONT_LAWN_OUTER,
      T_LAWN, ctx.mat.paving, UV_PAVING,
    ));
    g.add(pad(
      colliders, CORNER_X, YARD_X_MAX,
      s * CORNER_Z, s * FRONT_LAWN_OUTER,
      T_LAWN, ctx.mat.paving, UV_PAVING,
    ));

    // ground under the house and its side strips, front wall to rear wall
    g.add(pad(
      colliders, YARD_X_MIN, YARD_X_MAX,
      s * FRONT_LAWN_OUTER, s * HOUSE_BACK,
      T_LAWN, ctx.mat.lawn, UV_LAWN,
    ));

    // back yard, rear wall out to the timber back fence
    g.add(pad(
      colliders, YARD_X_MIN, YARD_X_MAX,
      s * HOUSE_BACK, s * BACK_FENCE,
      T_LAWN, ctx.mat.lawn, UV_LAWN,
    ));

    // garage apron: read the garage end off the house descriptor, never assumed
    g.add(pad(
      colliders,
      h.garageX - GARAGE_LEN / 2 - DRIVE_FLARE,
      h.garageX + GARAGE_LEN / 2 + DRIVE_FLARE,
      s * PAVEMENT_OUTER, s * FRONT_LAWN_OUTER,
      T_DRIVE, ctx.mat.concrete, UV_FLAT,
    ));
  }

  // ---- 10. out-of-bounds: a low berm on the apron, backed by hard colliders.
  // The -x end is left open so the street reads as running away to the plaza;
  // the collider there is solid all the same.
  {
    const berm = ctx.mat.painted(PAL.concreteDark, 0.95, 0);
    const zEdge = BOUND_Z + PERIM_W / 2;
    const xSpan = BOUND_X_MAX - BOUND_X_MIN + 2 * PERIM_W;
    const xMid = (BOUND_X_MIN + BOUND_X_MAX) / 2;
    const zSpan = 2 * BOUND_Z + 2 * PERIM_W;
    for (const s of [-1, 1] as const) {
      g.add(slab(xSpan, PERIM_H, PERIM_W, berm, xMid, Y_BASE, s * zEdge));
    }
    g.add(slab(PERIM_W, PERIM_H, zSpan, berm, BOUND_X_MAX + PERIM_W / 2, Y_BASE, 0));
    // -x wall, split around the street mouth
    const mouth = PAVEMENT_OUTER;
    const wingLen = BOUND_Z + PERIM_W - mouth;
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

  const result: BuildResult = { group: g, colliders };
  return result;
};
