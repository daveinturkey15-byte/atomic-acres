/**
 * Nuketown 2025 — what happens to a body: damage, death, redeployment.
 *
 * SPLIT OUT OF `host.ts` BY THE INTEGRATION LANE, for the AGENTS.md 400-line
 * cap. Un-stubbing the host against lane C took that file to 472 lines, and
 * lane A had already nominated this exact seam in its handoff: *"host.ts is
 * exactly 400 lines, at the cap and not under it. The next feature in it
 * forces a split; the natural seam is deploy()+kill() into a host-life.ts."*
 * Not one line of the arithmetic moved changed; `GameHost` composes this and
 * the public surface is identical.
 *
 * ## Why this is composition and not a callback bag (§5.3)
 *
 * `HostLife` OWNS the state it writes — the actor table, the score ledger, the
 * respawn queue, the spawn memories, the counters and the outbound event
 * queue. `GameHost` reads those fields; nothing is injected back the other
 * way. There is no `emit` callback and no `onKill` hook: this object holds the
 * event array and the bus, and the host drains it. That is why `mutablePhase`
 * is a plain field rather than a `phase()` getter passed in — the phase is one
 * value the host writes, not a door back into the host.
 *
 * Everything IMPORT-PLAN §2 calls authoritative is still written in exactly
 * one place; that place is now two files in one module rather than one file
 * over the cap.
 */

import { EYE_HEIGHT } from '../core/layout';
import { WEAPONS, type WeaponDef } from '../weapons/catalog';
import type {
  ActorId, DamageCause, DamageEvent, GameBus, GameEvent, HitZone, MatchPhaseName,
  SpawnReason, TeamId, Vec3, WorldQuery,
} from './events';
import type { HostDeps, HostStats } from './host-ports';
import { splitStreakEvents, type StreakTargetView } from './host-streaks';
import type { MatchRules } from './rules';
import { applyDeath, applyKill, createLedger, streakOf, type Ledger } from './scoring';
import { resolveDamage as resolveDamageDefault } from './damage';
import { applyDamage as applyHealthDamage, createHealth, revive, type ActorHealth } from './health';
import { RECENT_USE_AVOIDANCE_MS, selectSpawn as selectSpawnDefault, type SpawnUse } from './spawns';
import { createRespawnState, invulnerableUntil, scheduleRespawn, type RespawnState } from './respawn';
import { PoseTrack, createShotWindow, type ShotWindow } from './host-shot';

/**
 * id → definition, DERIVED from the authored list (§5.5). A second roster
 * written out by hand would be a defect even while it agreed.
 */
const WEAPON_BY_ID: ReadonlyMap<string, WeaponDef> = new Map(WEAPONS.map((w) => [w.id, w]));

/** Retained for `spawns.ts`: death points for its map-trap penalty, uses for its
 *  recent-use avoidance. Both of its horizons are `RECENT_USE_AVOIDANCE_MS`. */
const RECENT_DEATHS = 8;
const RECENT_USES = 16;

export interface HostActor {
  id: ActorId; team: TeamId; bot: boolean;
  /** `health.ts` owns every field of this; the host only ever swaps the record. */
  health: ActorHealth;
  spawnIndex: number; yaw: number; ack: number;
  window: ShotWindow; poses: PoseTrack;
  /** Per-actor monotonic streak-press counter. Mints the exactly-once claim id. */
  streakSeq: number;
}

/** Read-only context. Four values, none of them a function into the caller. */
export interface LifeContext {
  readonly world: WorldQuery;
  readonly deps: HostDeps;
  readonly rules: MatchRules;
  readonly bus: GameBus | null;
}

export class HostLife {
  readonly actors = new Map<ActorId, HostActor>();
  /** Events since the last drain. `GameHost.tick` empties it and returns them. */
  readonly pending: GameEvent[] = [];
  ledger: Ledger = createLedger([]);
  respawns: RespawnState = createRespawnState();
  stats: HostStats = { shotsAdmitted: 0, shotsRejected: 0, hitsLanded: 0, hitsBlocked: 0 };
  /** The current match phase, written by `GameHost.tick`. Read by `kill`. */
  phase: MatchPhaseName = 'warmup';

  private readonly recentUses: SpawnUse[] = [];
  private readonly recentDeaths: { at: number; p: Vec3 }[] = [];

  constructor(private readonly ctx: LifeContext) {}

  newActor(id: ActorId, team: TeamId, bot: boolean, now: number): HostActor {
    return {
      id, team, bot, health: createHealth(now), spawnIndex: -1, yaw: 0, ack: -1,
      window: createShotWindow(), poses: new PoseTrack(), streakSeq: 0,
    };
  }

