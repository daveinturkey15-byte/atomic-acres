/**
 * Nuketown 2025 — the streak boundary, as the host needs it.
 *
 * THE THIRD FILE OF THE HOST MODULE (`host.ts` / `host-ports.ts` / this), split
 * for the AGENTS.md 400-line cap and re-exported from `host.ts`, so the import
 * target stays `./host`.
 *
 * ## Why the port is wider than lane A first declared it
 *
 * Lane A wrote `StreakRuntimePort` against IMPORT-PLAN §2's method list while
 * lane C was being written in parallel. When both landed, two of the eight
 * methods did not fit, and the mismatch was real rather than cosmetic:
 *
 *  - `activate` needs the exactly-once material — life epoch, monotonic
 *    sequence and a unique claim id — because the whole point of lane C's
 *    admission is that a claim asserting its own eligibility is refused. A
 *    three-field `{actorId, slot, toggle}` intent cannot carry any of it, so
 *    an adapter would have had to invent the fields by reaching back into the
 *    host: the callback bag §5.3 forbids. Widening the port instead keeps the
 *    data flowing one way.
 *  - `advance` needs the host's own actor table with CURRENT health, or the
 *    sentry runs, aims, expires and never fires. It is the host's number, so
 *    the host passes it.
 *
 * ## What the host still refuses to know
 *
 * The port is structural. `host.ts` imports no value from
 * `game/killstreaks/**`; the only thing that crosses is the `StreakTarget`
 * TYPE, imported from lane C rather than re-spelled here, because a second
 * copy of a seven-field shape is the stale mirror §5.5 is about. The adapter
 * that makes a `StreakRuntime` satisfy this port lives in `game/session.ts`,
 * which is where the two lanes are actually wired together.
 */

import type { ActorId, DamageEvent, GameEvent, MatchPhaseName, TeamId, Vec3, WorldQuery } from './events';
import type { StreakSlotState } from '../net/protocol';
import type { StreakTarget } from './killstreaks/runtime';

/** Lane C's sentry target shape, re-exported under the host's own name. */
export type StreakTargetView = StreakTarget;

/**
 * A press, with everything only the host can supply. `claimId` is minted from
 * `(actorId, life, seq)`; see `streakClaimId` for what that does and does not
 * protect against.
 */
export interface StreakPress {
  readonly actorId: ActorId;
  /** 1-based, as printed on the key. */
  readonly slot: number;
  readonly toggle: boolean;
  readonly life: number;
  readonly seq: number;
  readonly claimId: string;
  readonly alive: boolean;
  /** The real phase, not a boolean: lane C's gate refuses `warmup` and `ended`
   *  with the same reason but a caller collapsing them loses the truth. */
  readonly matchPhase: MatchPhaseName;
  /** The presser's own position; also the fallback placement for a point streak. */
  readonly origin: Vec3;
  readonly aimYaw: number;
  /** An explicit placement, when a targeting surface produced one. */
  readonly anchor: Vec3 | null;
}

/**
 * `game/killstreaks/runtime.ts`, as the host needs it. Optional on `HostDeps`:
 * with no runtime a press is refused with `arena-unsupported` and a label,
 * never swallowed (§5.4).
 */
export interface StreakRuntimePort {
  registerActor(actorId: ActorId, team: TeamId): void;
  /** Called only for a kill the scoreboard CREDITED — never for a team kill. */
  recordElimination(actorId: ActorId, streak: number, now: number): GameEvent[];
  recordDeath(actorId: ActorId, now: number): GameEvent[];
  recordDisconnect(actorId: ActorId, now: number): GameEvent[];
  activate(press: StreakPress, now: number, world: WorldQuery): GameEvent[];
  advance(now: number, world: WorldQuery, targets: readonly StreakTargetView[]): GameEvent[];
  endMatch(now: number): GameEvent[];
  snapshotFor(actorId: ActorId): StreakSlotState[];
}

/**
 * The exactly-once key, minted host-side.
 *
 * STATED PLAINLY, because it is weaker than it looks: `net/protocol.ts`'s
 * `StreakIntentMsg` carries only `{slot, toggle}`, so a duplicated WIRE
 * message becomes two distinct host-stamped claims and would activate twice.
 * What this key does protect is the host's own path — a press processed twice
 * inside one host, and a claim replayed across a life or a match. Closing the
 * wire hole needs a `seq` on `StreakIntentMsg`, which is Wave 0's frozen file
 * and not this lane's to change. Reported, not patched over.
 */
export function streakClaimId(actorId: ActorId, life: number, seq: number): string {
  // `^[A-Za-z0-9_:-]{4,80}$` is lane C's admission pattern; an id with any
  // other character is refused as `malformed-claim`, so sanitise rather than
  // let a punctuated actor id read as a forgery.
  const safe = actorId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48) || 'actor';
  return safe + ':' + life + ':' + seq;
}

/** The refusal a press gets when no streak runtime is attached at all. */
export function streakUnsupported(press: StreakPress, at: number): GameEvent[] {
  return [{
    type: 'streak-denied',
    at,
    actorId: press.actorId,
    streakId: '',
    slot: press.slot,
    reason: 'arena-unsupported',
  }];
}

/**
 * Split what a streak effect returned into damage the host must WRITE DOWN and
 * everything else, which it only forwards.
 *
 * The sentry is the one effect that can author a `DamageEvent`. It computed
 * the number against the health the host handed it, but the host still has to
 * apply it: without this the turret would shoot for ever, the feed would fill
 * with hits and nobody would ever die — a whole subsystem that looks alive in
 * the log and does nothing in the match.
 */
export function splitStreakEvents(
  events: readonly GameEvent[],
): { readonly damage: readonly DamageEvent[]; readonly rest: readonly GameEvent[] } {
  const damage: DamageEvent[] = [];
  const rest: GameEvent[] = [];
  for (const e of events) {
    if (e.type === 'damage') damage.push(e);
    else rest.push(e);
  }
  return { damage, rest };
}
