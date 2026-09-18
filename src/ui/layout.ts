/**
 * Atomic Acres — HUD layout contract.
 *
 * Single source of truth for every HUD number that must agree between the
 * behaviour files (`hud.ts`, `hud-build.ts`, `hud-map.ts`) and `hud.css`.
 * Import from here; never re-declare one of these in either place. The
 * coupling is documented per constant as the CSS selector it governs.
 *
 * WHAT IS NOT HERE ANY MORE. `KILLFEED_MAX = 5` and `KILLFEED_MS = 5000` used
 * to live in this file. They were invented by the HUD lane before a feed
 * authority existed, and they now have one: `game/feed.ts` owns
 * `FEED_EVENT_LIMIT = 6`, `FEED_DAMAGE_LIMIT = 8` and `FEED_VISIBLE_MS = 7000`
 * (the old project's numbers). Two constants naming the same quantity is the
 * stale-mirror defect IMPORT-PLAN §5.5 is about, so these were deleted rather
 * than re-exported.
 *
 * Colours are NOT here — they come from `../core/palette` (`PAL`) and are
 * pushed into CSS custom properties (`--aa-*`) by `initHud` at startup.
 */

import { PAL } from '../core/palette';

/**
 * Hitmarker envelope. The kill confirm is the old project's measured recipe:
 * a 40 ms attack then a ~320 ms decay, so the pop reads as a snap rather than
 * a fade (`kill-confirm-pulse.ts`, `KILL_CONFIRM_PULSE_ATTACK_MS` /
 * `_DECAY_MS`). Body and head keep their own shorter windows from
 * `combat-feedback.ts:combatConfirmEnvelope` — body 180 ms, head 210 ms at
 * 1.18× scale — so a headshot is distinguishable without reading a number.
 *
 * BEFORE, here: one boolean `kill?` with `HIT_MS = 110` / `HIT_KILL_MS = 350`.
 * A head hit was indistinguishable from a body hit.
 */
export const HIT_ATTACK_MS = 40;
export const HIT_DECAY_MS = 320;
export const HIT_BODY_MS = 180;
export const HIT_HEAD_MS = 210;
export const HIT_KILL_MS = HIT_ATTACK_MS + HIT_DECAY_MS;
/** Peak scale per kind; drives `--hm-scale` on `.hud-hitmarker`. */
export const HIT_BODY_SCALE = 1;
export const HIT_HEAD_SCALE = 1.18;
export const HIT_KILL_SCALE = 1.42;

/** Damage-direction arc auto-hide. Governs `.hud-dmgdir` via JS timer. */
export const DMGDIR_MS = 900;

/** Minimap canvas backing size. CSS shows it at the same px (`.hud-map-canvas`). */
export const MAP_PX = 148;
/**
 * Live-minimap zoom over the whole-arena fit. 1 shows all 44.5 × 84 m of the
 * arena in a 148 px circle (1.62 px/m), which is a dot. 2.2 gives 3.6 px/m —
 * about a 20 m radius around the player, which is the BO2 reading distance and
 * matches the 15 m enemy-reveal ring in `game/minimap.ts`.
 */
export const MAP_ZOOM = 2.2;

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
  matchBar: '#hud .hud-matchbar',
  killfeed: '#hud .hud-killfeed',
  damageDone: '#hud .hud-feed-done',
  damageTaken: '#hud .hud-feed-taken',
  banner: '#hud .hud-banner',
  respawn: '#hud .hud-respawn',
  streak: '#hud .hud-streak',
  hitmarker: '#hud .hud-hitmarker',
  damageVignette: '#hud .hud-vignette',
  damageDirection: '#hud .hud-dmgdir',
  minimap: '#hud .hud-minimap',
  scoreboard: '#hud .hud-score',
} as const;

/**
 * Surface registry at 1/4 scale (IMPORT-PLAN §1.4). `critical` marks a surface
 * a visual overhaul may restyle but must not drop: the redesign that silently
 * removed multiplayer state is the failure this list exists to make loud.
 */
export const HUD_SURFACES: readonly { id: keyof typeof HUD_SELECTORS; critical: boolean }[] = Object.freeze([
  { id: 'ammo', critical: true },
  { id: 'weapon', critical: true },
  { id: 'health', critical: true },
  { id: 'matchBar', critical: true },
  { id: 'killfeed', critical: true },
  { id: 'damageDone', critical: false },
  { id: 'damageTaken', critical: false },
  { id: 'banner', critical: true },
  { id: 'respawn', critical: true },
  { id: 'streak', critical: true },
  { id: 'hitmarker', critical: true },
  { id: 'damageVignette', critical: false },
  { id: 'damageDirection', critical: true },
  { id: 'minimap', critical: true },
  { id: 'scoreboard', critical: true },
]);

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
