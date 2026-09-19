/**
 * _ownerfix-geom - owner-fixes lane geometry probe (node, no browser).
 *
 * Builds EVERY src/build module in node with esbuild and a Proxy material stub
 * (every module depends on core/materials as a TYPE only), the same way
 * scripts/_verify-trailer-geom.mjs builds the fleet, then answers two questions
 * a browser capture cannot answer at full precision:
 *
 *   node scripts/_ownerfix-geom.mjs vehicles
 *     Every vehicle's world-space mesh AABB and yaw-oriented footprint, every pair
 *     of vehicles whose MESHES intersect (plan convex hulls of the low body band,
 *     plus vertex-in-oriented-box both ways), the plan clearance between every pair,
 *     and every vehicle whose mesh vertices sit inside a collider of ANOTHER module
 *     (house, kerb, fence...).
 *
 *   node scripts/_ownerfix-geom.mjs coplanar [--module white-house] [--all]
 *     Every pair of axis-aligned faces from different parts of the module that lie
 *     on the same plane (offset within 0.5 mm) with the SAME outward normal and an
 *     overlapping rectangle - the exact condition for a z-fight. Abutting faces
 *     (opposite normals) are not reported: a box sitting on another is fine.
 *     Also reports faces of the module coplanar with another module's boxes.
 *
 * Read-only: writes captures/_ownerfix-*.json and prints. Never touches src/.
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'vehicles';
const opt = (name, dflt = '') => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const MODULE = opt('module', 'white-house');
const ALL = argv.includes('--all');
const NO_EXTRUDE = argv.includes('--no-extrude');
const JSON_OUT = argv.includes('--json');

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

const BUILDERS = [
  ['ground', buildGround], ['orange-house', buildOrangeHouse], ['white-house', buildWhiteHouse],
  ['third-house', buildThirdHouse], ['vehicles', buildVehicles], ['yards', buildYards],
  ['skyline', buildSkyline], ['plaza', buildPlaza], ['mannequins', buildMannequins],
  ['surround', buildSurround],
];

/** Every member of MaterialLibrary is a material or a cached factory; positions never depend on which. */
function stubMaterials() {
  const cache = new Map();
  const get = (key) => { let m = cache.get(key); if (!m) { m = new THREE.MeshStandardMaterial(); m.name = key; cache.set(key, m); } return m; };
  const fns = new Set(['painted', 'emissive', 'signText', 'operator']);
  return new Proxy({}, {
    get(_, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'dispose') return () => {};
      if (fns.has(prop)) return (...args) => get(prop + ':' + JSON.stringify(args));
      return get(String(prop));
    },
  });
}

