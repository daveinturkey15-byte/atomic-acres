/**
 * Nuketown 2025 — the guest/local projection.
 *
 * `GameClient` consumes host events and host snapshots and exposes a view.
 * **It decides nothing.** It computes no damage, awards no kill, ends no match
 * and — the one that matters — writes no score: `teamScores` and `rows` are
 * copied straight off `MatchStateMsg`, never recomputed from the rows beside
 * them. In the old project `authoritativeScores` was merged at eight separate
 * sites in one file and a test had to assert that *replicas do not mutate
 * replica scores* (IMPORT-PLAN §5.6). The structural fix is this class holding
 * only `readonly` view data and no arithmetic over it.
 *
 * LEVELS AND EDGES. `view()` is the level: health, score, blips, the respawn
 * clock — everything a HUD setter can be handed every frame and early-return
 * on. `drain()` is the edge: the hitmarker that must fire once, the feed row
 * that must appear once, the damage arc that must point once. Two channels
 * because a HUD driven only by levels cannot flash, and a HUD driven only by
 * edges shows stale numbers after a dropped frame.
 *
 * DOM-free and scene-free. `net/protocol` is imported for TYPES only, so the
 * wire shapes are not re-declared here as a mirror that goes stale the first
 * time `MatchStateMsg` grows a field.
 */

import type {
  ActorId,
  DamageEvent,
  FeedDestination,
  FeedTone,
  GameEvent,
  HitZone,
  MatchEndReason,
  MatchPhaseName,
  TeamId,
} from './events';
import type { MatchMode } from './rules';
import type { MatchStateMsg, PlayerSample, ScoreRow, StreakPoseMsg, StreakSlotState, StreakStateMsg } from '../net/protocol';
import { SHOT_REJECT_LABELS } from './events';
import { BannerArbiter, feedLineForDamage, feedLineForDeath, feedLineForKill, feedLineForStreakActivated, feedLineForStreakDenied, feedLineForStreakEarned, type FeedContext } from './feed';
import { shouldRevealEnemy, type MapBlip } from './minimap';
import { OrdnanceView, decorateKillLine, isOrdnanceEvent } from './ordnance-view';

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface MatchView {
  readonly mode: MatchMode | null;
  readonly phase: MatchPhaseName;
  /** Milliseconds left, or null for an unlimited clock. Never Infinity. */
  readonly msRemaining: number | null;
  readonly scoreLimit: number | null;
  readonly teamScores: readonly [number, number];
  readonly rows: readonly ScoreRow[];
  readonly winner: TeamId | 'draw' | null;
  readonly winnerId: string | null;
  readonly endReason: MatchEndReason | null;
}

export interface StreakView {
  /** Consecutive kills this life: the ladder position, host-authored. */
  readonly kills: number;
  readonly slots: readonly StreakSlotState[];
  /** Slots holding at least one charge. Derived, not carried. */
  readonly ready: number;
}

export interface AircraftView {
  readonly instanceId: number;
  readonly streakId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  /** Orbit centre: the gunner camera aims at this ground point. */
  readonly cx: number;
  readonly cz: number;
  /** Frozen host-domain display levels, shown as-is. */
  readonly remainingMs: number;
  readonly rocketsLeft: number;
  readonly cooldownMs: number;
}

/** The possessed gunship, when the owner holds one. Counters ride the aircraft entry. */
export interface GunnerView {
  readonly instanceId: number;
  readonly streakId: string;
}

export interface ClientView {
  readonly selfId: ActorId;
  readonly team: TeamId | null;
  /** null = the host has published no health yet. Never substituted with 100. */
  readonly health: number | null;
  readonly alive: boolean;
  readonly match: MatchView;
  readonly streak: StreakView;
  readonly blips: readonly MapBlip[];
  /** Milliseconds until respawn, or null when none is scheduled. */
  readonly respawnMs: number | null;
  readonly banner: { readonly text: string; readonly sub: string } | null;
  /** Live gunship poses, latest per instance. Empty until the pose stream lands. */
  readonly aircraft: readonly AircraftView[];
  /** Non-null while the owner possesses a gunship. */
  readonly gunner: GunnerView | null;
}

