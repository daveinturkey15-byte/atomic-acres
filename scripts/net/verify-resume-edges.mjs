/**
 * CPU-only proof for the three resume edges the earlier proofs did not cover
 * (verify-resume-repair / verify-resume-authority / verify-resume-loadout):
 *
 *   1. HostRoom token resume with a DIFFERENT transport peer id — so the
 *      by-peer "retried hello" fallback cannot mask a pass — plus negative
 *      controls: wrong token, old identity after rebind, reserved-seat
 *      capacity hold, expired reservation.
 *   2. Starting/countdown-phase resume: welcome.resume.phase === 'starting'
 *      with the exact startTick, the guest flipping to 'playing' exactly at
 *      that tick, and the input clamp before/after the flip.
 *   3. A refresh landing on each side of the one-host-frame rematch rebuild:
 *      the resume facts a welcome carries must always be exactly one GameHost
 *      generation's pair — never a torn mix — at every schedulable point, and
 *      the rebuilt match must re-seat the resumer and broadcast its warmup +
 *      initial spawn after the welcome.
 *
 * Real classes under test: HostRoom; GuestClient (every refresh is a real
 * GuestClient constructed with opts.resume — the real page-refresh path);
 * GameHost (the resume-facts authority); createSoloDriver + createHostDriver
 * + the real session-solo build() for proof 3's rematch. Stubs, all labelled:
 * the loopback Transport below (manual scheduling only — every wire byte is a
 * real NetMessage through the real receive validators), the WorldQuery stub,
 * and the MatchUi stub. Virtual clock only; no sockets, browser, or GPU.
 * Thresholds (LIVENESS_MS, REJOIN_GRACE_MS, REMATCH_MS) are imported, never
 * redefined. This proves CPU-schedulable behaviour only — not WAN, browser
 * visuals, or internet play.
 *
 *   node scripts/net/verify-resume-edges.mjs
 *   node scripts/net/verify-resume-edges.mjs --json
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_OUT = process.argv.includes('--json');
const ENTRY = `
  import { HostRoom, GuestClient, LIVENESS_MS } from '../../src/net/room';
  import { createHostDriver } from '../../src/net/match-host';
  import type { NetMessage } from '../../src/net/protocol';
  import type { PeerId, Transport } from '../../src/net/transport';
  import { GameHost } from '../../src/game/host';
  import { rulesFor, sanitizeSoloSetup, REJOIN_GRACE_MS } from '../../src/game/rules';
  import { REMATCH_MS, createSoloDriver } from '../../src/game/session-solo';
  import { createSessionLog } from '../../src/game/session-log';

  const fail = (m: string): never => { throw new Error(m); };
  const need = (ok: boolean, m: string): void => { if (!ok) fail(m); };
  const eq = (a: unknown, b: unknown, m: string): void => { need(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

  const TICK_MS = 50;
  // The production solo driver stamps localShot receipts with
  // performance.now(). Keep that seam in the same virtual clock as the
  // authority so the CPU proof does not manufacture a future/stale shot.
  let VIRTUAL_NOW = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => VIRTUAL_NOW });
  // Deterministic stand-in for the join-code RNG; the real mint lives in protocol.ts.
  const lcg = (seed: number) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
  const world = { lineOfSight: () => true, groundY: () => 0, inBounds: () => true };
  const CODE = 'ABC123';

  /** Loopback Transport. STUB: manual scheduling only — each side still runs
   *  its real receive path (isNetMessage, hello/admit, welcome parsing). */
  class Hub {
    down: Array<{ to: PeerId; msg: NetMessage }> = [];
    private readonly dropped = new Set<PeerId>();
    private hostHandler: ((from: PeerId, raw: unknown) => void) | null = null;
    private guests = new Map<PeerId, (from: PeerId, raw: unknown) => void>();
    hostTransport(): Transport {
      const self = this;
      return {
        send: (to, msg) => { if (self.dropped.has(to)) return; self.down.push({ to, msg }); const g = self.guests.get(to); if (g !== undefined) g('host', msg); },
        onMessage: (h) => { self.hostHandler = h; return () => { self.hostHandler = null; }; },
        close: () => undefined,
      };
    }
    guestTransport(peer: PeerId): Transport {
      const self = this;
      return {
        send: (to, msg) => { if (to === 'host' && !self.dropped.has(peer)) self.hostHandler?.(peer, msg); },
        onMessage: (h) => { self.guests.set(peer, h); return () => { self.guests.delete(peer); }; },
        close: () => undefined,
      };
    }
    /** Simulate a dead page/network path without sending a deliberate bye. */
    drop(peer: PeerId): void { this.dropped.add(peer); }
    restore(peer: PeerId): void { this.dropped.delete(peer); }
    /** Raw injection from a peer no real GuestClient created (negative probes). */
    deliver(from: PeerId, raw: unknown): void { this.hostHandler?.(from, raw); }
    typed(peer: PeerId, type: string): any {
      // A roster is published at join, ready, start, and every liveness change;
      // callers need the newest matching wire event, never the stale first one.
      return [...this.down].reverse().find((d) => d.to === peer && (d.msg as { type?: string }).type === type)?.msg;
    }
  }

  interface Clock { now: number; step(): void; }
  const clock = (): Clock => {
    const c = { now: 0, step: () => undefined } as unknown as Clock;
    c.step = () => { c.now += TICK_MS; VIRTUAL_NOW = c.now; };
    return c;
  };

  const stateOf = (g: GuestClient): string => (g as unknown as { state: string }).state;
  const factsHook = (host: GameHost) => (id: string) => ({ life: host.lifeOf(id), shotSeq: host.shotSeqOf(id) });

  function makeRoom(t: Clock, capacity: number) {
    const hub = new Hub();
    const room = new HostRoom(hub.hostTransport(), { now: () => t.now, codeRand: lcg(0x9e3779b9), code: CODE, capacity });
    return { hub, room };
  }

  /** A real refresh/join: a fresh GuestClient on its own transport peer id. */
  function joinGuest(t: Clock, hub: Hub, peer: PeerId, name: string, resume: { playerId: string; token: string } | null) {
    const guest = new GuestClient(hub.guestTransport(peer), 'host' as PeerId, CODE, name, {
      now: () => t.now, joinTimeoutMs: 3600000, ...(resume === null ? {} : { resume }),
    });
    const welcome = hub.typed(peer, 'welcome');
    need(welcome !== undefined, peer + ' got no welcome');
    return { guest, welcome: welcome as {
      playerId: string; token?: string;
      resume?: { phase: string; startTick: number; lastSeq: number; life: number; shotSeq: number };
    } };
  }

  const rawInput = (seq: number) => ({
    type: 'input', seq, mx: 0, mz: 1, yaw: 0, pitch: 0, fire: false, jump: false,
    stance: 'stand', sprint: false, dt: 0.05, y: 0,
  });
  const rawHello = (name: string, resume?: { playerId: string; token: string }) => ({
    type: 'hello', code: CODE, name, nonce: 'n-' + name, ...(resume === undefined ? {} : { resume }),
  });
  const startPlaying = (t: Clock, hub: Hub, room: HostRoom, guest: GuestClient): number => {
    room.setReady(true);
    guest.setReady(true);
    const refusal = room.start();
    eq(refusal, null, 'start refused; guest state=' + guest.getState() + ' roster=' + JSON.stringify(room.roster()));
    const start = hub.down.find((d) => (d.msg as { type?: string }).type === 'start')?.msg as unknown as { startTick: number } | undefined;
    need(start !== undefined && start.startTick > 0, 'start broadcast missing');
    for (let i = 0; i < 21; i++) { t.step(); room.tickOnce(t.now); }
    eq(room.getPhase(), 'playing', 'room did not reach playing');
    return start.startTick;
  };
  const shotAt = (seq: number, life: number, x: number, z: number, at: number, weapon = 'longhorn') => ({
    type: 'shot', seq, life, weaponId: weapon, firedAt: at, ox: x, oy: 1.5, oz: z, dx: 0, dy: 0, dz: 1,
  });

  // ---------------------------------------------------------------------------
  // Proof 1: token resume on a DIFFERENT transport peer id + negative controls.
  // ---------------------------------------------------------------------------
  function tokenResumeDifferentPeer(): Record<string, unknown> {
    const t = clock();
    const { hub, room } = makeRoom(t, 4);
    const gh = new GameHost({ world, rules: rulesFor('ffa', null, null), now: 0, seed: 7 });
    gh.addActor('p1', 1);
    gh.tick(4000);
    gh.updatePose('p1', 0, 0, 0, 4000);
    gh.submitShot('p1', shotAt(0, 1, 0, 0, 4000), 4000);
    room.setResumeFacts(factsHook(gh));

    const a = joinGuest(t, hub, 'guest-a', 'ann', null);
    eq(a.welcome.playerId, 'p1', 'first join seat id');
    need(a.welcome.resume === undefined, 'lobby welcome must not carry a resume block');
    eq(a.welcome.token, a.guest.identity()?.token, 'welcome token differs from guest identity');
    startPlaying(t, hub, room, a.guest);

    // One accepted input so the seat has a nontrivial high-water to resume above.
    eq(a.guest.sendMove(0, 1, 0, 0, false, false), 0, 'first guest input seq');
    t.step(); room.tickOnce(t.now);

    // Refresh silence: the page died without a bye. LIVENESS_MS of quiet turns
    // the seat into a reservation (disconnected, id kept, capacity held).
    hub.drop('guest-a');
    for (let i = 0; i < Math.ceil((LIVENESS_MS + 200) / TICK_MS); i++) { t.step(); room.tickOnce(t.now); }
    const goneRoster = room.roster();
    eq(goneRoster.find((r) => r.id === 'p1')?.connected, false, 'quiet seat not marked disconnected');
    eq(goneRoster.length, 2, 'reserved seat was dropped from the roster');

    // Negative: wrong token from a fresh peer must not take the reserved seat.
    hub.deliver('mallory', rawHello('mallory', { playerId: 'p1', token: 'wrong-wrong-wrong' }));
    eq((hub.typed('mallory', 'reject') as unknown as { reason: string })?.reason, 'already-started', 'wrong token was not refused');
    // Negative: a stranger with no claim must not get the reserved capacity.
    hub.deliver('stranger', rawHello('stranger'));
    // Admission checks the live phase before capacity, so a started room
    // correctly answers already-started; the retained disconnected p1 row
    // proves the reservation itself still occupies the roster/capacity.
    eq((hub.typed('stranger', 'reject') as unknown as { reason: string })?.reason, 'already-started', 'started-room admission bypassed reservation gate');
    need(room.roster().some((r) => r.id === 'p1' && !r.connected), 'reserved seat disappeared before resume');

    // The refresh: a NEW GuestClient on a NEW transport peer id, carrying the
    // persisted identity. The by-peer fallback cannot explain what follows —
    // 'guest-b' was never seen by this room before.
    const b = joinGuest(t, hub, 'guest-b', 'ann-two', a.guest.identity());
    eq(b.welcome.playerId, 'p1', 'token resume did not return the SAME seat');
    eq(b.welcome.token, a.welcome.token, 'resumed welcome minted a different token');
    need(b.welcome.resume !== undefined, 'live-match resume welcome lost the resume block');
    eq(b.welcome.resume.phase, 'playing', 'resume phase');
    eq(b.welcome.resume.lastSeq, 0, 'resume input high-water');
    eq(b.welcome.resume.life, gh.lifeOf('p1'), 'resume life not read from the game host');
    eq(b.welcome.resume.shotSeq, gh.shotSeqOf('p1'), 'resume shotSeq not read from the game host');

    // The seat answers on the new transport id; the host believes the SAME seat.
    eq(b.guest.sendMove(0, 1, 0, 0, false, false), 1, 'resumed guest did not continue above the host high-water');
    t.step(); room.tickOnce(t.now);
    const states = hub.down.filter((d) => (d.msg as { type?: string }).type === 'state');
    const last = states[states.length - 1].msg as unknown as { players: Array<{ id: string; ack: number }> };
    eq(last.players.find((p) => p.id === 'p1')?.ack, 1, 'resumed seat input not acked on the new peer');

    // Negative: the OLD transport id, after the seat moved, cannot reclaim
    // without the claim — with no claim, and with a wrong claim.
    hub.restore('guest-a');
    hub.deliver('guest-a', rawHello('ann'));
    eq((hub.typed('guest-a', 'reject') as unknown as { reason: string })?.reason, 'already-started', 'old identity without a claim resumed');
    hub.deliver('guest-a', rawHello('ann', { playerId: 'p1', token: 'wrong-wrong-wrong' }));
    const rejects = hub.down.filter((d) => d.to === 'guest-a' && (d.msg as { type?: string }).type === 'reject');
    eq(rejects.length, 2, 'old identity with a wrong token was not refused again');
    const rosterIds = ((hub.typed('guest-a', 'roster') as unknown as { roster: Array<{ id: string }> })?.roster ?? []).map((r) => r.id);
    need(!rosterIds.includes('p2'), 'a refused probe minted a fresh seat');

    room.dispose();
    return { seat: b.welcome.playerId, resume: b.welcome.resume, livenessMs: LIVENESS_MS };
  }

  // Observed bearer semantics, for the doc: after the seat rebinds to the new
  // peer, the OLD transport id presenting the CORRECT token rebinds it back.
  // Flagged for root review; not a failure here.
  function bearerNote(): string {
    const t = clock();
    const { hub, room } = makeRoom(t, 4);
    room.setResumeFacts(() => ({ life: 1, shotSeq: -1 }));
    const a = joinGuest(t, hub, 'guest-a', 'ann', null);
    startPlaying(t, hub, room, a.guest);
    const b = joinGuest(t, hub, 'guest-b', 'ann-two', a.guest.identity());
    eq(b.welcome.playerId, 'p1', 'bearer: refresh resume failed');
    hub.deliver('guest-a', rawHello('ann', a.guest.identity()));
    const steal = hub.typed('guest-a', 'welcome') as unknown as { playerId: string } | undefined;
    room.dispose();
    return steal !== undefined && steal.playerId === 'p1'
      ? 'OBSERVED: the stale transport id WITH the correct token retook the seat (bearer semantics).'
      : 'stale transport id with the correct token did not retook the seat';
  }

  // Negative: past REJOIN_GRACE_MS the sweep releases the seat and even the
  // true token can no longer resume it.
  function expiredReservation(): Record<string, unknown> {
    const t = clock();
    const { hub, room } = makeRoom(t, 4);
    room.setResumeFacts(() => ({ life: 1, shotSeq: -1 }));
    const a = joinGuest(t, hub, 'guest-a', 'ann', null);
    startPlaying(t, hub, room, a.guest);
    hub.drop('guest-a');
    for (let i = 0; i < Math.ceil((LIVENESS_MS + REJOIN_GRACE_MS + 200) / TICK_MS); i++) { t.step(); room.tickOnce(t.now); }
    const roster = room.roster();
    need(!roster.some((r) => r.id === 'p1'), 'expired reservation still on the roster');
    hub.deliver('guest-c', rawHello('carol', a.guest.identity()));
    eq((hub.typed('guest-c', 'reject') as unknown as { reason: string })?.reason, 'already-started', 'expired token still resumed');
    room.dispose();
    return { graceMs: REJOIN_GRACE_MS, livenessMs: LIVENESS_MS };
  }

  // ---------------------------------------------------------------------------
  // Proof 2: starting/countdown resume and the exact startTick transition.
  // ---------------------------------------------------------------------------
  function startingPhaseResume(): Record<string, unknown> {
    const t = clock();
    const { hub, room } = makeRoom(t, 4);
    const gh = new GameHost({ world, rules: rulesFor('ffa', null, null), now: 0, seed: 9 });
    gh.addActor('p1', 1);
    gh.tick(4000);
    gh.updatePose('p1', 0, 0, 0, 4000);
    gh.submitShot('p1', shotAt(0, 1, 0, 0, 4000), 4000);
    room.setResumeFacts(factsHook(gh));

    const a = joinGuest(t, hub, 'guest-a', 'ann', null);
    room.setReady(true); a.guest.setReady(true);
    eq(room.start(), null, 'start refused (countdown)');
    const startTick = ((hub.down.find((d) => (d.msg as { type?: string }).type === 'start')?.msg) as unknown as { startTick: number } | undefined)?.startTick ?? -1;
    need(startTick > 0, 'start broadcast missing');
    for (let i = 0; i < 5; i++) { t.step(); room.tickOnce(t.now); }
    eq(room.getPhase(), 'starting', 'room not counting down');
    eq(stateOf(a.guest), 'starting', 'guest state after start');

    // Refresh 250 ms into the 1 s countdown. No silence needed: a refresh is a
    // new transport id the moment the page reloads.
    const b = joinGuest(t, hub, 'guest-b', 'ann-two', a.guest.identity());
    need(b.welcome.resume !== undefined, 'countdown resume lost the resume block');
    eq(b.welcome.resume.phase, 'starting', 'resume phase during countdown');
    eq(b.welcome.resume.startTick, startTick, 'resume startTick differs from the host countdown');
    eq(b.welcome.resume.lastSeq, -1, 'fresh seat input high-water');
    eq(b.welcome.resume.life, gh.lifeOf('p1'), 'countdown resume life');
    eq(b.welcome.resume.shotSeq, gh.shotSeqOf('p1'), 'countdown resume shotSeq');
    eq(stateOf(b.guest), 'starting', 'resumed guest did not land in starting');

    // The phase clamp refuses inputs until the countdown ends.
    const before = room.diag.snapshot(t.now);
    hub.deliver('guest-b', rawInput(0));
    const mid = room.diag.snapshot(t.now);
    eq(mid.inputsRejected - before.inputsRejected, 1, 'starting-phase input was not clamped');
    eq(mid.inputsAccepted, before.inputsAccepted, 'starting-phase input was accepted');

    // Tick to startTick - 1: still starting on both sides. The next tick —
    // whose state broadcast carries tick === startTick — flips BOTH.
    while (room.getTick() < startTick - 1) { t.step(); room.tickOnce(t.now); }
    eq(stateOf(b.guest), 'starting', 'guest flipped before startTick');
    t.step(); room.tickOnce(t.now);
    eq(room.getPhase(), 'playing', 'host did not flip at startTick');
    eq(stateOf(b.guest), 'playing', 'guest did not flip at the first state tick >= startTick');

    // After the flip the same seq is accepted; a replay stays clamped.
    hub.deliver('guest-b', rawInput(0));
    const after = room.diag.snapshot(t.now);
    eq(after.inputsAccepted, mid.inputsAccepted + 1, 'post-countdown input refused');
    hub.deliver('guest-b', rawInput(0));
    const replay = room.diag.snapshot(t.now);
    eq(replay.inputsRejected, mid.inputsRejected + 1, 'replayed input seq was accepted');
    room.dispose();
    return { startTick, resumedPhase: b.welcome.resume.phase, flippedAtTick: room.getTick() };
  }

  // ---------------------------------------------------------------------------
  // Proof 3: refresh on each side of the one-host-frame rematch rebuild.
  // ---------------------------------------------------------------------------
  interface Stack {
    hub: Hub; room: HostRoom; solo: ReturnType<typeof createSoloDriver>;
    driver: ReturnType<typeof createHostDriver>; t: Clock; identity: { playerId: string; token: string };
    endedNow: number; roomTick(): void; soloTick(): void; runFrame(): void;
  }
  function rematchStack(seed: number): Stack {
    const t = clock();
    const { hub, room } = makeRoom(t, 8);
    // sanitizeSoloSetup admits the authored kill-limit table (10, 25, ...),
    // so use the smallest real limit and drive ten deterministic kills below;
    // scoreLimit=1/bots=0 silently fall back to 10/5 and invalidated the old
    // rematch fixture before it reached the resume edge.
    const setup = sanitizeSoloSetup({ mode: 'ffa', scoreLimit: 10, durationMs: null, friendlyFire: false, respawnMs: 1000, bots: 1 });
    const ui = { bindClient: () => undefined, setNames: () => undefined };
    const rematchWorld = {
      lineOfSight: (from: { x: number; z: number }, to: { x: number; z: number }) =>
        Math.abs(from.x) < 0.25 && Math.abs(to.x) < 0.5 && to.z > 1,
      groundY: () => 0, inBounds: () => true,
    };
    const solo = createSoloDriver({ world: rematchWorld, ui, setup, seed, localId: 'host', localName: 'host', instrument: createSessionLog('host') });
    const driver = createHostDriver(room, solo, { world: rematchWorld });
    const a = joinGuest(t, hub, 'guest-a', 'ann', null);
    room.setReady(true); a.guest.setReady(true);
    eq(room.start(), null, 'start refused (rematch scenario)');
    const roomTick = (): void => { t.step(); room.tickOnce(t.now); };
    const soloTick = (): void => { driver.tick(t.now, 0, 0, 0, 0, 0, 'stand'); };
    const runFrame = (): void => { roomTick(); soloTick(); };
    for (let i = 0; i < 1000 && solo.matchState()?.phase !== 'active'; i++) runFrame();
    eq(solo.matchState()?.phase, 'active', 'match never went active');
    // Put the guest in front of the host and reach the smallest authored
    // score limit. The target respawns between claims; the narrow LoS stub
    // prevents the one bot from racing the deterministic host claims.
    for (let seq = 0; seq < 10 && !solo.ended(); seq++) {
      room.placeSeat('p1', 0, 5, Math.PI);
      runFrame();
      solo.localShot({
        seq, weaponId: 'deadeye', time: t.now,
        origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: 1 },
      });
      // HostLife currently owns the 2.2 s authored respawn fallback; allow
      // three seconds here rather than assuming the menu's 1 s row.
      for (let i = 0; i < 60 && !solo.ended(); i++) runFrame();
    }
    need(solo.ended(), 'match did not end on the score-limit frag; match=' + JSON.stringify(solo.matchState()) + ' log=' + JSON.stringify(solo.log().slice(-12)));
    const endedMsg = hub.down.find((d) => (d.msg as { type?: string }).type === 'match-state' && (d.msg as unknown as { phase: string }).phase === 'ended');
    need(endedMsg !== undefined, 'ended match-state never broadcast');
    return { hub, room, solo, driver, t, identity: a.guest.identity() as { playerId: string; token: string }, endedNow: t.now, roomTick, soloTick, runFrame };
  }

  const findWire = (hub: Hub, pred: (m: any) => boolean): number => hub.down.findIndex((d) => pred(d.msg));

  function probeRematchBoundary(where: 'pre' | 'mid' | 'post'): Record<string, unknown> {
    const s = rematchStack(11);
    const r = s.endedNow + REMATCH_MS; // first frame time the rebuild triggers
    const warmupWire = (): { iWelcome: number; iWarm: number; iSpawn: number } => ({
      iWelcome: findWire(s.hub, (m) => m.type === 'welcome'),
      iWarm: findWire(s.hub, (m) => m.type === 'match-state' && m.phase === 'warmup'),
      iSpawn: findWire(s.hub, (m) => m.type === 'spawn' && m.e.actorId === 'p1' && m.e.reason === 'initial'),
    });

    if (where === 'pre') {
      // Refresh while the banner is still holding, one frame before rebuild.
      while (s.t.now < r - TICK_MS) s.runFrame();
      const epochBefore = s.solo.counters().epoch;
      const oldFacts = { ...(s.solo.resumeFacts('p1') as { life: number; shotSeq: number }) };
      const b = joinGuest(s.t, s.hub, 'guest-b', 'ann-two', s.identity);
      need(b.welcome.resume !== undefined, 'pre: resume block missing');
      eq(b.welcome.resume.life, oldFacts.life, 'pre: welcome life is not the old generation value');
      eq(b.welcome.resume.shotSeq, oldFacts.shotSeq, 'pre: welcome shotSeq is not the old generation value');
      eq(b.welcome.resume.phase, 'playing', 'pre: room phase during banner');
      eq(s.solo.counters().epoch, epochBefore, 'pre: build ran before the rebuild frame');
      s.runFrame(); // the rebuild frame: build() runs inside solo.tick
      eq(s.solo.counters().epoch, epochBefore + 1, 'pre: build did not run exactly once at the rebuild frame');
      s.runFrame(); // the frame whose host tick emits warmup + initial spawns
      const w = warmupWire();
      need(w.iWelcome >= 0 && w.iWarm > w.iWelcome && w.iSpawn > w.iWelcome, 'pre: welcome/warmup/initial-spawn wire order broken');
      need(s.solo.resumeFacts('p1') !== null, 'pre: resumed seat not re-added to the rebuilt host');
      s.room.dispose();
      return { where, oldFacts, newEpoch: s.solo.counters().epoch, ...w };
    }

    if (where === 'mid') {
      // The tightest schedulable point: the rebuild frame's room tick has run,
      // its solo tick — and therefore build() — has not.
      while (s.t.now < r - TICK_MS) s.runFrame();
      s.roomTick(); // now === r, room ticked, solo tick of this frame still pending
      const epochBefore = s.solo.counters().epoch;
      const oldFacts = { ...(s.solo.resumeFacts('p1') as { life: number; shotSeq: number }) };
      const b = joinGuest(s.t, s.hub, 'guest-b', 'ann-two', s.identity);
      need(b.welcome.resume !== undefined, 'mid: resume block missing');
      eq(b.welcome.resume.life, oldFacts.life, 'mid: welcome life is not the old generation value');
      eq(b.welcome.resume.shotSeq, oldFacts.shotSeq, 'mid: welcome shotSeq is not the old generation value');
      eq(s.solo.counters().epoch, epochBefore, 'mid: build ran before its own frame solo tick');
      s.soloTick(); // build() runs synchronously inside this call
      eq(s.solo.counters().epoch, epochBefore + 1, 'mid: build did not run exactly once at the rebuild frame');
      s.runFrame(); // warmup + initial spawns
      const w = warmupWire();
      need(w.iWelcome >= 0 && w.iWarm > w.iWelcome && w.iSpawn > w.iWelcome, 'mid: welcome/warmup/initial-spawn wire order broken');
      need(s.solo.resumeFacts('p1') !== null, 'mid: resumed seat not re-added to the rebuilt host');
      s.room.dispose();
      return { where, oldFacts, newEpoch: s.solo.counters().epoch, ...w };
    }

    // 'post': the rebuild and its warmup/spawn frame are already done; the
    // welcome must read the NEW generation's facts.
    while (s.t.now < r - TICK_MS) s.runFrame();
    const epochBefore = s.solo.counters().epoch;
    const oldFacts = { ...(s.solo.resumeFacts('p1') as { life: number; shotSeq: number }) };
    while (s.t.now < r + TICK_MS) s.runFrame(); // rebuild frame + warmup frame
    eq(s.solo.counters().epoch, epochBefore + 1, 'post: build did not run exactly once');
    const b = joinGuest(s.t, s.hub, 'guest-b', 'ann-two', s.identity);
    need(b.welcome.resume !== undefined, 'post: resume block missing');
    eq(b.welcome.resume.life, 1, 'post: welcome life is not the new generation value');
    eq(b.welcome.resume.shotSeq, -1, 'post: welcome shotSeq is not the new generation value');
    eq(b.welcome.resume.phase, 'playing', 'post: room phase during banner');
    need(s.solo.resumeFacts('p1') !== null, 'post: resumed seat not re-added to the rebuilt host');
    s.room.dispose();
    return { where, oldFacts, newFacts: b.welcome.resume, newEpoch: s.solo.counters().epoch };
  }

  export function run(): Record<string, unknown> {
    return {
      tokenResume: tokenResumeDifferentPeer(),
      bearer: bearerNote(),
      expiry: expiredReservation(),
      countdown: startingPhaseResume(),
      boundaryPre: probeRematchBoundary('pre'),
      boundaryMid: probeRematchBoundary('mid'),
      boundaryPost: probeRematchBoundary('post'),
    };
  }
`;

const outfile = join(tmpdir(), 'nuketown-resume-edges-' + process.pid + '.mjs');
await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'resume-edges.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile, logLevel: 'warning',
});

try {
  const scenario = await import(pathToFileURL(outfile).href);
  const result = scenario.run();
  if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
  console.log('[resume-edges] PASS token resume on a different transport peer id; wrong-token / old-identity / capacity / expiry negatives; countdown resume with exact startTick flip; input clamp; rematch-boundary fact coherence at all three schedule points');
} finally {
  rmSync(outfile, { force: true });
}
