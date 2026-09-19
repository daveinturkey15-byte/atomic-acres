/**
 * Atomic Acres — persisted player settings.
 *
 * loadSettings/saveSettings/resetSettings wrap every localStorage access in
 * try/catch: storage throws in some privacy modes, and a settings read must
 * never break the menu.
 *
 * ONE STORE, ONE SANITISER. Every field below is validated against a table or
 * a range on the way in, field by field, so a stale or hand-edited store
 * resets the one bad value and keeps the rest. `quality` is NOT a field: it
 * is derived from the four graphics knobs (`qualityOf`), because a stored
 * preset name beside stored knobs is the stale mirror IMPORT-PLAN §5.5 warns
 * about — the first time a knob moves the name lies.
 *
 * WHO CONSUMES WHAT (honest, as of the ui lane, 2026-09-19):
 *   fov, resolutionScale, shadowMapSize  — `settings-apply.ts`, live.
 *   sensitivity, invertY, bindings        — `settings-apply.ts` shims, live,
 *                                           until `core/player.ts` grows setters.
 *   ao, ssr, bloom                        — `settings-apply.ts` → `world.post.setEffects`, live.
 *                                           On the WebGL2/off fallback the chain is
 *                                           absent: the toggle is remembered by the
 *                                           fallback and reported, not rendered.
 *   fog                                   — `settings-apply.ts` → `world.post.setFog`, live
 *                                           (same fallback caveat as ao/ssr/bloom).
 *   tod, weather                          — `settings-apply.ts` → `world.atmosphere.set` /
 *                                           `setWeather` (else `post.setAtmosphere`), live.
 *                                           Uniform/env writes only; the light SET never changes.
 *   masterVolume, effectsVolume           — NOBODY in this build. The only audio is inside
 *                                           `weapons/controller.ts` with no volume hook.
 *                                           `settings-apply.ts:ApplyTargets.audio.setVolumes`
 *                                           is the offered signature for the audio lane.
 *   reducedMotion, damageFlashScale       — `ui/hud.ts`.
 *   weaponMotionScale                     — NOBODY YET (weapons lane's one-line read).
 *   netOverlay, callsign, linkTier, signalUrl — the menu and the lobby.
 *
 * QUERY PRECEDENCE. An explicit `?tod=` / `?weather=` in the page URL overrides the
 * persisted value on the FIRST `loadSettings()` of the page load only, so camera
 * captures pin a state. A later user adjustment writes storage and sticks; the
 * override is one-shot and never re-applied.
 */

import { DEFAULT_BINDINGS, sanitizeBindings, type Bindings } from './bindings';
import { TOD_NAMES, WEATHER_NAMES, type TodName, type WeatherName } from '../core/atmosphere';

// ---------------------------------------------------------------------------
// Graphics tables
// ---------------------------------------------------------------------------

export const SHADOW_MAP_SIZES = [1024, 2048, 4096] as const;
export type ShadowMapSize = (typeof SHADOW_MAP_SIZES)[number];

export interface GraphicsKnobs {
  readonly shadowMapSize: ShadowMapSize;
  readonly ao: boolean;
  readonly ssr: boolean;
  readonly bloom: boolean;
  /** 0.5 .. 1 of the device pixel ratio (capped at 2, as `core/renderer.ts` does). */
  readonly resolutionScale: number;
}

export const QUALITY_NAMES = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityName = (typeof QUALITY_NAMES)[number];
export type Quality = QualityName | 'custom';

/**
 * Presets are bundles of the knobs, nothing more. `high` IS today's build:
 * 4096 shadow, every effect on, full resolution. `ultra` equals `high` on
 * this build and the option says so — the post chain exposes nothing above
 * it yet, and inventing a difference would be a lie in a menu.
 */
export const QUALITY_PRESETS: Readonly<Record<QualityName, GraphicsKnobs>> = Object.freeze({
  low: Object.freeze({ shadowMapSize: 1024, ao: false, ssr: false, bloom: false, resolutionScale: 0.6 }),
  medium: Object.freeze({ shadowMapSize: 2048, ao: true, ssr: false, bloom: true, resolutionScale: 0.8 }),
  high: Object.freeze({ shadowMapSize: 4096, ao: true, ssr: true, bloom: true, resolutionScale: 1 }),
  ultra: Object.freeze({ shadowMapSize: 4096, ao: true, ssr: true, bloom: true, resolutionScale: 1 }),
});

