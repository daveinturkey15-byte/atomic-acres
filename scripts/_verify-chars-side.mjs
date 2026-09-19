/**
 * Re-shoot the side bearings, verifying the camera actually stayed where it was
 * put. The first pass produced an INTERIOR frame for faction B's side view: the
 * teleport lands and then ~66 frames of player.update() run before the shot, and
 * the controller can slide off the point. This asserts the position after the
 * settle and reports the drift instead of photographing whatever it found.
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
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .filter(Boolean).find((p) => existsSync(p));
const { url } = await usePreview();
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-vside-' + cdpPort),
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,UseSkiaRenderer', '--ignore-gpu-blocklist',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let browser = null;
for (let i = 0; i < 200 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

const STAGE = { x: -10, z: 0 };
const D = 3.4;
for (const [fi, fname] of [[0, 'a'], [1, 'b']]) {
  for (const [speed, gait] of [[0, 'idle'], [1.3, 'walk']]) {
    const b = Math.PI / 2;
    const cx = STAGE.x + D * Math.sin(b);
    const cz = STAGE.z + D * Math.cos(b);
    await page.evaluate(([i, s, sx, sz, x, z, yaw]) => {
      window.__NTANIM.unpin();
      window.__NTANIM.solo(i);
      window.__NTANIM.aim(i, 0, 0);
      window.__NTANIM.drive(i, s, false);
      window.__NTANIM.pin(i, sx, sz, 0);
      window.__NT.teleport(x, 0, z, yaw, -0.10);
      if (window.__NT.release) window.__NT.release();
    }, [fi, speed, STAGE.x, STAGE.z, cx, cz, b]);
    await page.waitForTimeout(700);
    // Re-assert the camera immediately before the shot, then take it fast.
    await page.evaluate(([x, z, yaw]) => {
      window.__NT.teleport(x, 0, z, yaw, -0.10);
      if (window.__NT.release) window.__NT.release();
    }, [cx, cz, b]);
    await page.waitForTimeout(140);
    const pos = await page.evaluate(() => window.__NT.probePos());
    const f = join(OUT, `f${fname}-${gait}-side.png`);
    writeFileSync(f, await page.screenshot({ type: 'png' }));
    console.log(`  f${fname}-${gait}-side  asked (${cx.toFixed(2)}, ${cz.toFixed(2)})  got (${pos[0].toFixed(2)}, ${pos[2].toFixed(2)})  drift ${Math.hypot(pos[0] - cx, pos[2] - cz).toFixed(2)} m`);
  }
}
await browser.close();
killTree(chrome.pid);
