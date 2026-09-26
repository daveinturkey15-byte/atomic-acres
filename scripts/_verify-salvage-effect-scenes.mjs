/** CPU lifecycle/replication falsifiers; pixel appearance is a separate browser gate. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), 'nuketown-salvage-effect-scenes');
await mkdir(out, { recursive: true });
await build({
  stdin: { contents: `export * as THREE from 'three';
    export * from './src/weapons/weapon-effects-scene';
    export * from './src/weapons/streak-effects-scene';
    export * from './src/core/effect-materials';
    export * from './src/core/presentation-defaults';`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: join(out, 'proof.mjs'), logLevel: 'silent',
});
const api = await import(pathToFileURL(join(out, 'proof.mjs')).href);
const { THREE, createWeaponEffectsScene, createStreakEffectsScene, flarePositionAt,
  authoredPresentationSearch, SPECIAL_EFFECT_SLOTS, STREAK_SCENE_CAPACITY } = api;
const registry = new Map();
const matFor = (kind, color, a = 0, b = 0) => {
  const key = `${kind}:${color}:${a}:${b}`;
  if (!registry.has(key)) registry.set(key, new THREE.MeshBasicMaterial({ color }));
  return registry.get(key);
};
const specialEffects = api.createSpecialEffectMaterials();
const mat = { emissive: (c, s) => matFor('emissive', c, s), painted: (c, r, m) => matFor('painted', c, r, m), steel: matFor('steel', 0x999999), specialEffects };
let sharedDisposals = 0;
const weapons = createWeaponEffectsScene(mat);
const streaks = createStreakEffectsScene(mat);
for (const material of registry.values()) material.addEventListener('dispose', () => sharedDisposals++);
for (const material of [specialEffects.flame, specialEffects.core, specialEffects.smoke]) material.addEventListener('dispose', () => sharedDisposals++);
const frozenMaterialCount = registry.size;
const nodeCount = weapons.group.children.length + streaks.group.children.length;
const checks = [];
function check(name, run) { run(); checks.push(name); }
const event = (effect, id, at = 1000) => ({
  type: 'weapon-effect', effect, id, at, actorId: 'human', team: 0, weaponId: 'flamethrower',
  x: 1, y: 1.6, z: -3, dx: 0.6, dy: 0, dz: -0.8, radius: effect === 'rail' ? 120 : 3, durationMs: 1000,
});
function finiteMatrices(group) {
  for (const mesh of group.children) {
    assert(mesh.count <= mesh.instanceMatrix.count);
    assert(Array.from(mesh.instanceMatrix.array.subarray(0, mesh.count * 16)).every(Number.isFinite));
  }
}
check('all special effects have visible finite geometry, duplicate edges do not double them', () => {
  for (const [id, effect] of ['flame', 'flare-launch', 'flare-impact', 'crossbow-blast', 'rail'].entries()) {
    weapons.reset(); weapons.onEvent(event(effect, id)); weapons.onEvent(event(effect, id)); weapons.update(1050);
    assert.equal(weapons.counts().live, 1); assert(weapons.counts().instances > 0); finiteMatrices(weapons.group);
  }
});
check('soft particles face the actual camera and retain transparent MRT auxiliaries', () => {
  weapons.reset(); weapons.onEvent(event('flame', 1)); weapons.update(1050);
  const camera = new THREE.PerspectiveCamera(); camera.rotation.set(0.3, 0.8, 0);
  for (const mesh of weapons.group.children) mesh.onBeforeRender(null, null, camera);
  finiteMatrices(weapons.group);
  for (const material of [specialEffects.flame, specialEffects.core, specialEffects.smoke]) {
    assert.equal(material.transparent, true); assert.equal(material.depthWrite, false); assert(material.mrtNode);
    const data = material.map.image.data; assert.equal(data[3], 0);
    assert(data.some((value, i) => i % 4 === 3 && value > 0 && value < 255));
  }
});
check('impact retires only its own launch, including actor identity', () => {
  weapons.reset(); weapons.onEvent(event('flare-launch', 2));
  weapons.onEvent({ ...event('flare-launch', 2), actorId: 'other' });
  weapons.onEvent(event('flare-impact', 2)); weapons.update(1050);
  assert.equal(weapons.counts().live, 2);
});
check('sustained event flood stays within fixed slots, nodes and materials', () => {
  weapons.reset();
  for (let i = 0; i < 5000; i++) weapons.onEvent(event('flame', i));
  weapons.update(1050); assert.equal(weapons.counts().live, SPECIAL_EFFECT_SLOTS);
  assert.equal(registry.size, frozenMaterialCount); finiteMatrices(weapons.group);
  assert.equal(weapons.group.children.length + streaks.group.children.length, nodeCount);
  weapons.update(2001); assert.equal(weapons.counts().instances, 0);
});
check('invalid effect input never reaches transform buffers', () => {
  weapons.reset(); weapons.onEvent({ ...event('flame', 0), x: NaN }); weapons.update(1100);
  assert.equal(weapons.counts().live, 0);
});
check('flare curve matches 120 authoritative semiimplicit gravity steps', () => {
  let y = 0, v = 0;
  for (let i = 0; i < 120; i++) { v -= 9.81 / 120; y += v / 120; }
  const sample = flarePositionAt(1000, 24, 9.81);
  assert(Math.abs(sample.drop + y) < 1e-9); assert.equal(sample.travel, 24);
});
const row = (kind, instanceId) => ({ kind, instanceId, actorId: 'human', team: instanceId % 2,
  streakId: kind, x: instanceId, y: 0, z: -3, remainingMs: 1000, yaw: 0.7, aimYaw: -0.9, shots: 0, fired: 0 });
check('every spatial equipment family draws from authoritative snapshots', () => {
  for (const kind of ['sentry', 'dart', 'supply-crate', 'fallout-screen', 'strike-relay']) {
    streaks.reset(); streaks.update(1050, [row(kind, 1)], 1000);
    assert.equal(streaks.counts().shown, 1); assert(streaks.counts().instances > 0); finiteMatrices(streaks.group);
  }
});
const variants = ['yardhawk', 'piloted-drone', 'hunter-swarm', 'chopper', 'drone-swarm'];
const airRow = (variant, id, units = variant === 'hunter-swarm' ? 3 : variant === 'drone-swarm' ? 5 : 1) => ({
  ...row('aircraft', id), variant, units, health: 100, controlled: variant === 'piloted-drone',
  craft: Array.from({ length: units }, (_, n) => ({ x: id * 4 + n * 3, y: 8 + n, z: -id * 2 + n, yaw: .4 + n, pitch: .15 })),
});
check('five aircraft silhouettes use exact host craft anchors and pitch without invented formation offsets', () => {
  const matrix = new THREE.Matrix4(), actual = new THREE.Vector3();
  const silhouettes = new Set();
  for (const variant of variants) {
    const s = airRow(variant, 1);
    streaks.reset(); streaks.update(1050, [s], 1000);
    assert.equal(streaks.counts().craft, s.units); assert.equal(streaks.counts().dropped, 0);
    const armor = streaks.group.children.find(m => m.name === 'olive-equipment-casings');
    // Every airframe's first armor primitive is centred on its admitted pose.
    const firsts = variant === 'yardhawk' ? 6 : variant === 'chopper' ? 5 : 1;
    for (let n = 0; n < s.units; n++) {
      armor.getMatrixAt(n * firsts, matrix); actual.setFromMatrixPosition(matrix);
      assert(actual.distanceTo(new THREE.Vector3(s.craft[n].x, s.craft[n].y, s.craft[n].z)) < 1e-5);
    }
    silhouettes.add(JSON.stringify(streaks.group.children.map(m => Array.from(m.instanceMatrix.array.subarray(0, m.count * 16)))));
    finiteMatrices(streaks.group);
  }
  assert.equal(silhouettes.size, 5);
});
check('sixteen maximum-size aircraft rows fit every fixed batch without dropping parts or allocating resources', () => {
  for (const variant of variants) {
    const rows = Array.from({ length: 40 }, (_, i) => airRow(variant, i, 5));
    streaks.update(1100, rows, 1000); finiteMatrices(streaks.group);
    assert.equal(streaks.counts().shown, 16); assert.equal(streaks.counts().craft, 80); assert.equal(streaks.counts().dropped, 0, variant);
    assert.equal(registry.size, frozenMaterialCount);
    assert.equal(weapons.group.children.length + streaks.group.children.length, nodeCount);
  }
  assert.equal(streaks.group.children.length, 9);
  const bufferBytes = streaks.group.children.reduce((n, m) => n + m.instanceMatrix.array.byteLength + (m.instanceColor?.array.byteLength ?? 0), 0);
  assert(bufferBytes < 320 * 1024, String(bufferBytes));
});
const carpetRow = id => ({ ...row('carpet-bomber', id), elapsedMs: 500,
  impacts: Array.from({ length: 20 }, (_, n) => ({ x: id * 3 + (n % 4 - 1.5) * 2.7, y: n / 10, z: -3 + (2 - Math.floor(n / 4)) * 5 })) });
check('carpet warning rings use all actual impact elevations and retire fired points', () => {
  const s = carpetRow(1), matrix = new THREE.Matrix4(), actual = new THREE.Vector3();
  streaks.update(1050, [s], 1000);
  const field = streaks.group.children.find(m => m.name === 'red-streak-field-boundaries');
  assert.equal(field.count, 20);
  for (let n = 0; n < 20; n++) {
    field.getMatrixAt(n, matrix); actual.setFromMatrixPosition(matrix);
    assert(actual.distanceTo(new THREE.Vector3(s.impacts[n].x, s.impacts[n].y + .07, s.impacts[n].z)) < 1e-5);
  }
  streaks.update(1100, [{ ...s, fired: 7 }], 1000); assert.equal(field.count, 13);
  streaks.update(1100, Array.from({ length: 16 }, (_, i) => carpetRow(i)), 1000);
  assert.equal(streaks.counts().dropped, 0); finiteMatrices(streaks.group);
});
check('invalid craft transforms are ignored, removed craft vanish and stale aircraft expire', () => {
  const s = airRow('drone-swarm', 1);
  streaks.update(1050, [{ ...s, craft: s.craft.map(c => ({ ...c, pitch: NaN })) }], 1000);
  assert.equal(streaks.counts().craft, 0); finiteMatrices(streaks.group);
  streaks.update(1100, [s], 1000); assert.equal(streaks.counts().craft, 5);
  streaks.update(1200, [{ ...s, units: 2, craft: s.craft.slice(0, 2) }], 1000); assert.equal(streaks.counts().craft, 2);
  streaks.update(2000, [s], 1000); assert.equal(streaks.counts().instances, 0);
  streaks.update(2001, [], 2001); assert.equal(streaks.counts().craft, 0);
});
check('streak pools cap hostile overlength input and expire stale replicated state', () => {
  const rows = Array.from({ length: 64 }, (_, i) => row('sentry', i));
  streaks.update(1100, rows, 1000); assert.equal(streaks.counts().shown, STREAK_SCENE_CAPACITY);
  finiteMatrices(streaks.group);
  streaks.update(2000, rows, 1000); assert.equal(streaks.counts().instances, 0);
  streaks.update(2050, [], 2000); assert.equal(streaks.counts().instances, 0);
});
check('authored defaults retain room parameters, explicit opt-outs and original baseline', () => {
  const p = new URLSearchParams(authoredPresentationSearch('?room=private&lighting=legacy&join=ABCD'));
  assert.equal(p.get('room'), 'private'); assert.equal(p.get('lighting'), 'legacy'); assert.equal(p.get('join'), 'ABCD');
  assert.equal(p.get('hands'), 'rifle-canary'); assert.equal(p.has('operator-shape'), false);
  assert.equal(authoredPresentationSearch('?art=baseline&join=ABCD'), '?art=baseline&join=ABCD');
});
check('reset and double-dispose release owned geometries once without disposing registry materials', () => {
  const unique = new Set([...weapons.group.children, ...streaks.group.children].map((mesh) => mesh.geometry));
  let released = 0;
  for (const geometry of unique) geometry.addEventListener('dispose', () => released++);
  weapons.reset(); streaks.reset(); assert.equal(weapons.counts().instances + streaks.counts().instances, 0);
  weapons.dispose(); streaks.dispose(); weapons.dispose(); streaks.dispose();
  assert.equal(released, unique.size); assert.equal(sharedDisposals, 0);
  weapons.onEvent(event('flame', 1)); weapons.update(1050); streaks.update(1050, [row('sentry', 1)]);
  assert.equal(weapons.counts().instances + streaks.counts().instances, 0);
});
console.log(JSON.stringify({ status: 'PASS', gate: 'CPU effect lifecycle only; actual pixels OPEN', checks }, null, 2));
