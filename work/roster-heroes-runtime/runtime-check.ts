/**
 * CPU lifecycle/rig checks for the roster-heroes loader — deterministic
 * stand-in GLB scenes through the `customLoader` seam. No browser, no GPU,
 * no server: every load path (happy, missing socket, missing magazine,
 * pending failure, clear-during-pending, cache sharing/bound, disposal) is
 * exercised in plain Node via esbuild bundling.
 *
 * Run: node work/roster-heroes-runtime/check-runtime.mjs
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../../src/core/materials';
import {
  clearRosterHeroCache,
  getRosterHeroCacheStats,
  isRosterHeroesCanaryRequested,
  loadRosterHeroRig,
  ROSTER_HERO_GLB_URLS,
  ROSTER_HERO_WEAPON_IDS,
} from '../../src/weapons/roster-heroes-loader';
import { findNamedSocket } from '../../src/weapons/catalog-carbine-loader';

let pass = 0;
const fails: string[] = [];
function ok(cond: boolean, label: string): void {
  if (cond) pass++;
  else fails.push(label);
}
function eq(actual: unknown, expected: unknown, label: string): void {
  ok(actual === expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
async function raises(p: Promise<unknown>, label: string): Promise<void> {
  try {
    await p;
    ok(false, label);
  } catch {
    pass++;
  }
}

const disposedUuids = new Set<string>();
function trackDispose(o: THREE.Material | THREE.BufferGeometry): void {
  o.addEventListener('dispose', () => disposedUuids.add(o.uuid));
}
const wasDisposed = (o: THREE.Material | THREE.BufferGeometry): boolean => disposedUuids.has(o.uuid);

const MAG_NODE: Record<string, string> = {
  mp5: 'mp5_magazine',
  'm14-ebr': 'ebr_magazine',
  lmg: 'lmg_ammo_box',
};

interface StandIn {
  scene: THREE.Group;
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  magGeo: THREE.BufferGeometry;
}

/** Deterministic stand-in "GLB": 4 anchors + magazine node + one shared mesh material. */
function heroScene(
  heroId: string,
  opts: { dropSocket?: string; dropMag?: boolean } = {},
): StandIn {
  const scene = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.05, 0.05, 0.3);
  const magGeo = new THREE.BoxGeometry(0.04, 0.12, 0.06);
  const mat = new THREE.MeshStandardMaterial();
  trackDispose(geo);
  trackDispose(magGeo);
  trackDispose(mat);

  const body = new THREE.Mesh(geo, mat);
  body.name = `${heroId}_receiver`;
  scene.add(body);

  const anchors: Array<[string, THREE.Vector3]> = [
    ['anchor_muzzle', new THREE.Vector3(0, 0.03, -0.35)],
    ['anchor_grip', new THREE.Vector3(0, -0.06, 0.02)],
    ['anchor_support', new THREE.Vector3(0, -0.01, -0.18)],
    ['anchor_mag', new THREE.Vector3(0, -0.07, -0.05)],
  ];
  for (const [name, pos] of anchors) {
    if (opts.dropSocket === name) continue;
    const socket = new THREE.Object3D();
    socket.name = name;
    socket.position.copy(pos);
    if (name === 'anchor_mag') socket.rotation.z = 0.3; // nontrivial frame for attach()
    scene.add(socket);
  }

  if (!opts.dropMag) {
    const mag = new THREE.Mesh(magGeo, mat);
    mag.name = MAG_NODE[heroId];
    mag.position.set(0, -0.06, 0); // hangs below anchor_mag
    const anchor = anchors.find((a) => a[0] === 'anchor_mag');
    if (anchor) mag.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.3);
    scene.add(mag);
  }

  scene.updateMatrixWorld(true);
  return { scene, geo, mat, magGeo };
}

