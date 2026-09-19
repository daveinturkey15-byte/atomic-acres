/**
 * Nuketown 2025 — what a bot knows about ordnance: the numbers, the supply
 * shape the host hands it, and the pure helpers `bots.ts` calls when it acts
 * on a grenade, knife or scavenge intent.
 *
 * Split out of `bot-sense.ts` for the 400-line cap and re-exported from it,
 * so `./bots` remains the one import target. PURE: nothing here moves a bot
 * or touches the host.
 */

import type { Vec3 } from './events';
import { TACTICAL_IDS, THROW_LIFT_MS, THROW_SPEED_MS, type GrenadeId } from './ordnance';
import { GRENADE_GRAVITY } from './ordnance-physics';

// ---------------------------------------------------------------------------
// Tuned numbers. Old `bot-ai.ts` grenade window and cooldown (the brief pins
// them); the knife and scavenge reaches are the owner's brief.
// ---------------------------------------------------------------------------

/** Old `bot-ai.ts`: a bot throws at a visible target no nearer than this ... */
export const BOT_GRENADE_MIN_M = 7;
/** ... and no farther than this. */
export const BOT_GRENADE_MAX_M = 18;
/** Old `bot-ai.ts`: one throw per this window, per bot. */
export const BOT_GRENADE_COOLDOWN_MS = 12_000;
/** Owner's brief: "bots knife when within 2 m". Under the 2.35 m swap reach, over the 1.6 m blade. */
export const BOT_KNIFE_M = 2.0;
/** A bot with no rounds walks to a drop inside this; farther is not worth the trip. */
export const BOT_SCAVENGE_M = 24;
/**
 * Height of the point `senseBot` hands back as a target above that actor's
 * feet - `bot-sense.ts:BOT_AIM_ORIGIN_Y`, which this file cannot import
 * without a cycle. The lob lands at the feet, so the solver subtracts it.
 */