  emit(e: GameEvent): void {
    this.pending.push(e);
    this.ctx.bus?.emit(e);
  }

  /** Drain a lane's returned events onto the bus. `undefined` = that lane is absent. */
  push(events: readonly GameEvent[] | undefined): void {
    if (events !== undefined) for (const e of events) this.emit(e);
  }

  /**
   * Drain a STREAK lane's events, writing its damage down instead of only
   * forwarding it. A sentry's `DamageEvent` is a proposal computed against the
   * health this host handed it; `hit` re-checks spawn protection, re-stamps
   * `healthAfter` from the health record and runs the kill, so the host stays
   * the one owner of that number (§5.6). Forwarding it raw would fill the feed
   * with hits that never killed anybody, which is exactly how a subsystem
   * looks alive in the log and does nothing in the match.
   */
  absorb(events: readonly GameEvent[] | undefined): void {
    if (events === undefined) return;
    const { damage, rest } = splitStreakEvents(events);
    for (const e of rest) this.emit(e);
    for (const e of damage) this.applyStreakDamage(e);
  }

  private applyStreakDamage(e: DamageEvent): void {
    const victim = this.actors.get(e.victimId);
    if (victim === undefined || !victim.health.alive) return;
    const attacker = e.attackerId === null ? null : this.actors.get(e.attackerId) ?? null;
    this.hit(victim, attacker, e.zone, e.distance, e.weaponId, e.cause, e.at, e.sourceX, e.sourceZ, e.amount);
  }

  /** The host's actor table as the sentry needs it: CURRENT health, and a pose. */
  streakTargets(now: number): StreakTargetView[] {
    const out: StreakTargetView[] = [];
    for (const a of this.actors.values()) {
      const p = a.poses.at(now);
      if (p === null) continue;
      out.push({ id: a.id, team: a.team, alive: a.health.alive, health: a.health.hp, x: p.x, y: p.y, z: p.z });
    }
    return out;
  }

  /** TDM: different teams, unless friendly fire is on. FFA: anyone but yourself. */
  areHostile(a: { id: ActorId; team: TeamId }, b: { id: ActorId; team: TeamId }): boolean {
    if (a.id === b.id) return false;
    if (this.ctx.rules.mode === 'ffa') return true;
    return a.team !== b.team || this.ctx.rules.friendlyFire;
  }

  /**
   * The ONLY place health moves. Everything the old `applyDamage` also did is
   * a subscriber.
   *
   * `preResolved` is the streak path: `damage.ts:resolveDamage` requires a
   * `WeaponDef` and a sentry has none, so a streak arrives with its number
   * already computed and this method still writes it down, still checks spawn
   * protection and still runs the kill. One place health moves, two ways in.
   */
  hit(
    victim: HostActor, attacker: HostActor | null, zone: HitZone, distance: number,
    weaponId: string, cause: DamageCause, now: number, sourceX: number, sourceZ: number,
    preResolved?: number,
  ): void {
    const def = WEAPON_BY_ID.get(weaponId);
    if (def === undefined && preResolved === undefined) return;
    const hostile = attacker !== null && this.areHostile(attacker, victim);
    // `friendlyFire` here is the host's hostility verdict, not the rule: in FFA
    // two mutual enemies share a `TeamId` (it is `0 | 1`), so this is how the
    // host tells `damage.ts` to skip its own team comparison rather than
    // teaching that module the mode twice.
    const res = preResolved !== undefined
      ? (victim.health.invulnerableUntil > now
        ? { damage: 0, blocked: 'invulnerable' as const }
        : { damage: preResolved, blocked: undefined })
      : (this.ctx.deps.resolveDamage ?? resolveDamageDefault)({
        def: def as WeaponDef, distance, zone, cause,
        attackerTeam: attacker?.team ?? null, victimTeam: victim.team,
        victimInvulnUntil: victim.health.invulnerableUntil, now,
        friendlyFire: hostile || this.ctx.rules.friendlyFire,
        // The bot handicap applies to what a bot does TO A HUMAN, not to what
        // bots do to each other. `damage.ts:BOT_DAMAGE_MULTIPLIER` is 0.25, so
        // applying it bot-on-bot makes a longhorn body shot 8.5 and a bot
        // needs twelve of them to kill another bot. MEASURED before this line
        // existed: a 5-bot TDM produced 1 kill in 30 s of active match, which
        // is not a match. With it: see the lane proof. The handicap is a
        // fairness rule about the player, and the host is the only thing that
        // knows both ends of the exchange.
        attackerIsBot: attacker?.bot === true && !victim.bot,
      });
    const app = applyHealthDamage(victim.health, res.damage, now);
    if (res.blocked !== undefined || app.applied <= 0) {
      this.stats = { ...this.stats, hitsBlocked: this.stats.hitsBlocked + 1 };
      return;
    }
    this.stats = { ...this.stats, hitsLanded: this.stats.hitsLanded + 1 };
    victim.health = app.health;
    this.emit({
      type: 'damage', at: now, attackerId: attacker?.id ?? null, attackerTeam: attacker?.team ?? null,
      victimId: victim.id, victimTeam: victim.team, amount: app.applied, cause, zone, weaponId,
      distance, healthAfter: app.health.hp, sourceX, sourceZ,
    });
    if (app.died) this.kill(victim, attacker, zone, distance, weaponId, cause, now, !hostile);
  }

