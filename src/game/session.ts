/**
 * Nuketown 2025 — the local match: one host, one client, N bots, no network.
 *
 * This is the integration seam IMPORT-PLAN §3 calls Wave 2. It exists so that
 * `main.ts` stays what AGENTS.md says it is — the only file that touches the
 * scene — and adds under thirty lines to do it. Everything here is DOM-free
 * and scene-free: it assembles `game/` modules and hands `main.ts` positions.
 *
 * ## The shape
 *
 *   createWorldQuery(colliders) ─→ GameHost ─→ events ─→ GameClient ─→ HUD
 *                                      ↑                    (ui lane)
 *                             BotDirector, the local
 *                             player's pose and shots
 *
 * The host is the only writer. The human and every bot reach it the same way:
 * `updatePose`, `submitInput`, `submitShot`, `submitStreakIntent`. Nothing in
 * this file resolves a hit, moves a score or decides a death.
 *
 * ## The adapter, and why it is here
 *
 * Lane C's `StreakRuntime` and the host's `StreakRuntimePort` are close but
 * not identical: the runtime wants a full `StreakIntent` (match epoch, gate
 * context, anchor) and answers with an `ActivationOutcome`. Translating that
 * is a wiring job, so it lives in the wiring file rather than in either lane's
 * module — neither of them should learn the other's spelling.
 *
 * ## What "a match actually runs" means here
 *
 * On the first `begin()` the host admits the human and `bots` bots, balanced,
 * and the match walks warmup → active → ended on the real clock. When it ends
 * the banner holds for `REMATCH_MS` and a whole new host, runtime and director
 * are built. That rematch is not decoration: a match that ends and never
 * restarts leaves the player looking at VICTORY with no respawn and nothing to
 * do, which is a worse bug than not shipping the end condition at all.
 */

import type { AABB } from '../core/kit';
import { MAX_PLAYERS, type PlayerSample } from '../net/protocol';
import { TICK_HZ } from '../net/snapshot';
import type { ShotClaim } from '../weapons/controller';
import { BotDirector, nextBotTeam, type BotActorView } from './bots';
import { GameClient } from './client';
import { GameHost } from './host';
import type { StreakPress, StreakRuntimePort, StreakTargetView } from './host-streaks';
import { STREAK_CATALOG } from './killstreaks/catalog';
import { StreakRuntime } from './killstreaks/runtime';
import { KILL_LIMITS, TEAM_A, rulesFor, type MatchRules } from './rules';
import { createSessionLog } from './session-log';
import { createWorldQuery } from './world-query';
import type { ActorId, GameEvent, TeamId, WorldQuery } from './events';
import type { HostSnapshot } from './host-ports';

/** The host runs at the netcode's tick, not the frame rate, so a 144 Hz
 *  machine and a 60 Hz one see the same match. `net/snapshot.ts` owns it. */
const TICK_MS = 1000 / TICK_HZ;
/** Guard against a backgrounded tab catching up in one frame: at most this
 *  many host ticks are run per call, and the rest of the debt is dropped. */
const MAX_CATCHUP_TICKS = 4;
/** How long the end-of-match banner holds before a fresh match is built.
 *  Long enough to read the scoreboard, short enough not to feel stranded. */
export const REMATCH_MS = 9_000;
/** Kills to win. `KILL_LIMITS[1]`, the smallest real limit on the lobby table:
 *  a 3v3 on a map 44 m across reaches it in a couple of minutes, and the whole
 *  arc — earn, spend, die, respawn, win — has to be reachable in one sitting. */
export const LOCAL_SCORE_LIMIT = KILL_LIMITS[1];
/** Default fill: 5 bots + the human is a 3v3, inside `LOBBY_CAPACITIES`. */
export const DEFAULT_BOTS = 5;
/** The human's actor id. One string, used by the host, the client and the feed. */
export const LOCAL_ACTOR_ID = 'you';

/** The UI lane's handle, narrowed to what a match needs from it. */
export interface MatchUi {
  bindClient(client: GameClient | null): void;
  setNames(names: Iterable<readonly [string, string]>): void;
}

