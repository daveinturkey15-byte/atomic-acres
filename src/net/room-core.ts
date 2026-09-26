/**
 * Nuketown 2025 — what host and guest rooms share: the kinematics, the pose
 * type, the live-room counter and the name cleaner.
 *
 * Split out of `room.ts` when that file (719 lines) was divided into the host
 * half and the guest half for the AGENTS.md 400-line cap. `room.ts` re-exports
 * everything here, so `import { ... } from './room'` still sees it all.
 *
 * Movement speeds mirror src/core/player.ts (WALK 4.8, SPRINT 6.6) which this
 * lane may not edit; if they drift, prediction error grows and the
 * reconciliation counters show it instead of silently disagreeing. The
 * long-term home for both is one shared tuning module.
 */
import { BOUND_X_MAX, BOUND_X_MIN, BOUND_Z } from '../core/layout';

/** Owned interval/timeout handle. DOM lib types these as numbers. */
export type TimerId = number | null;

// ---------------------------------------------------------------------------
// Shared kinematics: host and guest MUST integrate identically. mx is strafe
// (+right), mz is forward. Frame agrees with Player: forward is
// (-sin yaw, 0, -cos yaw), right is (cos yaw, 0, -sin yaw).
// ---------------------------------------------------------------------------

export const WALK_SPEED = 4.8;
export const SPRINT_SPEED = 6.6;
export const CROUCH_SPEED = 2.75;
export const PRONE_SPEED = 1.25;
export const STAND_HEIGHT = 1.78;
export const CROUCH_HEIGHT = 1.16;
export const PRONE_HEIGHT = 0.52;

/** Wire-safe stance intent. Missing on old peers means standing. */
export const PLAYER_STANCES = ['stand', 'crouch', 'prone'] as const;
export type PlayerStance = (typeof PLAYER_STANCES)[number];

export function isPlayerStance(value: unknown): value is PlayerStance {
  return typeof value === 'string' && (PLAYER_STANCES as readonly string[]).includes(value);
}

export function normalizeStance(value: unknown): PlayerStance | null {
  if (value === undefined) return 'stand';
  return isPlayerStance(value) ? value : null;
}

export function stanceSpeed(stance: PlayerStance): number {
  if (stance === 'prone') return PRONE_SPEED;
  if (stance === 'crouch') return CROUCH_SPEED;
  return WALK_SPEED;
}

export function stanceBodyHeight(stance: PlayerStance): number {
  if (stance === 'prone') return PRONE_HEIGHT;
  if (stance === 'crouch') return CROUCH_HEIGHT;
  return STAND_HEIGHT;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Optional for compatibility with pre-stance callers; authority fills stand. */
  stance?: PlayerStance;
}

export function createPose(x = 0, y = 0, z = 0, yaw = 0): Pose {
  return { x, y, z, yaw, stance: 'stand' };
}

/** Integrate one input sample. Pure: mutates `pose`, allocates nothing. */
export function integrateInput(
  pose: Pose, mx: number, mz: number, yaw: number, sprint: boolean, dt: number,
  stance: PlayerStance = pose.stance ?? 'stand',
  speedMultiplier = 1,
): void {
  let cx = Math.max(-1, Math.min(1, mx));
  let cz = Math.max(-1, Math.min(1, mz));
  const wishLength = Math.hypot(cx, cz);
  if (wishLength > 1) { cx /= wishLength; cz /= wishLength; }
  if (!Number.isFinite(yaw) || !Number.isFinite(dt) || dt <= 0) return;
  // Sprint is never a second speed multiplier: a crouched or prone actor is
  // always clamped to that stance's authored walk speed.
  const multiplier = Number.isFinite(speedMultiplier) ? Math.max(1, Math.min(1.25, speedMultiplier)) : 1;
  const speed = (stance === 'stand' && sprint ? SPRINT_SPEED : stanceSpeed(stance)) * multiplier;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  pose.x += (rx * cx + fx * cz) * speed * dt;
  pose.z += (rz * cx + fz * cz) * speed * dt;
  pose.yaw = yaw;
  pose.stance = stance;
  // The host owns position: clamp into the arena instead of trusting anyone.
  if (pose.x < BOUND_X_MIN) pose.x = BOUND_X_MIN;
  else if (pose.x > BOUND_X_MAX) pose.x = BOUND_X_MAX;
  if (pose.z < -BOUND_Z) pose.z = -BOUND_Z;
  else if (pose.z > BOUND_Z) pose.z = BOUND_Z;
  pose.y = 0;
}

/**
 * The inverse of `integrateInput` for a guest whose body is moved by the real
 * controller (collision, step-up, friction) rather than by the wire's
 * kinematics: given the body's world velocity, the `(mx, mz, sprint)` that
 * makes the host's integration reproduce the same displacement. Writes into
 * `out`; allocates nothing. A body stopped by a wall has zero velocity and so
 * sends zero intent — the host cannot be walked through what stopped the guest.
 */
export function intentFromVelocity(
  vx: number, vz: number, yaw: number,
  out: { mx: number; mz: number; sprint: boolean },
  stance: PlayerStance = 'stand',
  speedMultiplier = 1,
): void {
  const speed = Math.hypot(vx, vz);
  if (speed < 1e-3) {
    out.mx = 0; out.mz = 0; out.sprint = false;
    return;
  }
  const multiplier = Number.isFinite(speedMultiplier) ? Math.max(1, Math.min(1.25, speedMultiplier)) : 1;
  const base = stanceSpeed(stance) * multiplier;
  const sprint = stance === 'stand' && speed > WALK_SPEED * multiplier + 0.05;
  const scale = 1 / (sprint ? SPRINT_SPEED * multiplier : base);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  out.mx = Math.max(-1, Math.min(1, (vx * rx + vz * rz) * scale));
  out.mz = Math.max(-1, Math.min(1, (vx * fx + vz * fz) * scale));
  out.sprint = sprint;
}

let liveRooms = 0;
/** Rooms currently undisposed. Proof asserts this returns to zero. */
export function liveRoomCount(): number {
  return liveRooms;
}
export function roomOpened(): void {
  liveRooms += 1;
}
export function roomClosed(): void {
  liveRooms -= 1;
}

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 16) : '';
  return s || 'guest';
}
