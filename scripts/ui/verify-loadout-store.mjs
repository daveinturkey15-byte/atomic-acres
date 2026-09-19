// Headless verifier for src/ui/loadout-panel.ts — drives the real component
// over a minimal DOM stub and the real game/loadout store. Complements the
// browser gate (scripts/ui/verify-menu-hud-live.mjs at root) with a CPU-only
// check of the loadout-selection contract. Run: node scripts/ui/verify-loadout-store.mjs
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const bundle = join(tmpdir(), `loadout-panel-verify-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [join(repoRoot, 'src/ui/loadout-panel.ts')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  logLevel: 'warning',
});
let buildLoadoutSection;
try {
  ({ buildLoadoutSection } = await import(pathToFileURL(bundle).href));
} finally {
  await rm(bundle, { force: true });
}

// --- minimal DOM stub -------------------------------------------------------
function makeEl(tag) {
  const el = {
    tag,
    children: [],
    listeners: {},
    textContent: '',
    title: '',
    style: {},
    classList: {
      _set: new Set(),
      toggle(c, force) {
        const on = force === undefined ? !this._set.has(c) : force;
        if (on) this._set.add(c); else this._set.delete(c);
      },
      contains(c) { return el.classList._set.has(c); },
    },
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k]; },
    attrs: {},
    append(...nodes) { for (const n of nodes) el.children.push(n); },
    addEventListener(type, fn) { (el.listeners[type] ??= []).push(fn); },
    click() { for (const fn of el.listeners.click ?? []) fn({ stopPropagation() {} }); },
  };
  Object.defineProperty(el, 'className', {
    get: () => [...el.classList._set].join(' '),
    set: (v) => { el.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  // textContent -> reflect into children? Not needed; we assert on .textContent directly.
  return el;
}
const doc = {
  createElement(tag) { return makeEl(tag); },
};
globalThis.document = doc;

// The store port is ambient localStorage; install a capture stub BEFORE use.
let saved = null;
globalThis.localStorage = {
  getItem: () => saved,
  setItem: (k, v) => { saved = v; },
};

const { root } = buildLoadoutSection();
const byClass = (el, cls) => {
  const out = [];
  const walk = (n) => { if (n.classList?.contains(cls)) out.push(n); for (const c of n.children ?? []) walk(c); };
  walk(el);
  return out;
};

// 1. Data-derived roster: 4 kits, 3 tactical options incl. semtex.
const kits = byClass(root, 'aa-kit');
assert.strictEqual(kits.length, 4, 'four kit cards rendered');
const tacs = byClass(root, 'aa-tac');
assert.strictEqual(tacs.length, 3, 'three tactical options from TACTICAL_IDS');
const tacNames = tacs.map((t) => t.children.find((c) => c.className === 'aa-tac-name').textContent);
assert.deepStrictEqual(tacNames, ['Flashbang', 'Smoke', 'Semtex'], 'tactical names derived from the ordnance table');
const semtexLine = tacs[2].children.find((c) => c.className === 'aa-tac-line').textContent;
assert.match(semtexLine, /sticks on contact/, 'semtex stat line derived from sticks flag');
assert.match(semtexLine, /230 dmg/, 'semtex stat line derived from blast table');

// 2. Default store (linekeeper, grenade frag) -> tactical highlight falls back to flash.
let flashSel = tacs[0].getAttribute('aria-pressed');
assert.strictEqual(flashSel, 'true', 'no-kit-tactical falls back to first tactical id (flash)');
assert.match(root.children.find((c) => c.className === 'aa-loadline').textContent, /Longhorn/i, 'deploy line names resolved primary');

// 3. Pick semtex -> custom slot mirrors the kit primary; persists.
tacs[2].click();
let store = JSON.parse(saved);
assert.strictEqual(store.selected.kind, 'custom', 'semtex on a frag kit writes a custom selection');
const slot = store.custom[store.selected.slot];
assert.ok(slot, 'selected slot exists');
assert.strictEqual(slot.primary, 'longhorn', 'custom slot mirrors kit primary');
assert.strictEqual(slot.grenade, 'semtex', 'custom slot carries the chosen tactical');
assert.match(root.children.find((c) => c.className === 'aa-loadline').textContent, /Semtex/i, 'deploy line updates to semtex');
assert.strictEqual(tacs[2].getAttribute('aria-pressed'), 'true', 'semtex button highlighted');
assert.strictEqual(kits[0].getAttribute('aria-pressed'), 'true', 'own-kit card stays highlighted via primary match');

// 4. Repick semtex later reuses the same slot instead of clobbering slots.
const slotBefore = store.selected.slot;
tacs[2].click();
store = JSON.parse(saved);
assert.strictEqual(store.selected.slot, slotBefore, 'matching custom slot is reused');

// 5. Switch to flash on the same custom selection updates in place.
tacs[0].click();
store = JSON.parse(saved);
assert.strictEqual(store.selected.kind, 'custom');
assert.strictEqual(store.custom[store.selected.slot].grenade, 'flash', 'custom slot grenade updated in place');
assert.strictEqual(store.custom.filter(Boolean).length, 1, 'no slot sprawl');

// 6. Pick the marksman kit -> pure kit selection; smoke is the kit tactical.
const marksman = kits[3];
assert.match(marksman.children.find((c) => c.className === 'aa-kit-title').textContent, /Marksman/i);
marksman.click();
store = JSON.parse(saved);
assert.deepStrictEqual(store.selected, { kind: 'kit', id: 'marksman' }, 'kit card returns to pure kit selection');
assert.strictEqual(tacs[1].getAttribute('aria-pressed'), 'true', 'smoke highlighted for marksman kit');
assert.match(root.children.find((c) => c.className === 'aa-loadline').textContent, /Deadeye/i, 'deploy line names Deadeye');

// 7. Reload the section — state comes back from storage.
const second = buildLoadoutSection().root;
assert.strictEqual(byClass(second, 'aa-tac')[1].getAttribute('aria-pressed'), 'true', 'smoke survives a rebuild from storage');
const secondLine = second.children.find((c) => c.className === 'aa-loadline').textContent;
assert.match(secondLine, /Marksman/i, 'kit origin survives rebuild');

// 8. Full store, no matching slot -> REFUSAL. Zero writes, no slot loss, the
//    selection stands, and the note explains why. (Regression: the old code
//    computed Math.max(0, -1) here and silently overwrote slot 0.)
const fullStore = (slots, sel) => JSON.stringify({ version: 1, custom: slots, selected: sel });
const authoredSlot = (g, n) => ({ name: n, primary: 'longhorn', grenade: g });
saved = fullStore(
  [authoredSlot('smoke', 'Hold A · Smoke'), authoredSlot('semtex', 'Hold B · Semtex'), authoredSlot('smoke', 'Hold C · Smoke')],
  { kind: 'kit', id: 'linekeeper' },
);
const bytesBefore = saved;
const third = buildLoadoutSection().root; // re-render from the seeded store
const t3 = byClass(third, 'aa-tac');
assert.strictEqual(t3[0].getAttribute('aria-pressed'), 'true', 'frag kit falls back to flash highlight');
t3[0].click(); // flash: linekeeper pins frag, so this wants a custom slot
assert.strictEqual(saved, bytesBefore, 'refused choice writes zero bytes');
const refused = JSON.parse(saved);
assert.strictEqual(refused.custom.filter(Boolean).length, 3, 'no authored slot lost on refusal');
assert.deepStrictEqual(refused.selected, { kind: 'kit', id: 'linekeeper' }, 'selection stands on refusal');
assert.match(byClass(third, 'aa-loadnote')[0].textContent, /custom slot/i, 'refusal surfaces a visible note');
assert.strictEqual(t3[0].getAttribute('aria-pressed'), 'true', 'previous highlight unchanged on refusal');
assert.strictEqual(t3[2].getAttribute('aria-pressed'), 'false', 'refused tactical not falsely adopted');

// 9. Full store WITH a matching slot -> that slot is reused, neighbours untouched.
const neighbourA = authoredSlot('flash', 'Hold D · Flash');
const neighbourB = authoredSlot('semtex', 'Hold E · Semtex');
saved = fullStore([neighbourA, neighbourB, authoredSlot('smoke', 'Hold F · Smoke')], { kind: 'kit', id: 'linekeeper' });
tacs[1].click(); // smoke matches slot 2 exactly
store = JSON.parse(saved);
assert.deepStrictEqual(store.selected, { kind: 'custom', slot: 2 }, 'matching slot reused while store is full');
assert.deepStrictEqual(store.custom[0], neighbourA, 'slot 0 byte-identical');
assert.deepStrictEqual(store.custom[1], neighbourB, 'slot 1 byte-identical');
assert.strictEqual(store.custom[2].grenade, 'smoke', 'matched slot carries the choice');
assert.strictEqual(store.custom[2].primary, 'longhorn', 'matched slot keeps the mirrored primary');
assert.strictEqual(byClass(root, 'aa-loadnote')[0].textContent, '', 'no refusal note on a successful write');

// 10. Occupied slot 0, free slots behind -> the FIRST genuinely free slot is
//     written; the authored slot ahead of it is untouched.
const holdZ = authoredSlot('flash', 'Hold Z · Flash');
saved = fullStore([holdZ, null, null], { kind: 'kit', id: 'linekeeper' });
tacs[2].click(); // semtex matches nothing authored -> first free slot
store = JSON.parse(saved);
assert.deepStrictEqual(store.selected, { kind: 'custom', slot: 1 }, 'first genuinely free slot selected');
assert.deepStrictEqual(store.custom[0], holdZ, 'authored slot ahead of the write untouched');
assert.strictEqual(store.custom[1].grenade, 'semtex', 'free slot now mirrors kit primary + choice');
assert.strictEqual(store.custom[1].primary, 'longhorn', 'free slot mirrors the kit primary');
assert.strictEqual(store.custom[2], null, 'later free slot left free');

console.log('loadout-panel smoke: all assertions passed');
console.log('deploy line:', root.children.find((c) => c.className === 'aa-loadline').textContent);
