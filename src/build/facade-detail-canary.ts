/**
 * FACADE DETAIL CANARY - additive dressing for BOTH houses. Owned lane file.
 *
 * What it adds (and why the root builders lack it - see docs/facade-detail-canary.md):
 *   ORANGE  roof fascia + drip strips on the swept eave (the roof is a bare 0.32
 *           extrude edge), a concrete base plinth (walls met the lawn raw), and
 *           recessed-look louvre vents over the garage bays + in the upper GE spandrel.
 *   WHITE   fascia rings round both capsule roof prisms (bare prism rims today) and
 *           recessed-look louvre vents over the garage bays + on the entry capsule.
 *
 * Contract: imports only three, core/layout and core/kit TYPES. No new material
 * (ctx.mat singletons only), no lights, NO colliders, no ctx.rand (constant-derived,
 * deterministic), doors/windows/transparency untouched, everything flush-or-proud
 * dressing inside the existing envelopes: nothing stands prouder than 75 mm and no
 * opening is narrowed. Batching: 8 InstancedMeshes off one unit box.
 */
import * as THREE from 'three';
import {
  HOUSE_HALF_LEN, HOUSE_DEPTH, FLOOR_H, UPPER_H, EAVE_Y, GARAGE_LEN, GARAGE_DEPTH,
  GARAGE_BAYS, CANOPY_OUT, ORANGE, WHITE, DOOR_APRON_HALF_W,
} from '../core/layout';
import type { Builder } from '../core/kit';

// ---------------------------------------------------------------- shared dims
const HHL = HOUSE_HALF_LEN;
const HD = HOUSE_DEPTH;
const BAY_W = 2.4;
const BAY_JAMB = (GARAGE_LEN - GARAGE_BAYS * BAY_W) / (GARAGE_BAYS + 1);
const BAY_PITCH = BAY_W + BAY_JAMB;            // bay centre offset either side of garageX
const PLINTH_H = 0.5;                          // skirt band, y 0 -> 0.5 (below every sill)
const SKIRT_T = 0.12;                          // 60 mm proud of the wall face
const VENT_Y = 2.95;                           // over a bay: head 2.30 < 2.64 < 3.65
const VENT_W = 1.7, VENT_H = 0.62;
const SLATS = 5, SLAT_TILT = 0.6;              // radians, about the wall-parallel axis

const UP = new THREE.Vector3(0, 1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const v2 = new THREE.Vector3();
const E = new THREE.Euler();

/** [lo,hi] minus sorted cut intervals - same convention as the root builders. */
function subtract(lo: number, hi: number, cuts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let cur = lo;
  for (const [a, b] of cuts.sort((p, r) => p[0] - r[0])) {
    if (a > cur) out.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
    if (cur >= hi) return out;
  }
  if (cur < hi) out.push([cur, hi]);
  return out;
}

/** One instanced batch per material. Rows carry full box dims + orientation. */
class Batch {
  rows: number[][] = [];
  constructor(private geo: THREE.BufferGeometry) {}
  /** axis-aligned box, optional tilt (radians) about world x ('x') or world z ('z') */
  add(w: number, h: number, d: number, x: number, y: number, z: number,
      tilt = 0, axis: 'x' | 'z' = 'x'): void {
    this.rows.push([w, h, d, x, y, z, tilt, axis === 'x' ? 0 : 1]);
  }
  /** box with an arbitrary orientation (fascia follows the swept eave) */
  addOriented(w: number, h: number, d: number, pos: THREE.Vector3,
              quat: THREE.Quaternion): void {
    this.rows.push([w, h, d, pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w, 2]);
  }
  emit(mat: THREE.Material): THREE.InstancedMesh | null {
    if (this.rows.length === 0) return null;
    const im = new THREE.InstancedMesh(this.geo, mat, this.rows.length);
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (r[10] === 2) {
        m4.compose(v.set(r[3], r[4], r[5]),
          q.set(r[6], r[7], r[8], r[9]), v2.set(r[0], r[1], r[2]));
      } else {
        q.setFromEuler(E.set(r[6], 0, r[7] === 1 ? r[6] : 0));
        if (r[7] === 1) q.setFromEuler(E.set(0, 0, r[6]));
        m4.compose(v.set(r[3], r[4], r[5]), q, v2.set(r[0], r[1], r[2]));
      }
      im.setMatrixAt(i, m4);
    }
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    return im;
  }
}

