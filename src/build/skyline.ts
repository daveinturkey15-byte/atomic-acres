/**
 * SKYLINE - everything beyond the playable area: the entrance-plaza pylon sign and
 * its atom finial, the retro-futurist landmarks ringed outside the fences, the
 * desert mountains and the hazy city band. This is what makes the map read as
 * NUKETOWN 2025 rather than a generic suburb.
 *
 * Seen from 40-400 m: silhouette and colour only. NOTHING here gets a collider (the
 * ground module's boundary keeps the player in) and NOTHING casts or receives a
 * shadow - it is all far outside the cascade and would only waste it.
 * References: NT05 load screen (sign, saucer, dome, needle, flags), NT03 (hypar).
 *
 * BACKDROP MATERIALS, fitted to measured capture pixels - do not "tidy" these.
 * At metalness 0 the mountains measured (205,206,204) and the city (206,207,205):
 * flat white, no blue left. The sun here is warm and strong, so the diffuse gain on
 * a distant matt surface came out (2.00, 1.30, 0.76) - it SUPPRESSES blue - and ACES
 * compresses what survives to white. So every backdrop ring is roughness 1 with high
 * metalness, which drops the diffuse lobe the warm sun rides in on and lets the
 * palette and the haze set the colour. Metalness is the aerial-perspective dial,
 * graded per ring, and it only works while the fog is dense (FogExp2): under thin
 * fog these rings go near-black at the frame EDGE, because three.js fogs on view
 * depth, not on distance to the camera.
 */
import * as THREE from 'three';
import type { Builder } from '../core/kit';
import { box, extrude, group } from '../core/kit';
import { PAL } from '../core/palette';
import {
  BOUND_X_MAX, BOUND_X_MIN, BOUND_Z, PAVEMENT_OUTER, THIRD_HOUSE_X,
} from '../core/layout';

/** half the playable footprint - every horizon ring is a multiple of this */
const MAP_R = (BOUND_X_MAX - BOUND_X_MIN) / 2;
const CITY_R = MAP_R * 3.7;
/** Three overlapping massif rings, near -> far (265 / 330 / 405 m). Kept close on
 *  purpose: the haze buries anything much beyond this, so a ring at 500 m renders
 *  as white whatever albedo it is given. The 405 m layer is meant to be nearly gone. */
const MTN_R = [MAP_R * 5.3, MAP_R * 6.6, MAP_R * 8.1];
/** mountains are sunk so no base rim shows where the ground plane ends */
const MTN_SINK = 12;

/** Behind-the-spawn landmarks. Hoisted: the perimeter filler must leave a gap in
 *  front of each, or a 7 m block at 22 m hides a 10 m saucer at 40 m entirely. */
const SAUCER_X = -BOUND_X_MAX * 0.45;
const SAUCER_Z = -(BOUND_Z + 28);
const DOME_X = BOUND_X_MAX * 0.35;
const DOME_Z = BOUND_Z + 38;
const DOME_R = 16;
/** Space needle. Far enough out that the whole tower, spire included, fits the
 *  plaza frame, and its foot sits clear of the perimeter ring's -x runs. */
const NEEDLE_X = BOUND_X_MIN - 44;
const NEEDLE_Z = BOUND_Z * 0.45;
const NEEDLE_PLINTH_R = 13.5;

// ---------------------------------------------------------------- helpers
const YAXIS = new THREE.Vector3(0, 1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** yaw-only instance transform with independent axis scale */
function mtx(x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4()
    .compose(_v.set(x, y, z), _q.setFromAxisAngle(YAXIS, ry), _s.set(sx, sy, sz));
}

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, xf: THREE.Matrix4[]) {
  const im = new THREE.InstancedMesh(geo, mat, xf.length);
  for (let i = 0; i < xf.length; i++) im.setMatrixAt(i, xf[i]);
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  return im;
}

