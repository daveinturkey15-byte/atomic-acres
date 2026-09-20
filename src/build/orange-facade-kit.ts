/**
 * ORANGE FACADE KIT - additive dressing for the ORANGE house exterior.
 *
 * Lane: muse-facade-final-envelope-0652 (repair slot 2 of 0636). CPU/source only; root runs all renders.
 * Drop-in path (via patch/adoption.patch): src/build/orange-facade-kit.ts.
 * Opt-in (?facade-kit=canary): baseline registry untouched without the flag.
 *
 * ROUTE (per ai-3d-asset-generation-loop): code-only procedural overlay.
 * Architecture with layout-derived openings/colliders loses to image-to-3D
 * on every axis that matters here: a generated mesh invents hidden geometry,
 * has no opening schedule, no honest colliders, and cannot be verified
 * CPU-only. The Blender recipe in recipe/ stays the editable profile source
 * for future bevel refinement; adoption runs this file, not a GLB.
 *
 * WHAT IT ADDS (before-spawnA.png reads: panes pasted on, flat cills,
 * door a glowing hole, cream plinth raw, terracotta band unpanelled):
 *   1. Shadow-bead reveal liners (windowDark) inside every ground-floor
 *      aperture - actual depth read against the pane, zero opening narrowing.
 *   2. Two-piece sills: nosing with drip + apron board in rescaled cream.
 *   3. Door surrounds + hardware: pull bar, hinges, kick plate, recess bead.
 *      All hardware lives inside the door leaf; clear width untouched.
 *   4. Terracotta panel joints at a layout-derived pitch (NT04 panelised read).
 *   5. Plinth scoring: staggered recess grooves on the street/yard skirts.
 *
 * WHAT IT DOES NOT TOUCH (other lanes / existing builders):
 *   - No wallRun, no subtract, no openings pushed, no colliders emitted.
 *   - No roof sweep, garage bays/door, deck, stair, interior, white house.
 *   - No fascia/drip on the swept eave and no louvre vents: those are owned
 *     by src/build/facade-detail-canary.ts. This kit stops 75 mm short of
 *     every canary envelope; the boundary is asserted in check-facade-kit.mjs.
 *   - No new materials: 4 ctx.mat singletons only (cream, windowDark,
 *     concrete, steel). No `new THREE.Material`, no Math.random.
 *
 * OWNERSHIP / batchStatic: this group owns every BufferGeometry it mounts
 * (own unit box; never shares orange-house's unit box). disposeFacadeKit()
 * disposes owned geometries only, never ctx.mat singletons. The kit batches
 * independently under tag 'orange-facade-kit'; orange-house's
 * batchStatic('orange-house') cannot dispose our masters because it never
 * sees them (separate group), and ours cannot dispose its.
 *
 * OPENING SCHEDULE: orange-house.ts does not export its hole list, so the
 * per-window dressing mirrors its holesAround() inputs (M_* block below).
 * checks/check-facade-kit.mjs parses src/build/orange-house.ts and fails if
 * those literals drift. The durable fix (option B in patch/) is a one-line
 * export of the schedule from the root builder; until then the mirror plus
 * static check is the adoption handle.
 */
import * as THREE from 'three';
import {
  CANOPY_LEN, CANOPY_Y, EAVE_Y, FLOOR_H, HOUSE_DEPTH, HOUSE_HALF_LEN,
  ORANGE, UPPER_H,
} from '../core/layout';
import { PAL } from '../core/palette';
import { group, type Builder, type BuildResult } from '../core/kit';

// ---------------------------------------------------------------- frame (derivation verbatim from orange-house.ts)
const H = ORANGE;
const S = H.side;                 // -1 : the back yard lies at -z
const OUT = -S;                   // +1 : outward, toward the street
const GE = H.garageEnd;           // garage end in x
const FE = -GE;                   // free (deck / porch) end in x
const HHL = HOUSE_HALF_LEN;
const frontZ = H.frontZ;
const backZ = H.backZ;

// MIRROR of orange-house.ts ground-floor aperture inputs (see header).
// check-facade-kit.mjs asserts literal equality with the root builder.
const M_DOOR_W = 1.5, M_DOOR_HEAD = 2.35;
const M_WIN_W = 2.1, M_WIN_SILL = 0.95, M_WIN_HEAD = 2.45;
const M_MARGIN = 0.55, M_PIER = 0.75;
const M_WALL_T = 0.28;
const M_FRAME_W = 0.11;
const RECESS = HOUSE_DEPTH * 0.06;
const GND_FRONT = frontZ + S * RECESS;

