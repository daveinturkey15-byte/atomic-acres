/** Bounded host simulation for flame cones, afterburn and arced flare fires. */
import { WEAPONS, damageAt } from '../weapons/catalog';
import { behaviorFor, coneDamageAt, insideCone } from '../weapons/behavior';
import type { ShotMsg } from '../net/protocol';
import type { ActorId, Vec3, WeaponEffectEvent, WorldQuery } from './events';
import { BOT_DAMAGE_MULTIPLIER, admitted } from './damage';
import { hitHeight, pickTarget, type TargetCandidate } from './host-shot';
import type { HostActor, HostLife } from './host-life';

interface Burn { victim: ActorId; life: number; owner: ActorId; weapon: string; expires: number; next: number; x: number; z: number }
interface Flare { id: number; owner: ActorId; seq: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; distance: number }
interface Fire { owner: ActorId; x: number; y: number; z: number; expires: number; next: number }
const MAX_FLARES = 16;
const MAX_FIRES = 16;
const FIRE_RADIUS = 3;
const FIRE_LIFETIME_MS = 4000;
const BURN_TICK_MS = 250;
const FLAME = WEAPONS.find((w) => w.id === 'flamethrower')!;
const FLARE = WEAPONS.find((w) => w.id === 'flare-gun')!;

export class HostWeaponEffects {
  private readonly burns = new Map<ActorId, Burn>();
  private readonly flares: Flare[] = [];
  private readonly fires: Fire[] = [];
  private nextId = 1;
  private lastAt: number;
  constructor(private readonly life: HostLife, private readonly world: WorldQuery, now: number) { this.lastAt = now; }

  private emit(a: HostActor, c: ShotMsg, now: number, effect: WeaponEffectEvent['effect'], id: number,
    radius: number, durationMs: number): void {
    this.life.emit({ type: 'weapon-effect', effect, at: now, actorId: a.id, team: a.team, id,
      weaponId: c.weaponId, x: c.ox, y: c.oy, z: c.oz, dx: c.dx, dy: c.dy, dz: c.dz, radius, durationMs });
  }

  flame(a: HostActor, c: ShotMsg, now: number): void {
    const profile = behaviorFor(FLAME.id);
    const origin = { x: c.ox, y: c.oy, z: c.oz };
    this.emit(a, c, now, 'flame', this.nextId++, profile.range!, 130);
    for (const victim of this.life.actors.values()) {
      if (victim === a || !victim.health.alive || !this.life.areHostile(a, victim)) continue;
      const p = victim.poses.at(c.firedAt);
      if (p === null) continue;
      const horizontal = Math.hypot(p.x - c.ox, p.z - c.oz);
      const target = { x: p.x, y: Math.max(p.y + 0.1, Math.min(p.y + hitHeight(p.stance) - 0.05, c.oy + c.dy * horizontal)), z: p.z };
      if (!insideCone(c.ox, c.oy, c.oz, c.dx, c.dy, c.dz, target.x, target.y, target.z, profile)) continue;
      if (!this.world.lineOfSight(origin, target)) continue;
      const distance = Math.hypot(target.x - c.ox, target.y - c.oy, target.z - c.oz);
      const amount = coneDamageAt(distance, FLAME.damage.base, FLAME.damage.fall, profile.range!);
      this.hurt(victim, a, FLAME.id, amount, distance, now, c.ox, c.oz);
      // Protection or a refused hit must never seed a delayed hurt after protection expires.
      if (victim.health.alive && victim.health.invulnerableUntil <= now) {
        const previous = this.burns.get(victim.id);
        this.burns.set(victim.id, { victim: victim.id, life: victim.health.life, owner: a.id, weapon: FLAME.id,
          expires: now + profile.burnDuration! * 1000, next: previous?.next ?? now + BURN_TICK_MS, x: c.ox, z: c.oz });
      }
    }
  }

  flare(a: HostActor, c: ShotMsg, now: number): void {
    const profile = behaviorFor(FLARE.id);
    if (this.flares.length >= MAX_FLARES) return;
    const id = this.nextId++;
    this.flares.push({ id, owner: a.id, seq: c.seq, x: c.ox, y: c.oy, z: c.oz,
      vx: c.dx * profile.speed!, vy: c.dy * profile.speed!, vz: c.dz * profile.speed!, age: 0, distance: 0 });
    this.emit(a, c, now, 'flare-launch', id, 0.15, profile.lifetime! * 1000);
  }

  private hurt(victim: HostActor, owner: HostActor, weapon: string, raw: number, distance: number,
    now: number, x: number, z: number): void {
    if (raw <= 0) return;
    const amount = admitted(raw * (owner.bot && !victim.bot ? BOT_DAMAGE_MULTIPLIER : 1));
    this.life.hit(victim, owner, 'body', distance, weapon, 'bullet', now, x, z, amount);
  }

