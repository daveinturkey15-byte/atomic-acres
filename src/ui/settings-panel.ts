/**
 * Atomic Acres — the settings view, built once.
 *
 * Extracted from `menus.ts` when the accessibility trio landed: the two
 * together passed the 400-line cap in `AGENTS.md`, and the panel is a separate
 * feature from the menu shell that hosts it.
 *
 * Every control is a native element, so Tab, arrow keys and screen readers work
 * without a keyboard implementation of our own, and every one stops click
 * propagation so adjusting a slider does not bubble to `#start`'s
 * click-to-dismiss listener and drop the player into the match mid-tweak.
 *
 * The panel never persists anything itself: it reports a patch and the menu
 * saves and applies it, so there is one place that writes storage.
 */

import type { Settings } from './settings';

export interface SettingsPanelDeps {
  read(): Settings;
  /** Called on every input. The caller sanitises, persists and applies. */
  write(patch: Partial<Settings>): void;
}

export interface SettingsPanel {
  readonly root: HTMLElement;
  /** Re-read every control from storage (another tab may have changed it). */
  refresh(): void;
}

function stop(e: Event): void {
  e.stopPropagation();
}

export function buildSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
  const root = document.createElement('div');
  root.className = 'aa-view aa-hidden';
  root.setAttribute('aria-label', 'Settings');
  const title = document.createElement('h2');
  title.className = 'aa-h2';
  title.textContent = 'Settings';
  root.append(title);

  const refreshers: Array<() => void> = [];

  function slider(
    label: string,
    min: number,
    max: number,
    step: number,
    get: (s: Settings) => number,
    patch: (v: number) => Partial<Settings>,
    fmt: (v: number) => string,
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
    row.append(head, input);
    root.append(row);
    refreshers.push(() => {
      const v = get(deps.read());
      input.value = String(v);
      val.textContent = fmt(v);
    });
  }

  function toggle(label: string, get: (s: Settings) => boolean, patch: (v: boolean) => Partial<Settings>): void {
    const row = document.createElement('label');
    row.className = 'aa-setting aa-setting-row';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', label);
    input.addEventListener('click', stop);
    input.addEventListener('change', (e) => {
      stop(e);
      deps.write(patch(input.checked));
    });
    row.append(name, input);
    root.append(row);
    refreshers.push(() => {
      input.checked = get(deps.read());
    });
  }

  const one = (v: number): string => v.toFixed(1);
  const pct = (v: number): string => Math.round(v * 100) + '%';

  slider('Sensitivity', 0.1, 5, 0.1, (s) => s.sensitivity, (v) => ({ sensitivity: v }), one);
  slider('Field of view', 60, 110, 1, (s) => s.fov, (v) => ({ fov: v }), (v) => v.toFixed(0) + '°');

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
  qSel.addEventListener('click', stop);
  qSel.addEventListener('change', (e) => {
    stop(e);
    deps.write({ quality: qSel.value as Settings['quality'] });
  });
  qRow.append(qHead, qSel);
  root.append(qRow);
  refreshers.push(() => {
    qSel.value = deps.read().quality;
  });

  // --- accessibility: the trio gameplay reads (IMPORT-PLAN §1.5) -----------
  const aHead = document.createElement('h3');
  aHead.className = 'aa-h3';
  aHead.textContent = 'Accessibility';
  root.append(aHead);
  toggle('Reduced motion', (s) => s.reducedMotion, (v) => ({ reducedMotion: v }));
  slider('Damage flash', 0, 1, 0.05, (s) => s.damageFlashScale, (v) => ({ damageFlashScale: v }), pct);
  slider('Weapon motion', 0, 1, 0.05, (s) => s.weaponMotionScale, (v) => ({ weaponMotionScale: v }), pct);

  const refresh = (): void => {
    for (const r of refreshers) r();
  };
  refresh();

  return { root, refresh };
}
