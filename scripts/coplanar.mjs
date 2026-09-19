/**
 * coplanar - find every pair of surfaces the map builds on the SAME PLANE.
 *
 * WHY. Z-fighting is not a rendering setting, it is two faces at one depth. The
 * vehicles lane found the mechanism in the trailer's rear doorway (an opening panel
 * and an interior mass 0.0 mm apart): the draw order hid it from one station and
 * exposed it from another, so walking the map cannot find these - the same pair
 * reads clean or dithered depending on where you stand. This runs every builder in
 * node, reads the world-space triangles, and lists the pairs.
 *
 * HOW. Each src/build module is bundled with esbuild against a stub MaterialLibrary
 * (materials.ts paints canvases; the stubs carry the real roughness / transparent /
 * side flags so gloss can be classified) and a no-op static batcher, so vehicle
 * parts keep their names. Every Mesh and every InstancedMesh instance contributes
 * its triangles in world space. A triangle's plane is its unit normal (sign
 * canonicalised so opposite-facing faces group together, snapped to an axis when
 * within AXIS_TOL of one) plus its offset along that normal. Offsets are clustered
 * at OFFSET_TOL, so two parts 0.05 mm apart are one plane and two parts 1 mm apart
 * are not. Within a plane a FACE is a connected patch of one mesh instance
 * (triangles sharing a vertex); every pair of faces whose 2D overlap, computed by
 * exact convex clipping of their triangles, exceeds MIN_AREA is reported.
 *
 * WHAT THE FLAGS MEAN.
 *   normals   same     both faces point the same way: a decal-on-wall, rug-on-floor,
 *                      pane-on-band pair. The rasteriser picks a winner per pixel:
 *                      THIS is the dither.
 *             opposite back-to-back: a box standing on a slab, a skirting against a
 *                      wall. Harmless with opaque single-sided materials (the front
 *                      face of the upper part covers the seam) - reported because a
 *                      transparent or DoubleSide material on either side turns it
 *                      into a fight, and `fight` says which.
 *   enclosed  the overlap region lies strictly inside an opaque closed box of the
 *             map (its module is named); nothing can see it, so it cannot dither.
 *   fight     same-normal, or opposite-normal with a transparent/DoubleSide
 *             material, AND not enclosed. These are the ones to fix.
 *   visible   a fight whose two faces would actually shade differently: different
 *             materials, or the same MAPPED material (different UVs sample different
 *             texels). Two faces of one unmapped painted() colour with one normal
 *             produce the same pixel either way - a real depth tie, nothing to see.
 *   centre    the area-weighted centroid of the overlap itself, in world space; the
 *             JSON also carries `extent` (the overlap's own bounding rectangle), `quad`
 *             (that rectangle's four world corners, for a pixel harness to project)
 *             and `patches` (the largest clipped pieces with their centroids).
 *
 * Output: a JSON report (captures/coplanar.json by default) and a table sorted by
 * area. Exit code is 0; this is an instrument, the sweep decides what to fix.
 *
 *   node scripts/coplanar.mjs                       whole map, fights only in the table
 *   node scripts/coplanar.mjs --module yards        pairs touching one module
 *   node scripts/coplanar.mjs --all                 include flush contacts in the table
 *   node scripts/coplanar.mjs --min 0.01            table threshold in m2 (default 0.002)
 *   node scripts/coplanar.mjs --top 60              rows in the table
 *   node scripts/coplanar.mjs --out path.json       JSON report path
 *   node scripts/coplanar.mjs --colliders path.txt  dump every collider at full
 *                                                   precision (module-tagged) for diff
 *   node scripts/coplanar.mjs --batched             run the real static batcher
 *                                                   (vehicle parts lose their names)
 *   node scripts/coplanar.mjs --json                machine-readable summary on stdout
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const MODULE = opt('--module', null);
const MIN_AREA = Number(opt('--min', '0.002'));      // m2, pairs below this are not reported
const TOP = Number(opt('--top', '80'));
const OUT = opt('--out', join(ROOT, 'captures', 'coplanar.json'));
const COLLIDERS_OUT = opt('--colliders', null);
const ALL = flag('--all');
const BATCHED = flag('--batched');
const JSON_OUT = flag('--json');

const AXIS_TOL = 0.5 * Math.PI / 180;    // a normal within this of an axis IS that axis
const OFFSET_TOL = 0.0002;              // 0.2 mm: offsets closer than this are one plane
const NORMAL_Q = 1e-4;                  // normal-component quantum for grouping
const VERT_Q = 1e-5;                    // 0.01 mm: vertex key quantum for connectivity
const MIN_TRI_AREA = 1e-8;              // degenerate triangles are skipped
const ENCLOSE_EPS = 0.0005;             // 0.5 mm: strictly inside means this far in

// ---------------------------------------------------------------- the bundle
// No backticks and no dollar-brace below - this is a template literal.
const ENTRY = `
import * as THREE from 'three';
import { makeRng } from '../src/core/kit';
import { buildGround } from '../src/build/ground';
import { buildOrangeHouse } from '../src/build/orange-house';
import { buildWhiteHouse } from '../src/build/white-house';
import { buildThirdHouse } from '../src/build/third-house';
import { buildVehicles } from '../src/build/vehicles';
import { buildYards } from '../src/build/yards';
import { buildSkyline } from '../src/build/skyline';
import { buildPlaza } from '../src/build/plaza';
import { buildMannequins } from '../src/build/mannequins';
import { buildSurround } from '../src/build/surround';

// Same order and the same seeds as src/main.ts.
const BUILDERS = [
  ['ground', buildGround],
  ['orange-house', buildOrangeHouse],
  ['white-house', buildWhiteHouse],
  ['third-house', buildThirdHouse],
  ['vehicles', buildVehicles],
  ['yards', buildYards],
  ['skyline', buildSkyline],
  ['plaza', buildPlaza],
  ['mannequins', buildMannequins],
  ['surround', buildSurround],
];

/**
 * Mirrors core/materials.ts where this instrument can see it: the same keys, the
 * same roughness / metalness / transparent / opacity / side, cached on their
 * arguments the same way, each named so a face can say what it is made of.
 * Colours and textures are not reproduced and are not read here.
 */
