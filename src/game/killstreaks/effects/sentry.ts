/**
 * Nuketown 2025 — Sentry Post: a placed turret that shoots what it can see.
 *
 * Pure stepper, same contract as the other two: `step(state, dt, ctx)` returns
 * a NEW state and the events that happened. It owns no mesh, no muzzle flash,
 * no light and no material (§5.8, §5.10) — "the sentry needs a red glow" is
 * the one-line temptation that broke the old project's frozen light set, and a
 * module that cannot reach a renderer cannot yield to it.
 *
 * **Why it may author a `DamageEvent` at all.** Health is host-authoritative
 * and `host.ts` is its only writer. The sentry is called BY the host, inside
 * `runtime.advance`, with the host's own live target list — health included —
 * and the runtime subtracts each hit from its working copy before the next
 * instance steps, so two sentries firing at one victim in one tick produce
 * two correct `healthAfter` values instead of two copies of the same one. The
 * host applies what comes back. If a caller ever passes stale health, the
 * event is wrong: that is the contract, stated here rather than assumed.
 *
 * **Yaw convention.** World forward at yaw is `(-sin yaw, 0, -cos yaw)` —
 * `core/player.ts` line 11, and the whole project agrees. So the bearing of a
 * direction is `atan2(-dx, -dz)`, NOT `atan2(dx, dz)`. Getting this backwards
 * is identical at yaw 0 and PI and exactly wrong at +/-PI/2, which is how the
 * same sign error shipped in movement once already: test off-axis or not at all.
 */

import type { ActorId, DamageEvent, GameEvent, TeamId, WorldQuery } from '../../events';

// ---------------------------------------------------------------------------
// Tuning. FIRST VALUES: the old project had no sentry, so none of these has a
// before-value to carry. Each names the number it was reasoned against, which
// is the reviewable thing until play moves it (§5.9).
// ---------------------------------------------------------------------------

/** Engagement range. The old project's bots fired at 22 m; a static emplacement that outranged a moving player would own the street. */
export const SENTRY_RANGE_M = 18;
/** Arc it can cover, centred on the facing it was placed with. Wider than a player's 90-ish degree useful FOV, narrower than a turret that cannot be flanked. */
export const SENTRY_ARC_RAD = (140 * Math.PI) / 180;
/** Damage per shot. 14 x 8 shots = 112, so a full burst kills a 100 HP target in ~1.5 s of exposure. */
export const SENTRY_DAMAGE = 14;
/** Shot cadence. Slower than any shipped weapon, so trading with it is a real option. */
export const SENTRY_FIRE_INTERVAL_MS = 220;
/** Acquisition delay before the first shot at a NEW target. The old project's bot reaction was 650 ms; a machine is quicker than a person but must still be beatable. */
export const SENTRY_ACQUIRE_MS = 420;
/** Muzzle height above the ground it was placed on. */
export const SENTRY_MUZZLE_M = 0.85;
/** Where it aims on a target: centre mass, not the eye line. Zone is always `body`. */
export const SENTRY_AIM_HEIGHT_M = 1.35;
/** Traverse rate. It must be beatable by a sprint across its arc. */
export const SENTRY_TRAVERSE_RAD_S = 2.6;
/** Idle scan rate and half-arc, when it holds no target. */
export const SENTRY_SCAN_RAD_S = 0.9;
export const SENTRY_SCAN_HALF_ARC_RAD = SENTRY_ARC_RAD / 2;
/** How close the barrel must be to the bearing before it fires. */
export const SENTRY_AIM_TOLERANCE_RAD = 0.09;
/** Rounds carried. At the cadence above this is ~13 s of continuous fire, a third of its window. */
export const SENTRY_AMMO = 60;
/**
 * Hard ceiling on damage events one sentry may emit in one step. The old
 * project capped support damage at 64 per step across every entity; one
 * ground turret needs far less, and an uncapped loop is how a stalled tab
 * turns into a burst of thirty simultaneous hits.
 */
