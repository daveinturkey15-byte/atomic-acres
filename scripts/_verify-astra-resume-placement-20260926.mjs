/** CPU regression: real GuestClient -> guest driver -> Player camera -> GameHost.
 * Retains the failed cff5572 driver as a negative control; no host rule is mocked.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = mkdtempSync(join(tmpdir(), 'aa-resume-placement-'));
const baselineRef = 'cff55724fa7c3fee4d8493f351aaee332494f87a';
const retained = execFileSync('git', ['show', `${baselineRef}:src/net/match-guest.ts`], { cwd: root, encoding: 'utf8' });
const entry = `
 export * as THREE from 'three';
 export { Player } from './src/core/player';
 export { GameHost } from './src/game/host';
 export { rulesFor } from './src/game/rules';
 export { GuestClient } from './src/net/room-guest';
 export { createGuestDriver } from './src/net/match-guest';
 export { createSessionLog } from './src/game/session-log';
 export { EYE_HEIGHT, CROUCH_EYE, PRONE_EYE } from './src/core/layout';
`;
const modules = [];
for (const baseline of [false, true]) {
  const outfile = join(folder, baseline ? 'baseline.mjs' : 'current.mjs');
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: baseline ? [{
      name: 'retained-failure', setup(b) {
        b.onLoad({ filter: /net[\\/]match-guest\.ts$/ }, () => ({
          contents: retained, loader: 'ts', resolveDir: join(root, 'src/net'),
        }));
      },
    }] : [],
  });
  modules.push(await import(pathToFileURL(outfile).href));
}
const [current, baseline] = modules;
globalThis.addEventListener = () => undefined;
globalThis.document = { addEventListener: () => undefined };
const retainedPose = { x: -3.584, y: 0.154, z: 18.4, yaw: -0.192 };

function fixture(api, { cached = true, stance = 'stand', queuedSpawn = false } = {}) {
  const host = new api.GameHost({
    world: { lineOfSight: () => true, groundY: () => retainedPose.y, inBounds: () => true },
    rules: api.rulesFor('ffa', null, null), now: 0, seed: 7,
  });
  host.addActor('p1', 0, { loadout: { primary: 'mp5', sidearm: 'magnum', grenade: 'smoke' } });
  host.tick(5000);
  host.updatePose('p1', retainedPose.x, retainedPose.y, retainedPose.z, 5000, stance, retainedPose.yaw);
  const eye = stance === 'prone' ? api.PRONE_EYE : stance === 'crouch' ? api.CROUCH_EYE : api.EYE_HEIGHT;
  const preShot = { type: 'shot', seq: 2, life: host.lifeOf('p1'), weaponId: 'mp5', firedAt: 5000,
    ox: retainedPose.x, oy: retainedPose.y + eye, oz: retainedPose.z, dx: 0, dy: 1, dz: 0 };
  assert.equal(host.submitShot('p1', preShot, 5000).accepted, true, 'pre-reload real host shot');
  let now = 5200;
  host.tick(now);
  host.updatePose('p1', retainedPose.x, retainedPose.y, retainedPose.z, now, stance, retainedPose.yaw);
  const inventory = host.loadoutOf('p1');
  let receive;
  const sent = [], verdicts = [], placements = [], events = [];
  const transport = {
    send: (_to, msg) => {
      sent.push(msg);
      if (msg.type === 'shot') verdicts.push(host.submitShot('p1', msg, now));
    },
    onMessage: h => { receive = h; return () => { receive = null; }; }, close() {},
  };
  const guest = new api.GuestClient(transport, 'host', 'ABC123', 'guest', { now: () => now, joinTimeoutMs: 3600000 });
  const deliver = msg => receive('host', msg);
  deliver({ type: 'welcome', playerId: 'p1', hostNow: now, roster: [], token: 'resume-token-123', resume: {
    phase: 'playing', startTick: 68, lastSeq: 84, lastStreakSeq: 0, lastPilotSeq: -1,
    life: host.lifeOf('p1'), shotSeq: host.shotSeqOf('p1'), ...inventory,
  }});
  let tick = 100;
  const sample = host.stampSample({ id: 'p1', ...retainedPose, ack: 84 });
  const state = players => deliver({ type: 'state', tick: tick++, hostNow: now, players });
  if (cached) state([sample]);
  if (queuedSpawn) deliver({ type: 'spawn', e: { type: 'spawn', actorId: 'p1', at: now,
    team: 0, x: 8, y: 1, z: 9, yaw: 0.3, spawnIndex: 0, protectedUntil: now, reason: 'respawn' } });
  const camera = new api.THREE.PerspectiveCamera();
  const player = new api.Player(camera, { addEventListener() {} });
  // Same horizontal location as authority, but the reloaded camera is upstairs.
  // This isolates the y error that ordinary x/z reconciliation cannot repair.
  player.teleport(retainedPose.x, 1.91, retainedPose.z, Math.PI);
  let client;
  const driver = api.createGuestDriver(guest, {
    ui: { bindClient: c => { client = c; }, setNames() {}, onEvent: e => events.push(e) },
    instrument: api.createSessionLog('p1'),
    placeLocal(x, y, z, yaw, poseStance = 'stand') {
      placements.push({ x, y, z, yaw, stance: poseStance });
      player.teleport(x, y, z, yaw, 0, poseStance);
    },
  });
  const fire = (seq = 0) => driver.localShot({ seq, weaponId: 'mp5', time: now,
    origin: camera.position.clone(), direction: new api.THREE.Vector3(0, 1, 0) });
  const frame = elapsed => {
    now += elapsed;
    host.tick(now);
    host.updatePose('p1', retainedPose.x, retainedPose.y, retainedPose.z, now, stance, retainedPose.yaw);
    const p = player.state;
    driver.tick(now, p.pos.x, p.pos.y, p.pos.z, p.yaw, p.pitch, p.stance);
  };
  const dispose = () => { driver.dispose(); guest.dispose(); };
  return { host, guest, driver, camera, player, client, sample, state, sent, verdicts,
    placements, events, inventory, eye, fire, frame, dispose };
}

const reports = [];
const old = fixture(baseline);
try {
  old.fire();
  assert.equal(old.camera.position.y, 3.59);
  assert.equal(old.verdicts[0].reason, 'bad-origin', 'retained cff5572 must reproduce real host rejection');
  assert.equal(old.placements.length, 0);
  reports.push({ scenario: 'retained-cff5572', reason: old.verdicts[0].reason, cameraY: old.camera.position.y });
} finally { old.dispose(); }

for (const stance of ['stand', 'crouch', 'prone']) {
  const f = fixture(current, { stance });
  try {
    assert.equal(f.placements.length, 1);
    assert.deepEqual(f.player.state.pos.toArray(), [retainedPose.x, retainedPose.y, retainedPose.z]);
    assert.equal(f.player.state.yaw, retainedPose.yaw);
    assert.equal(f.player.getStance(), stance);
    assert.equal(f.player.getEyeHeight(), f.eye);
    assert.equal(f.camera.position.y, retainedPose.y + f.eye, 'camera restored before any update');
    assert.equal(f.player.getBodyHeight(), stance === 'prone' ? 0.52 : stance === 'crouch' ? 1.16 : 1.78);
    assert.equal(f.client.ordnance.self.spawnSeq, 0);
    assert.equal(f.events.filter(e => e.type === 'spawn').length, 0);
    assert.equal(f.driver.counters().lives, 1);
    assert.equal(f.client.ordnance.self.rounds, f.inventory.rounds);
    f.fire();
    assert.equal(f.verdicts[0].accepted, true, `${stance} real camera shot must be admitted`);
    assert.equal(f.host.shotSeqOf('p1'), 3);
    assert.equal(f.host.lifeOf('p1'), 1);
    assert.equal(f.host.loadoutOf('p1').rounds, f.inventory.rounds - 1, 'one actual shot spends exactly one round');
    f.state([{ ...f.sample, x: 99 }]);
    assert.equal(f.placements.length, 1, 'normal snapshots must not repeat the resume teleport');
    f.player.teleport(1, 2, 3, 0.5, 0.2);
    assert.equal(f.player.getStance(), 'stand', 'existing five-argument teleport stays standing');
    assert.equal(f.player.getEyeHeight(), current.EYE_HEIGHT);
    assert.equal(f.player.getBodyHeight(), 1.78);
    assert.equal(f.camera.position.y, 2 + current.EYE_HEIGHT);
    assert.equal(f.player.state.pitch, 0.2);
    reports.push({ scenario: stance, accepted: true, eyeHeight: f.eye, life: 1, shotSeq: 3 });
  } finally { f.dispose(); }
}

const late = fixture(current, { cached: false, stance: 'crouch' });
try {
  late.frame(10); late.frame(2000); late.fire();
  assert.equal(late.sent.filter(m => m.type === 'input' || m.type === 'shot').length, 0, 'no forwarding while awaiting first self state');
  for (const players of [[], [{ ...late.sample, id: 'other' }], [{ ...late.sample, ack: 83 }], [{ ...late.sample, y: NaN }]]) {
    late.state(players); late.frame(60); late.fire();
    assert.equal(late.placements.length, 0);
    assert.equal(late.sent.filter(m => m.type === 'input' || m.type === 'shot').length, 0);
  }
  late.state([late.sample]);
  assert.equal(late.placements.length, 1);
  late.frame(10); late.frame(60); late.frame(60);
  const inputs = late.sent.filter(m => m.type === 'input');
  assert.equal(inputs.length, 2);
  for (const m of inputs) {
    assert.equal(m.mx, 0, 'resume teleport must not become movement');
    assert.equal(m.mz, 0, 'resume teleport must not become movement');
    assert.equal(m.sprint, false);
    assert.equal(m.stance, 'crouch');
  }
  assert.equal(inputs[0].seq, 85);
  assert.equal(inputs[1].y, retainedPose.y, 'second exact-displacement input starts on retained level');
  assert.equal(late.driver.counters().snaps, 0);
  assert.equal(late.driver.counters().lives, 1);
  assert.equal(late.events.filter(e => e.type === 'spawn').length, 0);
  late.fire();
  assert.equal(late.verdicts[0].accepted, true);
  reports.push({ scenario: 'wait-first-valid-self-state', inputs: inputs.length, firstSeq: inputs[0].seq, forgedDisplacement: false });
} finally { late.dispose(); }

const spawned = fixture(current, { queuedSpawn: true });
try {
  assert.equal(spawned.placements.length, 1, 'a real queued respawn supersedes the old cached sample');
  assert.deepEqual(spawned.player.state.pos.toArray(), [8, 1, 9]);
  assert.equal(spawned.driver.counters().lives, 2);
  assert.equal(spawned.events.filter(e => e.type === 'spawn').length, 1);
  reports.push({ scenario: 'queued-respawn-wins', life: 2 });
} finally { spawned.dispose(); }
console.log(JSON.stringify({ status: 'PASS', baselineRef, reports }, null, 2));
