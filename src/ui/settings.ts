/**
 * Atomic Acres — persisted player settings.
 *
 * loadSettings/saveSettings/resetSettings wrap every localStorage access in
 * try/catch: storage throws in some privacy modes, and a settings read must
 * never break the menu.
 */

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Mouse-look multiplier. Default 1.0. */
  sensitivity: number;
  /** Vertical field of view in degrees. Default 75. */
  fov: number;
  /** Renderer quality tier. Default 'high'. */
  quality: Quality;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1.0,
  fov: 75,
  quality: 'high',
};

const KEY = 'atomic-acres-settings';

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
  return out;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
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
  return { ...DEFAULT_SETTINGS };
}
