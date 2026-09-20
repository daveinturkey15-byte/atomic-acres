#!/usr/bin/env node
/* Selected-weapon seam proof: real creation, stance carry, swap and disposal.
 *
 * Like verify-operator-lifetime.mjs, this runs the REAL module code: it
 * transpiles src/characters/*.ts in memory with the repo's own TypeScript (no
 * build, no deps added) and exercises it against real three.js objects, then
 * greps the three game-layer caller files that cannot run headless (main.ts,
 * session-solo.ts, session-types.ts) for the exact wiring. Behaviour first,
 * wiring second — not regex-only:
 *   - id -> archetype resolution incl. every fallback shape
 *   - per-archetype grip data: every support point strictly inside its muzzle,
 *     the pistol gripping its wrap (z 0.055), never beyond the 0.175 muzzle
 *   - CharacterSystem.spawn(weaponId): real authored figure wearing that id,
 *     rig aimed at the archetype grip
 *   - stance/carry: after the rig's own updates the LEFT HAND bone sits on the
 *     solved grip (smg and pistol measured), and has LEFT the rifle point
 *   - CharacterSystem.rearm: real detach+rebuild on archetype change,
 *     no-op (same group object) on same-archetype ids, procedural figures
 *     untouched (null, no weapon node)
 *   - despawn detaches the weapon; shared geometries survive every per-actor
 *     dispose; the cache releases only when the last actor dies
 *
 * Plain node, CPU-only, no browser/GPU/Blender/server/build. Fails closed.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(REPO, 'src', 'characters');
const OUT = path.join(REPO, 'node_modules', '.cache', 'nt-operator-selection');

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

const load = (name) => import(url.pathToFileURL(path.join(OUT, name)).href);
const weapon = await load('authored-weapon.js');
const operator = await load('operator-authored.js');
const { CharacterSystem } = await load('system.js');
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

const { BONE_NAMES, BONE_PARENTS } = await load('skeleton.js');

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

/** A fake "GLB" that passes the loader's joint-order + budget validation.
 *  Mirrors verify-operator-lifetime.mjs's fixture: budget-scale triangle
 *  counts, distinct per-primitive materials. */
function makeMockGltf({ triangles = 15000 } = {}) {
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
  // Deliberately non-modulo: primitive 0 wears matB, primitive 1 wears matA.
  first.material = matB;
  second.material = matA;
  return { scene, tracked };
}

function disposeCounts(tracked) {
  const sum = (list) => list.reduce((acc, o) => acc + (o.__disposeCount ?? 0), 0);
  return { geometries: sum(tracked.geometries), materials: sum(tracked.materials), textures: sum(tracked.textures) };
}

const makeDress = () => ({
  skin: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  cloth: new THREE.MeshBasicMaterial({ color: 0x222288 }),
  dark: new THREE.MeshBasicMaterial({ color: 0x111111 }),
});

const GATE_URL = 'https://game.local/?operator=authored';
function setGate(on) {
  if (on) globalThis.location = new URL(GATE_URL);
  else delete globalThis.location;
}

let scene = new THREE.Scene();
let system = new CharacterSystem(scene, makeDress());
// Fresh instances per gate regime: operator-authored.ts holds module-level
// shared/live/generation/pending/loader state (__testResetOperatorState
// clears shared/live/generation/pending but deliberately NOT the injected
// loader), and CharacterSystem holds an authoredTeams round-robin counter.
// Reusing one system across gate on -> off -> on mixes those regimes in a
// single process; fresh systems after drain + reset isolate each regime.
// Thresholds and product paths are untouched by this fixture change.
function freshSystem() {
  scene = new THREE.Scene();
  system = new CharacterSystem(scene, makeDress());
}
async function adopt() {
  operator.__testResetOperatorState();
  setGate(true);
  const mock = makeMockGltf();
  operator.__testSetOperatorLoader(() => Promise.resolve(mock));
  const adopted = await operator.preloadAuthoredOperator();
  check('adopt.loaded', adopted !== null && operator.authoredOperatorStatus().loaded);
  return mock;
}

function drain() {
  while (system.characters.length) system.despawn(system.characters[0]);
}


function leftHandOf(root) {
  let hand = null;
  root.traverse((o) => { if (!hand && o.isBone && o.name === 'LeftHand') hand = o; });
  return hand;
}

const _v = new THREE.Vector3();
/** World-space local point on a bone, measured after a full matrix refresh. */
function boneLocalToWorld(root, bone, local) {
  root.updateMatrixWorld(true);
  return _v.copy(local).applyMatrix4(bone.matrixWorld).clone();
}

