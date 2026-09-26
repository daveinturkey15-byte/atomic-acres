/**
 * Fallout Screen: a localized counter-recon field.
 *
 * It is target-point support that gives a team a defensible information pocket:
 * actors owned by the screen's team are hidden from enemy recon and darts while
 * they remain inside its radius.  It has no renderer dependency and emits no
 * per-frame event; `runtime.revealedTargetIds` reads this state.
 */

import type { ActorId, GameEvent, TeamId } from '../../events';

export const FALLOUT_RADIUS_M = 10;

export interface FalloutState {
  readonly kind: 'fallout-screen';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

export interface FalloutTick { readonly state: FalloutState; readonly events: readonly GameEvent[] }

export function createFallout(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
): FalloutState {
  return Object.freeze({
    kind: 'fallout-screen' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    x: place.x,
    y: place.y,
    z: place.z,
    radius: FALLOUT_RADIUS_M,
  });
}

export function stepFallout(state: FalloutState, dt: number): FalloutTick {
  const step = dt > 0 ? dt : 0;
  return { state: Object.freeze({ ...state, remainingMs: state.remainingMs - step }), events: [] };
}

/** True when this screen hides `targetTeam` from `observerTeam` at a point. */
export function falloutHides(
  state: FalloutState,
  observerTeam: TeamId,
  targetTeam: TeamId,
  x: number,
  z: number,
): boolean {
  return state.remainingMs > 0 && observerTeam !== state.team && targetTeam === state.team
    && Math.hypot(x - state.x, z - state.z) <= state.radius;
}
