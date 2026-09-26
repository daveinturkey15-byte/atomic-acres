/** CPU geometry/lifecycle proof. Pixel quality is deliberately left to real browser captures. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (path) => join(root, path).replaceAll('\\', '/');
const folder = mkdtempSync(join(tmpdir(), 'aa-astra-special-models-'));
const entry = join(folder, 'entry.ts'), bundle = join(folder, 'bundle.mjs');
writeFileSync(entry, `
export * as THREE from '${src('node_modules/three/build/three.module.js')}';
export * from '${src('src/weapons/special-viewmodels.ts')}';
export { viewmodelForWeapon, isNativeRig } from '${src('src/weapons/families.ts')}';
export { rosterProjection } from '${src('src/weapons/roster.ts')}';
export { disposeOwnedGeometries } from '${src('src/weapons/catalog-carbine-loader.ts')}';
`);
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(bundle).href);
const { THREE } = api;
const materials = new Set(), painted = new Map();
const material = (name) => { const m = new THREE.MeshStandardMaterial({ name }); materials.add(m); return m; };
const mat = {
  chrome: material('chrome'),
  viewmodel: {
    parkerizedSteel: material('parkerizedSteel'), darkGlove: material('darkGlove'),
    sleeve: material('sleeve'), gloveDetail: material('gloveDetail'), woodFurniture: material('woodFurniture'),
  },
  painted: (color, roughness, metalness) => {
    const key = `${color}/${roughness}/${metalness}`;
    if (!painted.has(key)) painted.set(key, material(key));
    return painted.get(key);
  },
};
const cases = [
  ['railgun', 'railgun', api.buildRailgunViewmodel],
  ['explosive-crossbow', 'crossbow', api.buildCrossbowViewmodel],
  ['flamethrower', 'flamethrower', api.buildFlamethrowerViewmodel],
  ['flare-gun', 'flaregun', api.buildFlareGunViewmodel],
];
const sizes = new Map();
const summaries = [];
for (const [id, key, builder] of cases) {
  assert.equal(api.viewmodelForWeapon(id), key);
  assert.equal(api.isNativeRig(id), true);
  const rig = builder(mat), twin = builder(mat);
  assert.equal(rig.group.userData.nativeWeaponId, id);
  const gun = rig.group.getObjectByName('WeaponGeometry');
  assert(gun, `${id}: geometry group`);
  assert(rig.hands?.root.parent === rig.group, `${id}: actual hand rig is attached`);
  let meshes = 0, triangles = 0;
  const geometry = new Set();
  const snapshot = (group) => {
    group.updateMatrixWorld(true);
    const parts = [];
    group.traverse((node) => {
      if (!node.isMesh) return;
      assert(materials.has(node.material), `${id}: library material ownership`);
      const positions = node.geometry.getAttribute('position');
      for (const value of positions.array) assert(Number.isFinite(value), `${id}: finite vertices`);
      parts.push([node.name, positions.count, node.geometry.index?.count ?? 0, ...node.matrixWorld.elements]);
    });
    return parts;
  };
  assert.deepEqual(snapshot(rig.group), snapshot(twin.group), `${id}: deterministic construction`);
  gun.traverse((node) => {
    if (!node.isMesh) return;
    meshes++;
    triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
  });
  assert(meshes <= api.SPECIAL_VIEWMODEL_BUDGET.meshes, `${id}: mesh budget ${meshes}`);
  assert(triangles <= api.SPECIAL_VIEWMODEL_BUDGET.triangles, `${id}: triangle budget ${triangles}`);
  const bounds = new THREE.Box3().setFromObject(gun), size = bounds.getSize(new THREE.Vector3());
  sizes.set(id, size);
  assert(rig.muzzle.position.z < -.25, `${id}: forward muzzle`);
  assert(Math.abs(rig.muzzle.position.z - bounds.min.z) < .045, `${id}: muzzle matches actual front geometry`);
  assert(size.y > .12 && size.z > .28, `${id}: nonempty held silhouette`);
  const bind = snapshot(rig.hands.root);
  rig.hands.updateReload(.5);
  rig.hands.resetReload();
  assert.deepEqual(snapshot(rig.hands.root), bind, `${id}: reload restores hand bind`);
  const disposed = new Set();
  rig.group.traverse((node) => {
    if (!node.isMesh) return;
    assert(!geometry.has(node.geometry), `${id}: each geometry has one disposal owner`);
    geometry.add(node.geometry);
    node.geometry.addEventListener('dispose', () => disposed.add(node.geometry));
  });
  twin.group.traverse((node) => { if (node.isMesh) assert(!geometry.has(node.geometry), `${id}: distinct rig ownership`); });
  let materialDisposals = 0;
  for (const m of materials) m.addEventListener('dispose', () => materialDisposals++);
  api.disposeOwnedGeometries(rig.group);
  assert.equal(disposed.size, geometry.size, `${id}: all rig geometry disposed`);
  assert.equal(materialDisposals, 0, `${id}: shared materials survive rig disposal`);
  api.disposeOwnedGeometries(twin.group);
  summaries.push({ id, meshes, triangles, width: +size.x.toFixed(3), length: +size.z.toFixed(3) });
}
assert(sizes.get('explosive-crossbow').x > .55, 'bow limbs must have a wide silhouette');
assert(sizes.get('flamethrower').x > .2, 'pressure tanks must widen flame weapon');
assert(sizes.get('railgun').z > .85, 'accelerator has long barrel and stock');
assert(sizes.get('flare-gun').z < .34, 'signal pistol remains compact');
assert.equal(api.rosterProjection().filter((w) => w.fallbackArt).length, 11, 'eleven conventional variants retain visible art-debt status');
assert.equal(api.rosterProjection().filter((w) => !w.fallbackArt).length, 9, 'exactly nine native rigs');
assert.throws(() => api.viewmodelForWeapon('unregistered-gun'));
const crimson = api.buildCrimsonFlamethrowerViewmodel(mat), flame = api.buildFlamethrowerViewmodel(mat);
assert.equal(crimson.group.userData.nativeWeaponId, 'crimson-flamethrower');
assert.equal(api.viewmodelForWeapon('crimson-flamethrower'), 'crimson-flamethrower');
assert.equal(api.isNativeRig('crimson-flamethrower'), false, 'reward finish does not claim a unique silhouette');
assert.notEqual(crimson.group.getObjectByName('PressureCylinder1').material,
  flame.group.getObjectByName('PressureCylinder1').material, 'reward has a distinct red finish');
api.disposeOwnedGeometries(crimson.group); api.disposeOwnedGeometries(flame.group);
// Exercise the existing optional articulated rifle hand path against actual new solids.
globalThis.window = { location: { search: '?hands=rifle-canary' } };
const canary = api.buildRailgunViewmodel(mat);
assert.equal(canary.hands.root.userData.design, 'rigged-rifle-v1');
canary.hands.updateReload(.5); canary.hands.resetReload();
api.disposeOwnedGeometries(canary.group);
delete globalThis.window;
for (const m of materials) m.dispose();
console.log(JSON.stringify({ result: 'PASS', scope: 'CPU geometry, hand lifecycle, registry and disposal; pixels unverified', nativeRigs: 9, borrowedRigs: 11, weapons: summaries }, null, 2));