/** Converge the carry layer, then return where the left hand actually is. */
function settleLeftHand(handle) {
  handle.input.aimWeight = 1;
  for (let i = 0; i < 60; i++) handle.rig.update(1 / 60, handle.input);
  handle.root.updateMatrixWorld(true);
  return leftHandOf(handle.root).getWorldPosition(new THREE.Vector3());
}

// ---- 1. id -> archetype resolution, every fallback shape -------------------
const MAPPING = [
  ['longhorn', 'rifle'], ['m4a1', 'rifle'], ['lmg', 'rifle'], ['explosive-crossbow', 'rifle'],
  ['mp5', 'smg'], ['rattler', 'smg'], ['mini-uzi', 'smg'],
  ['coachman', 'shotgun'], ['slug-shotgun', 'shotgun'],
  ['deadeye', 'sniper'], ['m14-ebr', 'sniper'],
  ['duster', 'pistol'], ['magnum', 'pistol'], ['flashlight-pistol', 'pistol'],
];
for (const [id, arch] of MAPPING) {
  check(`resolve.${id}`, weapon.resolveAuthoredArchetype(id) === arch);
}
for (const bad of ['unknown-gun', '', null, undefined, 42]) {
  check(`resolve.fallback(${String(bad)})`, weapon.resolveAuthoredArchetype(bad) === 'rifle');
}

// ---- 2. grip data: every support point inside its muzzle -------------------
const ARCHETYPES = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol'];
for (const arch of ARCHETYPES) {
  const g = weapon.authoredGripLocal(arch);
  const m = weapon.authoredMuzzleLocal(arch);
  check(`grip.${arch}.inside-muzzle`, g.z < m.z, `grip z=${g.z} muzzle z=${m.z}`);
}
const pistolGrip = weapon.authoredGripLocal('pistol');
const pistolMuzzle = weapon.authoredMuzzleLocal('pistol');
check('grip.pistol-not-beyond-muzzle', pistolGrip.z < pistolMuzzle.z && Math.abs(pistolMuzzle.z - 0.175) < 1e-9,
  `grip z=${pistolGrip.z} muzzle z=${pistolMuzzle.z}`);
const rifleGrip = weapon.authoredGripLocal('rifle');
check('grip.rifle-is-legacy-forestock',
  rifleGrip.x === 0 && rifleGrip.y === -0.055 && rifleGrip.z === 0.25,
  `${rifleGrip.x},${rifleGrip.y},${rifleGrip.z}`);

// ---- 3. real creation: authored figure wearing the selected id -------------
const mock = await adopt();
const smg = system.spawn(0, 0, 0, 1, 0, 'mp5');
const smgWorn = weapon.authoredWeaponOf(smg.root);
check('create.wears-selected-id', smgWorn !== null && smgWorn.weaponId === 'mp5');
check('create.archetype', smgWorn !== null && smgWorn.archetype === 'smg');
check('create.rig-aimed-at-archetype', smg.rig.carriedArchetype === 'smg');
check('create.weaponOf', system.weaponOf(smg) === 'mp5');

// ---- 4. stance carry: the left hand is ON the solved grip ------------------
const smgHand = settleLeftHand(smg);
const smgGripWorld = boneLocalToWorld(smg.root, smg.root.getObjectByName('operator-weapon').parent,
  weapon.authoredGripLocal('smg'));
check('carry.smg-hand-on-grip', smgHand.distanceTo(smgGripWorld) < 2e-3,
  `dist=${smgHand.distanceTo(smgGripWorld)}`);

const pistol = system.spawn(1, 0, 0, 1, 1, 'duster');
const pistolHand = settleLeftHand(pistol);
// Grip/muzzle live in RightHand LOCAL space (authored-weapon.ts GRIPS/MUZZLES).
// Measure them through the weapon's own parent (the RightHand bone), as the
// smg station above does — never through the LeftHand's parent (LeftForeArm),
// which offsets the point by ~0.208 m and fails a correct solve.
const pistolWeaponParent = pistol.root.getObjectByName('operator-weapon').parent;
const pistolGripWorld = boneLocalToWorld(pistol.root, pistolWeaponParent, pistolGrip);
const pistolMuzzleWorld = boneLocalToWorld(pistol.root, pistolWeaponParent, pistolMuzzle);
const legacyRifleWorld = boneLocalToWorld(pistol.root, pistolWeaponParent, new THREE.Vector3(0, -0.055, 0.25));
check('carry.pistol-hand-on-grip', pistolHand.distanceTo(pistolGripWorld) < 2e-3,
  `dist=${pistolHand.distanceTo(pistolGripWorld)}`);
