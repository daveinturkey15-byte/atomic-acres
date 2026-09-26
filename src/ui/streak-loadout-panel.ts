/**
 * Pre-match killstreak picker.
 *
 * The catalog is the roster and `SLOT_FAMILIES` is the slot policy.  The UI
 * only persists a validated four-id selection; the host remains the authority
 * that admits the loadout and refuses effects that are not wired in this
 * build.  Unsupported catalog rows stay visible and disabled so the player
 * can see the full authored ladder without being offered a fake button.
 */

import {
  DEFAULT_STREAK_LOADOUT, SLOT_FAMILIES, SLOT_TIERS, STREAK_CATALOG, streakById, validateStreakLoadout,
  type StreakLoadout,
} from '../game/killstreaks/catalog';
import { WIRED_STREAK_IDS } from '../game/killstreaks/runtime';

export const STREAK_LOADOUT_STORAGE_KEY = 'nuketown2025.streak-loadout.v1';
export const STREAK_LOADOUT_VERSION = 1;

export interface StreakLoadoutStore {
  readonly version: 1;
  readonly selected: StreakLoadout;
}

export interface StreakLoadoutSectionDeps {
  onChange?(loadout: StreakLoadout): void;
}

export interface StreakLoadoutSection {
  readonly root: HTMLElement;
  refresh(): void;
  read(): StreakLoadout;
}

function ambientStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function defaultStreakLoadoutStore(): StreakLoadoutStore {
  return { version: STREAK_LOADOUT_VERSION, selected: Object.freeze([...DEFAULT_STREAK_LOADOUT]) };
}

export function loadStreakLoadout(storage: Pick<Storage, 'getItem'> | null = ambientStorage()): StreakLoadoutStore {
  if (!storage) return defaultStreakLoadoutStore();
  try {
    const raw = storage.getItem(STREAK_LOADOUT_STORAGE_KEY);
    if (!raw) return defaultStreakLoadoutStore();
    const parsed = JSON.parse(raw) as { version?: unknown; selected?: unknown };
    if (parsed.version !== STREAK_LOADOUT_VERSION || !Array.isArray(parsed.selected)) return defaultStreakLoadoutStore();
    const check = validateStreakLoadout(parsed.selected, STREAK_CATALOG);
    if (!check.valid || parsed.selected.some((id) => !WIRED_STREAK_IDS.includes(String(id)))) return defaultStreakLoadoutStore();
    return { version: STREAK_LOADOUT_VERSION, selected: Object.freeze([...parsed.selected] as StreakLoadout) };
  } catch {
    return defaultStreakLoadoutStore();
  }
}

export function saveStreakLoadout(store: StreakLoadoutStore, storage: Pick<Storage, 'setItem'> | null = ambientStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STREAK_LOADOUT_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

function stop(e: Event): void { e.stopPropagation(); }

function duration(ms: number): string {
  if (ms <= 0) return 'INSTANT';
  const seconds = Math.round(ms / 1000);
  return `${seconds}S ACTIVE`;
}

export function buildStreakLoadoutSection(deps: StreakLoadoutSectionDeps = {}): StreakLoadoutSection {
  const root = document.createElement('section');
  root.className = 'aa-streak-loadout';
  root.setAttribute('aria-label', 'Killstreak loadout');

  const head = document.createElement('div');
  head.className = 'aa-loadhead';
  const title = document.createElement('h3');
  title.className = 'aa-loadtitle';
  title.textContent = 'STREAK SUITE';
  const meta = document.createElement('span');
  meta.className = 'aa-loadmeta';
  meta.textContent = 'HOST VERIFIED ON DEPLOY';
  head.append(title, meta);
  root.append(head);

  const note = document.createElement('div');
  note.className = 'aa-streak-note';
  note.textContent = 'Choose one streak per tier. Grey rows are catalogued for future wiring.';
  root.append(note);

  const grid = document.createElement('div');
  grid.className = 'aa-streak-loadout-grid';
  const selects: HTMLSelectElement[] = [];
  const summaries: HTMLElement[] = [];
  for (let i = 0; i < SLOT_FAMILIES.length; i++) {
    const card = document.createElement('label');
    card.className = 'aa-streak-pick';
    const top = document.createElement('span');
    top.className = 'aa-streak-pick-top';
    const slot = document.createElement('span');
    slot.textContent = `SLOT ${i + 1}`;
    const tier = document.createElement('span');
    tier.textContent = SLOT_TIERS[i].toUpperCase();
    top.append(slot, tier);

    const select = document.createElement('select');
    select.className = 'aa-streak-select';
    select.setAttribute('aria-label', `Killstreak slot ${i + 1}`);
    for (const id of SLOT_FAMILIES[i]) {
      const def = streakById(id, STREAK_CATALOG);
      if (!def) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = WIRED_STREAK_IDS.includes(id) ? def.displayName : `${def.displayName} · UNWIRED`;
      option.disabled = !WIRED_STREAK_IDS.includes(id);
      option.title = option.disabled ? 'Catalogued but unavailable in this build' : `${def.cost} kills · ${def.activation}`;
      select.append(option);
    }
    select.addEventListener('click', stop);
    select.addEventListener('change', (e) => {
      stop(e);
      const id = select.value;
      if (!WIRED_STREAK_IDS.includes(id)) return;
      const next = [...loadStreakLoadout().selected] as string[];
      next[i] = id;
      const check = validateStreakLoadout(next, STREAK_CATALOG);
      if (!check.valid || next.some((entry) => !WIRED_STREAK_IDS.includes(entry))) {
        note.textContent = check.errors.join(' · ') || 'STREAK NOT AVAILABLE IN THIS BUILD';
        refresh();
        return;
      }
      const store: StreakLoadoutStore = { version: STREAK_LOADOUT_VERSION, selected: Object.freeze(next) as StreakLoadout };
      if (!saveStreakLoadout(store)) note.textContent = 'STREAK SUITE NOT SAVED — STORAGE BLOCKED';
      else note.textContent = 'STREAK SUITE SAVED FOR THE NEXT DEPLOY';
      deps.onChange?.(store.selected);
      refresh();
    });

    const summary = document.createElement('span');
    summary.className = 'aa-streak-pick-summary';
    card.append(top, select, summary);
    grid.append(card);
    selects.push(select);
    summaries.push(summary);
  }
  root.append(grid);

  function refresh(): void {
    const selected = loadStreakLoadout().selected;
    for (let i = 0; i < selects.length; i++) {
      const id = selected[i];
      selects[i].value = id;
      const def = streakById(id, STREAK_CATALOG);
      summaries[i].textContent = def === null
        ? 'UNAVAILABLE'
        : `${def.cost} KILLS · ${def.activation.replace('-', ' ').toUpperCase()} · ${duration(def.durationMs)}`;
    }
  }

  refresh();
  return { root, refresh, read: () => loadStreakLoadout().selected };
}
