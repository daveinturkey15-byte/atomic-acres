/**
 * Browser-free loadout admission proof.
 *
 * This is deliberately separate from the two-browser proof: it exercises the
 * actual loopback room and solo host driver, so a wire declaration cannot be
 * mistaken for a menu-only value. It does not start the app or a relay.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const outfile = join(tmpdir(), 'nuketown-loadout-admission-' + process.pid + '.mjs');
const ENTRY = `
  import { GuestClient, HostRoom } from ${JSON.stringify('../src/net/room')};
  import { createLoopbackPair } from ${JSON.stringify('../src/net/transport')};
  import { createSoloDriver } from ${JSON.stringify('../src/game/session-solo')};
  import { createSessionLog } from ${JSON.stringify('../src/game/session-log')};
  import { DEFAULT_SOLO_SETUP, TEAM_A, TEAM_B } from ${JSON.stringify('../src/game/rules')};
  import { createWorldQuery } from ${JSON.stringify('../src/game/world-query')};

  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

  function verifyRoomDeclaration() {
    let now = 0;
    const pair = createLoopbackPair({ seed: 'loadout-admission', auto: false });
    const host = new HostRoom(pair.a, { code: 'ABC123', now: () => now });
    const guest = new GuestClient(pair.b, 'peer-a', host.code, 'guest', {
      now: () => now, joinTimeoutMs: 5000, localPrimaryId: () => 'deadeye',
    });
    pair.link.pump(0);
    const id = guest.getPlayerId();
    assert(id !== null, 'guest admission completed');
    assert(host.primaryOf(id) === 'deadeye', 'hello carries selected primary');
    guest.setReady(true);
    host.setReady(true);
    pair.link.pump(1);
    assert(host.start() === null, 'room starts with declared primary');
    for (let i = 0; i < 25 && guest.getState() !== 'playing'; i++) {
      now += 50;
      host.tickOnce(now);
      pair.link.pump(now);
    }
    assert(guest.getState() === 'playing', 'guest reaches playing');
    guest.sendMove(0, 0, 0, 0, false, false, 'stand', 'longhorn');
    pair.link.pump(now);
    host.tickOnce(now + 50);
    assert(host.primaryOf(id) === 'deadeye', 'post-Start input cannot swap primary');
    guest.dispose();
    host.dispose();
    pair.a.close();
    pair.b.close();
    return { id, primary: host.primaryOf(id) };
  }

  function verifyUnknownIsRejected() {
    let now = 0;
    const pair = createLoopbackPair({ seed: 'loadout-unknown', auto: false });
    const host = new HostRoom(pair.a, { code: 'ABC123', now: () => now });
    const guest = new GuestClient(pair.b, 'peer-a', host.code, 'forged', {
      now: () => now, joinTimeoutMs: 5000, localPrimaryId: () => 'not-a-weapon',
    });
    pair.link.pump(0);
    const id = guest.getPlayerId();
    assert(id !== null, 'unknown-primary guest admitted');
    assert(host.primaryOf(id) === undefined, 'unknown hello primary is sanitized');
    guest.setReady(true);
    pair.link.pump(1);
    assert(host.primaryOf(id) === undefined, 'unknown ready primary is sanitized');
    guest.dispose();
    host.dispose();
    pair.a.close();
    pair.b.close();
    return { id, primary: undefined };
  }

  function verifyHostKitBeforeSnapshot() {
    const ui = { bindClient: () => undefined, setNames: () => undefined };
    const solo = createSoloDriver({
      world: createWorldQuery([]), ui,
      setup: { ...DEFAULT_SOLO_SETUP, bots: 0 },
      localId: 'host', localName: 'HOST', localTeam: TEAM_A,
      instrument: createSessionLog('host'),
    });
    solo.addRemote('p1', 'GUEST', TEAM_B, 'deadeye');
    solo.tick(0, 0, 0, 0, 0, 0);
    const before = solo.snapshot().actors.find((a) => a.id === 'p1')?.primaryId;
    solo.remotePose('p1', 0, 0, 0, 0, 'stand', 'longhorn');
    solo.tick(50, 0, 0, 0, 0, 0);
    const after = solo.snapshot().actors.find((a) => a.id === 'p1')?.primaryId;
    solo.dispose();
    assert(before === 'deadeye', 'remote actor kit is seeded before first snapshot');
    assert(after === 'deadeye', 'remote actor kit ignores later primary input');
    return { before, after };
  }

  export function run() {
    return { room: verifyRoomDeclaration(), unknown: verifyUnknownIsRejected(), hostKit: verifyHostKitBeforeSnapshot() };
  }
`;

await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'loadout-admission-scenario.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile, logLevel: 'warning',
});
try {
  const scenario = await import(pathToFileURL(outfile).href);
  console.log('[loadout-admission] PASS ' + JSON.stringify(scenario.run()));
} finally {
  rmSync(outfile, { force: true });
}
