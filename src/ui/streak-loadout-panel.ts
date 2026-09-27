/**
 * Pre-match killstreak picker.
 *
 * The catalog is the roster and `SLOT_FAMILIES` is the slot policy.  The UI
 * only persists a validated five-id selection; the host remains the authority
 * that admits the loadout and refuses effects that are not wired in this
 * build.  Unsupported catalog rows stay visible and disabled so the player
 * can see the full authored ladder without being offered a fake button.
 */

import {
  DEFAULT_STREAK_LOADOUT, MUTUAL_EXCLUSIONS, SLOT_FAMILIES, SLOT_TIERS, STREAK_CATALOG, streakById, validateStreakLoadout,
  type StreakLoadout,
} from '../game/killstreaks/catalog';
import { WIRED_STREAK_IDS } from '../game/killstreaks/runtime';
import { streakDescription } from './streak-descriptions';
import { STREAK_SLOT_CODES } from './streak-presentation';
import { codeLabel } from './bindings';

export const LEGACY_STREAK_LOADOUT_STORAGE_KEY = 'nuketown2025.streak-loadout.v1';
export const STREAK_LOADOUT_STORAGE_KEY = 'nuketown2025.streak-loadout.v2';
export const STREAK_LOADOUT_VERSION = 2;

export interface StreakLoadoutStore {
  readonly version: 2;
  readonly selected: StreakLoadout;
  readonly legacyRetained: boolean;
  readonly migratedFrom: 1 | null;
}

export interface StreakLoadoutSectionDeps {
  codes?(): readonly string[];
  onChange?(loadout: StreakLoadout): void;
}

export interface StreakLoadoutSection {
  readonly root: HTMLElement;
  refresh(): void;
  read(): StreakLoadout;
  setEditable(editable: boolean): void;
}

function ambientStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function defaultStreakLoadoutStore(): StreakLoadoutStore {
  return { version: STREAK_LOADOUT_VERSION, selected: Object.freeze([...DEFAULT_STREAK_LOADOUT]), legacyRetained: false, migratedFrom: null };
}

/** Pure migration; the caller never writes the legacy record. Old order breaks ties. */
export function migrateLegacyStreakLoadout(value: unknown): StreakLoadout | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { version?: unknown; selected?: unknown };
  if (record.version !== 1 || !Array.isArray(record.selected) || record.selected.length !== 4) return null;
  const old: unknown[] = record.selected;
  const legacyFamilies: readonly (readonly string[])[] = [SLOT_FAMILIES[0].filter(id => id !== 'supply-crate'),
    SLOT_FAMILIES[0].filter(id => id !== 'supply-crate'), [...SLOT_FAMILIES[1], 'supply-crate'],
    [...SLOT_FAMILIES[2], ...SLOT_FAMILIES[4]]];
  if (new Set(old).size !== old.length || old.some((id, i) => typeof id !== 'string'
    || !legacyFamilies[i].includes(id) || !WIRED_STREAK_IDS.includes(id))) return null;
  if (MUTUAL_EXCLUSIONS.some(([a, b]) => old.includes(a) && old.includes(b))) return null;
  const selected: string[] = [];
  for (let i = 0; i < SLOT_FAMILIES.length; i++) {
    const candidates = [...old, DEFAULT_STREAK_LOADOUT[i], ...DEFAULT_STREAK_LOADOUT, ...SLOT_FAMILIES[i]];
    const id = candidates.find((candidate): candidate is string => typeof candidate === 'string'
      && SLOT_FAMILIES[i].some(id => id === candidate) && !selected.includes(candidate)
      && WIRED_STREAK_IDS.includes(candidate)
      && !MUTUAL_EXCLUSIONS.some(([a, b]) => candidate === a && selected.includes(b) || candidate === b && selected.includes(a)));
    if (!id) return null;
    selected.push(id);
  }
  return validateStreakLoadout(selected).valid ? Object.freeze(selected) as StreakLoadout : null;
}

