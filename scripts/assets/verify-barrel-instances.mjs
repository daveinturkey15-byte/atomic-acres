#!/usr/bin/env node
/**
 * CPU proof harness for the industrial-barrel canary. No GPU, no browser, no server,
 * no thresholds weakened: every number below is asserted, not printed for decoration.
 *
 * Binds to REAL artifacts only:
 *   - src TS compiled to work/barrel-verify-build (tsc, CPU only) and imported, so
 *     INDUSTRIAL_BARREL_PLACEMENTS, industrialBarrelCollider, INDUSTRIAL_BARREL_SIZE
 *     and the layout constants are the shipped ones, never a mirrored copy;
 *   - public/assets/industrial-barrel/industrial-barrel.glb parsed directly;
 *   - docs/verification/2026-09-19/collider-snapshot.json - the exact complete
 *     collider list returned by the built page's __NT.colliderSnapshot() API.
 *
 * Proves:
 *   1. source claims: one primitive, one material, 1473 triangles, envelope = SIZE;
 *   2. enclosure: each placement's instance world bounds (GLB envelope through the
 *      instance matrix) sit inside its industrialBarrelCollider AABB, y included;
 *   3. clearance: >= 0.45 m (0.4 m walking gap + 0.05 m snapshot QA margin) to every
 *      snapshot collider that vertically overlaps the barrel span;
 *   4. placement law: outside every door apron (both houses, front + back), >= 0.6 m
 *      from each spawn point, inside the back-yard band [HOUSE_BACK, BACK_FENCE-0.6]
 *      x [YARD_X_MIN+0.3, YARD_X_MAX-0.3].
 *
 * Failing placements print the nearest valid position from a deterministic radial
 * search (0.05 m grid, same constraints). Exit 0 only when every check passes.
 *
 * Run: node --max-old-space-size=1536 scripts/assets/verify-barrel-instances.mjs
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'work', 'barrel-verify-build');
const GLB_PATH = join(ROOT, 'public', 'assets', 'industrial-barrel', 'industrial-barrel.glb');
const SNAPSHOT_PATH = join(ROOT, 'docs', 'verification', '2026-09-19', 'collider-snapshot.json');

const WALKING_GAP = 0.4;
const QA_MARGIN = 0.05;            // snapshot scope: "require .05m extra margin"
const CLEAR_GAP = WALKING_GAP + QA_MARGIN;
const SPAWN_CLEAR = 0.6;           // stand-and-turn room around a spawn point
const ENCLOSURE_TOL = 0.001;       // exactly the millimetre rounding bound of SIZE
const VERTICAL_EPS = 0.02;         // touching faces are not overlaps
const SEARCH_RADIUS = 3.0;
const SEARCH_STEP = 0.05;

// ---------------------------------------------------------------- compile + import
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'package.json'), JSON.stringify({ type: 'module' }));
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
const compiled = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--noEmit', 'false', '--outDir', OUT_DIR], { cwd: ROOT, encoding: 'utf8' });
if (compiled.status !== 0) {
  console.error(compiled.stdout, compiled.stderr);
  throw new Error('tsc failed - the proof compiles the real source or it proves nothing');
}
// Node ESM needs explicit extensions; tsc emits extensionless relative specifiers.
function fixEsmExtensions(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) fixEsmExtensions(p);
    else if (entry.name.endsWith('.js')) {
      const code = readFileSync(p, 'utf8');
      const fixed = code.replace(/(\bfrom\s+'|\bimport\s+')(\.[^']*?)(')/g,
        (m, head, spec, tail) => head + (spec.endsWith('.js') || spec.endsWith('.json') ? spec : `${spec}.js`) + tail);
      if (fixed !== code) writeFileSync(p, fixed);
    }
  }
}
fixEsmExtensions(OUT_DIR);
const mod = (p) => import(pathToFileURL(join(OUT_DIR, 'src', p)).href);
const barrels = await mod('build/industrial-barrels.js');
const props = await mod('props/industrial-barrel.js');
const layout = await mod('core/layout.js');

// ---------------------------------------------------------------- tiny glTF reader
function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const payload = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(payload.toString('utf8'));
    else if (type === 0x004e4942) bin = payload;
    off += 8 + len;
  }
  return { json, bin };
}

function accessorBounds(gl, index) {
  const a = gl.json.accessors[index];
  if (a.type !== 'VEC3' || a.componentType !== 5126) throw new Error(`POSITION accessor ${index} not VEC3/f32`);
  if (a.min && a.max) return { min: a.min, max: a.max, count: a.count };
  const bv = gl.json.bufferViews[a.bufferView];
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? 12;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < 3; c++) {
      const v = gl.bin.readFloatLE(base + i * stride + c * 4);
      min[c] = Math.min(min[c], v);
      max[c] = Math.max(max[c], v);
    }
  }
  return { min, max, count: a.count };
}

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0];
  const q = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  const m = I4.slice();
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) m[c * 4 + rr] = r[c * 4 + rr] * s[c];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}
function place(x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1];
}
function xform(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
function aabbOfPoints(pts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let c = 0; c < 3; c++) {
    min[c] = Math.min(min[c], p[c]);
    max[c] = Math.max(max[c], p[c]);
  }
  return { min, max };
}
function corners(b) {
  const pts = [];
  for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) {
    pts.push([i ? b.max[0] : b.min[0], j ? b.max[1] : b.min[1], k ? b.max[2] : b.min[2]]);
  }
  return pts;
}

// ---------------------------------------------------------------- source claims
const gl = parseGlb(readFileSync(GLB_PATH));
const gltf = gl.json;
let primCount = 0;
let triCount = 0;
const materialSet = new Set();
let positionBounds = null;
for (const mesh of gltf.meshes) {
  for (const prim of mesh.primitives) {
    primCount += 1;
    if (prim.material !== undefined) materialSet.add(prim.material);
    const mode = prim.mode ?? 4;
    if (mode !== 4) throw new Error(`primitive mode ${mode} is not TRIANGLES`);
    const indexCount = prim.indices !== undefined ? gltf.accessors[prim.indices].count : 0;
    const pos = accessorBounds(gl, prim.attributes.POSITION);
    triCount += Math.round((indexCount || pos.count) / 3);
    if (primCount === 1) positionBounds = pos;
  }
}
const claims = [];
function claim(ok, label, detail) {
  claims.push({ ok, label, detail });
  if (!ok) console.error(`FAIL ${label}: ${detail}`);
}
claim(primCount === 1, 'one primitive', `found ${primCount}`);
claim(materialSet.size === 1, 'one material', `found ${materialSet.size}`);
claim(triCount === 1473, '1473 triangles', `found ${triCount}`);

// master-space envelope: the mesh node chain inside gltf.scene, root excluded
const scene = gltf.scenes[gltf.scene ?? 0];
const baseChains = [];
const walk = (nodeIndex, parent) => {
  const node = gltf.nodes[nodeIndex];
  const m = mul(parent, nodeMatrix(node));
  if (node.mesh !== undefined) baseChains.push({ mesh: node.mesh, matrix: m });
  for (const child of node.children ?? []) walk(child, m);
};
for (const rootIndex of scene.nodes) walk(rootIndex, I4);
claim(baseChains.length === 1, 'one mesh node in the scene', `found ${baseChains.length}`);
const base = baseChains[0].matrix;
const masterBox = aabbOfPoints(corners(positionBounds).map((p) => xform(base, p)));
const masterExtent = masterBox.max.map((v, c) => v - masterBox.min[c]);
const size = props.INDUSTRIAL_BARREL_SIZE;
const sizeDelta = masterExtent.map((v, c) => Math.abs(v - [size.x, size.y, size.z][c]));
claim(Math.max(...sizeDelta) <= 0.01, 'GLB envelope matches INDUSTRIAL_BARREL_SIZE',
  `extents ${masterExtent.map((v) => v.toFixed(3))} vs size ${[size.x, size.y, size.z]} delta ${sizeDelta.map((v) => v.toFixed(4))}`);

// ---------------------------------------------------------------- placement checks
const placements = barrels.INDUSTRIAL_BARREL_PLACEMENTS;
claim(placements.length === 4, 'four placements', `found ${placements.length}`);
const GROUND_Y = layout.KERB_HEIGHT + 0.001;

const toBox = (v) => ({ min: [v.min.x, v.min.y, v.min.z], max: [v.max.x, v.max.y, v.max.z] });
const gapXZ = (a, b) => {
  const dx = Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const dz = Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
};

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
const snapBoxes = Array.isArray(snapshot.colliders)
  ? snapshot.colliders.map((c) => ({ i: c.i, owner: c.owner, min: c.min, max: c.max }))
  : [];
const moduleStats = snapshot.moduleStats && typeof snapshot.moduleStats === 'object' ? snapshot.moduleStats : {};
const moduleColliderTotal = Object.values(moduleStats)
  .reduce((sum, module) => sum + Number(module?.colliders ?? 0), 0);
const validCount = Number.isInteger(snapshot.count) && snapshot.count >= 0;
const validIndices = snapBoxes.every((c, index) => Number.isInteger(c.i) && c.i === index);
const uniqueIndices = new Set(snapBoxes.map((c) => c.i)).size === snapBoxes.length;
const validBounds = snapBoxes.every((c) => typeof c.owner === 'string' && c.owner.length > 0
  && Array.isArray(c.min) && c.min.length === 3
  && Array.isArray(c.max) && c.max.length === 3
  && c.min.every(Number.isFinite) && c.max.every(Number.isFinite)
  && c.min.every((value, axis) => value <= c.max[axis]));
claim(snapshot.complete === true
  && typeof snapshot.scope === 'string'
  && snapshot.scope.includes('complete exact collider list returned by __NT.colliderSnapshot'),
  'snapshot scope is complete exact QA API output',
  `complete=${snapshot.complete}, scope=${snapshot.scope ?? 'missing'}`);
claim(validCount && snapBoxes.length === snapshot.count,
  'snapshot count matches collider array', `count=${snapshot.count}, rows=${snapBoxes.length}`);
claim(validCount && snapshot.qaColliderCount === snapshot.count,
  'snapshot count matches __NT.colliderCount', `qa=${snapshot.qaColliderCount}, count=${snapshot.count}`);
claim(validCount && snapshot.moduleColliderTotal === snapshot.count && moduleColliderTotal === snapshot.count,
  'snapshot count matches module collider total', `snapshot=${snapshot.moduleColliderTotal}, modules=${moduleColliderTotal}, count=${snapshot.count}`);
claim(validIndices && uniqueIndices,
  'snapshot indices are unique and contiguous', `rows=${snapBoxes.length}`);
claim(validBounds, 'snapshot bounds are complete finite AABBs', `rows=${snapBoxes.length}`);

const aprons = [];
for (const h of [layout.ORANGE, layout.WHITE]) {
  for (const [kind, doorX, wallZ] of [['front', h.frontDoorX, h.frontZ], ['back', h.backDoorX, h.backZ]]) {
    const out = Math.sign(wallZ) * layout.DOOR_APRON_DEPTH;
    aprons.push({
      label: `${kind}-door apron ${h.side < 0 ? 'orange' : 'white'}`,
      min: [doorX - layout.DOOR_APRON_HALF_W, 0, Math.min(wallZ, wallZ + out)],
      max: [doorX + layout.DOOR_APRON_HALF_W, 3, Math.max(wallZ, wallZ + out)],
    });
  }
}
const spawns = [
  { label: 'SPAWN_A', p: [layout.SPAWN_A.x, layout.SPAWN_A.z] },
  { label: 'SPAWN_B', p: [layout.SPAWN_B.x, layout.SPAWN_B.z] },
];
const band = {
  xMin: layout.YARD_X_MIN + 0.3, xMax: layout.YARD_X_MAX - 0.3,
  zMinAbs: layout.HOUSE_BACK, zMaxAbs: layout.BACK_FENCE - 0.6,
};

// The exact live snapshot includes the subject itself. Exclude only its one
// byte-equivalent AABB, not the barrel module: the other three remain obstacles.
const selfIndex = new Map();
for (const p of barrels.INDUSTRIAL_BARREL_PLACEMENTS) {
  const expected = toBox(barrels.industrialBarrelCollider(p));
  const matches = snapBoxes.filter(b => b.owner === 'industrial-barrels'
    && b.min.every((v, axis) => Math.abs(v - expected.min[axis]) < 1e-9)
    && b.max.every((v, axis) => Math.abs(v - expected.max[axis]) < 1e-9));
  claim(matches.length === 1, 'one exact live subject collider: ' + p.name,
    'matches=' + matches.length + '; regenerate the snapshot if source placements changed');
  if (matches.length === 1) selfIndex.set(p.name, matches[0].i);
}

function instanceBox(p) {
  const world = mul(place(p.x, GROUND_Y, p.z, p.yaw), base);
  return aabbOfPoints(corners(masterBox).map((q) => xform(world, q)));
}

function violations(p) {
  const C = toBox(barrels.industrialBarrelCollider(p));
  const W = instanceBox(p);
  const out = [];
  const faces = ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'];
  const margins = [
    W.min[0] - C.min[0], C.max[0] - W.max[0],
    W.min[1] - C.min[1], C.max[1] - W.max[1],
    W.min[2] - C.min[2], C.max[2] - W.max[2],
  ];
  const worst = Math.min(...margins);
  if (worst < -ENCLOSURE_TOL) {
    out.push(`enclosure broken by ${(-worst).toFixed(4)}m at ${faces[margins.indexOf(worst)]}`);
  }
  for (const b of snapBoxes) {
    if (b.i === selfIndex.get(p.name)) continue;
    const overlapsY = b.max[1] > C.min[1] + VERTICAL_EPS && b.min[1] < C.max[1] - VERTICAL_EPS;
    if (!overlapsY) continue;
    const gap = gapXZ(C, b);
    if (gap < CLEAR_GAP) out.push(`gap ${gap.toFixed(3)}m to ${b.owner}#${b.i}`);
  }
  for (const a of aprons) {
    const gap = gapXZ(C, a);
    if (gap < CLEAR_GAP) out.push(`gap ${gap.toFixed(3)}m to ${a.label}`);
  }
  for (const s of spawns) {
    const dx = Math.max(C.min[0] - s.p[0], s.p[0] - C.max[0], 0);
    const dz = Math.max(C.min[2] - s.p[1], s.p[1] - C.max[2], 0);
    const d = Math.hypot(dx, dz);
    if (d < SPAWN_CLEAR) out.push(`${d.toFixed(3)}m from ${s.label}`);
  }
  if (C.min[0] < band.xMin || C.max[0] > band.xMax || Math.abs(p.z) < band.zMinAbs || Math.abs(p.z) > band.zMaxAbs) {
    out.push('outside the back-yard play band');
  }
  return { out, worst, minGap: Math.min(...snapBoxes.filter((b) => b.i !== selfIndex.get(p.name) && b.max[1] > C.min[1] + VERTICAL_EPS && b.min[1] < C.max[1] - VERTICAL_EPS).map((b) => gapXZ(C, b)), Infinity) };
}

function nearestValid(p) {
  const round = (v) => Math.round(v * 100) / 100;
  for (let r = 0; r <= SEARCH_RADIUS + 1e-9; r += SEARCH_STEP) {
    const steps = Math.max(1, Math.round((2 * Math.PI * r) / SEARCH_STEP));
    for (let s = 0; s < steps; s++) {
      const th = (s / steps) * 2 * Math.PI;
      const cand = { ...p, x: round(p.x + r * Math.cos(th)), z: round(p.z + r * Math.sin(th)) };
      if (violations(cand).out.length === 0) return cand;
    }
  }
  return null;
}

const results = [];
let pass = claims.every((c) => c.ok);
for (const p of placements) {
  const v = violations(p);
  let suggestion = null;
  if (v.out.length > 0) {
    suggestion = nearestValid(p);
    pass = false;
  }
  results.push({ name: p.name, x: p.x, z: p.z, yaw: p.yaw, enclosureMargin: +v.worst.toFixed(4), minGap: v.minGap === Infinity ? null : +v.minGap.toFixed(3), problems: v.out, suggestion });
  if (v.out.length === 0) {
    console.log(`PASS ${p.name} @ (${p.x}, ${p.z}) yaw ${p.yaw}: enclosure margin ${v.worst.toFixed(4)}m, min collider gap ${v.minGap === Infinity ? 'n/a' : v.minGap.toFixed(3) + 'm'}`);
  } else {
    console.error(`FAIL ${p.name} @ (${p.x}, ${p.z}): ${v.out.slice(0, 6).join('; ')}`);
    console.error(`     nearest valid: ${suggestion ? `x ${suggestion.x}, z ${suggestion.z}` : 'none within 3.0m'}`);
  }
}

writeFileSync(join(ROOT, 'work', 'barrel-verify-result.json'), JSON.stringify({ pass, claims, results }, null, 2));
console.log(`\n${pass ? 'ALL CHECKS PASS' : 'CHECKS FAILED'} - details in work/barrel-verify-result.json`);
process.exit(pass ? 0 : 1);
