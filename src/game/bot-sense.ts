/**
 * Nuketown 2025 — the bot reducer: sense in, intent out.
 *
 * LEAF HALF of `game/bots.ts`, split at authoring time because the two
 * together came to 544 lines and AGENTS.md caps a file at 400 — the same
 * split, for the same reason, that `events.ts`/`vocab.ts` and
 * `host.ts`/`host-ports.ts` already made. `bots.ts` re-exports all of it, so
 * every import target stays `./bots` and nobody needs to know it is two files.
 *
 * Everything here is PURE. `senseBot` and `botIntent` read a bot record and
 * the actors around it and return a decision; nothing in this file moves a
 * bot, writes a score, applies damage or touches the host. A bot's bullet is
 * a claim like any other and `game/host.ts` resolves it (IMPORT-PLAN §2).
 */

import { WEAPONS, type WeaponDef } from '../weapons/catalog';
import type { ActorId, StreakDenialReason, TeamId, Vec3, WorldQuery } from './events';
import type { GrenadeId } from './ordnance';
import {
  BOT_GRENADE_COOLDOWN_MS, BOT_GRENADE_MAX_M, BOT_GRENADE_MIN_M, BOT_KNIFE_M, botTacticalFor,
  nearestScavengeDrop, type BotDropSpot, type BotSupply,
} from './bot-ordnance';
import { sightOf } from './world-query';

export * from './bot-ordnance';

// ---------------------------------------------------------------------------
// Tuned numbers. Each names the value it replaced and the sentence that moved
// it (§5.9). The four the brief pins are unchanged from the old project.
// ---------------------------------------------------------------------------

/** Old `bot-ai.ts` REACTION_DELAY_MS. How long a target must be continuously
 *  visible before the trigger is allowed. Play-tested; do not "improve" it. */
export const BOT_REACTION_MS = 650;
/** Old `bot-ai.ts` BOT_FIRE_RANGE_M. Beyond this a bot advances, it does not shoot. */
export const BOT_FIRE_RANGE_M = 22;
/** Old `bot-ai.ts` reinforcement cadence: one new bot per ten bot deaths. */
export const BOT_REINFORCE_EVERY_DEATHS = 10;
/** Old `bot-stance.ts` sustain window before the favoured half of the map flips. */
export const BOT_SIDE_HYSTERESIS_MS = 1_200;
/** Old `bot-ai.ts` operator aim origin: shoulder height, not eye and not feet. */
export const BOT_AIM_ORIGIN_Y = 1.42;

/** Bot ground speed. `core/player.ts` walks the human at ~5.4 m/s; a bot that
 *  matched it was impossible to disengage from on a map this size, so it runs
 *  at 0.8 of the human. Before: 5.4 (the human's own number, used directly). */
export const BOT_SPEED_MS = 4.3;
/** Step height a bot can walk up without a jump. Matches the kerb at 0.15 and
 *  the pavement lip; anything taller is an obstacle to slide along. */
export const BOT_STEP_UP_M = 0.45;
/** Chest height for the movement blocking test. Below the 1.42 aim origin so a
 *  waist-high rail blocks the walk even when the shot passes over it. */
export const BOT_CHEST_Y = 0.95;
/** Stop closing once this near; past it a bot backs off and strafes. */
export const BOT_ENGAGE_M = 7.0;
/** Re-pick the patrol goal on arrival within this, or after `GOAL_TIMEOUT_MS`. */
export const BOT_GOAL_REACHED_M = 2.5;
export const BOT_GOAL_TIMEOUT_MS = 9_000;
/** Strafe direction is re-rolled on this cadence while engaged. */
export const BOT_STRAFE_SWAP_MS = 900;
/** Below this fraction of full health a bot wants its own half of the map. */
export const BOT_FALLBACK_HP = 35;
/** Sight range for acquiring a target at all; the fire gate is the shorter one. */
export const BOT_SIGHT_M = 55;
/**
 * How long an acquisition survives a break in line of sight.
 *
 * ADDED by the integration lane, with the measurement that forced it. The
 * reaction delay is a delay on ACQUIRING a target, not a tax on every frame:
 * with `targetSince` reset the instant sight broke, a 60 s five-bot match
 * measured 4,563 live bot-ticks, 260 of them with a visible enemy, 244 of
 * those inside fire range - and only 10 shots, because almost no run of
 * continuous visibility lasted the 650 ms the trigger needs. Strafing across
 * a doorway on a map this dense breaks the segment constantly. 400 ms is
 * shorter than the reaction delay itself, so re-peeking a NEW corner still
 * costs the full 650 ms; what it stops is the same fight restarting the
 * clock every time a fence post goes past.
 */
