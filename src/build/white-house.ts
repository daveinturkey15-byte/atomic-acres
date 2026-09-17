/**
 * WHITE HOUSE - the +z show home (layout.WHITE).
 *
 * The 180-degree rotational PARTNER of the orange house, not its mirror: a different
 * piece of architecture inside the same envelope. Two fat rounded capsule volumes
 * (stadium plans) - a tall two-storey rear capsule carrying a pale blue-grey glazed
 * roof panel and a dark rooftop drum, with a lower single-storey entry capsule slung
 * across the street face under a deep cantilevered eave. Blue reveal bands and window
 * frames. Flat garage roof (shallow crown) instead of the orange house's barrel vaults.
 *
 * Every structural dimension comes from ../core/layout; the x end is read off
 * WHITE.garageX / WHITE.deckX so the pair stays rotational.
 */
import * as THREE from 'three';
import { PAL } from '../core/palette';
import {
  WHITE, HOUSE_HALF_LEN, HOUSE_DEPTH, FLOOR_H, UPPER_H, EAVE_Y,
  GARAGE_LEN, GARAGE_DEPTH, GARAGE_H, GARAGE_BAYS,
  DECK_Y, DECK_LEN, DECK_OUT, RAIL_H, KERB_HEIGHT,
  CANOPY_Y, CANOPY_LEN, CANOPY_OUT,
} from '../core/layout';
import { aabb, aabbSlab, box, extrude, group, slab } from '../core/kit';
import type { AABB, Builder } from '../core/kit';

// ------------------------------------------------------------------ helpers
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
    for (let i = 0; i < n; i++) {
      out.push(new THREE.Vector2(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n));
    }
  };
  arc(sx, sz, 0);
  line(p.cx + sx, p.cz + sz + p.r, p.cx - sx, p.cz + sz + p.r);
  arc(-sx, sz, Math.PI * 0.5);
  line(p.cx - sx - p.r, p.cz + sz, p.cx - sx - p.r, p.cz - sz);
  arc(-sx, -sz, Math.PI);
  line(p.cx - sx, p.cz - sz - p.r, p.cx + sx, p.cz - sz - p.r);
  arc(sx, -sz, Math.PI * 1.5);
  line(p.cx + sx + p.r, p.cz - sz, p.cx + sx + p.r, p.cz + sz);
  return out;
}

/** Vertical prism of a rounded plan; base sits at yBase. */
function prism(p: Plan, h: number, yBase: number, material: THREE.Material, seg = 8): THREE.Mesh {
  const s = new THREE.Shape();
  const x0 = p.cx - p.hx + p.r, x1 = p.cx + p.hx - p.r;
  const z0 = p.cz - p.hz + p.r, z1 = p.cz + p.hz - p.r;
  s.absarc(x1, z1, p.r, 0, Math.PI * 0.5, false);
  s.absarc(x0, z1, p.r, Math.PI * 0.5, Math.PI, false);
  s.absarc(x0, z0, p.r, Math.PI, Math.PI * 1.5, false);
  s.absarc(x1, z0, p.r, Math.PI * 1.5, Math.PI * 2, false);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg });
  g.rotateX(Math.PI * 0.5);
  g.translate(0, h, 0);
  const m = new THREE.Mesh(g, material);
  m.position.y = yBase;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Collects oriented boxes and emits ONE InstancedMesh, so a whole shell is 1 draw call. */
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
}

// ------------------------------------------------------------------ geometry constants
const S = WHITE.side;
const Z_FRONT = WHITE.frontZ;
const Z_BACK = WHITE.backZ;

const WALL_T = 0.26;
const CHORD = 0.55;
const COARSE = 1.2;

// Glazing. A pane flush with the wall face has no reveal, so a whole band reads as
// one dark slab whatever the material does. These set the pane back far enough that
// the head soffit and the cill throw a shadow line across every bay.
const GLAZ_IN = WALL_T * 0.32;   // setback of the pane behind the outer wall face
const GLAZ_T = WALL_T * 0.3;     // pane leaf thickness
const PIER_EVERY = 6;            // chords between the solid piers that break the ribbon

const REAR_D = HOUSE_DEPTH * 0.72;
const FRONT_D = HOUSE_DEPTH * 0.56;
const REAR: Plan = {
  cx: 0, cz: Z_BACK - S * REAR_D * 0.5,
  hx: HOUSE_HALF_LEN, hz: REAR_D * 0.5, r: REAR_D * 0.5,
};
const FRONT: Plan = {
  cx: -HOUSE_HALF_LEN * 0.12, cz: Z_FRONT + S * FRONT_D * 0.5,
  hx: HOUSE_HALF_LEN * 0.77, hz: FRONT_D * 0.5, r: FRONT_D * 0.5,
};
const H_REAR = EAVE_Y;
const H_FRONT = FLOOR_H + UPPER_H * 0.38;