function stubMaterials() {
  const cache = new Map();
  // Which keys carry a map / roughnessMap / normalMap in the real library. Two faces
  // of one UNMAPPED material with the same normal shade to the same pixel, so their
  // fight is invisible; a mapped material samples different texels per part and dithers.
  const TEXTURED = new Set(['concrete', 'paving', 'asphalt', 'kerb', 'lawn', 'sand',
    'stuccoCream', 'stuccoTerracotta', 'roofWhite', 'solar', 'barrelRoof', 'capsuleWhite',
    'interiorWall', 'timber', 'timberDark', 'deckBoards', 'hedge', 'leaf', 'bark',
    'chrome', 'steel']);
  const mk = (name, p) => {
    const m = new THREE.MeshStandardMaterial(p);
    m.name = name;
    m.userData.textured = TEXTURED.has(name) || name.startsWith('signText(');
    return m;
  };
  const get = (key, make) => { let m = cache.get(key); if (!m) { m = make(); cache.set(key, m); } return m; };
  const fixed = {
    concrete: { roughness: 1 }, paving: { roughness: 1 }, asphalt: { roughness: 1 },
    kerb: { roughness: 1 }, lawn: { roughness: 1 }, sand: { roughness: 1 },
    stuccoCream: { roughness: 1 }, stuccoTerracotta: { roughness: 1 },
    roofWhite: { roughness: 1, metalness: 0.05 }, solar: { roughness: 0.25, metalness: 0.35 },
    barrelRoof: { roughness: 1, metalness: 0.15 }, capsuleWhite: { roughness: 1, metalness: 0.02 },
    interiorWall: { roughness: 0.85 },
    roofGlazing: { roughness: 0.14, metalness: 0.1, transparent: true, opacity: 0.86 },
    glass: { roughness: 0.08, transparent: true, opacity: 0.42 },
    windowDark: { roughness: 0.12, metalness: 0.16 },
    timber: { roughness: 1 }, timberDark: { roughness: 1 }, deckBoards: { roughness: 1 },
    hedge: { roughness: 1 }, leaf: { roughness: 1 }, bark: { roughness: 1 },
    chrome: { roughness: 1, metalness: 0.95 }, steel: { roughness: 1, metalness: 0.7 },
  };
  const lib = {};
  for (const [k, p] of Object.entries(fixed)) lib[k] = get(k, () => mk(k, p));
  const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
  lib.painted = (color, rough = 0.42, metal = 0.25) =>
    get('p' + color + '_' + rough + '_' + metal,
      () => mk('painted(' + hex(color) + ',' + rough + ',' + metal + ')',
        { color, roughness: rough, metalness: metal }));
  lib.operator = (rough = 0.9, metal = 0) =>
    get('op' + rough + '_' + metal, () => mk('operator', { roughness: rough, metalness: metal }));
  lib.emissive = (color, strength = 1.4) =>
    get('e' + color + '_' + strength, () => mk('emissive(' + hex(color) + ')', { color, roughness: 0.5 }));
  lib.signText = (o) => get('s' + o.text + '|' + o.color + '|' + o.background + '|' + o.aspect + '|' + o.script + '|' + o.glow,
    () => mk('signText(' + JSON.stringify(o.text) + (o.background === undefined ? ',transparent' : '') + ')', {
      transparent: o.background === undefined, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide,
    }));
  lib.dispose = () => {};
  // Any key this stub does not know is still a material, and is named so the
  // report shows what materials.ts grew since this list was written.
  return new Proxy(lib, {
    get(t, k) {
      if (k in t || typeof k !== 'string') return t[k];
      return get('unknown:' + k, () => mk(k + '?', { roughness: 1 }));
    },
  });
}

