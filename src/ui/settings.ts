/**
 * Atomic Acres — persisted player settings.
 *
 * loadSettings/saveSettings/resetSettings wrap every localStorage access in
 * try/catch: storage throws in some privacy modes, and a settings read must
 * never break the menu.
 *
 * THE ACCESSIBILITY TRIO IS HERE ON PURPOSE, AND EARLY. IMPORT-PLAN §1.5:
 * `reducedMotion`, `damageFlashScale` and `weaponMotionScale` are read by
 * gameplay code and "must exist before the feedback lanes hard-code
 * intensities". The old project shipped a 1,048-line graphics-settings registry
 * and these three still had to be retro-fitted through it. Three fields and one
 * accessor cost nothing today and cost a rewrite later.
 *
 * Who reads them, honestly, as of this lane:
 *   reducedMotion      — `ui/hud.ts` (`setAccessibility`) and `hud.css`.
 *   damageFlashScale   — `ui/hud.ts`: 0 suppresses the damage vignette entirely.
 *   weaponMotionScale  — NOBODY YET. `weapons/` is another lane's file and its
 *                        sway/bob amplitudes are still constants. The value
 *                        persists and is exposed; wiring it is that lane's
 *                        one-line read, not a second copy of the setting.
 */

export type Quality = 'low' | 'medium' | 'high';

/** The subset gameplay and the HUD consume. Projected from `Settings`. */
export interface Accessibility {
  /** Suppress non-essential motion: flashes go instant, sway is damped. */
  readonly reducedMotion: boolean;
  /** 0..1 multiplier on the damage vignette. 0 removes it. */
  readonly damageFlashScale: number;
  /** 0..1 multiplier on viewmodel sway/bob amplitude. */
  readonly weaponMotionScale: number;
}

export interface Settings extends Accessibility {
  /** Mouse-look multiplier. Default 1.0. */
  sensitivity: number;
  /** Vertical field of view in degrees. Default 75. */
  fov: number;
  /** Renderer quality tier. Default 'high'. */
  quality: Quality;
  reducedMotion: boolean;
  damageFlashScale: number;
  weaponMotionScale: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1.0,
  fov: 75,
  quality: 'high',
  reducedMotion: false,
  damageFlashScale: 1,
  weaponMotionScale: 1,
};

const KEY = 'atomic-acres-settings';

/** The OS preference, when the browser exposes one. Never throws. */
function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function clamp01(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt;
}

function sanitize(raw: Partial<Settings>): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof raw.sensitivity === 'number' && Number.isFinite(raw.sensitivity)) {
    out.sensitivity = Math.min(5, Math.max(0.1, raw.sensitivity));
  }
  if (typeof raw.fov === 'number' && Number.isFinite(raw.fov)) {
    out.fov = Math.min(110, Math.max(60, raw.fov));
  }
  if (raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'high') {
    out.quality = raw.quality;
  }
  out.reducedMotion = typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : prefersReducedMotion();
  out.damageFlashScale = clamp01(raw.damageFlashScale, DEFAULT_SETTINGS.damageFlashScale);
  out.weaponMotionScale = clamp01(raw.weaponMotionScale, DEFAULT_SETTINGS.weaponMotionScale);
  return out;
}

/** The accessibility view of a settings object. One projection, no mirror. */
export function accessibilityOf(s: Settings): Accessibility {
  return {
    reducedMotion: s.reducedMotion,
    damageFlashScale: s.damageFlashScale,
    weaponMotionScale: s.weaponMotionScale,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    // A first-time player inherits the OS reduced-motion preference rather than
    // being shown flashes once and asked to opt out afterwards.
    if (!raw) return sanitize({});
    return sanitize(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return sanitize({});
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitize(s)));
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
  return sanitize({});
}
