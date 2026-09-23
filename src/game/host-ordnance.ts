/**
 * Nuketown 2025 — ordnance authority: grenades in hand and in flight,
 * detonation, flash, smoke, the knife, and the drops a death leaves.
 *
 * Part of the host module (`host.ts` composes it, the way it composes
 * `HostLife`), split for the 400-line cap into this file, `host-kit.ts` (what
 * each actor carries) and `host-drops.ts` (the ground). `GameHost` is its only
 * constructor and `ordnance` is private there, so authoritative state still
 * has one writer.
 *
 * ## How claims arrive
 *
 * A throw, a swing and a pickup reach are `ShotMsg` claims whose `weaponId`
 * is an `ORDNANCE_IDS` member. `GameHost.submitShot` runs the SAME eight
 * admission rules on them (`host-shot.ts`: exactly-once window, life epoch,
 * pre-death trade, fire age, muzzle) and hands the admitted ones here. That
 * is deliberate: a replayed knife is refused `duplicate` by the same code
 * that refuses a replayed bullet, and a grenade authored after death is
 * `shooter-dead` for the same reason a bullet is.
 *
 * A grenade is TWO claims: the first with a grenade id ARMS it (pin out — a
 * frag's fuse starts here, which is the cook), the second with the same id
 * RELEASES it along the claim's direction. Holding it past the fuse detonates
 * it in the hand. Nothing in a claim says how long it was cooked; the host's
 * own clock does.
 *
 * ## What the world sees
 *
 * Every state change is an event: armed, thrown, detonated, flash-hit,
 * smoke-volume / smoke-volume-end (THE SMOKE CONTRACT — see `README.md`),
 * melee, drop-*, pickup, ordnance-inventory, ordnance-rejected. Damage is a
 * `DamageEvent` through `HostLife.hit`, so a grenade kill scores, feeds and
 * respawns exactly like a bullet kill. Bots go blind through the
 * `SightField` on the world, which `bot-sense.ts` reads.
 */

import { BOT_DAMAGE_MULTIPLIER } from './damage';
import type { ActorId, DeathEvent, OrdnanceAction, OrdnanceRejectReason, ShotRejectReason, TeamId, Vec3, WorldQuery } from './events';
import { ORDNANCE_REJECT_LABELS } from './events';
import type { ShotMsg } from '../net/protocol';
import { HostDrops, type DropSnapshot } from './host-drops';
import { KitLedger } from './host-kit';
import type { HostActor, HostLife } from './host-life';
import type { ShotAdmission } from './host-ports';
import {
  BLAST_LIFT_M, BLAST_TARGET_Y, FLASH_EYE_Y, GRENADE_BY_ID, KNIFE_DAMAGE, KNIFE_FACING_DOT, KNIFE_ID,
  KNIFE_REACH_M, KNIFE_RECOVERY_MS, PICKUP_ID, THROW_FORWARD_M, THROW_LIFT_MS, THROW_SPEED_MS,
  flashExposure, fragDamageAt, isGrenadeId, type GrenadeDef,
} from './ordnance';
import { launch, stepBallistic, type Ballistic } from './ordnance-physics';
import { SightField, sightOf } from './world-query';

/** Live grenades the pool holds. Eight actors, two charges each, is the ceiling. */
export const GRENADE_POOL = 32;
/** Longest step the host integrates a grenade over; a stalled host owes no tunnel. */
const MAX_STEP_S = 0.1;

interface LiveGrenade extends Ballistic {
  live: boolean;
  id: number;
  grenadeId: string;
  ownerId: ActorId;
  ownerTeam: TeamId;
  ownerBot: boolean;
  detonatesAt: number;
}

export interface OrdnanceSnapshot {
  readonly grenades: number;
  readonly smokes: number;
  readonly drops: readonly DropSnapshot[];
  readonly counts: Readonly<Record<string, number>>;
}

const ADMITTED: ShotAdmission = Object.freeze({ accepted: true, reason: null, label: null });

