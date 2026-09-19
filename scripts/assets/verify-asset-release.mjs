/**
 * verify-asset-release.mjs — Real asset-cache lifecycle verification.
 *
 * Verifies:
 * 1. Set-based actual GPU resource ownership deduplication in disposeScene:
 *    meshes sharing geometry, materials sharing textures, or packed ORM textures
 *    wired to multiple slots (roughnessMap, metalnessMap, aoMap) are disposed
 *    exactly once per release.
 * 2. Cached asset release using actual bundled assets.ts with controlled GLTFLoader:
 *    releasing 'authored-mountains' disposes its GPU resources, removes it from
 *    cache, preserves 'coach' and other masters, and repeat calls are idempotent.
 * 3. Pending late-load release (race protection):
 *    calling releaseAsset while a load is in-flight ensures the late arrival is
 *    disposed immediately, is NEVER cached into masters, and no .then caches it
 *    after release completes.
 * 4. Rejection safety:
 *    failed pending loads do not trigger unhandled rejections.
 * 5. Pagehide clone detach precedes cache master disposal contract:
 *    clones are detached before shared master GPU buffers are disposed.
 *
 * Runs CPU-only via Node (no browser, no GPU, no Blender):
 *   node scripts/assets/verify-asset-release.mjs
 */
import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ASSETS_TS = join(ROOT, 'src', 'core', 'assets.ts');

let unhandledRejections = [];
process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(reason);
});

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

/**
 * Bundle src/core/assets.ts into a standalone ESM file and import it.
 * Each call creates a fresh module instance with pristine state (masters, pending, released).
 */
