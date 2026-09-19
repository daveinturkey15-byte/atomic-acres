/**
 * Atomic Acres — HUD construction. Every node in `#hud`, built exactly once.
 *
 * Split out of `hud.ts` because the two together passed the 400-line cap in
 * `AGENTS.md`, and because the split names the contract: everything that can
 * create a DOM node lives in THIS file and runs THIS ONCE. `hud.ts` afterwards
 * only writes `textContent`, flips classes and sets custom properties. If a
 * `createElement` ever appears in `hud.ts`, the contract has been broken and
 * the proof's node counter will say so.
 *
 * Pools are sized from their authorities, not from a number typed here:
 * feed rows from `game/feed.ts`, scoreboard rows from `net/protocol.ts`'s
 * `MAX_PLAYERS`, streak slots from `STREAK_SLOTS`.
 */

import { FEED_DAMAGE_LIMIT, FEED_EVENT_LIMIT } from '../game/feed';
import type { FeedDestination } from '../game/events';
import { MAX_PLAYERS } from '../net/protocol';
import { MAP_PX } from './layout';

/** Five slots, as the old `KillstreakLoadoutV1`. Lane C owns their contents. */
export const STREAK_SLOTS = 5;

export interface FeedPool {
  readonly rows: readonly HTMLElement[];
  readonly timers: number[];
  next: number;
}

export interface ScoreRowNodes {
  readonly root: HTMLElement;
  readonly name: HTMLElement;
  readonly kills: HTMLElement;
  readonly deaths: HTMLElement;
  readonly score: HTMLElement;
}

