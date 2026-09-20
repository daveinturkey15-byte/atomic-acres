#!/usr/bin/env node
/* Lifetime behaviour proof for the authored sand-operator runtime slice.
 *
 * Unlike verify-operator-runtime.mjs (contract greps + frozen-asset binary
 * checks), this harness runs the REAL module code: it transpiles
 * src/characters/*.ts in memory with the repo's own TypeScript (no build, no
 * deps added) and exercises it against real three.js objects. Proves
 * behaviour, not source text:
 *   - per-primitive material capture (identity, not modulo)
 *   - CharacterSystem.spawn hook: real figures get the authored dress,
 *     deterministic team patches, explicit procedural fallback
 *   - pose independence across actors; dispose removes only the actor's
 *     meshes while the shared cache survives
 *   - disposeAuthoredCache refuses while live, releases each source
 *     geometry/material/texture exactly once when the last actor dies
 *   - cancellation while in flight adopts nothing and disposes the result
 *   - validation failure disposes the result (no leak)
 *   - bounded timeout resolves null; a late result is swept, not adopted
 *   - rebind: the cache can be re-adopted after full release
 *
 * Plain node, CPU-only, no browser/GPU/Blender/server/build. Fails closed.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(REPO, 'src', 'characters');
const OUT = path.join(REPO, 'node_modules', '.cache', 'nt-operator-lifetime');

// ---- in-memory transpile of the characters module (erasable TS only) ----
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.ts'))) {
  const source = fs.readFileSync(path.join(SRC, file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ModuleKind.ES2022,
    },
  }).outputText;
  // Bundler-style extensionless relative imports must become explicit for node.
  const fixed = js.replace(/(from\s+')(\.[^']+?)(';)/g, (m, a, spec, c) =>
    spec.endsWith('.js') ? m : `${a}${spec}.js${c}`,
  );
  fs.writeFileSync(path.join(OUT, file.replace(/\.ts$/, '.js')), fixed);
}

const operator = await import(url.pathToFileURL(path.join(OUT, 'operator-authored.js')).href);
const { CharacterSystem } = await import(url.pathToFileURL(path.join(OUT, 'system.js')).href);
const THREE = (await import('three')).default ?? (await import('three'));

let failures = 0;
function check(id, ok, detail) {
  if (ok) {
    console.log(`ok   ${id}`);
  } else {
    failures += 1;
    console.log(`FAIL ${id}${detail ? ` -- ${detail}` : ''}`);
  }
}

// ---- fixtures: real three.js skinned primitives ----
const { BONE_NAMES, BONE_PARENTS } = await import(
  url.pathToFileURL(path.join(OUT, 'skeleton.js')).href
);

function buildStandardBones() {
  const bones = new Map(BONE_NAMES.map((name) => {
    const bone = new THREE.Bone();
    bone.name = name; // Bone() takes no name argument in three r180
    return [name, bone];
  }));
  for (const [name, parent] of Object.entries(BONE_PARENTS)) {
    if (parent) bones.get(parent).add(bones.get(name));
  }
  return BONE_NAMES.map((n) => bones.get(n));
}

/** A fake "GLB": n skinned primitives with skin attrs, 21 ordered bones. */
function makeMockGltf({ triangles = 15000, materialOrder } = {}) {
  const bones = buildStandardBones();
  const skeleton = new THREE.Skeleton(bones);
  const scene = new THREE.Group();
  const tracked = { geometries: [], materials: [], textures: [] };
  const track = (obj, kind) => {
    obj.addEventListener('dispose', () => (obj.__disposeCount = (obj.__disposeCount ?? 0) + 1));
    tracked[kind].push(obj);
    return obj;
  };
  const matA = track(new THREE.MeshStandardMaterial({ color: 0xccaa88 }), 'materials');
  const matB = track(new THREE.MeshStandardMaterial({ color: 0x334455 }), 'materials');
  matA.map = track(new THREE.Texture(), 'textures');
  matB.map = track(new THREE.Texture(), 'textures');
  const makePrim = (tris) => {
    const segs = Math.max(2, Math.ceil(Math.sqrt(tris / 2)));
    const geo = track(new THREE.PlaneGeometry(1, 2, segs, segs), 'geometries');
    const count = segs * segs * 4;
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4));
    const mesh = new THREE.SkinnedMesh(geo, matA);
    mesh.bind(skeleton, new THREE.Matrix4());
    scene.add(mesh);
    return mesh;
  };
  const first = makePrim(triangles * 0.7);
  const second = makePrim(triangles * 0.3);
  // Deliberately non-modulo assignment: primitive 0 wears matB, primitive 1
  // wears matA — identity asserts below fail if the loader redistributes.
  first.material = materialOrder ? materialOrder[0] : matB;
  second.material = materialOrder ? materialOrder[1] : matA;
  return { scene, tracked, skeleton, mats: { matA, matB } };
}