/** One bot as `main.ts` needs it to drive a `characters/` rig. */
export interface BotBody {
  readonly id: ActorId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly alive: boolean;
}

export interface LocalMatchOptions {
  readonly colliders: readonly AABB[];
  readonly ui: MatchUi;
  readonly bots?: number;
  readonly rules?: MatchRules;
  readonly seed?: number;
  /**
   * Put the human where the host deployed them.
   *
   * The one effect hook in this file, and it is here because position is
   * `core/player.ts`'s to write — the host chooses the spawn point and
   * somebody has to move the controller to it. Without this a death is a
   * black-box: health returns, the player never goes anywhere, and the whole
   * respawn is invisible.
   */
  readonly placeLocal?: (x: number, y: number, z: number, yaw: number) => void;
}

export interface LocalMatch {
  /** Admit everyone and start ticking. Idempotent; the lobby calls it on play. */
  begin(): void;
  /** One frame. `now` is `performance.now()`; the host ticks at `TICK_HZ`. */
  tick(now: number, x: number, y: number, z: number, yaw: number, pitch: number): void;
  /** A trigger pull from `weapons/controller.ts`, stamped and submitted. */
  localShot(claim: ShotClaim): void;
  /** A streak key press from the human. */
  pressStreak(slot: number): void;
  bots(): readonly BotBody[];
  snapshot(): HostSnapshot;
  /** Bounded log of the events worth naming. Read by the integration proof. */
  log(): readonly string[];
  /** Running totals plus the bot roster's own numbers. */
  counters(): Record<string, number>;
  /**
   * The `WorldQuery` port, read-only, so a harness can FALSIFY it. Without a
   * way to ask "is this segment blocked" from outside, "line of sight works"
   * is an adjective; with it the proof can name two points a house sits
   * between and two down the open road, and be wrong about one of them.
   */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  groundY(x: number, z: number): number;
  readonly localId: ActorId;
}

/**
 * Lane C's runtime, wearing the host's port.
 *
 * Six of the eight methods pass straight through. `activate` fills in what the
 * wire cannot carry and unwraps `ActivationOutcome.events` — the accepted and
 * refused cases both travel as events, which is what keeps a refused press
 * from being a dead key (§5.4). `advance` gains the host's target table.
 */
export function streakPort(rt: StreakRuntime, matchEpoch: number): StreakRuntimePort {
  return {
    registerActor: (id: ActorId, team: TeamId) => rt.registerActor(id, team),
    recordElimination: (id, streak, now) => rt.recordElimination(id, streak, now),
    recordDeath: (id, now) => rt.recordDeath(id, now),
    recordDisconnect: (id, now) => rt.recordDisconnect(id, now),
    endMatch: (now) => rt.endMatch(now),
    snapshotFor: (id) => rt.snapshotFor(id),
    advance: (now: number, world: WorldQuery, targets: readonly StreakTargetView[]) =>
      rt.advance(now, world, targets),
    activate: (p: StreakPress, now: number, world: WorldQuery) => rt.activate({
      actorId: p.actorId, slot: p.slot, seq: p.seq, claimId: p.claimId,
      matchEpoch, toggle: p.toggle,
      origin: p.origin, aimYaw: p.aimYaw, anchor: p.anchor,
      // Lane C documents `StreakRuntime.lifeOf` as "the life epoch the host
      // must echo in a claim", and echoing is the only thing that works: the
      // runtime advances its epoch at DEATH (`recordDeath`) while `health.ts`
      // advances the host's at REVIVE, and it starts at 0 against the host's
      // 1. MEASURED with `p.life` passed through instead: a bot that had
      // banked a recon sweep pressed it for the last 16 s of a 90 s match and
      // produced ZERO events - every claim refused `life-epoch`, which is a
      // host-internal reject and therefore silent. The cost of echoing is
      // that the life check cannot catch a forged LOCAL press; it still
      // catches a remote one, which is the case it exists for.
      life: rt.lifeOf(p.actorId) ?? p.life,
      // The three UI truths lane C's gate can refuse on live in the menu
      // lifecycle, which the host cannot see. Asserted permissive: the gate
      // then never wrongly ALLOWS, it only fails to explain a UI block. Named
      // in the lane report rather than left as a silent `true`.
      context: {
        alive: p.alive, matchPhase: p.matchPhase, arenaSupported: true,
        inputEnabled: true, menuOpen: false, targetingOpen: false, possessionActive: false,
      },
    }, now, world).events as GameEvent[],
  };
}

