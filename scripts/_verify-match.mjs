/**
 * _verify-match - the played-match proof, headless, on the BUILT bundle.
 *
 * IMPORT-PLAN s5.7: "the gate for src/game/ is a played match". This drives the
 * real page the way a player does (load, click #start, let the game's own frame
 * loop run) and reads the host's OWN snapshot through the QA hook every 15 s.
 * It never instantiates a game module itself - a proof that builds the modules
 * is not evidence that the shipped bundle runs a match.
 *
 *   node scripts/_verify-match.mjs                 # 120 s, 15 s samples
 *   node scripts/_verify-match.mjs --seconds 60 --every 15 --tag before
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
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = Number(opt('seconds', '120'));
const EVERY = Number(opt('every', '15'));
const TAG = opt('tag', 'run');

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
if (!exe) { console.error('[verify-match] no Chrome found'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-verifymatch-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1280,720', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('[verify-match] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 240)));

let code = 0;
try {
  console.log('[verify-match] ' + url + '  ' + SECONDS + 's, every ' + EVERY + 's');
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });

  const hasGame = await page.evaluate(() => typeof window.__NTGAME === 'object' && window.__NTGAME !== null);
  if (!hasGame) throw new Error('window.__NTGAME missing - the QA hook is not wired');

  await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });

  const rows = [];
  const t0 = Date.now();
  for (let t = EVERY; t <= SECONDS; t += EVERY) {
    while (Date.now() - t0 < t * 1000) await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const g = window.__NTGAME;
      const c = g.counters();
      const s = g.snapshot();
      const reasons = {};
      for (const ln of g.log()) {
        const m = /streak-denied .* (\S+)$/.exec(ln);
        if (m) reasons[m[1]] = (reasons[m[1]] || 0) + 1;
      }
      return {
        counters: c,
        phase: s.match.phase,
        teamScores: s.match.teamScores,
        stats: s.stats,
        actors: s.actors.map((a) => a.id + ':' + a.kills + '/' + a.deaths + (a.alive ? '' : '*')),
        reasons,
        logLines: g.log().length,
      };
    });
    r.t = t;
    rows.push(r);
    console.log('  t=' + String(t).padStart(3) + 's phase=' + r.phase.padEnd(7)
      + ' kills=' + String(r.counters.kills).padStart(3)
      + ' deaths=' + String(r.counters.deaths).padStart(3)
      + ' spawns=' + String(r.counters.spawns).padStart(3)
      + ' earned=' + String(r.counters.streakEarned).padStart(3)
      + ' activated=' + String(r.counters.streakActivated).padStart(3)
      + ' denied=' + String(r.counters.streakDenied).padStart(5)
      + ' presses=' + String(r.counters.streakPresses ?? 0).padStart(5)
      + ' shots=' + String(r.counters.shots ?? 0).padStart(4)
      + ' rejects=' + String(r.counters.shotRejects).padStart(3));
  }

  const last = rows[rows.length - 1];
  console.log('\n| t (s) | phase | kills | deaths | spawns | streak earned | activated | denied |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log('| ' + r.t + ' | ' + r.phase + ' | ' + r.counters.kills + ' | ' + r.counters.deaths
      + ' | ' + r.counters.spawns + ' | ' + r.counters.streakEarned + ' | ' + r.counters.streakActivated
      + ' | ' + r.counters.streakDenied + ' |');
  }
  console.log('\nscoreboard: ' + last.actors.join('  '));
  console.log('teamScores: ' + JSON.stringify(last.teamScores) + '   hostStats: ' + JSON.stringify(last.stats));
  console.log('denial reasons (from the bounded log): ' + JSON.stringify(last.reasons));
  console.log('counters: ' + JSON.stringify(last.counters));
  if (errors.length) console.log('page errors: ' + JSON.stringify(errors.slice(0, 6)));

  mkdirSync(join(ROOT, 'captures'), { recursive: true });
  writeFileSync(join(ROOT, 'captures', 'verify-match-' + TAG + '.json'),
    JSON.stringify({ tag: TAG, seconds: SECONDS, rows, errors }, null, 2));
} catch (e) {
  console.error('[verify-match] ' + String(e));
  code = 1;
} finally {
  try { await browser.close(); } catch { /* already gone */ }
  killTree(chrome.pid);
}
process.exit(code);
