/**
 * Atomic Acres — the menu shell: which view shows, and the lifecycle that
 * decides it.
 *
 * Everything lives inside the existing #start overlay (the capture harness
 * removes #start before every shot, so a node anywhere else would leak into
 * captures). `menu-lifecycle.ts` is the reducer; this file applies it. The
 * views are built once by `menu-views.ts`, `solo-setup.ts`, `lobby.ts` and
 * `settings-panel.ts`, and `render()` is the ONE place that decides visibility,
 * so the overlay cannot disagree with itself.
 *
 * THE ONE-CLICK CONTRACT. `playcap.mjs` and every harness call
 * `#start.click()` and expect a default solo match. That synthetic click lands
 * on the overlay itself; `main.ts` owns the listener that begins the match and
 * hides the overlay, and the reducer mirrors it here. Real clicks land on menu
 * controls inside `.aa-root`, which stops propagation, so a slider cannot
 * start a match and a button always does exactly what it says.
 *
 * `match()` is read lazily: `main.ts` builds the UI before the match object
 * exists, and binds it a few lines later (`UiHandle.bindMatch`).
 */
import type { HudApi } from './hud';
import type { LocalMatch } from '../game/session';
import type { SessionSnapshot } from '../game/session-types';
import {
  INITIAL_MENU_STATE, menuVisible, reduceMenuLifecycle, type MenuLifecycleEvent, type MenuLifecycleState,
} from './menu-lifecycle';
import { buildCredits, buildDeploying, buildEnd, buildError, buildMain, buildPause, button } from './menu-views';
import { buildLobbyPanel } from './lobby';
import { buildSettingsPanel } from './settings-panel';
import {
  applySettings, installInputShims, probeApplied, type AppliedProbe, type ApplyTargets, type MenuPlayer, type MenuWorld,
} from './settings-apply';
import { buildSoloSetupPanel } from './solo-setup';
import { loadSettings, resetSettings, saveSettings, type Settings } from './settings';

export type { MenuPlayer, MenuWorld } from './settings-apply';
export { MAPS, THUMB_H, THUMB_W, type MapEntry } from './map-select';

export const MENU_PANELS = ['main', 'solo', 'multiplayer', 'options', 'credits'] as const;
export type MenuPanel = (typeof MENU_PANELS)[number];

export interface MenuDeps {
  hud: HudApi;
  player: MenuPlayer;
  world: MenuWorld;
  match(): LocalMatch | null;
  names(): ReadonlyMap<string, string>;
}

export interface MenuHandle {
  /** Once per frame from the UI loop: follows the match into and out of the menus. */
  tick(now: number): void;
  /** Navigate the pre-match menu (the harness and a future gamepad path use this). */
  open(panel: MenuPanel): void;
  /** A pause request from something other than Escape (gamepad Start, a harness). */
  pause(): void;
  state(): MenuLifecycleState;
  panel(): MenuPanel;
  settings(): Settings;
  write(patch: Partial<Settings>): Settings;
  probe(): AppliedProbe;
}

/** End-screen refresh cadence. The countdown reads fine at 4 Hz. */
const END_REFRESH_MS = 250;