const G_SILL = FLOOR_H * 0.33;
const G_HEAD = FLOOR_H * 0.78;          // 2.46 m head - clears the 2.1 m doorway rule
const U_SILL = FLOOR_H + UPPER_H * 0.31;
const U_HEAD = FLOOR_H + UPPER_H * 0.755;
const DOOR_HALF = 0.9;
const FRONT_DOOR_X = -HOUSE_HALF_LEN * 0.16;
const YARD_DOOR_X = HOUSE_HALF_LEN * 0.26;

const GAR_CX = WHITE.garageX;
const GAR_CZ = Z_FRONT + S * GARAGE_DEPTH * 0.5;
const GAR_PLAN: Plan = {
  cx: GAR_CX, cz: GAR_CZ, hx: GARAGE_LEN * 0.5, hz: GARAGE_DEPTH * 0.5, r: GARAGE_LEN * 0.12,
};
const LINK_W = REAR_D * 0.52;
const LINK_D = REAR_D * 0.7;
const LINK_CX = HOUSE_HALF_LEN - LINK_W * 0.5 + 0.3;      // overlaps the garage box
const LINK: Plan = {
  cx: LINK_CX, cz: REAR.cz, hx: LINK_W * 0.5, hz: LINK_D * 0.5, r: 0.2,
};

const DECK_CX = WHITE.deckX;
const DECK_CZ = Z_BACK + S * DECK_OUT * 0.5;
const DECK_END = -WHITE.garageEnd;                        // x direction away from the garage
const DECK_EDGE_X = DECK_CX + DECK_END * DECK_LEN * 0.5;
const STEPS = 13;
const STEP_RISE = DECK_Y / STEPS;
const STEP_GOING = 0.29;
const DECK_T = KERB_HEIGHT + 0.1;   // entry-deck top, standing clear of the lawn plateau

/** Door hole on a chord, expressed in the plan's own street(-1)/yard(+1) face sign. */
interface Hole { x: number; face: -1 | 1; y0: number; y1: number }

