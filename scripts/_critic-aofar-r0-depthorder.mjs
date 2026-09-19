/**
 * ao-farfade ROUND 0 — is the farthest geometry the darkest thing in the frame?
 * READ-ONLY over PNGs already on disk. Nothing renders, nothing is edited.
 *
 * S5 says "aerial perspective falling off with depth, skyline reads as far". The
 * falsifiable form of that is an ORDERING: a distant plane must not be darker than a
 * near plane of the same family. This prints the chain (shipped colour) mean of the
 * far rectangles already defined in _critic-aotwo-final-farslab.mjs beside near
 * rectangles in the same frame, so the ordering can be read off rather than argued.
 *
 * The far rectangles are the INHERITED ones, verbatim. The near ones are new and are
 * only ever used as the brighter side of a comparison, so they cannot flatter a result.
 */
import { readPng, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const TAG = process.env.CRITIC_TAG || 'g-ao-farfade-r0';

const rectMean = (img, rect) => {
  const [x0, y0, x1, y1] = rect; let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += luma(img, x, y); n++; }
  return +(s / n).toFixed(2);
};
const rectRGB = (img, rect) => {
  const [x0, y0, x1, y1] = rect; let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.width + x) * img.bpp;
    r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
};

const SETS = {
  aerial: {
    'FAR  top-left skyline slab      (inherited)': [20, 10, 330, 150],
    'FAR  top-right skyline slab     (inherited)': [1440, 10, 1590, 120],
    'FAR  desert floor mid-left      (inherited)': [60, 200, 400, 330],
    'NEAR desert floor foreground': [600, 830, 1000, 895],
    'NEAR play-space paving centre': [700, 400, 900, 470],
    'MID  white-house roof': [820, 255, 980, 320],
  },
  yardWhite: {
    'FAR  ridge left                 (inherited)': [70, 80, 350, 145],
    'FAR  ridge right                (inherited)': [1405, 85, 1535, 145],
    'FAR  ridge centre (between them)': [700, 95, 950, 150],
    'NEAR lawn foreground': [200, 600, 500, 700],
    'MID  white-house body': [700, 400, 900, 500],
    'SKY  above the ridges': [600, 10, 1000, 45],
  },
  midStreet: {
    'flank far end (grazing, inherited band)': [1400, 470, 1480, 530],
    'flank near end (frontal, inherited band)': [320, 470, 520, 530],
  },
};

const out = {};
for (const [st, rects] of Object.entries(SETS)) {
  const chainP = join(CAP, TAG + '-' + st + '.png');
  const aoP = join(CAP, TAG + '-ao-' + st + '.png');
  if (!existsSync(chainP)) { console.log('skip ' + st); continue; }
  const chain = readPng(chainP);
  const ao = existsSync(aoP) ? readPng(aoP) : null;
  console.log('\n== ' + st);
  out[st] = {};
  for (const [name, rect] of Object.entries(rects)) {
    const m = rectMean(chain, rect);
    const rgb = rectRGB(chain, rect);
    const a = ao ? rectMean(ao, rect) : null;
    out[st][name] = { chain: m, rgb, ao: a, rect };
    console.log('   ' + name.padEnd(44)
      + ' chain ' + String(m).padStart(7)
      + '  rgb ' + String(rgb.join(',')).padStart(12)
      + (a === null ? '' : '   ao ' + String(a).padStart(7)));
  }
}
writeFileSync(join(CAP, TAG + '-depthorder.json'), JSON.stringify(out, null, 2));
