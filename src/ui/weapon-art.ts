import type { WeaponDef } from '../weapons/catalog';

/** Original project-owned reference thumbnails; the schematic remains a loading/error fallback. */
export function weaponArt(def: WeaponDef): HTMLElement {
  const root = document.createElement('span');
  root.className = 'aa-weapon-art';
  root.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = `${import.meta.env.BASE_URL}assets/reference-weapons/ui/${def.id}.webp`;
  img.addEventListener('load', () => root.classList.add('aa-art-ready'), { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('aa-weapon-glyph');
  svg.setAttribute('viewBox', '0 0 128 48');
  const kind = def.pellets > 1 ? 'shotgun' : def.adsFov < 40 ? 'precision' : def.magSize > 40 ? 'support' : def.interval < 0.09 ? 'compact' : 'rifle';
  svg.dataset.weaponClass = kind;
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  body.setAttribute('class', 'aa-weapon-glyph-body');
  body.setAttribute('d', kind === 'shotgun' ? 'M6 20h56l19 5h39v7H80l-18 5H40l-5-7H6z' : 'M5 21h70l20-7h28v8l-25 3v7l18 5H89l-16-7H50l-8 6H27l5-9H5z');
  const rail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rail.setAttribute('class', 'aa-weapon-glyph-rail');
  rail.setAttribute('d', kind === 'precision' ? 'M38 18h83M72 34h32' : 'M40 18h57M53 34h24');
  svg.append(body, rail);
  root.append(img, svg);
  return root;
}
