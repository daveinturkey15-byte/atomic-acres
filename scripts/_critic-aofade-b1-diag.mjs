/**
 * ao-farfade ROUND 1 — read the DIAGNOSTIC builds. READ-ONLY over PNGs on disk.
 *
 * The diagnostic build re-points `?post=ao` at a single scalar (|n.v|, view depth,
 * or the raw far multiplier) instead of the combined occlusion term. These frames are
 * NEVER scored; they exist only to say what value the fade would see on each guard
 * rectangle. Same rectangles as `_critic-aofade-b1-guards.mjs`.
 *
 * Display values go through ACES + sRGB like every other frame in this project, so a
 * linear 0..1 scalar does NOT arrive as 0..255. The mapping is measured, not assumed:
 * `--calib` prints the display value of known constants so a reader can invert it.
 */
import { readPng, rectStats } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const TAG = process.env.CRITIC_TAG || 'g-ao-farfade-diagN';
const P = (n) => join(CAP, TAG + '-' + n + '.png');

const RECTS = {
  aerial: {
    'skyline slab TL': [20, 10, 330, 150],
    'skyline slab TR': [1440, 10, 1590, 120],
    'desert floor mid-left': [60, 200, 400, 330],
  },
  yardWhite: {
    'ridge right': [1405, 85, 1535, 145],
    'ridge left': [70, 80, 350, 145],
  },
  midStreet: {
    'coach flank right': [1280, 470, 1480, 530],
    'coach flank left': [320, 470, 520, 530],
    'coach flank band': [320, 470, 1480, 530],
    'road/kerb junction': [80, 640, 1520, 700],
  },
  interiorOrange: {
    'wall right of doorway': [620, 260, 900, 700],
    'floor at threshold': [200, 800, 560, 880],
    'ceiling beam band': [200, 10, 900, 60],
  },
  whitePoolRoom: { 'wall full': [620, 60, 1200, 760] },
  spawnA: {
    'lawn field': [300, 620, 700, 740],
    'crate base contact': [745, 640, 935, 675],
    'pale wall left of door': [20, 380, 180, 540],
  },
};

for (const st of Object.keys(RECTS)) {
  let img;
  try { img = readPng(P('ao-' + st)); } catch { console.log('skip ' + st); continue; }
  console.log('\n== ' + st + '   (diagnostic scalar, DISPLAY values)');
  for (const [name, rect] of Object.entries(RECTS[st])) {
    const s = rectStats(img, rect);
    console.log('   ' + name.padEnd(24)
      + ' mean ' + String(s.mean).padStart(7)
      + ' p5 ' + String(s.p5).padStart(7)
      + ' p50 ' + String(s.p50).padStart(7)
      + ' p95 ' + String(s.p95).padStart(7)
      + ' min ' + String(s.min).padStart(7)
      + ' max ' + String(s.max).padStart(7));
  }
}
