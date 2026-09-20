/**
 * Nuketown 2025 — Signal Jam: suppresses the OTHER team's reveal.
 *
 * The same pure-stepper contract as `recon.ts`, and the same reason it emits
 * nothing: suppression is a level the minimap reads, not an occurrence.
 *
 * **Direction, stated once because it is the bug everyone writes.** A jam
 * owned by team T denies team `1 - T`. It does not help team T see; it stops
 * the enemy seeing. `jamsTeam(state, team)` answers "is THIS team blinded",
 * and `runtime.revealedFor(team)` is the only place the two effects are
 * combined — a consumer that checks recon without checking jams has
 * reimplemented half the pair and will disagree with the other half.
 *
 * Suppression is binary for the whole window. No ramp, no partial jam, no
 * per-blip filtering: those are balance decisions nobody has asked for, and an
 * invented tuning constant with no request behind it cannot be reviewed (§5.9).
 */

import type { ActorId, GameEvent, TeamId } from '../../events';

export interface CounterReconState {
  readonly kind: 'counter-recon';
  readonly instanceId: number;
  readonly actorId: ActorId;
  /** The OWNING team. The team denied is the other one. */
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  /** Total time this jam has been live, ms. The HUD shows it counting down. */
  readonly elapsedMs: number;
}

export interface CounterReconTickContext {
  readonly now: number;
}

export interface CounterReconTick {
  readonly state: CounterReconState;
  readonly events: readonly GameEvent[];
}

export function createCounterRecon(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
): CounterReconState {
  return Object.freeze({
    kind: 'counter-recon' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    elapsedMs: 0,
  });
}

export function stepCounterRecon(
  state: CounterReconState,
  dt: number,
  _ctx: CounterReconTickContext,
): CounterReconTick {
  const step = dt > 0 ? dt : 0;
  return {
    state: Object.freeze({
      ...state,
      remainingMs: state.remainingMs - step,
      elapsedMs: state.elapsedMs + step,
    }),
    events: [],
  };
}

/** Is `team` the one being denied by this jam? */
export function jamsTeam(state: CounterReconState, team: TeamId): boolean {
  return state.remainingMs > 0 && state.team !== team;
}

/** 0..1 through the window, for a HUD bar. */
export function jamProgress(state: CounterReconState): number {
  const total = state.elapsedMs + Math.max(0, state.remainingMs);
  return total > 0 ? state.elapsedMs / total : 1;
}
