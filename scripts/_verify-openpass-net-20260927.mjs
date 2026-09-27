/** Actual-source CPU falsifiers for definite non-send and clock/epoch ordering.
 * No browser, wall-clock refunds, host threshold changes or runtime monkeypatches. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const reportPath = process.argv[2];
assert(reportPath, 'Supply a unique report path; receipts never overwrite');
const temp = mkdtempSync(join(tmpdir(), 'aa-openpass-net-'));
const outfile = join(temp, 'actual.mjs');
await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
export * as THREE from 'three';
export { WeaponsController } from './src/weapons/controller';
export { WeaponStateClient } from './src/weapons/weapon-state-client';
export { HostWeaponState } from './src/game/host-weapon-state';
export { GameClient } from './src/game/client';
export { createRtcTransport } from './src/net/rtc';
export { createLocalMatch } from './src/game/session';
export { HostRoom, GuestClient } from './src/net/room';
export { createGuestDriver } from './src/net/match-guest';
export { createHostDriver } from './src/net/match-host';
export { createSoloDriver } from './src/game/session-solo';
export { createSessionLog } from './src/game/session-log';
export { DEFAULT_SOLO_SETUP } from './src/game/rules';
` }, outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{
  name: 'exclude-art-network', setup(builder) {
    builder.onLoad({ filter: /reference-weapon-models\.ts$/ }, () => ({ loader: 'ts', contents:
      `export const REFERENCE_WEAPON_IDS=[];export const REFERENCE_SOCKETS=[];export async function loadReferenceWeaponRig(){throw Error('CPU only');}` }));
  },
}] });
const api = await import(pathToFileURL(outfile).href), checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { checks.push({ name, status: 'FAIL', error: error.stack }); console.log('FAIL ' + name + '\n' + error.stack); }
}
const move = { speed: 0, sprinting: false, grounded: true };
function controller(onShot) {
  const material = new api.THREE.MeshStandardMaterial();
  const mat = new Proxy({ painted: () => material, emissive: () => material,
    viewmodel: { sleeve: material, darkGlove: material, gloveDetail: material, woodFurniture: material, parkerizedSteel: material } },
    { get: (o, p) => o[p] ?? material });
  const camera = new api.THREE.PerspectiveCamera(72);
  const ctl = new api.WeaponsController({ camera, scene: new api.THREE.Scene(), mat,
    targets: [], onHud() {}, carbineCanary: false, heroesCanary: false,
    localLoadout: () => ({ primary: 'm4a1', sidearm: 'magnum', grenade: 'flash' }),
    onWeaponIntent() { return 1; }, onShot });
  return { ctl, camera, close() { ctl.dispose(); material.dispose(); } };
}

await check('definite non-send cancels only that predicted debit and emits no firing presentation', () => {
  const host = new api.HostWeaponState(1, 'm4a1', 'magnum'), claims = [];
  let result = false;
  const f = controller(c => { claims.push(c); return result; });
  try {
    f.ctl.applyWeaponState(host.snapshot(1000), 1000); f.ctl.update(0, 1, move);
    const before = f.ctl.snapshot();
    assert.equal(f.ctl.command('fire'), false, 'definitely unsent trigger is refused locally');
    f.ctl.applyWeaponState(host.snapshot(1100), 1100);
    assert.equal(f.ctl.snapshot().mag, before.mag, 'same host level must not retain an impossible ACK debit');
    assert.equal(f.ctl.snapshot().shotsFired, before.shotsFired, 'unsent round gets no shot presentation count');
    f.ctl.update(.2, 1.2, move); result = true;
    assert.equal(f.ctl.command('fire'), true); assert.equal(claims.length, 2);
    assert.equal(claims[1].seq, claims[0].seq, 'definitely unsent sequence is reusable; no accepted sequence is recycled');
    assert.equal(f.ctl.snapshot().mag, before.mag - 1);
    f.ctl.applyWeaponState(host.snapshot(1300), 1300);
    assert.equal(f.ctl.snapshot().mag, before.mag - 1, 'accepted but not ACKed cannot be refunded by a level or timeout');
    assert.equal(host.spend('m4a1', 1200, 1300), null); host.acknowledgeShot(claims[1].seq);
    f.ctl.applyWeaponState(host.snapshot(1301), 1301);
    assert.equal(f.ctl.snapshot().mag, before.mag - 1, 'exact host ACK settles one debit');
  } finally { f.close(); }
});

await check('void-compatible callers remain accepted and exact ACK gaps/life fences remain intact', () => {
  const host = new api.HostWeaponState(1, 'm4a1', 'magnum'), f = controller(() => undefined);
  try { f.ctl.applyWeaponState(host.snapshot(1000), 1000); f.ctl.update(0, 1, move);
    assert.equal(f.ctl.command('fire'), true); assert.equal(f.ctl.snapshot().mag, 29);
  } finally { f.close(); }
  const p = new api.WeaponStateClient(), s = host.snapshot(1000); p.apply(s);
  p.predictShot(2, 'm4a1'); p.predictShot(4, 'm4a1');
  p.apply({ ...s, revision: 1, at: 1100, lastShotSeq: 4, resolvedShotSeqs: [4] });
  assert.equal(p.pendingShots, 1, 'high-water ACK must not retire a missing lower sequence');
  assert(!p.apply({ ...s, revision: 0, at: 1200 }));
  p.apply({ ...s, life: 2, at: 1300 }); assert.equal(p.pendingShots, 0);
  assert(!p.apply({ ...s, revision: 999, at: 9000 })); assert(!p.fresh(2900));
  p.predictShot(6, 'm4a1'); p.predictShot(7, 'm4a1');
  p.cancelUnsentShot(7); assert.equal(p.pendingShots, 1, 'definite refusal must preserve a different in-flight sequence');
  p.cancelUnsentShot(7); assert.equal(p.pendingShots, 1, 'duplicate non-send notice cannot refund another sequence');
  assert.equal(p.project('m4a1', 90000).mag, 29, 'even a very old unacknowledged accepted shot is never timeout-refunded');
});

await check('actual RTC reports synchronous failure, preserves queued acceptance and unreliable routing', async () => {
  const saved = { EventSource: globalThis.EventSource, RTCPeerConnection: globalThis.RTCPeerConnection, fetch: globalThis.fetch };
  const channels = [], sources = [];
  class Channel { constructor(label) { this.label = label; this.readyState = 'connecting'; this.sent = []; }
    send(s) { if (this.fail) throw Error('deterministic native send failure'); this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 'closed'; } }
  class Peer { connectionState = 'new'; createDataChannel(label) { const ch = new Channel(label); channels.push(ch); return ch; }
    async createOffer() { return { sdp: 'fixture', type: 'offer' }; } async setLocalDescription() {} close() {} }
  class Events { constructor() { sources.push(this); } addEventListener(name, fn) { this[name] = fn; } close() {} }
  globalThis.RTCPeerConnection = Peer; globalThis.EventSource = Events; globalThis.fetch = async () => ({ ok: true });
  let rtc;
  try {
    rtc = api.createRtcTransport({ role: 'guest', code: 'ABC234', signalUrl: 'http://unused', localId: 'g' });
    sources[0].ready(); await Promise.resolve(); await Promise.resolve();
    const ctl = channels.find(c => c.label === 'ctl'), fast = channels.find(c => c.label === 'fast');
    const shot = { type: 'shot', seq: 1 };
    assert.notEqual(rtc.send('host', shot), false, 'existing early reliable queue is accepted');
    ctl.readyState = 'open'; ctl.onopen(); assert.equal(ctl.sent.length, 1);
    assert.notEqual(rtc.send('host', { ...shot, seq: 2 }), false); assert.equal(ctl.sent.length, 2);
    ctl.fail = true; assert.equal(rtc.send('host', { ...shot, seq: 3 }), false, 'caught native send exception is definitely unsent');
    assert.equal(ctl.sent.length, 2); assert.equal(rtc.stats().dropped, 1);
    assert.equal(rtc.send('missing', shot), false);
    fast.readyState = 'open'; assert.notEqual(rtc.send('host', { type: 'input' }), false); assert.equal(fast.sent.length, 1);
    rtc.close(); assert.equal(rtc.send('host', shot), false);
  } finally { rtc?.close(); Object.assign(globalThis, saved); }
});

await check('epoch clock correction accepts newer host state but rejects pre-epoch, wrong-life and stale revision', () => {
  const client = new api.GameClient('p'), host = new api.HostWeaponState(1, 'm4a1', 'magnum');
  const spawn = { type: 'spawn', actorId: 'p', reason: 'initial', at: 1000, team: 0,
    x: 0, y: 0, z: 0, yaw: 0, protectedUntil: 1000 };
  client.applyEvent(spawn, 1000);
  const source = host.snapshot(1050), localized = { ...source, at: 850 };
  client.applySnapshot({ at: 1050, weaponState: localized, weaponSourceAt: source.at });
  assert.equal(client.weaponState?.at, 850, 'new source after spawn survives +200ms offset adjustment');
  assert.equal(client.weaponState?.life, 1);
  client.applySnapshot({ at: 1060, weaponState: { ...localized, revision: 999, at: 1060 }, weaponSourceAt: 999 });
  assert.equal(client.weaponState.revision, source.revision, 'pre-epoch source cannot bypass fence with a newer local timestamp');
  client.applySnapshot({ at: 1070, weaponState: { ...localized, revision: 999, life: 2 }, weaponSourceAt: 1070 });
  assert.equal(client.weaponState.life, 1, 'future life requires actual spawn');
  client.applySnapshot({ at: 1080, weaponState: { ...localized, revision: 1, at: 800 }, weaponSourceAt: 1080 });
  assert.equal(client.weaponState.revision, 1);
  client.applySnapshot({ at: 1085, weaponState: { ...localized, revision: 1, at: 1000 }, weaponSourceAt: 1079 });
  assert.equal(client.weaponState.at, 800, 'equal revision cannot roll source time back even if localized time looks newer');
  client.applySnapshot({ at: 1086, weaponState: { ...localized, revision: 1, at: 790 }, weaponSourceAt: 1086 });
  assert.equal(client.weaponState.at, 790, 'newer same-revision raw source survives another clock adjustment');
  client.applySnapshot({ at: 1090, weaponState: { ...localized, revision: 0, at: 1090 }, weaponSourceAt: 1090 });
  assert.equal(client.weaponState.revision, 1);
  client.applyEvent({ ...spawn, reason: 'respawn', at: 900 }, 1100);
  client.applySnapshot({ at: 1110, weaponState: { ...localized, revision: 999, life: 1, at: 1110 }, weaponSourceAt: 1110 });
  assert.equal(client.weaponState, null);
  client.applySnapshot({ at: 1120, weaponState: { ...localized, life: 2, at: 820 }, weaponSourceAt: 1120 });
  assert.equal(client.weaponState.life, 2); assert.equal(client.weaponState.at, 820);
});

await check('raw host same-revision ordering survives final ammo projection for charge and reload', () => {
  for (const action of ['charge-start', 'reload']) {
    const id = action === 'charge-start' ? 'railgun' : 'm4a1';
    const host = new api.HostWeaponState(1, id, 'magnum'), client = new api.GameClient('p'), projection = new api.WeaponStateClient();
    if (action === 'reload') assert.equal(host.spend(id, 900, 900), null);
    assert(host.intent({ action, weaponId: id, life: 1, seq: 0 }, 1000, { active: true, alive: true, possessing: false, busy: false }).accepted);
    const first = host.snapshot(1200), second = host.snapshot(1400);
    assert.equal(first.revision, second.revision, 'progress snapshots do not manufacture new host revisions');
    client.applySnapshot({ at: 1200, weaponState: first, weaponSourceAt: 1200 }); assert(projection.apply(client.weaponState));
    client.applySnapshot({ at: 1400, weaponState: { ...second, at: 1000 }, weaponSourceAt: 1400 });
    assert(projection.apply(client.weaponState), 'final projection must use raw host ordering after backwards localized correction');
    assert.equal(projection.state.at, 1000); assert.deepEqual(projection.state.primary, second.primary);
    assert(projection.fresh(1400)); assert(!projection.fresh(2501), 'raw source timestamp must not extend1500ms localized freshness');
    assert(!projection.apply({ ...client.weaponState, at: 1600, sourceAt: 1399 }), 'older raw source cannot refresh same revision');
    assert(!projection.apply(client.weaponState), 'exact duplicate remains stale');
    assert(!projection.apply({ ...client.weaponState, life: 0, revision: 999, sourceAt: 9999 }), 'old life remains stale');
    const newLife = new api.HostWeaponState(2, id, 'magnum').snapshot(1500);
    assert(projection.apply({ ...newLife, at: 1100, sourceAt: 1500 }));
    assert(!projection.apply({ ...client.weaponState, sourceAt: 1600 }), 'last-life progress cannot reappear');
  }
});

await check('actual room/guest driver propagates definite send refusal and raw host epoch through a real pong correction', () => {
  let now = 0, failSend = false; const peers = new Map(), queue = [], disposers = [];
  const oldNow = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  const transport = id => { const handlers = new Set(); const t = { localId: id, closed: false,
    send(to, msg) { if (id === 'g' && failSend && (msg.type === 'shot' || msg.type === 'weapon-intent')) return false;
      queue.push({ from: id, to, msg: structuredClone(msg) }); },
    onMessage(fn) { handlers.add(fn); return () => handlers.delete(fn); }, close() { handlers.clear(); },
    receive(from, msg) { for (const fn of handlers) fn(from, msg); } }; peers.set(id, t); return t; };
  const pump = () => { let n = 0; while (queue.length) { assert(++n < 10000); const q = queue.shift(); peers.get(q.to)?.receive(q.from, q.msg); } };
  const ui = () => ({ bindClient(c) { this.client = c; }, setNames() {}, resetPresentation() {} });
  try {
    const room = new api.HostRoom(transport('host'), { code: 'ABC234', now: () => now }); disposers.push(() => room.dispose());
    const guest = new api.GuestClient(transport('g'), 'host', 'ABC234', 'TEST', { now: () => now,
      localPrimaryId: 'm4a1', localLoadout: () => ({ primary: 'm4a1', sidearm: 'magnum', tactical: 'flash' }) });
    disposers.push(() => guest.dispose()); pump();
    const id = guest.getPlayerId(), world = { inBounds: () => true, groundY: () => 0, lineOfSight: () => true };
    const solo = api.createSoloDriver({ world, ui: ui(), localId: 'host', localName: 'HOST', localPrimaryId: 'm4a1',
      setup: { ...api.DEFAULT_SOLO_SETUP, bots: 0 }, instrument: api.createSessionLog('host') });
    const hd = api.createHostDriver(room, solo, { world }); disposers.push(() => hd.dispose());
    room.setReady(true); guest.setReady(true); pump(); assert.equal(room.start(), null); pump();
    let gd, view = ui();
    for (let i = 0; i < 100; i++) { now += 50; guest.ping(now); pump(); room.tickOnce(now); hd.tick(now, 0, 0, 0, 0, 0); pump();
      if (!gd && guest.getState() === 'playing') { gd = api.createGuestDriver(guest, { ui: view, instrument: api.createSessionLog(id) }); disposers.push(() => gd.dispose()); } }
    assert(gd); assert(view.client.weaponState);
    const own = guest.latestPlayers().find(p => p.id === id), forwarded = [];
    const f = controller(claim => { forwarded.push(claim.seq); return gd.localShot(claim); });
    try {
      f.camera.position.set(own.x, own.y + 1.62, own.z); f.camera.rotation.x = Math.PI / 2;
      f.ctl.applyWeaponState(view.client.weaponState, now); f.ctl.update(0, now / 1000, move);
      const before = solo.weaponStateFor(id, now).primary.mag;
      failSend = true; assert.equal(f.ctl.command('fire'), false);
      assert.equal(f.ctl.snapshot().mag, before); assert.equal(solo.weaponStateFor(id, now).primary.mag, before);
      failSend = false; assert.equal(f.ctl.command('fire'), true); pump();
      assert.equal(solo.weaponStateFor(id, now).primary.mag, before - 1, 'actual admitted sky shot spends one host round');
      f.ctl.applyWeaponState(view.client.weaponState, now);
      assert.equal(f.ctl.snapshot().mag, before - 1, 'full controller/driver/room/host exact ACK settles one round');
      now += 200; hd.tick(now, 0, 0, 0, 0, 0); pump();
      f.ctl.applyWeaponState(view.client.weaponState, now);
      for (let i = 3; i >= 0; i--) f.ctl.update(.05, now / 1000 - i * .05, move);
      const previousForwards = forwarded.length;
      failSend = true;
      for (let i = 0; i < 512; i++) assert.equal(f.ctl.command('fire'), false);
      assert.equal(forwarded.length - previousForwards, 512, 'all512 refusals actually reach send admission');
      assert.equal(f.ctl.snapshot().mag, before - 1);
      failSend = false; assert.equal(f.ctl.command('fire'), true); pump();
      assert.equal(solo.weaponStateFor(id, now).primary.mag, before - 2, 'previous accepted +512 definitely unsent +recovery must fit unchanged real host sequence gap');
      f.ctl.applyWeaponState(view.client.weaponState, now); assert.equal(f.ctl.snapshot().mag, before - 2);
      failSend = true;
      for (let i = 0; i < 512; i++) assert.equal(gd.weaponIntent({ action: 'equip', weaponId: 'm4a1' }), null);
      failSend = false; const intentSeq = gd.weaponIntent({ action: 'equip', weaponId: 'm4a1' }); pump();
      assert.notEqual(intentSeq, null); assert.equal(solo.weaponStateFor(id, now).lastIntentSeq, intentSeq);
      assert.equal(solo.weaponStateFor(id, now).lastIntentReason, null, 'known unsent intents also preserve unchanged host sequence fence');
    } finally { f.close(); }
    const claim = { seq: 1, weaponId: 'm4a1', time: now, origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 1, z: 0 } };
    failSend = true; assert.equal(gd.localShot(claim), false, 'driver exposes refusal, never pretends authority will ACK');
    assert.equal(gd.weaponIntent({ action: 'reload', weaponId: 'm4a1' }), null, 'unsent intent cannot create an acknowledgment wait');
    failSend = false; assert.notEqual(gd.localShot({ ...claim, seq: 2 }), false); pump();
    const spawnAt = now + 50; now = spawnAt;
    peers.get('g').receive('host', { type: 'spawn', e: { type: 'spawn', actorId: id, reason: 'respawn', at: spawnAt,
      team: 1, x: 0, y: 0, z: 0, yaw: 0, protectedUntil: spawnAt } });
    assert.equal(view.client.weaponState, null);
    peers.get('g').receive('host', { type: 'pong', t: now, now: now + 1000 });
    assert.equal(guest.hostClockOffset(), 200, 'real NTP EMA moved offset by200');
    const state = new api.HostWeaponState(2, 'm4a1', 'magnum').snapshot(spawnAt + 50);
    peers.get('g').receive('host', { type: 'weapon-state', actorId: id, state });
    assert.equal(view.client.weaponState?.life, 2, 'actual driver passes raw clock fence metadata');
    assert.equal(view.client.weaponState.at, state.at - 200);
    gd.dispose(); assert.equal(gd.localShot({ ...claim, seq: 3 }), false, 'disposed driver cannot send');
    const idle = api.createLocalMatch({ colliders: [], ui: ui() });
    try { assert.equal(idle.localShot(claim), false, 'idle facade refuses without an authority'); } finally { idle.dispose(); }
  } finally { for (const d of disposers.reverse()) d(); if (oldNow) Object.defineProperty(performance, 'now', oldNow); else delete performance.now; }
});

const paths = ['src/weapons/controller.ts','src/weapons/weapon-state-client.ts','src/game/client.ts',
  'src/net/transport.ts','src/net/rtc.ts','src/net/room-guest.ts','src/net/match-guest.ts',
  'src/game/session.ts','src/game/session-types.ts','src/main.ts','src/weapons/openpass-weapon-rigs.ts',
  'src/game/host-shot.ts','src/game/host-weapon-state.ts'];
const sha256 = path => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const failed = checks.filter(c => c.status === 'FAIL');
writeFileSync(resolve(root, reportPath), JSON.stringify({ status: failed.length ? 'FAILED' : 'PASS',
  scope: 'CPU actual source; hardware/browser acceptance OPEN', checks,
  source: paths.map(path => ({ path, sha256: sha256(path) })), helperSha256: sha256('scripts/_verify-openpass-net-20260927.mjs') }, null, 2) + '\n', { flag: 'wx' });
console.log(`${checks.length - failed.length}/${checks.length} PASS; immutable receipt ${reportPath}`);
if (failed.length) process.exitCode = 1;
