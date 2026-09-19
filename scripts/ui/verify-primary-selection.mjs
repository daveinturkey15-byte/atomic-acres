// CPU verifier for the primary-weapon slice of src/ui/loadout-panel.ts — drives
// the real component over a minimal DOM stub and the real game/loadout store
// (PRIMARY_IDS, SIDEARM_IDS, load/save/resolve) plus the real weapons catalog.
// No browser, no GPU. Run from the repo root:
//   node scripts/ui/verify-primary-selection.mjs
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
async function bundle(entry) {
  const out = join(tmpdir(), `prim-verify-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  await esbuild.build({
    entryPoints: [join(repoRoot, entry)],
    bundle: true,
    format: 'esm',
    outfile: out,
    logLevel: 'warning',
  });
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    await rm(out, { force: true });
  }
}
const { buildLoadoutSection } = await bundle('src/ui/loadout-panel.ts');
const storeApi = await bundle('src/game/loadout.ts');
const { PRIMARY_IDS, SIDEARM_IDS, loadLoadout, resolveLoadout } = storeApi;
const { WEAPONS } = await bundle('src/weapons/catalog.ts');

// --- minimal DOM stub (same contract as verify-loadout-store.mjs) ------------
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
  return el;
}
globalThis.document = { createElement(tag) { return makeEl(tag); } };

// The store port is ambient localStorage; install a capture stub BEFORE use.
let saved = null;
globalThis.localStorage = {
  getItem: () => saved,
  setItem: (k, v) => { saved = v; },
};

const byClass = (el, cls) => {
  const out = [];
  const walk = (n) => { if (n.classList?.contains(cls)) out.push(n); for (const c of n.children ?? []) walk(c); };
  walk(el);
  return out;
};
const textOf = (el, cls) => byClass(el, cls)[0]?.textContent ?? '';
const childText = (btn, cls) => btn.children.find((c) => c.className === cls)?.textContent ?? '';
const nameToId = new Map(WEAPONS.map((w) => [w.name, w.id]));
assert.strictEqual(nameToId.size, WEAPONS.length, 'catalog names are unique (button mapping is exact)');
const idOf = (btn) => nameToId.get(childText(btn, 'aa-prim-name'));

// 1. Derivation: one button per PRIMARY_IDS id — no more, no fewer, no table copy.
assert.ok(PRIMARY_IDS.length >= 4, 'primary pool is non-trivial');
const { root } = buildLoadoutSection();
const prims = byClass(root, 'aa-prim');
assert.strictEqual(prims.length, PRIMARY_IDS.length, 'primary buttons derive exactly from PRIMARY_IDS');
assert.deepStrictEqual(new Set(prims.map(idOf)), new Set(PRIMARY_IDS), 'every PRIMARY_IDS id offered once');
const sidearmNames = new Set(SIDEARM_IDS.map((id) => WEAPONS.find((w) => w.id === id)?.name));
for (const b of prims) {
  assert.ok(!sidearmNames.has(childText(b, 'aa-prim-name')), 'no sidearm offered as a primary');
  assert.match(childText(b, 'aa-prim-line'), /dmg/, 'primary stat line derived from the catalog');
  assert.strictEqual(b.getAttribute('aria-pressed') === 'true', idOf(b) === resolveLoadout(loadLoadout()).primary, 'pressed state tracks the resolved primary');
}
assert.strictEqual(byClass(root, 'aa-prims')[0]?.getAttribute('role'), 'group', 'primary group is labelled');
assert.match(textOf(root, 'aa-prim-stats'), /dmg.*m/, 'live stat line shows damage and range band');

// 2. Default kit selection: the kit primary is pressed; deploy + stats name it.
const before = resolveLoadout(loadLoadout());
assert.match(textOf(root, 'aa-loadline'), new RegExp(before.primary, 'i'), 'deploy line names the resolved primary');

// 3. New primary from a kit: custom slot mirrors the pair, tactical untouched.
const other = PRIMARY_IDS.find((id) => id !== before.primary);
const tacBefore = byClass(root, 'aa-tac').map((b) => b.getAttribute('aria-pressed'));
prims.find((b) => idOf(b) === other).click();
let store = JSON.parse(saved);
assert.strictEqual(store.selected.kind, 'custom', 'primary on a kit writes a custom selection');
assert.strictEqual(store.custom[store.selected.slot].primary, other, 'slot carries the chosen primary');
assert.strictEqual(store.custom[store.selected.slot].grenade, before.grenade, 'slot keeps the carried grenade');
assert.deepStrictEqual(byClass(root, 'aa-tac').map((b) => b.getAttribute('aria-pressed')), tacBefore, 'tactical highlight unchanged');
assert.match(textOf(root, 'aa-loadline'), new RegExp(other, 'i'), 'deploy line follows the new primary');
assert.match(textOf(root, 'aa-prim-stats'), /dmg.*m/, 'live stats still derived after the switch');
assert.strictEqual(textOf(root, 'aa-loadnote'), '', 'no refusal note on a successful write');

// 4. Re-pick writes zero bytes.
const bytes = saved;
prims.find((b) => idOf(b) === other).click();
assert.strictEqual(saved, bytes, 're-picking the carried primary writes nothing');

// 5. Custom selection: tactical then primary — grenade retained, no slot sprawl.
const altTac = byClass(root, 'aa-tac').find((b) => b.getAttribute('aria-pressed') !== 'true');
altTac.click();
store = JSON.parse(saved);
const slotCount = store.custom.filter(Boolean).length;
const keptGrenade = store.custom[store.selected.slot].grenade;
const third = PRIMARY_IDS.find((id) => id !== other && id !== resolveLoadout(loadLoadout()).primary) ?? other;
prims.find((b) => idOf(b) === third).click();
store = JSON.parse(saved);
assert.strictEqual(store.selected.kind, 'custom', 'still a custom selection');
assert.strictEqual(store.custom[store.selected.slot].primary, third, 'slot primary updated in place');
assert.strictEqual(store.custom[store.selected.slot].grenade, keptGrenade, 'chosen tactical retained');
assert.strictEqual(store.custom.filter(Boolean).length, slotCount, 'no slot sprawl');

// 6. Full store, no matching pair: refusal writes zero bytes, stands, explains.
const full = (slots, sel) => JSON.stringify({ version: 1, custom: slots, selected: sel });
const target = PRIMARY_IDS.find((id) => id !== PRIMARY_IDS[0] && id !== PRIMARY_IDS[1] && id !== PRIMARY_IDS[2]);
saved = full(
  [
    { name: 'Hold A', primary: PRIMARY_IDS[0], grenade: 'flash' },
    { name: 'Hold B', primary: PRIMARY_IDS[1], grenade: 'smoke' },
    { name: 'Hold C', primary: PRIMARY_IDS[2], grenade: 'semtex' },
  ],
  { kind: 'kit', id: store.selected.kind === 'kit' ? store.selected.id : 'linekeeper' },
);
const frozen = saved;
const fullRoot = buildLoadoutSection().root;
const fullPrims = byClass(fullRoot, 'aa-prim');
const pressedBefore = fullPrims.map((b) => b.getAttribute('aria-pressed'));
fullPrims.find((b) => idOf(b) === target).click();
assert.strictEqual(saved, frozen, 'refused primary writes zero bytes');
const refused = JSON.parse(saved);
assert.strictEqual(refused.custom.filter(Boolean).length, 3, 'no authored slot lost on refusal');
assert.match(textOf(fullRoot, 'aa-loadnote'), /custom slot/i, 'refusal surfaces a visible note');
assert.deepStrictEqual(byClass(fullRoot, 'aa-prim').map((b) => b.getAttribute('aria-pressed')), pressedBefore, 'previous highlight unchanged on refusal');

// 7. Retired ids never reach hands: sanitize drops them, no button can name them.
saved = full([{ name: 'Retired', primary: '__retired-prototype__', grenade: 'flash' }, null, null], { kind: 'custom', slot: 0 });
const dropped = loadLoadout();
assert.strictEqual(dropped.custom[0], null, 'unknown primary sanitized out of the slot');
assert.strictEqual(dropped.selected.kind, 'kit', 'selection falls back to a kit');
assert.ok(!prims.some((b) => childText(b, 'aa-prim-name') === '__retired-prototype__'), 'no button offers the retired id');

// 8. Kit cards still work: leave for a custom primary, then picking a kit
//    returns to a pure kit selection.
saved = null;
const kitRoot = buildLoadoutSection().root;
byClass(kitRoot, 'aa-prim')[1].click(); // custom selection first (kit click would early-return)
assert.strictEqual(JSON.parse(saved).selected.kind, 'custom', 'setup reached a custom selection');
byClass(kitRoot, 'aa-kit')[1].click();
store = JSON.parse(saved);
assert.strictEqual(store.selected.kind, 'kit', 'kit card returns to a pure kit selection');
assert.match(textOf(kitRoot, 'aa-loadline'), /Deploying/i, 'deploy line renders for the kit');
console.log('primary-selection smoke: all assertions passed');
console.log('primaries offered:', prims.length, '| deploy:', textOf(root, 'aa-loadline'));