/**
 * One director's whole numeric surface, in one place so the retire path and the
 * report path cannot read different sets. `metrics` plus the three counts the
 * director exposes as getters rather than as metric keys.
 */
function directorNumbers(d: BotDirector): Record<string, number> {
  return {
    ...d.metrics,
    botDeaths: d.deathCount,
    reinforcements: d.reinforcementCount,
    refusedReinforcements: d.refusedReinforcementCount,
  };
}

/** Display names, DERIVED from the ids. No second roster of callsigns (§5.5). */
function displayNameFor(id: ActorId): string {
  return id === LOCAL_ACTOR_ID ? 'YOU' : id.replace(/-/g, ' ').toUpperCase();
}

export function createLocalMatch(opts: LocalMatchOptions): LocalMatch {
  const world = createWorldQuery(opts.colliders);
  const rules = opts.rules ?? rulesFor('tdm', LOCAL_SCORE_LIMIT);
  const botCount = Math.min(opts.bots ?? DEFAULT_BOTS, MAX_PLAYERS - 1);
  const client = new GameClient(LOCAL_ACTOR_ID);
  client.setStreakNames(STREAK_CATALOG.definitions.map((d) => [d.id, d.displayName] as const));
  opts.ui.bindClient(client);

  let epoch = 0;
  let host: GameHost | null = null;
  let director: BotDirector | null = null;
  let streaks: StreakRuntime | null = null;
  let started = false;
  let pending = false;
  let acc = 0;
  let last = 0;
  let inputSeq = 0;
  let endedAt: number | null = null;
  let pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  /** Counters and a bounded log. `./session-log` owns the fold. */
  const instrument = createSessionLog(LOCAL_ACTOR_ID);

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
    const d = new BotDirector({ host: h, world, rand: h.rand, maxBots: MAX_PLAYERS - 1 });
    h.addActor(LOCAL_ACTOR_ID, TEAM_A);
    for (let i = 0; i < botCount; i++) d.add(nextBotTeam(d.roster, TEAM_A));
    const names: [string, string][] = [[LOCAL_ACTOR_ID, displayNameFor(LOCAL_ACTOR_ID)]];
    for (const b of d.roster) names.push([b.id, displayNameFor(b.id)]);
    opts.ui.setNames(names);
    host = h;
    director = d;
    streaks = runtime;
    instrument.newMatch();
    endedAt = null;
    last = now;
    acc = 0;
  };

  /** Events the host produced this tick: to the client, and to the two places
   *  that need to MOVE something — the human's controller and the bot bodies. */
  const route = (d: BotDirector, events: readonly GameEvent[], now: number): void => {
    for (const e of events) {
      client.applyEvent(e);
      instrument.record(e);
      if (e.type === 'spawn') {
        d.onSpawn(e.actorId, e.x, e.y, e.z, e.yaw);
        if (e.actorId === LOCAL_ACTOR_ID) opts.placeLocal?.(e.x, e.y, e.z, e.yaw);
      } else if (e.type === 'death') {
        d.onDeath(e.victimId, TEAM_A);
      } else if (e.type === 'match-phase' && e.phase === 'ended' && endedAt === null) {
        endedAt = now;
      }
    }
  };

  /**
   * The wire's `PlayerSample[]`, authored here because a local match has no
   * `net/room.ts`. Coordinates are this file's (the host owns none) and
   * hp/team/alive are stamped by the host - exactly the split that made those
   * three fields optional in Wave 0.
   */
  const samples = (h: GameHost, d: BotDirector): PlayerSample[] => {
    const out: PlayerSample[] = [h.stampSample({
      id: LOCAL_ACTOR_ID, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, ack: inputSeq,
    })];
    for (const b of d.roster) {
      out.push(h.stampSample({ id: b.id, x: b.x, y: b.y, z: b.z, yaw: b.yaw, ack: 0 }));
    }
    return out;
  };

  const step = (h: GameHost, d: BotDirector, now: number): void => {
    const dt = TICK_MS / 1000;
    h.updatePose(LOCAL_ACTOR_ID, pose.x, pose.y, pose.z, now);
    h.submitInput(LOCAL_ACTOR_ID, {
      type: 'input', seq: ++inputSeq, mx: 0, mz: 0,
      yaw: pose.yaw, pitch: pose.pitch, fire: false, jump: false,
    });
    const snap = h.snapshot();
    const human: BotActorView[] = [];
    const me = snap.actors.find((a) => a.id === LOCAL_ACTOR_ID);
    if (me) human.push({ id: me.id, team: me.team, alive: me.alive, x: pose.x, y: pose.y, z: pose.z });
    d.tick(now, dt, human, snap.actors);
    route(d, h.tick(now), now);
    const after = h.snapshot();
    client.applySnapshot({
      at: now, match: after.match,
      streak: streaks === null ? null : streaks.streakStateFor(LOCAL_ACTOR_ID, now),
      players: samples(h, d),
    });
  };

  const match: LocalMatch = {
    log: () => instrument.lines.slice(),
    los: (ax, ay, az, bx, by, bz) => world.lineOfSight({ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz }),
    groundY: (x, z) => world.groundY(x, z),
    // Everything here is SESSION-cumulative except `bots` and `matchKills`,
    // which are a level and a per-match count and say so. The bot numbers used
    // to be read straight off the live `BotDirector`, and `session.ts` builds a
    // NEW one on every rematch: `streakRefused` — the counter that proved the
    // 8ba75f7 streak livelock fix — therefore read 0 for the whole of match 2
    // however many refusals match 1 had, and a reader would conclude none
    // occurred. `session-log.ts` now banks each director's numbers as it is
    // retired and `botTotals` adds the live one back on.
    counters: () => ({
      ...instrument.tally, epoch,
      bots: director === null ? 0 : director.roster.length,
      ...instrument.botTotals(director === null ? null : directorNumbers(director)),
    }),
    localId: LOCAL_ACTOR_ID,

    begin(): void {
      if (started) return;
      started = true;
      // Built on the first tick, not here, so the host clock starts in the
      // same `performance.now()` domain the frame loop will feed it.
      pending = true;
    },

    tick(now, x, y, z, yaw, pitch): void {
      if (!started) return;
      pose = { x, y, z, yaw, pitch };
      if (pending) {
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

    localShot(claim): void {
      const h = host;
      if (h === null) return;
      const life = h.lifeOf(LOCAL_ACTOR_ID);
      if (life === null) return;
      h.submitShot(LOCAL_ACTOR_ID, {
        type: 'shot', seq: claim.seq, life, weaponId: claim.weaponId, firedAt: claim.time,
        ox: claim.origin.x, oy: claim.origin.y, oz: claim.origin.z,
        dx: claim.direction.x, dy: claim.direction.y, dz: claim.direction.z,
      }, performance.now());
    },

    pressStreak(slot): void {
      if (host !== null) host.submitStreakIntent(LOCAL_ACTOR_ID, { type: 'streak-intent', slot, toggle: false });
    },

    bots(): readonly BotBody[] {
      if (director === null) return [];
      return director.roster.map((b) => ({
        id: b.id, x: b.x, y: b.y, z: b.z, yaw: b.yaw, speed: b.speed, alive: b.alive,
      }));
    },

    snapshot(): HostSnapshot {
      if (host === null) throw new Error('[session] no match yet - call begin() first');
      return host.snapshot();
    },
  };

  // The QA surface is the RETURNED handle, and publishing it is `main.ts`'s
  // job. This file used to write `window.__NTGAME` itself, which made it the
  // one DOM token in a directory whose first hard boundary is "src/game/ is
  // DOM-free and scene-free" (IMPORT-PLAN s2). The hook is the same object at
  // the same name; only the assignment moved to the file that already owns
  // every other window global, next to `__NT`.
  return match;
}
