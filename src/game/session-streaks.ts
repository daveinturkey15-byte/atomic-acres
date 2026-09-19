/**
 * Nuketown 2025 — lane C's streak runtime, wearing the host's port.
 *
 * Moved out of `session.ts` unchanged when that file split into a facade and
 * drivers (the 400-line cap). Translating between `StreakRuntime` and the
 * host's `StreakRuntimePort` is a wiring job, so it lives beside the wiring
 * rather than in either lane's module — neither of them should learn the
 * other's spelling.
 *
 * Six of the eight methods pass straight through. `activate` fills in what the
 * wire cannot carry and unwraps `ActivationOutcome.events` — the accepted and
 * refused cases both travel as events, which is what keeps a refused press
 * from being a dead key (§5.4). `advance` gains the host's target table.
 */

import type { BotDirector } from './bots';
import type { ActorId, GameEvent, TeamId, WorldQuery } from './events';
import type { StreakPress, StreakRuntimePort, StreakTargetView } from './host-streaks';
import type { StreakRuntime } from './killstreaks/runtime';

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
export function directorNumbers(d: BotDirector): Record<string, number> {
  return {
    ...d.metrics,
    botDeaths: d.deathCount,
    reinforcements: d.reinforcementCount,
    refusedReinforcements: d.refusedReinforcementCount,
  };
}
