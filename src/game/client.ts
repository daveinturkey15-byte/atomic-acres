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
  ShotFiredEvent,
  TeamId,
} from './events';
import type { MatchMode } from './rules';
import type { MatchStateMsg, PlayerSample, ScoreRow, StreakSlotState, StreakStateMsg } from '../net/protocol';
import { SHOT_REJECT_LABELS } from './events';
import { BannerArbiter, feedLineForDamage, feedLineForDeath, feedLineForKill, feedLineForStreakActivated, feedLineForStreakDenied, feedLineForStreakEarned, type FeedContext } from './feed';
import { shouldRevealEnemy, type MapBlip } from './minimap';
import { OrdnanceView, decorateKillLine, isOrdnanceEvent } from './ordnance-view';
import { MortarView, isMortarEvent } from './killstreaks/effects/mortar-view';
import { BoltView } from './crossbow-view';
import { isCrossbowEvent } from './events-crossbow';
import type { RadarSample } from './killstreaks/effects/reveal';
import type { StreakEffectView } from './killstreaks/effect-view';
import type { WeaponState } from './host-weapon-state';
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
}

/** One-shot presentation events. Consumed by `drain()`, never replayed. */
export type ClientEdge =
  | { readonly kind: 'hit'; readonly marker: 'body' | 'head' | 'kill' }
  | { readonly kind: 'hurt'; readonly sourceX: number; readonly sourceZ: number; readonly amount: number }
  | { readonly kind: 'feed'; readonly text: string; readonly dest: FeedDestination; readonly tone: FeedTone }
  | { readonly kind: 'banner'; readonly text: string; readonly sub: string }
  | { readonly kind: 'banner-clear' };

