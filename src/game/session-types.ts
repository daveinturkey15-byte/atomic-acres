/**
 * Nuketown 2025 — the shapes a match driver and the session facade share.
 *
 * TYPES ONLY, no runtime value. Split out when `session.ts` grew a second and
 * third driver (solo / room host / room guest): the facade in `session.ts`,
 * the solo driver in `session-solo.ts` and the two room drivers under
 * `src/net/` all implement or consume these, and a types-only leaf is the one
 * place they can meet without a cycle.
 *
 * `MatchDriver` is exactly the per-frame surface `main.ts` already used off
 * `LocalMatch` — tick, shots, streak presses, bodies, snapshot, log, counters.
 * The facade adds menu verbs (configure / begin / leave / rematch) and the
 * room verbs on top; a driver never sees a menu.
 */

import type { MatchStateMsg } from '../net/protocol';
import type { PlayerStance } from '../net/room-core';
import type { ShotClaim } from '../weapons/controller';
import type { GameClient } from './client';
import type { ActorId, GameEvent, TeamId } from './events';
import type { HostStats } from './host-ports';

/**
 * What a QA hook reads off a match. A host driver returns its full
 * `HostSnapshot` (structurally a superset); a guest, which holds no
 * authority, projects one from the wire. Only the fields the harnesses read
 * are promised here, so the host's snapshot can grow without this changing.
 */
export interface SessionActor {
  readonly id: ActorId;
  readonly team: TeamId;
  readonly bot: boolean;
  readonly hp: number;
  readonly alive: boolean;
  readonly kills: number;
  readonly deaths: number;
  readonly score: number;
}

export interface SessionSnapshot {
  readonly at: number;
  readonly match: MatchStateMsg;
  readonly actors: readonly SessionActor[];
  readonly stats: HostStats;
  /**
   * Canary bolt projection, when the driver holds one. Host drivers return
   * the authoritative pool (live + cumulative counts); guests project what
   * the wire delivered. Absent means no canary projection — never a silent
   * zero claimed as authority. Honest partial, not a complete picture.
   */
  readonly crossbow?: { readonly live: number; readonly counts: Readonly<Record<string, number>> };
}

/** The UI lane's handle, narrowed to what a match needs from it. */
export interface MatchUi {
  bindClient(client: GameClient | null): void;
  setNames(names: Iterable<readonly [string, string]>): void;
  /** Optional raw admitted-event tap for presentation-only feedback lanes. */
  onEvent?(e: GameEvent): void;
  /** Clear presentation state when a driver creates a new match epoch. */
  resetPresentation?(): void;
}

/**
 * One body `main.ts` must draw: a bot, or a remote human. The name is
 * historical — `main.ts` iterates `match.bots()` and spawns one `characters/`
 * rig per id, and a remote player is drawn by exactly that loop, off exactly
 * that rig (AGENTS.md: one character path for players, bots and corpses).
 */
export interface BotBody {
  readonly id: ActorId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly alive: boolean;
  /** Host-authoritative pose stance; old snapshots and bots default to stand. */
  readonly stance?: PlayerStance;
  /**
   * The actor's host-authoritative current primary (`host-kit.ts` estimate),
   * or undefined when this driver cannot know it (a guest projection without
   * the field). `main.ts` spawns the figure with it and re-dresses the figure
   * through `CharacterSystem.rearm` whenever it changes; undefined keeps the
   * default rifle and never swaps.
   */
  readonly weaponId?: string;
}

/** Everything the frame loop needs from whichever match is live. */
export interface MatchDriver {
  /** One frame. `now` is `performance.now()`; drivers tick at `TICK_HZ`. */
  tick(now: number, x: number, y: number, z: number, yaw: number, pitch: number, stance?: PlayerStance): void;
  /** A trigger pull from `weapons/controller.ts`, stamped and submitted or sent. */
  localShot(claim: ShotClaim): void;
  /** A streak key press from the human. */
  pressStreak(slot: number): void;
  bots(): readonly BotBody[];
  /** The authoritative snapshot (host drivers) or the guest's projection of it. */
  snapshot(): SessionSnapshot;
  log(): readonly string[];
  counters(): Record<string, number>;
  /** True from the `ended` phase until the next match is built. */
  ended(): boolean;
  /** Start the next match now instead of after the hold. Guests: no-op. */
  rematchNow(): void;
  /** One line for the netcode overlay; null when there is no wire. */
  netLine(now: number): string | null;
  readonly localId: ActorId;
  dispose(): void;
}