export class HostOrdnance {
  private readonly kits = new KitLedger();
  private readonly drops: HostDrops;
  private readonly sight: SightField;
  private readonly pool: LiveGrenade[] = [];
  private nextGrenadeId = 1;
  private nextSmokeId = 1;
  private lastAdvance: number;
  private readonly ended: number[] = [];
  readonly counts = { armed: 0, thrown: 0, detonated: 0, cookOffs: 0, blastHits: 0, flashed: 0, smokes: 0, melees: 0, meleeHits: 0, refused: 0 };
  // Scratch points for the two segment tests. Never escape this class.
  private readonly pA = { x: 0, y: 0, z: 0 };
  private readonly pB = { x: 0, y: 0, z: 0 };

  constructor(private readonly life: HostLife, private readonly world: WorldQuery, now: number) {
    // The field bots read lives on the world. A bare port (a harness that
    // built its own) gets a private one: the host is still correct, the bots
    // just cannot see the smoke.
    this.sight = sightOf(world) ?? new SightField();
    // A new host is a new match; the field belongs to the match, the world
    // object outlives it (`session-solo.ts` rebuilds the host on rematch).
    this.sight.clear();
    this.drops = new HostDrops(life, world, this.kits);
    this.lastAdvance = now;
    for (let i = 0; i < GRENADE_POOL; i++) {
      this.pool.push({
        live: false, id: 0, grenadeId: 'frag', ownerId: '', ownerTeam: 0, ownerBot: false, detonatesAt: 0,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, resting: true,
      });
    }
  }

  // ---- Claims ---------------------------------------------------------------

  /** An admitted claim with an ordnance id. The shot window has already accepted its seq. */
  claim(a: HostActor, msg: ShotMsg, now: number): ShotAdmission {
    if (isGrenadeId(msg.weaponId)) return this.grenadeClaim(a, msg, now);
    if (msg.weaponId === KNIFE_ID) return this.meleeClaim(a, msg, now);
    if (msg.weaponId === PICKUP_ID) return this.drops.claim(a, msg, now);
    return this.refuse(a, msg, 'arm', 'no-grenade', now);
  }

  /** An admitted BULLET: the kit's round estimate moves. */
  noteShot(a: HostActor, weaponId: string): void {
    this.kits.noteShot(a, weaponId);
  }

  private refuse(a: HostActor, msg: ShotMsg, action: OrdnanceAction, reason: OrdnanceRejectReason, at: number): ShotAdmission {
    this.counts.refused++;
    this.life.emit({ type: 'ordnance-rejected', at, actorId: a.id, seq: msg.seq, action, reason });
    return { accepted: false, reason: reason as unknown as ShotRejectReason, label: ORDNANCE_REJECT_LABELS[reason] };
  }

  private grenadeClaim(a: HostActor, msg: ShotMsg, now: number): ShotAdmission {
    const def = GRENADE_BY_ID.get(msg.weaponId) as GrenadeDef;
    const kit = this.kits.kitOf(a);
    if (kit.armed === null) {
      const held = def.slot === 'lethal' ? kit.lethal : kit.tactical;
      if (held <= 0) return this.refuse(a, msg, 'arm', 'no-grenade', now);
      kit.armed = { grenadeId: def.id, armedAt: now, fuseAt: def.fuseFrom === 'arm' ? now + def.fuseMs : null };
      this.counts.armed++;
      this.life.emit({ type: 'grenade-armed', at: now, actorId: a.id, team: a.team, grenadeId: def.id, detonatesAt: kit.armed.fuseAt });
      this.life.emit(this.kits.inventoryEvent(a, now));
      return ADMITTED;
    }
    if (kit.armed.grenadeId !== def.id) return this.refuse(a, msg, 'throw', 'already-armed', now);
    if (def.slot === 'lethal') kit.lethal--; else kit.tactical--;
    const g = this.acquire();
    if (g !== null) {
      g.id = this.nextGrenadeId++;
      g.grenadeId = def.id; g.ownerId = a.id; g.ownerTeam = a.team; g.ownerBot = a.bot;
      g.detonatesAt = kit.armed.fuseAt ?? now + def.fuseMs;
      launch(g,
        msg.ox + msg.dx * THROW_FORWARD_M, msg.oy + msg.dy * THROW_FORWARD_M, msg.oz + msg.dz * THROW_FORWARD_M,
        msg.dx * THROW_SPEED_MS, msg.dy * THROW_SPEED_MS + THROW_LIFT_MS, msg.dz * THROW_SPEED_MS);
      this.counts.thrown++;
      this.life.emit({
        type: 'grenade-thrown', at: now, actorId: a.id, team: a.team, grenadeId: def.id, id: g.id,
        x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz, detonatesAt: g.detonatesAt,
      });
    }
    kit.armed = null;
    this.life.emit(this.kits.inventoryEvent(a, now));
    return ADMITTED;
  }

