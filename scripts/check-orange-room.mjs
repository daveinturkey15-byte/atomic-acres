// CPU geometry, authority parity, UV and late-load disposal contracts. Not a visual verdict.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';

const out = resolve('captures/orange-room-cpu'); mkdirSync(out, { recursive: true });
const modules = {};
for (const [key, entry] of Object.entries({ materials: 'src/core/interior-materials.ts', furniture: 'src/build/interior-furniture.ts', house: 'src/build/orange-house.ts' })) {
  const file = resolve(out, key + '.mjs');
  await build({ entryPoints: [entry], outfile: file, bundle: true, format: 'esm', platform: 'node', packages: 'external',
    define: { 'import.meta.env.BASE_URL': '"./"', 'import.meta.env.DEV': 'false' }, logLevel: 'silent' });
  modules[key] = await import(pathToFileURL(file));
}
const requests = [];
globalThis.document = { createElement: () => ({ width: 2, height: 2, getContext: () => ({ fillRect() {} }) }) };
const originalLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = function(url, onLoad, _progress, onError) {
  requests.push({ url, onLoad, onError }); return new THREE.Texture();
};
const m = modules.materials.createInteriorMaterials();
assert.equal(requests.length, 6);
const resources = new Set();
for (const value of Object.values(m)) if (value?.isMaterial) {
  resources.add(value);
  for (const slot of ['map', 'normalMap', 'roughnessMap']) if (value[slot]) resources.add(value[slot]);
}
assert.equal(resources.size, 16, 'seven materials and nine owned texture bindings');
let disposed = 0; for (const r of resources) r.addEventListener('dispose', () => disposed++);
const geometry = [];
for (const [name, g, limit] of [
  ['sofa', modules.furniture.livingSofa(m), [0.91, .98, 2.21]],
  ['cabinet', modules.furniture.livingCabinet(m, 3.15), [.67, 3.151, 1.301]],
  ['television', modules.furniture.livingTelevision(m, m.seam), [.52, .96, 1.101]],
]) {
  g.updateMatrixWorld(true); const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  size.toArray().forEach((v, i) => assert.ok(v <= limit[i], `${name} exceeds furniture envelope: ${size.toArray()}`));
  let triangles = 0;
  g.traverse(o => { if (!o.isMesh) return;
    for (const a of Object.values(o.geometry.attributes)) assert.ok([...a.array].every(Number.isFinite), `${name} contains nonfinite vertex data`);
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  });
  assert.ok(triangles < 12000, `${name} triangle ceiling`); geometry.push({ name, size: size.toArray(), triangles });
}
const plain = new THREE.MeshStandardMaterial();
const lib = new Proxy({ interior: () => m }, { get: (target, key) => key in target ? target[key] :
  ['painted', 'emissive', 'signText', 'operator'].includes(key) ? () => plain : plain });
const make = authored => {
  globalThis.window = { location: { search: authored ? '?room=authored' : '' } };
  return modules.house.buildOrangeHouse({ mat: lib, rand: () => .5 });
};
const base = make(false), candidate = make(true);
const bounds = result => result.colliders.map(c => [...c.min.toArray(), ...c.max.toArray()]);
assert.deepEqual(bounds(candidate), bounds(base), 'presentation keeps every authoritative collider byte-for-byte');
// Disposed materials must never accept asynchronous images or recreate GPU resources.
m.dispose(); m.dispose(); assert.equal(disposed, resources.size);
let loadedDisposed = 0;
for (const req of requests) { const t = new THREE.Texture(); t.addEventListener('dispose', () => loadedDisposed++); req.onLoad(t); }
assert.equal(loadedDisposed, 6); assert.equal(m.status.loaded, 0); assert.equal(disposed, resources.size);
THREE.TextureLoader.prototype.load = originalLoad;
for (const result of [base, candidate]) result.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
plain.dispose();
const receipt = { pass: true, geometry, colliders: candidate.colliders.length, resources: resources.size,
  checks: ['finite vertex/UV data', 'furniture bounds', '<12k triangles per furniture prefab', 'exact collider parity', 'single disposal', 'late-load disposal'] };
writeFileSync(resolve(out, 'result.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
