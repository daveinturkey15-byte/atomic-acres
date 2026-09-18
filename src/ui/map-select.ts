/**
 * Atomic Acres — map select.
 *
 * Data-driven: a new map is one more `MapEntry`, and the card list below builds
 * itself from the table. IMPORT-PLAN §1.5 calls this "already better here" than
 * the old project's 646-line `map-selection.ts`, so the shape is unchanged —
 * only the thumbnail changed, and it changed because it now uses the one
 * projection in `game/minimap.ts` instead of a private second one.
 *
 * Split out of `menus.ts` at the 400-line cap once the lifecycle reducer landed.
 */

import { paintMapThumb } from './hud-map';

export interface MapEntry {
  id: string;
  name: string;
  tagline: string;
  drawThumb(canvas: HTMLCanvasElement): void;
}

/**
 * Portrait, because the arena is: 44.5 m across by 84 m deep. The previous
 * 200 x 120 landscape thumbnail only fitted by scaling x and z by different
 * factors, so the picture on the map-select card was a shape the map is not.
 */
export const THUMB_W = 132;
export const THUMB_H = 200;

export const MAPS: MapEntry[] = [
  {
    id: 'nuketown-2025',
    name: 'Nuketown 2025',
    tagline: 'Twin houses · turning circle · tour coach',
    drawThumb: paintMapThumb,
  },
];

export interface MapSelect {
  readonly root: HTMLElement;
  selected(): string;
}

/** Build the card list. Selection is local state; nothing else reads it yet. */
export function buildMapSelect(): MapSelect {
  const root = document.createElement('div');
  root.className = 'aa-maps';
  let selected = MAPS[0]?.id ?? '';

  for (const m of MAPS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'aa-map' + (m.id === selected ? ' aa-selected' : '');
    card.setAttribute('aria-pressed', m.id === selected ? 'true' : 'false');
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      selected = m.id;
      // Array.from: NodeListOf is only directly iterable with downlevelIteration,
      // which this tsconfig does not set.
      for (const c of Array.from(root.querySelectorAll('.aa-map'))) {
        c.classList.remove('aa-selected');
        c.setAttribute('aria-pressed', 'false');
      }
      card.classList.add('aa-selected');
      card.setAttribute('aria-pressed', 'true');
    });

    const thumb = document.createElement('canvas');
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    thumb.className = 'aa-thumb';
    m.drawThumb(thumb);
    const name = document.createElement('div');
    name.className = 'aa-mapname';
    name.textContent = m.name;
    const tag = document.createElement('div');
    tag.className = 'aa-maptag';
    tag.textContent = m.tagline;
    card.append(thumb, name, tag);
    root.append(card);
  }

  return { root, selected: () => selected };
}
