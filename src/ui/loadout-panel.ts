/**
 * The loadout section of the pre-match panel: field-kit cards with derived
 * trait bars and weapon stats, the primary-weapon choice, the tactical-grenade
 * choice, and a deploy readout of what the next life actually carries.
 *
 * DATA, NOT COPY. Every name, stat line and bar is derived at render time from
 * `game/loadout.ts`, `game/ordnance.ts` and `weapons/catalog.ts` — a new kit,
 * weapon or grenade (semtex arrived exactly this way) appears here by existing
 * in those tables. The panel never invents a number.
 *
 * Persistence is the game's own store. `game/loadout.ts` is the one source
 * both this section and the spawn path (`main.ts` → `resolveLoadout(loadLoadout())`,
 * `weapons/ordnance-scene.ts:tacticalFor`) read, so a choice made here is the
 * loadout the next life carries. The store has two shapes: a kit selection,
 * whose tactical grenade is fixed by the kit, and custom slots, which free it.
 * Choosing a tactical the selected kit does not carry therefore writes a custom
 * slot mirroring the kit's primary — reusing a matching slot, else the first
 * free one. When all three slots are authored and none matches, the choice is
 * refused with a visible note: the store keeps its exact bytes and the current
 * selection stands, so nothing a custom-slot editor authors is silently
 * clobbered. Picking a kit card returns to the pure kit selection.
 *
 * Choosing a primary keeps the grenade the next life already carries and
 * follows the same slot rule as the tactical choice: it reuses a custom slot
 * that already holds the exact pair, else the first free one, and refuses —
 * without writing — when every slot is authored and none matches. Only ids in
 * `PRIMARY_IDS` are offered or accepted; anything else is refused with a note.
 *
 * DOM contract: the section mounts inside the `#start` overlay, so every
 * control stops propagation like the rest of the menu (the `menus.ts`
 * one-click contract: a stray click must never begin a match), and every
 * control is a real focusable `<button>` with `aria-pressed`, so the panel
 * stays keyboard-complete with a visible focus ring.
 */

import {
  CUSTOM_SLOT_COUNT, FIELD_KITS, PRIMARY_IDS, SAVE_REFUSAL_LABELS, SIDEARM_IDS, fieldKitById, kitTraits, loadLoadout,
  resolveLoadout, saveLoadout, sidearmForPrimary, type GrenadeId, type KitTraits, type LoadoutStore,
} from '../game/loadout';
import {
  GRENADE_BY_ID, LETHAL_IDS, LETHAL_PER_LIFE, SMOKE_LIFETIME_MS, TACTICAL_IDS, type GrenadeDef,
} from '../game/ordnance';
import { WEAPONS } from '../weapons/catalog';

export interface LoadoutSection {
  readonly root: HTMLElement;
  refresh(): void;
  read(): LoadoutStore;
}

export interface LoadoutSectionDeps {
  onChange?(store: LoadoutStore): void;
}

function stop(e: Event): void {
  e.stopPropagation();
}

function weaponById(id: string) {
  return WEAPONS.find((w) => w.id === id);
}

/** A compact schematic, derived from weapon traits so every catalog entry has
 * a useful visual without shipping a second asset roster. */
function weaponGlyph(def: NonNullable<ReturnType<typeof weaponById>>): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('aa-weapon-glyph');
  svg.setAttribute('viewBox', '0 0 128 48');
  svg.setAttribute('aria-hidden', 'true');
  const kind = def.pellets > 1 ? 'shotgun' : def.adsFov < 40 ? 'precision' : def.magSize > 40 ? 'support' : def.interval < 0.09 ? 'compact' : 'rifle';
  svg.dataset.weaponClass = kind;
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  body.setAttribute('class', 'aa-weapon-glyph-body');
  body.setAttribute('d', kind === 'shotgun' ? 'M6 20h56l19 5h39v7H80l-18 5H40l-5-7H6z' : 'M5 21h70l20-7h28v8l-25 3v7l18 5H89l-16-7H50l-8 6H27l5-9H5z');
  svg.append(body);
  const rail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rail.setAttribute('class', 'aa-weapon-glyph-rail');
  rail.setAttribute('d', kind === 'precision' ? 'M38 18h83M72 34h32' : 'M40 18h57M53 34h24');
  svg.append(rail);
  return svg;
}

