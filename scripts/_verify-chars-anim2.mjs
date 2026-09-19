/**
 * Animation re-check at the OPEN stage, with death sampled as a TIME SERIES.
 *
 * The first death capture was ambiguous: `__NTANIM.external` plays the baked
 * clip on LoopRepeat, so a single shot 1.8 s in can land back at the top of the
 * loop and photograph a standing figure. This samples hips/head height every
 * 150 ms for 3 s and writes four frames across that window, so a collapse is
 * either in the numbers and the pictures or it is not there at all.
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
  '--user-data-dir=' + join(tmpdir(), 'aa-vanim-' + cdpPort),
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
await ctx.addInitScript(() => {
  const t = new EventTarget();
  window.__OBS = [];
  t.addEventListener('observe', (e) => { window.__OBS.push(e.detail); });
  window.__THREE_DEVTOOLS__ = t;
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
await page.evaluate(() => {
  const scenes = (window.__OBS || []).filter((o) => o && o.isScene);
  window.__V = { scene: scenes.find((s) => { let n = 0; s.traverse((o) => { if (o.isSkinnedMesh) n++; }); return n > 0; }) };
});

const S = { x: -10, z: 0 };
const B = Math.PI / 4; const D = 3.6;
const cam = () => page.evaluate(([sx, sz, b, d]) => {
  window.__NT.teleport(sx + d * Math.sin(b), 0, sz + d * Math.cos(b), b, -0.10);
  if (window.__NT.release) window.__NT.release();
}, [S.x, S.z, B, D]);

/** World-space extremes of the SKINNED SURFACE, not just the bones: a vertex
 *  sample through the bone matrices proves the mesh follows, not only the rig. */
const surface = () => page.evaluate(() => {
  const ops = [];
  window.__V.scene.traverse((o) => { if (o.isSkinnedMesh && o.visible && o.parent.visible) ops.push(o); });
  const m = ops[0];
  if (!m) return null;
  const pos = m.geometry.getAttribute('position');
  const v = new m.position.constructor();
  let minY = 1e9; let maxY = -1e9; let n = 0;
  for (let i = 0; i < pos.count; i += 17) {
    v.fromBufferAttribute(pos, i);
    m.applyBoneTransform(i, v);
    m.localToWorld(v);
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    n++;
  }
  return { minY: +minY.toFixed(3), maxY: +maxY.toFixed(3), samples: n };
});

await page.evaluate(([sx, sz]) => {
  window.__NTANIM.unpin();
  window.__NTANIM.solo(0);
  window.__NTANIM.drive(0, 0, false);
  window.__NTANIM.aim(0, 0, 0);
  window.__NTANIM.pin(0, sx, sz, 0);
}, [S.x, S.z]);
await cam();
await page.waitForTimeout(1500);
const idle = await surface();
writeFileSync(join(OUT, 'anim2-idle.png'), await page.screenshot({ type: 'png' }));

await page.evaluate(() => window.__NTANIM.aim(0, 1, 0.15));
await page.waitForTimeout(1300);
const aim = await surface();
writeFileSync(join(OUT, 'anim2-aim-rifle.png'), await page.screenshot({ type: 'png' }));

await page.evaluate(() => { window.__NTANIM.aim(0, 0, 0); window.__NTANIM.drive(0, 0, true); });
await page.waitForTimeout(1500);
const crouch = await surface();
writeFileSync(join(OUT, 'anim2-crouch-idle.png'), await page.screenshot({ type: 'png' }));

await page.evaluate(() => window.__NTANIM.drive(0, 0, false));
await page.waitForTimeout(1300);
const played = await page.evaluate(async () => await window.__NTANIM.external(0, 'death'));
const series = [];
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(150);
  const s = await surface();
  series.push({ t: (i + 1) * 0.15, maxY: s.maxY });
  if (i === 2 || i === 5 || i === 8 || i === 13) {
    writeFileSync(join(OUT, `anim2-death-t${((i + 1) * 0.15).toFixed(2)}.png`), await page.screenshot({ type: 'png' }));
  }
}
const lowest = series.reduce((a, b) => (b.maxY < a.maxY ? b : a));
console.log(JSON.stringify({
  idle, aim, crouch, played,
  idleTop: idle.maxY, crouchTop: crouch.maxY,
  crouchDropM: +(idle.maxY - crouch.maxY).toFixed(3),
  aimTopDelta: +(aim.maxY - idle.maxY).toFixed(3),
  deathLowestTop: lowest, deathDropM: +(idle.maxY - lowest.maxY).toFixed(3),
  series,
}, null, 1));
await browser.close();
killTree(chrome.pid);
