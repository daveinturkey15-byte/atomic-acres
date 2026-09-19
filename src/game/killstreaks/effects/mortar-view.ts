/**
 * Nuketown 2025 — Mortar projection: the client's read-only view of the
 * host-authoritative telegraph + impact events.
 *
 * DOM-free and scene-free like `game/ordnance-view.ts`: it folds the two
 * `mortar-*` events into capped live lists that presentation polls every
 * frame. Guests author nothing — a `mortar-*` event on the bus is a host
 * decision to draw, and `streak-ended` (or `endsAt` + grace) is the order to
 * stop drawing it. Spectators read the same bus, so they see the same rings.
 *
 * Caps (the `MAX_*` rationale in `killstreaks/runtime.ts` §5.9, applied to
 * presentation): at most MORTAR_MAX_TELEGRAPHS warning discs and
 * MORTAR_MAX_IMPACTS recent detonations. The host allows 12 live streak
 * entities; four simultaneous mortar tubes already saturate the 8 m discs on
 * this map, so the fifth telegraph evicts the oldest — exactly the
 * `OrdnanceView` flight-pool shape, never an unbounded array.
 */

import type { GameEvent } from '../../events';

/** Simultaneous warning discs. Four 8 m discs cover both yards and the street. */
export const MORTAR_MAX_TELEGRAPHS = 4;
/** Recent detonations kept for the flash + dust ring. A ring buffer like `BLAST_RING`. */
export const MORTAR_MAX_IMPACTS = 8;
/** How long one impact flash + dust ring stays visible, ms. Matches the grenade `BLAST_FLASH_S` flash (350 ms) with a 4 s dust tail. */
export const MORTAR_FLASH_MS = 350;
export const MORTAR_DUST_MS = 4_000;
/** A telegraph with no `streak-ended` retires this long past `endsAt` (the `FLIGHT_GRACE_MS` shape). */
export const MORTAR_TELEGRAPH_GRACE_MS = 1_500;
export const MORTAR_VIEW_LOG_MAX = 100;

export interface MortarTelegraphView {
  readonly instanceId: number;
  readonly streakId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly impacts: number;
  readonly bornAt: number;
  readonly endsAt: number;
}

export interface MortarImpactView {
  readonly seq: number;
  readonly instanceId: number;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly at: number;
  readonly victims: number;
}

/** True for either host-authoritative mortar event. `client.ts` routes on it. */
export function isMortarEvent(e: GameEvent): boolean {
  return e.type === 'mortar-telegraph' || e.type === 'mortar-impact';
}

export class MortarView {
  readonly telegraphs: MortarTelegraphView[] = [];
  readonly impacts: MortarImpactView[] = [];
  impactSeq = 0;
  /** Last impact seq consumed by the audio drain. Presentation owns it. */
  audioSeq = 0;
  readonly counts: Record<string, number> = {
    telegraphs: 0, impacts: 0, ended: 0, evicted: 0,
  };
  readonly lines: string[] = [];

  private log(line: string): void {
    if (this.lines.length < MORTAR_VIEW_LOG_MAX) this.lines.push(line);
  }

  /** Fold one bus event in. Returns null always (no feed line: the streak banner already announced it). */
  apply(e: GameEvent): null {
    const at = e.at.toFixed(0);
    if (e.type === 'mortar-telegraph') {
      this.counts.telegraphs++;
      let t = this.telegraphs.find((v) => v.instanceId === e.instanceId);
      if (t === undefined) {
        if (this.telegraphs.length >= MORTAR_MAX_TELEGRAPHS) {
          this.telegraphs.shift();
          this.counts.evicted++;
        }
        t = {
          instanceId: e.instanceId, streakId: e.streakId,
          x: 0, y: 0, z: 0, radius: 0, impacts: 0, bornAt: 0, endsAt: 0,
        };
        this.telegraphs.push(t);
      }
      const i = this.telegraphs.indexOf(t);
      this.telegraphs[i] = {
        instanceId: e.instanceId, streakId: e.streakId,
        x: e.x, y: e.y, z: e.z, radius: e.radius, impacts: e.impacts,
        bornAt: e.at, endsAt: e.endsAt,
      };
      this.log(at + ' mortar-telegraph inst=' + e.instanceId + ' at=' + e.x.toFixed(1) + ',' + e.z.toFixed(1) + ' r=' + e.radius);
      return null;
    }
    if (e.type === 'mortar-impact') {
      this.counts.impacts++;
      const view: MortarImpactView = {
        seq: ++this.impactSeq, instanceId: e.instanceId, index: e.index,
        x: e.x, y: e.y, z: e.z, at: e.at, victims: e.victims,
      };
      // FIFO ring: oldest evicted first, seq stays monotonic. The prior
      // `% MORTAR_MAX_IMPACTS` slot write replaced an arbitrary entry, so a
      // stale record behind a fresh head survived `expire` below.
      this.impacts.push(view);
      if (this.impacts.length > MORTAR_MAX_IMPACTS) this.impacts.shift();
      this.log(at + ' mortar-impact inst=' + e.instanceId + ' #' + e.index + ' victims=' + e.victims);
      return null;
    }
    if (e.type === 'streak-ended') {
      const i = this.telegraphs.findIndex((v) => v.instanceId === e.instanceId);
      if (i >= 0) {
        this.telegraphs.splice(i, 1);
        this.counts.ended++;
        this.log(at + ' mortar-ended inst=' + e.instanceId + ' ' + e.reason);
      }
      return null;
    }
    return null;
  }

  /** Retire stale telegraphs and dust. Called by presentation once a frame. */
  expire(now: number): void {
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      if (now > this.telegraphs[i].endsAt + MORTAR_TELEGRAPH_GRACE_MS) this.telegraphs.splice(i, 1);
    }
    // Every expired dust entry, not just the head: staggered deadlines and a
    // wrapped ring leave stale records behind a fresh `impacts[0]`.
    if (this.impacts.length > 0) {
      let kept = 0;
      for (let i = 0; i < this.impacts.length; i++) {
        if (now - this.impacts[i].at <= MORTAR_DUST_MS) this.impacts[kept++] = this.impacts[i];
      }
      this.impacts.length = kept;
    }
  }

  /** Teardown: a null client leaves no rings behind (rematch / match over). */
  reset(): void {
    this.telegraphs.length = 0;
    this.impacts.length = 0;
    this.audioSeq = 0;
  }
}
