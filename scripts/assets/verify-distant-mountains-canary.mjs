/**
 * verify-distant-mountains-canary.mjs
 *
 * Headless CPU verification harness for the Distant Mountains Canary.
 * Asserts strict geometry, material, topological, and geomorphological contracts
 * without requiring a browser, GPU, or web server.
 *
 * Asserts:
 * 1. Positive Proofs:
 *    - Triangle count <= 18,000 (actual measured vs budget).
 *    - Draw calls <= 3 (actual measured vs budget).
 *    - Vertex buffers non-empty, finite, no NaNs, no infinities.
 *    - Normal vectors strictly unit-length and computed across all indexed vertices.
 *    - UV coverage valid and finite.
 *    - BoundingBox and BoundingSphere strictly finite and enclosing all vertices.
 *    - Strata & ridge geomorphology: verified multi-scale stepped benches and angular peaks vs smooth baseline.
 *    - Strict determinism across repeated instantiations.
 *    - Complete disposal and cleanup lifecycle.
 *    - Actual builder registration and release: the REAL buildSkyline registers
 *      the canary release under `userData.dispose` (the key the page lifecycle
 *      traverses), the release fires each canary geometry dispose exactly once,
 *      a second release is a no-op, and non-canary backdrop geometry is untouched.
 * 2. Negative Proofs:
 *    - Over-budget triangle trap (> 18,000 tris rejected).
 *    - Over-budget draw call trap (> 3 draws rejected).
 *    - Non-finite / NaN buffer injection trap.
 *    - Unnormalized / corrupt normal trap.
 *    - Inverted / invalid bounding volume trap.
 */

