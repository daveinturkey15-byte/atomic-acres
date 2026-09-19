/**
 * ADVERSARIAL VERIFIER - the 20 m faction read, on its own.
 *
 * The first attempt staged the two figures beside a set-dressing mannequin and
 * put the camera 20 m back; a porch staircase stood in the line and the frame
 * photographed the stair rail. This one picks the stand AND the camera by
 * probing the real collider set along the whole sight line, so the 20 m read is
 * an actual 20 m read.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures', 'verify-chars');
mkdirSync(OUT, { recursive: true });

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
const exe = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => existsSync(p));
if (!exe) { console.error('no Chrome'); process.exit(2); }

const { url } = await usePreview();
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-vfar-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 200 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('no CDP'); killTree(chrome.pid); process.exit(2); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

// Find a straight, collider-free 20 m corridor: stand point S, camera 20 m up
// +z of it, and every metre in between clear at chest height.
const line = await page.evaluate(() => {
  const clear = (x, z) => window.__NT.collidersAt(x, z, 1.2).length === 0;
  const cands = [];
  for (let x = -14; x <= 10; x += 0.5) {
    for (let z = -26; z <= 6; z += 0.5) {
      let ok = clear(x, z) && clear(x - 1.0, z) && clear(x + 1.0, z);
      for (let d = 1; d <= 20 && ok; d++) {
        if (!clear(x, z + d) || !clear(x - 1.0, z + d) || !clear(x + 1.0, z + d)) ok = false;
      }
      if (ok) cands.push({ x, z });
    }
  }
  return cands[0] ?? null;
});
console.log('[far] corridor', JSON.stringify(line));
if (line) {
  await page.evaluate(([sx, sz]) => {
    window.__NTANIM.showAll();
    window.__NTANIM.drive(0, 0); window.__NTANIM.drive(1, 0);
    window.__NTANIM.pin(0, sx - 0.9, sz, 0);
    window.__NTANIM.pin(1, sx + 0.9, sz, 0);
    window.__NT.teleport(sx, 0, sz + 20, 0, -0.02);
    if (window.__NT.release) window.__NT.release();
  }, [line.x, line.z]);
  await page.waitForTimeout(1600);
  writeFileSync(join(OUT, 'factions-at-20m.png'), await page.screenshot({ type: 'png' }));
  console.log('  wrote factions-at-20m.png');
  // and a 10 m read for a closer comparison of the two kits
  await page.evaluate(([sx, sz]) => {
    window.__NT.teleport(sx, 0, sz + 10, 0, -0.03);
    if (window.__NT.release) window.__NT.release();
  }, [line.x, line.z]);
  await page.waitForTimeout(1400);
  writeFileSync(join(OUT, 'factions-at-10m.png'), await page.screenshot({ type: 'png' }));
  console.log('  wrote factions-at-10m.png');
}
await browser.close();
killTree(chrome.pid);
