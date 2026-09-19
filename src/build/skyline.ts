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
  BOUND_X_MAX, BOUND_X_MIN, BOUND_Z, PAVEMENT_OUTER,
} from '../core/layout';

/** half the playable footprint - used only for things that belong TO the map */
const MAP_R = (BOUND_X_MAX - BOUND_X_MIN) / 2;   // 22.25

/**
 * HORIZON DISTANCES ARE ABSOLUTE METRES, NOT MULTIPLES OF MAP_R.  (2026-09-18)
 *
 * They used to be MAP_R * k. The 2026-09-18 re-proportioning cut MAP_R from ~54 to
 * 22.25, so every ring came in with it and the whole backdrop collapsed onto the map:
 * measured from the shipped constants, the city band stood at 67-82 m and the three
 * mountain rings at 118 / 147 / 180 m, with the pavilion rows at 55 m in front of them.
 * At FogExp2 0.0016 that is 1.7% haze on the city and 3.5-8.0% on the mountains - no
 * aerial perspective at all - so the horizon read as one flat crowd of same-valued grey
 * boxes stacked just behind the fence. That is the "grey lumps" in the owner's brief and
 * it is arithmetic, not taste: a backdrop's distance cannot be a function of how big the
 * town is.
 *
 * Re-pitched so the four bands separate, and so the haze does some of the work:
 *   pavilions  55-85 m     1-2% haze   hard edges, full value - the rest of the test town
 *   city       137/175 m   5-8% haze   a low band, never architecture
 *   foothills  300 m      21% haze     the DARK layer: the value ladder starts here
 *   mid range  420 m      36% haze
 *   far range  560 m      56% haze
 *   horizon    720 m      72% haze     nearly sky, and meant to be
 * ground.ts's desert floor runs to 900 m, so the far ring still stands on ground.
 *
 * The city ring has to stay IN FRONT of every mountain ring and angularly BELOW them,
 * or it becomes the horizon itself - which is what a first pass at 240 m did, with the
 * foothills interleaved through it at 234 m.
 */
const CITY_R = 175;
const MTN_R = [300, 420, 560, 720];
/** Massifs scale with their ring or the far ones vanish; multiplier per ring. */
const MTN_SCALE = [1.0, 1.4, 1.8, 2.3];
/** mountains are sunk so no base rim shows where the ground plane ends */
const MTN_SINK = 12;
/**
 * Nothing in the backdrop may stand inside the playable footprint. The pavilion ring
 * used to be placed at BOUND_X_MAX - 14, which was well outside the map before the
 * re-proportioning and is x = 11 after it - i.e. on the east flank of both houses.
 * Measured in base0-yardWhite.png: a 20 m wide, 7 m tall collider-less white slab
 * standing in the white house's east flank, which the player walks straight through.
 * KEEPOUT is checked per block below, and violations are counted and reported.
 */
const KEEPOUT = 9;

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

/**
 * Geodesic hemisphere: a vertex-up icosphere cut at the equator, returned as the
 * flat-shaded upper shell plus one transform per lattice strut. Meridian ribs alone
 * read as a circus tent; the triangulation IS the shape.
 * Two traps. (a) Rotate by a BASE vertex - (0,1,phi) is one of the twelve - because
 * position[0] is a subdivision midpoint already on +y, so rotating by it is a no-op.
 * (b) Only an EVEN subdivision lands vertices exactly on y=0: detail 1 and 3 cut
 * clean, detail 2 leaves 30 struts hanging through the floor.
 */
