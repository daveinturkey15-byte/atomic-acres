/**
 * Live stock-Chrome proof for the inbound host-silence watchdog.
 *
 * This consumes an already-running candidate page and signalling relay. It
 * never starts either service. Two isolated stock Chrome instances host/join
 * through the real LAN UI, start a match, and prove the WebRTC channels are
 * open before the host page's JavaScript is paused through CDP. Pausing keeps
 * the host tab alive and prevents an unload/pagehide/bye path; the guest must
 * therefore close from its own inbound watchdog.
 *
 *   node scripts/_verify-host-loss-live.mjs
 *   node scripts/_verify-host-loss-live.mjs --url http://127.0.0.1:4192/ --signal-port 4310
 *
 * The script writes captures/host-loss-live/result.json and, after the guest
 * reaches the terminal screen, captures/host-loss-live/guest-final.png.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const CANDIDATE = opt('url', 'http://127.0.0.1:4192/');
const SIGNAL_URL = opt('signal-url', 'http://127.0.0.1:' + opt('signal-port', '4310'));
const RUN_TAG = 'host-loss-live-' + Date.now();
const WATCHDOG_BOUND_MS = 9_500;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'captures', 'host-loss-live');
const RESULT_PATH = join(OUT_DIR, 'result.json');
const FINAL_SCREEN_PATH = join(OUT_DIR, 'guest-final.png');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = [];
const report = {
  candidate: CANDIDATE,
  signalUrl: SIGNAL_URL,
  lossMethod: 'CDP Debugger.pause on host page (no unload/pagehide/bye path)',
  watchdogBoundMs: WATCHDOG_BOUND_MS,
  steps: [],
  timings: {},
  preLoss: null,
  terminal: null,
  hostLifecycle: null,
  errors: {},
  resultPath: RESULT_PATH,
  finalScreenPath: FINAL_SCREEN_PATH,
};
let code = 0;

function say(line) {
  const text = '[host-loss] ' + line;
  console.log(text);
  log.push(text);
}

function step(name, ok, detail) {
  report.steps.push({ name, state: ok ? 'VERIFIED' : 'FAIL', detail });
  say((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) code = 1;
}

function cacheBusted(url) {
  const u = new URL(url);
  u.searchParams.set('qa', RUN_TAG);
  return u.href;
}

function pageErrors(peer) {
  const errors = [];
  peer.page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 300));
  });
  peer.page.on('pageerror', (error) => errors.push('PAGEERROR ' + String(error).slice(0, 300)));
  return errors;
}

async function openMultiplayer(peer, callsign, url) {
  await peer.page.goto(url, { waitUntil: 'load', timeout: 90_000 });
  await peer.page.waitForFunction(
    () => window.__NT?.ready === true && window.__AA_UI && window.__NTGAME,
    null,
    { timeout: 180_000 },
  );
  await peer.page.getByRole('button', { name: 'Multiplayer' }).click();
  await peer.page.getByLabel('Link').selectOption('lan');
  await peer.page.getByLabel('Signal server').fill(SIGNAL_URL);
  await peer.page.getByLabel('Signal server').dispatchEvent('change');
  await peer.page.getByLabel('Callsign').fill(callsign);
  await peer.page.getByLabel('Callsign').dispatchEvent('change');
}

async function roster(peer) {
  return peer.page.evaluate(() => window.__NTGAME.lobby.view().roster.map((r) => ({
    id: r.id,
    name: r.name,
    connected: r.connected,
    ready: r.ready,
    isHost: r.isHost,
  })));
}

async function mode(peer) {
  return peer.page.evaluate(() => window.__NTGAME.mode());
}

async function netLine(peer) {
  return peer.page.evaluate(() => {
    const g = window.__NTGAME;
    return g.lobby.netLine(performance.now());
  });
}

async function lobbyView(peer) {
  return peer.page.evaluate(() => window.__NTGAME.lobby.view());
}

async function activeSnapshot(peer) {
  return peer.page.evaluate(() => {
    const s = window.__NTGAME.snapshot();
    return {
      phase: s.match.phase,
      actors: s.actors.length,
      localId: window.__NTGAME.localId,
    };
  });
}

async function installHostLifecycleProbe(host) {
  await host.page.evaluate(() => {
    const marker = { beforeunload: 0, pagehide: 0, unload: 0 };
    Object.defineProperty(window, '__NT_QA_HOST_LIFECYCLE', {
      configurable: true,
      value: marker,
    });
    addEventListener('beforeunload', () => { marker.beforeunload += 1; });
    addEventListener('pagehide', () => { marker.pagehide += 1; });
    addEventListener('unload', () => { marker.unload += 1; });
  });
}

async function pauseHostWithoutUnload(host) {
  const cdp = await host.page.context().newCDPSession(host.page);
  let paused = false;
  let pausedEvent = null;
  cdp.on('Debugger.paused', (event) => {
    paused = true;
    pausedEvent = event;
  });
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.pause');
  const started = Date.now();
  while (!paused && Date.now() - started < 2_000) await sleep(25);
  if (!paused) {
    await cdp.detach().catch(() => {});
    throw new Error('CDP Debugger.pause did not produce Debugger.paused');
  }
  return { cdp, pausedEvent };
}

async function terminalState(guest) {
  return guest.page.evaluate(() => {
    const start = document.getElementById('start');
    const lobby = start?.querySelector('.aa-lobby');
    const error = start?.querySelector('.aa-error');
    const view = window.__NTGAME.lobby.view();
    let line = null;
    try { line = window.__NTGAME.netLine(performance.now()) ?? window.__NTGAME.lobby.netLine(performance.now()); } catch { /* read below */ }
    return {
      mode: window.__NTGAME.mode(),
      lobby: {
        role: view.role,
        phase: view.phase,
        error: view.error,
        roster: view.roster,
      },
      netLine: line,
      startDisplay: start ? getComputedStyle(start).display : null,
      lobbyVisible: lobby ? !lobby.classList.contains('aa-hidden') : false,
      errorText: error?.textContent?.trim() ?? '',
      text: start?.innerText?.slice(0, 2_000) ?? '',
    };
  });
}

