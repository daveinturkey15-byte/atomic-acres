/** CPU-only falsifiers using actual r180 NodeMaterial and Renderer.renderObject.
 * The final backend draw is captured, not rendered. GPU/fidelity remains separate. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = await mkdtemp(join(tmpdir(), 'nuketown-shadow-material-'));
await build({ stdin: { contents: `export * as THREE from 'three';
  export {NodeMaterial, WebGPURenderer} from 'three/webgpu';
  export {float,vec4} from 'three/tsl'; export * from './src/core/shadow-material-canary';`,
  resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm',
  outfile: join(out, 'fixture.mjs'), logLevel: 'silent' });
const { THREE, NodeMaterial, WebGPURenderer, float, vec4, installShadowMaterialCanary,
  SHADOW_MATERIAL_VARIANT_CAP } = await import(pathToFileURL(join(out, 'fixture.mjs')).href);
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
function base() {
  const m = new NodeMaterial(); m.isShadowPassMaterial = true; m.name = 'ShadowMaterial';
  m.colorNode = vec4(0, 0, 0, 1); m.fog = false; return m;
}
function setup(search = '?shadow-material=canary') {
  const records = [], scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const geometry = new THREE.BoxGeometry(), shadow = base(); scene.overrideMaterial = shadow;
  const renderer = { backend: { isWebGPUBackend: true }, renderObject: WebGPURenderer.prototype.renderObject,
    _handleObjectFunction(object, material, sceneArg, cameraArg, lights, group, clipping, pass) {
      records.push({ object, material, scene: sceneArg, camera: cameraArg, lights, group, clipping, pass,
        values: { alphaTest: material.alphaTest, alphaMap: material.alphaMap, side: material.side,
          transparent: material.transparent, alphaHash: material.alphaHash, depthNode: material.depthNode,
          colorNode: material.colorNode, mrtNode: material.mrtNode, fog: material.fog, depthWrite: material.depthWrite } });
    } };
  const original = renderer.renderObject, handle = installShadowMaterialCanary(renderer, search);
  const lights = {}, clipping = {}, group = { start: 0, count: 36, materialIndex: 0 };
  function draw(material, object = new THREE.Mesh(geometry, material)) {
    const args = [object, scene, camera, geometry, material, group, lights, clipping, 'test-pass'];
    renderer.renderObject(...args); return records.at(-1);
  }
  function dispose() { handle.dispose(); geometry.dispose(); shadow.dispose(); }
  return { renderer, original, handle, records, scene, camera, geometry, shadow, lights, clipping, group, draw, dispose };
}
function leaf(threshold = .42) { const m = new NodeMaterial(); m.alphaTest = threshold; return m; }

check('default is untouched and WebGL/non-shadow paths stay native', () => {
  const off = setup(''); assert.equal(off.handle.installed, false); assert.equal(off.renderer.renderObject, off.original); off.dispose();
  const f = setup(); f.renderer.backend.isWebGPUBackend = false;
  assert.equal(f.draw(leaf()).material, f.shadow); assert.equal(f.handle.counts().variants, 0);
  f.renderer.backend.isWebGPUBackend = true; f.scene.overrideMaterial = null;
  const m = leaf(); assert.equal(f.draw(m).material, m); f.dispose();
});
check('actual r180 renderer output agrees across alpha values/maps/sides and preserves forwarding', () => {
  const on = setup(), off = setup(''), texture = new THREE.Texture();
  // Share immutable shader references so identity comparisons are meaningful.
  off.shadow.colorNode = on.shadow.colorNode;
  const object = new THREE.Mesh(on.geometry), m = leaf();
  for (const threshold of [.42, .83, 0, .11]) for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
    m.alphaTest = threshold; m.alphaMap = threshold === .83 ? texture : null; m.side = side;
    m.shadowSide = threshold === .11 ? THREE.BackSide : null;
    const a = on.draw(m, object), b = off.draw(m, object);
    assert.deepEqual(a.values, b.values); assert.equal(on.scene.overrideMaterial, on.shadow);
    assert.equal(a.object, object); assert.equal(a.scene, on.scene); assert.equal(a.camera, on.camera);
    assert.equal(a.lights, on.lights); assert.equal(a.group, on.group); assert.equal(a.clipping, on.clipping); assert.equal(a.pass, 'test-pass');
  }
  assert.equal(on.handle.counts().variants, 1); texture.dispose(); on.dispose(); off.dispose();
});
check('opaque/cutout interleave removes shared-version churn after warm-up without dropping draws', () => {
  const on = setup(), off = setup(''), materials = [new NodeMaterial(), leaf()];
  const objects = Array.from({ length: 100 }, (_, i) => new THREE.Mesh(on.geometry, materials[i < 80 ? 0 : 1]));
  const previous = [new Map(), new Map()], mismatches = [0, 0];
  for (let frame = 0; frame < 6; frame++) for (const [j, fixture] of [on, off].entries()) {
    for (const object of objects) {
      const r = fixture.draw(object.material, object), key = object.id, state = [r.material, r.material.version];
      const old = previous[j].get(key);
      if (frame > 0 && (old[0] !== state[0] || old[1] !== state[1])) mismatches[j]++;
      previous[j].set(key, state);
    }
  }
  assert.deepEqual(mismatches, [0, 500]); assert.equal(on.records.length, off.records.length);
  assert.equal(on.handle.counts().variants, 1); on.dispose(); off.dispose();
});
check('custom object callbacks retain shared override identity, execute once and may mutate alphaTest', () => {
  for (const hook of ['onBeforeRender', 'onAfterRender']) {
    const f = setup(), m = leaf(), object = new THREE.Mesh(f.geometry, m); let calls = 0;
    object[hook] = (renderer, scene, camera, geometry, material) => {
      calls++; assert.equal(scene.overrideMaterial, f.shadow);
      assert.equal(material, hook === 'onBeforeRender' ? m : f.shadow);
      if (hook === 'onBeforeRender') m.alphaTest = .73;
    };
    const r = f.draw(m, object); assert.equal(r.material, f.shadow); assert.equal(calls, 1);
    assert.equal(f.handle.counts().variants, 0); f.dispose();
  }
});
check('native shadow callbacks still observe original override before and after the delegated draw', () => {
  const f = setup(), m = leaf(), object = new THREE.Mesh(f.geometry, m); const seen = [];
  object.onBeforeShadow = (...args) => seen.push(args[5]); object.onAfterShadow = (...args) => seen.push(args[5]);
  // Exact callback order/arguments used by r180 ShadowNode's native wrapper.
  const args = [f.renderer, object, f.camera, f.camera, f.geometry, f.scene.overrideMaterial, f.group];
  object.onBeforeShadow(...args); f.draw(m, object); object.onAfterShadow(...args);
  assert.deepEqual(seen, [f.shadow, f.shadow]); assert.notEqual(f.records[0].material, f.shadow); f.dispose();
});
check('transparent/alphaHash/coverage/clipped/custom-depth casters conservatively use original path', () => {
  const mutations = [m => { m.transparent = true; m.side = THREE.DoubleSide; },
    m => { m.alphaHash = true; }, m => { m.alphaToCoverage = true; },
    m => { m.clippingPlanes = [new THREE.Plane()]; }, m => { m.depthNode = float(.5); },
    m => { m.positionNode = float(1); }, m => { m.castShadowNode = vec4(1); },
    m => { m.castShadowPositionNode = float(1); }, m => { m.transmission = .5; }];
  for (const change of mutations) {
    const f = setup(), m = leaf(); change(m); f.draw(m);
    assert(f.records.every(r => r.material === f.shadow)); assert.equal(f.handle.counts().variants, 0); f.dispose();
  }
});
check('distinct lights own one variant each; base shader/depth/MRT changes propagate', () => {
  const f = setup(), m = leaf(), second = base();
  const firstVariant = f.draw(m).material; f.scene.overrideMaterial = second;
  const secondVariant = f.draw(m).material; assert.notEqual(firstVariant, secondVariant);
  second.depthNode = float(.4); second.mrtNode = vec4(1); second.depthWrite = false;
  const changed = f.draw(m); assert.equal(changed.values.depthNode, second.depthNode);
  assert.equal(changed.values.mrtNode, second.mrtNode); assert.equal(changed.values.depthWrite, false);
  assert.equal(changed.values.fog, false); assert.equal(f.handle.counts().variants, 2);
  second.dispose(); assert.equal(f.handle.counts().variants, 1); f.dispose();
});
check('variant cap delegates remaining lights and owns no source textures/materials', () => {
  const f = setup(), m = leaf(), extra = []; let sourceDisposals = 0, textureDisposals = 0;
  m.addEventListener('dispose', () => sourceDisposals++); const texture = new THREE.Texture();
  texture.addEventListener('dispose', () => textureDisposals++); m.alphaMap = texture;
  for (let i = 0; i < SHADOW_MATERIAL_VARIANT_CAP + 1; i++) {
    const shadow = base(); extra.push(shadow); f.scene.overrideMaterial = shadow;
    const r = f.draw(m); if (i === SHADOW_MATERIAL_VARIANT_CAP) assert.equal(r.material, shadow);
  }
  assert.equal(f.handle.counts().variants, SHADOW_MATERIAL_VARIANT_CAP);
  assert.equal(f.handle.counts().bypassed['variant-cap'], 1);
  f.dispose(); assert.equal(sourceDisposals, 0); assert.equal(textureDisposals, 0);
  extra.forEach(x => x.dispose()); m.dispose(); texture.dispose();
});
check('thrown native draw restores shared override; disposal restores exact method and runs once', () => {
  const f = setup(), m = leaf(), r = f.draw(m); let disposed = 0;
  r.material.addEventListener('dispose', () => disposed++);
  f.renderer._handleObjectFunction = () => { throw Error('fixture draw fault'); };
  assert.throws(() => f.draw(m), /fixture draw fault/); assert.equal(f.scene.overrideMaterial, f.shadow);
  f.dispose(); f.dispose(); assert.equal(disposed, 1); assert.equal(f.renderer.renderObject, f.original);
});
check('cleanup preserves a later owner wrapper and inherited method shape', () => {
  const f = setup(), later = function () {}; f.renderer.renderObject = later;
  f.handle.dispose(); assert.equal(f.renderer.renderObject, later);
  const proto = { renderObject: WebGPURenderer.prototype.renderObject };
  const renderer = Object.assign(Object.create(proto), { backend: { isWebGPUBackend: true } });
  const h = installShadowMaterialCanary(renderer, '?shadow-material=canary');
  assert(Object.hasOwn(renderer, 'renderObject')); h.dispose(); assert(!Object.hasOwn(renderer, 'renderObject')); f.dispose();
});
console.log(JSON.stringify({ status: 'PASS', checks, count: checks.length,
  limitation: 'Actual r180 callback/material CPU flow only. GPU pixels, frame improvement and full lifecycle acceptance remain OPEN.' }, null, 2));