/** One-shot presentation events. Consumed by `drain()`, never replayed. */
export type ClientEdge =
  | { readonly kind: 'hit'; readonly marker: 'body' | 'head' | 'kill' }
  | { readonly kind: 'hurt'; readonly sourceX: number; readonly sourceZ: number; readonly amount: number }
  | { readonly kind: 'feed'; readonly text: string; readonly dest: FeedDestination; readonly tone: FeedTone }
  | { readonly kind: 'banner'; readonly text: string; readonly sub: string }
  | { readonly kind: 'banner-clear' };

export interface ClientSnapshot {
  readonly at: number;
  readonly match?: MatchStateMsg | null;
  readonly streak?: StreakStateMsg | null;
  readonly players?: readonly PlayerSample[];
  /** Live gunship poses, latest per instance. Absent until the pose stream lands. */
  readonly poses?: readonly StreakPoseMsg[];
}

const EMPTY_MATCH: MatchView = Object.freeze({
  mode: null,
  phase: 'warmup' as MatchPhaseName,
  msRemaining: null,
  scoreLimit: null,
  teamScores: Object.freeze([0, 0]) as readonly [number, number],
  rows: Object.freeze([]) as readonly ScoreRow[],
  winner: null,
  winnerId: null,
  endReason: null,
});

const EMPTY_STREAK: StreakView = Object.freeze({ kills: 0, slots: Object.freeze([]), ready: 0 });

/** Banner ids are local and monotonic; the arbiter only needs them distinct. */
let nextBannerId = 1;

