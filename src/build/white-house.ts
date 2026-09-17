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
const DOOR_HALF = 0.9, FRONT_DOOR_X = -HOUSE_HALF_LEN * 0.16, YARD_DOOR_X = HOUSE_HALF_LEN * 0.26;
const GAR_CX = WHITE.garageX, GAR_CZ = Z_FRONT + S * GARAGE_DEPTH * 0.5;
const GAR_PLAN: Plan = { cx: GAR_CX, cz: GAR_CZ, hx: GARAGE_LEN * 0.5, hz: GARAGE_DEPTH * 0.5, r: GARAGE_LEN * 0.12 };
const LINK_W = REAR_D * 0.52, LINK_D = REAR_D * 0.7, LINK_CX = HOUSE_HALF_LEN - LINK_W * 0.5 + 0.3;
const LINK: Plan = { cx: LINK_CX, cz: REAR.cz, hx: LINK_W * 0.5, hz: LINK_D * 0.5, r: 0.2 };
const DECK_CX = WHITE.deckX, DECK_CZ = Z_BACK + S * DECK_OUT * 0.5, DECK_END = -WHITE.garageEnd;
const DECK_EDGE_X = DECK_CX + DECK_END * DECK_LEN * 0.5;
const STEPS = 13, STEP_RISE = DECK_Y / STEPS, STEP_GOING = 0.29, DECK_T = KERB_HEIGHT + 0.1;

/** Door hole on a chord, in the plan's own street(-1)/yard(+1) face sign. */
interface Hole { x: number; face: -1 | 1; y0: number; y1: number }

