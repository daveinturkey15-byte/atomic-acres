// One-shot pre-edit evidence, not a replacement for the runtime visual gate.
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
const out = resolve('captures/astra-foliage-cpu');
if (existsSync('docs/astra-foliage-baseline.json')) throw new Error('Frozen baseline already exists; never overwrite it to pass a candidate.');
mkdirSync(out, { recursive: true });
const file = resolve(out, 'yards-freeze.mjs');
await build({ entryPoints: ['src/build/yards.ts'], outfile: file, bundle: true,
  platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
  plugins: [{ name: 'capture-inputs', setup(b) { b.onLoad({ filter: /yards\.ts$/ }, a => ({
    contents: readFileSync(a.path, 'utf8').replace('g.add(buildVegetationTrees(',
      'globalThis.__treeSpecs = treeSpecs; g.add(buildVegetationTrees('), loader: 'ts' })); } }] });
const { buildYards } = await import(pathToFileURL(file));
const rngFile = resolve(out, 'kit.mjs');
await build({ entryPoints: ['src/core/kit.ts'], outfile: rngFile, bundle: true,
  platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const { makeRng } = await import(pathToFileURL(rngFile));
const plain = new THREE.MeshStandardMaterial();
const alpha = new THREE.MeshStandardMaterial({ alphaTest: 0.42, side: THREE.DoubleSide });
const mat = new Proxy({}, { get: (_, key) => key === 'leafCards' ? alpha :
  ['painted', 'emissive', 'signText'].includes(key) ? () => plain : plain });
const yard = buildYards({ mat, rand: makeRng('nuketown-2025:yards') });
const tree = yard.group.getObjectByName('vegetation-tree-canary');
const matrix = new THREE.Matrix4(), p = new THREE.Vector3();
function bounds(mesh, first, count) {
  const box = new THREE.Box3(); const pos = mesh.geometry.attributes.position;
  for (let i = first; i < first + count; i++) {
    mesh.getMatrixAt(i, matrix);
    for (let v = 0; v < pos.count; v++) box.expandByPoint(p.fromBufferAttribute(pos, v).applyMatrix4(matrix));
  }
  return box;
}
const crowns = tree.getObjectByName('tree-canopy-interior');
const leaves = tree.getObjectByName('tree-leaf-cards-alpha');
const frozen = {
  baselineSource: '25b2c96ddf35918430c5ab4eea667faaaf98e786',
  seed: 'nuketown-2025:yards', stats: tree.userData.vegetationStats,
  yardColliderHash: createHash('sha256').update(JSON.stringify(yard.colliders)).digest('hex'),
  yardColliderCount: yard.colliders.length,
  specs: globalThis.__treeSpecs,
  crownBounds: globalThis.__treeSpecs.map((_, i) => {
    const b = bounds(crowns, i * 3, 3).union(bounds(leaves, i * 100, 100));
    return { min: b.min.toArray(), max: b.max.toArray() };
  }),
  materialOwnership: 'All materials/textures remain borrowed from MaterialLibrary.',
  budgets: { addedDraws: 4, addedTriangles: 12000, addedTextureBytes: 8388608 },
  visualCriteria: [
    'turningHead: remove opaque round green lobes; connected woody forks and irregular fine leaf edges are visible.',
    'spawnA / yardWhite: retain crown envelopes and green palette, no thin floating confetti or bare twig-only crowns.',
    'moving camera: stable alpha-tested cutout leaves without obvious flat rectangular clusters, sparkle or popping.',
    'No new trunks, shifted tree positions, expanded canopy bounds or gameplay collider changes.'
  ],
};
writeFileSync('docs/astra-foliage-baseline.json', JSON.stringify(frozen, null, 2) + '\n');
console.log(JSON.stringify({ stats: frozen.stats, colliders: frozen.yardColliderCount, frozenTrees: frozen.specs.length }));
