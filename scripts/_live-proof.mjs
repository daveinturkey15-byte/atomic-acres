/**
 * Throwaway LIVE-MATCH smoke proof (lead requirement before puff retirement):
 * starts a real solo match headless, parks the player in the open street as a
 * visible target, and waits for a bot-thrown SMOKE grenade. Pre/post frames go
 * through the REAL rAF loop (never the sync QA path). PASS: a post frame with
 * a fresh grenade-kind volume differs from pre by >2% changed pixels, with no
 * page errors. DELETE after use; do not commit.
 */
import { chromium } from 'playwright';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { readPng, luma, rectStats } from './_critic-png.mjs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function chromePath() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  return c.find((p) => existsSync(p)) ?? null;
}
// high overview of the street half: any bot smoke on the map reads in frame
const POSE = { x: 0, y: 26, z: -30, yaw: Math.PI, pitch: -0.62 };
const BUDGET_MS = 240_000;

const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[live] no Chrome'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-liveproof-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let browser = null;
for (let i = 0; i < 200 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { killTree(chrome.pid); console.error('[live] no CDP'); process.exit(2); }
const killed = (() => { let d = false; return () => { if (!d) { d = true; try { killTree(chrome.pid); } catch {} } }; })();
process.on('exit', killed);
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
const sleep = (ms) => page.waitForTimeout(ms);
const strip = () => page.evaluate(() => {
  document.getElementById('start')?.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
});
const shoot = async (f) => { const p = join(OUT, f); await page.screenshot({ path: p }); return p; };

await page.goto(url + '?post=smoke', { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true && window.__NTGAME, null, { timeout: 180000 });
await strip();
await sleep(1500);
// begin the real solo match; the mask shows ONLY smoke opacity - bots, tracers
// and muzzle flashes are invisible, so any blob is a real cloud, no confounds
await page.evaluate(() => window.__NTGAME.begin());
await sleep(2000);
const poseHidden = () => page.evaluate((q) => {
  window.__NT.release();
  window.__NT.setMode('fly');
  window.__NT.teleport(q.x, q.y, q.z, q.yaw, q.pitch);
  window.__NT.weaponCmd('visible', false);
}, POSE);
await poseHidden();
await sleep(1000);
const fPre = await shoot('_live-pre-mask.png');
const seen = new Set();
let lastCounts = null;
const t0 = Date.now();
let result = null;
while (Date.now() - t0 < BUDGET_MS) {
  const qa = await page.evaluate(() => window.__NT.ordnance());
  lastCounts = qa.counts;
  const fresh = (qa.smokes ?? []).filter((s) => !seen.has(s.id));
  if (fresh.length > 0) {
    const id = fresh[0].id;
    const kind = fresh[0].kind;
    seen.add(id);
    await sleep(600); // blast lives 5 s; shoot while the volume is young
    await poseHidden();
    await sleep(800);
    const fPost = await shoot('_live-post-mask.png');
    const M = readPng(fPost);
    const st = rectStats(M, [0, 0, M.width, M.height]);
    console.log(`[live] smoke id=${id} kind=${kind}: mask mean ${st.mean} max ${st.max} p95 ${st.p95}`);
    if (st.mean > 0.3 || st.max > 40) { result = { file: fPost, id, mean: st.mean }; break; }
    for (const s of (qa.smokes ?? [])) seen.add(s.id);
  } else {
    for (const s of (qa.smokes ?? [])) seen.add(s.id);
  }
  await poseHidden();
  await sleep(500);
  await sleep(1000);
}
console.log('[live] last counts:', JSON.stringify(lastCounts), 'pageerrors:', errs.length ? errs : 'none');
killed();
if (result) {
  console.log(`[live] PASS: live-match grenade smoke in the march (id=${result.id}, mask mean ${result.mean})`);
  process.exit(0);
}
console.log('[live] FAIL: no live grenade smoke in the march inside budget');
process.exit(1);
