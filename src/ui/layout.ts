/**
 * Atomic Acres — HUD layout contract.
 *
 * Single source of truth for every HUD number that must agree between
 * `hud.ts` (behaviour) and `hud.css` (presentation). Import from here;
 * never re-declare one of these in either file.
 *
 * Pattern taken from the old project's hud-layout lesson: the HUD once
 * drifted because CSS and JS each hardcoded the same limits. The coupling
 * is documented per constant as the CSS selector it governs.
 *
 * Colours are NOT here — they come from `../core/palette` (`PAL`) and are
 * pushed into CSS custom properties (`--aa-*`) by `initHud` at startup.
 */

import { PAL } from '../core/palette';

/** Kill-feed pool size. Governs `.hud-feed-row` count pre-built by initHud. */
export const KILLFEED_MAX = 5;
/** How long a feed row stays visible. No CSS coupling (JS timer only). */
export const KILLFEED_MS = 5000;

/** Hitmarker visible duration; `.hm-kill` (kill confirm) holds longer. */
export const HIT_MS = 110;
export const HIT_KILL_MS = 350;

/** Damage-direction arc auto-hide. Governs `.hud-dmgdir` via JS timer. */
export const DMGDIR_MS = 900;

/** Minimap canvas backing size. CSS shows it at the same px (`.hud-map-canvas`). */
export const MAP_PX = 148;

/** Low-ammo / low-health thresholds. Govern `.hud-low` class application. */
export const LOW_AMMO = 5;
export const LOW_HP = 30;
/** Assumed mag size when only the remaining count is known (Duster is 12,
 *  Longhorn is 30 — 30 keeps the fraction warning conservative). */
export const ASSUMED_MAG = 30;

/**
 * Minimap redraw quanta. `setPlayer` is called every rAF; the canvas only
 * redraws when the quantised position/yaw actually changes, so standing
 * still costs three float compares and zero canvas work.
 */
export const MAP_POS_Q = 0.25;
export const MAP_YAW_Q = 0.035;

/**
 * Crosshair spread steps (px) written to `--xh-gap` on `#crosshair.xh-lines`.
 * Discrete event-driven values, not an animation — top/left positioning is
 * fine because it never transitions.
 */
export const XH_GAP_STILL = 3;
export const XH_GAP_MOVING = 6;
export const XH_GAP_FIRING = 9;

/** Logical HUD regions and the selectors that implement them. */
export const HUD_SELECTORS = {
  ammo: '#hud .hud-ammo',
  weapon: '#hud .hud-weapon',
  health: '#hud .hud-health',
  scoreLine: '#hud .hud-score-line',
  killfeed: '#hud .hud-killfeed',
  hitmarker: '#hud .hud-hitmarker',
  damageVignette: '#hud .hud-vignette',
  damageDirection: '#hud .hud-dmgdir',
  minimap: '#hud .hud-minimap',
  scoreboard: '#hud .hud-score',
} as const;

/** UI accent family, read off PAL so the HUD and the world agree. */
export const UI_ACCENT = PAL.hazardYellow;
export const UI_DANGER = PAL.applianceRed;
export const UI_INK = PAL.capsuleWhite;
export const UI_TEAL = PAL.signTeal;

/** `#rrggbb` for a PAL sRGB number. */
export function palCss(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** `rgba()` for a PAL sRGB number. Used by the canvas minimap. */
export function palRgba(n: number, a: number): string {
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}
