/**
 * ATMOSPHERE lane - ITEM 4 "the default must not regress": read-only comparison of two
 * capture sets already on disk (`npm run capture -- --tag <before>` and `<after>`).
 *
 * Rectangles are inherited VERBATIM from scripts/_critic-aotwo-measure.mjs and
 * scripts/_critic-aofade-b1-guards.mjs so the numbers are comparable with every AO
 * round's record and cannot drift in this lane's favour. Tolerances are the brief's:
 *   every station's frame mean luma within 3 %      sky rects within 2 %
 *   interiorOrange wall gradient p95-p5 in 20..28    spawnA crate base <= 66
 *   sunlit asphalt / lawn / facade within 3 %
 *   distant geometry (aerial slabs, turningHead mountains) may LIGHTEN by up to 8 %
 *
 *   node scripts/_verify-atmo-diff.mjs atmo-before atmo-after
 */
import { readPng, rectStats } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const [before = 'atmo-before', after = 'atmo-after'] = process.argv.slice(2);
const P = (tag, n) => join(CAP, tag + '-' + n + '.png');

const STATIONS = ['aerial', 'yardOrange', 'yardWhite', 'streetElevation', 'plaza', 'turningHead',
  'spawnA', 'spawnB', 'midStreet', 'interiorOrange'];

/** name -> [station, rect, kind]. kind decides the tolerance. */
const RECTS = {
  'turningHead sky left': ['turningHead', [60, 40, 340, 180], 'sky'],
  'turningHead sky centre': ['turningHead', [640, 40, 960, 180], 'sky'],
  'spawnA sky patch': ['spawnA', [1150, 30, 1250, 120], 'sky'],
  'turningHead asphalt foreground': ['turningHead', [400, 700, 1100, 870], 'lit'],
  'spawnA lawn field': ['spawnA', [300, 620, 700, 740], 'lit'],
  'spawnA pale wall left of door (facade)': ['spawnA', [20, 380, 180, 540], 'lit'],
  'spawnA crate base contact': ['spawnA', [745, 640, 935, 675], 'crate'],
  'interiorOrange wall right of doorway': ['interiorOrange', [620, 260, 900, 700], 'wallgrad'],
  'turningHead mountains': ['turningHead', [180, 270, 700, 330], 'distant'],
  'aerial slab TL': ['aerial', [20, 10, 330, 150], 'distant'],
  'aerial slab TR': ['aerial', [1440, 10, 1590, 120], 'distant'],
  'midStreet coach flank band': ['midStreet', [320, 470, 1480, 530], 'lit'],
};

const pct = (a, b) => (b - a) / a * 100;
const fmt = (n, w = 7) => String(n).padStart(w);
const rows = [];
let fails = 0;
const cache = {};
const img = (tag, st) => {
  const k = tag + '/' + st;
  if (!(k in cache)) cache[k] = existsSync(P(tag, st)) ? readPng(P(tag, st)) : null;
  return cache[k];
};

console.log(`\n== frame mean luma (whole frame), ${before} -> ${after}  [tolerance 3 %]`);
for (const st of STATIONS) {
  const a = img(before, st), b = img(after, st);
  if (!a || !b) { console.log('  ' + st.padEnd(16) + ' MISSING'); continue; }
  const ma = rectStats(a, [0, 0, a.width, a.height]).mean;
  const mb = rectStats(b, [0, 0, b.width, b.height]).mean;
  const d = pct(ma, mb);
  const ok = Math.abs(d) <= 3;
  if (!ok) fails++;
  rows.push({ what: 'frame mean ' + st, before: ma, after: mb, deltaPct: +d.toFixed(2), ok });
  console.log('  ' + st.padEnd(16) + fmt(ma) + ' -> ' + fmt(mb) + '  ' + fmt((d >= 0 ? '+' : '') + d.toFixed(2) + '%', 8) + (ok ? '' : '   FAIL'));
}

console.log('\n== rectangles');
for (const [name, [st, rect, kind]] of Object.entries(RECTS)) {
  const a = img(before, st), b = img(after, st);
  if (!a || !b) { console.log('  ' + name.padEnd(42) + ' MISSING'); continue; }
  const sa = rectStats(a, rect), sb = rectStats(b, rect);
  let ok, shown;
  if (kind === 'wallgrad') {
    const ga = +(sa.p95 - sa.p5).toFixed(1), gb = +(sb.p95 - sb.p5).toFixed(1);
    ok = gb >= 20 && gb <= 28;
    shown = `gradient p95-p5 ${ga} -> ${gb}  (must stay in 20..28)`;
    rows.push({ what: name + ' gradient', before: ga, after: gb, ok });
  } else if (kind === 'crate') {
    ok = sb.mean <= 66;
    shown = `mean ${sa.mean} -> ${sb.mean}  (must stay <= 66)`;
    rows.push({ what: name, before: sa.mean, after: sb.mean, ok });
  } else {
    const d = pct(sa.mean, sb.mean);
    const tol = kind === 'sky' ? 2 : 3;
    ok = kind === 'distant' ? (d >= -tol && d <= 8) : Math.abs(d) <= tol;
    shown = `mean ${sa.mean} -> ${sb.mean}  ${(d >= 0 ? '+' : '') + d.toFixed(2)}%  (${kind === 'distant' ? 'may lighten up to 8 %' : 'within ' + tol + ' %'})`;
    rows.push({ what: name, before: sa.mean, after: sb.mean, deltaPct: +d.toFixed(2), ok });
  }
  if (!ok) fails++;
  console.log('  ' + name.padEnd(42) + shown + (ok ? '' : '   FAIL'));
}

writeFileSync(join(CAP, after + '-vs-' + before + '.json'), JSON.stringify({ before, after, rows, fails }, null, 2));
console.log('\n' + (fails ? `${fails} check(s) outside tolerance` : 'every check inside tolerance'));
process.exit(fails ? 1 : 0);
