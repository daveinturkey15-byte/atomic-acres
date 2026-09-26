/** CPU replay of actual controller + canonical host weapon state. No renderer,
 * browser, transport, fabricated live rewards or gameplay acceptance. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'aa-weapon-state-client-'));
const outfile = join(temp, 'actual.mjs');
await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
export * as THREE from 'three';
export { WeaponsController } from './src/weapons/controller';
export { WeaponStateClient } from './src/weapons/weapon-state-client';
export { HostWeaponState, RAIL_CHARGE_MS } from './src/game/host-weapon-state';
export { initHud } from './src/ui/hud';
` }, outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{
  name: 'defer-unrelated-art-network', setup(builder) {
    builder.onLoad({ filter: /reference-weapon-models\.ts$/ }, () => ({ loader: 'ts', contents:
      `export const REFERENCE_WEAPON_IDS=[];export const REFERENCE_SOCKETS=[];export async function loadReferenceWeaponRig(){throw Error('No art network in CPU proof');}` }));
  },
}] });
const { THREE, WeaponsController, WeaponStateClient, HostWeaponState, RAIL_CHARGE_MS, initHud } = await import(pathToFileURL(outfile).href);
const checks = [];
const pass = label => { checks.push(label); console.log(`PASS ${label}`); };
const move = { speed: 0, sprinting: false, grounded: true };
function fixture(id = 'railgun', contents) {
  const material = new THREE.MeshStandardMaterial();
  const mat = new Proxy({ painted: () => material, emissive: () => material,
    viewmodel: { sleeve: material, darkGlove: material, gloveDetail: material, woodFurniture: material, parkerizedSteel: material } },
  { get: (o, p) => o[p] ?? material });
  let now = 1000, intentSeq = 0;
  const host = new HostWeaponState(1, id, 'magnum');
  if (contents) host.replacePrimary({ weaponId: id, ...contents }, now);
  const intents = [], shots = [];
  const ctl = new WeaponsController({ camera: new THREE.PerspectiveCamera(72), scene: new THREE.Scene(), mat,
    targets: [], onHud() {}, carbineCanary: false, heroesCanary: false,
    localLoadout: () => ({ primary: id, sidearm: 'magnum', grenade: 'flash' }),
    onWeaponIntent(request) {
      intentSeq = Math.max(intentSeq, host.snapshot(now).lastIntentSeq);
      const intent = { ...request, seq: ++intentSeq, life: 1 };
      const result = host.intent(intent, now, { active: true, alive: true, possessing: false, busy: false });
      intents.push({ intent, result, at: now }); return intent.seq;
    },
    onShot(claim) { const reason = host.spend(claim.weaponId, claim.time, now); host.acknowledgeShot(claim.seq); shots.push({ claim, reason }); },
  });
  ctl.applyWeaponState(host.snapshot(now), now); ctl.update(0, now / 1000, move);
  return { ctl, host, intents, shots,
    get now() { return now; },
    deliver() { return ctl.applyWeaponState(host.snapshot(now), now); },
    advance(ms, deliver = true) {
      const end = now + ms;
      while (now < end) { const dt = Math.min(50, end - now); now += dt;
        if (deliver) ctl.applyWeaponState(host.snapshot(now), now); ctl.update(dt / 1000, now / 1000, move); }
    },
    down() { ctl.pointerDown(0, now); }, up() { ctl.pointerUp(0); },
    close() { ctl.dispose(); material.dispose(); },
  };
}

const early = fixture();
assert.equal(early.ctl.command('fire'), false, 'Rail QA instant fire cannot bypass native charge');
early.down(); assert.equal(early.shots.length, 0); early.advance(100);
assert(early.ctl.hud.charging && early.ctl.hud.chargeProgress > 0 && early.ctl.hud.chargeProgress < 1);
early.up(); early.advance(1000);
assert.equal(early.shots.length, 0); assert.equal(early.host.primary.mag, 4);
assert(early.intents.some(i => i.intent.action === 'cancel'));
early.close(); pass('early native release cancels acknowledged charge without ammo or shot');

const full = fixture(); full.down(); full.advance(RAIL_CHARGE_MS - 1);
assert.equal(full.shots.length, 0); full.advance(1);
assert.equal(full.shots.length, 1); assert.equal(full.shots[0].reason, null);
assert.equal(full.host.primary.mag, 3); full.advance(2500);
assert.equal(full.shots.length, 1, 'holding cannot repeat or begin another paid charge');
full.up(); full.down(); full.advance(RAIL_CHARGE_MS);
assert.equal(full.shots.length, 2); assert.equal(full.shots[1].reason, null);
full.close(); pass('750ms host-admitted hold fires once; second shot requires a new press');

const unacked = fixture(); unacked.down(); unacked.advance(1000, false);
assert.equal(unacked.shots.length, 0); assert.equal(unacked.ctl.hud.chargeProgress, 0);
unacked.up(); unacked.deliver(); unacked.advance(200);
assert.equal(unacked.shots.length, 0); unacked.close(); pass('no host start acknowledgment means no locally manufactured charge completion');

const unready = fixture(); unready.down(); unready.advance(700); unready.advance(200, false);
assert.equal(unready.ctl.hud.chargeProgress, 1, 'visual progress can interpolate the recent host level');
assert.equal(unready.shots.length, 0, 'interpolated full bar cannot replace actual host-ready acknowledgement');
unready.deliver(); unready.ctl.update(0, unready.now / 1000, move);
assert.equal(unready.shots.length, 1); assert.equal(unready.shots[0].reason, null);
unready.close(); pass('full projected charge waits for the actual host-ready level before firing');

for (const action of ['hidden', 'switch', 'cancel', 'spawn', 'clear', 'dispose']) {
  const f = fixture(); f.down(); f.advance(200);
  if (action === 'hidden') { f.ctl.setVisible(false); f.ctl.setVisible(true); }
  if (action === 'switch') f.ctl.keyDown('Digit2');
  if (action === 'cancel') f.ctl.cancelWeaponAction();
  if (action === 'spawn') f.ctl.onSelfSpawn('railgun', 24, 'magnum', 42);
  if (action === 'clear') f.ctl.clearWeaponState();
  if (action === 'dispose') f.ctl.dispose();
  if (action !== 'dispose') f.advance(1000);
  assert.equal(f.shots.length, 0, `${action} cannot discharge the old hold`);
  assert(f.intents.some(i => i.intent.action === 'cancel')); f.close();
}
pass('menu/possession visibility, switch, cancel, spawn, unbind and disposal clear held charge');

const resumed = fixture();
resumed.host.intent({ seq: 50, life: 1, weaponId: 'railgun', action: 'charge-start' }, resumed.now,
  { active: true, alive: true, possessing: false, busy: false });
resumed.advance(800);
assert.equal(resumed.shots.length, 0); assert(!resumed.ctl.hud.charging);
assert.equal(resumed.host.snapshot(resumed.now).primary.chargeElapsedMs, null);
resumed.close(); pass('retained host charge without local native hold never auto-fires');

const refused = fixture();
refused.host.intent({ seq: 50, life: 1, weaponId: 'railgun', action: 'charge-start' }, refused.now,
  { active: true, alive: true, possessing: false, busy: false });
refused.down(); assert.equal(refused.intents.at(-1).result.reason, 'busy'); refused.advance(800);
assert.equal(refused.shots.length, 0); assert(!refused.ctl.hud.charging);
assert.equal(refused.host.snapshot(refused.now).primary.chargeElapsedMs, null);
refused.close(); pass('explicitly refused new charge cannot inherit an older host charge ticket');

const delayed = fixture(); delayed.down();
const oldCharge = delayed.host.snapshot(delayed.now);
delayed.up(); delayed.down(); delayed.advance(1000, false);
delayed.ctl.applyWeaponState(oldCharge, delayed.now); delayed.ctl.update(.05, delayed.now / 1000, move);
assert.equal(delayed.shots.length, 0, 'earlier press acknowledgement cannot complete a different held press');
assert.equal(delayed.ctl.hud.chargeProgress, 0);
delayed.advance(50); assert.equal(delayed.shots.length, 1); assert.equal(delayed.shots[0].reason, null);
delayed.close(); pass('late prior-press charge acknowledgement cannot fire the new press');

const reload = fixture('m4a1', { mag: 2, reserve: 4 });
reload.down(); reload.up(); reload.advance(300); reload.down(); reload.up(); reload.advance(100);
assert.equal(reload.host.primary.mag, 0); assert.equal(reload.shots.length, 2);
assert.equal(reload.ctl.command('reload'), true);
const started = reload.host.snapshot(reload.now); assert(started.primary.reloadRemainingMs > 0);
reload.deliver(); reload.advance(started.primary.reloadRemainingMs + 100, false);
assert.equal(reload.ctl.snapshot().mag, 0, 'local timer expiry cannot move reserve into magazine');
assert.equal(reload.ctl.snapshot().reserve, 4); assert(reload.ctl.snapshot().reloading);
assert.equal(reload.ctl.command('fire'), false);
reload.deliver(); assert.equal(reload.ctl.snapshot().mag, 4); assert.equal(reload.ctl.snapshot().reserve, 0);
assert(!reload.ctl.snapshot().reloading);
assert.equal(reload.ctl.applyWeaponState(started, reload.now), false, 'stale reload packet cannot roll back completed state');
reload.ctl.adoptWeapon('m4a1', 999, 'magnum', 999);
assert.equal(reload.ctl.snapshot().mag, 4); assert.equal(reload.ctl.snapshot().reserve, 0);
assert.equal(reload.ctl.grantRounds('m4a1', 999), false, 'total-only grant cannot double-credit canonical reserve');
reload.close(); pass('ordinary dry reload finishes only from host magazine/reserve, never by client repacking');

// Actual controller lifecycle: browser control loss is not an explicit reload cancel.
for (const acknowledged of [false, true]) {
  const f = fixture('m4a1', { mag: 2, reserve: 4 });
  assert.equal(f.ctl.command('reload'), true);
  const started = f.host.snapshot(f.now); assert(started.primary.reloadRemainingMs > 0);
  if (acknowledged) f.deliver();
  const beforeIntents = f.intents.length;
  (f.ctl.releaseWeaponInput ?? f.ctl.cancelWeaponAction).call(f.ctl);
  assert.equal(f.intents.length, beforeIntents, 'focus/lock loss must not send a reload cancellation');
  assert.equal(f.host.snapshot(f.now).primary.reloadRemainingMs, started.primary.reloadRemainingMs);
  f.advance(started.primary.reloadRemainingMs + 100);
  assert.equal(f.host.primary.mag, 6); assert.equal(f.host.primary.reserve, 0);
  assert.equal(f.ctl.snapshot().mag, 6); assert(!f.ctl.snapshot().reloading);
  f.close();
}

const staleChargeReload = fixture(); staleChargeReload.down(); staleChargeReload.advance(750); staleChargeReload.up(); staleChargeReload.down(); staleChargeReload.advance(100);
assert(staleChargeReload.ctl.command('reload'));
const pendingReloadCount = staleChargeReload.intents.length;
const priorReloadShots = staleChargeReload.shots.length;
staleChargeReload.ctl.releaseWeaponInput();
assert.equal(staleChargeReload.intents.length, pendingReloadCount, 'stale charge cannot cancel a newer pending reload');
const pendingReloadState = staleChargeReload.host.snapshot(staleChargeReload.now);
assert(pendingReloadState.primary.reloadRemainingMs > 0);
staleChargeReload.advance(pendingReloadState.primary.reloadRemainingMs + 1);
assert.equal(staleChargeReload.shots.length, priorReloadShots); staleChargeReload.close();
const pendingChargeRelease = fixture(); pendingChargeRelease.down();
pendingChargeRelease.ctl.releaseWeaponInput(); pendingChargeRelease.advance(1000);
assert.equal(pendingChargeRelease.shots.length, 0);
assert.equal(pendingChargeRelease.host.snapshot(pendingChargeRelease.now).primary.chargeElapsedMs, null);
pendingChargeRelease.close();
pass('focus/lock loss preserves acknowledged or pending host reload and exact ammunition transfer');

for (const mode of ['release', 'dispose']) {
  const f = fixture(); f.down(); f.advance(200);
  if (mode === 'release') (f.ctl.releaseWeaponInput ?? f.ctl.cancelWeaponAction).call(f.ctl);
  else f.ctl.dispose();
  assert.equal(f.host.snapshot(f.now).primary.chargeElapsedMs, null);
  assert(f.intents.some(i => i.intent.action === 'cancel'));
  if (mode === 'release') f.advance(1000);
  assert.equal(f.shots.length, 0); f.close();
}
const lostAuto = fixture('m4a1'); lostAuto.down(); lostAuto.advance(100);
(lostAuto.ctl.releaseWeaponInput ?? lostAuto.ctl.cancelWeaponAction).call(lostAuto.ctl);
const stoppedShots = lostAuto.shots.length; lostAuto.advance(1000);
assert.equal(lostAuto.shots.length, stoppedShots); lostAuto.close();
const lostDocument = fixture('m4a1', { mag: 2, reserve: 4 });
lostDocument.ctl.command('reload'); const documentReload = lostDocument.host.snapshot(lostDocument.now);
lostDocument.ctl.dispose(); lostDocument.host.advance(lostDocument.now + documentReload.primary.reloadRemainingMs + 1);
assert.equal(lostDocument.host.primary.mag, 6); assert.equal(lostDocument.host.primary.reserve, 0);
lostDocument.close();
pass('input release/disposal cancel paid charge and held automatic fire but retain document-independent reload');

const equip = fixture('m4a1'); equip.ctl.keyDown('Digit2');
assert.equal(equip.ctl.snapshot().id, 'magnum'); assert.equal(equip.ctl.command('fire'), false);
equip.deliver(); assert.equal(equip.ctl.command('fire'), true);
assert.equal(equip.shots.at(-1).claim.weaponId, 'magnum'); assert.equal(equip.shots.at(-1).reason, null);
equip.close(); pass('predicted slot switch waits for actual host equip before firing sidearm');

const projection = new WeaponStateClient(), host = new HostWeaponState(1, 'm4a1', 'magnum');
const state = host.snapshot(1000); projection.apply(state); projection.predictShot(1, 'm4a1'); projection.predictShot(3, 'm4a1');
const seq3 = { ...state, at: 1100, revision: 2, lastShotSeq: 3, resolvedShotSeqs: [3], primary: { ...state.primary, mag: state.primary.mag - 1 } };
projection.apply(seq3);
assert.equal(projection.pendingShots, 1); assert.equal(projection.project('m4a1', 1100).mag, state.primary.mag - 2);
projection.apply({ ...seq3, at: 1200, revision: 3, resolvedShotSeqs: [3, 1], primary: { ...state.primary, mag: state.primary.mag - 2 } });
assert.equal(projection.pendingShots, 0); projection.predictShot(5, 'm4a1');
projection.apply({ ...seq3, at: 1300, revision: 4, resolvedShotSeqs: [3, 1, 5], primary: { ...state.primary, mag: state.primary.mag - 2 } });
assert.equal(projection.project('m4a1', 1300).mag, state.primary.mag - 2, 'explicit refusal restores predicted round');
assert(!projection.apply(seq3)); assert(!projection.fresh(3001));
projection.predictShot(6, 'm4a1'); projection.apply({ ...state, life: 2, at: 1400, revision: 0 });
assert.equal(projection.pendingShots, 0); assert(!projection.apply({ ...state, at: 1500, revision: 99 }));
pass('exact unordered shot acknowledgments, refusals, stale levels and life epochs reconcile honestly');

// A changed guest/host clock offset can move a newer host revision backwards
// in the local clock domain. Authority ordering must still settle its exact
// shot acknowledgment; elapsed-time guards continue to use the supplied clock.
const clockOrder = new WeaponStateClient(), clockHost = new HostWeaponState(1, 'm4a1', 'magnum');
const beforeOffset = clockHost.snapshot(1000);
assert(clockOrder.apply(beforeOffset)); clockOrder.predictShot(8, 'm4a1');
assert.equal(clockHost.spend('m4a1', 1100, 1100), null); clockHost.acknowledgeShot(8);
const afterOffset = { ...clockHost.snapshot(1100), at: 900 };
assert(clockOrder.apply(afterOffset), 'higher host revision must survive a backwards localized clock correction');
assert.equal(clockOrder.pendingShots, 0, 'newer exact acknowledgment settles its own predicted debit');
assert.equal(clockOrder.project('m4a1', 1000).mag, beforeOffset.primary.mag - 1);
assert(!clockOrder.apply({ ...beforeOffset, at: 5000 }), 'later local time cannot revive a lower host revision');
assert(!clockOrder.apply({ ...afterOffset, at: 899 }), 'equal revision with older local time stays stale');
assert(!clockOrder.apply(afterOffset), 'equal revision and timestamp remain a duplicate');
assert(clockOrder.apply({ ...afterOffset, at: 901 }), 'newer timestamp can refresh an unchanged revision');
assert(!clockOrder.fresh(2502), 'receive ordering cannot extend the unchanged 1500ms freshness window');
pass('higher host revision survives offset correction while stale revisions and freshness remain fenced');

// Real HUD construction/setters with a minimal DOM double. This checks the
// existing weapon poll cannot erase the new action readout and that steady
// updates allocate no nodes or redundant text/class writes. It is not layout.
let nodes = 0, textWrites = 0, classWrites = 0;
class Element {
  children = []; className = ''; attributes = new Map(); text = '';
  style = { setProperty() {} };
  constructor(tag) {
    this.tagName = tag.toUpperCase(); nodes++;
    const change = (name, add) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      if (add) set.add(name); else set.delete(name);
      this.className = [...set].join(' '); classWrites++;
    };
    this.classList = { add: (...names) => names.forEach(n => change(n, true)),
      remove: (...names) => names.forEach(n => change(n, false)), toggle: change,
      contains: name => this.className.split(/\s+/).includes(name) };
  }
  set textContent(text) { this.text = String(text); textWrites++; }
  get textContent() { return this.text; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  getContext() { return null; }
  querySelectorAll() { return this.children.filter(e => e.tagName === 'DIV'); }
}
const domRoot = new Element('div');
globalThis.document = { getElementById: id => id === 'hud' ? domRoot : null, createElement: tag => new Element(tag) };
globalThis.addEventListener = () => {};
const hud = initHud();
const findClass = (node, name) => node.classList.contains(name) ? node : node.children.map(n => findClass(n, name)).find(Boolean);
const status = findClass(domRoot, 'hud-reload'); assert(status);
const idle = { charging: false, chargeProgress: 0, reloading: false, reloadRemainingMs: 0, actionPending: false };
hud.setWeaponAction({ ...idle, charging: true, actionPending: true });
assert.equal(status.textContent, 'CHARGE REQUESTED'); assert(!status.classList.contains('hud-reload-hidden'));
const half = { ...idle, charging: true, chargeProgress: .5 };
hud.setWeaponAction(half); assert.equal(status.textContent, 'CHARGING 50%');
hud.setWeapon('Railgun', false); assert(!status.classList.contains('hud-reload-hidden'));
const beforeSteady = { nodes, textWrites, classWrites };
for (let i = 0; i < 1000; i++) { hud.setWeaponAction(half); hud.setWeapon('Railgun', false); }
assert.deepEqual({ nodes, textWrites, classWrites }, beforeSteady);
hud.setWeaponAction({ ...idle, reloading: true, reloadRemainingMs: 1500 }); assert.equal(status.textContent, 'RELOADING 1.5s');
hud.setWeaponAction({ ...idle, reloading: true }); assert.equal(status.textContent, 'RELOADING…');
hud.setWeaponAction(idle); assert(status.classList.contains('hud-reload-hidden')); assert.equal(nodes, beforeSteady.nodes);
delete globalThis.document; delete globalThis.addEventListener;
pass('actual HUD preserves charge through legacy weapon polling, waits for reload ack and makes zero steady DOM writes');

const report = { status: 'PASS_CPU_ONLY', scope: 'Actual controller + HostWeaponState; no browser/transport/damage/render acceptance', checks,
  sourceHashes: Object.fromEntries(['src/weapons/controller.ts', 'src/weapons/weapon-state-client.ts', 'src/game/host-weapon-state.ts', 'src/weapons/types.ts', 'src/ui/hud.ts']
    .map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])), at: new Date().toISOString() };
writeFileSync(join(temp, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, report: join(temp, 'report.json') }));
