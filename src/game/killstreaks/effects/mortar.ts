/**
 * Nuketown 2025 — Blast Mortar: a called-in volley that walks itself onto a
 * marked point and then stops.
 *
 * The honest infantry-map stand-in for the old project's aircraft area
 * denial (Carpet Bomber: target-point, two-click corridor, bomber pass with
 * N impacts plus residual fire; Tri-Pass: target-line, three aircraft passes,
 * 15 m radius, 450 max). This map has no aircraft and no two-click corridor
 * targeting, so porting either verbatim would be a model of a plane the
 * engine cannot fly. What survives honestly is the SHAPE: a target-point
 * area-denial volley, deterministic, host-authoritative, done in seconds.
 *
 * Contract (same stepper shape as `sentry.ts`):
 *   - Six shells, first impact 600 ms after activation, one every 800 ms.
 *     The 600 ms is the whistle window: long enough to start moving, short
 *     enough that the marker means danger.
 *   - Scatter is seed-only: each shell lands inside a 4 m disc around the
 *     anchor, from an integer hash of (seed, shell). No clock, no Math.random.
 *   - Blast is 6 m, linear 55 -> 12 centre to edge, floored at 1 per the
 *     DamageEvent contract. Plunging fire: no line-of-sight check, so cover
 *     hides nothing from it — unlike the sentry, which must see its victim.
 *   - Hostile-only, never the owner, never the dead. Health chains inside a
 *     tick exactly like the sentry's, so a volley that kills stops counting.
 *   - Out of shells ends the instance (sentry precedent: out of ammo ends
 *     the emplacement). The 15 s catalog window is the ceiling, not the fuse.
 *
 * Placement reuses the sentry rule (in-bounds, on the ground) and the
 * runtime validates it BEFORE a charge moves, so a blocked marker leaves the
 * earned streak retryable with the same claim.
 */

import type { ActorId, DamageEvent, GameEvent, TeamId } from '../../events';
import type { SentryTarget } from './sentry';

// ---------------------------------------------------------------------------
// Tuning. FIRST VALUES for this project: the old project's carpet numbers
// (240 max, 5 s residual) assumed aircraft and a 80 m map; a 55-max shell on
// a ~30 m map is reasoned against OUR shotgun (12x8=96 point-blank) and OUR
// sentry (14/shot, ~1.5 s to kill): one centre hit wounds, two kill, the
// edge punishes loitering. Play moves these, not theory (§5.9).
// ---------------------------------------------------------------------------

/** Shells per volley. At the cadence below the whole call lasts ~4.6 s. */
export const MORTAR_SHELL_COUNT = 6;
/** Delay before the first impact: the whistle window. */
export const MORTAR_FIRST_IMPACT_MS = 600;
/** Cadence between impacts. Slower than any shipped weapon: you move between shells. */
export const MORTAR_IMPACT_CADENCE_MS = 800;
/** Scatter disc radius around the anchor, metres. */
export const MORTAR_SCATTER_M = 4;
/** Blast radius, metres. */
export const MORTAR_BLAST_M = 6;
/** Damage at the impact point. Two centre hits (110) kill a 100 HP target. */
export const MORTAR_MAX_DAMAGE = 55;
/** Damage at the blast edge. A graze, not a kill. */
export const MORTAR_MIN_DAMAGE = 12;
/**
 * Hard ceiling on shells landed in one step. The runtime caps dt at 250 ms
 * against a 800 ms cadence, so this is normally 1; the cap is for a tab that
 * returns mid-volley, where the banked time would otherwise land the whole
 * remainder in one frame.
 */
export const MAX_MORTAR_SHELLS_PER_STEP = 2;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface MortarState {
  readonly kind: 'mortar';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Ms since activation. Shells land when this crosses their schedule. */
  readonly elapsedMs: number;
  /** Shells already landed. Also the schedule cursor. */
  readonly landed: number;
  readonly seed: number;
}

export interface MortarTickContext {
  readonly now: number;
  readonly targets: readonly SentryTarget[];
}

export interface MortarTick {
  readonly state: MortarState;
  readonly events: readonly GameEvent[];
}