function geodesic(R: number, detail: number) {
  const src = new THREE.IcosahedronGeometry(R, detail);
  src.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, (1 + Math.sqrt(5)) / 2).normalize(), YAXIS));
  const pos = src.getAttribute('position');
  const seen = new Map<string, number>();
  const pts: THREE.Vector3[] = [];
  const face: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const k = v.toArray().map((n) => n.toFixed(4)).join();
    let id = seen.get(k);
    if (id === undefined) { id = pts.length; seen.set(k, id); pts.push(v); }
    face.push(id);
  }
  src.dispose();
  const shellPos: number[] = [];
  const edges = new Set<string>();
  for (let t = 0; t < face.length; t += 3) {
    const [a, b, c] = [pts[face[t]], pts[face[t + 1]], pts[face[t + 2]]];
    if (a.y + b.y + c.y <= 0) continue;                        // lower half, discard
    shellPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let e = 0; e < 3; e++) {
      const i = face[t + e], j = face[t + (e + 1) % 3];
      edges.add(i < j ? i + '_' + j : j + '_' + i);
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(shellPos, 3));
  shell.computeVertexNormals();
  const struts: THREE.Matrix4[] = [];
  const dir = new THREE.Vector3();
  for (const e of edges) {
    const [i, j] = e.split('_').map(Number);
    const a = pts[i], b = pts[j];
    const len = dir.subVectors(b, a).length();
    struts.push(new THREE.Matrix4().compose(
      new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(YAXIS, dir.divideScalar(len)),
      new THREE.Vector3(1, len, 1),
    ));
  }
  return { shell, struts };
}

/**
 * A transparent lettered plane laid ON a sign face - a drawn ribbon is a squiggle at
 * any distance; only glyphs give a baseline, a capital and a word silhouette.
 * THE MIRROR TRAP: rotation.y = +PI/2 puts the normal on +x and +u on world -z, and
 * -z is the right hand of anyone in the street looking down the stem toward -x, so
 * the word reads forwards from the map. -PI/2 faces the desert and mirrors it.
 */
