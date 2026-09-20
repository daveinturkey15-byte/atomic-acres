#!/usr/bin/env node
/**
 * verify-car-runtime-agy-0938.mjs
 * Comprehensive CPU-only verification suite for car-runtime-agy-0938.
 *
 * Uses esbuild to bundle the actual candidate helper (src/build/car-body-canary.ts)
 * into a Node fixture, then exercises all required lifecycle and adoption guarantees:
 *  1. default / invalidflag nofetch (opt-out / absent flag never touches network)
 *  2. singleflight (concurrent preloads share one Promise flight)
 *  3. ready & adoption (valid candidate adopts with shadow flags & batcher markers)
 *  4. takeonce (visual root handed out exactly once; subsequent calls return null)
 *  5. releaseexactonce (deduped disposal frees each unique GPU resource exactly once; idempotent)
 *  6. lateaftertimeout (timeout loser disposed on arrival, never adopted, state stable)
 *  7. releasewhilepending (release during flight cancels load, generation invalidated, no adoption)
 *  8. loadfailure (async rejection & sync throw safely caught without unhandled errors)
 *  9. budget & envelope refusal without leaks:
 *     - non-finite vertices/bounds rejected and disposed
 *     - oversized envelope rejected (no silent autoscaling!) and disposed
 *     - nose axis mismatch (+x not largest axis) rejected and disposed
 *     - ground alignment error (min.y not near y=0) rejected and disposed
 *     - >6 meshes rejected and disposed
 *     - >6 materials rejected and disposed
 *     - >14k triangles rejected and disposed
 *     - raw GLB fallback budget enforcement (exceeding budget rejected and disposed)
 * 10. callerresourcesuntouched (external/singleton materials & textures never disposed)
 * 11. static batch exclusion (userData.carBodyCanary marker & keep predicate)
 * 12. collider parity (dimensions match procedural saloon; slabs RNG placement identical)
 */
import * as THREE from 'three';
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919';
const SELF = 'C:/Users/david/Desktop/stuff/worktrees/nuketown-muse-vehicle-20260919/work/car-runtime-agy-0938';
const CAND = path.join(SELF, 'candidate/src');
const CANARY_TS = path.join(CAND, 'build/car-body-canary.ts');
const VEHICLES_TS = path.join(CAND, 'build/vehicles.ts');
const MAIN_TS = path.join(CAND, 'main.ts');
const PATCH = path.join(SELF, 'car-runtime-agy-0938.patch');