/** Louvre vent unit: dark 12 mm backing panel + n tilted slats riding at 45 mm.
 * `along` is the wall run direction; `out` is the outward sign of `face`. */
function louvre(vb: Batch, lb: Batch, along: 'x' | 'z', face: number, out: number,
                u: number, y: number, w: number, h: number, n: number): void {
  const y0 = y - h / 2 + 0.09, dy = (h - 0.18) / (n - 1);
  if (along === 'x') {
    vb.add(w, h, 0.012, u, y, face + out * 0.006);
    for (let i = 0; i < n; i++) {
      lb.add(w - 0.08, 0.035, 0.075, u, y0 + i * dy, face + out * 0.045, SLAT_TILT, 'x');
    }
  } else {
    vb.add(0.012, h, w, face + out * 0.006, y, u);
    for (let i = 0; i < n; i++) {
      lb.add(0.075, 0.035, w - 0.08, face + out * 0.045, y0 + i * dy, u, SLAT_TILT, 'z');
    }
  }
}

export const buildFacadeDetailCanary: Builder = (ctx) => {
  const g = new THREE.Group();
  g.name = 'facade-detail-canary';
  const geo = new THREE.BoxGeometry(1, 1, 1);

  const of = new Batch(geo);   // orange fascia   (roofWhite)
  const od = new Batch(geo);   // orange drip     (steel)
  const os = new Batch(geo);   // orange skirt    (concrete)
  const ov = new Batch(geo);   // orange vents    (windowDark)
  const ol = new Batch(geo);   // orange slats    (steel)
  const wf = new Batch(geo);   // white rings     (capsuleWhite)
  const wv = new Batch(geo);   // white vents     (windowDark)
  const wl = new Batch(geo);   // white slats     (steel)

  // ================================================================ ORANGE
  {
    const H = ORANGE, S = H.side, OUT = -S, GE = H.garageEnd, FE = -GE;
    const frontZ = H.frontZ, backZ = H.backZ, midZ = (frontZ + backZ) / 2;
    // sweep constants mirrored from orange-house.ts (private there, derived here
    // from the same layout.ts inputs - a re-proportion moves both together)
    const ROOF_T = 0.32, ROOF_RISE = UPPER_H * 0.78, ROOF_OVER = HD * 0.125;
    const CANTI = CANOPY_OUT * 1.1, TILT = 0.34, RHALF = HD / 2 + ROOF_OVER;
    const HI_X = GE * (HHL + CANTI), LO_X = FE * (HHL + ROOF_OVER);
    const TK = (-TILT * OUT) / RHALF;              // roof fall across depth
    const baseY = (x: number): number => {
      const u = Math.min(1, Math.max(0, (x - LO_X) / (HI_X - LO_X)));
      return EAVE_Y + ROOF_T + ROOF_RISE * Math.pow(u, 1.6);
    };
    const topY = (x: number, z: number): number => baseY(x) + TK * (z - midZ);
    const slopeAt = (x: number): number => {
      const e = 0.25;
      return (baseY(x + e) - baseY(x - e)) / (2 * e);
    };
    const eaveQuat = (slope: number): THREE.Quaternion =>
      q.setFromUnitVectors(UP, v.set(-slope, 1, -TK).normalize());

    // ---- eave fascia: street + yard edges, 16 boards each, sheared to the sweep
    for (const edge of [1, -1] as const) {          // 1 = street side, -1 = yard side
      const zE = midZ + edge * OUT * RHALF;
      const N = 16, len = (LO_X - HI_X) / N;
      for (let i = 0; i < N; i++) {
        const x = HI_X + len * (i + 0.5);
        const y = topY(x, zE) - ROOF_T / 2;
        eaveQuat(slopeAt(x));
        of.addOriented(len + 0.03, 0.5, 0.1, v2.set(x, y, zE + edge * OUT * 0.025), q);
        // drip strip under the board lip, projecting a little further out
        v2.set(x, y, zE + edge * OUT * 0.025)
          .add(v.set(0, -0.24, edge * OUT * 0.02).applyQuaternion(q));
        od.addOriented(len + 0.03, 0.05, 0.16, v2, q);
      }
    }
    // ---- end returns: cantilever tip (HI) and low sweep end (LO)
    for (const xE of [HI_X, LO_X]) {
      eaveQuat(slopeAt(xE));
      for (let i = 0; i < 4; i++) {
        const zc = midZ - 6.6 + 3.3 * (i + 0.5);
        of.addOriented(0.1, 0.5, 3.34,
          v2.set(xE + GE * 0.025, topY(xE, zc) - ROOF_T / 2, zc), q);
      }
    }

    // ---- base plinth (concrete), broken at every door and bay mouth
    const skirtRun = (axis: 'x' | 'z', fixed: number, a: number, b: number): void => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (hi - lo < 0.4) return;                     // no pointless slivers between mouths
      if (axis === 'x') os.add(hi - lo, PLINTH_H, SKIRT_T, (a + b) / 2, PLINTH_H / 2, fixed);
      else os.add(SKIRT_T, PLINTH_H, hi - lo, fixed, PLINTH_H / 2, (a + b) / 2);
    };
    const IN = 0.06;                               // proud offset
    // yard face, broken across the full keep-clear apron of the back door
    for (const [a, b] of subtract(-HHL, HHL,
      [[H.backDoorX - DOOR_APRON_HALF_W, H.backDoorX + DOOR_APRON_HALF_W]])) {
      skirtRun('x', backZ + S * IN, a, b);
    }
    // free-end face (full); garage-end face only where it shows past the wing
    skirtRun('z', FE * (HHL + IN), backZ, frontZ);
    skirtRun('z', GE * (HHL + IN), backZ, frontZ + S * GARAGE_DEPTH);
    // recessed street face of the ground floor, broken at the front door
    // (street-outward is -S, as for the louvres below)
    const GND = frontZ + S * (HD * 0.06) - S * IN;
    for (const [a, b] of subtract(-HHL, HHL,
      [[H.frontDoorX - DOOR_APRON_HALF_W, H.frontDoorX + DOOR_APRON_HALF_W]])) {
      skirtRun('x', GND, a, b);
    }
    // garage wing: street face between bay mouths, its outer end, its yard face
    const lo0 = Math.min(GE * HHL, GE * (HHL + GARAGE_LEN));
    const hi0 = Math.max(GE * HHL, GE * (HHL + GARAGE_LEN));
    const bays = [0, 1].map((k) => H.garageX + (k - (GARAGE_BAYS - 1) / 2) * BAY_PITCH);
    for (const [a, b] of subtract(lo0, hi0,
      bays.map((c) => [c - DOOR_APRON_HALF_W, c + DOOR_APRON_HALF_W] as [number, number]))) {
      skirtRun('x', frontZ - S * IN, a, b);
    }
    skirtRun('z', (GE > 0 ? hi0 : lo0) + GE * IN, frontZ, frontZ + S * GARAGE_DEPTH);
    skirtRun('x', frontZ + S * GARAGE_DEPTH + S * IN, lo0, hi0);

    // ---- louvres over the garage bays (both), apron 2.30 -> 3.65
    for (const c of bays) louvre(ov, ol, 'x', frontZ, -S, c, VENT_Y, VENT_W, VENT_H, SLATS);
    // upper GE-end spandrel between the clerestory head (5.56) and the sheared eave
    const flat = HD / 2 - HD * 0.185 - 0.9;        // keep off the wrapped corners
    louvre(ov, ol, 'z', GE * HHL, GE, midZ - flat / 2, 5.83, 1.2, 0.45, 3);
    louvre(ov, ol, 'z', GE * HHL, GE, midZ + flat / 2, 5.83, 1.2, 0.45, 3);
  }

  // ================================================================ WHITE
  {
    const H = WHITE, S = H.side;
    const frontZ = H.frontZ, backZ = H.backZ;
    const REAR_D = HD * 0.72, FRONT_D = HD * 0.56;
    const REAR = { cx: 0, cz: backZ - S * REAR_D * 0.5, hx: HHL, hz: REAR_D * 0.5, r: REAR_D * 0.5 };
    const FRONT = { cx: -HHL * 0.12, cz: frontZ + S * FRONT_D * 0.5, hx: HHL * 0.77, hz: FRONT_D * 0.5, r: FRONT_D * 0.5 };
    const H_REAR = EAVE_Y, H_FRONT = FLOOR_H + UPPER_H * 0.38;

    // ---- fascia rings round both roof prisms (prism tops: H+0.16 / H+0.14)
    const ring = (p: typeof REAR, topP: number): void => {
      const pts: THREE.Vector2[] = [];
      const { cx, cz, hx, hz, r } = p;
      const line = (x0: number, z0: number, x1: number, z1: number): void => {
        const L = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(1, Math.round(L / 1.2));
        for (let i = 0; i < n; i++) {
          pts.push(new THREE.Vector2(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n));
        }
      };
      const arc = (ccx: number, ccz: number, a0: number, a1: number): void => {
        for (let i = 0; i < 6; i++) {
          const a = a0 + (a1 - a0) * i / 6;
          pts.push(new THREE.Vector2(ccx + Math.cos(a) * r, ccz + Math.sin(a) * r));
        }
      };
      line(cx + hx, cz - hz + r, cx + hx, cz + hz - r);
      arc(cx + hx - r, cz + hz - r, 0, Math.PI / 2);
      line(cx - hx + r, cz + hz, cx + hx - r, cz + hz);
      arc(cx - hx + r, cz + hz - r, Math.PI / 2, Math.PI);
      line(cx - hx, cz + hz - r, cx - hx, cz - hz + r);
      arc(cx - hx + r, cz - hz + r, Math.PI, Math.PI * 1.5);
      line(cx - hx + r, cz - hz, cx + hx - r, cz - hz);
      arc(cx + hx - r, cz - hz + r, Math.PI * 1.5, Math.PI * 2);
      const yC = topP - 0.15;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        v.set(dx / L, 0, dz / L);                    // along the run
        v2.set(v.z, 0, -v.x);                        // outward candidate
        if (v2.x * (a.x - cx) + v2.z * (a.y - cz) < 0) v2.multiplyScalar(-1);
        q.setFromUnitVectors(XAXIS, v);
        wf.addOriented(L + 0.05, 0.34, 0.12,
          new THREE.Vector3(a.x + v.x * (L / 2) + v2.x * 0.05, yC, a.y + v.z * (L / 2) + v2.z * 0.05), q);
      }
    };
    ring(REAR, H_REAR + 0.16);
    ring(FRONT, H_FRONT + 0.14);

    // ---- louvres over the garage bays
    for (let k = 0; k < GARAGE_BAYS; k++) {
      louvre(wv, wl, 'x', frontZ, -S, H.garageX + (k - (GARAGE_BAYS - 1) / 2) * BAY_PITCH,
        VENT_Y, VENT_W, VENT_H, SLATS);
    }
    // entry capsule's flat street-face stretch: |x-cx| <= hx-r (=[-2.56,1.02]),
    // above the entry canopy (top 3.35); centres +-1.1 keep both edges flat
    const mid = FRONT.cx;
    louvre(wv, wl, 'x', frontZ, -S, mid - 1.1, 3.85, 1.1, 0.36, 4);
    louvre(wv, wl, 'x', frontZ, -S, mid + 1.1, 3.85, 1.1, 0.36, 4);
  }

  // ---------------------------------------------------------------- emit
  const parts: [Batch, THREE.Material][] = [
    [of, ctx.mat.roofWhite], [od, ctx.mat.steel], [os, ctx.mat.concrete],
    [ov, ctx.mat.windowDark], [ol, ctx.mat.steel],
    [wf, ctx.mat.capsuleWhite], [wv, ctx.mat.windowDark], [wl, ctx.mat.steel],
  ];
  for (const [b, m] of parts) {
    const im = b.emit(m);
    if (im) g.add(im);
  }
  return { group: g, colliders: [] };
};
