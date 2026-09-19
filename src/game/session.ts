/**
 * Nuketown 2025 — the session facade: the ONE object `main.ts` holds.
 *
 * `main.ts` owns the scene; this file owns which match is live. It keeps the
 * per-frame surface `main.ts` already used (`tick`, `localShot`, `pressStreak`,
 * `bots`, `snapshot`, `log`, `counters`, `los`, `groundY`, `localId`) and adds
 * the verbs a menu needs — `configure` a solo setup, `begin`, `leave`,
 * `rematch` — plus a `lobby` for hosting or joining a room. Every one of them
 * delegates to a `MatchDriver`:
 *
 *   solo   `session-solo.ts`        host + client + bots, no wire
 *   host   `net/match-host.ts`      the solo driver with remote seats, over a room
 *   guest  `net/match-guest.ts`     a `GameClient` fed from the wire
 *
 * The facade is DOM-free and scene-free like everything under `src/game/`.
 * It publishes nothing on `window`; `main.ts` assigns the returned handle to
 * `__NTGAME` because that file already owns every window global.
 *
 * ## The one-click contract
 *
 * `begin()` with nothing configured starts `DEFAULT_SOLO_SETUP` — the exact
 * match the gameplay wave shipped and every harness measures. `playcap.mjs`
 * clicks `#start` and expects the world to draw; `_verify-match.mjs` clicks it
 * and reads `snapshot()` fifteen seconds later. Neither knows a menu exists.
 */

import type { AABB } from '../core/kit';
import type { ShotClaim } from '../weapons/controller';
import { LobbySession } from '../net/lobby-session';
import { createHostDriver } from '../net/match-host';
import { createGuestDriver } from '../net/match-guest';
import { MAX_PLAYERS } from '../net/protocol';
import type { ActorId } from './events';
import { DEFAULT_SOLO_SETUP, TEAM_A, sanitizeSoloSetup, type SoloSetup } from './rules';
import { createSessionLog } from './session-log';
import { createSoloDriver, REMATCH_MS } from './session-solo';
import type { BotBody, MatchDriver, MatchUi, SessionSnapshot } from './session-types';
import { createWorldQuery } from './world-query';

export { REMATCH_MS } from './session-solo';
export type { BotBody, MatchUi } from './session-types';
/** Kills to win in the one-click default. Re-exported for the harnesses that read it. */
export const LOCAL_SCORE_LIMIT = DEFAULT_SOLO_SETUP.scoreLimit;
export const DEFAULT_BOTS = DEFAULT_SOLO_SETUP.bots;
/** The human's actor id in a solo match. In a room it is the seat id (`host` / `p1`). */
export const LOCAL_ACTOR_ID = 'you';

export type SessionMode = 'idle' | 'solo' | 'host' | 'guest';

export interface LocalMatchOptions {
  readonly colliders: readonly AABB[];
  readonly ui: MatchUi;
  readonly bots?: number;
  readonly seed?: number;
  /** Put the human where the host deployed them. `core/player.ts` owns position. */
  readonly placeLocal?: (x: number, y: number, z: number, yaw: number) => void;
}

export interface LocalMatch extends MatchDriver {
  /** Admit everyone and start ticking. Idempotent; `#start` calls it on play. */
  begin(): void;
  /** The setup the NEXT solo match uses. Sanitised against `rules.ts` tables. */
  configure(setup: Partial<SoloSetup>): SoloSetup;
  setup(): SoloSetup;
  /** Tear the live match down and go idle (pre-match menu). Leaves any room. */
  leave(): void;
  /** From the end screen: skip the rest of the hold and build the next match. */
  rematch(): void;
  mode(): SessionMode;
  /** Milliseconds until the automatic rematch, or null when the match is not over. */
  rematchInMs(now: number): number | null;
  readonly lobby: LobbySession;
  /**
   * The `WorldQuery` port, read-only, so a harness can FALSIFY it. Without a
   * way to ask "is this segment blocked" from outside, "line of sight works"
   * is an adjective; with it the proof can name two points a house sits
   * between and two down the open road, and be wrong about one of them.
   */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  groundY(x: number, z: number): number;
}

