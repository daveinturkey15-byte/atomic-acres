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
  ROAD_X_MAX, ROAD_X_MIN, THIRD_HOUSE_X, WHITE, YARD_X_MAX, YARD_X_MIN,
  DOOR_APRON_HALF_W, DOOR_APRON_DEPTH, SPAWN_A, SPAWN_B,
} from '../core/layout';
// The two house builders own their external rear stairs and EXPORT the ground each
// flight stands on. This module imports them; neither of them may import this one.
import { ORANGE_STAIR_FOOTPRINT } from './orange-house';
import { WHITE_STAIR_FOOTPRINT } from './white-house';

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
 * Two parts built on one plane tie in the depth buffer and dither. Where a dressed
 * part used to share a face with the part it meets, it now stands TUCK off it; meshes
 * only, every collider keeps its box (scripts/coplanar.mjs lists the pairs).
 */
const TUCK = 0.005;

/**
 * East boundary fence, closing the map beyond the eastern fringe dressing.
 * Twice now this fence has been derived from something that later moved - first
 * the turning head's kerb ring (which swung it through both back yards when the
 * head was recentred), then the third house. It is now anchored to the one thing
 * it is actually about: the east edge of the apron. It closes the map just past
 * where the road surface ends, and nothing else may move it.
 */
const BOUNDARY_X = ROAD_X_MAX + 0.6;

/**
 * The two flanking lanes down the sides of each yard are gameplay, not leftover space:
 * one is a 6.8 m run, the other a 2.0 m squeeze past the garage end, and they are the
 * only way around a house. Props are therefore laid out across an INNER band, not the
 * full yard, so nothing can be placed into a lane. This matters more since the yards
 * were re-proportioned to the minimap on 2026-09-18 and lost 14 m of width: every
 * fraction in this file was tuned against a 40 m yard, and mapping them onto the real
 * 26 m one un-edited walled both flanks shut.
 */
const PROP_LANE = 2.6;
const PROP_X_MIN = YARD_X_MIN + PROP_LANE;
const PROP_W = YARD_W - 2 * PROP_LANE;
/** x at fraction t across the prop band of a back yard (NOT the full yard) */
const yx = (t: number): number => PROP_X_MIN + t * PROP_W;

/**
 * The rear deck / undercroft / external stair belongs to the house builder, not to
 * this module. Half-length and depth of that volume, derived so one edit to DECK_LEN
 * or DECK_OUT moves the keep-out with the deck.
 */
const DECK_KEEP_HALF = DECK_LEN / 2 + 0.5;
const DECK_KEEP_D = DECK_OUT + 1.0;

/**
 * An external rear stair's ground footprint, as its house builder exports it. The
 * deck keep-out above stops at the deck; BOTH flights run past it - the orange one
 * 3.92 m along +x from the deck's free-end edge, the white one 3.77 m along -x - so
 * DECK_KEEP_HALF says nothing at all about the ground the treads stand on.
 */
interface StairFootprint { minX: number; maxX: number; minZ: number; maxZ: number }
const stairFootprint = (h: HouseSide): StairFootprint =>
  (h.side === ORANGE.side ? ORANGE_STAIR_FOOTPRINT : WHITE_STAIR_FOOTPRINT);
/** Nothing of ours touches a keep-out edge exactly; leave a hair of daylight. */
const KEEP_PAD = 0.05;

/**
 * Push an x clear of the things in a back yard that are not ours to stand on: the
 * house's back-door apron, the deck / undercroft volume within the deck's own depth,
 * and the external stair's exported footprint within the stair's own depth.
 *
 * Props are placed at fractions of the YARD, doors and decks at fractions of the
 * HOUSE, and the two sets of fractions know nothing about each other. Re-proportioning
 * the map on 2026-09-18 slid a 2.2 m crate store onto the orange back door and sealed
 * the house; the door half of this helper was the fix. It then pushed the same crate
 * store EAST, straight under the orange rear deck, because it only knew about doors.
 * The stair third arrived on 2026-09-19, after a planterBox was found built into the
 * bottom four treads of the white flight.
 *
 * The bans are MERGED before the shift. The previous version pushed to one ban's edge
 * and re-ran the list, which cannot converge when two bans overlap: with the stair ban
 * added, the white planter bounced between the deck volume and the stair footprint for
 * all four passes and finished inside the deck volume.
 */