/** The preset the knobs currently equal, or `custom`. Derived, never stored. */
export function qualityOf(k: GraphicsKnobs): Quality {
  for (const name of QUALITY_NAMES) {
    const p = QUALITY_PRESETS[name];
    if (p.shadowMapSize === k.shadowMapSize && p.ao === k.ao && p.ssr === k.ssr && p.bloom === k.bloom &&
        Math.abs(p.resolutionScale - k.resolutionScale) < 1e-6) return name;
  }
  return 'custom';
}

// ---------------------------------------------------------------------------
// The settings record
// ---------------------------------------------------------------------------

/** The subset gameplay and the HUD consume. Projected from `Settings`. */
export interface Accessibility {
  /** Suppress non-essential motion: flashes go instant, sway is damped. */
  readonly reducedMotion: boolean;
  /** 0..1 multiplier on the damage vignette. 0 removes it. */
  readonly damageFlashScale: number;
  /** 0..1 multiplier on viewmodel sway/bob amplitude. */
  readonly weaponMotionScale: number;
}

export type LinkTierSetting = 'tabs' | 'lan';

export interface Settings extends Accessibility, GraphicsKnobs {
  /** Mouse-look multiplier. Default 1.0. */
  sensitivity: number;
  invertY: boolean;
  bindings: Bindings;
  /**
   * Vertical field of view in degrees, 70..110. Default 72 — the value
   * `weapons/controller.ts:BASE_FOV` writes every frame, so a fresh profile
   * renders exactly what every capture harness has always photographed.
   */
  fov: number;
  shadowMapSize: ShadowMapSize;
  ao: boolean;
  ssr: boolean;
  bloom: boolean;
  resolutionScale: number;
  /** Analytic haze on/off. Default true — the baseline frame has haze. */
  fog: boolean;
  /** Time-of-day preset name. Default 'noon' — every capture baseline. */
  tod: TodName;
  /** Weather preset name. Default 'clear' — every capture baseline. */
  weather: WeatherName;
  masterVolume: number;
  effectsVolume: number;
  /** Netcode diagnostics overlay (F3 toggles it too). */
  netOverlay: boolean;
  callsign: string;
  linkTier: LinkTierSetting;
  signalUrl: string;
  reducedMotion: boolean;
  damageFlashScale: number;
  weaponMotionScale: number;
}

export const FOV_MIN = 70;
export const FOV_MAX = 110;
export const RESOLUTION_MIN = 0.5;

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  sensitivity: 1.0,
  invertY: false,
  bindings: DEFAULT_BINDINGS,
  fov: 72,
  ...QUALITY_PRESETS.high,
  fog: true,
  tod: 'noon',
  weather: 'clear',
  masterVolume: 1,
  effectsVolume: 1,
  netOverlay: false,
  callsign: 'player',
  linkTier: 'tabs' as LinkTierSetting,
  signalUrl: 'http://127.0.0.1:4310',
  reducedMotion: false,
  damageFlashScale: 1,
  weaponMotionScale: 1,
});

const KEY = 'atomic-acres-settings';

/** The OS preference, when the browser exposes one. Never throws. */
function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function num(v: unknown, lo: number, hi: number, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
}

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}