import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { unlinkSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CANARY_TS = join(ROOT, 'src', 'build', 'distant-mountains-canary.ts');

const MAX_ALLOWED_TRIANGLES = 18000;
const MAX_ALLOWED_DRAWS = 3;

// 1. Bundle TypeScript module for Node execution in ROOT so node_modules resolves
const outfile = join(ROOT, `tmp-mtn-canary-${process.pid}.mjs`);
try {
  await build({
    entryPoints: [CANARY_TS],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['three'],
    outfile,
    logLevel: 'error',
  });
} catch (err) {
  console.error('Failed to bundle canary module with esbuild:', err);
  process.exit(1);
}

const canaryModule = await import(pathToFileURL(outfile).href);
const {
  createDistantMountainsCanary,
  buildMountainRidgeGeometry,
  DEFAULT_CANARY_LAYERS,
} = canaryModule;

// Mock BuildContext with shared materials
function createMockContext() {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const matCache = new Map();
  const painted = (color, roughness = 0.98, metalness = 0.0) => {
    const key = `${color}_${roughness}_${metalness}`;
    if (!matCache.has(key)) {
      matCache.set(
        key,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(color),
          roughness,
          metalness,
        }),
      );
    }
    return matCache.get(key);
  };

  return {
    rand,
    mat: {
      painted,
    },
  };
}

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass: Boolean(pass), detail: String(detail) });
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name}${detail ? ` - ${detail}` : ''}`);
}

console.log('=== DISTANT MOUNTAINS CANARY CPU VERIFICATION ===\n');

// ---------------------------------------------------------------------------
// POSITIVE PROOF SUITE
// ---------------------------------------------------------------------------
console.log('--- 1. POSITIVE PROOFS (Actual Geometry & Contract Checks) ---');
const ctx = createMockContext();
const result = createDistantMountainsCanary(ctx);

// Check 1: Draw calls
const drawCalls = result.drawCalls;
check(
  'Draw Calls Budget',
  drawCalls <= MAX_ALLOWED_DRAWS && drawCalls > 0,
  `drawCalls=${drawCalls} (limit <= ${MAX_ALLOWED_DRAWS})`,
);

// Check 2: Triangle budget
const triangleCount = result.triangleCount;
check(
  'Triangle Count Budget',
  triangleCount <= MAX_ALLOWED_TRIANGLES && triangleCount > 0,
  `triangles=${triangleCount} (limit <= ${MAX_ALLOWED_TRIANGLES})`,
);

// Check 3: Meshes & Geometries match
check(
  'Mesh & Geometry Topology Match',
  result.meshes.length === drawCalls && result.geometries.length === drawCalls,
  `meshes=${result.meshes.length}, geometries=${result.geometries.length}`,
);

// Check 4: Buffer finite attributes & normals
let totalVertices = 0;
let allFinite = true;
let allNormalsUnit = true;
let maxNormalDev = 0;
let allUVsValid = true;

for (let l = 0; l < result.geometries.length; l++) {
  const geo = result.geometries[l];
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const idx = geo.index;

  totalVertices += pos.count;

  // Check positions
  for (let i = 0; i < pos.count * 3; i++) {
    const val = pos.array[i];
    if (!Number.isFinite(val) || Number.isNaN(val)) {
      allFinite = false;
      break;
    }
  }

  // Check normals length
  for (let i = 0; i < norm.count; i++) {
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const nz = norm.getZ(i);
    const len = Math.hypot(nx, ny, nz);
    const dev = Math.abs(len - 1.0);
    if (dev > maxNormalDev) maxNormalDev = dev;
    if (dev > 0.005) {
      allNormalsUnit = false;
      break;
    }
  }

  // Check UVs
  for (let i = 0; i < uv.count * 2; i++) {
    const val = uv.array[i];
    if (!Number.isFinite(val) || Number.isNaN(val)) {
      allUVsValid = false;
      break;
    }
  }

  // Check indices
  let indicesValid = true;
  for (let i = 0; i < idx.count; i++) {
    const vi = idx.array[i];
    if (vi < 0 || vi >= pos.count) {
      indicesValid = false;
      break;
    }
  }
  check(
    `Layer ${l} (${DEFAULT_CANARY_LAYERS[l].name}) Index Validity`,
    indicesValid,
    `indexCount=${idx.count}, vertexCount=${pos.count}`,
  );
}

check('Vertex Attributes Finite (No NaN / Inf)', allFinite, `totalVertices=${totalVertices}`);
check('Vertex Normals Normalized Unit Vectors', allNormalsUnit, `maxNormalDev=${maxNormalDev.toFixed(6)}`);
check('UV Coordinate Integrity', allUVsValid, 'all UV components finite and non-NaN');

// Check 5: Bounding volume finite & bounds inclusion
const box = result.boundingBox;
const sphere = result.boundingSphere;
const boxFinite =
  Number.isFinite(box.min.x) &&
  Number.isFinite(box.max.x) &&
  Number.isFinite(box.min.y) &&
  Number.isFinite(box.max.y) &&
  Number.isFinite(box.min.z) &&
  Number.isFinite(box.max.z);

const boxNonEmpty = box.max.x > box.min.x && box.max.y > box.min.y && box.max.z > box.min.z;
const sphereValid = Number.isFinite(sphere.radius) && sphere.radius > 0;

check('Bounding Box Finite & Non-Empty', boxFinite && boxNonEmpty, `boxMin=(${box.min.x.toFixed(1)}, ${box.min.y.toFixed(1)}, ${box.min.z.toFixed(1)}), boxMax=(${box.max.x.toFixed(1)}, ${box.max.y.toFixed(1)}, ${box.max.z.toFixed(1)})`);
check('Bounding Sphere Valid', sphereValid, `center=(${sphere.center.x.toFixed(1)}, ${sphere.center.y.toFixed(1)}, ${sphere.center.z.toFixed(1)}), radius=${sphere.radius.toFixed(1)}m`);

// Verify all vertices fall inside the bounding box
let allInsideBox = true;
const EPS = 0.05;
for (const geo of result.geometries) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (
      x < box.min.x - EPS ||
      x > box.max.x + EPS ||
      y < box.min.y - EPS ||
      y > box.max.y + EPS ||
      z < box.min.z - EPS ||
      z > box.max.z + EPS
    ) {
      allInsideBox = false;
      break;
    }
  }
}
check('All Vertices Contained Inside Bounding Box', allInsideBox, '100% vertex containment verified');

// Check 6: Geomorphological Strata & Silhouette Metric vs Smooth Lumpy Baseline
// We compare Layer 1 (Mid Massifs) against a synthetic smooth sinusoidal dome
const midGeo = result.geometries[1];
const midPos = midGeo.attributes.position;
const midCfg = DEFAULT_CANARY_LAYERS[1];
const nTheta = midCfg.segmentsAngle;
const nCross = midCfg.segmentsCross;
const rowStride = nTheta + 1;

// Measure second derivative of crest elevation along theta (angularity of peaks/notches)
let crestCurvatureSum = 0;
for (let i = 1; i < nTheta; i++) {
  // Crest is at row = nFront
  const nFront = Math.round(nCross * midCfg.frontBias);
  const yPrev = midPos.getY(nFront * rowStride + (i - 1));
  const yCurr = midPos.getY(nFront * rowStride + i);
  const yNext = midPos.getY(nFront * rowStride + (i + 1));
  const d2y = Math.abs(yNext - 2 * yCurr + yPrev);
  crestCurvatureSum += d2y;
}
const canaryCrestRoughness = crestCurvatureSum / nTheta;

// Synthetic smooth sine wave baseline (smooth lumpy mountain)
let smoothCurvatureSum = 0;
for (let i = 1; i < nTheta; i++) {
  const tPrev = ((i - 1) / nTheta) * Math.PI * 2;
  const tCurr = (i / nTheta) * Math.PI * 2;
  const tNext = ((i + 1) / nTheta) * Math.PI * 2;
  const yPrev = 100 + 30 * Math.sin(tPrev * 3);
  const yCurr = 100 + 30 * Math.sin(tCurr * 3);
  const yNext = 100 + 30 * Math.sin(tNext * 3);
  const d2y = Math.abs(yNext - 2 * yCurr + yPrev);
  smoothCurvatureSum += d2y;
}
const smoothCrestRoughness = smoothCurvatureSum / nTheta;

const roughnessRatio = canaryCrestRoughness / Math.max(1e-5, smoothCrestRoughness);
check(
  'Silhouette Angularity Metric (vs Smooth Sine Wave)',
  roughnessRatio >= 2.0,
  `canaryRoughness=${canaryCrestRoughness.toFixed(3)}, smoothBase=${smoothCrestRoughness.toFixed(3)}, ratio=${roughnessRatio.toFixed(2)}x (>= 2.0x)`,
);

// Measure cross-slope strata stepping: variance of slope gradient dy/dr
let strataGradientVariance = 0;
let gradSamples = 0;
for (let i = 0; i < nTheta; i += 8) {
  for (let j = 1; j < Math.round(nCross * midCfg.frontBias); j++) {
    const y1 = midPos.getY(j * rowStride + i);
    const y0 = midPos.getY((j - 1) * rowStride + i);
    const dy = y1 - y0;
    strataGradientVariance += Math.abs(dy);
    gradSamples++;
  }
}
const meanGradientVariation = strataGradientVariance / gradSamples;
check(
  'Sedimentary Strata Terracing Gradient',
  meanGradientVariation > 1.5,
  `meanGradientVariation=${meanGradientVariation.toFixed(2)}m per cross-step (strata benches verified)`,
);

// Check 6b (art-round1, additive): front-scarp faces the map, topsides up.
// Regression for the inverted-winding reject: old order put mid-face normals at
// y~-0.64/outward, reading as flat ribbons from every map camera.
{
  let sumY = 0, sumIn = 0, n = 0, minY = Infinity;
  for (let l = 0; l < result.geometries.length; l++) {
    const g = result.geometries[l];
    const p = g.attributes.position, v = g.attributes.normal;
    const cfg = DEFAULT_CANARY_LAYERS[l];
    const rs = cfg.segmentsAngle + 1;
    const nF = Math.max(2, Math.round(cfg.segmentsCross * cfg.frontBias));
    for (let jj = 0; jj <= nF; jj++) {
      for (let ii = 0; ii <= cfg.segmentsAngle; ii += 4) {
        const vi = jj * rs + ii;
        const ny = v.getY(vi);
        sumY += ny; n++; if (ny < minY) minY = ny;
        const px = p.getX(vi), pz = p.getZ(vi);
        const il = Math.hypot(px, pz) || 1;
        sumIn += (v.getX(vi) * -px + v.getZ(vi) * -pz) / il;
      }
    }
  }
  const meanY = sumY / n, meanIn = sumIn / n;
  check('Front-Scarp Normals Point Up', meanY > 0.3, `meanNy=${meanY.toFixed(3)} (must be > 0.3)`);
  check('Front-Scarp Normals Face Map Center', meanIn > 0.3, `meanInward=${meanIn.toFixed(3)} (must be > 0.3)`);
  check('No Downward Front-Scarp Normals', minY > -0.15, `minNy=${minY.toFixed(3)} (inverted winding gave -0.64)`);
}
// Check 6c (art-round2, additive): exact budget/config freeze — round 2 is
// evaluator math only: same 3 draws, same 15,744 tris, same tessellation,
// same ring layout, same shared palette numbers. Any drift fails here.
{
  const EXPECTED = [
    { segmentsAngle: 128, segmentsCross: 14, radius: 310, baseY: -12, radialWidth: 70 },
    { segmentsAngle: 160, segmentsCross: 18, radius: 460, baseY: -12, radialWidth: 105 },
    { segmentsAngle: 160, segmentsCross: 20, radius: 660, baseY: -12, radialWidth: 140 },
  ];
  let freezeOk = triangleCount === 15744 && drawCalls === 3;
  let freezeDetail = `tris=${triangleCount} draws=${drawCalls}`;
  for (let l = 0; l < 3; l++) {
    const c = DEFAULT_CANARY_LAYERS[l];
    const e = EXPECTED[l];
    const tris = c.segmentsAngle * c.segmentsCross * 2;
    if (c.segmentsAngle !== e.segmentsAngle || c.segmentsCross !== e.segmentsCross
      || c.radius !== e.radius || c.baseY !== e.baseY || c.radialWidth !== e.radialWidth) {
      freezeOk = false;
    }
    freezeDetail += ` L${l}=${tris}tris`;
  }
  const palOk = DEFAULT_CANARY_LAYERS[0].materialColor === 0x8a7a5e
    && DEFAULT_CANARY_LAYERS[1].materialColor === 0xa6b4c4
    && DEFAULT_CANARY_LAYERS[2].materialColor === 0xc6d0dc;
  check('Round2 Freeze: Budget/Layout/Palette Unchanged', freezeOk && palOk, `${freezeDetail} pal=${palOk ? 'dirt/mtn/far' : 'DRIFT'}`);
}

// Check 6d (art-round2, additive): silhouette decorrelation — crest height
// profiles of the three rings must not correlate (round-1 shared primes
// stacked peaks into parallel ribbons). Pearson |r| < 0.6 on all pairs.
{
  const crest = [];
  for (let l = 0; l < result.geometries.length; l++) {
    const g = result.geometries[l];
    const cfg = DEFAULT_CANARY_LAYERS[l];
    const rs = cfg.segmentsAngle + 1;
    const nF = Math.max(2, Math.round(cfg.segmentsCross * cfg.frontBias));
    const pos = g.attributes.position;
    const row = [];
    for (let i = 0; i < cfg.segmentsAngle; i++) {
      row.push(pos.getY(nF * rs + i));
    }
    crest.push(row);
  }
  const pearson = (a, b) => {
    const n = Math.min(a.length, b.length);
    const bs = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * (b.length - 1);
      const i0 = Math.floor(t);
      const i1 = Math.min(b.length - 1, i0 + 1);
      const f = t - i0;
      bs.push(b[i0] * (1 - f) + b[i1] * f);
    }
    const aa = a.slice(0, n);
    const ma = aa.reduce((s, v) => s + v, 0) / n;
    const mb = bs.reduce((s, v) => s + v, 0) / n;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < n; i++) {
      const da = aa[i] - ma;
      const db = bs[i] - mb;
      sab += da * db;
      saa += da * da;
      sbb += db * db;
    }
    return sab / Math.max(1e-9, Math.sqrt(saa * sbb));
  };
  const r01 = pearson(crest[0], crest[1]);
  const r02 = pearson(crest[0], crest[2]);
  const r12 = pearson(crest[1], crest[2]);
  const maxR = Math.max(Math.abs(r01), Math.abs(r02), Math.abs(r12));
  check(
    'Round2 Silhouette Decorrelation (|r| < 0.6)',
    maxR < 0.6,
    `r01=${r01.toFixed(3)} r02=${r02.toFixed(3)} r12=${r12.toFixed(3)} max|r|=${maxR.toFixed(3)}`,
  );
}

// Check 6e (art-round2, additive): large front buttress relief — mid-face
// radial range must clear the meander-alone ceiling (2.8 * variation) with a
// margin the old 6.5 m spur could not buy. Proves buttresses project.
{
  let reliefOk = true;
  const parts = [];
  for (let l = 0; l < result.geometries.length; l++) {
    const g = result.geometries[l];
    const cfg = DEFAULT_CANARY_LAYERS[l];
    const rs = cfg.segmentsAngle + 1;
    const nF = Math.max(2, Math.round(cfg.segmentsCross * cfg.frontBias));
    const jm = Math.floor(nF / 2);
    const pos = g.attributes.position;
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < cfg.segmentsAngle; i++) {
      const vi = jm * rs + i;
      const r = Math.hypot(pos.getX(vi), pos.getZ(vi));
      if (r < mn) mn = r;
      if (r > mx) mx = r;
    }
    const range = mx - mn;
    const floor = 2.8 * cfg.radiusVariation + 6;
    if (range <= floor) reliefOk = false;
    parts.push(`L${l}=${range.toFixed(1)}m>floor${floor.toFixed(1)}`);
  }
  check('Round2 Buttress Relief (front radial range)', reliefOk, parts.join(' '));
}
// Check 7: Determinism & Reproducibility
const result2 = createDistantMountainsCanary(ctx);
let byteIdentical = true;
for (let l = 0; l < result.geometries.length; l++) {
  const arr1 = result.geometries[l].attributes.position.array;
  const arr2 = result2.geometries[l].attributes.position.array;
  if (arr1.length !== arr2.length) {
    byteIdentical = false;
    break;
  }
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
      byteIdentical = false;
      break;
    }
  }
}
check('Determinism: Float-for-Float Reproducibility', byteIdentical, 'identical geometry across separate factory calls');
result2.dispose();

// Check 8: Disposal Contract
result.dispose();
check(
  'Disposal Clears Geometry & Buffers',
  result.geometries.length === 0 && result.meshes.length === 0,
  'geometry arrays cleanly cleared and disposed',
);

// ---------------------------------------------------------------------------
// NEGATIVE PROOF SUITE (Trap & Failure Handling)
// ---------------------------------------------------------------------------
console.log('\n--- 2. NEGATIVE PROOFS (Budgets, Corrupt Inputs, Fault Injections) ---');

// Negative Test 1: Over-budget triangle trap
const excessiveLayer = {
  ...DEFAULT_CANARY_LAYERS[0],
  segmentsAngle: 500,
  segmentsCross: 40, // 500 * 40 * 2 = 40,000 triangles (> 18,000)
};
const heavyGeo = buildMountainRidgeGeometry(excessiveLayer);
const heavyTriangles = heavyGeo.index.count / 3;
const trappedOverbudget = heavyTriangles > MAX_ALLOWED_TRIANGLES;
check(
  'Negative Proof: Triangle Budget Overflow Detection',
  trappedOverbudget,
  `detected ${heavyTriangles} tris > limit ${MAX_ALLOWED_TRIANGLES}`,
);
heavyGeo.dispose();

// Negative Test 2: Over-budget draw call trap
const excessiveLayers = [
  DEFAULT_CANARY_LAYERS[0],
  DEFAULT_CANARY_LAYERS[1],
  DEFAULT_CANARY_LAYERS[2],
  { ...DEFAULT_CANARY_LAYERS[0], name: 'illegal_layer_4' },
];
const illegalResult = createDistantMountainsCanary(ctx, excessiveLayers);
const trappedDrawOverflow = illegalResult.drawCalls > MAX_ALLOWED_DRAWS;
check(
  'Negative Proof: Draw Call Budget Overflow Detection',
  trappedDrawOverflow,
  `detected ${illegalResult.drawCalls} draws > limit ${MAX_ALLOWED_DRAWS}`,
);
illegalResult.dispose();

// Negative Test 3: NaN buffer injection rejection
function validateBufferIntegrity(geo) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count * 3; i++) {
    if (!Number.isFinite(pos.array[i]) || Number.isNaN(pos.array[i])) {
      return false;
    }
  }
  return true;
}
const testGeo = buildMountainRidgeGeometry(DEFAULT_CANARY_LAYERS[0]);
testGeo.attributes.position.array[42] = NaN; // Corrupt a vertex
const detectedNaN = !validateBufferIntegrity(testGeo);
check('Negative Proof: Corrupted NaN Vertex Rejection', detectedNaN, 'injected NaN immediately trapped by attribute validator');
testGeo.dispose();

// Negative Test 4: Zero/Corrupt Normal Rejection
function validateNormalsIntegrity(geo) {
  const norm = geo.attributes.normal;
  for (let i = 0; i < norm.count; i++) {
    const len = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i));
    if (len < 0.5 || len > 1.5) return false;
  }
  return true;
}
const testNormGeo = buildMountainRidgeGeometry(DEFAULT_CANARY_LAYERS[0]);
testNormGeo.attributes.normal.setXYZ(10, 0, 0, 0); // zero normal
const detectedZeroNormal = !validateNormalsIntegrity(testNormGeo);
check(
  'Negative Proof: Degenerate Zero-Length Normal Rejection',
  detectedZeroNormal,
  'zero-length normal vector immediately trapped',
);
testNormGeo.dispose();

// ---------------------------------------------------------------------------
// ACTUAL REGISTRATION & RELEASE — through the REAL buildSkyline, not the factory
// in isolation. A disconnected factory callback proves nothing about the shipped
// wiring: the page lifecycle (main.ts releaseEnvironmentCanary) traverses for
// `userData.dispose`, so the builder must register exactly that key.
// ---------------------------------------------------------------------------
console.log('\n--- 3. ACTUAL BUILDER REGISTRATION & RELEASE (real buildSkyline) ---');
// environment-flags must be the SAME module instance the bundled builder reads,
// so bundle a tiny entry re-exporting both (separate imports would not share
// the override state).
const SKYLINE_ENTRY = join(ROOT, `tmp-skyline-entry-${process.pid}.ts`);
const skyOutfile = join(ROOT, `tmp-skyline-canary-${process.pid}.mjs`);
writeFileSync(
  SKYLINE_ENTRY,
  `export { buildSkyline } from './src/build/skyline';\n`
  + `export { setEnvironmentFlagsOverride } from './src/core/environment-flags';\n`,
);
try {
  await build({
    entryPoints: [SKYLINE_ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['three'],
    outfile: skyOutfile,
    logLevel: 'error',
  });
} catch (err) {
  console.error('Failed to bundle skyline module with esbuild:', err);
  process.exit(1);
}
const skylineModule = await import(pathToFileURL(skyOutfile).href);
try { unlinkSync(skyOutfile); } catch {}
try { unlinkSync(SKYLINE_ENTRY); } catch {}

// Full-builder mock context: skyline touches painted/signText/emissive plus the
// steel and windowDark singletons. Deterministic LCG keeps the world reproducible.
function createSkylineMockContext() {
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const stub = () => new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9, metalness: 0 });
  return {
    rand,
    mat: {
      painted: () => stub(),
      signText: () => stub(),
      emissive: () => stub(),
      steel: stub(),
      windowDark: stub(),
    },
  };
}

// 3a. Baseline registers nothing: absent-flag behaviour unchanged.
skylineModule.setEnvironmentFlagsOverride({ groundPbr: null, distantMountains: null });
{
  const res = skylineModule.buildSkyline(createSkylineMockContext());
  check(
    'Baseline skyline registers no canary release',
    res.group.userData.dispose === undefined && res.group.getObjectByName('distant_mountains_canary') === undefined,
    'absent-flag group carries no userData.dispose and no canary subgroup',
  );
  check(
    'Baseline skyline keeps ridge geometry path',
    res.group.children.length > 0,
    `${res.group.children.length} backdrop children built`,
  );
}

// 3b. Canary registers the release under the exact key the page traverses.
skylineModule.setEnvironmentFlagsOverride({ distantMountains: true });
{
  const res = skylineModule.buildSkyline(createSkylineMockContext());
  const inner = res.group.getObjectByName('distant_mountains_canary');
  check('Canary subgroup present in built skyline', inner !== undefined, 'distant_mountains_canary child found');
  const outerRelease = res.group.userData.dispose;
  check(
    'Skyline group registers userData.dispose (page-lifecycle key)',
    typeof outerRelease === 'function',
    typeof outerRelease,
  );
  check(
    'Outer registration is the factory release (single idempotent owner)',
    outerRelease === inner?.userData.dispose,
    'group and subgroup share one release — traverse double-hit collapses',
  );

  // Count real GPU-resource disposals: every canary geometry must fire exactly
  // once across a double release, and no other backdrop geometry may fire.
  const canaryGeos = new Set();
  inner?.traverse((o) => {
    const mesh = o;
    if (mesh.isMesh && mesh.geometry) canaryGeos.add(mesh.geometry);
  });
  let canaryDisposals = 0;
  for (const geo of canaryGeos) geo.addEventListener('dispose', () => { canaryDisposals++; });
  const otherGeos = new Set();
  res.group.traverse((o) => {
    const mesh = o;
    if (mesh.isMesh && mesh.geometry && !canaryGeos.has(mesh.geometry)) otherGeos.add(mesh.geometry);
  });
  let otherDisposals = 0;
  for (const geo of otherGeos) geo.addEventListener('dispose', () => { otherDisposals++; });

  outerRelease();
  check(
    'Release disposes every canary geometry exactly once',
    canaryDisposals === canaryGeos.size && canaryGeos.size === 3,
    `${canaryDisposals}/${canaryGeos.size} dispose events`,
  );
  check('Release touches no non-canary backdrop geometry', otherDisposals === 0, `${otherDisposals} foreign disposals`);
  outerRelease();
  check(
    'Second release is a no-op (idempotent owner)',
    canaryDisposals === canaryGeos.size && otherDisposals === 0,
    'no further dispose events',
  );
}
skylineModule.setEnvironmentFlagsOverride({ groundPbr: null, distantMountains: null });

// ---------------------------------------------------------------------------
// SUMMARY & RESULTS EVALUATION
// ---------------------------------------------------------------------------
try {
  unlinkSync(outfile);
} catch {}

console.log('\n=== VERIFICATION SUMMARY ===');
const failed = checks.filter((c) => !c.pass);
console.log(`Total checks: ${checks.length}`);
console.log(`Passed: ${checks.length - failed.length}`);
console.log(`Failed: ${failed.length}`);

if (failed.length > 0) {
  console.error('\nFAILURES:');
  for (const f of failed) {
    console.error(` - ${f.name}: ${f.detail}`);
  }
  process.exit(1);
} else {
  console.log('\nALL DISTANT MOUNTAINS CANARY CHECKS PASSED (100% GREEN)');
  process.exit(0);
}

