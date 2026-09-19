/**
 * Atomic Acres — menus, map select, pause, and the lifecycle that drives them.
 *
 * Everything here lives inside the existing #start overlay (the capture harness
 * removes #start before every shot, so a node anywhere else would leak into
 * captures). No nodes are created outside #start; `main.ts` owns the overlay's
 * own click-to-dismiss listener, so clicks on empty overlay area still bubble
 * to it while interactive children stop propagation — adjusting a slider must
 * not drop the player into the match.
 *
 * TWO CHANGES FROM THE FIRST VERSION:
 *
 *  1. **The second projection is gone.** `drawNuketownThumb` re-projected
 *     `core/layout.ts` top-down with its own colours, a duplicate of
 *     `ui/hud.ts:drawMap()` in a project one day old (IMPORT-PLAN §5.12). Both
 *     now call `game/minimap.ts` through `ui/hud-map.ts`. The thumbnail is
 *     portrait because the arena IS portrait — 44.5 m by 84 m — and the old
 *     landscape card only fitted by scaling the two axes differently, which
 *     made the map-select picture a shape the map is not.
 *  2. **Visibility is a reducer, not a pile of booleans.** `menu-lifecycle.ts`
 *     owns which surface shows and what pointer lock is doing, including the
 *     denied and focus-suspended phases. This file applies the result.
 */
import type { HudApi } from './hud';
import { glyphFor, glyphScheme } from './glyphs';
import { buildMapSelect } from './map-select';
import { buildSettingsPanel } from './settings-panel';
import {
  INITIAL_MENU_STATE,
  menuVisible,
  reduceMenuLifecycle,
  type MenuLifecycleEvent,
  type MenuLifecycleState,
} from './menu-lifecycle';
import { loadSettings, saveSettings, resetSettings, accessibilityOf, type Settings } from './settings';

/** Minimal surface menus actually use — probed, never assumed. */
export interface MenuPlayer {
  setSensitivity?: (v: number) => void;
}

export interface MenuWorld {
  camera?: { fov: number; updateProjectionMatrix: () => void };
  renderer?: { domElement?: { requestPointerLock: () => unknown } };
}

/** Map select lives in `map-select.ts`; re-exported so `menus.ts` stays the
 *  one import target IMPORT-PLAN §0 lists for `initMenus` and `MAPS`. */
export { MAPS, THUMB_H, THUMB_W, type MapEntry } from './map-select';

// ---------------------------------------------------------------------------
// Settings application.
//
// Applied today: FOV — world.camera is a public THREE.PerspectiveCamera, so
// setting fov + updateProjectionMatrix() is an existing public API. The
// accessibility trio reaches the HUD through `hud.setAccessibility`.
// NOT applied (no public hook exists; values persist and take effect once the
// owning module grows one): sensitivity (player.ts has no setter; probed here
// so a future hook is picked up), quality, weaponMotionScale.
// ---------------------------------------------------------------------------

function applySettings(s: Settings, player: MenuPlayer, world: MenuWorld, hud: HudApi): void {
  try {
    if (world.camera) {
      world.camera.fov = s.fov;
      world.camera.updateProjectionMatrix();
    }
  } catch {
    // Camera not ready — persisted value applies on the next change.
  }
  try {
    player.setSensitivity?.(s.sensitivity);
  } catch {
    // No sensitivity hook — persisted only.
  }
  hud.setAccessibility(accessibilityOf(s));
}

function button(label: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = ('aa-btn ' + cls).trim();
  b.addEventListener('click', (e) => e.stopPropagation());
  return b;
}

/** A `<kbd data-glyph>` prompt cap; the glyph scheme owns its text. */
function kbd(action: string): HTMLElement {
  const k = document.createElement('kbd');
  k.setAttribute('data-glyph', action);
  k.textContent = glyphFor(action, glyphScheme());
  return k;
}

function view(label: string, hidden: boolean): HTMLElement {
  const v = document.createElement('div');
  v.className = 'aa-view' + (hidden ? ' aa-hidden' : '');
  v.setAttribute('aria-label', label);
  return v;
}