export function sanitizeSettings(raw: Partial<Settings> | Record<string, unknown>): Settings {
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const shadow = (SHADOW_MAP_SIZES as readonly number[]).includes(r['shadowMapSize'] as number)
    ? (r['shadowMapSize'] as ShadowMapSize)
    : d.shadowMapSize;
  const callsign = typeof r['callsign'] === 'string' ? r['callsign'].trim().replace(/\s+/g, ' ').slice(0, 16) : '';
  let signalUrl = d.signalUrl;
  if (typeof r['signalUrl'] === 'string') {
    try {
      signalUrl = new URL(r['signalUrl']).origin;
    } catch {
      signalUrl = d.signalUrl;
    }
  }
  return {
    sensitivity: num(r['sensitivity'], 0.1, 5, d.sensitivity),
    invertY: bool(r['invertY'], d.invertY),
    bindings: sanitizeBindings(r['bindings']),
    fov: num(r['fov'], FOV_MIN, FOV_MAX, d.fov),
    shadowMapSize: shadow,
    ao: bool(r['ao'], d.ao),
    ssr: bool(r['ssr'], d.ssr),
    bloom: bool(r['bloom'], d.bloom),
    resolutionScale: num(r['resolutionScale'], RESOLUTION_MIN, 1, d.resolutionScale),
    fog: bool(r['fog'], d.fog),
    tod: (TOD_NAMES as readonly string[]).includes(r['tod'] as string) ? (r['tod'] as TodName) : d.tod,
    weather: (WEATHER_NAMES as readonly string[]).includes(r['weather'] as string) ? (r['weather'] as WeatherName) : d.weather,
    masterVolume: num(r['masterVolume'], 0, 1, d.masterVolume),
    effectsVolume: num(r['effectsVolume'], 0, 1, d.effectsVolume),
    netOverlay: bool(r['netOverlay'], d.netOverlay),
    callsign: callsign || d.callsign,
    linkTier: r['linkTier'] === 'lan' ? 'lan' : 'tabs',
    signalUrl,
    // A first-time player inherits the OS reduced-motion preference rather
    // than being shown flashes once and asked to opt out afterwards.
    reducedMotion: typeof r['reducedMotion'] === 'boolean' ? r['reducedMotion'] : prefersReducedMotion(),
    damageFlashScale: num(r['damageFlashScale'], 0, 1, d.damageFlashScale),
    weaponMotionScale: num(r['weaponMotionScale'], 0, 1, d.weaponMotionScale),
  };
}

/** The accessibility view of a settings object. One projection, no mirror. */
export function accessibilityOf(s: Settings): Accessibility {
  return {
    reducedMotion: s.reducedMotion,
    damageFlashScale: s.damageFlashScale,
    weaponMotionScale: s.weaponMotionScale,
  };
}

/** The four graphics knobs of a preset, as a settings patch. */
export function presetPatch(name: QualityName): Partial<Settings> {
  return { ...QUALITY_PRESETS[name] };
}

/**
 * One-shot capture override. The world is built from `?tod=` / `?weather=` before
 * the menu ever loads, so the FIRST settings read of the page honours an explicit
 * query value over storage; afterwards the player's own adjustment rules. Never
 * throws, never touches storage. Unknown values fall through to the persisted one.
 */
let queryOverrideConsumed = false;
function queryEnvironment(): Partial<Settings> {
  if (queryOverrideConsumed) return {};
  queryOverrideConsumed = true;
  try {
    if (typeof location === 'undefined' || !location.search) return {};
    const q = new URLSearchParams(location.search);
    const patch: Partial<Settings> = {};
    const t = q.get('tod');
    if (t && (TOD_NAMES as readonly string[]).includes(t)) patch.tod = t as TodName;
    const w = q.get('weather');
    if (w && (WEATHER_NAMES as readonly string[]).includes(w)) patch.weather = w as WeatherName;
    return patch;
  } catch {
    return {};
  }
}

export function loadSettings(): Settings {
  const overlay = queryEnvironment();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return sanitizeSettings({ ...overlay });
    return sanitizeSettings({ ...(JSON.parse(raw) as Partial<Settings>), ...overlay });
  } catch {
    return sanitizeSettings({ ...overlay });
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitizeSettings(s)));
  } catch {
    // Storage unavailable (private mode, blocked cookies) — settings simply
    // live for this session only.
  }
}

export function resetSettings(): Settings {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Same as above: nothing persisted, nothing to clear.
  }
  return sanitizeSettings({});
}

// ---------------------------------------------------------------------------
// The solo setup, persisted beside the settings under its own key. It is
// sanitised by `game/rules.ts`, which owns every table it draws from.
// ---------------------------------------------------------------------------

const SOLO_KEY = 'atomic-acres-solo-setup';

export function loadSoloSetupRaw(): unknown {
  try {
    const raw = localStorage.getItem(SOLO_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function saveSoloSetupRaw(v: unknown): void {
  try {
    localStorage.setItem(SOLO_KEY, JSON.stringify(v));
  } catch {
    /* session-only, as above */
  }
}
