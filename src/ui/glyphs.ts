/**
 * Atomic Acres — input glyph contract.
 *
 * Lesson carried over from the old project's `hud-glyphs` module: prompt
 * caps are plain `<kbd data-glyph="fire">` elements whose *text* is the
 * only thing that ever changes. Layout, lifecycle and selectors stay
 * untouched, so adding gamepad support later means adding labels here —
 * never re-plumbing the HUD or the menus.
 *
 * Rules:
 * - Caps are rewritten via `textContent` only, and only when the scheme or
 *   the label actually changes (per-element cache in `data-applied`).
 * - `initGlyphScheme` starts on keyboard and flips to gamepad while any
 *   gamepad is connected (`gamepadconnected` / `gamepaddisconnected`;
 *   any keydown flips back). No polling, no per-frame work.
 */

export type InputScheme = 'keyboard' | 'gamepad';

interface GlyphDef {
  keyboard: string;
  pad: string;
}

/** Every prompt action the UI can name. Add a row, not a code path. */
export const GLYPHS: Record<string, GlyphDef> = {
  fire: { keyboard: 'LMB', pad: 'RT' },
  ads: { keyboard: 'RMB', pad: 'LT' },
  reload: { keyboard: 'R', pad: 'X' },
  switch: { keyboard: '1 / 2', pad: 'Y' },
  jump: { keyboard: 'Space', pad: 'A' },
  move: { keyboard: 'WASD', pad: 'LS' },
  sprint: { keyboard: 'Shift', pad: 'LS▸' },
  pause: { keyboard: 'Esc', pad: '☰' },
};

export function glyphFor(action: string, scheme: InputScheme): string {
  const g = GLYPHS[action];
  if (!g) return action;
  return scheme === 'gamepad' ? g.pad : g.keyboard;
}

/**
 * Rewrite every `<kbd data-glyph>` under root for the scheme.
 * Idempotent: elements already showing the right label are not touched.
 */
export function applyGlyphScheme(root: ParentNode, scheme: InputScheme): void {
  let caps: NodeListOf<HTMLElement>;
  try {
    caps = (root as Document | Element).querySelectorAll('kbd[data-glyph]');
  } catch {
    return;
  }
  for (const cap of Array.from(caps)) {
    const action = cap.getAttribute('data-glyph') ?? '';
    const label = glyphFor(action, scheme);
    if (cap.dataset.applied === scheme + ':' + label) continue;
    cap.textContent = label;
    cap.dataset.applied = scheme + ':' + label;
    cap.classList.toggle('pad-glyph', scheme === 'gamepad');
  }
  try {
    const doc = (root as Document).documentElement ?? document.documentElement;
    doc.dataset.inputScheme = scheme;
  } catch {
    // Headless / partial DOM — labels are already written.
  }
}

let currentScheme: InputScheme = 'keyboard';
let wired = false;

export function glyphScheme(): InputScheme {
  return currentScheme;
}

function setScheme(scheme: InputScheme): void {
  if (scheme === currentScheme && wired) {
    // Still re-apply: new menus may have built new caps since the flip.
    applyGlyphScheme(document, scheme);
    return;
  }
  currentScheme = scheme;
  applyGlyphScheme(document, scheme);
}

/** Wire one-shot listeners; safe to call twice (menus rebuild is not a rewire). */
export function initGlyphScheme(): void {
  applyGlyphScheme(document, currentScheme);
  if (wired) return;
  wired = true;
  addEventListener('gamepadconnected', () => setScheme('gamepad'));
  addEventListener('gamepaddisconnected', () => {
    try {
      const pads =
        typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
          ? Array.from(navigator.getGamepads()).some(Boolean)
          : false;
      setScheme(pads ? 'gamepad' : 'keyboard');
    } catch {
      setScheme('keyboard');
    }
  });
  addEventListener('keydown', () => {
    if (currentScheme !== 'keyboard') setScheme('keyboard');
  });
}