/** The tactical the next life actually throws — the same fallback `ordnance-scene.tacticalFor` applies when the store's grenade is not a tactical id. */
function effectiveTactical(store: LoadoutStore): GrenadeId {
  const g = resolveLoadout(store).grenade;
  return (TACTICAL_IDS as readonly string[]).includes(g) ? g : TACTICAL_IDS[0];
}

/**
 * A stat line derived from the ordnance table. Flash radius, a real smoke
 * screen (lifetime matches the authored smoke, not a detonation puff), the
 * stick behaviour, and the heavy blast envelope are each shown only when the
 * table says the grenade has them.
 */
function tacticalLine(g: GrenadeDef): string {
  const bits: string[] = [];
  if (g.flashRadius !== null) bits.push(`${g.flashRadius} m flash`);
  if (g.blastMaxDamage >= 100) bits.push(`${g.blastRadius} m · ${g.blastMaxDamage} dmg`);
  if (g.smokeMs >= SMOKE_LIFETIME_MS) bits.push(`${g.smokeRadius} m · ${Math.round(g.smokeMs / 1000)} s screen`);
  if (g.sticks) bits.push('sticks on contact');
  if (bits.length === 0) bits.push(`${g.blastRadius} m · ${g.blastMaxDamage} dmg`);
  return bits.join(' · ');
}

/** Rounds-per-minute and magazine straight from the catalog's own numbers. */
function weaponLine(id: string): string | null {
  const def = weaponById(id);
  if (!def) return null;
  const rpm = Math.round(60 / def.interval);
  const dmg = def.pellets > 1 ? `${def.pellets}×${def.damage.base}` : `${def.damage.base}`;
  return `${dmg} dmg · ${rpm} rpm · ${def.magSize} rd mag`;
}

/** Trait bars in `loadout.ts` are catalog-ranked on a 1–5 scale. */
const TRAIT_BAR_MAX = 5;
const TRAIT_LABELS: ReadonlyArray<readonly [label: string, key: keyof KitTraits]> = [
  ['Range', 'range'],
  ['Control', 'control'],
  ['Mobility', 'mobility'],
];