check('carry.pistol-left-rifle-point', pistolHand.distanceTo(legacyRifleWorld) > 0.1,
  `dist=${pistolHand.distanceTo(legacyRifleWorld)}`);
check('carry.pistol-not-beyond-muzzle', pistolHand.distanceTo(pistolMuzzleWorld) > 0.05,
  `dist=${pistolHand.distanceTo(pistolMuzzleWorld)}`);

check('swap.changes-archetype', system.rearm(smg, 'duster') === 'pistol');
check('swap.wears-new-id', system.weaponOf(smg) === 'duster');
check('swap.rig-refocused', smg.rig.carriedArchetype === 'pistol');
const smgHandAfter = settleLeftHand(smg);
check('swap.hand-moved-to-pistol-grip',
  smgHandAfter.distanceTo(boneLocalToWorld(smg.root, smg.root.getObjectByName('operator-weapon').parent, pistolGrip)) < 2e-3);

const groupBeforeSwap = weapon.authoredWeaponOf(smg.root).group;
check('swap.same-archetype-noop', system.rearm(smg, 'magnum') === 'pistol');
check('swap.noop-keeps-group', weapon.authoredWeaponOf(smg.root).group === groupBeforeSwap);
check('swap.noop-keeps-id', system.weaponOf(smg) === 'magnum');

check('swap.back-to-rifle', system.rearm(smg, 'longhorn') === 'rifle');
check('swap.rebuild-new-group', weapon.authoredWeaponOf(smg.root).group !== groupBeforeSwap);
const smgHandRifle = settleLeftHand(smg);
check('swap.rifle-hand-back-at-forestock',
  smgHandRifle.distanceTo(boneLocalToWorld(smg.root, smg.root.getObjectByName('operator-weapon').parent, rifleGrip)) < 2e-3);

// ---- 6. procedural figures are untouched -----------------------------------
// Fresh system after drain + reset: the gate-off regime must not inherit the
// gate-on system's actors, scene, or authoredTeams counter.
drain();
operator.__testResetOperatorState();
setGate(false);
freshSystem();
const proc = system.spawn(2, 2);
check('proc.no-authored-skin', proc.root.getObjectByName('operator-authored') == null);
check('proc.rearm-null', system.rearm(proc, 'duster') === null);
check('proc.no-weapon-node', proc.root.getObjectByName('operator-weapon') == null);
check('proc.rig-legacy', proc.rig.carriedArchetype === null);
check('proc.weaponOf-null', system.weaponOf(proc) === null);
drain();

// ---- 7. dispose detaches the weapon; shared geos survive -------------------
// Fresh system for the final gate-on regime: prior live counts and scenes
// must not leak into the disposal measurement.
const mock2 = await adopt();
freshSystem();
const sniper = system.spawn(0, 0, 0, 1, 0, 'm14-ebr');
check('dispose.spawned-sniper', weapon.authoredWeaponOf(sniper.root)?.archetype === 'sniper');
check('dispose.rearm-mid-life', system.rearm(sniper, 'coachman') === 'shotgun');
const sniperRoot = sniper.root;
system.despawn(sniper);
check('dispose.weapon-detached', sniperRoot.getObjectByName('operator-weapon') == null);
const counts2 = disposeCounts(mock2.tracked);
check('dispose.shared-geos-survive',
  counts2.geometries === 0 && counts2.materials === 0 && counts2.textures === 0,
  JSON.stringify(counts2));
drain();
check('dispose.cache-released-last', operator.disposeAuthoredCache() === true);

// ---- 8. caller wiring (game layer cannot run headless: exact-source greps) -
const readRepo = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const mainSrc = readRepo('src/main.ts');
const soloSrc = readRepo('src/game/session-solo.ts');
const typesSrc = readRepo('src/game/session-types.ts');
check('wire.main-spawn-passes-weapon',
  mainSrc.includes('characters.spawn(b.x, b.z, b.yaw, 1, undefined, b.weaponId || undefined)'));
check('wire.main-rearm-on-change', mainSrc.includes('if (b.weaponId) characters.rearm(h, b.weaponId);'));
check('wire.solo-copies-snapshot-primary', soloSrc.includes('b.weaponId = a.primaryId;'));
check('wire.solo-body-initialises-empty', soloSrc.includes("stance: 'stand', weaponId: '' }"));
check('wire.solo-resets-on-new-match', soloSrc.includes("bodyById.forEach((b) => { b.weaponId = ''; });"));
check('wire.types-botbody-optional-field',
  /export interface BotBody \{[\s\S]*?readonly weaponId\?: string;/.test(typesSrc));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
