/** CPU virtual-clock proof through actual room, host, drivers and client projection.
 * No browser, GPU, transport server or fabricated gameplay acceptance. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'aa-weapon-wire-'));
const entry = `
export {HostRoom,GuestClient,liveRoomCount,LIVENESS_MS} from './src/net/room';
export {createSoloDriver} from './src/game/session-solo';
export {createHostDriver} from './src/net/match-host';
export {createGuestDriver} from './src/net/match-guest';
export {createSessionLog} from './src/game/session-log';
export {DEFAULT_SOLO_SETUP} from './src/game/rules';
export {GameClient} from './src/game/client';
export {HostWeaponState} from './src/game/host-weapon-state';
export {isNetMessage} from './src/net/protocol';
export {localizeWeaponState,rebaseWeaponShotAcks} from './src/net/event-clock';`;
const output = join(temp, 'proof.mjs');
await build({ stdin: { contents: entry, loader: 'ts', resolveDir: root }, bundle: true, platform: 'node',
  format: 'esm', outfile: output, logLevel: 'silent' });
const api = await import(pathToFileURL(output).href);
let now = 0, checks = 0;
const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
const peers = new Map(), queue = [], delivered = [], close = [];
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
function transport(id) {
  const handlers = new Set();
  const t = { localId: id, send(to, msg) { queue.push({ from: id, to, msg: JSON.parse(JSON.stringify(msg)) }); },
    onMessage(fn) { handlers.add(fn); return () => handlers.delete(fn); }, close() { handlers.clear(); },
    receive(from, msg) { for (const fn of handlers) fn(from, msg); } };
  peers.set(id, t); return t;
}
function pump() {
  let limit = 0;
  while (queue.length) { assert(++limit < 10000); const m = queue.shift(); delivered.push(m); peers.get(m.to)?.receive(m.from, m.msg); }
}
const world = { inBounds: () => true, groundY: () => 0, lineOfSight: () => true };
const ui = () => ({ client: null, bindClient(c) { this.client = c; }, setNames() {}, resetPresentation() {} });
let room, hostDriver, g1, g2, driver1, driver2;
try {
  room = new api.HostRoom(transport('host'), { code: 'ABC234', now: () => now, capacity: 4 }); close.push(() => room.dispose());
  g1 = new api.GuestClient(transport('guest1'), 'host', 'ABC234', 'ALPHA', { now: () => now,
    localLoadout: () => ({ primary: 'railgun', sidearm: 'duster', tactical: 'flash' }), localPrimaryId: 'railgun' });
  g2 = new api.GuestClient(transport('guest2'), 'host', 'ABC234', 'BRAVO', { now: () => now });
  close.push(() => g1.dispose(), () => g2.dispose()); pump();
  const id1 = g1.getPlayerId(), id2 = g2.getPlayerId(); assert(id1 && id2 && id1 !== id2);
  const localUi = ui(), guestUi = ui(), otherUi = ui();
  const solo = api.createSoloDriver({ world, ui: localUi, localId: 'host', localName: 'HOST',
    localPrimaryId: 'mp5', setup: { ...api.DEFAULT_SOLO_SETUP, bots: 0 }, instrument: api.createSessionLog('host') });
  hostDriver = api.createHostDriver(room, solo, { world }); close.push(() => hostDriver.dispose());
  room.setReady(true); g1.setReady(true); g2.setReady(true); pump(); assert.equal(room.start(), null); pump();
  const makeDriver = (guest, view) => api.createGuestDriver(guest, { ui: view, instrument: api.createSessionLog(guest.getPlayerId()) });
  function tick(ms = 50, keepAlive = true) {
    now += ms; if (keepAlive) { g1.ping(now); g2.ping(now); pump(); }
    room.tickOnce(now); hostDriver.tick(now, 0, 0, 0, 0, 0); pump();
    if (!driver1 && g1.getState() === 'playing') { driver1 = makeDriver(g1, guestUi); close.push(() => driver1.dispose()); }
    if (!driver2 && g2.getState() === 'playing') { driver2 = makeDriver(g2, otherUi); close.push(() => driver2.dispose()); }
  }
  for (let n = 0; n < 100; n++) tick();
  assert.equal(solo.snapshot().match.phase, 'active'); assert(driver1 && driver2);
  const state = () => solo.weaponStateFor(id1, now);
  check('actual room and driver publish self-only state plus private inventory', () => {
    assert.equal(guestUi.client.weaponState.primary.weaponId, 'railgun');
    assert.equal(otherUi.client.weaponState.life, 1);
    for (const m of delivered) {
      if (m.msg.type === 'weapon-state') assert.equal(m.msg.actorId, m.to === 'guest1' ? id1 : id2);
      if (m.msg.type === 'ordnance' && m.msg.e.type === 'ordnance-inventory') assert.equal(m.msg.e.actorId, m.to === 'guest1' ? id1 : id2);
      if (m.msg.type === 'state') for (const p of m.msg.players) assert(!('weaponState' in p) && !('rounds' in p));
    }
  });
  check('wire rejects malformed actions, numeric poison, oversize acks and peer-authored state fields', () => {
    const intent = { type: 'weapon-intent', action: 'reload', weaponId: 'railgun', life: 1, seq: 1 };
    assert(api.isNetMessage(intent));
    for (const patch of [{ life: 0 }, { seq: -1 }, { seq: Infinity }, { action: 'instant-reload' }, { at: 1 }, { mag: 999 }, { actorId: id2 }])
      assert(!api.isNetMessage({ ...intent, ...patch }));
    const message = { type: 'weapon-state', actorId: id1, state: state() }; assert(api.isNetMessage(message));
    for (const patch of [{ at: NaN }, { resolvedShotSeqs: Array.from({ length: 65 }, (_, i) => i) },
      { resolvedShotSeqs: [1, 1] }, { activeWeaponId: 'unowned' }, { primary: { ...state().primary, reserve: -1 } }])
      assert(!api.isNetMessage({ ...message, state: { ...message.state, ...patch } }));
  });
  check('peer-authored private state cannot reach authority or another guest projection', () => {
    const before = guestUi.client.weaponState.primary.mag;
    const fake = { type: 'weapon-state', actorId: id1, state: { ...state(), revision: 999,
      primary: { ...state().primary, mag: 999 } } };
    peers.get('guest1').receive('guest2', fake); peers.get('host').receive('guest1', fake); pump();
    assert.equal(guestUi.client.weaponState.primary.mag, before); assert.equal(state().primary.mag, before);
    peers.get('guest1').receive('host', { ...fake, actorId: id2 });
    assert.equal(guestUi.client.weaponState.primary.mag, before);
  });
  check('new intent tags use unchanged reliable ordered RTC control route', () => {
    const rtc = readFileSync(join(root, 'src/net/rtc.ts'), 'utf8');
    assert(rtc.includes("new Set(['input', 'state'])")); assert(rtc.includes("createDataChannel('ctl', { ordered: true })"));
  });
  check('mixed-version hello/resume rejects before seat mutation and never publishes private state', () => {
    const count = room.roster().length, id = g1.getPlayerId();
    for (const capability of [undefined, 0, 2, '1', { version: 1 }]) {
      const peer = 'legacy-' + String(capability); transport(peer); const before = delivered.length;
      peers.get('host').receive(peer, { type: 'hello', code: 'ABC234', name: 'LEGACY', nonce: 'legacy',
        ...(capability === undefined ? {} : { weaponStateProtocol: capability }), resume: g1.identity() }); pump();
      const replies = delivered.slice(before).filter(m => m.to === peer);
      assert(replies.some(m => m.msg.type === 'reject' && m.msg.reason === 'incompatible-build'));
      assert(!replies.some(m => m.msg.type === 'welcome' || m.msg.type === 'weapon-state'));
      assert.equal(room.roster().length, count); assert.equal(g1.getPlayerId(), id);
    }
  });
  check('new guest clearly rejects legacy/wrong welcome only from its expected connecting peer', () => {
    for (const capability of [undefined, 2, '1']) {
      const t = transport('oldhost-probe-' + String(capability));
      const guest = new api.GuestClient(t, 'legacy-host', 'ABC234', 'PROBE', { now: () => now });
      close.push(() => guest.dispose()); queue.length = 0;
      const welcome = { type: 'welcome', playerId: 'fake', hostNow: now, roster: [],
        ...(capability === undefined ? {} : { weaponStateProtocol: capability }) };
      t.receive('stranger', welcome); assert.equal(guest.getState(), 'joining');
      t.receive('legacy-host', welcome); assert.equal(guest.getState(), 'rejected');
      assert.equal(guest.getRejectReason(), 'incompatible-build'); assert.equal(guest.getPlayerId(), null);
      t.receive('legacy-host', { ...welcome, weaponStateProtocol: 1 }); assert.equal(guest.getState(), 'rejected');
    }
  });
  driver1.weaponIntent({ action: 'equip', weaponId: 'duster' });
  const p = room.poseOf(id1), sidearmMag = state().sidearm.mag;
  driver1.localShot({ seq: 0, weaponId: 'duster', time: now,
    origin: { x: p.x, y: p.y + 1.68, z: p.z }, direction: { x: 0, y: 1, z: 0 } });
  const equipPackets = queue.splice(0); queue.push(...equipPackets.reverse()); pump(); tick();
  check('shot reordered before equip cannot spend inactive gun; public body publishes ID only', () => {
    assert.equal(state().sidearm.mag, sidearmMag); assert.equal(state().activeWeaponId, 'duster');
    assert.equal(guestUi.client.weaponState.activeWeaponId, 'duster');
    assert.equal(solo.stampSample({ id: id1, x: 0, y: 0, z: 0, yaw: 0, ack: 0 }).weaponId, 'duster');
  });
  driver1.weaponIntent({ action: 'equip', weaponId: 'railgun' }); pump();
  const start = driver1.weaponIntent({ action: 'charge-start', weaponId: 'railgun' });
  const cancel = driver1.weaponIntent({ action: 'cancel', weaponId: 'railgun' });
  const packets = queue.splice(0), intents = packets.filter(m => m.msg.type === 'weapon-intent');
  queue.push(...packets.filter(m => m.msg.type !== 'weapon-intent'), ...intents.reverse()); pump();
  check('reordered cancel fences delayed start and replay without charging', () => {
    assert(cancel > start); assert.equal(state().lastIntentSeq, cancel); assert.equal(state().primary.chargeElapsedMs, null);
    queue.push(...intents); pump(); assert.equal(state().lastIntentSeq, cancel); assert.equal(state().primary.chargeElapsedMs, null);
  });
  const poseClaim = (seq, weaponId = 'railgun') => {
    const p = room.poseOf(id1); return { seq, weaponId, time: now,
      origin: { x: p.x, y: p.y + 1.68, z: p.z }, direction: { x: 0, y: 1, z: 0 } };
  };
  const mag = state().primary.mag;
  driver1.weaponIntent({ action: 'charge-start', weaponId: 'railgun' }); pump(); tick(200);
  driver1.localShot(poseClaim(1)); pump();
  check('early rail shot remains refused with exact private ack and no ammo spend', () => {
    assert.equal(state().primary.mag, mag); assert(state().resolvedShotSeqs.includes(1));
    assert(guestUi.client.weaponState.resolvedShotSeqs.includes(1));
  });
  tick(600); driver1.localShot(poseClaim(2)); pump();
  check('host-timed full rail hold admits one shot, duplicate cannot spend again', () => {
    assert.equal(state().primary.mag, mag - 1); driver1.localShot(poseClaim(2)); pump(); assert.equal(state().primary.mag, mag - 1);
  });
  driver1.weaponIntent({ action: 'reload', weaponId: 'railgun' }); pump(); tick(150);
  const beforeResume = state(), identity = g1.identity(); assert(beforeResume.primary.reloadRemainingMs > 0); assert(identity);
  const fresh = new api.GuestClient(transport('fresh'), 'host', 'ABC234', 'ALPHA', { now: () => now, resume: identity }); close.push(() => fresh.dispose()); pump();
  const freshUi = ui(), freshDriver = makeDriver(fresh, freshUi); close.push(() => freshDriver.dispose());
  check('authenticated document replacement preserves exact magazines and remaining reload', () => {
    const resumed = fresh.resumeState().weaponState;
    assert.equal(fresh.getPlayerId(), id1); assert.equal(resumed.primary.mag, beforeResume.primary.mag);
    assert.equal(resumed.primary.reserve, beforeResume.primary.reserve);
    assert.equal(resumed.primary.reloadRemainingMs, beforeResume.primary.reloadRemainingMs);
    assert.equal(freshUi.client.weaponState.primary.reloadRemainingMs, beforeResume.primary.reloadRemainingMs);
    assert.deepEqual(freshUi.client.weaponState.resolvedShotSeqs, [], 'old-document shot acknowledgements have no new prediction');
    assert.equal(freshDriver.weaponIntent({ action: 'cancel', weaponId: 'railgun' }), null, 'pose-resume admission fence');
  });
  tick(); fresh.ping(now); pump();
  const next = freshDriver.weaponIntent({ action: 'cancel', weaponId: 'railgun' }); pump();
  check('resumed intent continues above retained seq and old peer cannot control seat', () => {
    assert(next > beforeResume.lastIntentSeq); assert.equal(state().lastIntentSeq, next);
    peers.get('host').receive('guest1', { type: 'weapon-intent', seq: next + 200, life: 1, weaponId: 'railgun', action: 'charge-start' });
    assert.equal(state().lastIntentSeq, next); assert.equal(state().primary.chargeElapsedMs, null);
  });
  freshDriver.weaponIntent({ action: 'charge-start', weaponId: 'railgun' }); pump(); tick(100);
  assert(state().primary.chargeElapsedMs !== null);
  const resume2 = new api.GuestClient(transport('fresh2'), 'host', 'ABC234', 'ALPHA', { now: () => now, resume: fresh.identity() }); close.push(() => resume2.dispose()); pump();
  check('authenticated refresh revokes prior native hold without consuming intent seq or ammo', () => {
    const resumed = resume2.resumeState().weaponState;
    assert.equal(resumed.primary.chargeElapsedMs, null); assert.equal(resumed.primary.mag, mag - 1);
    assert.equal(resumed.lastIntentSeq, state().lastIntentSeq);
  });
  const secondClaim = seq => {
    const p = room.poseOf(id2); return { seq, weaponId: solo.weaponStateFor(id2, now).activeWeaponId, time: now,
      origin: { x: p.x, y: p.y + 1.68, z: p.z }, direction: { x: 0, y: 1, z: 0 } };
  };
  driver2.localShot(secondClaim(9)); pump();
  assert(solo.weaponStateFor(id2, now).resolvedShotSeqs.includes(9));
  driver2.localShot({ ...secondClaim(10), time: now - 1000 }); pump();
  assert(solo.weaponStateFor(id2, now).resolvedShotSeqs.includes(10));
  const bravoResume = new api.GuestClient(transport('bravo-fresh'), 'host', 'ABC234', 'BRAVO',
    { now: () => now, resume: g2.identity() }); close.push(() => bravoResume.dispose()); pump();
  const bravoUi = ui(), bravoDriver = makeDriver(bravoResume, bravoUi); close.push(() => bravoDriver.dispose());
  const resumedBase = Math.max(bravoResume.resumeState().shotSeq, bravoResume.resumeState().weaponState.lastShotSeq) + 1;
  assert.equal(bravoResume.resumeState().shotSeq, 9); assert.equal(resumedBase, 11);
  assert.deepEqual(bravoUi.client.weaponState.resolvedShotSeqs, []);
  tick(250); const bravoMag = solo.weaponStateFor(id2, now).primary.mag;
  bravoDriver.localShot(secondClaim(0)); pump();
  check('resumed controller0 maps above admitted9/refused10 to wire11 and exact private ack0', () => {
    assert(solo.weaponStateFor(id2, now).resolvedShotSeqs.includes(11));
    assert.deepEqual(bravoUi.client.weaponState.resolvedShotSeqs, [0]);
    assert.equal(solo.weaponStateFor(id2, now).primary.mag, bravoMag - 1);
    bravoDriver.localShot(secondClaim(0)); pump(); assert.equal(solo.weaponStateFor(id2, now).primary.mag, bravoMag - 1);
  });
  // Resume2 has no controller; submit the same validated transport intent directly.
  const latest = state(); peers.get('host').receive('fresh2', { type: 'weapon-intent', seq: latest.lastIntentSeq + 1,
    life: latest.life, weaponId: 'railgun', action: 'charge-start' }); pump();
  assert(state().primary.chargeElapsedMs !== null);
  tick(api.LIVENESS_MS + 1, false);
  check('existing room liveness reservation cancels held charge without new watchdog', () => {
    assert.equal(room.roster().find(r => r.id === id1).connected, false); assert.equal(state().primary.chargeElapsedMs, null);
  });
  check('life and revision projections reject stale/reordered data; exact ack gaps survive offset', () => {
    const client = new api.GameClient('p'), source = { ...state(), at: 1000, revision: 10, life: 1, resolvedShotSeqs: [5, 7], lastShotSeq: 7 };
    client.applySnapshot({ at: 1000, weaponState: source });
    client.applySnapshot({ at: 1100, weaponState: { ...source, revision: 9, at: 1100, primary: { ...source.primary, mag: 999 } } });
    assert.equal(client.weaponState.revision, 10);
    const localized = api.localizeWeaponState(source, 20000); assert.equal(localized.at, -19000);
    assert.equal(localized.primary.reloadRemainingMs, source.primary.reloadRemainingMs); assert.equal(source.at, 1000);
    const shifted = api.rebaseWeaponShotAcks(localized, 5); assert.deepEqual(shifted.resolvedShotSeqs, [0, 2]);
    client.applyEvent({ type: 'spawn', actorId: 'p', reason: 'respawn', at: 1200, team: 0, x: 0, y: 0, z: 0, yaw: 0, protectedUntil: 1200 });
    client.applySnapshot({ at: 1300, weaponState: { ...source, revision: 999, at: 1300 } }); assert.equal(client.weaponState, null);
    client.applySnapshot({ at: 1300, weaponState: { ...source, life: 2, revision: 0, at: 1300 } }); assert.equal(client.weaponState.life, 2);
    const authority = new api.HostWeaponState(2, 'railgun', 'duster'), context = { active: true, alive: true, possessing: false, busy: false };
    assert.equal(authority.intent({ seq: 200, life: 1, weaponId: 'railgun', action: 'charge-start' }, 1, context).reason, 'life-epoch');
    assert(authority.intent({ seq: 0, life: 2, weaponId: 'railgun', action: 'charge-start' }, 2, context).accepted);
  });
  check('actual solo driver resets intent domain only for a new life after 512 prior intents', () => {
    const view = ui();
    const local = api.createSoloDriver({ world, ui: view, localId: 'review-local', localName: 'REVIEW',
      localPrimaryId: 'm4a1', setup: { ...api.DEFAULT_SOLO_SETUP, bots: 0, durationMs: null, scoreLimit: null },
      instrument: api.createSessionLog('review-local') });
    try {
      const frame = () => { now += 50; local.tick(now, 0, 0, 0, 0, 0); };
      for (let i = 0; i < 100; i++) frame();
      assert.equal(local.snapshot().match.phase, 'active');
      for (let i = 0; i < 512; i++) assert.equal(local.weaponIntent({ action: 'equip', weaponId: 'm4a1' }), i);
      assert.equal(view.client.weaponState.lastIntentSeq, 511);
      local.addRemote('review-enemy', 'ENEMY', 1, 'deadeye');
      local.remotePose('review-enemy', 0, 0, 5, Math.PI, 'stand'); frame();
      assert(local.remoteShot('review-enemy', { type: 'shot', seq: 0, life: 1, weaponId: 'deadeye', firedAt: now,
        ox: 0, oy: 1.5, oz: 5, dx: 0, dy: 0, dz: -1 }, now).accepted);
      for (let i = 0; i < 70; i++) frame();
      assert.equal(view.client.weaponState.life, 2, 'real death and respawn must create a new authority instance');
      assert.equal(local.weaponIntent({ action: 'equip', weaponId: 'm4a1' }), 0, 'fresh life starts its assigned intent domain at zero');
      assert.equal(view.client.weaponState.lastIntentSeq, 0);
      assert.equal(view.client.weaponState.lastIntentReason, null);
      // The remote port correctly refuses local actor IDs. Exercise hostile
      // inputs through the existing real remote seat, never a private host hook.
      const oldLife = local.remoteWeaponIntent('review-enemy', { action: 'equip', weaponId: 'deadeye', life: 2, seq: 1000 }, now);
      assert.equal(oldLife.reason, 'life-epoch');
      assert.equal(local.weaponIntent({ action: 'equip', weaponId: 'm4a1' }), 1, 'old-life poison cannot change the new assigned sequence');
      const gap = local.remoteWeaponIntent('review-enemy', { action: 'equip', weaponId: 'deadeye', life: 1, seq: 512 }, now);
      assert.equal(gap.reason, 'malformed', 'existing 512-gap fence remains intact');
      assert.equal(local.weaponIntent({ action: 'equip', weaponId: 'm4a1' }), 2, 'refusal cannot reset the current-life sequence');
      assert(local.remoteWeaponIntent('review-enemy', { action: 'equip', weaponId: 'deadeye', life: 1, seq: 20 }, now).accepted);
      assert.equal(local.remoteWeaponIntent('review-enemy', { action: 'equip', weaponId: 'deadeye', life: 1, seq: 19 }, now).reason,
        'duplicate', 'elevated host sequence cannot roll backwards within a life');
      assert.equal(local.weaponIntent({ action: 'equip', weaponId: 'm4a1' }), 3, 'same-life assignment never resets on successive actions');
    } finally { local.dispose(); }
  });
  console.log(`PASS ${checks} weapon-wire checks: actual host/room/drivers, CPU only; browser/network hardware acceptance OPEN`);
} finally {
  for (const dispose of close.reverse()) dispose(); pump();
  assert.equal(api.liveRoomCount(), 0);
  if (originalNow) Object.defineProperty(performance, 'now', originalNow); else delete performance.now;
  assert(resolve(temp).startsWith(resolve(tmpdir()) + '/aa-weapon-wire-') ||
    resolve(temp).startsWith(resolve(tmpdir()) + '\\aa-weapon-wire-'), 'Owned temporary proof directory required');
  rmSync(temp, { recursive: true, force: true });
}
