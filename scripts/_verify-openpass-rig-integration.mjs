/** Independent actual-controller integration proof. No renderer/browser/GLB
 * network, gameplay-authority replacement, art approval or existing-test edits. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..'), temp = mkdtempSync(join(tmpdir(), 'aa-openpass-rig-integration-'));
const outfile = join(temp, 'actual.mjs');
await build({ stdin: { loader: 'ts', resolveDir: root, contents: `
export * as THREE from 'three';
export { WeaponsController } from './src/weapons/controller';
export { OPENPASS_SOCKET_NAMES } from './src/weapons/openpass-weapon-rigs';
export { ROSTER_HERO_WEAPON_IDS } from './src/weapons/roster-heroes-loader';
` }, outfile, platform: 'node', format: 'esm', bundle: true, logLevel: 'silent', plugins: [{
  name: 'no-unrelated-asset-network', setup(builder) {
    builder.onLoad({ filter: /reference-weapon-models\.ts$/ }, () => ({ loader: 'ts', contents:
      `export const REFERENCE_WEAPON_IDS=[];export const REFERENCE_SOCKETS=[];export async function loadReferenceWeaponRig(){throw Error('CPU only');}` }));
  },
}] });
const { THREE, WeaponsController, OPENPASS_SOCKET_NAMES, ROSTER_HERO_WEAPON_IDS } = await import(pathToFileURL(outfile).href);
const move = { speed: 0, sprinting: false, grounded: true }, checks = [];
function pass(name) { checks.push(name); console.log('PASS ' + name); }
function factory(options = {}, query = '') {
  const oldWindow = globalThis.window;
  globalThis.window = { location: { search: query, href: 'http://cpu.invalid/' } };
  const materials = new Map();
  const getMaterial = name => { if (!materials.has(name)) materials.set(name, new THREE.MeshStandardMaterial({ name })); return materials.get(name); };
  const material = getMaterial('fixture-hero');
  const mat = new Proxy({ painted: (...args) => getMaterial('painted/' + args.join('/')), emissive: (...args) => getMaterial('emissive/' + args.join('/')),
    viewmodel: Object.fromEntries(['sleeve', 'darkGlove', 'gloveDetail', 'woodFurniture', 'parkerizedSteel'].map(name => [name, getMaterial(name)])) },
    { get: (o, p) => o[p] ?? getMaterial(String(p)) });
  const camera = new THREE.PerspectiveCamera(72, 16 / 9), scene = new THREE.Scene();
  const ctl = new WeaponsController({ camera, scene, mat, targets: [], onHud() {}, carbineCanary: false,
    heroesCanary: false, localLoadout: () => ({ primary: 'lmg', sidearm: 'duster', grenade: 'flash' }), ...options });
  if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  return { ctl, camera, material, materials, scene, close() { ctl.dispose(); for (const m of materials.values()) m.dispose(); } };
}
function meshHash(group) {
  const hash = createHash('sha256'); group.updateMatrixWorld(true);
  group.traverse(node => { if (!node.isMesh) return;
    hash.update(JSON.stringify([node.name, ...node.matrixWorld.elements]));
    for (const a of Object.values(node.geometry.attributes)) hash.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    if (node.geometry.index) hash.update(Buffer.from(node.geometry.index.array.buffer));
  }); return hash.digest('hex');
}
function activeRig(ctl) {
  // Rig groups precede lights/offhand and have the actual hand root. Read scene
  // graph identity rather than trusting the diagnostic adoption flag alone.
  const result = ctl.overlay.children.filter(n => n.visible && n.isGroup && n.getObjectByName('FirstPersonHands'));
  assert.equal(result.length, 1, 'exactly one gun/hands graph visible'); return result[0];
}
function select(f, id) { assert.equal(f.ctl.command('switch', id), true); f.ctl.update(0, 1, move); return activeRig(f.ctl); }

const baseline = factory(), explicitOff = factory({ lmgModelCanary: false }, '?lmg-model=canary');
try {
  assert.deepEqual(baseline.ctl.snapshot().lmgModelCanary, { requested: false, adopted: false, stats: null, sockets: [] });
  assert.equal(explicitOff.ctl.snapshot().lmgModelCanary.requested, false);
  assert(!baseline.ctl.overlay.getObjectByName('Viewmodel/OpenpassLMG'));
  assert.equal(meshHash(baseline.ctl.overlay), meshHash(explicitOff.ctl.overlay), 'explicit disable preserves exact default geometry');
  const rifle = select(baseline, 'm4a1'), lmg = select(baseline, 'lmg');
  assert.equal(lmg, rifle, 'default LMG still uses shared accepted fallback');
  assert.deepEqual(baseline.ctl.snapshot().mag, 75);
} finally { baseline.close(); explicitOff.close(); }
pass('default and explicit-disable preserve fallback graph, ordinary ammo and shared-rig switching');

for (const motion of [false, true]) {
  const f = factory({}, '?lmg-model=canary' + (motion ? '&motion=canary' : ''));
  try {
    const initial = f.ctl.snapshot().lmgModelCanary;
    assert(initial.requested && initial.adopted); assert.equal(initial.stats.meshes, 18);
    assert.deepEqual(initial.sockets, [...OPENPASS_SOCKET_NAMES]);
    const rifle = select(f, 'm4a1'), lmg = select(f, 'lmg'); assert.notEqual(lmg, rifle);
    assert.equal(lmg.name, 'Viewmodel/OpenpassLMG'); assert.equal(lmg.userData.artStatus, 'unreviewed-canary');
    assert.equal(f.ctl.snapshot().mag, 75); assert.equal(f.ctl.snapshot().motionCanary, motion);
    for (let i = 0; i < 5; i++) { assert.equal(select(f, 'm4a1'), rifle); assert.equal(select(f, 'lmg'), lmg); }
    f.ctl.setVisible(false); assert(!f.ctl.overlay.visible); f.ctl.setVisible(true); assert.equal(activeRig(f.ctl), lmg);
    const beforeAmmo = { mag: f.ctl.snapshot().mag, reserve: f.ctl.snapshot().reserve };
    f.ctl.command('ads', true);
    for (let i = 0; i < 100; i++) f.ctl.update(.05, 2 + i * .05, move);
    f.ctl.overlay.updateMatrixWorld(true); f.camera.updateMatrixWorld(true);
    const gun = lmg.getObjectByName('WeaponGeometry'), rear = lmg.getObjectByName('rear-sight-socket'), front = lmg.getObjectByName('front-sight-socket');
    for (const anchor of [rear, front]) {
      const point = anchor.getWorldPosition(new THREE.Vector3()).applyMatrix4(f.camera.matrixWorldInverse);
      assert(Math.abs(point.x) < .001 && Math.abs(point.y) < .001, 'actual mounted ADS anchors align within1mm including idle sway');
    }
    for (const x of [0, -.006, .006]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 0, 0), new THREE.Vector3(0, 0, -1), 0, 2);
      assert.equal(ray.intersectObject(gun, true).length, 0, 'actual mounted gun clears center/margin ADS rays');
    }
    assert.deepEqual({ mag: f.ctl.snapshot().mag, reserve: f.ctl.snapshot().reserve }, beforeAmmo, 'presentation never grants or spends rounds');
    f.ctl.command('ads', false); assert.equal(f.ctl.command('fire'), true); assert.equal(f.ctl.command('reload'), true);
    const pouch = lmg.getObjectByName('AmmoPouchReload'); let moved = false;
    for (let i = 0; i < 90 && f.ctl.snapshot().reloading; i++) { f.ctl.update(.05, 8 + i * .05, move); if (pouch.position.y < -.14) moved = true; }
    assert(moved, 'actual controller drives authored pouch/hand reload path');
    assert.equal(select(f, 'm4a1'), rifle); assert.equal(pouch.position.y, -.135, 'switch cancels/reset LMG reload graph');
    assert.equal(select(f, 'lmg'), lmg); assert.equal(pouch.position.y, -.135);
    const geometries = new Set(); f.ctl.overlay.traverse(n => { if (n.isMesh) geometries.add(n.geometry); });
    const disposed = new Map([...geometries].map(g => [g, 0]));
    for (const g of geometries) g.addEventListener('dispose', () => disposed.set(g, disposed.get(g) + 1));
    let disposedMaterial = 0; for (const m of f.materials.values()) m.addEventListener('dispose', () => disposedMaterial++);
    f.ctl.dispose(); f.ctl.dispose(); assert.equal(lmg.parent, null);
    const unresolved = [];
    f.ctl.overlay.traverse(n => { if (n.isMesh && disposed.get(n.geometry) !== 1) {
      const chain = []; for (let parent = n; parent && parent !== f.ctl.overlay; parent = parent.parent) chain.unshift(parent.name || parent.type);
      unresolved.push({ path: chain.join('/'), disposals: disposed.get(n.geometry) });
    } });
    if (unresolved.length) console.log(JSON.stringify({ disposalFailure: unresolved }, null, 2));
    assert([...disposed.values()].every(n => n === 1), 'canary plus every shared family geometry disposed exactly once');
    assert.equal(disposedMaterial, 0, 'shared material survives controller disposal');
  } finally { f.close(); }
  pass(`query opt-in ${motion ? 'motion' : 'ordinary'}: actual rig visibility, ADS, reload, fixed ammo and exactly-once disposal`);
}

const pending = new Map(), rigs = [];
const heroes = factory({ heroesCanary: true, lmgModelCanary: true,
  heroesLoader: (id) => new Promise(resolve => pending.set(id, resolve)) });
try {
  assert.deepEqual([...pending.keys()], [...ROSTER_HERO_WEAPON_IDS]);
  assert.equal(heroes.ctl.snapshot().lmgModelCanary.requested, true);
  assert.equal(heroes.ctl.snapshot().lmgModelCanary.adopted, false, 'requested LMG source rig yields to legacy hero experiment');
  assert(!heroes.ctl.overlay.getObjectByName('Viewmodel/OpenpassLMG'));
  const fallback = select(heroes, 'lmg');
  for (const [id, resolve] of pending) {
    const group = new THREE.Group(); group.name = 'Hero/' + id;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.01, .01, .01), heroes.material); mesh.name = 'FirstPersonHands'; group.add(mesh);
    const muzzle = new THREE.Object3D(), eject = new THREE.Object3D(); group.add(muzzle, eject);
    const rig = { group, muzzle, eject, isGLTFAsset: true, assetUrl: 'cpu-fixture/' + id, disposals: 0,
      dispose() { this.disposals++; mesh.geometry.dispose(); group.removeFromParent(); } }; rigs.push(rig); resolve(rig);
  }
  await Promise.resolve(); await Promise.resolve();
  assert.equal(heroes.ctl.snapshot().lmgModelCanary.adopted, false);
  assert.equal(activeRig(heroes.ctl).name, 'Hero/lmg'); assert(!fallback.visible);
  assert.equal(select(heroes, 'm4a1'), fallback, 'async hero swap preserves sibling fallback');
  assert.equal(select(heroes, 'lmg').name, 'Hero/lmg');
  heroes.ctl.dispose(); heroes.ctl.dispose(); assert(rigs.every(r => r.disposals === 1));
} finally { heroes.close(); }
pass('legacy heroes precedence preserves pending fallback, async adoption, sibling visibility and disposal');

const source = ['src/weapons/controller.ts', 'src/weapons/openpass-weapon-rigs.ts'];
const hash = path => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const report = { status: 'PASS_CPU_ONLY', checks,
  scope: 'Actual controller + actual LMG builder; imported reference networking excluded and hero loading uses a deferred port fixture. GPU/pixels/owner art acceptance OPEN.',
  source: source.map(path => ({ path, sha256: hash(path) })), helperSha256: hash('scripts/_verify-openpass-rig-integration.mjs') };
const reportPath = process.argv[2] ? resolve(root, process.argv[2]) : join(temp, 'report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
