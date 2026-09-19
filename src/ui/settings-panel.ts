/**
 * Atomic Acres — the options view, built once. Four tabs: Graphics, Controls,
 * Audio, Accessibility.
 *
 * Every control is a native element, so Tab, arrow keys and screen readers work
 * without a keyboard implementation of our own, and every one stops click
 * propagation so adjusting a slider cannot bubble to `#start` and drop the
 * player into a match mid-tweak.
 *
 * The panel never persists anything itself: it reports a patch and the menu
 * saves and applies it, so there is one place that writes storage. Beside each
 * control is the HONEST status of that option (`settings-apply.ts:OPTION_STATUS`):
 * `applies now`, `applies now (input shim ...)`, or `saved; no consumer in this
 * build yet`. A menu that shows an AO toggle the renderer cannot yet read says so
 * on the row rather than pretending.
 *
 * `quality` is DERIVED (`settings.ts:qualityOf`), never stored: picking a preset
 * writes the four knobs, and moving a knob makes the select read `Custom`.
 */

import { OPTION_STATUS, STATUS_NOTE } from './settings-apply';
import { buildBindingRows } from './settings-bindings';
import {
  FOV_MAX, FOV_MIN, QUALITY_NAMES, RESOLUTION_MIN, SHADOW_MAP_SIZES, presetPatch, qualityOf,
  type QualityName, type Settings,
} from './settings';

export interface SettingsPanelDeps {
  read(): Settings;
  /** Called on every input. The caller sanitises, persists and applies. */
  write(patch: Partial<Settings>): void;
}

export interface SettingsPanel {
  readonly root: HTMLElement;
  /** Re-read every control from storage (another tab may have changed it). */
  refresh(): void;
  /** True while a key capture is armed: Escape belongs to the capture then. */
  capturing(): boolean;
}

