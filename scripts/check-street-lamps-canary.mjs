// Frozen CPU gates for the lamp asset. Root owns actual WebGPU/pixel acceptance.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
const frozen = JSON.parse(readFileSync('docs/astra-street-lamps-baseline.json', 'utf8'));
const out = resolve('captures/astra-street-lamps-cpu'); mkdirSync(out, { recursive: true });
const fixture = resolve(out, 'fixture.mjs');
await build({ stdin: { contents: `export { buildYards } from './src/build/yards';
  export { makeRng } from './src/core/kit';
  export { batchStatic } from './src/core/static-batch';
  export { buildStreetLampsCanary, isStreetLampsCanaryEnabled } from './src/build/street-lamps-canary';`,
  resolveDir: process.cwd() }, outfile: fixture, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
  plugins: [{ name: 'trace-unrelated-yard-parts', setup(b) { b.onLoad({ filter: /yards\.ts$/ }, args => {
    let source = readFileSync(args.path, 'utf8');
    source = source.replace('dx /= n; dz /= n;', 'dx /= n; dz /= n; globalThis.__insideLamp = !lampCanary;');
    source = source.replace('hy2 - 0.2, hz2 + dz * 0.24);', 'hy2 - 0.2, hz2 + dz * 0.24); globalThis.__insideLamp = false;');
    source = source.replace('const a = this.byMat.get(m)', `if (!globalThis.__insideLamp) globalThis.__unrelated.push({
      type: this.geo.type, material: m.uuid, matrix: mx.toArray() }); const a = this.byMat.get(m)`);
    return { contents: source, loader: 'ts' };
  }); } }] });
const { buildYards, makeRng, batchStatic, buildStreetLampsCanary: buildLamps,
  isStreetLampsCanaryEnabled: enabled } = await import(pathToFileURL(fixture));
