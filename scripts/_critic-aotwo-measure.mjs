/**
 * ao-twoscale ROUND 0 (baseline) — read-only measurement over PNGs already on disk.
 *
 * interiorOrange / whitePoolRoom / spawnA / turningHead rectangles are carried over
 * UNCHANGED from scripts/_critic-aothick-measure.mjs (which itself carried them from
 * the ao-retune round-1 record), so the numbers are comparable round to round and the
 * rectangles cannot drift in a critic's favour.
 *
 * NEW this round, documented so round 1 can reuse them verbatim:
 *   midStreet 'coach flank band'   [320, 470, 1480, 530]  horizontal strip on the flat
 *                                                          coach panel, sampled every 80 px
 *   midStreet 'coach flank left'   [320, 470,  520, 530]
 *   midStreet 'coach flank right'  [1280, 470, 1480, 530]
 *   midStreet 'road/kerb junction' [80, 640, 1520, 700]    (from the ao-thickness FINAL)
 *
 * Nothing here renders; it only reads the written PNGs.
 */
import { readPng, rectStats, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const TAG = process.env.CRITIC_TAG || 'g-ao-twoscale-r0';
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
  midStreet: {
    'coach flank band': [320, 470, 1480, 530],
    'coach flank left': [320, 470, 520, 530],
    'coach flank right': [1280, 470, 1480, 530],
    'road/kerb junction': [80, 640, 1520, 700],
  },
};

const out = { tag: TAG, when: new Date().toISOString() };
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
  if (!existsSync(P(station))) { console.log('skip ' + station); continue; }
  const chain = readPng(P(station));
  let ao = null;
  try { ao = readPng(P('ao-' + station)); } catch { /* none */ }
  const row = { chain: {}, ao: {} };
  row.frameChain = rectStats(chain, [0, 0, chain.width, chain.height]);
  row.frameChainNearBlackPct = near(chain, 0, 12);
  row.frameChainAbove230Pct = fracInRect(chain, [0, 0, chain.width, chain.height], (v) => v > 229);
  if (ao) {
    row.frameAo = rectStats(ao, [0, 0, ao.width, ao.height]);
    row.frameAoNearBlackPct = near(ao, 0, 12);
    row.frameAoBelow225Pct = fracInRect(ao, [0, 0, ao.width, ao.height], (v) => v < 225);
  }
  for (const [name, rect] of Object.entries(RECTS[station])) {
    row.chain[name] = rectStats(chain, rect);
    row.chain[name].spread = +(row.chain[name].p95 - row.chain[name].p5).toFixed(1);
    if (ao) {
      row.ao[name] = rectStats(ao, rect);
      row.ao[name].pctNoAoAbove220 = fracInRect(ao, rect, (v) => v > 220);
      row.ao[name].pctSaturatedBelow8 = fracInRect(ao, rect, (v) => v < 8);
    }
  }
  out[station] = row;
}

const io = out.interiorOrange;
out.derived = {
  'interiorOrange aperture/wall (chain)':
    +(io.chain['aperture through doorway'].mean / io.chain['wall right of doorway'].mean).toFixed(3),
  'interiorOrange wall gradient p95-p5 (chain)': io.chain['wall right of doorway'].spread,
  'whitePoolRoom wall full gradient p95-p5 (chain)': out.whitePoolRoom.chain['wall full'].spread,
  'spawnA crate base contact mean (chain)': out.spawnA.chain['crate base contact'].mean,
};

// vertical profiles
function profile(img, x, y0, y1, n = 20) {
  const r = [];
  for (let i = 0; i < n; i++) {
    const y = Math.round(y0 + (y1 - y0) * i / (n - 1));
    let s = 0; for (let dx = -12; dx <= 12; dx++) s += luma(img, x + dx, y);
    r.push(+(s / 25).toFixed(1));
  }
  return r;
}
// the wall/ceiling junction cut, identical sampling to the ao-thickness FINAL:
// x = 760, y = 60..180 step 12, 25-px horizontal boxcar
function junction(img, x = 760) {
  const r = [];
  for (let y = 60; y <= 180; y += 12) {
    let s = 0; for (let dx = -12; dx <= 12; dx++) s += luma(img, x + dx, y);
    r.push(+(s / 25).toFixed(1));
  }
  return r;
}
// horizontal cut across the flat coach panel, every 80 px
function hband(img, y0, y1, x0, x1, step = 80) {
  const r = [];
  for (let x = x0; x <= x1; x += step) {
    let s = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let dx = -8; dx <= 8; dx++) { s += luma(img, x + dx, yy); n++; }
    r.push(+(s / n).toFixed(1));
  }
  return r;
}

out.profiles = {
  'interiorOrange chain x=760 y=240..880': profile(readPng(P('interiorOrange')), 760, 240, 880),
  'interiorOrange ao    x=760 y=240..880': profile(readPng(P('ao-interiorOrange')), 760, 240, 880),
  'interiorOrange ao junction x=760 y=60..180 step12': junction(readPng(P('ao-interiorOrange'))),
  'interiorOrange chain junction x=760 y=60..180 step12': junction(readPng(P('interiorOrange'))),
  'whitePoolRoom chain x=900 y=40..770': profile(readPng(P('whitePoolRoom')), 900, 40, 770),
  'whitePoolRoom ao    x=900 y=40..770': profile(readPng(P('ao-whitePoolRoom')), 900, 40, 770),
  'midStreet ao  flank band y470-530 x320..1480 step80': hband(readPng(P('ao-midStreet')), 470, 530, 320, 1480),
  'midStreet chain flank band y470-530 x320..1480 step80': hband(readPng(P('midStreet')), 470, 530, 320, 1480),
  'midStreet ao  flank column x=700..760 y40..880': profile(readPng(P('ao-midStreet')), 730, 40, 880, 14),
};

writeFileSync(join(CAP, TAG + '-rect-metrics.json'), JSON.stringify(out, null, 2));

const f = (n) => String(n).padStart(8);
for (const st of Object.keys(RECTS)) {
  if (!out[st]) continue;
  console.log('\n== ' + st);
  console.log('   frame chain  mean ' + f(out[st].frameChain.mean) + '  p5 ' + f(out[st].frameChain.p5)
    + '  p95 ' + f(out[st].frameChain.p95) + '  nearBlack% ' + out[st].frameChainNearBlackPct
    + '  >229% ' + out[st].frameChainAbove230Pct);
  if (out[st].frameAo) {
    console.log('   frame ao     mean ' + f(out[st].frameAo.mean) + '  p5 ' + f(out[st].frameAo.p5)
      + '  below225% ' + out[st].frameAoBelow225Pct);
  }
  for (const name of Object.keys(RECTS[st])) {
    const c = out[st].chain[name]; const a = out[st].ao[name];
    console.log('   ' + name.padEnd(26)
      + ' chain mean ' + f(c.mean) + ' p5 ' + f(c.p5) + ' p95 ' + f(c.p95) + ' spread ' + f(c.spread)
      + (a ? ('   ao mean ' + f(a.mean) + ' min ' + f(a.min) + ' >220% ' + String(a.pctNoAoAbove220).padStart(6)) : ''));
  }
}
console.log('\n== derived'); console.log(out.derived);
console.log('\n== profiles');
for (const [k, v] of Object.entries(out.profiles)) console.log('  ' + k + '\n    ' + v.join(' '));