export function initMenus(deps: { hud: HudApi; player: MenuPlayer; world: MenuWorld }): void {
  const { hud, player, world } = deps;
  const found = document.getElementById('start');
  if (!found) return;
  // Bound once so the closures below keep the narrowed type; #start is never
  // replaced during a session (the capture harness removes it before load).
  const overlay: HTMLElement = found;
  const canvas = world.renderer?.domElement;

  let settings: Settings = loadSettings();
  applySettings(settings, player, world, hud);
  let life: MenuLifecycleState = INITIAL_MENU_STATE;
  let panel: 'none' | 'settings' = 'none';

  overlay.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'aa-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Atomic Acres menu');

  // ---- main menu ----
  const main = view('Main menu', false);
  const eyebrow = document.createElement('div');
  eyebrow.className = 'aa-eyebrow';
  eyebrow.textContent = 'A fan project inspired by Black Ops 2';
  const title = document.createElement('h1');
  title.className = 'aa-title';
  title.textContent = 'ATOMIC ACRES';
  const sub = document.createElement('div');
  sub.className = 'aa-sub';
  sub.textContent = 'Nuketown 2025';
  const btnRow = document.createElement('div');
  btnRow.className = 'aa-row';
  const playBtn = button('Play', 'aa-primary');
  const settingsBtn = button('Settings');
  btnRow.append(playBtn, settingsBtn);

  const mapHead = document.createElement('div');
  mapHead.className = 'aa-maphead';
  mapHead.textContent = 'Map select';
  const mapSelect = buildMapSelect();

  const fan = document.createElement('div');
  fan.className = 'aa-fan';
  fan.textContent = 'Unofficial fan project — not affiliated with Activision or Treyarch.';
  // Attribution the animation supply chain requires (docs/LICENCES-ANIMATION.md,
  // obligation 3): the text encoder behind the baked clips is Llama-3-derived, and the
  // motion model is NVIDIA's. Both lines are licence text, not decoration - keep them.
  const credits = document.createElement('div');
  credits.className = 'aa-fan aa-credits';
  credits.textContent = 'Built with Meta Llama 3 · Motion: NVIDIA Kimodo SOMA-RP v1.1 (NVIDIA Open Model License)';
  main.append(eyebrow, title, sub, btnRow, mapHead, mapSelect.root, fan, credits);

  // ---- settings ----
  const settingsPanel = buildSettingsPanel({
    read: () => settings,
    write: (patch) => {
      settings = { ...settings, ...patch };
      saveSettings(settings);
      settings = loadSettings();
      applySettings(settings, player, world, hud);
    },
  });
  const sBtnRow = document.createElement('div');
  sBtnRow.className = 'aa-row';
  const backBtn = button('Back');
  const resetBtn = button('Reset defaults');
  sBtnRow.append(backBtn, resetBtn);
  settingsPanel.root.append(sBtnRow);

  // ---- deploying / pause / error ----
  const deploying = view('Deploying', true);
  const dTitle = document.createElement('h2');
  dTitle.className = 'aa-h2';
  dTitle.textContent = 'DEPLOYING';
  deploying.append(dTitle);

  const pause = view('Paused', true);
  const pTitle = document.createElement('h2');
  pTitle.className = 'aa-h2';
  pTitle.textContent = 'Paused';
  const pRow = document.createElement('div');
  pRow.className = 'aa-row';
  const resumeBtn = button('Resume', 'aa-primary');
  const pauseSettingsBtn = button('Settings');
  pRow.append(resumeBtn, pauseSettingsBtn);
  const hint = document.createElement('div');
  hint.className = 'aa-hint';
  hint.append(
    kbd('move'), document.createTextNode(' move · '),
    kbd('fire'), document.createTextNode(' fire · '),
    kbd('ads'), document.createTextNode(' aim · '),
    kbd('reload'), document.createTextNode(' reload · '),
    kbd('switch'), document.createTextNode(' weapons'),
  );
  pause.append(pTitle, pRow, hint);

  const errorView = view('Error', true);
  const eTitle = document.createElement('h2');
  eTitle.className = 'aa-h2';
  eTitle.textContent = 'Something broke';
  const eBody = document.createElement('div');
  eBody.className = 'aa-hint';
  eBody.textContent = 'The match stopped. Reload the page to try again.';
  errorView.append(eTitle, eBody);

  root.append(main, settingsPanel.root, deploying, pause, errorView);
  overlay.append(root);

  // -------------------------------------------------------------------------
  // Render the reducer's decision. One function, called after every event, so
  // there is exactly one place that can make the overlay disagree with itself.
  // -------------------------------------------------------------------------
  function render(): void {
    const showSettings = panel === 'settings' && menuVisible(life);
    main.classList.toggle('aa-hidden', showSettings || life.surface !== 'pre-match');
    settingsPanel.root.classList.toggle('aa-hidden', !showSettings);
    deploying.classList.toggle('aa-hidden', showSettings || life.surface !== 'deploying');
    pause.classList.toggle('aa-hidden', showSettings || life.surface !== 'paused-match');
    errorView.classList.toggle('aa-hidden', showSettings || life.surface !== 'error');
    overlay.style.display = menuVisible(life) ? 'flex' : 'none';
    if (!menuVisible(life)) return;
    try {
      const v = showSettings ? settingsPanel.root : visibleView();
      (v.querySelector('button, input, select') as HTMLElement | null)?.focus();
    } catch {
      // Headless — focus is a no-op.
    }
  }

  function visibleView(): HTMLElement {
    if (life.surface === 'paused-match') return pause;
    if (life.surface === 'deploying') return deploying;
    if (life.surface === 'error') return errorView;
    return main;
  }

  function send(e: MenuLifecycleEvent): void {
    const before = life;
    life = reduceMenuLifecycle(life, e);
    if (life.surface !== before.surface) panel = 'none';
    render();
  }

  function lockPointer(): void {
    send({ type: 'pointer-request', source: 'match-start' });
    try {
      const p = canvas?.requestPointerLock() as unknown as Promise<void> | undefined;
      // A rejected request is a REAL state, not an exception to swallow: the
      // browser refuses within a second of an Escape. `denied` keeps the game
      // running with a free mouse instead of opening a pause nobody asked for.
      p?.then?.(
        () => send({ type: 'pointer-acquired' }),
        () => send({ type: 'pointer-rejected' }),
      );
      // No optimistic 'acquired' when the call returns nothing. `pointerlockchange`
      // is the only authority on whether the lock exists, and assuming success
      // here is what would let a headless browser — which never locks — reach the
      // `locked` phase and then open a pause menu over the capture.
    } catch {
      send({ type: 'pointer-rejected' });
    }
  }

  // ---- keyboard: arrows move between controls, Escape steps back ----------
  overlay.addEventListener('keydown', (e) => {
    if (!menuVisible(life)) return;
    const target = e.target as HTMLElement | null;
    const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT');
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (panel === 'settings') {
        panel = 'none';
        render();
      } else if (life.surface === 'paused-match') {
        send({ type: 'resume' });
        lockPointer();
      }
      return;
    }
    if (inField) return;
    const order = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!order.includes(e.key)) return;
    const host = panel === 'settings' ? settingsPanel.root : visibleView();
    const ctrls = Array.from(host.querySelectorAll('button, input, select')) as HTMLElement[];
    if (ctrls.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const active = document.activeElement as HTMLElement | null;
    let i = ctrls.indexOf(active ?? ctrls[0]);
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = ctrls.length - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') i = i < 0 ? 0 : (i + 1) % ctrls.length;
    else i = i < 0 ? ctrls.length - 1 : (i - 1 + ctrls.length) % ctrls.length;
    try {
      ctrls[i].focus();
    } catch {
      // Headless — nothing to focus.
    }
  });

  const openSettings = (): void => {
    panel = 'settings';
    settings = loadSettings();
    applySettings(settings, player, world, hud);
    settingsPanel.refresh();
    render();
  };

  playBtn.addEventListener('click', () => {
    send({ type: 'match-start' });
    send({ type: 'match-ready' });
    lockPointer();
  });
  settingsBtn.addEventListener('click', openSettings);
  pauseSettingsBtn.addEventListener('click', openSettings);
  backBtn.addEventListener('click', () => {
    panel = 'none';
    render();
  });
  resetBtn.addEventListener('click', () => {
    settings = resetSettings();
    saveSettings(settings);
    applySettings(settings, player, world, hud);
    settingsPanel.refresh();
  });
  resumeBtn.addEventListener('click', () => {
    send({ type: 'resume' });
    lockPointer();
  });

  // Pointer lock and focus are the two truths the reducer cannot see.
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) {
      send({ type: 'pointer-acquired' });
      return;
    }
    send({ type: 'pointer-lost', focusTransition: !document.hasFocus(), pauseAllowed: true });
  });
  addEventListener('blur', () => send({ type: 'focus-lost' }));
  addEventListener('focus', () => send({ type: 'focus-gained' }));

  // main.ts owns #start's own click-to-dismiss. Mirror it into the reducer so
  // the two never disagree about whether the menu is up.
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    if (life.surface === 'pre-match') {
      send({ type: 'match-start' });
      send({ type: 'match-ready' });
    } else if (life.surface === 'paused-match') {
      send({ type: 'resume' });
    }
  });

  render();
}