export interface ClientSnapshot {
  readonly weaponState?: WeaponState | null;
  readonly radar?: readonly RadarSample[];
  readonly effects?: readonly StreakEffectView[];
  readonly at: number;
  readonly match?: MatchStateMsg | null;
  readonly streak?: StreakStateMsg | null;
  readonly players?: readonly PlayerSample[];
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

/** Remote presentation edges are intentionally short-lived and bounded. */
export const REMOTE_SHOT_MAX_AGE_MS = 750;
export const REMOTE_SHOT_QUEUE_LIMIT = 24;
export const REMOTE_SHOT_RECENT_LIMIT = 128;

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export class GameClient {
  /** Private self-only projection, in the local clock and controller shot-seq domain. */
  weaponState: WeaponState | null = null;
  private weaponLife = 0;
  private weaponEpochAt = -Infinity;
  readonly streakEffects: StreakEffectView[] = [];
  streakEffectsAt = 0;
  private radar: readonly RadarSample[] = [];
  private readonly streakCauseKeys = new Set<string>();
  private readonly streakCauseOrder: string[] = [];
  private lastSnapshotCauseId: string | null = null;

  private rememberStreakCause(key: string): boolean {
    if (this.streakCauseKeys.has(key)) return false;
    this.streakCauseKeys.add(key); this.streakCauseOrder.push(key);
    if (this.streakCauseOrder.length > 128) this.streakCauseKeys.delete(this.streakCauseOrder.shift()!);
    return true;
  }
  private readonly names = new Map<ActorId, string>();
  private readonly streakNames = new Map<string, string>();
  private readonly lastShotAt = new Map<ActorId, number>();
  private readonly remoteShots: ShotFiredEvent[] = [];
  /** Recent identity cache survives presentation drains, unlike the pending queue. */
  private readonly remoteShotKeys = new Set<string>();
  private readonly remoteShotKeyOrder: string[] = [];
  private readonly samples = new Map<ActorId, PlayerSample>();
  private readonly edges: ClientEdge[] = [];
  private readonly banners = new BannerArbiter();
  /** The ordnance lane's projection: flights, smoke, drops, what we hold. Read by presentation. */
  readonly ordnance: OrdnanceView;
  /** The mortar projection: host-authoritative warning discs + recent detonations. Read by presentation. Spectators read the same bus. */
  readonly mortar: MortarView;
  /** The crossbow canary projection: host-authoritative live bolts + recent terminal points. Read by presentation. Spectators read the same bus. */
  readonly crossbow: BoltView;

  private team: TeamId | null = null;
  private health: number | null = null;
  private alive = true;
  private match: MatchView = EMPTY_MATCH;
  private streak: StreakView = EMPTY_STREAK;
  private respawnAt: number | null = null;
  private now = 0;
  private blips: readonly MapBlip[] = [];
  private banner: { text: string; sub: string } | null = null;

  constructor(readonly selfId: ActorId) {
    this.ordnance = new OrdnanceView(selfId);
    this.mortar = new MortarView();
    this.crossbow = new BoltView();
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
    if (e.type === 'streak-earned' || e.type === 'streak-activated' || e.type === 'streak-denied' || e.type === 'streak-ended') {
      if (!this.rememberStreakCause(JSON.stringify(e))) return;
    }
    if (e.at > this.now) this.now = e.at;
    if (isMortarEvent(e) || e.type === 'streak-ended') {
      this.mortar.apply(e);
    }
    if (isCrossbowEvent(e)) {
      this.crossbow.apply(e);
      return;
    }
    if (e.type === 'match-phase') {
      // Bolt retirement on match end rides with the match edge; the phase
      // itself still reaches the switch below. Counts stay cumulative.
      this.crossbow.apply(e);
    }
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
          this.weaponState = null;
          this.weaponEpochAt = Math.max(this.weaponEpochAt, e.at);
          this.alive = false;
          this.health = 0;
          this.respawnAt = e.respawnAt;
          this.ordnance.note(e.at, 'death you by=' + String(e.killerId) + ' ' + e.cause);
        }
        this.pushLine(feedLineForDeath(e, this.ctx()));
        return;
      case 'spawn':
        if (e.actorId === this.selfId) {
          this.weaponLife = e.reason === 'initial' ? 1 : Math.max(1, this.weaponLife + 1);
          this.weaponState = null;
          this.weaponEpochAt = e.at;
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
      case 'shot-fired': {
        // Local prediction already played this shot. Host echo must not double it.
        if (e.actorId === this.selfId) return;
        const age = this.now - e.at;
        if (age > REMOTE_SHOT_MAX_AGE_MS) return;
        const key = remoteShotKey(e);
        if (this.remoteShotKeys.has(key)) return;
        if (this.remoteShotKeys.size >= REMOTE_SHOT_RECENT_LIMIT) {
          const evicted = this.remoteShotKeyOrder.shift();
          if (evicted !== undefined) this.remoteShotKeys.delete(evicted);
        }
        this.remoteShotKeys.add(key);
        this.remoteShotKeyOrder.push(key);
        if (this.remoteShots.length >= REMOTE_SHOT_QUEUE_LIMIT) {
          this.remoteShots.shift();
        }
        this.remoteShots.push(e);
        return;
      }
      case 'streak-earned':
        this.pushLine(feedLineForStreakEarned(e, this.ctx()));
        return;
      case 'streak-activated': {
        const l = feedLineForStreakActivated(e, this.ctx());
        this.pushLine(l);
        this.raiseBanner(l.text, 'KILLSTREAK', 'announcement', BANNER_ANNOUNCE_MS);
        return;
      }
      case 'streak-denied':
        this.pushLine(feedLineForStreakDenied(e, this.ctx()));
        return;
      case 'streak-ended':
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

  // -------------------------------------------------------------------------

  applySnapshot(s: ClientSnapshot): void {
    if (s.weaponState === null) this.weaponState = null;
    else if (s.weaponState !== undefined) {
      const state = s.weaponState, previous = this.weaponState;
      const currentLife = this.weaponLife === 0 || state.life === this.weaponLife;
      const forward = previous === null || state.revision > previous.revision ||
        (state.revision === previous.revision && state.at >= previous.at);
      if (currentLife && state.at >= this.weaponEpochAt && forward) {
        this.weaponLife = state.life;
        this.weaponState = { ...state, primary: { ...state.primary }, sidearm: { ...state.sidearm },
          resolvedShotSeqs: [...state.resolvedShotSeqs] };
      }
    }
    if (s.radar !== undefined) this.radar = s.radar;
    if (s.effects !== undefined) { this.streakEffectsAt = s.at; this.streakEffects.length = 0; this.streakEffects.push(...s.effects); }
    if (s.at > this.now) this.now = s.at;
    if (s.match) this.applyMatch(s.match);
    if (s.streak && s.streak.actorId === this.selfId) {
      const slots = s.streak.slots;
      this.streak = { kills: s.streak.kills, slots, ready: slots.filter((x) => x.charges > 0).length };
      if (s.streak.cause) {
        const key = s.streak.causeId ?? JSON.stringify(s.streak.cause);
        const changed = key !== this.lastSnapshotCauseId;
        this.lastSnapshotCauseId = key;
        if (changed && !this.streakCauseKeys.has(key)) {
          this.applyEvent(s.streak.cause);
          // The localized event key can differ from the stable host cause id.
          if (!this.streakCauseKeys.has(key)) this.rememberStreakCause(key);
        }
      }
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
      if (shouldRevealEnemy(dist, this.now, this.lastShotAt.get(p.id) ?? 0)) {
        out.push({ id: p.id, kind: 'enemy', x: p.x, z: p.z, yaw: p.yaw });
      } else {
        const sensor = this.radar.find(r => r.id === p.id && r.expiresAt > this.now);
        if (sensor) out.push({ id: p.id, kind: 'enemy', x: sensor.x, z: sensor.z, yaw: 0 });
      }
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
  }

  /** Zero-allocation liveness read for world presentation code. */
  isAlive(): boolean { return this.alive; }

  /** Drain remote shot edges into caller-owned storage; empty drains allocate nothing. */
  drainRemoteShots(out: ShotFiredEvent[]): number {
    if (this.remoteShots.length === 0) return 0;
    out.length = 0;
    for (let i = 0; i < this.remoteShots.length; i++) out.push(this.remoteShots[i]);
    this.remoteShots.length = 0;
    return out.length;
  }

  view(): ClientView {
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

function remoteShotKey(e: ShotFiredEvent): string {
  return `${e.actorId}:${e.life}:${e.seq}`;
}
