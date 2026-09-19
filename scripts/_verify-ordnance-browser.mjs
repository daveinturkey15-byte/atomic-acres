/**
 * _verify-ordnance-browser - the ordnance lane's PLAYED proof, on the BUILT
 * bundle, through the game's own frame loop (HANDOFF s2 item 2: the capture
 * path is not the player's path).
 *
 * A 120 s default match in which the human is SCRIPTED through the same QA
 * surface a person's keys reach (`__NT.weaponCmd`): from open ground a frag, a
 * flashbang and a smoke are each armed and released, the knife is swung at an
 * enemy and at a team-mate, and E is held at a foreign drop. The client
 * projection's own event log (`__NT.ordnance().lines`) is printed in full at
 * the end, and the run FAILS unless:
 *   - each grenade type was thrown and detonated (grenade-thrown /
 *     grenade-detonated with that id),
 *   - a `smoke-volume` of kind `grenade` and at least two of kind `blast` were
 *     announced on the bus (THE SMOKE CONTRACT, live),
 *   - a `melee` event was authored by the human,
 *   - a swap came back when one was attempted at a foreign drop in range,
 *   - the match is still running (kills happening) and the page threw nothing.
 *
 *   node scripts/_verify-ordnance-browser.mjs                 # 120 s
 *   node scripts/_verify-ordnance-browser.mjs --seconds 90 --tag before
 *
 * Every step records the host clock, phase, fps and the hand's state, so a
 * step that did nothing says why (dead, warmup, hand busy, teleport unsettled)
 * instead of leaving a gap to guess at. Machine courtesy: real Chrome over CDP
 * (playwright's chromium has no WebGPU), the shared preview on :4188,
 * spawnGuarded/killTree, windowsHide, the second monitor. One browser.
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
if (!exe) { console.error('[verify-ordnance-browser] no Chrome found'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-ordbrowser-' + cdpPort),
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
if (!browser) { console.error('[verify-ordnance-browser] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 240)));

/** The human's row off the host snapshot, plus the host clock, phase, fps and the hand. */
const selfRow = () => page.evaluate(() => {
  const s = window.__NTGAME.snapshot();
  const a = s.actors.find((x) => x.id === 'you');
  return {
    hostAt: Math.round(s.at), phase: s.match.phase, perfNow: Math.round(performance.now()),
    fps: window.__NT.stats().fps, hand: window.__NT.weaponCmd('ordnance'),
    me: a ? { alive: a.alive, lethal: a.lethal, tactical: a.tactical, armed: a.armed, primaryId: a.primaryId, team: a.team } : null,
  };
});

/**
 * Wait until the match is active and the human is alive and has been for a
 * moment. Bots knife and frag the human; a claim authored while down is
 * refused `shooter-dead` by the shared admission - correctly - and would read
 * here as a failed throw.
 */
async function whenAlive(maxMs = 8000) {
  const t = Date.now();
  while (Date.now() - t < maxMs) {
    const r = await selfRow();
    if (r.me && r.me.alive && r.phase === 'active') {
      await page.waitForTimeout(350);
      const again = await selfRow();
      if (again.me && again.me.alive) return again;
    }
    await page.waitForTimeout(150);
  }
  return null;
}

/** Wait for the off hand to be idle (a previous throw or stab still playing out). */
async function whenHandIdle(maxMs = 3000) {
  const t = Date.now();
  while (Date.now() - t < maxMs) {
    const h = await page.evaluate(() => window.__NT.weaponCmd('ordnance'));
    if (h && h.hand === 'idle') return true;
    await page.waitForTimeout(100);
  }
  return false;
}

/**
 * A scripted teleport is not a walk: the host's pose track only learns the
 * new place on its next tick, and a claim stamped before that rewinds to the
 * old one and is refused `bad-origin` (2.25 m). A real player never jumps
 * 30 m in a frame; the script waits out a few host ticks instead.
 */
async function settleAfterTeleport(ms = 350) {
  await page.waitForTimeout(ms);
}

/** The open street by the circle, looking east and a little up: a lob lands on tarmac, not on the wall in front of the upstairs spawn. */
const OPEN = { x: -6.0, z: 0.0, yaw: -Math.PI / 2, pitch: 0.2 };

/**
 * Wait until the human is alive AND holds a charge for this grenade. A life
 * carries ONE lethal and ONE tactical (`ordnance.ts:LETHAL_PER_LIFE`), and
 * flash and smoke share the tactical pouch - so a smoke after a flash waits
 * for the next life or the next pouch, exactly as a player would.
 */
