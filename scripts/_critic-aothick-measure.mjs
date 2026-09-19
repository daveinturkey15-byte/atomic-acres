/**
 * ao-thickness round 0 — measurement pass over the critic's own PNGs.
 * Rect names and coordinates are carried over unchanged from the ao-retune
 * round-1 record so the numbers are comparable round to round.
 */
import { readPng, rectStats, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const TAG = process.env.CRITIC_TAG || 'g-ao-thickness-r0';
const P = (n) => join(CAP, TAG + '-' + n + '.png');

const RECTS = {
  interiorOrange: {
    'wall right of doorway': [620, 260, 900, 700],
    'wall below window sill': [620, 700, 900, 880],
    'aperture through doorway': [160, 275, 560, 750],
    'floor at threshold': [200, 800, 560, 880],
    'ceiling beam band': [200, 10, 900, 60],
  },
  whitePoolRoom: {
    'wall field upper': [620, 60, 1200, 380],
    'wall field mid': [620, 380, 1200, 620],
    'wall field lower': [620, 620, 1200, 760],
    'wall full': [620, 60, 1200, 760],
    'corner strip right': [1250, 100, 1330, 700],
  },
  turningHead: {
    'sky left': [60, 40, 340, 180],
    'sky centre': [640, 40, 960, 180],
    'mountains': [180, 270, 700, 330],
    'asphalt foreground': [400, 700, 1100, 870],
    'under white coach': [380, 545, 720, 585],
  },
  spawnA: {
    'lawn field': [300, 620, 700, 740],
    'pale wall left of door': [20, 380, 180, 540],
    'crate base contact': [745, 640, 935, 675],
    'stepping stone contact': [640, 830, 800, 880],
    'sky patch': [1150, 30, 1250, 120],
  },
};

const out = {};
const near = (img, lo, hi) => {
  let n = 0, t = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const v = luma(img, x, y); t++; if (v >= lo && v <= hi) n++;
  }
  return +(100 * n / t).toFixed(2);
};
const fracInRect = (img, rect, pred) => {
  const [x0, y0, x1, y1] = rect; let n = 0, t = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t++; if (pred(luma(img, x, y))) n++; }
  return +(100 * n / t).toFixed(2);
};

for (const station of Object.keys(RECTS)) {
  const chain = readPng(P(station));
  let ao = null;
  try { ao = readPng(P('ao-' + station)); } catch { /* none */ }
  const row = { chain: {}, ao: {} };
  row.frameChain = rectStats(chain, [0, 0, chain.width, chain.height]);
  row.frameChainNearBlackPct = near(chain, 0, 12);
  if (ao) {
    row.frameAo = rectStats(ao, [0, 0, ao.width, ao.height]);
    row.frameAoNearBlackPct = near(ao, 0, 12);
  }
  for (const [name, rect] of Object.entries(RECTS[station])) {
    row.chain[name] = rectStats(chain, rect);
    if (ao) {
      row.ao[name] = rectStats(ao, rect);
      row.ao[name].pctNoAoAbove220 = fracInRect(ao, rect, (v) => v > 220);
      row.ao[name].pctSaturatedBelow8 = fracInRect(ao, rect, (v) => v < 8);
    }
  }
  out[station] = row;
}

// derived
const io = out.interiorOrange;
out.derived = {
  'interiorOrange aperture/wall (chain)':
    +(io.chain['aperture through doorway'].mean / io.chain['wall right of doorway'].mean).toFixed(3),
  'interiorOrange AO mean on wall rect 620,260-900,700': io.ao?.['wall right of doorway'].mean ?? null,
  'interiorOrange AO min on wall rect': io.ao?.['wall right of doorway'].min ?? null,
  'whitePoolRoom AO mean on wall full': out.whitePoolRoom.ao?.['wall full'].mean ?? null,
  'whitePoolRoom AO min on wall full': out.whitePoolRoom.ao?.['wall full'].min ?? null,
};

// vertical profile down the middle of each interior wall (chain + ao), 20 samples
function profile(img, x, y0, y1, n = 20) {
  const r = [];
  for (let i = 0; i < n; i++) {
    const y = Math.round(y0 + (y1 - y0) * i / (n - 1));
    let s = 0; for (let dx = -12; dx <= 12; dx++) s += luma(img, x + dx, y);
    r.push({ y, v: +(s / 25).toFixed(1) });
  }
  return r;
}
out.profiles = {
  'interiorOrange chain x=760 y=240..880': profile(readPng(P('interiorOrange')), 760, 240, 880),
  'interiorOrange ao    x=760 y=240..880': profile(readPng(P('ao-interiorOrange')), 760, 240, 880),
  'whitePoolRoom chain x=900 y=40..770': profile(readPng(P('whitePoolRoom')), 900, 40, 770),
  'whitePoolRoom ao    x=900 y=40..770': profile(readPng(P('ao-whitePoolRoom')), 900, 40, 770),
};

writeFileSync(join(CAP, TAG + '-rect-metrics.json'), JSON.stringify(out, null, 2));

const f = (n) => String(n).padStart(8);
for (const st of Object.keys(RECTS)) {
  console.log('\n== ' + st);
  console.log('   frame chain  mean ' + f(out[st].frameChain.mean) + '  p5 ' + f(out[st].frameChain.p5)
    + '  p95 ' + f(out[st].frameChain.p95) + '  nearBlack% ' + out[st].frameChainNearBlackPct);
  if (out[st].frameAo) {
    console.log('   frame ao     mean ' + f(out[st].frameAo.mean) + '  p5 ' + f(out[st].frameAo.p5)
      + '  nearBlack% ' + out[st].frameAoNearBlackPct);
  }
  for (const name of Object.keys(RECTS[st])) {
    const c = out[st].chain[name]; const a = out[st].ao[name];
    console.log('   ' + name.padEnd(26)
      + ' chain mean ' + f(c.mean) + ' p5 ' + f(c.p5) + ' p95 ' + f(c.p95)
      + (a ? ('   |  ao mean ' + f(a.mean) + ' min ' + f(a.min)
        + ' noAO%>220 ' + String(a.pctNoAoAbove220).padStart(6)
        + ' sat%<8 ' + String(a.pctSaturatedBelow8).padStart(6)) : ''));
  }
}
console.log('\n== derived');
for (const [k, v] of Object.entries(out.derived)) console.log('   ' + k.padEnd(52) + ' ' + v);
console.log('\n== profiles');
for (const [k, v] of Object.entries(out.profiles)) {
  console.log('   ' + k + '  ' + v.map((p) => p.v).join(' '));
}