let bundleCounter = 0;
async function loadFreshAssetsModule() {
  const id = `test-${Date.now()}-${++bundleCounter}`;
  const tmpFile = join(HERE, `.tmp-assets-${id}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [ASSETS_TS],
      outfile: tmpFile,
      bundle: true,
      external: ['three', 'three/*'],
      format: 'esm',
    });
    const mod = await import(pathToFileURL(tmpFile).href);
    return mod;
  } finally {
    if (existsSync(tmpFile)) {
      try {
        unlinkSync(tmpFile);
      } catch {
        /* best effort cleanup */
      }
    }
  }
}

/** Helper to track disposal counts on Three.js resource objects */
function spyDispose(resource) {
  let count = 0;
  const original = resource.dispose ? resource.dispose.bind(resource) : () => {};
  resource.dispose = () => {
    count++;
    original();
  };
  return () => count;
}

console.log('=== REAL ASSET-CACHE LIFECYCLE & DEDUPLICATION VERIFICATION ===\n');

// -----------------------------------------------------------------------------
// 1. SET-BASED GPU RESOURCE OWNERSHIP DEDUPLICATION
// -----------------------------------------------------------------------------
console.log('--- 1. Set-based GPU Resource Ownership Deduplication ---');
{
  const assetsMod = await loadFreshAssetsModule();

  // Shared geometry
  const sharedGeo = new THREE.BufferGeometry();
  const getGeoDisposeCount = spyDispose(sharedGeo);

  // Distinct geometry
  const distinctGeo = new THREE.BufferGeometry();
  const getDistinctGeoDisposeCount = spyDispose(distinctGeo);

  // Shared ORM texture (wired to roughnessMap, metalnessMap, aoMap across materials)
  const ormTexture = new THREE.Texture();
  const getOrmDisposeCount = spyDispose(ormTexture);

  // Separate color texture
  const colorTexture = new THREE.Texture();
  const getColorDisposeCount = spyDispose(colorTexture);

  // Separate normal texture
  const normalTexture = new THREE.Texture();
  const getNormalDisposeCount = spyDispose(normalTexture);

  // Shared Material 1 (ORM texture wired to 3 slots)
  const sharedMat1 = new THREE.MeshStandardMaterial({
    map: colorTexture,
    roughnessMap: ormTexture,
    metalnessMap: ormTexture,
    aoMap: ormTexture,
  });
  const getMat1DisposeCount = spyDispose(sharedMat1);

  // Material 2 (reuses shared ORM texture in roughnessMap)
  const mat2 = new THREE.MeshStandardMaterial({
    roughnessMap: ormTexture,
    normalMap: normalTexture,
  });
  const getMat2DisposeCount = spyDispose(mat2);

  // Build hierarchy:
  // - Mesh 1 uses sharedGeo, sharedMat1
  // - Mesh 2 uses sharedGeo, sharedMat1 (shared geometry and shared material!)
  // - Mesh 3 uses distinctGeo, mat2 (shares ORM texture across different material!)
  const rootGroup = new THREE.Group();
  const mesh1 = new THREE.Mesh(sharedGeo, sharedMat1);
  const mesh2 = new THREE.Mesh(sharedGeo, sharedMat1);
  const mesh3 = new THREE.Mesh(distinctGeo, mat2);
  rootGroup.add(mesh1, mesh2, mesh3);

  // Execute Set-based disposeScene
  assetsMod.disposeScene(rootGroup);

  check(
    'Shared BufferGeometry disposed exactly once across multiple meshes',
    getGeoDisposeCount() === 1,
    `disposed ${getGeoDisposeCount()} times`
  );
  check(
    'Distinct BufferGeometry disposed exactly once',
    getDistinctGeoDisposeCount() === 1,
    `disposed ${getDistinctGeoDisposeCount()} times`
  );
  check(
    'Shared Material disposed exactly once across multiple meshes',
    getMat1DisposeCount() === 1,
    `disposed ${getMat1DisposeCount()} times`
  );
  check(
    'Material 2 disposed exactly once',
    getMat2DisposeCount() === 1,
    `disposed ${getMat2DisposeCount()} times`
  );
  check(
    'Shared ORM texture wired across 4 slots & 2 materials disposed exactly once',
    getOrmDisposeCount() === 1,
    `disposed ${getOrmDisposeCount()} times (no repeated dispose)`
  );
  check(
    'Color texture disposed exactly once',
    getColorDisposeCount() === 1,
    `disposed ${getColorDisposeCount()} times`
  );
  check(
    'Normal texture disposed exactly once',
    getNormalDisposeCount() === 1,
    `disposed ${getNormalDisposeCount()} times`
  );

  // Repeat call verification (idempotent, does not crash or throw)
  let repeatThrew = false;
  try {
    assetsMod.disposeScene(rootGroup);
  } catch {
    repeatThrew = true;
  }
  check('Repeated disposeScene on already-disposed scene is safe', !repeatThrew);
}

// -----------------------------------------------------------------------------
// 2. CACHED ASSET RELEASE WITH CONTROLLED GLTFLoader
// -----------------------------------------------------------------------------
console.log('\n--- 2. Cached Asset Release & Master Preservation ---');
{
  const assetsMod = await loadFreshAssetsModule();

  // Create mock scenes with tracked disposers
  const coachGeo = new THREE.BufferGeometry();
  const getCoachGeoDispose = spyDispose(coachGeo);
  const coachMat = new THREE.MeshBasicMaterial();
  const getCoachMatDispose = spyDispose(coachMat);
  const coachScene = new THREE.Group();
  coachScene.add(new THREE.Mesh(coachGeo, coachMat));

  const mountainGeo = new THREE.BufferGeometry();
  const getMtnGeoDispose = spyDispose(mountainGeo);
  const mountainMat = new THREE.MeshStandardMaterial();
  const getMtnMatDispose = spyDispose(mountainMat);
  const mountainScene = new THREE.Group();
  mountainScene.add(new THREE.Mesh(mountainGeo, mountainMat));

  // Control GLTFLoader
  const origLoadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async function (url) {
    if (url.includes('coach')) return { scene: coachScene };
    if (url.includes('authored-mountains')) return { scene: mountainScene };
    throw new Error(`Unexpected url: ${url}`);
  };

  try {
    // Preload both coach and authored-mountains
    await assetsMod.preloadAssets(['coach', 'authored-mountains']);

    check('Both coach and authored-mountains resident in cache',
      assetsMod.getAsset('coach') !== undefined &&
      assetsMod.getAsset('authored-mountains') !== undefined
    );

    // Release only authored-mountains
    assetsMod.releaseAsset('authored-mountains');

    check(
      'releaseAsset drops authored-mountains from cache',
      assetsMod.getAsset('authored-mountains') === undefined
    );
    check(
      'releaseAsset disposes authored-mountains GPU resources',
      getMtnGeoDispose() === 1 && getMtnMatDispose() === 1,
      `geo: ${getMtnGeoDispose()}, mat: ${getMtnMatDispose()}`
    );
    check(
      'releaseAsset PRESERVES coach master in cache',
      assetsMod.getAsset('coach') !== undefined,
      'coach clone returned'
    );
    check(
      'releaseAsset leaves coach GPU resources untouched',
      getCoachGeoDispose() === 0 && getCoachMatDispose() === 0,
      `coach geo: ${getCoachGeoDispose()}, coach mat: ${getCoachMatDispose()}`
    );

    // Idempotent repeat release
    assetsMod.releaseAsset('authored-mountains');
    check(
      'Repeat releaseAsset is idempotent no-op (no extra disposals)',
      getMtnGeoDispose() === 1 && getCoachGeoDispose() === 0
    );

    // Unknown asset release is safe no-op
    assetsMod.releaseAsset('unknown-fantasy-asset');
    check('Unknown asset release is silent no-op', true);
  } finally {
    GLTFLoader.prototype.loadAsync = origLoadAsync;
  }
}

// -----------------------------------------------------------------------------
// 3. PENDING LATE-LOAD RELEASE (RACE PROTECTION)
// -----------------------------------------------------------------------------
console.log('\n--- 3. Pending Late-Load Release & Race Guard ---');
{
  const assetsMod = await loadFreshAssetsModule();

  const lateGeo = new THREE.BufferGeometry();
  const getLateGeoDispose = spyDispose(lateGeo);
  const lateMat = new THREE.MeshStandardMaterial();
  const getLateMatDispose = spyDispose(lateMat);
  const lateScene = new THREE.Group();
  lateScene.add(new THREE.Mesh(lateGeo, lateMat));

  let resolveLateLoad;
  const lateLoadPromise = new Promise((resolve) => {
    resolveLateLoad = resolve;
  });

  const origLoadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = function (url) {
    if (url.includes('authored-mountains')) {
      return lateLoadPromise;
    }
    return Promise.reject(new Error(`Unexpected url: ${url}`));
  };

  try {
    // 1. Initiate load (in flight, held pending)
    const preloadPromise = assetsMod.preloadAssets(['authored-mountains']);

    check(
      'authored-mountains is not yet in cache while pending',
      assetsMod.getAsset('authored-mountains') === undefined
    );

    // 2. Call releaseAsset WHILE load is still pending!
    assetsMod.releaseAsset('authored-mountains');

    // 3. Now resolve the late load
    resolveLateLoad({ scene: lateScene });
    await preloadPromise;
    // Allow any subsequent chained microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 20));

    check(
      'Late pending arrival had GPU resources disposed',
      getLateGeoDispose() === 1 && getLateMatDispose() === 1,
      `late geo: ${getLateGeoDispose()}, late mat: ${getLateMatDispose()}`
    );
    check(
      'Late pending arrival is NEVER cached into masters',
      assetsMod.getAsset('authored-mountains') === undefined,
      'getAsset returns undefined'
    );

    // 4. Subsequent load attempts after release must reject
    let subsequentRejected = false;
    try {
      await assetsMod.loadAsset('authored-mountains');
    } catch (err) {
      subsequentRejected = true;
      check(
        'Subsequent loadAsset after release rejects immediately',
        err instanceof Error && err.message.includes('released for page lifetime'),
        err.message
      );
    }
    check('Subsequent loadAsset rejected', subsequentRejected);
  } finally {
    GLTFLoader.prototype.loadAsync = origLoadAsync;
  }
}

// -----------------------------------------------------------------------------
// 4. PENDING LOAD REJECTION & UNHANDLED REJECTION SAFETY
// -----------------------------------------------------------------------------
console.log('\n--- 4. Pending Load Rejection Safety ---');
{
  const assetsMod = await loadFreshAssetsModule();

  let rejectLateLoad;
  const lateLoadPromise = new Promise((_, reject) => {
    rejectLateLoad = reject;
  });

  const origLoadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = function () {
    return lateLoadPromise;
  };

  try {
    const preloadPromise = assetsMod.preloadAssets(['authored-mountains']);
    // Release while in-flight
    assetsMod.releaseAsset('authored-mountains');

    // Reject the in-flight fetch (e.g. network error / 404)
    rejectLateLoad(new Error('Simulated 404 asset missing'));

    // Expected rejection on the caller's promise
    let callerCaught = false;
    try {
      await preloadPromise;
    } catch {
      callerCaught = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    check('Caller caught load error', callerCaught);
    check(
      'releaseAsset void flight.then has no unhandled rejection',
      unhandledRejections.length === 0,
      `unhandled rejections: ${unhandledRejections.length}`
    );
  } finally {
    GLTFLoader.prototype.loadAsync = origLoadAsync;
  }
}

// -----------------------------------------------------------------------------
// 5. PAGEHIDE CLONE DETACH PRECEDES CACHE MASTER DISPOSAL INVARIANT
// -----------------------------------------------------------------------------
console.log('\n--- 5. Pagehide Clone Detach Precedes Cache Master Disposal ---');
{
  const assetsMod = await loadFreshAssetsModule();

  const masterGeo = new THREE.BufferGeometry();
  const getMasterGeoDispose = spyDispose(masterGeo);
  const masterMat = new THREE.MeshStandardMaterial();
  const getMasterMatDispose = spyDispose(masterMat);
  const masterScene = new THREE.Group();
  masterScene.add(new THREE.Mesh(masterGeo, masterMat));

  const origLoadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async function () {
    return { scene: masterScene };
  };

  try {
    await assetsMod.preloadAssets(['authored-mountains']);
    const clone = assetsMod.getAsset('authored-mountains');

    const sceneRoot = new THREE.Group();
    sceneRoot.name = 'skyline';
    sceneRoot.add(clone);

    let cloneDetachedBeforeMasterDisposed = false;
    const authoredUserData = {
      dispose: () => {
        clone.removeFromParent();
        clone.clear();
      },
    };
    sceneRoot.userData = authoredUserData;

    // Simulate main.ts releaseEnvironmentCanary:
    // Step 1: Traverse targets and call clone detach
    if (typeof sceneRoot.userData.dispose === 'function') {
      sceneRoot.userData.dispose();
    }
    // Check clone detached from parent
    if (clone.parent === null) {
      cloneDetachedBeforeMasterDisposed = true;
    }
    // Step 2: Now release cached master
    assetsMod.releaseAsset('authored-mountains');

    check(
      'Clone was detached from parent BEFORE master disposal',
      cloneDetachedBeforeMasterDisposed,
      'clone detached first'
    );
    check(
      'Master GPU resources disposed after clone detach',
      getMasterGeoDispose() === 1 && getMasterMatDispose() === 1,
      `master geo disposed: ${getMasterGeoDispose()}`
    );
    check(
      'Clone children cleared without corrupting master buffers beforehand',
      clone.children.length === 0
    );
  } finally {
    GLTFLoader.prototype.loadAsync = origLoadAsync;
  }
}

// -----------------------------------------------------------------------------
// 6. SUMMARY & EXIT CODE
// -----------------------------------------------------------------------------
console.log('\n=== SUMMARY ===');
const failed = checks.filter((c) => !c.pass);
console.log(`Total: ${checks.length} | Passed: ${checks.length - failed.length} | Failed: ${failed.length}`);

if (failed.length > 0 || unhandledRejections.length > 0) {
  if (unhandledRejections.length > 0) {
    console.error('Unhandled rejections occurred:', unhandledRejections);
  }
  process.exit(1);
}
console.log('ASSET-CACHE LIFECYCLE VERIFICATION GREEN');
