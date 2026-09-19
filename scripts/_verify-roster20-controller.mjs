/**
 * _verify-roster20-controller — CPU invariants for the roster20 CONTROLLER
 * patch: family-SHARED rigs (5 graphs for 16 weapons), the playable-roster
 * gate at the controller boundary (no prototype can be selected or adopted),
 * the carbine-canary lifecycle under sharing (pending adoption, active-weapon
 * safety, post-dispose race), and exactly-once geometry disposal with the
 * shared material library untouched.
 *
 * Deterministic, headless, NO browser: bundles the real controller with
 * esbuild and runs it in node — pure THREE scene-graph work only; the
 * AudioService is documented headless-safe with no context, and nothing here
 * constructs a renderer. Reaches into `ctl.weapons` / `ctl.rigs`: TS `private`
 * is erase-only in the bundle, and a falsifier may read what the HUD cannot.
 *
 *   node scripts/_verify-roster20-controller.mjs   # exit 1 on any violation
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = (p) => join(root, p).replaceAll('\\', '/');

const entry = `
import { WeaponsController } from '${src('src/weapons/controller.ts')}';
import { WEAPONS } from '${src('src/weapons/catalog.ts')}';
import * as THREE from 'three';
export { WeaponsController, WEAPONS, THREE };
`;

const tmp = join(tmpdir(), 'nuketown-roster20-controller-verify');
mkdirSync(tmp, { recursive: true });
const entryPath = join(tmp, 'entry.ts');
const outPath = join(tmp, 'bundle.mjs');
writeFileSync(entryPath, entry);
await build({ entryPoints: [entryPath], outfile: outPath, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', nodePaths: [join(root, 'node_modules')] });
const { WeaponsController, WEAPONS, THREE } = await import(pathToFileURL(outPath).href);

// Count every geometry/material release in THIS THREE instance (the bundle's).
const geoDispose = new Map();
const geoOrig = THREE.BufferGeometry.prototype.dispose;
THREE.BufferGeometry.prototype.dispose = function () {
  geoDispose.set(this.uuid, (geoDispose.get(this.uuid) ?? 0) + 1);
  return geoOrig.call(this);
};
const matDispose = new Map();
const matOrig = THREE.Material.prototype.dispose;
THREE.Material.prototype.dispose = function () {
  matDispose.set(this.uuid, (matDispose.get(this.uuid) ?? 0) + 1);
  return matOrig.call(this);
};

const failures = [];
const check = (name, ok, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const drain = () => new Promise((res) => setTimeout(res, 0));

const PROTOTYPES = ['railgun', 'explosive-crossbow', 'flamethrower', 'flare-gun'];

// A MaterialLibrary stand-in: every field is another stand-in; every CALL
// yields a fresh real THREE.Material. The patch's material contract is
// "never dispose, never construct at runtime" — the stub exists so this test
// can prove the never-dispose half against the real Material.prototype,
// without dragging core/materials' canvas/2D pipeline into node.
const freshMaterial = () => new THREE.MeshStandardMaterial();
const mat = new Proxy(function materialLibrary() {}, {
  get(_t, prop) {
    if (prop === 'then') return undefined;
    return mat;
  },
  apply() { return freshMaterial(); },
});
const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 200);
const scene = new THREE.Scene();

// Controllable stand-in GLB canary: resolves only when the test pulls `deferred`.
let deferred = null;
const makeCanary = () => {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1), new THREE.MeshStandardMaterial()));
  return {
    isGLTFAsset: true,
    group,
    muzzle: new THREE.Object3D(),
    eject: new THREE.Object3D(),
    disposeCount: 0,
    dispose() { this.disposeCount += 1; },
  };
};
const loader = () => new Promise((resolve) => { deferred = resolve; });

const ctl = new WeaponsController({
  camera, scene, mat, targets: [], onHud: () => {},
  carbineCanary: true, carbineLoader: loader,
});

// ---- construction: shared rigs over the playable roster -------------------------------------------
const weapons = ctl.weapons;
check('controller carries exactly the playable roster (16)', weapons.length === WEAPONS.length - PROTOTYPES.length, `${weapons.length} vs ${WEAPONS.length}`);
check('original five keep switch slots 1-5', JSON.stringify(weapons.slice(0, 5).map((w) => w.def.id)) === JSON.stringify(['longhorn', 'rattler', 'coachman', 'deadeye', 'duster']));
check('no prototype in the carried set', weapons.every((w) => !PROTOTYPES.includes(w.def.id)));
const rigGroups = [...new Set(weapons.map((w) => w.rig.group))];
check('exactly five shared rig graphs for 16 weapons', rigGroups.length === 5, String(rigGroups.length));
check('each shared group joined the overlay exactly once', ctl.overlay.children.filter((c) => rigGroups.some((g) => g.uuid === c.uuid)).length === 5);
const visibleGroups = rigGroups.filter((g) => g.visible === true);
check('exactly one shared group starts visible — the first weapon’s', visibleGroups.length === 1 && visibleGroups[0] === weapons[0].rig.group);

// ---- repeated switch/lifecycle through shared rigs --------------------------------------------------
let switchRefusals = 0;
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 16; i++) if (ctl.command('switch', i) !== true) switchRefusals += 1;
}
check('96 switches all accepted', switchRefusals === 0, String(switchRefusals));
check('active lands on the last slot requested', ctl.snapshot().id === weapons[15].def.id);

ctl.command('switch', 'deadeye');
check('deadeye starts with a full mag', ctl.snapshot().mag === 5, String(ctl.snapshot().mag));
check('fire consumes one round through the shared sniper rig', ctl.command('fire') === true && ctl.snapshot().mag === 4);
check('reload starts on the shared rig', ctl.command('reload') === true && ctl.snapshot().reloading === true);
ctl.command('switch', 'rattler');
check('switch cancels the reload (shared rig pose reset)', ctl.snapshot().reloading === false);
ctl.command('switch', 'deadeye');
check('deadeye mag survives the round trip', ctl.snapshot().mag === 4, String(ctl.snapshot().mag));

// ---- the gate at the controller boundary ------------------------------------------------------------
check('switch to railgun refused', ctl.command('switch', 'railgun') === false);
check('switch to flare-gun by id refused', ctl.command('switch', 'flare-gun') === false);
check('switch past the roster end refused', ctl.command('switch', 16) === false);
check('adopting a railgun drop refused', ctl.adoptWeapon('railgun', 30) === false);
check('adopting a flamethrower drop refused', ctl.adoptWeapon('flamethrower', 150) === false);
check('active weapon unchanged after refusals', ctl.snapshot().id === 'deadeye');
check('adopting a playable drop still works', ctl.adoptWeapon('m4a1', 90) === true && ctl.snapshot().id === 'm4a1');

// ---- carbine canary: pending adoption, then shared-safe swap ---------------------------------------
const rifleGroup = weapons[0].rig.group;
check('pending canary leaves the shared rifle rig in place', weapons[0].rig.group === rifleGroup && ctl.activeCarbineRig === null);
const canary = makeCanary();
deferred(canary);
await drain(); await drain();
check('canary adopted onto the Longhorn only', weapons[0].rig === canary && ctl.activeCarbineRig === canary);
check('swap released nothing (sibling rigs keep their geometries)', geoDispose.size === 0, `${geoDispose.size} geometries disposed at swap`);
check('shared rifle rig still in the overlay for its other owners', ctl.overlay.children.some((c) => c.uuid === rifleGroup.uuid));
check('m4a1 stays active and visible after the mid-match adopt', ctl.snapshot().id === 'm4a1' && weapons.find((w) => w.def.id === 'm4a1').rig.group.visible === true);
check('canary hidden while another weapon is active', canary.group.visible === false);
ctl.command('switch', 'longhorn');
check('switching to the Longhorn shows the canary and hides the shared rifle', canary.group.visible === true && rifleGroup.visible === false);
ctl.command('switch', 'ak-47');
check('switching to another rifle-family weapon restores the shared rig', rifleGroup.visible === true && canary.group.visible === false);

// ---- exactly-once disposal, materials untouched -----------------------------------------------------
const ownedGeos = [];
for (const g of rigGroups) g.traverse((n) => { if (n.isMesh) ownedGeos.push(n.geometry.uuid); });
check('shared rigs own geometries to release', ownedGeos.length > 0, String(ownedGeos.length));
ctl.dispose();
check('every owned geometry disposed exactly once', ownedGeos.every((u) => geoDispose.get(u) === 1), JSON.stringify(ownedGeos.map((u) => geoDispose.get(u))));
check('canary released exactly once', canary.disposeCount === 1, String(canary.disposeCount));
check('no material was ever disposed', matDispose.size === 0, `${matDispose.size} materials disposed`);
const snapshotCounts = JSON.stringify([...geoDispose.entries()]);
ctl.dispose();
check('dispose is guarded against a second pass', JSON.stringify([...geoDispose.entries()]) === snapshotCounts && canary.disposeCount === 1);

// ---- dispose/adopt race: a canary resolving after dispose must release itself ----------------------
let deferred2 = null;
const loader2 = () => new Promise((resolve) => { deferred2 = resolve; });
const ctl2 = new WeaponsController({
  camera, scene, mat, targets: [], onHud: () => {},
  carbineCanary: true, carbineLoader: loader2,
});
ctl2.dispose();
const lateCanary = makeCanary();
deferred2(lateCanary);
await drain(); await drain();
check('late canary releases itself and is never adopted', lateCanary.disposeCount === 1 && ctl2.weapons[0].rig.group !== lateCanary.group);
check('late canary never entered the overlay', !ctl2.overlay.children.some((c) => c.uuid === lateCanary.group.uuid));

// ----------------------------------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`roster20 controller invariants FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`roster20 controller invariants PASS: 16 weapons on 5 shared rigs, 96 switches + reload/adopt lifecycle clean, ` +
  `prototypes refused at the controller boundary, canary shared-safe, ${ownedGeos.length} geometries released exactly once, 0 materials touched.`);