function put(
  g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material,
  x: number, y: number, z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

/** an extruded x/y profile yawed to face +x, i.e. back down the road */
function plate(
  g: THREE.Group, pts: [number, number][], depth: number, mat: THREE.Material,
  x: number, y: number, z: number,
): void {
  const mesh = extrude(pts, depth, mat);
  mesh.rotation.y = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
}

/** n legs splayed under a hub: feet on the ground, tops tucked in */
function splayLegs(
  x: number, z: number, n: number, topY: number, rFoot: number, rTop: number, phase = 0,
): THREE.Matrix4[] {
  const tilt = Math.atan2(rFoot - rTop, topY);
  const rc = (rFoot + rTop) / 2;
  const out: THREE.Matrix4[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + phase;
    out.push(new THREE.Matrix4().compose(
      _v.set(x + Math.cos(a) * rc, topY / 2, z - Math.sin(a) * rc),
      _q.setFromAxisAngle(YAXIS, a).multiply(_qz.setFromAxisAngle(ZAXIS, tilt)),
      _s.set(1, 1, 1),
    ));
  }
  return out;
}

const legLen = (topY: number, rFoot: number, rTop: number) => Math.hypot(topY, rFoot - rTop);

/** unique-vertex normals, so a low-segment primitive reads as facets */
function faceted(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.toNonIndexed();
  n.computeVertexNormals();
  g.dispose();
  return n;
}

/** Script-wordmark silhouette; monotone in x so it can never self-intersect. At 60 m
 *  a LOW ribbon with a tall initial and small bumps reads as script; a tall
 *  deep-toothed one reads as a comb, and lifting both ends as a bowl. */
function ribbon(halfW: number, thick: number, cap: number, wob: number, freq = 4.5) {
  const N = 44;
  const top: [number, number][] = [], bot: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (t * 2 - 1) * halfW;
    const base = Math.sin(t * Math.PI * 1.9) * 0.16 + t * 0.5 - 0.28;
    const w = Math.sin(t * Math.PI * freq) * wob;
    const asc = Math.exp(-(((t - 0.06) / 0.055) ** 2)) * cap;      // initial, left only
    const flick = Math.exp(-(((t - 0.9) / 0.06) ** 2)) * cap * 0.28;
    top.push([x, base + thick + w + asc + flick]);
    bot.push([x, base - thick + w * 0.3]);   // underside barely follows the wobble
  }
  return top.concat(bot.reverse());
}

function ellipse(rx: number, ry: number): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    p.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return p;
}

/** hyperbolic paraboloid shell, y = rise*(u^2 - v^2), skinned on both sides */
function hyparGeo(half: number, rise: number, thick: number, seg: number) {
  const pos: number[] = [], idx: number[] = [];
  const n = seg + 1;
  for (let layer = 0; layer < 2; layer++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = (i / seg) * 2 - 1;
        const v = (j / seg) * 2 - 1;
        pos.push(u * half, rise * (u * u - v * v) - layer * thick, v * half);
      }
    }
  }
  const b = n * n;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i, c = a + 1, d = a + n, e = d + 1;
      idx.push(a, d, c, c, d, e);                                    // top, facing up
      idx.push(b + a, b + c, b + d, b + c, b + e, b + d);            // soffit, down
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * One desert massif. Unit space is x in [-1,1], crest at y <= ~1, base skirt either
 * side of z = 0, so the instance scale sets width / height / depth independently and
 * the height-to-width ratio can stay near 0.4 - one cone at ratio 1.0 is what made
 * the old ring read as ice-cream cones. Several summits ride a broad body, undulating
 * coherently (per-vertex jitter at 300 m reads as a comb, not as strata). Both ends
 * fall to y = 0, so a sunk instance melts into the haze with no base line and
 * neighbours overlap into a continuous, irregular range.
 */
