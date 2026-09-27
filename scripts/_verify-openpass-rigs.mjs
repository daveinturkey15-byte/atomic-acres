/** CPU proof only. No browser, renderer, art approval, or gameplay mutation. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = p => join(root, p).replaceAll('\\', '/');
const folder = mkdtempSync(join(tmpdir(), 'aa-openpass-rig-'));
const entry = join(folder, 'entry.ts'), outfile = join(folder, 'bundle.mjs');
writeFileSync(entry, `export * as THREE from '${src('node_modules/three/build/three.module.js')}';
export * from '${src('src/weapons/openpass-weapon-rigs.ts')}';
export { RIFLE_HAND_BINDS } from '${src('src/weapons/rigged-rifle-hands.ts')}';`);
await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(outfile).href), { THREE } = api;
const materials = new Set(), cache = new Map();
const material = name => { const m = new THREE.MeshStandardMaterial({ name }); materials.add(m); return m; };
const mat = { chrome: material('chrome'), viewmodel: Object.fromEntries(
  ['parkerizedSteel', 'darkGlove', 'sleeve', 'gloveDetail', 'woodFurniture'].map(name => [name, material(name)])),
  painted(color, rough, metal) { const key = `${color}/${rough}/${metal}`;
    if (!cache.has(key)) cache.set(key, material(key)); return cache.get(key); },
};
assert.deepEqual(api.OPENPASS_RIG_IDS, ['lmg'], 'one canary only');
assert.deepEqual(Object.keys(api.OPENPASS_RIG_BUILDERS), ['lmg'], 'no stub roster');
const rig = api.OPENPASS_RIG_BUILDERS.lmg(mat), twin = api.buildOpenpassLmg(mat);
assert.equal(rig.weaponId, 'lmg'); assert.equal(rig.group.userData.artStatus, 'unreviewed-canary');
assert.equal(rig.hands.root.parent, rig.group);
const gun = rig.group.getObjectByName('WeaponGeometry');
assert(gun); assert.equal(rig.hands.root.userData.design, 'rigged-rifle-v1');
const meshes = [], geometries = new Set(), arrays = new Map();
const hash = group => {
  const h = createHash('sha256'); group.updateMatrixWorld(true);
  group.traverse(node => {
    if (!node.isMesh) return;
    h.update(JSON.stringify([node.name, ...node.matrixWorld.elements]));
    for (const a of Object.values(node.geometry.attributes)) h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    if (node.geometry.index) h.update(Buffer.from(node.geometry.index.array.buffer));
  }); return h.digest('hex');
};
assert.equal(hash(rig.group), hash(twin.group), 'deterministic actual geometry');
rig.group.traverse(node => {
  assert(!node.isLight, 'no light allocation'); if (!node.isMesh) return;
  meshes.push(node); geometries.add(node.geometry);
  assert(materials.has(node.material), 'library singleton material');
  assert(!node.castShadow && !node.receiveShadow && !node.frustumCulled);
  for (const [name, a] of Object.entries(node.geometry.attributes)) {
    arrays.set(a, a.array); for (const value of a.array) assert(Number.isFinite(value), `${node.name}/${name} finite`);
  }
  const count = node.geometry.getAttribute('position').count;
  for (const index of node.geometry.index?.array ?? []) assert(index >= 0 && index < count, 'in-range indices');
  node.geometry.computeBoundingBox(); node.geometry.computeBoundingSphere();
  assert(Number.isFinite(node.geometry.boundingSphere.radius) && node.geometry.boundingSphere.radius > 0);
});
const measured = { meshes: meshes.length, triangles: meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0),
  geometryBytes: [...geometries].reduce((n, g) => n + (g.index?.array.byteLength ?? 0) + Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0), 0), ownedTextures: 0 };
assert.deepEqual(rig.stats, measured, 'reported budget includes hands and all geometry');
for (const key of ['meshes', 'triangles', 'geometryBytes']) assert(measured[key] <= api.OPENPASS_RIG_BUDGET[key], `${key} frozen budget`);
const bounds = new THREE.Box3().setFromObject(gun), size = bounds.getSize(new THREE.Vector3());
const gunStats = { meshes: 0, triangles: 0 };
gun.traverse(n => { if (n.isMesh) { gunStats.meshes++; gunStats.triangles += (n.geometry.index?.count ?? n.geometry.attributes.position.count) / 3; } });
assert(size.z > 1.1 && size.z < 1.3 && size.x > .14, 'LMG long-barrel, feed/carry silhouette');
assert(Math.abs(rig.muzzle.position.z - bounds.min.z) < .012, 'muzzle at actual bore exit');
assert.deepEqual(Object.keys(rig.sockets), [...api.OPENPASS_SOCKET_NAMES]);
for (const socket of Object.values(rig.sockets)) assert(rig.group.getObjectByName(socket.name) === socket, 'real attached named sockets');
const forward = new THREE.Vector3(0, 0, -1);
assert(forward.clone().applyQuaternion(rig.muzzle.quaternion).distanceTo(forward) < 1e-9);
assert(forward.clone().applyQuaternion(rig.eject.quaternion).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-9);
assert.deepEqual(rig.sockets['grip-socket-r'].position.toArray(), api.RIFLE_HAND_BINDS.trigger.palm);
assert.deepEqual(rig.sockets['support-socket-l'].position.toArray(), api.RIFLE_HAND_BINDS.support.palm);
const rear = rig.sockets['rear-sight-socket'], front = rig.sockets['front-sight-socket'];
assert.equal(rear.position.y - .148 + rig.adsMount.offsetY, 0, 'actual ADS correction centres aperture');
assert.equal(front.position.y, rear.position.y);
rig.group.updateMatrixWorld(true);
for (const x of [0, -.007, .007]) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, rear.position.y, .20), forward, 0, 2);
  assert.equal(ray.intersectObject(gun, true).length, 0, `clear physical ADS ray x=${x}`);
}
const bindHash = hash(rig.group), pouch = rig.group.getObjectByName('AmmoPouchReload');
const palm = rig.hands.supportHand.getObjectByName('support-palm').geometry.attributes.position;
const palmPoint = new THREE.Vector3(palm.getX(0), palm.getY(0), palm.getZ(0));
for (let i = 0; i <= 100; i++) {
  rig.hands.updateReload(i / 100); rig.hands.updatePose(0, 0, 0); rig.group.updateMatrixWorld(true);
  rig.group.traverse(n => { for (const value of n.matrixWorld.elements) assert(Number.isFinite(value), 'finite reload transforms'); });
  if ([50, 56, 62, 70].includes(i)) {
    const contact = palmPoint.clone().applyMatrix4(rig.hands.supportHand.matrixWorld);
    const seat = rig.sockets['reload-socket-l'].getWorldPosition(new THREE.Vector3());
    assert(contact.distanceTo(seat) < .003, `hand/pouch contact phase ${i}`);
  }
  for (const side of ['trigger', 'support']) {
    const hand = side === 'trigger' ? rig.hands.triggerHand : rig.hands.supportHand;
    const forearm = hand.getObjectByName(side === 'trigger' ? 'TriggerForearm' : 'SupportForearm');
    const wrist = new THREE.Vector3(...api.RIFLE_HAND_BINDS[side].wrist);
    assert(wrist.clone().applyMatrix4(hand.matrixWorld).distanceTo(wrist.applyMatrix4(forearm.matrixWorld)) < 1e-6, 'sleeve stays on wrist');
    assert(forearm.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6, 'sleeve is not stretched');
  }
}
rig.hands.updateReload(.60); assert(pouch.position.y < -.21, 'pouch visibly withdrawn');
rig.hands.updatePose(0, 0, 1); assert.equal(pouch.position.y, -.135, 'offhand hand-lower returns pouch');
rig.hands.updatePose(0, 0, 0); assert(pouch.position.y < -.21, 'pose updates preserve active reload');
for (const invalid of [NaN, Infinity, -1, 2]) { rig.hands.updateReload(invalid); assert.equal(pouch.position.y, -.135); }
rig.hands.resetReload(); assert.equal(hash(rig.group), bindHash, 'cancel/reset returns exact geometry and bind');
for (const [attribute, array] of arrays) assert.equal(attribute.array, array, 'no reload geometry reallocations');
const disposal = new Map([...geometries].map(g => [g, 0]));
for (const geometry of geometries) geometry.addEventListener('dispose', () => disposal.set(geometry, disposal.get(geometry) + 1));
let materialDisposals = 0; for (const m of materials) m.addEventListener('dispose', () => materialDisposals++);
twin.group.traverse(n => { if (n.isMesh) assert(!geometries.has(n.geometry), 'independent ownership per rig'); });
const parent = new THREE.Group(); parent.add(rig.group); rig.dispose(); rig.dispose();
assert.equal(rig.group.parent, null); assert([...disposal.values()].every(n => n === 1), 'all owned geometries disposed exactly once');
assert.equal(materialDisposals, 0, 'shared materials survive disposal'); twin.dispose();
for (const m of materials) m.dispose();
console.log(JSON.stringify({ result: 'PASS', scope: 'CPU geometry, sockets, sight clearance, articulated reload, budgets and disposal only; game pixels and owner art acceptance OPEN',
  weaponId: rig.weaponId, stats: measured, gunStats, gunBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, constructionHash: bindHash }, null, 2));
