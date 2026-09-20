/**
 * capture-mortar-two-peer — blast-mortar proof over a REAL WebRTC pair.
 *
 * Host earns 8 admitted kills against a staged idle guest (real teleports +
 * real weaponCmd fire through host admission), then presses the ledger-derived
 * slot through the real session press. Host warning precedes any impact;
 * guest (+240s skewed clock) sees the same warning/impact/expiry localized.
 *
 * Owns two stock Chromes; cleans both on ANY error. Consumes an already-run
 * candidate + signal relay; starts neither.
 *
 * GUARD-0108 repair (source only, no gameplay/count changes):
 * - budget gate is HARD (was WARN): >1200 draws / >900k tris fails.
 * - dust expiry is HARD (was note): !cleanDust fails; HOLDS prints only when
 *   disc retired AND dust expired on the host.
 * - ANY console error fails (was PAGEERROR-only).
 * - closeA assigned immediately after first stockBrowser, before second launch.
 * - OVERALL 240s bounds EVERY wait (goto/ready/starts included) via cap();
 *   owned hard deadline closes both browsers (no global/process kill);
 *   catch writes failure JSON for ALL early errors.
 * - backend checked on BOTH peers + enabled post via actual current source:
 *   src/core/renderer.ts actualBackend (isWebGPUBackend probe) exposed as
 *   window.__NT_BACKEND.actual; src/core/world.ts exposes window.__NTPOST
 *   (src/core/post.ts: enabled + backend 'webgpu'|'off'|'webgl2').
 * - exact artifacts preserved: host-ring/guest-ring/host-detonation/
 *   host-cleanup PNGs + TAG-json. No host-state/debug grants injected.
 *
 *   node scripts/capture-mortar-two-peer.mjs --url http://127.0.0.1:4199/ --dist dist --signal-port 4310 --tag k4199
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'captures');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const BASE_URL = opt('url', 'http://127.0.0.1:4199/');
const TAG = opt('tag', 'mortar-two-peer');
const DIST = resolve(opt('dist', join(ROOT, 'dist')));
const SIGNAL_URL = opt('signal-url', 'http://127.0.0.1:' + opt('signal-port', '4310'));
const EXPECT_JS_SHA = opt('expect-js-sha', null);

const OVERALL_MS = 240_000;
const EARN_MS = 150_000;
const CALL_BUDGET = 1200;
const TRI_BUDGET = 900_000;
const EARN_KILLS = 8;
const MORTAR_ID = 'blast-mortar';
const SKEW_MS = 240_000;
/** Open street anchor: guest staging + host mortar disc (anchors on shooter origin). */
const OPEN = { x: -6.0, z: 0.0, yaw: -Math.PI / 2, pitch: -1.15 };

const T0 = Date.now();
const deadline = T0 + OVERALL_MS;
const left = () => deadline - Date.now();
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const errors = [];
const commands = [];
const note = (kind, args, result) => {
  if (commands.length < 500) commands.push({ t: +((Date.now() - T0) / 1000).toFixed(1), kind, args, result });
};
const fail = (m) => { fails.push(m); console.log('  FAIL: ' + m); };
const out = (n) => join(OUT, TAG + '-' + n);

/** Hoisted for catch-block failure JSON on ANY early error. */
let servedShas = null;
let servedJsPath = null;
let setupReadback = null;
let hostId = null;
let guestId = null;
let jsonWrote = false;
const writeJsonOnce = (obj) => {
  if (jsonWrote) return;
  jsonWrote = true;
  try { mkdirSync(OUT, { recursive: true }); } catch { /* OUT best-effort */ }
  writeFileSync(out('json'), JSON.stringify(obj, null, 2));
};

/** OVERALL 240s bounds every wait: throw before starting work that cannot fit. */
const need = (ms, label) => {
  if (left() < ms) throw new Error('overall 240s budget exhausted before ' + label + ' (' + Math.round(left()) + 'ms left)');
};
/** Cap any explicit playwright timeout so it can never overrun the owned deadline. */
const cap = (want, margin = 6000) => Math.max(1000, Math.min(want, left() - margin));
/** Race an owned async start against the remaining budget (rejects, never kills). */
const withDeadline = (promise, label) => Promise.race([
  promise,
  sleep(Math.max(1000, left() - 3000)).then(() => { throw new Error('overall 240s hard deadline exceeded during ' + label); }),
]);

