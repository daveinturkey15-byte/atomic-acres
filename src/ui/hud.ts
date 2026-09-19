/**
 * Atomic Acres — HUD.
 *
 * BO2 composition (bottom-corner heavy, thin condensed type, desaturated with
 * one amber accent), our own identity: no Activision/Treyarch marks, accent and
 * danger read off `PAL` so the UI and the world agree.
 *
 * Efficiency contract, unchanged by the widening and now MEASURED rather than
 * asserted (see `scripts/_readouts-proof.mjs`, node-creation counter):
 * - Every node is built ONCE, in `hud-build.ts`. This file contains no
 *   `createElement`: afterwards only `textContent` writes, class flips and CSS
 *   custom properties.
 * - Every setter caches its last-written value and returns early when nothing
 *   changed. Caches start at impossible values so the first real push always
 *   writes, whatever the weapon defs say today.
 * - Animation runs on `transform` and `opacity` only. The health bar fills via
 *   `scaleX`, not `width`.
 * - Every feed is a fixed pool of rows, recycled round-robin. A feed event is
 *   one `textContent` write plus two class flips.
 *
 * The API is wide because game state is wide (IMPORT-PLAN §2 "Changes needed").
 * It takes STRUCTS, not strings: `setScore(ScoreView)` rather than
 * `setScore(text)` means the HUD can render a scoreboard and a match bar from
 * the same push, and the caller cannot smuggle a formatted opinion through.
 */

import { FEED_VISIBLE_MS, accessibleFeedLabel } from '../game/feed';
import type { FeedDestination, FeedTone } from '../game/events';
import type { MapBlip } from '../game/minimap';
import { buildHud, type HudNodes } from './hud-build';
import { bindMatchSurfaces, type ScoreView, type StreakHudView } from './hud-match';
import { createMapPainter, type MapPainter } from './hud-map';
import type { Accessibility } from './settings';
import {
  ASSUMED_MAG,
  DMGDIR_MS,
  HIT_BODY_MS,
  HIT_HEAD_MS,
  HIT_KILL_MS,
  LOW_AMMO,
  LOW_HP,
  MAP_POS_Q,
  MAP_YAW_Q,
  MAP_ZOOM,
  UI_ACCENT,
  UI_DANGER,
  UI_INK,
  XH_GAP_FIRING,
  XH_GAP_MOVING,
  XH_GAP_STILL,
  palCss,
} from './layout';

export type HitKind = 'body' | 'head' | 'kill';

const HIT_MS: Readonly<Record<HitKind, number>> = { body: HIT_BODY_MS, head: HIT_HEAD_MS, kill: HIT_KILL_MS };

/**
 * The match-state surfaces live in `hud-match.ts` (the pair passed the 400-line
 * cap). Their view types are re-exported here so `HudApi` remains the single
 * import target for a caller.
 */
export type { ScoreRowView, ScoreView, StreakHudView, StreakSlotView } from './hud-match';

export interface HudApi {
  setAmmo(mag: number, reserve: number): void;
  setWeapon(name: string, reloading?: boolean): void;
  setHealth(hp: number): void;
  /** Match bar + scoreboard. `null` hides both (no match in progress). */
  setScore(s: ScoreView | null): void;
  /** Streak ladder strip. `null` hides it. */
  setStreak(v: StreakHudView | null): void;
  /** Centre banner. `null` hides. The arbiter in `game/feed.ts` decides what. */
  setBanner(text: string | null, sub?: string): void;
  /** Minimap blips, already filtered by the reveal rule. */
  setBlips(list: readonly MapBlip[]): void;
  /** Respawn countdown in whole seconds; `null` hides. */
  setRespawn(secs: number | null): void;
  /** One feed row, routed to its destination. */
  feed(line: string, dest: FeedDestination, tone?: FeedTone): void;
  damageFlash(): void;
  /** Red edge arc pointing at a world-space damage source. Event-rate. */
  damageFrom(srcX: number, srcZ: number, px: number, pz: number, yaw: number): void;
  hitmarker(kind: HitKind): void;
  setMoving(moving: boolean): void;
  setFiring(firing: boolean): void;
  setADS(ads: boolean): void;
  setPlayer(x: number, z: number, yaw: number): void;
  setDebugVisible(v: boolean): void;
  /** Accessibility trio from `ui/settings.ts`; the HUD reads two of the three. */
  setAccessibility(a: Accessibility): void;
  /** Ordnance lane: grenade charges held, which tactical, and whether one is armed (pin out). Level. */
  setGrenades(lethal: number, tactical: number, tacticalId: string, armed: string | null): void;
  /** Ordnance lane: flashbang white-out opacity 0..1. Level, every frame; opacity only. */
  setFlash(opacity: number): void;
  /** Ordnance lane: the pickup prompt ("HOLD E TO SWAP · LONGHORN"); `null` hides. Level. */
  setPrompt(text: string | null): void;
}

/**
 * Screen angle of a world-space source around the player: 0 is forward/top,
 * positive is camera-right/clockwise. Camera forward is
 * (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
 */