export function buildAll() {
  const mat = stubMaterials();
  const out = {};
  for (const [name, b] of BUILDERS) {
    const res = b({ mat, rand: makeRng('nuketown-2025:' + name) });
    res.group.name = name;
    res.group.updateMatrixWorld(true);
    out[name] = res;
  }
  return { THREE, modules: out };
}
`;

const outDir = join(tmpdir(), 'aa-ownerfix-geom');
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, 'world-' + Date.now() + '.mjs');
// --head <module>: build that ONE src/build module from git HEAD instead of the working
// tree (a before/after measure that never touches src/). Its relative imports are
// re-pointed at the real src tree so the rest of the world stays the working copy.
const HEAD_MOD = opt('head', '');
const plugins = [];
if (HEAD_MOD) {
  const { execFileSync } = await import('node:child_process');
  const src = execFileSync('git', ['show', 'HEAD:src/build/' + HEAD_MOD + '.ts'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const headFile = join(outDir, 'head-' + HEAD_MOD + '-' + Date.now() + '.ts');
  writeFileSync(headFile, src);
  const realDir = join(ROOT, 'src', 'build');
  plugins.push({
    name: 'head-module',
    setup(b) {
      b.onResolve({ filter: /\/src\/build\/[^/]+$/ }, (args) => {
        if (args.path.endsWith('/src/build/' + HEAD_MOD)) return { path: headFile };
        return undefined;
      });
      b.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (args.importer !== headFile) return undefined;
        const p = join(realDir, args.path);
        for (const ext of ['.ts', '/index.ts']) { try { statSync(p + ext); return { path: p + ext }; } catch { /* next */ } }
        return undefined;
      });
    },
  });
}
await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'world.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  define: { 'import.meta.env.DEV': 'false' },
  outfile, logLevel: 'warning', plugins,
  nodePaths: [join(ROOT, 'node_modules')],   // a HEAD copy outside the tree still finds 'three'
});
globalThis.location = { search: '' };
const { buildAll } = await import(pathToFileURL(outfile).href);
const { THREE, modules } = buildAll();

// ------------------------------------------------------------------ geometry helpers

/** World-space vertices of every mesh under root (instances expanded). */
function worldVerts(root) {
  const pts = [];
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.visible === false) return;
    const pos = o.geometry.attributes.position;
    if (!pos) return;
    const mats = [];
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); mats.push(new THREE.Matrix4().multiplyMatrices(o.matrixWorld, m)); }
    } else mats.push(o.matrixWorld);
    for (const mw of mats) {
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mw);
        pts.push([v.x, v.y, v.z]);
      }
    }
  });
  return pts;
}

/** Andrew monotone chain, points as [x,z]. */
function hull2(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
function segDist(a, b, c, d) {
  const ptSeg = (p, s0, s1) => {
    const dx = s1[0] - s0[0], dz = s1[1] - s0[1];
    const L2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - s0[0]) * dx + (p[1] - s0[1]) * dz) / L2));
    return Math.hypot(p[0] - s0[0] - t * dx, p[1] - s0[1] - t * dz);
  };
  return Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b));
}
function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Plan distance between two convex hulls; 0 when they overlap. */
function hullDist(A, B) {
  if (A.some((p) => pointInPoly(p, B)) || B.some((p) => pointInPoly(p, A))) return 0;
  let best = Infinity;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    best = Math.min(best, segDist(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length]));
  }
  return best;
}
/** Overlap area of two convex polygons (Sutherland-Hodgman clip of A by B). */
function hullOverlapArea(A, B) {
  let out = A.slice();
  for (let i = 0; i < B.length && out.length; i++) {
    const a = B[i], b = B[(i + 1) % B.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const inp = out; out = [];
    for (let k = 0; k < inp.length; k++) {
      const P = inp[k], Q = inp[(k + 1) % inp.length];
      const sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
      }
    }
  }
  let area = 0;
  for (let i = 0; i < out.length; i++) { const p = out[i], q = out[(i + 1) % out.length]; area += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(area) / 2;
}
const r3 = (v) => +v.toFixed(3);

// ------------------------------------------------------------------ vehicles

function vehiclesReport() {
  const veh = modules.vehicles;
  const cars = veh.group.children.map((g) => {
    const pts = worldVerts(g);
    const yaw = g.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
    // rotation.y maps local +x to world (cos, 0, -sin): local = R^-1 (world - pos)
    const toLocal = ([x, y, z]) => { const dx = x - g.position.x, dz = z - g.position.z; return [dx * c - dz * s, y - g.position.y, dx * s + dz * c]; };
    const aabb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const lmin = [Infinity, Infinity, Infinity], lmax = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) {
      for (let k = 0; k < 3; k++) { aabb.min[k] = Math.min(aabb.min[k], p[k]); aabb.max[k] = Math.max(aabb.max[k], p[k]); }
      const l = toLocal(p);
      for (let k = 0; k < 3; k++) { lmin[k] = Math.min(lmin[k], l[k]); lmax[k] = Math.max(lmax[k], l[k]); }
    }
    const low = pts.filter((p) => p[1] < 1.65);            // saloon roof height band
    return {
      name: g.name, x: g.position.x, y: g.position.y, z: g.position.z, yaw, pts,
      aabb, local: { min: lmin, max: lmax }, toLocal,
      hull: hull2(pts.map((p) => [p[0], p[2]])),
      hullLow: hull2(low.map((p) => [p[0], p[2]])),
      verts: pts.length,
    };
  });

  const pairs = [];
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const A = cars[i], B = cars[j];
    const inB = A.pts.filter((p) => { const l = B.toLocal(p); return l[0] > B.local.min[0] + 1e-6 && l[0] < B.local.max[0] - 1e-6 && l[1] > B.local.min[1] + 1e-6 && l[1] < B.local.max[1] - 1e-6 && l[2] > B.local.min[2] + 1e-6 && l[2] < B.local.max[2] - 1e-6; }).length;
    const inA = B.pts.filter((p) => { const l = A.toLocal(p); return l[0] > A.local.min[0] + 1e-6 && l[0] < A.local.max[0] - 1e-6 && l[1] > A.local.min[1] + 1e-6 && l[1] < A.local.max[1] - 1e-6 && l[2] > A.local.min[2] + 1e-6 && l[2] < A.local.max[2] - 1e-6; }).length;
    const dist = hullDist(A.hull, B.hull);
    const distLow = hullDist(A.hullLow, B.hullLow);
    const overlap = hullOverlapArea(A.hull, B.hull);
    const overlapLow = hullOverlapArea(A.hullLow, B.hullLow);
    pairs.push({ a: A.name, b: B.name, planClearance: r3(dist), lowBandClearance: r3(distLow), planOverlapM2: r3(overlap), lowBandOverlapM2: r3(overlapLow), aVertsInsideB: inB, bVertsInsideA: inA });
  }
  const intersecting = pairs.filter((p) => p.lowBandOverlapM2 > 1e-4 || p.aVertsInsideB > 0 || p.bVertsInsideA > 0);

  // vehicles against every OTHER module's colliders
  const hits = [];
  for (const car of cars) {
    for (const [mod, res] of Object.entries(modules)) {
      if (mod === 'vehicles') continue;
      for (let ci = 0; ci < res.colliders.length; ci++) {
        const c = res.colliders[ci];
        // skip ground pads that are just the surface the tyres rest on (top <= 0.16)
        if (mod === 'ground' && c.max.y <= 0.16 && car.aabb.min[1] > -0.01 && car.name !== 'saloon-on-apron') {
          // a tyre BOTTOM at y 0.02 sits inside a 0.15 kerb only if it is over the kerb: still report, but as 'kerb/pad'
        }
        let n = 0, deepest = 0;
        for (const p of car.pts) {
          if (p[0] > c.min.x && p[0] < c.max.x && p[1] > c.min.y && p[1] < c.max.y && p[2] > c.min.z && p[2] < c.max.z) {
            n++;
            const d = Math.min(p[0] - c.min.x, c.max.x - p[0], p[2] - c.min.z, c.max.z - p[2], c.max.y - p[1]);
            deepest = Math.max(deepest, d);
          }
        }
        if (n) hits.push({ vehicle: car.name, at: [r3(car.x), r3(car.z)], module: mod, collider: ci, min: [r3(c.min.x), r3(c.min.y), r3(c.min.z)], max: [r3(c.max.x), r3(c.max.y), r3(c.max.z)], verts: n, deepestM: r3(deepest) });
      }
    }
  }

  const report = {
    vehicles: cars.map((c) => ({
      name: c.name, pos: [r3(c.x), r3(c.y), r3(c.z)], yawRad: r3(c.yaw), yawDeg: r3(c.yaw * 180 / Math.PI), verts: c.verts,
      worldAabb: { min: c.aabb.min.map(r3), max: c.aabb.max.map(r3) },
      orientedLocal: { min: c.local.min.map(r3), max: c.local.max.map(r3) },
      footprint: c.hull.map((p) => p.map(r3)),
    })),
    pairs, intersecting, colliderHits: hits,
  };
  mkdirSync(join(ROOT, 'captures'), { recursive: true });
  writeFileSync(join(ROOT, 'captures', '_ownerfix-vehicles.json'), JSON.stringify(report, null, 2));
  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log('[ownerfix] vehicles: ' + cars.length);
  for (const v of report.vehicles) {
    console.log('  ' + v.name.padEnd(14) + ' pos ' + v.pos.join(',').padEnd(22) + ' yaw ' + String(v.yawDeg).padStart(8) + ' deg'
      + '  aabb x ' + v.worldAabb.min[0] + '..' + v.worldAabb.max[0] + '  z ' + v.worldAabb.min[2] + '..' + v.worldAabb.max[2]
      + '  local len ' + r3(v.orientedLocal.max[0] - v.orientedLocal.min[0]) + ' wid ' + r3(v.orientedLocal.max[2] - v.orientedLocal.min[2]) + ' h ' + r3(v.orientedLocal.max[1]));
  }
  console.log('\n[ownerfix] pairs (plan clearance in metres; 0 = hulls overlap):');
  for (const p of pairs) {
    const flag = intersecting.includes(p) ? ' <-- INTERSECT' : '';
    console.log('  ' + (p.a + ' / ' + p.b).padEnd(30) + ' clear ' + String(p.planClearance).padStart(6) + '  lowBand ' + String(p.lowBandClearance).padStart(6)
      + '  overlap ' + p.planOverlapM2 + ' m2  lowBand ' + p.lowBandOverlapM2 + ' m2  vertsIn ' + p.aVertsInsideB + '/' + p.bVertsInsideA + flag);
  }
  console.log('\n[ownerfix] mesh-vertex hits inside OTHER modules\' colliders: ' + hits.length);
  for (const h of hits) console.log('  ' + h.vehicle.padEnd(14) + ' ' + h.module.padEnd(12) + ' #' + h.collider + ' min ' + h.min.join(',') + ' max ' + h.max.join(',') + '  verts ' + h.verts + ' deepest ' + h.deepestM + ' m');
  console.log('\n[ownerfix] intersecting vehicle pairs: ' + intersecting.length);
}

// ------------------------------------------------------------------ coplanar

/** Axis-aligned boxes of a module: Batch instances, kit boxes/slabs, prism top/bottom. */
function moduleBoxes(name, res) {
  const boxes = [];
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3(), e = new THREE.Euler();
  const m = new THREE.Matrix4();
  const push = (label, min, max, faces, kind) => boxes.push({ module: name, label, min, max, faces, kind });
  const axisFromMatrix = (mw, halfLocal, label, kind, faces) => {
    mw.decompose(pos, q, scl);
    e.setFromQuaternion(q, 'YXZ');
    const yaw = e.y, quarter = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(e.x) > 1e-4 || Math.abs(e.z) > 1e-4 || Math.abs(yaw - quarter) > 1e-4) return false;
    const swap = Math.abs(Math.round(yaw / (Math.PI / 2))) % 2 === 1;
    const hx = (swap ? halfLocal[2] * scl.z : halfLocal[0] * scl.x), hy = halfLocal[1] * scl.y, hz = (swap ? halfLocal[0] * scl.x : halfLocal[2] * scl.z);
    if (hx <= 0 || hy <= 0 || hz <= 0) return false;
    push(label, [pos.x - hx, pos.y - hy, pos.z - hz], [pos.x + hx, pos.y + hy, pos.z + hz], faces, kind);
    return true;
  };
  res.group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const label = (o.name || o.parent?.name || '?');
    if (g.type === 'BoxGeometry') {
      const p = g.parameters;
      const half = [p.width / 2, p.height / 2, p.depth / 2];
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); axisFromMatrix(m, half, label + '#' + i, 'box', 'all'); }
      } else axisFromMatrix(o.matrixWorld, half, label + '@' + o.position.toArray().map(r3).join(','), 'box', 'all');
    } else if (g.type === 'ExtrudeGeometry' && !o.isInstancedMesh) {
      // prisms (rounded plans) and roof/stair extrusions: only their +-y planes are trusted
      g.computeBoundingBox();
      const b = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
      push('extrude@' + o.position.toArray().map(r3).join(','), b.min.toArray(), b.max.toArray(), 'y', 'extrude');
    }
  });
  return boxes;
}

function coplanarReport() {
  const target = modules[MODULE];
  if (!target) { console.error('no module ' + MODULE); process.exit(2); }
  const boxes = [];
  for (const [name, res] of Object.entries(modules)) {
    if (name !== MODULE && !ALL && name !== 'ground') continue;
    boxes.push(...moduleBoxes(name, res));
  }
  const faces = [];
  for (let bi = 0; bi < boxes.length; bi++) {
    const b = boxes[bi];
    for (let a = 0; a < 3; a++) {
      if (b.faces === 'y' && a !== 1) continue;
      for (const sgn of [-1, 1]) {
        const off = sgn > 0 ? b.max[a] : b.min[a];
        const u = (a + 1) % 3, w = (a + 2) % 3;
        faces.push({ bi, a, sgn, off, u0: b.min[u], u1: b.max[u], w0: b.min[w], w1: b.max[w] });
      }
    }
  }
  faces.sort((p, q) => p.a - q.a || p.sgn - q.sgn || p.off - q.off);
  const TOL = 5e-4, MIN_OVER = 5e-3;
  /**
   * Is the overlap rectangle R (on axis a at plane P, facing sgn) BURIED - i.e. is the
   * space just in front of it solid? True when some other box spans P + sgn*eps on axis
   * a and contains R on the other two axes: an abutting neighbour in a straight run, a
   * cill or drip band wrapped round a joint, a floor pad under a skirting. A buried pair
   * cannot fight because no pixel ever sees either face; it is counted, not reported.
   */
  const buried = (a, sgn, P, u0, u1, w0, w1, skipA, skipB) => {
    const u = (a + 1) % 3, w = (a + 2) % 3, probe = P + sgn * 2e-3;
    for (let k = 0; k < boxes.length; k++) {
      if (k === skipA || k === skipB) continue;
      const bx = boxes[k];
      if (bx.kind === 'extrude') continue;
      if (bx.min[a] > probe || bx.max[a] < probe) continue;
      if (bx.min[u] > u0 + 1e-3 || bx.max[u] < u1 - 1e-3) continue;
      if (bx.min[w] > w0 + 1e-3 || bx.max[w] < w1 - 1e-3) continue;
      return true;
    }
    return false;
  };
  let buriedCount = 0;
  const pairs = [];
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    for (let j = i + 1; j < faces.length; j++) {
      const g = faces[j];
      if (g.a !== f.a || g.sgn !== f.sgn || g.off - f.off > TOL) break;
      if (g.bi === f.bi) continue;
      // bottom faces lying on the world ground plane are buried: nobody sees y = 0 from below
      if (f.a === 1 && f.sgn < 0 && f.off <= 1e-3) continue;
      const bf = boxes[f.bi], bg = boxes[g.bi];
      if (NO_EXTRUDE && (bf.kind === 'extrude' || bg.kind === 'extrude')) continue;
      if (bf.module !== MODULE && bg.module !== MODULE) continue;
      const ou = Math.min(f.u1, g.u1) - Math.max(f.u0, g.u0);
      const ow = Math.min(f.w1, g.w1) - Math.max(f.w0, g.w0);
      if (ou < MIN_OVER || ow < MIN_OVER) continue;
      if (!argv.includes('--include-buried') && buried(f.a, f.sgn, f.off, Math.max(f.u0, g.u0), Math.min(f.u1, g.u1),
        Math.max(f.w0, g.w0), Math.min(f.w1, g.w1), f.bi, g.bi)) { buriedCount++; continue; }
      // two extrude bounding boxes may not really overlap (rounded plans): mark as unverified
      pairs.push({
        axis: 'xyz'[f.a], normal: f.sgn > 0 ? '+' : '-', plane: r3(f.off), deltaMm: r3((g.off - f.off) * 1000),
        a: bf.module + ':' + bf.label + ' [' + bf.min.map(r3) + ' .. ' + bf.max.map(r3) + ']',
        b: bg.module + ':' + bg.label + ' [' + bg.min.map(r3) + ' .. ' + bg.max.map(r3) + ']',
        overlap: r3(ou) + ' x ' + r3(ow) + ' m', overlapM2: r3(ou * ow),
        note: (bf.kind === 'extrude' || bg.kind === 'extrude') ? 'extrude bbox - verify plan overlap' : '',
      });
    }
  }
  pairs.sort((p, q) => q.overlapM2 - p.overlapM2);
  writeFileSync(join(ROOT, 'captures', '_ownerfix-coplanar-' + MODULE + '.json'), JSON.stringify({ module: MODULE, boxes: boxes.length, pairs }, null, 2));
  if (JSON_OUT) { console.log(JSON.stringify(pairs, null, 2)); return; }
  console.log('[ownerfix] ' + MODULE + ': ' + boxes.filter((b) => b.module === MODULE).length + ' axis-aligned parts (' + boxes.length + ' incl. other modules), ' + pairs.length + ' VISIBLE coplanar same-normal overlapping face pairs (' + buriedCount + ' more buried in solid, --include-buried to list)');
  // group by the two MESHES involved: same-mesh pairs (chord overlaps of one instanced run)
  // shade identically and cannot flicker; cross-mesh pairs are the visible ones.
  const groups = new Map();
  for (const p of pairs) {
    const ma = p.a.split('#')[0].split('@')[0], mb = p.b.split('#')[0].split('@')[0];
    const key = [ma, mb].sort().join('  <>  ');
    const g = groups.get(key) || { n: 0, area: 0, sameMesh: ma === mb, faces: new Set(), first: p };
    g.n++; g.area += p.overlapM2; g.faces.add(p.axis + p.normal + '@' + p.plane);
    groups.set(key, g);
  }
  console.log('');
  console.log('[ownerfix] grouped by mesh pair (CROSS-mesh first = visible fights):');
  for (const [key, g] of [...groups.entries()].sort((a, b) => Number(a[1].sameMesh) - Number(b[1].sameMesh) || b[1].area - a[1].area)) {
    console.log('  ' + (g.sameMesh ? 'same ' : 'CROSS') + '  ' + key.padEnd(60) + ' pairs ' + String(g.n).padStart(4) + '  area ' + r3(g.area).toFixed(3).padStart(8) + ' m2  planes ' + [...g.faces].slice(0, 6).join(' '));
  }
  console.log('');
  console.log('[ownerfix] cross-mesh pairs in detail:');
  for (const p of pairs) {
    const ma = p.a.split('#')[0].split('@')[0], mb = p.b.split('#')[0].split('@')[0];
    if (ma === mb && !argv.includes('--verbose')) continue;
    console.log('  ' + p.axis + p.normal + ' @ ' + String(p.plane).padStart(8) + '  d ' + String(p.deltaMm).padStart(6) + ' mm  overlap ' + p.overlap.padEnd(22) + (p.note ? ' (' + p.note + ')' : ''));
    console.log('      A ' + p.a);
    console.log('      B ' + p.b);
  }
}

// ------------------------------------------------------------------ upflood
// scripts/paths.mjs --y 3.3, replayed offline on the node-built colliders of every
// module, over one house's upper floor: the same grid (0.2 m from (-22, -42)), the same
// standability rule, the same 3-cell erosion, the same seeds and landmarks - so a
// layout can be checked in seconds without the shared preview or a browser. It is a
// pre-check, not the gate: the gate is the real script.
function upfloodReport() {
  const UP_Y = Number(opt('y', '3.3')), STEP = 0.2, X0 = -22, Z0 = -42;
  const STEP_UP = 0.38, BODY_TOP = 1.7, SAMPLE_Y = [0.45, 0.8, 1.2, 1.6], PLAYER_R = 0.42;
  const house = opt('house', 'white');
  const H = house === 'white'
    ? { xa: -8, xb: 8, za: 19, zb: 32, seeds: [['internal stair head', 1.9, 24.6], ['deck door', -3.4, 27.4]],
        marks: [['white upper landing', 1.9, 24.7], ['white upper bedroom (curved end)', -4.8, 23.3], ['white upper green room', 0.0, 23.2], ['white deck door (inside)', -3.4, 26.0], ['white rear deck', -3.4, 28.3]] }
    : { xa: -8, xb: 8, za: -32, zb: -17, seeds: [['internal stair head', 5.4, -25.4], ['deck door', 3.4, -27.4]],
        marks: [['orange upper landing', 5.4, -25.4], ['orange gallery landing', 0.6, -18.0], ['orange upper front room', -3.3, -18.0], ['orange upper rear room', -3.3, -23.5], ['orange deck door (inside)', 3.4, -25.8], ['orange rear deck', 3.4, -28.3]] };
  const cols = [];
  for (const [mod, res] of Object.entries(modules)) for (const c of res.colliders) {
    cols.push({ mod, min: [+c.min.x.toFixed(2), +c.min.y.toFixed(2), +c.min.z.toFixed(2)], max: [+c.max.x.toFixed(2), +c.max.y.toFixed(2), +c.max.z.toFixed(2)] });
  }
  const at = (x, z, y) => cols.filter((c) => !(x < c.min[0] - 0.35 || x > c.max[0] + 0.35 || z < c.min[2] - 0.35 || z > c.max[2] + 0.35 || y < c.min[1] || y > c.max[1]));
  const ix0 = Math.round((H.xa - X0) / STEP), ix1 = Math.round((H.xb - X0) / STEP);
  const iz0 = Math.round((H.za - Z0) / STEP), iz1 = Math.round((H.zb - Z0) / STEP);
  const W = ix1 - ix0, D = iz1 - iz0;
  const blocked = new Uint8Array(W * D), floorless = new Uint8Array(W * D);
  const why = new Map();
  for (let jz = 0; jz < D; jz++) for (let jx = 0; jx < W; jx++) {
    const x = X0 + (ix0 + jx) * STEP, z = Z0 + (iz0 + jz) * STEP;
    let top = -Infinity;
    for (const py of [UP_Y - 0.1, UP_Y - 0.3, UP_Y - 0.6]) for (const h of at(x, z, py)) {
      if (x < h.min[0] || x > h.max[0] || z < h.min[2] || z > h.max[2]) continue;
      if (h.max[1] > UP_Y + STEP_UP || h.max[1] < UP_Y - 0.65) continue;
      if (h.max[1] > top) top = h.max[1];
    }
    if (top === -Infinity) { blocked[jz * W + jx] = 1; floorless[jz * W + jx] = 1; continue; }
    let solid = null;
    for (const y of SAMPLE_Y) {
      for (const h of at(x, z, top + y)) {
        if (x < h.min[0] || x > h.max[0] || z < h.min[2] || z > h.max[2]) continue;
        if (h.max[1] <= top + STEP_UP) continue;
        if (h.min[1] >= top + BODY_TOP) continue;
        solid = h; break;
      }
      if (solid) break;
    }
    if (solid) { blocked[jz * W + jx] = 1; why.set(jz * W + jx, solid); }
  }
  const r = Math.ceil(PLAYER_R / STEP);
  const standable = new Uint8Array(W * D);
  for (let jz = 0; jz < D; jz++) for (let jx = 0; jx < W; jx++) {
    let ok = 1;
    for (let dz = -r; dz <= r && ok; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      const kx = jx + dx, kz = jz + dz;
      if (kx < 0 || kz < 0 || kx >= W || kz >= D) continue;
      if (blocked[kz * W + kx]) { ok = 0; break; }
    }
    standable[jz * W + jx] = ok;
  }
  const cell = (x, z) => [Math.round((x - X0) / STEP) - ix0, Math.round((z - Z0) / STEP) - iz0];
  const snapNear = (x, z) => {
    const [cx, cz] = cell(x, z);
    let best = -1, bd = Infinity;
    for (let jz = 0; jz < D; jz++) for (let jx = 0; jx < W; jx++) {
      if (!standable[jz * W + jx]) continue;
      const d = (jx - cx) ** 2 + (jz - cz) ** 2;
      if (d < bd) { bd = d; best = jz * W + jx; }
    }
    return best;
  };
  const bfs = (s) => {
    const seen = new Uint8Array(W * D); const q = [s]; seen[s] = 1;
    while (q.length) {
      const i = q.pop(); const jx = i % W, jz = (i - jx) / W;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const kx = jx + dx, kz = jz + dz;
        if (kx < 0 || kz < 0 || kx >= W || kz >= D) continue;
        const k = kz * W + kx; if (!standable[k] || seen[k]) continue; seen[k] = 1; q.push(k);
      }
    }
    return seen;
  };
  let bad = 0;
  console.log('[upflood] ' + house.toUpperCase() + ' upper floor at y ' + UP_Y + ' (offline replay of paths.mjs --y):');
  const seenBySeed = [];
  for (const [sName, sx, sz] of H.seeds) {
    const s = snapNear(sx, sz); const seen = bfs(s); seenBySeed.push(seen);
    const sjx = s % W, sjz = (s - sjx) / W;
    console.log('  from ' + sName + ' (snapped to ' + (X0 + (ix0 + sjx) * STEP).toFixed(1) + ', ' + (Z0 + (iz0 + sjz) * STEP).toFixed(1) + '):');
    for (const [mName, mx, mz] of H.marks) {
      const m = snapNear(mx, mz); const mjx = m % W, mjz = (m - mjx) / W;
      const ok = seen[m] === 1; if (!ok) bad++;
      console.log('    ' + (ok ? 'YES ' : 'NO  ') + mName.padEnd(34) + ' (nearest standable ' + (X0 + (ix0 + mjx) * STEP).toFixed(1) + ', ' + (Z0 + (iz0 + mjz) * STEP).toFixed(1) + ')');
    }
  }
  console.log('[upflood] ' + (bad ? bad + ' landmark/seed pairs FAILED' : 'ALL upper landmarks reachable from BOTH ways up'));
  if (argv.includes('--map')) {
    // rows = z (top = za), cols = x. '#' blocked by a collider, '.' no floor, ' ' free but eroded,
    // '+' standable and unreached, 'O' reached from seed 0, 'o' from seed 1, '@' from both
    console.log('       x ' + H.xa + ' .. ' + H.xb + ' (each char 0.2 m)');
    for (let jz = 0; jz < D; jz++) {
      let line = '';
      for (let jx = 0; jx < W; jx++) {
        const i = jz * W + jx;
        const a = seenBySeed[0] && seenBySeed[0][i], b = seenBySeed[1] && seenBySeed[1][i];
        if (standable[i]) line += a && b ? '@' : a ? 'O' : b ? 'o' : '+';
        else if (floorless[i]) line += '.';
        else if (blocked[i]) line += '#';
        else line += ' ';
      }
      console.log((Z0 + (iz0 + jz) * STEP).toFixed(1).padStart(6) + ' ' + line);
    }
  }
  if (argv.includes('--why')) {
    const [qx, qz] = opt('why-at', '0,0').split(',').map(Number);
    const [cx, cz] = cell(qx, qz);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const i = (cz + dz) * W + (cx + dx); if (!blocked[i]) continue;
      const w = why.get(i);
      console.log('  blocked cell (' + (qx + dx * STEP).toFixed(1) + ', ' + (qz + dz * STEP).toFixed(1) + ') ' + (w ? w.mod + ' [' + w.min + ' .. ' + w.max + ']' : 'NO FLOOR'));
    }
  }
}

if (cmd === 'vehicles') vehiclesReport();
else if (cmd === 'coplanar') coplanarReport();
else if (cmd === 'upflood') upfloodReport();
else if (cmd !== 'carfit') { console.error('usage: vehicles [--head vehicles] | carfit | coplanar [--module m] [--all] | upflood [--house white|orange] [--map] [--why --why-at x,z]'); process.exit(2); }

// ------------------------------------------------------------------ carfit
// Where can the stem saloon go? Smallest displacement from where it stands that clears
// both coaches by >= CLEAR at the mesh, stays on the carriageway, and keeps out of the
// camera stations, the paths landmark at the circle centre and the traverse legs.
function carfitReport() {
  const veh = modules.vehicles;
  const cars = veh.group.children.map((g) => ({ g, pts: worldVerts(g) }));
  const byName = (n) => cars.filter((c) => c.g.name === n);
  const coach = byName('coach')[0], bus = byName('coach-second')[0];
  const saloons = byName('saloon');
  // the offending one is the saloon whose hull overlaps the coach
  const hullOf = (c) => hull2(c.pts.map((p) => [p[0], p[2]]));
  const coachH = hullOf(coach), busH = hullOf(bus);
  const target = saloons.find((s) => hullDist(hullOf(s), coachH) === 0);
  if (!target) { console.log('[carfit] no saloon intersects the coach'); return; }
  const others = saloons.filter((s) => s !== target).map(hullOf);
  const g = target.g, x0 = g.position.x, z0 = g.position.z, yaw0 = g.rotation.y;
  const c0 = Math.cos(yaw0), s0 = Math.sin(yaw0);
  const local = target.pts.map(([x, , z]) => { const dx = x - x0, dz = z - z0; return [dx * c0 - dz * s0, dx * s0 + dz * c0]; });
  const localH = hull2(local);
  const place = (x, z, yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); return localH.map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]); };
  const cams = [[-6, 0], [0, 0], [-14, 1], [-14, -1], [-8, -8.5]];
  const legs = [
    [[-0.2, -20.4], [6.4, -2.4]], [[6.4, -2.4], [6.2, 5.2]], [[-7, -8.2], [-17.4, 0]],
    [[1, -15.6], [-4.6, -11.2]], [[-4.6, -11.2], [-7, -8.2]], [[-7, -8.2], [-7.6, -8]], [[-7.6, -8], [-9.4, -8]], [[-9.4, -8], [-9.8, -8.4]], [[-9.8, -8.4], [-12.6, -17.4]],
  ];
  const ptPoly = (p, H) => { if (pointInPoly(p, H)) return 0; let b = Infinity; for (let i = 0; i < H.length; i++) b = Math.min(b, segDist(p, p, H[i], H[(i + 1) % H.length])); return b; };
  const segPoly = (a, b, H) => { if (pointInPoly(a, H) || pointInPoly(b, H)) return 0; let d = Infinity; for (let i = 0; i < H.length; i++) d = Math.min(d, segDist(a, b, H[i], H[(i + 1) % H.length])); return d; };
  // other modules' colliders that a car body must not stand in (kerb ring, pads above the road, fences, houses)
  const blocks = [];
  for (const [mod, res] of Object.entries(modules)) {
    if (mod === 'vehicles') continue;
    for (const c of res.colliders) {
      if (c.max.y < 0.05) continue;               // road-level pads
      blocks.push({ mod, poly: [[c.min.x, c.min.z], [c.max.x, c.min.z], [c.max.x, c.max.z], [c.min.x, c.max.z]] });
    }
  }
  const CLEAR = 0.45, CAM = 1.0, LEG = 0.9;
  const onRoad = (H) => H.every(([x, z]) => (Math.abs(z) <= 4.4 - 0.05 && x >= -19.5 && x <= 16) || Math.hypot(x, z) <= 9.2 - 0.05);
  const cands = [];
  for (let yawDeg = 140; yawDeg <= 220; yawDeg += 5) for (let flip = 0; flip < 2; flip++) {
    const yaw = (flip ? yawDeg - 180 : yawDeg) * Math.PI / 180;
    for (let x = -12; x <= 4; x += 0.1) for (let z = -4; z <= 4; z += 0.1) {
      const H = place(x, z, yaw);
      if (!onRoad(H)) continue;
      const dCoach = hullDist(H, coachH), dBus = hullDist(H, busH);
      if (dCoach < CLEAR || dBus < CLEAR) continue;
      if (others.some((o) => hullDist(H, o) < CLEAR)) continue;
      if (cams.some((p) => ptPoly(p, H) < CAM)) continue;
      if (legs.some(([a, b]) => segPoly(a, b, H) < LEG)) continue;
      if (blocks.some((b) => hullDist(H, b.poly) < 0.1)) continue;
      cands.push({ x: r3(x), z: r3(z), yawDeg, nose: flip ? 'east' : 'west', move: r3(Math.hypot(x - x0, z - z0)), dCoach: r3(dCoach), dBus: r3(dBus) });
    }
  }
  cands.sort((a, b) => a.move - b.move);
  console.log('[carfit] offending saloon at (' + r3(x0) + ', ' + r3(z0) + ') yaw ' + r3(yaw0 * 180 / Math.PI) + ' deg; ' + cands.length + ' feasible placements (clear >= ' + CLEAR + ' m to both coaches, on the carriageway, ' + CAM + ' m off every camera station and the circle centre, ' + LEG + ' m off the traverse legs)');
  console.log('[carfit] nearest 15 by displacement:');
  for (const c of cands.slice(0, 15)) console.log('  move ' + String(c.move).padStart(6) + '  ->  x ' + String(c.x).padStart(7) + '  z ' + String(c.z).padStart(7) + '  yaw ' + c.yawDeg + ' (' + c.nose + ')  clear coach ' + c.dCoach + '  bus ' + c.dBus);
  writeFileSync(join(ROOT, 'captures', '_ownerfix-carfit.json'), JSON.stringify({ from: [x0, z0, yaw0], cands: cands.slice(0, 200) }, null, 2));
}
if (cmd === 'carfit') carfitReport();
