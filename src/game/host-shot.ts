/**
 * Nuketown 2025 — authoritative shot admission and hit geometry.
 *
 * PURE. Split out of `host.ts` at authoring time, not later: the two together
 * were 672 lines and AGENTS.md caps a file at 400. This is the same split the
 * vocabulary lane made between `events.ts` and `vocab.ts`, and the same unit
 * the old project had as its own 226-line `authoritative-shot.ts`, so the seam
 * is where a seam already belonged. `host.ts` owns the state; this file owns
 * the decision and the maths, and touches neither.
 *
 * ## The rules, in precedence order (IMPORT-PLAN §1.2)
 *
 *  1. **malformed** — a claim whose numbers are not numbers. Checked first so
 *     nothing downstream does arithmetic on a NaN.
 *  2. **unknown-shooter** — no such actor. `ctx === null` is how the caller
 *     says so, which keeps all ten refusals in one function instead of two.
 *  3. **match-inactive** — warmup and post-match bullets do not land.
 *  4. **life-epoch isolation** — a claim stamped with a previous life is
 *     refused. This is what stops a respawn resurrecting the bullets that were
 *     in flight when the shooter died, and it is checked BEFORE the death test
 *     because a stale-life claim is stale whether or not the shooter is up.
 *  5. **pre-death trade allowed, post-death bullet rejected** — `firedAt` at
 *     or before the death instant lands; after it is `shooter-dead`. Losing
 *     the trade you won on your own screen is the single most-reported netcode
 *     complaint there is, and this is the line that decides it.
 *  6. **exactly-once window with bounded reorder tolerance** — the last
 *     `SHOT_WINDOW` accepted seqs are retained. A seq in the window is a
 *     `duplicate`; a LOWER seq that is not in it is still admitted, which is
 *     the reorder tolerance — reliable delivery bunches 900 RPM bullets and
 *     they must not be refused for arriving out of order. Older than the
 *     window is `duplicate` (it cannot be proven new). A forward jump past
 *     `MAX_SEQ_GAP` is `malformed`: no sender legitimately skips 512 shots.
 *  7. **a 250 ms fire-age ceiling** (`stale`) and a 120 ms future bound
 *     (`future`), both widened by `CLOCK_ALLOWANCE_MS`. The ceiling is also
 *     the lag-compensation budget: the host only retains enough pose history
 *     to rewind that far, so a claim older than it cannot be resolved fairly.
 *  8. **the predicted muzzle validated against the shooter pose AT FIRE TIME**
 *     — `bad-origin`. At receipt time a sprinting player is metres away from
 *     where they fired, so validating against the current pose would refuse
 *     honest shots and admit teleport-muzzle ones.
 *
 * `empty-magazine` is in the vocabulary and is NOT decided here: the host sees
 * no reload, so it cannot count rounds without a protocol message that does
 * not exist yet. Declared, unimplemented, and listed in the lane handoff
 * rather than quietly dropped.
 */

import type { HitZone, ShotRejectReason } from './events';
import type { ShotMsg } from '../net/protocol';

// ---------------------------------------------------------------------------
// Tuned constants — each names where it came from (§5.9)
// ---------------------------------------------------------------------------

/** Accepted seqs retained per shooter. Old `RECENT_AUTHORED_SHOTS = 64`, unchanged. */
export const SHOT_WINDOW = 64;
/** Fire-age ceiling. Old `MAX_SHOT_FIRE_AGE_MS = 250`, unchanged. */
export const MAX_FIRE_AGE_MS = 250;
/** How far ahead of the host clock a claim may be. Old `MAX_FUTURE_SHOT_MS = 120`. */
export const MAX_FUTURE_MS = 120;
/** Clock-skew slack added to both bounds. Old `MAX_CLOCK_UNCERTAINTY_ALLOWANCE_MS = 25`. */
export const CLOCK_ALLOWANCE_MS = 25;
/** Forward seq jump treated as a forged claim. Old `MAX_SHOT_SEQUENCE_GAP = 512`. */
export const MAX_SEQ_GAP = 512;
/** Predicted muzzle vs the shooter pose at fire time. Old `validateShotOrigin`: 2.25 m. */
export const MAX_MUZZLE_OFFSET_M = 2.25;

