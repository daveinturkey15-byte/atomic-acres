/** CPU-only: actual rig matrices, contacts, 20 profile mappings and admitted event parity. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const handsFlag = process.env.VIEWMODEL_HANDS_FLAG ?? '';
assert.ok(['', 'rigged', 'rifle-canary'].includes(handsFlag), 'known optional hand canary');
const fxFlag = process.env.VIEWMODEL_FX_FLAG ?? '';
assert.ok(['', 'canary'].includes(fxFlag), 'known optional weapon FX canary');
const out = resolve(root, `work/astra-motion/cpu${handsFlag ? '-' + handsFlag : ''}${fxFlag ? '-fx-' + fxFlag : ''}`);
mkdirSync(out, { recursive: true });
const baseRef = 'e8b4b6d';
const entry = `
export * as THREE from 'three';
export { createFirstPersonHands } from './src/weapons/first-person-hands';
export { WEAPON_ANCHORS, TRIGGER_SPEC, supportJointsFor, geometryHash } from './src/weapons/hand-geometry-canary';
export { ViewmodelMotion } from './src/weapons/viewmodel-motion';
export { WeaponsController } from './src/weapons/controller';
export { WEAPONS } from './src/weapons/catalog';
export { FAMILY_FALLBACK, weaponFamily } from './src/weapons/families';
export * as builders from './src/weapons/viewmodel';
`;
for (const mode of ['current', 'baseline']) {
  await build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true,
    platform: 'node', format: 'esm', outfile: resolve(out, `${mode}.mjs`), logLevel: 'silent',
    plugins: mode === 'baseline' ? [{ name: 'retained-controller', setup(b) {
      b.onLoad({ filter: /weapons[\\/]controller\.ts$/ }, () => ({
        contents: execFileSync('git', ['show', `${baseRef}:src/weapons/controller.ts`], { cwd: root, encoding: 'utf8' }),
        loader: 'ts', resolveDir: resolve(root, 'src/weapons'),
      }));
    } }] : [],
  });
}
const api = await import(pathToFileURL(resolve(out, 'current.mjs')).href);
const baseline = await import(pathToFileURL(resolve(out, 'baseline.mjs')).href);
const { THREE } = api;
function materials(lib = THREE) {
  const m = new lib.MeshBasicMaterial();
  return new Proxy({ painted: () => m, emissive: () => m, viewmodel: { sleeve: m, darkGlove: m, gloveDetail: m, woodFurniture: m, parkerizedSteel: m } }, {
    get(target, key) { return target[key] ?? m; },
  });
}
const report = { baseline: baseRef, claim: 'CPU geometry/state only; visual acceptance OPEN', rigs: [], profiles: [], parity: [], controls: [] };
const near = (actual, expected, limit, name) => assert.ok(Math.abs(actual - expected) <= limit, `${name}: ${actual} vs ${expected} (limit ${limit})`);
const distance = (a, b) => a.distanceTo(b);
const v = (p) => new THREE.Vector3(...p);
const mat = materials();
const familyBuilders = { rifle: api.builders.buildRifleViewmodel, pistol: api.builders.buildPistolViewmodel, smg: api.builders.buildSmgViewmodel, shotgun: api.builders.buildShotgunViewmodel, sniper: api.builders.buildSniperViewmodel };
for (const anchor of api.WEAPON_ANCHORS) {
  const group = new THREE.Group();
  const hands = api.createFirstPersonHands(group, mat, anchor.supportZ, anchor.supportY, anchor.reloadTarget, true);
  const joints = api.supportJointsFor(anchor);
  let maxSeam = 0, maxStretch = 0, maxPalmStep = 0;
  const wrist = v(joints.wrist), elbow = v(joints.elbow), palm = v(joints.palm);
  const length = wrist.distanceTo(elbow);
  let previous = palm.clone();
  const resources = [];
  group.traverse(n => { if (n.isMesh) resources.push([n.geometry, n.material, api.geometryHash(n.geometry)]); });
  for (let f = 0; f <= 240; f++) {
    hands.updateReload(f / 240);
    hands.updatePose(0.4, 0.25, 0);
    group.updateMatrixWorld(true);
    const handWrist = wrist.clone().applyMatrix4(hands.supportHand.matrixWorld);
    const sleeveWrist = wrist.clone().applyMatrix4(hands.supportForearm.matrixWorld);
    const sleeveElbow = elbow.clone().applyMatrix4(hands.supportForearm.matrixWorld);
    maxSeam = Math.max(maxSeam, distance(handWrist, sleeveWrist));
    maxStretch = Math.max(maxStretch, Math.abs(distance(sleeveElbow, sleeveWrist) - length));
    const currentPalm = palm.clone().applyMatrix4(hands.supportHand.matrixWorld);
    maxPalmStep = Math.max(maxPalmStep, currentPalm.distanceTo(previous));
    previous = currentPalm;
    for (const n of [hands.supportHand, hands.supportForearm, hands.triggerHand]) assert.ok(n.matrixWorld.elements.every(Number.isFinite), `${anchor.weapon} finite matrices`);
  }
  near(maxSeam, 0, 1e-8, `${anchor.weapon} wrist/sleeve continuity`);
  near(maxStretch, 0, 1e-8, `${anchor.weapon} constant sleeve length`);
  assert.ok(maxPalmStep < 0.015, `${anchor.weapon} reload path discontinuity ${maxPalmStep}`);
  hands.updateReload(0.50); group.updateMatrixWorld(true);
  const seat = palm.clone().applyMatrix4(hands.supportHand.matrixWorld);
  const seatTarget = palm.clone().add(v(anchor.reloadTarget));
  near(seat.distanceTo(seatTarget), 0, 1e-8, `${anchor.weapon} measured palm seat contact`);
  // A shifted socket and a severed sleeve must fail the same contact predicates.
  assert.ok(seat.distanceTo(seatTarget.clone().add(new THREE.Vector3(0.02, 0, 0))) > 0.008);
  hands.supportForearm.matrix.elements[12] += 0.02;
  group.updateMatrixWorld(true);
  assert.ok(wrist.clone().applyMatrix4(hands.supportForearm.matrixWorld).distanceTo(wrist.clone().applyMatrix4(hands.supportHand.matrixWorld)) > 0.008);
  for (const terminal of [0, 1, -1, 1.2, NaN, Infinity]) {
    hands.updateReload(0.5); hands.updateReload(terminal);
    assert.deepEqual(hands.supportHand.position.toArray(), [0, 0, 0]);
    assert.deepEqual(hands.supportHand.quaternion.toArray(), [0, 0, 0, 1]);
  }
  hands.updateReload(0.5); hands.updatePose(0, 0, 1);
  near(hands.supportHand.position.length(), 0, 1e-10, `${anchor.weapon} offhand priority`);
  hands.resetReload();
  for (const [geo, material, hash] of resources) {
    assert.equal(api.geometryHash(geo), hash);
    assert.ok(material === mat.viewmodel.sleeve);
  }
  report.rigs.push({ family: anchor.weapon, maxSeam, maxStretch, maxPalmStep, seatDistance: seat.distanceTo(seatTarget), geometryUnchanged: true });
}
report.controls.push('20mm detached sleeve rejected', '20mm socket drift rejected', 'NaN/overshoot/cancel exact bind', 'ordnance suppresses reload reach');

// Independent full-geometry envelope: every real vertex, level camera, including
// reload + offhand overlap. No pose proxy or authored socket substitutes for it.
report.floor = [];
globalThis.window = { location: { search: '?motion=canary' } };
for (const [family, buildRig] of Object.entries(familyBuilders)) {
  const rig = buildRig(mat), motion = new api.ViewmodelMotion();
  let minimum = Infinity;
  for (const stance of ['crouch', 'prone']) for (const ads of [0, 1]) {
    for (const phase of [0, .12, .34, .50, .62, .79, 1]) for (const offHand of [0, .5, 1]) {
      for (let f = 0; f < 120; f++) motion.update(1 / 60, 1, family, ads, 0, 0, 0, phase, offHand, 0, 0, 0, true, stance === 'prone');
      rig.hands.updateReload(phase); rig.hands.updatePose(motion.crouch, motion.prone, offHand);
      rig.group.position.copy(motion.offset); rig.group.position.y += stance === 'prone' ? .50 : 1.05;
      rig.group.rotation.copy(motion.rotation); rig.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rig.group, true);
      minimum = Math.min(minimum, box.min.y);
      assert.ok(box.min.y >= .02, `${family} ${stance} ADS=${ads} reload=${phase} offhand=${offHand}: floor ${box.min.y}`);
      motion.reset();
      motion.update(1 / 60, 1, family, ads, 0, 0, 0, phase, offHand, 0, 0, 0, true, stance === 'prone');
      near(motion.prone, stance === 'prone' ? 1 : 0, 1e-12, 'switch/resume stance first frame');
    }
  }
  report.floor.push({ family, minimumWorldY: minimum, levelCameraOnly: true, threshold: .02 });
}
delete globalThis.window;

const perfGroup = new THREE.Group();
const perfHands = api.createFirstPersonHands(perfGroup, mat, -.36, -.055, [.01, -.065, .23], true);
const perfMotion = new api.ViewmodelMotion();
for (let i = 0; i < 2000; i++) { perfHands.updateReload((i % 240) / 240); perfHands.updatePose(.4, .6, .2); }
const started = performance.now();
for (let i = 0; i < 50000; i++) {
  perfMotion.update(1 / 60, i / 60, 'rifle', .3, .4, i * .1, .5, .45, .2, .01, .1, .2, true, false);
  perfHands.updateReload((i % 240) / 240); perfHands.updatePose(.4, .6, .2);
}
report.cost = { iterations: 50000, millisecondsPerPose: (performance.now() - started) / 50000, scope: 'CPU transform-only hot loop; no renderer/FPS claim' };
assert.ok(report.cost.millisecondsPerPose < .2, `pose CPU cost ${report.cost.millisecondsPerPose}ms exceeds .2ms`);

for (const def of api.WEAPONS) {
  const family = api.FAMILY_FALLBACK[api.weaponFamily(def.id)];
  assert.ok(familyBuilders[family]);
  const motion = new api.ViewmodelMotion();
  for (let frame = 0; frame < 360; frame++) {
    const p = frame / 359;
    motion.update(1 / 60, frame / 60, family, p, 1 - p, p * 12, 1 - p, p, p < .2 ? p : 0, frame < 8 ? 0.04 : 0, 0, frame * .01, p > .4, p > .65);
    assert.ok([...motion.offset.toArray(), motion.rotation.x, motion.rotation.y, motion.rotation.z].every(Number.isFinite));
  }
  for (let i = 0; i < 360; i++) motion.update(1 / 60, i / 60, family, 1, 0, 0, 0, 0, 0, 0, 0, 0, true, true);
  near(motion.offset.x, 0, 1e-12, `${def.id} ADS x`);
  near(motion.offset.y, -0.148, 1e-12, `${def.id} ADS y`);
  near(motion.offset.z, -0.3, 1e-12, `${def.id} ADS z`);
  near(Math.hypot(motion.rotation.x, motion.rotation.y, motion.rotation.z), 0, 1e-12, `${def.id} settled ADS axis`);
  report.profiles.push({ id: def.id, family, adsEndpoint: 'exact', transitions: 'finite' });
}

function controllerRun(lib, enabled) {
  globalThis.window = { location: { search: enabled ? `?motion=canary${handsFlag ? '&hands=' + handsFlag : ''}${fxFlag ? '&weapon-fx=' + fxFlag : ''}` : '' } };
  const camera = new lib.THREE.PerspectiveCamera(72, 16 / 9, .05, 160);
  const claims = [], rows = [];
  const ctl = new lib.WeaponsController({ camera, scene: new lib.THREE.Scene(), mat: materials(lib.THREE), targets: [], onHud() {}, onShot(c) { claims.push(structuredClone(c)); }, crossbowCanary: true, carbineCanary: false, heroesCanary: false });
  let frame = 0;
  const tick = (f) => {
    camera.position.set(0, f >= 320 ? .5 : 1.65, 0);
    camera.rotation.set(0, .1, 0);
    ctl.update(1 / 60, ++frame / 60, { speed: f < 70 ? 6.6 : 0, sprinting: f < 70, grounded: true, crouched: f >= 260, prone: f >= 320 });
    const s = ctl.snapshot(); delete s.motionCanary;
    rows.push([s, { ...ctl.hud }, camera.fov, camera.rotation.x, camera.rotation.y]);
  };
  for (const def of lib.WEAPONS) {
    if (!ctl.command('switch', def.id)) continue;
    for (let f = 0; f < 410; f++) {
      if (f === 5) ctl.pointerDown(0);
      if (f === 45) ctl.pointerUp(0);
      if (f === 75) ctl.command('ads', true);
      if (f === 100) ctl.command('fire');
      if (f === 120) ctl.command('ads', false);
      if (f === 130) ctl.command('reload');
      if (f === 190) { ctl.command('grenade', 'frag'); ctl.setOrdnance(1, 1, 'smoke', 'frag'); }
      if (f === 215) ctl.command('grenade', 'frag');
      if (f === 245) ctl.setOrdnance(0, 1, 'smoke', null);
      if (f === 270) ctl.command('knife');
      if (f === 350) { ctl.command('fire'); ctl.command('reload'); }
      if (f === 370) ctl.setVisible(false);
      if (f === 372) ctl.setVisible(true);
      tick(f);
    }
  }
  ctl.dispose();
  delete globalThis.window;
  return { claims, rows };
}
const retained = controllerRun(baseline, false);
const normal = controllerRun(api, false);
const candidate = controllerRun(api, true);
assert.deepEqual(normal, retained, 'default path vs frozen controller gameplay');
assert.deepEqual(candidate, retained, 'canary vs frozen controller gameplay');
assert.ok(candidate.claims.length > 100 && candidate.claims.some(c => c.weaponId === 'frag') && candidate.claims.some(c => c.weaponId === 'knife'), 'positive controls actually fired/throw/stabbed');
report.parity.push({ handsFlag: handsFlag || null, fxFlag: fxFlag || null, simulatedFrames: candidate.rows.length, exactClaims: candidate.claims.length, defaultVsFrozen: 'PASS', canaryVsFrozen: 'PASS', compared: 'HUD/ammo/reload/cadence/FOV/camera recoil/claim origin+direction+time' });
for (const name of ['first-person-hands-motion.ts', 'viewmodel-motion.ts']) {
  const source = readFileSync(resolve(root, 'src/weapons', name), 'utf8');
  assert.ok(!source.includes('requestAnimationFrame') && !source.includes('setInterval'));
}
writeFileSync(resolve(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: 'PASS', rigs: report.rigs.length, profiles: report.profiles.length, ...report.parity[0], report: resolve(out, 'result.json') }, null, 2));