/** Impact point of shell `index`: the one deterministic answer for a seed. */
export interface MortarImpact {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ---------------------------------------------------------------------------
// Determinism. One integer hash, no allocation, no Math.random: the same
// (seed, shell) lands in the same place on every host and every replay.
// ---------------------------------------------------------------------------

function hash2(seed: number, index: number, salt: number): number {
  let h = (seed >>> 0) ^ ((index + 1) * 0x9e3779b1) ^ (salt * 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

export function mortarImpactAt(state: MortarState, index: number): MortarImpact {
  const r = Math.sqrt((hash2(state.seed, index, 1) % 10_000) / 10_000) * MORTAR_SCATTER_M;
  const a = ((hash2(state.seed, index, 2) % 10_000) / 10_000) * Math.PI * 2;
  return Object.freeze({
    x: state.x + Math.cos(a) * r,
    y: state.y,
    z: state.z + Math.sin(a) * r,
  });
}

/** Scheduled landing time of shell `index`, ms after activation. */
export function mortarImpactTimeMs(index: number): number {
  return MORTAR_FIRST_IMPACT_MS + index * MORTAR_IMPACT_CADENCE_MS;
}

export function createMortar(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
): MortarState {
  return Object.freeze({
    kind: 'mortar' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    x: place.x,
    y: place.y,
    z: place.z,
    elapsedMs: 0,
    landed: 0,
    seed: seed >>> 0,
  });
}

/** Linear blast falloff, centre to edge, floored at 1 per the DamageEvent contract. */
function blastDamage(distM: number): number {
  if (distM >= MORTAR_BLAST_M) return 0;
  const t = distM / MORTAR_BLAST_M;
  return Math.max(1, Math.round(MORTAR_MAX_DAMAGE + (MORTAR_MIN_DAMAGE - MORTAR_MAX_DAMAGE) * t));
}

export function stepMortar(state: MortarState, dt: number, ctx: MortarTickContext): MortarTick {
  const step = dt > 0 ? dt : 0;
  const elapsedMs = state.elapsedMs + step;
  let landed = state.landed;
  const events: DamageEvent[] = [];
  // Health falls as shells land, so a volley that kills stops on the same
  // tick rather than double-tapping a corpse (sentry rule, same reason).
  const health: Record<ActorId, number> = {};
  while (
    landed < MORTAR_SHELL_COUNT &&
    elapsedMs >= mortarImpactTimeMs(landed) &&
    landed - state.landed < MAX_MORTAR_SHELLS_PER_STEP
  ) {
    const impact = mortarImpactAt(state, landed);
    const victims: { t: SentryTarget; dist: number; amount: number }[] = [];
    for (const t of ctx.targets) {
      if (!t.alive || t.team === state.team || t.id === state.actorId || t.health <= 0) continue;
      const dx = t.x - impact.x;
      const dy = t.y + 1.35 - impact.y;
      const dz = t.z - impact.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const amount = blastDamage(dist);
      if (amount <= 0) continue;
      victims.push({ t, dist, amount });
    }
    // Deterministic order: nearest first, ties on id (sentry rule).
    victims.sort((a, b) => (a.dist === b.dist ? (a.t.id < b.t.id ? -1 : 1) : a.dist - b.dist));
    for (const v of victims) {
      const before = health[v.t.id] ?? v.t.health;
      if (before <= 0) continue;
      health[v.t.id] = before - v.amount;
      events.push(Object.freeze({
        type: 'damage',
        at: ctx.now,
        attackerId: state.actorId,
        attackerTeam: state.team,
        victimId: v.t.id,
        victimTeam: v.t.team,
        amount: v.amount,
        cause: 'streak',
        zone: 'body',
        weaponId: '',
        distance: v.dist,
        healthAfter: Math.max(0, before - v.amount),
        sourceX: impact.x,
        sourceZ: impact.z,
      }) as DamageEvent);
    }
    landed += 1;
  }
  // Out of shells ends the call; the runtime emits the one `streak-ended`.
  // An effect never ends itself: remainingMs 0 is the signal.
  const remainingMs = landed >= MORTAR_SHELL_COUNT ? 0 : state.remainingMs - step;
  return {
    state: Object.freeze({ ...state, remainingMs, elapsedMs, landed }),
    events,
  };
}
