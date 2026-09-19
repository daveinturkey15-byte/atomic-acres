/**
 * CPU-only proof for src/build/facade-detail-canary.ts. No browser, no GPU, no
 * server: esbuild-bundles the canary against root node_modules (read-only use),
 * builds it twice with a material stub (core/materials.ts needs a DOM canvas, a
 * CPU run must not), and asserts the brief's contracts:
 *   - <= 12 added draws, <= 12000 added triangles, all InstancedMesh
 *   - only ctx.mat singletons (no material constructed by the builder)
 *   - colliders: none. Determinism: two builds, byte-equal matrices.
 *   - every instance inside its house's structural envelope
 *   - door aprons (front/back/garage mouths) clear below y=2.55
 *   - nothing low covers a sill (low instances top out at the plinth, 0.5)
 *   - source hygiene: no Math.random, no material construction, narrow imports
 */
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const src = path.join(root, 'src', 'build', 'facade-detail-canary.ts');
const bundle = path.join(here, '.facade-canary.bundled.cjs');

await esbuild.build({
  entryPoints: [src], outfile: bundle, bundle: true, platform: 'node',
  format: 'cjs', external: ['three'], logLevel: 'silent', target: 'es2022',
});
const require = createRequire(import.meta.url);
const { buildFacadeDetailCanary } = require(bundle);

// ---- material stub: exactly the five ctx.mat singletons the canary may use
const stub = {
  roofWhite: new THREE.MeshStandardMaterial(),
  capsuleWhite: new THREE.MeshStandardMaterial(),
  steel: new THREE.MeshStandardMaterial(),
  windowDark: new THREE.MeshStandardMaterial(),
  concrete: new THREE.MeshStandardMaterial(),
};
const ctx = { mat: stub };

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

function build() {
  const res = buildFacadeDetailCanary(ctx);
  const meshes = [];
  res.group.traverse((o) => { if (o.isInstancedMesh || o.isMesh) meshes.push(o); });
  return { res, meshes };
}
const a = build(), b = build();

check(a.res.colliders.length === 0, `colliders: ${a.res.colliders.length} (must be 0)`);
check(a.meshes.length > 0 && a.meshes.every((m) => m.isInstancedMesh),
  'every emitted object must be an InstancedMesh');
check(a.meshes.length <= 12, `draws: ${a.meshes.length} > 12`);

const allowed = new Set(Object.values(stub));
let tris = 0, instances = 0;
for (const m of a.meshes) {
  check(allowed.has(m.material), 'a mesh carries a material outside ctx.mat singletons');
  tris += m.count * m.geometry.index.count / 3;
  instances += m.count;
}
check(tris <= 12000, `triangles: ${tris} > 12000`);

// determinism: same batching, byte-equal matrices
check(a.meshes.length === b.meshes.length, 'two builds differ in draw count');
for (let i = 0; i < Math.min(a.meshes.length, b.meshes.length); i++) {
  const A = a.meshes[i].instanceMatrix.array, B = b.meshes[i].instanceMatrix.array;
  let same = A.length === B.length;
  if (same) for (let j = 0; j < A.length; j++) if (A[j] !== B[j]) { same = false; break; }
  check(same, `build 2 differs in instance matrices (mesh ${i})`);
}

// world AABB per instance (abs-rotation * local half extents)
function instBoxes(im) {
  const out = [];
  const e = im.instanceMatrix.array;
  for (let i = 0; i < im.count; i++) {
    const o = i * 16;
    // compose(): column j = R_j * dim_j, so |e[4j+row]| = |R_row,j| * dim_j and the
    // world half extent of row r is sum_j |e[o + 4j + r]| / 2
    const cx = (Math.abs(e[o]) + Math.abs(e[o + 4]) + Math.abs(e[o + 8])) / 2;
    const cy = (Math.abs(e[o + 1]) + Math.abs(e[o + 5]) + Math.abs(e[o + 9])) / 2;
    const cz = (Math.abs(e[o + 2]) + Math.abs(e[o + 6]) + Math.abs(e[o + 10])) / 2;
    out.push({
      min: [e[o + 12] - cx, e[o + 13] - cy, e[o + 14] - cz],
      max: [e[o + 12] + cx, e[o + 13] + cy, e[o + 14] + cz],
    });
  }
  return out;
}
const boxes = a.meshes.flatMap(instBoxes);

