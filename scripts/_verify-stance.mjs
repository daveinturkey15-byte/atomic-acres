/**
 * Browser-free stance authority falsifier. Bundles the real room kinematics,
 * wire parser, rewindable pose history and hit geometry. It proves that a
 * sprint flag cannot buy crouch/prone speed, malformed stances are refused,
 * old messages remain standing, and the lower stance capsules change the
 * actual hit result and muzzle-origin allowance.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const outfile = join(tmpdir(), 'nuketown-stance-' + process.pid + '.mjs');
const ENTRY = `
  import { createPose, integrateInput, isPlayerStance } from ${JSON.stringify('../src/net/room-core')};
  import { isNetMessage } from ${JSON.stringify('../src/net/protocol')};
  import { PoseTrack, pickTarget, admitShot } from ${JSON.stringify('../src/game/host-shot')};
  import { GameHost } from ${JSON.stringify('../src/game/host')};
  import { createWorldQuery } from ${JSON.stringify('../src/game/world-query')};
  import { createLocalMatch } from ${JSON.stringify('../src/game/session')};
  import { GuestClient, HostRoom } from ${JSON.stringify('../src/net/room')};
  import { createLoopbackPair } from ${JSON.stringify('../src/net/transport')};
  import { TICK_DT } from ${JSON.stringify('../src/net/snapshot')};

  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, msg + ': expected ' + b + ', got ' + a);
  const ray = (y) => ({ type: 'shot', seq: 1, life: 1, weaponId: 'longhorn', firedAt: 100,
    ox: -2, oy: y, oz: 0, dx: 1, dy: 0, dz: 0 });

  function verifyHeadroom() {
    // The room places seats at y=0. The real map's pavement is a thin slab;
    // only its top, not its volume, is ground. Keep the low roof local to the
    // B spawn so an open-yard rise and a covered rise exercise the same query.
    const floor = { min: { x: -100, y: 0, z: -100 }, max: { x: 100, y: 0.151, z: 100 } };
    const roof = { min: { x: -2, y: 1.35, z: 31 }, max: { x: 4, y: 1.45, z: 37 } };
    const colliders = [floor, roof];
    const canOccupy = (pose, target) => {
      const height = target === 'stand' ? 1.78 : target === 'crouch' ? 1.16 : 0.52;
      const maxGroundY = pose.y + 0.35;
      let feetY = pose.y;
      for (const c of colliders) {
        if (pose.x + 0.3 <= c.min.x || pose.x - 0.3 >= c.max.x) continue;
        if (pose.z + 0.3 <= c.min.z || pose.z - 0.3 >= c.max.z) continue;
        if (c.max.y <= maxGroundY + 0.001 && c.max.y > feetY) feetY = c.max.y;
      }
      const minY = feetY + 0.02;
      const maxY = feetY + height;
      return !colliders.some((c) =>
        maxY > c.min.y && minY < c.max.y &&
        pose.x + 0.3 > c.min.x && pose.x - 0.3 < c.max.x &&
        pose.z + 0.3 > c.min.z && pose.z - 0.3 < c.max.z);
    };
    assert(canOccupy({ x: 20, y: 0, z: 0 }, 'stand'), 'open yard stand clears floor slab');
    assert(canOccupy({ x: 1.2, y: 0, z: 34.3 }, 'crouch'), 'low roof admits crouch above floor slab');
    assert(!canOccupy({ x: 1.2, y: 0, z: 34.3 }, 'stand'), 'low roof rejects standing above floor slab');
    let now = 0;
    const pair = createLoopbackPair({ seed: 'stance-headroom', auto: false });
    const host = new HostRoom(pair.a, { code: 'ABC123', now: () => now, canStand: canOccupy });
    const guest = new GuestClient(pair.b, 'peer-a', host.code, 'guest', { now: () => now, joinTimeoutMs: 5000 });
    pair.link.pump(0);
    assert(guest.getState() === 'lobby', 'headroom guest joined');
    guest.setReady(true); host.setReady(true); pair.link.pump(1);
    assert(host.start() === null, 'headroom room started');
    for (let i = 0; i < 30 && guest.getState() !== 'playing'; i++) {
      now += 50; host.tickOnce(now); pair.link.pump(now);
    }
    assert(guest.getState() === 'playing', 'headroom guest reached playing');
    const id = guest.getPlayerId();
    assert(id !== null, 'headroom guest has id');
    const move = (stance) => {
      guest.sendMoveAt(0, 0, 0, 0, false, TICK_DT, 0, stance);
      now += 50; pair.link.pump(now); host.tickOnce(now); pair.link.pump(now);
    };
    host.placeSeat(id, 20, 0, 0, 'prone');
    move('crouch');
    assert(host.poseOf(id).stance === 'crouch', 'open-yard prone to crouch accepted above floor slab');
    move('stand');
    assert(host.poseOf(id).stance === 'stand', 'open-yard crouch to stand accepted above floor slab');
    host.placeSeat(id, 1.2, 34.3, 0, 'prone');
    move('crouch');
    assert(host.poseOf(id).stance === 'crouch', 'crouch accepted under low ceiling');
    move('stand');
    assert(host.poseOf(id).stance === 'crouch', 'stand rejected under low ceiling');
    move('prone');
    move('crouch');
    assert(host.poseOf(id).stance === 'crouch', 'prone to crouch accepted under low ceiling');
    guest.dispose(); host.dispose(); pair.a.close(); pair.b.close();
    return { blocked: 'crouch->stand', allowed: 'prone->crouch' };
  }

  function verifyFacadeTick() {
    const ui = { bindClient: () => undefined, setNames: () => undefined };
    const match = createLocalMatch({
      colliders: [], bots: 0, ui,
      localPrimaryId: () => 'deadeye',
    });
    match.begin();
    match.tick(0, 0, 0, 0, 0, 0, 'crouch');
    match.tick(50, 0, 0, 0, 0, 0, 'crouch');
    const crouch = match.snapshot().actors.find((a) => a.id === 'you')?.stance;
    match.tick(100, 0, 0, 0, 0, 0, 'prone');
    const prone = match.snapshot().actors.find((a) => a.id === 'you')?.stance;
    assert(crouch === 'crouch', 'facade forwards crouch stance to host');
    assert(prone === 'prone', 'facade forwards prone stance to host');
    match.dispose();
    return { crouch, prone };
  }

  export function run() {
    const stand = createPose();
    integrateInput(stand, 0, 1, 0, true, 1, 'stand');
    const crouch = createPose();
    integrateInput(crouch, 0, 1, 0, true, 1, 'crouch');
    const prone = createPose();
    integrateInput(prone, 0, 1, 0, true, 1, 'prone');
    near(Math.abs(stand.z), 6.6, 'standing sprint speed');
    near(Math.abs(crouch.z), 2.75, 'crouch sprint clamp');
    near(Math.abs(prone.z), 1.25, 'prone sprint clamp');

    const old = { type: 'input', seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, fire: false, jump: false };
    const crouchMsg = { ...old, stance: 'crouch' };
    const bad = { ...old, stance: 'flying' };
    assert(isNetMessage(old), 'old input remains valid');
    assert(isNetMessage(crouchMsg), 'crouch input is valid');
    assert(!isNetMessage(bad), 'invalid stance is rejected at wire boundary');
    assert(!isPlayerStance('flying'), 'invalid stance is not normalized');

    const track = new PoseTrack();
    track.push(0, 0, 0, 0, 'stand');
    track.push(50, 0, 0, 0, 'crouch');
    track.push(100, 0, 0, 0, 'prone');
    assert(track.at(20)?.stance === 'stand', 'pose history holds old stance before transition');
    assert(track.at(80)?.stance === 'prone', 'pose history uses newer discrete stance after transition');

    const standHead = pickTarget(ray(1.6), [{ id: 'stand', pose: { at: 100, x: 0, y: 0, z: 0, stance: 'stand' } }]);
    const crouchHead = pickTarget(ray(1.05), [{ id: 'crouch', pose: { at: 100, x: 0, y: 0, z: 0, stance: 'crouch' } }]);
    const tooHighForCrouch = pickTarget(ray(1.3), [{ id: 'crouch', pose: { at: 100, x: 0, y: 0, z: 0, stance: 'crouch' } }]);
    const proneHigh = pickTarget(ray(0.7), [{ id: 'prone', pose: { at: 100, x: 0, y: 0, z: 0, stance: 'prone' } }]);
    const proneLegs = pickTarget({ ...ray(0.25), oz: 0.72 }, [{
      id: 'prone', pose: { at: 100, x: 0, y: 0, z: 0, yaw: 0, stance: 'prone' },
    }]);
    const proneYawed = pickTarget({ ...ray(0.25), ox: 0.6, oz: -2, dx: 0, dz: 1 }, [{
      id: 'prone-yawed', pose: { at: 100, x: 0, y: 0, z: 0, yaw: Math.PI / 2, stance: 'prone' },
    }]);
    const wrongYaw = pickTarget({ ...ray(0.25), ox: 0.6, oz: -2, dx: 0, dz: 1 }, [{
      id: 'prone-wrong-yaw', pose: { at: 100, x: 0, y: 0, z: 0, yaw: 0, stance: 'prone' },
    }]);
    assert(standHead?.zone === 'head', 'standing head zone preserves old height');
    assert(crouchHead?.zone === 'head', 'crouch head zone follows crouch height');
    assert(tooHighForCrouch === null, 'crouch capsule rejects a standing-height hit');
    assert(proneHigh === null, 'prone capsule rejects a crouch-height hit');
    assert(proneLegs?.id === 'prone', 'prone horizontal footprint admits a limb outside the old cylinder');
    assert(proneYawed?.id === 'prone-yawed', 'prone footprint rotates with actor yaw');
    assert(wrongYaw === null, 'prone footprint does not ignore actor yaw');

    const common = { matchActive: true, life: 1, alive: true, diedAt: null, knownWeapon: true,
      window: { seqHigh: -1, seqs: [] }, receivedAt: 100 };
    const acceptedStand = admitShot(ray(1), { ...common, pose: { at: 100, x: 0, y: 0, z: 0, stance: 'stand' } });
    const rejectedProne = admitShot({ ...ray(1.5), seq: 2 }, { ...common, pose: { at: 100, x: 0, y: 0, z: 0, stance: 'prone' } });
    assert(acceptedStand === null, 'standing muzzle tolerance preserves prior admission');
    assert(rejectedProne === 'bad-origin', 'prone muzzle tolerance refuses an implausibly high origin');
    const host = new GameHost({ world: createWorldQuery([]), now: 0 });
    host.addActor('you', 0, { primaryId: 'deadeye' });
    const primary = host.snapshot().actors.find((a) => a.id === 'you')?.primaryId;
    assert(primary === 'deadeye', 'authoritative self primary follows selected loadout');
    const headroom = verifyHeadroom();
    const facade = verifyFacadeTick();
    return { speeds: [Math.abs(stand.z), Math.abs(crouch.z), Math.abs(prone.z)], zones: [standHead.zone, crouchHead.zone], proneFootprint: [proneLegs.id, proneYawed.id], invalid: bad.stance, muzzle: rejectedProne, primary, headroom, facade };
  }
`;

await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'stance-scenario.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile, logLevel: 'warning',
});
try {
  const scenario = await import(pathToFileURL(outfile).href);
  console.log('[stance] PASS ' + JSON.stringify(scenario.run()));
} finally {
  rmSync(outfile, { force: true });
}
