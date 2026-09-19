/**
 * Browser-free falsifier for the guest clock boundary.
 *
 * It bundles the real clock adapter, GameClient, and OrdnanceView with esbuild
 * and runs the same host-authored message shapes used by the guest driver. Both
 * a positive and a negative epoch offset are exercised. The checks cover the
 * actual guest projection at local times, raw-message immutability, absolute
 * endpoints, and relative durations so a second conversion cannot hide behind a
 * passing pure-function check.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const outfile = join(tmpdir(), 'nuketown-event-clock-' + process.pid + '.mjs');
const ENTRY = `
  import { GameClient } from ${JSON.stringify('../src/game/client')};
  import { flashOpacity } from ${JSON.stringify('../src/weapons/ordnance-scene')};
  import { localizeGameEvent, localizeGameMessage } from ${JSON.stringify('../src/net/event-clock')};
  import { GuestClient } from ${JSON.stringify('../src/net/room-guest')};

  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const same = (a, b, label) => assert(Object.is(a, b), label + ': expected ' + b + ', got ' + a);
  const near = (a, b, label) => assert(Math.abs(a - b) < 1e-9, label + ': expected ' + b + ', got ' + a);
  const smokeLive = (client, now) => client.ordnance.smokes.some((s) => now < s.diesAt);

  function verifyJoinSeed() {
    let now = 100;
    let receive = null;
    const sent = [];
    const transport = {
      localId: 'guest', closed: false,
      send: (to, msg) => sent.push({ to, msg }),
      onMessage: (handler) => { receive = handler; return () => { receive = null; }; },
      close: () => undefined,
    };
    const guest = new GuestClient(transport, 'host', 'ABC123', 'guest', { now: () => now, joinTimeoutMs: 5000 });
    assert(sent.length === 1 && sent[0].msg.type === 'hello', 'join sent hello');
    receive('host', { type: 'welcome', playerId: 'p1', hostNow: 500000, roster: [], token: 'token-123456789' });
    same(guest.hostClockOffset(), 499900, 'welcome seeds host offset');
    // start refreshes the short initial estimate while NTP is still absent.
    now = 200;
    receive('host', { type: 'start', startTick: 20, hostNow: 500100 });
    same(guest.hostClockOffset(), 499900, 'start refreshes provisional offset');
    // The first pong is authoritative and replaces the one-way estimate.
    now = 400;
    receive('host', { type: 'pong', t: 250, now: 500350 });
    same(guest.hostClockOffset(), 500025, 'first pong replaces seed');
    guest.dispose();
    return { seeded: 499900, ntp: 500025 };
  }

  export function run() {
    const results = [{ joinSeed: verifyJoinSeed() }];
    // The first case models the host clock being far ahead of the guest;
    // the second models the host clock being far behind it.
    for (const offset of [240000, -175000]) {
      const hostNow = 900000;
      const smokeLife = 12000;
      const smoke = {
        type: 'smoke-volume', at: hostNow, id: 41, x: 1, y: 2, z: 3,
        radius: 5, bornAt: hostNow, diesAt: hostNow + smokeLife, kind: 'grenade',
      };
      const rawSmokeMessage = { type: 'ordnance', e: smoke };
      const rawSmokeBefore = JSON.stringify(rawSmokeMessage);
      const localSmokeMessage = localizeGameMessage(rawSmokeMessage, offset);
      const localSmoke = localSmokeMessage.e;
      same(JSON.stringify(rawSmokeMessage), rawSmokeBefore, 'raw smoke message unchanged');
      same(localSmoke.at, hostNow - offset, 'smoke event at');
      same(localSmoke.bornAt, hostNow - offset, 'smoke bornAt');
      same(localSmoke.diesAt, hostNow + smokeLife - offset, 'smoke diesAt');
      same(localSmoke.diesAt - localSmoke.bornAt, smokeLife, 'smoke lifetime');

      const client = new GameClient('guest');
      client.applyEvent(localSmoke);
      client.tick(localSmoke.bornAt + smokeLife / 2);
      assert(smokeLive(client, localSmoke.bornAt + smokeLife / 2), 'smoke live at midlife');
      client.tick(localSmoke.diesAt);
      assert(!smokeLive(client, localSmoke.diesAt), 'smoke expires at diesAt');

      const flash = {
        type: 'flash-hit', at: hostNow + 100, victimId: 'guest', sourceId: 'host',
        x: 0, y: 1, z: 0, intensity: 0.8, durationMs: 1650,
      };
      const rawFlashMessage = { type: 'ordnance', e: flash };
      const rawFlashBefore = JSON.stringify(rawFlashMessage);
      const localFlashMessage = localizeGameMessage(rawFlashMessage, offset);
      const localFlash = localFlashMessage.e;
      same(JSON.stringify(rawFlashMessage), rawFlashBefore, 'raw flash message unchanged');
      same(localFlash.at, hostNow + 100 - offset, 'flash at');
      same(localFlash.durationMs, flash.durationMs, 'flash duration');
      same(localFlash.at + localFlash.durationMs, flash.at + flash.durationMs - offset, 'flash expiry');
      const flashClient = new GameClient('guest');
      flashClient.applyEvent(localFlash);
      flashClient.tick(localFlash.at + 100);
      assert(flashOpacity(localFlash.at + 100, flashClient.ordnance.self.flashAt, flashClient.ordnance.self.flashMs, flashClient.ordnance.self.flashPeak) > 0, 'flash on during guest tick');
      flashClient.tick(localFlash.at + localFlash.durationMs);
      same(flashOpacity(localFlash.at + localFlash.durationMs, flashClient.ordnance.self.flashAt, flashClient.ordnance.self.flashMs, flashClient.ordnance.self.flashPeak), 0, 'flash off at expiry');

      const death = {
        type: 'death', at: hostNow + 500, victimId: 'guest', victimTeam: 0,
        killerId: 'host', cause: 'bullet', streakLost: 2, respawnAt: hostNow + 3500,
      };
      const localDeath = localizeGameEvent(death, offset);
      same(localDeath.respawnAt, hostNow + 3500 - offset, 'respawnAt');
      same(localDeath.respawnAt - localDeath.at, 3000, 'respawn delay');
      const respawnClient = new GameClient('guest');
      respawnClient.applyEvent(localDeath);
      respawnClient.tick(localDeath.respawnAt - 100);
      same(respawnClient.view().respawnMs, 100, 'respawn countdown before due');
      respawnClient.tick(localDeath.respawnAt + 1);
      same(respawnClient.view().respawnMs, 0, 'respawn countdown at due');

      const match = {
        type: 'match-state', at: hostNow + 700, mode: 'tdm', phase: 'active',
        endsAt: hostNow + 30700, scoreLimit: 25, teamScores: [3, 4], scores: [],
        winner: null, winnerId: null, endReason: null,
      };
      const rawMatchBefore = JSON.stringify(match);
      const localizedMatch = localizeGameMessage(match, offset);
      same(JSON.stringify(match), rawMatchBefore, 'raw match snapshot unchanged');
      same(localizedMatch.at, match.at - offset, 'match at');
      same(localizedMatch.endsAt, match.endsAt - offset, 'match endsAt');
      same(localizedMatch.endsAt - localizedMatch.at, match.endsAt - match.at, 'match remaining');

      const thrown = {
        type: 'grenade-thrown', at: hostNow + 800, actorId: 'guest', team: 0,
        grenadeId: 'frag', id: 7, x: 1, y: 1, z: 1, vx: 1, vy: 2, vz: 3,
        detonatesAt: hostNow + 1800,
      };
      const localizedThrown = localizeGameMessage({ type: 'ordnance', e: thrown }, offset);
      same(localizedThrown.e.detonatesAt, thrown.detonatesAt - offset, 'detonatesAt');
      same(localizedThrown.e.detonatesAt - localizedThrown.e.at, 1000, 'fuse span');

      // Mutation-negative control: shifting the already-localized message again
      // must move it away from the one expected guest endpoint. If production
      // ever converts twice, this check catches the same wrong absolute value.
      const doubleConvertedSmoke = localizeGameMessage(localSmokeMessage, offset).e;
      assert(doubleConvertedSmoke.bornAt !== localSmoke.bornAt, 'double conversion negative control');
      same(localSmoke.bornAt, hostNow - offset, 'single conversion endpoint');
      near(localizedMatch.endsAt - localizedMatch.at, 30000, 'single conversion invariant');
      results.push({ offset, smokeLife: localSmoke.diesAt - localSmoke.bornAt, flashMs: localFlash.durationMs, matchRemaining: localizedMatch.endsAt - localizedMatch.at });
    }
    return results;
  }
`;

await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'event-clock-scenario.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile, logLevel: 'warning',
});

try {
  const scenario = await import(pathToFileURL(outfile).href);
  const results = scenario.run();
  console.log('[event-clock] PASS positive/negative offsets: ' + JSON.stringify(results));
} finally {
  rmSync(outfile, { force: true });
}
