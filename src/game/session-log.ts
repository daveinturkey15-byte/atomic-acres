/**
 * Nuketown 2025 — the session's instrument: counters and a bounded event log.
 *
 * Split out of `game/session.ts` for the AGENTS.md 400-line cap (that file came
 * to 407 with this in it), and it is a clean seam anyway: everything here is a
 * pure fold over `GameEvent`s that decides nothing and is read by a harness.
 *
 * It exists because of IMPORT-PLAN §5.7. "The gate for `src/game/` is a played
 * match" — and a played match has to be readable as numbers before anyone can
 * say whether it went well. Each counter below was added to answer a question
 * a run actually raised; `humanHitsTaken` and `humanDeaths` are separate, for
 * instance, because "the bots never killed the player" and "the bots never
 * SHOT at the player" are different defects with different owners, and the
 * first run that failed could not tell them apart.
 */

import type { ActorId, GameEvent } from './events';

/** Lines retained. A match is a few dozen; the cap is for a session left running. */
export const SESSION_LOG_MAX = 400;

export interface SessionLog {
  /** Mutable, read by `LocalMatch.counters()`. */
  readonly tally: Record<string, number>;
  readonly lines: string[];
  record(e: GameEvent): void;
  /** Called on a rematch: the per-match counters reset, the cumulative do not. */
  newMatch(): void;
  /**
   * Bank a retiring `BotDirector`'s own counters before `session.ts` throws it
   * away. Without this every number the director owns — refusals, presses,
   * shots, deaths, reinforcements — reads ZERO for the first seconds after a
   * rematch, and a reader concludes none of it ever happened. That is not
   * hypothetical: `streakRefused` is the counter that proved the 8ba75f7
   * livelock fix, and past one rematch it proved nothing.
   */
  retireDirector(metrics: Readonly<Record<string, number>>): void;
  /**
   * SESSION-CUMULATIVE director numbers: everything already retired, plus the
   * live director's own. This is the figure to quote; `BotDirector.metrics` is
   * one director's slice of it.
   */
  botTotals(live: Readonly<Record<string, number>> | null): Record<string, number>;
}

export function createSessionLog(selfId: ActorId): SessionLog {
  const tally: Record<string, number> = {
    kills: 0, deaths: 0, damage: 0, shotRejects: 0,
    streakEarned: 0, streakActivated: 0, streakDenied: 0, streakEnded: 0, spawns: 0,
    humanDeaths: 0, humanHitsTaken: 0, humanDamageTaken: 0,
    // Everything above is SESSION-cumulative and survives a rematch; this one
    // is per match, because a scoreboard is per match and comparing the two
    // across a rematch boundary is how a harness fails a healthy build.
    matchKills: 0,
  };
  const lines: string[] = [];
  /** Director counters banked from every match that has already ended. */
  const retiredBots: Record<string, number> = {};

  return {
    tally,
    lines,
    newMatch(): void {
      tally.matchKills = 0;
    },
    retireDirector(metrics): void {
      for (const [k, v] of Object.entries(metrics)) {
        if (Number.isFinite(v)) retiredBots[k] = (retiredBots[k] ?? 0) + v;
      }
    },
    botTotals(live): Record<string, number> {
      const out: Record<string, number> = { ...retiredBots };
      if (live !== null) {
        for (const [k, v] of Object.entries(live)) out[k] = (out[k] ?? 0) + v;
      }
      return out;
    },
    record(e: GameEvent): void {
      const at = e.at.toFixed(0);
      let line: string | null = null;
      if (e.type === 'kill') {
        tally.kills++;
        tally.matchKills++;
      } else if (e.type === 'death') {
        tally.deaths++;
        if (e.victimId === selfId) tally.humanDeaths++;
      } else if (e.type === 'damage') {
        tally.damage++;
        if (e.victimId === selfId) {
          tally.humanHitsTaken++;
          tally.humanDamageTaken += e.amount;
        }
      } else if (e.type === 'spawn') {
        tally.spawns++;
      } else if (e.type === 'shot-rejected') {
        tally.shotRejects++;
        line = at + ' shot-reject ' + e.shooterId + ' ' + e.reason;
      } else if (e.type === 'streak-earned') {
        tally.streakEarned++;
        line = at + ' streak-earned ' + e.actorId + ' ' + e.streakId + ' charges=' + e.charges;
      } else if (e.type === 'streak-activated') {
        tally.streakActivated++;
        line = at + ' streak-activated ' + e.actorId + ' ' + e.streakId + ' left=' + e.chargesLeft;
      } else if (e.type === 'streak-denied') {
        tally.streakDenied++;
        // `detail` is set only when the refusal came from world state rather
        // than the gate, and it is the only place the precise cause survives:
        // `reason` is mapped onto the frozen nine, so a `no-placement` reject
        // would otherwise read here as a map that does not support the streak.
        line = at + ' streak-denied ' + e.actorId + ' slot' + e.slot + ' ' + e.reason
          + (e.detail === undefined ? '' : '/' + e.detail);
      } else if (e.type === 'streak-ended') {
        tally.streakEnded++;
        line = at + ' streak-ended ' + e.streakId + ' ' + e.reason;
      } else if (e.type === 'match-phase') {
        line = at + ' match-phase ' + e.phase + ' winner=' + String(e.winner) + ' reason=' + String(e.endReason);
      }
      if (line !== null && lines.length < SESSION_LOG_MAX) lines.push(line);
    },
  };
}