const BAND_SILL = FLOOR_H + UPPER_H * 0.18;
const BAND_HEAD = EAVE_Y - UPPER_H * 0.21;
const UP = new THREE.Vector3(0, 1, 0);

type Row = [number, number, number, number, number, number, number];
interface Hole { c: number; w: number; sill: number; head: number }

/** Verbatim mirror of holesAround() in orange-house.ts (see header). */
function mirroredHoles(doorC: number): Hole[] {
  const out: Hole[] = [{ c: doorC, w: M_DOOR_W, sill: 0, head: M_DOOR_HEAD }];
  for (const dir of [-1, 1] as const) {
    const from = doorC + dir * (M_DOOR_W / 2 + M_PIER);
    const to = dir < 0 ? -HHL + M_MARGIN : HHL - M_MARGIN;
    const run = Math.abs(to - from);
    const n = Math.floor((run + M_PIER) / (M_WIN_W + M_PIER));
    for (let i = 0; i < n; i++) {
      const used = n * M_WIN_W + (n - 1) * M_PIER;
      const start = from + dir * (run - used) / 2;
      out.push({
        c: start + dir * (M_WIN_W / 2 + i * (M_WIN_W + M_PIER)),
        w: M_WIN_W, sill: M_WIN_SILL, head: M_WIN_HEAD,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- owned geometry
/** Owned unit box for THIS kit only. Never shared with orange-house. */
let ownedUnit: THREE.BoxGeometry | null = null;
const ownedProfiles: THREE.BufferGeometry[] = [];

/**
 * Release kit-owned GPU resources. Idempotent. Never touches ctx.mat
 * singletons or any geometry outside this kit's group.
 */
export function disposeFacadeKit(): void {
  for (const g of ownedProfiles) { try { g.dispose(); } catch { /* noop */ } }
  ownedProfiles.length = 0;
  if (ownedUnit) { try { ownedUnit.dispose(); } catch { /* noop */ } ownedUnit = null; }
}

// ---------------------------------------------------------------- kit
export const FACADE_KIT_MATERIALS = 4 as const;
/** Worst-case static triangle budget (measured by checks/, not asserted here). */
export const FACADE_KIT_TRI_BUDGET = 15000 as const;
/** Dressing never stands prouder than this (m); canary contract parity. */
export const FACADE_KIT_MAX_PROUD = 0.075 as const;
export const FACADE_KIT_COLLIDERS = 0 as const;

export const buildOrangeFacadeKit: Builder = (ctx) => {
  const g = group('orange-facade-kit');
  const mat = ctx.mat;
  const cream = mat.painted(PAL.houseCream, 0.6, 0.05);
  const bead = mat.windowDark;
  const stone = mat.concrete;
  const steelM = mat.steel;

  if (!ownedUnit) ownedUnit = new THREE.BoxGeometry(1, 1, 1);
  const unitBox = ownedUnit;
  const creamRows: Row[] = [];
  const beadRows: Row[] = [];
  const stoneRows: Row[] = [];
  const steelRows: Row[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  const emit = (rows: Row[], m: THREE.Material, shadow: boolean): void => {
    if (!rows.length) return;
    const im = new THREE.InstancedMesh(unitBox, m, rows.length);
    im.castShadow = shadow;
    im.receiveShadow = true;
    rows.forEach((r, i) => im.setMatrixAt(i, m4.compose(
      v.set(r[3], r[4], r[5]), q.setFromAxisAngle(UP, r[6]), sc.set(r[0], r[1], r[2]))));
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  };

  // -------------------------------------------------- per-aperture dressing
  // Street + yard faces. End walls carry builder-owned leaves the kit must
  // not re-frame, so end-wall dressing is a later lane, not this one.
  const faces = [
    { along: 'x' as const, fixed: GND_FRONT + S * M_WALL_T / 2, out: OUT, doorC: H.frontDoorX },
    { along: 'x' as const, fixed: backZ + OUT * M_WALL_T / 2, out: S, doorC: H.backDoorX },
  ];
  const at = (rows: Row[], along: 'x' | 'z', u: number, y: number, n: number,
    w: number, t: number, d: number): void => {
    rows.push(along === 'x' ? [w, t, d, u, y, n, 0] : [w, t, d, n, y, u, Math.PI / 2]);
  };

  for (const f of faces) {
    const faceN = f.fixed + f.out * M_WALL_T / 2;
    for (const o of mirroredHoles(f.doorC)) {
      const isDoor = o.sill < 0.05;
      const cy = (o.sill + o.head) / 2;
      const hh = o.head - o.sill;
      // Shadow bead: 20 mm dark perimeter INSIDE the existing reveal, laid on
      // jamb faces the builder already emits. Clear width/height unchanged.
      const beadN = faceN + f.out * 0.012;
      const pw = o.w + 2 * M_FRAME_W - 0.02;
      at(beadRows, f.along, o.c, o.head - 0.01, beadN, pw, 0.025, 0.02);
      for (const s of [-1, 1]) {
        at(beadRows, f.along, o.c + s * (o.w / 2 + M_FRAME_W - 0.035), cy, beadN,
          0.025, hh, 0.02);
      }
      if (isDoor) {
        // Door surround: 90 mm architrave standing 30 mm proud (<=75 mm cap).
        const archN = faceN + f.out * 0.015;
        at(creamRows, f.along, o.c, o.head + 0.045, archN, o.w + 0.3, 0.09, 0.06);
        for (const s of [-1, 1]) {
          at(creamRows, f.along, o.c + s * (o.w / 2 + 0.075), o.head / 2, archN,
            0.09, o.head, 0.06);
        }
        // Hardware INSIDE the leaf plane: pull bar + standoffs, 3 hinges,
        // kick plate. Nothing enters the door apron volume.
        const leafN = faceN - f.out * 0.02;
        const hx = o.c + (o.w / 2 - 0.18);
        at(steelRows, f.along, hx, 1.15, leafN + f.out * 0.045, 0.035, 1.1, 0.035);
        for (const hy of [0.65, 1.15, 1.65]) {
          at(steelRows, f.along, hx, hy, leafN + f.out * 0.022, 0.03, 0.05, 0.045);
        }
        for (const hy of [0.35, 1.15, 1.95]) {
          at(steelRows, f.along, o.c - (o.w / 2 - 0.02), hy, leafN, 0.02, 0.12, 0.02);
        }
        at(steelRows, f.along, o.c, 0.15, leafN + f.out * 0.005, o.w - 0.1, 0.25, 0.01);
        at(beadRows, f.along, o.c, o.head + 0.1, archN + f.out * 0.02, o.w + 0.3, 0.02, 0.065);
        continue;
      }
      // Two-piece sill: sloped weathering (concrete) + nosing + apron (cream).
      // Repair slot 2 (final envelope): nosing/apron embedded so outer faces
      // read <=0.070 m proud against the SAME 0.075 m lane cap (5 mm float
      // margin). Stone nosing 120 mm deep centred +10 mm proud (outer +70,
      // inner -50 embedded); cream apron 120 mm deep centred +5 mm proud
      // (outer +65, stepped 5 mm shy of the nosing). Y extents unchanged and
      // still below the window sill line: clear zones untouched.
      const sillY = o.sill;
      const stoneN = faceN + f.out * 0.01;
      const apronN = faceN + f.out * 0.005;
      at(stoneRows, f.along, o.c, sillY - 0.015, stoneN, o.w + 2 * M_FRAME_W + 0.04, 0.05, 0.12);
      at(creamRows, f.along, o.c, sillY - 0.055, apronN, o.w + 2 * M_FRAME_W + 0.06, 0.045, 0.12);
      at(beadRows, f.along, o.c, sillY - 0.08, faceN + f.out * 0.055,
        o.w + 2 * M_FRAME_W + 0.02, 0.015, 0.02);
      at(creamRows, f.along, o.c, sillY - 0.16, faceN + f.out * 0.01,
        o.w + 0.1, 0.1, 0.03);
    }
  }

  // -------------------------------------------------- terracotta panel joints
  // NT04 panelised read. Fixed pitch from layout (HHL/2 ~= 3.2 m bays),
  // 15 mm recess beads FLUSH with the wall face (proud 0): joint shadow
  // with no collider and no silhouette change. Yard cadence is the
  // point-reflection of the street cadence (rotational pair, never mirror).
  {
    const bandZ = frontZ + OUT * M_WALL_T / 2;
    const bandCy = (BAND_SILL + BAND_HEAD) / 2;
    const bandH = BAND_HEAD - BAND_SILL;
    const pitch = HHL / 2;
    for (let i = -2; i <= 2; i++) {
      const x = i * pitch;
      if (Math.abs(x) > HHL - 0.6) continue;
      beadRows.push([0.03, bandH - 0.1, 0.02, x, bandCy, bandZ + OUT * 0.005, 0]);
    }
    const yardZ = backZ + S * M_WALL_T / 2;
    for (let i = -2; i <= 2; i++) {
      const x = -i * pitch;
      if (Math.abs(x) > HHL - 0.6) continue;
      beadRows.push([0.03, bandH - 0.1, 0.02, x, bandCy, yardZ + S * 0.005, 0]);
    }
  }

  // -------------------------------------------------- plinth scoring
  // Staggered 20 mm recess grooves across the skirt bands the builder already
  // emits. Grooves sit ON the skirt face: visual scoring of the veneer
  // without moving its collider line. Plus a cap shadow course split into the
  // same segments. Both break +-0.85 m around every door, exactly where the
  // builder's own skirt breaks: dressing a surface that is not there would
  // float trim across the doorway void.
  {
    const skirtFaces = [
      { z: GND_FRONT + OUT * 0.05, out: OUT, doorC: H.frontDoorX },
      { z: backZ + S * 0.05, out: S, doorC: H.backDoorX },
    ];
    const DOOR_BREAK = 0.85;
    for (const sf of skirtFaces) {
      const n = Math.floor((HHL * 2) / 0.8);
      for (let i = 0; i <= n; i++) {
        const x = -HHL + (i + (i % 2 ? 0.5 : 0)) * 0.8;
        if (Math.abs(x) > HHL - 0.2) continue;
        if (Math.abs(x - sf.doorC) < DOOR_BREAK) continue;
        beadRows.push([0.025, 0.3, 0.02, x, 0.2, sf.z + sf.out * 0.045, 0]);
      }
      let segs: Array<[number, number]> = [[-HHL + 0.2, HHL - 0.2]];
      const cut: [number, number] = [sf.doorC - DOOR_BREAK, sf.doorC + DOOR_BREAK];
      const next: Array<[number, number]> = [];
      for (const [a, b] of segs) {
        if (cut[1] <= a || cut[0] >= b) { next.push([a, b]); continue; }
        if (cut[0] > a + 0.4) next.push([a, cut[0]]);
        if (cut[1] < b - 0.4) next.push([cut[1], b]);
      }
      segs = next;
      for (const [a, b] of segs) {
        beadRows.push([b - a, 0.02, 0.02, (a + b) / 2, 0.43, sf.z + sf.out * 0.05, 0]);
      }
    }
  }

  // Porch-canopy bed mould: 60x60 mm cream bed where the canopy slab meets
  // the street wall. Stops short of the garage return (canary envelope).
  creamRows.push([CANOPY_LEN, 0.06, 0.06, H.frontDoorX, CANOPY_Y - 0.03, GND_FRONT + OUT * 0.03, 0]);

  emit(creamRows, cream, true);
  emit(beadRows, bead, false);
  emit(stoneRows, stone, true);
  emit(steelRows, steelM, false);

  // Batchable by construction: opaque singletons, float32 unit box, no
  // instanceColor, no mirrors, no children on dressed meshes. Root invokes
  // batchStatic(g, 'orange-facade-kit') after adoption, never inside a builder.
  return { group: g, colliders: [] } satisfies BuildResult;
};

/**
 * Gated adoption wrapper: a throw inside the kit never takes the baseline
 * house with it. Baseline renders exactly as today when the gate is off.
 */
export const buildOrangeFacadeKitGated: Builder = (ctx) => {
  try {
    return buildOrangeFacadeKit(ctx);
  } catch (err) {
    console.warn('[orange-facade-kit] fallback to baseline:', err);
    return { group: group('orange-facade-kit-fallback'), colliders: [] } satisfies BuildResult;
  }
};

/** Facade-kit canary opt-in: ?facade-kit=canary. Mirrors the detail-canary shape. */
export function isOrangeFacadeKitOptIn(): boolean {
  const g = globalThis as { __NT_OVERRIDE_FACADE_KIT__?: boolean };
  if (typeof g.__NT_OVERRIDE_FACADE_KIT__ === 'boolean') return g.__NT_OVERRIDE_FACADE_KIT__;
  if (typeof window !== 'undefined' && window.location?.search) {
    const v = new URLSearchParams(window.location.search).get('facade-kit')?.toLowerCase();
    return v === 'canary';
  }
  return false;
}
