/**
 * Nuketown 2025 — Blast Mortar: seeded indirect fire on a marked point.
 *
 * The identity beside `sentry.ts`: a sentry owns a lane it can SEE; a mortar
 * hits a disc it does NOT need to see. No line-of-sight check — lobbing over
 * the houses is the whole reason to spend 8 kills on it instead of 5 on a
 * sentry. What it trades for that: the impacts land where the seed says, on a
 * fixed schedule, friend-or-foe by team only, and the tube goes quiet when the
 * window ends whether or not anything walked into the disc.
 *
 * Tuning. FIRST VALUES for this project, each named with the number it was
 * reasoned against (§5.9):
 */
import type { ActorId, DamageEvent, GameEvent, TeamId, WorldQuery } from '../../events';
import type { MortarImpactEvent, MortarTelegraphEvent } from '../../events-ordnance';
import type { SentryTarget } from './sentry';

/** Impact count. The old project's carpet bomber derived exactly 20 in-bounds
 * impacts from the host seed (IMPORT-PLAN §1.1); the count ports, the aircraft
 * does not. */
export const MORTAR_IMPACTS = 20;
/** Scatter disc radius around the anchor. A sentry's 18 m range owns a lane;
 * an 8 m disc covers one yard without reaching across the street. */
export const MORTAR_SPREAD_M = 8;
/** Splash radius per impact. Wider than a doorway, narrower than a house. */
export const MORTAR_SPLASH_M = 4;
/** Flat damage inside the splash. 35 x 3 connected impacts = 105: three hits
 * kill a 100 HP target, one hit plus a rifle follow-up does. No falloff —
 * a second ring is balance tuning nobody has asked for. */
export const MORTAR_DAMAGE = 35;
/**
 * Hard ceiling on impacts fired in one step. Same replication-bound rationale
 * as `MAX_SENTRY_SHOTS_PER_STEP`: a backgrounded tab returns with a capped
 * 250 ms step, and the excess over the cap is LOST, never banked into a burst.
 */
export const MAX_MORTAR_IMPACTS_PER_STEP = 4;

export interface MortarState {
  readonly kind: 'mortar';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  /** Total time live, ms. Impact `i` is due once elapsed passes its slot. */
  readonly elapsedMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly seed: number;
  /** Scheduling window, ms. Stored, not derived: the final step overshoots
   * `remainingMs` below zero, so `elapsed + remaining` stops equalling it. */
  readonly durationMs: number;
  /** Impacts already fired. Never exceeds MORTAR_IMPACTS. */
  readonly fired: number;
  /** Telegraph emitted. False until the first stepped tick warns the disc, so
   * no damage is ever untelegraphed; idempotent across retries. */
  readonly telegraphed: boolean;
}

/** Hostile candidates, the runtime's own actor table with current health. */
export interface MortarTickContext {
  readonly now: number;
  readonly targets: readonly SentryTarget[];
}

export interface MortarTick {
  readonly state: MortarState;
  readonly events: readonly GameEvent[];
}

export type MortarPlacement =
  | { readonly ok: true; readonly x: number; readonly y: number; readonly z: number }
  | { readonly ok: false; readonly reason: 'out-of-bounds' | 'no-ground' };

/**
 * Placement is validated BEFORE a charge is consumed (the Rule-5 shape
 * `validateSentryPlacement` pins): a blocked anchor leaves the earned streak
 * retryable, exactly, with the same claim.
 */
export function validateMortarPlacement(x: number, z: number, world: WorldQuery): MortarPlacement {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: 'out-of-bounds' };
  if (!world.inBounds(x, z)) return { ok: false, reason: 'out-of-bounds' };
  const y = world.groundY(x, z);
  if (!Number.isFinite(y)) return { ok: false, reason: 'no-ground' };
  return { ok: true, x, y, z };
}

export function createMortar(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  anchor: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
): MortarState {
  return Object.freeze({
    kind: 'mortar' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    elapsedMs: 0,
    x: anchor.x,
    y: anchor.y,
    z: anchor.z,
    seed: seed >>> 0,
    durationMs: Math.max(0, durationMs),
    fired: 0,
    telegraphed: false,
  });
}

