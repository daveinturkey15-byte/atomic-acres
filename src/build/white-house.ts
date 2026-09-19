/**
 * WHITE HOUSE - the +z show home (layout.WHITE).
 * 180-degree rotational PARTNER of the orange house, not its mirror: two rounded capsule
 * volumes - tall rear capsule with divided-light roof lantern + louvred plant drum, lower
 * entry capsule on the street face. Placement derives from layout; detail sizes are literals.
 */
import * as THREE from 'three';
import { PAL } from '../core/palette';
import {
  WHITE, HOUSE_HALF_LEN, HOUSE_DEPTH, FLOOR_H, UPPER_H, EAVE_Y, GARAGE_LEN, GARAGE_DEPTH,
  GARAGE_H, GARAGE_BAYS, DECK_Y, DECK_LEN, DECK_OUT, RAIL_H, KERB_HEIGHT, CANOPY_Y,
  CANOPY_LEN, CANOPY_OUT,
} from '../core/layout';
import { aabb, aabbSlab, box, extrude, group, slab } from '../core/kit';
import type { AABB, Builder } from '../core/kit';

/** Rounded-rectangle plan in world x/z. r === hz gives a stadium (capsule). */
interface Plan { cx: number; cz: number; hx: number; hz: number; r: number }

/** Signed distance from (x,z) to the plan outline; negative is inside. */
function planSdf(p: Plan, x: number, z: number): number {
  const dx = Math.abs(x - p.cx) - (p.hx - p.r);
  const dz = Math.abs(z - p.cz) - (p.hz - p.r);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - p.r;
}

/** Closed outline sampled at roughly `step` metres. Vector2 is (worldX, worldZ). */
function planLoop(p: Plan, step: number): THREE.Vector2[] {
  const sx = p.hx - p.r, sz = p.hz - p.r;
  const out: THREE.Vector2[] = [];
  const arc = (ox: number, oz: number, a0: number) => {
    const n = Math.max(2, Math.ceil((p.r * Math.PI * 0.5) / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 0.5;
      out.push(new THREE.Vector2(p.cx + ox + p.r * Math.cos(a), p.cz + oz + p.r * Math.sin(a)));
    }
  };
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let i = 0; i < n; i++) out.push(new THREE.Vector2(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n));
  };
  arc(sx, sz, 0); line(p.cx + sx, p.cz + sz + p.r, p.cx - sx, p.cz + sz + p.r);
  arc(-sx, sz, Math.PI * 0.5); line(p.cx - sx - p.r, p.cz + sz, p.cx - sx - p.r, p.cz - sz);
  arc(-sx, -sz, Math.PI); line(p.cx - sx, p.cz - sz - p.r, p.cx + sx, p.cz - sz - p.r);
  arc(sx, -sz, Math.PI * 1.5); line(p.cx + sx + p.r, p.cz - sz, p.cx + sx + p.r, p.cz + sz);
  return out;
}

/** Vertical prism of a rounded plan; base sits at yBase. */
function prism(p: Plan, h: number, yBase: number, material: THREE.Material, seg = 8): THREE.Mesh {
  const s = new THREE.Shape();
  const x0 = p.cx - p.hx + p.r, x1 = p.cx + p.hx - p.r, z0 = p.cz - p.hz + p.r, z1 = p.cz + p.hz - p.r;
  s.absarc(x1, z1, p.r, 0, Math.PI * 0.5, false);
  s.absarc(x0, z1, p.r, Math.PI * 0.5, Math.PI, false);
  s.absarc(x0, z0, p.r, Math.PI, Math.PI * 1.5, false);
  s.absarc(x1, z0, p.r, Math.PI * 1.5, Math.PI * 2, false);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg });
  g.rotateX(Math.PI * 0.5); g.translate(0, h, 0);
  const m = new THREE.Mesh(g, material);
  m.position.y = yBase; m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Oriented boxes -> ONE InstancedMesh, so a whole shell is 1 draw call. */
class Batch {
  private rows: number[][] = [];
  /** rotX / rotZ are for the few tilted parts (a rolled door panel, diamonds on a wall). */
  add(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0): void {
    if (w <= 0 || h <= 0 || d <= 0) return;
    this.rows.push([w, h, d, x, y, z, rotY, rotX, rotZ]);
  }
  mesh(material: THREE.Material, name: string): THREE.InstancedMesh | null {
    const n = this.rows.length;
    if (!n) return null;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, n);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const r = this.rows[i];
      q.setFromEuler(e.set(r[7], r[6], r[8], 'YXZ')); pos.set(r[3], r[4], r[5]); scl.set(r[0], r[1], r[2]);
      im.setMatrixAt(i, mtx.compose(pos, q, scl));
    }
    im.instanceMatrix.needsUpdate = true; im.castShadow = im.receiveShadow = true; im.name = name;
    return im;
  }
}

// ------------------------------------------------------------------ constants
const S = WHITE.side, Z_FRONT = WHITE.frontZ, Z_BACK = WHITE.backZ;
// COARSE is the collider chord. It was 1.2: on the curved ends a 1.2 m chord at 26
// degrees to the axis becomes a 0.75 m deep AABB, 0.5 m of phantom wall inside the
// room - which is what pinched the upper rear hall shut for paths.mjs at the deck door.
// At 0.6 the same chord is 0.40 m deep, 0.08 m of phantom.
const WALL_T = 0.26, CHORD = 0.55, COARSE = 0.6;
const GLAZ_IN = WALL_T * 0.32, GLAZ_T = WALL_T * 0.3; // pane set back: soffit + cill shadow lines
const PIER_EVERY = 6;
const REAR_D = HOUSE_DEPTH * 0.72, FRONT_D = HOUSE_DEPTH * 0.56;
const REAR: Plan = { cx: 0, cz: Z_BACK - S * REAR_D * 0.5, hx: HOUSE_HALF_LEN, hz: REAR_D * 0.5, r: REAR_D * 0.5 };
const FRONT: Plan = { cx: -HOUSE_HALF_LEN * 0.12, cz: Z_FRONT + S * FRONT_D * 0.5, hx: HOUSE_HALF_LEN * 0.77, hz: FRONT_D * 0.5, r: FRONT_D * 0.5 };
const H_REAR = EAVE_Y, H_FRONT = FLOOR_H + UPPER_H * 0.38;
const G_SILL = FLOOR_H * 0.33, G_HEAD = FLOOR_H * 0.78;
const U_SILL = FLOOR_H + UPPER_H * 0.31, U_HEAD = FLOOR_H + UPPER_H * 0.755;
// Door centres come from the layout contract so the yard builder can keep its keep-clear
// aprons off them; these two fractions were the source of WHITE's values.
const DOOR_HALF = 0.9, FRONT_DOOR_X = WHITE.frontDoorX, YARD_DOOR_X = WHITE.backDoorX;
const GAR_CX = WHITE.garageX, GAR_CZ = Z_FRONT + S * GARAGE_DEPTH * 0.5;
const GAR_PLAN: Plan = { cx: GAR_CX, cz: GAR_CZ, hx: GARAGE_LEN * 0.5, hz: GARAGE_DEPTH * 0.5, r: GARAGE_LEN * 0.12 };
const LINK_W = REAR_D * 0.52, LINK_D = REAR_D * 0.7, LINK_CX = HOUSE_HALF_LEN - LINK_W * 0.5 + 0.3;
const LINK: Plan = { cx: LINK_CX, cz: REAR.cz, hx: LINK_W * 0.5, hz: LINK_D * 0.5, r: 0.2 };
const DECK_CX = WHITE.deckX, DECK_CZ = Z_BACK + S * DECK_OUT * 0.5, DECK_END = -WHITE.garageEnd;
const DECK_EDGE_X = DECK_CX + DECK_END * DECK_LEN * 0.5;
const STEPS = 13, STEP_RISE = DECK_Y / STEPS, STEP_GOING = 0.29, DECK_T = KERB_HEIGHT + 0.1;
const STAIR_W = 1.35;                     // tread width, across the flight
const STAIR_RUN = STEPS * STEP_GOING;     // 3.77 m along x
const STAIR_FOOT_X = DECK_EDGE_X + DECK_END * STAIR_RUN;
/** landing a player needs past the bottom tread, and clearance either side */
const STAIR_LANDING = 0.8;
const STAIR_SIDE = 0.3;

/**
 * The ground this house's external rear stair owns, as an AABB in world x/z.
 *
 * yards.ts imports this and keeps every prop out of it. It exists because the deck
 * keep-out yards.ts already had (DECK_LEN / DECK_OUT) stops at the deck, and this
 * flight runs 3.77 m PAST that volume in x - so a yards.ts planterBox was built into
 * the bottom four treads (captures/verify/stair-white-foot.png: a hedge sitting on
 * the steps) with no module being wrong about it. Derived from the SAME constants
 * that build the treads, so a re-proportioning moves the keep-out with the stair.
 */
export const WHITE_STAIR_FOOTPRINT = {
  minX: Math.min(DECK_EDGE_X, STAIR_FOOT_X + DECK_END * STAIR_LANDING),
  maxX: Math.max(DECK_EDGE_X, STAIR_FOOT_X + DECK_END * STAIR_LANDING),
  minZ: DECK_CZ - STAIR_W / 2 - STAIR_SIDE,
  maxZ: DECK_CZ + STAIR_W / 2 + STAIR_SIDE,
};

// ---------------------------------------------------- interior plan (s2/s6 topology)
// Signed off WHITE so a later handedness flip moves the whole plan with one sign.
const GEW = WHITE.garageEnd;                        // +1: the garage end in x
const SLAB_T = 0.22;                                // upper floor slab
const RAIL_IN = 1.0;                                // internal balustrade
// The upper floor starts PAST the single-storey entry capsule: over that capsule the
// roof is at 4.31 m and a floor at 3.15 would leave 1.16 m of headroom. What is left
// is the two-storey void the landing looks down into.
const VOID_Z = Z_FRONT + S * (FRONT_D + 0.25);
const RISERS = 12;                                  // 0.2625 m a riser, inside STEP_UP
const RISE = FLOOR_H / RISERS;
const GOING = 0.27;
const ST_W = 1.4;
const ST_X = GEW * (HOUSE_HALF_LEN * 0.30);
const ST_Z0 = REAR.cz - S * 2.0;                    // foot, out under the void
const ST_Z1 = ST_Z0 + S * RISERS * GOING;           // head
const GAR_DOOR_Z = Z_FRONT + S * (HOUSE_DEPTH * 0.545);
const BAY_W = 2.4, BAY_H = GARAGE_H * 0.63;
const BAY_JAMB = (GARAGE_LEN - GARAGE_BAYS * BAY_W) / (GARAGE_BAYS + 1);
const GAR_OUT_X = GAR_CX + GEW * (GARAGE_LEN / 2);
const OPEN_BAY = GARAGE_BAYS - 1;                   // the bay nearest the house stands open
// Absolute coping top. The floor the player actually stands on indoors is ground.ts's
// lawn plateau at KERB_HEIGHT + 0.001 = 0.151, not y = 0, so a 0.34 rim left only
// 0.19 m of pool. 0.50 gives a 0.349 m step in and the same step out, inside the
// controller's STEP_UP of 0.38.
/**
 * ground.ts lays the house and garage interior floor pad at T_FLOOR = KERB_HEIGHT + 0.004
 * (must track it). Every ground-floor finish sits ON that pad, not on y = 0: at y = 0 the
 * hearth, the partition skirtings and the pool basin were buried in it (the basin's top
 * was 1 mm over the pad - a z-fight at any distance).
 */
const FLOOR_Y = KERB_HEIGHT + 0.004;
const POOL_FLOOR = FLOOR_Y + 0.02;
const POOL_RIM = 0.50;

