/**
 * Nuketown 2025 — the CROSSBOW projection: the client's read-only view of the
 * host-authoritative bolt launch + terminal point (CANARY, gated).
 *
 * DOM-free and scene-free like `game/ordnance-view.ts` and the mortar
 * projection: it folds the two `bolt-*` events into a capped live list that
 * presentation (`weapons/crossbow-fx.ts`) polls every frame. Guests author
 * nothing — a `bolt-*` event on the bus is a host decision to draw, and
 * `match-phase ended` (or `expiresAt` + grace) is the order to stop drawing
 * it. Spectators read the same bus, so they see the same bolts.
 *
 * Caps: at most CROSSBOW_VIEW_POOL live bolts. The host allows 16 live bolts
 * (`game/host-crossbow.ts:CROSSBOW_POOL`, 16 = `ordnance-view.ts:FLIGHT_POOL`),
 * so every live bolt has a visual slot; a 17th concurrent launch never emits
 * (host drops admitted-but-unflown), and a view that is somehow full evicts
 * the oldest — exactly the `OrdnanceView` flight-pool shape, never an
 * unbounded array. Impacts are a FIFO ring of the last 16 terminal points for
 * the effects-pool flash drain.
 */

import type { ActorId, GameEvent, HitZone, TeamId } from './events';

export const CROSSBOW_VIEW_POOL = 16;
export const CROSSBOW_IMPACT_RING = 16;
/** A launch with no impact retires this long past `expiresAt` (the mortar grace shape). */
export const CROSSBOW_VIEW_GRACE_MS = 1_500;
/** Recent terminal points kept for the flash drain. Matches the mortar dust tail. */
export const CROSSBOW_IMPACT_MS = 4_000;
export const CROSSBOW_VIEW_LOG_MAX = 100;

export interface BoltLiveView {
  boltId: number;
  seq: number;
  actorId: ActorId;
  team: TeamId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bornAt: number;
  expiresAt: number;
}

export interface BoltImpactView {
  seq: number;
  boltId: number;
  actorId: ActorId | null;
  victimId: ActorId | null;
  zone: HitZone | null;
  distance: number;
  x: number;
  y: number;
  z: number;
  stopped: 'victim' | 'wall' | 'expired';
  at: number;
}

export class BoltView {
  readonly bolts: BoltLiveView[] = [];
  readonly impacts: BoltImpactView[] = [];
  impactSeq = 0;
  /** Last impact seq consumed by the effects drain. Presentation owns it. */
  audioSeq = 0;
  readonly counts: Record<string, number> = {
    launched: 0, impacts: 0, victims: 0, walls: 0, expired: 0, evicted: 0,
  };
  readonly lines: string[] = [];

  private log(line: string): void {
    if (this.lines.length < CROSSBOW_VIEW_LOG_MAX) this.lines.push(line);
  }

  /** Fold one bus event in. Returns null always (no feed line: the hit marker already fired). */
  apply(e: GameEvent): null {
    const at = e.at.toFixed(0);
    if (e.type === 'bolt-launched') {
      this.counts.launched++;
      let b = this.bolts.find((v) => v.boltId === e.boltId);
      if (b === undefined) {
        if (this.bolts.length >= CROSSBOW_VIEW_POOL) {
          let oldest = 0;
          for (let i = 1; i < this.bolts.length; i++) {
            if (this.bolts[i].bornAt < this.bolts[oldest].bornAt) oldest = i;
          }
          this.bolts.splice(oldest, 1);
          this.counts.evicted++;
        }
        b = {
          boltId: e.boltId, seq: e.seq, actorId: e.actorId, team: e.team,
          x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, bornAt: 0, expiresAt: 0,
        };
        this.bolts.push(b);
      }
      const i = this.bolts.indexOf(b);
      this.bolts[i] = {
        boltId: e.boltId, seq: e.seq, actorId: e.actorId, team: e.team,
        x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz,
        bornAt: e.at, expiresAt: e.expiresAt,
      };
      this.log(at + ' bolt-launched id=' + e.boltId + ' seq=' + e.seq + ' by=' + e.actorId);
      return null;
    }
    if (e.type === 'bolt-impact') {
      this.counts.impacts++;
      if (e.stopped === 'victim') this.counts.victims++;
      else if (e.stopped === 'wall') this.counts.walls++;
      else this.counts.expired++;
      const i = this.bolts.findIndex((v) => v.boltId === e.boltId);
      if (i >= 0) this.bolts.splice(i, 1);
      const view: BoltImpactView = {
        seq: ++this.impactSeq, boltId: e.boltId, actorId: e.actorId,
        victimId: e.victimId, zone: e.zone, distance: e.distance,
        x: e.x, y: e.y, z: e.z, stopped: e.stopped, at: e.at,
      };
      this.impacts.push(view);
      if (this.impacts.length > CROSSBOW_IMPACT_RING) this.impacts.shift();
      this.log(at + ' bolt-impact id=' + e.boltId + ' ' + e.stopped +
        (e.victimId === null ? '' : ' victim=' + e.victimId));
      return null;
    }
    if (e.type === 'match-phase' && e.phase === 'ended') {
      // Match over drops every live bolt silently — no post-match drawing.
      // Counts are cumulative; only the live list clears.
      if (this.bolts.length > 0) this.bolts.length = 0;
      this.log(at + ' bolts-cleared match-ended');
      return null;
    }
    return null;
  }

  /** Retire stale launches and dust. Called by presentation once a frame. */
  expire(now: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      if (now > this.bolts[i].expiresAt + CROSSBOW_VIEW_GRACE_MS) this.bolts.splice(i, 1);
    }
    if (this.impacts.length > 0) {
      let kept = 0;
      for (let i = 0; i < this.impacts.length; i++) {
        if (now - this.impacts[i].at <= CROSSBOW_IMPACT_MS) this.impacts[kept++] = this.impacts[i];
      }
      this.impacts.length = kept;
    }
  }

  /** Teardown: a null client leaves no bolts behind (rematch / match over). */
  reset(): void {
    this.bolts.length = 0;
    this.impacts.length = 0;
    this.audioSeq = 0;
  }

  /** Honest canary snapshot: live slots plus the exact cumulative counts. */
  snapshot(): { live: number; counts: Readonly<Record<string, number>> } {
    return { live: this.bolts.length, counts: { ...this.counts } };
  }
}
