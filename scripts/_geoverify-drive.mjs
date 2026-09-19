/**
 * ADVERSARIAL VERIFIER DRIVER (untracked harness, gitignore-convention same as
 * scripts/_critic-*.mjs). Boots the SHARED preview (:4188) and one real Chrome over
 * CDP exactly as scripts/playcap.mjs does - playwright's chromium has no WebGPU
 * adapter - then evaluates a payload file in the page and writes its JSON result.
 *
 *   node scripts/_geoverify-drive.mjs --js scripts/_gv-p1.mjs --out captures/geoverify/p1.json
 *
 * The payload is the BODY of an async function; it returns a JSON-serialisable value.
 * If the returned object has `shots: [{name,x,y,z,yaw,pitch,mode}]`, each is
 * teleported to and photographed into captures/geoverify/<name>.png through the
 * game's OWN frame loop (never __NT.render(), never goto()).
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures', 'geoverify');

const argv = process.argv.slice(2);
const opt = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const jsFile = opt('js');
const outFile = opt('out', join(OUT, 'result.json'));
if (!jsFile) { console.error('need --js'); process.exit(2); }
const payload = readFileSync(join(ROOT, jsFile), 'utf8');

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

const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[gv] no Chrome'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-geoverify-' + cdpPort),
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
if (!browser) { console.error('[gv] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 400)));

console.log('[gv] ' + url + '  payload ' + jsFile);
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 240000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1500);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

let result;
try {
  result = await page.evaluate(new Function('return (async () => {' + payload + '})()'));
} catch (e) {
  console.error('[gv] payload threw: ' + String(e).slice(0, 2000));
  await browser.close(); killTree(chrome.pid); process.exit(3);
}

mkdirSync(OUT, { recursive: true });
if (result && Array.isArray(result.shots)) {
  for (const s of result.shots) {
    await page.evaluate((q) => {
      window.__NT.setMode(q.mode || 'fly');
      window.__NT.teleport(q.x, q.y, q.z, q.yaw, q.pitch || 0);
      if (window.__NT.release) window.__NT.release();
    }, s);
    await page.waitForTimeout(s.wait || 900);
    const shot = await page.screenshot({ type: 'png' });
    writeFileSync(join(OUT, s.name + '.png'), shot);
    console.log('  shot ' + s.name + ' -> captures/geoverify/' + s.name + '.png');
  }
}

writeFileSync(outFile, JSON.stringify({ url, errors, result }, null, 1));
console.log('[gv] wrote ' + outFile + (errors.length ? ('  (' + errors.length + ' console errors)') : ''));
if (errors.length) console.log('  ' + errors.slice(0, 6).join('\n  '));
await browser.close();
killTree(chrome.pid);
process.exit(0);