function ridgeGeo(rand: () => number, seg: number): THREE.BufferGeometry {
  const nSum = 2 + Math.floor(rand() * 2);
  const sums: [number, number, number][] = [];   // [along the ridge, height, half-width]
  for (let i = 0; i < nSum; i++) {
    sums.push([(i + 0.5) / nSum + (rand() - 0.5) * 0.26,
      0.46 + rand() * 0.40, 0.30 + rand() * 0.28]);
  }
  const f1 = 3 + rand() * 3, p1 = rand() * 6.28;
  const f2 = 8 + rand() * 6, p2 = rand() * 6.28;
  const fz = 1.2 + rand() * 1.6, pz = rand() * 6.28;
  const pb1 = rand() * 6.28, pb2 = rand() * 6.28;
  const cr: number[][] = [], fb: number[][] = [], bb: number[][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    let h = 0.36 * Math.pow(Math.sin(Math.PI * t), 0.5);           // the massif body
    // exponent 2.6, not 2: a gaussian summit comes to a POINT, and a point at this
    // horizontal scale IS the white ice-cream cone. 2.6 gives a mesa crown instead.
    for (const [p, a, w] of sums) {
      h = Math.max(h, a * Math.exp(-(Math.abs((t - p) / w) ** 2.6)));
    }
    h *= 1 + 0.11 * Math.sin(t * Math.PI * f1 + p1)
           + 0.05 * Math.sin(t * Math.PI * f2 + p2);               // ridge strata
    h *= Math.min(1, t / 0.12, (1 - t) / 0.12);                    // ends into the floor
    const zc = 0.30 * Math.sin(t * Math.PI * fz + pz);             // the ridge meanders
    const x = t * 2 - 1;
    cr.push([x, Math.max(h, 0), zc]);
    fb.push([x, 0, zc + 0.62 + 0.34 * Math.sin(t * 5.1 + pb1)]);
    bb.push([x, 0, zc - 0.62 - 0.34 * Math.sin(t * 4.3 + pb2)]);
  }

  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => { pos.push(...a, ...b, ...c); };
  for (let i = 0; i < seg; i++) {
    tri(fb[i], fb[i + 1], cr[i + 1]); tri(fb[i], cr[i + 1], cr[i]);   // sunward flank
    tri(bb[i + 1], bb[i], cr[i]); tri(bb[i + 1], cr[i], cr[i + 1]);   // far flank
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- builder
export const buildSkyline: Builder = (ctx) => {
  const g = group('skyline');
  const r = ctx.rand;
  const m = ctx.mat;
  const unit = new THREE.BoxGeometry(1, 1, 1);

  // --- 1. pylon sign: off the -x road stem, facing back down the street so it
  // closes the vista from the head and from both spawns' sightlines.
  {
    const SX = BOUND_X_MIN - 12;
    const SZ = -(PAVEMENT_OUTER + 1.6);
    const TOP = 17.2, BOT_HALF = 5.6, TOP_HALF = 3.4;
    const halfAt = (y: number) => BOT_HALF + (TOP_HALF - BOT_HALF) * (y / TOP);
    const pale = m.painted(PAL.concrete, 0.74, 0.12);
    const maroon = m.emissive(PAL.signMaroon);

    // two splayed posts and two cross-beams = the trapezoid frame
    const lean = Math.atan2(BOT_HALF - TOP_HALF, TOP);
    for (const s of [-1, 1]) {
      const post = box(0.84, Math.hypot(TOP, BOT_HALF - TOP_HALF), 0.84, pale,
        SX, TOP / 2, SZ + s * (BOT_HALF + TOP_HALF) / 2);
      post.rotation.x = -s * lean;
      g.add(post);
    }
    for (const y of [4.2, TOP - 0.7]) {
      g.add(box(0.58, 0.46, halfAt(y) * 2 + 0.4, pale, SX, y, SZ));
    }

    plate(g, [
      [-halfAt(5.0) + 0.55, 5.0], [halfAt(5.0) - 0.55, 5.0],
      [halfAt(15.9) - 0.55, 15.9], [-halfAt(15.9) + 0.55, 15.9],
    ], 0.34, m.painted(PAL.houseCream, 0.82, 0.04), SX + 0.5, 0, SZ);

    // "Nuketown" script over its underswash
    plate(g, ribbon(3.7, 0.3, 1.55, 0.16, 8), 0.26, maroon, SX + 0.8, 12.2, SZ);
    plate(g, ribbon(4.0, 0.15, 0, 0.1, 1.6), 0.2, maroon, SX + 0.76, 10.5, SZ);
    // strapline: "Discover the City of the Future" is one lighter bar at 66 m
    g.add(box(0.2, 0.42, 6.0, m.emissive(PAL.windowBand, 0.5), SX + 0.72, 9.3, SZ));
    // teal oval badge on a cream surround
    plate(g, ellipse(3.15, 1.8), 0.22, m.painted(PAL.coachCream, 0.7, 0.05),
      SX + 0.72, 7.0, SZ);
    plate(g, ellipse(2.75, 1.45), 0.2, m.emissive(PAL.signTeal, 1.2), SX + 0.92, 7.0, SZ);

    // atom-and-orbit finial - the signature motif. Euler XYZ is Rx*Ry*Rz, so Y
    // opens each ring off edge-on and X rolls it: three near-horizontal rings
    // just read as an eye.
    g.add(box(0.42, 3.8, 0.42, pale, SX, TOP + 1.9, SZ));
    const atomY = TOP + 5.4;
    put(g, new THREE.SphereGeometry(1.8, 20, 14),
      m.painted(PAL.signMaroon, 0.45, 0.1), SX, atomY, SZ);
    const ringGeo = new THREE.TorusGeometry(3.75, 0.11, 6, 44);
    const ringMat = m.painted(PAL.signMaroon, 0.5, 0.18);
    for (let i = 0; i < 3; i++) {
      put(g, ringGeo, ringMat, SX, atomY, SZ).rotation.set((i / 3) * Math.PI, 0.62, 0);
    }
  }

  // --- 2. plaza flag rows
  {
    const poles: THREE.Matrix4[] = [];
    const cloth: THREE.Matrix4[][] = [[], [], []];
    const FZ = PAVEMENT_OUTER + 5.5;
    for (let i = 0; i < 8; i++) {
      const x = BOUND_X_MIN - 4 - i * 3.2;
      for (const s of [-1, 1]) {
        const z = s * FZ;
        poles.push(mtx(x, 2.6, z, 0));
        const yaw = (r() - 0.5) * 0.5;
        cloth[(i + (s > 0 ? 1 : 0)) % 3].push(mtx(
          x + Math.sin(yaw) * 0.85, 4.15, z + Math.cos(yaw) * 0.85, yaw, 1.6, 0.98, 0.06));
      }
    }
    g.add(inst(new THREE.CylinderGeometry(0.075, 0.075, 5.2, 6), m.steel, poles));
    const cols = [PAL.signMaroon, PAL.signTeal, PAL.coachCream];
    for (let i = 0; i < 3; i++) g.add(inst(unit, m.painted(cols[i], 0.85, 0), cloth[i]));
  }

  // --- 3. hyperbolic-paraboloid pylon. NT03 puts this maroon saddle left of the
  // orange house, so -x. Rotated 45 deg it reaches half*sqrt(2): set back enough
  // that the high corners still clear the boundary.
  {
    const x = BOUND_X_MIN - 14;
    const z = -BOUND_Z * 0.75;
    put(g, new THREE.CylinderGeometry(0.78, 1.15, 6.2, 10),
      m.painted(PAL.concrete, 0.88, 0.05), x, 3.1, z);
    put(g, hyparGeo(7.5, 3.4, 0.34, 8),
      m.painted(PAL.signMaroon, 0.62, 0.06), x, 6.2, z).rotation.y = Math.PI / 4;
  }

  // --- 4. space-needle on a two-step circular plaza. Glazed band INSET under the
  // roof lip; flush with it the deck reads as a black tyre on a stick. The plinth is
  // what stops the AERIAL station - which looks almost down the mast - reading the
  // shaft as a loose white tube: from above it is now a tower standing in a plaza.
  {
    const x = NEEDLE_X;
    const z = NEEDLE_Z;
    const cream = m.painted(PAL.capsuleWhite, 0.68, 0.06);
    put(g, new THREE.CylinderGeometry(NEEDLE_PLINTH_R + 2.0, NEEDLE_PLINTH_R + 2.2, 0.24, 36),
      m.painted(PAL.concreteDark, 0.94, 0), x, 0.12, z);
    put(g, new THREE.CylinderGeometry(NEEDLE_PLINTH_R, NEEDLE_PLINTH_R, 0.5, 36),
      m.painted(PAL.concrete, 0.9, 0), x, 0.25, z);
    put(g, new THREE.CylinderGeometry(1.1, 2.6, 38, 12), cream, x, 19, z);
    put(g, new THREE.CylinderGeometry(5.8, 2.0, 3.0, 20), cream, x, 33.2, z);
    put(g, new THREE.CylinderGeometry(5.6, 5.6, 1.6, 20), m.windowDark, x, 35.5, z);
    put(g, new THREE.CylinderGeometry(3.4, 5.9, 2.0, 20), cream, x, 37.3, z);
    put(g, new THREE.ConeGeometry(0.42, 8.0, 8), m.steel, x, 42.3, z);
    g.add(inst(new THREE.BoxGeometry(0.55, legLen(10.4, 5.1, 1.7), 0.55), cream,
      splayLegs(x, z, 3, 10.4, 5.1, 1.7)));
  }

  // --- 5. flying-saucer house, beyond team A's back fence. Window band inset
  // into the upper hull: wider than the body it reads as a black brim.
  {
    const Y = 8.0;
    const topY = Y - 1.4;
    const profile = [
      [0, -1.7], [1.9, -1.15], [3.6, -0.35], [4.9, 0],
      [3.9, 0.7], [2.4, 1.25], [1.0, 1.55], [0, 1.65],
    ].map((p) => new THREE.Vector2(p[0], p[1]));
    const cream = m.painted(PAL.houseCream, 0.58, 0.08);
    put(g, new THREE.LatheGeometry(profile, 22), cream, SAUCER_X, Y, SAUCER_Z);
    put(g, new THREE.CylinderGeometry(4.3, 4.45, 0.62, 22, 1, true), m.windowDark,
      SAUCER_X, Y + 0.34, SAUCER_Z);
    g.add(inst(new THREE.BoxGeometry(0.38, legLen(topY, 5.4, 2.0), 0.38), cream,
      splayLegs(SAUCER_X, SAUCER_Z, 4, topY, 5.4, 2.0, Math.PI / 4)));
  }

  // --- 6. geodesic dome, beyond team B's back fence: its answering landmark.
  {
    const R = DOME_R;
    put(g, faceted(new THREE.SphereGeometry(R, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2)),
      m.painted(PAL.capsuleWhite, 0.72, 0.03), DOME_X, 0.4, DOME_Z);
    put(g, new THREE.CylinderGeometry(R * 1.04, R * 1.08, 0.9, 24),
      m.painted(PAL.concreteDark, 0.92, 0), DOME_X, 0.45, DOME_Z);
    const meridians: THREE.Matrix4[] = [];
    for (let i = 0; i < 8; i++) meridians.push(mtx(DOME_X, 0.4, DOME_Z, (i / 8) * Math.PI));
    g.add(inst(new THREE.TorusGeometry(R * 1.008, 0.14, 5, 36, Math.PI), m.steel, meridians));
    for (const th of [0.52, 1.0]) {
      put(g, new THREE.TorusGeometry(R * Math.cos(th), 0.13, 5, 40), m.steel,
        DOME_X, 0.4 + R * Math.sin(th), DOME_Z).rotation.x = Math.PI / 2;
    }
  }

  // --- 7. perimeter fringe: low show pavilions scattered just outside the boundary,
  // so the player never looks over the fence into nothing. Two measured failures are
  // encoded here. (a) All in PAL.concrete they read from the AERIAL as thin white
  // cards: the roof was the same value as the paving and nothing out here casts a
  // shadow, so the top plane melted into the ground and only the two shaded flanks
  // survived, as an L of grey. (b) Fixing that with a saturated roof cap overshot -
  // the ring became rows of blue panels and pulled the eye off the town. So bleached
  // walls, a roof one step darker in the SAME concrete family, and the only colour is
  // a thin glazing band. Spacing, size and yaw are jittered and one slot in six is
  // dropped: an even pitch at a fixed angle reads as a car park from 78 m up.
  {
    const walls: THREE.Matrix4[] = [];
    const roofs: THREE.Matrix4[] = [];
    const bands: THREE.Matrix4[] = [];
    const ROOF_T = 0.7;
    const OVER = 0.5;          // roof overhang: the eave line is what reads at 60 m
    // every block's local +z faces the map, so the window-band offset is free
    const add = (x: number, z: number, ry: number) => {
      if (r() < 0.16) return;                                   // break the rhythm
      const yaw = ry + (r() - 0.5) * 0.7 + (r() < 0.22 ? Math.PI / 2 : 0);
      const w = 7 + r() * 13, d = 7 + r() * 9, h = 3.2 + r() * 4.3;
      walls.push(mtx(x, h / 2, z, yaw, w, h, d));
      roofs.push(mtx(x, h + ROOF_T / 2, z, yaw, w + OVER * 2, ROOF_T, d + OVER * 2));
      // half-buried in the wall, so it is a glazing band and never a loose card
      const off = d / 2 - 0.06;
      bands.push(mtx(x + Math.sin(yaw) * off, h * 0.55, z + Math.cos(yaw) * off, yaw,
        w * 0.66, 0.8, 0.28));
    };
    // each run breaks where a landmark stands behind it, so the sightline out
    // over the back fence actually reaches the landmark
    const clear = (x: number, at: number, gap: number) => Math.abs(x - at) > gap;
    const zRow = BOUND_Z + 13;
    for (let x = BOUND_X_MIN - 28; x <= BOUND_X_MAX - 2; x += 12 + r() * 11) {
      if (clear(x, SAUCER_X, 15)) add(x, -zRow - r() * 11, 0);
      if (clear(x, DOME_X, DOME_R + 5)) add(x, zRow + r() * 11, Math.PI);
    }
    // the +x run must clear the third house, which another module owns
    const xRow = Math.max(BOUND_X_MAX + 13, THIRD_HOUSE_X + 19);
    for (let z = -BOUND_Z - 8; z <= BOUND_Z + 8; z += 11 + r() * 10) {
      add(xRow + r() * 9, z, -Math.PI / 2);
    }
    // the -x side only closes past |z| = 28: the road stem, the pylon sign and the
    // needle all sit inside that corridor and the plaza vista must stay open
    for (const s of [-1, 1]) {
      for (let z = 28; z <= BOUND_Z + 20; z += 11 + r() * 9) {
        add(BOUND_X_MIN - 22 - r() * 12, s * z, s * Math.PI / 2);
      }
    }
    g.add(inst(unit, m.painted(PAL.thirdWall, 0.9, 0), walls));
    g.add(inst(unit, m.painted(PAL.concreteDark, 0.93, 0), roofs));
    // the one accent, and distant glazing is pale haze, never a black slot
    g.add(inst(unit, m.painted(PAL.roofGlazing, 0.3, 0.2), bands));
  }

  // --- 8. hazy city band between the map and the mountains. Haze, not architecture:
  // low enough that the mountains always read above it, with enough spread in all
  // three dimensions that no two blocks share a silhouette. A second, lower ring in
  // front thickens the band for free.
  {
    const city: THREE.Matrix4[] = [];
    const place = (rad: number, hMin: number, hSpan: number, n: number, tower: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.06;
        const d = rad * (0.96 + r() * 0.09);
        const isTower = r() > tower;
        const h = isTower ? hMin + hSpan + r() * 12 : hMin + r() * hSpan;
        // local +x is radial with this yaw, local +z tangential: keep the frontage
        // the wide one, and never let either go below 8 m or it reads as a panel
        const deep = 8 + r() * 11;
        const front = isTower ? 9 + r() * 8 : 12 + r() * 21;
        city.push(mtx(Math.cos(a) * d, h / 2, Math.sin(a) * d,
          -a + (r() - 0.5) * 0.45, deep, h, front));
      }
    };
    place(CITY_R, 6, 15, 104, 0.9);
    place(CITY_R * 0.82, 4, 8, 40, 1.1);
    g.add(inst(unit, m.painted(PAL.cityFar, 1, 0.7), city));
  }

  // --- 9. mountains: three overlapping ridge layers, each paler than the one in
  // front. Two silhouettes per layer so the instances are not all the same massif;
  // the far layer sits at the sky horizon colour and should barely read as geometry.
  {
    // [count, ring index, half-width min/span, height min/span, half-depth min/span]
    const layers: [number, number, number, number, number, number, number, number,
      THREE.Material][] = [
      [9, 0, 110, 80, 38, 46, 17, 9, m.painted(PAL.mountain, 1, 1)],
      [10, 1, 130, 95, 46, 54, 20, 11, m.painted(PAL.mountainFar, 1, 1)],
      [10, 2, 150, 110, 54, 58, 23, 13, m.painted(PAL.skyHorizon, 1, 0.9)],
    ];
    for (const [n, ring, wMin, wSpan, hMin, hSpan, dMin, dSpan, mat] of layers) {
      const buckets: THREE.Matrix4[][] = [[], []];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.45;
        const d = MTN_R[ring] * (0.96 + r() * 0.1);
        buckets[i % 2].push(mtx(
          Math.cos(a) * d, -MTN_SINK, Math.sin(a) * d,
          -a - Math.PI / 2,                                  // crest runs tangentially
          wMin + r() * wSpan, hMin + r() * hSpan + MTN_SINK, dMin + r() * dSpan,
        ));
      }
      for (let k = 0; k < 2; k++) g.add(inst(ridgeGeo(r, 22), mat, buckets[k]));
    }
  }

  // Backdrop contract: no shadows either way; nothing moves, so compose each
  // matrix once and stop the renderer recomposing it every frame.
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });

  return { group: g, colliders: [] };
};