export function createLocalMatch(opts: LocalMatchOptions): LocalMatch {
  const world = createWorldQuery(opts.colliders);
  const ui = opts.ui;
  const instrument = createSessionLog(LOCAL_ACTOR_ID);
  const lobby = new LobbySession({ now: () => performance.now() });
  let setup: SoloSetup = opts.bots === undefined
    ? DEFAULT_SOLO_SETUP
    : sanitizeSoloSetup({ ...DEFAULT_SOLO_SETUP, bots: opts.bots });
  let driver: MatchDriver | null = null;
  let mode: SessionMode = 'idle';
  let endedAt: number | null = null;
  let localId: ActorId = LOCAL_ACTOR_ID;
  let lastNow = 0;

  const swap = (next: MatchDriver | null, nextMode: SessionMode): void => {
    if (driver !== null && driver !== next) driver.dispose();
    driver = next;
    mode = nextMode;
    localId = next === null ? LOCAL_ACTOR_ID : next.localId;
    endedAt = null;
  };

  const startSolo = (): void => {
    swap(createSoloDriver({
      world, ui, setup, seed: opts.seed, placeLocal: opts.placeLocal,
      localId: LOCAL_ACTOR_ID, localName: 'YOU', instrument,
    }), 'solo');
  };

  /**
   * A room that has started needs a driver: the host wraps the solo driver
   * (its own bots, the host's setup) in the room binding; a guest gets the
   * wire-fed projection. Built here, on the frame that first sees the room
   * past its lobby phase, so the host clock starts in the frame loop's domain.
   */
  const adoptRoom = (): void => {
    const room = lobby.hostRoom();
    if (room !== null && mode !== 'host') {
      const roomSetup = sanitizeSoloSetup({ ...setup, bots: Math.max(1, lobby.hostBots()) });
      const solo = createSoloDriver({
        world, ui, seed: opts.seed, placeLocal: opts.placeLocal, instrument,
        setup: lobby.hostBots() === 0 ? { ...roomSetup, bots: 0 } : roomSetup,
        localId: room.hostId, localName: room.hostName(), localTeam: TEAM_A,
      });
      swap(createHostDriver(room, solo, { world }), 'host');
      return;
    }
    const guest = lobby.guestClient();
    if (guest !== null && mode !== 'guest' && guest.getPlayerId() !== null) {
      swap(createGuestDriver(guest, { ui, placeLocal: opts.placeLocal, instrument }), 'guest');
    }
  };

  const match: LocalMatch = {
    get localId() { return localId; },
    lobby,
    los: (ax, ay, az, bx, by, bz) => world.lineOfSight({ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz }),
    groundY: (x, z) => world.groundY(x, z),
    log: () => (driver === null ? instrument.lines.slice() : driver.log()),
    counters: () => (driver === null ? { ...instrument.tally, epoch: 0, bots: 0 } : driver.counters()),
    mode: () => mode,
    setup: () => setup,
    ended: () => driver !== null && driver.ended(),
    netLine: (now) => (driver === null ? null : driver.netLine(now)),

    configure(patch): SoloSetup {
      setup = sanitizeSoloSetup({ ...setup, ...patch });
      if (setup.bots > MAX_PLAYERS - 1) setup = sanitizeSoloSetup({ ...setup, bots: MAX_PLAYERS - 1 });
      return setup;
    },

    begin(): void {
      if (mode !== 'idle') return;
      if (lobby.active()) {
        adoptRoom();
        return;
      }
      startSolo();
    },

    leave(): void {
      lobby.leave();
      swap(null, 'idle');
    },

    rematch(): void {
      driver?.rematchNow();
    },

    rematchInMs(now): number | null {
      if (driver === null || !driver.ended()) return null;
      if (endedAt === null) endedAt = now;
      return Math.max(0, REMATCH_MS - (now - endedAt));
    },

    tick(now, x, y, z, yaw, pitch): void {
      lastNow = now;
      // A room that reached its start while we were idle (or while a solo
      // match was running) takes over; a room that closed hands back to idle.
      if (lobby.active()) {
        if (lobby.started()) adoptRoom();
        else if (mode === 'host' || mode === 'guest') swap(null, 'idle');
      } else if (mode === 'host' || mode === 'guest') {
        swap(null, 'idle');
      }
      if (driver === null) return;
      driver.tick(now, x, y, z, yaw, pitch);
      if (!driver.ended()) endedAt = null;
    },

    localShot(claim: ShotClaim): void { driver?.localShot(claim); },
    pressStreak(slot): void { driver?.pressStreak(slot); },
    bots(): readonly BotBody[] { return driver === null ? NO_BODIES : driver.bots(); },
    snapshot(): SessionSnapshot {
      if (driver === null) throw new Error('[session] no match yet - call begin() first');
      return driver.snapshot();
    },
    rematchNow(): void { driver?.rematchNow(); },
    dispose(): void {
      lobby.dispose();
      swap(null, 'idle');
      void lastNow;
    },
  };

  return match;
}

const NO_BODIES: readonly BotBody[] = Object.freeze([]);