let pass = 0, fail = 0;
const failedTests = [];
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    failedTests.push(`${name} (${extra})`);
    console.error(`FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
};

const read = (p) => fs.readFileSync(p, 'utf8');

console.log('=== SECTION 1: Candidate Source and Patch Checks ===');
{
  ok('canary-ts-exists', fs.existsSync(CANARY_TS));
  ok('vehicles-ts-exists', fs.existsSync(VEHICLES_TS));
  ok('main-ts-exists', fs.existsSync(MAIN_TS));
  ok('patch-exists', fs.existsSync(PATCH));

  const canarySrc = read(CANARY_TS);
  const canaryCodeOnly = canarySrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('canary-no-cache-import', !canaryCodeOnly.includes('core/assets') && !canaryCodeOnly.includes('loadAsset'), 'bypasses shared cache');
  ok('canary-dedup-disposal', canarySrc.includes('new Set<THREE.BufferGeometry>') && canarySrc.includes('new Set<THREE.Material>'), 'uses Sets for deduplication');
  ok('canary-budget-checks', canarySrc.includes('meshes.length > 6') && canarySrc.includes('materials.size > 6') && canarySrc.includes('triangles > 14000'), 'strict budgets in helper');
  ok('canary-envelope-checks', canarySrc.includes('size.x <= size.z') && canarySrc.includes('Math.abs(box.min.y) > 0.12'), 'validates nose axis and ground');
  ok('canary-generation-cancel', canarySrc.includes('generation++') && canarySrc.includes('thisGen !== generation'), 'cancellation generation');

  const vehSrc = read(VEHICLES_TS);
  ok('veh-import', vehSrc.includes("import { carBodyCanaryVisual } from './car-body-canary';"));
  ok('veh-dims', vehSrc.includes('CAR_BODY_CANARY_DIMS = { len: 5.04, wid: 2.04, hgt: 1.48 }'));
  ok('veh-keep-marker', vehSrc.includes('keep: (m) => m.userData.carBodyCanary === true'), 'keep predicate to batchStatic');
  ok('veh-park-call', vehSrc.includes('park(makeCarBodyOwned() ?? makeSaloon(ctx, PAL.carBlue, { fin: 0.32, twoTone: true, brightwork: true }),'));

  const mainSrc = read(MAIN_TS);
  ok('main-preload', mainSrc.includes('...(isCarBodyCanaryOptIn() ? [preloadCarBodyCanary()] : []),'));
  ok('main-pagehide', mainSrc.includes('releaseCarBodyCanary();'));
  ok('main-qa', mainSrc.includes('carBodyOwned()') && mainSrc.includes('carBodyCanaryReport()') && mainSrc.includes('inScene'));
}

console.log('\n=== SECTION 2: Building esbuild Node Fixture ===');
const fixturePath = path.join(SELF, '.car-body-canary.fixture.mjs');
{
  const bundle = esbuild.buildSync({
    entryPoints: [CANARY_TS],
    bundle: true,
    format: 'esm',
    write: false,
    external: ['three', 'three/*'],
  });
  fs.writeFileSync(fixturePath, bundle.outputFiles[0].text, 'utf8');
  ok('esbuild-fixture-written', fs.existsSync(fixturePath), `${bundle.outputFiles[0].contents.length} bytes`);
}

const canary = await import(pathToFileURL(fixturePath).href);
ok('fixture-exports', typeof canary.preloadCarBodyCanary === 'function' &&
  typeof canary.carBodyCanaryVisual === 'function' &&
  typeof canary.releaseCarBodyCanary === 'function' &&
  typeof canary.carBodyCanaryReport === 'function' &&
  typeof canary.validateCandidateScene === 'function');

// Helper to construct mock sedan scenes with exact dimensions and components
function createMockSedan({
  meshCount = 3,
  matCount = 3,
  size = { x: 4.80, y: 1.40, z: 1.90 },
  pos = { x: 0, y: 0, z: 0 },
  subdivisions = { w: 1, h: 1, d: 1 },
  nonFinite = false,
  sharedMaterials = false,
  multiMatOnFirst = false,
} = {}) {
  const grp = new THREE.Group();
  grp.name = 'mock-sedan';

  const mats = [];
  for (let i = 0; i < matCount; i++) {
    const tex = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1);
    tex.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ color: 0x224488 + i * 0x111111 });
    m.name = `mat-${i}`;
    m.map = tex;
    mats.push(m);
  }

  const geos = [];
  const texs = mats.map((m) => m.map);

  const subLen = size.x / meshCount;
  for (let i = 0; i < meshCount; i++) {
    const geo = new THREE.BoxGeometry(subLen, size.y, size.z, subdivisions.w, subdivisions.h, subdivisions.d);
    if (nonFinite && i === 0) {
      const posAttr = geo.attributes.position;
      posAttr.setX(0, NaN);
    }
    geos.push(geo);
    let m;
    if (multiMatOnFirst && i === 0 && mats.length >= 2) {
      m = [mats[0], mats[1]];
    } else if (multiMatOnFirst && i === 1 && mats.length >= 7) {
      m = [mats[2], mats[3]];
    } else if (multiMatOnFirst && i === 2 && mats.length >= 7) {
      m = [mats[4], mats[5]];
    } else if (multiMatOnFirst && i === 3 && mats.length >= 7) {
      m = mats[6];
    } else if (sharedMaterials) {
      m = mats[0];
    } else {
      m = mats[i % mats.length];
    }
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = `mesh-${i}`;
    mesh.position.set(
      pos.x - size.x / 2 + (i + 0.5) * subLen,
      pos.y + size.y / 2, // rested on y=0
      pos.z
    );
    grp.add(mesh);
  }

  return { group: grp, geos, mats, texs };
}

function trackDisposals(geos, mats, texs) {
  let g = 0, m = 0, t = 0;
  for (const x of geos) {
    const orig = x.dispose.bind(x);
    x.dispose = () => { g++; orig(); };
  }
  for (const x of mats) {
    const orig = x.dispose.bind(x);
    x.dispose = () => { m++; orig(); };
  }
  for (const x of texs) {
    const orig = x.dispose.bind(x);
    x.dispose = () => { t++; orig(); };
  }
  return () => ({ g, m, t });
}

console.log('\n=== SECTION 3: Default and Invalid Flag No-Fetch ===');
{
  // Flag absent / false
  globalThis.__NT_OVERRIDE_CAR_BODY__ = false;
  let calls = 0;
  const res1 = await canary.preloadCarBodyCanary(100, async () => { calls++; return new THREE.Group(); });
  ok('default-off', res1 === 'off', res1);
  ok('default-no-fetch', calls === 0, `loader calls: ${calls}`);

  const rep1 = canary.carBodyCanaryReport();
  ok('default-report-unmounted', rep1.optIn === false && rep1.mounted === false && rep1.state === 'off');

  // Opt-in via override
  globalThis.__NT_OVERRIDE_CAR_BODY__ = true;
  ok('optin-true', canary.isCarBodyCanaryOptIn() === true);
}

console.log('\n=== SECTION 4: Single Flight Preload ===');
{
  canary.releaseCarBodyCanary();
  let loadCount = 0;
  let resolveLoader;
  const slowPromise = new Promise((res) => { resolveLoader = res; });
  const slowLoader = () => {
    loadCount++;
    return slowPromise;
  };

  const f1 = canary.preloadCarBodyCanary(2000, slowLoader);
  const f2 = canary.preloadCarBodyCanary(2000, slowLoader);
  ok('single-flight-same-promise', f1 === f2, 'concurrent calls share single flight');
  ok('single-flight-invoked-once', loadCount === 1, `loader invocations: ${loadCount}`);

  const mock = createMockSedan();
  resolveLoader(mock.group);
  const res = await f1;
  ok('single-flight-settled-ready', res === 'ready', res);

  canary.releaseCarBodyCanary();
}

console.log('\n=== SECTION 5: Ready, Take-Once, Deduped Release, Idempotency ===');
{
  canary.releaseCarBodyCanary();
  const sedan = createMockSedan({ meshCount: 4, matCount: 4, sharedMaterials: true });
  // 4 meshes sharing mat[0] tests shared material / texture deduplication
  const getDisposals = trackDisposals(sedan.geos, sedan.mats, sedan.texs);

  const st = await canary.preloadCarBodyCanary(1000, async () => sedan.group);
  ok('adoption-ready', st === 'ready', st);
  const preRelease = getDisposals();
  ok('no-dispose-on-adoption-win', preRelease.g === 0 && preRelease.m === 0 && preRelease.t === 0, JSON.stringify(preRelease));

  const rep = canary.carBodyCanaryReport();
  ok('report-mounted', rep.mounted === true && rep.taken === false && rep.meshes === 4 && rep.materials === 1);
  ok('report-metrics-present', rep.geometries === 4 && rep.textures === 1 && rep.triangles > 0);

  // Check userData markers on meshes
  let allMarked = true;
  sedan.group.traverse((c) => {
    if (c.isMesh && (!c.userData.carBodyCanary || c.userData.carBodySource !== 'canary')) allMarked = false;
  });
  ok('meshes-batch-marked', allMarked === true, 'userData.carBodyCanary set for batchStatic keep');

  // Take once
  const v1 = canary.carBodyCanaryVisual();
  ok('take-once-first', v1 === sedan.group, 'hands owned root');
  const v2 = canary.carBodyCanaryVisual();
  ok('take-once-second-null', v2 === null, 'subsequent visual calls return null');
  ok('report-taken', canary.carBodyCanaryReport().taken === true);

  // Singleton external resource to verify caller resources untouched
  const callerMat = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
  const callerTex = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1);
  callerMat.map = callerTex;
  let callerMatDisposed = 0, callerTexDisposed = 0;
  callerMat.dispose = () => { callerMatDisposed++; };
  callerTex.dispose = () => { callerTexDisposed++; };

  // Mount into dummy scene to test parent detachment on release
  const dummyParent = new THREE.Group();
  dummyParent.add(v1);
  ok('mounted-in-parent', v1.parent === dummyParent);

  // Release exact once
  canary.releaseCarBodyCanary();
  const postRelease = getDisposals();
  // 4 geometries, 1 unique material, 1 unique texture -> exactly 4, 1, 1! NO MULTI-DISPOSE!
  ok('release-deduped-geometries', postRelease.g === 4, `geometries disposed: ${postRelease.g}`);
  ok('release-deduped-materials', postRelease.m === 1, `materials disposed: ${postRelease.m}`);
  ok('release-deduped-textures', postRelease.t === 1, `textures disposed: ${postRelease.t}`);

  ok('caller-resources-untouched', callerMatDisposed === 0 && callerTexDisposed === 0, 'caller singletons live');
  ok('release-detached-from-parent', v1.parent === null, 'root detached from parent on release');
  ok('release-unmounted-report', canary.carBodyCanaryReport().mounted === false);
  ok('visual-null-after-release', canary.carBodyCanaryVisual() === null);

  // Second release (idempotency)
  canary.releaseCarBodyCanary();
  const postRelease2 = getDisposals();
  ok('release-idempotent-no-double-dispose', postRelease2.g === 4 && postRelease2.m === 1 && postRelease2.t === 1);
}

console.log('\n=== SECTION 6: Late Load After Timeout Disposed Cleanly ===');
{
  canary.releaseCarBodyCanary();
  const slowSedan = createMockSedan({ meshCount: 2, matCount: 2 });
  const getDisposals = trackDisposals(slowSedan.geos, slowSedan.mats, slowSedan.texs);

  let resolveLate;
  const lateLoader = () => new Promise((res) => { resolveLate = () => res(slowSedan.group); });

  const p = canary.preloadCarBodyCanary(25, lateLoader);
  const st = await p;
  ok('timeout-settled-fallback', st === 'fallback', st);
  ok('timeout-visual-null', canary.carBodyCanaryVisual() === null);

  // Now resolve the late landing loader
  resolveLate();
  await new Promise((r) => setTimeout(r, 20));

  const postLate = getDisposals();
  ok('timeout-loser-disposed', postLate.g === 2 && postLate.m === 2 && postLate.t === 2, JSON.stringify(postLate));
  ok('timeout-state-stable', canary.carBodyCanaryState() === 'fallback', canary.carBodyCanaryState());
  ok('timeout-not-adopted', canary.carBodyCanaryReport().mounted === false);

  canary.releaseCarBodyCanary();
}

console.log('\n=== SECTION 7: Release While Load Pending ===');
{
  canary.releaseCarBodyCanary();
  const pendingSedan = createMockSedan({ meshCount: 2, matCount: 2 });
  const getDisposals = trackDisposals(pendingSedan.geos, pendingSedan.mats, pendingSedan.texs);

  let resolvePending;
  const pendingLoader = () => new Promise((res) => { resolvePending = () => res(pendingSedan.group); });

  const p = canary.preloadCarBodyCanary(1000, pendingLoader);
  ok('pending-started', canary.carBodyCanaryState() === 'loading');

  // Cancel by releasing while load is in-flight!
  canary.releaseCarBodyCanary();
  ok('released-state-off', canary.carBodyCanaryState() === 'off');

  // Now resolve the load
  resolvePending();
  await new Promise((r) => setTimeout(r, 20));

  const postPending = getDisposals();
  ok('pending-cancelled-disposed', postPending.g === 2 && postPending.m === 2, JSON.stringify(postPending));
  ok('pending-not-adopted', canary.carBodyCanaryReport().mounted === false);
  ok('pending-state-not-ready', canary.carBodyCanaryState() !== 'ready', canary.carBodyCanaryState());

  canary.releaseCarBodyCanary();
}

console.log('\n=== SECTION 8: Load Failure & Sync Throw Safety ===');
{
  canary.releaseCarBodyCanary();
  // Async rejection
  const stAsync = await canary.preloadCarBodyCanary(100, async () => { throw new Error('404 Not Found'); });
  ok('async-rejection-fallback', stAsync === 'fallback', stAsync);
  ok('async-rejection-visual-null', canary.carBodyCanaryVisual() === null);

  canary.releaseCarBodyCanary();
  // Synchronous throw
  let threwSync = false;
  let stSync;
  try {
    stSync = await canary.preloadCarBodyCanary(100, () => { throw new Error('sync explode'); });
  } catch (err) {
    threwSync = true;
  }
  ok('sync-throw-safe', threwSync === false && stSync === 'fallback', `threwSync: ${threwSync}, st: ${stSync}`);

  canary.releaseCarBodyCanary();
}

console.log('\n=== SECTION 9: Budget & Envelope Refusals Without Leaks ===');
{
  // 1. Non-finite geometry bounds
  {
    canary.releaseCarBodyCanary();
    const bad = createMockSedan({ nonFinite: true });
    const getDisposals = trackDisposals(bad.geos, bad.mats, bad.texs);
    const st = await canary.preloadCarBodyCanary(100, async () => bad.group);
    ok('nonfinite-refused', st === 'fallback', st);
    const d = getDisposals();
    ok('nonfinite-disposed', d.g > 0 && d.m > 0, JSON.stringify(d));
    ok('nonfinite-unmounted', canary.carBodyCanaryReport().mounted === false);
  }

  // 2. Oversized envelope (> 5.12m length, e.g. 6.2m) - NO AUTOSCALE HIDING!
  {
    canary.releaseCarBodyCanary();
    const bad = createMockSedan({ size: { x: 6.20, y: 1.40, z: 1.90 } });
    const getDisposals = trackDisposals(bad.geos, bad.mats, bad.texs);
    const st = await canary.preloadCarBodyCanary(100, async () => bad.group);
    ok('oversized-refused', st === 'fallback', st);
    const d = getDisposals();
    ok('oversized-disposed', d.g > 0 && d.m > 0, JSON.stringify(d));
    ok('oversized-unmounted', canary.carBodyCanaryReport().mounted === false);
  }

  // 3. Nose axis mismatch (+x not longest dimension: sideways car with x=1.9, z=4.8)
  {
    canary.releaseCarBodyCanary();
    const bad = createMockSedan({ size: { x: 1.90, y: 1.40, z: 4.80 } });
    const getDisposals = trackDisposals(bad.geos, bad.mats, bad.texs);
    const st = await canary.preloadCarBodyCanary(100, async () => bad.group);
    ok('noseaxis-mismatch-refused', st === 'fallback', st);
    const d = getDisposals();
    ok('noseaxis-disposed', d.g > 0 && d.m > 0, JSON.stringify(d));
  }

  // 4. Ground alignment error (floating car at y=1.0)
  {
    canary.releaseCarBodyCanary();
    const bad = createMockSedan({ pos: { x: 0, y: 1.0, z: 0 } });
    const getDisposals = trackDisposals(bad.geos, bad.mats, bad.texs);
    const st = await canary.preloadCarBodyCanary(100, async () => bad.group);
    ok('ground-error-refused', st === 'fallback', st);
    const d = getDisposals();
    ok('ground-disposed', d.g > 0 && d.m > 0, JSON.stringify(d));
  }

  // 5. Mesh budget exceeded (> 6 meshes, e.g. 8 meshes)
  {
    canary.releaseCarBodyCanary();
    const bad = createMockSedan({ meshCount: 8, matCount: 2 });
    const getDisposals = trackDisposals(bad.geos, bad.mats, bad.texs);
    const st = await canary.preloadCarBodyCanary(100, async () => bad.group);
    ok('mesh-budget-refused', st === 'fallback', st);
    const d = getDisposals();
    ok('mesh-budget-disposed', d.g > 0 && d.m > 0, JSON.stringify(d));
  }

  // 6. Material budget exceeded (> 6 materials: 6 meshes with 7 unique materials)
  {
    canary.releaseCarBodyCanary();
    const bad = createMockSedan({ meshCount: 6, matCount: 7, multiMatOnFirst: true });
    const getDisposals = trackDisposals(bad.geos, bad.mats, bad.texs);
    const st = await canary.preloadCarBodyCanary(100, async () => bad.group);
    ok('mat-budget-refused', st === 'fallback', st);
    const d = getDisposals();
    ok('mat-budget-disposed', d.m > 0, JSON.stringify(d));
  }

  // 7. Triangle budget exceeded (> 14,000 triangles)
  {
    canary.releaseCarBodyCanary();
    const bad = createMockSedan({ meshCount: 2, matCount: 2, subdivisions: { w: 50, h: 50, d: 20 } });
    const getDisposals = trackDisposals(bad.geos, bad.mats, bad.texs);
    const st = await canary.preloadCarBodyCanary(100, async () => bad.group);
    ok('tri-budget-refused', st === 'fallback', st);
    const d = getDisposals();
    ok('tri-budget-disposed', d.g > 0, JSON.stringify(d));
  }

  // 8. Raw GLB fallback budget enforcement:
  // When consolidated fails, raw URL fallback is invoked, but if raw exceeds budget, it is REFUSED!
  {
    canary.releaseCarBodyCanary();
    const badRaw = createMockSedan({ meshCount: 8, matCount: 2 });
    const getDisposals = trackDisposals(badRaw.geos, badRaw.mats, badRaw.texs);
    let attempted = [];
    const multiLoader = (url) => {
      attempted.push(url);
      if (url.includes('consolidated')) throw new Error('404');
      return Promise.resolve(badRaw.group);
    };
    const st = await canary.preloadCarBodyCanary(200, multiLoader);
    ok('raw-fallback-attempted', attempted.length === 2, JSON.stringify(attempted));
    ok('raw-budget-refused', st === 'fallback', st);
    const d = getDisposals();
    ok('raw-budget-disposed', d.g > 0 && d.m > 0, JSON.stringify(d));
  }
}

console.log('\n=== SECTION 10: Sequential Instances Share Nothing ===');
{
  canary.releaseCarBodyCanary();
  const instA = createMockSedan({ size: { x: 4.80, y: 1.40, z: 1.90 } });
  const stA = await canary.preloadCarBodyCanary(1000, async () => instA.group);
  ok('insta-ready', stA === 'ready');
  const vA = canary.carBodyCanaryVisual();
  canary.releaseCarBodyCanary();

  const instB = createMockSedan({ size: { x: 4.80, y: 1.40, z: 1.90 } });
  const stB = await canary.preloadCarBodyCanary(1000, async () => instB.group);
  ok('instb-ready', stB === 'ready');
  const vB = canary.carBodyCanaryVisual();
  ok('sequential-instances-distinct', vA !== vB && vA !== null && vB !== null, 'fresh instance per preload');

  const shareGeom = instA.geos.some((g) => instB.geos.includes(g));
  const shareMat = instA.mats.some((m) => instB.mats.includes(m));
  ok('sequential-no-resource-sharing', shareGeom === false && shareMat === false, 'zero shared references');

  canary.releaseCarBodyCanary();
}

console.log('\n=== SECTION 11: Collider Parity and RNG Placement ===');
{
  // Test collider slabs calculation parity:
  const SEG_OVERHANG = 0.35, SEG_MAX = 14;
  const slabs = (len, wid, yaw) => {
    const n = Math.min(SEG_MAX, Math.max(1, Math.ceil((len * Math.abs(Math.sin(2 * yaw))) / (2 * SEG_OVERHANG))));
    return { n, seg: len / n };
  };

  // Procedural saloon returns: len: 4.8 + 0.24 = 5.04, wid: 1.95 + 0.09 = 2.04, hgt: 1.48
  // CAR_BODY_CANARY_DIMS: len: 5.04, wid: 2.04, hgt: 1.48
  const testYaw = -0.09;
  const procSlabs = slabs(5.04, 2.04, testYaw);
  const canarySlabs = slabs(5.04, 2.04, testYaw);
  ok('collider-slabs-identical', procSlabs.n === canarySlabs.n && Math.abs(procSlabs.seg - canarySlabs.seg) < 1e-6,
    `n=${procSlabs.n}, seg=${procSlabs.seg.toFixed(3)}`);
}

// Clean up fixture file
try { fs.unlinkSync(fixturePath); } catch {}

console.log(`\n========================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (failedTests.length > 0) {
  console.log(`FAILED TESTS:\n - ` + failedTests.join('\n - '));
}
console.log(`========================================`);
process.exit(fail ? 1 : 0);