export const BOT_TARGET_MEMORY_MS = 400;

/**
 * How long a bot leaves a refused killstreak slot alone before trying again.
 *
 * ADDED by the defect lane, with the measurement that forced it. A bot pressed
 * its ready slot on EVERY host tick and the gate refused it on every one, so a
 * single banked charge held across the end of a match produced a `streak-denied`
 * event at 20 Hz for the whole `session.ts:REMATCH_MS` hold: MEASURED at 179
 * denials in one 9 s window (seed 7, 240 s, default limits), all of them with
 * the match phase `ended`, i.e. `match-inactive`. Nothing was wrong with the
 * gate — the refusal was correct every time. What was wrong was asking again
 * 1/20 of a second later.
 *
 * 4 s. Long enough that a refusal which WILL clear on its own (a live streak
 * retiring, a placement opening up) costs at most a handful of retries, and
 * short enough that a bot does not sit on a charge it could spend. Before: no
 * backoff at all, i.e. `TICK_MS` — 50 ms.
 */
export const BOT_STREAK_RETRY_MS = 4_000;

/**
 * Refusals that pressing again cannot clear, so the bot stops pressing at all
 * until it is redeployed (`BotDirector.onSpawn`) or the match is rebuilt.
 *
 * Three, each terminal for a different cause:
 * `dead` cannot change without a new life; `match-inactive` cannot
 * change without a new match, and the session builds a whole new director for
 * one; `not-earned` means the host's ledger disagrees with the slot snapshot
 * the bot read, which retrying does not reconcile.
 *
 * DELIBERATELY NOT HERE: `arena-unsupported`. It is terminal too — a streak
 * with no stepper in this build (`blast-mortar`) can never be activated — but
 * `readySlot` returns the LOWEST slot holding a charge, so blocking the whole
 * bot on it would also stop it spending a recon sweep it banks later in the
 * same life. Under `BOT_STREAK_RETRY_MS` that case costs one denial every 4 s
 * instead of eighty, which is a readable rate rather than a flood.
 */
export const BOT_STREAK_TERMINAL_DENIALS: readonly StreakDenialReason[] = Object.freeze([
  'dead', 'match-inactive', 'not-earned',
]);

// ---------------------------------------------------------------------------
// Arsenal — a PROJECTION of the weapon catalog, never a second roster (§5.5)
// ---------------------------------------------------------------------------

/**
 * The policy is DEFAULT-ELIGIBLE with a named, justified exclusion list. That
 * direction matters: the old project's rule existed so "a new weapon cannot
 * silently be invisible to bots", and an opt-IN list would reintroduce exactly
 * that failure the next time someone adds a sixth weapon.
 *
 * `weapons/catalog.ts` is the weapons lane's file and carries no `bot` field,
 * so the policy lives here as a predicate over the definition rather than as a
 * flag added to someone else's table.
 */
export const BOT_EXCLUDED_WEAPON_IDS: readonly string[] = Object.freeze([
  // The pistol is every kit's sidearm (`game/loadout.ts:SIDEARM_IDS`); a bot
  // that drew it as a primary would be carrying the backup gun and nothing else.
  'duster',
]);

/** Guard against the exclusion list going stale, which is the §5.5 failure in
 *  miniature: a retired id would silently exclude nothing and read as fine. */
for (const id of BOT_EXCLUDED_WEAPON_IDS) {
  if (!WEAPONS.some((w) => w.id === id)) {
    throw new Error('[bots] BOT_EXCLUDED_WEAPON_IDS names "' + id + '", which is not in weapons/catalog.ts');
  }
}

/** Derived: the catalog minus the exclusions. A sixth weapon joins by existing. */
export const BOT_ARSENAL: readonly WeaponDef[] = Object.freeze(
  WEAPONS.filter((w) => !BOT_EXCLUDED_WEAPON_IDS.includes(w.id)),
);

// ---------------------------------------------------------------------------
// Aim. The project's yaw frame, stated once here.
// ---------------------------------------------------------------------------

/**
 * Yaw that faces (toX, toZ) from (fromX, fromZ).
 *
 * The frame is `core/player.ts`'s: world forward at yaw y is
 * `(-sin y, 0, -cos y)`. Getting the sign wrong here is invisible at yaw 0 and
 * exactly backwards at ±90°, which is a defect this project has already paid
 * for once. `killstreaks/effects/sentry.ts:bearingOf` is the same two lines for
 * the same reason — a known duplicate, flagged rather than hidden, and it
 * belongs in `core/` with the rest of the frame when someone owns that file.
 */