// envelopes: orange lives at z<0, white at z>0 (from layout.ts frontZ/backZ)
const ENV = {
  orange: { x: [-13.1, 8.0], y: [-0.01, 9.45], z: [-28.2, -13.85] },
  white: { x: [-13.1, 13.1], y: [-0.01, 6.9], z: [13.85, 28.2] },
};
boxes.forEach((bx, i) => {
  const side = bx.min[2] < 0 ? 'orange' : 'white';
  const env = ENV[side];
  if (bx.min[0] < env.x[0] || bx.max[0] > env.x[1]
    || bx.min[1] < env.y[0] || bx.max[1] > env.y[1]
    || bx.min[2] < env.z[0] || bx.max[2] > env.z[1]) {
    fails.push(`instance ${i} outside ${side} envelope `
      + `x[${bx.min[0].toFixed(2)},${bx.max[0].toFixed(2)}] `
      + `y[${bx.min[1].toFixed(2)},${bx.max[1].toFixed(2)}] `
      + `z[${bx.min[2].toFixed(2)},${bx.max[2].toFixed(2)}]`);
  }
});

// keep-clear aprons: nothing below y=2.55 may stand in front of a door or bay mouth
const APRONS = [
  // orange: front door, back door, two garage bay mouths
  { s: -1, x: 1.536 * 1, z: -15.4, out: 1 }, { s: -1, x: -2.048, z: -26.6, out: -1 },
  { s: -1, x: -10.933, z: -15.4, out: 1 }, { s: -1, x: -8.067, z: -15.4, out: 1 },
  // white: mirrored through the origin
  { s: 1, x: -1.024, z: 15.4, out: -1 }, { s: 1, x: 1.664, z: 26.6, out: 1 },
  { s: 1, x: 8.067, z: 15.4, out: -1 }, { s: 1, x: 10.933, z: 15.4, out: -1 },
];
for (const ap of APRONS) {
  const x0 = ap.x - 1.35, x1 = ap.x + 1.35;
  const z0 = ap.out < 0 ? ap.z + 3.2 * ap.out : ap.z;
  const z1 = ap.out < 0 ? ap.z : ap.z + 3.2 * ap.out;
  boxes.forEach((bx, i) => {
    if (bx.min[1] >= 2.55) return;                       // high dressing over a door is fine
    if (bx.max[0] > x0 && bx.min[0] < x1 && bx.max[2] > z0 && bx.min[2] < z1) {
      fails.push(`instance ${i} stands in a door/bay apron (x ${ap.x}, z ${ap.z})`);
    }
  });
}

// sills: anything low is plinth; it must top out at 0.5 (+eps), under every sill
boxes.forEach((bx, i) => {
  if (bx.min[1] < 1.0 && bx.max[1] > 0.55) {
    fails.push(`instance ${i} is low but taller than the plinth `
      + `(top ${bx.max[1].toFixed(2)}) - would cover glazing`);
  }
});

// source hygiene
const code = fs.readFileSync(src, 'utf8');
check(!/Math\.random/.test(code), 'canary uses Math.random (must be deterministic)');
check(!/new\s+THREE\.\w*Material|MeshStandardMaterial\s*\(/.test(code),
  'canary constructs a material (must only use ctx.mat)');
const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
check(imports.every((s) => ['three', '../core/layout', '../core/kit'].includes(s)),
  `unexpected imports: ${imports.join(', ')}`);

fs.rmSync(bundle, { force: true });

const summary = {
  draws: a.meshes.length, instances, triangles: tris,
  colliders: a.res.colliders.length, deterministic: fails.length === 0,
  perMesh: a.meshes.map((m) => ({ count: m.count, tris: m.count * m.geometry.index.count / 3 })),
};
console.log(JSON.stringify(summary, null, 2));
if (fails.length) {
  console.error(`FAIL (${fails.length}):`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('VERIFY-FACADE-DETAIL-CANARY: PASS');
