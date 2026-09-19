/**
 * Nuketown 2025 — the authoritative match driver: one host, one client, N bots,
 * and any remote humans a room hands it.
 *
 * This is the body of what `session.ts` used to be, parameterised by a
 * `SoloSetup` (bot count, difficulty, limits, respawn, team layout) and given
 * REMOTE SEATS so the same driver serves both a solo match and the host side
 * of a multiplayer one. A remote seat is a human whose position arrives from
 * `net/room.ts` (which owns position) and whose shots arrive as `ShotMsg`
 * claims over the wire; to the host below they are actors like any other, and
 * to `main.ts` they are bodies in `bots()` like any bot — one rig for players,
 * bots, remotes and corpses.
 *
 * The host is the only writer. The human, every bot and every remote reach it
 * the same way: `updatePose`, `submitInput`, `submitShot`, `submitStreakIntent`.
 * Nothing in this file resolves a hit, moves a score or decides a death.
 *
 * ## What "a match actually runs" means here
 *
 * On the first tick the host admits the human, the remotes and `setup.bots`
 * bots, balanced per `setup.teams`, and the match walks warmup → active →
 * ended on the real clock. When it ends the banner holds for `REMATCH_MS` and
 * a whole new host, runtime and director are built (or sooner, on
 * `rematchNow()` from the end screen). A match that ends and never restarts
 * leaves the player looking at VICTORY with nothing to do, which is a worse
 * bug than not shipping the end condition at all.
 */

import { MAX_PLAYERS, type MatchStateMsg, type PlayerSample, type ShotMsg, type StreakStateMsg } from '../net/protocol';
import { TICK_HZ } from '../net/snapshot';
import type { ShotClaim } from '../weapons/controller';
import { BotDirector, nextBotTeam, type BotActorView } from './bots';
import { GameClient } from './client';
import type { ActorId, GameEvent, TeamId, WorldQuery } from './events';
import { GameHost } from './host';
import type { HostSnapshot, ShotAdmission } from './host-ports';
import { STREAK_CATALOG } from './killstreaks/catalog';
import { StreakRuntime } from './killstreaks/runtime';
import { BOT_DIFFICULTY_PRESETS, TEAM_A, opposingTeam, rulesForSetup, type SoloSetup } from './rules';
import type { SessionLog } from './session-log';
import { directorNumbers, streakPort } from './session-streaks';
import type { BotBody, MatchDriver, MatchUi } from './session-types';

/** The host runs at the netcode's tick, not the frame rate, so a 144 Hz
 *  machine and a 60 Hz one see the same match. `net/snapshot.ts` owns it. */
const TICK_MS = 1000 / TICK_HZ;
/** Guard against a backgrounded tab catching up in one frame: at most this
 *  many host ticks are run per call, and the rest of the debt is dropped. */
const MAX_CATCHUP_TICKS = 4;
/** How long the end-of-match screen holds before a fresh match is built.
 *  Long enough to read the scoreboard, short enough not to feel stranded. */
export const REMATCH_MS = 9_000;

export interface SoloDriverOptions {
  readonly world: WorldQuery;
  readonly ui: MatchUi;
  readonly setup: SoloSetup;
  readonly seed?: number;
  /** Put the human where the host deployed them. `core/player.ts` owns position. */
  readonly placeLocal?: (x: number, y: number, z: number, yaw: number) => void;
  readonly localId: ActorId;
  readonly localName: string;
  readonly localTeam?: TeamId;
  /** Shared across drivers so `counters()` stays session-cumulative. */
  readonly instrument: SessionLog;
}

/** A remote human's seat: position from the room, everything else from the host. */
interface RemoteSeat {
  readonly id: ActorId;
  name: string;
  team: TeamId;
  x: number; y: number; z: number; yaw: number;
  speed: number;
  alive: boolean;
  seq: number;
}

/** Mutable body record reused every frame, so `bots()` allocates nothing. */
interface Body { id: ActorId; x: number; y: number; z: number; yaw: number; speed: number; alive: boolean }

export type EventSink = (events: readonly GameEvent[], now: number) => void;

