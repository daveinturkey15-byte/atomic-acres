/**
 * _verify-lobby-screens - open every menu state on the built page and
 * photograph it, at 1600x900 and 1280x720, through real Chrome over CDP.
 *
 * States: main, solo setup, multiplayer (idle and hosting a tabs room),
 * options (each tab), credits, pause, pause->options, end of match, and the
 * return to the main menu after Leave. The end screen comes from a REAL
 * match: FFA, seven veteran bots, ten-kill limit, polled until the host says
 * `ended` (budget 4 min) - a screen nobody could reach in play is not a
 * state. Every frame's mean luma is checked so a black or blank capture
 * cannot pass as a screenshot.
 *
 *   node scripts/_verify-lobby-screens.mjs [--no-end]
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
const argv = process.argv.slice(2);
const WANT_END = !argv.includes('--no-end');
const say = (s) => console.log('[screens] ' + s);

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
if (!exe) { console.error('[screens] no Chrome found'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-screens-' + cdpPort),
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
if (!browser) { console.error('[screens] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

const shots = [];
let code = 0;
mkdirSync(OUT, { recursive: true });

async function capture(name, expect) {
  await sleep(350);
  const png = await page.screenshot({ type: 'png' });
  const file = join(OUT, 'menu-' + name + '.png');
  writeFileSync(file, png);
  const luma = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = 200; c.height = 112; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 200, 112);
    const d = g.getImageData(0, 0, 200, 112).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; return s / (d.length / 4);
  }, png.toString('base64'));
  const st = await page.evaluate(() => { const m = window.__AA_UI.menu; return { surface: m.state().surface, panel: m.panel(), visible: document.getElementById('start').style.display !== 'none' }; });
  // innerText carries CSS text-transform (the headings are uppercase), so compare case-blind.
  const textOk = expect ? await page.evaluate((t) => document.getElementById('start').innerText.toLowerCase().includes(t.toLowerCase()), expect) : true;
  const ok = luma > 6 && st.visible && textOk;
  shots.push({ name, file, luma: +luma.toFixed(1), ...st, expect, ok });
  say(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(22)} surface=${st.surface.padEnd(12)} panel=${st.panel.padEnd(11)} luma ${luma.toFixed(1)}${expect ? (textOk ? '  text "' + expect + '"' : '  MISSING "' + expect + '"') : ''}  -> ${file}`);
  if (!ok) code = 1;
}
const open = (p) => page.evaluate((pp) => window.__AA_UI.menu.open(pp), p);
const click = (name) => page.getByRole('button', { name, exact: true }).first().click();

async function load(w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true && window.__AA_UI && window.__NTGAME, null, { timeout: 180000 });
  await sleep(600);
}

try {
  // ---- 1600x900: every pre-match panel -------------------------------------
  await load(1600, 900);
  await capture('main', 'ATOMIC ACRES');
  await open('solo');
  await capture('solo-setup', 'Solo vs bots');
  await open('multiplayer');
  await capture('multiplayer', 'Multiplayer');
  await click('Host a room');
  await page.waitForFunction(() => /^[0-9A-Z]{6}$/.test(document.querySelector('#start .aa-code')?.textContent ?? ''), null, { timeout: 10000 });
  await capture('multiplayer-hosting', 'open seat');
  await click('Match rules');
  await capture('multiplayer-rules', 'Match rules');
  await click('Back to lobby');
  await click('Leave');
  await open('options');
  await capture('options-graphics', 'Quality preset');
  for (const [tab, name, text] of [['Controls', 'options-controls', 'Key bindings'], ['Audio', 'options-audio', 'Master volume'], ['Accessibility', 'options-access', 'Reduced motion']]) {
    await page.getByRole('tab', { name: tab }).click();
    await capture(name, text);
  }
  await open('credits');
  await capture('credits', 'Kimodo');

  // ---- into a match, pause, pause -> options ---------------------------------
  await open('solo');
  await click('Deploy');
  await page.waitForFunction(() => window.__NTGAME.mode() === 'solo' && document.getElementById('start').style.display === 'none', null, { timeout: 10000 });
  await sleep(2500);
  await page.evaluate(() => window.__AA_UI.menu.pause());
  await capture('pause', 'Paused');
  await click('Options');
  await capture('pause-options', 'Options');
  await page.keyboard.press('Escape');
  await sleep(200);
  await click('Resume');
  await page.waitForFunction(() => document.getElementById('start').style.display === 'none', null, { timeout: 5000 });
  say('resumed; menu hidden, mode=' + await page.evaluate(() => window.__NTGAME.mode()));

  // ---- end of match: a real one, fast rules ----------------------------------
  if (WANT_END) {
    await page.evaluate(() => window.__AA_UI.menu.pause());
    await click('Leave match');
    await page.waitForFunction(() => window.__NTGAME.mode() === 'idle', null, { timeout: 5000 });
    // Deploy re-applies the panel's persisted setup, so the fast rules go in
    // through the panel's own storage key and a reload, exactly as a player's
    // saved choices would.
    await page.evaluate(() => { localStorage.setItem('atomic-acres-solo-setup', JSON.stringify({ mode: 'ffa', bots: 7, difficulty: 'veteran', scoreLimit: 10, durationMs: 120000, respawnMs: 1000 })); });
    await load(1600, 900);
    await open('solo');
    const rules = await page.evaluate(() => window.__NTGAME.setup());
    say('end-match rules from the panel store: ' + JSON.stringify(rules));
    await click('Deploy');
    await page.waitForFunction(() => window.__NTGAME.mode() === 'solo', null, { timeout: 10000 });
    const t0 = Date.now();
    let ended = false;
    while (Date.now() - t0 < 240000) {
      ended = await page.evaluate(() => window.__NTGAME.ended());
      if (ended) break;
      await sleep(1000);
    }
    if (ended) {
      await page.waitForFunction(() => window.__AA_UI.menu.state().surface === 'match-over', null, { timeout: 5000 });
      await capture('end-of-match', 'Rematch');
      const snap = await page.evaluate(() => { const s = window.__NTGAME.snapshot(); return { phase: s.match.phase, winner: s.match.winner, winnerId: s.match.winnerId, reason: s.match.endReason, rows: s.match.scores.length }; });
      say('end screen from a real match: ' + JSON.stringify(snap) + ' after ' + Math.round((Date.now() - t0) / 1000) + ' s');
      await click('Leave');
      await page.waitForFunction(() => window.__AA_UI.menu.state().surface === 'pre-match', null, { timeout: 5000 });
      await capture('main-after-leave', 'ATOMIC ACRES');
    } else {
      say('FAIL end of match never arrived inside 240 s (FFA, 7 veteran bots, 10 kills)');
      code = 1;
    }
  }

  // ---- 1280x720: the three densest panels --------------------------------------
  await load(1280, 720);
  await capture('720-main', 'ATOMIC ACRES');
  await open('solo');
  await capture('720-solo-setup', 'Solo vs bots');
  await open('options');
  await page.getByRole('tab', { name: 'Controls' }).click();
  await capture('720-options-controls', 'Key bindings');
  await open('multiplayer');
  await capture('720-multiplayer', 'Multiplayer');
  // Keyboard reachability: arrow keys walk the controls of the visible view.
  await open('main');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
  say('keyboard: two ArrowDown from the main menu focuses "' + focused + '"');
  if (!focused) code = 1;
} catch (e) {
  console.error('[screens] ' + String(e));
  code = 1;
} finally {
  if (errors.length) say('page errors ' + JSON.stringify(errors.slice(0, 5)));
  try { await browser.close(); } catch { /* gone */ }
  killTree(chrome.pid);
  writeFileSync(join(OUT, 'menu-screens.json'), JSON.stringify({ url, shots, errors }, null, 2));
  say(`${shots.filter((s) => s.ok).length}/${shots.length} screens captured -> captures/menu-screens.json`);
}
process.exit(code);