// ------------------------------------------------------------------ builder
export const buildWhiteHouse: Builder = (ctx) => {
  const g = group('white-house');
  const colliders: AABB[] = [];
  const bWall = new Batch(), bGlaz = new Batch(), bTrim = new Batch();
  const bDark = new Batch(), bWood = new Batch(), bSteel = new Batch(), bGlow = new Batch();

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
      const face: -1 | 1 = S * (mz - p.cz) < 0 ? -1 : 1;
      const flat = Math.abs(S * (mz - p.cz)) > p.hz * 0.6;
      let hole: Hole | null = null;
      for (const h of holes) if (flat && h.face === face && Math.abs(mx - h.x) < DOOR_HALF) hole = h;
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
    const cw = COARSE * 1.12; // coarse colliders; spandrels solid (no walk-through)
    for (const q of planLoop(p, COARSE)) {
      if (others.some((o) => planSdf(o, q.x, q.y) < -0.18)) continue;
      const face: -1 | 1 = S * (q.y - p.cz) < 0 ? -1 : 1;
      const flat = Math.abs(S * (q.y - p.cz)) > p.hz * 0.6;
      const h = holes.find((d) => flat && d.face === face && Math.abs(q.x - d.x) < DOOR_HALF + COARSE * 0.5);
      const col = (y0: number, y1: number): void => {
        if (y1 - y0 > 0.05) colliders.push(aabbSlab(q.x, y0, q.y, cw, y1 - y0, cw));
      };
      if (h) { col(0, h.y0); col(h.y1, top); } else col(0, top);
    }
  };

  shell(REAR, H_REAR, true, [
    { x: YARD_DOOR_X, face: 1, y0: 0, y1: G_HEAD },
    { x: DECK_CX, face: 1, y0: DECK_Y, y1: U_HEAD },
  ], [FRONT, LINK]);
  shell(FRONT, H_FRONT, false, [{ x: FRONT_DOOR_X, face: -1, y0: 0, y1: G_HEAD }], [REAR]);

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
  const bayPitch = GARAGE_LEN / GARAGE_BAYS, bayHalf = bayPitch * 0.36, bayTop = GARAGE_H * 0.7;
  for (let i = 0; i < garLoop.length; i++) {
    const a = garLoop[i], c = garLoop[(i + 1) % garLoop.length];
    const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
    if (planSdf(REAR, mx, mz) < -0.18) continue;
    if (mx < HOUSE_HALF_LEN + 0.05 && Math.abs(mz - REAR.cz) < LINK_D * 0.5) continue;
    let bay = false;
    for (let k = 0; k < GARAGE_BAYS; k++) {
      if (S * (mz - GAR_CZ) < 0 && Math.abs(mx - GAR_CX - (k - (GARAGE_BAYS - 1) * 0.5) * bayPitch) < bayHalf) bay = true;
    }
    if (bay) run(bWall, a, c, GAR_PLAN, bayTop, GARAGE_H, WALL_T, 0);
    else run(bWall, a, c, GAR_PLAN, 0, GARAGE_H, WALL_T, 0);
  }
  for (let k = 0; k < GARAGE_BAYS; k++) {
    const bx = GAR_CX + (k - (GARAGE_BAYS - 1) * 0.5) * bayPitch;
    bDark.add(bayHalf * 2, bayTop, 0.14, bx, bayTop * 0.5, Z_FRONT + S * 0.44);
    bTrim.add(bayHalf * 2 + 0.3, 0.18, 0.2, bx, bayTop + 0.09, Z_FRONT - S * 0.06);
    for (const s of [-1, 1]) bTrim.add(0.16, bayTop, 0.2, bx + s * (bayHalf + 0.07), bayTop * 0.5, Z_FRONT - S * 0.06);
  }
  bWall.add(LINK_W, GARAGE_H, LINK_D, LINK_CX, GARAGE_H * 0.5, REAR.cz);
  colliders.push(aabbSlab(LINK_CX, 0, REAR.cz, LINK_W, GARAGE_H, LINK_D));
  colliders.push(aabbSlab(GAR_CX, 0, GAR_CZ, GARAGE_LEN, GARAGE_H, GARAGE_DEPTH));
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
  const stair = extrude(stairPts, 1.35, ctx.mat.deckBoards);
  stair.position.set(DECK_EDGE_X, 0, DECK_CZ); stair.rotation.y = DECK_END === 1 ? 0 : Math.PI;
  g.add(stair);
  for (let i = 0; i < STEPS; i++) {
    colliders.push(aabbSlab(DECK_EDGE_X + DECK_END * (i + 0.5) * STEP_GOING, 0, DECK_CZ,
      STEP_GOING, DECK_Y - i * STEP_RISE, 1.35));
  }

  // --- interior set dressing (all clear of both real doors) ----------------------
  const STAIR_X = DECK_CX, NST = 10, sRise = FLOOR_H / (NST + 1), sGo = 0.28;
  const sZ0 = REAR.cz - REAR.hz * 0.5, sLen = NST * sGo + 0.8, sZc = sZ0 + sLen * 0.5 - 0.4;
  for (let i = 0; i < NST; i++) { // open flight at the deck end, cheeks leave a foot doorway
    const top = sRise * (i + 1);
    bWood.add(1.2, 0.09, sGo + 0.05, STAIR_X, top - 0.045, sZ0 + i * sGo);
    colliders.push(aabbSlab(STAIR_X, 0, sZ0 + i * sGo, 1.2, top, sGo + 0.05));
  }
  for (const wx of [STAIR_X - 0.68, STAIR_X + 0.68]) {
    bWall.add(0.16, FLOOR_H, sLen, wx, FLOOR_H * 0.5, sZc);
    colliders.push(aabbSlab(wx, 0, sZc, 0.16, FLOOR_H, sLen));
  }
  const CT_X = HOUSE_HALF_LEN - 0.95, CT_Z = REAR.cz - 0.2; // kitchen run, garage-end wall
  bWall.add(0.65, 0.92, 3.0, CT_X, 0.46, CT_Z);
  bWood.add(0.72, 0.07, 3.1, CT_X, 0.955, CT_Z);
  bDark.add(0.6, 0.5, 0.9, CT_X - 0.02, 1.25, CT_Z - 1.1);
  colliders.push(aabbSlab(CT_X, 0, CT_Z, 0.65, 0.92, 3.0));
  const FP_X = -HOUSE_HALF_LEN * 0.42; // chimney breast on the yard wall
  const fpZ = REAR.cz + REAR.hz - WALL_T - 0.28;
  bWall.add(1.7, FLOOR_H, 0.55, FP_X, FLOOR_H * 0.5, fpZ);
  bDark.add(0.9, 0.7, 0.2, FP_X, 0.45, fpZ - 0.2);
  bDark.add(1.9, 0.07, 0.8, FP_X, 0.035, fpZ - 0.15);
  colliders.push(aabbSlab(FP_X, 0, fpZ, 1.7, FLOOR_H, 0.55));
  // partitions as [x, zCentre, len]; each pair leaves a 1.2 m full-height doorway
  const segs: [number, number, number][] = [
    [HOUSE_HALF_LEN * 0.5, REAR.cz - 1.95, 2.11], [HOUSE_HALF_LEN * 0.5, REAR.cz + 1.06, 1.51],
    [HOUSE_HALF_LEN * 0.33, FRONT.cz - 1.43, 1.1], [HOUSE_HALF_LEN * 0.33, FRONT.cz + 0.92, 1.2],
  ];
  for (const [px, pz, pl] of segs) {
    bWall.add(0.14, 2.5, pl, px, 1.25, pz); // leaf
    bWall.add(0.18, 0.09, pl, px, 0.045, pz); // skirting
    colliders.push(aabbSlab(px, 0, pz, 0.14, 2.5, pl));
  }
  for (const [lx, lz] of [[REAR.cx, REAR.cz], [FRONT.cx, FRONT.cz]]) { // pendants, no scene lights
    bDark.add(0.05, 0.45, 0.05, lx, FLOOR_H - 0.45, lz);
    bSteel.add(0.34, 0.16, 0.34, lx, FLOOR_H - 0.72, lz);
    bGlow.add(0.16, 0.1, 0.16, lx, FLOOR_H - 0.82, lz);
  }

  // --- exterior close-up detail ----------------------------------------------------
  const gut = (p: Plan, top: number): void => {
    const loop = planLoop(p, 2.4);
    for (let i = 0; i < loop.length; i++) {
      run(bSteel, loop[i], loop[(i + 1) % loop.length], p, top - 0.16, top - 0.04, 0.12, 0.12);
    }
  };
  gut(REAR, H_REAR); gut(FRONT, H_FRONT);
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
    [bWall, ctx.mat.capsuleWhite, 'wh-walls'], [bGlaz, ctx.mat.windowDark, 'wh-glazing'],
    [bTrim, ctx.mat.painted(PAL.capsuleTrim, 0.5, 0.15), 'wh-trim'],
    [bDark, ctx.mat.painted(PAL.rooftopDrum, 0.6, 0.1), 'wh-recess'],
    [bWood, ctx.mat.deckBoards, 'wh-deck'], [bSteel, ctx.mat.steel, 'wh-balusters'],
    [bGlow, ctx.mat.emissive(PAL.sunColor, 1.3), 'wh-glow'],
  ];
  for (const [b, m, n] of batched) { const im = b.mesh(m, n); if (im) g.add(im); }
  return { group: g, colliders };
};