const clearOfHouse = (h: HouseSide, x: number, z: number, halfW: number): number => {
  const f = stairFootprint(h);
  const pad = halfW + KEEP_PAD;
  const bans: [number, number][] = [
    [h.backDoorX - DOOR_APRON_HALF_W - pad, h.backDoorX + DOOR_APRON_HALF_W + pad],
  ];
  if (Math.abs(z) <= HOUSE_BACK + DECK_KEEP_D) {
    bans.push([h.deckX - DECK_KEEP_HALF - pad, h.deckX + DECK_KEEP_HALF + pad]);
  }
  // The footprint is a real x/z box, so it only bans x where the prop is level with
  // it. Widened by 1 m in z because all this helper is given is the prop's CENTRE.
  if (z >= f.minZ - 1.0 && z <= f.maxZ + 1.0) {
    bans.push([f.minX - pad, f.maxX + pad]);
  }
  const merged: [number, number][] = [];
  for (const b of bans.slice().sort((p, q) => p[0] - q[0])) {
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([b[0], b[1]]);
  }
  if (!merged.some((b) => x > b[0] && x < b[1])) return x;
  const lo = PROP_X_MIN + halfW, hi = PROP_X_MIN + PROP_W - halfW;
  let best = x, bestD = Infinity;
  for (const b of merged) {
    for (const c of b) {
      if (c < lo || c > hi) continue;
      if (merged.some((o) => c > o[0] + 1e-6 && c < o[1] - 1e-6)) continue;
      const d = Math.abs(c - x);
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  if (bestD === Infinity) {
    // Reported, never silently placed anyway: a prop left inside a keep-out is what
    // the self-check at the end of this file exists to catch, and it will.
    console.warn('[yards] no free x for a %s m prop at z %s - left at %s',
      (halfW * 2).toFixed(2), z.toFixed(1), x.toFixed(2));
    return x;
  }
  return best;
};
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
  const PAVE = mat.painted(PAL.concreteDark, 0.95, 0);    // patio disc
  // Stepping stones. PAL.steel is a COOL blue-grey (0x8b9099) and against saturated
  // lawn under a blue sky it read as a row of puddles, not paving. The footage
  // correction in docs/REAL-REFERENCE.md has sunlit ground running warm, so these
  // take the warm flagstone key.
  const STONE = mat.painted(PAL.flagstone, 1, 0);
  // grey, matte - nearer the lawn in value so the run reads as a path, not plates.
  const SLAB = mat.painted(PAL.concrete, 0.95, 0);        // pale dwarf walls / plinths
  const SOIL = mat.painted(PAL.dirt, 1, 0);
  // Bedding. FLOWER (carRed) was on every pot, bloom, cold frame and washing line -
  // forty-odd pure-red heads across two yards, which is what made the yards read as a
  // scatter of primaries rather than a garden. BLOOM is the bulk key now: a dusty
  // clay-red that sits in the same family as the terracotta pots it grows out of.
  // FLOWER survives on a handful of accents, where one saturated spot is the point.
  const FLOWER = mat.painted(PAL.carRed, 0.8, 0);
  const BLOOM = mat.painted(PAL.terracottaDk, 0.85, 0);
  // Shuffleboard court: SPEC's "green court" (NT02). carTeal read as a swimming
  // pool from spawn B - deep saturated fill, pale lip, white coping. lawnLight is
  // the palest green in the palette: it separates from mown lawn by VALUE, keeps
  // the white markings legible, and at roughness 1 can never read as liquid.
  const COURT = mat.painted(PAL.lawnLight, 1, 0);         // painted court, matte
  const LAMP = mat.painted(PAL.terracotta, 0.45, 0.2);    // orange lamp head
  const POT = mat.painted(PAL.terracottaDk, 0.85, 0);       // plant pots
  const CLOTHB = mat.painted(PAL.capsuleTrim, 0.8, 0);      // blue wash, chair accents
  const LINEN = mat.painted(PAL.pavingWarm, 0.95, 0);       // warm off-white wash

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
  /** terracotta pot with soil + bedding plant; founded ON the lawn rung */
  const pot = (x: number, z: number, s = 1): void => {
    C.put(POT, 0.36 * s, 0.30 * s, 0.36 * s, x, T_LAWN + 0.15 * s, z);
    C.put(SOIL, 0.30 * s, 0.05 * s, 0.30 * s, x, T_LAWN + 0.30 * s, z);
    S.put(mat.leaf, 0.30 * s, 0.24 * s, 0.30 * s, x, T_LAWN + 0.42 * s, z);
    S.put(BLOOM, 0.16 * s, 0.14 * s, 0.16 * s, x, T_LAWN + 0.55 * s, z);
  };
  /** white garden chair, seat facing local +z rotated by ry, standing on y0 */
  const chair = (x: number, z: number, ry: number, y0: number): void => {
    const at = (ox: number, oz: number): [number, number] => l2w(x, z, ry, ox, oz);
    const [cx, cz] = at(0, 0);
    B.put(WHITEP, 0.52, 0.06, 0.5, cx, y0 + 0.45, cz, ry);
    const [bx, bz] = at(0, -0.24);
    B.put(WHITEP, 0.52, 0.55, 0.06, bx, y0 + 0.75, bz, ry, -0.12);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [lx, lz] = at(sx * 0.22, sz * 0.20);
      B.put(IRON, 0.05, 0.45, 0.05, lx, y0 + 0.225, lz);
    }
    colliders.push(aabbSlab(cx, y0, cz, 0.62, 0.95, 0.62));
  };
  /** round side table standing on y0 */
  const table = (x: number, z: number, y0: number): void => {
    C.put(WHITEP, 0.7, 0.05, 0.7, x, y0 + 0.62, z);
    C.put(IRON, 0.07, 0.6, 0.07, x, y0 + 0.31, z);
    C.put(IRON, 0.4, 0.04, 0.4, x, y0 + 0.02, z);
    colliders.push(aabbSlab(x, y0, z, 0.75, 0.65, 0.75));
  };
  /** one bedding blob on rung y0: leaf mass + flower head */
  const bloom = (x: number, z: number, y0: number, s = 1): void => {
    S.put(mat.leaf, 0.26 * s, 0.2 * s, 0.26 * s, x, y0 + 0.10 * s, z);
    S.put(BLOOM, 0.15 * s, 0.13 * s, 0.15 * s, x, y0 + 0.22 * s, z);
  };

  // ---------------------------------------------------------------- fences
  // REAL-REFERENCE item 1 / SPEC NT03: TWO builds on a stone plinth, not one
  // picket run. Tall side/rear runs (~1.8-2.0 m total) read as HORIZONTAL stacked
  // boards (f-FKQOEO-1ceE-075.jpg; f-FKQOEO-1ceE-205.jpg left run;
  // f-aICKIbuo8zQ-085.jpg; f-aICKIbuo8zQ-090.jpg) over a 0.35-0.6 m rubble/stone
  // plinth with square posts ~2 m apart, slightly proud. Low front runs
  // (~1.1-1.3 m) read as VERTICAL boards + scalloped/dipped top rail
  // (f-aICKIbuo8zQ-120.jpg; f-aICKIbuo8zQ-175.jpg 2 m bays; f-aICKIbuo8zQ-190.jpg).
  // Current layout has NO street-facing fence run: pavement meets open lawn edged
  // only by the chain-and-post verge, so every run below takes the tall build and
  // no low/scalloped variant is emitted.
  // Rubble is geometry + painted() only (plinth box + wider coping course): there
  // is no masonry veneer in materials.ts yet, so this wants a proper procedural
  // veneer material later (REAL-REFERENCE missing-prop 1).
  // Total height stays <= FENCE_H 2.1, so the traverse/collider contract is
  // unchanged in height. Every gameplay Hole stays open at the same t/w (holes
  // are gameplay concessions, not footage truth); plinth, coping, boards and cap
  // all segment like the back rails and NEVER bridge a hole; colliders split into
  // solid segs only, same aabbSlab pattern; posts skip holed positions.
  const PLINTH_H = 0.5, COPING_H = 0.08, BOARD_TOP = 1.91, POST_TOP = 2.04;
  const PLINTH = mat.painted(PAL.rubbleStone, 0.95, 0);
  const COPING = mat.painted(PAL.rubbleMortar, 0.95, 0);

  /**
   * Tall horizontal-board fence on a rubble plinth, holes punched clean through.
   * `cornerAtA`: this run starts on the corner of another run, which already carries
   * the post there - it is not built again (the same 0.16 m post twice is every face
   * on every face). The plinths and copings still meet in the corner square; they are
   * one flat colour and shade identically, so that tie is not seen.
   */
  function fence(ax: number, az: number, bx: number, bz: number, holes: Hole[], cornerAtA = false): void {
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const ry = Math.atan2(ux, uz);
    const at = (t: number): [number, number] => [ax + ux * t, az + uz * t];
    const holed = (t: number, pad: number): boolean =>
      holes.some((o) => Math.abs(t - o.t * L) < o.w / 2 + pad);

    // solid runs -> plinth/coping/boards/cap/colliders; the holes are left open
    const segs: [number, number][] = [];
    let cur = 0;
    for (const o of holes.slice().sort((p, q) => p.t - q.t)) {
      const s0 = o.t * L - o.w / 2;
      if (s0 > cur) segs.push([cur, s0]);
      cur = Math.max(cur, o.t * L + o.w / 2);
    }
    if (cur < L) segs.push([cur, L]);
    const y0 = PLINTH_H + COPING_H;
    for (const [s0, s1] of segs) {
      const len = s1 - s0;
      const [cx, cz] = at((s0 + s1) / 2);
      B.put(PLINTH, 0.28, PLINTH_H, len, cx, PLINTH_H / 2, cz, ry);
      // a return run's coping is TUCK taller both ways, so where it meets the back run's
      // coping in the corner square neither the tops nor the overhanging soffits tie
      B.put(COPING, 0.36, COPING_H + (cornerAtA ? 2 * TUCK : 0), len, cx, PLINTH_H + COPING_H / 2, cz, ry);
      for (let c = 0; c < 5; c++) {   // 5 stacked courses, 0.25 boards + 0.02 gaps
        const y = y0 + 0.125 + c * 0.27;
        B.put(mat.timber, 0.06, 0.25, len, cx, y, cz, ry);
      }
      B.put(mat.timberDark, 0.2, 0.08, len, cx, BOARD_TOP + 0.04, cz, ry);  // cap: segmented
      for (const y of [y0 + 0.42, y0 + 1.02]) {   // back rails behind the boards
        B.put(mat.timberDark, 0.08, 0.1, len, cx - uz * 0.07, y, cz + ux * 0.07, ry);
      }
      colliders.push(aabbSlab(cx, 0, cz,
        Math.abs(ux) * len + Math.abs(uz) * 0.36, FENCE_H,
        Math.abs(uz) * len + Math.abs(ux) * 0.36));
    }
    const np = Math.max(2, Math.round(L / 2.0));   // square posts ~2 m, proud of the cap
    for (let j = cornerAtA ? 1 : 0; j <= np; j++) {
      const d = (j / np) * L;
      if (holed(d, 0.2)) continue;
      const [x, z] = at(d);
      B.put(mat.timberDark, 0.16, POST_TOP, 0.16, x, POST_TOP / 2, z, ry);
    }
  }

  for (const h of HOUSES) {
    const zf = h.side * BACK_FENCE;
    const holes = h.side === ORANGE.side
      ? [{ t: 0.30, w: 1.6 }, { t: 0.74, w: 1.35 }]
      : [{ t: 0.21, w: 1.5 }, { t: 0.57, w: 1.35 }, { t: 0.86, w: 1.6 }];
    fence(YARD_X_MIN, zf, YARD_X_MAX, zf, holes);
    fence(YARD_X_MIN, zf, YARD_X_MIN, h.side * HOUSE_BACK, [], true);   // side returns
    fence(YARD_X_MAX, zf, YARD_X_MAX, h.side * HOUSE_BACK, [], true);
  }
  fence(BOUNDARY_X, -BOUND_Z, BOUNDARY_X, BOUND_Z, []);           // cul-de-sac boundary
  /** Fence runs meet at the yard corners on purpose; the prop overlap check skips them. */
  const FENCE_END = colliders.length;

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
      // the rounded top runs TUCK short of the box at both ends: its flat caps were
      // the box's own end faces (hedge on hedge, different UVs, at every block joint)
      C.span(mat.hedge, w / 2, ax + ux * (s0 + TUCK), body, az + uz * (s0 + TUCK),
        ax + ux * (s1 - TUCK), body, az + uz * (s1 - TUCK));
      colliders.push(aabbSlab(cx, 0, cz, Math.abs(ux) * len + Math.abs(uz) * w, hh,
        Math.abs(uz) * len + Math.abs(ux) * w));
    }
    for (const e of [0, L]) S.put(mat.hedge, w, w, w, ax + ux * e, hgt - w / 2, az + uz * e);
  }

  for (const h of HOUSES) {
    const zin = h.side * (BACK_FENCE - 0.9);
    const [a, b] = h.side === ORANGE.side ? [0.40, 0.68] : [0.28, 0.50];
    // footage box hedge 1.2-1.4 m (f-FKQOEO-1ceE-100.jpg); verge gaps untouched so
    // the traverse verge scan stays permeable on both sides.
    hedge(yx(a), zin, yx(b), zin, rr(1.2, 1.4));                              // inside back fence
    hedge(YARD_X_MIN + 0.9, zin, YARD_X_MIN + 0.9, yz(h, 0.45), 1.3);         // yard edges
    hedge(YARD_X_MAX - 0.9, zin, YARD_X_MAX - 0.9, yz(h, 0.35), 1.25);
    const ve = -h.garageEnd;                                                  // never the drive side
    hedge(ve * (HOUSE_HALF_LEN + GARAGE_LEN * 0.1), fz(h, 0.08),
      ve * (HOUSE_HALF_LEN + GARAGE_LEN), fz(h, 0.08), rr(1.2, 1.4));
  }
  /** Fences and yard-edge hedges define the flanking lanes; props may not enter them. */
  const EDGE_END = colliders.length;
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

  // Six behind the back fences as backdrop, and four ON the front lawns as a true
  // 180-degree rotational pair. The lawn four used to be positioned off HEAD_RADIUS
  // and BOUND_X_MIN - two dimensions that have nothing to do with a lawn - which after
  // the re-proportioning left one tree 1.5 m from the orange porch and another
  // pinching the orange west flank down to a 1.03 m gap beside the garage wing. They
  // are fractions of the lawn now, and they are cover: a trunk is the only thing on
  // either lawn that breaks a sightline above head height.
  for (const [tx, tz] of [
    [yx(0.10), -(BACK_FENCE + 2.6)], [yx(0.52), -(BACK_FENCE + 3.4)],
    [yx(0.90), -(BACK_FENCE + 2.2)], [yx(0.16), BACK_FENCE + 3.0],
    [yx(0.58), BACK_FENCE + 2.3], [yx(0.93), BACK_FENCE + 3.6],
    [hx(1.35), fz(ORANGE, 0.42)], [hx(-0.55), fz(ORANGE, 0.60)],
    [hx(-1.35), fz(WHITE, 0.42)], [hx(0.55), fz(WHITE, 0.60)],
  ]) tree(tx, tz);

  // ---------------------------------------------------------------- street lamps
  function lamp(x: number, z: number, dx: number, dz: number): void {
    const ph = 5.0, R = 1.45;
    const n = Math.hypot(dx, dz) || 1;
    dx /= n; dz /= n;
    C.put(mat.steel, 0.38, 0.26, 0.38, x, 0.13, z);
    C.put(mat.steel, 0.17, ph, 0.17, x, ph / 2, z);
    // Two-span 0.21 m arm: the 0.15 m four-span curve aliased into white
    // asterisks at aerial range (~2px); this is ~3px out there, and the elbow
    // knob keeps a curved read close up. Head lands where it always did.
    const ex = x + dx * R * 0.45, ey = ph + R * 0.52, ez = z + dz * R * 0.45;
    const hx2 = x + dx * R, hy2 = ph + R, hz2 = z + dz * R;
    C.span(mat.steel, 0.105, x, ph, z, ex, ey, ez);
    C.span(mat.steel, 0.105, ex, ey, ez, hx2, hy2, hz2);
    S.put(mat.steel, 0.26, 0.26, 0.26, ex, ey, ez);
    S.put(LAMP, 0.72, 0.36, 0.72, hx2 + dx * 0.24, hy2 - 0.02, hz2 + dz * 0.24);
    S.put(mat.emissive(PAL.sunColor, 0.5), 0.36, 0.14, 0.36, hx2 + dx * 0.24, hy2 - 0.2, hz2 + dz * 0.24);
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
  /**
   * A run of n stones along f(u); instanced, never collided, sits on T_STEP. `skip`
   * drops a stone whose centre lands on another T_STEP feature (the court apron): a
   * stone laid flush INTO a slab is two colours on one plane. The rng is drawn either
   * way so the rest of the yard does not move.
   */
  function stones(n: number, f: (u: number) => [number, number], skip?: (x: number, z: number) => boolean): void {
    for (let i = 0; i < n; i++) {
      const [sx, sz] = f(i / (n - 1));
      const w = rr(0.44, 0.52), d = rr(0.40, 0.47), ry = rr(-0.15, 0.15);
      if (skip && skip(sx, sz)) continue;
      C.put(STONE, w, T_STEP, d, sx, T_STEP / 2, sz, ry);
    }
  }

  // ================================ ORANGE back yard (-z) ================================
  {
    const H = ORANGE;
    // Circular patio off the rear deck (the deck and its stair are another module).
    // It was laid where the OLD yard-ward flight landed; the flight now runs along the
    // back wall instead, so nothing lands on the disc. The disc stays - it is 60 mm of
    // dressing and it still reads as the terrace the back door opens onto.
    const pr = DECK_LEN * 0.36;
    const pxx = H.deckX, pzz = yz(H, (DECK_OUT + pr * 1.12) / YARD_D);  // clear of the deck
    padDisc(SLAB, pr * 2.2, pxx, pzz, T_STEP);   // pale kerb ring, 30 mm proud of the lawn
    padDisc(PAVE, pr * 2, pxx, pzz, T_SURF);     // the terrace itself, 30 mm over the ring

    // glasshouse: a white aluminium frame, not a haze. Dwarf wall, corner posts,
    // eaves + ridge beams, glazing bars every ~0.7 m, door on the east face.
    // SW of the cold frames: 3.4 m off the west fence, 2.2 m off the back fence,
    // 2.9 m off the cold frames, 1.9 m off the west walk corridor.
    const gxx = yx(0.13), gzz = yz(H, 0.68), gw = 3.5, gd = 2.7, gwall = 1.75, grise = 1.0;
    const GBASE = 0.5, FRAME = WHITEP;
    const gh = gwall - GBASE;
    // the x walls butt inside the z walls (both used to run through the corner);
    // the corner posts are 2 * TUCK wider than the 0.12 walls they stand on so their
    // faces are proud of the wall faces rather than on them
    for (const s of [-1, 1]) {
      B.put(SLAB, gw, GBASE, 0.12, gxx, GBASE / 2, gzz + s * (gd / 2));
      B.put(SLAB, 0.12, GBASE, gd + 0.12, gxx + s * (gw / 2), GBASE / 2, gzz);
    }
    const POST = 0.12 + 2 * TUCK;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      B.put(FRAME, POST, gwall + grise, POST, gxx + sx * gw / 2, (gwall + grise) / 2, gzz + sz * gd / 2);
    for (const s of [-1, 1]) {
      B.put(FRAME, gw + 0.12, 0.1, 0.1, gxx, gwall + 0.05, gzz + s * gd / 2);
      B.put(FRAME, 0.1, 0.1, gd + 0.12, gxx + s * gw / 2, gwall + 0.05, gzz);
    }
    B.put(FRAME, gw + 0.14, 0.12, 0.14, gxx, gwall + grise + 0.02, gzz);
    for (let i = -1; i <= 1; i++) {
      for (const s of [-1, 1]) {
        B.put(FRAME, 0.07, gh, 0.07, gxx + i * gw / 4, GBASE + gh / 2, gzz + s * gd / 2);
        B.put(FRAME, 0.07, gh, 0.07, gxx + s * gw / 2, GBASE + gh / 2, gzz + i * gd / 3);
      }
    }
    for (const s of [-1, 1]) {
      B.put(mat.glass, 0.05, 0.55, gd * 0.62, gxx + s * gw / 2, gwall + 0.27, gzz);
      B.put(mat.glass, 0.05, 0.45, gd * 0.30, gxx + s * gw / 2, gwall + 0.775, gzz);   // above the lower pane, not over it
      B.put(FRAME, 0.07, 0.07, gd * 0.62 + 0.1, gxx + s * gw / 2, gwall + 0.55, gzz);
    }
    const slope = Math.atan2(grise, gd / 2), plen = Math.hypot(grise, gd / 2);
    for (const s of [-1, 1]) {
      B.put(mat.glass, gw, gh, 0.05, gxx, GBASE + gh / 2, gzz + s * gd / 2);
      B.put(mat.glass, 0.05, gh, gd, gxx + s * gw / 2, GBASE + gh / 2, gzz);
      B.put(mat.glass, gw, 0.04, plen, gxx, gwall + grise / 2, gzz + s * gd / 4, 0, s * slope);
      for (let i = -1; i <= 1; i++)
        B.put(FRAME, 0.07, 0.07, plen, gxx + i * gw / 4, gwall + grise / 2, gzz + s * gd / 4, 0, s * slope);
    }
    B.put(mat.windowDark, 0.08, 1.5, 0.9, gxx + gw / 2 + 0.02, GBASE + 0.75, gzz);
    for (const s of [-1, 1]) B.put(FRAME, 0.09, 1.6, 0.09, gxx + gw / 2 + 0.03, GBASE + 0.8, gzz + s * 0.5);
    B.put(FRAME, 0.09, 0.09, 1.09, gxx + gw / 2 + 0.03, GBASE + 1.62, gzz);
    B.put(SLAB, 0.7, 0.2, 1.1, gxx + gw / 2 + 0.4, 0.10, gzz);
    colliders.push(aabbSlab(gxx, 0, gzz, gw + 0.2, gwall + grise, gd + 0.2));

    // Cold frames. They were the densest patch of saturated red on the map - sixteen
    // carRed heads in a 4 m square - and they were solid 0.6 m timber boxes with NO
    // collider, so the player walked through them. Four heads each now, in the muted
    // clay key, and an honest slab apiece.
    for (const i of [-1, 1]) {
      // Moved from yx(0.30) / yz(H, 0.8). Once these carried the collider they had
      // always been missing, the pair reached z -34.39 with SPAWN_A standing at
      // z -34.30: the orange team spawned inside a cold frame. They tuck in south of
      // the glasshouse now, 2.2 m west of the spawn and clear of both fences.
      const cx = yx(0.16) + i * 1.2, cz = yz(H, 0.90), cw = 1.9, cd = 0.95, ch = 0.4;
      B.put(mat.timberDark, cw, ch, cd, cx, ch / 2, cz);
      B.put(SOIL, cw - 0.16, 0.08, cd - 0.16, cx, ch - 0.02, cz);
      B.put(mat.glass, cw, 0.05, cd * 1.1, cx, ch + 0.34, cz, 0, -0.5);
      for (let k = 0; k < 4; k++) {
        const fx = cx + rr(-0.75, 0.75), fzz2 = cz + rr(-0.28, 0.28);
        S.put(mat.leaf, 0.2, 0.14, 0.2, fx, ch + 0.05, fzz2);
        S.put(BLOOM, 0.14, 0.13, 0.14, fx, ch + 0.15, fzz2);
      }
      colliders.push(aabbSlab(cx, 0, cz, cw, ch + 0.22, cd * 1.12));
    }

    // white curved-roof carport
    // kx/kw moved east and in from 0.86 / 5.8: the north-west post stood at x 6.08,
    // 0.8 m inside the orange rear deck's own footprint, which is the house builder's.
    // kz 0.45 -> 0.49 (0.42 m deeper) on 2026-09-19: the orange external stair now
    // runs ALONG the back wall into this quarter, and the carport's two shallow posts
    // reached 0.10 m into its exported footprint. The house owns that ground.
    const kx = yx(0.90), kz = yz(H, 0.49), kw = 5.0, kd = 4.6, kph = 2.5;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const ppx = kx + sx * (kw / 2 - 0.2), ppz = kz + sz * (kd / 2 - 0.2);
      C.put(mat.steel, 0.16, kph, 0.16, ppx, kph / 2, ppz);
      // 0.20, not 0.36: a 0.16 m post inside a 0.36 m box is 100 mm of air you cannot
      // walk through on every side, four times over, in the tightest part of the yard.
      colliders.push(aabbSlab(ppx, 0, ppz, 0.20, kph, 0.20));
    }
    for (let i = 0; i < 7; i++) {
      const u0 = i / 7 - 0.5, u1 = (i + 1) / 7 - 0.5;
      const y0 = kph + 0.6 * (1 - 4 * u0 * u0), y1 = kph + 0.6 * (1 - 4 * u1 * u1);
      const dzz = (u1 - u0) * kd, dy = y1 - y0;
      B.put(mat.roofWhite, kw, 0.12, Math.hypot(dzz, dy), kx, (y0 + y1) / 2,
        kz + (u0 + u1) / 2 * kd, 0, -Math.atan2(dy, dzz));
    }

    // Crate store. Two courses, not three: at 2.16 m the stack was a wall in the one
    // shallow corner of this yard that is not the deck, and the owner asked for cover,
    // not walls. clearOfHouse now also pushes it out of the rear-deck volume - the
    // door-only version had moved it EAST, straight under the orange deck.
    const cu = 0.72;
    const czz = yz(H, 0.26);
    const cxx = clearOfHouse(H, yx(0.38), czz, cu * 1.1);
    for (const [ox, oy, oz] of [[-0.5, 0, -0.5], [0.5, 0, -0.5], [-0.5, 0, 0.5], [0.5, 0, 0.5],
                                [-0.44, 1, 0.04], [0.47, 1, 0.16]]) {
      const up = oy === 1 && ox > 0 ? TUCK : 0;   // the two top crates share neither lid nor foot
      B.put(oy === 1 ? mat.timber : mat.timberDark, cu, cu + up, cu, cxx + ox * cu,
        oy * cu + (cu + up) / 2 + up, czz + oz * cu, rr(-0.13, 0.13));
    }
    colliders.push(aabbSlab(cxx, 0, czz, cu * 2.2, cu * 2, cu * 2.2));

    // a straight stone run: patio rim -> glasshouse door. It starts OUTSIDE the ring,
    // not at the disc centre, so no stone is ever laid on top of the patio.
    const dx0 = gxx - pxx, dz0 = (gzz + gd / 2 + 0.7) - pzz;
    const run = Math.hypot(dx0, dz0);
    const u0 = (pr * 1.1 + 0.65) / run;
    stones(15, (u) => {
      const t = u0 + (1 - u0) * u;
      return [pxx + dx0 * t, pzz + dz0 * t];
    });
    // ---- lived-in detail, all founded on the T_* ladder, all instanced
    pot(gxx + gw / 2 + 1.15, gzz - 1.1);
    pot(gxx + gw / 2 + 1.15, gzz + 1.0);
    pot(pxx - 3.2, yz(H, 0.42), 1.15);
    pot(pxx - 2.3, yz(H, 0.38), 0.9);
    B.put(IRON, 0.32, 0.24, 0.2, pxx - 2.75, T_LAWN + 0.12, yz(H, 0.44));   // watering can
    C.span(IRON, 0.03, pxx - 2.75, T_LAWN + 0.2, yz(H, 0.44), pxx - 2.45, T_LAWN + 0.32, yz(H, 0.44));
    const hrx = gxx - 1.3, hrz = gzz + gd / 2 + 0.55;                // hose reel
    for (const s of [-1, 1]) B.put(mat.timberDark, 0.08, 0.7, 0.5, hrx + s * 0.3, T_LAWN + 0.35, hrz);
    C.put(mat.hedge, 0.5, 0.52, 0.5, hrx, T_LAWN + 0.45, hrz, Math.PI / 2, Math.PI / 2);
    colliders.push(aabbSlab(hrx, T_LAWN, hrz, 0.75, 0.7, 0.55));
    // Patio set on the SOUTH half, leaving the north half of the disc as the landing
    // for the stone run and the east-west walk corridor. Every piece goes through
    // clearOfHouse even though none of them is anywhere near a keep-out today: the
    // TABLE was placed directly, and when the orange flight still ran yard-ward it
    // was parked in that flight's bottom tread (captures/verify/stair-orange-foot.png)
    // for a whole wave. A prop this module places directly is a prop nothing checks.
    const pSet = (x: number, z: number, halfW: number): number => clearOfHouse(H, x, z, halfW);
    chair(pSet(pxx - 1.3, pzz - 1.2, 0.31), pzz - 1.2, Math.PI * 0.75, T_SURF);
    chair(pSet(pxx + 1.3, pzz - 1.2, 0.31), pzz - 1.2, -Math.PI * 0.6, T_SURF);
    table(pSet(pxx, pzz - 1.35, 0.375), pzz - 1.35, T_SURF);
    for (let i = 0; i < 8; i++) {                                   // patio bedding ring
      const a = -Math.PI * 0.45 + (i / 7) * Math.PI * 0.75;
      bloom(pxx + Math.cos(a) * (pr * 1.1 + 0.55), pzz + Math.sin(a) * (pr * 1.1 + 0.55),
        T_LAWN, rr(0.85, 1.2));
    }
    {                                                                // run edging
      const ex0 = gxx, ez0 = gzz + gd / 2 + 0.7;
      const sx0 = pxx + dx0 * u0, sz0 = pzz + dz0 * u0;
      const mx = (sx0 + ex0) / 2, mz = (sz0 + ez0) / 2;
      const len = Math.hypot(ex0 - sx0, ez0 - sz0);
      const ry = Math.atan2(ex0 - sx0, ez0 - sz0);
      for (const s of [-1, 1])
        B.put(STONE, 0.14, T_STEP, len, mx + Math.cos(ry) * 0.55 * s, T_STEP / 2, mz - Math.sin(ry) * 0.55 * s, ry);
    }
  }

  // ================================ WHITE back yard (+z) ================================
  {
    const H = WHITE;
    // rounded modernist garden pod
    // pxx was yx(0.20): the pod's east side reached into the white rear deck's
    // volume, 0.22 m off the deck itself. West by 1.5 m and it clears with 1.3 m.
    const pxx = yx(0.11), pzz = yz(H, 0.55), pr = 2.0;
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
    const onApron = (x: number, z: number): boolean =>
      Math.abs(x - qx) < (qL + 0.7) / 2 + 0.3 && Math.abs(z - qz) < (qW + 0.7) / 2 + 0.3;
    stones(11, (u) => {
      const mx = yx(0.30), mz = yz(H, 0.79);                       // bezier control
      const k = (1 - u) * (1 - u), j = 2 * (1 - u) * u, i2 = u * u;
      return [k * ax + j * mx + i2 * bx, k * az + j * mz + i2 * bz];
    }, onApron);
    // ---- lived-in detail, all founded on the T_* ladder, all instanced
    const wlz = yz(H, 0.30);                                         // washing line
    for (const wx of [yx(0.70), yx(0.80)]) {
      B.put(mat.timberDark, 0.12, 1.75, 0.12, wx, T_LAWN + 0.875, wlz);
      B.put(mat.timberDark, 0.5, 0.08, 0.08, wx, T_LAWN + 1.7, wlz);
    }
    C.span(IRON, 0.015, yx(0.70), T_LAWN + 1.68, wlz, yx(0.80), T_LAWN + 1.68, wlz);
    B.put(WHITEP, 0.55, 0.65, 0.04, yx(0.725), T_LAWN + 1.32, wlz);
    B.put(LINEN, 0.5, 0.6, 0.04, yx(0.755), T_LAWN + 1.35, wlz);
    B.put(CLOTHB, 0.55, 0.62, 0.04, yx(0.7775), T_LAWN + 1.34, wlz);
    // One collider per POST. The single 4.3 x 1.75 m box across the whole run was the
    // worst phantom in the map: the mesh is two 0.12 m posts and a wire, and a player
    // walking the 2.4 m of open grass between them hit a wall at chest height.
    for (const wx of [yx(0.70), yx(0.80)]) {
      colliders.push(aabbSlab(wx, T_LAWN, wlz, 0.5, 1.75, 0.16));
    }
    // Chairs and table SOUTH-WEST of the pod, not west of it: at yx(0.11) a chair sat
    // 0.21 m inside the pod's own collider, and the pod is 4.2 m across.
    chair(yx(0.05), yz(H, 0.85), Math.PI / 2, T_LAWN);
    chair(yx(0.12), yz(H, 0.885), Math.PI / 2 + 0.3, T_LAWN);
    table(yx(0.085), yz(H, 0.815), T_LAWN);
    pot(yx(0.075), yz(H, 0.30), 1.1);                                  // pair flanking the pod door
    pot(yx(0.145), yz(H, 0.30), 0.95);
    C.put(FLOWER, 0.3, 0.28, 0.3, yx(0.6025), T_SAND + 0.14, yz(H, 0.741)); // sand toys
    B.put(IRON, 0.06, 0.5, 0.12, yx(0.635), T_SAND + 0.1, yz(H, 0.8125), 0.5);
    S.put(mat.sand, 0.35, 0.18, 0.35, yx(0.6225), T_SAND + 0.06, yz(H, 0.830));
    padBox(SOIL, 5.5, 0.7, yx(0.5375), yz(H, 0.25), T_STEP);         // bedding south of court
    for (let i = 0; i < 7; i++)
      bloom(yx(0.4775) + i * 0.8, yz(H, 0.25) + (i % 2 ? 0.15 : -0.15), T_STEP, rr(0.9, 1.2));
    B.put(SLAB, 0.25, 0.85, 3.0, yx(0.9125), T_LAWN + 0.425, yz(H, 0.464)); // east windbreak
    B.put(PAVE, 0.4, 0.1, 3.2, yx(0.9125), T_LAWN + 0.9, yz(H, 0.464));
    colliders.push(aabbSlab(yx(0.9125), T_LAWN, yz(H, 0.464), 0.4, 1.0, 3.2));
  }

  // ---------------------------------------------------------------- cover
  // Owner, 2026-09-18: "make sure the cover is more evenly distributed, muted, and
  // collision works and everything."
  //
  // WAS: a set authored for a 40 m yard, inherited unchanged into the 29.6 m one. Nine
  // pieces in the two back yards and NOTHING on either frontage but a hedge and the
  // appliance bank; four pairs placed inside each other (two cans overlapping 0.14 m,
  // two dome bins 0.05 m, a chair 0.21 m inside the garden pod, a hydrant and a vent
  // 0.07 m apart against the glasshouse); a carRed flower head on every pot, bloom,
  // cold frame and washing line, where the gameplay frames read timber, concrete,
  // terracotta and dust.
  //
  // NOW: four areas - two back yards, two frontages - each with three to five pieces of
  // 0.6-1.2 m cover on a 3-4 m rhythm, in those four colour families, each aabbSlab the
  // box its own mesh occupies. The only tall things left in a yard are the landmarks
  // that were already there, one per yard. The self-check at the end of this module
  // tests all of that rather than trusting this paragraph.
  //
  // Frames: f-FKQOEO-1ceE-100.jpg (mailbox on a stone pier), f-FKQOEO-1ceE-055.jpg
  // (dome bins + stepping pads), f-aICKIbuo8zQ-055.jpg (DO NOT STACK crates),
  // f-aICKIbuo8zQ-175.jpg (turf rolls).
  const YELLOW = mat.painted(PAL.hazardYellow, 0.6, 0.05);
  const CANGREY = mat.painted(PAL.steel, 0.45, 0.6);
  /** galvanised-gone-dull: the dust key that replaced the reds and the bright green */
  const DUST = mat.painted(PAL.pavingStain, 0.9, 0.05);
  /** trash can 1.05 m: body + lid + knob, standing on rung y0 */
  const trashCan = (m: THREE.Material, x: number, z: number, y0: number): void => {
    C.put(m, 0.55, 0.9, 0.55, x, y0 + 0.45, z);
    C.put(WHITEP, 0.62, 0.08, 0.62, x, y0 + 0.94, z);
    S.put(WHITEP, 0.14, 0.12, 0.14, x, y0 + 1.02, z);
    colliders.push(aabbSlab(x, y0, z, 0.62, 1.05, 0.62));
  };
  /** dome bin 0.95 m: body + white dome lid (f-FKQOEO-1ceE-055.jpg) */
  const domeBin = (m: THREE.Material, x: number, z: number): void => {
    C.put(m, 0.55, 0.72, 0.55, x, T_LAWN + 0.36, z);
    S.put(WHITEP, 0.58, 0.34, 0.58, x, T_LAWN + 0.82, z);
    colliders.push(aabbSlab(x, T_LAWN, z, 0.6, 0.95, 0.6));
  };
  /** mailbox on a stone pier, 1.35 m (f-FKQOEO-1ceE-100.jpg) */
  const mailbox = (x: number, z: number): void => {
    B.put(PLINTH, 0.4, 1.0, 0.4, x, T_LAWN + 0.5, z);
    B.put(COPING, 0.48, 0.08, 0.48, x, T_LAWN + 1.04, z);
    B.put(YELLOW, 0.52, 0.24, 0.3, x, T_LAWN + 1.2, z);
    B.put(YELLOW, 0.04, 0.22, 0.2, x + 0.28, T_LAWN + 1.32, z);  // flag
    colliders.push(aabbSlab(x, T_LAWN, z, 0.55, 1.35, 0.5));
  };
  /** turf roll 0.6 m: horizontal cylinder lying along x (f-aICKIbuo8zQ-175.jpg) */
  const turfRoll = (x: number, z: number): void => {
    C.put(mat.leaf, 1.8, 0.6, 0.6, x, T_LAWN + 0.3, z, Math.PI / 2, Math.PI / 2);
    colliders.push(aabbSlab(x, T_LAWN, z, 1.8, 0.6, 0.6));
  };
  /**
   * Two timber crates side by side, optionally a third on top: 0.60 m or 1.18 m.
   * The pair is jittered in yaw, so the collider carries 60 mm over the nominal
   * footprint - that is the corner swing at 0.1 rad and nothing more.
   */
  const CU = 0.58;
  const crateStack = (x: number, z: number, ry: number, high: boolean): void => {
    const rows: [number, number][] = high
      ? [[-0.5, 0], [0.5, 0], [0.04, 1]] : [[-0.5, 0], [0.5, 0]];
    for (const [ox, oy] of rows) {
      const [bx, bz] = l2w(x, z, ry, ox * CU, 0);
      B.put(oy ? mat.timber : mat.timberDark, CU, CU, CU,
        bx, T_LAWN + oy * CU + CU / 2, bz, ry + rr(-0.1, 0.1));
    }
    const len = CU * 2 + 0.06, wid = CU + 0.06;
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    colliders.push(aabbSlab(x, T_LAWN, z, c * len + s * wid,
      CU * (high ? 2 : 1) + 0.02, s * len + c * wid));
  };
  /** Dust-toned drum on a timber pallet - 1.0 m, the yards' standard waist cover. */
  const drum = (x: number, z: number): void => {
    B.put(mat.timberDark, 0.86, 0.12, 0.86, x, T_LAWN + 0.06, z);
    C.put(DUST, 0.60, 0.84, 0.60, x, T_LAWN + 0.54, z);
    C.put(PAVE, 0.64, 0.05, 0.64, x, T_LAWN + 0.955, z);          // rolled lid
    C.put(PAVE, 0.62, 0.04, 0.62, x, T_LAWN + 0.70, z);           // rolling hoop
    colliders.push(aabbSlab(x, T_LAWN, z, 0.86, 1.0, 0.86));
  };
  /** Low rubble block wall, 1.05 m; `len` runs along local +z before the yaw. */
  const lowWall = (x: number, z: number, len: number, ry: number): void => {
    B.put(PLINTH, 0.34, 0.92, len, x, T_LAWN + 0.46, z, ry);
    B.put(COPING, 0.44, 0.13, len + 0.12, x, T_LAWN + 0.985, z, ry);
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    colliders.push(aabbSlab(x, T_LAWN, z,
      c * 0.44 + s * (len + 0.12), 1.05, s * 0.44 + c * (len + 0.12)));
  };
  /** Timber sleeper planter with a clipped box hedge in it - 1.1 m of soft cover. */
  const planterBox = (x: number, z: number, len: number, ry: number): void => {
    const w = 0.86;
    B.put(mat.timber, w, 0.52, len, x, T_LAWN + 0.26, z, ry);
    B.put(mat.timberDark, w + 0.08, 0.09, len + 0.08, x, T_LAWN + 0.555, z, ry);
    B.put(SOIL, w - 0.2, 0.06, len - 0.2, x, T_LAWN + 0.55, z, ry);
    const n = Math.max(2, Math.round(len / 0.8));
    for (let i = 0; i < n; i++) {
      const [bx, bz] = l2w(x, z, ry, 0, ((i + 0.5) / n - 0.5) * len);
      S.put(mat.hedge, w * 0.92, 0.54, (len / n) * 1.12, bx, T_LAWN + 0.83, bz, ry);
    }
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    colliders.push(aabbSlab(x, T_LAWN, z,
      c * (w + 0.08) + s * (len + 0.08), 1.10, s * (w + 0.08) + c * (len + 0.08)));
  };
  const ACROSS = Math.PI / 2;   // a run laid along x rather than along z

  { // ORANGE back yard (-z). The two empty quarters were WEST-shallow and
    // EAST-shallow; the deep half already carries glasshouse, carport, cold frames
    // and the patio set. A block wall and a crate stack fill them, the two cans move
    // apart and off the line of the x = +7.1 fence hole, and one turf roll goes -
    // two of them lying 0.65 m apart read as one lump anyway.
    const H = ORANGE;
    lowWall(yx(0.14), yz(H, 0.17), 2.6, ACROSS);                 // west-shallow
    // The east-SHALLOW quarter is the external stair's ground now - the flight runs
    // along the back wall from the deck's free end out to x 10.32 - so these two drop
    // ~2 m deeper, under the carport canopy, where crates and a turf roll belong
    // anyway. z 0.11 -> 0.31 and 0.15 -> 0.34; x unchanged.
    crateStack(yx(0.86), yz(H, 0.31), 0.24, true);               // east, under the carport
    turfRoll(yx(0.96), yz(H, 0.34));                             // clear of carport posts
    trashCan(CANGREY, yx(0.84), yz(H, 0.77), T_LAWN);            // south of the carport
    trashCan(DUST, yx(0.90), yz(H, 0.73), T_LAWN);
    drum(yx(0.10), yz(H, 0.38));                                 // west walk, mid depth
  }

  { // WHITE back yard (+z). Same read: the pod, the court, the pit and the washing
    // line fill the middle and the deep half, so cover goes WEST-shallow (a planter
    // in the gap between the west fence and the pod) and EAST (a drum at the shallow
    // end, the lettered crates at mid depth), with the dome bins moved apart and west
    // of the x = +10.7 fence hole. The lettered crates used to stand in the west
    // corner where the pod now is; they ARE a crate stack, so they do that job here
    // rather than a plain one being added beside them.
    const H = WHITE;
    const qx = yx(0.80), qz = yz(H, 0.66);
    B.put(YELLOW, 0.72, 0.72, 0.72, qx, T_LAWN + 0.36, qz);       // the one hazard pair
    B.put(mat.timber, 0.66, 0.66, 0.66, qx + 0.15, T_LAWN + 1.05, qz - 0.1, 0.18);
    B.put(mat.signText({ text: 'DO NOT STACK', color: PAL.busBlack, background: PAL.hazardYellow, aspect: 1.7 }),
      0.62, 0.36, 0.03, qx, T_LAWN + 0.75, qz - 0.38);            // the one signText
    colliders.push(aabbSlab(qx, T_LAWN, qz, 1.0, 1.4, 1.0));
    // The planter was the west-shallow piece at yx(0.08) / yz(0.19), and
    // captures/verify/stair-white-foot.png is a photograph of it standing on the
    // bottom four treads of the white external stair. That whole quarter IS the
    // stair's footprint (x -10.97..-6.40 at z 27.33..29.28) and the garden pod takes
    // everything behind it, so there is no west-shallow spot left for a 2.48 m box:
    // it moves to the east-shallow face, which had nothing between the back door and
    // the drum. clearOfHouse now guards it either way.
    const plx = yx(0.70), plz = yz(H, 0.12);
    planterBox(clearOfHouse(H, plx, plz, 1.24), plz, 2.4, ACROSS);
    drum(yx(0.94), yz(H, 0.22));                                  // east-shallow
    domeBin(mat.hedge, yx(0.80), yz(H, 0.86));                    // olive ...
    domeBin(WHITEP, yx(0.86), yz(H, 0.83));                       // ... and pale
    padDisc(STONE, 0.7, yx(0.125), yz(H, 0.28), T_STEP);          // pod approach discs
    padDisc(STONE, 0.7, yx(0.16), yz(H, 0.28), T_STEP);           // clear of the first (they overlapped)
  }

  // ---------------------------------------------------------------- front lawns
  // Both lawns had one hedge run and one appliance bank between the pavement and the
  // porch - 8.4 m of open grass you cross under fire from an upper window with nothing
  // to drop behind. Three pieces each now, placed to the same rhythm but from
  // different objects, because the lawns are a 180-degree rotational pair and the two
  // houses are not meant to dress alike. Everything stays clear of the porch path that
  // the chain run leaves open, of the front-door apron, and of the drive each garage
  // wing faces: the orange drive already has the red saloon parked on it, the white
  // drive gets the drum pair instead.
  {
    const O = ORANGE, W = WHITE;
    mailbox(hx(-0.30), O.side * (PAVEMENT_OUTER + 0.95));         // orange verge
    lowWall(hx(1.45), fz(O, 0.58), 2.8, ACROSS);                  // orange lawn, east
    crateStack(hx(0.0), fz(O, 0.25), 0.1, true);                  // orange lawn, west
    planterBox(hx(-0.80), W.side * (PAVEMENT_OUTER + 0.95), 2.4, ACROSS);
    drum(hx(1.45), fz(W, 0.58));                                  // white drive
    drum(hx(1.62), fz(W, 0.50));
    crateStack(hx(0.0), fz(W, 0.25), -0.1, true);                 // white lawn, east
  }

  B.flush(g, 'yard-box');
  C.flush(g, 'yard-cyl');
  S.flush(g, 'yard-sph');

  // ---------------------------------------------------------------- self-check
  // Four things this module has got wrong before, each once it had already shipped a
  // green gate. They are cheap to test and the test cannot go stale, so they run at
  // build time over our own colliders. Everything is REPORTED, never silently
  // dropped: a collider deleted here leaves a solid-looking mesh you walk through,
  // which is a worse bug than the one it would hide.
  const span = (c: AABB): string =>
    `x ${c.min.x.toFixed(1)}..${c.max.x.toFixed(1)} z ${c.min.z.toFixed(1)}..${c.max.z.toFixed(1)}`;
  const warn = (what: string, bad: AABB[]): void => {
    if (bad.length) console.warn('[yards] %d collider(s) %s: %s',
      bad.length, what, bad.map(span).join(' | '));
  };

  // 1. A prop is allowed to be wide; it is not allowed to be wide INTO a flanking
  //    lane. Those two runs down the sides of each house are the only way round it.
  //    PROPS only: the boundary fences ARE the lane's outer wall and the yard-edge
  //    hedges are the yard's own planting, both deliberately in that band (they leave
  //    a 1.3 m walk at the deep end and nothing at all across the garage squeeze).
  //    Counting them made this warning fire fifteen times on every load, which is the
  //    same as not having it.
  const LANE_IN = YARD_X_MIN + PROP_LANE * 0.5;
  const LANE_OUT = YARD_X_MAX - PROP_LANE * 0.5;
  warn('reach into a flanking lane', colliders.slice(EDGE_END).filter((c) =>
    Math.abs(c.max.z) > HOUSE_BACK && (c.min.x < LANE_IN || c.max.x > LANE_OUT)));

  // 2. Door aprons. A sealed door is the most expensive bug this project has had: it
  //    looks like a house and behaves like a wall, and no single module is wrong
  //    about it. Both faces now - props stand on the front lawns too.
  for (const h of HOUSES) {
    for (const [face, wallZ, doorX] of [
      ['back', h.backZ, h.backDoorX], ['front', h.frontZ, h.frontDoorX],
    ] as [string, number, number][]) {
      const out = Math.sign(wallZ);   // which way the apron reaches from that wall
      warn(`stand in the ${h.side < 0 ? 'ORANGE' : 'WHITE'} ${face}-door apron`,
        colliders.filter((c) => {
          const zNear = out > 0 ? c.min.z : c.max.z;
          const d = (zNear - wallZ) * out;
          return d >= -0.4 && d <= DOOR_APRON_DEPTH
            && c.max.x > doorX - DOOR_APRON_HALF_W && c.min.x < doorX + DOOR_APRON_HALF_W
            && c.max.y - c.min.y > 0.4;
        }));
    }
  }

  // 3. The rear deck, its undercroft and its external stair belong to the house
  //    builder. clearOfHouse keeps props out of that volume; this proves it did.
  for (const h of HOUSES) {
    warn(`stand in the ${h.side < 0 ? 'ORANGE' : 'WHITE'} rear-deck volume`,
      colliders.filter((c) => {
        const az = Math.min(Math.abs(c.min.z), Math.abs(c.max.z));
        return h.side * c.min.z > 0 && az >= Math.abs(h.backZ) - 0.2
          && az <= Math.abs(h.backZ) + DECK_KEEP_D
          && c.max.x > h.deckX - DECK_KEEP_HALF && c.min.x < h.deckX + DECK_KEEP_HALF;
      }));
  }

  // 4. Two of our own props standing inside each other. Four pairs did before this
  //    pass - a chair 0.21 m into the garden pod, two bins overlapping by 0.05 m -
  //    and none of them is visible in a plan render or catchable by a traverse.
  //    O(n^2) over ~70 boxes, once, at build time.
  const OVERLAP = 0.02;       // touching is fine; interpenetrating is not
  const pairs: AABB[] = [];
  for (let i = 0; i < colliders.length; i++) {
    for (let j = i + 1; j < colliders.length; j++) {
      if (i < FENCE_END && j < FENCE_END) continue;
      const a = colliders[i], b = colliders[j];
      if (Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) <= OVERLAP) continue;
      if (Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z) <= OVERLAP) continue;
      if (Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y) <= OVERLAP) continue;
      pairs.push(a, b);
    }
  }
  warn('interpenetrate another yard prop (listed in pairs)', pairs);

  // 5. Nothing of ours within SPAWN_CLEAR of either spawn point. Giving the cold
  //    frames the honest collider they had always been missing put one of them 90 mm
  //    from SPAWN_A, and a player who spawns inside the scenery has no idea why he
  //    cannot walk. paths.mjs only reports the nearest standable cell, so it shows
  //    this as a 0.6 m shrug rather than as a failure.
  const SPAWN_CLEAR = 1.2;
  for (const [name, sp] of [['A', SPAWN_A], ['B', SPAWN_B]] as const) {
    warn(`stand within ${SPAWN_CLEAR} m of spawn ${name}`, colliders.filter((c) =>
      sp.x > c.min.x - SPAWN_CLEAR && sp.x < c.max.x + SPAWN_CLEAR
      && sp.z > c.min.z - SPAWN_CLEAR && sp.z < c.max.z + SPAWN_CLEAR
      && c.max.y - c.min.y > 0.4));
  }

  // 6. THE EXTERNAL STAIRS. Check 3 tests the deck volume, and both flights run PAST
  //    it: the white one 3.77 m along -x, the orange one 3.92 m along +x. So a
  //    planterBox could be, and for a whole wave was, built into the bottom four
  //    treads of the white stair with no module being wrong about it - the yard did
  //    not know the stair existed. Each house now EXPORTS its flight's footprint and
  //    this asserts on it. Unlike the warnings above it THROWS in dev, because the
  //    thing it guards against is a future re-proportioning silently recreating the
  //    same defect; in a built artifact it reports loudly rather than taking the map
  //    down in front of a player.
  const inStair: string[] = [];
  for (const h of HOUSES) {
    const f = stairFootprint(h);
    const name = h.side < 0 ? 'ORANGE' : 'WHITE';
    for (const c of colliders) {
      if (c.max.x <= f.minX || c.min.x >= f.maxX) continue;
      if (c.max.z <= f.minZ || c.min.z >= f.maxZ) continue;
      inStair.push(`${name} stair footprint (x ${f.minX.toFixed(2)}..${f.maxX.toFixed(2)} `
        + `z ${f.minZ.toFixed(2)}..${f.maxZ.toFixed(2)}) <- ${span(c)}`);
    }
  }
  if (inStair.length) {
    const msg = `[yards] ${inStair.length} collider(s) stand in an external-stair `
      + `footprint: ${inStair.join(' | ')}`;
    if (import.meta.env.DEV) throw new Error(msg);
    console.error(msg);
  }

  return { group: g, colliders };
};