function disposeCounts(tracked) {
  const sum = (list) => list.reduce((acc, o) => acc + (o.__disposeCount ?? 0), 0);
  return {
    geometries: sum(tracked.geometries),
    materials: sum(tracked.materials),
    textures: sum(tracked.textures),
  };
}

function makeDress() {
  return {
    skin: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    cloth: new THREE.MeshBasicMaterial({ color: 0x222288 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x111111 }),
  };
}

const GATE_URL = 'https://game.local/?operator=authored';
function setGate(on) {
  if (on) globalThis.location = new URL(GATE_URL);
  else delete globalThis.location;
}

const deferred = () => {
  let resolve;
  const promise = new Promise((res) => (resolve = res));
  return { promise, resolve };
};

const scene = new THREE.Scene();
const dress = makeDress();
const system = new CharacterSystem(scene, dress);

async function scenario_gateOff_and_hook() {
  operator.__testResetOperatorState();
  setGate(false);
  check('gate.off', operator.isAuthoredOperatorEnabled() === false);
  const mock = makeMockGltf();
  operator.__testSetOperatorLoader(() => Promise.resolve(mock));
  await operator.preloadAuthoredOperator();
  // Gate off -> the hook must keep every figure procedural, byte-for-byte.
  const h = system.spawn(1, 1);
  check('gate.off.spawn-procedural', !h.root.getObjectByName('operator-authored'));
  check('gate.off.spawn-procedural-live', operator.authoredOperatorStatus().live === 0);
  system.despawn(h);

  setGate(true);
  const h1 = system.spawn(0, 0); // no faction: team patch alternates
  const h2 = system.spawn(1, 0);
  const h3 = system.spawn(2, 0, 0, 1, 1); // pinned faction 1
  check('hook.figures-authored', [h1, h2, h3].every((x) => x.root.getObjectByName('operator-authored')));
  check('hook.teams-alternate', h1.faction === 0 && h2.faction === 1);
  check('hook.teams-pinned', h3.faction === 1);
  check('hook.marker-rides-chest', h1.root.getObjectByName('operator-team-patch') !== null);
  check('hook.live-count', operator.authoredOperatorStatus().live === 3);
  check('hook.budget-primitives', operator.authoredOperatorStatus().primitives === 2);
  return { h1, h2, h3 };
}

async function scenario_pose_and_clear({ h1, h2, h3 }) {
  // Pose independence: rotate h2's chest, dispose h1, h2 must be untouched.
  let chest = null;
  h2.root.traverse((o) => { if (!chest && o.isBone && o.name === 'Chest') chest = o; });
  chest.rotation.z = 0.42;
  const h2Meshes = h2.root.getObjectByName('operator-authored');
  system.despawn(h1);
  check('pose.h2-chest-unchanged', chest.rotation.z === 0.42);
  check('pose.h2-mesh-alive', h2.root.getObjectByName('operator-authored') === h2Meshes);
  check('pose.cache-refuses-while-live', operator.disposeAuthoredCache() === false);
  system.despawn(h2);
  system.despawn(h3);
  check('pose.cache-released-when-empty', operator.disposeAuthoredCache() === true);
}

async function scenario_exact_dispose_once() {
  operator.__testResetOperatorState();
  setGate(true);
  const mock = makeMockGltf();
  operator.__testSetOperatorLoader(() => Promise.resolve(mock));
  await operator.preloadAuthoredOperator();
  const a = system.spawn(0, 0);
  const b = system.spawn(1, 0);
  // Shared sources must NOT release while any actor lives.
  system.despawn(a);
  check('once.half-alive-untouched', Object.values(disposeCounts(mock.tracked)).every((v) => v === 0));
  check('once.cache-refused-while-live', operator.disposeAuthoredCache() === false);
  system.despawn(b);
  check('once.cache-released-when-empty', operator.disposeAuthoredCache() === true);
  const counts = disposeCounts(mock.tracked);
  check('once.geometries', counts.geometries === mock.tracked.geometries.length, JSON.stringify(counts));
  check('once.materials', counts.materials === mock.tracked.materials.length, JSON.stringify(counts));
  check('once.textures', counts.textures === mock.tracked.textures.length, JSON.stringify(counts));

  // Rebind: a fresh adoption works after full release.
  const mock2 = makeMockGltf();
  operator.__testSetOperatorLoader(() => Promise.resolve(mock2));
  const shared2 = await operator.preloadAuthoredOperator();
  check('rebind.readopted', shared2 !== null && operator.authoredOperatorStatus().loaded);
  const c = system.spawn(0, 0);
  check('rebind.spawn-after-release', c.root.getObjectByName('operator-authored') !== null);
  system.despawn(c);
  operator.disposeAuthoredCache();
}

