/**
 * _verify-net-two-browsers - the lobby lane's netcode proof on the BUILT page,
 * across TWO real Chrome instances (distinct profiles, distinct CDP ports), so
 * nothing in it can ride BroadcastChannel: the room goes over WebRTC data
 * channels signalled by scripts/net-signal.mjs - the LAN tier, proven on one
 * machine.
 *
 * What it drives, through the real menus (not the classes):
 *   A: Multiplayer -> link "Network" -> Host a room -> reads the code off the DOM
 *   B: Multiplayer -> link "Network" -> Join by code
 *   both rosters show two seats; both tick Ready; A presses Start
 *   B walks (scripted KeyW on the window, exactly what the keyboard sends)
 *   A's host room believes B's position; the lag is measured two ways
 *   A teleports in front of B and fires the REAL weapon (__NT.weaponCmd)
 *   B's HUD health drops, B's feed shows the kill
 *   RTT / snapshot rate read off the diagnostics line on both sides
 *   120 s from Start without a disconnect, sampled every 10 s
 *
 *   node scripts/_verify-net-two-browsers.mjs [--seconds 120] [--signal-port 4310]
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
const SIGNAL_PORT = Number(opt('signal-port', '4310'));
const SIGNAL_URL = 'http://127.0.0.1:' + SIGNAL_PORT;
const log = [];
const say = (s) => { const line = '[net2] ' + s; console.log(line); log.push(line); };

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

// Same launch block as scripts/playcap.mjs (real Chrome over CDP: playwright's
// chromium has no WebGPU adapter), plus two WebRTC flags so two headless
// instances on one box can reach each other: raw host IPs instead of mDNS
// names, and loopback allowed as a candidate.
async function launch(tag) {
  const exe = chromePath();
  if (!exe) throw new Error('no Chrome found');
  const cdpPort = await freePort();
  const child = spawnGuarded(exe, [
    '--headless=new', '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + join(tmpdir(), 'aa-net2-' + tag + '-' + cdpPort),
    '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--allow-loopback-in-peer-connection',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--window-position=2560,0', '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let browser = null;
  for (let i = 0; i < 160 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
    catch { await sleep(250); }
  }
  if (!browser) { killTree(child.pid); throw new Error('Chrome ' + tag + ' never accepted CDP'); }
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  return { child, browser, page, errors, tag };
}

async function signalUp() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(SIGNAL_URL + '/health', { signal: AbortSignal.timeout(800) });
      if (r.ok) return true;
    } catch { /* not yet */ }
    await sleep(250);
  }
  return false;
}

const { url } = await usePreview();
const signal = spawnGuarded(process.execPath, [join(ROOT, 'scripts', 'net-signal.mjs'), '--port', String(SIGNAL_PORT)], { stdio: 'ignore', windowsHide: true });
if (!await signalUp()) { killTree(signal.pid); console.error('[net2] signal relay never came up'); process.exit(2); }
say('signal relay up at ' + SIGNAL_URL);