/** Interior |x| of the REAR capsule at this z, on the outline; -1 where there is none. */
function rearX(z: number): number {
  const d = Math.abs(z - REAR.cz);
  return d > REAR.r ? -1 : (REAR.hx - REAR.r) + Math.sqrt(REAR.r * REAR.r - d * d);
}
/** Sorted [min,max] from two unordered bounds. */
const span = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean =>
  Math.max(a0, b0) < Math.min(a1, b1) - 1e-6;
/** [lo,hi] minus sorted cut intervals. */
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

/**
 * A door hole, located by a PLAN POINT and a radius rather than by "flat face + x".
 * The old test could only cut the two flat faces, which is why the garage could never
 * have an internal door: the kitchen wall it has to pass through is the curved +x end
 * of the rear capsule. Distance works on a curve and on a flat run alike.
 */
interface Hole { x: number; z: number; r: number; y0: number; y1: number }

// ------------------------------------------------------------------ builder
export const buildWhiteHouse: Builder = (ctx) => {
  const g = group('white-house');
  const colliders: AABB[] = [];
  const bWall = new Batch(), bGlaz = new Batch(), bTrim = new Batch();
  // Interior room surfaces only - ceiling/floor slab, partitions, chimney breast.
  // The capsule shell is ONE box per run, so its inner face cannot be split off; what
  // can be split is everything that is only ever seen from inside. One extra call.
  const bWallIn = new Batch();
  const bDark = new Batch(), bWood = new Batch(), bSteel = new Batch(), bGlow = new Batch();
  const bPlum = new Batch(), bGold = new Batch(), bMint = new Batch(), bRubble = new Batch();

  /**
   * One wall/glass/trim chunk along a chord, pushed `out` proud of the face.
   *
   * `mitre` says, per end, whether the chord turns into its neighbour (1: extend 0.3 t
   * so the two boxes overlap and the corner closes) or continues it in a straight line
   * (0: end exactly on the loop point so the boxes ABUT). Every chord used to extend
   * both ends unconditionally, which on every straight run - the yard face, the garage
   * walls, the entry capsule's street face, the parapet and skirt bands - laid two
   * coplanar textured faces over each other for 0.156 m out of every 0.55 m: 488 such
   * pairs and 66 m2 of stucco fighting itself (scripts/_ownerfix-geom.mjs coplanar).
   */
  const run = (b: Batch, a: THREE.Vector2, c: THREE.Vector2, p: Plan,
    y0: number, y1: number, t: number, out: number, grow = 0, mitre: [number, number] = [1, 1],
    extra: [number, number] = [0, 0]): void => {
    const dx = c.x - a.x, dz = c.y - a.y, L = Math.hypot(dx, dz);
    if (L < 1e-3 || y1 - y0 < 0.04) return;
    const ea = mitre[0] * t * 0.3 + extra[0], ec = mitre[1] * t * 0.3 + extra[1];
    const shift = (ec - ea) * 0.5 / L;                       // centre slides toward the longer end
    const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
    // `out` is measured along the CHORD'S perpendicular, oriented away from the plan
    // centre - not along the ray from the centre, which on a stadium's straight runs
    // also carried a tangential component that slid every pane, cill and transom up to
    // 48 mm along the wall (and left 5 mm coplanar overlaps between neighbours).
    let nx = -dz / L, nz = dx / L;
    if (nx * (mx - p.cx) + nz * (mz - p.cz) < 0) { nx = -nx; nz = -nz; }
    b.add(L + ea + ec + grow, y1 - y0, t, mx + dx * shift + nx * out, (y0 + y1) * 0.5,
      mz + dz * shift + nz * out, Math.atan2(-dz, dx));
  };
  /** Per-end mitre flags for chord i of a closed loop: 0 where the neighbour is collinear. */
  const mitreOf = (loop: THREE.Vector2[], i: number): [number, number] => {
    const n = loop.length;
    const turns = (u: THREE.Vector2, v: THREE.Vector2, w: THREE.Vector2): number => {
      const ax = v.x - u.x, az = v.y - u.y, bx = w.x - v.x, bz = w.y - v.y;
      const cross = ax * bz - az * bx, la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      return Math.abs(cross) / (la * lb) > 1e-4 ? 1 : 0;
    };
    const p = loop[(i - 1 + n) % n], a = loop[i], c = loop[(i + 1) % n], q = loop[(i + 2) % n];
    return [turns(p, a, c), turns(a, c, q)];
  };

  /** Capsule shell: wall/glazing bands, trim, door holes; chords inside a neighbour drop out. */
  const shell = (p: Plan, top: number, twoStorey: boolean, holes: Hole[], others: Plan[]): void => {
    const loop = planLoop(p, CHORD);
    const n = loop.length;
    const midOf = (j: number): [number, number] => {
      const a = loop[(j + n) % n], c = loop[(j + 1 + n) % n];
      return [(a.x + c.x) * 0.5, (a.y + c.y) * 0.5];
    };
    const dropped = (j: number): boolean => { const [mx, mz] = midOf(j); return others.some((o) => planSdf(o, mx, mz) < -0.18); };
    const holeOf = (j: number): Hole | null => {
      const [mx, mz] = midOf(j);
      let h: Hole | null = null;
      for (const d of holes) if (Math.hypot(mx - d.x, mz - d.z) < d.r) h = d;
      return h;
    };
    /** Is chord j absent in the band y0..y1 - dropped inside a neighbour, or wholly in a door? */
    const absent = (j: number, y0: number, y1: number): boolean => {
      if (dropped(j)) return true;
      const h = holeOf(j);
      return h !== null && y0 >= h.y0 - 1e-6 && y1 <= h.y1 + 1e-6;
    };
    for (let i = 0; i < n; i++) {
      const a = loop[i], c = loop[(i + 1) % n];
      if (dropped(i)) continue;
      const m = mitreOf(loop, i);
      const hole = holeOf(i);
      const put = (y0: number, y1: number, glass: boolean): void => {
        const cut = hole !== null && y1 > hole.y0 && y0 < hole.y1;
        const glazed = glass && !(i % PIER_EVERY === 0 && !cut);
        const b = glazed ? bGlaz : bWall, t = glazed ? GLAZ_T : WALL_T, o = glazed ? -GLAZ_IN : 0;
        if (cut && hole) {
          if (y0 < hole.y0) run(b, a, c, p, y0, hole.y0, t, o, 0, m);
          if (y1 > hole.y1) run(b, a, c, p, hole.y1, y1, t, o, 0, m);
          return;
        }
        // At a door jamb or a capsule junction the run simply stops, and every layer -
        // pane, cill, drip - used to stop on the same plane: three end faces on one
        // plane at every jamb. Here the pane reaches 10 mm past the jamb line and the
        // cill and drip stop 10 mm short of it, so each end face has its own plane.
        const ex: [number, number] = [absent(i - 1, y0, y1) ? 1 : 0, absent(i + 1, y0, y1) ? 1 : 0];
        run(b, a, c, p, y0, y1, t, o, 0, m, glazed ? [ex[0] * 0.01, ex[1] * 0.01] : [0, 0]);
        if (!glazed) return;
        const back: [number, number] = [ex[0] * -0.01, ex[1] * -0.01];
        run(bTrim, a, c, p, y1 - 0.06, y1 + 0.1, WALL_T + 0.14, 0.04, 0, m, back); // head drip
        run(bWall, a, c, p, y0 - 0.12, y0 + 0.06, WALL_T + 0.24, 0.05, 0, m, back); // deep cill
        const ym = y0 + (y1 - y0) * 0.61;
        run(bTrim, a, c, p, ym - 0.05, ym + 0.05, WALL_T * 0.8, -GLAZ_IN * 0.5, 0, m); // transom
        // mullion: a short strip inside ONE pane, so it keeps its own width regardless of mitre
        if (i % 2 === 0) run(bTrim, a, c, p, y0, y1, WALL_T * 0.7, -GLAZ_IN * 0.45, -CHORD + 0.12);
      };
      put(0, G_SILL, false); put(G_SILL, G_HEAD, true); put(G_HEAD, twoStorey ? FLOOR_H : top, false);
      if (twoStorey) {
        put(FLOOR_H, U_SILL, false); put(U_SILL, U_HEAD, true); put(U_HEAD, top, false);
        run(bTrim, a, c, p, FLOOR_H - 0.16, FLOOR_H + 0.12, WALL_T + 0.14, 0, 0, m);
      }
      run(bTrim, a, c, p, top - 0.3, top + (twoStorey ? 0.1 : 0.34), WALL_T + 0.14, 0, 0, m);
    }
    // Colliders: the EXACT axis-aligned bound of each wall chord. These used to be
    // 1.344 m squares standing on a 0.26 m wall - a phantom metre of solid all round
    // every capsule, which ate about 0.9 m off the inside of the curved ends. It was
    // invisible on the ground floor (nobody goes right up to the curve) and it sealed
    // the upper bedroom the moment there was an upper floor to seal: paths.mjs --y 3.3
    // reported the room standable and unreachable through a 0.18 m pinch.
    const loopC = planLoop(p, COARSE);
    for (let i = 0; i < loopC.length; i++) {
      const a = loopC[i], c = loopC[(i + 1) % loopC.length];
      const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
      if (others.some((o) => planSdf(o, mx, mz) < -0.18)) continue;
      const dx = c.x - a.x, dz = c.y - a.y, L = Math.hypot(dx, dz) || 1;
      const ux = Math.abs(dx / L), uz = Math.abs(dz / L);
      // Clip the aperture out ALONG the chord rather than dropping whole chords by
      // their midpoint: a midpoint test on 1.2 m collider chords against 0.55 m mesh
      // chords puts the two gaps in different places. That is exactly what it did -
      // traverse's door scan found the white yard door passable at x = 1.8 only, and
      // the spawn-to-spawn route wedged on the doorway it could see straight through.
      let hole: Hole | null = null, ht: [number, number] | null = null;
      for (const d of holes) {
        const fx = a.x - d.x, fz = a.y - d.z;
        const b2 = fx * (dx / L) + fz * (dz / L);
        const cc = fx * fx + fz * fz - d.r * d.r;
        const disc = b2 * b2 - cc;
        if (disc <= 0) continue;
        const sq = Math.sqrt(disc);
        const t0 = Math.max(0, -b2 - sq), t1 = Math.min(L, -b2 + sq);
        if (t1 > t0) { hole = d; ht = [t0, t1]; break; }
      }
      const chunk = (t0: number, t1: number, y0: number, y1: number): void => {
        if (t1 - t0 < 0.02 || y1 - y0 < 0.05) return;
        const len = t1 - t0, tm = (t0 + t1) * 0.5;
        colliders.push(aabbSlab(a.x + (dx / L) * tm, y0, a.y + (dz / L) * tm,
          Math.max(0.2, len * ux + WALL_T * uz), y1 - y0,
          Math.max(0.2, len * uz + WALL_T * ux)));
      };
      if (!hole || !ht) { chunk(0, L, 0, top); continue; }
      for (const [s0, s1] of subtract(0, L, [ht])) chunk(s0, s1, 0, top);
      chunk(ht[0], ht[1], 0, hole.y0);
      chunk(ht[0], ht[1], hole.y1, top);
    }
  };

  shell(REAR, H_REAR, true, [
    { x: YARD_DOOR_X, z: Z_BACK, r: DOOR_HALF, y0: 0, y1: G_HEAD },
    { x: DECK_CX, z: Z_BACK, r: DOOR_HALF, y0: DECK_Y, y1: U_HEAD },
    // garage -> KITCHEN, through the curved +x end (INTERIORS-TOPOLOGY s3.3,
    // g-VfcKHcDJXpM-122: green display shelving on the left, through an open internal
    // doorway to the blue base units, white worktop, sink and fridge).
    { x: GEW * rearX(GAR_DOOR_Z), z: GAR_DOOR_Z, r: 0.8, y0: 0, y1: G_HEAD },
  ], [FRONT]);
  shell(FRONT, H_FRONT, false,
    [{ x: FRONT_DOOR_X, z: Z_FRONT, r: DOOR_HALF, y0: 0, y1: G_HEAD }], [REAR]);

  // No floor prisms. The two 0.1 m ground prisms were entirely inside ground.ts's 0.154 m
  // interior floor pad (never visible), and the 0.22 m concrete prism at FLOOR_H - the
  // single-storey house's old ceiling - was left under the upper floor when the banded
  // slab arrived: two slabs, same top plane (3.15) and same underside (2.93), concrete
  // against interiorWall, over the whole upper floor. That was the upstairs z-fight
  // (scripts/_ownerfix-geom.mjs coplanar: 16 band/prism pairs on each plane). It also
  // capped the stairwell and the two-storey void with a floor nobody could stand on.
  // The banded slab below is the floor; the roof prism is the ceiling.
  g.add(prism(REAR, 0.16, H_REAR, ctx.mat.capsuleWhite));
  g.add(prism(FRONT, 0.14, H_FRONT, ctx.mat.capsuleWhite));

  // --- roof lantern: reflective glass divided into panes by a deep white kerb ---
  const glazHz = REAR.hz - REAR_D * 0.155;
  const glaze: Plan = { cx: -HOUSE_HALF_LEN * 0.18, cz: REAR.cz, hx: HOUSE_HALF_LEN * 0.66, hz: glazHz, r: glazHz };
  const PANE_Y = H_REAR + 0.16;
  g.add(prism(glaze, 0.1, PANE_Y, ctx.mat.glass, 10));
  const glazLoop = planLoop(glaze, CHORD * 1.6);
  for (let i = 0; i < glazLoop.length; i++) {
    run(bWall, glazLoop[i], glazLoop[(i + 1) % glazLoop.length], glaze, H_REAR + 0.02, PANE_Y + 0.26, 0.22, 0, 0, mitreOf(glazLoop, i));
  }
  for (let k = -2; k <= 2; k++) { // longitudinal bars, clipped to the stadium
    const dz = k * glazHz * 0.36;
    const hw = (glaze.hx - glazHz) + Math.sqrt(Math.max(0.05, glazHz * glazHz - dz * dz));
    bWall.add(hw * 2, 0.1, 0.12, glaze.cx, PANE_Y + 0.12, glaze.cz + dz);
  }
  for (let k = -1; k <= 1; k++) { // transverse bars, 6 mm under the longitudinal ones at the crossings
    const ax = Math.abs(k * glaze.hx * 0.3) - (glaze.hx - glazHz);
    const hh = ax <= 0 ? glazHz : Math.sqrt(Math.max(0.05, glazHz * glazHz - ax * ax));
    bWall.add(0.12, 0.1, hh * 2, glaze.cx + k * glaze.hx * 0.3, PANE_Y + 0.114, glaze.cz);
  }

  // --- rooftop plant drum: matte louvred vent + cowl + duct, not a hot tub -----
  const drumX = HOUSE_HALF_LEN * 0.73, drumR = REAR_D * 0.22, drumH = UPPER_H * 0.69;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(drumR, drumR, drumH, 22),
    ctx.mat.painted(PAL.rooftopDrum, 0.85, 0.02));
  drum.position.set(drumX, H_REAR + 0.16 + drumH * 0.5, REAR.cz);
  drum.castShadow = drum.receiveShadow = true;
  g.add(drum);
  for (let k = 0; k < 14; k++) { // louvre fins break the tub curve
    const a = (k / 14) * Math.PI * 2;
    bDark.add(0.1, drumH * 0.62, 0.24, drumX + Math.cos(a) * (drumR + 0.05),
      H_REAR + 0.16 + drumH * 0.47, REAR.cz + Math.sin(a) * (drumR + 0.05), Math.PI * 0.5 - a);
  }
  bWall.add(drumR * 2.3, 0.16, drumR * 2.3, drumX, H_REAR + 0.16 + drumH + 0.02, REAR.cz);
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(drumR * 0.42, drumR * 0.55, 0.5, 14),
    ctx.mat.painted(PAL.capsuleTrim, 0.6, 0.2));
  cowl.position.set(drumX, H_REAR + 0.16 + drumH + 0.25, REAR.cz); cowl.castShadow = true;
  g.add(cowl);
  // duct from the drum toward the lantern kerb: starts OUTSIDE the glazed pane (it used
  // to run 0.77 m across the glass, sitting on the same 6.36 plane as the pane's base)
  bDark.add(1.3, 0.28, 0.42, drumX - drumR + 0.95, H_REAR + 0.3, REAR.cz);
  colliders.push(aabbSlab(drumX, H_REAR, REAR.cz, drumR * 2, drumH, drumR * 2));

  // --- garage wing: flat shallow-crowned roof, 3 recessed bays ------------------
  const garLoop = planLoop(GAR_PLAN, CHORD);
  const bayHalf = BAY_W * 0.5, bayTop = BAY_H;
  const bayCx = (d: number): number =>
    GAR_OUT_X - GEW * (BAY_JAMB + BAY_W / 2 + d * (BAY_W + BAY_JAMB));
  for (let i = 0; i < garLoop.length; i++) {
    const a = garLoop[i], c = garLoop[(i + 1) % garLoop.length];
    const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
    if (planSdf(REAR, mx, mz) < -0.18) continue;
    // leave the kitchen doorway out of the garage's own house-side wall
    if (Math.hypot(mx - GEW * rearX(GAR_DOOR_Z), mz - GAR_DOOR_Z) < 1.15) continue;
    let bay = false;
    for (let k = 0; k < GARAGE_BAYS; k++) {
      if (S * (mz - GAR_CZ) < 0 && Math.abs(mx - bayCx(k)) < bayHalf) bay = true;
    }
    const m = mitreOf(garLoop, i);
    if (bay) run(bWall, a, c, GAR_PLAN, bayTop, GARAGE_H, WALL_T, 0, 0, m);
    else run(bWall, a, c, GAR_PLAN, 0, GARAGE_H, WALL_T, 0, 0, m);
  }
  // Garage face reads from the street per f-FKQOEO-1ceE-060 (ribbed sectionals +
  // beams + cabinets), f-aICKIbuo8zQ-190 (blank vs ribbed bays, one open bay with
  // shelving), f-aICKIbuo8zQ-055/115 (flat canopy + cloth banner + mint doors) and
  // f-FKQOEO-1ceE-205 (numbered door + open glazed bay). Plausible in-world text
  // only, never Treyarch wording.
  // THE DOORS. Both bays used to get a full-height dark plane 0.44 m inside the reveal -
  // the shut one with slats on it, the "open" one with three slats under its header -
  // so from the street BOTH read shut and the open bay was an opaque door a body
  // walked through (captures/ownerfix-before-garage-street.png; the owner: "the
  // garage door is still opaque"). Now: one pale-green sectional leaf per bay, the way
  // g-VfcKHcDJXpM-171 / f-FKQOEO-1ceE-141 show the white garage - the shut bay's leaf
  // stands in the reveal with four panel joints, hinge blocks and a handle; the open
  // bay's leaf is ROLLED UP: its bottom panel hangs under the header, one panel curls
  // back at 45 degrees and the rest lies flat along two ceiling tracks into the garage
  // (g-tB35IKluv0g-085 shows exactly that overhead). The throat below is empty.
  const bayZ = Z_FRONT + S * 0.44;      // the door plane, inside the reveal
  const bayFaceZ = Z_FRONT - S * 0.06;  // pier/header plane on the street face
  const LEAF_T = 0.06;
  const JOINTS = [0.22, 0.44, 0.66, 0.88]; // panel joints, fractions of the leaf height
  for (let k = 0; k < GARAGE_BAYS; k++) {
    const bx = bayCx(k);
    const open = k === OPEN_BAY;
    const leafW = bayHalf * 2 - 0.06;
    // Header hangs 30 mm below the wall's soffit at bayTop: the two shared that plane
    // (y- @ 2.2995 under all eight header chords) and fought over it from the drive.
    bTrim.add(bayHalf * 2 + 0.3, 0.2, 0.2, bx, bayTop + 0.07, bayFaceZ);
    // jamb piers stop at the header's underside (bayTop - 0.03) rather than 30 mm into it
    for (const s of [-1, 1]) bTrim.add(0.16, bayTop - 0.03, 0.2, bx + s * (bayHalf + 0.07), (bayTop - 0.03) * 0.5, bayFaceZ);
    if (!open) {
      const leafH = bayTop - FLOOR_Y - 0.02;
      bMint.add(leafW, leafH, LEAF_T, bx, FLOOR_Y + leafH / 2, bayZ);
      for (const f of JOINTS) {
        const jy = FLOOR_Y + leafH * f;
        for (const side of [-1, 1]) {           // joints read from the street AND the pool room
          const jz = bayZ + side * S * (LEAF_T / 2 + 0.008);
          bDark.add(leafW - 0.04, 0.035, 0.016, bx, jy, jz);
          for (const hx of [-0.85, 0, 0.85]) bDark.add(0.1, 0.11, 0.02, bx + hx, jy, jz + side * S * 0.004);
        }
      }
      // handle plate between the second and third joints (at 0.95 it sat across a joint)
      bDark.add(0.34, 0.14, 0.014, bx, FLOOR_Y + leafH * 0.55, bayZ - S * (LEAF_T / 2 + 0.007));
      bSteel.add(0.2, 0.04, 0.035, bx, FLOOR_Y + leafH * 0.55, bayZ - S * (LEAF_T / 2 + 0.03));
    } else {
      // Bottom edge at bayTop - 0.42 = 1.88 m, over a 1.78 m body: no collider, and it
      // takes nothing off the opening a player or the paths flood uses.
      const hang = 0.22, curl = 0.32, flat = 2.2;
      bMint.add(leafW, hang, LEAF_T, bx, bayTop - 0.2 - hang / 2, bayZ);
      bMint.add(leafW, LEAF_T, curl, bx, bayTop - 0.2 + curl * 0.3536, bayZ + S * curl * 0.3536, 0, -S * Math.PI / 4);
      const flatZ = bayZ + S * (curl * 0.7071 + flat / 2);
      bMint.add(leafW, LEAF_T, flat, bx, bayTop + 0.026, flatZ);
      for (let j = 0; j < 4; j++) {           // panel joints on the underside you see from the throat
        bDark.add(leafW - 0.04, 0.016, 0.035, bx, bayTop + 0.026 - LEAF_T / 2 - 0.008,
          flatZ - S * flat / 2 + S * (0.4 + j * 0.5));
      }
      for (const s of [-1, 1]) bSteel.add(0.05, 0.05, flat + 0.5, bx + s * (bayHalf + 0.01), bayTop + 0.09, flatZ + S * 0.1);
    }
  }
  // The three jamb piers between and beside the bays had no colliders: 0.47 m of wall a
  // body walked straight through. The open bay itself stays open.
  for (const [x0, x1] of [
    [GAR_OUT_X - GEW * BAY_JAMB, GAR_OUT_X],
    [bayCx(0) - GEW * bayHalf, bayCx(1) + GEW * bayHalf],
    [GAR_OUT_X - GEW * GARAGE_LEN, GAR_OUT_X - GEW * (GARAGE_LEN - BAY_JAMB)],
  ]) {
    const [a, b] = span(x0, x1);
    colliders.push(aabbSlab((a + b) / 2, 0, Z_FRONT, b - a, GARAGE_H, 0.3));
  }
  // Downlights on the garage soffit (f-FKQOEO-1ceE-141: a modern downlit ceiling) -
  // emissive only, never a scene light - so the room seen through the open bay is lit,
  // not a black hole.
  for (let k = 0; k < GARAGE_BAYS; k++) {
    for (const dz of [-1.7, 0, 1.7]) bGlow.add(0.32, 0.04, 0.32, bayCx(k), GARAGE_H - 0.02, GAR_CZ + S * dz);
  }
  // Open flat translucent canopy slab on slim columns forward of the bays. The fascia
  // is 40 mm shorter than the glass so their end faces are not one plane.
  const gCanZ = Z_FRONT - S * 1.55, gCanY = GARAGE_H * 0.82;
  const gCanopy = box(GARAGE_LEN + 1.2, 0.1, 2.3, ctx.mat.glass, GAR_CX, gCanY, gCanZ);
  gCanopy.castShadow = true; g.add(gCanopy);
  bTrim.add(GARAGE_LEN + 1.16, 0.1, 0.14, GAR_CX, gCanY - 0.08, gCanZ - S * 1.15);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = GAR_CX + sx * (GARAGE_LEN * 0.5 + 0.35), pz = gCanZ + sz * 0.95;
    bSteel.add(0.14, gCanY, 0.14, px, gCanY * 0.5, pz);
    colliders.push(aabbSlab(px, 0, pz, 0.16, gCanY, 0.16));
  }
  // Cloth banner hung under the canopy lip; welcome-style wording in-world.
  g.add(box(3.4, 0.62, 0.05,
    ctx.mat.signText({ text: 'Welcome to Future Homes', color: PAL.rooftopDrum, background: PAL.capsuleWhite, aspect: 5.5 }),
    GAR_CX, gCanY - 0.48, gCanZ - S * 1.12));
  // Bay number on the pier between the open bay and its neighbour.
  g.add(box(0.4, 0.5, 0.05,
    ctx.mat.signText({ text: '13', color: PAL.capsuleWhite, background: PAL.rooftopDrum, aspect: 0.8 }),
    (bayCx(0) + bayCx(1)) / 2, 1.7, bayFaceZ - S * 0.12));
  // ==================== THE POOL ===================================================
  // INTERIORS-TOPOLOGY s3: the white house's SECOND bay - the shut one - is an indoor
  // swimming pool, and it is the most recognisable interior detail in Nuketown 2025
  // that this build did not have. g-tB35IKluv0g-091 (pool, vending machines, green
  // back-lit shelving and crates in one frame), g-VfcKHcDJXpM-171 (the painted "2" with
  // the shut sectional door filling the right half), f-mGpZaLy5_hM-030.
  //
  // DEPTH IS CAPPED BY THE CONTROLLER, NOT BY TASTE. groundUnder() in src/core/player.ts
  // starts at `let best = 0` - the world base plane - so nothing anywhere in this map can
  // be entered below y = 0. A 1.4 m sunken basin would be a hole a player could neither
  // fall into nor climb out of, and drawing one anyway would be a walk-on-water lie. So
  // the basin floor IS y = 0 and the COPING stands POOL_RIM (0.34 m) proud of the garage
  // floor: you step over the rim (STEP_UP is 0.38), you are in the water to mid-shin, you
  // step out anywhere, and mesh and collider agree. Making it properly deep needs a
  // change in player.ts, which is not this lane's file - see the report.
  const poolCx = bayCx(OPEN_BAY === 0 ? 1 : 0);      // in front of the SHUT bay
  // Pushed 0.55 m toward the yard and shortened, so a 1.5 m walkway survives between
  // the shut sectional door and the pool's shallow end. At its first size the coping
  // and the shut bay's leaf left 0.24 m between them and the pool was a sealed island
  // - paths.mjs drew it in red and turned the white east flank landmark NO.
  const poolW = BAY_W, poolD = GARAGE_DEPTH * 0.5;
  const poolCz = GAR_CZ + S * 0.55;
  const tileM = ctx.mat.painted(PAL.signTeal, 0.3, 0.05);
  g.add(slab(poolW, 0.05, poolD, tileM, poolCx, POOL_FLOOR - 0.05, poolCz));   // basin floor
  g.add(box(poolW * 0.55, 0.02, poolD * 0.35, ctx.mat.signText({
    text: '2', color: PAL.capsuleTrim, background: PAL.signTeal, aspect: 1.2,
  }), poolCx, POOL_FLOOR + 0.01, poolCz));
  for (const sx of [-1, 1]) {                                                // coping, x sides
    bWall.add(0.34, POOL_RIM, poolD + 0.68, poolCx + sx * (poolW / 2 + 0.17), POOL_RIM / 2, poolCz);
    colliders.push(aabbSlab(poolCx + sx * (poolW / 2 + 0.17), 0, poolCz, 0.34, POOL_RIM, poolD + 0.68));
  }
  // Coping on the z ends - but the STREET end is left open for 1.3 m as the shallow
  // end. Ringing the pool completely made it a sealed pocket: paths.mjs turned the
  // white east flank landmark NO, because the nearest standable cell to it is inside
  // a pool the ground flood cannot step into (the flood has no step-up). A player
  // could, but "a player could" is not what that instrument measures, and an
  // unenterable pool is a worse answer anyway.
  const POOL_ENTRY = poolW;   // the whole street end is the shallow end
  for (const sz of [-1, 1]) {
    const cz = poolCz + sz * (poolD / 2 + 0.17);
    if (sz * S > 0) {                                  // yard end: full run
      bWall.add(poolW, POOL_RIM, 0.34, poolCx, POOL_RIM / 2, cz);
      colliders.push(aabbSlab(poolCx, 0, cz, poolW, POOL_RIM, 0.34));
      continue;
    }
    for (const [c0, c1] of subtract(poolCx - poolW / 2, poolCx + poolW / 2,
      [[poolCx - POOL_ENTRY / 2, poolCx + POOL_ENTRY / 2]])) {
      if (c1 - c0 < 0.05) continue;
      bWall.add(c1 - c0, POOL_RIM, 0.34, (c0 + c1) / 2, POOL_RIM / 2, cz);
      colliders.push(aabbSlab((c0 + c1) / 2, 0, cz, c1 - c0, POOL_RIM, 0.34));
    }
    // two shallow-end treads down into the water
    for (let t = 0; t < 2; t++) {
      bWall.add(POOL_ENTRY, POOL_RIM - (t + 1) * 0.12, 0.36, poolCx,
        (POOL_RIM - (t + 1) * 0.12) / 2, cz + S * (0.2 + t * 0.36));
    }
  }
  g.add(box(poolW - 0.06, 0.02, poolD - 0.06, ctx.mat.glass, poolCx, POOL_RIM - 0.14, poolCz));
  // chequered floor round the pool (INTERIORS-TOPOLOGY s3), 26 mm over the floor pad
  for (let fx = 0; fx < 6; fx++) {
    for (let fz = 0; fz < 6; fz++) {
      const px = GAR_OUT_X - GEW * (0.45 + fx * 1.0);
      const pz = GAR_CZ - S * (GARAGE_DEPTH * 0.5 - 0.7 - fz * 1.1);
      if (Math.abs(px - poolCx) < poolW * 0.5 + 0.3
        && Math.abs(pz - poolCz) < poolD * 0.5 + 0.3) continue;
      g.add(slab(0.98, 0.02, 1.08, (fx + fz) % 2
        ? ctx.mat.painted(PAL.capsuleWhite, 0.55, 0.05)
        : ctx.mat.painted(PAL.capsuleTrim, 0.55, 0.05), px, FLOOR_Y + 0.006, pz));
    }
  }
  // Three Nuka-style vending machines along the REAR wall and the green back-lit display
  // shelving on the HOUSE-side wall, so the view in through the open bay is shelving on
  // the left with the kitchen doorway beyond it, the machines ahead and the pool coping
  // to the right - the order f-FKQOEO-1ceE-141 / g-tB35IKluv0g-085 show from inside.
  // (They used to stand IN the open bay's throat, 0.85 m off the house wall.) Both are
  // cover. The machines stop 5 cm short of the pool coping's x and the kitchen doorway
  // keeps 0.9 m clear in front of it.
  const vendZ = GAR_CZ + S * (GARAGE_DEPTH * 0.5 - 0.66);
  for (let vd = 0; vd < 3; vd++) {
    const vx = poolCx - GEW * (poolW / 2 + 0.17 + 0.37 + vd * 0.72);
    bWall.add(0.6, 1.95, 0.92, vx, FLOOR_Y + 0.975, vendZ);
    bGlaz.add(0.5, 1.15, 0.06, vx, FLOOR_Y + 1.2, vendZ - S * 0.49);
    colliders.push(aabbSlab(vx, 0, vendZ, 0.62, 1.95 + FLOOR_Y, 0.92));
  }
  const shelfX = GAR_OUT_X - GEW * (GARAGE_LEN - 0.36);
  const shelfZ = GAR_DOOR_Z - S * 1.8;
  bWall.add(0.42, 1.6, 1.8, shelfX, FLOOR_Y + 1.45, shelfZ);
  // GREEN back-lit shelving - the bGlow batch is one warm-white material, and this
  // shelving is the room's signature colour (g-tB35IKluv0g-091), so it gets its own.
  for (let sy = 0; sy < 3; sy++) {
    g.add(box(0.3, 0.07, 1.66, ctx.mat.emissive(PAL.lawn, 1.6),
      shelfX + GEW * 0.08, FLOOR_Y + 0.95 + sy * 0.45, shelfZ));
  }
  colliders.push(aabbSlab(shelfX, 0.65, shelfZ, 0.42, 1.6 + FLOOR_Y, 1.8));
  // (no crate stack in here: every place it fits between the pool coping, the vending
  //  run and the kitchen doorway blocks the drive-in lane, and the probe proved it -
  //  a crate that seals the open bay is worse dressing than none.)
  // Honest garage shell: rear + outer side solid, the HOUSE side split around the
  // kitchen doorway, street face blocked at the shut bay only.
  colliders.push(aabbSlab(GAR_CX, 0, GAR_CZ + S * GARAGE_DEPTH * 0.5 - S * 0.2, GARAGE_LEN, GARAGE_H, 0.4));
  colliders.push(aabbSlab(GAR_OUT_X - GEW * 0.15, 0, GAR_CZ, 0.3, GARAGE_H, GARAGE_DEPTH));
  {
    const houseX = GAR_OUT_X - GEW * (GARAGE_LEN - 0.15);
    const [ga, gb] = span(GAR_CZ - GARAGE_DEPTH * 0.5, GAR_CZ + GARAGE_DEPTH * 0.5);
    for (const [c0, c1] of subtract(ga, gb, [[GAR_DOOR_Z - 0.75, GAR_DOOR_Z + 0.75]])) {
      if (c1 - c0 < 0.1) continue;
      colliders.push(aabbSlab(houseX, 0, (c0 + c1) / 2, 0.3, GARAGE_H, c1 - c0));
    }
  }
  for (let k = 0; k < GARAGE_BAYS; k++) {
    if (k === OPEN_BAY) continue;
    colliders.push(aabbSlab(bayCx(k), 0, bayZ, bayHalf * 2, bayTop, 0.3));
  }
  const rHalf = GARAGE_LEN * 0.5 + 0.22, rise = HOUSE_DEPTH * 0.02, rT = 0.22;
  const roofPts: [number, number][] = [[-rHalf, 0], [rHalf, 0]];
  for (let i = 0; i <= 10; i++) {
    const x = rHalf - (2 * rHalf * i) / 10;
    roofPts.push([x, rT + rise * (1 - (x / rHalf) * (x / rHalf))]);
  }
  const garRoof = extrude(roofPts, GARAGE_DEPTH + 0.5, ctx.mat.capsuleWhite);
  garRoof.position.set(GAR_CX, GARAGE_H, GAR_CZ); g.add(garRoof);
  const garTrim = planLoop({ ...GAR_PLAN, hx: rHalf, hz: GARAGE_DEPTH * 0.5 + 0.25 }, CHORD * 2);
  for (let i = 0; i < garTrim.length; i++) {
    run(bTrim, garTrim[i], garTrim[(i + 1) % garTrim.length], GAR_PLAN, GARAGE_H - 0.06, GARAGE_H + rT, 0.18, 0, 0, mitreOf(garTrim, i));
  }

  // --- porch canopy + entry deck ------------------------------------------------
  const canZ = Z_FRONT - S * (CANOPY_OUT * 0.5 - 0.2);
  g.add(box(CANOPY_LEN, 0.26, CANOPY_OUT + 0.4, ctx.mat.capsuleWhite, FRONT_DOOR_X, CANOPY_Y - 0.13, canZ));
  bTrim.add(CANOPY_LEN + 0.12, 0.16, 0.18, FRONT_DOOR_X, CANOPY_Y - 0.3, Z_FRONT - S * (CANOPY_OUT - 0.1));
  // The entry deck stops INSIDE the street wall (it used to reach 20 mm into the room,
  // where its inner face shared a plane with the rubble skirt's, 1.9 m of it above
  // the floor pad).
  const entryZ = Z_FRONT - S * (CANOPY_OUT * 0.5 - 0.1), entryW = CANOPY_LEN + 1.2;
  g.add(slab(entryW, DECK_T, CANOPY_OUT - 0.1, ctx.mat.concrete, FRONT_DOOR_X, 0, entryZ));
  colliders.push(aabbSlab(FRONT_DOOR_X, 0, entryZ, entryW, DECK_T, CANOPY_OUT - 0.1));

  // --- rear deck + exterior stair ------------------------------------------------
  bWood.add(DECK_LEN, 0.22, DECK_OUT, DECK_CX, DECK_Y - 0.11, DECK_CZ);
  colliders.push(aabb(DECK_CX, DECK_Y - 0.11, DECK_CZ, DECK_LEN, 0.22, DECK_OUT));
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    bWood.add(0.22, DECK_Y - 0.22, 0.22, DECK_CX + sx * (DECK_LEN * 0.5 - 0.18),
      (DECK_Y - 0.22) * 0.5, DECK_CZ + sz * (DECK_OUT * 0.5 - 0.18));
  }
  const railY = DECK_Y + RAIL_H;
  // the end rail stops at the yard rail's inner face; the two caps used to overlap at
  // the corner (one 70 x 70 mm square of decking on decking)
  const edges: [number, number, number, number][] = [
    [DECK_CX, DECK_CZ + S * DECK_OUT * 0.5, DECK_LEN, 0],
    [DECK_CX - DECK_END * DECK_LEN * 0.5, DECK_CZ - S * 0.07, DECK_OUT - 0.14, Math.PI * 0.5],
  ];
  for (const [ex, ez, len, rot] of edges) {
    bWood.add(len, 0.1, 0.14, ex, railY, ez, rot);
    const n = Math.max(2, Math.round(len / 0.17));
    for (let i = 1; i < n; i++) {
      const f = (i / n - 0.5) * len;
      bSteel.add(0.04, RAIL_H - 0.1, 0.04, ex + Math.cos(rot) * f, DECK_Y + (RAIL_H - 0.1) * 0.5, ez - Math.sin(rot) * f);
    }
  }
  colliders.push(aabb(DECK_CX, DECK_Y + RAIL_H * 0.5, DECK_CZ + S * DECK_OUT * 0.5, DECK_LEN, RAIL_H, 0.16));
  colliders.push(aabb(DECK_CX - DECK_END * DECK_LEN * 0.5, DECK_Y + RAIL_H * 0.5, DECK_CZ, 0.16, RAIL_H, DECK_OUT));
  const stairPts: [number, number][] = [[0, DECK_Y]];
  for (let i = 0; i < STEPS; i++) {
    stairPts.push([i * STEP_GOING, DECK_Y - i * STEP_RISE],
      [(i + 1) * STEP_GOING, DECK_Y - i * STEP_RISE], [(i + 1) * STEP_GOING, DECK_Y - (i + 1) * STEP_RISE]);
  }
  stairPts.push([0, 0]);
  const stair = extrude(stairPts, STAIR_W, ctx.mat.deckBoards);
  stair.position.set(DECK_EDGE_X, 0, DECK_CZ); stair.rotation.y = DECK_END === 1 ? 0 : Math.PI;
  g.add(stair);
  for (let i = 0; i < STEPS; i++) {
    colliders.push(aabbSlab(DECK_EDGE_X + DECK_END * (i + 0.5) * STEP_GOING, 0, DECK_CZ,
      STEP_GOING, DECK_Y - i * STEP_RISE, STAIR_W));
  }

  // ==================== internal stair + UPPER FLOOR ===============================
  // The old flight was 10 risers ending at 2.86 m inside a walled box with NOTHING above
  // it: this house had no second floor at all, so the deck door in the yard face - which
  // the shell has always cut - opened onto three metres of air. 12 risers of 0.2625 m
  // now, and a real slab to arrive on.
  const railXW = ST_X - GEW * (ST_W / 2);            // open side of the flight
  const wellX = span(railXW, ST_X + GEW * (ST_W / 2 + 0.1));
  for (let i = 0; i < RISERS; i++) {
    const top = (i + 1) * RISE;
    const zc = ST_Z0 + S * (i + 0.5) * GOING;
    bWood.add(ST_W, top, GOING, ST_X, top / 2, zc);
    colliders.push(aabbSlab(ST_X, 0, zc, ST_W, top, GOING));
    // 20 mm under the landing rail's cap: the top post shared its 4.15 plane with it.
    // The LAST post is not drawn at all: it stood wholly inside the landing rail's box
    // with its +z face on the rail's end plane. Its collider stays.
    if (i < RISERS - 1) bWood.add(0.1, RAIL_IN - 0.02, GOING, railXW, top + (RAIL_IN - 0.02) / 2, zc);
    colliders.push(aabb(railXW, top + RAIL_IN / 2, zc, 0.1, RAIL_IN, GOING));
  }
  // two magenta discs on the flank wall at the head of the flight (f-mGpZaLy5_hM-088)
  for (const dz of [-0.75, 0.75]) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 18),
      ctx.mat.painted(PAL.trailerTrim, 0.55, 0.1));
    disc.rotation.x = Math.PI * 0.5;
    disc.position.set(ST_X + GEW * (ST_W / 2 + 0.07), 2.1, ST_Z1 + S * dz);
    g.add(disc);
  }
  // Floor slab, banded in z and clipped to the capsule outline so the boxes ARE the
  // colliders and nothing overhangs the curved end. Holes: the two-storey void over the
  // living/dining volume (everything street-side of VOID_Z) and the stairwell.
  // Each band reaches the curve's NARROWER edge, so no band overhangs the wall - which
  // at the yard apex, where x changes fastest with z, cost a wedge of floor: the last
  // 0.4 m band could only reach |x| 2.37 while the room is 3.6 m wide at its start. That
  // wedge was the missing floor under the rear hall's west end, the 'no floor' cells
  // that eroded the deck-door threshold shut (paths.mjs --y 3.3). Bands are 0.4 m
  // through the room and 0.1 m over the last 0.85 m, where the arc turns to face +z.
  const BANDW = 0.4;
  const [uz0, uz1] = span(VOID_Z, REAR.cz + S * REAR.r);
  const bandEdges: number[] = [uz0];
  for (let z = uz0; z < uz1 - 1e-6;) {
    const next = Math.min(uz1, z + (uz1 - z > 0.85 + BANDW ? BANDW : 0.1));
    bandEdges.push(next); z = next;
  }
  const [wz0, wz1] = span(VOID_Z, ST_Z1);
  for (let b = 0; b + 1 < bandEdges.length; b++) {
    const za = bandEdges[b], zb = bandEdges[b + 1];
    const lim = Math.min(rearX(za), rearX(zb));
    if (lim <= 0.1) continue;
    const cuts: [number, number][] = [];
    if (overlaps(za, zb, wz0, wz1)) cuts.push(wellX);
    for (const [a, c] of subtract(-lim, lim, cuts)) {
      if (c - a < 0.06) continue;
      bWallIn.add(c - a, SLAB_T, zb - za, (a + c) / 2, FLOOR_H - SLAB_T / 2, (za + zb) / 2);
      colliders.push(aabb((a + c) / 2, FLOOR_H - SLAB_T / 2, (za + zb) / 2, c - a, SLAB_T, zb - za));
    }
  }
  /** 1.0 m balustrade run on the upper floor; one box is both mesh and collider. */
  const upRail = (x0: number, z0: number, x1: number, z1: number): void => {
    const [a0, a1] = span(x0, x1), [b0, b1] = span(z0, z1);
    const w = Math.max(0.12, a1 - a0), d = Math.max(0.12, b1 - b0);
    const cx = (a0 + a1) / 2, cz = (b0 + b1) / 2;
    bWood.add(w, RAIL_IN - 0.08, d, cx, FLOOR_H + (RAIL_IN - 0.08) / 2, cz);
    bDark.add(w + 0.06, 0.08, d + 0.06, cx, FLOOR_H + RAIL_IN - 0.04, cz);
    colliders.push(aabb(cx, FLOOR_H + RAIL_IN / 2, cz, w, RAIL_IN, d));
  };
  upRail(wellX[0], VOID_Z, wellX[0], ST_Z1);
  upRail(wellX[1], VOID_Z, wellX[1], ST_Z1);

  // ==================== the upper floor's -z FACE ==================================
  // This face did not exist. From the landing you looked over a 1.0 m void rail, over
  // the entry capsule's roof and straight out to the plaza, the umbrellas and the TEST
  // SITE sign - captures/verify/wup-edge-side.png and wup-edge-from-landing.png. The
  // rear capsule is two-storey and the entry capsule is single-storey, and shell()
  // DROPS every REAR chord whose midpoint falls inside FRONT, so from H_FRONT up to
  // the eave along that whole stretch there was no wall, no glazing and no collider.
  // The orange house has a glazed clerestory ring in exactly this position
  // (captures/verify/up-orange-landing.png).
  //
  // Closed the way INTERIORS-TOPOLOGY s4.2 describes the real rooms, and
  // g-1icNQzMgLUM-249 / -256 / -263 show them: TALL WINDOWS IN A SOLID WALL. Same band
  // heights as the rest of this house's upper storey (U_SILL / U_HEAD), same
  // materials, same set-back pane and cill/head lines. The collider convention is the
  // shell's - exact AABBs with the aperture clipped ALONG the run - but because this
  // run is straight and axis-aligned, one exact AABB per band IS the wall rather than
  // a chord approximation of it.
  //
  // THE ONE APERTURE, and why it is not a hole. Below H_FRONT the wall skips the
  // stairwell span (wellX). A solid wall there blocks the INTERNAL stair: its bottom
  // five risers are street-side of VOID_Z, and a climber's head - player.ts puts the
  // body box BODY_H 1.78 above the tread it snapped to - crosses FLOOR_H at riser 5,
  // exactly in this plane. Based at H_FRONT instead, the highest head that still
  // overlaps this wall's z band is 4.14 m, 0.17 m clear, and the climb survives. It
  // opens nothing: the entry capsule's own street wall stands 0..H_FRONT across that
  // whole line, so nothing passes or shoots out through it.
  // The wall hangs on the STREET side of the floor edge, so its inner face is flush
  // with VOID_Z and it takes nothing off a room that has nothing to give: built inboard
  // instead, its 0.26 m ate the bed's foot, and moving the bed north by that much
  // pinched the one route into the bedroom - round the partition's deep end and back
  // west down a 1.4 m corridor against the curve - below the eroded player radius.
  // paths.mjs --y 3.3 turned the bedroom NO and said so.
  const faceZ0 = VOID_Z - S * WALL_T, faceZ1 = VOID_Z;
  const faceCz = (faceZ0 + faceZ1) / 2;
  const faceHX = Math.max(rearX(faceZ0), rearX(faceZ1));
  const faceFull: [number, number][] = [[-faceHX, faceHX]];
  const faceOpen = subtract(-faceHX, faceHX, [wellX]);   // below FACE_SPLIT: stairwell out
  // The band split sits 10 mm ABOVE the entry roof's underside (H_FRONT): at exactly
  // H_FRONT every pier's bottom face lay on the ceiling plane of the room below, a
  // 10 mm strip of white fighting the tan soffit along the whole face.
  const FACE_SPLIT = H_FRONT + 0.01;
  for (const [y0, y1, glass] of [
    [FLOOR_H, U_SILL, false], [U_SILL, FACE_SPLIT, true],
    [FACE_SPLIT, U_HEAD, true], [U_HEAD, H_REAR, false],
  ] as [number, number, boolean][]) {
    if (y1 - y0 < 0.04) continue;
    for (const [xa, xb] of y1 <= FACE_SPLIT + 1e-6 ? faceOpen : faceFull) {
      if (xb - xa < 0.06) continue;
      colliders.push(aabb((xa + xb) / 2, (y0 + y1) / 2, faceCz, xb - xa, y1 - y0, WALL_T));
      const n = Math.max(1, Math.round((xb - xa) / CHORD));
      for (let i = 0; i < n; i++) {
        const a = xa + (xb - xa) * i / n, c = xa + (xb - xa) * (i + 1) / n;
        if (glass && i % PIER_EVERY !== 0) {
          bGlaz.add(c - a, y1 - y0, GLAZ_T, (a + c) / 2, (y0 + y1) / 2, faceCz + S * GLAZ_IN);
          // mullion 5 mm inside the pane's top and bottom, so its end faces are not the pane's
          if (i % 2 === 0) bTrim.add(0.12, y1 - y0 - 0.01, WALL_T * 0.7, (a + c) / 2, (y0 + y1) / 2, faceCz + S * GLAZ_IN * 0.45);
        } else {
          // Straight run: chunks ABUT on the chord points. Only the two ends of the whole
          // face reach 0.3 WALL_T further, into the curved shell chord they meet. (Every
          // chunk used to grow 0.6 WALL_T, so neighbours lay over each other for 0.156 m
          // - the same coplanar stucco pairs the capsule shells had.)
          const ea = a - xa < 1e-6 && xa <= -faceHX + 1e-6 ? WALL_T * 0.3 : 0;
          const ec = xb - c < 1e-6 && xb >= faceHX - 1e-6 ? WALL_T * 0.3 : 0;
          bWall.add(c - a + ea + ec, y1 - y0, WALL_T, (a + c) / 2 + (ec - ea) / 2, (y0 + y1) / 2, faceCz);
        }
      }
    }
  }
  // deep cill under the window band and a head drip over it - the two lines the
  // capsule shell draws round every other opening in this house
  for (const [xa, xb] of faceOpen) {
    if (xb - xa < 0.12) continue;
    // 30 mm short at each end: at the stairwell cut its end face was the pane's end face
    bWall.add(xb - xa - 0.06, 0.18, WALL_T + 0.24, (xa + xb) / 2, U_SILL - 0.03, faceCz);
  }
  bTrim.add(faceHX * 2, 0.16, WALL_T + 0.14, 0, U_HEAD + 0.02, faceCz);
  bTrim.add(faceHX * 2 - 0.04, 0.18, WALL_T + 0.14, 0, FLOOR_H + 0.06, faceCz);   // skirting line, inside the slab's edge
  // NO rail across ST_Z1: that is the head of the flight, i.e. the one cell a player
  // arriving from below has to step onto. It was railed for one build and the probe
  // climbed the whole stair and then stood there unable to get off it.
  // kitchen run + diner booth, garage end, clear of the garage doorway lane
  // Ground-floor dressing stands on FLOOR_Y, the pad the player actually walks on.
  const CT_X = HOUSE_HALF_LEN - 0.95, CT_Z = REAR.cz + S * 1.3; // kitchen run
  bWall.add(0.65, 0.92, 2.2, CT_X, FLOOR_Y + 0.46, CT_Z);
  bWood.add(0.72, 0.07, 2.3, CT_X, FLOOR_Y + 0.955, CT_Z);
  bDark.add(0.6, 0.5, 0.9, CT_X - 0.02, FLOOR_Y + 1.25, CT_Z - S * 0.7);
  colliders.push(aabbSlab(CT_X, 0, CT_Z, 0.65, FLOOR_Y + 0.92, 2.2));
  // The built-in diner booth: navy banquettes round a fixed table, the best hard cover
  // on this floor (INTERIORS-TOPOLOGY s2.3, g-1icNQzMgLUM-041).
  // (0.15 m further from the kitchen run than before: the +x banquette ran 0.10 m
  //  into the counter's end)
  const bkX = HOUSE_HALF_LEN * 0.66 - 0.15, bkZ = REAR.cz + S * 2.9;
  for (const sz of [-1, 1]) {
    bWall.add(2.0, 0.44, 0.55, bkX, FLOOR_Y + 0.22, bkZ + sz * 0.72);
    bDark.add(2.0, 0.62, 0.14, bkX, FLOOR_Y + 0.75, bkZ + sz * 0.95);
    colliders.push(aabbSlab(bkX, 0, bkZ + sz * 0.72, 2.0, FLOOR_Y + 0.86, 0.6));
  }
  bWood.add(1.7, 0.07, 0.8, bkX, FLOOR_Y + 0.74, bkZ);
  const FP_X = -HOUSE_HALF_LEN * 0.42; // chimney breast on the yard wall
  const fpZ = REAR.cz + REAR.hz - WALL_T - 0.28;
  // to the slab's underside, not through it: at FLOOR_H its top was a second face on the
  // rear hall's floor plane, 1.7 x 0.39 m of the same texture at a different scale
  bWallIn.add(1.7, FLOOR_H - SLAB_T, 0.55, FP_X, (FLOOR_H - SLAB_T) * 0.5, fpZ);
  bDark.add(0.9, 0.7, 0.2, FP_X, FLOOR_Y + 0.45, fpZ - 0.2);
  bDark.add(1.9, 0.07, 0.8, FP_X, FLOOR_Y + 0.035, fpZ - 0.15);   // hearth, on the floor not in it
  colliders.push(aabbSlab(FP_X, 0, fpZ, 1.7, FLOOR_H, 0.55));
  // partitions as [x, zCentre, len]; each pair leaves a 1.2 m full-height doorway
  // One partition closes the stair's kitchen side; one screens the back room. Both
  // leave the plan open - a capsule house reads wrong chopped into cells.
  const segs: [number, number, number][] = [
    [ST_X + GEW * (ST_W / 2 + 0.09), REAR.cz - S * 1.0, 3.0],
    [-HOUSE_HALF_LEN * 0.34, REAR.cz + S * 1.6, 2.4],
  ];
  for (const [px, pz, pl] of segs) {
    bWallIn.add(0.14, 2.5, pl, px, FLOOR_Y + 1.25, pz); // leaf
    bWallIn.add(0.18, 0.09, pl + 0.04, px, FLOOR_Y + 0.045, pz); // skirting, returned round the ends
    colliders.push(aabbSlab(px, 0, pz, 0.14, FLOOR_Y + 2.5, pl));
  }
  // Pendants, no scene lights. The REAR one hangs from the upper slab; the FRONT one is
  // street-side of VOID_Z where the only ceiling is the entry capsule's roof at H_FRONT,
  // so its rod runs up to that - it used to hang from the deleted concrete prism.
  for (const [lx, lz, ceil] of [[REAR.cx, REAR.cz, FLOOR_H - SLAB_T], [FRONT.cx, FRONT.cz, H_FRONT]]) {
    bDark.add(0.05, ceil - (FLOOR_H - 0.675), 0.05, lx, (ceil + FLOOR_H - 0.675) / 2, lz);
    bSteel.add(0.34, 0.16, 0.34, lx, FLOOR_H - 0.72, lz);
    bGlow.add(0.16, 0.1, 0.16, lx, FLOOR_H - 0.82, lz);
  }
  // ==================== upper rooms ================================================
  // INTERIORS-TOPOLOGY s4.2 / s6.2, g-1icNQzMgLUM-249/-256/-263, f-aICKIbuo8zQ-135: a
  // PURPLE diamond-wallpaper bedroom in the ROUNDED -x end (the curve is the shell's,
  // which is what s8.7 says makes it read as Nuketown 2025), a PALE-GREEN striped room
  // beside it through a cased doorway, and a landing that owns the stair head, the +x
  // end and the deck door.
  //
  // What was here: one open slab, one 2.75 m partition, and the finishes standing on
  // the floor as free 3 m slabs (a mint "striped panel" 10 cm off the plum partition, a
  // mint panel ON the bedroom's curved wall). From the stair head it read as a corridor
  // with props - captures/ownerfix-before-up-*.png - and the owner said so. Rooms need
  // walls: every partition below runs floor to roof, carries a header over its doorway
  // and a timber casing round it, is two 0.07 m leaves so each room keeps its own
  // paper, and has its collider split around the opening. Doorways are 1.2 m, the
  // width the ground floor uses, because paths.mjs erodes 0.42 m each side on a 0.2 m
  // grid and a 1.0 m opening leaves it a 0.16 m band that may hold no cell centre.
  //
  // Plan (WHITE, S = +1, GEW = +1; the floor exists from VOID_Z to the yard wall):
  //   bedroom      x  curve .. BX          z  face .. HALL_Z     doors: to the green room (corner
  //                                                              opening on the face wall), to the hall
  //   green room   x  BX .. WELL_X        z  face .. HALL_Z     door to the hall; the stair rail and a
  //                                                              stub wall close its +x side
  //   rear hall    z  HALL_Z .. yard wall x  curve .. landing   1.8 m wide; the DECK DOOR opens into it
  //   landing      x  WELL_X .. +x curve, plus the hall
  //
  // SIZED FOR THE GATE, not for taste. paths.mjs --y 3.3 floods a 0.2 m grid and erodes
  // by ceil(0.42 / 0.2) = 3 cells - 0.6 m, not 0.42 - and it treats a floor edge as a
  // wall. A cell is blocked only when its CENTRE lies inside a collider, so a 0.14 m
  // partition between two grid rows is invisible to it. Hence: every partition here is
  // centred on a grid line (x or z a multiple of 0.2) so the flood sees it, every
  // doorway is 1.6 m so two cell centres survive the erosion, and the hall is 1.8 m so
  // three rows do. The 1.2 m doors of the first pass left the bedroom, the green room
  // and the deck door all NO from the stair head; the game controller (radius 0.42)
  // walked them fine, but the instrument is the contract.
  const UY = FLOOR_H;
  const U_TOP = UY + UPPER_H;                        // roof prism underside
  const P_T = 0.14, LEAF = P_T / 2;
  const DOOR_W = 1.6, DOOR_H = 2.1;
  const BX = -HOUSE_HALF_LEN * 0.375;                // -2.4: bedroom | green-room partition (x)
  const HALL_Z = Z_BACK - S * 2.0;                   // 24.6: rooms | rear hall partition (z)
  const WELL_X = wellX[0];                           // the stairwell's room-side rail line
  const ROOM_Z0 = VOID_Z + S * 0.02;                 // the rooms' -z edge, on the face wall
  /** interior half-width at this z, just inside the shell's inner face */
  const innerX = (z: number): number => rearX(z) - WALL_T / 2 - 0.03;

  /**
   * Full-height partition with cased doorways. axis 'x': stands at x = at, runs a0..a1
   * in z, bNeg faces -x / bPos faces +x. axis 'z': at z = at, runs a0..a1 in x, bNeg
   * faces -z. Door spans are [lo, hi] along the run; each keeps a header from DOOR_H up.
   * The casing head hangs 30 mm below that header so the two never share a plane.
   */
  const upWall = (axis: 'x' | 'z', at: number, a0: number, a1: number,
    bNeg: Batch, bPos: Batch, doors: [number, number][]): void => {
    const [lo, hi] = span(a0, a1);
    const leaf = (b: Batch, c: number, len: number, y0: number, y1: number, off: number): void => {
      if (len < 0.02 || y1 - y0 < 0.02) return;
      if (axis === 'x') b.add(LEAF, y1 - y0, len, at + off, (y0 + y1) / 2, c);
      else b.add(len, y1 - y0, LEAF, c, (y0 + y1) / 2, at + off);
    };
    const solid = (c: number, len: number, y0: number, y1: number): void => {
      if (len < 0.02 || y1 - y0 < 0.02) return;
      leaf(bNeg, c, len, y0, y1, -LEAF / 2);
      leaf(bPos, c, len, y0, y1, LEAF / 2);
      if (axis === 'x') colliders.push(aabb(at, (y0 + y1) / 2, c, P_T, y1 - y0, len));
      else colliders.push(aabb(c, (y0 + y1) / 2, at, len, y1 - y0, P_T));
    };
    for (const [s0, s1] of subtract(lo, hi, doors)) solid((s0 + s1) / 2, s1 - s0, UY, U_TOP);
    for (const [d0, d1] of doors) {
      solid((d0 + d1) / 2, d1 - d0, UY + DOOR_H, U_TOP);
      for (const e of [d0, d1]) {
        if (e <= lo + 1e-6 || e >= hi - 1e-6) continue;   // the jamb IS another wall: no casing
        if (axis === 'x') bWood.add(P_T + 0.04, DOOR_H - 0.03, 0.08, at, UY + (DOOR_H - 0.03) / 2, e);
        else bWood.add(0.08, DOOR_H - 0.03, P_T + 0.04, e, UY + (DOOR_H - 0.03) / 2, at);
      }
      if (axis === 'x') bWood.add(P_T + 0.04, 0.08, d1 - d0 + 0.08, at, UY + DOOR_H + 0.01, (d0 + d1) / 2);
      else bWood.add(d1 - d0 + 0.08, 0.08, P_T + 0.04, (d0 + d1) / 2, UY + DOOR_H + 0.01, at);
    }
  };
  /** Finish slab laid on the floor bands, z-banded and clipped inside the curve. */
  const finish = (b: Batch, x0: number, x1: number, z0: number, z1: number, t: number): void => {
    const [za0, za1] = span(z0, z1);
    const n = Math.max(1, Math.round((za1 - za0) / BANDW));
    for (let i = 0; i < n; i++) {
      const za = za0 + (za1 - za0) * i / n, zb = za0 + (za1 - za0) * (i + 1) / n;
      const lim = Math.min(innerX(za), innerX(zb));
      const a = Math.max(Math.min(x0, x1), -lim), c = Math.min(Math.max(x0, x1), lim);
      if (c - a < 0.05) continue;
      b.add(c - a, t, zb - za, (a + c) / 2, UY + t / 2, (za + zb) / 2);
    }
  };
  /** Pendant from the roof: rod, shade, bulb. Emissive only, never a scene light. */
  const pendant = (x: number, z: number, drop: number): void => {
    bDark.add(0.04, drop, 0.04, x, U_TOP - drop / 2, z);
    bSteel.add(0.42, 0.18, 0.42, x, U_TOP - drop - 0.05, z);
    bGlow.add(0.18, 0.1, 0.18, x, U_TOP - drop - 0.16, z);
  };

  // ---- the walls
  // bedroom <-> green room: a cased opening in the corner against the face wall (the
  // bed's head and its unit take the rest of the partition, as in g-1icNQzMgLUM-263).
  const bedDoorZ = span(ROOM_Z0, ROOM_Z0 + S * DOOR_W);
  const hallDoorBed: [number, number] = [-4.45, -4.45 + DOOR_W];     // opposite the deck door (-4.3..-2.5)
  const hallDoorGreen: [number, number] = [-1.45, -1.45 + DOOR_W];
  upWall('x', BX, ROOM_Z0, HALL_Z - S * LEAF, bPlum, bMint, [bedDoorZ]);
  upWall('z', HALL_Z, -innerX(HALL_Z) + 0.05, BX, bPlum, bWallIn, [hallDoorBed]);
  upWall('z', HALL_Z, BX, WELL_X + LEAF, bMint, bWallIn, [hallDoorGreen]);
  // stub from the stair rail's end to the hall wall: it closes the green room's +x side
  // (the gap past the rail was 0.72 m - a slot to shoot through and too narrow to walk).
  // Mint on BOTH faces: f-mGpZaLy5_hM-088 puts "a pale-green wall further along" at the
  // head of this flight, and this is the wall the climber arrives beside.
  upWall('x', WELL_X, ST_Z1, HALL_Z - S * LEAF, bMint, bMint, []);
  // paper below the window band and above it on the two shell walls each room owns:
  // the -z face (straight) and, for the bedroom, the curved end. The pane, its deep
  // cill and its head drip stay exposed between them; 5 mm off the wall's inner face.
  const paperBands: [number, number][] = [[UY + 0.16, U_SILL - 0.14], [U_HEAD + 0.12, U_TOP - 0.02]];
  for (const [y0, y1] of paperBands) {
    bPlum.add(BX - LEAF + innerX(VOID_Z + S * 0.2), y1 - y0, 0.03, (BX - LEAF - innerX(VOID_Z + S * 0.2)) / 2, (y0 + y1) / 2, VOID_Z + S * 0.02);
    bMint.add(WELL_X - 0.06 - (BX + LEAF), y1 - y0, 0.03, (WELL_X - 0.06 + BX + LEAF) / 2, (y0 + y1) / 2, VOID_Z + S * 0.02);
  }
  {
    // The same loop and index the shell used, so i % PIER_EVERY names the same piers:
    // those get papered through the window band too, and the curved end reads as one
    // plum wall with windows in it (g-1icNQzMgLUM-249) instead of plum bands with
    // white posts between the panes.
    const loop = planLoop(REAR, CHORD);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], c = loop[(i + 1) % loop.length];
      const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
      if (mx > BX - 0.4 || S * (mz - VOID_Z) < 0.05 || S * (HALL_Z - mz) < 0.1) continue;
      const m = mitreOf(loop, i);
      for (const [y0, y1] of paperBands) run(bPlum, a, c, REAR, y0, y1, 0.03, -(WALL_T / 2 + 0.035), 0, m);
      if (i % PIER_EVERY === 0) run(bPlum, a, c, REAR, U_SILL - 0.14, U_HEAD + 0.12, 0.03, -(WALL_T / 2 + 0.035), 0, m);
    }
  }
  // gold diamonds on the plum: a square turned 45 degrees about the wall's normal, the
  // repeat of the paper in g-1icNQzMgLUM-263. Skipped where the headboard unit and the
  // doorways stand.
  const bedZc = HALL_Z - S * (LEAF + 0.01 + 0.45);   // bed 0.9 wide, 10 mm off the hall wall
  const unitZ: [number, number] = span(bedZc - S * 0.4, bedZc + S * 0.4);
  const SPK_Z = [bedZc - S * 0.24, bedZc + S * 0.24];  // two round speakers over the unit
  for (let y = UY + 0.45; y < U_TOP - 0.25; y += 0.5) {
    for (let z = VOID_Z + S * 0.3; S * (HALL_Z - z) > 0.3; z += S * 0.5) {
      if (y < UY + 2.05 && z > unitZ[0] && z < unitZ[1]) continue;
      if (y < UY + DOOR_H + 0.1 && z > bedDoorZ[0] - 0.1 && z < bedDoorZ[1] + 0.1) continue;
      if (Math.abs(y - (UY + 2.35)) < 0.36 && SPK_Z.some((sz) => Math.abs(z - sz) < 0.36)) continue;
      bGold.add(0.012, 0.2, 0.2, BX - LEAF - 0.006, y, z, 0, Math.PI / 4);
    }
    for (let x = -innerX(HALL_Z) + 0.35; x < BX - 0.3; x += 0.5) {
      if (y < UY + DOOR_H + 0.1 && x > hallDoorBed[0] - 0.1 && x < hallDoorBed[1] + 0.1) continue;
      bGold.add(0.2, 0.2, 0.012, x, y, HALL_Z - S * (LEAF + 0.006), 0, 0, Math.PI / 4);
    }
  }
  // WHITE stripes on the mint (g-1icNQzMgLUM-256: pale green and white, not brown):
  // the green room's three partition faces. bWall is the white stucco.
  for (let z = bedDoorZ[1] + 0.2; S * (HALL_Z - z) > 0.25; z += S * 0.32) {
    bWall.add(0.008, 2.5, 0.06, BX + LEAF + 0.004, UY + 0.16 + 1.25, z);
  }
  for (let x = BX + 0.3; x < WELL_X - 0.2; x += 0.32) {
    if (x > hallDoorGreen[0] - 0.08 && x < hallDoorGreen[1] + 0.08) continue;
    bWall.add(0.06, 2.5, 0.008, x, UY + 0.16 + 1.25, HALL_Z - S * (LEAF + 0.004));
  }
  for (let z = ST_Z1 + S * 0.2; S * (HALL_Z - LEAF - z) > 0.2; z += S * 0.32) {
    bWall.add(0.008, 2.5, 0.06, WELL_X - LEAF - 0.004, UY + 0.16 + 1.25, z);
  }

  // ---- the bedroom: purple carpet, single bed on a yellow rug, built-in cream
  // headboard unit with shelves and a reading light, two round wall speakers, a side
  // table with a lamp (g-1icNQzMgLUM-256). The bed's head is on the shared wall at its
  // hall end, its foot toward the curve, the opening to the green room beside it.
  finish(bPlum, -HOUSE_HALF_LEN, BX - LEAF, VOID_Z, HALL_Z - S * LEAF, 0.02);
  const CPT = 0.02;                                   // carpet; everything in here stands on it
  const unitX = BX - LEAF - 0.16;
  bWall.add(0.32, 2.0, 0.8, unitX, UY + CPT + 1.0, bedZc);
  colliders.push(aabbSlab(unitX, UY, bedZc, 0.32, 2.0, 0.8));
  for (const sy of [1.42, 1.72]) bWood.add(0.24, 0.04, 0.7, unitX - 0.02, UY + sy, bedZc);
  bDark.add(0.26, 0.3, 0.72, unitX - 0.02, UY + 1.27, bedZc);     // the dark recess behind the shelves
  bGlow.add(0.12, 0.06, 0.3, unitX - 0.14, UY + 1.18, bedZc);
  const bedCx = unitX - 0.16 - 0.95;
  // rug, on the carpet; it stops 20 mm short of the headboard unit and of the hall wall
  bGold.add(2.36, 0.02, 1.6, bedCx - 0.23, UY + CPT + 0.01, bedZc - S * 0.36);
  const bedY = UY + CPT + 0.02;                        // bed on the rug
  bWall.add(1.9, 0.3, 0.9, bedCx, bedY + 0.15, bedZc);
  bPlum.add(1.8, 0.16, 0.82, bedCx, bedY + 0.38, bedZc);
  bWall.add(0.5, 0.1, 0.55, bedCx + 0.62, bedY + 0.51, bedZc);     // pillow
  colliders.push(aabbSlab(bedCx, UY, bedZc, 1.9, 0.55, 0.9));
  const tblX = -innerX(VOID_Z + S * 0.45) + 0.55, tblZ = VOID_Z + S * 0.45;   // in the curve, by the window
  bDark.add(0.34, 0.5, 0.34, tblX, UY + CPT + 0.25, tblZ);
  colliders.push(aabbSlab(tblX, UY, tblZ, 0.34, 0.52, 0.34));
  bSteel.add(0.04, 0.3, 0.04, tblX, UY + CPT + 0.65, tblZ);
  bGlow.add(0.22, 0.2, 0.22, tblX, UY + CPT + 0.9, tblZ);
  {
    const spk = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 18);
    for (const sz of SPK_Z) {
      const m = new THREE.Mesh(spk, ctx.mat.painted(PAL.rooftopDrum, 0.6, 0.1));
      m.rotation.z = Math.PI * 0.5;
      m.position.set(BX - LEAF - 0.03, UY + 2.35, sz);
      m.castShadow = true;
      g.add(m);
    }
  }
  pendant((BX - innerX(bedZc)) / 2 - 0.3, VOID_Z + S * 1.3, 0.9);

  // ---- the pale-green room: circular-pattern rug on the grey-green floor, a low
  // timber unit under the window, a yellow artwork and the starburst clock
  // (g-1icNQzMgLUM-256, -263).
  const grX = (BX + WELL_X) / 2, grZ = VOID_Z + S * 1.55;
  {
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.02, 28),
      ctx.mat.painted(PAL.interiorTeal, 0.9, 0));
    rug.position.set(grX, UY + 0.01, grZ); rug.receiveShadow = true;
    g.add(rug);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.014, 24),
      ctx.mat.painted(PAL.interiorMint, 0.9, 0));
    ring.position.set(grX, UY + 0.027, grZ); ring.receiveShadow = true;
    g.add(ring);
  }
  bWood.add(1.2, 0.5, 0.45, BX + 1.3, UY + 0.25, VOID_Z + S * 0.31);
  colliders.push(aabbSlab(BX + 1.3, UY, VOID_Z + S * 0.31, 1.2, 0.5, 0.45));
  bGold.add(0.7, 0.5, 0.03, hallDoorGreen[1] + 0.5, UY + 1.65, HALL_Z - S * (LEAF + 0.025));   // beside the hall door
  const star = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 14),
    ctx.mat.painted(PAL.interiorGold, 0.5, 0.2));
  star.rotation.z = Math.PI * 0.5;
  star.position.set(BX + LEAF + 0.035, UY + 1.95, HALL_Z - S * 0.55);   // on the solid end of the shared wall
  g.add(star);
  pendant(grX, grZ, 0.9);

  // ---- the landing: the stair head, the rear hall to the deck door, and the +x end
  // with a WAIST-HIGH built-in unit under the face window - crouch cover the stair
  // head looks at, that leaves the street-facing window (the map's best sightline,
  // INTERIORS-TOPOLOGY s4.2) usable. It was 2.2 m tall and stood in front of the
  // glass, and its west cheek ran 0.1 m into the stairwell's +x rail.
  // An OPEN carcass - back, two cheeks, top - not a solid block with a recess drawn
  // inside it; the dark lining is what shows between the boards. Joinery, not
  // overlapping boxes: the back board and the top sit BETWEEN the two cheeks, the
  // lining lies on the back board's face, and the shelves start at the lining's face,
  // so no two boards share an end plane or a face.
  const shX = wellX[1] + 0.06 + 1.02, shZ = VOID_Z + S * 0.27;   // 20 mm clear of the well rail
  const shBack = shZ - S * 0.16;                                  // back board, 0.04 thick
  const SH_H = 0.85;
  bWood.add(1.9, SH_H, 0.04, shX, UY + SH_H / 2, shBack);
  bDark.add(1.9, SH_H, 0.02, shX, UY + SH_H / 2, shBack + S * 0.03);
  for (const sx of [-1, 1]) bWood.add(0.05, SH_H, 0.36, shX + sx * 0.975, UY + SH_H / 2, shZ);
  bWood.add(2.0, 0.05, 0.36, shX, UY + SH_H + 0.025, shZ);
  for (const sy of [0.28, 0.56]) bWood.add(1.9, 0.04, 0.30, shX, UY + sy, shZ + S * 0.03);
  colliders.push(aabbSlab(shX, UY, shZ, 2.0, SH_H + 0.05, 0.36));
  for (const [dx, sy, w, b] of [[-0.6, 0.02, 0.5, bGold], [0.2, 0.02, 0.7, bPlum], [-0.3, 0.30, 0.9, bMint],
    [0.55, 0.30, 0.4, bGold], [-0.5, SH_H + 0.05, 0.6, bPlum], [0.45, SH_H + 0.05, 0.3, bGold]] as [number, number, number, Batch][]) {
    b.add(w, 0.22, 0.2, shX + dx, UY + sy + 0.11, shZ + S * 0.02);
  }
  pendant(WELL_X + 1.6, HALL_Z - S * 0.6, 0.9);
  pendant(-1.2, HALL_Z + S * 0.7, 0.7);
  // ---- ground-floor back room, screened by the seg partition and the chimney breast
  // (at + 3.2 it overlapped the chimney hearth by 0.31 m; the two now clear by 90 mm)
  bWood.add(1.7, 0.44, 0.7, BX - 2.0, FLOOR_Y + 0.22, REAR.cz + S * 2.5);
  colliders.push(aabbSlab(BX - 2.0, 0, REAR.cz + S * 2.5, 1.7, FLOOR_Y + 0.44, 0.7));

  // --- exterior close-up detail ----------------------------------------------------
  const gut = (p: Plan, top: number): void => {
    const loop = planLoop(p, 2.4);
    for (let i = 0; i < loop.length; i++) {
      run(bSteel, loop[i], loop[(i + 1) % loop.length], p, top - 0.16, top - 0.04, 0.12, 0.12, 0, mitreOf(loop, i));
    }
  };
  gut(REAR, H_REAR); gut(FRONT, H_FRONT);
  // Rubble skirt: thin stone base course where capsule walls meet the ground.
  // Geometry + painted(PAL.rubbleStone) stand-in per brief; wants a proper
  // rubble-veneer material (random polygons + PAL.rubbleMortar joints) later.
  // Seen as ashlar/rubble bases and piers in f-FKQOEO-1ceE-055/085/115/205 and
  // f-aICKIbuo8zQ-045/075/100/115.
  const skirt = (p: Plan, isGarage: boolean): void => {
    const loop = planLoop(p, 2.4);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], c = loop[(i + 1) % loop.length];
      if (isGarage) { // leave the three drive-in mouths without a step
        const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
        let mouth = false;
        for (let k = 0; k < GARAGE_BAYS; k++) {
          if (S * (mz - GAR_CZ) < 0 && Math.abs(mx - bayCx(k)) < bayHalf + 0.3) mouth = true;
        }
        if (mouth) continue;
      }
      // 0.32 thick at +0.06: outer face 0.22 proud as before, inner face 0.10 inside the
      // wall line - it used to run 20 mm into the room and stand on the entry deck's plane
      run(bRubble, a, c, p, 0, 0.45, WALL_T + 0.06, 0.06, 0, mitreOf(loop, i));
    }
  };
  skirt(REAR, false); skirt(FRONT, false); skirt(GAR_PLAN, true);
  const stFace = Z_FRONT - S * 0.2, ydFace = Z_BACK + S * 0.2; // proud of the faces
  // Downpipes: 0.20 m off the face (at 0.18 the yard pipe's outer face was 0.3 mm off the
  // head drip's) and stopping 50 mm under the parapet band instead of flush with it.
  bSteel.add(0.12, H_FRONT - 0.05, 0.12, FRONT_DOOR_X + 2.2, (H_FRONT - 0.05) * 0.5, Z_FRONT - S * 0.2);
  // (yard pipe 0.15 m further along: at -2.4 its -x face was 0.2 mm off a cill chunk's end)
  bSteel.add(0.12, H_REAR - 0.05, 0.12, YARD_DOOR_X - 2.55, (H_REAR - 0.05) * 0.5, Z_BACK + S * 0.2);
  bSteel.add(0.12, GARAGE_H - 0.05, 0.12, GAR_CX - GARAGE_LEN * 0.5 + 0.3, (GARAGE_H - 0.05) * 0.5, Z_FRONT - S * 0.22);
  bDark.add(0.55, 0.75, 0.2, FRONT_DOOR_X + 1.3, 0.53, stFace); // meter box on the spandrel, under the cill
  colliders.push(aabbSlab(FRONT_DOOR_X + 1.3, 0, stFace, 0.55, 0.93, 0.2));
  bDark.add(0.4, 0.25, 0.12, FRONT_DOOR_X - 2.6, 2.7, stFace); // vents, above head
  bDark.add(0.4, 0.25, 0.12, YARD_DOOR_X + 2.2, 2.7, ydFace);
  g.add(box(0.5, 0.3, 0.05, // house number plaque
    ctx.mat.signText({ text: '62', color: PAL.rooftopDrum, background: PAL.capsuleWhite, aspect: 1.6 }),
    FRONT_DOOR_X - 1.1, 0.62, stFace));
  for (const [ddx, ddz] of [[FRONT_DOOR_X, stFace], [YARD_DOOR_X, ydFace]]) { // pull handles
    bSteel.add(0.06, 0.5, 0.08, ddx - 0.95, 1.15, ddz);
    bSteel.add(0.06, 0.5, 0.08, ddx + 0.95, 1.15, ddz);
  }
  // (no yard step: a 0.12 m slab under a 0.151 m lawn pad was never visible)
  g.add(box(1.4, 0.06, 0.25, ctx.mat.concrete, YARD_DOOR_X, 0.15, Z_BACK + S * 0.05)); // thresholds
  g.add(box(1.4, 0.06, 0.25, ctx.mat.concrete, FRONT_DOOR_X, 0.27, Z_FRONT - S * 0.05));
  for (const [dx, dz] of [[FRONT_DOOR_X + 1.0, stFace], [YARD_DOOR_X - 1.0, ydFace]]) { // bulkheads
    bDark.add(0.22, 0.1, 0.14, dx, 2.32, dz);
    bGlow.add(0.16, 0.12, 0.1, dx, 2.22, dz);
  }

  const batched: [Batch, THREE.Material, string][] = [
    [bWall, ctx.mat.capsuleWhite, 'wh-walls-out'],
    [bWallIn, ctx.mat.interiorWall, 'wh-walls-in'],
    [bGlaz, ctx.mat.windowDark, 'wh-glazing'],
    [bTrim, ctx.mat.painted(PAL.capsuleTrim, 0.5, 0.15), 'wh-trim'],
    [bDark, ctx.mat.painted(PAL.rooftopDrum, 0.6, 0.1), 'wh-recess'],
    [bWood, ctx.mat.deckBoards, 'wh-deck'], [bSteel, ctx.mat.steel, 'wh-balusters'],
    [bGlow, ctx.mat.emissive(PAL.sunColor, 1.3), 'wh-glow'],
    [bPlum, ctx.mat.painted(PAL.interiorPlum, 0.85, 0), 'wh-plum'],
    [bGold, ctx.mat.painted(PAL.interiorGold, 0.7, 0), 'wh-gold'],
    [bMint, ctx.mat.painted(PAL.interiorMint, 0.8, 0), 'wh-mint'],
    [bRubble, ctx.mat.painted(PAL.rubbleStone, 0.95, 0), 'wh-rubble'],
  ];
  for (const [b, m, n] of batched) { const im = b.mesh(m, n); if (im) g.add(im); }
  return { group: g, colliders };
};
