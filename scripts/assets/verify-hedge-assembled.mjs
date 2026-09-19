import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { transformSync } from 'esbuild';

const ROOT = process.cwd();
const candidateText = readFileSync(ROOT + '/src/build/yards.ts', 'utf8');
const baseText = execFileSync('git', ['show', 'fb715149:src/build/yards.ts'], { cwd: ROOT, encoding: 'utf8' });
const kitText = readFileSync(ROOT + '/src/core/kit.ts', 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error('missing function body ' + name);
  let depth = 0;
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (ch === '\\\\') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === String.fromCharCode(96)) { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed function ' + name);
}
function compileFunction(source, name, deps, values) {
  const js = transformSync(source, { loader: 'ts', target: 'es2020', format: 'cjs' }).code;
  return new Function(...deps, js + '\nreturn ' + name + ';')(...values);
}
const makeRng = compileFunction(extractFunction(kitText, 'makeRng'), 'makeRng', [], []);
const candidateHedgeSource = extractFunction(candidateText, 'hedge');
const baseHedgeSource = extractFunction(baseText, 'hedge');
const legacyHedgeSource = candidateHedgeSource.replace(
  'S.put(mat.hedge, bw, bh, bd, cx + ux * sh + uz * ox, ly, cz + uz * sh - ux * ox, ry);',
  'S.put(mat.hedge, bw, bh, bd, cx + ux * sh + uz * ox, ly, cz + uz * sh - ux * ox);',
);
if (legacyHedgeSource === candidateHedgeSource) throw new Error('legacy negative control mutation did not match');
const tuckMatch = candidateText.match(/const TUCK = ([0-9.]+)/);
if (!tuckMatch) throw new Error('TUCK constant missing');
const TUCK = Number(tuckMatch[1]);
const EPS = 1e-6;
const BACK_FENCE = 37.0;
const HOUSE_BACK = 26.6;
const YARD_D = BACK_FENCE - HOUSE_BACK;
const YARD_X_MIN = -14.8;
const YARD_X_MAX = 14.8;
const PROP_LANE = 2.6;
const PROP_X_MIN = YARD_X_MIN + PROP_LANE;
const PROP_W = (YARD_X_MAX - YARD_X_MIN) - 2 * PROP_LANE;
const HOUSE_HALF_LEN = 6.4;
const GARAGE_LEN = 6.2;
const PAVEMENT_OUTER = 7.0;
const FRONT_LAWN_OUTER = 15.4;
const LAWN_D = FRONT_LAWN_OUTER - PAVEMENT_OUTER;
const ORANGE = { side: -1, garageEnd: -1 };
const WHITE = { side: 1, garageEnd: 1 };
const HOUSES = [ORANGE, WHITE];
const yx = (t) => PROP_X_MIN + t * PROP_W;
const yz = (h, t) => h.side * (HOUSE_BACK + t * YARD_D);
const fz = (h, t) => h.side * (PAVEMENT_OUTER + t * LAWN_D);
function specs() {
  const result = [];
  for (const h of HOUSES) {
    const zin = h.side * (BACK_FENCE - 0.9);
    const ab = h === ORANGE ? [0.40, 0.68] : [0.28, 0.50];
    result.push({ name: (h.side < 0 ? 'orange' : 'white') + '-back', ax: yx(ab[0]), az: zin, bx: yx(ab[1]), bz: zin, hgt: { kind: 'rr', a: 1.2, b: 1.4 } });
    result.push({ name: (h.side < 0 ? 'orange' : 'white') + '-left', ax: YARD_X_MIN + 0.9, az: zin, bx: YARD_X_MIN + 0.9, bz: yz(h, 0.45), hgt: { kind: 'fixed', value: 1.3 } });
    result.push({ name: (h.side < 0 ? 'orange' : 'white') + '-right', ax: YARD_X_MAX - 0.9, az: zin, bx: YARD_X_MAX - 0.9, bz: yz(h, 0.35), hgt: { kind: 'fixed', value: 1.25 } });
    const ve = -h.garageEnd;
    result.push({ name: (h.side < 0 ? 'orange' : 'white') + '-garage', ax: ve * (HOUSE_HALF_LEN + GARAGE_LEN * 0.1), az: fz(h, 0.08), bx: ve * (HOUSE_HALF_LEN + GARAGE_LEN), bz: fz(h, 0.08), hgt: { kind: 'rr', a: 1.2, b: 1.4 } });
  }
  return result;
}

const position = new THREE.Vector3();
const euler = new THREE.Euler();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const direction = new THREE.Vector3();
const midpoint = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1);
const icosaGeometry = new THREE.IcosahedronGeometry(0.5, 1);