function letters(
  g: THREE.Group, mat: THREE.Material, w: number, h: number,
  x: number, y: number, z: number,
): void {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.rotation.y = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
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

    // The project's OWN name in neon script with an original strapline under it (never the
    // source map's name or its welcome-sign copy - VISUAL-BAR B5), both glyph planes
    // standing just clear of the face so the cream panel still backs them. The plane,
    // not the font, sets the cap height: signText pins the word to 90% of the plane
    // width, so at 72 m every centimetre of panel is worth taking. Headless Chromium
    // has no Brush Script MT - the stack lands on Segoe Script - and no Futura, so
    // the strapline is Century Gothic. Both are period-correct enough.
    const NAME_W = (halfAt(12.2) - 0.55) * 2 / 0.9;      // 90% of it IS the word
    const NAME_A = 5.0;   // 'Atomic Acres' is 12 glyphs; 3.5 fitted the 8-glyph source name
    letters(g, m.signText({
      text: 'Atomic Acres', color: PAL.signMaroon, aspect: NAME_A, script: true, glow: true,
    }), NAME_W, NAME_W / NAME_A, SX + 0.86, 12.2, SZ);

    const LINE_W = (halfAt(9.3) - 0.55) * 2, LINE_A = 6.0;
    const lineH = LINE_W / LINE_A;
    // the plate is sized BY the strapline now, not the other way round; it used to be
    // a 0.42 m bar, which is why the line had nowhere to go and it read as blank
    g.add(box(0.2, lineH, LINE_W, m.emissive(PAL.windowBand, 0.5), SX + 0.72, 9.3, SZ));
    letters(g, m.signText({
      text: 'Tomorrow Lives Here', color: PAL.signTeal, aspect: LINE_A,
    }), LINE_W, lineH, SX + 0.86, 9.3, SZ);
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
  // into the upper hull: wider than the body it reads as a black brim. Under the
  // lip a mauve soffit ring carries recessed downlights on the map-facing arc,
  // on four slim splayed legs with open walk-under (f-FKQOEO-1ceE-165.jpg read).
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
    // mauve soffit band tucked under the lip: tapered ring, widest at the lip so
    // the cream shell overhangs it. Radii derive from the lathe lip (4.9) above.
    const LIP_R = 4.9;
    const SOF_T = 0.55;
    put(g, new THREE.CylinderGeometry(LIP_R - 0.05, LIP_R - 0.9, SOF_T, 22),
      m.painted(PAL.saucerSoffit, 0.8, 0.05), SAUCER_X, Y - SOF_T / 2, SAUCER_Z);
    // recessed downlights: warm discs just proud of the soffit underside, spaced
    // ~1.25 m apart along the map-side arc. Instanced; pitched to face straight down.
    const dlQ = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const dls: THREE.Matrix4[] = [];
    for (const a of [-0.45, -0.15, 0.15, 0.45]) {
      dls.push(new THREE.Matrix4().compose(
        new THREE.Vector3(
          SAUCER_X + Math.sin(a) * (LIP_R - 0.7), Y - SOF_T - 0.02,
          SAUCER_Z + Math.cos(a) * (LIP_R - 0.7)),
        dlQ, new THREE.Vector3(1, 1, 1)));
    }
    g.add(inst(new THREE.CircleGeometry(0.16, 12),
      m.emissive(PAL.windowBand, 1.1), dls));
    g.add(inst(new THREE.BoxGeometry(0.38, legLen(topY, 5.4, 2.0), 0.38), cream,
      splayLegs(SAUCER_X, SAUCER_Z, 4, topY, 5.4, 2.0, Math.PI / 4)));
  }

  // --- 6. geodesic dome, beyond team B's back fence: its answering landmark.
  // Panels and struts come off the SAME triangulation, so the frame lands on the
  // panel joints instead of lying across them. detail 3 is a 4V dome: 160 panels and
  // 250 struts, one draw call each and ~2.7k triangles - cheap enough for background,
  // and 2V at this 32 m span reads as folded paper rather than a space frame.
  {
    const R = DOME_R;
    const strut = R * 0.0085;
    const dome = geodesic(R, 3);
    put(g, dome.shell, m.painted(PAL.capsuleWhite, 0.72, 0.03), DOME_X, 0.4, DOME_Z);
    put(g, new THREE.CylinderGeometry(R * 1.04, R * 1.08, 0.9, 24),
      m.painted(PAL.concreteDark, 0.92, 0), DOME_X, 0.45, DOME_Z);
    // struts ride a hair proud of the shell so they never z-fight the panels
    const lattice = inst(
      new THREE.CylinderGeometry(strut, strut, 1, 5, 1, true), m.steel, dome.struts);
    lattice.position.set(DOME_X, 0.4, DOME_Z);
    lattice.scale.setScalar(1.004);
    g.add(lattice);
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
  // Two value tiers by distance, so the ring itself has depth instead of being one
  // flat crowd: the near rank keeps its own value, the outer rank is stepped toward the
  // city band. Fog does almost nothing at 55-90 m (1-2%), so this has to be albedo.
  {
    const wallsNear: THREE.Matrix4[] = [];
    const wallsFar: THREE.Matrix4[] = [];
    const roofs: THREE.Matrix4[] = [];
    const bands: THREE.Matrix4[] = [];
    const ROOF_T = 0.7;
    const OVER = 0.5;          // roof overhang: the eave line is what reads at 60 m
    let rejected = 0;
    /**
     * Would a block of this footprint at this yaw touch the playable area? Uses the
     * yawed half-extents against the boundary rect inflated by KEEPOUT, which is the
     * conservative test - the exact OBB can only be smaller.
     */
    const clearOfMap = (x: number, z: number, w: number, d: number, yaw: number): boolean => {
      const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
      const hx = (c * w + s * d) / 2, hz = (s * w + c * d) / 2;
      const insideX = x + hx > BOUND_X_MIN - KEEPOUT && x - hx < BOUND_X_MAX + KEEPOUT;
      const insideZ = Math.abs(z) - hz < BOUND_Z + KEEPOUT;
      return !(insideX && insideZ);
    };
    // every block's local +z faces the map, so the window-band offset is free
    const add = (x: number, z: number, ry: number) => {
      if (r() < 0.16) return;                                   // break the rhythm
      const yaw = ry + (r() - 0.5) * 0.7 + (r() < 0.22 ? Math.PI / 2 : 0);
      const w = 7 + r() * 13, d = 7 + r() * 9, h = 3.2 + r() * 4.3;
      if (!clearOfMap(x, z, w, d, yaw)) { rejected++; return; }
      const far = Math.hypot(x, z) > 78;
      (far ? wallsFar : wallsNear).push(mtx(x, h / 2, z, yaw, w, h, d));
      roofs.push(mtx(x, h + ROOF_T / 2, z, yaw, w + OVER * 2, ROOF_T, d + OVER * 2));
      // half-buried in the wall, so it is a glazing band and never a loose card
      const off = d / 2 - 0.06;
      bands.push(mtx(x + Math.sin(yaw) * off, h * 0.55, z + Math.cos(yaw) * off, yaw,
        w * 0.66, 0.8, 0.28));
    };
    // each run breaks where a landmark stands behind it, so the sightline out
    // over the back fence actually reaches the landmark
    const clear = (x: number, at: number, gap: number) => Math.abs(x - at) > gap;
    const zRow = BOUND_Z + KEEPOUT + 5;
    for (let x = BOUND_X_MIN - 34; x <= BOUND_X_MAX + 30; x += 12 + r() * 11) {
      if (clear(x, SAUCER_X, 15)) add(x, -zRow - r() * 13, 0);
      if (clear(x, DOME_X, DOME_R + 5)) add(x, zRow + r() * 13, Math.PI);
    }
    // The +x ranks close the east behind the third house. Both ranks now sit OUTSIDE
    // the boundary: the near rank used to be at BOUND_X_MAX - 14, which the
    // re-proportioning put at x = 11, i.e. inside the map (see KEEPOUT).
    const xNear = BOUND_X_MAX + KEEPOUT + 3;
    for (let z = -BOUND_Z - 8; z <= BOUND_Z + 8; z += 13 + r() * 9) {
      if (Math.abs(z) < 13) continue;                    // the house owns the axis
      add(xNear + r() * 8, z, -Math.PI / 2);
    }
    const xFar = BOUND_X_MAX + 30;
    for (let z = -BOUND_Z - 12; z <= BOUND_Z + 12; z += 11 + r() * 10) {
      add(xFar + r() * 11, z, -Math.PI / 2);
    }
    // the -x side only closes past |z| = 28: the road stem, the pylon sign and the
    // needle all sit inside that corridor and the plaza vista must stay open
    for (const s of [-1, 1]) {
      for (let z = 28; z <= BOUND_Z + 26; z += 11 + r() * 9) {
        add(BOUND_X_MIN - 26 - r() * 14, s * z, s * Math.PI / 2);
      }
    }
    g.add(inst(unit, m.painted(PAL.thirdWall, 0.9, 0), wallsNear));
    g.add(inst(unit, m.painted(PAL.concrete, 0.95, 0.18), wallsFar));
    g.add(inst(unit, m.painted(PAL.concreteDark, 0.93, 0), roofs));
    // the one accent, and distant glazing is pale haze, never a black slot
    g.add(inst(unit, m.painted(PAL.roofGlazing, 0.3, 0.2), bands));
    if (rejected) {
      console.warn('[skyline] %d backdrop pavilion(s) rejected for reaching inside the '
        + 'playable area (boundary + %s m). Backdrop blocks have no colliders, so one '
        + 'inside the map is geometry the player walks through.', rejected, KEEPOUT);
    }
  }

  // --- 8. hazy city band between the map and the mountains. Haze, not architecture:
  // low enough that the mountains always read above it, with enough spread in all
  // three dimensions that no two blocks share a silhouette. A second, lower ring in
  // front thickens the band for free.
  // Two tiers, two materials: the inner tier is a step darker so the band is a band
  // with depth rather than a single cut-out. Sizes scale with CITY_R (now 240 m, not
  // 82) or the whole thing subtends nothing.
  {
    const near: THREE.Matrix4[] = [];
    const far: THREE.Matrix4[] = [];
    const place = (
      out: THREE.Matrix4[], rad: number, hMin: number, hSpan: number,
      n: number, tower: number, kh: number, kp: number,
    ) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.06;
        const d = rad * (0.96 + r() * 0.09);
        const isTower = r() > tower;
        const h = (isTower ? hMin + hSpan + r() * 12 : hMin + r() * hSpan) * kh;
        // local +x is radial with this yaw, local +z tangential: keep the frontage
        // the wide one, and never let either go below 8 m or it reads as a panel
        const deep = (8 + r() * 11) * kp;
        const front = (isTower ? 9 + r() * 8 : 12 + r() * 21) * kp;
        out.push(mtx(Math.cos(a) * d, h / 2, Math.sin(a) * d,
          -a + (r() - 0.5) * 0.45, deep, h, front));
      }
    };
    // Plan sizes scale so the band still closes the circle at 175 m; HEIGHTS do not,
    // because the band's job is to sit under the ranges, not to compete with them.
    place(far, CITY_R, 6, 15, 130, 0.9, 1.0, 1.9);
    place(near, CITY_R * 0.78, 4, 8, 58, 1.1, 1.0, 1.6);
    g.add(inst(unit, m.painted(PAL.mountainFar, 1, 0.85), near));
    g.add(inst(unit, m.painted(PAL.cityFar, 1, 0.7), far));
  }

  // --- 9. mountains: FOUR overlapping ridge layers now, and the near one is the dark
  // one. The three-layer set was mountain / mountainFar / skyHorizon - three pale greys
  // within ~12% of each other, at 118-180 m where the haze contributes 3-8%. Nothing in
  // that set could read as depth, because depth is a VALUE LADDER and there was no dark
  // end to the ladder. A steel-toned foothill ring at 300 m gives the ladder a floor;
  // 450 m and 640 m step up through mountain / mountainFar to skyHorizon, which at 65%
  // haze is meant to be almost gone.
  //
  // Counts are up from 9-10 to 14-18 per ring: at MAP_R*5.3 = 118 m nine massifs closed
  // the circle, at 300 m they leave 100 m gaps between them and the range reads as
  // separate lumps rather than as a range. Two silhouettes per layer, as before.
  {
    // [count, ring index, half-width min/span, height min/span, half-depth min/span]
    const layers: [number, number, number, number, number, number, number, number,
      THREE.Material][] = [
      [18, 0, 95, 70, 55, 45, 16, 9, m.painted(PAL.steel, 1, 1)],
      [16, 1, 110, 80, 46, 50, 17, 9, m.painted(PAL.mountain, 1, 1)],
      [16, 2, 130, 95, 50, 54, 20, 11, m.painted(PAL.mountainFar, 1, 1)],
      [14, 3, 150, 110, 54, 58, 23, 13, m.painted(PAL.skyHorizon, 1, 0.9)],
    ];
    let phase = 0;
    for (const [n, ring, wMin, wSpan, hMin, hSpan, dMin, dSpan, mat] of layers) {
      const k = MTN_SCALE[ring];
      const buckets: THREE.Matrix4[][] = [[], []];
      // each layer starts at its own angle, so two rings never stack crest-on-crest
      phase += 0.37;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + phase + (r() - 0.5) * 0.45;
        const d = MTN_R[ring] * (0.96 + r() * 0.1);
        buckets[i % 2].push(mtx(
          Math.cos(a) * d, -MTN_SINK, Math.sin(a) * d,
          -a - Math.PI / 2,                                  // crest runs tangentially
          (wMin + r() * wSpan) * k, (hMin + r() * hSpan) * k + MTN_SINK,
          (dMin + r() * dSpan) * k,
        ));
      }
      for (let b = 0; b < 2; b++) g.add(inst(ridgeGeo(r, 22), mat, buckets[b]));
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
