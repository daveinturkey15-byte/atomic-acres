/** A telegraphed twenty-bomb corridor, validated in full before payment. */
import type { ActorId, DamageEvent, GameEvent, TeamId, Vec3, WorldQuery } from '../../events';
import type { SentryTarget } from './sentry';

export const CARPET_BOMBS = 20;
export const CARPET_FIRST_MS = 1600;
export const CARPET_INTERVAL_MS = 160;
export const CARPET_RADIUS_M = 3.4;
export interface CarpetState {
  readonly kind: 'carpet-bomber'; readonly instanceId: number; readonly actorId: ActorId;
  readonly team: TeamId; readonly streakId: string; readonly remainingMs: number;
  readonly x: number; readonly y: number; readonly z: number; readonly aimYaw: number;
  readonly elapsedMs: number; readonly fired: number; readonly telegraphed: boolean;
  readonly impacts: readonly Vec3[];
}
/** Four ranks of five impacts, 20m long and 8m wide, inside the playable boundary. */
export function carpetCorridor(anchor: Vec3, yaw: number, world: WorldQuery): readonly Vec3[] | null {
  if (![anchor.x, anchor.y, anchor.z, yaw].every(Number.isFinite)) return null;
  const impacts: Vec3[] = [];
  for (let row = 0; row < 5; row++) for (let lane = 0; lane < 4; lane++) {
    const along = (row - 2) * 5, across = (lane - 1.5) * 2.7;
    const x = anchor.x - Math.sin(yaw) * along + Math.cos(yaw) * across;
    const z = anchor.z - Math.cos(yaw) * along - Math.sin(yaw) * across;
    const y = world.groundY(x, z);
    if (!world.inBounds(x, z) || !Number.isFinite(y)) return null;
    impacts.push(Object.freeze({ x, y, z }));
  }
  return Object.freeze(impacts);
}
export function createCarpet(instanceId: number, actorId: ActorId, team: TeamId, durationMs: number,
  anchor: Vec3, aimYaw: number, impacts: readonly Vec3[]): CarpetState {
  return Object.freeze({ kind: 'carpet-bomber', instanceId, actorId, team, streakId: 'carpet-bomber',
    remainingMs: durationMs, ...anchor, aimYaw, elapsedMs: 0, fired: 0, telegraphed: false, impacts });
}
export function stepCarpet(state: CarpetState, dt: number, ctx: {
  readonly now: number; readonly world: WorldQuery; readonly targets: readonly SentryTarget[]; readonly freeForAll?: boolean;
}): { readonly state: CarpetState; readonly events: readonly GameEvent[] } {
  const step = Math.min(250, Math.max(0, Number.isFinite(dt) ? dt : 0), state.remainingMs);
  if (step <= 0) return { state, events: [] };
  const elapsedMs = state.elapsedMs + step, events: GameEvent[] = [];
  if (!state.telegraphed) events.push({ type: 'mortar-telegraph', at: ctx.now, instanceId: state.instanceId,
    actorId: state.actorId, team: state.team, streakId: state.streakId, x: state.x, y: state.y, z: state.z,
    radius: 12, impacts: CARPET_BOMBS, endsAt: ctx.now + state.remainingMs });
  let fired = state.fired, count = 0;
  const health = new Map(ctx.targets.map((t) => [t.id, t.health]));
  while (fired < state.impacts.length && count < 2 && elapsedMs >= CARPET_FIRST_MS + fired * CARPET_INTERVAL_MS) {
    const point = state.impacts[fired];
    const blast = { x: point.x, y: point.y + .25, z: point.z };
    const victims = [...ctx.targets].filter((t) => t.id !== state.actorId && (ctx.freeForAll || t.team !== state.team)
      && t.alive && (health.get(t.id) ?? 0) > 0 && Math.hypot(t.x - point.x, t.y + 1.2 - blast.y, t.z - point.z) <= CARPET_RADIUS_M
      && ctx.world.lineOfSight(blast, { x: t.x, y: t.y + 1.2, z: t.z }))
      .sort((a, b) => a.id.localeCompare(b.id));
    events.push({ type: 'mortar-impact', at: ctx.now, instanceId: state.instanceId, actorId: state.actorId,
      team: state.team, streakId: state.streakId, index: fired, ...point, victims: victims.length });
    for (const target of victims) {
      const distance = Math.hypot(target.x - point.x, target.y + 1.2 - blast.y, target.z - point.z);
      const amount = Math.round(70 * (1 - .5 * distance / CARPET_RADIUS_M));
      const after = Math.max(0, health.get(target.id)! - amount); health.set(target.id, after);
      const event: DamageEvent = { type: 'damage', at: ctx.now, attackerId: state.actorId, attackerTeam: state.team,
        victimId: target.id, victimTeam: target.team, cause: 'streak', zone: 'body', weaponId: '', amount,
        healthAfter: after, distance, sourceX: point.x, sourceZ: point.z };
      events.push(event);
    }
    fired++; count++;
  }
  return { state: Object.freeze({ ...state, remainingMs: state.remainingMs - step, elapsedMs, fired, telegraphed: true }), events };
}