const A = await launch('A');
const B = await launch('B');
let code = 0;
const report = { url, signalUrl: SIGNAL_URL, seconds: SECONDS, steps: [], samples: [], errors: {} };
const step = (name, ok, detail) => { report.steps.push({ name, ok, detail }); say((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) code = 1; };

async function openMultiplayer(P, callsign) {
  await P.page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await P.page.waitForFunction(() => window.__NT && window.__NT.ready === true && window.__AA_UI && window.__NTGAME, null, { timeout: 180000 });
  await P.page.getByRole('button', { name: 'Multiplayer' }).click();
  await P.page.getByLabel('Link').selectOption('lan');
  await P.page.getByLabel('Signal server').fill(SIGNAL_URL);
  await P.page.getByLabel('Signal server').dispatchEvent('change');
  await P.page.getByLabel('Callsign').fill(callsign);
  await P.page.getByLabel('Callsign').dispatchEvent('change');
}
const rosterNames = (P) => P.page.evaluate(() => Array.from(document.querySelectorAll('#start .aa-seat:not(.aa-empty) .aa-seat-name')).map((n) => n.textContent));
const mode = (P) => P.page.evaluate(() => window.__NTGAME.mode());
const netLine = (P) => P.page.evaluate(() => { const g = window.__NTGAME; return g.netLine(performance.now()) ?? g.lobby.netLine(performance.now()); });
const roster = (P) => P.page.evaluate(() => window.__NTGAME.lobby.view().roster.map((r) => ({ id: r.id, name: r.name, connected: r.connected, ready: r.ready })));

try {
  await Promise.all([openMultiplayer(A, 'alpha'), openMultiplayer(B, 'bravo')]);
  await A.page.getByRole('button', { name: 'Host a room' }).click();
  await A.page.waitForFunction(() => /^[0-9A-Z]{6}$/.test(document.querySelector('#start .aa-code')?.textContent ?? ''), null, { timeout: 10000 });
  const roomCode = await A.page.evaluate(() => document.querySelector('#start .aa-code').textContent);
  step('A hosts a room, code on screen', /^[0-9A-Z]{6}$/.test(roomCode), roomCode);

  await B.page.getByLabel('Join code').fill(roomCode);
  await B.page.getByRole('button', { name: 'Join by code' }).click();
  const t0 = Date.now();
  await Promise.all([
    A.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30000 }),
    B.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30000 }),
  ]);
  const ra = await rosterNames(A);
  const rb = await rosterNames(B);
  step('B joins by code over WebRTC; both rosters show two players', ra.length === 2 && rb.length === 2, `join took ${Date.now() - t0} ms; A sees ${JSON.stringify(ra)}; B sees ${JSON.stringify(rb)}`);

  await A.page.getByLabel('Ready').check();
  await B.page.getByLabel('Ready').check();
  await A.page.waitForFunction(() => !document.querySelector('#start .aa-lobby-room button.aa-primary')?.disabled, null, { timeout: 10000 });
  const readyA = await roster(A);
  step('both ready, Start enabled on the host', readyA.every((r) => r.ready), JSON.stringify(readyA));
  const tStart = Date.now();
  await A.page.getByRole('button', { name: 'Start match' }).click();
  await Promise.all([
    A.page.waitForFunction(() => window.__NTGAME.mode() === 'host' && document.getElementById('start').style.display === 'none', null, { timeout: 15000 }),
    B.page.waitForFunction(() => window.__NTGAME.mode() === 'guest' && document.getElementById('start').style.display === 'none', null, { timeout: 15000 }),
  ]);
  step('host starts; both pages leave the menu (A host, B guest)', true, `A=${await mode(A)} B=${await mode(B)} after ${Date.now() - tStart} ms`);
  await sleep(4500); // warmup is 3 s; let both HUDs settle and the guest spawn land

  const bId = await B.page.evaluate(() => window.__NTGAME.localId);
  const hostSeesB = (p, id) => p.evaluate((i) => window.__NTGAME.lobby.hostRoom().poseOf(i), id);
  // ---- B walks: hold W for 3 s ---------------------------------------------
  const before = await B.page.evaluate(() => window.__NT.probePos());
  await B.page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })));
  const walk = [];
  const walkT0 = Date.now();
  while (Date.now() - walkT0 < 3000) {
    const own = await B.page.evaluate(() => window.__NT.probePos());
    const seen = await hostSeesB(A.page, bId);
    walk.push({ t: Date.now() - walkT0, own: [own[0], own[2]], seen: seen ? [seen.x, seen.z] : null });
    await sleep(100);
  }
  await B.page.evaluate(() => dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })));
  const stopT = Date.now();
  await sleep(120);
  const after = await B.page.evaluate(() => window.__NT.probePos());
  // Settle: poll A until its belief of B stops moving, then compare with B's own.
  let settled = null;
  let lastSeen = null;
  for (let i = 0; i < 40; i++) {
    const seen = await hostSeesB(A.page, bId);
    if (lastSeen && seen && Math.hypot(seen.x - lastSeen.x, seen.z - lastSeen.z) < 0.01) { settled = seen; break; }
    lastSeen = seen;
    await sleep(25);
  }
  const settleMs = Date.now() - stopT;
  const walked = Math.hypot(after[0] - before[0], after[2] - before[2]);
  const finalGap = settled ? Math.hypot(settled.x - after[0], settled.z - after[2]) : NaN;
  const midGaps = walk.filter((w) => w.seen && w.t > 600).map((w) => Math.hypot(w.seen[0] - w.own[0], w.seen[1] - w.own[1]));
  const midGapMed = midGaps.length ? midGaps.sort((a, b) => a - b)[Math.floor(midGaps.length / 2)] : NaN;
  const lagMs = (midGapMed / 4.8) * 1000; // walk speed 4.8 m/s
  step('B walked and the host tracked it', walked > 5, `B moved ${walked.toFixed(2)} m in 3 s`);
  step('host belief of B within 200 ms (mid-walk gap / walk speed)', lagMs <= 200, `median mid-walk gap ${midGapMed.toFixed(2)} m = ${lagMs.toFixed(0)} ms`);
  step('host pose settles on B\'s stop position', finalGap < 0.5 && settleMs <= 400, `settled ${settleMs} ms after keyup, ${finalGap.toFixed(2)} m from B's own position`);
  report.walk = walk;

  // ---- A shoots B ----------------------------------------------------------
  const bPos = await B.page.evaluate(() => window.__NT.probePos());
  const spot = await A.page.evaluate(([bx, bz]) => {
    const g = window.__NTGAME;
    const tries = [[0, 5], [5, 0], [0, -5], [-5, 0], [3.5, 3.5], [-3.5, 3.5], [3.5, -3.5], [-3.5, -3.5], [0, 8], [8, 0], [0, -8], [-8, 0]];
    for (const [dx, dz] of tries) {
      const ax = bx + dx;
      const az = bz + dz;
      if (window.__NT.collidersAt(ax, az, 1.0).length > 0) continue;
      if (!g.los(ax, 1.5, az, bx, 1.5, bz)) continue;
      return { ax, az };
    }
    return null;
  }, [bPos[0], bPos[2]]);
  step('a clear firing position beside B exists', spot !== null, spot ? `A at (${spot.ax.toFixed(1)}, ${spot.az.toFixed(1)})` : 'none of 12 offsets had LOS');
  const hpBefore = await B.page.evaluate(() => document.querySelector('#hud .hud-hp-label')?.textContent ?? '');
  const killsBefore = await A.page.evaluate(() => window.__NTGAME.counters().kills);
  if (spot) {
    await A.page.evaluate(([ax, az, bx, bz]) => {
      const yaw = Math.atan2(-(bx - ax), -(bz - az));
      const dist = Math.hypot(bx - ax, bz - az);
      const pitch = Math.atan2(0.95 - 1.68, dist);
      window.__NT.teleport(ax, 0, az, yaw, pitch);
    }, [spot.ax, spot.az, bPos[0], bPos[2]]);
    await sleep(400);
    let fired = 0;
    let hits = 0;
    for (let i = 0; i < 24; i++) {
      const ok = await A.page.evaluate(() => window.__NT.weaponCmd('fire'));
      if (ok) fired++;
      await sleep(140);
      const hp = await B.page.evaluate(() => document.querySelector('#hud .hud-hp-label')?.textContent ?? '');
      if (hp !== hpBefore) hits++;
      const kills = await A.page.evaluate(() => window.__NTGAME.counters().kills);
      if (kills > killsBefore) break;
    }
    await sleep(600);
    const hpAfter = await B.page.evaluate(() => document.querySelector('#hud .hud-hp-label')?.textContent ?? '');
    const bFeed = await B.page.evaluate(() => Array.from(document.querySelectorAll('#hud .hud-killfeed .hud-feed-row:not(.hud-feed-hidden)')).map((n) => n.textContent));
    const aFeed = await A.page.evaluate(() => Array.from(document.querySelectorAll('#hud .hud-killfeed .hud-feed-row:not(.hud-feed-hidden)')).map((n) => n.textContent));
    const killsAfter = await A.page.evaluate(() => window.__NTGAME.counters().kills);
    const bTaken = await B.page.evaluate(() => Array.from(document.querySelectorAll('#hud .hud-feed-taken .hud-feed-row:not(.hud-feed-hidden)')).map((n) => n.textContent));
    step('A fired the real weapon at B', fired > 0, `${fired} trigger pulls, B HUD health ${hpBefore} -> ${hpAfter} (changed on ${hits} polls)`);
    step('B\'s HUD showed the damage', hpAfter !== hpBefore || bTaken.length > 0, `hp label ${hpBefore} -> ${hpAfter}; damage-taken feed ${JSON.stringify(bTaken.slice(0, 3))}`);
    const killLine = bFeed.find((l) => /ALPHA|alpha/i.test(l) && /YOU|BRAVO/i.test(l)) ?? aFeed.find((l) => /BRAVO/i.test(l));
    step('the feed shows the kill', killsAfter > killsBefore && killLine !== undefined, `host kills ${killsBefore} -> ${killsAfter}; B feed ${JSON.stringify(bFeed.slice(0, 4))}; A feed ${JSON.stringify(aFeed.slice(0, 4))}`);
  }

  // ---- diagnostics + 120 s hold --------------------------------------------
  const first = { a: await netLine(A), b: await netLine(B) };
  say('diag A: ' + first.a);
  say('diag B: ' + first.b);
  const rttOk = /rtt (\d+)/.test(first.b ?? '') && /snap ([\d.]+) Hz/.test(first.b ?? '');
  step('RTT and snapshot rate read from the diagnostics', rttOk, first.b ?? 'no line');
  let disconnects = 0;
  while (Date.now() - tStart < SECONDS * 1000) {
    await sleep(10000);
    const s = {
      t: Math.round((Date.now() - tStart) / 1000),
      a: await netLine(A), b: await netLine(B),
      modeA: await mode(A), modeB: await mode(B),
      rosterA: await roster(A), rosterB: await roster(B),
    };
    report.samples.push(s);
    const conn = s.rosterA.every((r) => r.connected) && s.rosterB.every((r) => r.connected) && s.modeA === 'host' && s.modeB === 'guest';
    if (!conn) disconnects++;
    say(`t=${String(s.t).padStart(3)}s ${conn ? 'connected' : 'DISCONNECT'} | A ${s.a} | B ${s.b}`);
  }
  step(`${SECONDS} s from Start without a disconnect`, disconnects === 0, `${report.samples.length} samples, ${disconnects} bad`);
} catch (e) {
  say('EXCEPTION ' + String(e).slice(0, 400));
  code = 1;
} finally {
  report.errors = { A: A.errors.slice(0, 8), B: B.errors.slice(0, 8) };
  if (A.errors.length || B.errors.length) say('console errors A=' + JSON.stringify(A.errors.slice(0, 4)) + ' B=' + JSON.stringify(B.errors.slice(0, 4)));
  try { await A.browser.close(); } catch { /* gone */ }
  try { await B.browser.close(); } catch { /* gone */ }
  killTree(A.child.pid);
  killTree(B.child.pid);
  killTree(signal.pid);
  mkdirSync(join(ROOT, 'captures'), { recursive: true });
  report.log = log;
  writeFileSync(join(ROOT, 'captures', 'net-two-browsers.json'), JSON.stringify(report, null, 2));
  say((code === 0 ? 'PASS' : 'FAIL') + ' -> captures/net-two-browsers.json');
}
process.exit(code);