assert.equal(enabled(''), false); assert.equal(enabled('?street-lamps=canary'), true);
assert.equal(enabled('?street-lamps=off'), false);
const cache = new Map(); let materialDisposals = 0;
const cached = (key, params = {}) => {
  if (!cache.has(key)) { const m = new THREE.MeshStandardMaterial(params); m.name = key;
    m.addEventListener('dispose', () => ++materialDisposals); cache.set(key, m); }
  return cache.get(key);
};
const mat = new Proxy({}, { get: (_, key) => {
  if (key === 'painted') return (c, r, metal) => cached(`painted/${c}/${r}/${metal}`, { color: c, roughness: r, metalness: metal });
  if (key === 'emissive') return (c, i) => cached(`emissive/${c}/${i}`, { emissive: c, emissiveIntensity: i });
  if (key === 'signText') return (...args) => cached('signText/' + args.join('/'));
  return cached(String(key), key === 'leafCards' ? { alphaTest: 0.42, side: THREE.DoubleSide } : {});
} });
globalThis.__insideLamp = false; globalThis.__unrelated = [];
globalThis.location = { search: '?foliage=canary' };
const yardBefore = buildYards({ mat, rand: makeRng(frozen.seed) });
const unrelatedBefore = globalThis.__unrelated;
const beforeMaterials = [...cache.keys()].sort();
globalThis.__unrelated = [];
globalThis.location.search = '?foliage=canary&street-lamps=canary';
const yardAfter = buildYards({ mat, rand: makeRng(frozen.seed) });
assert.deepEqual(globalThis.__unrelated, unrelatedBefore, 'Every non-lamp Batch input must stay exact');
assert.deepEqual([...cache.keys()].sort(), beforeMaterials, 'No material cache entry added');
assert.deepEqual(yardAfter.colliders, yardBefore.colliders);
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
assert.equal(hash(yardBefore.colliders), frozen.colliderHash); assert.equal(yardAfter.colliders.length, frozen.colliderCount);
assert.equal(yardBefore.group.getObjectByName('street-lamps-canary'), undefined);
const lamps = yardAfter.group.getObjectByName('street-lamps-canary');
assert.ok(lamps); assert.equal(lamps.children.length, 3);
const specs = frozen.lamps.map(({ x, z, dx, dz }) => ({ x, z, dx, dz }));
assert.deepEqual(lamps.userData.streetLampInputs, specs);
const stats = lamps.userData.streetLampStats;
assert.equal(stats.lampCount, 8); assert.ok(stats.triangles - frozen.originalTriangles <= frozen.budgets.addedTriangles);
const metal = lamps.getObjectByName('street-lamp-metal');
const housing = lamps.getObjectByName('street-lamp-housing');
const lens = lamps.getObjectByName('street-lamp-lens');
assert.equal(metal.material, mat.steel); assert.ok(beforeMaterials.includes(housing.material.name));
assert.equal(lens.material.emissiveIntensity, 0.5);
const p = new THREE.Vector3(), matrix = new THREE.Matrix4();
function boundsCheck(group) {
  for (let i = 0; i < specs.length; i++) {
    const b = frozen.lamps[i].bounds;
    const box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)).expandByScalar(0.00001);
    for (const mesh of group.children) {
      mesh.getMatrixAt(i, matrix); const positions = mesh.geometry.attributes.position;
      for (let v = 0; v < positions.count; v++) assert.ok(box.containsPoint(p.fromBufferAttribute(positions, v).applyMatrix4(matrix)),
        `Lamp ${i} ${mesh.name} vertex ${v} exceeds frozen bounds`);
    }
  }
}
boundsCheck(lamps);
metal.getMatrixAt(0, matrix); const saved = matrix.clone(); matrix.elements[12] += 2;
metal.setMatrixAt(0, matrix); assert.throws(() => boundsCheck(lamps), /exceeds frozen bounds/); metal.setMatrixAt(0, saved);
for (const mesh of lamps.children) {
  assert.equal(mesh.count, 8); assert.equal(mesh.instanceMatrix.usage, THREE.StaticDrawUsage);
  assert.ok(mesh.instanceMatrix.array.every(Number.isFinite)); assert.equal(mesh.isLight, undefined);
  for (const a of Object.values(mesh.geometry.attributes)) assert.ok(a.array.every(Number.isFinite));
  const normals = mesh.geometry.attributes.normal;
  for (let v = 0; v < normals.count; v++) assert.ok(Math.abs(p.fromBufferAttribute(normals, v).length() - 1) < 0.0001);
  assert.ok(mesh.boundingSphere.radius > 0 && Number.isFinite(mesh.boundingSphere.radius));
  for (let i = 0; i < specs.length; i++) {
    mesh.getMatrixAt(i, matrix);
    assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(new THREE.Vector3(specs[i].x, 0, specs[i].z)) < 0.00001);
  }
}
// Analytic tangent continuity: a smooth bend joins a straight stem and horizontal
// housing connection, without a duplicated elbow sphere or zero-length segment.
const rings = metal.geometry.userData.sweepRings;
assert.equal(rings[3].x, 0); assert.equal(rings[3].y, 5);
assert.deepEqual([rings[3].tx, rings[3].ty], [0, 1]);
assert.ok(Math.abs(rings.at(-2).tx - 1) < 1e-12 && Math.abs(rings.at(-2).ty) < 1e-12);
for (let i = 1; i < rings.length; i++) {
  assert.ok(Math.hypot(rings[i].x - rings[i - 1].x, rings[i].y - rings[i - 1].y) > 0.001);
  assert.ok(rings[i].radius <= rings[i - 1].radius);
  assert.ok(rings[i].tx * rings[i - 1].tx + rings[i].ty * rings[i - 1].ty > 0.99);
}
// Outward sweep winding is important with the existing FrontSide steel material.
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cross = new THREE.Vector3(), normal = new THREE.Vector3();
const pos = metal.geometry.attributes.position, nor = metal.geometry.attributes.normal, idx = metal.geometry.index;
const poleIndices = (rings.length - 1) * 16 * 6;
for (let i = 0; i < poleIndices; i += 3) {
  a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
  cross.crossVectors(b.sub(a), c.sub(a)); normal.fromBufferAttribute(nor, idx.getX(i));
  assert.ok(cross.dot(normal) > 0);
}
for (const [mesh, role] of [[housing, 'housingCentre'], [lens, 'lensCentre']]) {
  const centre = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
  for (let i = 0; i < specs.length; i++) {
    mesh.getMatrixAt(i, matrix);
    assert.ok(p.copy(centre).applyMatrix4(matrix).distanceTo(new THREE.Vector3(...frozen.lamps[i][role])) < 0.00001);
  }
}
const roles = { steel: metal.material, housing: housing.material, lens: lens.material };
const second = buildLamps(roles, specs), one = buildLamps(roles, specs.slice(0, 1));
for (let role = 0; role < 3; role++) {
  assert.notEqual(lamps.children[role].geometry, second.children[role].geometry);
  assert.deepEqual(lamps.children[role].instanceMatrix.array, second.children[role].instanceMatrix.array);
  assert.deepEqual(lamps.children[role].geometry.attributes.position.array, one.children[role].geometry.attributes.position.array);
}
assert.equal(buildLamps(roles, []).children.length, 0);
assert.throws(() => buildLamps(roles, [{ x: 0, z: 0, dx: 0, dz: 0 }]), /nonzero direction/);
assert.throws(() => buildLamps(roles, [{ x: NaN, z: 0, dx: 1, dz: 0 }]), /finite coordinates/);
let meshesDisposed = 0, geometriesDisposed = 0;
for (const mesh of second.children) {
  mesh.addEventListener('dispose', () => ++meshesDisposed); mesh.geometry.addEventListener('dispose', () => ++geometriesDisposed);
  mesh.dispose(); mesh.geometry.dispose();
}
assert.equal(meshesDisposed, 3); assert.equal(geometriesDisposed, 3); assert.equal(materialDisposals, 0);
const beforeBatch = batchStatic(yardBefore.group, 'street-lamps-before-cpu');
const afterBatch = batchStatic(yardAfter.group, 'street-lamps-after-cpu');
assert.ok(afterBatch.meshesAfter - beforeBatch.meshesAfter <= frozen.budgets.addedDrawGroups);
assert.equal(materialDisposals, 0);
const report = { status: 'CPU_PASS_GPU_OPEN', lamps: specs.length,
  originalTriangles: frozen.originalTriangles, candidateTriangles: stats.triangles,
  addedTriangles: stats.triangles - frozen.originalTriangles, drawGroupsBeforeBatch: 3,
  beforeBatch, afterBatch, addedMaterials: 0, addedTextures: 0, addedLights: 0,
  colliderHash: frozen.colliderHash, colliderCount: frozen.colliderCount,
  bounds: '8/8 per-vertex bounds and housing/lens centres preserved; escaped-instance negative control rejected',
  unrelatedInputs: `${unrelatedBefore.length} non-lamp Batch transforms/materials identical`,
  geometry: 'finite, outward winding, unit normals, smooth tangent joins, monotonic taper, shared across lamps',
  ownership: 'independent build geometry ownership; 3 mesh/geometry disposal events; 0 borrowed material disposals',
  gpu: 'OPEN actual same-station pixels, moving camera and runtime resource gate with root' };
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
