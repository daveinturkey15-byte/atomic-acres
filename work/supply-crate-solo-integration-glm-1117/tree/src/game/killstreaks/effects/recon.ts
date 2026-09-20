/**
 * Nuketown 2025 — Recon Sweep: a timed map-reveal window.
 *
 * A pure stepper. `step(state, dt, ctx) -> {state, events}`: state in, a NEW
 * state and zero or more events out. Nothing here mutates its input, touches
 * the scene, builds a material or knows a canvas exists. Presentation is not
 * ours (§5.8), and a streak may never add or remove a light or construct a
 * material (§5.10) — the cheapest way to guarantee that is to have no access
 * to either.
 *
 * **It emits no events, and that is the design.** A reveal is INFORMATION, not
 * an occurrence: the minimap asks whether a team is currently revealed and at
 * what sweep phase, and the answer is a function of live state. Emitting a
 * "revealed" event every tick would put a per-frame message on a bus whose
 * consumers all want a level, not an edge. The lifecycle edges that DO exist —
 * activated, ended — belong to `runtime.ts`, which owns the instance id.
 *
 * The reveal model is the one the owner means by "the way the mini map works":
 * a sweep line crosses the map on a fixed period, and enemy positions LATCH at
 * the pulse and hold, rather than tracking continuously. A continuously
 * tracking reveal reads as wallhack; a latched one reads as radar.
 */

import type { ActorId, GameEvent, TeamId } from '../../events';

/**
 * Sweep period. FIRST VALUE for this project, not inherited: the old project
 * had no periodic sweep at all — its reveal was continuous, which is the
 * "wallhack" read above. 2,500 ms is the interval at which a walking player
 * (roughly 4 m/s) moves ~10 m between pulses, about a house width on this map,
 * so a latched blip is useful without being exact.
 */
export const RECON_SWEEP_PERIOD_MS = 2_500;

/**
 * How long a latched blip stays drawn after its pulse. Derived from the
 * period, not authored: a hold longer than the period would stack two blips
 * for the same actor, and a much shorter one makes the map blink empty.
 */
export const RECON_BLIP_HOLD_MS = Math.round(RECON_SWEEP_PERIOD_MS * 0.8);

export interface ReconState {
  readonly kind: 'recon';
  readonly instanceId: number;
  readonly actorId: ActorId;
  /** The team that SEES. A recon reveals the other team to this one. */
  readonly team: TeamId;
  readonly streakId: string;
  /** Milliseconds of window left. `runtime.ts` ends the instance at <= 0. */
  readonly remainingMs: number;
  /** Time inside the current sweep, ms. Drives the HUD sweep line. */
  readonly sweepMs: number;
  /** Sweeps completed. A consumer latches new positions when this changes. */
  readonly pulses: number;
  /** True for the tick in which a sweep completed. */
  readonly pulsed: boolean;
}

/** Only what cannot be derived. `dt` is the runtime's clamped step. */
export interface ReconTickContext {
  readonly now: number;
}

export interface ReconTick {
  readonly state: ReconState;
  readonly events: readonly GameEvent[];
}

/**
 * The seed offsets the first pulse so two recons activated in the same tick do
 * not pulse in lockstep. Seed-only: no clock, no `Math.random`.
 */
export function createRecon(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  seed: number,
): ReconState {
  const offset = (seed >>> 0) % RECON_SWEEP_PERIOD_MS;
  return Object.freeze({
    kind: 'recon' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    sweepMs: offset,
    pulses: 0,
    pulsed: false,
  });
}

export function stepRecon(state: ReconState, dt: number, _ctx: ReconTickContext): ReconTick {
  const step = dt > 0 ? dt : 0;
  const total = state.sweepMs + step;
  const crossed = Math.floor(total / RECON_SWEEP_PERIOD_MS);
  return {
    state: Object.freeze({
      ...state,
      remainingMs: state.remainingMs - step,
      sweepMs: total - crossed * RECON_SWEEP_PERIOD_MS,
      pulses: state.pulses + crossed,
      pulsed: crossed > 0,
    }),
    events: [],
  };
}

/** Does this recon reveal the enemy team to `team`? Suppression is not asked here. */
export function reconRevealsTo(state: ReconState, team: TeamId): boolean {
  return state.team === team && state.remainingMs > 0;
}

/** 0..1 around the sweep, for the HUD line. Presentation reads it; nothing writes it. */
export function reconSweepPhase(state: ReconState): number {
  return state.sweepMs / RECON_SWEEP_PERIOD_MS;
}

/** Is a blip latched at the last pulse still inside its hold window? */
export function reconBlipVisible(state: ReconState): boolean {
  return state.pulses > 0 && state.sweepMs <= RECON_BLIP_HOLD_MS;
}