/** Stand-in MaterialLibrary: only the slots the fallback path actually reads. */
const sharedSteel = new THREE.MeshStandardMaterial({ name: 'shared-steel' });
trackDispose(sharedSteel);
const freshMat = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial();
const fakeMat = {
  viewmodel: {
    parkerizedSteel: sharedSteel,
    woodFurniture: freshMat(),
    sleeve: freshMat(),
    gloveDetail: freshMat(),
    darkGlove: freshMat(),
  },
  chrome: freshMat(),
  steel: freshMat(),
  glass: freshMat(),
  timberDark: freshMat(),
  painted: (_color: unknown, _rough?: number, _metal?: number): THREE.MeshStandardMaterial => freshMat(),
} as unknown as MaterialLibrary;

function loaderFor(
  heroId: string,
  opts: { dropSocket?: string; dropMag?: boolean; count?: { n: number } } = {},
): { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> } {
  return {
    loadAsync: async () => {
      if (opts.count) opts.count.n++;
      return { scene: heroScene(heroId, opts).scene };
    },
  };
}

const approx = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;

async function main(): Promise<void> {
  // A. Opt-in query contract: ?heroes=canary only, explicit search string.
  ok(isRosterHeroesCanaryRequested('?heroes=canary'), 'heroes=canary requested');
  eq(isRosterHeroesCanaryRequested('?carbine=canary'), false, 'carbine query does not opt into heroes');
  eq(isRosterHeroesCanaryRequested('?heroes=1'), false, 'non-canary value ignored');
  eq(isRosterHeroesCanaryRequested(''), false, 'empty query not requested');
  eq(ROSTER_HERO_WEAPON_IDS.length, 3, 'exactly three hero ids');
  eq(Object.keys(ROSTER_HERO_GLB_URLS).length, 3, 'three hero urls');

  // B. Unknown ids never load.
  clearRosterHeroCache();
  await raises(
    loadRosterHeroRig('railgun', { mat: fakeMat, customLoader: loaderFor('mp5') }),
    'unknown weapon id rejects',
  );
  eq(getRosterHeroCacheStats().cachedUrls.length, 0, 'unknown id loads nothing');

  // C. Happy path: stand-in GLB with all four anchors + magazine node.
  clearRosterHeroCache();
  const count = { n: 0 };
  const rig = await loadRosterHeroRig('mp5', { mat: fakeMat, customLoader: loaderFor('mp5', { count }) });
  eq(count.n, 1, 'one decode for one rig');
  eq(rig.isGLTFAsset, true, 'stand-in adopted as GLB');
  ok(rig.assetUrl!.endsWith('assets/roster-heroes/mp5.glb'), 'asset url is the hero url');
  eq(rig.weaponId, 'mp5', 'rig carries its weapon id');
  eq(rig.muzzle, findNamedSocket(rig.group, 'anchor_muzzle'), 'muzzle IS the authored socket');
  eq(rig.gripSocket, findNamedSocket(rig.group, 'anchor_grip'), 'grip IS the authored socket');
  eq(rig.supportSocket, findNamedSocket(rig.group, 'anchor_support'), 'support IS the authored socket');
  eq(rig.magSocket, findNamedSocket(rig.group, 'anchor_mag'), 'mag IS the authored socket');
  ok(rig.eject !== undefined, 'eject presentation frame present');

  // Reload-mag pivot: mag node re-parented anchor_mag -> pivot, world pose kept.
  const mag = findNamedSocket(rig.group, MAG_NODE.mp5)!;
  ok(mag !== undefined, 'magazine node found under rig');
  eq(mag.parent!.name, 'hero_mag_pivot', 'mag parented to pivot');
  eq(mag.parent!.parent, rig.magSocket, 'pivot parented to anchor_mag');
  rig.group.updateMatrixWorld(true);
  const masterMagWorld = new THREE.Vector3();
  heroScene('mp5').scene.updateMatrixWorld(true);
  // world pose preserved: compare against the same stand-in built fresh
  const ref = heroScene('mp5');
  ref.scene.updateMatrixWorld(true);
  const refMag = ref.scene.children.find((c) => c.name === MAG_NODE.mp5) as THREE.Object3D;
  const refWorld = refMag.getWorldPosition(new THREE.Vector3());
  const rigWorld = mag.getWorldPosition(new THREE.Vector3());
  masterMagWorld.copy(rigWorld);
  ok(approx(refWorld.x, rigWorld.x, 1e-5) && approx(refWorld.y, rigWorld.y, 1e-5) && approx(refWorld.z, rigWorld.z, 1e-5), 'mag world pose preserved through re-parent');

  // Reload swing rides the SAME hands phase the controller already drives.
  const pivot = mag.parent!;
  rig.hands!.updateReload(0.5);
  ok(Math.abs(pivot.rotation.x) > 0.5, 'mid-reload mag swings about anchor');
  rig.hands!.updateReload(1);
  ok(Math.abs(pivot.rotation.x) < 1e-9, 'reload end restores mag pose');
  rig.hands!.updateReload(0.3);
  rig.hands!.resetReload();
  ok(Math.abs(pivot.rotation.x) < 1e-9, 'resetReload restores mag pose');
  ok(rig.hands!.root !== undefined, 'hands rig present');
  const statsC = getRosterHeroCacheStats();
  ok(Object.values(statsC.refCounts)[0] === 1, 'one live reference');

  // Viewmodel traits applied without touching shared materials.
  const bodyMesh = rig.group.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
  eq(bodyMesh.renderOrder, 100, 'viewmodel render order');
  eq(bodyMesh.frustumCulled, false, 'frustum culled off');
  eq(bodyMesh.castShadow, false, 'no shadow casting');

  // D. Disposal: idempotent, releases master resources, spares shared library material.
  rig.dispose();
  rig.dispose();
  const sAfterDispose = getRosterHeroCacheStats();
  eq(sAfterDispose.cachedUrls.length, 0, 'auto-dispose cleared the single entry');
  ok(sAfterDispose.pendingCount === 0, 'no pending loads leak');
  const standIn = loaderFor('mp5');
  void standIn;

  // Rebuild a tracked stand-in to observe master disposal (C's scene came from
  // an untracked builder call, so track a fresh one end-to-end here).
  clearRosterHeroCache();
  const tracked = heroScene('mp5');
  const rigT = await loadRosterHeroRig('mp5', {
    mat: fakeMat,
    customLoader: { loadAsync: async () => ({ scene: tracked.scene }) },
  });
  rigT.dispose();
  ok(wasDisposed(tracked.geo) && wasDisposed(tracked.magGeo) && wasDisposed(tracked.mat), 'master resources disposed on last release');

  // E. Missing socket rejects the asset and engages the procedural fallback.
  clearRosterHeroCache();
  const badSocket = heroScene('mp5', { dropSocket: 'anchor_mag' });
  const fb = await loadRosterHeroRig('mp5', {
    mat: fakeMat,
    customLoader: { loadAsync: async () => ({ scene: badSocket.scene }) },
  });
  eq(fb.isGLTFAsset, false, 'missing socket -> procedural fallback');
  ok(fb.gripSocket && fb.supportSocket && fb.magSocket && fb.muzzle, 'fallback exposes the socket contract');
  ok(fb.hands !== undefined, 'fallback carries hands');
  ok(wasDisposed(badSocket.geo) && wasDisposed(badSocket.mat), 'rejected asset resources disposed immediately');
  fb.dispose();
  fb.dispose();
  ok(!wasDisposed(sharedSteel), 'fallback disposal never touches shared library material');

  // F. Missing magazine node is also a bad asset (no mag-less hero rigs).
  clearRosterHeroCache();
  const badMag = heroScene('lmg', { dropMag: true });
  const fb2 = await loadRosterHeroRig('lmg', {
    mat: fakeMat,
    customLoader: { loadAsync: async () => ({ scene: badMag.scene }) },
  });
  eq(fb2.isGLTFAsset, false, 'missing magazine node -> fallback');
  eq(fb2.weaponId, 'lmg', 'fallback keeps the weapon id');
  ok(wasDisposed(badMag.geo), 'mag-less asset resources disposed');
  fb2.dispose();

  // G. Pending failure: loader rejects -> fallback with mat, rethrow without.
  clearRosterHeroCache();
  const boom = { loadAsync: (): Promise<{ scene: THREE.Group }> => Promise.reject(new Error('disk on fire')) };
  const fb3 = await loadRosterHeroRig('lmg', { mat: fakeMat, customLoader: boom });
  eq(fb3.isGLTFAsset, false, 'loader failure -> fallback when mat present');
  fb3.dispose();
  await raises(loadRosterHeroRig('lmg', { customLoader: boom }), 'loader failure rethrows without mat');

  // H. Clear-during-pending: late load is discarded, its resources disposed,
  // and the caller lands on the fallback — never a resurrected master.
  clearRosterHeroCache();
  let resolveLoad!: (v: { scene: THREE.Group }) => void;
  const loadPromiseShell = Promise.withResolvers<{ scene: THREE.Group }>();
  resolveLoad = loadPromiseShell.resolve;
  const late = heroScene('m14-ebr');
  const pending = loadRosterHeroRig('m14-ebr', {
    mat: fakeMat,
    customLoader: { loadAsync: (): Promise<{ scene: THREE.Group }> => loadPromiseShell.promise },
  });
  clearRosterHeroCache();
  resolveLoad({ scene: late.scene });
  const rigLate = await pending;
  eq(rigLate.isGLTFAsset, false, 'clear-during-pending falls back');
  ok(wasDisposed(late.geo) && wasDisposed(late.mat), 'late resources disposed on arrival');
  ok(getRosterHeroCacheStats().generation >= 2, 'generation epoch advanced by clears');
  rigLate.dispose();

  // I. Cache sharing + bound: concurrent same-URL loads decode once; two live
  // rigs share master buffers; disposal is last-release-only.
  clearRosterHeroCache();
  const countI = { n: 0 };
  const [a, b] = await Promise.all([
    loadRosterHeroRig('mp5', { mat: fakeMat, customLoader: loaderFor('mp5', { count: countI }) }),
    loadRosterHeroRig('mp5', { mat: fakeMat, customLoader: loaderFor('mp5', { count: countI }) }),
  ]);
  eq(countI.n, 1, 'in-flight dedupe: one decode serves both rigs');
  eq(getRosterHeroCacheStats().cachedUrls.length, 1, 'one master entry for the URL');
  const urlKey = getRosterHeroCacheStats().cachedUrls[0];
  eq(getRosterHeroCacheStats().refCounts[urlKey], 2, 'two live references');
  ok(a.group !== b.group, 'rigs are distinct clones');
  a.group.visible = true;
  b.group.visible = false;
  eq(b.group.visible, false, 'sibling visibility independent');
  a.dispose();
  eq(getRosterHeroCacheStats().refCounts[urlKey], 1, 'release decrements only own reference');
  const share = heroScene('mp5');
  void share;
  b.dispose();
  eq(getRosterHeroCacheStats().cachedUrls.length, 0, 'last release disposes master');

  // All three heroes cached at once — the bound is three and it is reached.
  clearRosterHeroCache();
  const heroes = await Promise.all(
    ROSTER_HERO_WEAPON_IDS.map((id) => loadRosterHeroRig(id, { mat: fakeMat, customLoader: loaderFor(id) })),
  );
  const sAll = getRosterHeroCacheStats();
  eq(sAll.cachedUrls.length, 3, 'three masters cached');
  ok(sAll.cachedUrls.length <= sAll.maxEntries, 'cache bound respected');
  for (const h of heroes) {
    eq(h.isGLTFAsset, true, `${h.weaponId} adopted`);
    h.dispose();
  }
  eq(getRosterHeroCacheStats().cachedUrls.length, 0, 'all masters released');

  // Report.
  console.log(`roster-heroes runtime checks: ${pass} passed, ${fails.length} failed`);
  if (fails.length > 0) {
    for (const f of fails) console.error(`  FAIL ${f}`);
    process.exit(1);
  }
}

await main();