export const SETTINGS_TABS = ['graphics', 'controls', 'audio', 'access'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
const TAB_LABEL: Record<SettingsTab, string> = { graphics: 'Graphics', controls: 'Controls', audio: 'Audio', access: 'Accessibility' };

function stop(e: Event): void {
  e.stopPropagation();
}

function note(key: string): HTMLElement {
  const n = document.createElement('span');
  n.className = 'aa-note aa-note-' + (OPTION_STATUS[key] ?? 'persist');
  n.textContent = STATUS_NOTE[OPTION_STATUS[key] ?? 'persist'];
  return n;
}

export function buildSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
  const root = document.createElement('div');
  root.className = 'aa-view aa-hidden aa-options';
  root.setAttribute('aria-label', 'Options');
  const title = document.createElement('h2');
  title.className = 'aa-h2';
  title.textContent = 'Options';
  root.append(title);

  const refreshers: Array<() => void> = [];
  const tabs = document.createElement('div');
  tabs.className = 'aa-tabs';
  tabs.setAttribute('role', 'tablist');
  const pages = new Map<SettingsTab, HTMLElement>();
  const tabButtons = new Map<SettingsTab, HTMLButtonElement>();
  let current: SettingsTab = 'graphics';
  const showTab = (t: SettingsTab): void => {
    current = t;
    for (const [id, page] of pages) page.classList.toggle('aa-hidden', id !== t);
    for (const [id, b] of tabButtons) b.setAttribute('aria-selected', id === t ? 'true' : 'false');
  };
  for (const t of SETTINGS_TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'aa-tab';
    b.setAttribute('role', 'tab');
    b.textContent = TAB_LABEL[t];
    b.addEventListener('click', (e) => { stop(e); showTab(t); });
    tabButtons.set(t, b);
    tabs.append(b);
    const page = document.createElement('div');
    page.className = 'aa-tabpage aa-hidden';
    page.setAttribute('role', 'tabpanel');
    pages.set(t, page);
  }
  root.append(tabs);
  for (const page of pages.values()) root.append(page);

  const page = (t: SettingsTab): HTMLElement => pages.get(t) as HTMLElement;

  function slider(
    into: HTMLElement, key: string, label: string, min: number, max: number, step: number,
    get: (s: Settings) => number, patch: (v: number) => Partial<Settings>, fmt: (v: number) => string,
  ): void {
    const row = document.createElement('label');
    row.className = 'aa-setting';
    const head = document.createElement('div');
    head.className = 'aa-setting-head';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.className = 'aa-val';
    head.append(name, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    input.addEventListener('click', stop);
    input.addEventListener('input', (e) => {
      stop(e);
      const v = Number(input.value);
      val.textContent = fmt(v);
      deps.write(patch(v));
    });
    row.append(head, input, note(key));
    into.append(row);
    refreshers.push(() => {
      const v = get(deps.read());
      input.value = String(v);
      val.textContent = fmt(v);
    });
  }

  function toggle(into: HTMLElement, key: string, label: string, get: (s: Settings) => boolean, patch: (v: boolean) => Partial<Settings>): void {
    const row = document.createElement('label');
    row.className = 'aa-setting aa-setting-row';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', label);
    input.addEventListener('click', stop);
    input.addEventListener('change', (e) => { stop(e); deps.write(patch(input.checked)); });
    row.append(name, input, note(key));
    into.append(row);
    refreshers.push(() => { input.checked = get(deps.read()); });
  }

  function select(
    into: HTMLElement, key: string, label: string, options: readonly { value: string; text: string }[],
    get: (s: Settings) => string, patch: (v: string) => Partial<Settings>,
  ): HTMLSelectElement {
    const row = document.createElement('label');
    row.className = 'aa-setting aa-setting-row';
    const name = document.createElement('span');
    name.textContent = label;
    const sel = document.createElement('select');
    sel.className = 'aa-select';
    sel.setAttribute('aria-label', label);
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.text;
      sel.append(opt);
    }
    sel.addEventListener('click', stop);
    sel.addEventListener('change', (e) => { stop(e); deps.write(patch(sel.value)); });
    row.append(name, sel, note(key));
    into.append(row);
    refreshers.push(() => { sel.value = get(deps.read()); });
    return sel;
  }

  const one = (v: number): string => v.toFixed(1);
  const pct = (v: number): string => Math.round(v * 100) + '%';
  const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

  // ---- graphics -----------------------------------------------------------
  const g = page('graphics');
  const qSel = select(g, 'quality', 'Quality preset',
    [...QUALITY_NAMES.map((q) => ({ value: q, text: cap(q) + (q === 'ultra' ? ' (= High on this build)' : '') })), { value: 'custom', text: 'Custom' }],
    (s) => qualityOf(s), (v) => (v === 'custom' ? {} : presetPatch(v as QualityName)));
  (qSel.querySelector('option[value="custom"]') as HTMLOptionElement).disabled = true;
  refreshers.push(() => {
    const q = qualityOf(deps.read());
    (qSel.querySelector('option[value="custom"]') as HTMLOptionElement).disabled = q !== 'custom';
    qSel.value = q;
  });
  select(g, 'shadowMapSize', 'Shadow map', SHADOW_MAP_SIZES.map((n) => ({ value: String(n), text: n + ' px' })),
    (s) => String(s.shadowMapSize), (v) => ({ shadowMapSize: Number(v) as Settings['shadowMapSize'] }));
  toggle(g, 'ao', 'Ambient occlusion', (s) => s.ao, (v) => ({ ao: v }));
  toggle(g, 'ssr', 'Screen-space reflections', (s) => s.ssr, (v) => ({ ssr: v }));
  toggle(g, 'bloom', 'Bloom', (s) => s.bloom, (v) => ({ bloom: v }));
  slider(g, 'resolutionScale', 'Resolution scale', RESOLUTION_MIN, 1, 0.05, (s) => s.resolutionScale, (v) => ({ resolutionScale: v }), pct);
  slider(g, 'fov', 'Field of view', FOV_MIN, FOV_MAX, 1, (s) => s.fov, (v) => ({ fov: v }), (v) => v.toFixed(0) + '°');
  const mb = document.createElement('div');
  mb.className = 'aa-setting aa-setting-row aa-muted';
  mb.append(Object.assign(document.createElement('span'), { textContent: 'Motion blur' }), Object.assign(document.createElement('span'), { textContent: 'n/a - the post chain has no motion-blur pass' }));
  g.append(mb);

  // ---- controls -----------------------------------------------------------
  const c = page('controls');
  slider(c, 'sensitivity', 'Mouse sensitivity', 0.1, 5, 0.1, (s) => s.sensitivity, (v) => ({ sensitivity: v }), one);
  toggle(c, 'invertY', 'Invert Y', (s) => s.invertY, (v) => ({ invertY: v }));
  toggle(c, 'netOverlay', 'Netcode diagnostics overlay (F3)', (s) => s.netOverlay, (v) => ({ netOverlay: v }));
  const bh = document.createElement('h3');
  bh.className = 'aa-h3';
  bh.textContent = 'Key bindings';
  c.append(bh);
  const rows = buildBindingRows({ read: () => deps.read().bindings, write: (b) => deps.write({ bindings: b }) });
  c.append(rows.root, note('bindings'));
  refreshers.push(() => rows.refresh());

  // ---- audio --------------------------------------------------------------
  const a = page('audio');
  slider(a, 'masterVolume', 'Master volume', 0, 1, 0.05, (s) => s.masterVolume, (v) => ({ masterVolume: v }), pct);
  slider(a, 'effectsVolume', 'Effects volume', 0, 1, 0.05, (s) => s.effectsVolume, (v) => ({ effectsVolume: v }), pct);
  const an = document.createElement('div');
  an.className = 'aa-hint';
  an.textContent = 'This build has no audio bus: the only sounds are inside the weapon controller, with no volume hook. Both sliders persist and take effect the moment one lands.';
  a.append(an);

  // ---- accessibility: the trio gameplay reads (IMPORT-PLAN §1.5) ----------
  const x = page('access');
  toggle(x, 'reducedMotion', 'Reduced motion', (s) => s.reducedMotion, (v) => ({ reducedMotion: v }));
  slider(x, 'damageFlashScale', 'Damage flash', 0, 1, 0.05, (s) => s.damageFlashScale, (v) => ({ damageFlashScale: v }), pct);
  slider(x, 'weaponMotionScale', 'Weapon motion', 0, 1, 0.05, (s) => s.weaponMotionScale, (v) => ({ weaponMotionScale: v }), pct);

  showTab(current);
  const refresh = (): void => {
    for (const r of refreshers) r();
  };
  refresh();

  return { root, refresh, capturing: () => rows.capturing() };
}
