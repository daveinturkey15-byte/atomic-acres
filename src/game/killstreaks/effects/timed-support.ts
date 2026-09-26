/** A runtime lifetime for host grants and the selectable map-wide emergency strike. */
import type { ActorId, TeamId } from '../../events';
export interface TimedSupportState {
  readonly kind: 'timed-support'; readonly instanceId: number; readonly actorId: ActorId;
  readonly team: TeamId; readonly streakId: string; readonly remainingMs: number;
}
export function createTimedSupport(instanceId: number, actorId: ActorId, team: TeamId, streakId: string, durationMs: number): TimedSupportState {
  return Object.freeze({ kind: 'timed-support', instanceId, actorId, team, streakId, remainingMs: Math.max(1, durationMs) });
}
