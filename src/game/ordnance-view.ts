/**
 * Nuketown 2025 — the client's projection of ordnance: what is in the air,
 * what is on the ground, what is smoking, and what the local player holds.
 *
 * Owned by `GameClient` (one per client) and READ by presentation
 * (`weapons/grenades.ts`, `weapons/drops.ts`, the HUD via `main.ts`). It
 * decides nothing: every field is copied off a host event, the way
 * `client.ts` copies scores off `MatchStateMsg` (IMPORT-PLAN §5.6). It holds
 * pools, not lists that grow — presentation reads it every frame and nothing
 * here allocates after construction except the bounded log.
 *
 * Flights are REPLAYED, not streamed: `grenade-thrown` carries the launch
 * state and presentation integrates it with the same `stepBallistic` the host
 * used, against the same `WorldQuery`. `grenade-detonated` snaps the flight
 * to the authoritative point and retires it. A flight whose detonation never
 * arrives (match rebuilt under it) retires itself `FLIGHT_GRACE_MS` past its
 * fuse.
 *
 * `lines` is the ordnance lane's own bounded log, because
 * `game/session-log.ts` is not this lane's file and the browser proof needs
 * the event sequence in words.
 */

import type { ActorId, FeedTone, GameEvent, KillEvent, OrdnanceEvent, SmokeKind } from './events';
import { ORDNANCE_REJECT_LABELS } from './events';
import { KILL_SEPARATOR } from './feed';
import type { Ballistic } from './ordnance-physics';

export const FLIGHT_POOL = 16;
export const SMOKE_POOL = 16;
export const BLAST_RING = 8;
export const VIEW_LOG_MAX = 300;
/** A flight with no detonation event is dropped this long after its fuse. */
export const FLIGHT_GRACE_MS = 1_500;
/** The kill-feed glyph for a knife kill: the dagger, in place of the separator. */
export const KNIFE_GLYPH = '†';

export interface FlightView extends Ballistic {
  live: boolean;
  id: number;
  grenadeId: string;
  ownerId: ActorId;
  bornAt: number;
  detonatesAt: number;
}

export interface SmokeView {
  id: number;
  x: number; y: number; z: number;
  radius: number;
  bornAt: number;
  diesAt: number;
  kind: SmokeKind;
}

export interface DropView {
  id: number;
  weaponId: string;
  rounds: number;
  grenades: number;
  x: number; y: number; z: number;
  diesAt: number;
}

/** One detonation for presentation, in a ring. `seq` lets a reader consume each once. */
export interface BlastView {
  seq: number;
  grenadeId: string;
  x: number; y: number; z: number;
  at: number;
}

export interface SelfOrdnance {
  lethal: number;
  tactical: number;
  primaryId: string | null;
  rounds: number;
  /** Grenade in hand with the pin out, as the host sees it. */
  armed: string | null;
  /** Last flash on us: host time, length, peak. Presentation derives the white-out. */
  flashAt: number;
  flashMs: number;
  flashPeak: number;
  /** Counts a reader compares frame to frame: our spawns, our pickups, our swings. */
  spawnSeq: number;
  pickupSeq: number;
  lastPickupKind: 'scavenge' | 'swap' | null;
  lastPickupWeaponId: string | null;
  lastPickupRounds: number;
  meleeSeq: number;
}

export interface OrdnanceLine {
  readonly text: string;
  readonly tone: FeedTone;
}

export class OrdnanceView {
  readonly flights: FlightView[] = [];
  readonly smokes: SmokeView[] = [];
  readonly drops: DropView[] = [];
  readonly blasts: BlastView[] = [];
  blastSeq = 0;
  readonly self: SelfOrdnance = {
    lethal: 0, tactical: 0, primaryId: null, rounds: 0, armed: null,
    flashAt: -Infinity, flashMs: 0, flashPeak: 0,
    spawnSeq: 0, pickupSeq: 0, lastPickupKind: null, lastPickupWeaponId: null, lastPickupRounds: 0, meleeSeq: 0,
  };
  readonly counts: Record<string, number> = {
    armed: 0, thrown: 0, detonated: 0, flashHits: 0, smokes: 0, smokeEnds: 0, melees: 0,
    drops: 0, dropChanges: 0, dropRemoved: 0, pickups: 0, rejected: 0,
  };
  readonly lines: string[] = [];

  constructor(readonly selfId: ActorId) {
    for (let i = 0; i < FLIGHT_POOL; i++) {
      this.flights.push({
        live: false, id: 0, grenadeId: 'frag', ownerId: '', bornAt: 0, detonatesAt: 0,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, resting: true,
      });
    }
  }

