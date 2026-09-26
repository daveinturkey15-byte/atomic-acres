/** CPU proof against the real retained controller. No renderer, browser or host-rule changes. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = mkdtempSync(join(tmpdir(), 'aa-input-clock-'));
const baselineRef = '576a90e80e40c88ff1f1a22c66aaaf9d4b791623';
const retained = execFileSync('git', ['show', `${baselineRef}:src/weapons/controller.ts`], { cwd: root, encoding: 'utf8' });
const entry = `export * as THREE from 'three'; export { WeaponsController } from './src/weapons/controller';`;
const modules = [];
for (const baseline of [false, true]) {
  const outfile = join(folder, baseline ? 'baseline.mjs' : 'current.mjs');
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{
      name: 'cpu-presentation-boundary', setup(b) {
        // Asset networking is unrelated to timing. Keep all actual controller,
        // weapon, effects, ammo, geometry and update-loop code; only defer art.
        b.onLoad({ filter: /reference-weapon-models\.ts$/ }, () => ({ loader: 'ts', contents:
          `export const REFERENCE_WEAPON_IDS=[]; export const REFERENCE_SOCKETS=[]; export async function loadReferenceWeaponRig(){throw Error('CPU fixture never requests art');}` }));
        if (baseline) b.onLoad({ filter: /weapons[\\/]controller\.ts$/ }, () => ({
          contents: retained, loader: 'ts', resolveDir: join(root, 'src/weapons'),
        }));
      },
    }] });
  modules.push(await import(pathToFileURL(outfile).href));
}
const [current, baseline] = modules;
const move = { speed: 0, sprinting: false, grounded: true };
function fixture(api, id = 'duster') {
  const { THREE, WeaponsController } = api;
  const material = new THREE.MeshStandardMaterial();
  const mat = new Proxy({ painted: () => material, emissive: () => material,
    viewmodel: { sleeve: material, darkGlove: material, gloveDetail: material, woodFurniture: material, parkerizedSteel: material },
  }, { get: (o, p) => o[p] ?? material });
  const claims = [];
  const ctl = new WeaponsController({ camera: new THREE.PerspectiveCamera(72, 16 / 9, .05, 200), scene: new THREE.Scene(), mat,
    targets: [], onHud() {}, onShot: (shot) => claims.push(shot), carbineCanary: false, heroesCanary: false });
  ctl.command('switch', id);
  ctl.update(0, 1, move);
  return { ctl, claims, close() { ctl.dispose(); material.dispose(); } };
}
const old = fixture(baseline), fresh = fixture(current);
old.ctl.pointerDown(0, 1800); fresh.ctl.pointerDown(0, 1800);
assert.equal(old.claims[0].time, 1000, 'retained implementation reproduces stale-frame input');
assert.equal(fresh.claims[0].time, 1800, 'native input stamps admission instant despite 800ms stalled frame');
assert.equal(fresh.ctl.nowMs, 1000, 'fresh input does not move the frame clock');
const mag = fresh.ctl.snapshot().mag;
fresh.ctl.pointerUp(0); fresh.ctl.pointerDown(0, 5000);
assert.equal(fresh.claims.length, 1, 'fresh timestamp cannot bypass cooldown');
assert.equal(fresh.ctl.snapshot().mag, mag, 'rejected cooldown consumes no ammo');
old.close(); fresh.close();
for (const value of [undefined, NaN, Infinity, -Infinity, -1, 999]) {
  const f = fixture(current); f.ctl.pointerDown(0, value);
  assert.equal(f.claims[0].time, 1000, 'default/invalid/past input retains monotonic virtual frame clock');
  f.close();
}
const qa = fixture(current);
assert.equal(qa.ctl.command('fire'), true);
assert.equal(qa.claims[0].time, 1000, 'QA command fire deliberately remains on virtual time');
qa.close();
function burst(api, inputAtMs) {
  const f = fixture(api, 'machine-pistol');
  f.ctl.pointerDown(0, inputAtMs);
  let time = 1;
  for (const dt of [.05, .05, .05, .05, .04, .016, .044]) {
    time += dt; f.ctl.update(dt, time, move);
  }
  f.ctl.pointerUp(0);
  const result = { claims: f.claims.map(({ time, seq, weaponId }) => ({ time, seq, weaponId })),
    mag: f.ctl.snapshot().mag, shots: f.ctl.snapshot().shotsFired, autoTimer: f.ctl.autoTimer };
  f.close(); return result;
}
const before = burst(baseline), after = burst(current);
assert.deepEqual(after, before, 'automatic scheduling, cadence, sequence and ammo exactly match retained controller');
for (const input of [NaN, Infinity, -1, 999, 1000]) {
  assert.deepEqual(burst(current, input), before, 'invalid/past/frame-time input keeps exact virtual auto semantics');
}
assert(after.claims.length >= 5, 'actual automatic update loop exercised');
for (let i = 1; i < after.claims.length; i++) {
  assert(Math.abs(after.claims[i].time - after.claims[i - 1].time - 55) < 1e-7, 'owed shots preserve 55ms schedule');
}
assert(Math.abs(after.claims[1].time - 1055) < 1e-7, '1100ms frame backdates owed shot to 1055ms');
const nativeAuto = fixture(current, 'machine-pistol');
nativeAuto.ctl.pointerDown(0, 1800);
nativeAuto.ctl.update(.05, 1.810, move);
nativeAuto.ctl.update(.016, 1.826, move);
assert.deepEqual(nativeAuto.claims.map((c) => c.time), [1800], 'pre-input frame time cannot produce former too-soon1815ms shot');
for (const [dt, at] of [[.020, 1.846], [.020, 1.866], [.030, 1.896], [.040, 1.936], [.040, 1.976]]) {
  nativeAuto.ctl.update(dt, at, move);
}
const nativeAutoClaims = nativeAuto.claims.map((c) => c.time);
assert(nativeAutoClaims.length >= 4, 'native automatic continuation exercised');
for (let i = 1; i < nativeAutoClaims.length; i++) {
  assert(Math.abs(nativeAutoClaims[i] - nativeAutoClaims[i - 1] - 55) < 1e-7, 'native first and subsequent automatic shots preserve55ms cadence');
}
nativeAuto.close();
const future = fixture(current, 'machine-pistol');
future.ctl.pointerDown(0, 1800);
future.ctl.update(.05, 1.5, move); future.ctl.update(.05, 1.78, move);
assert.equal(future.ctl.autoInputAtMs, 1800, 'pending input retained until frame clock reaches it');
assert.equal(future.ctl.coolInputAtMs, 1800, 'future cooldown edge also retained');
assert.equal(future.claims.length, 1, 'future input does not borrow earlier updates');
future.ctl.update(.05, 1.810, move);
assert.equal(future.ctl.autoInputAtMs, null);
assert.equal(future.ctl.coolInputAtMs, null);
assert.equal(future.claims.length, 1);
future.close();
for (const cancel of ['up', 'pause', 'switch']) {
  const f = fixture(current, 'machine-pistol'); f.ctl.pointerDown(0, 1800);
  if (cancel === 'up') f.ctl.pointerUp(0);
  if (cancel === 'pause') { f.ctl.setVisible(false); f.ctl.setVisible(true); }
  if (cancel === 'switch') f.ctl.command('switch', 'duster');
  assert.equal(f.ctl.autoInputAtMs, null, `${cancel} clears native clock edge`);
  assert.equal(f.ctl.coolInputAtMs, cancel === 'up' ? 1800 : null, 'release preserves shot cooldown; pause/switch clear it');
  f.ctl.update(.05, 1.81, move); f.ctl.update(.05, 1.9, move);
  assert.equal(f.claims.length, 1, `${cancel} prevents phantom automatic continuation`);
  f.close();
}
function semiRelease(api, removeBoundary = false) {
  const f = fixture(api, 'duster'); f.ctl.pointerDown(0, 1800); f.ctl.pointerUp(0);
  if (removeBoundary) f.ctl.coolInputAtMs = null; // negative control for the reproduced missing protection
  f.ctl.update(.05, 1.810, move); f.ctl.update(.05, 1.860, move); f.ctl.update(.020, 1.880, move);
  const beforeAttempt = f.ctl.snapshot().mag;
  f.ctl.pointerDown(0, 1880); f.ctl.pointerUp(0);
  const early = f.claims.map((c) => c.time);
  const afterAttempt = f.ctl.snapshot().mag;
  if (!removeBoundary) {
    assert.equal(afterAttempt, beforeAttempt, 'too-soon native semi press spends no ammo');
    f.ctl.update(.041, 1.921, move); f.ctl.pointerDown(0, 1921);
  }
  const result = { early, final: f.claims.map((c) => c.time) }; f.close(); return result;
}
assert.deepEqual(semiRelease(current, true).early, [1800, 1880], 'negative control reproduces80ms Duster spacing against120ms interval');
const semi = semiRelease(current);
assert.deepEqual(semi.early, [1800], 'pointerUp cannot erase first-shot cooldown boundary');
assert.deepEqual(semi.final, [1800, 1921], 'native semi resumes after full120ms cooldown');
const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
assert(main.includes('weapons.pointerDown(e.button, performance.now())'), 'actual native handler supplies monotonic clock');
const receipt = { status: 'PASS', baselineRef, staleFrameMs: 1000, nativeInputMs: 1800,
  qaClock: 'virtual frame time unchanged', autoClaims: after.claims, nativeAutoClaims, nativeSemiClaims: semi.final, hostThresholds: 'unchanged' };
writeFileSync(join(folder, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
