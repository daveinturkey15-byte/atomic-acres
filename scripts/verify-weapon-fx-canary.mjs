/** CPU contract only. Root owns actual WebGPU compilation, frame-time and pixels. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'work/astra-motion/weapon-fx');
mkdirSync(out, { recursive: true });
const contract = JSON.parse(readFileSync(resolve(root, 'docs/astra-weapon-fx-contract.json'), 'utf8'));
const base = '5ce4d85';
for (const mode of ['current', 'legacy']) await build({
  stdin: { contents: `export * as THREE from 'three'; export { WeaponEffects } from './src/weapons/effects'; export { WeaponFxCanary } from './src/weapons/weapon-fx-canary';`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: resolve(out, `${mode}.mjs`), logLevel: 'silent',
  plugins: mode === 'legacy' ? [{ name: 'retained-effects', setup(b) { b.onLoad({ filter: /weapons[\\/]effects\.ts$/ }, () => ({ contents: execFileSync('git', ['show', `${base}:src/weapons/effects.ts`], { cwd: root, encoding: 'utf8' }), loader: 'ts', resolveDir: resolve(root, 'src/weapons') })); } }] : [],
});
const current = await import(pathToFileURL(resolve(out, 'current.mjs')).href);
const legacy = await import(pathToFileURL(resolve(out, 'legacy.mjs')).href);
const { THREE } = current;
const report = { claim: 'CPU contract only; root WebGPU/pixels/performance OPEN', base, checks: [], controls: [] };
function check(name, f) { f(); report.checks.push(name); }
function negative(name, f) { assert.throws(f); report.controls.push(name); }
function make(api, flag) {
  globalThis.window = { location: { search: flag } };
  const m = new api.THREE.MeshBasicMaterial();
  const mat = new Proxy({ emissive: () => m, painted: () => m }, { get(a, k) { return a[k] ?? m; } });
  return { fx: new api.WeaponEffects(new api.THREE.Scene(), mat), borrowed: m };
}
const p = new THREE.Vector3(0.2, 1.5, -0.5), n = new THREE.Vector3(0.3, 1, 0.2).normalize(), q = new THREE.Quaternion();
function legacyState(fx) {
  const children = fx.group.children.filter(o => o.name !== 'weapon-fx-canary').map(o => ({ visible: o.visible, p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray() }));
  const state = { children, live: fx.liveCount(), decals: fx.decalCount() };
  for (const [k, v] of Object.entries(fx)) {
    if (typeof v === 'number') state[k] = v;
    else if (Array.isArray(v) && (!v.length || typeof v[0] === 'number')) state[k] = [...v];
  }
  return state;
}
function trace(flag, grenadesOnly = false) {
  const a = make(current, flag).fx, b = make(legacy, '').fx;
  for (let f = 0; f < 480; f++) {
    for (const fx of [a, b]) {
      if (f % 23 === 0) fx.blast(p, q);
      if (!grenadesOnly && f % 7 === 0) { fx.flashAt(p, q); fx.impact(p, n, f % 2 === 0); fx.tracer(p, n, 11); fx.shell(p, n, p); }
      if (f === 31) fx.stretchLives(2);
      fx.update(f % 29 === 0 ? 0 : 1 / 60);
    }
    assert.deepEqual(legacyState(a), legacyState(b), `legacy mismatch frame ${f}, ${flag}`);
    if (grenadesOnly) assert.equal(a.canary.liveCount(), 0, 'grenade entered the new emitter');
  }
}
check('480-frame default exact legacy trace', () => trace(''));
check('480-frame unknown flag exact legacy trace', () => trace('?weapon-fx=other'));
check('480-frame grenade canary trace identical; zero new particles', () => trace('?weapon-fx=canary', true));
const { fx, borrowed } = make(current, '?weapon-fx=canary');
const helper = fx.canary;
const batches = [helper.gas, helper.dust, helper.sparks];
const meshes = helper.group.children;
const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 1.6, 0); cam.updateMatrixWorld(true);
function renderCpu() { for (const mesh of meshes) mesh.onBeforeRender(null, null, cam); }
function resources() { return batches.flatMap(b => [b.data, b.mesh, b.mesh.geometry, b.mesh.material, b.texture, b.positions, b.positions.array, b.normals, b.normals.array, b.colors, b.colors.array]); }
const initialResources = resources();
const bytes = batches.reduce((s, b) => s + b.data.byteLength + b.texture.image.data.byteLength + b.mesh.geometry.index.array.byteLength + Object.values(b.mesh.geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0), 0);
report.resources = { batches: meshes.length, particles: batches.reduce((s, b) => s + b.capacity, 0), ownedCpuTextureAndBufferBytes: bytes, conservativeCpuPlusGpuBytes: bytes * 2, triangles: meshes.reduce((s, m) => s + m.geometry.index.count / 3, 0) };
function budget(draws, size) { assert.ok(draws <= contract.budgets.additional_draw_batches_max); assert.ok(size <= contract.budgets.owned_texture_and_buffer_bytes_max); }
check('three fixed draws and conservative CPU+GPU buffer/texture memory below one MiB', () => budget(meshes.length, bytes * 2));
negative('fourth draw rejected', () => budget(4, bytes));
negative('oversized memory rejected', () => budget(3, 1048577));
check('no lights or shadows, single-pass material, depth test on/write off, RGBA vertex colors', () => {
  helper.group.traverse(o => assert.ok(!o.isLight));
  for (const m of meshes) { assert.equal(m.castShadow, false); assert.equal(m.material.forceSinglePass, true); assert.equal(m.material.depthWrite, false); assert.equal(m.material.depthTest, true); assert.equal(m.geometry.getAttribute('color').itemSize, 4); }
});
check('original masks have zero border and varied nonzero internal alpha', () => {
  for (const b of batches) {
    const { data, width, height } = b.texture.image;
    const levels = new Set();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3]; levels.add(a);
      if (!x || !y || x === width - 1 || y === height - 1) assert.equal(a, 0);
    }
    assert.ok(levels.size > 50);
  }
});
check('MRT normal attribute present, unit length and current-camera facing for every quad', () => {
  cam.rotation.set(0.7, -0.6, 0.1); cam.updateMatrixWorld(true); renderCpu();
  for (const b of batches) {
    const normals = b.mesh.geometry.getAttribute('normal');
    assert.equal(normals.count, b.positions.count);
    for (let i = 0; i < normals.count; i++) {
      const x = normals.getX(i), y = normals.getY(i), z = normals.getZ(i);
      assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6);
      assert.ok(Math.abs(x - cam.matrixWorld.elements[8]) < 1e-6);
    }
  }
});
check('one admitted flash produces six gas particles; impact uses dust/sparks and legacy decal', () => {
  fx.flashAt(p, q); assert.equal(helper.gas.liveCount(), 6);
  fx.impact(p, n, false); assert.equal(helper.dust.liveCount(), 6); assert.equal(helper.sparks.liveCount(), 5); assert.equal(fx.decalCount(), 1);
  assert.equal(fx.impactMeshes.filter(m => m.visible).length, 0);
  const sparks = helper.sparks.liveCount(); fx.impact(p, n, true); assert.equal(helper.sparks.liveCount(), sparks);
});
check('zero negative and NaN dt do not advance state', () => {
  const state = batches.map(b => Array.from(b.data));
  for (const dt of [0, -1, NaN]) fx.update(dt);
  assert.deepEqual(batches.map(b => Array.from(b.data)), state);
});
check('saturation reuses all 192 slots; 6000 calls keep resource identities and finite buffers', () => {
  for (let f = 0; f < 2000; f++) {
    fx.flashAt(p, q); fx.impact(p, n, false); fx.impact(p, n, true);
    if (f % 8 === 0) { fx.update(1 / 240); cam.rotation.y += 0.01; cam.updateMatrixWorld(true); renderCpu(); }
  }
  assert.equal(helper.liveCount(), 192);
  assert.deepEqual(resources(), initialResources);
  for (const b of batches) for (const a of [b.positions.array, b.colors.array]) assert.ok(a.every(Number.isFinite));
});
check('large dt including infinity expires all and dead buffers remain finite', () => {
  fx.update(20); assert.equal(helper.liveCount(), 0); renderCpu();
  fx.flashAt(p, q); fx.update(Infinity); renderCpu(); assert.equal(helper.liveCount(), 0);
  for (const b of batches) assert.ok(b.positions.array.every(Number.isFinite));
});
negative('unexpired positive control is caught', () => { fx.flashAt(p, q); assert.equal(helper.liveCount(), 0); });
check('analytic trajectories agree across frame partitions', () => {
  const a = new current.WeaponFxCanary(new THREE.Group()), b = new current.WeaponFxCanary(new THREE.Group());
  a.muzzle(p, q); b.muzzle(p, q); a.impact(p, n, false); b.impact(p, n, false);
  a.update(0.1); for (let i = 0; i < 10; i++) b.update(0.01);
  for (let i = 0; i < 3; i++) {
    const ma = a.group.children[i], mb = b.group.children[i];
    ma.onBeforeRender(null, null, cam); mb.onBeforeRender(null, null, cam);
    const aa = ma.geometry.getAttribute('position').array, bb = mb.geometry.getAttribute('position').array;
    for (let j = 0; j < aa.length; j++) assert.ok(Math.abs(aa[j] - bb[j]) < 1e-6);
  }
  a.dispose(); b.dispose();
});
check('surface normals zero/up/down/wall/diagonal stay finite; centers remain outside source plane', () => {
  for (const normal of [new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), n]) {
    const h = new current.WeaponFxCanary(new THREE.Group()); h.impact(p, normal, true);
    for (let f = 0; f < 40; f++) {
      h.update(1 / 60); const m = h.dust.mesh; m.onBeforeRender(null, null, cam);
      const norm = normal.lengthSq() ? normal : new THREE.Vector3(0, 1, 0), a = m.geometry.getAttribute('position');
      for (let i = 0; i < h.dust.capacity; i++) if (h.dust.data[i * 20 + 6] > 0) {
        let x = 0, y = 0, z = 0; for (let k = 0; k < 4; k++) { x += a.getX(i * 4 + k) / 4; y += a.getY(i * 4 + k) / 4; z += a.getZ(i * 4 + k) / 4; }
        assert.ok((x - p.x) * norm.x + (y - p.y) * norm.y + (z - p.z) * norm.z >= 0.0249);
      }
      assert.ok(a.array.every(Number.isFinite));
    }
    h.dispose();
  }
});
check('dispose twice releases nine owned resources once, never borrowed library material', () => {
  let disposed = 0, borrowedDisposes = 0;
  borrowed.addEventListener('dispose', () => borrowedDisposes++);
  for (const b of batches) for (const r of [b.mesh.geometry, b.mesh.material, b.texture]) r.addEventListener('dispose', () => disposed++);
  fx.dispose(); fx.dispose(); assert.equal(disposed, 9); assert.equal(borrowedDisposes, 0); assert.equal(helper.liveCount(), 0);
  helper.muzzle(p, q); helper.impact(p, n, true); helper.update(0.1); assert.equal(helper.liveCount(), 0);
  assert.equal(helper.group.parent, null);
  const rebuilt = make(current, '?weapon-fx=canary').fx;
  assert.notEqual(rebuilt.canary.gas.texture, helper.gas.texture); rebuilt.flashAt(p, q); assert.equal(rebuilt.canary.liveCount(), 6); rebuilt.dispose();
});
check('hot methods contain no object/array/new/function allocation syntax', () => {
  const source = ts.createSourceFile('fx.ts', readFileSync(resolve(root, 'src/weapons/weapon-fx-canary.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const hot = new Set(['add', 'update', 'write', 'muzzle', 'impact', 'liveCount']);
  function walk(n) {
    if (ts.isMethodDeclaration(n) && hot.has(n.name.getText(source))) {
      function audit(c) { assert.ok(!ts.isNewExpression(c) && !ts.isObjectLiteralExpression(c) && !ts.isArrayLiteralExpression(c) && !ts.isArrowFunction(c) && !ts.isFunctionExpression(c), `hot allocation at ${c.pos}`); ts.forEachChild(c, audit); }
      if (n.body) audit(n.body);
    } else ts.forEachChild(n, walk);
  }
  walk(source);
});
negative('default-state mismatch is caught', () => assert.deepEqual({ live: 1 }, { live: 0 }));
report.status = 'PASS';
writeFileSync(resolve(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
