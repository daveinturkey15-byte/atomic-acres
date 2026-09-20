// One-shot capture of the original lamp subsection; never overwrite this baseline.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
if (existsSync('docs/astra-street-lamps-baseline.json')) throw new Error('Baseline is frozen; do not regenerate to pass a candidate.');
const out = resolve('captures/astra-street-lamps-cpu'); mkdirSync(out, { recursive: true });
const fixture = resolve(out, 'freeze.mjs');
await build({ stdin: { contents: `export { buildYards } from './src/build/yards';
  export { makeRng } from './src/core/kit';`, resolveDir: process.cwd() }, outfile: fixture,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
  plugins: [{ name: 'capture-lamp-primitives', setup(b) { b.onLoad({ filter: /yards\.ts$/ }, args => {
    let source = readFileSync(args.path, 'utf8');
    source = source.replace('dx /= n; dz /= n;', `dx /= n; dz /= n;
      globalThis.__lamp = { x, z, dx, dz, parts: [] }; globalThis.__lamps.push(globalThis.__lamp);`);
    source = source.replace('const a = this.byMat.get(m)', `if (globalThis.__lamp) globalThis.__lamp.parts.push({ geometry: this.geo, matrix: mx.clone() });
      const a = this.byMat.get(m)`);
    source = source.replace('hy2 - 0.2, hz2 + dz * 0.24);', 'hy2 - 0.2, hz2 + dz * 0.24); globalThis.__lamp = null;');
    return { contents: source, loader: 'ts' };
  }); } }] });
const { buildYards, makeRng } = await import(pathToFileURL(fixture));
const material = new THREE.MeshStandardMaterial();
const mat = new Proxy({}, { get: (_, key) => ['painted', 'emissive', 'signText'].includes(key) ? () => material : material });
globalThis.__lamps = []; globalThis.__lamp = null;
const yard = buildYards({ mat, rand: makeRng('nuketown-2025:yards') });
const p = new THREE.Vector3();
const lamps = globalThis.__lamps.map(lamp => {
  const bounds = new THREE.Box3(); let triangles = 0;
  for (const part of lamp.parts) {
    const pos = part.geometry.attributes.position;
    triangles += (part.geometry.index?.count ?? pos.count) / 3;
    for (let v = 0; v < pos.count; v++) bounds.expandByPoint(p.fromBufferAttribute(pos, v).applyMatrix4(part.matrix));
  }
  return { x: lamp.x, z: lamp.z, dx: lamp.dx, dz: lamp.dz,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, triangles,
    housingCentre: [lamp.x + lamp.dx * 1.69, 6.43, lamp.z + lamp.dz * 1.69],
    lensCentre: [lamp.x + lamp.dx * 1.69, 6.25, lamp.z + lamp.dz * 1.69] };
});
const frozen = { sourceCommit: 'd3dcf6d74b5f8da750430cc20ed59052c2d9a667',
  seed: 'nuketown-2025:yards', lamps, originalTriangles: lamps.reduce((n, l) => n + l.triangles, 0),
  colliderCount: yard.colliders.length,
  colliderHash: createHash('sha256').update(JSON.stringify(yard.colliders)).digest('hex'),
  budgets: { addedDrawGroups: 3, addedTriangles: 15000, addedMaterials: 0, addedTextures: 0, addedLights: 0 },
  gates: ['All lamp foot/direction inputs and full yard colliders unchanged.',
    'All replacement vertices fit frozen per-lamp world AABBs; head and lens centres retained.',
    'turningHead foreground: continuous curved tapered arm replaces angular elbow, credible connected housing and inset lens.',
    'midStreet and streetElevation: no moved bases, extra light, bulbous poles or enlarged silhouette.',
    'Moving-camera: no seam sparkle, detached components or resource growth. Root GPU acceptance required.'] };
writeFileSync('docs/astra-street-lamps-baseline.json', JSON.stringify(frozen, null, 2) + '\n');
console.log(JSON.stringify({ lamps: lamps.length, triangles: frozen.originalTriangles, colliders: frozen.colliderCount }));
