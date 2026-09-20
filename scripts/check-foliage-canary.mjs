// CPU contract checks. Actual fixed-camera/WebGPU acceptance remains with root.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
const frozen = JSON.parse(readFileSync('docs/astra-foliage-baseline.json', 'utf8'));
const out = resolve('captures/astra-foliage-cpu'); mkdirSync(out, { recursive: true });
const fixture = resolve(out, 'fixture.mjs');
await build({ stdin: { contents: `export { buildYards } from './src/build/yards';
  export { makeRng } from './src/core/kit';
  export { batchStatic } from './src/core/static-batch';
  export { buildVegetationTrees } from './src/build/vegetation-tree';
  export { isFoliageCanaryEnabled } from './src/build/vegetation-foliage-canary';`, resolveDir: process.cwd() },
  outfile: fixture, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const { buildYards, makeRng, buildVegetationTrees, isFoliageCanaryEnabled, batchStatic } = await import(pathToFileURL(fixture));
assert.equal(isFoliageCanaryEnabled(''), false);
assert.equal(isFoliageCanaryEnabled('?foliage=canary'), true);
assert.equal(isFoliageCanaryEnabled('?foliage=off'), false);
const plain = new THREE.MeshStandardMaterial();
const bark = new THREE.MeshStandardMaterial({ color: 0x5d4635 });
const solidLeaf = new THREE.MeshStandardMaterial({ color: 0x416837 });
const alphaMap = new THREE.Texture();
const alpha = new THREE.MeshStandardMaterial({ alphaMap, alphaTest: 0.42, side: THREE.DoubleSide });
let borrowedDisposals = 0;
for (const borrowed of [plain, bark, solidLeaf, alpha, alphaMap]) borrowed.addEventListener('dispose', () => ++borrowedDisposals);
const mat = new Proxy({}, { get: (_, key) => key === 'leafCards' ? alpha :
  key === 'bark' ? bark : key === 'leaf' ? solidLeaf :
  ['painted', 'emissive', 'signText'].includes(key) ? () => plain : plain });
globalThis.location = { search: '' };
const yardBefore = buildYards({ mat, rand: makeRng(frozen.seed) });
const baseline = yardBefore.group.getObjectByName('vegetation-tree-canary');
assert.deepEqual(baseline.userData.vegetationStats, frozen.stats);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
assert.equal(hash(yardBefore.colliders), frozen.yardColliderHash);
globalThis.location.search = '?foliage=canary';
const yardAfter = buildYards({ mat, rand: makeRng(frozen.seed) });
const candidate = yardAfter.group.getObjectByName('vegetation-tree-canary');
assert.deepEqual(yardAfter.colliders, yardBefore.colliders);
assert.equal(hash(yardAfter.colliders), frozen.yardColliderHash);
assert.equal(candidate.userData.foliageCanary, 'branch-sprays-v1');
assert.deepEqual(candidate.userData.foliageFrozenBounds, frozen.crownBounds);
for (const name of ['tree-trunk-tapered', 'tree-root-flare', 'tree-branches']) {
  const a = baseline.getObjectByName(name), b = candidate.getObjectByName(name);
  assert.deepEqual(b.instanceMatrix.array, a.instanceMatrix.array);
  assert.deepEqual(b.geometry.attributes.position.array, a.geometry.attributes.position.array);
  assert.equal(a.material, b.material);
}
const leaves = candidate.getObjectByName('tree-leaf-sprays-alpha');
const twigs = candidate.getObjectByName('tree-secondary-twigs');
assert.equal(leaves.material, alpha); assert.equal(twigs.material, bark);
assert.equal(leaves.material.transparent, false); assert.ok(leaves.material.alphaTest > 0);
assert.equal(candidate.getObjectByName('tree-canopy-interior'), undefined);
assert.equal(candidate.children.length, 5); assert.equal(leaves.count, 3200); assert.equal(twigs.count, 120);
let actualTriangles = 0;
for (const mesh of candidate.children) {
  assert.equal(mesh.isInstancedMesh, true);
  actualTriangles += mesh.geometry.index.count / 3 * mesh.count;
  for (const attribute of Object.values(mesh.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
  assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
  assert.equal(mesh.instanceMatrix.usage, THREE.StaticDrawUsage);
  assert.ok(Number.isFinite(mesh.boundingSphere.radius));
}
assert.equal(actualTriangles, candidate.userData.vegetationStats.triangles);
assert.ok(actualTriangles - frozen.stats.triangles <= frozen.budgets.addedTriangles);
assert.ok(candidate.children.length - frozen.stats.drawCount <= frozen.budgets.addedDraws);
const p = new THREE.Vector3(), matrix = new THREE.Matrix4();
function verifyLeafBounds(mesh) {
  const pos = mesh.geometry.attributes.position;
  for (let tree = 0; tree < frozen.specs.length; tree++) {
    const b = frozen.crownBounds[tree];
    const box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)).expandByScalar(0.00001);
    for (let instance = tree * 320; instance < (tree + 1) * 320; instance++) {
      mesh.getMatrixAt(instance, matrix);
      for (let v = 0; v < pos.count; v++) assert.ok(box.containsPoint(p.fromBufferAttribute(pos, v).applyMatrix4(matrix)),
        `tree ${tree} instance ${instance} exceeds frozen foliage bounds`);
    }
  }
}
verifyLeafBounds(leaves);
// Secondary wood stays in the existing whole-tree envelope, including the old
// major branches below the leaf crown. It does not acquire collision of its own.
for (let tree = 0; tree < frozen.specs.length; tree++) {
  const box = new THREE.Box3();
  for (const [name, count] of [['tree-trunk-tapered', 1], ['tree-root-flare', 1],
    ['tree-branches', 3], ['tree-canopy-interior', 3], ['tree-leaf-cards-alpha', 100]]) {
    const mesh = baseline.getObjectByName(name), pos = mesh.geometry.attributes.position;
    for (let i = tree * count; i < (tree + 1) * count; i++) {
      mesh.getMatrixAt(i, matrix);
      for (let v = 0; v < pos.count; v++) box.expandByPoint(p.fromBufferAttribute(pos, v).applyMatrix4(matrix));
    }
  }
  box.expandByScalar(0.00001);
  const pos = twigs.geometry.attributes.position;
  for (let i = tree * 12; i < (tree + 1) * 12; i++) {
    twigs.getMatrixAt(i, matrix);
    for (let v = 0; v < pos.count; v++) assert.ok(box.containsPoint(p.fromBufferAttribute(pos, v).applyMatrix4(matrix)));
  }
}
// Positive negative control: a slipped instance must fail the exact same check.
leaves.getMatrixAt(0, matrix); const saved = matrix.clone(); matrix.elements[12] += 5;
leaves.setMatrixAt(0, matrix); assert.throws(() => verifyLeafBounds(leaves), /exceeds frozen/);
leaves.setMatrixAt(0, saved);
const again = buildVegetationTrees({ bark: plain, leaf: plain, leafCards: alpha }, frozen.specs, true);
for (const name of ['tree-leaf-sprays-alpha', 'tree-secondary-twigs']) {
  const a = candidate.getObjectByName(name), b = again.group.getObjectByName(name);
  assert.deepEqual(a.instanceMatrix.array, b.instanceMatrix.array);
  assert.notEqual(a.geometry, b.geometry); // separate build owners, never cross-dispose
  assert.deepEqual(a.geometry.attributes.position.array, b.geometry.attributes.position.array);
}
const single = buildVegetationTrees({ bark: plain, leaf: plain, leafCards: alpha }, frozen.specs.slice(0, 1), true);
const singleLeaves = single.group.getObjectByName('tree-leaf-sprays-alpha');
assert.deepEqual(singleLeaves.geometry.attributes.position.array, leaves.geometry.attributes.position.array);
assert.equal(singleLeaves.count, 320); // geometry footprint does not grow with tree count
assert.equal(new Set(leaves.geometry.index.array).size, 16);
assert.equal(leaves.geometry.index.count / 3, 8);
// No silent opaque fallback: absent/alpha-blended materials preserve the baseline.
const unavailable = buildVegetationTrees({ bark: plain, leaf: plain }, frozen.specs, true);
assert.deepEqual(unavailable.stats, frozen.stats);
assert.equal(unavailable.group.userData.foliageCanary, 'unavailable-cutout-material');
const blended = alpha.clone(); blended.transparent = true;
assert.deepEqual(buildVegetationTrees({ bark: plain, leaf: plain, leafCards: blended }, frozen.specs, true).stats, frozen.stats);
assert.equal(buildVegetationTrees({ bark: plain, leaf: plain }, [], true).stats.triangles, 0);
// Replaced baseline meshes/geometry are released before returning; library assets are not.
const oldGeoDispose = THREE.BufferGeometry.prototype.dispose, oldMeshDispose = THREE.InstancedMesh.prototype.dispose;
const retiredGeometry = [], retiredMeshes = [];
try {
  THREE.BufferGeometry.prototype.dispose = function () { retiredGeometry.push(this); oldGeoDispose.call(this); };
  THREE.InstancedMesh.prototype.dispose = function () { retiredMeshes.push(this); oldMeshDispose.call(this); };
  const r = buildVegetationTrees({ bark: plain, leaf: plain, leafCards: alpha }, frozen.specs, true);
  assert.equal(retiredGeometry.length, 2); assert.equal(new Set(retiredGeometry).size, 2);
  assert.equal(retiredMeshes.length, 2); assert.ok(retiredMeshes.every(m => m.parent === null));
  const active = r.group.children;
  for (const m of active) { assert.ok(!retiredGeometry.includes(m.geometry)); m.dispose(); m.geometry.dispose(); }
  assert.equal(new Set(retiredGeometry).size, 7); assert.equal(new Set(retiredMeshes).size, 7);
} finally { THREE.BufferGeometry.prototype.dispose = oldGeoDispose; THREE.InstancedMesh.prototype.dispose = oldMeshDispose; }
assert.equal(borrowedDisposals, 0);
const manifest = JSON.parse(readFileSync('public/textures/vegetation/manifest.json', 'utf8'));
for (const file of manifest.files) {
  const bytes = readFileSync(file.path);
  assert.equal(bytes.length, file.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
}
// Exercise the real batcher once: it may merge the small bark draws but must
// leave the alpha mesh, per-instance tint and its borrowed material intact.
const baselineBatch = batchStatic(baseline, 'foliage-baseline-cpu');
const candidateBatch = batchStatic(candidate, 'foliage-canary-cpu');
assert.equal(candidate.getObjectByName('tree-leaf-sprays-alpha'), leaves);
assert.equal(leaves.material, alpha); assert.ok(leaves.instanceColor);
assert.equal(borrowedDisposals, 0);
assert.ok(candidateBatch.meshesAfter - baselineBatch.meshesAfter <= frozen.budgets.addedDraws);
const report = { status: 'CPU_PASS_GPU_OPEN', baseline: frozen.stats, candidate: candidate.userData.vegetationStats,
  addedDraws: 0, baselineBatch, candidateBatch,
  addedTriangles: actualTriangles - frozen.stats.triangles, addedTextureBytes: 0,
  colliderCount: yardAfter.colliders.length, colliderHash: hash(yardAfter.colliders),
  frozenCrownBounds: '10/10 contained; deliberately slipped instance rejected',
  lifecycle: '2 replaced meshes/geometry disposed; active geometry independently disposable; 0 borrowed disposals',
  assets: '4 existing CC0 source maps verified against committed SHA-256 manifest',
  visualAcceptance: 'OPEN - root actual WebGPU frames, moving camera and runtime resource gate required' };
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