  /**
   * The knife: nearest live actor inside the reach (measured across the
   * ground, so an eye-to-chest slope does not lengthen it), inside the facing
   * cone, with a clear segment. Recovery is enforced here and named when it
   * refuses; a miss is a `melee` event with no victim, not a refusal.
   */
  private meleeClaim(a: HostActor, msg: ShotMsg, now: number): ShotAdmission {
    const kit = this.kits.kitOf(a);
    if (now < kit.meleeReadyAt) return this.refuse(a, msg, 'melee', 'melee-cooldown', now);
    kit.meleeReadyAt = now + KNIFE_RECOVERY_MS;
    this.counts.melees++;
    let best: HostActor | null = null;
    let bestD = KNIFE_REACH_M;
    for (const v of this.life.actors.values()) {
      if (v === a || !v.health.alive) continue;
      if (v.team === a.team) continue; // friendly pass-through: never spend the swing on a teammate
      const p = v.poses.at(msg.firedAt);
      if (p === null) continue;
      const flat = Math.hypot(p.x - msg.ox, p.z - msg.oz);
      if (flat > bestD) continue;
      const tx = p.x - msg.ox;
      const ty = p.y + BLAST_TARGET_Y - msg.oy;
      const tz = p.z - msg.oz;
      const len = Math.hypot(tx, ty, tz);
      if (len > 1e-6 && (tx * msg.dx + ty * msg.dy + tz * msg.dz) / len < KNIFE_FACING_DOT) continue;
      if (!this.clear(msg.ox, msg.oy, msg.oz, p.x, p.y + BLAST_TARGET_Y, p.z)) continue;
      best = v;
      bestD = flat;
    }
    if (best !== null) {
      this.counts.meleeHits++;
      this.life.hit(best, a, 'body', bestD, KNIFE_ID, 'melee', now, msg.ox, msg.oz, KNIFE_DAMAGE);
    }
    this.life.emit({ type: 'melee', at: now, actorId: a.id, team: a.team, victimId: best === null ? null : best.id });
    return ADMITTED;
  }

  // ---- Tick -----------------------------------------------------------------

