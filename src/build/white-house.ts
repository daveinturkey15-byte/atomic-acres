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
  add(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): void {
    if (w <= 0 || h <= 0 || d <= 0) return;
    this.rows.push([w, h, d, x, y, z, rotY]);
  }
  mesh(material: THREE.Material, name: string): THREE.InstancedMesh | null {
    const n = this.rows.length;
    if (!n) return null;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, n);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const r = this.rows[i];
      q.setFromAxisAngle(up, r[6]); pos.set(r[3], r[4], r[5]); scl.set(r[0], r[1], r[2]);
      im.setMatrixAt(i, mtx.compose(pos, q, scl));
    }
    im.instanceMatrix.needsUpdate = true; im.castShadow = im.receiveShadow = true; im.name = name;
    return im;
  }
}

// ------------------------------------------------------------------ constants
const S = WHITE.side, Z_FRONT = WHITE.frontZ, Z_BACK = WHITE.backZ;
const WALL_T = 0.26, CHORD = 0.55, COARSE = 1.2;
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
const POOL_FLOOR = KERB_HEIGHT + 0.005;
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

  /** One wall/glass/trim chunk along a chord, pushed `out` proud of the face. */
  const run = (b: Batch, a: THREE.Vector2, c: THREE.Vector2, p: Plan,
    y0: number, y1: number, t: number, out: number, grow = 0): void => {
    const dx = c.x - a.x, dz = c.y - a.y, L = Math.hypot(dx, dz);
    if (L < 1e-3 || y1 - y0 < 0.04) return;
    const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
    let nx = mx - p.cx, nz = mz - p.cz;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    b.add(L + t * 0.6 + grow, y1 - y0, t, mx + nx * out, (y0 + y1) * 0.5, mz + nz * out, Math.atan2(-dz, dx));
  };

  /** Capsule shell: wall/glazing bands, trim, door holes; chords inside a neighbour drop out. */
  const shell = (p: Plan, top: number, twoStorey: boolean, holes: Hole[], others: Plan[]): void => {
    const loop = planLoop(p, CHORD);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], c = loop[(i + 1) % loop.length];
      const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
      if (others.some((o) => planSdf(o, mx, mz) < -0.18)) continue;
      let hole: Hole | null = null;
      for (const h of holes) if (Math.hypot(mx - h.x, mz - h.z) < h.r) hole = h;
      const put = (y0: number, y1: number, glass: boolean): void => {
        const cut = hole !== null && y1 > hole.y0 && y0 < hole.y1;
        const glazed = glass && !(i % PIER_EVERY === 0 && !cut);
        const b = glazed ? bGlaz : bWall, t = glazed ? GLAZ_T : WALL_T, o = glazed ? -GLAZ_IN : 0;
        if (cut && hole) {
          if (y0 < hole.y0) run(b, a, c, p, y0, hole.y0, t, o);
          if (y1 > hole.y1) run(b, a, c, p, hole.y1, y1, t, o);
        } else run(b, a, c, p, y0, y1, t, o);
        if (!glazed || cut) return;
        run(bTrim, a, c, p, y1 - 0.06, y1 + 0.1, WALL_T + 0.14, 0.04); // head drip
        run(bWall, a, c, p, y0 - 0.12, y0 + 0.06, WALL_T + 0.24, 0.05); // deep cill
        const ym = y0 + (y1 - y0) * 0.61;
        run(bTrim, a, c, p, ym - 0.05, ym + 0.05, WALL_T * 0.8, -GLAZ_IN * 0.5); // transom
        if (i % 2 === 0) run(bTrim, a, c, p, y0, y1, WALL_T * 0.7, -GLAZ_IN * 0.45, -CHORD + 0.12);
      };
      put(0, G_SILL, false); put(G_SILL, G_HEAD, true); put(G_HEAD, twoStorey ? FLOOR_H : top, false);
      if (twoStorey) {
        put(FLOOR_H, U_SILL, false); put(U_SILL, U_HEAD, true); put(U_HEAD, top, false);
        run(bTrim, a, c, p, FLOOR_H - 0.16, FLOOR_H + 0.12, WALL_T + 0.14, 0);
      }
      run(bTrim, a, c, p, top - 0.3, top + (twoStorey ? 0.1 : 0.34), WALL_T + 0.14, 0);
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

  g.add(prism(REAR, 0.1, 0, ctx.mat.concrete));
  g.add(prism(FRONT, 0.1, 0, ctx.mat.concrete));
  g.add(prism({ ...REAR, hx: REAR.hx - WALL_T, hz: REAR.hz - WALL_T, r: REAR.r - WALL_T },
    0.22, FLOOR_H - 0.22, ctx.mat.concrete));
  g.add(prism(REAR, 0.16, H_REAR, ctx.mat.capsuleWhite));
  g.add(prism(FRONT, 0.14, H_FRONT, ctx.mat.capsuleWhite));

  // --- roof lantern: reflective glass divided into panes by a deep white kerb ---
  const glazHz = REAR.hz - REAR_D * 0.155;
  const glaze: Plan = { cx: -HOUSE_HALF_LEN * 0.18, cz: REAR.cz, hx: HOUSE_HALF_LEN * 0.66, hz: glazHz, r: glazHz };
  const PANE_Y = H_REAR + 0.16;
  g.add(prism(glaze, 0.1, PANE_Y, ctx.mat.glass, 10));
  const glazLoop = planLoop(glaze, CHORD * 1.6);
  for (let i = 0; i < glazLoop.length; i++) {
    run(bWall, glazLoop[i], glazLoop[(i + 1) % glazLoop.length], glaze, H_REAR + 0.02, PANE_Y + 0.26, 0.22, 0);
  }
  for (let k = -2; k <= 2; k++) { // longitudinal bars, clipped to the stadium
    const dz = k * glazHz * 0.36;
    const hw = (glaze.hx - glazHz) + Math.sqrt(Math.max(0.05, glazHz * glazHz - dz * dz));
    bWall.add(hw * 2, 0.1, 0.12, glaze.cx, PANE_Y + 0.12, glaze.cz + dz);
  }
  for (let k = -1; k <= 1; k++) { // transverse bars
    const ax = Math.abs(k * glaze.hx * 0.3) - (glaze.hx - glazHz);
    const hh = ax <= 0 ? glazHz : Math.sqrt(Math.max(0.05, glazHz * glazHz - ax * ax));
    bWall.add(0.12, 0.1, hh * 2, glaze.cx + k * glaze.hx * 0.3, PANE_Y + 0.12, glaze.cz);
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
  bDark.add(1.3, 0.28, 0.42, drumX - drumR + 0.05, H_REAR + 0.3, REAR.cz);
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
    if (bay) run(bWall, a, c, GAR_PLAN, bayTop, GARAGE_H, WALL_T, 0);
    else run(bWall, a, c, GAR_PLAN, 0, GARAGE_H, WALL_T, 0);
  }
  // Garage face reads from the street per f-FKQOEO-1ceE-060 (ribbed sectionals +
  // beams + cabinets), f-aICKIbuo8zQ-190 (blank vs ribbed bays, one open bay with
  // shelving), f-aICKIbuo8zQ-055/115 (flat canopy + cloth banner + mint doors) and
  // f-FKQOEO-1ceE-205 (numbered door + open glazed bay). Plausible in-world text
  // only, never Treyarch wording.
  const bayZ = Z_FRONT + S * 0.44; // recessed dark bay plane behind the face
  const bayFaceZ = Z_FRONT - S * 0.06; // pier/header plane on the street face
  for (let k = 0; k < GARAGE_BAYS; k++) {
    const bx = bayCx(k);
    const open = k === OPEN_BAY;
    bDark.add(bayHalf * 2, bayTop, 0.14, bx, bayTop * 0.5, bayZ);
    bTrim.add(bayHalf * 2 + 0.3, 0.18, 0.2, bx, bayTop + 0.09, bayFaceZ);
    for (const s of [-1, 1]) bTrim.add(0.16, bayTop, 0.2, bx + s * (bayHalf + 0.07), bayTop * 0.5, bayFaceZ);
    if (!open) {
      // Closed ribbed sectional: thin repeated slats proud of the dark plane.
      for (let r = 0; r < 7; r++) {
        bTrim.add(bayHalf * 2 - 0.06, 0.09, 0.06, bx, 0.32 + r * (bayTop - 0.5) / 6, bayZ - S * 0.1);
      }
    } else {
      // Open bay: slab stack parked under the header, dark throat left clear.
      for (let r = 0; r < 3; r++) {
        bTrim.add(bayHalf * 2 - 0.06, 0.09, 0.06, bx, bayTop - 0.18 - r * 0.16, bayZ - S * 0.1);
      }
    }
  }
  // Open flat translucent canopy slab on slim columns forward of the bays.
  const gCanZ = Z_FRONT - S * 1.55, gCanY = GARAGE_H * 0.82;
  const gCanopy = box(GARAGE_LEN + 1.2, 0.1, 2.3, ctx.mat.glass, GAR_CX, gCanY, gCanZ);
  gCanopy.castShadow = true; g.add(gCanopy);
  bTrim.add(GARAGE_LEN + 1.2, 0.1, 0.14, GAR_CX, gCanY - 0.08, gCanZ - S * 1.15);
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
  // chequered floor round the pool (INTERIORS-TOPOLOGY s3), laid above the plateau
  for (let fx = 0; fx < 6; fx++) {
    for (let fz = 0; fz < 6; fz++) {
      const px = GAR_OUT_X - GEW * (0.45 + fx * 1.0);
      const pz = GAR_CZ - S * (GARAGE_DEPTH * 0.5 - 0.7 - fz * 1.1);
      if (Math.abs(px - poolCx) < poolW * 0.5 + 0.3
        && Math.abs(pz - poolCz) < poolD * 0.5 + 0.3) continue;
      g.add(slab(0.98, 0.05, 1.08, (fx + fz) % 2
        ? ctx.mat.painted(PAL.capsuleWhite, 0.55, 0.05)
        : ctx.mat.painted(PAL.capsuleTrim, 0.55, 0.05), px, 0.115, pz));
    }
  }
  // Three Nuka-style vending machines and the green back-lit display shelving that face
  // each other across the room in g-tB35IKluv0g-091 - both are cover.
  const vendX = GAR_OUT_X - GEW * (GARAGE_LEN - 0.85);
  for (let vd = 0; vd < 3; vd++) {
    const vz = GAR_CZ - S * (GARAGE_DEPTH * 0.5 - 1.35 - vd * 1.0);
    bWall.add(0.62, 1.95, 0.92, vendX, 0.975, vz);
    bGlaz.add(0.06, 1.15, 0.72, vendX - GEW * 0.3, 1.2, vz);
    colliders.push(aabbSlab(vendX, 0, vz, 0.65, 1.95, 0.92));
  }
  const shelfZ = GAR_CZ + S * (GARAGE_DEPTH * 0.5 - 0.55);
  bWall.add(1.8, 1.6, 0.42, poolCx, 1.45, shelfZ);
  // GREEN back-lit shelving - the bGlow batch is one warm-white material, and this
  // shelving is the room's signature colour (g-tB35IKluv0g-091), so it gets its own.
  for (let sy = 0; sy < 3; sy++) {
    g.add(box(1.66, 0.07, 0.3, ctx.mat.emissive(PAL.lawn, 1.6),
      poolCx, 0.95 + sy * 0.45, shelfZ - S * 0.08));
  }
  colliders.push(aabbSlab(poolCx, 0.65, shelfZ, 1.8, 1.6, 0.42));
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
    run(bTrim, garTrim[i], garTrim[(i + 1) % garTrim.length], GAR_PLAN, GARAGE_H - 0.06, GARAGE_H + rT, 0.18, 0);
  }

  // --- porch canopy + entry deck ------------------------------------------------
  const canZ = Z_FRONT - S * (CANOPY_OUT * 0.5 - 0.2);
  g.add(box(CANOPY_LEN, 0.26, CANOPY_OUT + 0.4, ctx.mat.capsuleWhite, FRONT_DOOR_X, CANOPY_Y - 0.13, canZ));
  bTrim.add(CANOPY_LEN + 0.12, 0.16, 0.18, FRONT_DOOR_X, CANOPY_Y - 0.3, Z_FRONT - S * (CANOPY_OUT - 0.1));
  const entryZ = Z_FRONT - S * (CANOPY_OUT * 0.5 - 0.15), entryW = CANOPY_LEN + 1.2;
  g.add(slab(entryW, DECK_T, CANOPY_OUT, ctx.mat.concrete, FRONT_DOOR_X, 0, entryZ));
  colliders.push(aabbSlab(FRONT_DOOR_X, 0, entryZ, entryW, DECK_T, CANOPY_OUT));

  // --- rear deck + exterior stair ------------------------------------------------
  bWood.add(DECK_LEN, 0.22, DECK_OUT, DECK_CX, DECK_Y - 0.11, DECK_CZ);
  colliders.push(aabb(DECK_CX, DECK_Y - 0.11, DECK_CZ, DECK_LEN, 0.22, DECK_OUT));
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    bWood.add(0.22, DECK_Y - 0.22, 0.22, DECK_CX + sx * (DECK_LEN * 0.5 - 0.18),
      (DECK_Y - 0.22) * 0.5, DECK_CZ + sz * (DECK_OUT * 0.5 - 0.18));
  }
  const railY = DECK_Y + RAIL_H;
  const edges: [number, number, number, number][] = [
    [DECK_CX, DECK_CZ + S * DECK_OUT * 0.5, DECK_LEN, 0],
    [DECK_CX - DECK_END * DECK_LEN * 0.5, DECK_CZ, DECK_OUT, Math.PI * 0.5],
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
    bWood.add(0.1, RAIL_IN, GOING, railXW, top + RAIL_IN / 2, zc);
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
  const BANDW = 0.4;
  const [uz0, uz1] = span(VOID_Z, REAR.cz + S * REAR.r);
  const nBandW = Math.max(1, Math.round((uz1 - uz0) / BANDW));
  const [wz0, wz1] = span(VOID_Z, ST_Z1);
  for (let b = 0; b < nBandW; b++) {
    const za = uz0 + b * (uz1 - uz0) / nBandW, zb = uz0 + (b + 1) * (uz1 - uz0) / nBandW;
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
  const faceOpen = subtract(-faceHX, faceHX, [wellX]);   // below H_FRONT: stairwell out
  for (const [y0, y1, glass] of [
    [FLOOR_H, U_SILL, false], [U_SILL, H_FRONT, true],
    [H_FRONT, U_HEAD, true], [U_HEAD, H_REAR, false],
  ] as [number, number, boolean][]) {
    if (y1 - y0 < 0.04) continue;
    for (const [xa, xb] of y1 <= H_FRONT + 1e-6 ? faceOpen : faceFull) {
      if (xb - xa < 0.06) continue;
      colliders.push(aabb((xa + xb) / 2, (y0 + y1) / 2, faceCz, xb - xa, y1 - y0, WALL_T));
      const n = Math.max(1, Math.round((xb - xa) / CHORD));
      for (let i = 0; i < n; i++) {
        const a = xa + (xb - xa) * i / n, c = xa + (xb - xa) * (i + 1) / n;
        const cx = (a + c) / 2;
        if (glass && i % PIER_EVERY !== 0) {
          bGlaz.add(c - a, y1 - y0, GLAZ_T, cx, (y0 + y1) / 2, faceCz + S * GLAZ_IN);
          if (i % 2 === 0) bTrim.add(0.12, y1 - y0, WALL_T * 0.7, cx, (y0 + y1) / 2, faceCz + S * GLAZ_IN * 0.45);
        } else {
          bWall.add(c - a + WALL_T * 0.6, y1 - y0, WALL_T, cx, (y0 + y1) / 2, faceCz);
        }
      }
    }
  }
  // deep cill under the window band and a head drip over it - the two lines the
  // capsule shell draws round every other opening in this house
  for (const [xa, xb] of faceOpen) {
    if (xb - xa < 0.06) continue;
    bWall.add(xb - xa, 0.18, WALL_T + 0.24, (xa + xb) / 2, U_SILL - 0.03, faceCz);
  }
  bTrim.add(faceHX * 2, 0.16, WALL_T + 0.14, 0, U_HEAD + 0.02, faceCz);
  bTrim.add(faceHX * 2, 0.18, WALL_T + 0.14, 0, FLOOR_H + 0.06, faceCz);   // skirting line
  // NO rail across ST_Z1: that is the head of the flight, i.e. the one cell a player
  // arriving from below has to step onto. It was railed for one build and the probe
  // climbed the whole stair and then stood there unable to get off it.
  // kitchen run + diner booth, garage end, clear of the garage doorway lane
  const CT_X = HOUSE_HALF_LEN - 0.95, CT_Z = REAR.cz + S * 1.3; // kitchen run
  bWall.add(0.65, 0.92, 2.2, CT_X, 0.46, CT_Z);
  bWood.add(0.72, 0.07, 2.3, CT_X, 0.955, CT_Z);
  bDark.add(0.6, 0.5, 0.9, CT_X - 0.02, 1.25, CT_Z - S * 0.7);
  colliders.push(aabbSlab(CT_X, 0, CT_Z, 0.65, 0.92, 2.2));
  // The built-in diner booth: navy banquettes round a fixed table, the best hard cover
  // on this floor (INTERIORS-TOPOLOGY s2.3, g-1icNQzMgLUM-041).
  const bkX = HOUSE_HALF_LEN * 0.66, bkZ = REAR.cz + S * 2.9;
  for (const sz of [-1, 1]) {
    bWall.add(2.0, 0.44, 0.55, bkX, 0.22, bkZ + sz * 0.72);
    bDark.add(2.0, 0.62, 0.14, bkX, 0.75, bkZ + sz * 0.95);
    colliders.push(aabbSlab(bkX, 0, bkZ + sz * 0.72, 2.0, 0.86, 0.6));
  }
  bWood.add(1.7, 0.07, 0.8, bkX, 0.74, bkZ);
  const FP_X = -HOUSE_HALF_LEN * 0.42; // chimney breast on the yard wall
  const fpZ = REAR.cz + REAR.hz - WALL_T - 0.28;
  bWallIn.add(1.7, FLOOR_H, 0.55, FP_X, FLOOR_H * 0.5, fpZ);
  bDark.add(0.9, 0.7, 0.2, FP_X, 0.45, fpZ - 0.2);
  bDark.add(1.9, 0.07, 0.8, FP_X, 0.035, fpZ - 0.15);
  colliders.push(aabbSlab(FP_X, 0, fpZ, 1.7, FLOOR_H, 0.55));
  // partitions as [x, zCentre, len]; each pair leaves a 1.2 m full-height doorway
  // One partition closes the stair's kitchen side; one screens the back room. Both
  // leave the plan open - a capsule house reads wrong chopped into cells.
  const segs: [number, number, number][] = [
    [ST_X + GEW * (ST_W / 2 + 0.09), REAR.cz - S * 1.0, 3.0],
    [-HOUSE_HALF_LEN * 0.34, REAR.cz + S * 1.6, 2.4],
  ];
  for (const [px, pz, pl] of segs) {
    bWallIn.add(0.14, 2.5, pl, px, 1.25, pz); // leaf
    bWallIn.add(0.18, 0.09, pl, px, 0.045, pz); // skirting
    colliders.push(aabbSlab(px, 0, pz, 0.14, 2.5, pl));
  }
  for (const [lx, lz] of [[REAR.cx, REAR.cz], [FRONT.cx, FRONT.cz]]) { // pendants, no scene lights
    bDark.add(0.05, 0.45, 0.05, lx, FLOOR_H - 0.45, lz);
    bSteel.add(0.34, 0.16, 0.34, lx, FLOOR_H - 0.72, lz);
    bGlow.add(0.16, 0.1, 0.16, lx, FLOOR_H - 0.82, lz);
  }
  // ==================== upper rooms ================================================
  // INTERIORS-TOPOLOGY s4.2: a PURPLE diamond-wallpaper bedroom in the ROUNDED capsule
  // end - its outer wall is curved because the shell is, which is the thing s8.7 says
  // makes the room read as Nuketown 2025 - and a PALE-GREEN room next to it through a
  // doorway. f-aICKIbuo8zQ-135, g-1icNQzMgLUM-249/-256/-263.
  const UY = FLOOR_H;
  const BX = -HOUSE_HALF_LEN * 0.34;                 // bedroom | green-room partition
  const BZ = REAR.cz + S * 0.9;
  // partition, stopping short of the yard end so the DECK DOOR route gets round it
  for (const [pz0, pz1] of [span(VOID_Z + 0.1, REAR.cz + S * 2.1)]) {
    bPlum.add(0.14, UPPER_H - 0.3, pz1 - pz0, BX, UY + (UPPER_H - 0.3) / 2, (pz0 + pz1) / 2);
    colliders.push(aabbSlab(BX, UY, (pz0 + pz1) / 2, 0.14, UPPER_H - 0.3, pz1 - pz0));
  }
  for (let di = 0; di < 8; di++) {                   // gold diamonds, plum face only
    const dz = -1.0 + (di % 4) * 0.7, dy = 1.0 + Math.floor(di / 4) * 0.62;
    bGold.add(0.05, 0.3, 0.3, BX - 0.09, UY + dy, BZ + dz);
  }
  // bed on a yellow rug, built-in cream headboard unit, side table and lamp
  // A single bed tight against the partition. The curved end is only ~4 m across at
  // the bedroom and a double bed in the middle of it pinched the room shut: paths.mjs
  // --y 3.3 reported the bedroom standable but SEALED, which is exactly the failure
  // that instrument exists to catch.
  // Unmoved: the -z face wall above hangs street-side of VOID_Z precisely so this bed
  // does not have to move. Two attempts at moving it instead (+0.26 m and +0.56 m) both
  // turned paths.mjs --y 3.3's bedroom landmark NO.
  const bedX = BX - 1.3, bedZ = VOID_Z + S * 1.05;
  bGold.add(1.0, 0.42, 1.9, bedX, UY + 0.21, bedZ);
  bWall.add(1.1, 0.85, 0.22, bedX, UY + 0.42, bedZ - S * 1.0);
  colliders.push(aabbSlab(bedX, UY, bedZ, 1.05, 0.55, 1.95));
  // Rug 2.4 -> 2.0 deep and the side table 1.05 -> 0.75 m off the bed centre: at their
  // old sizes both crossed the new -z face wall's inner plane and poked out of it.
  bPlum.add(2.2, 0.04, 2.0, bedX - 0.55, UY + 0.03, bedZ);
  bDark.add(0.42, 0.5, 0.42, bedX - 0.85, UY + 0.25, bedZ - S * 0.75);
  bGlow.add(0.22, 0.2, 0.22, bedX - 0.85, UY + 0.62, bedZ - S * 0.75);
  bSteel.add(0.06, 1.05, 0.06, bedX - 1.0, UY + 0.52, bedZ + S * 1.3);
  bGlow.add(0.26, 0.22, 0.26, bedX - 1.0, UY + 1.15, bedZ + S * 1.3);
  // pale-green room: striped wall panel, circular rug, starburst clock (g-1icNQzMgLUM-256)
  const grX = BX + 1.9, grZ = REAR.cz + S * 1.4;
  bMint.add(0.05, 2.0, 3.0, BX + 0.1, UY + 1.15, grZ);
  bMint.add(2.6, 0.04, 2.4, grX, UY + 0.03, grZ);
  bWood.add(0.9, 0.42, 0.5, grX + 0.5, UY + 0.21, grZ + S * 1.2);
  colliders.push(aabbSlab(grX + 0.5, UY, grZ + S * 1.2, 0.9, 0.42, 0.5));
  const star = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 14),
    ctx.mat.painted(PAL.interiorGold, 0.5, 0.2));
  star.rotation.x = Math.PI * 0.5;
  star.position.set(BX + 0.14, UY + 1.9, grZ - S * 0.9);
  g.add(star);
  // Mint finish and the one striped-wall station cluster this house is allowed, both
  // laid ON the curved wall. They were a free-standing screen until paths.mjs --y 3.3
  // showed a 0.14 m ensuite partition plugging the ONLY corridor into the bedroom -
  // the whole room standable and completely sealed. Paint, not furniture.
  bMint.add(0.06, 1.9, 2.6, BX - 3.15, UY + 1.05, REAR.cz + S * 2.4);
  g.add(box(0.05, 0.4, 1.4, ctx.mat.painted(PAL.trailerTrim, 0.7, 0),
    BX - 3.09, UY + 1.45, REAR.cz + S * 2.4));
  bGold.add(0.04, 0.06, 1.4, BX - 3.08, UY + 1.69, REAR.cz + S * 2.4);
  bDark.add(0.09, 0.22, 0.16, BX - 3.08, UY + 1.3, REAR.cz + S * 1.8);
  g.add(box(0.04, 0.32, 0.5, ctx.mat.signText({
    text: 'House Care', color: PAL.rooftopDrum, background: PAL.capsuleWhite, aspect: 1.6,
  }), BX - 3.08, UY + 1.0, REAR.cz + S * 3.0));
  // ceiling diffusers upstairs - emissive only, never a scene light
  for (const [lx, lz] of [[bedX, bedZ], [grX, grZ]]) {
    bGlow.add(0.5, 0.05, 0.5, lx, UY + UPPER_H - 0.4, lz);
  }
  // ---- ground-floor back room left behind by the bedroom moving upstairs
  bWallIn.add(0.14, 2.4, 2.2, BX, 1.2, REAR.cz + S * 3.4);
  colliders.push(aabbSlab(BX, 0, REAR.cz + S * 3.4, 0.14, 2.4, 2.2));
  bWood.add(1.7, 0.44, 0.7, BX - 2.0, 0.22, REAR.cz + S * 3.2);
  colliders.push(aabbSlab(BX - 2.0, 0, REAR.cz + S * 3.2, 1.7, 0.44, 0.7));

  // --- exterior close-up detail ----------------------------------------------------
  const gut = (p: Plan, top: number): void => {
    const loop = planLoop(p, 2.4);
    for (let i = 0; i < loop.length; i++) {
      run(bSteel, loop[i], loop[(i + 1) % loop.length], p, top - 0.16, top - 0.04, 0.12, 0.12);
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
      run(bRubble, a, c, p, 0, 0.45, WALL_T + 0.1, 0.03);
    }
  };
  skirt(REAR, false); skirt(FRONT, false); skirt(GAR_PLAN, true);
  const stFace = Z_FRONT - S * 0.2, ydFace = Z_BACK + S * 0.2; // proud of the faces
  bSteel.add(0.12, H_FRONT, 0.12, FRONT_DOOR_X + 2.2, H_FRONT * 0.5, Z_FRONT - S * 0.18);
  bSteel.add(0.12, H_REAR, 0.12, YARD_DOOR_X - 2.4, H_REAR * 0.5, Z_BACK + S * 0.18);
  bSteel.add(0.12, GARAGE_H, 0.12, GAR_CX - GARAGE_LEN * 0.5 + 0.3, GARAGE_H * 0.5, Z_FRONT - S * 0.2);
  bDark.add(0.55, 0.75, 0.2, FRONT_DOOR_X + 1.3, 0.55, stFace); // meter box on the spandrel
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
  g.add(slab(2.0, 0.12, 1.0, ctx.mat.concrete, YARD_DOOR_X, 0, Z_BACK + S * 0.55)); // yard step
  colliders.push(aabbSlab(YARD_DOOR_X, 0, Z_BACK + S * 0.55, 2.0, 0.12, 1.0));
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
