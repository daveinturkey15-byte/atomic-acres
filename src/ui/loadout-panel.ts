/**
 * The loadout section of the pre-match panel: field-kit cards with derived
 * trait bars and weapon stats, the tactical-grenade choice, and a deploy
 * readout of what the next life actually carries.
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
 * DOM contract: the section mounts inside the `#start` overlay, so every
 * control stops propagation like the rest of the menu (the `menus.ts`
 * one-click contract: a stray click must never begin a match), and every
 * control is a real focusable `<button>` with `aria-pressed`, so the panel
 * stays keyboard-complete with a visible focus ring.
 */

import {
  FIELD_KITS, SAVE_REFUSAL_LABELS, fieldKitById, kitTraits, loadLoadout, resolveLoadout,
  saveLoadout, type GrenadeId, type KitTraits, type LoadoutStore,
} from '../game/loadout';
import {
  GRENADE_BY_ID, LETHAL_IDS, LETHAL_PER_LIFE, SMOKE_LIFETIME_MS, TACTICAL_IDS, type GrenadeDef,
} from '../game/ordnance';
import { WEAPONS } from '../weapons/catalog';

export interface LoadoutSection {
  readonly root: HTMLElement;
}

function stop(e: Event): void {
  e.stopPropagation();
}

function weaponById(id: string) {
  return WEAPONS.find((w) => w.id === id);
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

export function buildLoadoutSection(): LoadoutSection {
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
    weapon.textContent = weaponById(kit.primary)?.name ?? kit.primary;
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
    note.textContent = result.saved || !result.refusal ? '' : SAVE_REFUSAL_LABELS[result.refusal];
    refresh();
  }

  function selectKit(id: string): void {
    const store = loadLoadout();
    if (store.selected.kind === 'kit' && store.selected.id === id) return;
    apply({ ...store, selected: { kind: 'kit', id: fieldKitById(id).id } });
  }

  function selectTactical(g: GrenadeId): void {
    const store = loadLoadout();
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

  // --- Readout -------------------------------------------------------------
  function refresh(): void {
    const store = loadLoadout();
    const resolved = resolveLoadout(store);
    const activeTac = effectiveTactical(store);

    for (const [kitId, card] of kitCards) {
      const active = resolved.primary === fieldKitById(kitId).primary;
      card.classList.toggle('aa-selected', active);
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    for (const [g, btn] of tacButtons) {
      const active = g === activeTac;
      btn.classList.toggle('aa-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    const primaryName = weaponById(resolved.primary)?.name ?? resolved.primary;
    const sidearmName = weaponById(resolved.sidearm)?.name ?? resolved.sidearm;
    const tacDisplayName = GRENADE_BY_ID.get(activeTac)?.name ?? activeTac;
    const sel = store.selected;
    const origin = sel.kind === 'kit' ? fieldKitById(sel.id).title : store.custom[sel.slot]?.name ?? 'Custom';
    deployLine.textContent = `Deploying · ${origin} — ${primaryName} · ${sidearmName} · ${tacDisplayName}`;
  }

  refresh();
  return { root };
}
