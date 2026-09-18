/**
 * Atomic Acres — menus, map select, settings panel, pause.
 *
 * Everything here lives inside the existing #start overlay (capture harness
 * removes #start before every shot, so a node anywhere else would leak into
 * captures). No nodes are created outside #start; the existing click-to-dismiss
 * listener on #start itself keeps working — clicks on empty overlay area still
 * bubble to it, while interactive children below stop propagation so adjusting
 * a slider does not dismiss the menu or grab pointer lock.
 *
 * Keyboard: every view is fully operable without a mouse. Buttons, map cards,
 * sliders and the select are native controls (Tab works for free); arrow keys
 * move between controls in the visible view, Home/End jump, Escape steps back.
 * Every control has an explicit `:focus-visible` ring in menus.css — the
 * browser default is not relied on. Key hints use `<kbd data-glyph>` caps so
 * the glyph scheme (keyboard today, gamepad later) rewrites their text.
 */
import './menus.css';
import type { HudApi } from './hud';
import { glyphFor, glyphScheme } from './glyphs';
import { loadSettings, saveSettings, resetSettings, type Settings } from './settings';
import {
  ROAD_HALF_WIDTH,
  ROAD_X_MIN,
  ROAD_X_MAX,
  HEAD_CENTER_X,
  HEAD_RADIUS,
  HOUSE_HALF_LEN,
  HOUSE_DEPTH,
  FRONT_LAWN_OUTER,
  GARAGE_LEN,
  GARAGE_DEPTH,
  BACK_FENCE,
  YARD_X_MIN,
  YARD_X_MAX,
  BOUND_X_MIN,
  BOUND_X_MAX,
  BOUND_Z,
  HOUSES,
} from '../core/layout';

/** Minimal surface menus actually use — probed, never assumed. */
export interface MenuPlayer {
  setSensitivity?: (v: number) => void;
}

export interface MenuWorld {
  camera?: { fov: number; updateProjectionMatrix: () => void };
  renderer?: { domElement?: { requestPointerLock: () => unknown } };
}

// ---------------------------------------------------------------------------
// Map select: data-driven. A new map is one more entry here — the render loop
// below builds a card per entry, no other code changes.
// ---------------------------------------------------------------------------

export interface MapEntry {
  id: string;
  name: string;
  tagline: string;
  drawThumb(canvas: HTMLCanvasElement): void;
}

/** Top-down schematic of Nuketown 2025, drawn from layout.ts — never guessed. */
function drawNuketownThumb(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const sx = W / (BOUND_X_MAX - BOUND_X_MIN);
  const sz = H / (2 * BOUND_Z);
  const X = (x: number): number => (x - BOUND_X_MIN) * sx;
  const Z = (z: number): number => (z + BOUND_Z) * sz;

  ctx.fillStyle = '#10151b';
  ctx.fillRect(0, 0, W, H);

  // yards
  ctx.fillStyle = '#1a2b1d';
  ctx.fillRect(X(YARD_X_MIN), Z(-BACK_FENCE), (YARD_X_MAX - YARD_X_MIN) * sx, 2 * BACK_FENCE * sz);

  // road + turning head
  ctx.fillStyle = '#2a2e33';
  ctx.fillRect(X(ROAD_X_MIN), Z(-ROAD_HALF_WIDTH), (ROAD_X_MAX - ROAD_X_MIN) * sx, 2 * ROAD_HALF_WIDTH * sz);
  ctx.beginPath();
  ctx.arc(X(HEAD_CENTER_X), Z(0), HEAD_RADIUS * sx, 0, Math.PI * 2);
  ctx.fill();

  // houses: main block + garage wing per side
  for (const h of HOUSES) {
    const s = h.side;
    const front = FRONT_LAWN_OUTER * s;
    const back = (FRONT_LAWN_OUTER + HOUSE_DEPTH) * s;
    const z0 = Math.min(Z(front), Z(back));
    ctx.fillStyle = s < 0 ? '#8a5a22' : '#9aa0a6';
    ctx.fillRect(X(-HOUSE_HALF_LEN), z0, 2 * HOUSE_HALF_LEN * sx, Math.abs(Z(back) - Z(front)));
    const gx0 = h.garageX - GARAGE_LEN / 2;
    const gz0 = Math.min(Z(front), Z(front + GARAGE_DEPTH * s));
    ctx.fillStyle = '#3d434a';
    ctx.fillRect(X(gx0), gz0, GARAGE_LEN * sx, Math.abs(Z(front + GARAGE_DEPTH * s) - Z(front)));
  }

  // back fences
  ctx.strokeStyle = '#5a4a2f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X(YARD_X_MIN), Z(-BACK_FENCE));
  ctx.lineTo(X(YARD_X_MAX), Z(-BACK_FENCE));
  ctx.moveTo(X(YARD_X_MIN), Z(BACK_FENCE));
  ctx.lineTo(X(YARD_X_MAX), Z(BACK_FENCE));
  ctx.stroke();
}

