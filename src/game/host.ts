/**
 * Authoritative match coordinator. Only this composed module writes health,
 * score, equipment, shot admission and streak rewards. Position arrives from
 * the movement authority through updatePose; the host retains rewind samples.
 *
 * HostLife owns damage/death/spawn; HostOrdnance owns grenades and equipment;
 * HostFirearms owns cadence, pellets, rails, flames and flares; HostCrossbow
 * owns explosive bolts. Every admitted outcome is published through GameEvent.
 * Scene, DOM and local controller prediction never write authoritative damage.
 */

export * from './host-ports';
export * from './host-streaks';

import { isPlayableWeapon } from '../weapons/roster';
import { isRewardWeapon } from '../weapons/catalog';
import type { RewardReadout } from './host-kit';
import type { WeaponIntent, WeaponIntentResult, WeaponState } from './host-weapon-state';
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
import { acceptShot, admitShot } from './host-shot';
import { HostOrdnance } from './host-ordnance';
import { HostFirearms } from './host-firearms';
import { CROSSBOW_ID, HostCrossbow } from './host-crossbow';
import { isOrdnanceId, TACTICAL_IDS } from './ordnance';
import { PRIMARY_IDS, SIDEARM_IDS, sidearmForPrimary, type Loadout } from './loadout';
import type { StreakLoadout } from './killstreaks/catalog';
import { fieldRepairHealth } from './killstreaks/effects/rewards';
import { normalizeStance, type PlayerStance } from '../net/room-core';

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
  private readonly firearms: HostFirearms;
  /** Canary bolts in flight. Composed like `ordnance`; never published. */
  private readonly crossbow: HostCrossbow;
  /** Admit the gated crossbow id as live bolts. False by default (still gated). */
  private readonly crossbowCanary: boolean;
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
    this.firearms = new HostFirearms(this.life, this.world, this.ordnance, this.clock, this.deps.streaks);
    this.crossbowCanary = opts.crossbowCanary === true;
    this.crossbow = new HostCrossbow(this.life, this.world, this.clock);
  }

  /** Admit an actor and deploy it. Re-adding a live id only moves its team.
   *  `primaryId` is the weapon it carries, so a corpse that never fired still
   *  drops the right gun; absent, the host assumes the default kit's. */
  addActor(id: ActorId, team: TeamId, opts: { bot?: boolean; primaryId?: string; loadout?: Loadout; streakLoadout?: StreakLoadout } = {}): void {
    this.life.ledger = withActor(this.life.ledger, id, team);
    const existing = this.life.actors.get(id);
    if (existing) {
      existing.team = team;
      return;
    }
    const a = this.life.newActor(id, team, opts.bot === true, this.clock);
    const primary = opts.loadout?.primary ?? opts.primaryId;
    a.primaryHint = primary !== undefined && PRIMARY_IDS.includes(primary) ? primary : null;
    a.sidearmHint = opts.loadout && SIDEARM_IDS.includes(opts.loadout.sidearm)
      ? opts.loadout.sidearm : sidearmForPrimary(a.primaryHint ?? 'longhorn');
    const tactical = opts.loadout?.grenade;
    a.tacticalHint = tactical && TACTICAL_IDS.includes(tactical) ? tactical : TACTICAL_IDS[0];
    this.life.actors.set(id, a);
    this.deps.streaks?.registerActor(id, team, opts.streakLoadout);
    this.life.deploy(a, this.clock, 'initial');
  }

  /** Disconnect. The scoreboard row and any queued respawn leave with the seat. */
  removeActor(id: ActorId): void {
    if (!this.life.actors.delete(id)) return;
    this.life.ledger = withoutActor(this.life.ledger, id);
    this.life.respawns = { queue: this.life.respawns.queue.filter((e) => e.actorId !== id) };
    this.ordnance.forget(id);
    this.crossbow.forget(id);
    this.firearms.forget(id);
    this.life.push(this.deps.streaks?.recordDisconnect(id, this.clock));
  }

  /** Position, from `net/room.ts` which owns it — and the shot-rewind history.
   *  Without a call every tick, `bad-origin` refuses every claim: a loud failure,
   *  in preference to an unrewound hit test nobody notices. */
  updatePose(
    id: ActorId, x: number, y: number, z: number, at: number = this.clock,
    stance: PlayerStance = 'stand', yaw?: number,
  ): void {
    const actor = this.life.actors.get(id);
    if (actor === undefined) return;
    actor.stance = stance;
    actor.poses.push(at, x, y, z, stance, yaw ?? actor.yaw);
  }

  /** Refresh the authored primary for the next deploy without rewriting the current kit. */
  setPrimary(id: ActorId, primaryId: string | undefined): void {
    const a = this.life.actors.get(id);
    if (a === undefined || primaryId === undefined || !PRIMARY_IDS.includes(primaryId)) return;
    a.primaryHint = primaryId;
  }

  /** Authored next-life kit; current held weapons and ammo remain untouched. */
  setLoadout(id: ActorId, loadout: Loadout): void {
    const a = this.life.actors.get(id);
    if (!a || !PRIMARY_IDS.includes(loadout.primary) || !SIDEARM_IDS.includes(loadout.sidearm)) return;
    a.primaryHint = loadout.primary;
    a.sidearmHint = loadout.sidearm;
    a.tacticalHint = TACTICAL_IDS.includes(loadout.grenade) ? loadout.grenade : TACTICAL_IDS[0];
  }

  /** Aim and buttons. Position is deliberately absent from `InputMsg`. */
  submitInput(id: ActorId, msg: InputMsg): void {
    const a = this.life.actors.get(id);
    if (!a || msg.seq <= a.ack) return;
    a.ack = msg.seq;
    if (Number.isFinite(msg.yaw)) a.yaw = msg.yaw;
    const stance = normalizeStance(msg.stance);
    if (stance !== null) a.stance = stance;
    // Input cannot rewrite the loadout admitted before Start.
  }

  /** Host stamps life/sequence/eligibility. Return the refusal as well as
   * emitting it, so bots can back off instead of re-pressing at tick rate. */
  submitStreakIntent(id: ActorId, msg: Pick<StreakIntentMsg, 'type' | 'slot' | 'toggle'>): StreakDenialReason | null {
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
    if (this.deps.streaks?.isPiloting?.(id)) this.ordnance.cancelWeapons(a, this.clock);
    for (const e of events) {
      if (e.type === 'streak-denied' && e.actorId === id) return e.reason;
    }
    return null;
  }

  submitWeaponIntent(id: ActorId, intent: WeaponIntent, receivedAt = this.clock): WeaponIntentResult {
    const a = this.life.actors.get(id);
    if (!a) return { accepted: false, reason: 'unknown-shooter' };
    return this.ordnance.weaponIntent(a, intent, receivedAt, this.match.phase === 'active', this.deps.streaks?.isPiloting?.(id) === true);
  }
  /** Trusted seat disconnect/resume boundary; ammunition and reload survive. */
  cancelWeaponCharge(id: ActorId, _now = this.clock): void {
    const a = this.life.actors.get(id);
    if (a) this.ordnance.cancelWeaponCharge(a);
  }
  weaponStateOf(id: ActorId, now = this.clock): WeaponState | null {
    const a = this.life.actors.get(id);
    if (!a) return null;
    if (this.deps.streaks?.isPiloting?.(id)) this.ordnance.cancelWeapons(a, now);
    return this.ordnance.weaponState(a, now);
  }

  /** Every weapon shares life, sequence, clock and muzzle admission before its own delivery path. */
  submitShot(shooterId: ActorId, claim: ShotMsg, receivedAt: number = this.clock): ShotAdmission {
    const a = this.life.actors.get(shooterId) ?? null;
    const ordnance = isOrdnanceId(claim.weaponId);
    const isCrossbow = claim.weaponId === CROSSBOW_ID;
    // Unknown/prototype claims fail closed before their delivery path.
    const reason = admitShot(claim, a === null ? null : {
      matchActive: this.match.phase === 'active', life: a.health.life, alive: a.health.alive,
      diedAt: a.health.diedAt,
      knownWeapon: ordnance || isPlayableWeapon(claim.weaponId) || isRewardWeapon(claim.weaponId) || (isCrossbow && this.crossbowCanary),
      window: a.window, pose: a.poses.at(claim.firedAt), receivedAt,
    }) ?? (this.deps.streaks?.isPiloting?.(shooterId) ? 'possessing' : null);
    if (reason !== null) {
      // Spend refused possession sequences so they cannot replay on exit.
      if (reason === 'possessing' && a) acceptShot(a.window, claim.seq);
      if (a && !ordnance && claim.life === a.health.life && reason !== 'malformed') this.ordnance.acknowledgeWeaponShot(a, claim.seq);
      this.life.stats = { ...this.life.stats, shotsRejected: this.life.stats.shotsRejected + 1 };
      this.life.emit({ type: 'shot-rejected', at: receivedAt, shooterId, seq: claim.seq, reason });
      return { accepted: false, reason, label: SHOT_REJECT_LABELS[reason] };
    }
    const shooter = a as HostActor;
    acceptShot(shooter.window, claim.seq);
    if (ordnance) return this.ordnance.claim(shooter, claim, receivedAt);
    this.ordnance.acknowledgeWeaponShot(shooter, claim.seq);
    const firearmRejection = this.firearms.admit(shooter, claim, receivedAt);
    if (firearmRejection !== null) {
      this.life.stats = { ...this.life.stats, shotsRejected: this.life.stats.shotsRejected + 1 };
      this.life.emit({ type: 'shot-rejected', at: receivedAt, shooterId, seq: claim.seq, reason: firearmRejection });
      return { accepted: false, reason: firearmRejection, label: SHOT_REJECT_LABELS[firearmRejection] };
    }
    // Publish accepted fire before hit resolution. Bolts then fly against
    // current poses; rejected claims produce no presentation edge.
    const muzzle = shooter.poses.at(claim.firedAt);
    if (muzzle !== null) {
      this.life.emit({
        type: 'shot-fired', at: receivedAt, actorId: shooter.id,
        life: claim.life, seq: claim.seq, weaponId: claim.weaponId,
        // The admitted claim's origin is validated against the rewound pose.
        // Pose y is the feet; using it falsely muffles shots against the ground.
        x: claim.ox, y: claim.oy, z: claim.oz,
      });
    }
    this.life.stats = { ...this.life.stats, shotsAdmitted: this.life.stats.shotsAdmitted + 1 };
    if (isCrossbow) {
      this.crossbow.launch(shooter, claim, receivedAt);
      return ADMITTED;
    }
    this.firearms.fire(shooter, claim, receivedAt);
    return ADMITTED;
  }

  /** TDM: different teams, unless friendly fire is on. FFA: anyone but yourself. */
  areHostile(a: { id: ActorId; team: TeamId }, b: { id: ActorId; team: TeamId }): boolean {
    return this.life.areHostile(a, b);
  }

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
    // Match identity changes only at transitions.
    if (this.match !== prev) {
      this.life.emit({
        type: 'match-phase', at: now, phase: this.match.phase, endsAt: this.match.endsAt,
        winner: this.match.winner, winnerId: this.match.winnerId, endReason: this.match.endReason,
      });
      if (this.match.phase === 'ended') {
        this.life.respawns = clearRespawns(this.life.respawns);
        this.life.push(this.deps.streaks?.endMatch(now));
        this.ordnance.endMatch(now);
        this.crossbow.endMatch(now);
        this.firearms.endMatch();
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

    for (const a of this.life.actors.values()) {
      a.health = regenStep(a.health, dtSeconds, now);
      if (this.deps.streaks?.isPiloting?.(a.id)) this.ordnance.cancelWeapons(a, now);
    }
    if (this.deps.streaks) {
      this.life.absorb(this.deps.streaks.advance(now, this.world, this.life.streakTargets(now)));
      for (const grant of this.deps.streaks.drainRewardGrants?.() ?? []) {
        const actor = this.life.actors.get(grant.actorId);
        if (grant.reward === 'field-repair' && actor?.health.alive && actor.team === grant.team) {
          actor.health = { ...actor.health, hp: fieldRepairHealth(actor.health.hp) };
        } else if (actor && this.match.phase === 'active') this.ordnance.grantReward(actor, grant, now);
      }
    }
    // Resolve firearm deaths before ordnance scans the queue for corpse drops.
    this.crossbow.advance(now);
    this.firearms.advance(now);
    this.ordnance.advance(now);

    const out = this.life.pending.slice();
    this.life.pending.length = 0;
    return out;
  }

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
        sidearmId: kit.sidearmId, sidearmRounds: kit.sidearmRounds, tacticalId: kit.tacticalId,
        speedMultiplier: kit.speedMultiplier, rewardWeaponId: kit.rewardWeaponId, rewardWeaponRemainingMs: kit.rewardWeaponRemainingMs,
        armed: kit.armed, blindUntil: kit.blindUntil, stance: a.stance,
        weaponState: this.ordnance.weaponState(a, this.clock),
      });
    }
    return { at: this.clock, match, actors, stats: this.life.stats, ordnance: this.ordnance.snapshot(), crossbow: this.crossbow.snapshot() };
  }

  /** The three optional `PlayerSample` fields, added to a sample `room.ts` authored. */
  stampSample(sample: PlayerSample): PlayerSample {
    const a = this.life.actors.get(sample.id);
    return a ? {
      ...sample, hp: a.health.hp, team: a.team, alive: a.health.alive, stance: a.stance,
      weaponId: this.ordnance.weaponState(a, this.clock).activeWeaponId,
    } : sample;
  }

  get matchState(): MatchState { return this.match; }

  /** The life epoch a claim from this actor must carry. `null` = no such actor.
   *  Exists so a shot claim can be stamped without building a whole snapshot. */
  lifeOf(id: ActorId): number | null {
    return this.life.actors.get(id)?.health.life ?? null;
  }

  /** The highest shot sequence admitted in this actor's current life. */
  shotSeqOf(id: ActorId): number | null {
    return this.life.actors.get(id)?.window.seqHigh ?? null;
  }

  /**
   * Current host-owned kit for a live resume; no spawn or ammo reset. `rounds`
   * retains its legacy total meaning; weaponState carries the exact split and timers.
   */
  loadoutOf(id: ActorId): RewardReadout & {
    primaryId: string; rounds: number; sidearmId: string; sidearmRounds: number;
    lethal: number; tactical: number; tacticalId: string; armed: string | null;
    weaponState: WeaponState;
  } | null {
    const actor = this.life.actors.get(id);
    if (actor === undefined) return null;
    const kit = this.ordnance.kitOf(actor, this.clock);
    return {
      primaryId: kit.primaryId, rounds: kit.rounds,
      sidearmId: kit.sidearmId, sidearmRounds: kit.sidearmRounds,
      lethal: kit.lethal, tactical: kit.tactical,
      tacticalId: kit.tacticalId,
      armed: kit.armed,
      weaponState: this.ordnance.weaponState(actor, this.clock),
      speedMultiplier: kit.speedMultiplier, rewardWeaponId: kit.rewardWeaponId, rewardWeaponRemainingMs: kit.rewardWeaponRemainingMs,
    };
  }
}