export const BOT_TARGET_CHEST_Y = 1.42;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * What the host says a bot is carrying — the `ActorSnapshot` fields the
 * ordnance lane added. Optional on `botIntent` so a caller that has not
 * wired it (today's `bots.ts`) gets a bot that never throws, knifes or
 * scavenges rather than one that does so blindly.
 */
export interface BotSupply {
  readonly lethal: number;
  readonly tactical: number;
  readonly rounds: number;
  readonly armed: string | null;
}

/** A drop on the ground, as `HostSnapshot.ordnance.drops` lists it. */
export interface BotDropSpot {
  readonly x: number;
  readonly z: number;
  readonly weaponId: string;
  readonly rounds: number;
}

/** The two record fields the helpers read. `BotRuntime` satisfies it. */
export interface BotCarrier {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly tacticalId?: GrenadeId;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The tactical a bot carries. DERIVED from the roster serial so half the
 * bots flash and half smoke, with no second roster of who has what: the id
 * `bot-07` parses to 7. Explicit `tacticalId` on the record wins.
 */
export function botTacticalFor(bot: BotCarrier): GrenadeId {
  if (bot.tacticalId !== undefined) return bot.tacticalId;
  const n = Number.parseInt(bot.id.replace(/\D/g, ''), 10);
  return TACTICAL_IDS[(Number.isFinite(n) ? n : 0) % TACTICAL_IDS.length] ?? 'flash';
}

/** Nearest drop with rounds, inside `BOT_SCAVENGE_M`, or null. */
export function nearestScavengeDrop(bot: BotCarrier, drops: readonly BotDropSpot[]): BotDropSpot | null {
  let best: BotDropSpot | null = null;
  let bestD = BOT_SCAVENGE_M;
  for (const d of drops) {
    if (d.rounds <= 0) continue;
    const dist = Math.hypot(d.x - bot.x, d.z - bot.z);
    if (dist <= bestD) { best = d; bestD = dist; }
  }
  return best;
}

/** Pitch candidates the lob solver scans, radians: a flat skim up to a high lob. */
const LOB_PITCH_MIN = -0.35;
const LOB_PITCH_MAX = 0.85;
const LOB_PITCH_STEPS = 32;

/**
 * Where a release at `pitch` lands on a plane `drop` metres below the hand,
 * under the HOST's throw: `THROW_SPEED_MS` along the direction plus
 * `THROW_LIFT_MS` straight up. The closed form for a parabola from a height;
 * bounces and the roll are not modelled, so the mark is where it first lands.
 */
export function lobRange(pitch: number, drop: number): number {
  const vx = THROW_SPEED_MS * Math.cos(pitch);
  const vy = THROW_SPEED_MS * Math.sin(pitch) + THROW_LIFT_MS;
  const disc = vy * vy + 2 * GRENADE_GRAVITY * Math.max(0, drop);
  const t = (vy + Math.sqrt(disc)) / GRENADE_GRAVITY;
  return vx * t;
}

/**
 * The pitch that lands nearest `range` on a plane `drop` metres below the
 * hand. A scan, not the level-ground `asin` solution: that one ignored the
 * lift and the 1.42 m the hand is above the target's feet, and a bot's 10 m
 * throw first touched down at 14 m before it rolled. Allocates nothing.
 */
export function lobPitchFor(range: number, drop: number): number {
  let best = LOB_PITCH_MIN;
  let bestErr = Infinity;
  for (let i = 0; i <= LOB_PITCH_STEPS; i++) {
    const p = LOB_PITCH_MIN + (LOB_PITCH_MAX - LOB_PITCH_MIN) * (i / LOB_PITCH_STEPS);
    const err = Math.abs(lobRange(p, drop) - range);
    if (err < bestErr) { bestErr = err; best = p; }
  }
  return best;
}

/**
 * The unit direction a bot releases a grenade along: the bearing to the
 * target, lofted by `lobPitchFor` so the first touchdown is at the target's
 * feet. `from` is the bot's aim origin, `to` the target's chest; the landing
 * plane is the target's feet. Written into `out`; allocates nothing.
 */
export function throwDirection(from: Vec3, to: Vec3, out: { x: number; y: number; z: number }): void {
  const fx = to.x - from.x;
  const fz = to.z - from.z;
  const range = Math.hypot(fx, fz);
  const pitch = lobPitchFor(range, from.y - (to.y - BOT_TARGET_CHEST_Y));
  const flat = range > 1e-6 ? Math.cos(pitch) / range : 0;
  out.x = fx * flat;
  out.y = Math.sin(pitch);
  out.z = fz * flat;
  const len = Math.hypot(out.x, out.y, out.z);
  if (len > 1e-6) { out.x /= len; out.y /= len; out.z /= len; } else { out.x = 0; out.y = 1; out.z = 0; }
}

/**
 * The unit direction a bot knifes along: from its aim origin to the target's
 * chest, so the host's facing test (`ordnance.ts:KNIFE_FACING_DOT`) passes for
 * a bot that is actually looking at what it is stabbing. Written into `out`.
 */
export function knifeDirection(from: Vec3, to: Vec3, out: { x: number; y: number; z: number }): void {
  out.x = to.x - from.x;
  out.y = to.y - from.y;
  out.z = to.z - from.z;
  const len = Math.hypot(out.x, out.y, out.z);
  if (len > 1e-6) { out.x /= len; out.y /= len; out.z /= len; } else { out.x = 0; out.y = 0; out.z = -1; }
}

/**
 * One ordnance claim, exactly as a human's controller authors one: a `ShotMsg`
 * whose `weaponId` is a grenade id, `knife` or `pickup`, from the bot's aim
 * origin along `dir`, stamped with its life epoch and the next shot seq. A
 * grenade is TWO of these with the same id (arm, then release); see
 * `host-ordnance.ts`. Returns the wire shape `bots.ts:BotHost.submitShot`
 * takes, so the director submits it where it submits a bullet.
 */
export function botOrdnanceClaim(
  life: number, weaponId: string, ox: number, oy: number, oz: number, dir: Vec3, seq: number, now: number,
): { type: 'shot'; seq: number; life: number; weaponId: string; firedAt: number; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number } {
  return { type: 'shot', seq, life, weaponId, firedAt: now, ox, oy, oz, dx: dir.x, dy: dir.y, dz: dir.z };
}