/**
 * The hit capsule. These are a MIRROR and are flagged as one: `core/player.ts`
 * has a private `HALF_W = 0.3` / `BODY_H = 1.78` and `characters/skeleton.ts`
 * exports `STANDARD_HEIGHT = 1.78`. AGENTS.md rule 1 puts every structural
 * dimension in `core/layout.ts`; neither of those files is this lane's to
 * change, so the duplicate is named here and handed over rather than added
 * quietly. The radius is 0.35 rather than the collision 0.3 because a hitbox
 * tighter than the body reads as "my bullets go through people".
 */
export const HIT_RADIUS = 0.35;
export const HIT_HEIGHT = 1.78;
/** Height above the feet at or above which a hit is a headshot. */
export const HEAD_Y = 1.55;
/** Below this height above the feet a hit is a limb; between the two, the body. */
export const LIMB_Y = 0.9;

/** Pose samples retained per actor. 24 at the 20 Hz tick is 1.2 s, past the 250 ms ceiling. */
export const POSE_SAMPLES = 24;

// ---------------------------------------------------------------------------
// Pose history — the rewind
// ---------------------------------------------------------------------------

export interface PoseSample {
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * A bounded ring of authoritative poses. `net/room.ts` owns position; this is
 * the host's short memory of it, and it is what makes both the muzzle check
 * and the hit test happen in the world as it was when the trigger went down.
 *
 * It is a class with two methods over its own array — not a callback bag
 * (§5.3). Nothing is injected into it and it calls nothing.
 */
export class PoseTrack {
  private readonly ring: PoseSample[] = [];
  private cursor = 0;

  push(at: number, x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(at)) return;
    const s: PoseSample = { at, x, y, z };
    if (this.ring.length < POSE_SAMPLES) this.ring.push(s);
    else this.ring[this.cursor % POSE_SAMPLES] = s;
    this.cursor++;
  }

  get size(): number {
    return this.ring.length;
  }

  /** Linear interpolation between the bracketing samples; clamps at both ends. */
  at(t: number): PoseSample | null {
    if (this.ring.length === 0) return null;
    let before: PoseSample | null = null;
    let after: PoseSample | null = null;
    for (const s of this.ring) {
      if (s.at <= t && (before === null || s.at > before.at)) before = s;
      if (s.at >= t && (after === null || s.at < after.at)) after = s;
    }
    if (before === null) return after;
    if (after === null || after.at === before.at) return before;
    const f = (t - before.at) / (after.at - before.at);
    return {
      at: t,
      x: before.x + (after.x - before.x) * f,
      y: before.y + (after.y - before.y) * f,
      z: before.z + (after.z - before.z) * f,
    };
  }
}

// ---------------------------------------------------------------------------
// The exactly-once window
// ---------------------------------------------------------------------------

export interface ShotWindow {
  /** Highest seq ever accepted this life; -1 before the first. */
  seqHigh: number;
  /** The retained accepted seqs, oldest first, at most `SHOT_WINDOW` of them. */
  seqs: number[];
}

export function createShotWindow(): ShotWindow {
  return { seqHigh: -1, seqs: [] };
}

