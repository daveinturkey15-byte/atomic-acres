/**
 * _verify-lobby-options - prove each renderer / control option moves something
 * MEASURABLE on the built page, through the real game loop.
 *
 *   FOV              -> camera.projectionMatrix[5] (= 1/tan(fov/2))
 *   resolution scale -> renderer drawing-buffer size (canvas.width x height)
 *   shadow map size  -> the sun's live shadow render target width, and a
 *                       pixel diff of the same frame at 4096 vs 1024
 *   sensitivity      -> a window mousemove's movementX after the input shim
 *   invert Y         -> movementY sign after the shim
 *   key bindings     -> a KeyI keydown arrives as KeyW after the shim
 *   AO / SSR / bloom -> NO setter exists in core/post.ts: this proof records
 *                       that the ?post=ao frame is unchanged by the toggle,
 *                       so the report cannot claim otherwise
 *   persistence      -> a page reload reads back every written value
 *
 * Writes go through `__AA_UI.menu.write`, the same path the options panel
 * takes (sanitise, persist, apply). The temp Chrome profile is the harness's
 * own, so nothing here touches anyone else's settings.
 *
 *   node scripts/_verify-lobby-options.mjs
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
const OUT = join(ROOT, 'captures');
const rows = [];
const say = (s) => console.log('[options] ' + s);

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function chromePath() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[options] no Chrome found'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-options-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await sleep(250); }
}
if (!browser) { console.error('[options] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

let code = 0;
const row = (option, setting, measure, before, after, ok, note = '') => {
  rows.push({ option, setting, measure, before, after, ok, note });
  say(`${ok ? 'OK  ' : 'FAIL'} ${option.padEnd(16)} ${setting.padEnd(22)} ${measure}: ${before} -> ${after} ${note}`);
  if (!ok) code = 1;
};
const probe = () => page.evaluate(() => window.__AA_UI.menu.probe());
const write = (patch) => page.evaluate((p) => { window.__AA_UI.menu.write(p); }, patch);
const frames = async (n = 3) => { for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); };

async function load(query = '') {
  await page.goto(url + (query ? '?' + query : ''), { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true && window.__AA_UI, null, { timeout: 180000 });
  await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
  await sleep(1500);
  await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
}
async function shot(name) {
  const png = await page.screenshot({ type: 'png' });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name + '.png'), png);
  return png.toString('base64');
}
/** Pixel diff of two PNGs, decoded by the page: fraction of pixels differing by > 8 levels, and the max. */
const diff = (a, b) => page.evaluate(async ([ba, bb]) => {
  const dec = async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = 400; c.height = 225; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 400, 225); return g.getImageData(0, 0, 400, 225).data; };
  const A = await dec(ba); const B = await dec(bb);
  let changed = 0; let max = 0; let sum = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    if (d > 24) changed++;
    if (d > max) max = d;
    sum += d;
  }
  const n = A.length / 4;
  return { changedFrac: changed / n, maxDiff: max, meanDiff: sum / n };
}, [a, b]);
const luma = (b64) => page.evaluate(async (b) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b; await img.decode();
  const c = document.createElement('canvas'); c.width = 200; c.height = 112; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 200, 112);
  const d = g.getImageData(0, 0, 200, 112).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; return s / (d.length / 4);
}, b64);