// ------------------------------------------------------------------ builder
export const buildWhiteHouse: Builder = (ctx) => {
  const g = group('white-house');
  const colliders: AABB[] = [];
  const bWall = new Batch(), bGlaz = new Batch(), bTrim = new Batch();
  const bDark = new Batch(), bWood = new Batch(), bSteel = new Batch();

  /** Place one wall/glass/trim chunk along a chord, pushed `out` proud of the face. */
  const run = (
    b: Batch, a: THREE.Vector2, c: THREE.Vector2, p: Plan,
    y0: number, y1: number, t: number, out: number, grow = 0,
  ): void => {
    const dx = c.x - a.x, dz = c.y - a.y;
    const L = Math.hypot(dx, dz);
    if (L < 1e-3 || y1 - y0 < 0.04) return;
    const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
    let nx = mx - p.cx, nz = mz - p.cz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    b.add(L + t * 0.6 + grow, y1 - y0, t, mx + nx * out, (y0 + y1) * 0.5, mz + nz * out,
      Math.atan2(-dz, dx));
  };

  /**
   * Shell one capsule: wall bands, glazing bands, blue reveal + cap trim, door holes,
   * and chords buried inside a neighbouring mass are dropped so the interiors connect.
   */
  const shell = (p: Plan, top: number, twoStorey: boolean, holes: Hole[], others: Plan[]): void => {
    const loop = planLoop(p, CHORD);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], c = loop[(i + 1) % loop.length];
      const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
      if (others.some((o) => planSdf(o, mx, mz) < -0.18)) continue;
      const face: -1 | 1 = S * (mz - p.cz) < 0 ? -1 : 1;
      const flat = Math.abs(S * (mz - p.cz)) > p.hz * 0.6;
      let hole: Hole | null = null;
      for (const h of holes) {
        if (flat && h.face === face && Math.abs(mx - h.x) < DOOR_HALF) hole = h;
      }
      // a solid pier every few chords, so neither band can read as one long void
      const pierChord = i % PIER_EVERY === 0;
      const put = (y0: number, y1: number, glass: boolean): void => {
        // only the band the door actually crosses loses its pier and its frame;
        // treating the whole chord as holed left a bare slab of glass over every door
        const cut = hole !== null && y1 > hole.y0 && y0 < hole.y1;
        const pier = pierChord && !cut;
        const glazed = glass && !pier;
        const b = glazed ? bGlaz : bWall;
        const t = glazed ? GLAZ_T : WALL_T;
        const o = glazed ? -GLAZ_IN : 0;
        if (cut && hole) {
          if (y0 < hole.y0) run(b, a, c, p, y0, hole.y0, t, o);
          if (y1 > hole.y1) run(b, a, c, p, hole.y1, y1, t, o);
        } else {
          run(b, a, c, p, y0, y1, t, o);
        }
        if (!glazed || cut) return;
        // frame the bay: blue head drip, white projecting cill, blue transom, and a
        // mullion every other chord standing proud of the glass inside the reveal.
        run(bTrim, a, c, p, y1 - 0.06, y1 + 0.08, WALL_T + 0.12, 0);
        run(bWall, a, c, p, y0 - 0.1, y0 + 0.06, WALL_T + 0.2, 0);
        const ym = y0 + (y1 - y0) * 0.61;
        run(bTrim, a, c, p, ym - 0.05, ym + 0.05, WALL_T * 0.8, -GLAZ_IN * 0.5);
        if (i % 2 === 0) {
          run(bTrim, a, c, p, y0, y1, WALL_T * 0.7, -GLAZ_IN * 0.45, -CHORD + 0.12);
        }
      };
      put(0, G_SILL, false);
      put(G_SILL, G_HEAD, true);
      put(G_HEAD, twoStorey ? FLOOR_H : top, false);
      if (twoStorey) {
        put(FLOOR_H, U_SILL, false);
        put(U_SILL, U_HEAD, true);
        put(U_HEAD, top, false);
        run(bTrim, a, c, p, FLOOR_H - 0.16, FLOOR_H + 0.12, WALL_T + 0.14, 0);
      }
      run(bTrim, a, c, p, top - 0.3, top + (twoStorey ? 0.1 : 0.34), WALL_T + 0.14, 0);
    }
    // coarse colliders around the same outline, with the door gaps opened up
    const cw = COARSE * 1.12;                 // overlap so the ring has no seams
    for (const q of planLoop(p, COARSE)) {
      if (others.some((o) => planSdf(o, q.x, q.y) < -0.18)) continue;
      const face: -1 | 1 = S * (q.y - p.cz) < 0 ? -1 : 1;
      const flat = Math.abs(S * (q.y - p.cz)) > p.hz * 0.6;
      const h = holes.find((d) => flat && d.face === face
        && Math.abs(q.x - d.x) < DOOR_HALF + COARSE * 0.5);
      const col = (y0: number, y1: number): void => {
        if (y1 - y0 > 0.05) colliders.push(aabbSlab(q.x, y0, q.y, cw, y1 - y0, cw));
      };
      if (h) { col(0, h.y0); col(h.y1, top); } else { col(0, top); }
    }
  };

  // --- the two capsule masses -------------------------------------------------
  shell(REAR, H_REAR, true, [
    { x: YARD_DOOR_X, face: 1, y0: 0, y1: G_HEAD },
    { x: DECK_CX, face: 1, y0: DECK_Y, y1: U_HEAD },
  ], [FRONT, LINK]);
  shell(FRONT, H_FRONT, false, [
    { x: FRONT_DOOR_X, face: -1, y0: 0, y1: G_HEAD },
  ], [REAR]);

  // --- floors, roof decks, glazed roof panel, rooftop drum --------------------
  g.add(prism(REAR, 0.1, 0, ctx.mat.concrete));
  g.add(prism(FRONT, 0.1, 0, ctx.mat.concrete));
  g.add(prism({ ...REAR, hx: REAR.hx - WALL_T, hz: REAR.hz - WALL_T, r: REAR.r - WALL_T },
    0.22, FLOOR_H - 0.22, ctx.mat.concrete));
  g.add(prism(REAR, 0.16, H_REAR, ctx.mat.capsuleWhite));
  g.add(prism(FRONT, 0.14, H_FRONT, ctx.mat.capsuleWhite));

  const glazHz = REAR.hz - REAR_D * 0.155;
  const glaze: Plan = {
    cx: -HOUSE_HALF_LEN * 0.18, cz: REAR.cz,
    hx: HOUSE_HALF_LEN * 0.66, hz: glazHz, r: glazHz,
  };
  g.add(prism(glaze, 0.14, H_REAR + 0.16, ctx.mat.roofGlazing, 10));
  const glazLoop = planLoop(glaze, CHORD * 1.6);
  for (let i = 0; i < glazLoop.length; i++) {
    run(bTrim, glazLoop[i], glazLoop[(i + 1) % glazLoop.length], glaze,
      H_REAR + 0.14, H_REAR + 0.34, 0.16, 0);
  }

  const drumX = HOUSE_HALF_LEN * 0.73, drumR = REAR_D * 0.22, drumH = UPPER_H * 0.69;
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(drumR, drumR, drumH, 22),
    ctx.mat.painted(PAL.rooftopDrum, 0.5, 0.2));
  drum.position.set(drumX, H_REAR + 0.16 + drumH * 0.5, REAR.cz);
  drum.castShadow = drum.receiveShadow = true;
  g.add(drum);
  const capGeo = new THREE.CylinderGeometry(drumR * 1.12, drumR * 1.12, 0.18, 22);
  const cap = new THREE.Mesh(capGeo, ctx.mat.painted(PAL.capsuleTrim, 0.5, 0.2));
  cap.position.set(drumX, H_REAR + 0.16 + drumH, REAR.cz);
  g.add(cap);
  colliders.push(aabbSlab(drumX, H_REAR, REAR.cz, drumR * 2, drumH, drumR * 2));

  // --- garage wing: box footprint, flat shallow-crowned roof, 3 recessed bays --
  const garLoop = planLoop(GAR_PLAN, CHORD);
  const bayPitch = GARAGE_LEN / GARAGE_BAYS;
  const bayHalf = bayPitch * 0.36;
  const bayTop = GARAGE_H * 0.7;
  for (let i = 0; i < garLoop.length; i++) {
    const a = garLoop[i], c = garLoop[(i + 1) % garLoop.length];
    const mx = (a.x + c.x) * 0.5, mz = (a.y + c.y) * 0.5;
    if (planSdf(REAR, mx, mz) < -0.18) continue;
    if (mx < HOUSE_HALF_LEN + 0.05 && Math.abs(mz - REAR.cz) < LINK_D * 0.5) continue;
    let bay = false;
    for (let k = 0; k < GARAGE_BAYS; k++) {
      const bx = GAR_CX + (k - (GARAGE_BAYS - 1) * 0.5) * bayPitch;
      if (S * (mz - GAR_CZ) < 0 && Math.abs(mx - bx) < bayHalf) bay = true;
    }
    if (bay) run(bWall, a, c, GAR_PLAN, bayTop, GARAGE_H, WALL_T, 0);
    else run(bWall, a, c, GAR_PLAN, 0, GARAGE_H, WALL_T, 0);
  }
  for (let k = 0; k < GARAGE_BAYS; k++) {
    const bx = GAR_CX + (k - (GARAGE_BAYS - 1) * 0.5) * bayPitch;
    const bz = Z_FRONT + S * 0.44;
    bDark.add(bayHalf * 2, bayTop, 0.14, bx, bayTop * 0.5, bz);
    bTrim.add(bayHalf * 2 + 0.3, 0.18, 0.2, bx, bayTop + 0.09, Z_FRONT - S * 0.06);
    bTrim.add(0.16, bayTop, 0.2, bx - bayHalf - 0.07, bayTop * 0.5, Z_FRONT - S * 0.06);
    bTrim.add(0.16, bayTop, 0.2, bx + bayHalf + 0.07, bayTop * 0.5, Z_FRONT - S * 0.06);
  }
  bWall.add(LINK_W, GARAGE_H, LINK_D, LINK_CX, GARAGE_H * 0.5, REAR.cz);
  colliders.push(aabbSlab(LINK_CX, 0, REAR.cz, LINK_W, GARAGE_H, LINK_D));
  colliders.push(aabbSlab(GAR_CX, 0, GAR_CZ, GARAGE_LEN, GARAGE_H, GARAGE_DEPTH));

  // shallow crown only - a flat roof with a trim fascia, NOT the orange house's vaults
  const rHalf = GARAGE_LEN * 0.5 + 0.22, rise = HOUSE_DEPTH * 0.02, rT = 0.22;
  const roofPts: [number, number][] = [[-rHalf, 0], [rHalf, 0]];
  for (let i = 0; i <= 10; i++) {
    const x = rHalf - (2 * rHalf * i) / 10;
    roofPts.push([x, rT + rise * (1 - (x / rHalf) * (x / rHalf))]);
  }
  const garRoof = extrude(roofPts, GARAGE_DEPTH + 0.5, ctx.mat.capsuleWhite);
  garRoof.position.set(GAR_CX, GARAGE_H, GAR_CZ);
  g.add(garRoof);
  const garLoopTrim = planLoop({ ...GAR_PLAN, hx: rHalf, hz: GARAGE_DEPTH * 0.5 + 0.25 }, CHORD * 2);
  for (let i = 0; i < garLoopTrim.length; i++) {
    run(bTrim, garLoopTrim[i], garLoopTrim[(i + 1) % garLoopTrim.length], GAR_PLAN,
      GARAGE_H - 0.06, GARAGE_H + rT, 0.18, 0);
  }

  // --- deep cantilevered porch canopy on the street face ----------------------
  const canZ = Z_FRONT - S * (CANOPY_OUT * 0.5 - 0.2);
  g.add(box(CANOPY_LEN, 0.26, CANOPY_OUT + 0.4, ctx.mat.capsuleWhite,
    FRONT_DOOR_X, CANOPY_Y - 0.13, canZ));
  bTrim.add(CANOPY_LEN + 0.12, 0.16, 0.18, FRONT_DOOR_X, CANOPY_Y - 0.3,
    Z_FRONT - S * (CANOPY_OUT - 0.1));
  // The entry deck under the eave. It has to clear the lawn plateau ground.ts tops
  // out at KERB_HEIGHT + 0.001 - at 0.12 m thick it was buried and read as bare lawn.
  const entryZ = Z_FRONT - S * (CANOPY_OUT * 0.5 - 0.15);
  const entryW = CANOPY_LEN + 1.2;
  g.add(slab(entryW, DECK_T, CANOPY_OUT, ctx.mat.concrete, FRONT_DOOR_X, 0, entryZ));
  colliders.push(aabbSlab(FRONT_DOOR_X, 0, entryZ, entryW, DECK_T, CANOPY_OUT));

  // --- rear deck at upper-floor level + exterior stair down to the lawn -------
  bWood.add(DECK_LEN, 0.22, DECK_OUT, DECK_CX, DECK_Y - 0.11, DECK_CZ);
  colliders.push(aabb(DECK_CX, DECK_Y - 0.11, DECK_CZ, DECK_LEN, 0.22, DECK_OUT));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = DECK_CX + sx * (DECK_LEN * 0.5 - 0.18);
      const pz = DECK_CZ + sz * (DECK_OUT * 0.5 - 0.18);
      bWood.add(0.22, DECK_Y - 0.22, 0.22, px, (DECK_Y - 0.22) * 0.5, pz);
    }
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
      bSteel.add(0.04, RAIL_H - 0.1, 0.04,
        ex + Math.cos(rot) * f, DECK_Y + (RAIL_H - 0.1) * 0.5, ez - Math.sin(rot) * f);
    }
  }
  colliders.push(aabb(DECK_CX, DECK_Y + RAIL_H * 0.5, DECK_CZ + S * DECK_OUT * 0.5,
    DECK_LEN, RAIL_H, 0.16));
  colliders.push(aabb(DECK_CX - DECK_END * DECK_LEN * 0.5, DECK_Y + RAIL_H * 0.5, DECK_CZ,
    0.16, RAIL_H, DECK_OUT));

  const stairPts: [number, number][] = [[0, DECK_Y]];
  for (let i = 0; i < STEPS; i++) {
    stairPts.push([i * STEP_GOING, DECK_Y - i * STEP_RISE]);
    stairPts.push([(i + 1) * STEP_GOING, DECK_Y - i * STEP_RISE]);
    stairPts.push([(i + 1) * STEP_GOING, DECK_Y - (i + 1) * STEP_RISE]);
  }
  stairPts.push([0, 0]);
  const stair = extrude(stairPts, 1.35, ctx.mat.deckBoards);
  stair.position.set(DECK_EDGE_X, 0, DECK_CZ);
  stair.rotation.y = DECK_END === 1 ? 0 : Math.PI;
  g.add(stair);
  for (let i = 0; i < STEPS; i++) {
    const cx = DECK_EDGE_X + DECK_END * (i + 0.5) * STEP_GOING;
    colliders.push(aabbSlab(cx, 0, DECK_CZ, STEP_GOING, DECK_Y - i * STEP_RISE, 1.35));
  }

  // --- one draw call per material --------------------------------------------
  const batched: [Batch, THREE.Material, string][] = [
    [bWall, ctx.mat.capsuleWhite, 'wh-walls'],
    [bGlaz, ctx.mat.windowDark, 'wh-glazing'],
    [bTrim, ctx.mat.painted(PAL.capsuleTrim, 0.5, 0.15), 'wh-trim'],
    [bDark, ctx.mat.painted(PAL.rooftopDrum, 0.6, 0.1), 'wh-recess'],
    [bWood, ctx.mat.deckBoards, 'wh-deck'],
    [bSteel, ctx.mat.steel, 'wh-balusters'],
  ];
  for (const [b, m, n] of batched) { const im = b.mesh(m, n); if (im) g.add(im); }
  return { group: g, colliders };
};
