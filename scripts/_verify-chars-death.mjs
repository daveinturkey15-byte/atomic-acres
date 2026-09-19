/**
 * Death on the SHIPPED path.
 *
 * `__NTANIM.external(i,'death')` goes through `playExternal`, not through
 * `rig.playDeath()` which is what main.ts actually calls when a bot's `alive`
 * flag drops. The external route moved the mesh but then held ONE pose for 3 s
 * (maxY 1.740 on every one of twenty samples) - identical readings, which is
 * exactly the signature that says a measurement measured nothing. So: let the
 * local match run, watch `__NTGAME.bots()` for a body that dies, and sample the
 * SKINNED SURFACE of the figure standing at that bot's coordinates before and
 * after. Also runs `external(i,'walk')` as a control, so "frozen" can be told
 * apart from "playExternal is broken".
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
  '--user-data-dir=' + join(tmpdir(), 'aa-vdeath-' + cdpPort),
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
  // world-space vertical extent of the skinned surface nearest (x,z)
  window.__surfAt = (x, z) => {
    const ops = [];
    window.__V.scene.traverse((o) => { if (o.isSkinnedMesh) ops.push(o); });
    let best = null; let bd = 1e9;
    for (const m of ops) {
      const p = m.parent.position;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best || bd > 2.5) return null;
    const pos = best.geometry.getAttribute('position');
    const v = new best.position.constructor();
    let minY = 1e9; let maxY = -1e9;
    for (let i = 0; i < pos.count; i += 13) {
      v.fromBufferAttribute(pos, i);
      best.applyBoneTransform(i, v);
      best.localToWorld(v);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    return { minY: +minY.toFixed(3), maxY: +maxY.toFixed(3), dist: +bd.toFixed(2) };
  };
});

// --- control: does playExternal animate AT ALL on this build?
await page.evaluate(() => { window.__NTANIM.unpin(); window.__NTANIM.pin(0, -10, 0, 0); });
await page.waitForTimeout(600);
const walkOk = await page.evaluate(async () => await window.__NTANIM.external(0, 'walk'));
const walkSeries = [];
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(180);
  walkSeries.push((await page.evaluate(() => window.__surfAt(-10, 0)))?.maxY);
}
await page.evaluate(() => { window.__NTANIM.clearExternal(0); window.__NTANIM.unpin(); });
console.log('[control] external walk played', walkOk, 'maxY series', JSON.stringify(walkSeries),
  'distinct', new Set(walkSeries).size);

// --- shipped path: wait for a bot to die in the local match
let found = null;
const t0 = Date.now();
while (!found && Date.now() - t0 < 180000) {
  found = await page.evaluate(() => {
    const bots = window.__NTGAME ? window.__NTGAME.bots() : [];
    const dead = bots.find((b) => !b.alive);
    return dead ? { id: dead.id, x: dead.x, y: dead.y, z: dead.z } : null;
  });
  if (!found) await page.waitForTimeout(700);
}
console.log('[death] first dead bot', JSON.stringify(found), 'after', ((Date.now() - t0) / 1000).toFixed(1), 's');
if (found) {
  const series = [];
  for (let i = 0; i < 14; i++) {
    const s = await page.evaluate(([x, z]) => window.__surfAt(x, z), [found.x, found.z]);
    series.push({ t: +(i * 0.2).toFixed(1), ...(s || {}) });
    if (i === 1) {
      await page.evaluate(([x, z]) => {
        window.__NT.teleport(x, 0, z + 4.0, 0, -0.28);
        if (window.__NT.release) window.__NT.release();
      }, [found.x, found.z]);
    }
    if (i === 4 || i === 9 || i === 13) {
      writeFileSync(join(OUT, `death-shipped-t${(i * 0.2).toFixed(1)}.png`), await page.screenshot({ type: 'png' }));
    }
    await page.waitForTimeout(200);
  }
  const tops = series.map((s) => s.maxY).filter((v) => v !== undefined);
  console.log('[death] surface top series', JSON.stringify(tops), 'distinct', new Set(tops).size,
    'min', Math.min(...tops), 'max', Math.max(...tops));
}
await browser.close();
killTree(chrome.pid);
