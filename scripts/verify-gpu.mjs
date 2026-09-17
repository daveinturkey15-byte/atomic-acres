/**
 * THROWAWAY verification for the WebGPU migration (delete after the report).
 * The shared capture harness takes no query params, so this drives the same
 * stations with explicit backend selection and records which backend came up.
 * Usage: node scripts/verify-gpu.mjs [wgl2|gpu|both]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
const STATIONS = ['streetElevation', 'yardOrange', 'turningHead', 'aerial'];

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function waitForServer(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const mode = process.argv[2] || 'both';
const angle = process.env.NT_ANGLE || 'd3d11';
const tagFor = (def) => process.env.NT_TAG || def;
const variants = mode === 'both'
  ? [{ tag: tagFor('wgl2'), qs: '?gl=webgl' }, { tag: 'gpu', qs: '' }]
  : mode === 'wgl2' ? [{ tag: tagFor('wgl2'), qs: '?gl=webgl' }] : [{ tag: 'gpu', qs: '' }];
const port = await freePort();
const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
);
const base = 'http://localhost:' + port + '/';
if (!await waitForServer(base)) {
  console.error('[verify-gpu] dev server never came up');
  server.kill();
  process.exit(1);
}

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=' + angle,
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
  ],
});

let failed = false;
for (const v of variants) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
    if (m.type() === 'warning') warnings.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await page.goto(base + v.qs, { waitUntil: 'load', timeout: 90000 });
  try {
    await page.waitForFunction(() => window.__NT && window.__NT.ready === true, undefined, { timeout: 90000 });
  } catch (err) {
    console.error(`[${v.tag}] __NT never ready: ` + String(err).slice(0, 300));
    console.error('  consoleErrors=' + JSON.stringify(consoleErrors.slice(0, 6)));
    console.error('  pageErrors=' + JSON.stringify(pageErrors.slice(0, 6)));
    failed = true;
    await page.close();
    continue;
  }
  await page.evaluate(() => {
    const el = document.getElementById('start');
    if (el) el.remove();
    for (const id of ['hud', 'crosshair']) {
      const h = document.getElementById(id);
      if (h) h.style.display = 'none';
    }
  });
  await page.waitForTimeout(2500);
  const backend = await page.evaluate(() => window.__NT_BACKEND || null);
  for (const name of STATIONS) {
    await page.evaluate((n) => window.__NT.goto(n), name);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__NT.render());
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `${v.tag}-${name}.png`) });
    const stats = await page.evaluate(() => window.__NT.stats());
    console.log(`  ${name.padEnd(16)} calls=${stats.calls} tris=${Math.round(stats.triangles / 1000)}k`);
  }
  const warns = warnings.filter((w) => !w.includes('.render() called before'));
  console.log(`  consoleErrors=${consoleErrors.length} pageErrors=${pageErrors.length} warnings(other)=${warns.length}`);
  for (const e of [...pageErrors, ...consoleErrors].slice(0, 8)) console.log('    !! ' + e);
  for (const w of warns.slice(0, 4)) console.log('    warn: ' + w);
  if (pageErrors.length || consoleErrors.length) failed = true;
  await page.close();
}

await browser.close();
server.kill();
process.exit(failed ? 2 : 0);
