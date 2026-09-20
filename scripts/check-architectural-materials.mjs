// CPU ownership, atomicity, source-asset and r180 adapter controls. No pixel claim.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import StandardNodeLibrary from 'three/src/renderers/webgpu/nodes/StandardNodeLibrary.js';

const out = resolve('captures/astra-architecture-cpu');
mkdirSync(out, { recursive: true });
const fixture = resolve(out, 'fixture.mjs');
await build({ entryPoints: ['src/core/architectural-materials.ts'], outfile: fixture,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const { installArchitecturalMaterials: install, isArchitectureEnabled: enabled,
  ARCHITECTURE_TEXTURE_FILES: names } = await import(pathToFileURL(fixture));
assert.equal(enabled(''), false);
assert.equal(enabled('?architecture=canary'), true);
assert.equal(enabled('?architecture=off'), false);
const keys = ['stuccoCream', 'stuccoTerracotta', 'capsuleWhite', 'interiorWall',
  'roofWhite', 'timber', 'timberDark'];
const library = () => {
  const borrowed = new THREE.Texture();
  let borrowedDisposals = 0, libraryDisposals = 0;
  borrowed.addEventListener('dispose', () => ++borrowedDisposals);
  const lib = Object.fromEntries(keys.map(key => [key, new THREE.MeshStandardMaterial({
    color: key === 'interiorWall' ? 0x8f8a7a : 0xffffff,
    map: borrowed, roughnessMap: borrowed, normalMap: borrowed,
  })]));
  lib.concrete = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, map: borrowed });
  lib.dispose = () => { ++libraryDisposals; borrowed.dispose(); };
  return { lib, borrowed, counts: () => ({ borrowedDisposals, libraryDisposals }) };
};
const loaders = () => {
  const maps = names.map((name, i) => new THREE.DataTexture(
    new Uint8Array(4), 1024, i < 2 ? 1024 : 256));
  const disposals = [0, 0, 0, 0];
  maps.forEach((map, i) => map.addEventListener('dispose', () => ++disposals[i]));
  let calls = 0;
  return { maps, disposals, calls: () => calls,
    load: async url => { ++calls; return maps[names.indexOf(url.split('/').at(-1))]; } };
};
const l = library(), t = loaders();
const oldDispose = l.lib.dispose, oldColour = l.lib.interiorWall.color.clone();
const identities = keys.map(key => l.lib[key]);
const concrete = l.lib.concrete;
assert.equal(await install(l.lib, false, t.load), null);
assert.equal(t.calls(), 0);
const pending = install(l.lib, true, t.load);
assert.equal(install(l.lib, true, t.load), pending);
const controller = await pending;
assert.ok(controller);
assert.equal(t.calls(), 4);
assert.equal(controller.materialCount, 7);
assert.ok(controller.runtimeBytes <= 24 * 1024 * 1024);
assert.deepEqual(keys.map(key => l.lib[key]), identities);
assert.equal(l.lib.concrete, concrete);
assert.equal(l.lib.concrete.map, l.borrowed);
assert.equal(l.counts().borrowedDisposals, 0);
const adapter = new StandardNodeLibrary();
for (const material of identities) {
  assert.equal(material.map, null);
  const converted = adapter.fromMaterial(material);
  assert.equal(converted.isNodeMaterial, true);
  for (const field of ['colorNode', 'normalNode', 'roughnessNode']) {
    assert.ok(material[field]?.isNode, field);
    assert.equal(converted[field], material[field], `${field} survives r180 renderer adapter`);
  }
  assert.equal(converted.color, material.color);
}
// Repeated callers neither refetch assets nor allocate new material graphs.
const graph = l.lib.stuccoCream.normalNode;
for (let i = 0; i < 10000; ++i) assert.equal(install(l.lib, true, t.load), pending);
assert.equal(l.lib.stuccoCream.normalNode, graph);
assert.equal(t.calls(), 4);
controller.dispose(); controller.dispose();
assert.deepEqual(t.disposals, [1, 1, 1, 1]);
assert.equal(l.lib.dispose, oldDispose);
assert.ok(l.lib.interiorWall.color.equals(oldColour));
for (const m of identities) {
  assert.equal(m.map, l.borrowed);
  assert.equal(Object.hasOwn(m, 'colorNode'), false);
}
assert.equal(l.counts().borrowedDisposals, 0);

// Full library teardown must also release the four owned textures exactly once.
const teardown = library(), td = loaders();
const c2 = await install(teardown.lib, true, td.load);
teardown.lib.dispose(); c2.dispose();
assert.deepEqual(td.disposals, [1, 1, 1, 1]);
assert.deepEqual(teardown.counts(), { borrowedDisposals: 1, libraryDisposals: 1 });

// A missing channel leaves all original materials intact and frees partial maps.
const failed = library(), f = loaders();
const warn = console.warn; const warnings = [];
console.warn = message => warnings.push(message);
try {
  const fail = await install(failed.lib, true, url => {
    if (url.endsWith(names[2])) throw Error('intentional missing channel');
    return f.load(url);
  });
  assert.equal(fail, null);
  assert.equal(warnings.length, 1);
} finally { console.warn = warn; }
assert.deepEqual(f.disposals, [1, 1, 0, 1]);
assert.equal(failed.lib.timber.map, failed.borrowed);
assert.equal(failed.counts().borrowedDisposals, 0);
// Failure is retryable, not a cached partially installed graph.
const retry = loaders();
const c3 = await install(failed.lib, true, retry.load); assert.ok(c3); c3.dispose();

// Teardown during in-flight loading does not install into a dead library.
const cancelled = library(), cl = loaders(); const releases = [];
const cancelledTask = install(cancelled.lib, true, url => new Promise(resolve =>
  releases.push(() => resolve(cl.maps[names.indexOf(url.split('/').at(-1))]))));
await Promise.resolve(); cancelled.lib.dispose(); releases.forEach(release => release());
assert.equal(await cancelledTask, null);
assert.deepEqual(cl.disposals, [1, 1, 1, 1]);
assert.equal(cancelled.lib.stuccoCream.map, cancelled.borrowed);

const assets = resolve('public/assets/architecture-pbr');
const provenance = JSON.parse(readFileSync(resolve(assets, 'provenance.json')));
let total = 0;
for (const f of [...provenance.sources.flatMap(s => s.files), ...provenance.derivations]) {
  const bytes = readFileSync(resolve(assets, f.path)); total += bytes.length;
  assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256, f.path);
  assert.equal(bytes.length, f.bytes);
  if (f.dimensions) {
    assert.equal(bytes.readUInt32BE(16), f.dimensions[0]);
    assert.equal(bytes.readUInt32BE(20), f.dimensions[1]);
  }
}
assert.ok(total < 8_000_000);
assert.equal(total, provenance.totalAssetBytes);
const result = { status: 'PASS', rendererAcceptance: 'OPEN: no GPU/browser lease in this lane',
  materials: 7, ownedTextures: 4, sourceScans: 2, packagedAssetBytes: total,
  runtimeTextureBytesWithMipmaps: controller.runtimeBytes,
  controls: ['r180 standard-to-node hooks', 'material identity', 'borrowed map ownership',
    '10000 cache hits', 'explicit disposal', 'library teardown', 'partial load failure and retry',
    'teardown while loading', 'source and derived hashes', 'PNG dimensions and budgets'] };
writeFileSync(resolve(out, 'result.json'), JSON.stringify(result, null, 2)+'\n');
console.log(JSON.stringify(result));