function parseRecord(raw: string | null): Record<string, unknown> | null {
  try { const v: unknown = raw === null ? null : JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; }
  catch { return null; }
}

export function loadStreakLoadout(storage: Pick<Storage, 'getItem'> | null = ambientStorage()): StreakLoadoutStore {
  if (!storage) return defaultStreakLoadoutStore();
  try {
    const legacyRaw = storage.getItem(LEGACY_STREAK_LOADOUT_STORAGE_KEY);
    const parsed = parseRecord(storage.getItem(STREAK_LOADOUT_STORAGE_KEY));
    if (parsed?.version === STREAK_LOADOUT_VERSION && Array.isArray(parsed.selected)
      && validateStreakLoadout(parsed.selected).valid && parsed.selected.every(id => WIRED_STREAK_IDS.includes(String(id)))) {
      return { version: 2, selected: Object.freeze([...parsed.selected]) as StreakLoadout,
        legacyRetained: legacyRaw !== null, migratedFrom: parsed.migratedFrom === 1 ? 1 : null };
    }
    const migrated = migrateLegacyStreakLoadout(parseRecord(legacyRaw));
    return { ...defaultStreakLoadoutStore(), ...(migrated ? { selected: migrated, migratedFrom: 1 as const } : {}),
      legacyRetained: legacyRaw !== null };
  } catch {
    return defaultStreakLoadoutStore();
  }
}

export function saveStreakLoadout(store: StreakLoadoutStore, storage: (Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'getItem'>>) | null = ambientStorage()): boolean {
  if (!storage || store.version !== 2 || !validateStreakLoadout(store.selected).valid
    || store.selected.some(id => !WIRED_STREAK_IDS.includes(id))) return false;
  try {
    const raw = JSON.stringify(store);
    storage.setItem(STREAK_LOADOUT_STORAGE_KEY, raw);
    return storage.getItem ? storage.getItem(STREAK_LOADOUT_STORAGE_KEY) === raw : true;
  } catch {
    return false;
  }
}

/** Picking the other heavy slot's reward swaps them before canonical validation. */
export function chooseStreakSlot(selected: StreakLoadout, index: number, id: string): StreakLoadout | null {
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_FAMILIES.length || !WIRED_STREAK_IDS.includes(id)) return null;
  const next: string[] = [...selected], sibling = index === 2 ? 3 : index === 3 ? 2 : -1;
  if (sibling >= 0 && next[sibling] === id) next[sibling] = next[index];
  next[index] = id;
  return validateStreakLoadout(next).valid ? Object.freeze(next) as StreakLoadout : null;
}

function stop(e: Event): void { e.stopPropagation(); }

function duration(ms: number): string {
  if (ms <= 0) return 'INSTANT';
  const seconds = Math.round(ms / 1000);
  return `${seconds}S ACTIVE`;
}