  private log(line: string): void {
    if (this.lines.length < VIEW_LOG_MAX) this.lines.push(line);
  }

  /**
   * A line about the local player from OUTSIDE the ordnance vocabulary - its
   * spawn, its death, a claim the shared admission refused. `client.ts` calls
   * it so the browser proof's timeline says why a throw at t=14 did nothing
   * ("shot-rejected shooter-dead") instead of leaving a gap to guess at.
   */
  note(at: number, text: string): void {
    this.log(at.toFixed(0) + ' ' + text);
  }

  /** Retire flights whose detonation never came. Called by presentation once a frame. */
  expire(now: number): void {
    for (const f of this.flights) {
      if (f.live && now > f.detonatesAt + FLIGHT_GRACE_MS) f.live = false;
    }
  }

  /** Our own spawn: the projection's per-life state resets. */
  onSelfSpawn(): void {
    this.self.spawnSeq++;
    this.self.armed = null;
    this.self.flashAt = -Infinity;
  }

  /**
   * Fold one ordnance event in. Returns a feed line when the local player
   * should read one (their own pickup, their own refusal), else null.
   */
  apply(e: OrdnanceEvent): OrdnanceLine | null {
    const at = e.at.toFixed(0);
    switch (e.type) {
      case 'grenade-armed':
        this.counts.armed++;
        this.log(at + ' grenade-armed ' + e.actorId + ' ' + e.grenadeId + (e.detonatesAt === null ? '' : ' fuseAt=' + e.detonatesAt.toFixed(0)));
        return null;
      case 'grenade-thrown': {
        this.counts.thrown++;
        let slot = this.flights.find((f) => !f.live);
        if (slot === undefined) slot = this.flights.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
        slot.live = true;
        slot.id = e.id; slot.grenadeId = e.grenadeId; slot.ownerId = e.actorId;
        slot.bornAt = e.at; slot.detonatesAt = e.detonatesAt;
        slot.x = e.x; slot.y = e.y; slot.z = e.z;
        slot.vx = e.vx; slot.vy = e.vy; slot.vz = e.vz;
        slot.resting = false;
        this.log(at + ' grenade-thrown ' + e.actorId + ' ' + e.grenadeId + ' id=' + e.id
          + ' at=' + e.x.toFixed(1) + ',' + e.y.toFixed(1) + ',' + e.z.toFixed(1));
        return null;
      }
      case 'grenade-detonated': {
        this.counts.detonated++;
        for (const f of this.flights) if (f.live && f.id === e.id) f.live = false;
        const b = this.blasts.length < BLAST_RING ? null : this.blasts[this.blastSeq % BLAST_RING];
        const view: BlastView = b ?? { seq: 0, grenadeId: '', x: 0, y: 0, z: 0, at: 0 };
        view.seq = ++this.blastSeq; view.grenadeId = e.grenadeId; view.x = e.x; view.y = e.y; view.z = e.z; view.at = e.at;
        if (b === null) this.blasts.push(view);
        this.log(at + ' grenade-detonated ' + String(e.actorId) + ' ' + e.grenadeId + ' id=' + e.id + ' victims=' + e.victims
          + ' at=' + e.x.toFixed(1) + ',' + e.y.toFixed(1) + ',' + e.z.toFixed(1));
        return null;
      }
      case 'flash-hit':
        this.counts.flashHits++;
        if (e.victimId === this.selfId) {
          this.self.flashAt = e.at; this.self.flashMs = e.durationMs; this.self.flashPeak = e.intensity;
        }
        this.log(at + ' flash-hit ' + e.victimId + ' by=' + String(e.sourceId) + ' i=' + e.intensity.toFixed(2) + ' ms=' + e.durationMs);
        return null;
      case 'smoke-volume': {
        this.counts.smokes++;
        let s = this.smokes.find((v) => v.id === e.id);
        if (s === undefined) {
          if (this.smokes.length >= SMOKE_POOL) this.smokes.shift();
          s = { id: e.id, x: 0, y: 0, z: 0, radius: 0, bornAt: 0, diesAt: 0, kind: e.kind };
          this.smokes.push(s);
        }
        s.x = e.x; s.y = e.y; s.z = e.z; s.radius = e.radius; s.bornAt = e.bornAt; s.diesAt = e.diesAt; s.kind = e.kind;
        this.log(at + ' smoke-volume id=' + e.id + ' ' + e.kind + ' r=' + e.radius + ' until=' + e.diesAt.toFixed(0));
        return null;
      }
      case 'smoke-volume-end': {
        this.counts.smokeEnds++;
        const i = this.smokes.findIndex((v) => v.id === e.id);
        if (i >= 0) this.smokes.splice(i, 1);
        this.log(at + ' smoke-volume-end id=' + e.id);
        return null;
      }
      case 'melee':
        this.counts.melees++;
        if (e.actorId === this.selfId) this.self.meleeSeq++;
        this.log(at + ' melee ' + e.actorId + ' hit=' + String(e.victimId));
        return null;
      case 'drop-spawned': {
        this.counts.drops++;
        this.drops.push({ id: e.id, weaponId: e.weaponId, rounds: e.rounds, grenades: e.grenades, x: e.x, y: e.y, z: e.z, diesAt: e.diesAt });
        this.log(at + ' drop-spawned id=' + e.id + ' ' + e.weaponId + ' rounds=' + e.rounds + ' from=' + e.ownerId);
        return null;
      }
      case 'drop-changed': {
        this.counts.dropChanges++;
        const d = this.drops.find((v) => v.id === e.id);
        if (d !== undefined) {
          d.weaponId = e.weaponId; d.rounds = e.rounds; d.grenades = e.grenades;
          d.x = e.x; d.y = e.y; d.z = e.z; d.diesAt = e.diesAt;
        }
        this.log(at + ' drop-changed id=' + e.id + ' ' + e.weaponId + ' rounds=' + e.rounds);
        return null;
      }
      case 'drop-removed': {
        this.counts.dropRemoved++;
        const i = this.drops.findIndex((v) => v.id === e.id);
        if (i >= 0) this.drops.splice(i, 1);
        this.log(at + ' drop-removed id=' + e.id + ' ' + e.reason);
        return null;
      }
      case 'pickup': {
        this.counts.pickups++;
        this.log(at + ' pickup ' + e.actorId + ' ' + e.kind + ' ' + e.weaponId + ' rounds=' + e.rounds + ' grenades=' + e.grenades
          + (e.leftWeaponId === null ? '' : ' left=' + e.leftWeaponId));
        if (e.actorId !== this.selfId) return null;
        this.self.pickupSeq++;
        this.self.lastPickupKind = e.kind;
        this.self.lastPickupWeaponId = e.weaponId;
        this.self.lastPickupRounds = e.rounds;
        if (e.kind === 'swap') return { text: 'TOOK ' + e.weaponId.toUpperCase() + ' (' + e.rounds + ')', tone: 'own' };
        const parts: string[] = [];
        if (e.rounds > 0) parts.push('+' + e.rounds + ' ROUNDS');
        if (e.grenades > 0) parts.push('+' + e.grenades + (e.grenades === 1 ? ' GRENADE' : ' GRENADES'));
        return { text: 'SCAVENGED ' + parts.join(' '), tone: 'own' };
      }
      case 'ordnance-inventory':
        if (e.actorId !== this.selfId) return null;
        this.self.lethal = e.lethal; this.self.tactical = e.tactical;
        this.self.primaryId = e.primaryId; this.self.rounds = e.rounds; this.self.armed = e.armed;
        return null;
      case 'ordnance-rejected':
        this.counts.rejected++;
        this.log(at + ' ordnance-rejected ' + e.actorId + ' seq=' + e.seq + ' ' + e.action + ' ' + e.reason);
        return e.actorId === this.selfId ? { text: ORDNANCE_REJECT_LABELS[e.reason], tone: 'own' } : null;
    }
  }
}

/**
 * The kill-feed glyph. A knife kill reads `YOU † BOT 03`; a grenade kill keeps
 * the separator and tags the grenade the way `feed.ts` tags a headshot. The
 * line itself is `feed.ts`'s (not this lane's file); only the glyph is added.
 */
export function decorateKillLine(text: string, e: KillEvent): string {
  if (e.cause === 'melee') return text.replace(' ' + KILL_SEPARATOR + ' ', ' ' + KNIFE_GLYPH + ' ');
  if (e.cause === 'explosion') return text + ' [' + e.weaponId.toUpperCase() + ']';
  return text;
}

/** True for any event this projection consumes. `client.ts` routes on it. */
export function isOrdnanceEvent(e: GameEvent): e is OrdnanceEvent {
  switch (e.type) {
    case 'grenade-armed': case 'grenade-thrown': case 'grenade-detonated': case 'flash-hit':
    case 'smoke-volume': case 'smoke-volume-end': case 'melee': case 'drop-spawned': case 'drop-changed':
    case 'drop-removed': case 'pickup': case 'ordnance-inventory': case 'ordnance-rejected':
      return true;
    default:
      return false;
  }
}
