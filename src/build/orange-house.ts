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
  KERB_HEIGHT, ORANGE, RAIL_H, UPPER_H,
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

// glazing: a pane sits BEHIND the outer wall face so the jamb casts a reveal shadow
const PANE_T = 0.04;                        // leaf thickness
const REVEAL = 0.075;                       // setback of the pane from the outer face
const FRAME_W = 0.11;                       // frame face width around an aperture
const FRAME_D = 0.1;                        // frame depth (0.075 of it stands proud)
const DECK_T = KERB_HEIGHT + 0.1;           // entry deck top, clear of the lawn plateau

const UP = new THREE.Vector3(0, 1, 0);
const NOROT = new THREE.Quaternion();

/** The sweep: roof upper surface before the depth tilt, flat-ish then swooping. */
function baseY(x: number): number {
  const u = Math.min(1, Math.max(0, (x - LO_X) / (HI_X - LO_X)));
  return EAVE_Y + ROOF_T + ROOF_RISE * Math.pow(u, 1.6);
}
const roofTopY = (x: number, z: number): number => baseY(x) + TILT_K * (z - midZ);
const inst = (geo: THREE.BufferGeometry, m: THREE.Material, n: number): THREE.InstancedMesh => {
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
  ) => {
    const add = (p0: number, p1: number, y0: number, y1: number, solid: boolean) => {
      if (p1 - p0 < 0.02 || y1 - y0 < 0.02) return;
      const c = (p0 + p1) / 2, cy = (y0 + y1) / 2, L = p1 - p0, hh = y1 - y0;
      if (along === 'x') {
        g.add(box(L, hh, WALL_T, mat.stuccoCream, c, cy, fixed));
        if (solid) colliders.push(aabb(c, cy, fixed, L, hh, WALL_T));
      } else {
        g.add(box(WALL_T, hh, L, mat.stuccoCream, fixed, cy, c));
        if (solid) colliders.push(aabb(fixed, cy, c, WALL_T, hh, L));
      }
    };
    let cur = Math.min(a, b);
    for (const h of [...holes].sort((p, r) => p.c - r.c)) {
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
  const porchX = FE * (HHL - CORNER_R - CANOPY_LEN / 2);
  const backDoorX = GE * HHL * 0.32;   // must match the back-wall DOOR hole below

  wallRun('x', GND_FRONT + S * WALL_T / 2, GE * HHL, FE * HHL, OUT, [
    { c: porchX, ...DOOR }, { c: FE * HHL * 0.1, ...WIN }, { c: GE * HHL * 0.34, ...WIN },
  ]);
  wallRun('x', backZ + OUT * WALL_T / 2, GE * HHL, FE * HHL, S, [
    { c: GE * HHL * 0.32, ...DOOR }, { c: FE * HHL * 0.2, ...WIN }, { c: FE * HHL * 0.74, ...WIN },
  ]);
  wallRun('z', FE * (HHL - WALL_T / 2), GND_FRONT, backZ, FE, [{ c: midZ, ...WIN }]);
  wallRun('z', GE * (HHL - WALL_T / 2), GND_FRONT, backZ, GE, []);

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
    at(frameRows, o.c, o.head + FRAME_W / 2, frameN, o.w + 2 * FRAME_W, FRAME_W, FRAME_D);
    for (const s of [-1, 1]) {
      at(frameRows, o.c + s * (o.w + FRAME_W) / 2, cy, frameN, FRAME_W, hh, FRAME_D);
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

  // upper-storey glazed door onto the rear deck, filling the spandrel under the band
  const ddH = BAND_SILL - DECK_Y - 0.05, ddY = (DECK_Y + 0.05 + BAND_SILL) / 2;
  const ddZ = backZ + S * 0.03;
  g.add(box(1.7, ddH, 0.06, mat.windowDark, H.deckX, ddY, ddZ));
  frameRows.push([1.94, 0.12, 0.13, H.deckX, ddY + ddH / 2 + 0.06, ddZ + S * 0.03, 0]);
  frameRows.push([1.94, 0.1, 0.13, H.deckX, ddY - ddH / 2 - 0.05, ddZ + S * 0.03, 0]);
  for (const s of [-1, 1]) {
    frameRows.push([0.12, ddH, 0.13, H.deckX + s * 0.91, ddY, ddZ + S * 0.03, 0]);
  }
  frameRows.push([0.08, ddH, 0.1, H.deckX, ddY, ddZ + S * 0.015, 0]);

  emit(paneRows, mat.glass, false);
  emit(frameRows, frameMat, true);

  const gndCz = (GND_FRONT + backZ) / 2;
  const gndD = HOUSE_DEPTH - RECESS;
  g.add(slab(HHL * 2, 0.12, gndD, mat.concrete, 0, -0.09, gndCz));
  g.add(box(HHL * 2 - 0.1, 0.08, gndD - 0.1, mat.stuccoCream, 0, FLOOR_H - 0.05, gndCz));
  // rubble base course where the house meets the ground: painted() geometry only,
  // no colliders (inside the wall-collider line) — wants a proper veneer material later.
  const stoneM = mat.painted(PAL.rubbleStone, 0.9, 0);
  const skirt = (z: number, c0: number, c1: number): void => {
    g.add(box(c1 - c0, 0.4, 0.08, stoneM, (c0 + c1) / 2, 0.2, z));
    g.add(box(c1 - c0, 0.06, 0.1, mat.painted(PAL.rubbleMortar, 0.9, 0), (c0 + c1) / 2, 0.43, z));
  };
  skirt(GND_FRONT + OUT * 0.05, GE * HHL, porchX - 0.85); skirt(GND_FRONT + OUT * 0.05, porchX + 0.85, FE * HHL);
  skirt(backZ + S * 0.05, GE * HHL, backDoorX - 0.85); skirt(backZ + S * 0.05, backDoorX + 0.85, FE * HHL);
  // -------------------------------------------------- interior dressing (ground floor)
  // Blocky set dressing inside the walkable ground floor. Traverse probes start at
  // (x,-16)/(x,-20.4) and walk straight out through each real door, so the front
  // lane (x ~ porchX) and back lane (x ~ backDoorX) stay empty; every collider
  // below sits off those lanes. Partitions stop at >=1.1 m gaps, colliders flank.
  const darkIn = mat.timberDark, topIn = mat.painted(PAL.concreteDark, 0.6, 0.05);
  // stair bay on the garage-end wall: full-height cheeks, open toward the room
  // (2.1 m doorway), treads rising over a cupboard; the cap hides the penetration.
  const encX0 = GE * (HHL - 0.35), encX1 = encX0 - GE * 2.1, encXM = (encX0 + encX1) / 2;
  const encZ0 = frontZ - S * 1.9, encZ1 = encZ0 + S * 3.5, encZM = (encZ0 + encZ1) / 2;
  put(0.12, FLOOR_H, encZ0 - encZ1, frameMat, encX0, FLOOR_H / 2, encZM, true);
  put(0.12, FLOOR_H, encZ0 - encZ1, frameMat, encX1, FLOOR_H / 2, encZM, true);
  put(encX1 - encX0, 0.12, encZ0 - encZ1, frameMat, encXM, FLOOR_H - 0.06, encZM);
  put(encX1 - encX0 - 0.24, 1.1, 1.7, darkIn, encXM, 0.55, encZ0 + S * 2.15, true);
  for (let k = 0; k < 5; k++) {
    put(encX1 - encX0 - 0.24, 0.07, 0.3, mat.deckBoards,
      encXM, 1.25 + k * 0.32, encZ0 + S * (1.45 + k * 0.3));
  }
  // kitchen counter on a solid back-wall stretch, clear of the door and windows
  const kCZ = backZ - S * (WALL_T / 2 + 0.31);
  put(2.4, 0.9, 0.62, frameMat, -0.6, 0.45, kCZ, true);
  put(2.48, 0.06, 0.7, topIn, -0.6, 0.93, kCZ);
  g.add(box(0.9, 0.03, 0.5, mat.windowDark, -0.9, 0.975, kCZ));
  // chimney breast on the solid back-wall segment by the garage-end corner
  const fBX = GE * (HHL - 0.75), fBZ = backZ - S * (WALL_T / 2 + 0.275);
  put(1.5, 2.6, 0.55, mat.stuccoTerracotta, fBX, 1.3, fBZ, true);
  g.add(box(0.8, 0.6, 0.12, mat.barrelRoof, fBX, 0.45, fBZ - S * 0.24));
  put(1.6, 0.08, 0.65, darkIn, fBX, 1.12, fBZ - S * 0.03);
  // two dividers, each with a 1.3 m gap; colliders flank the gap, never span it
  const paX = porchX - 2.5, paZ0 = frontZ + S * 2.9, paZ1 = backZ - S * 1.3;
  const paG0 = midZ + S * 0.82, paG1 = midZ - S * 0.48;
  const segZ = (a: number, b: number): void => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    put(0.12, FLOOR_H, hi - lo, frameMat, paX, FLOOR_H / 2, (lo + hi) / 2, true);
  };
  segZ(paZ0, paG1); segZ(paG0, paZ1);
  const pbZ = midZ + S * 1.3, pbX0 = GE * (HHL - 1.0), pbX1 = GE * HHL * 0.05;
  const pbG0 = backDoorX + GE * 2.25, pbG1 = backDoorX + GE * 0.95;
  const segX = (a: number, b: number): void => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    put(hi - lo, FLOOR_H, 0.12, frameMat, (lo + hi) / 2, FLOOR_H / 2, pbZ, true);
  };
  segX(pbX0, pbG0); segX(pbG1, pbX1);
  // skirting tight to the inner faces, split around both doors; never collided
  const skF = GND_FRONT - S * (WALL_T / 2 + 0.015), skB = backZ - S * (WALL_T / 2 + 0.015);
  put(porchX - 0.75 + HHL - 0.3, 0.09, 0.03, darkIn, (-HHL + 0.3 + porchX - 0.75) / 2, 0.075, skF);
  put(HHL - 0.3 - porchX - 0.75, 0.09, 0.03, darkIn, (porchX + 0.75 + HHL - 0.3) / 2, 0.075, skF);
  put(backDoorX - 0.75 + HHL - 0.3, 0.09, 0.03, darkIn, (-HHL + 0.3 + backDoorX - 0.75) / 2, 0.075, skB);
  put(HHL - 0.3 - backDoorX - 0.75, 0.09, 0.03, darkIn, (backDoorX + 0.75 + HHL - 0.3) / 2, 0.075, skB);
  put(0.03, 0.09, HOUSE_DEPTH - RECESS - 0.6, darkIn, GE * (HHL - WALL_T / 2 - 0.155), 0.075, midZ);
  put(0.03, 0.09, HOUSE_DEPTH - RECESS - 0.6, darkIn, FE * (HHL - WALL_T / 2 - 0.155), 0.075, midZ);
  // ceiling lights: emissive diffusers only, no scene lights
  const glowM = mat.emissive(PAL.sunColor);
  for (const [lx, lz] of [[GE * HHL * 0.4, midZ + S * 1.2], [FE * HHL * 0.4, midZ - S * 1.8]] as P2[]) {
    put(0.1, 0.08, 0.1, darkIn, lx, FLOOR_H - 0.1, lz);
    g.add(box(0.55, 0.05, 0.55, glowM, lx, FLOOR_H - 0.15, lz));
  }
  // teal living/dining + white/blue kitchen (f-aICKIbuo8zQ-010); clear of door lanes.
  const tealM = mat.painted(PAL.interiorTeal, 0.85, 0);
  g.add(box(3.0, 1.1, 0.06, tealM, -0.7, 1.35, backZ - S * (WALL_T / 2 + 0.06)));
  g.add(box(2.4, 0.62, 0.04, mat.painted(PAL.applianceBlue, 0.6, 0.05), -0.6, 0.42, kCZ - S * 0.32));
  g.add(box(2.5, 0.05, 0.72, mat.painted(PAL.capsuleWhite, 0.7, 0), -0.6, 0.96, kCZ));
  const tblX = 0.9, tblZ = midZ + S * 1.6;
  const tblTop = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.06, 20), mat.painted(PAL.applianceRed, 0.55, 0.05)); tblTop.position.set(tblX, 0.74, tblZ); g.add(tblTop);
  const tblPed = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 0.72, 10), darkIn); tblPed.position.set(tblX, 0.37, tblZ); g.add(tblPed); colliders.push(aabb(tblX, 0.37, tblZ, 0.5, 0.74, 0.5));
  const shellM = mat.painted(PAL.lawn, 0.7, 0);
  const chairAt = (cx: number, cz: number, ry: number): void => {
    const seat = box(0.45, 0.07, 0.45, shellM, cx, 0.46, cz); seat.rotation.y = ry; g.add(seat);
    const back = box(0.45, 0.5, 0.07, shellM, cx - Math.sin(ry) * 0.2, 0.75, cz - Math.cos(ry) * 0.2); back.rotation.y = ry; g.add(back);
    const trumpet = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.2, 0.44, 10), darkIn); trumpet.position.set(cx, 0.22, cz); g.add(trumpet);
    colliders.push(aabb(cx, 0.4, cz, 0.5, 0.8, 0.5));
  };
  chairAt(tblX - 1.3, tblZ + 0.1, Math.PI / 2);
  chairAt(tblX + 0.2, tblZ - 1.25, -Math.PI / 2);
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.14, 20), mat.emissive(PAL.sunColor)); saucer.position.set(tblX, FLOOR_H - 0.25, tblZ - 0.6); g.add(saucer);
  for (const [px, pz] of [[tblX, tblZ], [-0.6, kCZ - S * 1.2]] as P2[]) {
    g.add(box(0.04, 0.7, 0.04, darkIn, px, FLOOR_H - 0.4, pz));
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat.emissive(PAL.sunColor)); globe.position.set(px, FLOOR_H - 0.85, pz); g.add(globe);
  }
  g.add(box(2.8, 0.03, 2.0, mat.painted(PAL.coachMaroon, 0.9, 0), tblX, 0.035, tblZ));
  for (const s of [-1, 1]) g.add(box(0.5, 2.0, 0.08, tealM, FE * HHL * 0.1 + s * 1.35, 1.5, GND_FRONT + S * 0.12));
  g.add(box(1.6, 0.06, 0.35, darkIn, -0.7, 1.95, backZ - S * 0.35));
  g.add(box(0.55, 0.4, 0.4, mat.windowDark, -1.1, 2.2, backZ - S * 0.35));
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.28, 10), mat.painted(PAL.trailerTrim, 0.7, 0)); pot.position.set(1.7, 0.14, midZ + S * 1.3); g.add(pot);
  const shrub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.7, 8), mat.painted(PAL.hedge, 0.9, 0)); shrub.position.set(1.7, 0.6, midZ + S * 1.3); g.add(shrub);
  colliders.push(aabb(1.7, 0.4, midZ + S * 1.3, 0.4, 0.8, 0.4));

  // -------------------------------------------------- upper storey (solid, wrapped corner)
  const wallPts = outline(GE * HHL, GE * HHL, CORNER_R, 5).map(([x, z]) => [x, -z] as P2);
  const upper = extrude(wallPts, UPPER_H, mat.stuccoTerracotta);
  upper.geometry.rotateX(-Math.PI / 2);
  upper.position.y = FLOOR_H + UPPER_H / 2;
  shear(upper, midZ);
  g.add(upper);
  colliders.push(aabb(0, FLOOR_H + UPPER_H / 2, midZ, HHL * 2, UPPER_H, HOUSE_DEPTH));

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
  const bandPts = outline(GE * HHL * 0.55, GE * HHL * 0.85, CORNER_R, 5);
  const nSeg = bandPts.length - 1;
  const glass = inst(unit, mat.windowDark, nSeg);
  const rails = inst(unit, frameMat, nSeg * 3);
  const bandCy = (BAND_SILL + BAND_HEAD) / 2;
  const bandH = BAND_HEAD - BAND_SILL;
  const TRANSOM_Y = BAND_SILL + bandH * 0.62;   // splits the band so it is not one void
  const stations: { x: number; z: number; a: number }[] = [];
  let ri = 0;
  for (let i = 0; i < nSeg; i++) {
    const [x0, z0] = bandPts[i];
    const [x1, z1] = bandPts[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const a = Math.atan2(-uz, ux);
    const nx = -uz, nz = ux;                       // outward face normal
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    q.setFromAxisAngle(UP, a);
    glass.setMatrixAt(i, m4.compose(
      v.set(mx + nx * 0.01, bandCy, mz + nz * 0.01), q, sc.set(len, bandH, 0.09)));
    for (const [yy, th] of [[BAND_HEAD + 0.07, 0.14], [BAND_SILL - 0.07, 0.14],
      [TRANSOM_Y, 0.11]] as P2[]) {
      rails.setMatrixAt(ri++, m4.compose(
        v.set(mx + nx * 0.05, yy, mz + nz * 0.05), q, sc.set(len, th, 0.17)));
    }
    const nm = Math.max(1, Math.round(len / 0.62));
    for (let k = i === 0 ? 0 : 1; k <= nm; k++) {
      const t = k / nm;
      stations.push({ x: x0 + dx * t + nx * 0.055, z: z0 + dz * t + nz * 0.055, a });
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
      const head = EAVE_Y + TILT_K * (face[0] - midZ);
      fins.setMatrixAt(fi++, m4.compose(
        v.set(x, (FLOOR_H + head) / 2, face[0] + face[1] * 0.075),
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
  g.add(slab(GARAGE_LEN, GARAGE_H, GARAGE_DEPTH, mat.stuccoCream, gx, 0, gz));
  colliders.push(aabbSlab(gx, 0, gz, GARAGE_LEN, GARAGE_H, GARAGE_DEPTH));

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

  // garage face: 3 ribbed bays (middle one open) + canopy + welcome cloth.
  // f-FKQOEO-1ceE-060 ribs/cabinets/pillar stripe; f-FKQOEO-1ceE-205 open bay + shelving + numbered pier; f-aICKIbuo8zQ-030/-055/-115 canopy + banner.
  const doorMat = mat.painted(PAL.concreteDark, 0.6, 0.05);
  const bayW = 2.0, bayH = GARAGE_H * 0.7, bayGap = 0.4, OPEN_BAY = 1;
  const bayX = (d: number): number => gx - GARAGE_LEN / 2 + 0.45 + bayW / 2 + d * (bayW + bayGap);
  const ribs = inst(unit, mat.painted(PAL.concrete, 0.7, 0), 10);
  let bi = 0;
  for (let d = 0; d < GARAGE_BAYS; d++) {
    const dxp = bayX(d);
    if (d === OPEN_BAY) {
      g.add(box(bayW, bayH, 0.06, mat.windowDark, dxp, bayH / 2, frontZ + OUT * 0.02));
      g.add(box(bayW - 0.3, 0.06, 0.3, mat.timberDark, dxp, 1.05, frontZ + OUT * 0.14));
      g.add(box(bayW - 0.3, 0.06, 0.3, mat.timberDark, dxp, 1.62, frontZ + OUT * 0.14));
      g.add(box(0.5, 0.35, 0.28, mat.painted(PAL.pavingWarm, 0.9, 0), dxp - 0.55, 1.28, frontZ + OUT * 0.14));
      g.add(box(0.45, 0.3, 0.28, mat.painted(PAL.trailerTrim, 0.7, 0), dxp + 0.55, 1.25, frontZ + OUT * 0.14));
    } else {
      g.add(box(bayW, bayH, 0.1, doorMat, dxp, bayH / 2, frontZ));
      for (let r = 0; r < 5; r++) {
        ribs.setMatrixAt(bi++, m4.compose(v.set(dxp, bayH * ((r + 0.5) / 5), frontZ + OUT * 0.055), NOROT, sc.set(bayW - 0.1, 0.05, 0.04)));
      }
    }
  }
  g.add(ribs);
  // flat canopy slab on slim columns; pale painted() stands in for glazing (wants glass later).
  g.add(box(GARAGE_LEN + 0.8, 0.12, 3.2, mat.painted(PAL.glass, 0.35, 0.1), gx, GARAGE_H - 0.35, frontZ + OUT * 2.1));
  for (const cx of [gx - GARAGE_LEN / 2 - 0.2, gx + GARAGE_LEN / 2 + 0.2]) {
    put(0.14, GARAGE_H - 0.41, 0.14, mat.steel, cx, (GARAGE_H - 0.41) / 2, frontZ + OUT * 3.5, true);
  }
  g.add(box(3.6, 0.6, 0.05, mat.signText({ text: 'Hail, wayfarer! Tour the homes of tomorrow', color: PAL.signMaroon, background: PAL.houseCream, aspect: 6 }), gx, 2.9, frontZ + OUT * 3.68));
  const pierX = bayX(OPEN_BAY) + (bayW + bayGap) / 2;
  g.add(box(0.34, 0.45, 0.05, mat.signText({ text: '13', color: PAL.signMaroon, background: PAL.houseCream, aspect: 0.75 }), pierX, 1.7, frontZ + OUT * 0.06));
  // one 0.4 m band + pinstripe + plaque on the numbered pier ONLY (f-FKQOEO-1ceE-060, f-FKQOEO-1ceE-190) — nowhere else in this house.
  g.add(box(0.46, 0.4, 0.04, mat.painted(PAL.terracotta, 0.8, 0), pierX, 2.52, frontZ + OUT * 0.05));
  g.add(box(0.46, 0.05, 0.04, mat.painted(PAL.hazardYellow, 0.6, 0), pierX, 2.76, frontZ + OUT * 0.05));
  g.add(box(0.4, 0.24, 0.03, mat.signText({ text: 'Wash bay — leave it tidy', color: PAL.signTeal, background: PAL.houseCream, aspect: 1.7 }), pierX, 1.02, frontZ + OUT * 0.05));
  put(0.6, 1.9, 1.1, mat.steel, gx - GARAGE_LEN / 2 - 0.35, 0.95, gz - 1.4, true);
  put(0.6, 1.9, 1.1, mat.steel, gx - GARAGE_LEN / 2 - 0.35, 0.95, gz + 1.4, true);

  // every timberDark post and the garage service door share one InstancedMesh
  const postRows: Row[] = [[1.0, 2.1, 0.1, gx + GARAGE_LEN / 2 - 1.35, 1.05, frontZ, 0]];

  // -------------------------------------------------- porch canopy (cantilevered eave)
  const canZ = frontZ + OUT * (CANOPY_OUT / 2 - 0.06);
  g.add(box(CANOPY_LEN, 0.22, CANOPY_OUT + 0.12, mat.roofWhite,
    porchX, CANOPY_Y - 0.11, canZ));
  g.add(box(CANOPY_LEN, 0.36, 0.12, mat.roofWhite,
    porchX, CANOPY_Y - 0.18, frontZ + OUT * CANOPY_OUT));

  // NT04: the eave cantilevers over a CONCRETE DECK, not bare lawn. ground.ts tops
  // the lawn plateau at KERB_HEIGHT + 0.001, so the slab rises from y=0 and stands
  // proud of it; its collider gives the player a step, well inside STEP_UP.
  const pdW = CANOPY_LEN + 1.2;
  const pdZ = frontZ + OUT * (CANOPY_OUT / 2 - 0.15);
  g.add(slab(pdW, DECK_T, CANOPY_OUT, mat.concrete, porchX, 0, pdZ));
  colliders.push(aabbSlab(porchX, 0, pdZ, pdW, DECK_T, CANOPY_OUT));

  // -------------------------------------------------- rear deck at upper-floor level
  const dX = H.deckX;
  const dOut = backZ + S * DECK_OUT;
  const dCz = backZ + S * (DECK_OUT / 2 - 0.05);
  g.add(box(DECK_LEN, 0.18, DECK_OUT + 0.1, mat.deckBoards, dX, DECK_Y - 0.09, dCz));
  colliders.push(aabb(dX, DECK_Y - 0.09, dCz, DECK_LEN, 0.18, DECK_OUT + 0.1));
  const dL = dX - DECK_LEN / 2, dR = dX + DECK_LEN / 2;
  for (const px of [dL + 0.3, dX - STAIR_W / 2 - 0.2, dX + STAIR_W / 2 + 0.2, dR - 0.3]) {
    postRows.push([0.2, DECK_Y - 0.18, 0.2, px, (DECK_Y - 0.18) / 2, dOut + OUT * 0.18, 0]);
  }

  // NT03: the flight leaves the OUTER edge at its centre and runs yard-ward (S),
  // landing on the yards.ts patio disc (centre deckX, offset DECK_OUT + pr*1.12).
  // Chosen over reversing along x: an x-run foot lands metres off the disc by the
  // side fence, while the yard-ward run drops onto it. Gap + newels serve the stair.
  const runs: [number, number, number, number][] = [
    [dL, dOut, dX - STAIR_W / 2, dOut],
    [dX + STAIR_W / 2, dOut, dR, dOut],
    [dR, dOut, dR, backZ],
    [dL, backZ, dL, dOut],
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
    for (let k = 0; k <= n; k++) {
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
  for (const [nx, nz] of [[dL, dOut], [dR, dOut], [dR, backZ], [dL, backZ],
    [dX - STAIR_W / 2, dOut], [dX + STAIR_W / 2, dOut]] as P2[]) {
    postRows.push([0.14, RAIL_H + 0.1, 0.14, nx, DECK_Y + (RAIL_H + 0.1) / 2, nz, 0]);
  }

  // -------------------------------------------------- exterior timber stair
  // Yard-ward flight from the deck-edge gap: the foot (z = dOut + S*run) lands
  // ~1 m past the patio centre, inside its radius. Treads finish on the disc;
  // stringer/handrail slope signs derive from S, never a bare sign.
  const runL = STEPS * 0.28, topZ = dOut, botZ = dOut + S * runL;
  const footY = 0.2, yAt = (t: number): number => DECK_Y + (footY - DECK_Y) * t;
  const slopeA = Math.atan2(DECK_Y - footY, runL);
  const treads = inst(new THREE.BoxGeometry(STAIR_W - 0.12, 0.07, 0.34),
    mat.deckBoards, STEPS);
  for (let i = 0; i < STEPS; i++) {
    treads.setMatrixAt(i, m4.compose(
      v.set(dX, yAt((i + 1) / STEPS) + 0.035, topZ + S * (i + 0.5) * 0.28),
      NOROT, sc.set(1, 1, 1)));
  }
  g.add(treads);
  const railM = mat.painted(PAL.timber, 0.88, 0);
  for (const sx of [dX - (STAIR_W / 2 - 0.05), dX + (STAIR_W / 2 - 0.05)]) {
    const st = box(0.1, 0.34, Math.hypot(runL, DECK_Y - footY) + 0.3,
      mat.timberDark, sx, (DECK_Y + footY) / 2 - 0.1, (topZ + botZ) / 2);
    st.rotation.x = S * slopeA;
    g.add(st);
    const hr = box(0.08, 0.08, Math.hypot(runL, DECK_Y - footY) + 0.2,
      railM, sx + Math.sign(sx - dX) * 0.05, (DECK_Y + footY) / 2 + RAIL_H, (topZ + botZ) / 2);
    hr.rotation.x = S * slopeA;
    g.add(hr);
  }
  for (const t of [0.08, 0.5, 0.92]) {
    for (const sx of [dX - STAIR_W / 2, dX + STAIR_W / 2]) {
      postRows.push([0.07, RAIL_H, 0.07, sx, yAt(t) + RAIL_H / 2, topZ + (botZ - topZ) * t, 0]);
    }
  }
  emit(postRows, mat.timberDark, true);
  // Only the low foot of the flight is solid: the traverse east-west corridor
  // crosses UNDER the high part, so a collider may only cover the run where the
  // soffit yAt drops below ~2.0 m headroom (eye 1.68 + margin). Each third is
  // clipped to that line; the upper thirds emit nothing and stay walk-under.
  const tHead = (DECK_Y - 2.0) / (DECK_Y - footY);
  for (let i = 0; i < 3; i++) {
    const t0 = Math.max(i / 3, tHead), t1 = (i + 1) / 3;
    if (t0 >= t1) continue;
    const za = topZ + (botZ - topZ) * t0, zb = topZ + (botZ - topZ) * t1;
    colliders.push(aabb(dX, yAt(t0) / 2, (za + zb) / 2, STAIR_W, yAt(t0), Math.abs(zb - za)));
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
