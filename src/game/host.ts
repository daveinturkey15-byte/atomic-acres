/**
 * Nuketown 2025 — THE ONLY WRITER.
 *
 * Health, score, kills, deaths, streak charges, spawn choice, match phase and
 * the RNG seed are written here and nowhere else (IMPORT-PLAN §2). Everything
 * else in `src/game/` is a pure function this file calls, or a consumer of the
 * events it emits. A guest that writes a score is a bug, not an optimisation.
 *
 * DOM-free and scene-free. The world arrives through the injected `WorldQuery`
 * port and nothing else. `HostDeps` is not a callback bag (§5.3): every member
 * is a pure function or an event-answering state machine, and none of them
 * calls back into the host.
 *
 * It owns none of the arithmetic it orchestrates. The damage number is
 * `damage.ts`'s, the health transition `health.ts`'s, the spawn point
 * `spawns.ts`'s, the queue `respawn.ts`'s, the score `scoring.ts`'s and the
 * phase `match.ts`'s. This file decides WHEN, and writes the result down —
 * the whole difference from the old project's `applyDamage`, which did all of
 * that plus audio, rumble, camera trauma and pointer lock in one ~100-line
 * function (§5.2).
 *
 * POSITION is NOT owned here. `net/room.ts` integrates movement; this host is
 * TOLD (`updatePose`) and keeps a bounded history so a shot resolves against
 * where everyone was when the trigger went down. `snapshot()` therefore
 * carries no coordinates, and `stampSample()` adds `hp`/`team`/`alive` to a
 * sample `room.ts` authored — which is why those three fields are optional on
 * `PlayerSample`.
 *
 * FOUR FILES, ONE MODULE (the 400-line cap). `./host-ports` holds every shape
 * that crosses the boundary; `./host-shot` holds shot admission and hit
 * geometry, with the eight admission rules in its header; `./host-life` holds
 * damage, death and redeployment — composed, not inherited, and owning the
 * state those three write; `./host-streaks` holds the streak boundary the
 * integration lane widened against lane C's real runtime. The two that are
 * PUBLIC SHAPE — ports and the streak boundary — are re-exported here; import
 * them from THIS file.
 *
 * `HostLife` is deliberately NOT re-exported. It is the authoritative mutator:
 * it writes health, the score ledger and the respawn queue directly, with none
 * of the ordering `GameHost` puts around them. `GameHost` is its only
 * constructor and `life` is private, so publishing it bought nothing and cost
 * the one guarantee IMPORT-PLAN §2 asks for — that authoritative state has one
 * writer. The split is a file-size split, not an API. */

export * from './host-ports';
export * from './host-streaks';

import { WEAPONS, type WeaponDef } from '../weapons/catalog';
import {
  SHOT_REJECT_LABELS,
  type ActorId, type GameEvent, type StreakDenialReason, type TeamId, type WorldQuery,
} from './events';
import type { InputMsg, MatchStateMsg, PlayerSample, ShotMsg, StreakIntentMsg } from '../net/protocol';
import type { ActorSnapshot, HostDeps, HostOptions, HostSnapshot, ShotAdmission } from './host-ports';
import { HostLife, type HostActor } from './host-life';
import { streakClaimId, streakUnsupported } from './host-streaks';
import { DEFAULT_RULES, type MatchRules } from './rules';
import { advanceFfa, advanceMatch, createMatch, endsAtForWire, type MatchState } from './match';
import { leaderboard, teamTotals, withActor, withoutActor } from './scoring';
import { regenStep } from './health';
import { clearRespawns, dueRespawns } from './respawn';
import { acceptShot, admitShot, pickTarget, type TargetCandidate } from './host-shot';
import { HostOrdnance } from './host-ordnance';
import { isOrdnanceId } from './ordnance';

/** id → definition, DERIVED from the authored list (§5.5). */
const WEAPON_BY_ID: ReadonlyMap<string, WeaponDef> = new Map(WEAPONS.map((w) => [w.id, w]));

/** The one shape of "yes". A refusal always carries its reason and label. */
const ADMITTED: ShotAdmission = Object.freeze({ accepted: true, reason: null, label: null });