async function whenSupplied(id, maxMs = 45000) {
  const t = Date.now();
  let last = null;
  while (Date.now() - t < maxMs) {
    last = await whenAlive(4000);
    if (last && last.me && (id === 'frag' ? last.me.lethal : last.me.tactical) >= 1) return { ok: true, row: last, waitedMs: Date.now() - t };
    await page.waitForTimeout(400);
  }
  return { ok: false, row: last, waitedMs: Date.now() - t };
}

/** From open ground: arm, wait for the hand, release; the two claims a throw is. */
async function throwGrenade(id) {
  const sup = await whenSupplied(id);
  const me = sup.row;
  await page.evaluate((o) => window.__NT.teleport(o.x, 0, o.z, o.yaw, o.pitch), OPEN);
  await settleAfterTeleport();
  const idle = await whenHandIdle();
  const a = await page.evaluate((g) => window.__NT.weaponCmd('grenade', g), id);
  await page.waitForTimeout(450);
  const b = await page.evaluate(() => window.__NT.weaponCmd('grenade'));
  const after = await selfRow();
  return {
    supplied: sup.ok, waitedMs: sup.waitedMs, before: me && me.me, idle, calls: [a, b],
    hostAt: after.hostAt, perfNow: after.perfNow, phase: after.phase, fps: after.fps, hand: after.hand,
  };
}

/**
 * Stand 1.4 m from a live bot, facing it (yaw 0 looks along -z), and swing.
 * An ENEMY inside 2 m knifes on its next tick, so the human usually loses
 * that race (the first run: dead before its own swing landed); a TEAM-MATE
 * does not fight back, the swing still lands, is logged, and does no damage.
 */
async function knifeBot(enemy) {
  const me = await whenAlive();
  const placed = await page.evaluate((wantEnemy) => {
    const s = window.__NTGAME.snapshot();
    const you = s.actors.find((a) => a.id === 'you');
    const teams = new Map(s.actors.map((a) => [a.id, a.team]));
    const bots = window.__NTGAME.bots().filter((b) => b.alive && (wantEnemy ? teams.get(b.id) !== you.team : teams.get(b.id) === you.team));
    if (bots.length === 0) return null;
    const b = bots[0];
    window.__NT.teleport(b.x, 0, b.z + 1.4, 0, -0.35);
    return { bot: b.id, at: [+b.x.toFixed(1), +(b.z + 1.4).toFixed(1)] };
  }, enemy);
  if (placed === null) return { ok: false, why: enemy ? 'no live enemy bot' : 'no live team-mate bot' };
  await settleAfterTeleport(enemy ? 130 : 350);
  const ok = await page.evaluate(() => window.__NT.weaponCmd('knife'));
  await page.waitForTimeout(600);
  const after = await selfRow();
  return { ok, ...placed, before: me && me.me, hostAt: after.hostAt, aliveAfter: after.me && after.me.alive, hand: after.hand };
}

/** Wait for a drop that is not our gun, stand 1.6 m from it (swap range, past scavenge range), settle, hold E. */
async function swapAtDrop(maxWaitMs = 30000) {
  const me = await whenAlive();
  const primary = me && me.me ? me.me.primaryId : 'longhorn';
  const t = Date.now();
  let placed = null;
  while (placed === null && Date.now() - t < maxWaitMs) {
    placed = await page.evaluate((p) => {
      const o = window.__NT.ordnance();
      const d = (o.drops || []).find((v) => v.weaponId !== p) ?? null;
      if (d === null) return null;
      window.__NT.teleport(d.x + 1.6, 0, d.z, Math.PI / 2, -0.4);
      return { drop: d.id, weaponId: d.weaponId, rounds: d.rounds };
    }, primary);
    if (placed === null) await page.waitForTimeout(500);
  }
  if (placed === null) return { ok: false, why: 'no foreign drop appeared in ' + maxWaitMs + ' ms' };
  await settleAfterTeleport();
  const ok = await page.evaluate(() => window.__NT.weaponCmd('use'));
  await page.waitForTimeout(900);
  const after = await selfRow();
  return { ok, ...placed, primaryBefore: primary, after: after.me };
}

