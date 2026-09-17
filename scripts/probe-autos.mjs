/** THROWAWAY autos probe: turningHead re-check + plinth close-up. DELETE AFTER USE. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
  s.on('error', rej);
});
async function waitFor(url, ms = 300000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const port = await freePort();
console.log('[probe] dev server on port ' + port);
const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
);
server.stdout.on('data', (d) => process.stdout.write('[vite] ' + d));
server.stderr.on('data', (d) => process.stderr.write('[vite] ' + d));

const url = 'http://127.0.0.1:' + port + '/';
const up = await waitFor(url);
if (!up) { console.error('[probe] server never came up'); server.kill(); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));

await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, undefined, { timeout: 180000 });
// ---- traverse replica (exact ROUTES/doors/verge logic, generous timeouts) ----
const ROUTES = [
  { name: 'spawnA -> spawnB, west flank',
    pts: [[0, -29], [-13, -27], [-20, -16], [-20, 0], [-20, 16], [-13, 27], [0, 29]] },
  { name: 'spawnA -> spawnB, east flank',
    pts: [[0, -29], [13, -27], [18, -16], [18, -8], [18, 8], [18, 16], [13, 27], [0, 29]] },
  { name: 'spawnA -> cul-de-sac turning head',
    pts: [[0, -29], [13, -27], [16, -16], [16, -8], [20, -1], [26, -0.5]] },
  { name: 'spawnA -> open end of the street',
    pts: [[0, -29], [-13, -27], [-20, -10], [-30, -2], [-44, 0]] },
  { name: 'along the street, open end -> head',
    pts: [[-44, 0], [-24, 0], [-8, 0], [8, 0], [20, 0], [26, 0]] },
];
const results = await page.evaluate(async (routes) => {
  const nt = window.__NT;
  const out = [];
  for (const route of routes) {
    nt.probeReset(route.pts[0][0], route.pts[0][1]);
    let stuck = null;
    let reached = 0;
    for (let i = 1; i < route.pts.length; i++) {
      const [tx, tz] = route.pts[i];
      if (!nt.probeWalkTo(tx, tz, 1400)) {
        stuck = { target: [tx, tz], at: nt.probePos() };
        break;
      }
      reached = i;
    }
    out.push({ name: route.name, reached, legs: route.pts.length - 1, stuck });
  }
  return out;
}, ROUTES);
let bad = 0;
console.log('[traverse-replica] routes:');
for (const r of results) {
  const ok = r.stuck === null;
  if (!ok) bad++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + r.name
    + '  (' + r.reached + '/' + r.legs + ' legs)'
    + (r.stuck ? '  stuck to ' + JSON.stringify(r.stuck.target)
      + ' at ' + JSON.stringify(r.stuck.at.map((n) => +n.toFixed(1))) : ''));
}
const doors = await page.evaluate(() => {
  const nt = window.__NT;
  const FRONT = 13.6;
  const BACK = 22.8;
  const scan = (side, wallZ, fromOutside) => {
    const open = [];
    for (let x = -9.5; x <= 9.5; x += 0.5) {
      const startZ = side * (wallZ + (fromOutside ? 2.4 : -2.4));
      const endZ = side * (wallZ - (fromOutside ? 2.6 : -2.6));
      nt.probeReset(x, startZ);
      if (nt.probeWalkTo(x, endZ, 420)) open.push(+x.toFixed(1));
    }
    const spans = [];
    for (const v of open) {
      const last = spans[spans.length - 1];
      if (last && Math.abs(v - last[1]) < 0.75) last[1] = v;
      else spans.push([v, v]);
    }
    return spans;
  };
  return {
    orangeStreet: scan(-1, FRONT, true),
    orangeYard: scan(-1, BACK, false),
    whiteStreet: scan(1, FRONT, true),
    whiteYard: scan(1, BACK, false),
  };
});
let faceless = 0;
console.log('[traverse-replica] doors:');
for (const [k, spans] of Object.entries(doors)) {
  if (!spans.length) faceless++;
  console.log('  ' + k + ' ' + (spans.length ? JSON.stringify(spans) : 'NONE'));
}
const verge = await page.evaluate(() => {
  const nt = window.__NT;
  const scan = (side) => {
    const open = [];
    for (let x = -19; x <= 19; x += 0.5) {
      nt.probeReset(x, side * 11.0);
      if (nt.probeWalkTo(x, side * 5.5, 420)) open.push(+x.toFixed(1));
    }
    const spans = [];
    for (const v of open) {
      const last = spans[spans.length - 1];
      if (last && Math.abs(v - last[1]) < 0.75) last[1] = v;
      else spans.push([v, v]);
    }
    return spans;
  };
  return { orangeVerge: scan(-1), whiteVerge: scan(1) };
});
let walled = 0;
console.log('[traverse-replica] verge:');
for (const [k, spans] of Object.entries(verge)) {
  const total = spans.reduce((a, v) => a + (v[1] - v[0]) + 0.5, 0);
  if (total < 8) walled++;
  console.log('  ' + k + ' ' + total.toFixed(1) + ' m open ' + JSON.stringify(spans));
}
const hand = await page.evaluate(() => window.__NT.stats().handedness);
const handOk = Array.isArray(hand) && hand.every(Boolean);
console.log('[traverse-replica] handedness ' + (handOk ? 'PASS' : 'FAIL ' + JSON.stringify(hand)));
console.log('[traverse-replica] ' + (results.length - bad) + '/' + results.length
  + ' routes; ' + (4 - faceless) + '/4 faces; walled=' + walled);
if (bad || faceless || walled || !handOk) process.exitCode = 3;
const strip = () => page.evaluate(() => {
  const el = document.getElementById('start');
  if (el) el.remove();
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair');
  if (ch) ch.style.display = 'none';
});
await strip();
await page.waitForTimeout(1500);

await page.evaluate(() => window.__NT.goto('turningHead'));
await page.waitForTimeout(400);
await strip();
await page.evaluate(() => window.__NT.render());
await page.screenshot({ path: join(OUT, 'autos-turningHead.png') });
console.log('[probe] turningHead shot; stats:', JSON.stringify(await page.evaluate(() => window.__NT.stats())));

// slalom view: stand east of the pair in the open corridor, look west
await page.evaluate(() => window.__NT.teleport(-30, 0, 0, Math.PI / 2, 0.02));
await page.waitForTimeout(400);
await strip();
await page.evaluate(() => window.__NT.render());
console.log('[probe] slalom pose: ' + await page.evaluate(() => (typeof window.__NT.cameraPose === 'function' ? JSON.stringify(window.__NT.cameraPose()) : 'NO_POSE_API')));
await page.screenshot({ path: join(OUT, 'autos-slot-a.png') });
console.log('[probe] slalom shot');

// plinth close-up: stand east of the plinth mouth, look at the sedan
await page.evaluate(() => window.__NT.teleport(-42.0, 0, -1.6, 0.91, 0.02));
await page.waitForTimeout(400);
await strip();
await page.evaluate(() => window.__NT.render());
console.log('[probe] plinth pose: ' + await page.evaluate(() => (typeof window.__NT.cameraPose === 'function' ? JSON.stringify(window.__NT.cameraPose()) : 'NO_POSE_API')));
await page.screenshot({ path: join(OUT, 'autos-mouth-a.png') });
console.log('[probe] plinth shot');

console.log('[probe] pageErrors:', JSON.stringify(pageErrors));
console.log('[probe] consoleErrors:', JSON.stringify(consoleErrors.slice(0, 8)));
await browser.close();
server.kill();
process.exit(pageErrors.length ? 2 : 0);
