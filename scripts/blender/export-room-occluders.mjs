// Export exact authored house geometry, not collider proxies, for a CPU BVH bake.
import * as THREE from 'three';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const out = resolve('work/room-visibility-bake'); mkdirSync(out, { recursive: true });
const entry = resolve(out, 'house.mjs');
await build({ entryPoints: ['src/build/orange-house.ts'], outfile: entry, bundle: true,
  platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent', define: { 'import.meta.env.DEV': 'false' } });
const { buildOrangeHouse } = await import(pathToFileURL(entry));
const materials = new Map();
const material = key => {
  if (!materials.has(key)) { const m = new THREE.MeshStandardMaterial(); m.name = key; materials.set(key, m); }
  return materials.get(key);
};
const interior = Object.fromEntries(['leather','walnut','carpet','linen','plaster','brass','seam'].map(k => [k,material('room-'+k)]));
const mat = new Proxy({}, { get: (_, key) => key === 'interior' ? () => interior :
  ['painted','emissive','signText','operator'].includes(key) ? () => material(key) : material(key) });
globalThis.window = { location: { search: '?room=authored' } };
const result = buildOrangeHouse({ mat, rand: () => .5 }); result.group.updateMatrixWorld(true);
const positions = [], triangles = []; let meshes = 0;
const v = new THREE.Vector3(), inst = new THREE.Matrix4(), world = new THREE.Matrix4();
result.group.traverse(o => {
  if (!o.isMesh || ['glass','roofGlazing','emissive','windowDark'].includes(o.material.name)) return;
  if (Array.isArray(o.material)) throw Error('Unexpected multi-material geometry');
  const a = o.geometry.attributes.position, index = o.geometry.index;
  for (let n = 0; n < (o.isInstancedMesh ? o.count : 1); n++) {
    world.copy(o.matrixWorld); if(o.isInstancedMesh) { o.getMatrixAt(n, inst); world.multiply(inst); }
    const offset = positions.length;
    for(let i=0; i<a.count; i++) positions.push(v.fromBufferAttribute(a,i).applyMatrix4(world).toArray());
    for(let i=0; i<(index?.count ?? a.count); i+=3) triangles.push([0,1,2].map(k=>offset+(index?index.getX(i+k):i+k)));
    meshes++;
  }
});
const sourceFiles = ['src/build/orange-house.ts','src/build/interior-furniture.ts','src/core/layout.ts','src/core/static-batch.ts'];
const payload = { source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),
  meshes, positions, triangles, bounds:{min:[-1.0,0,-21.3],max:[6.4,6.25,-16.0]}, dimensions:[32,28,24], directions:64 };
const file=resolve(out,'occluders.json'); writeFileSync(file,JSON.stringify(payload));
console.log(JSON.stringify({file,meshes,vertices:positions.length,triangles:triangles.length,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}));