function capturedPut(kind, instances, w, h, d, x, y, z, ry = 0, tilt = 0) {
  euler.set(tilt, ry, 0, 'YXZ');
  quaternion.setFromEuler(euler);
  const matrix = new THREE.Matrix4().compose(
    position.set(x, y, z), quaternion, scale.set(w, h, d),
  );
  instances.push({ kind, matrix: matrix.clone() });
}
function capturedSpan(instances, radius, ax, ay, az, bx, by, bz) {
  direction.set(bx - ax, by - ay, bz - az);
  const length = direction.length() || 1e-5;
  direction.multiplyScalar(1 / length);
  quaternion.setFromUnitVectors(UP, direction);
  const matrix = new THREE.Matrix4().compose(
    midpoint.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2),
    quaternion, scale.set(radius * 2, length, radius * 2),
  );
  instances.push({ kind: 'C.span', matrix: matrix.clone() });
}
function boundsFor(cx, yBase, cz, w, h, d) {
  return { minX: cx - w / 2, maxX: cx + w / 2, minY: yBase, maxY: yBase + h, minZ: cz - d / 2, maxZ: cz + d / 2 };
}
function unionBounds(items) {
  return items.reduce((u, b) => ({
    minX: Math.min(u.minX, b.minX), maxX: Math.max(u.maxX, b.maxX),
    minY: Math.min(u.minY, b.minY), maxY: Math.max(u.maxY, b.maxY),
    minZ: Math.min(u.minZ, b.minZ), maxZ: Math.max(u.maxZ, b.maxZ),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
}
function violation(v, b) {
  return Math.max(b.minX - v.x, v.x - b.maxX, b.minY - v.y, v.y - b.maxY, b.minZ - v.z, v.z - b.maxZ);
}
function measure(geometry, instance, bounds) {
  const attr = geometry.getAttribute('position');
  let vertexCount = 0;
  let max = 0;
  let point = null;
  for (let i = 0; i < attr.count; i++) {
    position.fromBufferAttribute(attr, i).applyMatrix4(instance.matrix);
    const d = violation(position, bounds);
    if (d > EPS) vertexCount++;
    if (d > max) { max = d; point = [position.x, position.y, position.z]; }
  }
  return { vertexCount, max, point };
}
function makeBatch(kind, instances) {
  return {
    put(_material, w, h, d, x, y, z, ry = 0, tilt = 0) {
      capturedPut(kind, instances, w, h, d, x, y, z, ry, tilt);
    },
    span(_material, radius, ax, ay, az, bx, by, bz) {
      capturedSpan(instances, radius, ax, ay, az, bx, by, bz);
    },
  };
}
function actualFunction(source, rand, rr, B, C, S, colliders) {
  return compileFunction(
    source,
    'hedge',
    ['THREE', 'TUCK', 'rr', 'mat', 'B', 'C', 'S', 'colliders', 'aabbSlab'],
    [THREE, TUCK, rr, { hedge: { name: 'hedge' } }, B, C, S, colliders, boundsFor],
  );
}
function runHarness(source) {
  const rand = makeRng('nuketown-2025:yards');
  const reports = [];
  let totalBlocks = 0;
  for (const raw of specs()) {
    const hgt = raw.hgt.kind === 'rr' ? raw.hgt.a + rand() * (raw.hgt.b - raw.hgt.a) : raw.hgt.value;
    const instances = { B: [], C: [], S: [] };
    const colliders = [];
    const hedge = actualFunction(
      source, rand, (a, b) => a + rand() * (b - a),
      makeBatch('B.put', instances.B),
      makeBatch('C.span', instances.C),
      makeBatch('S.put', instances.S),
      colliders,
    );
    hedge(raw.ax, raw.az, raw.bx, raw.bz, hgt);
    const L = Math.hypot(raw.bx - raw.ax, raw.bz - raw.az);
    const n = Math.max(2, Math.round(L / 2.6));
    if (instances.B.length !== n || instances.C.length !== n || (instances.S.length !== 2 && instances.S.length !== n + 2) || colliders.length !== n) {
      throw new Error('capture count mismatch for ' + raw.name + ': ' + JSON.stringify({ n, B: instances.B.length, C: instances.C.length, S: instances.S.length, colliders: colliders.length }));
    }
    const lumpCount = instances.S.length - 2;
    const blocks = [];
    for (let i = 0; i < n; i++) {
      const box = measure(boxGeometry, instances.B[i], colliders[i]);
      const cylinder = measure(cylinderGeometry, instances.C[i], colliders[i]);
      const lump = i < lumpCount ? measure(icosaGeometry, instances.S[i], colliders[i]) : { vertexCount: 0, max: 0, point: null };
      blocks.push({ box, cylinder, lump });
    }
    const overall = unionBounds(colliders);
    const capA = measure(icosaGeometry, instances.S[lumpCount], overall);
    const capB = measure(icosaGeometry, instances.S[lumpCount + 1], overall);
    const firstDownstreamRand = rand();
    reports.push({
      name: raw.name,
      axis: Math.abs(raw.bx - raw.ax) > Math.abs(raw.bz - raw.az) ? 'X' : 'Z',
      blocks,
      capVertexCount: capA.vertexCount + capB.vertexCount,
      capMax: Math.max(capA.max, capB.max),
      firstDownstreamRand,
    });
    totalBlocks += n;
  }
  return { reports, totalBlocks };
}
function summarize(harness) {
  let cylinderVertices = 0;
  let cylinderMax = 0;
  let cylinderRun = '';
  let lumpVertices = 0;
  let lumpMax = 0;
  let lumpRun = '';
  let boxVertices = 0;
  let caps = 0;
  for (const report of harness.reports) {
    for (const block of report.blocks) {
      cylinderVertices += block.cylinder.vertexCount;
      lumpVertices += block.lump.vertexCount;
      boxVertices += block.box.vertexCount;
      if (block.cylinder.max > cylinderMax) { cylinderMax = block.cylinder.max; cylinderRun = report.name; }
      if (block.lump.max > lumpMax) { lumpMax = block.lump.max; lumpRun = report.name; }
    }
    if (report.capVertexCount > 0) caps++;
  }
  return {
    runCount: harness.reports.length,
    blockCount: harness.totalBlocks,
    cylinderOutsideVertices: cylinderVertices,
    maxCylinderOverrunMeters: cylinderMax,
    maxCylinderOverrunRun: cylinderRun,
    lumpOutsideVertices: lumpVertices,
    maxLumpOverrunMeters: lumpMax,
    maxLumpOverrunRun: lumpRun,
    boxOutsideVertices: boxVertices,
    baselineEndcapOutsideRuns: caps,
    firstDownstreamRand: harness.reports[0].firstDownstreamRand,
  };
}

const fixed = runHarness(candidateHedgeSource);
const legacy = runHarness(legacyHedgeSource);
const base = runHarness(baseHedgeSource);
const fixedSummary = summarize(fixed);
const legacySummary = summarize(legacy);
const baseSummary = summarize(base);
const fixedDownstream = fixed.reports.map((r) => r.firstDownstreamRand);
const baseDownstream = base.reports.map((r) => r.firstDownstreamRand);
const legacyDownstream = legacy.reports.map((r) => r.firstDownstreamRand);
const rngUnchanged = JSON.stringify(fixedDownstream) === JSON.stringify(baseDownstream);
const result = {
  base: 'fb715149',
  execution: 'actual extracted TypeScript hedge() compiled by esbuild; actual THREE r180 primitive matrices and vertices',
  fixed: fixedSummary,
  legacyNegativeControlWithoutYaw: legacySummary,
  baseActual: baseSummary,
  rngCursor: {
    fixedMatchesBase: rngUnchanged,
    legacyMatchesBase: JSON.stringify(legacyDownstream) === JSON.stringify(baseDownstream),
    firstFixedDownstreamRand: fixedDownstream[0],
    firstBaseDownstreamRand: baseDownstream[0],
  },
  verdict: {
    fixedGeometryInside: fixedSummary.cylinderOutsideVertices === 0 && fixedSummary.lumpOutsideVertices === 0 && fixedSummary.boxOutsideVertices === 0,
    legacyNegativeControlFails: legacySummary.lumpOutsideVertices > 0,
    fixedEndpointBaselineSeparate: fixedSummary.baselineEndcapOutsideRuns === baseSummary.baselineEndcapOutsideRuns && fixedSummary.baselineEndcapOutsideRuns > 0,
    exactReplay: fixedSummary.runCount === 8 && fixedSummary.blockCount === 17,
    rngCursorUnchanged: rngUnchanged,
  },
};
console.log(JSON.stringify(result, null, 2));
if (!result.verdict.fixedGeometryInside || !result.verdict.legacyNegativeControlFails ||
    !result.verdict.fixedEndpointBaselineSeparate || !result.verdict.exactReplay || !result.verdict.rngCursorUnchanged) {
  process.exitCode = 1;
}