export function sourceAngle(srcX: number, srcZ: number, px: number, pz: number, yaw: number): number {
  const dx = srcX - px;
  const dz = srcZ - pz;
  if (dx * dx + dz * dz < 1e-12) return 0;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
}

function noopApi(): HudApi {
  const noop = (): void => undefined;
  return {
    setAmmo: noop,
    setWeapon: noop,
    setHealth: noop,
    setScore: noop,
    setStreak: noop,
    setBanner: noop,
    setBlips: noop,
    setRespawn: noop,
    feed: noop,
    damageFlash: noop,
    damageFrom: noop,
    hitmarker: noop,
    setMoving: noop,
    setFiring: noop,
    setADS: noop,
    setPlayer: noop,
    setDebugVisible: noop,
    setAccessibility: noop,
    setGrenades: noop,
    setFlash: noop,
    setPrompt: noop,
  };
}

/** Quantised signature of a blip list; cheap enough to build every frame. */
function blipSig(list: readonly MapBlip[]): string {
  let s = '';
  for (const b of list) {
    s += b.kind + ((b.x / MAP_POS_Q) | 0) + ',' + ((b.z / MAP_POS_Q) | 0) + ';';
  }
  return s;
}

export function initHud(): HudApi {
  const root = document.getElementById('hud');
  if (!root) return noopApi();
  const n: HudNodes = buildHud(root, document.getElementById('crosshair'));

  // Palette agreement: one write each at startup, then never again.
  root.style.setProperty('--aa-accent', palCss(UI_ACCENT));
  root.style.setProperty('--aa-danger', palCss(UI_DANGER));
  root.style.setProperty('--aa-ink', palCss(UI_INK));

  const map: MapPainter | null = createMapPainter(n.mapCanvas, MAP_ZOOM);
  const match = bindMatchSurfaces(n);

  // --- caches: impossible seeds so the first real push always writes --------
  let moving = false;
  let firing = false;
  let lastGap = -1;
  let cMag = -1;
  let cRes = -1;
  let cLowAmmo = false;
  let cWeapon = '';
  let cReloading = false;
  let cHp = -1;
  let cLowHp = false;
  let cAds = false;
  let cDebugHidden = true;
  let cBlipSig: string | null = null;
  let cMapX = 0;
  let cMapZ = 0;
  let cMapYaw = 0;
  let mapDrawn = false;
  let mapDirty = true;
  let blips: readonly MapBlip[] = [];
  let dmgTimer = 0;
  let hitTimer = 0;
  let flashScale = 1;
  let reducedMotion = false;
  let cGrenades = '';
  let cFlash = -1;
  let cPrompt: string | null = '';

  const applyGap = (): void => {
    if (!n.crosshair) return;
    let gap = XH_GAP_STILL;
    if (moving) gap += XH_GAP_MOVING;
    if (firing) gap += XH_GAP_FIRING;
    if (gap === lastGap) return;
    lastGap = gap;
    n.crosshair.style.setProperty('--xh-gap', gap + 'px');
  };
  applyGap();

  const drawMap = (x: number, z: number, yaw: number): void => {
    map?.drawPlayerUp(x, z, yaw, blips);
    mapDirty = false;
  };
  drawMap(0, 0, 0);

  // Scoreboard on Tab hold. Registered once; no per-frame listener churn.
  addEventListener('keydown', (e) => {
    if (e.code === 'Tab' && !e.repeat) {
      e.preventDefault();
      n.scoreboard.classList.remove('hud-score-hidden');
    }
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'Tab') n.scoreboard.classList.add('hud-score-hidden');
  });
  addEventListener('blur', () => n.scoreboard.classList.add('hud-score-hidden'));

  return {
    setAmmo(mag: number, reserve: number): void {
      const m = Math.max(0, Math.round(mag));
      const r = Math.max(0, Math.round(reserve));
      if (m === cMag && r === cRes) return;
      cMag = m;
      cRes = r;
      n.mag.textContent = String(m);
      n.reserve.textContent = String(r);
      const low = m <= LOW_AMMO || m <= ASSUMED_MAG * 0.2;
      if (low !== cLowAmmo) {
        cLowAmmo = low;
        n.ammo.classList.toggle('hud-low', low);
      }
    },

    setWeapon(name: string, reloading = false): void {
      if (name === cWeapon && reloading === cReloading) return;
      cWeapon = name;
      cReloading = reloading;
      n.weaponName.textContent = name;
      n.reload.classList.toggle('hud-reload-hidden', !reloading);
    },

    setHealth(hp: number): void {
      const v = Math.max(0, Math.min(100, Math.round(hp)));
      if (v === cHp) return;
      cHp = v;
      // scaleX keeps the fill on the compositor; width would lay out every hit.
      n.hpFill.style.transform = 'scaleX(' + v / 100 + ')';
      n.hpLabel.textContent = String(v);
      const low = v <= LOW_HP;
      if (low !== cLowHp) {
        cLowHp = low;
        n.health.classList.toggle('hud-low', low);
      }
    },

    setScore: match.setScore,
    setStreak: match.setStreak,
    setBanner: match.setBanner,
    setRespawn: match.setRespawn,

    setBlips(list: readonly MapBlip[]): void {
      const sig = blipSig(list);
      if (sig === cBlipSig) return;
      cBlipSig = sig;
      blips = list;
      mapDirty = true;
    },

    feed(text: string, dest: FeedDestination, tone: FeedTone = 'neutral'): void {
      const pool = n.feeds[dest];
      const i = pool.next;
      pool.next = (i + 1) % pool.rows.length;
      const row = pool.rows[i];
      window.clearTimeout(pool.timers[i]);
      row.textContent = text;
      row.setAttribute('aria-label', accessibleFeedLabel(dest, text));
      row.className = 'hud-feed-row hud-tone-' + tone;
      pool.timers[i] = window.setTimeout(() => {
        row.classList.add('hud-feed-hidden');
      }, FEED_VISIBLE_MS);
    },

    damageFlash(): void {
      if (flashScale <= 0) return;
      n.vignette.classList.remove('hud-flash');
      void n.vignette.offsetWidth;
      n.vignette.classList.add('hud-flash');
    },

    damageFrom(srcX: number, srcZ: number, px: number, pz: number, yaw: number): void {
      const ang = sourceAngle(srcX, srcZ, px, pz, yaw);
      n.dmgdir.style.transform = 'rotate(' + ang + 'rad)';
      n.dmgdir.classList.remove('hud-dmgdir-hidden');
      window.clearTimeout(dmgTimer);
      dmgTimer = window.setTimeout(() => {
        n.dmgdir.classList.add('hud-dmgdir-hidden');
      }, DMGDIR_MS);
    },

    hitmarker(kind: HitKind): void {
      n.hit.className = 'hud-own hud-hitmarker';
      void n.hit.offsetWidth;
      n.hit.className = 'hud-own hud-hitmarker hm-' + kind;
      window.clearTimeout(hitTimer);
      hitTimer = window.setTimeout(() => {
        n.hit.className = 'hud-own hud-hitmarker';
      }, HIT_MS[kind]);
    },

    setMoving(m: boolean): void {
      if (m === moving) return;
      moving = m;
      applyGap();
    },

    setFiring(f: boolean): void {
      if (f === firing) return;
      firing = f;
      applyGap();
    },

    setADS(ads: boolean): void {
      if (ads === cAds) return;
      cAds = ads;
      n.crosshair?.classList.toggle('xh-hidden', ads);
    },

    setPlayer(x: number, z: number, yaw: number): void {
      const qx = Math.round(x / MAP_POS_Q) * MAP_POS_Q;
      const qz = Math.round(z / MAP_POS_Q) * MAP_POS_Q;
      const qy = Math.round(yaw / MAP_YAW_Q) * MAP_YAW_Q;
      if (mapDrawn && !mapDirty && qx === cMapX && qz === cMapZ && qy === cMapYaw) return;
      cMapX = qx;
      cMapZ = qz;
      cMapYaw = qy;
      mapDrawn = true;
      drawMap(x, z, yaw);
    },

    setDebugVisible(v: boolean): void {
      const hidden = !v;
      if (hidden === cDebugHidden) return;
      cDebugHidden = hidden;
      root.classList.toggle('hud-debug-hidden', hidden);
    },

    setAccessibility(a: Accessibility): void {
      flashScale = a.damageFlashScale;
      reducedMotion = a.reducedMotion;
      root.style.setProperty('--aa-flash', String(flashScale));
      root.classList.toggle('hud-reduced-motion', reducedMotion);
    },

    setGrenades(lethal: number, tactical: number, tacticalId: string, armed: string | null): void {
      const sig = lethal + '|' + tactical + '|' + tacticalId + '|' + String(armed);
      if (sig === cGrenades) return;
      cGrenades = sig;
      n.grenadeLethal.textContent = '\u25CF FRAG ' + lethal + (armed === 'frag' ? ' \u2022 ARMED' : '');
      n.grenadeTactical.textContent = '\u25C6 ' + tacticalId.toUpperCase() + ' ' + tactical
        + (armed !== null && armed !== 'frag' ? ' \u2022 ARMED' : '');
      n.grenadeLethal.classList.toggle('hud-low', lethal <= 0);
      n.grenadeTactical.classList.toggle('hud-low', tactical <= 0);
    },

    setFlash(opacity: number): void {
      // The accessibility flash scale applies here too: a player who turned
      // the damage flash down did not ask to be blinded by a grenade instead.
      const v = Math.round(Math.max(0, Math.min(1, opacity)) * flashScale * 100) / 100;
      if (v === cFlash) return;
      cFlash = v;
      n.flash.style.opacity = String(v);
    },

    setPrompt(text: string | null): void {
      if (text === cPrompt) return;
      cPrompt = text;
      if (text === null) {
        n.prompt.classList.add('hud-hidden');
        return;
      }
      n.prompt.textContent = text;
      n.prompt.classList.remove('hud-hidden');
    },
  };
}
