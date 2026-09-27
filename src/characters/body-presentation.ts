import type { BotBody } from '../game/session-types';
import type { CharacterHandle } from './system';

/** The simulation owns positions; this buffer only presents its 20 Hz samples. */
export interface BodySample { x: number; y: number; z: number; yaw: number; time: number }
export interface BodyTrack {
  previous: BodySample;
  current: BodySample;
  alive: boolean;
}
const DELAY_MS = 50;
interface PresentedTrack extends BodyTrack {
  renderedX: number; renderedZ: number; renderedAt: number;
  buffered: boolean;
}
const tracks = new WeakMap<CharacterHandle, PresentedTrack>();
const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function sampleBody(track: BodyTrack, pose: BodySample, alive: boolean): boolean {
  const distance = Math.hypot(pose.x - track.current.x, pose.y - track.current.y, pose.z - track.current.z);
  const reset = alive !== track.alive || distance > 2 || pose.time < track.current.time || pose.time - track.current.time > 250;
  if (reset) {
    Object.assign(track.previous, pose);
    Object.assign(track.current, pose);
  } else if (pose.time > track.current.time) {
    Object.assign(track.previous, track.current);
    Object.assign(track.current, pose);
  }
  track.alive = alive;
  return reset;
}

/** Allocation-free interpolation, shortest-arc facing, no speculative movement. */
export function readBody(track: BodyTrack, now: number, out: BodySample): void {
  const a = track.previous, b = track.current;
  const span = b.time - a.time;
  const t = span > 0 ? Math.max(0, Math.min(1, (now - DELAY_MS - a.time) / span)) : 1;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.yaw = a.yaw + angleDelta(a.yaw, b.yaw) * t;
  out.time = now;
}

const scratch: BodySample = { x: 0, y: 0, z: 0, yaw: 0, time: 0 };
/** Returns displayed horizontal speed for the mixer, never for simulation. */
export function presentBody(handle: CharacterHandle, body: BotBody, now: number): number {
  scratch.x = body.x; scratch.y = body.y; scratch.z = body.z;
  scratch.yaw = body.yaw; scratch.time = body.sampleTimeMs ?? now;
  // Guest poses already come from the network interpolation buffer. Do not add
  // another delay, and never feed rendered positions back to hit admission.
  const buffered = body.sampleTimeMs !== undefined;
  let track = tracks.get(handle);
  let reset = false;
  if (!track) {
    track = { previous: { ...scratch }, current: { ...scratch }, alive: body.alive,
      renderedX: scratch.x, renderedZ: scratch.z, renderedAt: now, buffered };
    tracks.set(handle, track);
    reset = true;
  } else {
    const modeChanged = track.buffered !== buffered;
    reset = sampleBody(track, scratch, body.alive) || modeChanged;
    if (modeChanged) {
      Object.assign(track.previous, scratch);
      Object.assign(track.current, scratch);
    }
    track.buffered = buffered;
  }
  if (buffered) {
    readBody(track, now, scratch);
  }
  const elapsed = now - track.renderedAt;
  const speed = !reset && body.alive && elapsed > 0 && elapsed <= 250
    ? Math.hypot(scratch.x - track.renderedX, scratch.z - track.renderedZ) * 1000 / elapsed : 0;
  track.renderedX = scratch.x; track.renderedZ = scratch.z; track.renderedAt = now;
  handle.root.position.set(scratch.x, scratch.y, scratch.z);
  // Camera/host forward is -Z; the standard character and its weapon face +Z.
  handle.yaw = scratch.yaw + Math.PI;
  handle.root.rotation.y = handle.yaw;
  handle.rootMotion = false;
  return speed;
}
