/**
 * Nuketown 2025 — per-actor health, as pure transitions.
 *
 * A LEAF of the combat lane: imports nothing. `damage.ts` decides HOW MUCH,
 * this file decides WHAT THE NUMBER BECOMES, and `game/host.ts` is the only
 * caller allowed to keep the result. Splitting those three is the whole point —
 * the old project's `applyDamage()` mutated health *and* played audio *and*
 * rumbled a gamepad *and* scheduled a respawn, in one ~100-line function
 * (IMPORT-PLAN §5.2). Nothing here can reach a HUD, a sound or a socket,
 * because there is nothing here to reach one with.
 *
 * Every function returns a NEW `ActorHealth`. None of them mutates its input,
 * so a caller may hold the pre-hit record (the killfeed wants it) without
 * defensive copying, and a test may replay a sequence from any point.
 *
 * **The life epoch lives here.** `ActorHealth.life` is bumped by `revive()` and
 * by nothing else, which makes the life boundary a single assignment rather
 * than a convention. `net/protocol.ts:ShotMsg.life` is checked against it, so
 * the `life-epoch` shot rejection and the respawn are the same fact.
 */

// ---------------------------------------------------------------------------
// Constants, with their history (IMPORT-PLAN §5.9)
// ---------------------------------------------------------------------------

/**
 * Full health. 100 in the old project at every site that touched hp, and the
 * ceiling its `admittedPlayerDamage(d)` clamped to — a single shot could take a
 * full-health player down and never more.
 */
export const MAX_HEALTH = 100;

/**
 * Quiet time before health starts coming back. Old
 * `REMOTE_HEALTH_REGEN_DELAY_MS = 5_000`, shared by the host authority and the
 * local projection so the bar could not disagree with the server.
 */
export const REGEN_DELAY_MS = 5_000;

/**
 * Recovery rate. Old `REMOTE_HEALTH_REGEN_PER_SECOND = 18`, i.e. a survivor at
 * 1 hp is whole again 5 s + 5.5 s after the last hit. BO2's regen is faster
 * than that; the value is kept because it is the one the owner played, and a
 * change to it is a balance request, not a port decision.
 */
export const REGEN_PER_SECOND = 18;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ActorHealth {
  /** Current health, always in `[0, MAX_HEALTH]` and always finite. */
  readonly hp: number;
  /** False from the tick the hp hit zero until `revive()`. */
  readonly alive: boolean;
  /** Host time of the last admitted hit; the regen delay counts from here. */
  readonly lastDamageAt: number;
  /** Host time of death; null while alive. */
  readonly diedAt: number | null;
  /**
   * Incoming damage is refused while `now < invulnerableUntil`. Set by the
   * spawn-protection window (`rules.spawnProtectMs`), never by the actor.
   */
  readonly invulnerableUntil: number;
  /**
   * Life epoch. Starts at 1 and increments on every `revive()`. A shot claim
   * stamped with a stale epoch is the `life-epoch` rejection, which is how a
   * bullet authored after death is told apart from a legitimate pre-death
   * trade — the distinction the old `authoritative-shot.test.ts` pinned.
   */
  readonly life: number;
}

/** A fresh, whole actor. `invulnerableUntil` comes from the spawn, not from here. */
export function createHealth(now: number, invulnerableUntil: number = now): ActorHealth {
  return {
    hp: MAX_HEALTH,
    alive: true,
    lastDamageAt: now,
    diedAt: null,
    invulnerableUntil: Math.max(now, invulnerableUntil),
    life: 1,
  };
}

/** True while the spawn-protection window is open. */
export function isInvulnerable(h: ActorHealth, now: number): boolean {
  return now < h.invulnerableUntil;
}

/** `0..1`, for the HUD's low-health threshold. Derived — never stored. */
export function healthFraction(h: ActorHealth): number {
  return h.hp / MAX_HEALTH;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface DamageApplication {
  /** The new record. The old one is untouched. */
  readonly health: ActorHealth;
  /** True only on the call that took hp to zero. A corpse never dies twice. */
  readonly died: boolean;
  /**
   * Health actually removed, after clamping. `amount` minus this is overkill;
   * the feed wants the applied number and the scoreboard wants neither.
   */
  readonly applied: number;
}

/**
 * Subtract admitted damage.
 *
 * `amount` is expected to have come from `damage.ts:resolveDamage()`, which has
 * already applied falloff, the zone multiplier, friendly fire and the
 * invulnerability window. This function re-checks none of that: it is the
 * arithmetic, not the policy. It does defend against two things a policy layer
 * cannot rule out — a non-finite number, and a second hit landing on an actor
 * that is already down in the same tick.
 */
export function applyDamage(h: ActorHealth, amount: number, now: number): DamageApplication {
  if (!h.alive) return { health: h, died: false, applied: 0 };
  const raw = Number.isFinite(amount) ? amount : 0;
  if (raw <= 0) return { health: h, died: false, applied: 0 };

  const applied = Math.min(h.hp, raw);
  const hp = h.hp - applied;
  const died = hp <= 0;
  return {
    health: {
      hp,
      alive: !died,
      lastDamageAt: now,
      diedAt: died ? now : null,
      invulnerableUntil: h.invulnerableUntil,
      life: h.life,
    },
    died,
    applied,
  };
}

/**
 * Start a new life. Health is whole, the epoch advances, and the protection
 * window is whatever the spawn granted (`rules.spawnProtectMs(mode)` — 0 in
 * FFA, where separation at selection time does the job instead).
 *
 * `lastDamageAt` is seeded to `now` so a player who respawns cannot be counted
 * as having been quiet for the whole death; the regen clock starts at the spawn
 * like every other clock in a new life.
 */
export function revive(h: ActorHealth, now: number, invulnerableUntil: number = now): ActorHealth {
  return {
    hp: MAX_HEALTH,
    alive: true,
    lastDamageAt: now,
    diedAt: null,
    invulnerableUntil: Math.max(now, invulnerableUntil),
    life: h.life + 1,
  };
}

/**
 * Advance regeneration by `dtSeconds`.
 *
 * Returns the same object when nothing changes, so the host can compare by
 * identity and skip a broadcast. Dead actors, full actors and actors still
 * inside the delay all take that path.
 */
export function regenStep(h: ActorHealth, dtSeconds: number, now: number): ActorHealth {
  if (!h.alive || h.hp >= MAX_HEALTH) return h;
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return h;
  if (now - h.lastDamageAt < REGEN_DELAY_MS) return h;
  const hp = Math.min(MAX_HEALTH, h.hp + REGEN_PER_SECOND * dtSeconds);
  if (hp === h.hp) return h;
  return { ...h, hp };
}

/**
 * Extend the protection window, e.g. when a spawn is granted to an actor that
 * already has a record. Never shortens one — a shrinking invulnerability is a
 * way for a late message to un-protect a player who was told they were safe.
 */
export function protectUntil(h: ActorHealth, until: number): ActorHealth {
  if (!(until > h.invulnerableUntil)) return h;
  return { ...h, invulnerableUntil: until };
}
