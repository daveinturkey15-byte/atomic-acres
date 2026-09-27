/** CPU-only actual motion/body/hand modules. No renderer, DOM, model or authority changes. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] ?? 'initial';
assert.match(tag, /^[a-z0-9-]+$/);
const out = resolve(root, 'captures/polish-motion-20260927', tag);
assert.ok(!existsSync(out), 'receipt directory must be new');
mkdirSync(out, { recursive: true });
const baseline = 'b9adb96b561378adf679cafc925a871820134746';
const paths = ['src/weapons/viewmodel-motion.ts', 'src/weapons/first-person-hands-motion.ts',
  'src/characters/body-presentation.ts'];
const hash = b => createHash('sha256').update(b).digest('hex');
const retained = {};
for (const path of paths) {
  const bytes = execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root });
  retained[path] = bytes.toString();
  writeFileSync(resolve(out, path.split('/').at(-1) + '.before'), bytes);
}
const entry = `
export * as THREE from 'three';
export * from './src/weapons/viewmodel-motion';
export * from './src/characters/body-presentation';
export {createFirstPersonHands} from './src/weapons/first-person-hands';
export {WEAPON_ANCHORS,supportJointsFor,TRIGGER_SPEC,geometryHash} from './src/weapons/hand-geometry-canary';
`;
for (const mode of ['current', 'baseline']) await build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true,
  platform: 'node', format: 'esm', outfile: resolve(out, `${mode}.mjs`), logLevel: 'silent',
  plugins: mode === 'baseline' ? [{ name: 'retained-motion', setup(b) {
    b.onLoad({ filter: /(viewmodel-motion|first-person-hands-motion|body-presentation)\.ts$/ }, args => {
      const path = paths.find(p => args.path.replaceAll('\\', '/').endsWith('/' + p));
      return path ? { contents: retained[path], loader: 'ts', resolveDir: dirname(args.path) } : undefined;
    });
  } }] : [],
});
const api = await import(pathToFileURL(resolve(out, 'current.mjs')).href);
const old = await import(pathToFileURL(resolve(out, 'baseline.mjs')).href);
const { THREE } = api;
const report = { baseline, claim: 'CPU timing/pose only; visual and owner acceptance OPEN', groups: [], metrics: {},
  beforeHashes: Object.fromEntries(paths.map(p => [p, hash(retained[p])])), sourceHashes: {} };
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} ±${tolerance}`);
const group = (name, run) => { try { run(); report.groups.push({ name, pass: true }); }
  catch (error) { report.groups.push({ name, pass: false, error: String(error.stack ?? error) }); } };
const pose = (m, hz, t, options = {}) => {
  const { family = 'rifle', ads = 0, sprint = 0, reload = 0, offHand = 0, kick = 0,
    yaw = 0, crouch = false, prone = false, grounded = true } = options;
  m.update(1 / hz, t, family, ads, sprint, 0, 0, reload, offHand, kick, 0, yaw, crouch, prone, grounded);
};
const row = m => [...m.offset.toArray(), m.rotation.x, m.rotation.y, m.rotation.z];

group('30/60/120Hz exact ADS and sprint family settling', () => {
  const rates = [];
  for (const hz of [30, 60, 120]) {
    const pistol = new api.ViewmodelMotion(), lmg = new api.ViewmodelMotion();
    for (let f = 0; f < hz * .5; f++) {
      pose(pistol, hz, f / hz, { family: 'pistol', sprint: 1 });
      pose(lmg, hz, f / hz, { family: 'lmg', sprint: 1 });
    }
    assert.ok(pistol.rotation.x > lmg.rotation.x, 'heavy carry enters more slowly');
    for (let f = 0; f < hz * .2; f++) {
      pose(pistol, hz, 1, { family: 'pistol' }); pose(lmg, hz, 1, { family: 'lmg' });
    }
    assert.ok(lmg.rotation.x > pistol.rotation.x * 3, 'heavy carry recovers more slowly');
    rates.push([hz, pistol.rotation.x, lmg.rotation.x]);
    for (const family of ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'sniper', 'shotgun', 'special', 'exotic']) {
      const m = new api.ViewmodelMotion();
      for (let f = 0; f < hz * 6; f++) pose(m, hz, f / hz, { family, ads: 1, sprint: 1,
        kick: f < hz / 10 ? .06 : 0, yaw: f / hz, crouch: true, prone: true, grounded: f > hz / 2 });
      close(m.offset.x, 0); close(m.offset.y, -.148); close(m.offset.z, -.3);
      close(Math.hypot(m.rotation.x, m.rotation.y, m.rotation.z), 0);
    }
  }
  for (const [, p, l] of rates) { close(p, rates[0][1]); close(l, rates[0][2]); }
  report.metrics.sprintSettling = rates;
});

group('landing actual edge once; short-air/no-air/ADS/offhand/reset controls', () => {
  const peaks = [];
  for (const hz of [30, 60, 120]) {
    const m = new api.ViewmodelMotion(), control = new api.ViewmodelMotion();
    let peak = 0, peakAt = 0;
    for (let f = 0; f < hz; f++) {
      const airborne = f >= hz * .1 && f < hz * .3;
      pose(m, hz, f / hz, { grounded: !airborne }); pose(control, hz, f / hz);
      const dip = control.offset.y - m.offset.y;
      assert.ok(dip >= -1e-12 && dip <= .009 + 1e-12);
      if (dip > peak) { peak = dip; peakAt = f / hz - .3; }
      if (f / hz > .6) assert.deepEqual(row(m), row(control), 'settles; grounded frames do not retrigger');
    }
    assert.ok(peak > .008 && peakAt >= 0 && peakAt <= .08); peaks.push({ hz, peak, peakAt });
    for (const mode of ['short', 'ads', 'offhand', 'reset']) {
      const a = new api.ViewmodelMotion(), b = new api.ViewmodelMotion();
      for (let f = 0; f < hz; f++) {
        const airborne = mode === 'short' ? f === 2 : f >= hz * .1 && f < hz * .3;
        if (mode === 'reset' && f === Math.ceil(hz * .3)) a.reset();
        const shared = { ads: mode === 'ads' ? 1 : 0, offHand: mode === 'offhand' ? 1 : 0 };
        pose(a, hz, f / hz, { ...shared, grounded: !airborne }); pose(b, hz, f / hz, shared);
        if (mode !== 'reset' || f >= Math.ceil(hz * .3)) assert.deepEqual(row(a), row(b), mode);
      }
    }
  }
  report.metrics.landings = peaks;
});

group('reload hold matches .79 return waypoint; bind endpoints and C2 phase seams', () => {
  close(api.reloadPresentation(.79), 1);
  assert.ok(old.reloadPresentation(.79) < 1, 'retained old receiver raises before hand clears return waypoint');
  for (const t of [0, 1, -1, 2, NaN, Infinity]) close(api.reloadPresentation(t), 0);
  for (const seam of [.18, .79, 1]) {
    const epsilon = 1e-5;
    const slope = (api.reloadPresentation(seam + epsilon) - api.reloadPresentation(seam - epsilon)) / (2 * epsilon);
    assert.ok(Math.abs(slope) < 1e-4, `smooth phase seam ${seam}`);
  }
});

group('actual buffered root and mixer speed agree through start/stop; old mismatch retained', () => {
  const h = { root: new THREE.Object3D(), yaw: 0, rootMotion: true };
  const make = (x, sampleTimeMs, speed) => ({ id: 'cpu', x, y: 0, z: 0, yaw: 0, sampleTimeMs, speed, alive: true });
  const poses = [[0, make(0, 0, 0)], [50, make(.2, 50, 4)], [75, make(.2, 50, 4)],
    [100, make(.2, 100, 0)], [125, make(.2, 100, 0)], [150, make(.2, 150, 0)]];
  const speeds = poses.map(([now, b]) => api.presentBody(h, b, now));
  close(speeds[0], 0); close(speeds[1], 0); close(speeds[2], 4); close(speeds[3], 4);
  close(speeds[4], 0); close(speeds[5], 0);
  assert.equal(h.rootMotion, false); close(h.yaw, Math.PI);
  const oldH = { root: new old.THREE.Object3D(), yaw: 0, rootMotion: true };
  let oldX = 0, oldAt = 0; const mismatches = [];
  for (const [now, b] of poses) {
    old.presentBody(oldH, b, now);
    const displayed = now > oldAt ? (oldH.root.position.x - oldX) * 1000 / (now - oldAt) : 0;
    if (Math.abs(displayed - b.speed) > 1) mismatches.push({ now, displayed, oldMixerSpeed: b.speed });
    oldX = oldH.root.position.x; oldAt = now;
  }
  assert.equal(mismatches.length, 2, 'old start and stop mismatch really exercised');
  report.metrics.bodyNegative = mismatches;
  report.metrics.bodyCurrent = speeds;
});

group('teleport/life/gap/backward/mode-switch reset; guest has no additional position delay', () => {
  const h = { root: new THREE.Object3D(), yaw: 0, rootMotion: true };
  const body = { id: 'cpu', x: 0, y: 0, z: 0, yaw: Math.PI - .01, speed: 4, alive: true, sampleTimeMs: 0 };
  api.presentBody(h, body, 0);
  for (const [now, patch] of [[50, { x: 10, sampleTimeMs: 50 }], [100, { alive: false, sampleTimeMs: 100 }],
    [150, { alive: true, sampleTimeMs: 150 }], [1000, { x: 10.2, sampleTimeMs: 1000 }],
    [1010, { sampleTimeMs: 900 }], [1020, { x: 10.3, sampleTimeMs: undefined }],
    [1030, { sampleTimeMs: 1030 }]]) {
    Object.assign(body, patch); close(api.presentBody(h, body, now), 0); close(h.root.position.x, body.x);
  }
  const guest = { ...body, sampleTimeMs: undefined };
  api.presentBody(h, guest, 1100); guest.x += .08;
  close(api.presentBody(h, guest, 1120), 4); close(h.root.position.x, guest.x);
  const track = { previous: { x: 0, y: 0, z: 0, yaw: Math.PI - .01, time: 0 },
    current: { x: 0, y: 0, z: 0, yaw: -Math.PI + .01, time: 50 }, alive: true };
  const outPose = { x: 0, y: 0, z: 0, yaw: 0, time: 0 };
  api.readBody(track, 75, outPose); close(outPose.yaw, Math.PI);
});

group('five real hand rigs retain contact/sleeve lengths/geometry through motion phases', () => {
  const material = new THREE.MeshBasicMaterial();
  const mat = new Proxy({ painted: () => material, emissive: () => material,
    viewmodel: { sleeve: material, darkGlove: material, gloveDetail: material } }, { get(t, k) { return t[k] ?? material; } });
  let worstSeam = 0, worstStretch = 0;
  for (const anchor of api.WEAPON_ANCHORS) {
    const rootGroup = new THREE.Group();
    const hands = api.createFirstPersonHands(rootGroup, mat, anchor.supportZ, anchor.supportY, anchor.reloadTarget, true);
    const joints = api.supportJointsFor(anchor);
    const wrist = new THREE.Vector3(...joints.wrist), elbow = new THREE.Vector3(...joints.elbow), palm = new THREE.Vector3(...joints.palm);
    const length = wrist.distanceTo(elbow), geometry = [];
    rootGroup.traverse(n => { if (n.isMesh) geometry.push([n.geometry, api.geometryHash(n.geometry)]); });
    for (let f = 0; f <= 240; f++) {
      hands.updateReload(f / 240); hands.updatePose(.4, .25, 0); rootGroup.updateMatrixWorld(true);
      const liveWrist = wrist.clone().applyMatrix4(hands.supportHand.matrixWorld);
      const sleeveWrist = wrist.clone().applyMatrix4(hands.supportForearm.matrixWorld);
      const sleeveElbow = elbow.clone().applyMatrix4(hands.supportForearm.matrixWorld);
      worstSeam = Math.max(worstSeam, liveWrist.distanceTo(sleeveWrist));
      worstStretch = Math.max(worstStretch, Math.abs(length - sleeveWrist.distanceTo(sleeveElbow)));
    }
    hands.updateReload(.5); rootGroup.updateMatrixWorld(true);
    const seat = palm.clone().applyMatrix4(hands.supportHand.matrixWorld);
    close(seat.distanceTo(palm.clone().add(new THREE.Vector3(...anchor.reloadTarget))), 0, 1e-8);
    assert.ok(seat.distanceTo(palm.clone().add(new THREE.Vector3(...anchor.reloadTarget)).addScalar(.02)) > .008);
    hands.resetReload(); hands.updatePose(0, 0, 0); rootGroup.updateMatrixWorld(true);
    close(palm.clone().applyMatrix4(hands.supportHand.matrixWorld).distanceTo(palm), 0, 1e-8);
    for (const [g, before] of geometry) { assert.equal(api.geometryHash(g), before); g.dispose(); }
  }
  assert.ok(worstSeam < 1e-8 && worstStretch < 1e-8); material.dispose();
  report.metrics.contact = { worstSeam, worstStretch };
});

group('persistent pose outputs and bounded warmed CPU update cost', () => {
  const m = new api.ViewmodelMotion(), offset = m.offset, rotation = m.rotation;
  for (let i = 0; i < 1000; i++) pose(m, 60, i / 60, { sprint: i % 2, family: 'lmg' });
  const start = performance.now();
  for (let i = 0; i < 30000; i++) pose(m, 60, i / 60, { sprint: i % 2, family: 'lmg' });
  const perUpdateMs = (performance.now() - start) / 30000;
  assert.equal(m.offset, offset); assert.equal(m.rotation, rotation); assert.ok(perUpdateMs < .2);
  assert.ok(row(m).every(Number.isFinite)); report.metrics.perUpdateMs = perUpdateMs;
});

for (const p of [...paths, 'src/weapons/controller.ts', 'src/main.ts', 'scripts/_verify-polish-motion.mjs']) report.sourceHashes[p] = hash(readFileSync(resolve(root, p)));
report.result = report.groups.every(g => g.pass) ? 'PASS' : 'FAIL';
writeFileSync(resolve(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, groups: report.groups, metrics: report.metrics, receipt: resolve(out, 'result.json') }, null, 2));
if (report.result !== 'PASS') process.exitCode = 1;