export function run() {
  const mat = stubMaterials();
  const modules = [];
  for (const [name, build] of BUILDERS) {
    const res = build({ mat, rand: makeRng('nuketown-2025:' + name) });
    res.group.name = name;
    res.group.updateMatrixWorld(true);
    modules.push({ name, group: res.group, colliders: res.colliders });
  }
  return { THREE, modules };
}
`;

/** vehicles.ts calls batchStatic on every parked vehicle; a no-op keeps the parts. */
const stubBatcher = {
  name: 'stub-static-batch',
  setup(b) {
    b.onResolve({ filter: /static-batch$/ }, () => ({ path: 'static-batch', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export function batchStatic(){ return { left:{}, hazards:[], groups:0, pruned:0, meshesBefore:0, meshesAfter:0 }; }',
      loader: 'js',
    }));
  },
};

const outDir = join(tmpdir(), 'aa-coplanar');
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, 'map-' + Date.now() + '.mjs');
await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'map.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  define: { 'import.meta.env.DEV': 'false' },
  plugins: BATCHED ? [] : [stubBatcher],
  outfile,
  logLevel: 'warning',
});
const { THREE, modules } = (await import(pathToFileURL(outfile).href)).run();

// ------------------------------------------------------------ collider dump
if (COLLIDERS_OUT) {
  const lines = [];
  for (const m of modules) {
    m.colliders.forEach((c, i) => lines.push(m.name + '[' + i + '] '
      + [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z].join(',')));
  }
  writeFileSync(COLLIDERS_OUT, lines.join('\n') + '\n');
}

// ---------------------------------------------------------- triangle harvest
/**
 * One record per triangle: which mesh instance, which quantised plane, and the
 * three world-space vertices. Stored in growable typed arrays - the map is a
 * few hundred thousand triangles and object-per-triangle would not fit comfortably.
 */
const instances = [];      // { module, name, material, matName, transparent, doubleSide, geoType, box: {inv, hx,hy,hz} | null }
let cap = 1 << 18;
let tInst = new Int32Array(cap);
let tPlane = new Int32Array(cap);   // index into planeKeys
let tOff = new Float64Array(cap);
let tSign = new Int8Array(cap);
let tPos = new Float64Array(cap * 9);
let nTri = 0;
const planeKeys = [];     // canonical normal per plane-direction key
const planeIndex = new Map();
let skippedHidden = 0;
let skippedDegenerate = 0;
let skippedNonMesh = 0;

function grow() {
  cap *= 2;
  const g = (arr, n) => { const b = new arr.constructor(n); b.set(arr); return b; };
  tInst = g(tInst, cap); tPlane = g(tPlane, cap); tOff = g(tOff, cap); tSign = g(tSign, cap);
  tPos = g(tPos, cap * 9);
}

/** Canonical plane direction: axis-snapped, sign-canonicalised, quantised. */
function planeKeyFor(nx, ny, nz) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const cosTol = Math.cos(AXIS_TOL);
  // snap KEEPS the sign: a box bottom (-y) and the slab under it (+y) must land in
  // one plane group as OPPOSITE faces, not be folded into +y and read as the same.
  let cx = nx, cy = ny, cz = nz;
  if (ax >= cosTol) { cx = nx < 0 ? -1 : 1; cy = 0; cz = 0; }
  else if (ay >= cosTol) { cx = 0; cy = ny < 0 ? -1 : 1; cz = 0; }
  else if (az >= cosTol) { cx = 0; cy = 0; cz = nz < 0 ? -1 : 1; }
  // sign: first component with |v| > 1e-6 is made positive
  let s = 1;
  if (Math.abs(cx) > 1e-6) s = cx < 0 ? -1 : 1;
  else if (Math.abs(cy) > 1e-6) s = cy < 0 ? -1 : 1;
  else s = cz < 0 ? -1 : 1;
  cx *= s; cy *= s; cz *= s;
  const qx = Math.round(cx / NORMAL_Q), qy = Math.round(cy / NORMAL_Q), qz = Math.round(cz / NORMAL_Q);
  const key = qx + ',' + qy + ',' + qz;
  let idx = planeIndex.get(key);
  if (idx === undefined) {
    idx = planeKeys.length;
    planeIndex.set(key, idx);
    // the representative normal: exact axis if snapped, else the first seen (renormalised)
    const len = Math.hypot(cx, cy, cz);
    planeKeys.push({ key, n: [cx / len, cy / len, cz / len], axis: qy === 0 && qz === 0 ? 'x' : (qx === 0 && qz === 0 ? 'y' : (qx === 0 && qy === 0 ? 'z' : null)) });
  }
  return { idx, sign: s };
}

const _m = new THREE.Matrix4();
const _v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

function harvestMesh(mesh, moduleName, instanceMatrix, instTag) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  if (!pos) return;
  const idx = geo.index;
  const count = idx ? idx.count : pos.count;
  const world = instanceMatrix ? _m.multiplyMatrices(mesh.matrixWorld, instanceMatrix) : mesh.matrixWorld;
  const det = world.determinant();
  const mat = mesh.material;
  const m0 = Array.isArray(mat) ? mat[0] : mat;
  // a named ancestor gives the part a human handle
  let nameNode = mesh;
  while (nameNode && !nameNode.name && nameNode.parent) nameNode = nameNode.parent;
  const baseName = (mesh.name || (nameNode && nameNode.name) || mesh.type) + (instTag !== undefined ? '#' + instTag : '');
  const geoType = geo.type || 'BufferGeometry';
  const inst = {
    module: moduleName, name: baseName, matName: m0 ? m0.name : '?',
    transparent: !!(m0 && m0.transparent), doubleSide: !!(m0 && m0.side === THREE.DoubleSide),
    roughness: m0 && m0.roughness !== undefined ? m0.roughness : 1,
    textured: !!(m0 && m0.userData && m0.userData.textured),
    geoType, box: null, planes: new Set(), flat: false,
  };
  if (geoType === 'BoxGeometry' && !inst.transparent && geo.parameters) {
    // closed opaque box: a candidate encloser. Local frame test handles yawed boxes.
    const p = geo.parameters;
    inst.box = { inv: world.clone().invert(), hx: p.width / 2, hy: p.height / 2, hz: p.depth / 2 };
  }
  const instId = instances.length;
  instances.push(inst);
  const e = world.elements;
  const X = (i) => pos.getX(i), Y = (i) => pos.getY(i), Z = (i) => pos.getZ(i);
  for (let t = 0; t < count; t += 3) {
    const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
    const ids = [i0, i1, i2];
    for (let k = 0; k < 3; k++) {
      const lx = X(ids[k]), ly = Y(ids[k]), lz = Z(ids[k]);
      _v[k].set(
        e[0] * lx + e[4] * ly + e[8] * lz + e[12],
        e[1] * lx + e[5] * ly + e[9] * lz + e[13],
        e[2] * lx + e[6] * ly + e[10] * lz + e[14]);
    }
    const ax = _v[1].x - _v[0].x, ay = _v[1].y - _v[0].y, az = _v[1].z - _v[0].z;
    const bx = _v[2].x - _v[0].x, by = _v[2].y - _v[0].y, bz = _v[2].z - _v[0].z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len2 = Math.hypot(nx, ny, nz);
    if (len2 * 0.5 < MIN_TRI_AREA) { skippedDegenerate++; continue; }
    nx /= len2; ny /= len2; nz /= len2;
    if (det < 0) { nx = -nx; ny = -ny; nz = -nz; }   // mirrored placement flips winding
    const pk = planeKeyFor(nx, ny, nz);
    const n = planeKeys[pk.idx].n;
    const off = n[0] * _v[0].x + n[1] * _v[0].y + n[2] * _v[0].z;
    if (nTri >= cap) grow();
    inst.planes.add(pk.idx * 2 + (pk.sign > 0 ? 1 : 0));
    tInst[nTri] = instId; tPlane[nTri] = pk.idx; tOff[nTri] = off; tSign[nTri] = pk.sign;
    const o = nTri * 9;
    for (let k = 0; k < 3; k++) { tPos[o + k * 3] = _v[k].x; tPos[o + k * 3 + 1] = _v[k].y; tPos[o + k * 3 + 2] = _v[k].z; }
    nTri++;
  }
}

const perModuleTris = {};
for (const m of modules) {
  const before = nTri;
  m.group.traverse((o) => {
    if (!o.visible) { if (o !== m.group) skippedHidden++; return; }
    if (!o.isMesh) { if (o !== m.group && !o.isGroup && o.type !== 'Object3D') skippedNonMesh++; return; }
    // an ancestor switched off hides the whole subtree
    for (let p = o.parent; p && p !== m.group; p = p.parent) if (!p.visible) { skippedHidden++; return; }
    if (o.isInstancedMesh) {
      const im = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); harvestMesh(o, m.name, im, i); }
    } else {
      harvestMesh(o, m.name, null, undefined);
    }
  });
  perModuleTris[m.name] = nTri - before;
}
// a FLAT instance has every triangle on one plane (a PlaneGeometry, a ShapeGeometry,
// a hand-built quad): with a DoubleSide material its back face IS its front face.
for (const inst of instances) { inst.flat = inst.planes.size === 1; inst.planes = null; }

// --------------------------------------------------------------- plane groups
// Sort triangle indices by (plane key, offset); cluster offsets closer than OFFSET_TOL.
const order = new Int32Array(nTri);
for (let i = 0; i < nTri; i++) order[i] = i;
const orderArr = Array.from(order);
orderArr.sort((a, b) => (tPlane[a] - tPlane[b]) || (tOff[a] - tOff[b]));

/** 2D basis for a plane: u = n x a (a = the axis least aligned with n), v = n x u. */
function basisFor(n) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  let a;
  if (ax <= ay && ax <= az) a = [1, 0, 0]; else if (ay <= az) a = [0, 1, 0]; else a = [0, 0, 1];
  let u = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const lu = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / lu, u[1] / lu, u[2] / lu];
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, v };
}

/** Sutherland-Hodgman: area of convex polygon A clipped to convex polygon B (both CCW or CW - handled). */
function polyArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) { const j = (i + 1) % n; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; }
  return a / 2;
}
function ensureCCW(p) { return polyArea(p) < 0 ? p.slice().reverse() : p; }
/** Sutherland-Hodgman clip returning the polygon itself (for area + centroid). */
function clipPoly(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inp = out; out = [];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j], Q = inp[(j + 1) % inp.length];
      const sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
      }
    }
  }
  return out.length >= 3 ? out : null;
}
function clipConvex(subject, clip) {
  const p = clipPoly(subject, clip);
  return p ? Math.abs(polyArea(p)) : 0;
}
/** Area-weighted centroid of a polygon (2D). */
function polyCentroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const j = (i + 1) % n;
    const c = p[i][0] * p[j][1] - p[j][0] * p[i][1];
    a += c; cx += (p[i][0] + p[j][0]) * c; cy += (p[i][1] + p[j][1]) * c;
  }
  a /= 2;
  return Math.abs(a) < 1e-12 ? [p[0][0], p[0][1]] : [cx / (6 * a), cy / (6 * a)];
}

/** Union-find over triangles of one instance sharing a (quantised) vertex. */
function components(triIds, uv) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
  for (const t of triIds) parent.set(t, t);
  const byVert = new Map();
  for (const t of triIds) {
    for (let k = 0; k < 3; k++) {
      const key = Math.round(uv[t][k][0] / VERT_Q) + ',' + Math.round(uv[t][k][1] / VERT_Q);
      const prev = byVert.get(key);
      if (prev === undefined) byVert.set(key, t); else union(prev, t);
    }
  }
  const groups = new Map();
  for (const t of triIds) { const r = find(t); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); }
  return [...groups.values()];
}

const pairs = [];
let faceCount = 0;
let planeCount = 0;

/**
 * Is the overlap region BURIED on the given side of its plane? The region is
 * sampled on a grid (its corners inset by a hair, plus interior points) and every
 * sample must lie inside SOME opaque closed box that extends from the plane, or
 * from behind it, strictly forward along +side*n - the desert under a road slab,
 * a lawn pad's side face inside the yard plateau, a wall base covered by a garage
 * pad on one half and the lawn on the other. A box whose FRONT boundary is this
 * plane is the coplanar pair itself and does not count. Tested in each box's own
 * frame, so yawed boxes work; a normal that is not one of the box's axes falls
 * back to strict containment. Returns the box that buried the first sample.
 */
const _lp = new THREE.Vector3();
const _ln = new THREE.Vector3();
function pointBuriedBy(p, n, side, exclude) {
  outer: for (let i = 0; i < instances.length; i++) {
    const b = instances[i].box;
    if (!b || exclude.has(i)) continue;
    _ln.set(n[0] * side, n[1] * side, n[2] * side).transformDirection(b.inv);
    const h = [b.hx, b.hy, b.hz];
    let k = -1;
    if (Math.abs(_ln.x) > 0.9999) k = 0; else if (Math.abs(_ln.y) > 0.9999) k = 1; else if (Math.abs(_ln.z) > 0.9999) k = 2;
    const dir = k >= 0 ? Math.sign(_ln.getComponent(k)) : 0;
    _lp.set(p[0], p[1], p[2]).applyMatrix4(b.inv);
    for (let a = 0; a < 3; a++) {
      const c = _lp.getComponent(a);
      if (a === k) {
        // along the normal: from the back boundary (inclusive) to strictly short of the front
        if (dir > 0 ? (c < -h[a] - ENCLOSE_EPS || c > h[a] - ENCLOSE_EPS) : (c > h[a] + ENCLOSE_EPS || c < -h[a] + ENCLOSE_EPS)) continue outer;
      } else if (Math.abs(c) > h[a] + ENCLOSE_EPS) continue outer;   // across: touching the box's edge still counts
    }
    return i;
  }
  return -1;
}
function buriedBy(samples, n, side, exclude) {
  let first = -1;
  for (const p of samples) {
    const i = pointBuriedBy(p, n, side, exclude);
    if (i < 0) return null;
    if (first < 0) first = i;
  }
  return instances[first].module + ':' + instances[first].name;
}

function processPlane(triIds, plane, off) {
  planeCount++;
  const { u, v } = basisFor(plane.n);
  // project triangles
  const uv = {};
  const byInst = new Map();
  for (const t of triIds) {
    const o = t * 9;
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const x = tPos[o + k * 3], y = tPos[o + k * 3 + 1], z = tPos[o + k * 3 + 2];
      tri.push([u[0] * x + u[1] * y + u[2] * z, v[0] * x + v[1] * y + v[2] * z]);
    }
    uv[t] = ensureCCW(tri);
    const id = tInst[t];
    if (!byInst.has(id)) byInst.set(id, []);
    byInst.get(id).push(t);
  }
  // faces = connected components per instance
  const faces = [];
  for (const [instId, ts] of byInst) {
    for (const comp of components(ts, uv)) {
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity, area = 0;
      let sPos = 0, sNeg = 0;
      for (const t of comp) {
        for (const p of uv[t]) { if (p[0] < minU) minU = p[0]; if (p[0] > maxU) maxU = p[0]; if (p[1] < minV) minV = p[1]; if (p[1] > maxV) maxV = p[1]; }
        area += Math.abs(polyArea(uv[t]));
        if (tSign[t] > 0) sPos++; else sNeg++;
      }
      faces.push({ instId, tris: comp, minU, minV, maxU, maxV, area, sign: sPos >= sNeg ? 1 : -1, mixed: sPos > 0 && sNeg > 0 });
    }
  }
  faceCount += faces.length;
  if (faces.length < 2) return;
  faces.sort((a, b) => a.minU - b.minU);
  for (let i = 0; i < faces.length; i++) {
    const A = faces[i];
    for (let j = i + 1; j < faces.length; j++) {
      const B = faces[j];
      if (B.minU >= A.maxU) break;
      const ovU = Math.min(A.maxU, B.maxU) - Math.max(A.minU, B.minU);
      const ovV = Math.min(A.maxV, B.maxV) - Math.max(A.minV, B.minV);
      if (ovU <= 0 || ovV <= 0 || ovU * ovV <= MIN_AREA) continue;
      // exact overlap: sum of pairwise convex clips, and where that overlap actually is
      // (a bbox centre says nothing useful about two 5000 m2 sheets that only touch in
      // a corner)
      let area = 0, cu = 0, cv = 0;
      let oU0 = Infinity, oV0 = Infinity, oU1 = -Infinity, oV1 = -Infinity;
      const patches = [];   // the largest clipped pieces, so a big pair can be FOUND
      for (const ta of A.tris) {
        const pa = uv[ta];
        for (const tb of B.tris) {
          const poly = clipPoly(pa, uv[tb]);
          if (!poly) continue;
          const pa2 = Math.abs(polyArea(poly));
          if (pa2 <= 0) continue;
          const c = polyCentroid(poly);
          area += pa2; cu += c[0] * pa2; cv += c[1] * pa2;
          for (const q of poly) { if (q[0] < oU0) oU0 = q[0]; if (q[0] > oU1) oU1 = q[0]; if (q[1] < oV0) oV0 = q[1]; if (q[1] > oV1) oV1 = q[1]; }
          if (patches.length < 6 || pa2 > patches[patches.length - 1].a) {
            patches.push({ a: pa2, c });
            patches.sort((x, y) => y.a - x.a);
            if (patches.length > 6) patches.pop();
          }
        }
      }
      if (area <= MIN_AREA) continue;
      cu /= area; cv /= area;
      const ia = instances[A.instId], ib = instances[B.instId];
      const same = A.sign === B.sign;
      // overlap region -> 3D corners for the enclosure test
      const u0 = oU0, u1 = oU1, v0 = oV0, v1 = oV1;
      const to3 = (uu, vv) => [
        plane.n[0] * off + u[0] * uu + v[0] * vv,
        plane.n[1] * off + u[1] * uu + v[1] * vv,
        plane.n[2] * off + u[2] * uu + v[2] * vv];
      const corners = [to3(u0, v0), to3(u1, v0), to3(u1, v1), to3(u0, v1)];
      const centre = to3(cu, cv);
      // burial samples: a 4x4 grid over the overlap rect, edges pulled in by 1 mm so a
      // face that reaches exactly to a covering box's edge is judged by what covers it
      const samples = [];
      const inU = Math.min(0.001, (u1 - u0) / 4), inV = Math.min(0.001, (v1 - v0) / 4);
      for (let gi = 0; gi < 4; gi++) for (let gj = 0; gj < 4; gj++) {
        samples.push(to3(u0 + inU + (u1 - u0 - 2 * inU) * gi / 3, v0 + inV + (v1 - v0 - 2 * inV) * gj / 3));
      }
      // Under the floor nothing is seen: ground.ts covers y=0 wall to wall with opaque
      // desert / apron / fringe and the player never goes below it. A face whose
      // overlap sits below y=0, or a downward face lying ON y=0 (box bottoms on the
      // desert: culled from every camera the game can have), cannot dither.
      const maxY = Math.max(...corners.map((c) => c[1]));
      const facesDown = plane.axis === 'y' && A.sign < 0 && B.sign < 0;
      const belowFloor = maxY < -1e-6 || (facesDown && Math.abs(off) < 1e-6)
        || (plane.axis !== 'y' && maxY <= 1e-6);
      const excl = new Set([A.instId, B.instId]);
      // a same-normal pair is hidden when buried on ITS front side; an opposite pair
      // only when both sides are covered
      let enclosed = belowFloor ? 'ground:desert floor (y<=0)' : null;
      if (!enclosed) {
        if (same) enclosed = buriedBy(samples, plane.n, A.sign, excl);
        else { const f = buriedBy(samples, plane.n, 1, excl); enclosed = f && buriedBy(samples, plane.n, -1, excl) ? f : null; }
      }
      const glossy = (x) => x.transparent || x.doubleSide || x.roughness < 0.3;
      // a back-to-back pair dithers only if one face is a flat DoubleSide sheet (its
      // back face IS the plane); a box with a DoubleSide material hides its own back
      const sheet = (ia.doubleSide && ia.flat) || (ib.doubleSide && ib.flat);
      const sameMaterial = ia.matName === ib.matName;
      const fight = !enclosed && (same || sheet);
      // two faces of one unmapped colour shade identically: the fight is real in the
      // depth buffer and invisible on screen. Anything mapped (or two materials) shows.
      const visible = fight && (!sameMaterial || ia.textured || ib.textured);
      pairs.push({
        area: +area.toFixed(5),
        plane: plane.axis ? plane.axis + '=' + off.toFixed(4) : 'n(' + plane.n.map((c) => c.toFixed(4)).join(',') + ')@' + off.toFixed(4),
        axis: plane.axis, normal: plane.n.map((c) => +c.toFixed(5)), offset: +off.toFixed(5),
        normals: same ? 'same' : 'opposite',
        fight,
        visible,
        sameMaterial,
        enclosed,
        centre: centre.map((c) => +c.toFixed(3)),
        extent: [+(u1 - u0).toFixed(3), +(v1 - v0).toFixed(3)],
        quad: corners.map((c) => c.map((x) => +x.toFixed(4))),
        patches: patches.map((q) => ({ area: +q.a.toFixed(4), at: to3(q.c[0], q.c[1]).map((c) => +c.toFixed(3)) })),
        a: { module: ia.module, part: ia.name, material: ia.matName, textured: ia.textured, geo: ia.geoType, faceArea: +A.area.toFixed(4), glossy: glossy(ia), transparent: ia.transparent, doubleSide: ia.doubleSide, flat: ia.flat, mixedWinding: A.mixed },
        b: { module: ib.module, part: ib.name, material: ib.matName, textured: ib.textured, geo: ib.geoType, faceArea: +B.area.toFixed(4), glossy: glossy(ib), transparent: ib.transparent, doubleSide: ib.doubleSide, flat: ib.flat, mixedWinding: B.mixed },
      });
    }
  }
}

let start = 0;
while (start < orderArr.length) {
  const p = tPlane[orderArr[start]];
  let end = start;
  // one cluster: consecutive same-plane triangles whose offsets step by < OFFSET_TOL
  while (end + 1 < orderArr.length && tPlane[orderArr[end + 1]] === p
    && tOff[orderArr[end + 1]] - tOff[orderArr[end]] < OFFSET_TOL) end++;
  const ids = orderArr.slice(start, end + 1);
  // more than one instance, or one instance with several triangles, can only pair up if >= 2 tris
  if (ids.length >= 2) {
    let off = 0;
    for (const t of ids) off += tOff[t];
    processPlane(ids, planeKeys[p], off / ids.length);
  }
  start = end + 1;
}

// ------------------------------------------------------------------- report
pairs.sort((a, b) => b.area - a.area);
const touches = (p) => !MODULE || p.a.module === MODULE || p.b.module === MODULE;
const shown = pairs.filter((p) => touches(p) && (ALL || p.fight) && p.area >= MIN_AREA);
const fights = pairs.filter((p) => p.fight);
const byModule = {};
const bump = (k, p) => {
  const r = byModule[k] || (byModule[k] = { pairs: 0, fights: 0, fightsOver001: 0, visibleOver001: 0 });
  r.pairs++;
  if (p.fight) { r.fights++; if (p.area > 0.01) { r.fightsOver001++; if (p.visible) r.visibleOver001++; } }
};
for (const p of pairs) {
  bump(p.a.module, p);
  if (p.b.module !== p.a.module) bump(p.b.module, p);
}
const summary = {
  when: new Date().toISOString(),
  batched: BATCHED,
  triangles: nTri,
  perModuleTris,
  planes: planeCount,
  faces: faceCount,
  skipped: { hidden: skippedHidden, degenerate: skippedDegenerate, nonMesh: skippedNonMesh },
  pairs: pairs.length,
  pairsOver001: pairs.filter((p) => p.area > 0.01).length,
  fights: fights.length,
  fightsOver001: fights.filter((p) => p.area > 0.01).length,
  sameNormal: pairs.filter((p) => p.normals === 'same').length,
  visibleOver001: fights.filter((p) => p.visible && p.area > 0.01).length,
  fightsSameMaterial: fights.filter((p) => p.sameMaterial).length,
  fightsDifferentMaterialOver001: fights.filter((p) => !p.sameMaterial && p.area > 0.01).length,
  enclosed: pairs.filter((p) => p.enclosed).length,
  byModule,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, pairs }, null, 1));

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const f = (n, w) => String(n).padStart(w);
  console.log('[coplanar] ' + nTri + ' triangles in ' + modules.length + ' modules -> ' + planeCount
    + ' planes, ' + faceCount + ' faces' + (BATCHED ? ' (batched)' : '')
    + '; skipped hidden ' + skippedHidden + ', degenerate ' + skippedDegenerate);
  console.log('[coplanar] pairs overlapping > ' + MIN_AREA + ' m2: ' + pairs.length
    + '   (> 0.01 m2: ' + summary.pairsOver001 + ')');
  console.log('[coplanar] FIGHTS (same-normal, or a flat DoubleSide sheet, not buried): ' + fights.length
    + '   (> 0.01 m2: ' + summary.fightsOver001 + '; of those with DIFFERENT materials: '
    + summary.fightsDifferentMaterialOver001 + ', same material ' + (summary.fightsOver001 - summary.fightsDifferentMaterialOver001) + ')');
  console.log('[coplanar] VISIBLE fights > 0.01 m2 (different materials, or a mapped one): ' + summary.visibleOver001
    + '   (same unmapped colour both sides shades identically and is left out)');
  console.log('[coplanar] by module:      pairs  fights  fights>0.01  visible>0.01');
  for (const [k, r] of Object.entries(byModule).sort((a, b) => b[1].fights - a[1].fights)) {
    console.log('   ' + k.padEnd(16) + f(r.pairs, 6) + f(r.fights, 8) + f(r.fightsOver001, 13) + f(r.visibleOver001, 14));
  }
  // Families: the same two kinds of part on the same axis, however many times the
  // map repeats them. This is the view the sweep works from - one fix per family.
  const fam = new Map();
  const base = (s) => s.replace(/#\d+$/, '');
  for (const p of shown) {
    const sa = p.a.module + ': ' + base(p.a.part) + ' [' + p.a.material + ']';
    const sb = p.b.module + ': ' + base(p.b.part) + ' [' + p.b.material + ']';
    const [x, y] = sa < sb ? [sa, sb] : [sb, sa];
    const k = x + '  <>  ' + y + '  ' + (p.axis ? p.axis : 'n') + ' ' + p.normals
      + (p.sameMaterial ? (p.visible ? ' SAME-MAT(mapped)' : ' SAME-MAT(flat: invisible)') : '');
    const r = fam.get(k) || { n: 0, area: 0, max: 0, at: p.centre, plane: p.plane };
    r.n++; r.area += p.area; if (p.area > r.max) { r.max = p.area; r.at = p.centre; r.plane = p.plane; }
    fam.set(k, r);
  }
  const fams = [...fam.entries()].sort((a, b) => b[1].area - a[1].area);
  console.log('');
  console.log('[coplanar] families (' + fams.length + '), by total area:');
  console.log('      n   total m2   max m2   plane@max         pair');
  for (const [k, r] of fams.slice(0, TOP)) {
    console.log('  ' + f(r.n, 5) + f(r.area.toFixed(3), 11) + f(r.max.toFixed(3), 9) + '   '
      + r.plane.padEnd(18).slice(0, 18) + ' ' + k + '   e.g. @(' + r.at.join(', ') + ')');
  }
  console.log('');
  console.log('[coplanar] ' + (ALL ? 'all pairs' : 'fights') + (MODULE ? ' touching ' + MODULE : '')
    + ', largest first (' + Math.min(TOP, shown.length) + ' of ' + shown.length + '):');
  console.log('   area m2  plane              nrm  encl  vis  A (module: part [material])  ->  B');
  for (const p of shown.slice(0, TOP)) {
    console.log('  ' + p.area.toFixed(4).padStart(8) + '  ' + p.plane.padEnd(18).slice(0, 18) + ' '
      + (p.normals === 'same' ? 'same' : 'opp ') + '  ' + (p.enclosed ? 'yes ' : 'no  ') + ' '
      + (p.visible ? 'VIS  ' : (p.fight ? 'flat ' : '-    '))
      + p.a.module + ': ' + p.a.part + ' [' + p.a.material + ']  ->  '
      + p.b.module + ': ' + p.b.part + ' [' + p.b.material + ']'
      + '   @(' + p.centre.join(', ') + ')');
  }
  console.log('');
  console.log('[coplanar] report: ' + OUT);
  console.log('[coplanar] count: ' + pairs.length + ' pairs, ' + fights.length + ' fights, '
    + summary.fightsOver001 + ' fights over 0.01 m2, ' + summary.visibleOver001 + ' of them visible');
}