  private kill(
    victim: HostActor, killer: HostActor | null, zone: HitZone, distance: number,
    weaponId: string, cause: DamageCause, now: number, friendly: boolean,
  ): void {
    const streakLost = streakOf(this.ledger, victim.id);
    const credited = killer !== null && killer.id !== victim.id;
    const sched = scheduleRespawn(this.respawns, {
      actorId: victim.id, team: this.ctx.rules.mode === 'ffa' ? null : victim.team,
      diedAt: now, life: victim.health.life, phase: this.phase,
    });
    this.respawns = sched.state;
    const here = victim.poses.at(now);
    if (here !== null) {
      this.recentDeaths.push({ at: now, p: { x: here.x, y: here.y, z: here.z } });
      if (this.recentDeaths.length > RECENT_DEATHS) this.recentDeaths.shift();
    }

    if (credited) {
      this.ledger = applyKill(this.ledger, { killer: killer.id, victim: victim.id, zone, friendly });
      const killerStreak = streakOf(this.ledger, killer.id);
      this.emit({
        type: 'kill', at: now, killerId: killer.id, killerTeam: killer.team, victimId: victim.id,
        victimTeam: victim.team, weaponId, zone, cause, distance, killerStreak,
      });
      // A team kill earns nothing: the ladder advances only on a kill the
      // scoreboard credited, decided by the same flag `applyKill` used.
      if (!friendly) this.push(this.ctx.deps.streaks?.recordElimination(killer.id, killerStreak, now));
    }
    this.ledger = applyDeath(this.ledger, { victim: victim.id, killer: credited ? killer.id : null });
    this.emit({
      type: 'death', at: now, victimId: victim.id, victimTeam: victim.team,
      killerId: credited ? killer.id : null, cause, streakLost,
      respawnAt: sched.entry?.dueAt ?? null,
    });
    this.push(this.ctx.deps.streaks?.recordDeath(victim.id, now));
  }

  deploy(a: HostActor, now: number, reason: SpawnReason): void {
    const threats: Vec3[] = [];
    const occupants: Vec3[] = [];
    for (const o of this.actors.values()) {
      if (o === a || !o.health.alive) continue;
      const p = o.poses.at(now);
      if (p === null) continue;
      // Eye height, not feet: `selectSpawn` calls `lineOfSight` with these
      // points unchanged, and a foot position hides behind a kerb.
      const eye: Vec3 = { x: p.x, y: p.y + EYE_HEIGHT, z: p.z };
      occupants.push(eye);
      if (this.areHostile(o, a)) threats.push(eye);
    }
    const sel = (this.ctx.deps.selectSpawn ?? selectSpawnDefault)({
      mode: this.ctx.rules.mode, team: this.ctx.rules.mode === 'ffa' ? null : a.team,
      actorId: a.id, now, world: this.ctx.world, threats, occupants,
      recentDeaths: this.recentDeaths.filter((d) => now - d.at <= RECENT_USE_AVOIDANCE_MS).map((d) => d.p),
      recentUses: this.recentUses, previousIndex: a.spawnIndex, population: this.actors.size,
    });
    const at = sel.placement;
    const protect = invulnerableUntil(now, this.ctx.rules.mode);
    a.health = reason === 'initial' ? createHealth(now, protect) : revive(a.health, now, protect);
    a.spawnIndex = sel.index;
    a.yaw = at.yaw;
    // A new life is a new exactly-once window: seq numbering restarts with it,
    // and retaining the old one would refuse the first shots of this life.
    a.window = createShotWindow();
    a.poses.push(now, at.x, at.y, at.z);
    this.recentUses.push({ index: sel.index, at: now });
    if (this.recentUses.length > RECENT_USES) this.recentUses.shift();
    this.emit({
      type: 'spawn', at: now, actorId: a.id, team: a.team, x: at.x, y: at.y, z: at.z,
      yaw: at.yaw, spawnIndex: sel.index, protectedUntil: protect, reason,
    });
  }
}