  /** Once per host tick, before the event queue is drained. */
  advance(now: number): void {
    this.ended.length = 0;
    this.sight.prune(now, this.ended);
    for (const id of this.ended) this.life.emit({ type: 'smoke-volume-end', at: now, id });

    for (const a of this.life.actors.values()) {
      const kit = this.kits.peek(a.id);
      if (kit === null || kit.armed === null || kit.armed.fuseAt === null || now < kit.armed.fuseAt) continue;
      const p = a.poses.at(now);
      const def = GRENADE_BY_ID.get(kit.armed.grenadeId) as GrenadeDef;
      kit.armed = null;
      this.counts.cookOffs++;
      if (p !== null) this.detonate(def, this.nextGrenadeId++, a.id, a.team, a.bot, p.x, p.y + BLAST_TARGET_Y, p.z, now);
      this.life.emit(this.kits.inventoryEvent(a, now));
    }

    const dt = Math.min(MAX_STEP_S, Math.max(0, now - this.lastAdvance) / 1000);
    this.lastAdvance = now;
    for (const g of this.pool) {
      if (!g.live) continue;
      const def = GRENADE_BY_ID.get(g.grenadeId) as GrenadeDef;
      const step = stepBallistic(g, dt, this.world);
      if ((def.impact && step.contact) || now >= g.detonatesAt) {
        g.live = false;
        this.detonate(def, g.id, g.ownerId, g.ownerTeam, g.ownerBot, g.x, g.y, g.z, now);
      }
    }

    // Deaths since the last drain: a corpse drops its primary, and a grenade
    // it was holding goes on cooking at its feet. AFTER the detonations above,
    // not before: `GameHost.tick` empties `pending` right after this returns,
    // so a death a grenade caused this tick is only ever visible here, now.
    // Scanned first, a frag kill left no drop and the proof said so.
    // Spawns likewise: a new life's kit is issued lazily by `kitOf`, and the
    // client only learns its counts from an `ordnance-inventory` event - so
    // one goes out per deploy, or the HUD reads "FRAG 0" until the first
    // throw and the hand refuses to raise on a grenade the host would admit.
    for (const e of this.life.pending) {
      if (e.type === 'death') this.onDeath(e, now);
      else if (e.type === 'spawn') {
        const a = this.life.actors.get(e.actorId);
        if (a !== undefined) this.life.emit(this.kits.inventoryEvent(a, now));
      }
    }

    this.drops.advance(now);
  }

  private onDeath(e: DeathEvent, now: number): void {
    this.drops.onDeath(e, now);
    const victim = this.life.actors.get(e.victimId);
    const kit = victim === undefined ? null : this.kits.peek(victim.id);
    if (victim === undefined || kit === null || kit.armed === null) return;
    const def = GRENADE_BY_ID.get(kit.armed.grenadeId) as GrenadeDef;
    const p = victim.poses.at(e.at) ?? victim.poses.at(now);
    const g = p === null ? null : this.acquire();
    if (g !== null && p !== null) {
      g.id = this.nextGrenadeId++;
      g.grenadeId = def.id; g.ownerId = victim.id; g.ownerTeam = victim.team; g.ownerBot = victim.bot;
      g.detonatesAt = kit.armed.fuseAt ?? now + def.fuseMs;
      launch(g, p.x, p.y + BLAST_TARGET_Y, p.z, 0, 0, 0);
      this.life.emit({
        type: 'grenade-thrown', at: now, actorId: victim.id, team: victim.team, grenadeId: def.id, id: g.id,
        x: g.x, y: g.y, z: g.z, vx: 0, vy: 0, vz: 0, detonatesAt: g.detonatesAt,
      });
    }
    kit.armed = null;
  }

  // ---- Detonation -----------------------------------------------------------