let closeA = async () => {};
let closeB = async () => {};
/** Owned hard deadline: closes both browsers, no global/process kill. Pending waits reject on close. */
let hardExpired = false;
const hardTimer = setTimeout(async () => {
  hardExpired = true;
  fail('overall 240s hard deadline exceeded - closing owned browsers');
  try { await closeA(); } catch { /* owned close best-effort */ }
  try { await closeB(); } catch { /* owned close best-effort */ }
}, OVERALL_MS);
if (typeof hardTimer.unref === 'function') hardTimer.unref();

function cacheBusted(url) {
  const u = new URL(url);
  u.searchParams.set('qa', TAG + '-' + Date.now());
  return u.href;
}

async function installClockSkew(page) {
  await page.addInitScript(({ offset }) => {
    const nativeNow = performance.now.bind(performance);
    const nativeOrigin = performance.timeOrigin;
    const originalRaf = window.requestAnimationFrame;
    const nativeRaf = originalRaf.bind(window);
    const marker = { offset, installed: false, rafWrapped: false, timeOriginShifted: false, rafTimestamp: null };
    Object.defineProperty(window, '__NT_QA_CLOCK', { configurable: true, value: marker });
    try {
      Object.defineProperty(performance, 'now', { configurable: true, value: () => nativeNow() + offset });
      Object.defineProperty(performance, 'timeOrigin', { configurable: true, value: nativeOrigin - offset });
      marker.timeOriginShifted = performance.timeOrigin === nativeOrigin - offset;
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true, writable: true,
        value: (cb) => nativeRaf((ts) => { marker.rafTimestamp = ts + offset; cb(ts + offset); }),
      });
      marker.rafWrapped = window.requestAnimationFrame !== originalRaf;
      marker.installed = performance.now() - nativeNow() > offset - 10
        && marker.timeOriginShifted && marker.rafWrapped;
    } catch { marker.installed = false; }
    marker.installed = marker.installed;
    marker.rafWrapped = marker.rafWrapped;
    marker.timeOriginShifted = marker.timeOriginShifted;
  }, { offset: SKEW_MS });
}

async function openMultiplayer(peer, callsign, url) {
  need(20_000, 'openMultiplayer(' + callsign + ')');
  await peer.page.goto(url, { waitUntil: 'load', timeout: cap(90_000) });
  await peer.page.waitForFunction(
    () => window.__NT?.ready === true && window.__AA_UI && window.__NTGAME,
    null, { timeout: cap(180_000) });
  await peer.page.getByRole('button', { name: 'Multiplayer' }).click();
  await peer.page.getByLabel('Link').selectOption('lan');
  await peer.page.getByLabel('Signal server').fill(SIGNAL_URL);
  await peer.page.getByLabel('Signal server').dispatchEvent('change');
  await peer.page.getByLabel('Callsign').fill(callsign);
  await peer.page.getByLabel('Callsign').dispatchEvent('change');
}