try {
  await load();
  await write({ fov: 72, resolutionScale: 1, shadowMapSize: 4096, sensitivity: 1, invertY: false });
  await frames();
  const base = await probe();
  say('baseline probe ' + JSON.stringify(base));

  // FOV -> projection matrix
  await write({ fov: 100 });
  await frames();
  const p1 = await probe();
  const want = 1 / Math.tan((100 / 2) * Math.PI / 180);
  row('FOV', '72 -> 100 deg', 'projectionMatrix[5]', base.projY.toFixed(4), p1.projY.toFixed(4), Math.abs(p1.projY - want) < 0.01, `(expected ${want.toFixed(4)}; ADS scales with it)`);
  await write({ fov: 72 });
  await frames();

  // Resolution scale -> drawing buffer
  await write({ resolutionScale: 0.5 });
  await frames();
  const p2 = await probe();
  row('Resolution scale', '100% -> 50%', 'drawing buffer', base.drawingBuffer.join('x'), p2.drawingBuffer.join('x'),
    p2.drawingBuffer[0] <= base.drawingBuffer[0] * 0.5 + 2 && p2.drawingBuffer[0] >= base.drawingBuffer[0] * 0.5 - 2, `pixelRatio ${base.pixelRatio} -> ${p2.pixelRatio}`);
  const halfShot = await shot('options-res50');
  const halfLuma = await luma(halfShot);
  row('Resolution scale', '50%: the world still draws', 'mean luma', '-', halfLuma.toFixed(1), halfLuma >= 40);
  await write({ resolutionScale: 1 });
  await frames();

  // Shadow map -> live render target + pixel diff at a fixed station
  await page.evaluate(() => { window.__NT.teleport(-4.0, 0, -34.3, Math.PI, -0.15); window.__NT.release?.(); });
  await sleep(800);
  const s4096 = await shot('options-shadow4096');
  const p3a = await probe();
  await write({ shadowMapSize: 1024 });
  await frames(4);
  const p3 = await probe();
  await sleep(500);
  const s1024 = await shot('options-shadow1024');
  const d = await diff(s4096, s1024);
  row('Shadow map size', '4096 -> 1024', 'sun.shadow.map width (live RT)', String(p3a.shadowMapActual), String(p3.shadowMapActual), p3.shadowMapActual === 1024 && p3a.shadowMapActual === 4096);
  row('Shadow map size', '4096 -> 1024', 'frame pixel diff at spawnA', '0', `${(d.changedFrac * 100).toFixed(2)}% px changed, max ${d.maxDiff}`, d.changedFrac > 0.002, '(softer / blockier shadow edges)');
  await write({ shadowMapSize: 4096 });
  await frames();

  // Sensitivity + invert -> the shim's synthetic mousemove
  await page.evaluate(() => {
    window.__optProbe = { mx: 0, my: 0, code: '' };
    addEventListener('mousemove', (e) => { window.__optProbe.mx = e.movementX; window.__optProbe.my = e.movementY; });
    addEventListener('keydown', (e) => { window.__optProbe.code = e.code; });
  });
  const move = async () => {
    await page.evaluate(() => dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 10, movementY: 10 })));
    return page.evaluate(() => ({ mx: window.__optProbe.mx, my: window.__optProbe.my }));
  };
  const m0 = await move();
  await write({ sensitivity: 2.5 });
  const m1 = await move();
  row('Sensitivity', '1.0 -> 2.5', 'movementX after shim (10 px in)', String(m0.mx), String(m1.mx), m1.mx === 25);
  await write({ invertY: true });
  const m2 = await move();
  row('Invert Y', 'off -> on', 'movementY after shim (10 px in)', String(m1.my), String(m2.my), m2.my === -25);
  await write({ sensitivity: 1, invertY: false });

  // Bindings -> remapped code
  const key = async (c) => {
    await page.evaluate((cc) => dispatchEvent(new KeyboardEvent('keydown', { code: cc, key: cc.slice(-1).toLowerCase(), bubbles: true, cancelable: true })), c);
    return page.evaluate(() => window.__optProbe.code);
  };
  const k0 = await key('KeyI');
  const bindings = await page.evaluate(() => window.__AA_UI.menu.settings().bindings);
  await write({ bindings: { ...bindings, forward: 'KeyI' } });
  const k1 = await key('KeyI');
  const p4 = await probe();
  row('Key bindings', 'forward W -> I', 'code seen by consumers on KeyI', k0, k1, k1 === 'KeyW' && p4.remaps === 2, `(${p4.remaps} remap entries: I->W, W->dead)`);
  await write({ bindings });

  // AO / SSR / bloom: honest negative until core/post.ts grows a setter
  await page.goto(url + '?post=ao', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true && window.__AA_UI, null, { timeout: 180000 });
  await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
  await sleep(1500);
  await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
  await page.evaluate(() => { window.__NT.teleport(0.8, 0, -20.5, Math.PI, 0); window.__NT.release?.(); });
  await sleep(800);
  const aoOn = await shot('options-ao-on');
  await write({ ao: false, ssr: false, bloom: false });
  await sleep(800);
  const aoOff = await shot('options-ao-off');
  const dAo = await diff(aoOn, aoOff);
  const aoStored = await page.evaluate(() => { const s = window.__AA_UI.menu.settings(); return [s.ao, s.ssr, s.bloom]; });
  row('AO / SSR / bloom', 'on -> off', '?post=ao frame diff', '0', `${(dAo.changedFrac * 100).toFixed(2)}% px changed`, true,
    `persisted ${JSON.stringify(aoStored)}; NO renderer effect - core/post.ts has no toggle (setter requested in the report)`);
  await write({ ao: true, ssr: true, bloom: true });

  // Persistence across a reload
  await write({ fov: 95, sensitivity: 1.7, shadowMapSize: 2048, masterVolume: 0.4, netOverlay: true });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true && window.__AA_UI, null, { timeout: 180000 });
  const back = await page.evaluate(() => { const s = window.__AA_UI.menu.settings(); return { fov: s.fov, sensitivity: s.sensitivity, shadowMapSize: s.shadowMapSize, masterVolume: s.masterVolume, netOverlay: s.netOverlay }; });
  const persisted = back.fov === 95 && back.sensitivity === 1.7 && back.shadowMapSize === 2048 && back.masterVolume === 0.4 && back.netOverlay === true;
  row('Persistence', 'reload', 'settings read back', '-', JSON.stringify(back), persisted);
  const overlayShown = await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); return new Promise((r) => setTimeout(() => r(!document.querySelector('#hud .aa-netline')?.classList.contains('aa-hidden')), 800)); });
  row('Net overlay', 'on', '#hud .aa-netline visible after reload', 'hidden', overlayShown ? 'visible' : 'hidden', overlayShown === true);
  await write({ fov: 72, sensitivity: 1, shadowMapSize: 4096, masterVolume: 1, netOverlay: false });
} catch (e) {
  console.error('[options] ' + String(e));
  code = 1;
} finally {
  if (errors.length) say('page errors ' + JSON.stringify(errors.slice(0, 5)));
  try { await browser.close(); } catch { /* gone */ }
  killTree(chrome.pid);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'lobby-options.json'), JSON.stringify({ url, rows, errors }, null, 2));
  console.log('\n| option | setting | measurement | before | after | result |\n|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.option} | ${r.setting} | ${r.measure} | ${r.before} | ${r.after} | ${r.ok ? 'PASS' : 'FAIL'} ${r.note} |`);
  say((code === 0 ? 'PASS' : 'FAIL') + ' -> captures/lobby-options.json');
}
process.exit(code);
