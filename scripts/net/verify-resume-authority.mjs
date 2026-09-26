/**
 * CPU-only resume authority proof. This complements verify-resume-repair.mjs:
 * that older proof keeps its narrow SoloDriver stub, while this one drives the
 * real GameHost life and ShotWindow state and the real GuestClient handoff.
 *
 *   node scripts/net/verify-resume-authority.mjs
 *   node scripts/net/verify-resume-authority.mjs --json
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_OUT = process.argv.includes('--json');
const ENTRY = `
  import { GameHost } from '../../src/game/host';
  import { rulesFor } from '../../src/game/rules';
  import { GuestClient } from '../../src/net/room-guest';
  import { createGuestDriver } from '../../src/net/match-guest';
  import { createSessionLog } from '../../src/game/session-log';

  const fail = (message) => { throw new Error(message); };
  const need = (ok, message) => { if (!ok) fail(message); };
  const world = {
    lineOfSight: () => true,
    groundY: () => 0,
    inBounds: () => true,
  };
  const rules = rulesFor('ffa', null, null);
  const claim = (seq, life, weaponId, at, x, z) => ({
    type: 'shot', seq, life, weaponId, firedAt: at,
    ox: x, oy: 1.5, oz: z, dx: 0, dy: 0, dz: 1,
  });

  function hostAuthority() {
    const host = new GameHost({ world, rules, now: 0, seed: 7 });
    host.addActor('shooter', 0, { primaryId: 'deadeye' });
    host.addActor('victim', 1);
    const first = host.tick(5000);
    need(host.snapshot().match.phase === 'active', 'host did not enter active phase');
    host.updatePose('shooter', 0, 0, 0, 5000, 'stand', 0);
    host.updatePose('victim', 0, 0, 5, 5000, 'stand', 0);
    need(host.lifeOf('shooter') === 1, 'initial life is not authoritative 1');
    need(host.shotSeqOf('shooter') === -1, 'initial shot window is not empty');

    const frag = host.submitShot('shooter', claim(0, 1, 'frag', 5000, 0, 0), 5000);
    need(frag.accepted === true, 'admitted ordnance claim was refused');
    need(host.shotSeqOf('shooter') === 0, 'ordnance claim did not advance actual shot high-water');
    const deadeye = host.submitShot('shooter', claim(1, 1, 'deadeye', 5000, 0, 0), 5000);
    need(deadeye.accepted === true, 'lethal firearm claim was refused');
    need(host.snapshot().actors.find((a) => a.id === 'victim')?.alive === false, 'real host did not record death');
    need(host.shotSeqOf('shooter') === 1, 'firearm claim did not advance actual shot high-water');
    host.tick(5000);

    const respawnAt = host.snapshot().actors.find((a) => a.id === 'victim')?.respawnAt;
    need(Number.isFinite(respawnAt), 'real host did not schedule respawn');
    const respawnEvents = host.tick(respawnAt);
    const respawn = respawnEvents.find((e) => e.type === 'spawn' && e.actorId === 'victim');
    need(respawn !== undefined, 'real host did not emit respawn');
    need(host.lifeOf('victim') === 2, 'respawn life did not advance to 2');
    need(host.shotSeqOf('victim') === -1, 'respawn did not reset the current life shot window');
    const resumedFacts = { life: host.lifeOf('victim'), shotSeq: host.shotSeqOf('victim') };
    need(resumedFacts.life === 2 && resumedFacts.shotSeq === -1, 'resume facts did not read current respawn');
    const postResume = host.submitShot('victim', claim(resumedFacts.shotSeq + 1, resumedFacts.life, 'longhorn', respawnAt, respawn.x, respawn.z), respawnAt);
    need(postResume.accepted === true, 'immediate post-resume shot was refused');
    need(host.shotSeqOf('victim') === 0, 'post-respawn shot high-water is wrong');

    // A fresh GameHost is the session rematch boundary. Its facts must never
    // inherit the previous host's life or sequence state.
    const rematch = new GameHost({ world, rules, now: 0, seed: 8 });
    rematch.addActor('victim', 1);
    const rematchEvents = rematch.tick(5000);
    const rematchSpawn = rematchEvents.find((e) => e.type === 'spawn' && e.actorId === 'victim');
    need(rematchSpawn !== undefined, 'rematch did not emit initial spawn');
    rematch.updatePose('victim', rematchSpawn.x, rematchSpawn.y, rematchSpawn.z, 5000, 'stand', rematchSpawn.yaw);
    need(rematch.lifeOf('victim') === 1 && rematch.shotSeqOf('victim') === -1, 'rematch inherited old resume facts');
    const rematchFacts = { life: rematch.lifeOf('victim'), shotSeq: rematch.shotSeqOf('victim') };
    const rematchShot = rematch.submitShot('victim', claim(rematchFacts.shotSeq + 1, rematchFacts.life, 'longhorn', 5000, rematchSpawn.x, rematchSpawn.z), 5000);
    need(rematchShot.accepted === true, 'immediate rematch shot was refused');

    return {
      initialEvents: first.filter((e) => e.type === 'spawn').length,
      shooter: { life: host.lifeOf('shooter'), shotSeq: host.shotSeqOf('shooter') },
      respawn: { life: host.lifeOf('victim'), shotSeq: host.shotSeqOf('victim') },
      rematch: { life: rematch.lifeOf('victim'), shotSeq: rematch.shotSeqOf('victim') },
    };
  }

  function guestQueue() {
    let receive = null;
    const sent = [];
    const transport = {
      send: (to, msg) => sent.push({ to, msg }),
      onMessage: (handler) => { receive = handler; return () => { receive = null; }; },
      close: () => undefined,
    };
    const guest = new GuestClient(transport, 'host', 'ABC123', 'guest', { now: () => 0, joinTimeoutMs: 3600000 });
    need(typeof receive === 'function', 'guest transport did not install receive handler');
    receive('host', {
      type: 'welcome', playerId: 'p1', hostNow: 0, roster: [], token: 'resume-token-123',
      resume: { phase: 'playing', startTick: 0, lastSeq: 4, life: 2, shotSeq: 9 },
    });
    receive('host', {
      type: 'spawn',
      e: { type: 'spawn', at: 0, actorId: 'p1', team: 0, x: 1, y: 0, z: 2, yaw: 0,
        spawnIndex: 0, protectedUntil: 0, reason: 'respawn' },
    });
    const delivered = [];
    guest.onGame((msg) => delivered.push(msg));
    need(delivered.length === 1 && delivered[0].type === 'spawn', 'pre-driver game tag was lost');
    need(guest.resumeState()?.life === 2, 'guest resume state changed before driver construction');
    guest.dispose();
    return { delivered: delivered.length, sentBye: sent.some((x) => x.msg.type === 'bye') };
  }

  function guestEpochs() {
    let receive = null;
    const sent = [];
    const transport = {
      send: (to, msg) => sent.push({ to, msg }),
      onMessage: (handler) => { receive = handler; return () => { receive = null; }; },
      close: () => undefined,
    };
    const guest = new GuestClient(transport, 'host', 'ABC123', 'guest', { now: () => 0, joinTimeoutMs: 3600000 });
    const ui = { bindClient: () => undefined, setNames: () => undefined };
    receive('host', {
      type: 'welcome', playerId: 'p1', hostNow: 0, roster: [], token: 'resume-token-123',
      resume: { phase: 'playing', startTick: 0, lastSeq: 4, life: 1, shotSeq: 9 },
    });
    let placed = null;
    const driver = createGuestDriver(guest, { ui, instrument: createSessionLog('p1'),
      placeLocal: (x, y, z, yaw, stance) => { placed = { x, y, z, yaw, stance }; },
    });
    const fire = (seq) => driver.localShot({ seq, weaponId: 'longhorn', time: 0, origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: 1 } });
    fire(0);
    need(!sent.some((x) => x.msg.type === 'shot'), 'resumed driver fired before authoritative placement');
    const poseHost = new GameHost({ world, rules, now: 0, seed: 23 });
    poseHost.addActor('p1', 0); poseHost.tick(5000);
    poseHost.updatePose('p1', 0, 0, 0, 5000, 'stand', 0);
    receive('host', { type: 'state', tick: 1, hostNow: 0,
      players: [poseHost.stampSample({ id: 'p1', x: 0, y: 0, z: 0, yaw: 0, ack: 4 })],
    });
    need(placed?.x === 0 && placed.y === 0 && placed.z === 0 && placed.stance === 'stand',
      'resumed driver did not apply the host placement');
    fire(0);
    let shots = sent.filter((x) => x.msg.type === 'shot').map((x) => ({ seq: x.msg.seq, life: x.msg.life }));
    need(shots.length === 1 && shots[0].seq === 10 && shots[0].life === 1, 'resumed driver did not preserve shot base');

    const match = (at, phase, endReason) => ({
      type: 'match-state', at, mode: 'ffa', phase, endsAt: phase === 'ended' ? at : null,
      scoreLimit: null, teamScores: [0, 0], scores: [], winner: null, winnerId: null, endReason,
    });
    receive('host', match(10, 'ended', 'score'));
    // The real rematch path emits its initial spawn as a distinct initial
    // deployment. That event is the authoritative reset; no count guessing.
    receive('host', match(20, 'warmup', null));
    receive('host', { type: 'spawn', e: {
      type: 'spawn', at: 20, actorId: 'p1', team: 0, x: 0, y: 0, z: 0, yaw: 0,
      spawnIndex: 0, protectedUntil: 0, reason: 'initial',
    }});
    fire(0);
    receive('host', { type: 'spawn', e: {
      type: 'spawn', at: 30, actorId: 'p1', team: 0, x: 0, y: 0, z: 0, yaw: 0,
      spawnIndex: 1, protectedUntil: 0, reason: 'respawn',
    }});
    fire(0);
    shots = sent.filter((x) => x.msg.type === 'shot').map((x) => ({ seq: x.msg.seq, life: x.msg.life }));
    need(shots.length === 3, 'guest driver did not emit all epoch shots');
    need(shots[1].seq === 0 && shots[1].life === 1, 'initial rematch spawn did not reset guest epoch');
    need(shots[2].seq === 0 && shots[2].life === 2, 'respawn did not reset shot window or advance life');
    driver.dispose();
    guest.dispose();
    return { shots, matchEpoch: driver.counters().epoch };
  }

  export function run() { return { host: hostAuthority(), guest: guestQueue(), guestEpochs: guestEpochs() }; }
`;

const outfile = join(tmpdir(), 'nuketown-resume-authority-' + process.pid + '.mjs');
await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'resume-authority.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile, logLevel: 'warning',
});

try {
  const scenario = await import(pathToFileURL(outfile).href);
  const result = scenario.run();
  if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
  console.log('[resume-authority] PASS real GameHost authority plus real GuestDriver rematch/respawn epochs and handoff queue');
} finally {
  rmSync(outfile, { force: true });
}
