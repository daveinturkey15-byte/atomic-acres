/**
 * Nuketown 2025 — the room-host driver: the solo driver, bound to a `HostRoom`.
 *
 * Nothing here decides a game fact. It moves data between two authorities
 * that each own one thing: the ROOM owns where every guest is (it integrates
 * their inputs) and the GAME HOST owns everything else. Each frame:
 *
 *   room poses  ──▶ solo.remotePose ──▶ GameHost.updatePose
 *   guest shot  ──▶ solo.remoteShot ──▶ GameHost.submitShot
 *   host events ──▶ the wire: damage / kill / spawn / shot-reject /
 *                   streak-state (to the actor) / match-state / ordnance
 *
 * Remote humans are seats on the solo driver, admitted by roster revision and
 * balanced by `rules.ts:balanceTeams` (host first, stable id order, alternate
 * fill). A spawn for a remote seat also moves the ROOM's pose, because the
 * room keeps integrating from wherever it believes the seat is.
 */
import { balanceTeams } from '../game/rules';
import { isOrdnanceEventType, type GameEvent, type KillEvent, type WorldQuery } from '../game/events';
import type { SoloDriver } from '../game/session-solo';
import type { BotBody, MatchDriver } from '../game/session-types';
import type { ShotClaim } from '../weapons/controller';
import type { GameNetMessage, NetMessage } from './protocol';
import type { HostRoom } from './room';

/** Match line cadence on the wire. The clock reads fine at 10 Hz; edges go at once. */
const MATCH_STATE_MS = 100;
/** Streak ledger level refresh per remote seat; edges go at once. */
const STREAK_LEVEL_MS = 2_000;
const STREAK_TYPES: ReadonlySet<string> = new Set(['streak-earned', 'streak-activated', 'streak-denied', 'streak-ended']);

export function createHostDriver(room: HostRoom, solo: SoloDriver, opts: { world: WorldQuery }): MatchDriver {
  const seats = new Set<string>();
  const kills = new Map<string, KillEvent>();
  let rev = -1;
  let lastMatchAt = -Infinity;
  let lastStreakAt = -Infinity;
  let phaseEdge = false;
  let disposed = false;

  const syncRoster = (): void => {
    const r = room.rosterRevision();
    if (r === rev) return;
    rev = r;
    const roster = room.roster();
    const ids = [room.hostId];
    for (const e of roster) if (!e.isHost) ids.push(e.id);
    const teams = balanceTeams(room.hostId, ids);
    const seen = new Set<string>();
    for (const e of roster) {
      if (e.isHost) continue;
      seen.add(e.id);
      solo.addRemote(e.id, e.name, teams.get(e.id) ?? 1);
      seats.add(e.id);
    }
    for (const id of seats) {
      if (!seen.has(id)) {
        seats.delete(id);
        solo.removeRemote(id);
      }
    }
  };

  const streakTo = (id: string, now: number): void => {
    const m = solo.streakStateFor(id, now);
    if (m !== null) room.sendToPlayer(id, m);
  };

  const sink = (events: readonly GameEvent[], now: number): void => {
    kills.clear();
    for (const e of events) {
      switch (e.type) {
        case 'damage':
          room.broadcast({ type: 'damage', e });
          break;
        case 'kill':
          kills.set(e.victimId, e);
          break;
        case 'death':
          room.broadcast({ type: 'kill', kill: kills.get(e.victimId) ?? null, death: e });
          break;
        case 'spawn':
          room.broadcast({ type: 'spawn', e });
          if (seats.has(e.actorId)) room.placeSeat(e.actorId, e.x, e.z, e.yaw);
          break;
        case 'shot-rejected':
          if (seats.has(e.shooterId)) room.sendToPlayer(e.shooterId, { type: 'shot-reject', e });
          break;
        case 'match-phase':
          phaseEdge = true;
          break;
        default:
          if (STREAK_TYPES.has(e.type)) {
            const id = (e as { actorId?: string }).actorId;
            if (id !== undefined && seats.has(id)) streakTo(id, now);
          } else if (isOrdnanceEventType(e.type)) {
            room.broadcast({ type: 'ordnance', e } as NetMessage);
          }
      }
    }
  };

  const onGame = (playerId: string, msg: GameNetMessage): void => {
    if (msg.type === 'shot') solo.remoteShot(playerId, msg, performance.now());
    else if (msg.type === 'streak-intent') solo.remoteStreak(playerId, msg.slot, msg.toggle);
  };

  solo.setEventSink(sink);
  room.onGame(onGame);
  room.setStamp((s) => solo.stampSample(s));
  room.setExtraSamples((into) => solo.botSamples(into));
  syncRoster();

  return {
    localId: solo.localId,
    log: () => solo.log(),
    counters: () => ({ ...solo.counters(), rosterRev: rev, seats: seats.size }),
    ended: () => solo.ended(),
    rematchNow: () => solo.rematchNow(),
    bots: (): readonly BotBody[] => solo.bots(),
    snapshot: () => solo.snapshot(),
    localShot: (claim: ShotClaim) => solo.localShot(claim),
    pressStreak: (slot) => solo.pressStreak(slot),
    netLine(now): string | null {
      const s = room.diag.snapshot(now);
      const rtt = s.rttMs === null ? '--' : s.rttMs.toFixed(0);
      return `host · seats ${seats.size} · rtt ${rtt} ms · tick ${s.tickHz.toFixed(1)} Hz · in ${s.inputsAccepted}/${s.inputsRejected} ok/rej`;
    },

    tick(now, x, y, z, yaw, pitch): void {
      if (disposed) return;
      syncRoster();
      room.driveHostSeat(x, y, z, yaw);
      room.forEachGuestPose((id, p, connected) => {
        if (connected) solo.remotePose(id, p.x, p.y, p.z, p.yaw);
      });
      solo.tick(now, x, y, z, yaw, pitch);
      if (phaseEdge || now - lastMatchAt >= MATCH_STATE_MS) {
        const m = solo.matchState();
        if (m !== null) {
          room.broadcast(m);
          lastMatchAt = now;
          phaseEdge = false;
        }
      }
      if (now - lastStreakAt >= STREAK_LEVEL_MS) {
        lastStreakAt = now;
        for (const id of seats) streakTo(id, now);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      solo.setEventSink(null);
      room.onGame(null);
      room.setStamp(null);
      room.setExtraSamples(null);
      solo.dispose();
      void opts;
    },
  };
}