export interface SoloDriver extends MatchDriver {
  addRemote(id: ActorId, name: string, team: TeamId): void;
  removeRemote(id: ActorId): void;
  /** The room integrated this seat to here. Called once per room tick. */
  remotePose(id: ActorId, x: number, y: number, z: number, yaw: number): void;
  remoteShot(id: ActorId, claim: ShotMsg, receivedAt: number): ShotAdmission | null;
  remoteStreak(id: ActorId, slot: number, toggle: boolean): void;
  /** Every event the host produced, after the local client has seen it. One sink. */
  setEventSink(sink: EventSink | null): void;
  matchState(): MatchStateMsg | null;
  streakStateFor(id: ActorId, now: number): StreakStateMsg | null;
  stampSample(s: PlayerSample): PlayerSample;
  /** Bots as wire samples, for a room that must show them to guests. */
  botSamples(into: PlayerSample[]): void;
}

/** Display names, DERIVED from the ids. No second roster of callsigns (§5.5). */
export function displayNameFor(id: ActorId, localId: ActorId): string {
  return id === localId ? 'YOU' : id.replace(/-/g, ' ').toUpperCase();
}

export function createSoloDriver(opts: SoloDriverOptions): SoloDriver {
  const { world, ui, setup, instrument } = opts;
  const localId = opts.localId;
  const localTeam: TeamId = opts.localTeam ?? TEAM_A;
  const rules = rulesForSetup(setup);
  const botCount = Math.min(setup.bots, MAX_PLAYERS - 1);
  const difficulty = BOT_DIFFICULTY_PRESETS[setup.difficulty];
  const client = new GameClient(localId);
  client.setStreakNames(STREAK_CATALOG.definitions.map((d) => [d.id, d.displayName] as const));
  ui.bindClient(client);

  const seats = new Map<ActorId, RemoteSeat>();
  const bodies: Body[] = [];
  const bodyById = new Map<ActorId, Body>();
  let sink: EventSink | null = null;
  let epoch = 0;
  let host: GameHost | null = null;
  let director: BotDirector | null = null;
  let streaks: StreakRuntime | null = null;
  let lastMatch: MatchStateMsg | null = null;
  let pending = true;
  let acc = 0;
  let last = 0;
  let inputSeq = 0;
  let endedAt: number | null = null;
  let disposed = false;
  const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const sampleBuf: PlayerSample[] = [];

  const pushNames = (): void => {
    const names: [string, string][] = [[localId, opts.localName]];
    for (const s of seats.values()) names.push([s.id, s.name]);
    if (director !== null) for (const b of director.roster) names.push([b.id, displayNameFor(b.id, localId)]);
    ui.setNames(names);
  };

  const build = (now: number): void => {
    // Bank the outgoing director's numbers BEFORE it is dropped. This is the
    // only moment they still exist; after the reassignment below they are gone.
    if (director !== null) instrument.retireDirector(directorNumbers(director));
    epoch++;
    const runtime = new StreakRuntime({ seed: (opts.seed ?? 1) + epoch, matchEpoch: epoch });
    const h = new GameHost({
      world, rules, now, seed: (opts.seed ?? 0x4e554b45) + epoch,
      deps: { streaks: streakPort(runtime, epoch) },
    });
    const d = new BotDirector({ host: h, world, rand: h.rand, maxBots: MAX_PLAYERS - 1, difficulty });
    h.addActor(localId, localTeam);
    for (const s of seats.values()) h.addActor(s.id, s.team);
    const humans = [{ team: localTeam }, ...[...seats.values()].map((s) => ({ team: s.team }))];
    for (let i = 0; i < botCount; i++) {
      const team = rules.mode !== 'ffa' && setup.teams === 'enemies'
        ? opposingTeam(localTeam)
        : nextBotTeam([...humans, ...d.roster], localTeam);
      d.add(team);
    }
    host = h;
    director = d;
    streaks = runtime;
    pushNames();
    instrument.newMatch();
    endedAt = null;
    last = now;
    acc = 0;
  };

  /** Events the host produced this tick: to the client, the instrument, the
   *  bodies that must move, and — when a room is listening — the wire. */
  const route = (d: BotDirector, events: readonly GameEvent[], now: number): void => {
    for (const e of events) {
      client.applyEvent(e);
      instrument.record(e);
      if (e.type === 'spawn') {
        d.onSpawn(e.actorId, e.x, e.y, e.z, e.yaw);
        if (e.actorId === localId) opts.placeLocal?.(e.x, e.y, e.z, e.yaw);
        const s = seats.get(e.actorId);
        if (s !== undefined) { s.x = e.x; s.y = e.y; s.z = e.z; s.yaw = e.yaw; s.alive = true; }
      } else if (e.type === 'death') {
        d.onDeath(e.victimId, localTeam);
      } else if (e.type === 'match-phase' && e.phase === 'ended' && endedAt === null) {
        endedAt = now;
      }
    }
    if (sink !== null && events.length > 0) sink(events, now);
  };

  /**
   * The wire's `PlayerSample[]`, authored here because the local client has no
   * `net/room.ts`. Coordinates are this file's (the host owns none) and
   * hp/team/alive are stamped by the host — exactly the split that made those
   * three fields optional in Wave 0. The buffer is reused; the client copies.
   */
  const samples = (h: GameHost, d: BotDirector): PlayerSample[] => {
    sampleBuf.length = 0;
    sampleBuf.push(h.stampSample({ id: localId, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, ack: inputSeq }));
    for (const s of seats.values()) {
      sampleBuf.push(h.stampSample({ id: s.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, ack: s.seq }));
    }
    for (const b of d.roster) {
      sampleBuf.push(h.stampSample({ id: b.id, x: b.x, y: b.y, z: b.z, yaw: b.yaw, ack: 0 }));
    }
    return sampleBuf;
  };

  const step = (h: GameHost, d: BotDirector, now: number): void => {
    const dt = TICK_MS / 1000;
    h.updatePose(localId, pose.x, pose.y, pose.z, now);
    h.submitInput(localId, {
      type: 'input', seq: ++inputSeq, mx: 0, mz: 0,
      yaw: pose.yaw, pitch: pose.pitch, fire: false, jump: false,
    });
    for (const s of seats.values()) {
      h.updatePose(s.id, s.x, s.y, s.z, now);
      h.submitInput(s.id, { type: 'input', seq: ++s.seq, mx: 0, mz: 0, yaw: s.yaw, pitch: 0, fire: false, jump: false });
    }
    const snap = h.snapshot();
    const humans: BotActorView[] = [];
    for (const a of snap.actors) {
      if (a.id === localId) humans.push({ id: a.id, team: a.team, alive: a.alive, x: pose.x, y: pose.y, z: pose.z });
      const s = seats.get(a.id);
      if (s !== undefined) {
        s.alive = a.alive;
        humans.push({ id: s.id, team: a.team, alive: a.alive, x: s.x, y: s.y, z: s.z });
      }
    }
    d.tick(now, dt, humans, snap.actors, snap.ordnance.drops);
    route(d, h.tick(now), now);
    const after = h.snapshot();
    lastMatch = after.match;
    client.applySnapshot({
      at: now, match: after.match,
      streak: streaks === null ? null : streaks.streakStateFor(localId, now),
      players: samples(h, d),
    });
  };

  const body = (id: ActorId): Body => {
    let b = bodyById.get(id);
    if (b === undefined) {
      b = { id, x: 0, y: 0, z: 0, yaw: 0, speed: 0, alive: true };
      bodyById.set(id, b);
      bodies.push(b);
    }
    return b;
  };

  return {
    localId,
    log: () => instrument.lines.slice(),
    // Everything here is SESSION-cumulative except `bots` and `matchKills`.
    // `session-log.ts` banks each director's numbers as it is retired and
    // `botTotals` adds the live one back on, so a rematch cannot zero them.
    counters: () => ({
      ...instrument.tally, epoch,
      bots: director === null ? 0 : director.roster.length,
      remotes: seats.size,
      ...instrument.botTotals(director === null ? null : directorNumbers(director)),
    }),
    ended: () => endedAt !== null,
    netLine: () => null,

    tick(now, x, y, z, yaw, pitch): void {
      if (disposed) return;
      pose.x = x; pose.y = y; pose.z = z; pose.yaw = yaw; pose.pitch = pitch;
      if (pending) {
        // Built on the first tick so the host clock starts in the same
        // `performance.now()` domain the frame loop will feed it.
        pending = false;
        build(now);
        return;
      }
      if (endedAt !== null && now - endedAt >= REMATCH_MS) {
        build(now);
        return;
      }
      const h = host;
      const d = director;
      if (h === null || d === null) return;
      acc += Math.max(0, now - last);
      last = now;
      let ticks = 0;
      while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
        acc -= TICK_MS;
        ticks++;
        step(h, d, now - acc);
      }
      // A tab that was backgrounded owes hours of ticks. Replaying them would
      // resolve every queued shot against a stale pose and fast-forward the
      // match; dropping the debt costs nothing but wall-clock accuracy.
      if (acc > TICK_MS * MAX_CATCHUP_TICKS) acc = 0;
    },

    rematchNow(): void {
      if (endedAt !== null) endedAt = -Infinity;
    },

    localShot(claim: ShotClaim): void {
      const h = host;
      if (h === null) return;
      const life = h.lifeOf(localId);
      if (life === null) return;
      h.submitShot(localId, {
        type: 'shot', seq: claim.seq, life, weaponId: claim.weaponId, firedAt: claim.time,
        ox: claim.origin.x, oy: claim.origin.y, oz: claim.origin.z,
        dx: claim.direction.x, dy: claim.direction.y, dz: claim.direction.z,
      }, performance.now());
    },

    pressStreak(slot): void {
      if (host !== null) host.submitStreakIntent(localId, { type: 'streak-intent', slot, toggle: false });
    },

    bots(): readonly BotBody[] {
      if (director !== null) {
        for (const r of director.roster) {
          const b = body(r.id);
          b.x = r.x; b.y = r.y; b.z = r.z; b.yaw = r.yaw; b.speed = r.speed; b.alive = r.alive;
        }
      }
      for (const s of seats.values()) {
        const b = body(s.id);
        b.x = s.x; b.y = s.y; b.z = s.z; b.yaw = s.yaw; b.speed = s.speed; b.alive = s.alive;
      }
      return bodies;
    },

    snapshot(): HostSnapshot {
      if (host === null) throw new Error('[session] no match yet - call begin() first');
      return host.snapshot();
    },

    // ---- remote seats (the room host binding) --------------------------------

    addRemote(id, name, team): void {
      let s = seats.get(id);
      if (s === undefined) {
        s = { id, name, team, x: 0, y: 0, z: 0, yaw: 0, speed: 0, alive: true, seq: 0 };
        seats.set(id, s);
      }
      s.name = name;
      s.team = team;
      host?.addActor(id, team);
      pushNames();
    },

    removeRemote(id): void {
      if (!seats.delete(id)) return;
      host?.removeActor(id);
      const b = bodyById.get(id);
      if (b !== undefined) {
        bodyById.delete(id);
        bodies.splice(bodies.indexOf(b), 1);
      }
      pushNames();
    },

    remotePose(id, x, y, z, yaw): void {
      const s = seats.get(id);
      if (s === undefined) return;
      s.speed = Math.hypot(x - s.x, z - s.z) * TICK_HZ;
      s.x = x; s.y = y; s.z = z; s.yaw = yaw;
    },

    remoteShot(id, claim, receivedAt): ShotAdmission | null {
      if (host === null || !seats.has(id)) return null;
      return host.submitShot(id, claim, receivedAt);
    },

    remoteStreak(id, slot, toggle): void {
      if (host !== null && seats.has(id)) host.submitStreakIntent(id, { type: 'streak-intent', slot, toggle });
    },

    setEventSink(s): void { sink = s; },
    matchState: () => lastMatch,
    streakStateFor: (id, now) => (streaks === null ? null : streaks.streakStateFor(id, now)),
    stampSample: (s) => (host === null ? s : host.stampSample(s)),
    botSamples(into): void {
      if (director === null || host === null) return;
      for (const b of director.roster) {
        into.push(host.stampSample({ id: b.id, x: b.x, y: b.y, z: b.z, yaw: b.yaw, ack: 0 }));
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (director !== null) instrument.retireDirector(directorNumbers(director));
      ui.bindClient(null);
      host = null;
      director = null;
      streaks = null;
    },
  };
}
