/** Real r180 Meshopt geometry decode, mount/disposal proof; no renderer or GPU. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = mkdtempSync(join(tmpdir(), 'aa-reference-models-'));
const src = (p) => join(root, p).replaceAll('\\', '/');
const entry = join(folder, 'entry.ts'), bundle = join(folder, 'bundle.mjs');
writeFileSync(entry, `export * as THREE from '${src('node_modules/three/build/three.module.js')}';
export * from '${src('src/weapons/reference-weapon-models.ts')}';
export { collectGltfResources } from '${src('src/weapons/catalog-carbine-loader.ts')}';`);
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(bundle).href);
const { THREE } = api;
globalThis.self = globalThis;
// CPU ImageBitmap stand-in. WebP bytes are validated; pixel decoding/appearance
// is explicitly outside this fixture and must be checked in the real browser.
const bitmaps = [];
globalThis.createImageBitmap = async (blob) => {
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const bitmap = { width: 512, height: 512, closed: 0, close() { this.closed++; } };
  bitmaps.push(bitmap); return bitmap;
};
const manifest = JSON.parse(readFileSync(join(root, 'public/assets/reference-weapons/source-provenance.json')));
assert.equal(manifest.files.length, 24);
assert.equal(manifest.totalBytes, 999630);
for (const row of manifest.files) {
  const bytes = readFileSync(join(root, row.targetPath));
  assert.equal(bytes.length, row.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
}
const material = new THREE.MeshStandardMaterial();
let sharedDisposals = 0;
material.addEventListener('dispose', () => sharedDisposals++);
const mat = { viewmodel: { sleeve: material, darkGlove: material, gloveDetail: material }, painted: () => material };
const summaries = [];
const parse = async (id) => {
  const b = readFileSync(join(root, `public/assets/reference-weapons/${id}/${id}-fp-lod0.glb`));
  return api.createReferenceWeaponLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
for (const id of api.REFERENCE_WEAPON_IDS) {
  const gltf = await parse(id);
  assert.equal(gltf.animations.length, 13, 'original presentation clips retained in file');
  if (id === 'minigun') gltf.scene.traverse((n) => {
    if (n.isMesh && n.name.endsWith('_Lens')) assert.equal(n.material.transparent, false, 'source pane reproduces opaque defect');
  });
  const rig = api.adaptReferenceWeaponModel(id, gltf, mat);
  const resources = api.collectGltfResources(rig.group);
  for (const geometry of resources.geometries) {
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      assert(Number.isFinite(position.getX(i)) && Number.isFinite(position.getY(i)) && Number.isFinite(position.getZ(i)), 'decoded vertices finite');
    }
  }
  assert(rig.stats.triangles > 10000, 'real compressed mesh decoded');
  assert(rig.stats.textures >= 5, 'embedded PBR textures bound');
  const point = (name) => rig.group.worldToLocal(rig.group.getObjectByName(name).getWorldPosition(new THREE.Vector3()));
  rig.group.updateMatrixWorld(true);
  assert(point('grip-socket-r').distanceTo(new THREE.Vector3(.01, -.112, .012)) < 1e-7, 'trigger palm fit');
  const support = point('support-socket-l');
  const palm = new THREE.Vector3(-.01, support.y, support.z);
  rig.hands.supportHand.localToWorld(palm);
  rig.group.worldToLocal(palm);
  assert(palm.distanceTo(support) < 1e-7, 'support palm fit');
  const handBind = rig.hands.supportHand.matrixWorld.clone();
  rig.hands.updateReload(.5);
  rig.hands.resetReload();
  rig.group.updateMatrixWorld(true);
  assert.deepEqual(rig.hands.supportHand.matrixWorld.elements, handBind.elements, 'reload bind restored');
  const mount = rig.adsMount;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(mount.pitch, mount.yaw, 0, 'YXZ'));
  for (const name of rig.adsSightNames) {
    const p = point(name).applyQuaternion(q).add(new THREE.Vector3(mount.offsetX, -.148 + mount.offsetY, -.3));
    assert(Math.hypot(p.x, p.y) < .00001 && p.z < 0, `${id}: both sights on camera axis`);
  }
  assert(point('muzzle-socket').z < -.3, 'forward muzzle');
  const rear = point('rear-sight-socket'), front = point('front-sight-socket');
  const oldQ = new THREE.Quaternion().setFromUnitVectors(front.clone().sub(rear).normalize(), new THREE.Vector3(0, 0, -1));
  const oldRear = rear.clone().applyQuaternion(oldQ);
  const oldOffset = new THREE.Vector3(-oldRear.x, -oldRear.y, -.3);
  rig.group.position.copy(oldOffset); rig.group.quaternion.copy(oldQ); rig.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), .05, 2);
  if (id !== 'minigun') {
    assert(ray.intersectObject(rig.group, true).some((hit) => hit.object.name.includes('_Runtime_')), 'negative control: original anchor-only mount occludes actual aiming ray');
  }
  rig.group.position.set(mount.offsetX, -.148 + mount.offsetY, -.3);
  rig.group.quaternion.copy(q); rig.group.updateMatrixWorld(true);
  const rearWorld = rig.group.getObjectByName(rig.adsSightNames[0]).getWorldPosition(new THREE.Vector3());
  const opaque = (hit) => {
    const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
    return materials.some((m) => !m.transparent || m.opacity > .2);
  };
  for (const [x, y] of [[0, 0], [-.003, 0], [.003, 0], [-.003, .003], [.003, .003]]) {
    ray.set(new THREE.Vector3(), new THREE.Vector3(x, y, rearWorld.z).normalize());
    assert.equal(ray.intersectObject(rig.group, true).filter(opaque).length, 0, `${id}: actual triangle aperture clearance at ${x},${y}`);
  }
  if (id === 'minigun') rig.group.traverse((n) => {
    if (n.isMesh && n.name.endsWith('_Lens')) {
      assert(n.material.transparent && n.material.opacity <= .2 && !n.material.depthWrite, 'retained lens has transparent finish');
    }
  });
  let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0;
  for (const g of resources.geometries) g.addEventListener('dispose', () => geometryDisposals++);
  for (const m of resources.materials) if (m !== material) m.addEventListener('dispose', () => materialDisposals++);
  for (const t of resources.textures) t.addEventListener('dispose', () => textureDisposals++);
  const ownedMaterials = resources.materials.size - 1;
  summaries.push({ id, ...rig.stats, adsMount: mount });
  rig.dispose(); rig.dispose();
  assert.equal(geometryDisposals, resources.geometries.size, 'every owned geometry exactly once');
  assert.equal(materialDisposals, ownedMaterials, 'every owned material exactly once');
  assert.equal(textureDisposals, resources.textures.size, 'every texture exactly once');
  assert.equal(sharedDisposals, 0, 'shared hand materials untouched');
}
const invalid = await parse('mini-uzi');
invalid.scene.getObjectByName('muzzle-socket').removeFromParent();
const rejectedResources = api.collectGltfResources(invalid.scene);
let released = 0;
for (const g of rejectedResources.geometries) g.addEventListener('dispose', () => released++);
assert.throws(() => api.adaptReferenceWeaponModel('mini-uzi', invalid, mat), /missing muzzle-socket/);
assert.equal(released, rejectedResources.geometries.size, 'invalid model releases geometry and preserves caller fallback');
assert(bitmaps.length >= 20 && bitmaps.every((b) => b.closed === 1), 'owned ImageBitmaps closed exactly once, including failure');
assert.equal(sharedDisposals, 0);
console.log(JSON.stringify({ status: 'PASS', copiedAssets: manifest.files.length, copiedBytes: manifest.totalBytes, models: summaries, imagePixelDecode: 'OPEN: real browser required' }, null, 2));