async function scenario_invalid_load_leak_fixed() {
  operator.__testResetOperatorState();
  setGate(true);
  const mock = makeMockGltf();
  // One skeleton is shared by both primitives: break the order exactly once.
  let reversed = false;
  mock.scene.traverse((o) => {
    if (!reversed && o.isSkinnedMesh && o.skeleton) { o.skeleton.bones.reverse(); reversed = true; }
  });
  operator.__testSetOperatorLoader(() => Promise.resolve(mock));
  const result = await operator.preloadAuthoredOperator();
  check('invalid.resolves-null', result === null);
  check('invalid.reason', (operator.authoredOperatorStatus().reason ?? '').startsWith('joint order'));
  check('invalid.not-loaded', operator.authoredOperatorStatus().loaded === false);
  const counts = disposeCounts(mock.tracked);
  check('invalid.disposed-not-leaked',
    counts.geometries === mock.tracked.geometries.length &&
    counts.materials === mock.tracked.materials.length &&
    counts.textures === mock.tracked.textures.length,
    JSON.stringify(counts));
  // Fallback seam stays usable.
  check('invalid.dress-falls-back', operator.dressAuthored(new THREE.Object3D(), fakeBones(), dress) === null);
}

function fakeBones() {
  const bones = buildStandardBones();
  const byName = {};
  BONE_NAMES.forEach((n, i) => { byName[n] = bones[i]; });
  return byName;
}

async function scenario_cancel_while_pending() {
  operator.__testResetOperatorState();
  setGate(true);
  const mock = makeMockGltf();
  const gate = deferred();
  operator.__testSetOperatorLoader(() => gate.promise);
  const preload = operator.preloadAuthoredOperator();
  operator.clearAuthoredOperator('test-cancel');
  gate.resolve(mock);
  const result = await preload;
  check('cancel.resolves-null', result === null);
  check('cancel.not-adopted', operator.authoredOperatorStatus().loaded === false);
  const counts = disposeCounts(mock.tracked);
  check('cancel.result-disposed-not-leaked',
    counts.geometries === mock.tracked.geometries.length &&
    counts.materials === mock.tracked.materials.length &&
    counts.textures === mock.tracked.textures.length,
    JSON.stringify(counts));
  check('cancel.reason-recorded', operator.authoredOperatorStatus().reason === 'test-cancel');
  // A fresh load after cancellation still works (generation token, not a lock).
  const mock2 = makeMockGltf();
  operator.__testSetOperatorLoader(() => Promise.resolve(mock2));
  check('cancel.reload-works', (await operator.preloadAuthoredOperator()) !== null);
}

async function scenario_timeout_orphan_swept() {
  operator.__testResetOperatorState();
  setGate(true);
  const slow = makeMockGltf();
  const gate = deferred();
  operator.__testSetOperatorLoader(() => gate.promise);
  const preload = operator.preloadAuthoredOperator('/x', 25);
  const result = await preload;
  check('timeout.resolves-null', result === null);
  check('timeout.reason', (operator.authoredOperatorStatus().reason ?? '').includes('timed out'));
  check('timeout.not-pending', operator.authoredOperatorStatus().pending === false);
  // The load finally lands AFTER the timeout: the orphan sweeper must
  // dispose it and adoption must never happen.
  gate.resolve(slow);
  await new Promise((r) => setTimeout(r, 10));
  const counts = disposeCounts(slow.tracked);
  check('timeout.orphan-swept',
    counts.geometries === slow.tracked.geometries.length &&
    counts.materials === slow.tracked.materials.length &&
    counts.textures === slow.tracked.textures.length,
    JSON.stringify(counts));
  check('timeout.never-adopted', operator.authoredOperatorStatus().loaded === false);
}

async function scenario_per_primitive_materials() {
  operator.__testResetOperatorState();
  setGate(true);
  const mock = makeMockGltf(); // prim0 -> matB, prim1 -> matA (non-modulo)
  operator.__testSetOperatorLoader(() => Promise.resolve(mock));
  await operator.preloadAuthoredOperator();
  const h = system.spawn(0, 0);
  const meshes = [];
  h.root.traverse((o) => { if (o.name === 'operator-authored') meshes.push(o); });
  check('mats.two-meshes', meshes.length === 2);
  check('mats.prim0-wears-matB', meshes[0].material === mock.mats.matB, 'modulo redistribution would fail this');
  check('mats.prim1-wears-matA', meshes[1].material === mock.mats.matA, 'modulo redistribution would fail this');
  system.despawn(h);
  operator.disposeAuthoredCache();
}

try {
  const hooked = await scenario_gateOff_and_hook();
  await scenario_pose_and_clear(hooked);
  await scenario_exact_dispose_once();
  await scenario_invalid_load_leak_fixed();
  await scenario_cancel_while_pending();
  await scenario_timeout_orphan_swept();
  await scenario_per_primitive_materials();
} catch (err) {
  failures += 1;
  console.log(`FAIL harness-crash -- ${err && err.stack ? err.stack : err}`);
} finally {
  operator.__testSetOperatorLoader(null);
  operator.__testResetOperatorState();
  setGate(false);
}

console.log(failures === 0
  ? '\nOPERATOR_LIFETIME_VERIFY PASS'
  : `\nOPERATOR_LIFETIME_VERIFY FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