  private detonate(
    def: GrenadeDef, id: number, ownerId: ActorId, ownerTeam: TeamId, ownerBot: boolean,
    x: number, y: number, z: number, now: number,
  ): void {
    const owner = this.life.actors.get(ownerId) ?? null;
    let victims = 0;
    this.counts.detonated++;
    for (const v of this.life.actors.values()) {
      if (!v.health.alive) continue;
      const p = v.poses.at(now);
      if (p === null) continue;
      const cx = p.x;
      const cy = p.y + BLAST_TARGET_Y;
      const cz = p.z;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d < def.blastRadius && this.clear(x, y + BLAST_LIFT_M, z, cx, cy, cz)) {
        let amount = fragDamageAt(d, def);
        // The bot handicap, as `host-life.ts:hit` applies it to bullets: what a
        // bot does TO A HUMAN, never bot-on-bot. Same rule, same number.
        if (ownerBot && !v.bot) amount = Math.round(amount * BOT_DAMAGE_MULTIPLIER);
        if (amount >= 1) {
          this.life.hit(v, owner, 'body', d, def.id, 'explosion', now, x, z, amount);
          victims++;
          this.counts.blastHits++;
        }
      }
      if (def.flashRadius !== null) this.flash(v, p, def, owner, x, y, z, now);
    }
    this.life.emit({
      type: 'grenade-detonated', at: now, actorId: owner === null ? null : owner.id, team: owner === null ? null : owner.team,
      grenadeId: def.id, id, x, y, z, victims,
    });
    if (def.smokeRadius > 0 && def.smokeMs > 0) {
      const smokeId = this.nextSmokeId++;
      const volume = { id: smokeId, x, y, z, radius: def.smokeRadius, bornAt: now, diesAt: now + def.smokeMs, kind: def.id === 'smoke' ? 'grenade' as const : 'blast' as const };
      this.sight.add(volume);
      this.counts.smokes++;
      this.life.emit({ type: 'smoke-volume', at: now, ...volume });
    }
  }

  /** One actor against one flash: eye height, facing from its yaw, a clear segment. */
  private flash(v: HostActor, p: Vec3, def: GrenadeDef, owner: HostActor | null, x: number, y: number, z: number, now: number): void {
    const radius = def.flashRadius as number;
    const ex = p.x;
    const ey = p.y + FLASH_EYE_Y;
    const ez = p.z;
    const dx = x - ex;
    const dy = y - ey;
    const dz = z - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) return;
    const los = this.clear(x, y + BLAST_LIFT_M, z, ex, ey, ez);
    // Look direction is the project's yaw frame: forward = (-sin yaw, 0, -cos yaw).
    const cos = d < 1e-6 ? 1 : (dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw)) / d;
    const ex2 = flashExposure(d, cos, los, radius);
    if (ex2.intensity <= 0.01) return;
    this.sight.setBlind(v.id, now + ex2.durationMs);
    this.counts.flashed++;
    this.life.emit({
      type: 'flash-hit', at: now, victimId: v.id, sourceId: owner === null ? null : owner.id,
      x, y, z, intensity: ex2.intensity, durationMs: ex2.durationMs,
    });
  }

  private clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    this.pA.x = ax; this.pA.y = ay; this.pA.z = az;
    this.pB.x = bx; this.pB.y = by; this.pB.z = bz;
    return this.world.lineOfSight(this.pA, this.pB);
  }

  private acquire(): LiveGrenade | null {
    for (const g of this.pool) {
      if (!g.live) { g.live = true; return g; }
    }
    return null;
  }

  // ---- Readouts and lifecycle ----------------------------------------------

  /** The kit fields the actor snapshot carries. */
  kitOf(a: HostActor): { lethal: number; tactical: number; primaryId: string; rounds: number; armed: string | null; blindUntil: number } {
    const k = this.kits.kitOf(a);
    return { lethal: k.lethal, tactical: k.tactical, primaryId: k.primaryId, rounds: k.rounds, armed: k.armed === null ? null : k.armed.grenadeId, blindUntil: this.sight.blindUntil(a.id) };
  }

  forget(id: ActorId): void {
    this.kits.forget(id);
    this.sight.clearBlind(id);
  }

  /**
   * Match over: the ground clears, live grenades are dropped from the
   * simulation, blindness ends, and every smoke volume ends ON THE BUS - the
   * contract promises a `smoke-volume-end` for every id, and the next match
   * is built on the same world object, so a field left full here would blind
   * the next match's bots to spheres nobody is drawing.
   */
  endMatch(now: number): void {
    this.drops.endMatch(now);
    for (const g of this.pool) g.live = false;
    for (const v of this.sight.activeSmokeVolumes()) this.life.emit({ type: 'smoke-volume-end', at: now, id: v.id });
    this.sight.clear();
  }

  snapshot(): OrdnanceSnapshot {
    let live = 0;
    for (const g of this.pool) if (g.live) live++;
    return {
      grenades: live, smokes: this.sight.activeSmokeVolumes().length, drops: this.drops.snapshot(),
      counts: { ...this.counts, ...this.drops.counts },
    };
  }
}
