/**
 * Plan-view instrument.
 *
 * Renders what the player can actually stand in, as a top-down occupancy map, next to
 * the official BO2 minimap at matched scale. Every previous layout argument on this
 * project was lost by comparing a *description* of the map with a *screenshot* of it.
 * This compares the built collision world with the reference plan, which is the only
 * pair of things that can honestly disagree.
 *
 * Blocked is sampled at knee height and at chest height separately: a knee-high kerb
 * you can walk over and a chest-high fence you cannot must not look the same.
 *
 *   node scripts/plan.mjs [--out captures/plan.png]
 */
import { chromium } from 'playwright';
import { usePreview } from './lib/preview.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'captures/plan.png';

// world window to draw, metres
const X0 = -26, X1 = 30, Z0 = -46, Z1 = 46;
const PPM = 8;                       // pixels per metre
const STEP = 0.25;                   // sampling pitch, metres


// ONE shared preview server for the whole repo - see lib/preview.mjs. Every
// harness used to spawn its own and kill only the vite parent, orphaning esbuild;
// 52 of them accumulated in three hours and held 52 listening sockets.
const { url } = await usePreview();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });

const grid = await page.evaluate(([X0, X1, Z0, Z1, STEP]) => {
  const nt = window.__NT;
  const nx = Math.round((X1 - X0) / STEP);
  const nz = Math.round((Z1 - Z0) / STEP);
  const knee = new Uint8Array(nx * nz);
  const chest = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = X0 + ix * STEP;
      const z = Z0 + iz * STEP;
      if (nt.collidersAt(x, z, 0.35).length) knee[iz * nx + ix] = 1;
      if (nt.collidersAt(x, z, 1.30).length) chest[iz * nx + ix] = 1;
    }
  }
  return { nx, nz, knee: Array.from(knee), chest: Array.from(chest), count: nt.colliderCount };
}, [X0, X1, Z0, Z1, STEP]);

await browser.close();

// ---- rasterise to a PPM, then let the caller convert; no image deps in this repo
const W = Math.round((X1 - X0) * PPM);
const H = Math.round((Z1 - Z0) * PPM);
const px = Buffer.alloc(W * H * 3);
const put = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = r; px[i + 1] = g; px[i + 2] = b;
};
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const wx = X0 + x / PPM, wz = Z0 + y / PPM;
    const ix = Math.round((wx - X0) / STEP), iz = Math.round((wz - Z0) / STEP);
    const k = grid.knee[iz * grid.nx + ix], c = grid.chest[iz * grid.nx + ix];
    // chest-blocked = wall (white); knee-only = step-over (dim); open = dark
    if (c) put(x, y, 235, 235, 235);
    else if (k) put(x, y, 90, 86, 74);
    else put(x, y, 16, 18, 20);
  }
}
// axes every 10 m, brighter at the origin
for (let m = Math.ceil(X0 / 10) * 10; m <= X1; m += 10) {
  const x = Math.round((m - X0) * PPM);
  for (let y = 0; y < H; y++) put(x, y, m === 0 ? 210 : 70, m === 0 ? 60 : 24, m === 0 ? 60 : 24);
}
for (let m = Math.ceil(Z0 / 10) * 10; m <= Z1; m += 10) {
  const y = Math.round((m - Z0) * PPM);
  for (let x = 0; x < W; x++) put(x, y, m === 0 ? 60 : 24, m === 0 ? 140 : 60, m === 0 ? 210 : 90);
}
mkdirSync(join(ROOT, 'captures'), { recursive: true });
const ppm = join(ROOT, OUT.replace(/\.png$/, '.ppm'));
writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), px]));

const openCells = grid.knee.filter((v) => !v).length;
console.log(`[plan] ${grid.count} colliders; ${W}x${H} px at ${PPM} px/m over `
  + `x ${X0}..${X1}, z ${Z0}..${Z1}`);
console.log(`[plan] ${(100 * openCells / grid.knee.length).toFixed(1)}% of the sampled window is walkable at knee height`);
console.log('[plan] wrote ' + ppm);