export const MAX_SENTRY_SHOTS_PER_STEP = 4;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** What the host knows about an actor the sentry might shoot. Data, not callbacks (§5.3). */
export interface SentryTarget {
  readonly id: ActorId;
  readonly team: TeamId;
  readonly alive: boolean;
  /** Health BEFORE this tick's streak damage. The runtime keeps it current. */
  readonly health: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SentryState {
  readonly kind: 'sentry';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Current barrel bearing. */
  readonly yaw: number;
  /** Placed facing; the arc and the idle scan are centred on it and never move. */
  readonly baseYaw: number;
  readonly ammo: number;
  readonly cooldownMs: number;
  readonly acquireMs: number;
  readonly targetId: ActorId | null;
  readonly seed: number;
  /** Scan phase in radians, advanced only while idle. */
  readonly scanRad: number;
  /** Shots fired over its life. The HUD shows ammo; this proves determinism. */
  readonly shots: number;
}

export interface SentryTickContext {
  readonly now: number;
  readonly world: WorldQuery;
  readonly targets: readonly SentryTarget[];
}

export interface SentryTick {
  readonly state: SentryState;
  readonly events: readonly GameEvent[];
}

export type SentryPlacement =
  | { readonly ok: true; readonly x: number; readonly y: number; readonly z: number }
  | { readonly ok: false; readonly reason: 'out-of-bounds' | 'no-ground' };

/**
 * Placement is validated BEFORE a charge is consumed (IMPORT-PLAN §1.1, the
 * rule their carpet-corridor test pins): a blocked placement leaves the earned
 * streak retryable, exactly, with the same claim.
 */
export function validateSentryPlacement(x: number, z: number, world: WorldQuery): SentryPlacement {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: 'out-of-bounds' };
  if (!world.inBounds(x, z)) return { ok: false, reason: 'out-of-bounds' };
  const y = world.groundY(x, z);
  if (!Number.isFinite(y)) return { ok: false, reason: 'no-ground' };
  return { ok: true, x, y, z };
}

export function createSentry(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
  baseYaw: number,
  seed: number,
): SentryState {
  // Seed-only: the scan starts somewhere inside its arc, so two sentries
  // placed in the same tick do not sweep in lockstep. Deterministic, and
  // load-bearing — where the barrel is decides when it can first fire.
  const phase = (((seed >>> 0) % 2_048) / 2_048) * Math.PI * 2;
  return Object.freeze({
    kind: 'sentry' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    x: place.x,
    y: place.y,
    z: place.z,
    yaw: baseYaw + Math.sin(phase) * SENTRY_SCAN_HALF_ARC_RAD,
    baseYaw,
    ammo: SENTRY_AMMO,
    cooldownMs: SENTRY_ACQUIRE_MS,
    acquireMs: 0,
    targetId: null,
    seed,
    scanRad: phase,
    shots: 0,
  });
}

/** Signed shortest angle from `a` to `b`, in (-PI, PI]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Bearing of a world direction, in the project's yaw frame. See the header. */
export function bearingOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Nearest hostile with line of sight inside the arc. Ties break on id so the
 * choice is a function of the inputs and nothing else — two hosts stepping the
 * same state with the same targets pick the same victim.
 */
function acquire(state: SentryState, ctx: SentryTickContext): SentryTarget | null {
  const from = { x: state.x, y: state.y + SENTRY_MUZZLE_M, z: state.z };
  let best: SentryTarget | null = null;
  let bestD = Infinity;
  for (const t of ctx.targets) {
    if (!t.alive || t.team === state.team || t.id === state.actorId || t.health <= 0) continue;
    const dx = t.x - state.x;
    const dz = t.z - state.z;
    const flat = Math.hypot(dx, dz);
    if (flat > SENTRY_RANGE_M) continue;
    if (Math.abs(angleDelta(state.baseYaw, bearingOf(dx, dz))) > SENTRY_ARC_RAD / 2) continue;
    if (!ctx.world.lineOfSight(from, { x: t.x, y: t.y + SENTRY_AIM_HEIGHT_M, z: t.z })) continue;
    if (flat < bestD || (flat === bestD && best !== null && t.id < best.id)) {
      best = t;
      bestD = flat;
    }
  }
  return best;
}