  advance(now: number): void {
    const dt = Math.min(0.1, Math.max(0, now - this.lastAt) / 1000);
    this.lastAt = now;
    for (const [id, burn] of this.burns) {
      const victim = this.life.actors.get(id); const owner = this.life.actors.get(burn.owner);
      if (!victim?.health.alive || !owner || victim.health.life !== burn.life || now >= burn.expires) { this.burns.delete(id); continue; }
      if (now >= burn.next) { burn.next = now + BURN_TICK_MS; this.hurt(victim, owner, burn.weapon, 3, 0, now, burn.x, burn.z); }
    }
    const candidates: TargetCandidate[] = [];
    for (const actor of this.life.actors.values()) {
      const pose = actor.poses.at(now);
      if (actor.health.alive && pose) candidates.push({ id: actor.id, pose });
    }
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const flare = this.flares[i];
      let remaining = dt;
      let stopped = false;
      while (remaining > 1e-9 && !stopped) {
        const step = Math.min(remaining, 1 / 120); remaining -= step;
        stopped = this.step(flare, step, now, candidates);
      }
      if (stopped) this.flares.splice(i, 1);
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const fire = this.fires[i]; const owner = this.life.actors.get(fire.owner);
      if (!owner || now >= fire.expires) { this.fires.splice(i, 1); continue; }
      if (now < fire.next) continue;
      fire.next = now + BURN_TICK_MS;
      for (const target of candidates) {
        const victim = this.life.actors.get(target.id)!;
        const p = { x: target.pose.x, y: target.pose.y + Math.min(0.8, hitHeight(target.pose.stance) * 0.5), z: target.pose.z };
        const distance = Math.hypot(p.x - fire.x, p.y - fire.y, p.z - fire.z);
        if (distance < FIRE_RADIUS && this.world.lineOfSight(fire, p)) this.hurt(victim, owner, FLARE.id, 12 * (1 - distance / FIRE_RADIUS), distance, now, fire.x, fire.z);
      }
    }
  }

  private step(f: Flare, dt: number, now: number, candidates: TargetCandidate[]): boolean {
    const profile = behaviorFor(FLARE.id);
    const from = { x: f.x, y: f.y, z: f.z };
    f.vy -= profile.gravity! * dt;
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.age += dt;
    const length = Math.hypot(f.x - from.x, f.y - from.y, f.z - from.z);
    f.distance += length;
    const ray: ShotMsg = { type: 'shot', weaponId: FLARE.id, life: 0, seq: f.seq, firedAt: now,
      ox: from.x, oy: from.y, oz: from.z, dx: (f.x - from.x) / length, dy: (f.y - from.y) / length, dz: (f.z - from.z) / length };
    const hit = pickTarget(ray, candidates.filter((c) => c.id !== f.owner));
    const end: Vec3 = hit && hit.distance <= length ? hit : f;
    if (!this.world.lineOfSight(from, end)) {
      // Binary-search the clear side of the wall so the fire cannot burn through its back.
      let lo = 0; let hi = 1;
      for (let i = 0; i < 10; i++) {
        const t = (lo + hi) * 0.5;
        const p = { x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t, z: from.z + (end.z - from.z) * t };
        if (this.world.lineOfSight(from, p)) lo = t; else hi = t;
      }
      f.x = from.x + (end.x - from.x) * Math.max(0, lo - 0.01);
      f.y = from.y + (end.y - from.y) * Math.max(0, lo - 0.01);
      f.z = from.z + (end.z - from.z) * Math.max(0, lo - 0.01);
      this.impact(f, now); return true;
    }
    if (hit && hit.distance <= length) {
      const victim = this.life.actors.get(hit.id); const owner = this.life.actors.get(f.owner);
      f.x = hit.x; f.y = hit.y; f.z = hit.z;
      if (victim && owner) this.hurt(victim, owner, FLARE.id, damageAt(FLARE, f.distance), f.distance, now, from.x, from.z);
      this.impact(f, now); return true;
    }
    const ground = this.world.groundY(f.x, f.z);
    if (f.y <= ground && from.y >= ground) { f.y = ground + 0.04; this.impact(f, now); return true; }
    if (!this.world.inBounds(f.x, f.z) || f.age >= profile.lifetime! || f.distance >= profile.range!) { this.impact(f, now); return true; }
    return false;
  }

  private impact(f: Flare, now: number): void {
    const owner = this.life.actors.get(f.owner);
    if (!owner) return;
    this.life.emit({ type: 'weapon-effect', effect: 'flare-impact', at: now, actorId: owner.id, team: owner.team,
      id: f.id, weaponId: FLARE.id, x: f.x, y: f.y, z: f.z, dx: 0, dy: 0, dz: 0, radius: FIRE_RADIUS, durationMs: FIRE_LIFETIME_MS });
    if (this.fires.length >= MAX_FIRES) this.fires.shift();
    this.fires.push({ owner: f.owner, x: f.x, y: f.y + 0.03, z: f.z, expires: now + FIRE_LIFETIME_MS, next: now });
  }

  forget(id: ActorId): void {
    this.burns.delete(id);
    for (const [victim, burn] of this.burns) if (burn.owner === id) this.burns.delete(victim);
    for (let i = this.flares.length - 1; i >= 0; i--) if (this.flares[i].owner === id) this.flares.splice(i, 1);
    for (let i = this.fires.length - 1; i >= 0; i--) if (this.fires[i].owner === id) this.fires.splice(i, 1);
  }
  clear(): void { this.burns.clear(); this.flares.length = 0; this.fires.length = 0; }
}