function hash32(seed: number, ordinal: number): number {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0 ^ ordinal, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ 0x1234abcd, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Impact `index` centre: uniform in the scatter disc, seed-only. No clock. */
export function mortarImpactAt(seed: number, index: number, anchor: { readonly x: number; readonly z: number }): { x: number; z: number } {
  const a = (hash32(seed, index * 2 + 1) / 0x1_0000_0000) * Math.PI * 2;
  const r = Math.sqrt(hash32(seed, index * 2 + 2) / 0x1_0000_0000) * MORTAR_SPREAD_M;
  return { x: anchor.x + Math.cos(a) * r, z: anchor.z + Math.sin(a) * r };
}
export function stepMortar(state: MortarState, dt: number, ctx: MortarTickContext): MortarTick {
  const step = dt > 0 ? dt : 0;
  const elapsedMs = state.elapsedMs + step;
  const remainingMs = state.remainingMs - step;
  const events: GameEvent[] = [];
  let telegraphed = state.telegraphed;
  // The warning precedes EVERYTHING: first stepped tick, once per tube. Gated
  // on step > 0 so a zero-dt probe stays silent (the verifier pins this).
  if (!telegraphed && step > 0) {
    telegraphed = true;
    events.push(Object.freeze({
      type: 'mortar-telegraph',
      at: ctx.now,
      instanceId: state.instanceId,
      actorId: state.actorId,
      team: state.team,
      streakId: state.streakId,
      x: state.x,
      y: state.y,
      z: state.z,
      radius: MORTAR_SPREAD_M,
      impacts: MORTAR_IMPACTS,
      endsAt: ctx.now + Math.max(0, state.remainingMs),
    }) as MortarTelegraphEvent);
  }
  // Chained within the tick: two impacts catching one victim in the same step
  // produce two correct `healthAfter` values, not two copies of the first.
  const health = new Map<string, number>(ctx.targets.map((t) => [t.id, t.health]));
  let fired = state.fired;
  let firedThisStep = 0;
  // Even slots: the schedule is plain arithmetic, and jitter would be
  // unauthored tuning. The cap bounds timers caught up after a stall, not
  // bodies in a disc — one impact may strike several victims.
  while (
    fired < MORTAR_IMPACTS &&
    firedThisStep < MAX_MORTAR_IMPACTS_PER_STEP &&
    ((fired + 1) / MORTAR_IMPACTS) * state.durationMs <= elapsedMs
  ) {
    const at = mortarImpactAt(state.seed, fired, state);
    const index = fired;
    fired += 1;
    firedThisStep += 1;
    // Deterministic victim order: id-sorted, so two hosts stepping the same
    // state with the same targets emit the same event list.
    const victims = [...ctx.targets]
      .filter((t) => t.alive && t.team !== state.team && t.id !== state.actorId && (health.get(t.id) ?? t.health) > 0)
      .filter((t) => Math.hypot(t.x - at.x, t.z - at.z) <= MORTAR_SPLASH_M)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // The flash precedes its own damage in the same tick: presentation draws
    // the detonation it is about to read hits for. No silent damage, ever.
    events.push(Object.freeze({
      type: 'mortar-impact',
      at: ctx.now,
      instanceId: state.instanceId,
      actorId: state.actorId,
      team: state.team,
      streakId: state.streakId,
      index,
      x: at.x,
      y: state.y,
      z: at.z,
      victims: victims.length,
    }) as MortarImpactEvent);
    for (const v of victims) {
      const h = (health.get(v.id) ?? v.health) - MORTAR_DAMAGE;
      health.set(v.id, h);
      events.push(Object.freeze({
        type: 'damage',
        at: ctx.now,
        attackerId: state.actorId,
        attackerTeam: state.team,
        victimId: v.id,
        victimTeam: v.team,
        amount: MORTAR_DAMAGE,
        cause: 'streak',
        zone: 'body',
        weaponId: '',
        distance: Math.hypot(v.x - at.x, v.z - at.z),
        healthAfter: Math.max(0, h),
        sourceX: at.x,
        sourceZ: at.z,
      }) as DamageEvent);
    }
  }

  return {
    state: Object.freeze({ ...state, remainingMs, elapsedMs, fired, telegraphed }),
    events,
  };
}

/** Impacts fired / total, for the HUD countdown. Presentation reads it. */
export function mortarProgress(state: MortarState): number {
  return state.fired / MORTAR_IMPACTS;
}