export function buildLoadoutSection(deps: LoadoutSectionDeps = {}): LoadoutSection {
  // Privacy/quota failures must not throw away a choice in the current match.
  // Successful persistence still reads the shared store, including other tabs.
  let unsaved: LoadoutStore | null = null;
  const read = (): LoadoutStore => unsaved ?? loadLoadout();
  const root = document.createElement('div');
  root.className = 'aa-loadout';

  const head = document.createElement('div');
  head.className = 'aa-loadhead';
  head.textContent = 'Loadout';
  root.append(head);

  // --- Kit cards -----------------------------------------------------------
  const kits = document.createElement('div');
  kits.className = 'aa-kits';
  kits.setAttribute('role', 'group');
  kits.setAttribute('aria-label', 'Field kits');
  const kitCards = new Map<string, HTMLButtonElement>();
  for (const kit of FIELD_KITS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'aa-kit';
    card.setAttribute('aria-pressed', 'false');
    card.title = `${kit.title} — ${kit.summary}`;

    const role = document.createElement('span');
    role.className = 'aa-kit-role';
    role.textContent = kit.role;
    const title = document.createElement('span');
    title.className = 'aa-kit-title';
    title.textContent = kit.title;
    const summary = document.createElement('span');
    summary.className = 'aa-kit-summary';
    summary.textContent = kit.summary;
    card.append(role, title, summary);

    const weapon = document.createElement('span');
    weapon.className = 'aa-kit-weapon';
    const kitDef = weaponById(kit.primary);
    if (kitDef) weapon.append(weaponGlyph(kitDef));
    const weaponName = document.createElement('span');
    weaponName.className = 'aa-kit-weapon-name';
    weaponName.textContent = kitDef?.name ?? kit.primary;
    weapon.append(weaponName);
    const wline = weaponLine(kit.primary);
    if (wline) {
      const stats = document.createElement('span');
      stats.className = 'aa-kit-wstats';
      stats.textContent = wline;
      weapon.append(stats);
    }
    card.append(weapon);

    const traits = kitTraits(kit);
    const bars = document.createElement('span');
    bars.className = 'aa-kit-bars';
    for (const [label, key] of TRAIT_LABELS) {
      const bar = document.createElement('span');
      bar.className = 'aa-kitbar';
      const cap = document.createElement('span');
      cap.textContent = label;
      const cells = document.createElement('span');
      cells.className = 'aa-kitbar-cells';
      for (let i = 0; i < TRAIT_BAR_MAX; i++) {
        const cell = document.createElement('span');
        if (i < traits[key]) cell.className = 'on';
        cells.append(cell);
      }
      bar.append(cap, cells);
      bars.append(bar);
    }
    card.append(bars);

    // The kit's tactical slot: 'frag' means the kit pins no tactical, and the
    // spawn path falls back to the first tactical id — show that honestly.
    const tacName = kit.grenade === 'frag'
      ? GRENADE_BY_ID.get(TACTICAL_IDS[0])?.name ?? TACTICAL_IDS[0]
      : GRENADE_BY_ID.get(kit.grenade)?.name ?? kit.grenade;
    const grenade = document.createElement('span');
    grenade.className = 'aa-kit-grenade';
    grenade.textContent = `Tac · ${tacName}`;
    card.append(grenade);

    card.addEventListener('click', (e) => { stop(e); selectKit(kit.id); });
    kitCards.set(kit.id, card);
    kits.append(card);
  }
  root.append(kits);

  // --- Saved custom classes -----------------------------------------------
  // Custom slots are part of the game's loadout store.  Surface them here so
  // a player can return to a previous weapon/tactical pair without silently
  // overwriting it while browsing the catalog.
  const savedLabel = document.createElement('div');
  savedLabel.className = 'aa-loadsub aa-saved-label';
  savedLabel.textContent = 'SAVED CLASSES';
  const saved = document.createElement('div');
  saved.className = 'aa-saved';
  saved.setAttribute('role', 'group');
  saved.setAttribute('aria-label', 'Saved custom classes');
  const savedButtons: Array<{ readonly button: HTMLButtonElement; readonly clear: HTMLButtonElement; readonly index: number }> = [];
  for (let i = 0; i < CUSTOM_SLOT_COUNT; i++) {
    const slot = document.createElement('div');
    slot.className = 'aa-saved-slot';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'aa-saved-pick';
    pick.setAttribute('aria-pressed', 'false');
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'aa-saved-clear';
    clear.textContent = '×';
    clear.title = `Clear saved class ${i + 1}`;
    clear.setAttribute('aria-label', `Clear saved class ${i + 1}`);
    pick.addEventListener('click', (e) => { stop(e); selectSaved(i); });
    clear.addEventListener('click', (e) => { stop(e); clearSaved(i); });
    slot.append(pick, clear);
    saved.append(slot);
    savedButtons.push({ button: pick, clear, index: i });
  }
  root.append(savedLabel, saved);

  // --- Primary weapon choice ------------------------------------------------
  // Derived from PRIMARY_IDS (playable non-sidearms), never a second table: a
  // new catalog primary appears here by existing. Gated prototypes and
  // sidearms are not in PRIMARY_IDS, so they are never offered — and
  // selectPrimary re-checks membership rather than trusting the button.
  const primLabel = document.createElement('div');
  primLabel.className = 'aa-loadsub';
  primLabel.textContent = 'Primary weapon';
  root.append(primLabel);

  const prims = document.createElement('div');
  prims.className = 'aa-prims';
  prims.setAttribute('role', 'group');
  prims.setAttribute('aria-label', 'Primary weapon');
  const primButtons = new Map<string, HTMLButtonElement>();
  for (const id of PRIMARY_IDS) {
    const def = weaponById(id);
    if (!def) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aa-prim';
    btn.setAttribute('aria-pressed', 'false');
    const name = document.createElement('span');
    name.className = 'aa-prim-name';
    name.textContent = def.name;
    const line = document.createElement('span');
    line.className = 'aa-prim-line';
    line.textContent = weaponLine(id) ?? id;
    btn.append(weaponGlyph(def), name, line);
    btn.addEventListener('click', (e) => { stop(e); selectPrimary(id); });
    primButtons.set(id, btn);
    prims.append(btn);
  }
  root.append(prims);

  const primStats = document.createElement('div');
  primStats.className = 'aa-note aa-prim-stats';
  root.append(primStats);

  const sidearmLabel = document.createElement('div');
  sidearmLabel.className = 'aa-loadsub';
  sidearmLabel.textContent = 'Sidearm · key 2';
  const sidearms = document.createElement('div');
  sidearms.className = 'aa-prims aa-sidearms';
  sidearms.setAttribute('role', 'group');
  sidearms.setAttribute('aria-label', 'Sidearm');
  const sidearmButtons = new Map<string, HTMLButtonElement>();
  for (const id of SIDEARM_IDS) {
    const def = weaponById(id);
    if (!def) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aa-sidearm';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', def.name);
    const name = document.createElement('span');
    name.className = 'aa-prim-name';
    name.textContent = def.name;
    const stats = document.createElement('span');
    stats.className = 'aa-prim-line';
    stats.textContent = weaponLine(id) ?? id;
    btn.append(weaponGlyph(def), name, stats);
    btn.addEventListener('click', (e) => { stop(e); selectSidearm(id); });
    sidearmButtons.set(id, btn);
    sidearms.append(btn);
  }
  root.append(sidearmLabel, sidearms);

  // --- Tactical grenade choice --------------------------------------------
  const tacLabel = document.createElement('div');
  tacLabel.className = 'aa-loadsub';
  tacLabel.textContent = 'Tactical grenade';
  root.append(tacLabel);

  const tacs = document.createElement('div');
  tacs.className = 'aa-tacs';
  tacs.setAttribute('role', 'group');
  tacs.setAttribute('aria-label', 'Tactical grenade');
  const tacButtons = new Map<GrenadeId, HTMLButtonElement>();
  for (const id of TACTICAL_IDS) {
    const def = GRENADE_BY_ID.get(id);
    if (!def) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aa-tac';
    btn.setAttribute('aria-pressed', 'false');
    const name = document.createElement('span');
    name.className = 'aa-tac-name';
    name.textContent = def.name;
    const line = document.createElement('span');
    line.className = 'aa-tac-line';
    line.textContent = tacticalLine(def);
    btn.append(name, line);
    btn.addEventListener('click', (e) => { stop(e); selectTactical(id); });
    tacButtons.set(id, btn);
    tacs.append(btn);
  }
  root.append(tacs);

  // The lethal slot is authored, not chosen: state it rather than offering a
  // control the store cannot honour.
  if (LETHAL_IDS.length === 1) {
    const lethalName = GRENADE_BY_ID.get(LETHAL_IDS[0])?.name ?? LETHAL_IDS[0];
    const lethal = document.createElement('div');
    lethal.className = 'aa-note aa-loadlethal';
    lethal.textContent = `Lethal slot · ${lethalName} · ${LETHAL_PER_LIFE} per life`;
    root.append(lethal);
  }

  const deployLine = document.createElement('div');
  deployLine.className = 'aa-loadline';
  root.append(deployLine);

  const note = document.createElement('div');
  note.className = 'aa-note aa-loadnote';
  root.append(note);

  // --- Store writes --------------------------------------------------------
  function apply(next: LoadoutStore): void {
    const result = saveLoadout(next);
    unsaved = result.saved ? null : next;
    note.textContent = result.saved || !result.refusal ? '' : SAVE_REFUSAL_LABELS[result.refusal];
    refresh();
    deps.onChange?.(next);
  }

  function selectKit(id: string): void {
    const store = read();
    if (store.selected.kind === 'kit' && store.selected.id === id) return;
    apply({ ...store, selected: { kind: 'kit', id: fieldKitById(id).id } });
  }

  function selectTactical(g: GrenadeId): void {
    const store = read();
    const sel = store.selected;
    if (sel.kind === 'kit') {
      const kit = fieldKitById(sel.id);
      if (kit.grenade === g) return; // the kit already carries it
      // Reuse a custom slot that already mirrors this exact loadout, else the
      // first free slot. If every slot is authored and none matches, refuse:
      // no write, no selection change, one clear note.
      const matching = store.custom.findIndex((c) => c !== null && c.primary === kit.primary && c.grenade === g);
      const free = store.custom.findIndex((c) => c === null);
      if (matching < 0 && free < 0) {
        note.textContent = 'All custom slots hold authored loadouts and none matches this kit — clear a slot first.';
        return;
      }
      const slot = matching >= 0 ? matching : free;
      const custom = store.custom.slice();
      custom[slot] = {
        name: `${kit.title} · ${GRENADE_BY_ID.get(g)?.name ?? g}`.slice(0, 24),
        primary: kit.primary,
        grenade: g,
      };
      apply({ ...store, custom, selected: { kind: 'custom', slot } });
      return;
    }
    const custom = store.custom.slice();
    const target = custom[sel.slot];
    if (!target) return; // sanitizeSelection never selects an empty slot; guard anyway
    const base = target.name.split(' · ')[0] ?? target.name;
    custom[sel.slot] = { ...target, grenade: g, name: `${base} · ${GRENADE_BY_ID.get(g)?.name ?? g}`.slice(0, 24) };
    apply({ ...store, custom, selected: { kind: 'custom', slot: sel.slot } });
  }

  function selectPrimary(id: string): void {
    if (!PRIMARY_IDS.includes(id) || SIDEARM_IDS.includes(id)) {
      note.textContent = 'That weapon is not selectable yet.';
      return;
    }
    const store = read();
    const keep = resolveLoadout(store).grenade; // the grenade the next life already carries
    const sel = store.selected;
    if (sel.kind === 'kit') {
      const kit = fieldKitById(sel.id);
      if (kit.primary === id) return; // the kit already carries it
      // Same slot rule as selectTactical: reuse the slot that already holds
      // this exact pair, else the first free one; refuse without writing when
      // every slot is authored and none matches.
      const matching = store.custom.findIndex((c) => c !== null && c.primary === id && c.grenade === keep);
      const free = store.custom.findIndex((c) => c === null);
      if (matching < 0 && free < 0) {
        note.textContent = 'All custom slots hold authored loadouts and none matches this weapon — clear a slot first.';
        return;
      }
      const slot = matching >= 0 ? matching : free;
      const custom = store.custom.slice();
      custom[slot] = {
        name: `${weaponById(id)?.name ?? id} · ${GRENADE_BY_ID.get(keep)?.name ?? keep}`.slice(0, 24),
        primary: id,
        grenade: keep,
      };
      apply({ ...store, custom, selected: { kind: 'custom', slot } });
      return;
    }
    const custom = store.custom.slice();
    const target = custom[sel.slot];
    if (!target) return; // sanitizeSelection never selects an empty slot; guard anyway
    if (target.primary === id) return;
    const gname = GRENADE_BY_ID.get(target.grenade)?.name ?? target.grenade;
    custom[sel.slot] = { ...target, primary: id, name: `${weaponById(id)?.name ?? id} · ${gname}`.slice(0, 24) };
    apply({ ...store, custom, selected: { kind: 'custom', slot: sel.slot } });
  }

  function selectSaved(slot: number): void {
    const store = read();
    if (!store.custom[slot]) return;
    if (store.selected.kind === 'custom' && store.selected.slot === slot) return;
    apply({ ...store, selected: { kind: 'custom', slot } });
  }

  function selectSidearm(id: string): void {
    if (!SIDEARM_IDS.includes(id)) return;
    const store = read();
    const current = resolveLoadout(store);
    if (current.sidearm === id || current.primary === id) return;
    const custom = store.custom.slice();
    let slot: number;
    if (store.selected.kind === 'custom') slot = store.selected.slot;
    else {
      const matching = custom.findIndex((entry) => entry !== null && entry.primary === current.primary
        && entry.grenade === current.grenade && (entry.sidearm ?? sidearmForPrimary(entry.primary)) === id);
      slot = matching >= 0 ? matching : custom.findIndex((entry) => entry === null);
      if (slot < 0) {
        note.textContent = 'All custom classes are full. Select a saved class to edit, or clear a slot first.';
        return;
      }
    }
    custom[slot] = { name: custom[slot]?.name ?? `${weaponById(current.primary)?.name ?? current.primary} · ${id}`.slice(0, 24),
      primary: current.primary, grenade: current.grenade, sidearm: id };
    apply({ ...store, custom, selected: { kind: 'custom', slot } });
  }

  function clearSaved(slot: number): void {
    const store = read();
    if (!store.custom[slot]) return;
    const custom = store.custom.slice();
    custom[slot] = null;
    const selected = store.selected.kind === 'custom' && store.selected.slot === slot
      ? { kind: 'kit' as const, id: FIELD_KITS[0].id }
      : store.selected;
    apply({ ...store, custom, selected });
  }

  // --- Readout -------------------------------------------------------------
  function refresh(): void {
    const store = read();
    const resolved = resolveLoadout(store);
    const activeTac = effectiveTactical(store);

    for (const [kitId, card] of kitCards) {
      const active = store.selected.kind === 'kit' && store.selected.id === kitId;
      card.classList.toggle('aa-selected', active);
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    for (const [g, btn] of tacButtons) {
      const active = g === activeTac;
      btn.classList.toggle('aa-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    for (const [id, btn] of primButtons) {
      const active = id === resolved.primary;
      btn.classList.toggle('aa-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    for (const [id, btn] of sidearmButtons) {
      const active = id === resolved.sidearm;
      btn.classList.toggle('aa-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    for (const item of savedButtons) {
      const custom = store.custom[item.index];
      const active = store.selected.kind === 'custom' && store.selected.slot === item.index;
      item.button.classList.toggle('aa-selected', active);
      item.button.setAttribute('aria-pressed', active ? 'true' : 'false');
      item.clear.disabled = custom === null;
      if (custom === null) {
        item.button.textContent = `CLASS ${item.index + 1} · EMPTY`;
        item.button.title = `Save a custom class in slot ${item.index + 1} by choosing a weapon or tactical`;
      } else {
        const primaryName = weaponById(custom.primary)?.name ?? custom.primary;
        const grenadeName = GRENADE_BY_ID.get(custom.grenade)?.name ?? custom.grenade;
        item.button.textContent = custom.name || `${primaryName} · ${grenadeName}`;
        item.button.title = `${primaryName} · ${grenadeName}`;
      }
    }

    const primaryName = weaponById(resolved.primary)?.name ?? resolved.primary;
    const sidearmName = weaponById(resolved.sidearm)?.name ?? resolved.sidearm;
    const tacDisplayName = GRENADE_BY_ID.get(activeTac)?.name ?? activeTac;
    const sel = store.selected;
    // A custom slot written by a kit/tactical or kit/primary choice is
    // auto-named after that same pair ("Linekeeper · Semtex", "MP5 · Semtex":
    // selectTactical uses the kit title, selectPrimary the weapon name), so
    // printing the stored name AND the resolved pair reads the pair twice
    // (roster-menu-2259: "DEPLOYING · MP5 · SEMTEX — MP5 · DUSTER · SEMTEX").
    // Show 'Custom' for an auto-mirror and keep a genuinely authored name
    // ("Hold A · Smoke") verbatim. Candidates mirror the two generators
    // exactly, including their 24-character slice.
    const storedName = sel.kind === 'kit' ? null : store.custom[sel.slot]?.name ?? null;
    const mirrorHeads = [primaryName, ...FIELD_KITS.map((k) => k.title)];
    const autoMirror = storedName !== null && mirrorHeads.some((head) =>
      `${head} · ${tacDisplayName}`.slice(0, 24).toLowerCase() === storedName.toLowerCase());
    const origin = sel.kind === 'kit' ? fieldKitById(sel.id).title : !storedName || autoMirror ? 'Custom' : storedName;
    deployLine.textContent = `Deploying · ${origin} — ${primaryName} · ${sidearmName} · ${tacDisplayName}`;
    const primDef = weaponById(resolved.primary);
    const band = primDef ? ` · ${primDef.damage.nearRange}–${primDef.damage.farRange} m` : '';
    primStats.textContent = `${weaponLine(resolved.primary) ?? resolved.primary}${band}`;
  }

  refresh();
  return { root, refresh, read };
}