export interface HudNodes {
  readonly root: HTMLElement;
  readonly crosshair: HTMLElement | null;
  readonly weapon: HTMLElement;
  readonly weaponName: HTMLElement;
  readonly reload: HTMLElement;
  readonly ammo: HTMLElement;
  readonly mag: HTMLElement;
  readonly reserve: HTMLElement;
  readonly health: HTMLElement;
  readonly hpFill: HTMLElement;
  readonly hpLabel: HTMLElement;
  readonly vignette: HTMLElement;
  readonly dmgdir: HTMLElement;
  readonly hit: HTMLElement;
  readonly feeds: Readonly<Record<FeedDestination, FeedPool>>;
  readonly bar: HTMLElement;
  readonly barMode: HTMLElement;
  readonly barClock: HTMLElement;
  readonly barTeamA: HTMLElement;
  readonly barTeamB: HTMLElement;
  readonly banner: HTMLElement;
  readonly bannerText: HTMLElement;
  readonly bannerSub: HTMLElement;
  readonly respawn: HTMLElement;
  readonly streak: HTMLElement;
  readonly streakKills: HTMLElement;
  readonly streakSlots: readonly HTMLElement[];
  readonly mapCanvas: HTMLCanvasElement;
  readonly scoreboard: HTMLElement;
  readonly scoreRows: readonly ScoreRowNodes[];
  /** Ordnance lane: grenade counts (above the ammo), the flash white-out, the pickup prompt. */
  readonly grenades: HTMLElement;
  readonly grenadeLethal: HTMLElement;
  readonly grenadeTactical: HTMLElement;
  readonly flash: HTMLElement;
  readonly prompt: HTMLElement;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function span(cls: string, text = ''): HTMLElement {
  return el('span', cls, text);
}

function feedPool(parent: HTMLElement, cls: string, size: number, label: string): FeedPool {
  const box = el('div', 'hud-own ' + cls);
  box.setAttribute('role', 'log');
  box.setAttribute('aria-label', label);
  const rows: HTMLElement[] = [];
  const timers: number[] = [];
  for (let i = 0; i < size; i++) {
    const row = el('div', 'hud-feed-row hud-feed-hidden');
    box.appendChild(row);
    rows.push(row);
    timers.push(0);
  }
  parent.appendChild(box);
  return { rows, timers, next: 0 };
}

export function buildHud(root: HTMLElement, crosshair: HTMLElement | null): HudNodes {
  // --- crosshair: 4 child spans driven by a --xh-gap CSS var ---------------
  if (crosshair) {
    crosshair.classList.add('xh-lines');
    for (const c of ['xh-n', 'xh-s', 'xh-e', 'xh-w']) crosshair.appendChild(span('xh ' + c));
  }

  // Tag the pre-existing debug divs main.ts appended (first three div children
  // at init, if present) so setDebugVisible hides ONLY those.
  try {
    const kids = root.querySelectorAll(':scope > div');
    for (let i = 0; i < 3 && i < kids.length; i++) kids[i].classList.add('hud-debug');
  } catch {
    /* never throw when absent */
  }

  // --- weapon + ammo (bottom-right) ----------------------------------------
  const weapon = el('div', 'hud-own hud-weapon');
  const weaponName = span('hud-weapon-name', 'Longhorn');
  const reload = span('hud-reload hud-reload-hidden', 'RELOADING');
  weapon.append(weaponName, reload);

  const ammo = el('div', 'hud-own hud-ammo');
  const mag = span('hud-mag', '30');
  const reserve = span('hud-reserve', '120');
  ammo.append(mag, span('hud-ammo-sep', ' / '), reserve);

  // --- health (bottom-left) + damage vignette -------------------------------
  const health = el('div', 'hud-own hud-health');
  const hpTrack = el('div', 'hud-hp-track');
  const hpFill = el('div', 'hud-hp-fill');
  const hpLabel = span('hud-hp-label', '100');
  hpTrack.appendChild(hpFill);
  health.append(hpTrack, hpLabel);
  const vignette = el('div', 'hud-own hud-vignette');

  // --- damage-direction arc: rotated via transform only ---------------------
  const dmgdir = el('div', 'hud-own hud-dmgdir hud-dmgdir-hidden');
  dmgdir.appendChild(el('div', 'hud-dmgdir-arc'));

  // --- hitmarker: 4 strokes, opacity + scale only ---------------------------
  const hit = el('div', 'hud-own hud-hitmarker');
  for (let i = 0; i < 4; i++) hit.appendChild(span('hm-a hm-' + i));

  // --- feeds: one pool per destination, recycled round-robin ----------------
  const feeds: Record<FeedDestination, FeedPool> = {
    'events': feedPool(root, 'hud-killfeed', FEED_EVENT_LIMIT, 'Event feed'),
    'damage-done': feedPool(root, 'hud-feed-done', FEED_DAMAGE_LIMIT, 'Damage done'),
    'damage-taken': feedPool(root, 'hud-feed-taken', FEED_DAMAGE_LIMIT, 'Damage taken'),
  };

  // --- match bar (top-centre): mode, clock, two team scores -----------------
  const bar = el('div', 'hud-own hud-matchbar hud-hidden');
  const barMode = span('hud-bar-mode');
  const barClock = span('hud-bar-clock');
  const barTeamA = span('hud-bar-score hud-team-a');
  const barTeamB = span('hud-bar-score hud-team-b');
  bar.append(barTeamA, barMode, barClock, barTeamB);

  // --- banner + respawn (centre) --------------------------------------------
  const banner = el('div', 'hud-own hud-banner hud-hidden');
  banner.setAttribute('role', 'status');
  const bannerText = el('div', 'hud-banner-text');
  const bannerSub = el('div', 'hud-banner-sub');
  banner.append(bannerText, bannerSub);
  const respawn = el('div', 'hud-own hud-respawn hud-hidden');
  respawn.setAttribute('role', 'status');

  // --- streak strip (bottom-centre) -----------------------------------------
  const streak = el('div', 'hud-own hud-streak hud-hidden');
  const streakKills = span('hud-streak-kills', '0');
  streak.appendChild(streakKills);
  const streakSlots: HTMLElement[] = [];
  for (let i = 0; i < STREAK_SLOTS; i++) {
    const s = span('hud-streak-slot hud-hidden');
    streak.appendChild(s);
    streakSlots.push(s);
  }

  // --- minimap (top-left) ----------------------------------------------------
  const mapWrap = el('div', 'hud-own hud-minimap');
  mapWrap.append(el('div', 'hud-map-title', 'ATOMIC ACRES'));
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = MAP_PX;
  mapCanvas.height = MAP_PX;
  mapCanvas.className = 'hud-map-canvas';
  mapWrap.appendChild(mapCanvas);

  // --- scoreboard (hold Tab) -------------------------------------------------
  const scoreboard = el('div', 'hud-own hud-score hud-score-hidden');
  const head = el('div', 'hud-score-row hud-score-head');
  head.append(span('hud-score-name', 'PLAYER'), span('hud-score-n', 'K'), span('hud-score-n', 'D'), span('hud-score-n', 'PTS'));
  scoreboard.append(el('div', 'hud-score-title', 'SCOREBOARD'), head);
  const scoreRows: ScoreRowNodes[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const row = el('div', 'hud-score-row hud-hidden');
    const name = span('hud-score-name');
    const kills = span('hud-score-n');
    const deaths = span('hud-score-n');
    const score = span('hud-score-n');
    row.append(name, kills, deaths, score);
    scoreboard.appendChild(row);
    scoreRows.push({ root: row, name, kills, deaths, score });
  }

  // --- ordnance (ordnance lane): grenade counts, flash white-out, pickup prompt --
  // Positioned inline because `hud.css` belongs to another lane; these are
  // one-time writes at build, the same contract as the palette custom
  // properties. Animation is opacity only (the flash) - never layout.
  const grenades = el('div', 'hud-own hud-grenades');
  grenades.style.cssText = 'position:fixed;right:22px;bottom:84px;font-size:15px;letter-spacing:0.14em;'
    + 'display:flex;gap:18px;justify-content:flex-end;';
  const grenadeLethal = span('hud-grenade-lethal', '\u25CF FRAG 1');
  const grenadeTactical = span('hud-grenade-tactical', '\u25C6 FLASH 1');
  grenades.append(grenadeLethal, grenadeTactical);
  const flash = el('div', 'hud-own hud-flashout');
  flash.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#fff;opacity:0;will-change:opacity;';
  flash.setAttribute('aria-hidden', 'true');
  const prompt = el('div', 'hud-own hud-prompt hud-hidden');
  prompt.style.cssText = 'position:fixed;left:50%;top:64%;transform:translateX(-50%);font-size:15px;'
    + 'letter-spacing:0.18em;padding:6px 14px;border:1px solid rgba(240,236,226,0.55);border-radius:3px;'
    + 'background:rgba(0,0,0,0.35);';
  prompt.setAttribute('role', 'status');

  root.append(weapon, ammo, health, vignette, dmgdir, hit, bar, banner, respawn, streak, mapWrap, scoreboard,
    grenades, flash, prompt);
  root.classList.add('hud-debug-hidden');

  return {
    root,
    crosshair,
    weapon,
    weaponName,
    reload,
    ammo,
    mag,
    reserve,
    health,
    hpFill,
    hpLabel,
    vignette,
    dmgdir,
    hit,
    feeds,
    bar,
    barMode,
    barClock,
    barTeamA,
    barTeamB,
    banner,
    bannerText,
    bannerSub,
    respawn,
    streak,
    streakKills,
    streakSlots,
    mapCanvas,
    scoreboard,
    scoreRows,
    grenades,
    grenadeLethal,
    grenadeTactical,
    flash,
    prompt,
  };
}