export function buildStreakLoadoutSection(deps: StreakLoadoutSectionDeps = {}): StreakLoadoutSection {
  let unsaved: StreakLoadoutStore | null = null, editable = true;
  const readStore = (): StreakLoadoutStore => unsaved ?? loadStreakLoadout();
  const read = (): StreakLoadout => readStore().selected;
  const codes = (): readonly string[] => deps.codes?.() ?? STREAK_SLOT_CODES;
  const keyNote = (): string => 'Choose five streaks. Keys ' + codes().slice(0, SLOT_FAMILIES.length).map(codeLabel).join(' · ')
    + '; extra crate reward ' + codeLabel(codes()[SLOT_FAMILIES.length]) + '.';
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
  meta.textContent = 'KEYS ' + codes().slice(0, SLOT_FAMILIES.length).map(codeLabel).join(' · ');
  const defaults = document.createElement('button');
  defaults.type = 'button'; defaults.className = 'aa-button'; defaults.textContent = 'USE DEFAULTS';
  defaults.setAttribute('aria-label', 'Use default killstreak loadout');
  head.append(title, meta, defaults);
  root.append(head);

  const note = document.createElement('div');
  note.className = 'aa-streak-note';
  note.setAttribute('aria-live', 'polite');
  note.textContent = readStore().migratedFrom === 1
    ? 'Saved four-slot setup adapted to five slots. Original setup retained.'
    : keyNote();
  root.append(note);

  const grid = document.createElement('div');
  grid.className = 'aa-streak-loadout-grid';
  const selects: HTMLSelectElement[] = [];
  const summaries: HTMLElement[] = [];
  const keyLabels: HTMLElement[] = [];
  for (let i = 0; i < SLOT_FAMILIES.length; i++) {
    const card = document.createElement('label');
    card.className = 'aa-streak-pick';
    const top = document.createElement('span');
    top.className = 'aa-streak-pick-top';
    const slot = document.createElement('span');
    slot.textContent = `KEY ${codeLabel(codes()[i])}`;
    keyLabels.push(slot);
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
      option.textContent = WIRED_STREAK_IDS.includes(id) ? def.displayName : `${def.displayName} · UNAVAILABLE`;
      option.disabled = !WIRED_STREAK_IDS.includes(id);
      option.title = option.disabled ? 'Catalogued but unavailable in this build' : `${def.cost} kills · ${def.activation}`;
      select.append(option);
    }
    select.addEventListener('click', stop);
    select.addEventListener('change', (e) => {
      stop(e);
      if (!editable || select.matches(':disabled')) { refresh(); return; }
      const id = select.value;
      const before = read(), sibling = i === 2 ? 3 : i === 3 ? 2 : -1;
      const swapped = sibling >= 0 && before[sibling] === id && before[i] !== id;
      const next = chooseStreakSlot(before, i, id);
      if (!next) {
        note.textContent = 'That reward cannot be selected in this slot.';
        refresh();
        return;
      }
      commit(next, swapped ? `HEAVY SLOTS SWAPPED · ` : '');
    });

    const summary = document.createElement('span');
    summary.className = 'aa-streak-pick-summary';
    card.append(top, select, summary);
    grid.append(card);
    selects.push(select);
    summaries.push(summary);
  }
  root.append(grid);

  function commit(selected: StreakLoadout, prefix = ''): void {
    const store: StreakLoadoutStore = { ...readStore(), selected };
    const saved = saveStreakLoadout(store);
    unsaved = saved ? null : store;
    note.textContent = prefix + (saved ? 'STREAK SUITE SAVED FOR THE NEXT DEPLOY' : 'SELECTED FOR THIS SESSION · STORAGE BLOCKED');
    deps.onChange?.(selected);
    refresh();
  }
  defaults.addEventListener('click', (event) => {
    stop(event);
    if (editable && !defaults.matches(':disabled')) commit(Object.freeze([...DEFAULT_STREAK_LOADOUT]));
  });

  function refresh(): void {
    const selected = read();
    meta.textContent = 'KEYS ' + codes().slice(0, SLOT_FAMILIES.length).map(codeLabel).join(' · ');
    defaults.disabled = !editable;
    for (let i = 0; i < selects.length; i++) {
      keyLabels[i].textContent = `KEY ${codeLabel(codes()[i])}`;
      const id = selected[i];
      selects[i].value = id;
      selects[i].disabled = !editable;
      for (const option of Array.from(selects[i].options)) {
        option.disabled = chooseStreakSlot(selected, i, option.value) === null;
        const candidate = streakById(option.value);
        option.title = option.disabled ? 'Unavailable with this loadout' : candidate ? streakDescription(candidate.id) : '';
      }
      const def = streakById(id, STREAK_CATALOG);
      summaries[i].textContent = def === null
        ? 'UNAVAILABLE'
        : `${def.cost} KILLS · ${duration(def.durationMs)} — ${streakDescription(def.id)}`;
    }
  }

  refresh();
  return { root, refresh, read, setEditable(value) {
    editable = value;
    note.textContent = value ? keyNote() : 'MATCH ACTIVE · STREAK SELECTION FROZEN';
    refresh();
  } };
}
