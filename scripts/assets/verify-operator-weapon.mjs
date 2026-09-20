#!/usr/bin/env node
/* Weapon-bind proof for the authored sand-operator hand-held gun.
 *
 * Runs the REAL module code (in-memory transpile of src/characters/*.ts with
 * the repo's own TypeScript, real three.js objects). Proves behaviour:
 *   - actor creation carries a RightHand weapon with +z forward, grip and
 *     muzzle alignment (not empty hands, not a fixed renamed gun)
 *   - real selection resolves to its family archetype (m4a1->rifle,
 *     deadeye->sniper, duster->pistol, railgun->rifle fallback); unknown->rifle
 *   - weapon swap in place, animated hand transforms move the muzzle, forward
 *     axis stays +z, disposal removes the weapon while the GLB cache lifetime
 *     is exact (refuses while live, releases when empty)
 *   - the corrected GLB's baked static hand-prop (non-skinned mesh) is
 *     rejected: never adopted, never attached, never double-guns, never
 *     counted in budgets
 *   - materials are shared caller singletons (no new programs)
 *
 * Plain node, CPU-only, no browser/GPU/Blender/server/build. Fails closed.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(REPO, 'src', 'characters');
const OUT = path.join(REPO, 'node_modules', '.cache', 'nt-operator-weapon');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.ts'))) {
  const source = fs.readFileSync(path.join(SRC, file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ModuleKind.ES2022 },
  }).outputText;
  const fixed = js.replace(/(from\s+')(\.[^']+?)(';)/g, (m, a, spec, c) =>
    spec.endsWith('.js') ? m : `${a}${spec}.js${c}`,
  );
  fs.writeFileSync(path.join(OUT, file.replace(/\.ts$/, '.js')), fixed);
}

const operator = await import(url.pathToFileURL(path.join(OUT, 'operator-authored.js')).href);
const weaponMod = await import(url.pathToFileURL(path.join(OUT, 'authored-weapon.js')).href);
const { CharacterSystem } = await import(url.pathToFileURL(path.join(OUT, 'system.js')).href);
const THREE = (await import('three')).default ?? (await import('three'));

let failures = 0;
function check(id, ok, detail) {
  if (ok) console.log(`ok   ${id}`);
  else { failures += 1; console.log(`FAIL ${id}${detail ? ` -- ${detail}` : ''}`); }
}

const { BONE_NAMES, BONE_PARENTS } = await import(
  url.pathToFileURL(path.join(OUT, 'skeleton.js')).href
);

function buildStandardBones() {
  const bones = new Map(BONE_NAMES.map((name) => {
    const bone = new THREE.Bone();
    bone.name = name;
    return [name, bone];
  }));
  for (const [name, parent] of Object.entries(BONE_PARENTS)) {
    if (parent) bones.get(parent).add(bones.get(name));
  }
  return BONE_NAMES.map((n) => bones.get(n));
}

/** Fake GLB: 2 skinned prims + optional static baked hand-prop (non-skinned). */
function makeMockGltf({ triangles = 15000, withStaticProp = false } = {}) {
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
  const makePrim = (tris, mat) => {
    const segs = Math.max(2, Math.ceil(Math.sqrt(tris / 2)));
    const geo = track(new THREE.PlaneGeometry(1, 2, segs, segs), 'geometries');
    const count = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(1), 4));
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.bind(skeleton, new THREE.Matrix4());
    scene.add(mesh);
    return mesh;
  };
  const first = makePrim(triangles * 0.7, matB);
  const second = makePrim(triangles * 0.3, matA);
  void first; void second;
  let staticMesh = null;
  if (withStaticProp) {
    // Obsolete baked hand-prop: static (non-skinned) 372-tri-class small mesh.
    const g = track(new THREE.BoxGeometry(0.05, 0.08, 0.3, 6, 6, 6), 'geometries');
    const m = track(new THREE.MeshStandardMaterial({ color: 0x222222 }), 'materials');
    staticMesh = new THREE.Mesh(g, m);
    staticMesh.name = 'baked-hand-prop';
    scene.add(staticMesh);
  }
  return { scene, tracked, skeleton, staticMesh };
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

function handOf(root) {
  let found = null;
  root.traverse((o) => { if (!found && o.isBone && o.name === 'RightHand') found = o; });
  return found;
}

const scene = new THREE.Scene();
const dress = makeDress();
const system = new CharacterSystem(scene, dress);

