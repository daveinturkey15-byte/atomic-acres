/**
 * Headless CPU proof for the authoritative remote-shot edge and bounded
 * presentation queue. It bundles the real game/audio modules with esbuild,
 * but starts no browser, server, WebAudio context, renderer, or GPU process.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const outfile = join(tmpdir(), `nuketown-remote-audio-${process.pid}.mjs`);

const ENTRY = `
import { GameHost } from '../src/game/host';
import { GameClient } from '../src/game/client';
import { createWorldQuery } from '../src/game/world-query';
import { rulesFor, WARMUP_MS } from '../src/game/rules';
import { localizeGameMessage } from '../src/net/event-clock';
import { WorldAudio } from '../src/audio/world-audio';
import { remoteShotGain, remoteShotCutoff } from '../src/audio/service';
import { EYE_HEIGHT } from '../src/core/layout';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const near = (a, b, message) => assert(Math.abs(a - b) < 1e-9, message + ': ' + a + ' != ' + b);

function claim(seq, firedAt, weaponId = 'longhorn') {
  return { type: 'shot', seq, life: 1, weaponId, firedAt,
    ox: 0, oy: 1.4, oz: 0, dx: 0, dy: 0, dz: -1 };
}

export function run() {
  const host = new GameHost({ world: createWorldQuery([]), rules: rulesFor('ffa', 25), now: 0, seed: 9 });
  host.addActor('bot-01', 0, { bot: true });
  const activeAt = WARMUP_MS + 1;
  host.tick(activeAt);
  host.updatePose('bot-01', 0, 0, 0, activeAt, 'stand', 0);

  const admitted = host.submitShot('bot-01', claim(1, activeAt), activeAt);
  assert(admitted.accepted, 'accepted miss claim');
  const acceptedEvents = host.tick(activeAt).filter((e) => e.type === 'shot-fired');
  assert(acceptedEvents.length === 1, 'one shot-fired edge for admitted miss');
  assert(acceptedEvents[0].y === claim(1, activeAt).oy, 'remote audio origin uses the validated muzzle, not actor feet');
  const fired = acceptedEvents[0];
  assert(fired.actorId === 'bot-01' && fired.life === 1 && fired.seq === 1, 'shot identity');
  assert(fired.weaponId === 'longhorn' && fired.x === 0 && fired.y === 1.4 && fired.z === 0, 'validated muzzle pose');

  const duplicate = host.submitShot('bot-01', claim(1, activeAt), activeAt);
  assert(!duplicate.accepted, 'duplicate rejected');
  const duplicateEvents = host.tick(activeAt).filter((e) => e.type === 'shot-fired');
  assert(duplicateEvents.length === 0, 'duplicate emits no shot-fired edge');

  const rejected = host.submitShot('bot-01', claim(2, activeAt, 'unknown-firearm'), activeAt);
  assert(!rejected.accepted, 'unknown weapon rejected');
  const rejectedEvents = host.tick(activeAt).filter((e) => e.type === 'shot-fired');
  assert(rejectedEvents.length === 0, 'rejected claim emits no shot-fired edge');

  const local = new GameClient('bot-01');
  local.applyEvent(fired);
  const localEdges = [];
  assert(local.drainRemoteShots(localEdges) === 0, 'own shot filtered');

  const raw = { type: 'shot-fired', e: fired };
  const localized = localizeGameMessage(raw, 100);
  near(localized.e.at, fired.at - 100, 'localized shot clock');
  const remote = new GameClient('listener');
  remote.applyEvent(localized.e);
  remote.applyEvent(localized.e);
  const remoteEdges = [];
  assert(remote.drainRemoteShots(remoteEdges) === 1, 'remote dedup queue');
  remote.applyEvent(localized.e);
  assert(remote.drainRemoteShots(remoteEdges) === 0, 'post-drain duplicate remains suppressed');
  remote.applyEvent({ ...localized.e, at: localized.e.at - 1000, seq: 2 });
  assert(remote.drainRemoteShots(remoteEdges) === 0, 'stale local-clock event dropped');

  const overflow = new GameClient('listener');
  overflow.applyEvent(localized.e);
  for (let seq = 10; seq < 138; seq++) overflow.applyEvent({ ...localized.e, seq });
  const overflowEdges = [];
  overflow.drainRemoteShots(overflowEdges);
  overflow.applyEvent(localized.e);
  assert(overflow.drainRemoteShots(overflowEdges) === 1, '128-key recent cache evicts oldest identity only after bound');

  near(remoteShotGain(0, false), 0.7, 'close remote gain');
  assert(remoteShotGain(40, false) < remoteShotGain(5, false), 'distance attenuation');
  assert(remoteShotGain(5, true) < remoteShotGain(5, false), 'occlusion attenuation');
  assert(remoteShotCutoff(40, false) < remoteShotCutoff(5, false), 'distance lowpass');
  assert(remoteShotCutoff(5, true) <= 1100, 'occlusion lowpass');

  const shots = [];
  const footsteps = [];
  const environments = [];
  const sink = {
    spatialShot: (family, distanceM, pan, occluded) => shots.push({ family, distanceM, pan, occluded }),
    footstep: () => footsteps.push(true),
    setEnvironment: (kind, level) => environments.push({ kind, level }),
  };
  const mat = { lawn: {}, sand: {}, deckBoards: {}, timber: {}, timberDark: {}, steel: {}, chrome: {} };
  const wall = { min: { x: 8, y: -1, z: 3 }, max: { x: 12, y: 3, z: 7 } };
  const worldAudio = new WorldAudio([], mat, sink, [wall]);
  worldAudio.bindClient(remote);
  remote.applyEvent({ ...localized.e, seq: 3, y: EYE_HEIGHT });
  worldAudio.update({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
    pitch: 0, grounded: true, stance: 'stand' }, 'stand', true, 'clear');
  assert(shots.length === 1, 'world audio drains one remote edge');
  assert(shots[0].distanceM === 0 && shots[0].pan === 0, 'same-position remote presentation');

  // A second edge tests distant pan/occlusion through the actual WorldAudio path.
  const distant = { ...localized.e, seq: 4, x: 20, y: 0, z: 10 };
  remote.applyEvent(distant);
  worldAudio.update({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
    pitch: 0, grounded: true, stance: 'stand' }, 'stand', true, 'clear');
  assert(shots.length === 2, 'distant remote edge drained');
  assert(shots[1].distanceM > 20 && shots[1].pan > 0.5 && shots[1].occluded, 'distant pan and static-AABB occlusion');

  remote.applyEvent({ type: 'death', at: localized.e.at + 1, victimId: 'listener', victimTeam: 0,
    killerId: 'bot-01', cause: 'bullet', streakLost: 0, respawnAt: null });
  const footBefore = footsteps.length;
  worldAudio.update({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 2, y: 0, z: 0 }, yaw: 0,
    pitch: 0, grounded: true, stance: 'stand' }, 'stand', true, 'rain');
  assert(footsteps.length === footBefore, 'dead player footsteps suppressed');
  assert(environments.some((e) => e.kind === 'storm'), 'weather continues while dead');

  remote.applyEvent({ ...localized.e, seq: 5 });
  worldAudio.bindClient(null);
  worldAudio.update({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
    pitch: 0, grounded: false, stance: 'stand' }, 'stand', true, 'clear');
  assert(shots.length === 2, 'unbind tears down pending remote presentation');
  return { accepted: 1, rejected: 1, duplicate: 1, remote: shots.length, environments: environments.length };
}
`;

const built = await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'remote-audio-proof.ts', loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false,
});
writeFileSync(outfile, built.outputFiles[0].text, 'utf8');
try {
  const mod = await import(pathToFileURL(outfile).href);
  const result = mod.run();
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  rmSync(outfile, { force: true });
}
