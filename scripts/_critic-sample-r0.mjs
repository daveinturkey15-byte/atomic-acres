/**
 * ONE-OFF pixel sampler for the interiors critic, round 0. Disposable.
 * Reads named rectangles out of already-written PNGs and prints mean luma, so the
 * "interior vs. through-the-opening" ratio is a measured number, not an impression.
 * Decodes in a blank Chromium page (no server, no game).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = join(ROOT, 'captures');

// [file, label, x, y, w, h]  -- coordinates in the 1600x900 frame
const SAMPLES = [
  ['g-interiors-r0-play-orangeInside.png', 'orangeInside  wall LEFT of front door', 470, 380, 90, 200],
  ['g-interiors-r0-play-orangeInside.png', 'orangeInside  THROUGH front door (street)', 610, 560, 170, 90],
  ['g-interiors-r0-play-orangeInside.png', 'orangeInside  floor AT threshold', 610, 665, 170, 30],
  ['g-interiors-r0-play-orangeInside.png', 'orangeInside  floor DEEP in room', 150, 800, 200, 60],
  ['g-interiors-r0-play-orangeInside.png', 'orangeInside  ceiling mid-span', 700, 40, 300, 60],
  ['g-interiors-r0-play-orangeInside.png', 'orangeInside  wall/ceiling junction', 700, 258, 300, 14],

  ['g-interiors-r0-interiorOrange.png', 'interiorOrange  wall RIGHT of doorway', 640, 400, 240, 300],
  ['g-interiors-r0-interiorOrange.png', 'interiorOrange  THROUGH doorway (street)', 250, 300, 280, 180],
  ['g-interiors-r0-interiorOrange.png', 'interiorOrange  floor AT threshold', 240, 780, 300, 60],
  ['g-interiors-r0-interiorOrange.png', 'interiorOrange  ceiling', 700, 20, 300, 50],

  ['g-interiors-r0-orangeKitchen.png', 'orangeKitchen  near wall (left)', 120, 250, 300, 400],
  ['g-interiors-r0-orangeKitchen.png', 'orangeKitchen  FAR room wall (7 m back)', 560, 380, 60, 120],
  ['g-interiors-r0-orangeKitchen.png', 'orangeKitchen  ceiling mid-span', 600, 60, 400, 60],
  ['g-interiors-r0-orangeKitchen.png', 'orangeKitchen  floor near', 600, 800, 300, 70],
  ['g-interiors-r0-orangeKitchen.png', 'orangeKitchen  floor far (through opening)', 620, 590, 200, 30],
  ['g-interiors-r0-orangeKitchen.png', 'orangeKitchen  THROUGH right window (street)', 1300, 430, 150, 130],

  ['g-interiors-r0-whiteBedroom.png', 'whiteGround  interior curved wall', 200, 120, 300, 120],
  ['g-interiors-r0-whiteBedroom.png', 'whiteGround  THROUGH opening (sunlit street)', 1140, 590, 120, 80],
  ['g-interiors-r0-whiteBedroom.png', 'whiteGround  floor near', 300, 830, 300, 60],

  ['g-interiors-r0-whitePoolRoom.png', 'whitePool  big flat wall centre', 600, 150, 500, 500],
  ['g-interiors-r0-whitePoolRoom.png', 'whitePool  same wall, 400 px lower', 600, 660, 500, 60],
];

const browser = await chromium.launch({ args: ['--headless=new'] });
const page = await browser.newPage();
await page.goto('about:blank');

const cache = new Map();
for (const [file, label, x, y, w, h] of SAMPLES) {
  if (!cache.has(file)) cache.set(file, readFileSync(join(C, file)).toString('base64'));
  const r = await page.evaluate(async ([b64, x, y, w, h]) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(x, y, w, h).data;
    let L = 0, R = 0, G = 0, B = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      L += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      R += d[i]; G += d[i + 1]; B += d[i + 2]; n++;
    }
    return { luma: +(L / n).toFixed(1), r: Math.round(R / n), g: Math.round(G / n), b: Math.round(B / n) };
  }, [cache.get(file), x, y, w, h]);
  console.log(label.padEnd(46) + 'luma ' + String(r.luma).padStart(6)
    + '   rgb ' + String(r.r).padStart(3) + ',' + String(r.g).padStart(3) + ',' + String(r.b).padStart(3));
}
await browser.close();