export function stepSentry(state: SentryState, dt: number, ctx: SentryTickContext): SentryTick {
  const step = dt > 0 ? dt : 0;
  const secs = step / 1_000;
  const target = acquire(state, ctx);

  // A new target restarts acquisition; holding the same one does not.
  const sameTarget = target !== null && target.id === state.targetId;
  let acquireMs = target === null ? 0 : sameTarget ? Math.max(0, state.acquireMs - step) : SENTRY_ACQUIRE_MS;
  // The cooldown may go one interval NEGATIVE, and that floor is the whole
  // point. Clamped at zero it lost the overshoot every step, so the real
  // cadence became `ceil(interval / dt) * dt` — 300 ms at a 100 ms tick
  // instead of 220, i.e. the turret's damage depended on the host's frame
  // rate. Letting one interval of credit carry makes the cadence exact at any
  // tick rate; flooring it at one interval keeps a long blind spell from
  // banking a burst.
  let cooldownMs = Math.max(-SENTRY_FIRE_INTERVAL_MS, state.cooldownMs - step);
  let yaw = state.yaw;
  let scanRad = state.scanRad;
  let ammo = state.ammo;
  let shots = state.shots;
  const events: DamageEvent[] = [];

  if (target === null) {
    scanRad += SENTRY_SCAN_RAD_S * secs;
    const want = state.baseYaw + Math.sin(scanRad) * SENTRY_SCAN_HALF_ARC_RAD;
    const d = angleDelta(yaw, want);
    yaw += Math.sign(d) * Math.min(Math.abs(d), SENTRY_TRAVERSE_RAD_S * secs);
  } else {
    const want = bearingOf(target.x - state.x, target.z - state.z);
    const d = angleDelta(yaw, want);
    yaw += Math.sign(d) * Math.min(Math.abs(d), SENTRY_TRAVERSE_RAD_S * secs);
    const aimed = Math.abs(angleDelta(yaw, want)) <= SENTRY_AIM_TOLERANCE_RAD;
    // Health falls as this loop fires, so a burst that kills stops on the
    // same tick rather than emptying the magazine into a corpse.
    let health = target.health;
    while (
      aimed && acquireMs <= 0 && cooldownMs <= 0 && ammo > 0 && health > 0 &&
      events.length < MAX_SENTRY_SHOTS_PER_STEP
    ) {
      const dx = target.x - state.x;
      const dy = target.y + SENTRY_AIM_HEIGHT_M - (state.y + SENTRY_MUZZLE_M);
      const dz = target.z - state.z;
      const amount = SENTRY_DAMAGE;
      health -= amount;
      ammo -= 1;
      shots += 1;
      cooldownMs += SENTRY_FIRE_INTERVAL_MS;
      events.push(Object.freeze({
        type: 'damage',
        at: ctx.now,
        attackerId: state.actorId,
        attackerTeam: state.team,
        victimId: target.id,
        victimTeam: target.team,
        amount,
        cause: 'streak',
        zone: 'body',
        weaponId: '',
        distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
        healthAfter: Math.max(0, health),
        sourceX: state.x,
        sourceZ: state.z,
      }) as DamageEvent);
    }
  }

  // Out of ammo ends the emplacement; the runtime sees remainingMs <= 0 and
  // emits the one `streak-ended` event. An effect never ends itself.
  const remainingMs = ammo <= 0 ? 0 : state.remainingMs - step;

  return {
    state: Object.freeze({
      ...state,
      remainingMs,
      yaw,
      scanRad,
      ammo,
      shots,
      cooldownMs,
      acquireMs,
      targetId: target === null ? null : target.id,
    }),
    events,
  };
}