try {
  operator.__testResetOperatorState();
  setGate(true);

  // Static hand-prop in the source GLB must not block adoption and must never
  // reach an actor (rejected correctly, no double weapon).
  const mock = makeMockGltf({ withStaticProp: true });
  operator.__testSetOperatorLoader(() => Promise.resolve(mock));
  const shared = await operator.preloadAuthoredOperator();
  check('weapon.cache-adopted-with-static-prop', shared !== null);
  check('weapon.budget-ignores-static',
    operator.authoredOperatorStatus().primitives === 2 &&
    operator.authoredOperatorStatus().triangles >= 12000 &&
    operator.authoredOperatorStatus().triangles <= 22000);

  // Actor creation follows real selection (family archetype, not fixed gun).
  const hRifle = system.spawn(0, 0, 0, 1, 0, 'm4a1');
  const wRifle = weaponMod.authoredWeaponOf(hRifle.root);
  check('weapon.rifle-archetype', wRifle !== null && wRifle.archetype === 'rifle', wRifle?.archetype);
  check('weapon.rifle-id', wRifle !== null && wRifle.weaponId === 'm4a1');
  const hSniper = system.spawn(2, 0, 0, 1, 1, 'deadeye');
  check('weapon.sniper-archetype', weaponMod.authoredWeaponOf(hSniper.root)?.archetype === 'sniper');
  const hPistol = system.spawn(4, 0, 0, 1, 0, 'duster');
  check('weapon.pistol-archetype', weaponMod.authoredWeaponOf(hPistol.root)?.archetype === 'pistol');
  const hExotic = system.spawn(6, 0, 0, 1, 1, 'railgun');
  check('weapon.exotic-fallback-rifle', weaponMod.authoredWeaponOf(hExotic.root)?.archetype === 'rifle');
  const hUnknown = system.spawn(8, 0, 0, 1, 0, 'not-a-gun');
  check('weapon.unknown-fallback-rifle', weaponMod.authoredWeaponOf(hUnknown.root)?.archetype === 'rifle');
  const hDefault = system.spawn(10, 0);
  check('weapon.default-rifle', weaponMod.authoredWeaponOf(hDefault.root)?.archetype === 'rifle');

  // Socket, grip, forward axis, muzzle alignment on the rifle figure.
  const hand = handOf(hRifle.root);
  check('weapon.rides-righthand', hand !== null && wRifle.group.parent === hand);
  check('weapon.uses-caller-material',
    wRifle.group.children.every((c) => c.isMesh !== true || c.material === dress.dark));
  const muzzleLocal = wRifle.muzzle.position;
  check('weapon.muzzle-local',
    Math.abs(muzzleLocal.x) < 1e-6 && muzzleLocal.z > 0.4 && muzzleLocal.z < 0.5,
    muzzleLocal.toArray().join(','));
  check('weapon.forward-plus-z',
    weaponMod.AUTHORED_BARREL_LOCAL.x === 0 &&
    weaponMod.AUTHORED_BARREL_LOCAL.y === 0 &&
    weaponMod.AUTHORED_BARREL_LOCAL.z === 1);
  check('weapon.no-static-prop-adopted',
    hRifle.root.getObjectByName('baked-hand-prop') == null &&
    hRifle.root.getObjectByName('operator-weapon') != null);
  check('weapon.one-gun-only',
    hRifle.root.getObjectsByProperty('name', 'operator-weapon').length === 1);

  // Animated hand transforms move the muzzle (rides the bone, not the scene).
  hRifle.root.updateWorldMatrix(true, true);
  const before = new THREE.Vector3();
  wRifle.muzzle.getWorldPosition(before);
  hand.rotation.x = 0.5;
  hand.rotation.y = 0.3;
  hRifle.root.updateWorldMatrix(true, true);
  const after = new THREE.Vector3();
  wRifle.muzzle.getWorldPosition(after);
  check('weapon.follows-hand', before.distanceTo(after) > 0.01, `${before.distanceTo(after)}`);
  // World forward still +z of the hand frame after the pose change.
  const handQuat = new THREE.Quaternion();
  hand.getWorldQuaternion(handQuat);
  const barrelWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(handQuat);
  const toMuzzle = after.clone().sub(hand.getWorldPosition(new THREE.Vector3())).normalize();
  check('weapon.world-forward', barrelWorld.dot(toMuzzle) > 0.9, `${barrelWorld.dot(toMuzzle)}`);

  // Weapon swap in place (no respawn, no second gun, muzzle tracks archetype).
  const swapped = operator.swapAuthoredWeapon(hRifle.root, dress, 'deadeye');
  const wSwapped = weaponMod.authoredWeaponOf(hRifle.root);
  check('weapon.swap-sniper', swapped === 'sniper' && wSwapped?.archetype === 'sniper');
  check('weapon.swap-still-one',
    hRifle.root.getObjectsByProperty('name', 'operator-weapon').length === 1);
  check('weapon.swap-muzzle-longer', wSwapped.muzzle.position.z > muzzleLocal.z);
  const swappedBack = operator.swapAuthoredWeapon(hRifle.root, dress, 'rattler');
  check('weapon.swap-smg', swappedBack === 'smg');

  // Disposal removes the weapon while the shared GLB cache lifetime stays exact.
  const liveBefore = operator.authoredOperatorStatus().live;
  check('weapon.live-six', liveBefore === 6, `${liveBefore}`);
  system.despawn(hPistol);
  check('weapon.dispose-removes-gun',
    hPistol.root.getObjectByName('operator-weapon') == null);
  check('weapon.cache-refuses-while-live', operator.disposeAuthoredCache() === false);
  for (const h of [hRifle, hSniper, hExotic, hUnknown, hDefault]) system.despawn(h);
  check('weapon.cache-released-when-empty', operator.disposeAuthoredCache() === true);
} catch (err) {
  failures += 1;
  console.log(`FAIL harness-crash -- ${err && err.stack ? err.stack : err}`);
} finally {
  operator.__testSetOperatorLoader(null);
  operator.__testResetOperatorState();
  setGate(false);
}

console.log(failures === 0 ? '\nOPERATOR_WEAPON_VERIFY PASS' : `\nOPERATOR_WEAPON_VERIFY FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
