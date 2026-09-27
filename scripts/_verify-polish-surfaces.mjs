/** CPU source/graph/lifecycle checks. Does not render or establish art acceptance. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { positionWorld, normalWorldGeometry, materialColor } from 'three/tsl';
import StandardNodeLibrary from 'three/src/renderers/webgpu/nodes/StandardNodeLibrary.js';
import RenderObject from 'three/src/renderers/common/RenderObject.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'captures', 'polish-surfaces-cpu-' + new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const oldSource = execFileSync('git', ['show', 'b9adb96:src/core/architectural-materials.ts'], { cwd: root });
assert.equal(hash(oldSource), '5b4a13bd68bc46c1d718a64a1c7e20164b9fa638c0669245df3272a2fb47e0ec', 'Exact Git blob');
assert.equal(hash(oldSource.toString().replace(/\r?\n/g, '\r\n')),
  '813f747be64ec5a394dd1a60375f18901e4a9fcb206a6602aedd82cdc9d0c634', 'Exact initial Windows checkout bytes');
writeFileSync(join(out, 'baseline.ts'), oldSource, { flag: 'wx' });
const options = { bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' };
await build({ ...options, stdin: { contents: oldSource.toString(), loader: 'ts', resolveDir: join(root, 'src/core') }, outfile: join(out, 'baseline.mjs') });
await build({ ...options, stdin: { contents: `export * from './architectural-materials'; export * from './surface-weathering'; export * from './room-visibility';`,
  loader: 'ts', resolveDir: join(root, 'src/core') }, outfile: join(out, 'candidate.mjs') });
const baseline = await import(pathToFileURL(join(out, 'baseline.mjs')).href);
const candidate = await import(pathToFileURL(join(out, 'candidate.mjs')).href);
const keys = ['stuccoCream', 'stuccoTerracotta', 'capsuleWhite', 'interiorWall', 'roofWhite', 'timber', 'timberDark'];
const changed = keys.slice(0, 3), protectedKeys = keys.slice(3);
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); console.log('PASS ' + name); };
const savedLocation = globalThis.location;
const fixtures = [];
function fixture() {
  const borrowed = new THREE.Texture(); let borrowedDisposals = 0, libraryDisposals = 0;
  borrowed.addEventListener('dispose', () => ++borrowedDisposals);
  const lib = Object.fromEntries(keys.map(key => [key, new THREE.MeshStandardMaterial({
    color: key === 'interiorWall' ? 0x8f8a7a : 0xffffff, map: borrowed, roughnessMap: borrowed, normalMap: borrowed,
  })]));
  lib.interior = () => ({});
  lib.dispose = () => { ++libraryDisposals; borrowed.dispose(); };
  const names = candidate.ARCHITECTURE_TEXTURE_FILES;
  const maps = names.map((name, i) => {
    const map = new THREE.DataTexture(new Uint8Array(4), 1024, i < 2 ? 1024 : 256);
    map.name = name; return map;
  });
  const disposals = maps.map(() => 0); maps.forEach((t, i) => t.addEventListener('dispose', () => ++disposals[i]));
  let calls = 0;
  const f = { lib, borrowed, maps, disposals, originalDispose: lib.dispose, calls: () => calls,
    counts: () => ({ borrowedDisposals, libraryDisposals }),
    load: async url => { ++calls; return maps[names.indexOf(url.split('/').at(-1))]; } };
  fixtures.push(f); return f;
}
const canonical = node => {
  const ids = new Map();
  return JSON.stringify(node.toJSON()).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    id => { if (!ids.has(id)) ids.set(id, `uuid${ids.size}`); return ids.get(id); });
};
// Evaluate the ACTUAL authored TSL arithmetic graph, not a mirrored dust formula.
// Texture samples are controlled RGBA inputs; this proves bounds, not GPU filtering.
const zip = (a, b, fn) => Array.isArray(a) || Array.isArray(b)
  ? Array.from({ length: Math.max(a.length ?? 1, b.length ?? 1) }, (_, i) => fn(Array.isArray(a) ? a[i] : a, Array.isArray(b) ? b[i] : b)) : fn(a, b);
function evaluate(node, p, n, scan = [.5, .5, 0, 1]) {
  const visit = v => {
    if (v === positionWorld) return p;
    if (v === normalWorldGeometry) return n;
    if (v === materialColor) return [1, 1, 1, 1];
    if (v.isConstNode) return v.value?.toArray ? v.value.toArray() : v.value;
    if (v.isTextureNode) return scan;
    if (v.isVarNode || v.isConvertNode) return visit(v.node);
    if (v.isSplitNode) { const a = visit(v.node), values = [...v.components].map(c => a['xyzw'.indexOf(c)]); return values.length === 1 ? values[0] : values; }
    if (v.isJoinNode) return v.nodes.flatMap(visit);
    if (v.isOperatorNode) {
      const op = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b }[v.op];
      assert(op, 'Unsupported operator ' + v.op); return zip(visit(v.aNode), visit(v.bNode), op);
    }
    if (v.isMathNode) {
      const a = visit(v.aNode), b = v.bNode ? visit(v.bNode) : undefined, c = v.cNode ? visit(v.cNode) : undefined;
      if (v.method === 'abs') return zip(a, 0, x => Math.abs(x));
      if (v.method === 'sin') return zip(a, 0, x => Math.sin(x));
      if (v.method === 'pow') return zip(a, b, Math.pow);
      if (v.method === 'max') return zip(a, b, Math.max);
      if (v.method === 'dot') return a.reduce((sum, x, i) => sum + x * b[i], 0);
      if (v.method === 'clamp') return zip(zip(a, b, Math.max), c, Math.min);
      if (v.method === 'smoothstep') { const t = Math.max(0, Math.min(1, (c - a) / (b - a))); return t * t * (3 - 2 * t); }
      throw Error('Unsupported math ' + v.method);
    }
    throw Error('Unsupported actual TSL node ' + v.constructor.name);
  };
  return visit(node);
}

try {
  check('explicit opt-in and protected profile exclusions', () => {
    for (const q of ['', '?surface-finish=off', '?surface-finish=CANARY', '?surface-finish=true']) assert.equal(candidate.isSurfaceFinishEnabled(q), false);
    assert(candidate.isSurfaceFinishEnabled('?surface-finish=canary'));
    for (const key of protectedKeys) assert.equal(candidate.surfaceFinishProfile(key), null);
    assert.equal(candidate.surfaceFinishProfile('__proto__'), null);
  });
  globalThis.location = { search: '?architecture=canary&room=authored&room-light=baked' };
  const old = fixture(), plain = fixture(), canary = fixture();
  const oldCtl = await baseline.installArchitecturalMaterials(old.lib, true, old.load);
  const plainCtl = await candidate.installArchitecturalMaterials(plain.lib, true, plain.load);
  globalThis.location.search += '&surface-finish=canary';
  const identities = keys.map(k => canary.lib[k]), originalColors = identities.map(m => m.color.clone());
  const canaryTask = candidate.installArchitecturalMaterials(canary.lib, true, canary.load);
  const ctl = await canaryTask;
  check('default graph equals frozen b9adb96; only three opted-in profiles differ', () => {
    assert.equal(plainCtl.surfaceFinish, 'baseline'); assert.equal(ctl.surfaceFinish, 'canary');
    for (const k of keys) for (const hook of ['colorNode', 'roughnessNode', 'normalNode']) {
      assert.equal(canonical(old.lib[k][hook]), canonical(plain.lib[k][hook]), `default drift ${k}.${hook}`);
      if (protectedKeys.includes(k)) assert.equal(canonical(old.lib[k][hook]), canonical(canary.lib[k][hook]), `protected drift ${k}.${hook}`);
      else assert.notEqual(canonical(old.lib[k][hook]), canonical(canary.lib[k][hook]), `canary absent ${k}.${hook}`);
    }
    for (const k of keys) assert(canary.lib[k].color.equals(old.lib[k].color), 'palette tint unchanged');
  });
  check('dust follows .151m grade, exterior normals and bounded house plans', () => {
    for (const side of [-1, 1]) {
      const dust = candidate.surfaceDustNode(side), front = side * 15.4, n = [0, 0, -side];
      assert.equal(evaluate(dust, [0, .151, front], n), 1);
      assert.equal(evaluate(dust, [0, .301, front], n), 0, 'no film above150mm');
      assert.equal(evaluate(dust, [0, .120, front], n), 0, 'no subterranean band');
      assert.equal(evaluate(dust, [0, .18, front], n.map(x => -x)), 0, 'inner wall face stays clean');
      for (const yNormal of [-1, 1]) assert.equal(evaluate(dust, [0, .18, front], [0, yNormal, 0]), 0, 'horizontal faces stay clean');
      assert.equal(evaluate(dust, [8, .18, front], n), 0, 'no garage extension dust');
      assert.equal(evaluate(dust, [0, .18, -front], n), 0, 'wrong house excluded');
      let previous = 1;
      for (let y = .176; y <= .31; y += .002) { const v = evaluate(dust, [0, y, front], n); assert(v <= previous + 1e-12 && v >= 0); previous = v; }
    }
  });
  check('actual roughness graphs stay bounded and retain three distinct finish ranges', () => {
    for (const key of changed) {
      const profile = candidate.surfaceFinishProfile(key);
      for (let x = -7; x <= 7; x += .7) for (const y of [.12, .151, .19, .25, .301, 1, 6]) for (const g of [0, .5, 1]) {
        const rough = evaluate(canary.lib[key].roughnessNode, [x, y, profile.side * 15.4], [0, 0, -profile.side], [.5, g, 0, 1]);
        assert(Number.isFinite(rough) && rough >= profile.roughMin - .012 - 1e-9 && rough <= profile.roughMax + .012 + profile.dustRoughness + 1e-9);
      }
    }
    assert(candidate.surfaceFinishProfile('capsuleWhite').roughMax + .012 < candidate.surfaceFinishProfile('stuccoCream').roughMin + .012);
    assert(candidate.surfaceFinishProfile('stuccoCream').roughMax + .012 < candidate.surfaceFinishProfile('stuccoTerracotta').roughMin - .012);
  });
  check('r180 adaptation, shader identity and unchanged resource budget', () => {
    const adapter = new StandardNodeLibrary(), geometry = new THREE.BoxGeometry();
    const keyFor = material => RenderObject.prototype.getMaterialCacheKey.call({ material,
      renderer: { backend: { isWebGPUBackend: true } }, object: { geometry, receiveShadow: true }, geometry,
      clippingContextCacheKey: '', getGeometryCacheKey: RenderObject.prototype.getGeometryCacheKey });
    assert.equal(new Set(identities.map(keyFor)).size, 7);
    for (const key of keys) {
      const m = canary.lib[key], adapted = adapter.fromMaterial(m);
      for (const hook of ['colorNode', 'roughnessNode', 'normalNode']) assert.equal(adapted[hook], m[hook]);
      assert.equal(m.customProgramCacheKey().includes('/surface-finish-v1'), changed.includes(key));
    }
    geometry.dispose();
    assert.deepEqual(keys.map(k => canary.lib[k]), identities);
    assert.equal(ctl.materialCount, 7); assert.equal(ctl.textures.length, 4); assert.equal(ctl.runtimeBytes, oldCtl.runtimeBytes);
    assert.equal(ctl.runtimeBytes, 13981014); assert.equal(canary.calls(), 4);
    const graph = canary.lib.stuccoCream.roughnessNode;
    for (let i = 0; i < 10000; i++) assert.equal(candidate.installArchitecturalMaterials(canary.lib, true, canary.load), canaryTask);
    assert.equal(canary.lib.stuccoCream.roughnessNode, graph); assert.equal(canary.calls(), 4);
  });
  const loadRoom = async url => { const bytes = readFileSync(join(root, 'public', url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };
  const roomBaseline = await candidate.installRoomVisibility(plain.lib, true, loadRoom);
  const roomCanary = await candidate.installRoomVisibility(canary.lib, true, loadRoom);
  check('actual baked-room data and AO graph survive surface finish unchanged', () => {
    assert(roomBaseline && roomCanary); assert.equal(roomBaseline.bytes, roomCanary.bytes);
    for (const key of keys) {
      assert.equal(canonical(plain.lib[key].aoNode), canonical(canary.lib[key].aoNode));
      assert(canary.lib[key].customProgramCacheKey().includes('|room-bvh-v1/'));
    }
  });
  canary.lib.dispose(); ctl.dispose();
  check('composed room/library teardown restores ownership and all borrowed maps', () => {
    assert.deepEqual(canary.disposals, [1, 1, 1, 1]);
    assert.deepEqual(canary.counts(), { borrowedDisposals: 1, libraryDisposals: 1 });
    assert.equal(canary.lib.dispose, canary.originalDispose);
    identities.forEach((m, i) => { assert(m.color.equals(originalColors[i])); assert.equal(m.map, canary.borrowed); for (const hook of ['colorNode', 'roughnessNode', 'normalNode', 'aoNode']) assert.equal(Object.hasOwn(m, hook), false); });
  });
  const failed = fixture(); const originalWarn = console.warn;
  console.warn = () => {};
  try { assert.equal(await candidate.installArchitecturalMaterials(failed.lib, true, url => url.endsWith('timber-surface.png') ? Promise.reject(Error('fixture')) : failed.load(url)), null); }
  finally { console.warn = originalWarn; }
  check('partial texture failure leaves original materials and releases partial ownership', () => {
    assert.deepEqual(failed.disposals, [1, 1, 0, 1]);
    for (const key of keys) { assert.equal(failed.lib[key].map, failed.borrowed); assert.equal(Object.hasOwn(failed.lib[key], 'colorNode'), false); }
    assert.equal(failed.lib.dispose, failed.originalDispose);
  });
  plain.lib.dispose(); old.lib.dispose();
  const paths = ['src/core/architectural-materials.ts', 'src/core/surface-weathering.ts', 'src/core/room-visibility.ts', 'scripts/_verify-polish-surfaces.mjs'];
  writeFileSync(join(out, 'report.json'), JSON.stringify({ status: 'PASS', checks,
    baseline: 'b9adb96', baselineArchitectureSha256: hash(oldSource), threeVersion: THREE.REVISION,
    sourceHashes: Object.fromEntries(paths.map(p => [p, hash(readFileSync(join(root, p)))])),
    materials: 7, textures: 4, runtimeTextureBytes: ctl.runtimeBytes,
    geometryDrawLightDelta: 0, claim: 'CPU graph/arithmetic/ownership only; actual GPU compilation, pixels and frame cost OPEN' }, null, 2) + '\n');
  console.log(`PASS ${checks.length} polish surface CPU groups; receipt ${join(out, 'report.json')}`);
} finally {
  if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
}