/** Record an admitted seq. Called only after `admitShot` returned null. */
export function acceptShot(w: ShotWindow, seq: number): void {
  w.seqs.push(seq);
  if (w.seqs.length > SHOT_WINDOW) w.seqs.shift();
  if (seq > w.seqHigh) w.seqHigh = seq;
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

export interface ShotAdmissionCtx {
  readonly matchActive: boolean;
  /** The shooter's current life epoch. */
  readonly life: number;
  readonly alive: boolean;
  /** Host time of death while down; null while alive. */
  readonly diedAt: number | null;
  /** False when `claim.weaponId` is not in `weapons/catalog.ts:WEAPONS`. */
  readonly knownWeapon: boolean;
  readonly window: ShotWindow;
  /** The shooter's pose at `claim.firedAt`, already rewound by the caller. */
  readonly pose: PoseSample | null;
  readonly receivedAt: number;
}

/**
 * Returns the refusal, or null to admit. `ctx === null` means the sender is
 * not an actor in this match.
 */
export function admitShot(c: ShotMsg, ctx: ShotAdmissionCtx | null): ShotRejectReason | null {
  if (
    !Number.isSafeInteger(c.seq) || c.seq < 0 || !Number.isSafeInteger(c.life) ||
    typeof c.weaponId !== 'string' || c.weaponId.length === 0 ||
    !Number.isFinite(c.firedAt) ||
    !Number.isFinite(c.ox) || !Number.isFinite(c.oy) || !Number.isFinite(c.oz) ||
    Math.abs(Math.hypot(c.dx, c.dy, c.dz) - 1) > 1e-3
  ) return 'malformed';

  if (ctx === null) return 'unknown-shooter';
  // A weapon nobody ships is a forged claim, not a content gap: every legal
  // id is a row in the authored catalog and the client picked it from there.
  if (!ctx.knownWeapon) return 'malformed';
  if (!ctx.matchActive) return 'match-inactive';
  if (c.life !== ctx.life) return 'life-epoch';
  if (!ctx.alive && (ctx.diedAt === null || c.firedAt > ctx.diedAt)) return 'shooter-dead';

  const w = ctx.window;
  if (w.seqs.includes(c.seq)) return 'duplicate';
  if (w.seqHigh >= 0) {
    if (c.seq <= w.seqHigh - SHOT_WINDOW) return 'duplicate';
    if (c.seq - w.seqHigh > MAX_SEQ_GAP) return 'malformed';
  }

  const age = ctx.receivedAt - c.firedAt;
  if (age > MAX_FIRE_AGE_MS + CLOCK_ALLOWANCE_MS) return 'stale';
  if (age < -(MAX_FUTURE_MS + CLOCK_ALLOWANCE_MS)) return 'future';

  const p = ctx.pose;
  if (p === null || Math.hypot(c.ox - p.x, c.oy - p.y, c.oz - p.z) > MAX_MUZZLE_OFFSET_M) return 'bad-origin';
  return null;
}

// ---------------------------------------------------------------------------
// Hit geometry
// ---------------------------------------------------------------------------

export interface TargetCandidate {
  readonly id: string;
  /** The candidate's pose at `claim.firedAt` — the same rewind as the muzzle. */
  readonly pose: PoseSample;
}

export interface TargetHit {
  readonly id: string;
  /** Metres along the unit aim direction. */
  readonly distance: number;
  readonly zone: HitZone;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Nearest candidate the ray enters, with the zone taken from the height of the
 * entry point above that candidate's feet. Geometry only: no teams, no
 * damage, no line-of-sight — the caller owns all three, because only it has
 * the `WorldQuery` port and the rules.
 */
export function pickTarget(c: ShotMsg, candidates: readonly TargetCandidate[]): TargetHit | null {
  let best: TargetHit | null = null;
  for (const cand of candidates) {
    const p = cand.pose;
    const t = rayCylinder(c.ox, c.oy, c.oz, c.dx, c.dy, c.dz, p.x, p.y, p.z, HIT_RADIUS, HIT_HEIGHT);
    if (t === null || (best !== null && t >= best.distance)) continue;
    const hy = c.oy + c.dy * t - p.y;
    best = {
      id: cand.id,
      distance: t,
      zone: hy >= HEAD_Y ? 'head' : hy >= LIMB_Y ? 'body' : 'limb',
      x: c.ox + c.dx * t,
      y: c.oy + c.dy * t,
      z: c.oz + c.dz * t,
    };
  }
  return best;
}

/**
 * Ray against a vertical cylinder — the hit capsule without its caps, which
 * costs one grazing shot at the crown of the head and saves the whole
 * sphere-cap branch. Returns the distance along a UNIT direction, or null.
 * An origin inside the cylinder returns the exit root, so a point-blank muzzle
 * inside an enemy still registers instead of silently missing.
 */
export function rayCylinder(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  r: number, h: number,
): number | null {
  const mx = ox - cx;
  const mz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a <= 1e-9) return null;
  const b = 2 * (mx * dx + mz * dz);
  const c = mx * mx + mz * mz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = (-b - s) / (2 * a);
  if (t < 0) t = (-b + s) / (2 * a);
  if (t < 0) return null;
  const y = oy + dy * t;
  return y >= cy && y <= cy + h ? t : null;
}
