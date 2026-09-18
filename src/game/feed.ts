/**
 * Nuketown 2025 — feed lines, feed routing, and the banner arbiter.
 *
 * Produces STRINGS AND TONES. It renders nothing, owns no element, and knows
 * no HUD: `ui/hud.ts` takes a line and a destination and writes text. That
 * split is the whole point — the old project's `addFeed` sat inside a 100-line
 * `applyDamage` that also played audio, rumbled the pad and exited pointer
 * lock (IMPORT-PLAN §5.2).
 *
 * Display names arrive as DATA (`FeedContext.names`, `FeedContext.streakNames`)
 * rather than being looked up here. A roster of streak titles written out in
 * this file would be a mirror of `game/killstreaks/catalog.ts`, and a mirror is
 * a defect even while it agrees (IMPORT-PLAN §5.5). Unknown ids degrade to the
 * id itself, uppercased, which is ugly on purpose: a missing name should be
 * visible, not silently plausible.
 */

import type {
  ActorId,
  DamageEvent,
  DeathEvent,
  FeedDestination,
  FeedLineEvent,
  FeedTone,
  KillEvent,
  StreakActivatedEvent,
  StreakDeniedEvent,
  StreakEarnedEvent,
  TeamId,
} from './events';
import { STREAK_DENIAL_LABELS } from './events';

// ---------------------------------------------------------------------------
// Capacity — the authority for how much feed exists
// ---------------------------------------------------------------------------

/**
 * Six event rows, eight damage rows, seven seconds. Old `hud-feed.ts`
 * (`EVENT_FEED_LIMIT`, `DAMAGE_FEED_LIMIT`, `DAMAGE_FEED_VISIBLE_MS`) — the one
 * module IMPORT-PLAN §1.4 calls "exactly right", so the numbers come across
 * unchanged.
 *
 * BEFORE, in this repo: `ui/layout.ts` held `KILLFEED_MAX = 5` and
 * `KILLFEED_MS = 5000`, invented by the HUD lane when no feed authority
 * existed. Those two constants are gone from `ui/layout.ts`; the HUD imports
 * these, so the pool size and the row lifetime have one owner.
 */
export const FEED_EVENT_LIMIT = 6;
export const FEED_DAMAGE_LIMIT = 8;
export const FEED_VISIBLE_MS = 7_000;

