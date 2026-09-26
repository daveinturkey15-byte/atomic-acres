/** The bank/ladder transition, separate from effect simulation and network projections. */
import type { ActorId, DamageCause, GameEvent, StreakEarnedEvent, TeamId } from '../events';
import type { StreakStateMsg } from '../../net/protocol';
import { streakById, type StreakCatalog, type StreakLoadout } from './catalog';

export interface ActorLedger {
  readonly actorId: ActorId; team: TeamId; loadout: StreakLoadout; life: number;
  kills: number; cycle: number; earned: Set<string>; charges: Map<string, number>;
  lastSeq: number; cause: StreakStateMsg['cause']; at: number;
}

/** Full banks hold the entire rung; spending resumes it without silently dropping rewards. */
export function earnElimination(a: ActorLedger, streak: number, at: number, cause: DamageCause,
  catalog: StreakCatalog<string>, limits: { ladder: number; bank: number; charges: number }): GameEvent[] {
  a.at = at;
  a.kills = Number.isFinite(streak) ? Math.max(0, Math.min(limits.ladder, Math.floor(streak))) : a.kills;
  if (cause === 'streak') return [];
  const next = a.cycle + 1, unlocks: { id: string; slot: number }[] = [];
  a.loadout.forEach((id, i) => {
    const def = streakById(id, catalog);
    if (def && !a.earned.has(id) && next >= def.cost) unlocks.push({ id, slot: i + 1 });
  });
  if (unlocks.some(({ id }) => {
    const held = a.charges.get(id) ?? 0;
    return held >= limits.charges || (held === 0 && a.charges.size >= limits.bank);
  })) return [];
  a.cycle = next;
  const events: StreakEarnedEvent[] = [];
  for (const { id, slot } of unlocks) {
    a.earned.add(id);
    const charges = (a.charges.get(id) ?? 0) + 1;
    a.charges.set(id, charges);
    const e: StreakEarnedEvent = Object.freeze({ type: 'streak-earned', at, actorId: a.actorId, team: a.team, streakId: id, slot, charges });
    events.push(e); a.cause = e;
  }
  const top = Math.max(...a.loadout.map((id) => streakById(id, catalog)?.cost ?? 0));
  if (top > 0 && a.cycle >= top) { a.cycle = 0; a.earned.clear(); }
  return events;
}