/** mulberry32. Small, seeded, and NOT `Math.random` — the world is deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GameHost {
  private readonly world: WorldQuery;
  private readonly deps: HostDeps;
  /** Damage, death, redeployment — and the state those three write. */
  private readonly life: HostLife;
  /** Grenades, smoke, flash, the knife, drops. Composed like `life`; never published. */
  private readonly ordnance: HostOrdnance;
  private match: MatchState;
  private clock: number;
  private lastTick: number;
  /** The one RNG. Public so `game/bots.ts` and streak effects share the seed. */
  readonly rand: () => number;
  readonly rules: MatchRules;

  constructor(opts: HostOptions) {
    this.world = opts.world;
    this.deps = opts.deps ?? {};
    this.rules = opts.rules ?? DEFAULT_RULES;
    this.clock = opts.now ?? 0;
    this.lastTick = this.clock;
    this.rand = mulberry32(opts.seed ?? 0x4e554b45);
    this.match = createMatch(this.clock, this.rules);
    this.life = new HostLife({
      world: this.world, deps: this.deps, rules: this.rules, bus: opts.bus ?? null,
    });
    this.life.phase = this.match.phase;
    this.ordnance = new HostOrdnance(this.life, this.world, this.clock);
  }

  // ---- Roster ----------------------------------------

  /** Admit an actor and deploy it. Re-adding a live id only moves its team.
   *  `primaryId` is the weapon it carries, so a corpse that never fired still
   *  drops the right gun; absent, the host assumes the default kit's. */
  addActor(id: ActorId, team: TeamId, opts: { bot?: boolean; primaryId?: string } = {}): void {
    this.life.ledger = withActor(this.life.ledger, id, team);
    const existing = this.life.actors.get(id);
    if (existing) {
      existing.team = team;
      return;
    }
    const a = this.life.newActor(id, team, opts.bot === true, this.clock);
    a.primaryHint = opts.primaryId ?? null;
    this.life.actors.set(id, a);
    this.deps.streaks?.registerActor(id, team);
    this.life.deploy(a, this.clock, 'initial');
  }

  /** Disconnect. The scoreboard row and any queued respawn leave with the seat. */
  removeActor(id: ActorId): void {
    if (!this.life.actors.delete(id)) return;
    this.life.ledger = withoutActor(this.life.ledger, id);
    this.life.respawns = { queue: this.life.respawns.queue.filter((e) => e.actorId !== id) };
    this.ordnance.forget(id);
    this.life.push(this.deps.streaks?.recordDisconnect(id, this.clock));
  }

  /** Position, from `net/room.ts` which owns it — and the shot-rewind history.
   *  Without a call every tick, `bad-origin` refuses every claim: a loud failure,
   *  in preference to an unrewound hit test nobody notices. */
  updatePose(id: ActorId, x: number, y: number, z: number, at: number = this.clock): void {
    this.life.actors.get(id)?.poses.push(at, x, y, z);
  }

  /** Aim and buttons. Position is deliberately absent from `InputMsg`. */
  submitInput(id: ActorId, msg: InputMsg): void {
    const a = this.life.actors.get(id);
    if (!a || msg.seq <= a.ack) return;
    a.ack = msg.seq;
    if (Number.isFinite(msg.yaw)) a.yaw = msg.yaw;
  }

  /**
   * A streak press. The host supplies everything only it can know — the life
   * epoch, the monotonic sequence, the claim id, whether the presser is alive
   * and whether the match is running — because a claim that asserts its own
   * eligibility is the forgery lane C's admission exists to refuse.
   *
   * RETURNS THE REFUSAL, or null when the press was admitted. The events are
   * still emitted; this is the answer the PRESSER gets, and an automated
   * presser needs it. `game/bots.ts` backs off on a refusal instead of
   * re-pressing the same slot at the tick rate — without a return value its
   * only way to learn it had been refused was the event bus it does not read,
   * so it re-pressed at 20 Hz and filled the feed (§5.4 in reverse: a refusal
   * nobody can hear is as bad as one nobody is given).
   */
  submitStreakIntent(id: ActorId, msg: StreakIntentMsg): StreakDenialReason | null {
    const a = this.life.actors.get(id);
    if (!a) return null;
    const p = a.poses.at(this.clock);
    const press = {
      actorId: id, slot: msg.slot, toggle: msg.toggle === true,
      life: a.health.life, seq: ++a.streakSeq,
      claimId: streakClaimId(id, a.health.life, a.streakSeq),
      alive: a.health.alive, matchPhase: this.match.phase,
      origin: p === null ? { x: 0, y: 0, z: 0 } : { x: p.x, y: p.y, z: p.z },
      aimYaw: a.yaw, anchor: null,
    };
    // §5.4: a player-initiated action never fails silently, not even when the
    // lane that would satisfy it is absent.
    const streaks = this.deps.streaks;
    const events = streaks === undefined
      ? streakUnsupported(press, this.clock)
      : streaks.activate(press, this.clock, this.world);
    this.life.absorb(events);
    for (const e of events) {
      if (e.type === 'streak-denied' && e.actorId === id) return e.reason;
    }
    return null;
  }

  // ---- Shots ----------------------------------------

  /**
   * A claim. A bullet, or — when `weaponId` names ordnance (a grenade id,
   * `knife`, `pickup`) — a throw, a swing or a pickup reach. Every kind passes
   * the same eight rules and the same exactly-once window first; only the
   * resolution differs, and the ordnance kinds are routed to `HostOrdnance`
   * instead of the hit test. One claim shape on the wire, one admission.
   */
  submitShot(shooterId: ActorId, claim: ShotMsg, receivedAt: number = this.clock): ShotAdmission {
    const a = this.life.actors.get(shooterId) ?? null;
    const ordnance = isOrdnanceId(claim.weaponId);
    const reason = admitShot(claim, a === null ? null : {
      matchActive: this.match.phase === 'active', life: a.health.life, alive: a.health.alive,
      diedAt: a.health.diedAt, knownWeapon: ordnance || WEAPON_BY_ID.has(claim.weaponId),
      window: a.window, pose: a.poses.at(claim.firedAt), receivedAt,
    });
    if (reason !== null) {
      this.life.stats = { ...this.life.stats, shotsRejected: this.life.stats.shotsRejected + 1 };
      this.life.emit({ type: 'shot-rejected', at: receivedAt, shooterId, seq: claim.seq, reason });
      return { accepted: false, reason, label: SHOT_REJECT_LABELS[reason] };
    }
    const shooter = a as HostActor;
    acceptShot(shooter.window, claim.seq);
    if (ordnance) return this.ordnance.claim(shooter, claim, receivedAt);
    this.life.stats = { ...this.life.stats, shotsAdmitted: this.life.stats.shotsAdmitted + 1 };
    this.ordnance.noteShot(shooter, claim.weaponId);

    const candidates: TargetCandidate[] = [];
    for (const v of this.life.actors.values()) {
      if (v === shooter || !v.health.alive) continue;
      const pose = v.poses.at(claim.firedAt);
      if (pose !== null) candidates.push({ id: v.id, pose });
    }
    // Geometry last: the actor sweep is the cheap test that can refuse, and
    // `lineOfSight` is the expensive one. A wall between them is a miss.
    const hit = pickTarget(claim, candidates);
    const victim = hit === null ? undefined : this.life.actors.get(hit.id);
    if (hit !== null && victim !== undefined &&
        this.world.lineOfSight({ x: claim.ox, y: claim.oy, z: claim.oz }, { x: hit.x, y: hit.y, z: hit.z })) {
      this.life.hit(victim, shooter, hit.zone, hit.distance, claim.weaponId, 'bullet', receivedAt, claim.ox, claim.oz);
    }
    return ADMITTED;
  }

  /** TDM: different teams, unless friendly fire is on. FFA: anyone but yourself. */
  areHostile(a: { id: ActorId; team: TeamId }, b: { id: ActorId; team: TeamId }): boolean {
    return this.life.areHostile(a, b);
  }

  // ---- Tick ----------------------------------------

  /** Advances the match, redeploys the due, regenerates health, drains events. */
  tick(now: number): GameEvent[] {
    const dtSeconds = Math.max(0, now - this.lastTick) / 1000;
    this.clock = now;
    this.lastTick = now;

    const prev = this.match;
    this.match =
      this.rules.mode === 'ffa'
        ? advanceFfa(prev, now, leaderboard(this.life.ledger), this.rules)
        : advanceMatch(prev, now, teamTotals(this.life.ledger), this.rules);
    this.life.phase = this.match.phase;
    // Identity is the change signal: `match.ts` returns the same object when
    // nothing moved, so this emits once per transition and never per tick.
    if (this.match !== prev) {
      this.life.emit({
        type: 'match-phase', at: now, phase: this.match.phase, endsAt: this.match.endsAt,
        winner: this.match.winner, winnerId: this.match.winnerId, endReason: this.match.endReason,
      });
      if (this.match.phase === 'ended') {
        this.life.respawns = clearRespawns(this.life.respawns);
        this.life.push(this.deps.streaks?.endMatch(now));
        this.ordnance.endMatch(now);
      }
    }

    const due = dueRespawns(this.life.respawns, now);
    if (due.state !== this.life.respawns) {
      this.life.respawns = due.state;
      for (const e of due.due) {
        const a = this.life.actors.get(e.actorId);
        if (a && !a.health.alive) this.life.deploy(a, now, 'respawn');
      }
    }

    for (const a of this.life.actors.values()) a.health = regenStep(a.health, dtSeconds, now);
    if (this.deps.streaks) {
      this.life.absorb(this.deps.streaks.advance(now, this.world, this.life.streakTargets(now)));
    }
    // Last, and before the drain: it reads this tick's deaths off `pending`
    // (a corpse drops its gun) and its own detonations land on the same queue.
    this.ordnance.advance(now);

    const out = this.life.pending.slice();
    this.life.pending.length = 0;
    return out;
  }

  // ---- Readouts ----------------------------------------

  snapshot(): HostSnapshot {
    const match: MatchStateMsg = {
      type: 'match-state', at: this.clock, mode: this.rules.mode, phase: this.match.phase,
      endsAt: endsAtForWire(this.match), scoreLimit: this.rules.scoreLimit,
      teamScores: teamTotals(this.life.ledger), scores: leaderboard(this.life.ledger),
      winner: this.match.winner, winnerId: this.match.winnerId, endReason: this.match.endReason,
    };
    const actors: ActorSnapshot[] = [];
    for (const a of this.life.actors.values()) {
      const e = this.life.ledger.get(a.id);
      const kit = this.ordnance.kitOf(a);
      actors.push({
        id: a.id, team: a.team, bot: a.bot, hp: a.health.hp, alive: a.health.alive,
        life: a.health.life, spawnIndex: a.spawnIndex, protectedUntil: a.health.invulnerableUntil,
        respawnAt: this.life.respawns.queue.find((r) => r.actorId === a.id)?.dueAt ?? null,
        kills: e?.kills ?? 0, deaths: e?.deaths ?? 0, score: e?.score ?? 0, streak: e?.streak ?? 0,
        slots: this.deps.streaks?.snapshotFor(a.id) ?? [],
        lethal: kit.lethal, tactical: kit.tactical, primaryId: kit.primaryId, rounds: kit.rounds,
        armed: kit.armed, blindUntil: kit.blindUntil,
      });
    }
    return { at: this.clock, match, actors, stats: this.life.stats, ordnance: this.ordnance.snapshot() };
  }

  /** The three optional `PlayerSample` fields, added to a sample `room.ts` authored. */
  stampSample(sample: PlayerSample): PlayerSample {
    const a = this.life.actors.get(sample.id);
    return a ? { ...sample, hp: a.health.hp, team: a.team, alive: a.health.alive } : sample;
  }

  get matchState(): MatchState { return this.match; }

  /** The life epoch a claim from this actor must carry. `null` = no such actor.
   *  Exists so a shot claim can be stamped without building a whole snapshot. */
  lifeOf(id: ActorId): number | null {
    return this.life.actors.get(id)?.health.life ?? null;
  }
}