/** Rows a destination keeps. Derived, so a new destination cannot be forgotten. */
export function feedLimit(dest: FeedDestination): number {
  return dest === 'events' ? FEED_EVENT_LIMIT : FEED_DAMAGE_LIMIT;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type DamageFeedDetails = Readonly<{ damageDealt?: number; damageTaken?: number }>;

/**
 * Kill feed vs damage-done vs damage-taken. Ported whole from the old
 * `hud-feed.ts`: a row that is only about damage dealt goes right, a row only
 * about damage taken goes left, anything else — including a row that is about
 * both — is an event.
 */
export function feedDestination(details?: DamageFeedDetails): FeedDestination {
  if (details?.damageDealt !== undefined && details.damageTaken === undefined) return 'damage-done';
  if (details?.damageTaken !== undefined && details.damageDealt === undefined) return 'damage-taken';
  return 'events';
}

/** Screen-reader prefix per destination: three identical numbers otherwise. */
export function accessibleFeedLabel(dest: FeedDestination, text: string): string {
  if (dest === 'damage-done') return 'Damage done: ' + text;
  if (dest === 'damage-taken') return 'Damage taken: ' + text;
  return text;
}

// ---------------------------------------------------------------------------
// Context and tone
// ---------------------------------------------------------------------------

export interface FeedContext {
  readonly selfId: ActorId;
  /** null before the host has assigned one. Never substitute a team. */
  readonly selfTeam: TeamId | null;
  readonly names: ReadonlyMap<ActorId, string>;
  /** streakId → display title, owned by the streak catalog, not by this file. */
  readonly streakNames?: ReadonlyMap<string, string>;
}

export function displayName(ctx: FeedContext, id: ActorId): string {
  return ctx.names.get(id) ?? id.toUpperCase();
}

export function streakTitle(ctx: FeedContext, streakId: string): string {
  return ctx.streakNames?.get(streakId) ?? streakId.replace(/[-_]/g, ' ').toUpperCase();
}

/**
 * Whose event this is. `own` beats `friendly`, which is why the local player's
 * own kill never reads as a team-mate's. `neutral` is the honest answer while
 * `selfTeam` is null — a guest that guesses a team mis-colours the whole feed.
 */
export function feedTone(ctx: FeedContext, actorId: ActorId | null, actorTeam: TeamId | null): FeedTone {
  if (actorId !== null && actorId === ctx.selfId) return 'own';
  if (ctx.selfTeam === null || actorTeam === null) return 'neutral';
  return actorTeam === ctx.selfTeam ? 'friendly' : 'enemy';
}

function line(at: number, text: string, dest: FeedDestination, tone: FeedTone): FeedLineEvent {
  return { type: 'feed', at, text, dest, tone };
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** Separator between killer and victim. One place, so the feed reads uniform. */
export const KILL_SEPARATOR = '»';

/**
 * The kill-feed row. Tone follows the KILLER, because that is who the row is
 * about; a row for your own death still reads `enemy` because the enemy is the
 * killer. Headshot and team-kill are DERIVED (`zone === 'head'`,
 * `killerTeam === victimTeam`) and never carried as fields.
 */
export function feedLineForKill(e: KillEvent, ctx: FeedContext): FeedLineEvent {
  const parts = [displayName(ctx, e.killerId), KILL_SEPARATOR, displayName(ctx, e.victimId)];
  if (e.zone === 'head') parts.push('[HS]');
  if (e.killerTeam === e.victimTeam) parts.push('[TEAM]');
  return line(e.at, parts.join(' '), 'events', feedTone(ctx, e.killerId, e.killerTeam));
}

/** A death nobody was credited with: a fall, a suicide, world damage. */
export function feedLineForDeath(e: DeathEvent, ctx: FeedContext): FeedLineEvent | null {
  if (e.killerId !== null) return null;
  const cause = e.cause === 'fall' ? 'FELL' : 'DIED';
  return line(e.at, displayName(ctx, e.victimId) + ' ' + cause, 'events', feedTone(ctx, e.victimId, e.victimTeam));
}

/**
 * The damage number, routed to the side it belongs on. Returns null for a hit
 * the local player was neither end of — a spectator's damage numbers are noise,
 * and the old project's zero-damage feedback module exists because rows it had
 * no business showing kept arriving.
 */
export function feedLineForDamage(e: DamageEvent, ctx: FeedContext): FeedLineEvent | null {
  const amount = Math.max(1, Math.round(e.amount));
  if (e.attackerId === ctx.selfId && e.victimId !== ctx.selfId) {
    return line(
      e.at,
      amount + '  ' + displayName(ctx, e.victimId),
      feedDestination({ damageDealt: amount }),
      feedTone(ctx, e.victimId, e.victimTeam),
    );
  }
  if (e.victimId === ctx.selfId) {
    const from = e.attackerId === null ? 'WORLD' : displayName(ctx, e.attackerId);
    return line(
      e.at,
      amount + '  ' + from,
      feedDestination({ damageTaken: amount }),
      feedTone(ctx, e.attackerId, e.attackerTeam),
    );
  }
  return null;
}

/** "CARE PACKAGE READY" — earned, not yet spent. Only the earner sees it. */
export function feedLineForStreakEarned(e: StreakEarnedEvent, ctx: FeedContext): FeedLineEvent | null {
  if (e.actorId !== ctx.selfId) return null;
  return line(e.at, streakTitle(ctx, e.streakId) + ' READY', 'events', 'own');
}

/**
 * The announcement every peer hears, naming the streak and telling own,
 * friendly and enemy apart — the old awareness module's pinned behaviour. Tone
 * carries the distinction so no string has to say "ENEMY" twice.
 */
export function feedLineForStreakActivated(e: StreakActivatedEvent, ctx: FeedContext): FeedLineEvent {
  const tone = feedTone(ctx, e.actorId, e.team);
  const who = tone === 'own' ? 'YOUR' : tone === 'enemy' ? 'ENEMY' : tone === 'friendly' ? 'ALLIED' : '';
  const title = streakTitle(ctx, e.streakId);
  return line(e.at, (who ? who + ' ' : '') + title, 'events', tone);
}

/**
 * The refusal, spelled out. The label is looked up, never carried on the event
 * and never re-worded here — this row is the whole reason IMPORT-PLAN §5.4
 * exists, because in the old project a blocked slot press produced silence for
 * weeks before an owner reported it.
 */
export function feedLineForStreakDenied(e: StreakDeniedEvent, ctx: FeedContext): FeedLineEvent | null {
  if (e.actorId !== ctx.selfId) return null;
  return line(e.at, streakTitle(ctx, e.streakId) + ': ' + STREAK_DENIAL_LABELS[e.reason], 'events', 'own');
}

// ---------------------------------------------------------------------------
// Banner arbiter
// ---------------------------------------------------------------------------

export const BANNER_PRIORITIES = ['announcement', 'match-flow', 'fatal'] as const;
export type BannerPriority = (typeof BANNER_PRIORITIES)[number];

/** Rank is the index in the frozen list: a new tier is one array entry. */
function rank(p: BannerPriority): number {
  return BANNER_PRIORITIES.indexOf(p);
}

export interface BannerRequest {
  /** Caller-unique. An expiry only ever applies to its own request. */
  readonly id: number;
  readonly priority: BannerPriority;
  readonly text: string;
  readonly sub: string;
  /** null holds until cleared or superseded. */
  readonly durationMs: number | null;
}

export type BannerDisplay =
  | { readonly kind: 'show'; readonly text: string; readonly sub: string }
  | { readonly kind: 'hide' }
  | { readonly kind: 'none' };

const NONE: BannerDisplay = { kind: 'none' };
const HIDE: BannerDisplay = { kind: 'hide' };

/**
 * One banner at a time, three priorities, explicit expiry.
 *
 * The failure it prevents, measured in the old project: the centre banner was
 * shared unarbitrated state with five writers, so a streak announcement landing
 * inside the match-start window overwrote it, and the match-start timeout then
 * hid whatever was showing — including the announcement players were meant to
 * read. Here an expiry that does not name the ACTIVE request does nothing, so
 * a late timer can never hide someone else's banner.
 *
 * Equal or higher rank takes over. A lower-rank request queues (newest
 * highest-rank loser only) and is promoted with a fresh duration when the
 * active one ends, so a deferred banner still gets its full read.
 */
export class BannerArbiter {
  private active: BannerRequest | null = null;
  private queued: BannerRequest | null = null;
  private shownAt = 0;

  current(): BannerRequest | null {
    return this.active;
  }

  pending(): BannerRequest | null {
    return this.queued;
  }

  request(r: BannerRequest, now: number): BannerDisplay {
    if (this.active === null || rank(r.priority) >= rank(this.active.priority)) {
      this.queued = this.queued?.id === r.id ? null : this.queued;
      return this.show(r, now);
    }
    if (this.queued === null || rank(r.priority) >= rank(this.queued.priority)) this.queued = r;
    return NONE;
  }

  /** A timed banner ran out. Ignored unless `id` is the one on screen. */
  expire(id: number, now: number): BannerDisplay {
    if (this.active === null || this.active.id !== id) return NONE;
    const next = this.queued;
    this.queued = null;
    this.active = null;
    return next === null ? this.hide() : this.show(next, now);
  }

  /** Level-triggered expiry for a game loop: cheaper and race-free vs a timer. */
  tick(now: number): BannerDisplay {
    const a = this.active;
    if (a === null || a.durationMs === null) return NONE;
    if (now - this.shownAt < a.durationMs) return NONE;
    return this.expire(a.id, now);
  }

  clear(): BannerDisplay {
    this.active = null;
    this.queued = null;
    return this.hide();
  }

  private show(r: BannerRequest, now: number): BannerDisplay {
    this.active = r;
    this.shownAt = now;
    return { kind: 'show', text: r.text, sub: r.sub };
  }

  private hide(): BannerDisplay {
    this.shownAt = 0;
    return HIDE;
  }
}
