/** Actual native catalog/storage/panel/projection CPU proof. No browser or GPU. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const output = join(mkdtempSync(join(tmpdir(), 'aa-streak-parity-')), 'actual.mjs');
await build({ stdin: { resolveDir: root, contents: `
export * from './src/game/killstreaks/catalog';
export * from './src/ui/streak-loadout-panel';
export * from './src/ui/streak-presentation';
export * from './src/ui/streak-descriptions';
` }, outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(output).href);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
const defaults = ['supply-crate', 'piloted-drone', 'carpet-bomber', 'chopper', 'drone-swarm'];
const oldDefault = { version: 1, selected: ['recon-sweep', 'signal-jam', 'sentry-post', 'blast-mortar'] };
const oldRaw = JSON.stringify(oldDefault);
const storage = new Map(); let writes = 0, blocked = false;
const storageApi = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { writes++; if (blocked) throw Error('storage denied'); storage.set(key, value); },
};
test('five chosen native families, independent top slot and frozen reward percentages', () => {
  assert.equal(api.SLOT_COUNT, 5);
  assert.deepEqual(api.SLOT_TIERS, ['low', 'mid', 'high', 'high', 'top']);
  assert.deepEqual(api.DEFAULT_STREAK_LOADOUT, defaults);
  assert(api.SLOT_FAMILIES[0].includes('supply-crate'));
  assert(!api.SLOT_FAMILIES[1].includes('supply-crate'));
  assert.deepEqual(api.SLOT_FAMILIES[2], api.SLOT_FAMILIES[3]);
  assert.deepEqual(api.SLOT_FAMILIES[4], ['drone-swarm', 'last-resort']);
  assert(!api.SLOT_FAMILIES[2].includes('drone-swarm'));
  assert.equal(api.STREAK_CATALOG.definitions.filter(d => d.availability === 'selectable').length, 16);
  const pool = api.STREAK_CATALOG.rewardPool;
  for (const [id, percent] of Object.entries({ 'field-repair': 10, 'crimson-flamethrower': 10, 'last-resort': 1 })) {
    assert.equal(pool.entries.find(row => row.id === id).weightUnits * 100, pool.totalUnits * percent);
  }
  assert(!pool.entries.some(row => row.id === 'supply-crate'));
});
test('illegal duplicate/top/reward/four-slot selections remain refused', () => {
  for (const bad of [oldDefault.selected, [...defaults.slice(0, 4)],
    ['supply-crate', 'piloted-drone', 'drone-swarm', 'chopper', 'last-resort'],
    ['supply-crate', 'piloted-drone', 'chopper', 'chopper', 'drone-swarm'],
    ['crimson-flamethrower', ...defaults.slice(1)]]) assert(!api.validateStreakLoadout(bad).valid);
  assert.equal(api.chooseStreakSlot(defaults, -1, 'chopper'), null);
  assert.equal(api.chooseStreakSlot(defaults, 5, 'chopper'), null);
});
test('heavy duplicate choice swaps immutable slots only', () => {
  const original = Object.freeze([...defaults]);
  const swapped = api.chooseStreakSlot(original, 2, 'chopper');
  assert.deepEqual(swapped, ['supply-crate', 'piloted-drone', 'chopper', 'carpet-bomber', 'drone-swarm']);
  assert.deepEqual(original, defaults);
  assert.deepEqual(api.chooseStreakSlot(swapped, 3, 'chopper'), defaults);
  assert.equal(api.chooseStreakSlot(defaults, 0, 'chopper'), null);
});
test('v1 default migration keeps compatible choices and exact original bytes without writes', () => {
  storage.set(api.LEGACY_STREAK_LOADOUT_STORAGE_KEY, oldRaw);
  const migrated = api.loadStreakLoadout(storageApi);
  assert.deepEqual(migrated.selected, ['recon-sweep', 'sentry-post', 'blast-mortar', 'chopper', 'drone-swarm']);
  assert.equal(migrated.version, 2); assert.equal(migrated.migratedFrom, 1); assert(migrated.legacyRetained);
  assert.equal(writes, 0); assert.equal(storage.get(api.LEGACY_STREAK_LOADOUT_STORAGE_KEY), oldRaw);
  assert.deepEqual(oldDefault, JSON.parse(oldRaw));
});
test('every legal retained four-slot combination migrates deterministically without mutation', () => {
  const low = api.SLOT_FAMILIES[0].filter(id => id !== 'supply-crate');
  const mid = [...api.SLOT_FAMILIES[1], 'supply-crate'];
  const high = [...api.SLOT_FAMILIES[2], ...api.SLOT_FAMILIES[4]];
  let checked = 0;
  for (const a of low) for (const b of low) for (const c of mid) for (const d of high) {
    const selected = [a, b, c, d];
    if (new Set(selected).size !== 4 || api.MUTUAL_EXCLUSIONS.some(([x, y]) => selected.includes(x) && selected.includes(y))) continue;
    const record = { version: 1, selected: Object.freeze(selected) }, before = JSON.stringify(record);
    const migrated = api.migrateLegacyStreakLoadout(record);
    assert(migrated && api.validateStreakLoadout(migrated).valid);
    assert.deepEqual(api.migrateLegacyStreakLoadout(record), migrated);
    assert.equal(JSON.stringify(record), before); checked++;
  }
  assert(checked > 100); console.log('  retained combinations: ' + checked);
});
test('malformed v1 refused; validated v2 takes priority and legacy remains untouched', () => {
  for (const bad of [null, {}, { version: 2, selected: oldDefault.selected },
    { version: 1, selected: ['bogus', ...oldDefault.selected.slice(1)] },
    { version: 1, selected: ['recon-sweep', 'recon-sweep', 'sentry-post', 'blast-mortar'] }]) {
    assert.equal(api.migrateLegacyStreakLoadout(bad), null);
  }
  const v2 = { ...api.defaultStreakLoadoutStore(), legacyRetained: true };
  assert(api.saveStreakLoadout(v2, storageApi));
  assert.deepEqual(api.loadStreakLoadout(storageApi).selected, defaults);
  assert.equal(storage.get(api.LEGACY_STREAK_LOADOUT_STORAGE_KEY), oldRaw);
  storage.set(api.STREAK_LOADOUT_STORAGE_KEY, '{bad');
  assert.equal(api.loadStreakLoadout(storageApi).migratedFrom, 1);
});
test('invalid store cannot persist; silent storage refusal fails readback', () => {
  const before = writes;
  assert(!api.saveStreakLoadout({ ...api.defaultStreakLoadoutStore(), selected: oldDefault.selected }, storageApi));
  assert.equal(writes, before);
  assert(!api.saveStreakLoadout(api.defaultStreakLoadoutStore(), { setItem() {}, getItem() { return null; } }));
});

function element(tag) {
  const e = { tagName: tag.toUpperCase(), children: [], parentElement: null, attributes: {}, listeners: {},
    textContent: '', disabled: false, value: '', className: '',
    append(...nodes) { for (const n of nodes) { this.children.push(n); n.parentElement = this; } },
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    dispatch(type) { for (const fn of this.listeners[type] ?? []) fn({ target: this, stopPropagation() {} }); },
    matches(selector) { assert.equal(selector, ':disabled'); return this.disabled ||
      (this.parentElement?.tagName === 'FIELDSET' && this.parentElement.disabled) ||
      (this.parentElement ? this.parentElement.matches(selector) : false); },
  };
  Object.defineProperty(e, 'options', { get() { return e.children.filter(n => n.tagName === 'OPTION'); } });
  return e;
}
globalThis.document = { createElement: element };
globalThis.localStorage = storageApi;
const flatten = e => [e, ...e.children.flatMap(flatten)];
storage.clear(); writes = 0;
let callbacks = 0, changed = null;
const panel = api.buildStreakLoadoutSection({ onChange(value) { changed = value; callbacks++; } });
const nodes = flatten(panel.root), selects = nodes.filter(e => e.tagName === 'SELECT');
const reset = nodes.find(e => e.tagName === 'BUTTON' && e.textContent === 'USE DEFAULTS');
test('actual menu exposes five numbered choices, descriptions and default reset', () => {
  assert.equal(selects.length, 5); assert(reset);
  for (let i = 0; i < 5; i++) assert(nodes.some(e => e.textContent === `KEY ${i + 3}`));
  assert.equal(nodes.filter(e => e.className === 'aa-streak-pick-summary' && /KILLS.* — .+/.test(e.textContent)).length, 5);
  selects[2].value = 'chopper'; selects[2].dispatch('change');
  assert.equal(changed[2], 'chopper'); assert.equal(changed[3], 'carpet-bomber');
  assert.equal(selects[3].value, 'carpet-bomber');
  assert(!selects[2].options.find(e => e.value === 'carpet-bomber').disabled);
  reset.dispatch('click'); assert.deepEqual(panel.read(), defaults);
});
test('actual panel freeze rejects synthetic changes and defaults; ancestor fieldset also fences', () => {
  const before = callbacks; panel.setEditable(false);
  assert(selects.every(e => e.disabled)); assert(reset.disabled);
  selects[0].value = 'adrenaline'; selects[0].dispatch('change'); reset.dispatch('click');
  assert.equal(callbacks, before); assert.deepEqual(panel.read(), defaults);
  panel.setEditable(true);
  const fieldset = element('fieldset'); fieldset.disabled = true; fieldset.append(panel.root);
  selects[0].value = 'adrenaline'; selects[0].dispatch('change'); reset.dispatch('click');
  assert.equal(callbacks, before); fieldset.disabled = false;
});
test('storage refusal keeps honest session-only selection through refresh', () => {
  blocked = true; const saved = storage.get(api.STREAK_LOADOUT_STORAGE_KEY);
  selects[0].value = 'adrenaline'; selects[0].dispatch('change');
  panel.refresh(); assert.equal(panel.read()[0], 'adrenaline'); assert.equal(changed[0], 'adrenaline');
  assert.equal(storage.get(api.STREAK_LOADOUT_STORAGE_KEY), saved);
  assert(nodes.some(e => e.textContent.includes('STORAGE BLOCKED'))); blocked = false;
});
test('chosen fifth reward stays key7; conditional sixth reward alone uses key8', () => {
  assert.deepEqual(api.STREAK_SLOT_CODES, ['Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8']);
  const chosen = defaults.map(id => ({ id, charges: 1 }));
  const cards = api.projectStreakStrip(chosen, 15);
  assert.equal(cards.length, 5); assert.equal(cards[4].key, '7');
  assert(!cards[4].stateText.includes('CRATE'));
  const bonus = api.projectStreakStrip([...chosen, { id: 'adrenaline', charges: 1 }], 15);
  assert.equal(bonus.length, 6); assert.equal(bonus[5].key, '8');
  assert.match(bonus[5].stateText, /CRATE REWARD/); assert.equal(bonus[5].state, 'ready');
});
test('rebound key codes reach visible hints and accessibility text without changing authority', () => {
  const slots = defaults.map(id => ({ id, charges: 1 }));
  const rebound = api.projectStreakStrip(slots, 15, ['KeyJ', 'KeyK', 'KeyL', 'Numpad1', 'Numpad2', 'Numpad3']);
  assert.deepEqual(rebound.map(row => row.key), ['J', 'K', 'L', 'NUM 1', 'NUM 2']);
  assert.match(rebound[0].aria, /PRESS J/); assert.match(rebound[4].hint, /PRESS NUM 2/);
  assert.deepEqual(rebound.map(row => row.state), ['ready', 'ready', 'ready', 'ready', 'ready']);
  assert.equal(api.projectStreakStrip(slots, 15, [])[0].key, '?');
});
const files = ['src/game/killstreaks/catalog.ts', 'src/ui/streak-loadout-panel.ts', 'src/ui/streak-presentation.ts', 'src/ui/streak-descriptions.ts'];
console.log(JSON.stringify({ status: 'PASS', groups: passed, scope: 'CPU source only; no runtime/browser acceptance', hashes:
  Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])) }, null, 2));
