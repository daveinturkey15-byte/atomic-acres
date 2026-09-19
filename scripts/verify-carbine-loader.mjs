#!/usr/bin/env node
/**
 * CPU-only verification suite for the Catalog Carbine Loader.
 *
 * Proves the 8 required lifetime and ownership contracts:
 *   1. two instances (shared master buffers, refCount = 2)
 *   2. release one (refCount = 1, master preserved, sibling intact)
 *   3. release all (refCount = 0, master resources cleanly disposed)
 *   4. idempotence (multiple dispose calls are safe no-ops)
 *   5. late cancel (in-flight load cancelled before resolve; no resurrection)
 *   6. load failure (rejection falls back cleanly without crashing)
 *   7. missing sockets (bad asset rejected, never fabricated; fallback engaged)
 *   8. fallback shared material survival (shared MaterialLibrary never disposed)
 *
 * Plus asset structural proof (actual exported GLB file has all 18 meshes and 4 sockets),
 * query-flag parsing, controller integration, and the lifecycle repairs:
 *   12. factory hands disposal (owned hands geometries freed, shared materials survive)
 *   13. active-clear orphan + stale-release guard (siblings survive, reload intact)
 *   14. overlapping pending generation (stale discarded, newer survives)
 *   15. post-increment error releases its reference (no leak, sibling valid)
 *   16. controller teardown before resolution (late rig disposed, no swap)
 *   17. canary QA status (URL/sockets/candidate-vs-fallback proves GLB adoption).
 */
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LOADER_PATH = resolve(ROOT, 'src/weapons/catalog-carbine-loader.ts');
const CONTROLLER_PATH = resolve(ROOT, 'src/weapons/controller.ts');
const OUTFILE = join(tmpdir(), `carbine-loader-verify-${process.pid}.mjs`);

const ENTRY = `
  import * as THREE from ${JSON.stringify(join(ROOT, 'node_modules/three'))};
  import {
    loadCatalogCarbineRig,
    clearMasterCarbineCache,
    releaseAllCarbineResources,
    getCarbineCacheStats,
    validateRequiredSockets,
    findNamedSocket,
    collectGltfResources,
    disposeResourceSet,
    disposeOwnedGeometries,
    getPresentCarbineSockets,
    canonicalizeUrl,
    REQUIRED_CARBINE_SOCKETS,
    CATALOG_CARBINE_GLB_URL,
    isCarbineCanaryRequested,
  } from ${JSON.stringify(LOADER_PATH)};
  import { WeaponsController } from ${JSON.stringify(CONTROLLER_PATH)};

  export {
    THREE,
    loadCatalogCarbineRig,
    clearMasterCarbineCache,
    releaseAllCarbineResources,
    getCarbineCacheStats,
    validateRequiredSockets,
    findNamedSocket,
    collectGltfResources,
    disposeResourceSet,
    disposeOwnedGeometries,
    getPresentCarbineSockets,
    canonicalizeUrl,
    REQUIRED_CARBINE_SOCKETS,
    CATALOG_CARBINE_GLB_URL,
    isCarbineCanaryRequested,
    WeaponsController,
  };
`;

const assert = (ok, msg) => {
  if (!ok) {
    console.error(`FAIL: ${msg}`);
    throw new Error(msg);
  }
};

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'verify-entry.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: OUTFILE,
  logLevel: 'warning',
});