export function initMenus(deps: MenuDeps): MenuHandle {
  const found = document.getElementById('start');
  const overlay: HTMLElement = found ?? document.createElement('div');
  const canvas = deps.world.renderer?.domElement;
  const targets: ApplyTargets = { player: deps.player, world: deps.world, hud: deps.hud };

  let settings: Settings = loadSettings();
  applySettings(settings, targets);
  let life: MenuLifecycleState = INITIAL_MENU_STATE;
  let panel: MenuPanel = 'main';
  let optionsReturn: MenuPanel = 'main';
  let lastEndRefresh = 0;
  let lobbyBound: LocalMatch | null = null;

  const write = (patch: Partial<Settings>): Settings => {
    saveSettings({ ...settings, ...patch });
    settings = loadSettings();
    applySettings(settings, targets);
    return settings;
  };

  overlay.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'aa-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Atomic Acres menu');
  // Real clicks stop here: only the synthetic `#start.click()` reaches main.ts.
  root.addEventListener('click', (e) => e.stopPropagation());

  const main = buildMain();
  const pause = buildPause();
  const credits = buildCredits();
  const end = buildEnd();
  const deploying = buildDeploying();
  const errorView = buildError();
  const solo = buildSoloSetupPanel({
    onChange: (s) => { deps.match()?.configure(s); },
    onDeploy: () => startSolo(),
    onBack: () => { panel = optionsReturn === 'multiplayer' ? 'multiplayer' : 'main'; solo.setMode('solo'); render(); },
  });
  const lobby = buildLobbyPanel({
    session: () => deps.match()?.lobby ?? null,
    settings: () => settings,
    write,
    rules: () => solo.setup(),
    onEditRules: () => { optionsReturn = 'multiplayer'; solo.setMode('rules'); panel = 'solo'; render(); },
    onBack: () => { panel = 'main'; render(); },
  });
  const options = buildSettingsPanel({ read: () => settings, write });
  const oRow = document.createElement('div');
  oRow.className = 'aa-row';
  const oBack = button('Back');
  const oReset = button('Reset defaults');
  oRow.append(oBack, oReset);
  options.root.append(oRow);

  root.append(main.root, solo.root, lobby.root, options.root, credits.root, pause.root, end.root, deploying, errorView);
  overlay.append(root);

  // -------------------------------------------------------------------------
  // Render the reducer's decision. One function, called after every event.
  // -------------------------------------------------------------------------
  function visibleView(): HTMLElement {
    const s = life.surface;
    if (s === 'deploying') return deploying;
    if (s === 'error') return errorView;
    if (s === 'match-over') return end.root;
    if (s === 'paused-match') return panel === 'options' ? options.root : pause.root;
    if (panel === 'solo') return solo.root;
    if (panel === 'multiplayer') return lobby.root;
    if (panel === 'options') return options.root;
    if (panel === 'credits') return credits.root;
    return main.root;
  }

  function render(): void {
    const show = visibleView();
    for (const v of [main.root, solo.root, lobby.root, options.root, credits.root, pause.root, end.root, deploying, errorView]) {
      v.classList.toggle('aa-hidden', v !== show);
    }
    const translucent = life.surface === 'paused-match' || life.surface === 'match-over';
    overlay.classList.toggle('aa-translucent', translucent);
    overlay.style.display = menuVisible(life) ? 'flex' : 'none';
    if (!menuVisible(life)) return;
    if (show === lobby.root) lobby.refresh();
    if (show === options.root) options.refresh();
    try {
      (show.querySelector('button:not([disabled]), input, select') as HTMLElement | null)?.focus();
    } catch {
      /* headless: focus is a no-op */
    }
  }

  function send(e: MenuLifecycleEvent): void {
    const before = life;
    life = reduceMenuLifecycle(life, e);
    if (life.surface !== before.surface && life.surface !== 'pre-match') panel = 'main';
    render();
  }

  function lockPointer(source: 'match-start' | 'resume' = 'match-start'): void {
    send({ type: 'pointer-request', source });
    try {
      const p = canvas?.requestPointerLock() as unknown as Promise<void> | undefined;
      // A rejected request is a REAL state (`denied`): the game runs with a
      // free mouse and the next canvas click re-locks. Never assume success:
      // `pointerlockchange` is the only authority, which is what keeps a
      // headless browser from reaching `locked` and pausing over a capture.
      p?.then?.(() => send({ type: 'pointer-acquired' }), () => send({ type: 'pointer-rejected' }));
    } catch {
      send({ type: 'pointer-rejected' });
    }
  }

  function startSolo(): void {
    const m = deps.match();
    if (m === null) return;
    if (m.lobby.active()) m.leave();
    m.configure(solo.setup());
    m.begin();
    send({ type: 'match-start' });
    send({ type: 'match-ready' });
    lockPointer();
  }

  function leaveMatch(): void {
    const m = deps.match();
    const wasRoom = m !== null && m.mode() !== 'solo';
    m?.leave();
    try { document.exitPointerLock(); } catch { /* no lock */ }
    panel = wasRoom ? 'multiplayer' : 'main';
    send({ type: 'return-pre-match' });
  }

  function openOptions(from: MenuPanel): void {
    optionsReturn = from;
    panel = 'options';
    options.refresh();
    render();
  }

  // ---- wiring -------------------------------------------------------------
  main.solo.addEventListener('click', () => { optionsReturn = 'main'; solo.setMode('solo'); panel = 'solo'; render(); });
  main.multiplayer.addEventListener('click', () => { panel = 'multiplayer'; render(); });
  main.options.addEventListener('click', () => openOptions('main'));
  main.credits.addEventListener('click', () => { panel = 'credits'; render(); });
  credits.back.addEventListener('click', () => { panel = 'main'; render(); });
  oBack.addEventListener('click', () => { panel = life.surface === 'paused-match' ? 'main' : optionsReturn; render(); });
  oReset.addEventListener('click', () => { settings = resetSettings(); saveSettings(settings); applySettings(settings, targets); options.refresh(); });
  pause.resume.addEventListener('click', () => { send({ type: 'resume' }); lockPointer('resume'); });
  pause.options.addEventListener('click', () => openOptions('main'));
  pause.leave.addEventListener('click', leaveMatch);
  end.rematch.addEventListener('click', () => { deps.match()?.rematch(); });
  end.leave.addEventListener('click', leaveMatch);

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

  // The synthetic `#start.click()` (playcap, every harness): main.ts begins the
  // default match and hides the overlay; mirror it so the reducer agrees.
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    if (life.surface === 'pre-match') {
      send({ type: 'match-start' });
      send({ type: 'match-ready' });
    } else if (life.surface === 'paused-match') {
      send({ type: 'resume' });
    }
  });

  // ---- keyboard: Escape steps back, arrows and Tab move focus ---------------
  addEventListener('keydown', (e) => {
    if (!menuVisible(life)) {
      // No lock to release (denied / never granted): Escape must still pause.
      if (e.key === 'Escape' && life.pointerLock !== 'locked' && (life.surface === 'hidden')) send({ type: 'pause-requested' });
      return;
    }
    if (panel === 'options' && options.capturing()) return;
    const target = e.target as HTMLElement | null;
    const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT');
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (life.surface === 'paused-match') {
        if (panel === 'options') { panel = 'main'; render(); } else { send({ type: 'resume' }); lockPointer('resume'); }
      } else if (life.surface === 'pre-match' && panel !== 'main') {
        panel = panel === 'solo' && optionsReturn === 'multiplayer' ? 'multiplayer' : panel === 'options' ? optionsReturn : 'main';
        solo.setMode('solo');
        render();
      }
      return;
    }
    if (inField && e.key !== 'Tab') return;
    // Tab shows the HUD scoreboard through the translucent pause / end overlay;
    // in the pre-match menus it is focus movement and never reaches the HUD.
    const moves = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    const tabbing = e.key === 'Tab' && life.surface === 'pre-match';
    if (!moves.includes(e.key) && !tabbing) return;
    const ctrls = Array.from(visibleView().querySelectorAll('button:not([disabled]), input, select')) as HTMLElement[];
    if (ctrls.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    let i = ctrls.indexOf(document.activeElement as HTMLElement);
    const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight' || (tabbing && !e.shiftKey);
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = ctrls.length - 1;
    else if (fwd) i = i < 0 ? 0 : (i + 1) % ctrls.length;
    else i = i < 0 ? ctrls.length - 1 : (i - 1 + ctrls.length) % ctrls.length;
    try { ctrls[i].focus(); } catch { /* headless */ }
  }, true);

  installInputShims(targets, () => menuVisible(life));

  // ---- follow the match -----------------------------------------------------
  function endSnapshot(m: LocalMatch): SessionSnapshot | null {
    try { return m.snapshot(); } catch { return null; }
  }

  function tick(now: number): void {
    const m = deps.match();
    if (m === null) return;
    if (lobbyBound !== m) {
      lobbyBound = m;
      m.configure(solo.setup());
      m.lobby.onChange(() => { if (menuVisible(life) && panel === 'multiplayer') lobby.refresh(); });
    }
    const mode = m.mode();
    const s = life.surface;
    if (s === 'pre-match' || s === 'deploying') {
      // A room that started (host pressed Start, or we are its guest) takes over.
      if (mode !== 'idle' && s === 'pre-match') {
        send({ type: 'match-start' });
        send({ type: 'match-ready' });
        lockPointer();
      } else if (s === 'deploying' && mode !== 'idle') {
        send({ type: 'match-ready' });
      }
      return;
    }
    if (mode === 'idle') {
      // The room closed under us (host left, link dropped): back to the lobby
      // panel, where the session's error label says why.
      if (s === 'hidden' || s === 'paused-match' || s === 'match-over') {
        try { document.exitPointerLock(); } catch { /* no lock */ }
        panel = m.lobby.view().error !== null ? 'multiplayer' : 'main';
        send({ type: 'return-pre-match' });
      }
      return;
    }
    const ended = m.ended();
    if (s === 'hidden' || s === 'paused-match') {
      if (ended) {
        try { document.exitPointerLock(); } catch { /* no lock */ }
        end.update(endSnapshot(m), m.localId, deps.names(), m.rematchInMs(now), mode !== 'guest');
        lastEndRefresh = now;
        send({ type: 'match-ended' });
      }
      return;
    }
    if (s === 'match-over') {
      if (!ended) {
        send({ type: 'rematch' });
        send({ type: 'match-ready' });
        lockPointer();
      } else if (now - lastEndRefresh >= END_REFRESH_MS) {
        lastEndRefresh = now;
        end.update(endSnapshot(m), m.localId, deps.names(), m.rematchInMs(now), mode !== 'guest');
      }
    }
  }

  render();

  return {
    tick,
    open(p): void {
      if (life.surface === 'paused-match' && p === 'options') { openOptions('main'); return; }
      if (life.surface !== 'pre-match') return;
      if (p === 'options') { openOptions('main'); return; }
      if (p === 'solo') solo.setMode('solo');
      panel = p;
      render();
    },
    pause(): void {
      try { document.exitPointerLock(); } catch { /* no lock */ }
      send({ type: 'pause-requested' });
    },
    state: () => life,
    panel: () => panel,
    settings: () => settings,
    write,
    probe: () => probeApplied(targets, settings),
  };
}