/** How long a streak announcement holds the banner. Old awareness window. */
export const BANNER_ANNOUNCE_MS = 2_600;
/** Match phase changes hold longer — they are the thing players wait for. */
export const BANNER_MATCH_MS = 3_200;
/** A gunship pose older than this is dropped: at 20 Hz it is ten missed ticks, a dead airframe. */
export const POSE_STALE_MS = 500;

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export class GameClient {
  private readonly names = new Map<ActorId, string>();
  private readonly streakNames = new Map<string, string>();
  private readonly lastShotAt = new Map<ActorId, number>();
  private readonly samples = new Map<ActorId, PlayerSample>();
  private readonly edges: ClientEdge[] = [];
  private readonly banners = new BannerArbiter();
  /** The ordnance lane's projection: flights, smoke, drops, what we hold. Read by presentation. */
  readonly ordnance: OrdnanceView;

  private team: TeamId | null = null;
  private health: number | null = null;
  private alive = true;
  private match: MatchView = EMPTY_MATCH;
  private streak: StreakView = EMPTY_STREAK;
  private respawnAt: number | null = null;
  private now = 0;
  private blips: readonly MapBlip[] = [];
  private banner: { text: string; sub: string } | null = null;
  /** Latest gunship pose per instance, with the receipt time. Pruned in tick(). */
  private readonly aircraftById = new Map<number, { pose: AircraftView; rxAt: number }>();
  /** Chopper instanceIds this client has seen created, with the newest event `at` each. Never shrinks mid-match. */
  private readonly choppersSeen = new Map<number, number>();
  private possessed: GunnerView | null = null;

  constructor(readonly selfId: ActorId) {
    this.ordnance = new OrdnanceView(selfId);
  }

  /** Display names arrive from the roster, which `net/room.ts` owns. */
  setNames(names: Iterable<readonly [ActorId, string]>): void {
    for (const [id, name] of names) this.names.set(id, name);
  }

  /** Streak titles arrive from the streak catalog, which lane C owns. */
  setStreakNames(names: Iterable<readonly [string, string]>): void {
    for (const [id, name] of names) this.streakNames.set(id, name);
  }

  private ctx(): FeedContext {
    return { selfId: this.selfId, selfTeam: this.team, names: this.names, streakNames: this.streakNames };
  }

  private push(e: ClientEdge): void {
    this.edges.push(e);
  }

  private pushLine(l: { text: string; dest: FeedDestination; tone: FeedTone } | null): void {
    if (l !== null) this.push({ kind: 'feed', text: l.text, dest: l.dest, tone: l.tone });
  }

  private raiseBanner(text: string, sub: string, priority: 'announcement' | 'match-flow', ms: number | null): void {
    const d = this.banners.request({ id: nextBannerId++, priority, text, sub, durationMs: ms }, this.now);
    this.applyBanner(d);
  }

  private applyBanner(d: { kind: 'show'; text: string; sub: string } | { kind: 'hide' } | { kind: 'none' }): void {
    if (d.kind === 'none') return;
    if (d.kind === 'hide') {
      this.banner = null;
      this.push({ kind: 'banner-clear' });
      return;
    }
    this.banner = { text: d.text, sub: d.sub };
    this.push({ kind: 'banner', text: d.text, sub: d.sub });
  }

  // -------------------------------------------------------------------------

  applyEvent(e: GameEvent): void {
    if (e.at > this.now) this.now = e.at;
    if (isOrdnanceEvent(e)) {
      const l = this.ordnance.apply(e);
      if (l !== null) this.pushLine({ text: l.text, dest: 'events', tone: l.tone });
      return;
    }
    switch (e.type) {
      case 'damage':
        return this.onDamage(e);
      case 'kill': {
        this.lastShotAt.set(e.killerId, e.at);
        if (e.killerId === this.selfId) this.push({ kind: 'hit', marker: 'kill' });
        // The line is `feed.ts`'s; the knife glyph and the grenade tag are the ordnance lane's.
        const l = feedLineForKill(e, this.ctx());
        this.pushLine({ text: decorateKillLine(l.text, e), dest: l.dest, tone: l.tone });
        return;
      }
      case 'death':
        if (e.victimId === this.selfId) {
          this.alive = false;
          this.health = 0;
          this.respawnAt = e.respawnAt;
          // The runtime dismounts a dead owner silently; the death event is the notice.
          this.possessed = null;
          this.ordnance.note(e.at, 'death you by=' + String(e.killerId) + ' ' + e.cause);
        }
        this.pushLine(feedLineForDeath(e, this.ctx()));
        return;
      case 'spawn':
        if (e.actorId === this.selfId) {
          this.alive = true;
          this.team = e.team;
          this.respawnAt = null;
          this.ordnance.onSelfSpawn();
          this.ordnance.note(e.at, 'spawn you at=' + e.x.toFixed(1) + ',' + e.y.toFixed(1) + ',' + e.z.toFixed(1));
        }
        return;
      case 'shot-rejected':
        if (e.shooterId === this.selfId) {
          this.pushLine({ text: SHOT_REJECT_LABELS[e.reason], dest: 'events', tone: 'own' });
          this.ordnance.note(e.at, 'shot-rejected you seq=' + e.seq + ' ' + e.reason);
        }
        return;
      case 'streak-earned':
        this.pushLine(feedLineForStreakEarned(e, this.ctx()));
        return;
      case 'streak-activated': {
        const l = feedLineForStreakActivated(e, this.ctx());
        this.pushLine(l);
        this.raiseBanner(l.text, 'KILLSTREAK', 'announcement', BANNER_ANNOUNCE_MS);
        this.noteChopperActivated(e.actorId, e.streakId, e.instanceId, e.at);
        return;
      }
      case 'streak-denied':
        this.pushLine(feedLineForStreakDenied(e, this.ctx()));
        return;
      case 'streak-ended':
        this.noteChopperEnded(e.instanceId);
        return;
      case 'match-phase':
        return this.onPhase(e.phase, e.winner, e.winnerId, e.endReason);
      case 'feed':
        this.push({ kind: 'feed', text: e.text, dest: e.dest, tone: e.tone });
        return;
    }
  }

  private onDamage(e: DamageEvent): void {
    if (e.attackerId !== null) this.lastShotAt.set(e.attackerId, e.at);
    if (e.attackerId === this.selfId && e.victimId !== this.selfId) {
      this.push({ kind: 'hit', marker: markerFor(e.zone) });
    }
    if (e.victimId === this.selfId) {
      this.health = e.healthAfter;
      this.team = e.victimTeam;
      if (e.healthAfter > 0) {
        this.push({ kind: 'hurt', sourceX: e.sourceX, sourceZ: e.sourceZ, amount: e.amount });
      }
    }
    this.pushLine(feedLineForDamage(e, this.ctx()));
  }

  private onPhase(
    phase: MatchPhaseName,
    winner: TeamId | 'draw' | null,
    winnerId: string | null,
    endReason: MatchEndReason | null,
  ): void {
    this.match = { ...this.match, phase, winner, winnerId, endReason };
    // Instances never survive a match end (the runtime retires them all), and
    // instance ids restart at 1 — so a new match must forget the old airframes
    // or a creation would misread as a possess toggle.
    this.choppersSeen.clear();
    this.possessed = null;
    this.aircraftById.clear();
    if (phase === 'active') this.raiseBanner('ENGAGE', '', 'match-flow', BANNER_MATCH_MS);
    if (phase === 'ended') {
      const sub = endReason === 'time' ? 'TIME' : endReason === 'score' ? 'SCORE LIMIT' : '';
      this.raiseBanner(this.outcomeText(winner, winnerId), sub, 'match-flow', null);
    }
  }

  private outcomeText(winner: TeamId | 'draw' | null, winnerId: string | null): string {
    if (winner === 'draw') return 'DRAW';
    if (winnerId !== null) return winnerId === this.selfId ? 'VICTORY' : 'DEFEAT';
    if (winner === null || this.team === null) return 'MATCH OVER';
    return winner === this.team ? 'VICTORY' : 'DEFEAT';
  }

  /**
   * Own gunship activation: the FIRST event per instance is the creation, a
   * NEWER one for a known instance is the possess toggle. Compared on `at`,
   * so the streak-state edge replaying the same event object is a no-op and a
   * re-possess after a dismount still toggles. Other actors' gunships are
   * ignored: possession is first-person state.
   */
  private noteChopperActivated(actorId: ActorId, streakId: string, instanceId: number, at: number): void {
    if (actorId !== this.selfId || streakId !== 'chopper-gunner') return;
    const last = this.choppersSeen.get(instanceId);
    if (last === undefined) {
      this.choppersSeen.set(instanceId, at);
      return;
    }
    if (at <= last) return;
    this.choppersSeen.set(instanceId, at);
    this.possessed = this.possessed?.instanceId === instanceId
      ? null
      : { instanceId, streakId };
  }

  /** Dismount and expiry both clear a held platform. Idempotent: replays no-op. */
  private noteChopperEnded(instanceId: number): void {
    if (this.possessed?.instanceId === instanceId) this.possessed = null;
  }

  // -------------------------------------------------------------------------

  applySnapshot(s: ClientSnapshot): void {
    if (s.at > this.now) this.now = s.at;
    if (s.match) this.applyMatch(s.match);
    if (s.streak && s.streak.actorId === this.selfId) {
      const slots = s.streak.slots;
      this.streak = { kills: s.streak.kills, slots, ready: slots.filter((x) => x.charges > 0).length };
      if (s.streak.cause) this.applyEvent(s.streak.cause);
    }
    if (s.players) {
      this.samples.clear();
      for (const p of s.players) this.samples.set(p.id, p);
      const self = this.samples.get(this.selfId);
      if (self) {
        // `hp`/`team`/`alive` are optional on the wire: absent means no game
        // authority yet. Branch on undefined; never substitute a default.
        if (self.hp !== undefined) this.health = self.hp;
        if (self.team !== undefined) this.team = self.team;
        if (self.alive !== undefined) this.alive = self.alive;
      }
    }
    if (s.poses) {
      for (const p of s.poses) {
        this.aircraftById.set(p.instanceId, {
          pose: {
            instanceId: p.instanceId, streakId: p.streakId,
            x: p.x, y: p.y, z: p.z, yaw: p.yaw, cx: p.cx, cz: p.cz,
            remainingMs: p.remainingMs, rocketsLeft: p.rocketsLeft, cooldownMs: p.cooldownMs,
          },
          rxAt: s.at,
        });
      }
    }
    this.blips = this.computeBlips();
    this.applyBanner(this.banners.tick(this.now));
  }

  /**
   * The BO2 rule, applied here and nowhere else: team-mates always show, the
   * local player always shows, and an enemy shows only when close or when it
   * has fired recently (`game/minimap.ts:shouldRevealEnemy`). An enemy list
   * that always draws is a wallhack, and it is the single most common way a
   * browser FPS minimap goes wrong.
   */
  private computeBlips(): readonly MapBlip[] {
    const self = this.samples.get(this.selfId);
    const out: MapBlip[] = [];
    for (const p of this.samples.values()) {
      if (p.alive === false) continue;
      if (p.id === this.selfId) {
        out.push({ id: p.id, kind: 'self', x: p.x, z: p.z, yaw: p.yaw });
        continue;
      }
      const known = p.team !== undefined && this.team !== null;
      if (known && p.team === this.team) {
        out.push({ id: p.id, kind: 'ally', x: p.x, z: p.z, yaw: p.yaw });
        continue;
      }
      if (!known) continue;
      const dist = self ? Math.hypot(p.x - self.x, p.z - self.z) : Number.POSITIVE_INFINITY;
      if (!shouldRevealEnemy(dist, this.now, this.lastShotAt.get(p.id) ?? 0)) continue;
      out.push({ id: p.id, kind: 'enemy', x: p.x, z: p.z, yaw: p.yaw });
    }
    return out;
  }

  private applyMatch(m: MatchStateMsg): void {
    this.match = {
      mode: m.mode,
      phase: m.phase,
      msRemaining: m.endsAt === null ? null : Math.max(0, m.endsAt - m.at),
      scoreLimit: m.scoreLimit,
      teamScores: m.teamScores,
      rows: m.scores,
      winner: m.winner,
      winnerId: m.winnerId,
      endReason: m.endReason,
    };
  }

  // -------------------------------------------------------------------------

  /** Advance time without a snapshot: keeps the respawn clock and banners live. */
  tick(now: number): void {
    if (now > this.now) this.now = now;
    this.applyBanner(this.banners.tick(this.now));
    for (const [id, entry] of this.aircraftById) {
      if (this.now - entry.rxAt > POSE_STALE_MS) this.aircraftById.delete(id);
    }
  }

  view(): ClientView {
    const aircraft: AircraftView[] = [];
    for (const entry of this.aircraftById.values()) aircraft.push(entry.pose);
    aircraft.sort((a, b) => a.instanceId - b.instanceId);
    return {
      selfId: this.selfId,
      team: this.team,
      health: this.health,
      alive: this.alive,
      match: this.match,
      streak: this.streak,
      blips: this.blips,
      respawnMs: this.respawnAt === null ? null : Math.max(0, this.respawnAt - this.now),
      banner: this.banner,
      aircraft,
      gunner: this.possessed,
    };
  }

  /** Take every edge since the last call. The caller renders them, in order. */
  drain(): ClientEdge[] {
    if (this.edges.length === 0) return [];
    return this.edges.splice(0, this.edges.length);
  }
}

/** Hitmarker kind from the hit zone. `limb` reads as a body hit, not a miss. */
function markerFor(zone: HitZone): 'body' | 'head' {
  return zone === 'head' ? 'head' : 'body';
}
