/**
 * Host-clock to guest-clock conversion at the gameplay receive boundary.
 *
 * `HostRoom` and `GameHost` author absolute times in the host's monotonic
 * clock. A guest renders with its own monotonic clock. `offset` is the NTP
 * estimate `hostNow - guestNow`, so an absolute host timestamp becomes
 * `hostTimestamp - offset` exactly once when it enters the guest projection.
 *
 * Durations are deliberately not touched. `flash-hit.durationMs` is a span,
 * while `bornAt`, `diesAt`, `respawnAt`, `detonatesAt`, `protectedUntil`, and
 * `endsAt` are absolute host times. Match snapshots carry `at` and `endsAt`,
 * so their remaining duration is preserved by shifting both endpoints by the
 * same offset.
 */
import type { GameEvent } from '../game/events';
import type { GameNetMessage, MatchStateMsg, StreakStateMsg } from './protocol';

/** Convert one absolute timestamp. Invalid offsets fail safe to the source. */
export function hostTimeToGuest(hostTime: number, offset: number): number {
  return Number.isFinite(offset) ? hostTime - offset : hostTime;
}

function optionalHostTime(value: number | null, offset: number): number | null {
  return value === null ? null : hostTimeToGuest(value, offset);
}

function localizeEvent<T extends GameEvent>(event: T, offset: number): T {
  return localizeGameEvent(event, offset) as T;
}

/** Localize every absolute time carried by one host-authored game event. */
export function localizeGameEvent(event: GameEvent, offset: number): GameEvent {
  const at = hostTimeToGuest(event.at, offset);
  switch (event.type) {
    case 'death':
      return { ...event, at, respawnAt: optionalHostTime(event.respawnAt, offset) };
    case 'spawn':
      return { ...event, at, protectedUntil: hostTimeToGuest(event.protectedUntil, offset) };
    case 'match-phase':
      return { ...event, at, endsAt: hostTimeToGuest(event.endsAt, offset) };
    case 'grenade-armed':
      return { ...event, at, detonatesAt: optionalHostTime(event.detonatesAt, offset) };
    case 'grenade-thrown':
      return { ...event, at, detonatesAt: hostTimeToGuest(event.detonatesAt, offset) };
    case 'smoke-volume':
      return {
        ...event,
        at,
        bornAt: hostTimeToGuest(event.bornAt, offset),
        diesAt: hostTimeToGuest(event.diesAt, offset),
      };
    case 'drop-spawned':
      return { ...event, at, diesAt: hostTimeToGuest(event.diesAt, offset) };
    case 'drop-changed':
      return { ...event, at, diesAt: hostTimeToGuest(event.diesAt, offset) };
    default:
      return { ...event, at };
  }
}

/** Localize a match snapshot while preserving the absolute endpoint delta. */
export function localizeMatchState(message: MatchStateMsg, offset: number): MatchStateMsg {
  return {
    ...message,
    at: hostTimeToGuest(message.at, offset),
    endsAt: message.endsAt === null ? null : hostTimeToGuest(message.endsAt, offset),
  };
}

/** Localize the level timestamp and its optional edge event together. */
export function localizeStreakState(message: StreakStateMsg, offset: number): StreakStateMsg {
  return {
    ...message,
    at: hostTimeToGuest(message.at, offset),
    cause: message.cause === null ? null : localizeGameEvent(message.cause, offset) as StreakStateMsg['cause'],
  };
}

/**
 * The sole receive-side conversion for gameplay messages. Keeping message
 * routing here prevents a future event case from accidentally bypassing the
 * clock boundary or converting a message twice in the driver.
 */
export function localizeGameMessage(message: GameNetMessage, offset: number): GameNetMessage {
  switch (message.type) {
    case 'damage':
      return { ...message, e: localizeEvent(message.e, offset) };
    case 'spawn':
      return { ...message, e: localizeEvent(message.e, offset) };
    case 'shot-reject':
      return { ...message, e: localizeEvent(message.e, offset) };
    case 'kill':
      return {
        ...message,
        kill: message.kill === null ? null : localizeEvent(message.kill, offset),
        death: localizeEvent(message.death, offset),
      };
    case 'ordnance':
      return { ...message, e: localizeEvent(message.e, offset) };
    case 'match-state':
      return localizeMatchState(message, offset);
    case 'streak-state':
      return localizeStreakState(message, offset);
    default:
      // Guest-authored messages are not delivered through GuestClient.onGame.
      // Keeping them unchanged makes this helper total without inventing a
      // second clock domain for input claims.
      return message;
  }
}