export function operatorYawToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

/** Pitch from the aim origin to a point. Positive looks up, as the camera does. */
export function operatorPitchToward(from: Vec3, to: Vec3): number {
  const flat = Math.hypot(to.x - from.x, to.z - from.z);
  return Math.atan2(to.y - from.y, flat === 0 ? 1e-6 : flat);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** What a bot is allowed to know about another actor: where it is, nothing more. */
export interface BotActorView {
  readonly id: ActorId;
  readonly team: TeamId;
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BotSense {
  readonly targetId: ActorId | null;
  readonly target: Vec3 | null;
  readonly distance: number;
  /** A clear chest-to-chest segment right now. */
  readonly visible: boolean;
}

export interface BotIntent {
  readonly yaw: number;
  readonly pitch: number;
  /** World-space unit wish, or (0,0) to stand still. */
  readonly moveX: number;
  readonly moveZ: number;
  readonly fire: boolean;
  /** 1-based slot to press this tick, or null. */
  readonly streakSlot: number | null;
  /** Grenade to arm and release this tick (`game/ordnance.ts` id), or null. */
  readonly grenade: GrenadeId | null;
  /** Swing the knife this tick. */
  readonly knife: boolean;
  /** Walking to a drop for ammo: its position, or null. Overrides the patrol goal. */
  readonly scavengeX: number | null;
  readonly scavengeZ: number | null;
}

/** One bot's mutable record. The director owns every one of these. */
export interface BotRuntime {
  readonly id: ActorId;
  readonly team: TeamId;
  readonly weapon: WeaponDef;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  alive: boolean;
  life: number;
  /** Continuously-visible target, and when that run of visibility began. */
  targetId: ActorId | null;
  targetSince: number;
  /** Host time this target was last actually visible. See `BOT_TARGET_MEMORY_MS`. */
  lastSeen: number;
  /** Favoured half of the map: +1 toward +z (white spawn), -1 toward -z. */
  side: 1 | -1;
  sideWant: 1 | -1;
  sideSince: number;
  goalX: number;
  goalZ: number;
  goalAt: number;
  strafe: 1 | -1;
  strafeAt: number;
  inputSeq: number;
  shotSeq: number;
  cooldown: number;
  /** Slot the last streak refusal named, and the host time it may be re-pressed.
   *  See `BOT_STREAK_RETRY_MS`; `null` means no slot is under a hold. */
  streakHoldSlot: number | null;
  streakHoldUntil: number;
  /** A refusal this life cannot clear. Reset by `BotDirector.onSpawn`. */
  streakBlocked: boolean;
  /**
   * Ordnance lane, OPTIONAL so `bots.ts`'s record literal still type-checks
   * without it: host time of the last throw (the 12 s cooldown counts from
   * here), and the tactical this bot carries. Absent reads as never thrown /
   * `botTacticalFor(0)`.
   */
  grenadeAt?: number;
  tacticalId?: GrenadeId;
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

const NO_TARGET: BotSense = Object.freeze({ targetId: null, target: null, distance: Infinity, visible: false });

/**
 * Nearest hostile with a clear chest segment; falls back to nearest hostile.
 *
 * Two things obscure sight besides walls, both read off the `SightField` the
 * host keeps on the world (`world-query.ts`): a flash this bot took blinds it
 * outright for the flash's duration — no target at all, not even the unseen
 * fallback, because a blinded bot that keeps advancing on a remembered
 * position is a bot that was not flashed — and a smoke volume between the two
 * chests blocks the segment exactly as a wall does.
 */
export function senseBot(
  bot: BotRuntime,
  actors: readonly BotActorView[],
  world: WorldQuery,
): BotSense {
  const sight = sightOf(world);
  if (sight !== null && sight.isBlinded(bot.id)) return NO_TARGET;
  const eye: Vec3 = { x: bot.x, y: bot.y + BOT_AIM_ORIGIN_Y, z: bot.z };
  let best: BotActorView | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestVisible = false;
  for (const a of actors) {
    if (!a.alive || a.id === bot.id || a.team === bot.team) continue;
    const d = Math.hypot(a.x - bot.x, a.z - bot.z);
    if (d > BOT_SIGHT_M) continue;
    const at: Vec3 = { x: a.x, y: a.y + BOT_AIM_ORIGIN_Y, z: a.z };
    const vis = world.lineOfSight(eye, at) && !(sight !== null && sight.losBlockedBySmoke(eye, at));
    // A visible target always beats an unseen one, however close the unseen is.
    if (bestVisible && !vis) continue;
    if (vis && !bestVisible) {
      best = a; bestDist = d; bestVisible = true; continue;
    }
    if (d < bestDist) { best = a; bestDist = d; bestVisible = vis; }
  }
  if (best === null) return NO_TARGET;
  return {
    targetId: best.id,
    target: { x: best.x, y: best.y + BOT_AIM_ORIGIN_Y, z: best.z },
    distance: bestDist,
    visible: bestVisible,
  };
}

/**
 * Sense → intent. Pure: it reads the bot record and writes nothing.
 *
 * The reaction delay is the whole character of a bot. `targetSince` is
 * maintained by the caller as the instant the CURRENT continuous run of
 * visibility began, so breaking line of sight and re-peeking costs the full
 * 650 ms again — which is what makes a corner fight winnable.
 */
export function botIntent(
  bot: BotRuntime,
  sense: BotSense,
  now: number,
  hp: number,
  readySlot: number | null,
  supply: BotSupply | null = null,
  drops: readonly BotDropSpot[] | null = null,
): BotIntent {
  let yaw = bot.yaw;
  let pitch = 0;
  let moveX = 0;
  let moveZ = 0;
  let fire = false;
  let grenade: GrenadeId | null = null;
  let knife = false;
  let scavengeX: number | null = null;
  let scavengeZ: number | null = null;

  if (sense.target !== null && sense.targetId !== null) {
    const eye: Vec3 = { x: bot.x, y: bot.y + BOT_AIM_ORIGIN_Y, z: bot.z };
    yaw = operatorYawToward(bot.x, bot.z, sense.target.x, sense.target.z);
    pitch = operatorPitchToward(eye, sense.target);
  }

  const engaged = sense.visible && sense.distance <= BOT_FIRE_RANGE_M;
  if (engaged) {
    fire = now - bot.targetSince >= BOT_REACTION_MS && bot.cooldown <= 0;
    // Ordnance, only when the host has told us what we carry. The knife is
    // a reflex inside 2 m; the grenade waits for the reaction delay like the
    // trigger does, and then only in the 7-18 m window, once per 12 s.
    if (supply !== null && supply.armed === null) {
      if (sense.distance <= BOT_KNIFE_M) {
        knife = true;
        fire = false;
      } else if (fire && sense.distance >= BOT_GRENADE_MIN_M && sense.distance <= BOT_GRENADE_MAX_M
          && now - (bot.grenadeAt ?? -Infinity) >= BOT_GRENADE_COOLDOWN_MS) {
        grenade = supply.lethal > 0 ? 'frag' : supply.tactical > 0 ? botTacticalFor(bot) : null;
        if (grenade !== null) fire = false;
      }
    }
    // Closer than the engage radius it backs off; otherwise it closes. Either
    // way it strafes, because a bot that walks a straight line at you is a
    // target and not an opponent.
    const forward = sense.distance > BOT_ENGAGE_M ? 1 : -0.6;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    moveX = fx * forward + Math.cos(yaw) * bot.strafe * 0.85;
    moveZ = fz * forward - Math.sin(yaw) * bot.strafe * 0.85;
  } else {
    // Out of rounds and nothing to shoot: the nearest drop is the goal.
    const spot = supply !== null && supply.rounds <= 0 && drops !== null ? nearestScavengeDrop(bot, drops) : null;
    const goalX = spot === null ? bot.goalX : spot.x;
    const goalZ = spot === null ? bot.goalZ : spot.z;
    if (spot !== null) { scavengeX = spot.x; scavengeZ = spot.z; }
    const gx = goalX - bot.x;
    const gz = goalZ - bot.z;
    const gd = Math.hypot(gx, gz);
    if (gd > 1e-3) {
      moveX = gx / gd;
      moveZ = gz / gd;
      // Nothing to shoot: face where it is going, so the body reads as walking
      // rather than moonwalking. The rig has no independent upper body yet.
      if (sense.target === null) yaw = operatorYawToward(bot.x, bot.z, goalX, goalZ);
    }
  }

  const len = Math.hypot(moveX, moveZ);
  if (len > 1) { moveX /= len; moveZ /= len; }

  // A streak is pressed the moment it is banked and the bot is not mid-fight;
  // a real player hoards, a bot spending it immediately is what proves the
  // whole earn → bank → spend → effect path every match instead of rarely.
  const streakSlot = readySlot !== null && hp > BOT_FALLBACK_HP ? readySlot : null;
  return { yaw, pitch, moveX, moveZ, fire, streakSlot, grenade, knife, scavengeX, scavengeZ };
}