try {
  const api = await import(pathToFileURL(OUTFILE).href);
  const { THREE } = api;

  console.log('=== Catalog Carbine Loader CPU Verification ===\n');

  // Helper: create a valid mock GLTF scene with tracked geometries, materials, and textures
  function createMockValidScene() {
    const scene = new THREE.Group();
    scene.name = 'Scene';

    // Track disposals
    const disposals = {
      geometries: 0,
      materials: 0,
      textures: 0,
    };

    // 4 required sockets
    const muzzle = new THREE.Object3D();
    muzzle.name = 'anchor_muzzle';
    muzzle.position.set(0, 0.035, -0.615);

    const grip = new THREE.Object3D();
    grip.name = 'anchor_grip';
    grip.position.set(0, -0.072, -0.006);

    const support = new THREE.Object3D();
    support.name = 'anchor_support';
    support.position.set(0, 0.002, -0.330);

    const mag = new THREE.Object3D();
    mag.name = 'anchor_mag';
    mag.position.set(0, -0.052, -0.118);

    scene.add(muzzle, grip, support, mag);

    // Add 18 mock meshes with textures
    for (let i = 0; i < 18; i++) {
      const geom = new THREE.BoxGeometry(0.01, 0.01, 0.01);
      const origGeomDispose = geom.dispose.bind(geom);
      geom.dispose = () => {
        disposals.geometries++;
        origGeomDispose();
      };

      const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
      const origTexDispose = tex.dispose.bind(tex);
      tex.dispose = () => {
        disposals.textures++;
        origTexDispose();
      };

      const mat = new THREE.MeshStandardMaterial({ map: tex });
      const origMatDispose = mat.dispose.bind(mat);
      mat.dispose = () => {
        disposals.materials++;
        origMatDispose();
      };

      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = `part_${i}`;
      scene.add(mesh);
    }

    return { scene, disposals };
  }

  // Helper: create a mock MaterialLibrary with tracked materials
  function createMockMaterialLibrary() {
    let disposedCount = 0;
    const track = (mat) => {
      const orig = mat.dispose.bind(mat);
      mat.dispose = () => {
        disposedCount++;
        orig();
      };
      return mat;
    };

    const sharedMat = track(new THREE.MeshStandardMaterial({ color: 0x111111 }));
    const viewmodelSet = {
      sleeve: track(new THREE.MeshStandardMaterial({ color: 0x223322 })),
      darkGlove: track(new THREE.MeshStandardMaterial({ color: 0x111111 })),
      woodFurniture: track(new THREE.MeshStandardMaterial({ color: 0x442211 })),
      parkerizedSteel: sharedMat,
      gloveDetail: track(new THREE.MeshStandardMaterial({ color: 0x111111 })),
      stats: { materials: 4, textures: 0, albedoSize: 0, detailSize: 0, cpuTextureBytes: 0 },
    };

    const lib = {
      viewmodel: viewmodelSet,
      chrome: track(new THREE.MeshStandardMaterial({ color: 0xcccccc })),
      timberDark: track(new THREE.MeshStandardMaterial({ color: 0x221105 })),
      painted: () => track(new THREE.MeshStandardMaterial({ color: 0x333333 })),
      emissive: () => track(new THREE.MeshBasicMaterial({ color: 0xffffaa })),
      getDisposedCount: () => disposedCount,
    };

    return lib;
  }

  // -------------------------------------------------------------
  // Test 1: Two instances & shared master buffers
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const mock = createMockValidScene();
    const mockLoader = {
      loadAsync: async () => ({ scene: mock.scene }),
    };

    const rig1 = await api.loadCatalogCarbineRig({
      url: 'mock://carbine-1.glb',
      customLoader: mockLoader,
      attachHands: false,
    });
    const rig2 = await api.loadCatalogCarbineRig({
      url: 'mock://carbine-1.glb',
      customLoader: mockLoader,
      attachHands: false,
    });

    assert(rig1 !== rig2, 'two distinct rig instances must be created');
    assert(rig1.group !== rig2.group, 'two distinct group hierarchies must be created');
    assert(rig1.isGLTFAsset === true, 'rig1 must be GLTF asset');
    assert(rig2.isGLTFAsset === true, 'rig2 must be GLTF asset');

    // Verify shared geometry between instances
    const mesh1 = rig1.group.getObjectByName('part_0');
    const mesh2 = rig2.group.getObjectByName('part_0');
    assert(mesh1 && mesh2, 'part_0 mesh must exist on both rigs');
    assert(mesh1.geometry === mesh2.geometry, 'both rigs must share the same geometry instance');
    assert(mesh1.material === mesh2.material, 'both rigs must share the same material instance');

    const stats = api.getCarbineCacheStats();
    assert(stats.refCounts['mock://carbine-1.glb'] === 2, 'refCount must be 2 for two active instances');

    // -------------------------------------------------------------
    // Test 2: Release one (sibling remains completely intact)
    // -------------------------------------------------------------
    rig1.dispose();

    const statsAfterRel1 = api.getCarbineCacheStats();
    assert(statsAfterRel1.refCounts['mock://carbine-1.glb'] === 1, 'refCount must be 1 after releasing one instance');
    assert(mock.disposals.geometries === 0, 'shared geometries must NOT be disposed when sibling is still active');
    assert(mock.disposals.materials === 0, 'shared materials must NOT be disposed when sibling is still active');
    assert(mock.disposals.textures === 0, 'shared textures must NOT be disposed when sibling is still active');

    // Verify rig2 is still fully usable
    assert(mesh2.geometry.isBufferGeometry, 'rig2 geometry must remain valid and intact');
    assert(rig2.muzzle.position.z === -0.615, 'rig2 muzzle anchor must be intact');

    // -------------------------------------------------------------
    // Test 3: Release all (resources cleanly disposed)
    // -------------------------------------------------------------
    rig2.dispose();

    const statsAfterRelAll = api.getCarbineCacheStats();
    assert(statsAfterRelAll.refCounts['mock://carbine-1.glb'] === undefined, 'cache entry must be cleaned up on refCount 0');
    assert(mock.disposals.geometries === 18, `all 18 geometries must be disposed (got ${mock.disposals.geometries})`);
    assert(mock.disposals.materials === 18, `all 18 materials must be disposed (got ${mock.disposals.materials})`);
    assert(mock.disposals.textures === 18, `all 18 textures must be disposed (got ${mock.disposals.textures})`);

    console.log('✓ Proof 1: Two instances (shared buffers, refCount = 2) passed.');
    console.log('✓ Proof 2: Release one (sibling intact, zero GPU leaks) passed.');
    console.log('✓ Proof 3: Release all (all master resources cleanly disposed) passed.');
  }

  // -------------------------------------------------------------
  // Test 4: Idempotence
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const mock = createMockValidScene();
    const mockLoader = {
      loadAsync: async () => ({ scene: mock.scene }),
    };

    const rig = await api.loadCatalogCarbineRig({
      url: 'mock://carbine-idempotence.glb',
      customLoader: mockLoader,
      attachHands: false,
    });

    // Multiple dispose calls on same instance
    rig.dispose();
    rig.dispose();
    rig.dispose();

    assert(mock.disposals.geometries === 18, 'geometries must be disposed exactly once, not multiple times');

    // Multiple clear calls
    api.clearMasterCarbineCache();
    api.clearMasterCarbineCache();
    api.releaseAllCarbineResources();

    console.log('✓ Proof 4: Idempotence (multiple dispose/clear calls are safe no-ops) passed.');
  }

  // -------------------------------------------------------------
  // Test 5: Late cancel (no resurrection after clear)
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    let resolveDelayedLoad;
    const delayedPromise = new Promise((resolve) => {
      resolveDelayedLoad = resolve;
    });

    const mock = createMockValidScene();
    const slowLoader = {
      loadAsync: async () => delayedPromise,
    };

    // Start load
    const loadPromise = api.loadCatalogCarbineRig({
      url: 'mock://carbine-slow.glb',
      customLoader: slowLoader,
      attachHands: false,
    });

    // Immediately clear cache before the load resolves
    api.clearMasterCarbineCache();

    // Now resolve the delayed load
    resolveDelayedLoad({ scene: mock.scene });

    let loadThrew = false;
    try {
      await loadPromise;
    } catch (e) {
      loadThrew = true;
    }

    assert(loadThrew, 'cancelled load must reject and not succeed');
    const statsAfterLate = api.getCarbineCacheStats();
    assert(statsAfterLate.cachedUrls.length === 0, 'late resolving load must NOT resurrect into cache');
    assert(mock.disposals.geometries === 18, 'late resolving resources must be immediately disposed');

    console.log('✓ Proof 5: Late cancel (pending load discarded on clear, no resurrection) passed.');
  }

  // -------------------------------------------------------------
  // Test 6: Load failure & clean fallback
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const failingLoader = {
      loadAsync: async () => {
        throw new Error('404 Network Error');
      },
    };

    const mockMat = createMockMaterialLibrary();
    const fallbackRig = await api.loadCatalogCarbineRig({
      url: 'mock://nonexistent.glb',
      customLoader: failingLoader,
      mat: mockMat,
      attachHands: false,
    });

    assert(fallbackRig !== null, 'must return fallback rig on load error');
    assert(fallbackRig.isGLTFAsset === false, 'fallback rig must have isGLTFAsset: false');
    assert(fallbackRig.muzzle !== undefined, 'fallback rig must have muzzle socket');
    assert(fallbackRig.gripSocket !== undefined, 'fallback rig must have gripSocket');
    assert(fallbackRig.supportSocket !== undefined, 'fallback rig must have supportSocket');
    assert(fallbackRig.magSocket !== undefined, 'fallback rig must have magSocket');

    const statsAfterFail = api.getCarbineCacheStats();
    assert(statsAfterFail.pendingCount === 0, 'pending load state must be cleaned up after failure');

    console.log('✓ Proof 6: Load failure (gracefully returns procedural fallback without crash) passed.');
  }

  // -------------------------------------------------------------
  // Test 7: Missing sockets (rejection & fallback, NEVER fabricate)
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const mock = createMockValidScene();
    // Intentionally remove anchor_support socket
    const supportNode = mock.scene.getObjectByName('anchor_support');
    mock.scene.remove(supportNode);

    const badSocketLoader = {
      loadAsync: async () => ({ scene: mock.scene }),
    };

    const mockMat = createMockMaterialLibrary();
    const fallbackRig = await api.loadCatalogCarbineRig({
      url: 'mock://missing-socket.glb',
      customLoader: badSocketLoader,
      mat: mockMat,
      attachHands: false,
    });

    assert(fallbackRig.isGLTFAsset === false, 'bad asset missing required socket must fall back to procedural');
    assert(mock.disposals.geometries === 18, 'bad asset resources must be disposed on rejection');

    console.log('✓ Proof 7: Missing sockets (asset rejected without fabricating sockets, fallback engaged) passed.');
  }

  // -------------------------------------------------------------
  // Test 8: Fallback shared material survival
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const failingLoader = {
      loadAsync: async () => { throw new Error('Force fallback'); },
    };

    const mockMat = createMockMaterialLibrary();
    const fallbackRig = await api.loadCatalogCarbineRig({
      url: 'mock://failing.glb',
      customLoader: failingLoader,
      mat: mockMat,
      attachHands: false,
    });

    // Dispose the fallback rig
    fallbackRig.dispose();

    // Verify that NO materials from mockMat were disposed!
    assert(mockMat.getDisposedCount() === 0, `shared materials in MaterialLibrary must NOT be disposed (got ${mockMat.getDisposedCount()})`);
    assert(mockMat.viewmodel.parkerizedSteel !== undefined, 'parkerizedSteel must remain valid');

    console.log('✓ Proof 8: Fallback shared material survival (MaterialLibrary intact after fallback teardown) passed.');
  }

  // -------------------------------------------------------------
  // Test 9: Actual exported GLB file structural verification
  // -------------------------------------------------------------
  {
    const glbPath = resolve(ROOT, 'public/assets/catalog-carbine/carbine.glb');
    const glbBuf = readFileSync(glbPath);
    assert(glbBuf.length > 0, 'carbine.glb must exist and be non-empty');

    const magic = glbBuf.readUInt32LE(0);
    assert(magic === 0x46546c67, 'valid glTF binary magic');
    const jsonLen = glbBuf.readUInt32LE(12);
    const jsonStr = glbBuf.toString('utf8', 20, 20 + jsonLen);
    const gltf = JSON.parse(jsonStr);

    const nodeNames = gltf.nodes.map((n) => n.name);
    console.log(`\nGLB Inspection: ${nodeNames.length} nodes found in actual exported GLB:`);

    // Verify 4 required hardware sockets exist in GLB
    for (const reqSocket of api.REQUIRED_CARBINE_SOCKETS) {
      assert(nodeNames.includes(reqSocket), `GLB must contain hardware empty '${reqSocket}'`);
    }

    // Verify orientation of sockets:
    const muzzleNode = gltf.nodes.find((n) => n.name === 'anchor_muzzle');
    const gripNode = gltf.nodes.find((n) => n.name === 'anchor_grip');
    const supportNode = gltf.nodes.find((n) => n.name === 'anchor_support');
    const magNode = gltf.nodes.find((n) => n.name === 'anchor_mag');

    assert(muzzleNode.translation[2] < -0.5, 'muzzle must point forward along -Z');
    assert(supportNode.translation[2] < -0.2, 'support hand must be forward on handguard along -Z');
    assert(magNode.translation[1] < 0, 'magwell must be below receiver along -Y');
    assert(gripNode.translation[1] < 0, 'grip must be below receiver along -Y');

    // Count meshes
    const meshNodes = gltf.nodes.filter((n) => n.mesh !== undefined);
    assert(meshNodes.length === 18, `GLB must contain exactly 18 mesh components (found ${meshNodes.length})`);

    console.log(`✓ Proof 9: Actual GLB structural verification (18 meshes, 4 sockets, correct -Z orientation) passed.`);
  }

  // -------------------------------------------------------------
  // Test 10: Query flag parser test
  // -------------------------------------------------------------
  {
    assert(api.isCarbineCanaryRequested('?carbine=canary') === true, '?carbine=canary must return true');
    assert(api.isCarbineCanaryRequested('?tod=noon&carbine=canary&weather=clear') === true, 'multi-param ?carbine=canary must return true');
    assert(api.isCarbineCanaryRequested('?carbine=false') === false, '?carbine=false must return false');
    assert(api.isCarbineCanaryRequested('') === false, 'empty search must return false');
    assert(api.isCarbineCanaryRequested('?tod=noon') === false, 'other params must return false');

    console.log('✓ Proof 10: Query flag (?carbine=canary) parsing verification passed.');
  }

  // -------------------------------------------------------------
  // Test 11: WeaponsController integration & canary swap
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const mockMat = createMockMaterialLibrary();
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 100);
    const scene = new THREE.Scene();

    // 11a: Baseline controller (carbineCanary: false)
    const baselineController = new api.WeaponsController({
      camera,
      scene,
      mat: mockMat,
      targets: [],
      onHud: () => {},
      carbineCanary: false,
    });

    assert(baselineController.activeCarbineRig === null, 'baseline controller must not have activeCarbineRig');
    const snapshot = baselineController.command('state');
    assert(snapshot.name === 'Longhorn', 'weapon 0 must be Longhorn');
    baselineController.dispose();

    // 11b: Canary controller (carbineCanary: true) with mocked loader
    const mock = createMockValidScene();
    const customLoader = {
      loadAsync: async () => ({ scene: mock.scene }),
    };

    // Pre-cache mock asset under CATALOG_CARBINE_GLB_URL
    const preloadedRig = await api.loadCatalogCarbineRig({
      url: api.CATALOG_CARBINE_GLB_URL,
      customLoader,
      attachHands: false,
    });

    const canaryController = new api.WeaponsController({
      camera,
      scene,
      mat: mockMat,
      targets: [],
      onHud: () => {},
      carbineCanary: true,
    });

    // Wait microtask tick for async canary resolution
    await new Promise((r) => setTimeout(r, 20));

    assert(canaryController.activeCarbineRig !== null, 'canary controller must acquire activeCarbineRig');
    assert(canaryController.activeCarbineRig.isGLTFAsset === true, 'activeCarbineRig must be GLTF asset');

    // Verify fallback gun is NOT in overlay (never overlap both guns)
    let visibleGunCount = 0;
    for (const child of canaryController.overlay.children) {
      if (child.isGroup && child.visible && child.name.includes('Viewmodel')) {
        visibleGunCount++;
      }
    }
    assert(visibleGunCount === 1, `exactly 1 weapon viewmodel must be visible in overlay (got ${visibleGunCount})`);

    // Teardown
    canaryController.dispose();
    preloadedRig.dispose();

    console.log('✓ Proof 11: WeaponsController integration (baseline preservation, canary swap, zero overlap, safe teardown) passed.');
  }

  // -------------------------------------------------------------
  // Test 12: Actual factory hands are owned geometries and dispose
  // (Previous GLB dispose detached hands without disposing: 0/10 freed.)
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const mock = createMockValidScene();
    const mockMat = createMockMaterialLibrary();
    const mockLoader = { loadAsync: async () => ({ scene: mock.scene }) };
    const rig = await api.loadCatalogCarbineRig({
      url: 'mock://carbine-hands.glb',
      customLoader: mockLoader,
      mat: mockMat,
      attachHands: true,
    });
    assert(rig.isGLTFAsset === true, 'hands rig must be GLTF asset');
    assert(rig.hands !== undefined && rig.hands !== null, 'hands rig must attach real factory hands');
    const handGeos = new Set();
    rig.hands.root.traverse((n) => { if (n.isMesh && n.geometry) handGeos.add(n.geometry); });
    assert(handGeos.size >= 8, `factory hands must own geometries (got ${handGeos.size})`);
    let handDisposals = 0;
    for (const g of handGeos) {
      const orig = g.dispose.bind(g);
      g.dispose = () => { handDisposals++; orig(); };
    }
    rig.dispose();
    assert(handDisposals === handGeos.size, `all hands geometries must dispose (got ${handDisposals}/${handGeos.size})`);
    assert(mock.disposals.geometries === 18, `master geometries must dispose on last release (got ${mock.disposals.geometries})`);
    assert(mockMat.getDisposedCount() === 0, 'shared viewmodel/painted materials must survive hands disposal');
    console.log('✓ Proof 12: Factory hands disposal (owned geometries freed, shared materials survive) passed.');
  }

  // -------------------------------------------------------------
  // Test 13: Active clear orphans; stale release never deletes the reload
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const scenes = [];
    const freshLoader = {
      loadAsync: async () => {
        const m = createMockValidScene();
        scenes.push(m);
        return { scene: m.scene };
      },
    };
    const URL = 'mock://carbine-active-clear.glb';
    const rig1 = await api.loadCatalogCarbineRig({ url: URL, customLoader: freshLoader, attachHands: false });
    const rig2 = await api.loadCatalogCarbineRig({ url: URL, customLoader: freshLoader, attachHands: false });
    assert(scenes.length === 1, 'second load must share the cached master');
    api.clearMasterCarbineCache(URL);
    assert(scenes[0].disposals.geometries === 0, 'active clear must NOT dispose under live clones');
    assert(api.getCarbineCacheStats().cachedUrls.length === 0, 'active clear must remove the entry from the cache');
    const mesh2 = rig2.group.getObjectByName('part_0');
    assert(mesh2 && mesh2.geometry.isBufferGeometry, 'sibling clone must stay usable after active clear');
    rig1.dispose();
    assert(scenes[0].disposals.geometries === 0, 'orphaned master must survive until the last sibling releases');
    const rig3 = await api.loadCatalogCarbineRig({ url: URL, customLoader: freshLoader, attachHands: false });
    assert(scenes.length === 2, 'reload after clear must decode a fresh master');
    assert(api.getCarbineCacheStats().cachedUrls.length === 1, 'reload must install the new entry');
    rig2.dispose();
    assert(scenes[0].disposals.geometries === 18, 'orphaned master must dispose on last sibling release');
    assert(api.getCarbineCacheStats().cachedUrls.length === 1, 'stale release must NOT delete the reloaded entry');
    const mesh3 = rig3.group.getObjectByName('part_0');
    assert(mesh3 && mesh3.geometry.isBufferGeometry, 'reloaded clone must stay usable after stale release');
    assert(scenes[1].disposals.geometries === 0, 'reloaded master must be untouched by stale release');
    rig3.dispose();
    assert(scenes[1].disposals.geometries === 18, 'reloaded master must dispose on last release');
    console.log('✓ Proof 13: Active-clear orphan + stale-release guard passed.');
  }

  // -------------------------------------------------------------
  // Test 14: Overlapping pending loads (stale finally must not kill the new pending)
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const URL = 'mock://carbine-overlap.glb';
    let resolveA;
    let resolveB;
    const gateA = new Promise((r) => { resolveA = r; });
    const gateB = new Promise((r) => { resolveB = r; });
    let calls = 0;
    const overlapLoader = {
      loadAsync: async () => {
        calls++;
        return calls === 1 ? gateA : gateB;
      },
    };
    const mockA = createMockValidScene();
    const mockB = createMockValidScene();
    const loadA = api.loadCatalogCarbineRig({ url: URL, customLoader: overlapLoader, attachHands: false });
    api.clearMasterCarbineCache(URL);
    const loadB = api.loadCatalogCarbineRig({ url: URL, customLoader: overlapLoader, attachHands: false });
    resolveA({ scene: mockA.scene });
    let threwA = false;
    try { await loadA; } catch { threwA = true; }
    assert(threwA, 'stale load must reject after clear');
    assert(mockA.disposals.geometries === 18, 'stale resources must dispose immediately');
    assert(api.getCarbineCacheStats().pendingCount === 1, 'stale finally must NOT delete the newer pending load');
    resolveB({ scene: mockB.scene });
    const rigB = await loadB;
    assert(rigB.isGLTFAsset === true, 'newer pending load must succeed');
    assert(api.getCarbineCacheStats().pendingCount === 0, 'pending state must clear after resolve');
    rigB.dispose();
    assert(mockB.disposals.geometries === 18, 'newer master must dispose on release');
    console.log('✓ Proof 14: Overlapping pending generation passed.');
  }

  // -------------------------------------------------------------
  // Test 15: Post-increment errors release the reference (no leaked refCount)
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const mock = createMockValidScene();
    const mockMat = createMockMaterialLibrary();
    const sharedLoader = { loadAsync: async () => ({ scene: mock.scene }) };
    const URL = 'mock://carbine-ref-leak.glb';
    const sibling = await api.loadCatalogCarbineRig({ url: URL, customLoader: sharedLoader, attachHands: false });
    const failingMat = {
      ...mockMat,
      painted: (color, ...rest) => {
        if (color === 0x2c2923) throw new Error('cuff allocation failed');
        return mockMat.painted(color, ...rest);
      },
    };
    let threw = false;
    try {
      await api.loadCatalogCarbineRig({ url: URL, customLoader: sharedLoader, mat: failingMat, attachHands: true });
    } catch { threw = true; }
    assert(threw, 'hands allocation failure must reject (fallback also needs the cuff)');
    const stats = api.getCarbineCacheStats();
    assert(stats.refCounts[api.canonicalizeUrl(URL)] === 1, 'refCount must return to 1 after failed clone');
    const mesh = sibling.group.getObjectByName('part_0');
    assert(mesh && mesh.geometry.isBufferGeometry, 'sibling must stay valid after failed clone');
    assert(mock.disposals.geometries === 0, 'sibling master must NOT dispose on failed clone');
    sibling.dispose();
    assert(mock.disposals.geometries === 18, 'master must dispose on last sibling release');
    console.log('✓ Proof 15: Post-increment error releases its reference passed.');
  }

  // -------------------------------------------------------------
  // Test 16: Controller teardown before canary resolution (no swap, no leak)
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const mockMat = createMockMaterialLibrary();
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 100);
    const scene = new THREE.Scene();
    const mock = createMockValidScene();
    const mockLoader = { loadAsync: async () => ({ scene: mock.scene }) };
    let releaseGate;
    const gate = new Promise((r) => { releaseGate = r; });
    let createdRig = null;
    const deferredLoader = async (opts) => {
      await gate;
      createdRig = await api.loadCatalogCarbineRig({
        url: 'mock://carbine-teardown.glb',
        customLoader: mockLoader,
        mat: opts.mat,
        attachHands: true,
      });
      return createdRig;
    };
    const controller = new api.WeaponsController({
      camera, scene, mat: mockMat, targets: [], onHud: () => {},
      carbineCanary: true, carbineLoader: deferredLoader,
    });
    controller.dispose();
    releaseGate();
    await new Promise((r) => setTimeout(r, 20));
    assert(createdRig !== null, 'deferred canary load must still resolve its rig');
    assert(controller.activeCarbineRig === null, 'torn-down controller must NOT adopt the late rig');
    assert(createdRig.group.parent === null, 'late rig must be detached on teardown');
    let canaryGroups = 0;
    for (const child of controller.overlay.children) {
      if (child.isGroup && child.name === 'CatalogCarbineViewmodel') canaryGroups++;
    }
    assert(canaryGroups === 0, `torn-down overlay must contain no canary viewmodel (got ${canaryGroups})`);
    assert(mock.disposals.geometries === 18, 'late master must dispose when the torn-down rig releases');
    assert(mockMat.getDisposedCount() === 0, 'shared materials must survive teardown');
    console.log('✓ Proof 16: Controller teardown before resolution passed.');
  }

  // -------------------------------------------------------------
  // Test 17: Read-only canary status proves GLB adoption (not just the name)
  // -------------------------------------------------------------
  {
    api.clearMasterCarbineCache();
    const mockMat = createMockMaterialLibrary();
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 100);
    const scene = new THREE.Scene();
    const baseline = new api.WeaponsController({
      camera, scene, mat: mockMat, targets: [], onHud: () => {}, carbineCanary: false,
    });
    const baseState = baseline.command('state');
    assert(baseState.carbine !== undefined, 'QA state must carry read-only carbine status');
    assert(baseState.carbine.requested === false && baseState.carbine.active === false, 'baseline must report inactive canary');
    assert(baseState.carbine.isGLTF === false && baseState.carbine.url === null, 'baseline must report no GLB URL');
    baseline.dispose();
    const mock = createMockValidScene();
    const customLoader = { loadAsync: async () => ({ scene: mock.scene }) };
    const preloaded = await api.loadCatalogCarbineRig({
      url: api.CATALOG_CARBINE_GLB_URL, customLoader, attachHands: false,
    });
    const canary = new api.WeaponsController({
      camera, scene, mat: mockMat, targets: [], onHud: () => {}, carbineCanary: true,
    });
    await new Promise((r) => setTimeout(r, 20));
    const canaryState = canary.command('state');
    assert(canaryState.carbine.active === true, 'canary state must report active');
    assert(canaryState.carbine.isGLTF === true, 'canary state must prove GLTF adoption, not fallback');
    assert(canaryState.carbine.url === api.canonicalizeUrl(api.CATALOG_CARBINE_GLB_URL), 'canary state must report the loaded URL');
    for (const s of api.REQUIRED_CARBINE_SOCKETS) {
      assert(canaryState.carbine.sockets.includes(s), `canary state must list socket ${s}`);
    }
    canary.dispose();
    preloaded.dispose();
    console.log('✓ Proof 17: Canary QA status (URL/sockets/candidate-vs-fallback) passed.');
  }

  console.log('\n======================================================');
  console.log('ALL 17 CPU VERIFICATION PROOFS PASSED (0 failures)');
  console.log('======================================================\n');
} finally {
  try {
    rmSync(OUTFILE, { force: true });
  } catch {}
}