export const MAPS: MapEntry[] = [
  {
    id: 'nuketown-2025',
    name: 'Nuketown 2025',
    tagline: 'Twin houses · cul-de-sac · tour coach',
    drawThumb: drawNuketownThumb,
  },
];

// ---------------------------------------------------------------------------
// Settings application.
//
// Applied today: FOV — world.camera is a public THREE.PerspectiveCamera, so
// setting fov + updateProjectionMatrix() is an existing public API.
// NOT applied (no public hook exists; values persist via settings.ts and take
// effect once the owning module grows one):
//   - sensitivity — Player's look speed is a hardcoded constant in its
//     mousemove handler (player.ts); there is no setSensitivity. The panel
//     still probes player.setSensitivity?.() so a future hook is picked up.
//   - quality — World exposes no renderer-quality/scale hook, so there is
//     nothing to call; the tier is stored for the future.
// ---------------------------------------------------------------------------

function applySettings(s: Settings, player: MenuPlayer, world: MenuWorld): void {
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
}

function button(label: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = ('aa-btn ' + cls).trim();
  // Keep menu interaction from bubbling to #start's click-to-dismiss listener
  // (a bubbled click would hide the overlay and grab pointer lock mid-tweak).
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

export function initMenus(deps: { hud: HudApi; player: MenuPlayer; world: MenuWorld }): void {
  void deps.hud; // HudApi is owned by the HUD/weapons loop; menus take it for signature parity.
  const { player, world } = deps;
  const overlay = document.getElementById('start');
  if (!overlay) return;
  const canvas = world.renderer?.domElement;

  let settings: Settings = loadSettings();
  applySettings(settings, player, world);
  let selectedMap = MAPS[0]?.id ?? '';
  let hasStarted = false;
  let settingsReturn: 'main' | 'pause' = 'main';
  const refreshers: Array<() => void> = [];

  overlay.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'aa-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Atomic Acres menu');

  // ---- main menu ----
  const main = document.createElement('div');
  main.className = 'aa-view';
  main.setAttribute('aria-label', 'Main menu');
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

  // ---- map select ----
  const mapHead = document.createElement('div');
  mapHead.className = 'aa-maphead';
  mapHead.textContent = 'Map select';
  const mapList = document.createElement('div');
  mapList.className = 'aa-maps';
  for (const m of MAPS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'aa-map' + (m.id === selectedMap ? ' aa-selected' : '');
    card.setAttribute('aria-pressed', m.id === selectedMap ? 'true' : 'false');
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedMap = m.id;
      // Array.from: NodeListOf is only directly iterable with downlevelIteration,
      // which this tsconfig does not set.
      for (const c of Array.from(mapList.querySelectorAll('.aa-map'))) {
        c.classList.remove('aa-selected');
        c.setAttribute('aria-pressed', 'false');
      }
      card.classList.add('aa-selected');
      card.setAttribute('aria-pressed', 'true');
    });
    const thumb = document.createElement('canvas');
    thumb.width = 200;
    thumb.height = 120;
    thumb.className = 'aa-thumb';
    m.drawThumb(thumb);
    const name = document.createElement('div');
    name.className = 'aa-mapname';
    name.textContent = m.name;
    const tag = document.createElement('div');
    tag.className = 'aa-maptag';
    tag.textContent = m.tagline;
    card.append(thumb, name, tag);
    mapList.append(card);
  }

  const fan = document.createElement('div');
  fan.className = 'aa-fan';
  fan.textContent = 'Unofficial fan project — not affiliated with Activision or Treyarch.';
  main.append(eyebrow, title, sub, btnRow, mapHead, mapList, fan);

  // ---- settings panel ----
  const settingsView = document.createElement('div');
  settingsView.className = 'aa-view aa-hidden';
  settingsView.setAttribute('aria-label', 'Settings');
  const sTitle = document.createElement('h2');
  sTitle.className = 'aa-h2';
  sTitle.textContent = 'Settings';
  settingsView.append(sTitle);

  function sliderRow(
    label: string, min: number, max: number, step: number,
    get: () => number, set: (v: number) => void, fmt: (v: number) => string,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'aa-setting';
    const head = document.createElement('div');
    head.className = 'aa-setting-head';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.className = 'aa-val';
    val.textContent = fmt(get());
    head.append(name, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    input.setAttribute('aria-label', label);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', (e) => {
      e.stopPropagation();
      set(Number(input.value));
      val.textContent = fmt(get());
      saveSettings(settings);
      applySettings(settings, player, world);
    });
    row.append(head, input);
    refreshers.push(() => { input.value = String(get()); val.textContent = fmt(get()); });
    return row;
  }

  settingsView.append(
    sliderRow('Sensitivity', 0.1, 5, 0.1, () => settings.sensitivity,
      (v) => { settings.sensitivity = v; }, (v) => v.toFixed(1)),
    sliderRow('Field of view', 60, 110, 1, () => settings.fov,
      (v) => { settings.fov = v; }, (v) => v.toFixed(0) + '°'),
  );

  const qRow = document.createElement('label');
  qRow.className = 'aa-setting';
  const qHead = document.createElement('div');
  qHead.className = 'aa-setting-head';
  const qName = document.createElement('span');
  qName.textContent = 'Quality';
  qHead.append(qName);
  const qSel = document.createElement('select');
  qSel.className = 'aa-select';
  qSel.setAttribute('aria-label', 'Quality');
  for (const q of ['low', 'medium', 'high'] as const) {
    const opt = document.createElement('option');
    opt.value = q;
    opt.textContent = q[0].toUpperCase() + q.slice(1);
    qSel.append(opt);
  }
  qSel.value = settings.quality;
  qSel.addEventListener('click', (e) => e.stopPropagation());
  qSel.addEventListener('change', (e) => {
    e.stopPropagation();
    settings.quality = qSel.value as Settings['quality'];
    saveSettings(settings);
    applySettings(settings, player, world);
  });
  qRow.append(qHead, qSel);
  refreshers.push(() => { qSel.value = settings.quality; });
  settingsView.append(qRow);

  const sBtnRow = document.createElement('div');
  sBtnRow.className = 'aa-row';
  const backBtn = button('Back');
  const resetBtn = button('Reset defaults');
  sBtnRow.append(backBtn, resetBtn);
  settingsView.append(sBtnRow);

  // ---- pause ----
  const pause = document.createElement('div');
  pause.className = 'aa-view aa-hidden';
  pause.setAttribute('aria-label', 'Paused');
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

  root.append(main, settingsView, pause);
  overlay.append(root);

  const views = { main, settings: settingsView, pause } as const;
  let current: keyof typeof views = 'main';

  function focusFirst(view: HTMLElement): void {
    try {
      const t = view.querySelector('button, input, select') as HTMLElement | null;
      t?.focus();
    } catch {
      // Headless — focus is a no-op.
    }
  }

  function show(view: keyof typeof views): void {
    current = view;
    main.classList.toggle('aa-hidden', view !== 'main');
    settingsView.classList.toggle('aa-hidden', view !== 'settings');
    pause.classList.toggle('aa-hidden', view !== 'pause');
    focusFirst(views[view]);
  }

  function lockPointer(): void {
    try {
      const p = canvas?.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      // Headless / denied — game still runs, mouse just stays free.
    }
  }

  function visibleControls(): HTMLElement[] {
    const view = views[current];
    const out: HTMLElement[] = [];
    for (const t of Array.from(view.querySelectorAll('button, input, select'))) {
      const h = t as HTMLElement;
      if (h.getAttribute('aria-hidden') === 'true') continue;
      out.push(h);
    }
    return out;
  }

  // Arrow-key navigation inside the visible view. Native controls keep their
  // own keys: when focus sits in a slider or select, arrows adjust the value
  // and only Escape steps back.
  overlay.addEventListener('keydown', (e) => {
    if (overlay.style.display === 'none') return;
    const target = e.target as HTMLElement | null;
    const inField =
      !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT');
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (current === 'settings') show(settingsReturn);
      else if (current === 'pause' && hasStarted) {
        overlay.style.display = 'none';
        lockPointer();
      }
      return;
    }
    if (inField) return;
    const order = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!order.includes(e.key)) return;
    const ctrls = visibleControls();
    if (ctrls.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const active = document.activeElement as HTMLElement | null;
    let i = ctrls.indexOf(active ?? ctrls[0]);
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = ctrls.length - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      i = i < 0 ? 0 : (i + 1) % ctrls.length;
    } else {
      i = i < 0 ? ctrls.length - 1 : (i - 1 + ctrls.length) % ctrls.length;
    }
    try {
      ctrls[i].focus();
    } catch {
      // Headless — nothing to focus.
    }
  });

  playBtn.addEventListener('click', () => {
    hasStarted = true;
    overlay.style.display = 'none';
    lockPointer();
  });
  settingsBtn.addEventListener('click', () => {
    settingsReturn = hasStarted ? 'pause' : 'main';
    // Refresh controls from storage in case another tab changed them.
    settings = loadSettings();
    applySettings(settings, player, world);
    for (const r of refreshers) r();
    show('settings');
  });
  backBtn.addEventListener('click', () => show(settingsReturn));
  resetBtn.addEventListener('click', () => {
    settings = resetSettings();
    saveSettings(settings);
    applySettings(settings, player, world);
    for (const r of refreshers) r();
  });
  resumeBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    lockPointer();
  });
  pauseSettingsBtn.addEventListener('click', () => {
    settingsReturn = 'pause';
    settings = loadSettings();
    applySettings(settings, player, world);
    for (const r of refreshers) r();
    show('settings');
  });

  // Pause on Esc: the browser exits pointer lock, which fires
  // pointerlockchange. Show the pause view (still inside #start) only after a
  // real play session has begun and the overlay is currently hidden — the
  // first-load menu is not a pause.
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) return;
    if (!hasStarted) return;
    if (overlay.style.display !== 'none') return;
    settingsReturn = 'pause';
    show('pause');
    overlay.style.display = 'flex';
  });
}
