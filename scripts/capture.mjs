/**
 * Headless capture harness.
 *
 * Starts ITS OWN dev server on a port it picks, so it can never photograph a stale
 * preview left running by something else. Drives window.__NT to each camera station,
 * screenshots it, and reports console errors and renderer stats.
 *
 *   node scripts/capture.mjs                  all stations
 *   node scripts/capture.mjs aerial yardOrange   named stations
 *   node scripts/capture.mjs --tag pass2       label the output set
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');

const argv = process.argv.slice(2);
let tag = '';
const tagIdx = argv.indexOf('--tag');
if (tagIdx !== -1) {
  tag = argv[tagIdx + 1] ?? '';
  argv.splice(tagIdx, 2);
}
const wanted = argv.filter((a) => !a.startsWith('--'));

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on('error', rej);
  });
}

async function waitForServer(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const port = await freePort();
console.log('[capture] starting own dev server on port ' + port);
const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
);
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const url = 'http://127.0.0.1:' + port + '/';
const up = await waitForServer(url);
if (!up) {
  console.error('[capture] server never came up. log:\n' + serverLog);
  server.kill();
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
// clear only PNGs from a previous run so a failed station cannot leave a stale image
for (const f of readdirSync(OUT)) {
  if (f.endsWith('.png') || f.endsWith('.json')) rmSync(join(OUT, f), { force: true });
}

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400));
});
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));

console.log('[capture] loading ' + url);
await page.goto(url, { waitUntil: 'load', timeout: 90000 });

// wait for the build to finish and the QA surface to appear
try {
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true,
    { timeout: 90000 });
} catch {
  console.error('[capture] window.__NT never became ready.');
  console.error('  page errors: ' + JSON.stringify(pageErrors, null, 2));
  console.error('  console errors: ' + JSON.stringify(consoleErrors.slice(0, 12), null, 2));
  await browser.close();
  server.kill();
  process.exit(1);
}

// let a few frames run so the renderer info is populated and textures have uploaded
await page.waitForTimeout(1200);

const stations = await page.evaluate(() => window.__NT.stations);
const names = wanted.length ? wanted : Object.keys(stations);

const results = [];
for (const name of names) {
  if (!stations[name]) {
    console.warn('[capture] no such station: ' + name);
    continue;
  }
  const ok = await page.evaluate((n) => window.__NT.goto(n), name);
  if (!ok) { console.warn('[capture] goto failed: ' + name); continue; }
  await page.waitForTimeout(260);
  await page.evaluate(() => window.__NT.render());
  const file = join(OUT, (tag ? tag + '-' : '') + name + '.png');
  await page.screenshot({ path: file });
  const stats = await page.evaluate(() => window.__NT.stats());
  results.push({ station: name, ref: stations[name].ref, note: stations[name].note, file, stats });
  console.log('  ' + name.padEnd(16)
    + String(stats.calls).padStart(5) + ' calls  '
    + String(Math.round(stats.triangles / 1000)).padStart(5) + 'k tris'
    + (stations[name].ref ? '   ref=' + stations[name].ref.split(' ')[0] : '   (diagnostic)'));
}

const moduleStats = await page.evaluate(() => window.__NT.moduleStats);
const summary = {
  when: new Date().toISOString(),
  url,
  tag,
  viewport: '1600x900',
  moduleStats,
  results,
  pageErrors,
  consoleErrors,
};
writeFileSync(join(OUT, (tag ? tag + '-' : '') + 'summary.json'),
  JSON.stringify(summary, null, 2));

await browser.close();
server.kill();

console.log('\n[capture] modules:');
for (const [k, v] of Object.entries(moduleStats)) {
  console.log('  ' + k.padEnd(14) + String(v.objects).padStart(5) + ' objects  '
    + String(v.colliders).padStart(4) + ' colliders  ' + v.ms + ' ms');
}
if (pageErrors.length) {
  console.log('\n[capture] PAGE ERRORS (' + pageErrors.length + '):');
  for (const e of pageErrors.slice(0, 10)) console.log('  ' + e);
}
if (consoleErrors.length) {
  console.log('\n[capture] CONSOLE ERRORS (' + consoleErrors.length + '):');
  for (const e of consoleErrors.slice(0, 10)) console.log('  ' + e);
}
console.log('\n[capture] wrote ' + results.length + ' captures to captures/');
process.exit(pageErrors.length ? 2 : 0);