async function waitUntil(fn, timeoutMs, intervalMs = 100) {
  const t = Date.now();
  let last = null;
  while (Date.now() - t < Math.min(timeoutMs, Math.max(1000, left() - 4000)) && left() > 5000 && !hardExpired) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

try {
  mkdirSync(OUT, { recursive: true });

  // ---- identity: served bytes == local dist (JS and CSS), ./assets normalized ----
  need(15_000, 'served==local identity');
  const servedHtml = await withDeadline((await fetch(BASE_URL)).text(), 'served identity fetch');
  const refs = [...servedHtml.matchAll(/(?:src|href)="(?:\.\/)?(\/?assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1].replace(/^\//, ''));
  if (!refs.length) fail('served HTML names no assets/*.js|css - cannot prove served==local');
  servedShas = { 'index.html': sha(Buffer.from(servedHtml, 'utf8')) };
  for (const r of refs) {
    need(10_000, 'fetch served asset ' + r);
    servedShas[r] = sha(Buffer.from(await (await fetch(new URL(r, BASE_URL))).arrayBuffer()));
  }
  servedJsPath = refs.find((r) => r.endsWith('.js')) ?? null;
  for (const [r, h] of Object.entries(servedShas)) {
    let local;
    try { local = sha(readFileSync(join(DIST, r))); } catch { fail('local dist missing served asset: ' + r); continue; }
    if (local !== h) fail('served!=local: ' + r + ' (stale server photograph refused)');
  }
  if (EXPECT_JS_SHA && servedJsPath) {
    if (servedShas[servedJsPath] !== EXPECT_JS_SHA) fail('served JS sha != pinned --expect-js-sha (' + servedJsPath + ')');
    else console.log('  served JS ' + servedJsPath + ' sha matches pinned candidate');
  }

  // GUARD-0108: assign closeA immediately after the FIRST launch, before the
  // second launch can throw — partial second-launch failure cannot leak Chrome 1.
  need(30_000, 'stockBrowser host');
  const A = await withDeadline(stockBrowser('mortar-2p-host'), 'stockBrowser host');
  closeA = A.close;
  need(30_000, 'stockBrowser guest');
  let B;
  try {
    B = await withDeadline(stockBrowser('mortar-2p-guest-skewed'), 'stockBrowser guest');
  } catch (e) {
    throw new Error('guest stockBrowser failed after host owned (host will close): ' + String((e && e.message) || e));
  }
  closeB = B.close;
  for (const p of [A, B]) {
    p.page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
    p.page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 240)));
  }
  await installClockSkew(B.page);
  const url = cacheBusted(BASE_URL);
  await withDeadline(Promise.all([openMultiplayer(A, 'host-earn', url), openMultiplayer(B, 'guest-idle', url)]), 'openMultiplayer both peers');

  // ---- real WebGPU on BOTH peers (the player path, not the fallback) ----
  // Actual current source: renderer.ts actualBackend() probes isWebGPUBackend and
  // publishes window.__NT_BACKEND.actual; world.ts publishes window.__NTPOST
  // (post.ts: enabled + backend 'webgpu'|'off'|'webgl2').
  need(15_000, 'backend probe both peers');
  const gpuA = await A.page.evaluate(() => typeof navigator.gpu !== 'undefined');
  const gpuB = await B.page.evaluate(() => typeof navigator.gpu !== 'undefined');
  const backend = await A.page.evaluate(() => ({
    renderer: window.__NT_BACKEND?.actual ?? null,
    post: window.__NTPOST?.backend ?? null,
    postEnabled: window.__NTPOST?.enabled ?? null,
  }));
  const backendGuest = await B.page.evaluate(() => ({
    renderer: window.__NT_BACKEND?.actual ?? null,
    post: window.__NTPOST?.backend ?? null,
    postEnabled: window.__NTPOST?.enabled ?? null,
  }));
  console.log('[mortar-2p] ' + BASE_URL + ' tag=' + TAG + ' signal=' + SIGNAL_URL + ' gpuApi=' + gpuA + '/' + gpuB + ' backend=' + JSON.stringify(backend) + ' guest=' + JSON.stringify(backendGuest));
  if (!gpuA) fail('no navigator.gpu API on host - fallback path refused');
  if (!gpuB) fail('no navigator.gpu API on guest - fallback path refused');
  if (backend.renderer !== 'webgpu' || backend.post !== 'webgpu' || backend.postEnabled !== true) {
    fail('host is not the actual WebGPU renderer+enabled-post (got ' + JSON.stringify(backend) + ') - fallback refused');
  }
  if (backendGuest.renderer !== 'webgpu' || backendGuest.post !== 'webgpu' || backendGuest.postEnabled !== true) {
    fail('guest is not the actual WebGPU renderer+enabled-post (got ' + JSON.stringify(backendGuest) + ') - fallback refused');
  }

  // ---- room: host a 1v1, guest joins over WebRTC ----
  need(15_000, 'host room');
  await A.page.getByRole('button', { name: 'Host a room' }).click();
  await A.page.waitForFunction(() => /^[0-9A-Z]{6}$/.test(document.querySelector('#start .aa-code')?.textContent ?? ''), null, { timeout: cap(10_000) });
  const roomCode = await A.page.evaluate(() => document.querySelector('#start .aa-code')?.textContent ?? '');
  if (!/^[0-9A-Z]{6}$/.test(roomCode)) throw new Error('host room code never appeared: ' + roomCode);
  note('room', { code: roomCode }, 'hosted');
  await B.page.getByLabel('Join code').fill(roomCode);
  await B.page.getByRole('button', { name: 'Join by code' }).click();
  need(35_000, 'guest join seats');
  await Promise.all([
    A.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: cap(30_000) }),
    B.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: cap(30_000) }),
  ]);
  note('room', { seats: 2 }, 'guest joined over WebRTC');

  // ---- rules: no kill cap, long clock, so 8 kills never end the match ----
  setupReadback = await A.page.evaluate(() => window.__NTGAME.configure({ mode: 'tdm', scoreLimit: null, durationMs: 900000 }));
  note('configure', setupReadback, 'host rules (read back)');
  if (setupReadback.scoreLimit !== null) fail('misconfigured session: scoreLimit must be null, got ' + JSON.stringify(setupReadback));

  await A.page.getByLabel('Ready').check();
  await B.page.getByLabel('Ready').check();
  need(15_000, 'lobby ready');
  await A.page.waitForFunction(() => !document.querySelector('#start .aa-lobby-room button.aa-primary')?.disabled, null, { timeout: cap(10_000) });
  const startAt = Date.now();
  await A.page.getByRole('button', { name: 'Start match' }).click();
  need(25_000, 'match start');
  await Promise.all([
    A.page.waitForFunction(() => window.__NTGAME.mode() === 'host' && document.getElementById('start').style.display === 'none', null, { timeout: cap(20_000) }),
    B.page.waitForFunction(() => window.__NTGAME.mode() === 'guest' && document.getElementById('start').style.display === 'none', null, { timeout: cap(20_000) }),
  ]);
  hostId = await A.page.evaluate(() => window.__NTGAME.localId);
  guestId = await B.page.evaluate(() => window.__NTGAME.localId);
  note('start', { hostId, guestId, ms: Date.now() - startAt }, 'host+guest live');
  need(25_000, 'match active');
  await Promise.all([
    A.page.waitForFunction(() => { try { return window.__NTGAME.snapshot().match.phase === 'active'; } catch { return false; } }, null, { timeout: cap(20_000) }),
    B.page.waitForFunction(() => { try { return window.__NTGAME.snapshot().match.phase === 'active'; } catch { return false; } }, null, { timeout: cap(20_000) }),
  ]);
  await sleep(500);

  const skewMarker = await B.page.evaluate(() => window.__NT_QA_CLOCK ?? null);
  if (skewMarker?.installed !== true) fail('guest +240s clock not installed: ' + JSON.stringify(skewMarker));
  else note('clock', { offset: skewMarker.offset }, 'guest skewed domain live');

  const hostObserve = () => A.page.evaluate((hid) => {
    const g = window.__NTGAME;
    const s = g.snapshot();
    const you = s.actors.find((a) => a.id === hid) ?? null;
    return {
      phase: s.match.phase, endsAt: s.match.endsAt,
      you: you && { id: you.id, team: you.team, hp: you.hp, alive: you.alive, kills: you.kills, deaths: you.deaths, slots: you.slots ?? null },
      actors: s.actors.map((a) => ({ id: a.id, team: a.team, alive: a.alive, kills: a.kills, deaths: a.deaths })),
      counters: g.counters(),
      logTail: g.log().slice(-40),
    };
  }, hostId);
  const guestAliveNow = () => B.page.evaluate(() => {
    const g = window.__NTGAME;
    try {
      const s = g.snapshot();
      const me = s.actors.find((a) => a.id === g.localId);
      return me && me.alive && s.match.phase === 'active' ? { id: me.id, team: me.team } : null;
    } catch { return null; }
  });
  const mortarOf = (peer) => peer.page.evaluate(() => window.__NT.ordnance().mortar);
  const earnedLine = (s) => s.logTail.filter((l) => l.includes('streak-earned ' + hostId + ' ' + MORTAR_ID));

  // opposite teams or the ladder never advances (friendly fire is off)
  const teams0 = await hostObserve();
  const guestTeam0 = (await B.page.evaluate(() => {
    try { const g = window.__NTGAME; const s = g.snapshot(); return s.actors.find((a) => a.id === g.localId)?.team ?? null; }
    catch { return null; }
  }));
  if (teams0.you && guestTeam0 !== null && teams0.you.team === guestTeam0) {
    fail('host and guest share a team (' + teams0.you.team + ') - admitted kills cannot advance the ladder');
  }

  // ---- EARN: 8 admitted host kills over the idle staged guest ----
  const eye = await A.page.evaluate(() => window.__NT.stats().eyeHeight);
  const earnT = Date.now();
  let kills = 0;
  for (let k = 0; k < EARN_KILLS && Date.now() - earnT < EARN_MS && left() > 80_000; k++) {
    const alive = await waitUntil(guestAliveNow, 12_000, 200);
    if (!alive) { fail('earn kill ' + (k + 1) + ': guest never respawned alive'); break; }
    // stage the idle guest on the open anchor (harmless QA staging, stated in JSON)
    const gst = await B.page.evaluate(([gx, gz]) => {
      const g = window.__NTGAME;
      const gy = g.groundY(gx, gz);
      window.__NT.teleport(gx, gy, gz, 0, 0);
      return { x: gx, gy, z: gz };
    }, [OPEN.x, OPEN.z]);
    note('teleport', { who: 'guest', x: gst.x, z: gst.z }, 'staged-idle');
    await sleep(500);
    const gpos = await B.page.evaluate(() => window.__NT.probePos());
    const spot = await A.page.evaluate(([bx, bz]) => {
      const g = window.__NTGAME;
      const tries = [[0, 5], [5, 0], [0, -5], [-5, 0], [3.5, 3.5], [-3.5, 3.5], [3.5, -3.5], [-3.5, -3.5], [0, 8], [8, 0], [0, -8], [-8, 0]];
      for (const [dx, dz] of tries) {
        const ax = bx + dx, az = bz + dz;
        if (window.__NT.collidersAt(ax, az, 1.0).length > 0) continue;
        if (!g.los(ax, 1.5, az, bx, 1.5, bz)) continue;
        return { ax, az };
      }
      return null;
    }, [gpos[0], gpos[2]]);
    if (!spot) { fail('earn kill ' + (k + 1) + ': no clear firing position beside guest'); break; }
    const pre = await hostObserve();
    await A.page.evaluate(([sx, sz, bx, by, bz, e]) => {
      const g = window.__NTGAME;
      const gy = g.groundY(sx, sz);
      const dx = bx - sx, dz = bz - sz;
      const dist = Math.hypot(dx, dz) || 1;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2((by + 0.9) - (gy + e), dist);
      window.__NT.teleport(sx, gy, sz, yaw, pitch);
    }, [spot.ax, spot.az, gpos[0], gpos[1], gpos[2], eye]);
    note('teleport', { who: 'host', x: +spot.ax.toFixed(1), z: +spot.az.toFixed(1), to: 'guest' }, 'staged-aim');
    await sleep(400);
    const killsBefore = (await hostObserve()).you?.kills ?? 0;
    let dead = false;
    for (let p = 0; p < 28 && left() > 70_000; p++) {
      const r = await A.page.evaluate(() => {
        const q = window.__NT;
        const st = q.weaponCmd('state');
        if (st.reloading) return { why: 'reloading' };
        if (st.cool > 0) return { why: 'cool' };
        if (st.mag <= 0) { if (st.reserve > 0) { q.weaponCmd('reload'); return { why: 'reload' }; } return { why: 'dry-no-reserve' }; }
        return { why: 'pull', fired: !!q.weaponCmd('fire') };
      });
      note('fire', { kill: k + 1 }, r.why + ':' + (r.fired ?? ''));
      await sleep(r.why === 'pull' ? 150 : 250);
      const chkHost = await hostObserve();
      if (!chkHost.you?.alive) { fail('host died mid-earn at kill ' + (k + 1) + ' - ladder reset, proof invalid'); break; }
      const gAlive = await guestAliveNow();
      if ((chkHost.you?.kills ?? 0) > killsBefore || !gAlive) { dead = true; break; }
    }
    const post = await hostObserve();
    if ((post.you?.kills ?? 0) > killsBefore && (post.you?.deaths ?? 0) === (pre.you?.deaths ?? 0)) {
      kills++;
      console.log('  earn ' + kills + '/' + EARN_KILLS + ': host kills=' + post.you.kills + ' deaths=' + post.you.deaths);
    } else {
      fail('earn kill ' + (k + 1) + ' not admitted (kills ' + killsBefore + '->' + post.you?.kills + ', host alive=' + post.you?.alive + ')');
      break;
    }
    if (!dead) note('earn', { kill: k + 1 }, 'kill counted but guest projection lagged; continuing on ledger');
  }
  const endS = await hostObserve();
  const earnLines = earnedLine(endS);
  const slotRow = (endS.you?.slots ?? []).find((s) => s.streakId === MORTAR_ID && s.charges >= 1) ?? null;
  const slot = slotRow ? slotRow.slot : 4;
  console.log('  earn: host kills=' + endS.you?.kills + ' deaths=' + endS.you?.deaths + ' ledger=' + JSON.stringify(earnLines) + ' slot=' + slot);
  if (earnLines.length < 1 || !slotRow) {
    fail('BLOCKED: no ' + MORTAR_ID + ' charge in the host ledger after ' + kills + ' admitted kills (slots=' + JSON.stringify(endS.you?.slots) + ')');
    writeJsonOnce({
      tag: TAG, url: BASE_URL, dist: DIST, servedShas, servedJsPath,
      outcome: 'refuted', admission: true, fixture: setupReadback,
      earnKillsHost: endS.you?.kills, hostDeaths: endS.you?.deaths, admittedKills: kills,
      ledgerEarn: earnLines, slots: endS.you?.slots ?? null,
      counters: endS.counters, logTail: endS.logTail, errors: errors.slice(0, 8),
      stagedTeleport: 'guest staged idle on open anchor; host staged to firing spots (QA-only)',
      audioClaim: 'none (no capture attempted)', fails,
    });
    throw new Error('earn infeasible; exact blocked step recorded (no charge earned, nothing pressed)');
  }

  // ---- STAGE + PRESS through the real host session API (Digit6 path = slot 4) ----
  if (!endS.you?.alive) fail('host dead at press time - wait for redeploy and re-run');
  const gy = await A.page.evaluate(([x, z]) => window.__NTGAME.groundY(x, z), [OPEN.x, OPEN.z]);
  await A.page.evaluate((t) => window.__NT.teleport(t.x, t.gy, t.z, t.yaw, t.pitch),
    { x: OPEN.x, z: OPEN.z, gy, yaw: OPEN.yaw, pitch: OPEN.pitch });
  note('teleport', { who: 'host', x: OPEN.x, z: OPEN.z }, 'QA staging: frame own disc (anchors on shooter origin)');
  await sleep(500);
  const beforeDeaths = (await hostObserve()).you?.deaths ?? 0;
  const beforeMortar = await mortarOf(A);
  await A.page.evaluate((s) => window.__NTGAME.pressStreak(s), slot);
  note('pressStreak', { slot, key: slot === 4 ? 'Digit6' : 'Digit?' }, 'real-session press');
  let pressLog = null;
  for (let i = 0; i < 20 && left() > 55_000; i++) {
    const s = await hostObserve();
    const act = s.logTail.filter((l) => l.includes('streak-activated ' + hostId + ' '));
    const denied = s.logTail.filter((l) => l.includes('streak-denied ' + hostId + ' slot' + slot));
    if (act.length) { pressLog = { activated: act, denied }; break; }
    if (denied.length) { pressLog = { activated: act, denied }; break; }
    await sleep(150);
  }
  const activatedLine = (pressLog?.activated ?? []).find((l) => l.includes(MORTAR_ID));
  const wrongStreak = (pressLog?.activated ?? []).filter((l) => !l.includes(MORTAR_ID));
  if (wrongStreak.length) fail('slot ' + slot + ' activated a DIFFERENT streak (loadout drift): ' + wrongStreak.join(' | '));
  if (!activatedLine) fail('no streak-activated ledger line for ' + MORTAR_ID + ' after a real press'
    + (pressLog?.denied.length ? ' (denied: ' + pressLog.denied.join(' | ') + ')' : ' (silence)'));
  else console.log('  press: ' + activatedLine);

  // ---- RING: host warning disc BEFORE any impact; guest sees it skewed ----
  let tele = null;
  for (let i = 0; i < 30 && left() > 45_000; i++) {
    const m = await mortarOf(A);
    if (m.telegraphs.length >= 1) { tele = m; break; }
    await sleep(100);
  }
  const budgetGate = async (peer, label) => {
    const m = await measureFrame(peer.page);
    if (!sceneWasMeasured(m)) fail('MEASURED NOTHING at ' + label + ': ' + JSON.stringify(m));
    else console.log('  frame ' + label + ': calls=' + m.calls + ' tris=' + m.triangles + ' programs=' + m.programs);
    // GUARD-0108: HARD gate, thresholds retained. WARN-only was a false-pass path.
    if (m.calls > CALL_BUDGET || m.triangles > TRI_BUDGET) {
      fail('over budget at ' + label + ': calls=' + m.calls + ' (budget ' + CALL_BUDGET + ') tris=' + m.triangles + ' (budget ' + TRI_BUDGET + ')');
    }
    return m;
  };
  if (!tele) fail('no host-authoritative warning disc ever appeared after an admitted press');
  else {
    if (tele.impactSeq !== beforeMortar.impactSeq) fail('first warning sighting already had impacts - ring did NOT precede impact');
    const s = await hostObserve();
    if (s.phase !== 'active') fail('warning frame in phase ' + s.phase + ' (wrong phase)');
    if (s.you && s.you.alive !== true) fail('warning frame shot while photographer dead (staged corpse framing)');
    if ((s.you?.deaths ?? 0) !== beforeDeaths) fail('photographer died and respawned between press and ring frame (self-respawn)');
    await A.page.screenshot({ path: out('host-ring.png') });
    await budgetGate(A, 'host-ring');
    console.log('  ring: discs=' + JSON.stringify(tele.telegraphs) + ' impactSeq=' + tele.impactSeq);
  }
  let guestTele = null;
  for (let i = 0; i < 30 && left() > 40_000; i++) {
    const m = await mortarOf(B);
    if (m.telegraphs.length >= 1) { guestTele = m; break; }
    await sleep(150);
  }
  if (!guestTele) fail('guest in the +240s domain never saw the warning disc (localization gap)');
  else {
    await B.page.screenshot({ path: out('guest-ring.png') });
    console.log('  guest ring: discs=' + JSON.stringify(guestTele.telegraphs) + ' impactSeq=' + guestTele.impactSeq);
  }

  // ---- DETONATION: first impact + flash/dust on both peers ----
  let sawImpact = false;
  for (let i = 0; i < 70 && left() > 30_000; i++) {
    const m = await mortarOf(A);
    if (m.impactSeq > (beforeMortar.impactSeq ?? 0)) { sawImpact = true; break; }
    await sleep(200);
  }
  if (!sawImpact) fail('no impacts ever reached the projection after the warning disc');
  else {
    await sleep(120);
    const s = await hostObserve();
    if (s.phase !== 'active') fail('impact frame shot in phase ' + s.phase);
    await A.page.screenshot({ path: out('host-detonation.png') });
    await budgetGate(A, 'host-detonation');
  }
  let guestImpact = false;
  const guestSeq0 = guestTele?.impactSeq ?? beforeMortar.impactSeq ?? 0;
  for (let i = 0; i < 40 && left() > 25_000; i++) {
    const m = await mortarOf(B);
    if (m.impactSeq > guestSeq0) { guestImpact = true; break; }
    await sleep(200);
  }
  if (!guestImpact) fail('guest never saw an impact after the warning disc');

  // ---- CLEANUP: discs retired, dust expired, both domains (BOTH HARD) ----
  let cleanDisc = false;
  for (let i = 0; i < 60 && left() > 12_000; i++) {
    const m = await mortarOf(A);
    if (m.telegraphs.length === 0) { cleanDisc = true; break; }
    await sleep(400);
  }
  if (!cleanDisc) fail('warning disc never retired (no streak-ended/expiry cleanup)');
  let cleanDust = false;
  for (let i = 0; i < 40 && left() > 6_000; i++) {
    const m = await mortarOf(A);
    if (m.impacts === 0) { cleanDust = true; break; }
    await sleep(300);
  }
  // GUARD-0108: HARD gate (was note-then-HOLDS). View cap keeps 8, dust 4s each —
  // still held records at exit means dust did NOT expire, so fail.
  if (!cleanDust) fail('impact/dust records still held at exit (dust did not expire within window)');
  await A.page.screenshot({ path: out('host-cleanup.png') });
  const cleanFrame = await mortarOf(A);
  const cleanGuest = await mortarOf(B);
  let guestClean = cleanGuest.telegraphs.length === 0;
  for (let i = 0; i < 20 && !guestClean && left() > 5_000; i++) {
    await sleep(400);
    const m = await mortarOf(B);
    if (m.telegraphs.length === 0) { guestClean = true; break; }
  }
  if (!guestClean) fail('guest warning disc never retired in the skewed domain');
  const cleanObs = await hostObserve();
  if (cleanFrame.telegraphs.length !== 0) fail('cleanup frame still shows a warning disc');

  // GUARD-0108: ANY console error fails (was PAGEERROR-only).
  if (errors.length) fail('console/page error: ' + errors[0] + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' more)' : ''));

  writeJsonOnce({
    tag: TAG, url: BASE_URL, dist: DIST, signalUrl: SIGNAL_URL, servedShas, servedJsPath,
    outcome: fails.length ? 'refuted' : 'holds', admission: true,
    webgpu: backend, webgpuGuest: backendGuest,
    servedEqualsLocal: !fails.some((f) => f.startsWith('served!=local')),
    fixture: setupReadback, hostId, guestId,
    earnKillsHost: endS.you?.kills, hostDeaths: endS.you?.deaths, admittedKills: kills,
    ledgerEarn: earnLines, mortarSlot: slot, pressLedger: pressLog,
    telegraphs: tele ? tele.telegraphs : null,
    ringBeforeImpact: tele ? tele.impactSeq === beforeMortar.impactSeq : null,
    guest: { skewed: skewMarker, ring: guestTele?.telegraphs ?? null, sawImpact: guestImpact, discRetired: guestClean },
    cleanup: { discRetired: cleanDisc, dustExpired: cleanDust, counts: cleanFrame.counts },
    counters: cleanObs.counters, logTail: cleanObs.logTail,
    mortarLines: cleanFrame.lines ?? null,
    errors: errors.slice(0, 8),
    stagedTeleport: 'guest staged idle on open anchor per kill; host staged to firing spots + own disc anchor (QA-only, not player walks)',
    audioClaim: 'none (no capture attempted)',
    fails,
  });
  if (fails.length) { console.log('[mortar-2p] REFUTED:\n  - ' + fails.join('\n  - ')); process.exitCode = 1; }
  else console.log('[mortar-2p] HOLDS: 8 admitted host kills earned blast-mortar over WebRTC, ring-before-impact on both peers, dust retired');
} catch (e) {
  fail('exception: ' + String((e && e.stack) || e));
  // Failure JSON for ALL early errors (even before earn/press state exists).
  writeJsonOnce({
    tag: TAG, url: BASE_URL, dist: DIST, signalUrl: SIGNAL_URL,
    servedShas, servedJsPath, outcome: 'refuted', admission: true,
    fixture: setupReadback, hostId, guestId,
    error: String((e && e.stack) || e),
    hardExpired, msElapsed: Date.now() - T0,
    errors: errors.slice(0, 8),
    stagedTeleport: 'guest staged idle on open anchor per kill; host staged to firing spots + own disc anchor (QA-only, not player walks)',
    audioClaim: 'none (no capture attempted)',
    fails,
  });
  console.log('[mortar-2p] REFUTED:\n  - ' + fails.join('\n  - '));
  process.exitCode = 1;
} finally {
  clearTimeout(hardTimer);
  try { await closeA(); } catch { /* tree reaped; a second close is a no-op */ }
  try { await closeB(); } catch { /* tree reaped; a second close is a no-op */ }
}
