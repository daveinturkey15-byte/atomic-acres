/**
 * Freecam headless check (temporary, lives in /tmp — not part of the repo).
 * Drives the REAL Player controller through window.__NT:
 *  1. fly-with-collision is blocked by the orange house front wall
 *  2. noclip passes through that same wall
 *  3. fly forward while pitched up gains height
 *  4. yaw-frame sanity at 90 deg (facing -x, W decreases x) and 45 deg
 *  5. walk mode still walks (short leg on the street)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = 'C:/Users/david/Desktop/stuff/nuketown';

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

const port = await freePort();
const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
);
const url = 'http://localhost:' + port + '/';
if (!await waitForServer(url)) {
  console.error('[flycheck] dev server never came up');
  server.kill();
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, { timeout: 90000 });
await page.evaluate(() => {
  document.getElementById('start')?.remove();
});
await page.waitForTimeout(800);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? ' — ' + detail : ''));
};

// helper run in-page: hold a key for ms while the rAF loop integrates, return pos
async function holdKey(code, ms) {
  return await page.evaluate(async ({ code, ms }) => {
    const nt = window.__NT;
    nt.release();
    const down = new KeyboardEvent('keydown', { code });
    const up = new KeyboardEvent('keyup', { code });
    window.dispatchEvent(down);
    await new Promise((r) => setTimeout(r, ms));
    window.dispatchEvent(up);
    return nt.probePos();
  }, { code, ms });
}

// 1. fly-with-collision blocked by orange house front wall (wall plane z=-13.6)
await page.evaluate(() => {
  const nt = window.__NT;
  nt.spawn('a');
  nt.setMode('fly');
  nt.teleport(0, 1.0, -10, 0, 0); // street side, facing -z at the wall
  nt.release();
});
const blocked = await holdKey('KeyW', 1200);
check('fly-collision blocked by wall', blocked[2] > -14.5,
  'z=' + blocked.map((v) => +v.toFixed(2)).join(','));

// 2. noclip through the same wall
await page.evaluate(() => {
  const nt = window.__NT;
  nt.setMode('noclip');
  nt.teleport(0, 1.0, -10, 0, 0);
  nt.release();
});
const through = await holdKey('KeyW', 1200);
check('noclip passes through wall', through[2] < -16,
  'z=' + through.map((v) => +v.toFixed(2)).join(','));

// 3. pitch-up flight gains height (open sky above the street)
await page.evaluate(() => {
  const nt = window.__NT;
  nt.setMode('fly');
  nt.teleport(-30, 2.0, 0, Math.PI / 2, 0.6); // face -x (open end), look up
  nt.release();
});
const climbed = await holdKey('KeyW', 1000);
check('pitch-up flight gains height', climbed[1] > 4.0,
  'y=' + climbed.map((v) => +v.toFixed(2)).join(','));

// 4a. 90 deg: yaw=+PI/2 faces -x, W must decrease x, hold z
await page.evaluate(() => {
  const nt = window.__NT;
  nt.setMode('fly');
  nt.teleport(-30, 2.0, 0, Math.PI / 2, 0);
  nt.release();
});
const east = await holdKey('KeyW', 800);
check('90deg forward is -x', east[0] < -33 && Math.abs(east[2]) < 1.5,
  'x/z=' + east.map((v) => +v.toFixed(2)).join(','));

// 4b. 45 deg: yaw=PI/4 forward is (-sin45, -cos45): x and z decrease together
await page.evaluate(() => {
  const nt = window.__NT;
  nt.setMode('fly');
  nt.teleport(-30, 2.0, 10, Math.PI / 4, 0);
  nt.release();
});
const diag = await holdKey('KeyW', 800);
const dx = diag[0] - -30, dz = diag[2] - 10;
check('45deg forward is diagonal', dx < -3 && dz < -3 && Math.abs(Math.abs(dx) - Math.abs(dz)) < 1.5,
  'dx=' + dx.toFixed(2) + ' dz=' + dz.toFixed(2));

// 5. walk still works: spawn A, probe a short street leg via the real probe
const walkOk = await page.evaluate(() => {
  const nt = window.__NT;
  nt.probeReset(0, -29);
  return nt.probeWalkTo(-13, -27, 600);
});
check('walk leg via probe', walkOk === true, 'spawnA -> (-13,-27)');

// mode reporting through stats()
const stats = await page.evaluate(() => {
  const nt = window.__NT;
  nt.setMode('fly');
  nt.setFlySpeed(20);
  return nt.stats();
});
check('stats exposes mode+flySpeed', stats.mode === 'fly' && stats.flySpeed === 20,
  JSON.stringify({ mode: stats.mode, flySpeed: stats.flySpeed }));

await browser.close();
server.kill();

if (pageErrors.length) {
  console.log('[flycheck] PAGE ERRORS:');
  for (const e of pageErrors) console.log('  !! ' + e);
}
const bad = results.filter((r) => !r.ok).length + (pageErrors.length ? 1 : 0);
console.log('[flycheck] ' + (results.length - results.filter((r) => !r.ok).length) + '/' + results.length + ' checks passed');
process.exit(bad ? 1 : 0);