let host = null;
let guest = null;
let hostPause = null;
const errors = { host: [], guest: [] };

try {
  host = await stockBrowser('host-loss-A');
  guest = await stockBrowser('host-loss-B');
  errors.host = pageErrors(host);
  errors.guest = pageErrors(guest);
  const url = cacheBusted(CANDIDATE);
  await Promise.all([
    openMultiplayer(host, 'host-loss-host', url),
    openMultiplayer(guest, 'host-loss-guest', url),
  ]);

  await host.page.getByRole('button', { name: 'Host a room' }).click();
  await host.page.waitForFunction(
    () => /^[0-9A-Z]{6}$/.test(document.querySelector('#start .aa-code')?.textContent ?? ''),
    null,
    { timeout: 10_000 },
  );
  const roomCode = await host.page.evaluate(() => document.querySelector('#start .aa-code')?.textContent ?? '');
  step('real Host a room UI publishes a room code', /^[0-9A-Z]{6}$/.test(roomCode), roomCode);

  await guest.page.getByLabel('Join code').fill(roomCode);
  await guest.page.getByRole('button', { name: 'Join by code' }).click();
  const joinedAt = Date.now();
  await Promise.all([
    host.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30_000 }),
    guest.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30_000 }),
  ]);
  const joinedRoster = { host: await roster(host), guest: await roster(guest) };
  report.timings.joinMs = Date.now() - joinedAt;
  step('guest joins through the real LAN/WebRTC lobby', joinedRoster.host.length === 2 && joinedRoster.guest.length === 2,
    JSON.stringify({ elapsedMs: report.timings.joinMs, host: joinedRoster.host, guest: joinedRoster.guest }));

  await host.page.getByLabel('Ready').check();
  await guest.page.getByLabel('Ready').check();
  await host.page.waitForFunction(
    () => !document.querySelector('#start .aa-lobby-room button.aa-primary')?.disabled,
    null,
    { timeout: 10_000 },
  );
  const readyRoster = await roster(host);
  step('both real peers become ready before Start', readyRoster.length === 2 && readyRoster.every((r) => r.ready), JSON.stringify(readyRoster));

  const startAt = Date.now();
  await host.page.getByRole('button', { name: 'Start match' }).click();
  await Promise.all([
    host.page.waitForFunction(() => window.__NTGAME.mode() === 'host' && document.getElementById('start').style.display === 'none', null, { timeout: 20_000 }),
    guest.page.waitForFunction(() => window.__NTGAME.mode() === 'guest' && document.getElementById('start').style.display === 'none', null, { timeout: 20_000 }),
    host.page.waitForFunction(() => window.__NTGAME.snapshot().match.phase === 'active', null, { timeout: 20_000 }),
    guest.page.waitForFunction(() => {
      try { return window.__NTGAME.snapshot().match.phase === 'active'; }
      catch (error) {
        if (String(error).includes('guest has no match line yet')) return false;
        throw error;
      }
    }, null, { timeout: 20_000 }),
  ]);
  report.timings.startMs = Date.now() - startAt;
  await Promise.all([
    host.page.waitForFunction(() => {
      try { return /lan peers 1/.test(window.__NTGAME.lobby.netLine(performance.now()) ?? ''); }
      catch { return false; }
    }, null, { timeout: 10_000 }),
    guest.page.waitForFunction(() => {
      try {
        const line = window.__NTGAME.lobby.netLine(performance.now()) ?? '';
        return /lan peers 1/.test(line) && /rtt \d+/.test(line);
      } catch { return false; }
    }, null, { timeout: 10_000 }),
  ]);
  const beforeLossLines = { host: await netLine(host), guest: await netLine(guest) };
  const beforeLossViews = { host: await lobbyView(host), guest: await lobbyView(guest) };
  const beforeLossModes = { host: await mode(host), guest: await mode(guest) };
  const beforeLossSnapshots = { host: await activeSnapshot(host), guest: await activeSnapshot(guest) };
  const realRtc = beforeLossModes.host === 'host'
    && beforeLossModes.guest === 'guest'
    && beforeLossViews.host.tier === 'lan'
    && beforeLossViews.guest.tier === 'lan'
    && beforeLossViews.host.roster.length === 2
    && beforeLossViews.guest.roster.length === 2
    && beforeLossViews.host.linkOk === true
    && beforeLossViews.guest.linkOk === true
    && /lan peers 1/.test(beforeLossLines.host ?? '')
    && /lan peers 1/.test(beforeLossLines.guest ?? '')
    && /rtt \d+/.test(beforeLossLines.guest ?? '');
  step('both peers reached active over an actual WebRTC LAN channel', realRtc,
    JSON.stringify({ modes: beforeLossModes, lines: beforeLossLines, views: beforeLossViews, snapshots: beforeLossSnapshots }));
  if (!realRtc) throw new Error('pre-loss WebRTC proof did not meet the required channel/diagnostic shape');
  report.preLoss = {
    capturedAt: new Date().toISOString(),
    elapsedFromStartMs: Date.now() - startAt,
    modes: beforeLossModes,
    lines: beforeLossLines,
    views: beforeLossViews,
    snapshots: beforeLossSnapshots,
  };

  await installHostLifecycleProbe(host);
  const pauseAt = Date.now();
  hostPause = await pauseHostWithoutUnload(host);
  report.timings.hostPauseMs = Date.now() - pauseAt;
  step('host JavaScript paused without an unload/pagehide path', host.page.isClosed() === false,
    JSON.stringify({ pageClosed: host.page.isClosed(), pauseMs: report.timings.hostPauseMs, pauseReason: hostPause.pausedEvent?.reason ?? null }));

  const lossWaitStarted = Date.now();
  let final = null;
  try {
    await guest.page.waitForFunction(() => {
      const start = document.getElementById('start');
      const lobby = start?.querySelector('.aa-lobby');
      const view = window.__NTGAME.lobby.view();
      return window.__NTGAME.mode() === 'idle'
        && view.role === 'idle'
        && view.phase === 'idle'
        && view.error === 'HOST LEFT THE ROOM'
        && getComputedStyle(start).display !== 'none'
        && lobby !== null
        && !lobby.classList.contains('aa-hidden');
    }, null, { timeout: WATCHDOG_BOUND_MS, polling: 50 });
    final = await terminalState(guest);
  } catch (error) {
    final = await terminalState(guest).catch(() => null);
    report.terminal = final;
    throw new Error(`guest watchdog did not reach host-left terminal within ${WATCHDOG_BOUND_MS} ms: ${String(error)}`);
  }
  report.timings.guestTerminalMs = Date.now() - lossWaitStarted;
  report.terminal = {
    ...final,
    capturedAt: new Date().toISOString(),
    lossWaitMs: report.timings.guestTerminalMs,
    withinTenSeconds: report.timings.guestTerminalMs < 10_000,
  };
  const terminalOk = report.timings.guestTerminalMs < 10_000
    && final.mode === 'idle'
    && final.lobby.role === 'idle'
    && final.lobby.phase === 'idle'
    && final.lobby.error === 'HOST LEFT THE ROOM'
    && final.errorText === 'HOST LEFT THE ROOM'
    && final.lobbyVisible === true
    && final.startDisplay !== 'none'
    && final.netLine === null;
  step('guest inbound watchdog reaches the host-left terminal under 10 s', terminalOk,
    JSON.stringify({ elapsedMs: report.timings.guestTerminalMs, terminal: final }));

  await sleep(300);
  const postTerminal = await terminalState(guest);
  report.terminal.postTerminal = postTerminal;
  step('guest has no continuing room/ping diagnostics after teardown', postTerminal.mode === 'idle'
    && postTerminal.lobby.role === 'idle'
    && postTerminal.netLine === null,
  JSON.stringify(postTerminal));
  mkdirSync(OUT_DIR, { recursive: true });
  await guest.page.screenshot({ path: FINAL_SCREEN_PATH, fullPage: false });

  await hostPause.cdp.send('Debugger.resume');
  await sleep(100);
  const lifecycle = await host.page.evaluate(() => ({ ...window.__NT_QA_HOST_LIFECYCLE }));
  report.hostLifecycle = { ...lifecycle, pageClosedAfterResume: host.page.isClosed() };
  step('loss was observed before any host unload/pagehide/bye lifecycle', lifecycle.beforeunload === 0
    && lifecycle.pagehide === 0 && lifecycle.unload === 0 && host.page.isClosed() === false,
  JSON.stringify(report.hostLifecycle));
} catch (error) {
  say('EXCEPTION ' + String(error).slice(0, 700));
  code = 1;
} finally {
  if (hostPause?.cdp) {
    try { await hostPause.cdp.send('Debugger.resume'); } catch { /* cleanup after an already resumed/closed page */ }
    try { await hostPause.cdp.detach(); } catch { /* owned session */ }
  }
  report.errors = { host: errors.host.slice(0, 12), guest: errors.guest.slice(0, 12) };
  if (errors.host.length || errors.guest.length) {
    step('stock Chrome host and guest stayed free of console/page errors', false, JSON.stringify(report.errors));
  } else {
    step('stock Chrome host and guest stayed free of console/page errors', true, 'host/guest error arrays empty');
  }
  try { if (guest) await guest.close(); } catch (error) { say('guest cleanup ' + String(error).slice(0, 200)); code = 1; }
  try { if (host) await host.close(); } catch (error) { say('host cleanup ' + String(error).slice(0, 200)); code = 1; }
  report.exitCode = code;
  report.finishedAt = new Date().toISOString();
  report.log = log;
  try {
    mkdirSync(dirname(RESULT_PATH), { recursive: true });
    writeFileSync(RESULT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
  } catch (error) {
    say('report persistence ' + String(error).slice(0, 240));
    code = 1;
    report.exitCode = code;
    report.log = log;
  }
  console.log(JSON.stringify(report));
}

process.exit(code);