let code = 0;
const script = [];
try {
  console.log('[verify-ordnance-browser] ' + url + '  ' + SECONDS + 's');
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  const hasHook = await page.evaluate(() => typeof window.__NT.ordnance === 'function' && typeof window.__NTGAME === 'object');
  if (!hasHook) throw new Error('__NT.ordnance / __NTGAME missing - the wiring is not in this build');
  await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
  await page.waitForTimeout(500);

  const t0 = Date.now();
  const start = await selfRow();
  console.log('  after click: host at=' + start.hostAt + ' phase=' + start.phase + ' perf=' + start.perfNow + ' fps=' + start.fps);
  const at = async (sec, fn, label) => {
    while (Date.now() - t0 < sec * 1000) await page.waitForTimeout(200);
    const began = Date.now() - t0;
    const r = await fn();
    script.push({ t: sec, beganMs: began, label, r });
    console.log('  t=' + String(sec).padStart(3) + 's (+' + (began / 1000).toFixed(1) + 's) ' + label + ' -> ' + JSON.stringify(r));
  };
  // Warmup is 3 s; every step waits for the human to be alive and the match active.
  await at(6, () => throwGrenade('frag'), 'throw frag');
  await at(14, () => throwGrenade('flash'), 'throw flash');
  await at(22, () => throwGrenade('smoke'), 'throw smoke');
  await at(30, () => knifeBot(true), 'knife an enemy bot');
  await at(34, () => knifeBot(false), 'knife a team-mate bot (swing must log; no damage)');
  await at(40, swapAtDrop, 'hold E at a foreign drop (swap)');
  await at(Math.min(SECONDS - 20, 75), () => throwGrenade('frag'), 'throw frag again (refused unless replenished)');

  while (Date.now() - t0 < SECONDS * 1000) await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const g = window.__NTGAME;
    const o = window.__NT.ordnance();
    const s = g.snapshot();
    return { ordnance: o, counters: g.counters(), phase: s.match.phase, stats: s.stats, hostOrdnance: s.ordnance ?? null };
  });

  const lines = r.ordnance.lines;
  const has = (re) => lines.filter((l) => re.test(l)).length;
  const thrown = { frag: has(/grenade-thrown you frag/), flash: has(/grenade-thrown you flash/), smoke: has(/grenade-thrown you smoke/) };
  const det = { frag: has(/grenade-detonated you frag/), flash: has(/grenade-detonated you flash/), smoke: has(/grenade-detonated you smoke/) };
  const smokeGrenade = has(/smoke-volume id=\d+ grenade/);
  const smokeBlast = has(/smoke-volume id=\d+ blast/);
  const melee = has(/^\d+ melee you /);
  const swaps = has(/^\d+ pickup you swap /);
  const kills = r.counters.kills;
  const swapTried = script.some((s) => s.label.startsWith('hold E') && s.r && s.r.ok === true);

  console.log('\n---- event log (client projection, ' + lines.length + ' lines) ----');
  for (const l of lines) console.log('  ' + l);
  console.log('---- end of log ----\n');
  console.log('thrown ' + JSON.stringify(thrown) + '  detonated ' + JSON.stringify(det)
    + '  smoke volumes: grenade=' + smokeGrenade + ' blast=' + smokeBlast + '  melee by you: ' + melee
    + '  swaps by you: ' + swaps + (swapTried ? '' : ' (no foreign drop was in reach to try)'));
  console.log('match: phase=' + r.phase + ' kills=' + kills + ' counters=' + JSON.stringify(r.counters));
  console.log('ordnance counts: ' + JSON.stringify(r.ordnance.counts) + '  self: ' + JSON.stringify(r.ordnance.self));
  console.log('host ordnance: ' + JSON.stringify(r.hostOrdnance));
  if (errors.length) console.log('page errors: ' + JSON.stringify(errors.slice(0, 8)));

  const fails = [];
  for (const id of ['frag', 'flash', 'smoke']) {
    if (thrown[id] < 1) fails.push('the human never threw a ' + id);
    if (det[id] < 1) fails.push('no ' + id + ' detonation reached the client');
  }
  if (smokeGrenade < 1) fails.push('no smoke-volume of kind grenade was announced');
  if (smokeBlast < 2) fails.push('fewer than two blast smoke volumes were announced (' + smokeBlast + ')');
  if (melee < 1) fails.push('the human never swung the knife');
  if (swapTried && swaps < 1) fails.push('a swap was attempted at a foreign drop in range and no pickup swap came back');
  if (kills < 1) fails.push('no kills in ' + SECONDS + ' s - the match is not running');
  if (errors.some((e) => e.startsWith('PAGEERROR'))) fails.push('the page threw: ' + errors.find((e) => e.startsWith('PAGEERROR')));

  mkdirSync(join(ROOT, 'captures'), { recursive: true });
  writeFileSync(join(ROOT, 'captures', 'verify-ordnance-browser-' + TAG + '.json'),
    JSON.stringify({ tag: TAG, seconds: SECONDS, script, fails, result: r, errors }, null, 2));
  if (fails.length) {
    console.log('[verify-ordnance-browser] REFUTED:\n  - ' + fails.join('\n  - '));
    code = 1;
  } else {
    console.log('[verify-ordnance-browser] HOLDS: three grenade types thrown and detonated, smoke announced, knife swung, match live');
  }
} catch (e) {
  console.error('[verify-ordnance-browser] ' + String(e));
  code = 1;
} finally {
  try { await browser.close(); } catch { /* already gone */ }
  killTree(chrome.pid);
}
process.exit(code);
