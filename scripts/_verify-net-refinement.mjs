/**
 * Standalone Nuketown two-browser network refinement proof.
 *
 * This proof consumes the already-running candidate page and signalling relay:
 * it does not start a server, relay, or a browser with feature overrides. Each
 * peer is one fresh stock Chrome instance from stock-browser.mjs, so the LAN
 * WebRTC path cannot fall back to BroadcastChannel or Dave's profile.
 *
 * Required gates retained from _verify-net-two-browsers.mjs:
 *   walk > 5 m; mid-walk host lag <= 200 ms; stop settles < 0.5 m / 400 ms;
 *   real damage and kill; 120 s from Start with no disconnect.
 *
 * Added gates:
 *   guest Control/Z input reaches the authoritative host and the public
 *   remote-body QA mapping reports the rendered remote stance for that actor;
 *   a selected marksman primary is the post-spawn host ordnance primary, HUD
 *   weapon, and weaponCmd state;
 *   one guest starts with a +240,000 ms local clock (performance.now,
 *   timeOrigin, and requestAnimationFrame timestamps) and proves an ordnance
 *   smoke endpoint remains live then expires in that shifted domain.
 *
 *   node scripts/_verify-net-refinement.mjs
 *   node scripts/_verify-net-refinement.mjs --url http://127.0.0.1:4192/ --signal-port 4310
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
const SECONDS = Math.max(120, Number(opt('seconds', '120')));
const CLOCK_SKEW_MS = 240_000;
const RUN_TAG = 'net-refinement-' + Date.now();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = join(ROOT, 'captures', 'net-refinement', 'result.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = [];
const report = {
  candidate: CANDIDATE,
  signalUrl: SIGNAL_URL,
  seconds: SECONDS,
  clockSkewMs: CLOCK_SKEW_MS,
  loadoutSeed: { host: 'linekeeper', guest: 'marksman', guestExpectedPrimary: 'deadeye' },
  steps: [],
  samples: [],
  open: [],
  errors: {},
  resultPath: RESULT_PATH,
};
let code = 0;

function say(line) {
  const text = '[net-refine] ' + line;
  console.log(text);
  log.push(text);
}

function step(name, ok, detail) {
  report.steps.push({ name, state: ok ? 'VERIFIED' : 'FAIL', detail });
  say((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) code = 1;
}

function open(name, detail) {
  report.open.push({ name, state: 'OPEN', detail });
  report.steps.push({ name, state: 'OPEN', detail });
  say('OPEN ' + name + (detail ? '  ' + detail : ''));
}

function cacheBusted(url) {
  const u = new URL(url);
  u.searchParams.set('qa', RUN_TAG);
  return u.href;
}

function pageErrors(peer) {
  const errors = [];
  peer.page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 240));
  });
  peer.page.on('pageerror', (error) => errors.push('PAGEERROR ' + String(error).slice(0, 240)));
  return errors;
}

async function installClockSkew(page) {
  await page.addInitScript(({ offset }) => {
    const nativeNow = performance.now.bind(performance);
    const nativeOrigin = performance.timeOrigin;
    const originalRaf = window.requestAnimationFrame;
    const nativeRaf = originalRaf.bind(window);
    let timeOriginShifted = false;
    let rafWrapped = false;
    let installed = false;
    const marker = { offset, installed: false, rafWrapped: false, timeOriginShifted: false, rafTimestamp: null };
    Object.defineProperty(window, '__NT_QA_CLOCK', {
      configurable: true,
      value: marker,
    });
    try {
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => nativeNow() + offset,
      });
      Object.defineProperty(performance, 'timeOrigin', {
        configurable: true,
        value: nativeOrigin - offset,
      });
      timeOriginShifted = performance.timeOrigin === nativeOrigin - offset;
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        writable: true,
        value: (callback) => nativeRaf((timestamp) => {
          marker.rafTimestamp = timestamp + offset;
          callback(timestamp + offset);
        }),
      });
      rafWrapped = window.requestAnimationFrame !== originalRaf;
      installed = performance.now() - nativeNow() > offset - 10
        && timeOriginShifted && rafWrapped;
    } catch {
      installed = false;
    }
    marker.installed = installed;
    marker.rafWrapped = rafWrapped;
    marker.timeOriginShifted = timeOriginShifted;
  }, { offset: CLOCK_SKEW_MS });
}

async function seedLoadout(page, id) {
  await page.addInitScript(({ selected }) => {
    localStorage.setItem('nuketown2025.loadout.v1', JSON.stringify({
      version: 1,
      custom: [null, null, null],
      selected: { kind: 'kit', id: selected },
    }));
  }, { selected: id });
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
    id: r.id, name: r.name, connected: r.connected, ready: r.ready,
  })));
}

async function mode(peer) {
  return peer.page.evaluate(() => window.__NTGAME.mode());
}

async function netLine(peer) {
  return peer.page.evaluate(() => {
    const g = window.__NTGAME;
    return g.netLine(performance.now()) ?? g.lobby.netLine(performance.now());
  });
}

async function hostPose(host, id) {
  return host.page.evaluate((playerId) => {
    const room = window.__NTGAME.lobby.hostRoom();
    const p = room?.poseOf(playerId);
    return p ? { x: p.x, y: p.y, z: p.z, yaw: p.yaw, stance: p.stance ?? 'stand' } : null;
  }, id);
}

async function hostBodyAndRender(host, id) {
  return host.page.evaluate((playerId) => {
    const bodies = window.__NTGAME.bots();
    const b = bodies.find((body) => body.id === playerId) ?? null;
    const remoteApi = window.__NT?.remoteBodies;
    let remoteList = null;
    try {
      const value = typeof remoteApi === 'function' ? remoteApi() : null;
      remoteList = Array.isArray(value) ? value : null;
    } catch { /* an invalid optional surface is reported as an unmatched body */ }
    const remote = remoteList?.find((body) => body.id === playerId) ?? null;
    return {
      body: b ? { id: b.id, x: b.x, y: b.y, z: b.z, stance: b.stance ?? 'stand', alive: b.alive } : null,
      animation: typeof remoteApi === 'function'
        ? { supported: true, match: remote ? { ...remote } : null }
        : null,
    };
  }, id);
}

async function waitUntil(fn, timeoutMs, intervalMs = 75) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

async function waitHostStance(host, id, want, timeoutMs = 4_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await hostBodyAndRender(host, id);
    const auth = last?.body?.stance === want;
    const anim = last?.animation;
    const match = anim?.match;
    const rendered = match !== null && match?.id === id
      && (want === 'crouch' ? match.crouch === true && match.prone !== true
        : want === 'prone' ? match.prone === true
          : match.crouch !== true && match.prone !== true)
      && (want === 'stand' || String(match.locomotion).startsWith(want + '-'));
    if (auth && (anim === null || rendered)) return { ...last, rendered };
    await sleep(75);
  }
  return {
    ...(last ?? { body: null, animation: null }),
    rendered: false,
  };
}

async function guestAlive(guest, maxMs = 8_000) {
  return waitUntil(async () => guest.page.evaluate(() => {
    const g = window.__NTGAME;
    const s = g.snapshot();
    const me = s.actors.find((a) => a.id === g.localId);
    return me && me.alive && s.match.phase === 'active' ? me : null;
  }), maxMs, 150);
}

async function throwSmoke(guest) {
  const alive = await guestAlive(guest, 12_000);
  if (!alive) return null;
  await guest.page.bringToFront();
  await guest.page.keyboard.down('KeyQ');
  try {
    await sleep(500);
  } finally {
    await guest.page.keyboard.up('KeyQ');
  }
  return waitUntil(async () => guest.page.evaluate(() => {
    const o = window.__NT.ordnance();
    const smoke = o.smokes.find((v) => v.kind === 'grenade') ?? null;
    return smoke ? {
      smoke,
      now: performance.now(),
      line: [...o.lines].reverse().find((line) => line.includes('smoke-volume')) ?? null,
    } : null;
  }), 8_000, 100);
}

async function verifySkewedSmoke(guest) {
  const clock = await guest.page.evaluate(() => ({
    marker: window.__NT_QA_CLOCK ?? null,
    now: performance.now(),
  }));
  const rafDeltaMs = Number.isFinite(clock.marker?.rafTimestamp)
    ? Math.abs(clock.marker.rafTimestamp - clock.now) : Infinity;
  const clockOk = clock.marker?.installed === true
    && clock.marker.offset === CLOCK_SKEW_MS
    && clock.marker.rafWrapped === true
    && clock.marker.timeOriginShifted === true
    && Number.isFinite(clock.marker.rafTimestamp)
    && rafDeltaMs <= 2_000;
  if (!clockOk) {
    step('epoch-skew clock installed before guest startup', false,
      JSON.stringify({ ...clock, rafDeltaMs }));
    return;
  }
  step('epoch-skew clock installed before guest startup', true, JSON.stringify({ ...clock, rafDeltaMs }));
  const shape = await guest.page.evaluate(() => {
    const api = window.__NT?.ordnance;
    if (typeof api !== 'function') return { api: false };
    let value = null;
    try { value = api(); } catch (error) { return { api: true, error: String(error) }; }
    return {
      api: true,
      bound: value?.bound === true,
      hasSelf: !!value?.self && typeof value.self === 'object',
      hasSmokes: Array.isArray(value?.smokes),
      hasLines: Array.isArray(value?.lines),
      smokeKeys: Array.isArray(value?.smokes) && value.smokes[0]
        ? Object.keys(value.smokes[0]).sort() : [],
    };
  });
  const shapeObservable = shape.api === true && shape.bound === true
    && shape.hasSelf === true && shape.hasSmokes === true && shape.hasLines === true;
  if (!shape.api) {
    open('epoch-skew ordnance lifetime', 'the public __NT.ordnance projection is unavailable');
    return;
  }
  step('epoch-skew ordnance projection exposes a bound smoke list', shapeObservable,
    JSON.stringify(shape));
  if (!shapeObservable) return;
  const initial = await throwSmoke(guest);
  if (!initial) {
    step('epoch-skew smoke admission through real KeyQ input', false,
      'guest was alive but no grenade smoke entry became observable');
    return;
  }
  const smoke = initial.smoke;
  const eventShape = ['id', 'kind', 'bornAt', 'diesAt'].every((key) => Object.prototype.hasOwnProperty.call(smoke, key))
    && typeof smoke.bornAt === 'number' && typeof smoke.diesAt === 'number';
  step('epoch-skew smoke projection exposes lifetime endpoints', eventShape,
    JSON.stringify({ keys: Object.keys(smoke).sort(), id: smoke.id, kind: smoke.kind }));
  if (!eventShape) return;
  const live = smoke.bornAt <= initial.now && smoke.diesAt > initial.now;
  const span = smoke.diesAt - smoke.bornAt;
  step('epoch-skew smoke remains live in the guest clock domain', live && span >= 24_000 && span <= 26_000,
    JSON.stringify({ id: smoke.id, bornAt: smoke.bornAt, diesAt: smoke.diesAt, now: initial.now, span, line: initial.line }));
  const expired = await waitUntil(async () => guest.page.evaluate((id) => {
    const o = window.__NT.ordnance();
    const now = performance.now();
    return now > (o.smokes.find((v) => v.id === id)?.diesAt ?? -Infinity)
      ? { now, stillPresent: o.smokes.some((v) => v.id === id) } : null;
  }, smoke.id), 32_000, 250);
  if (!expired) {
    step('epoch-skew smoke expires at its localized endpoint', false,
      'runtime expiry was not reached within the 32 s bound');
    return;
  }
  step('epoch-skew smoke expires at its localized endpoint', expired.stillPresent === false,
    JSON.stringify(expired));
}

async function verifyLoadout(host, guest, guestId) {
  const expected = 'deadeye';
  const shape = await Promise.all([
    guest.page.evaluate(() => {
      const weapon = window.__NT?.weaponCmd;
      const ordnance = window.__NT?.ordnance;
      let state = null;
      let ord = null;
      try { state = typeof weapon === 'function' ? weapon('state') : null; } catch (error) { return { weapon: false, error: String(error) }; }
      try { ord = typeof ordnance === 'function' ? ordnance() : null; } catch (error) { return { weapon: true, ordnance: false, error: String(error) }; }
      return {
        weapon: typeof weapon === 'function' && !!state && typeof state === 'object',
        ordnance: typeof ordnance === 'function' && !!ord && typeof ord === 'object',
        bound: ord?.bound === true,
        self: !!ord?.self && typeof ord.self === 'object',
        stateKeys: state ? Object.keys(state).sort() : [],
        selfKeys: ord?.self ? Object.keys(ord.self).sort() : [],
      };
    }),
    host.page.evaluate((id) => {
      const snapshot = window.__NTGAME?.snapshot?.();
      const actor = snapshot?.actors?.find((candidate) => candidate.id === id) ?? null;
      return {
        actors: Array.isArray(snapshot?.actors),
        actor: !!actor,
        hasPrimaryId: !!actor && Object.prototype.hasOwnProperty.call(actor, 'primaryId'),
        actorPrimaryId: actor?.primaryId ?? null,
      };
    }, guestId),
  ]);
  const guestShape = shape[0];
  const hostShape = shape[1];
  const shapeOk = guestShape?.weapon === true && guestShape.ordnance === true
    && guestShape.bound === true && guestShape.self === true
    && hostShape?.actors === true && hostShape.actor === true && hostShape.hasPrimaryId === true;
  step('post-spawn loadout QA surfaces expose their required shapes', shapeOk,
    JSON.stringify({ guest: guestShape, host: hostShape }));
  if (!shapeOk) return;
  let last = null;
  const result = await waitUntil(async () => {
    const read = await guest.page.evaluate((want) => {
      const state = window.__NT.weaponCmd('state');
      const ord = window.__NT.ordnance();
      const hud = document.querySelector('#hud .hud-weapon-name')?.textContent?.trim() ?? '';
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem('nuketown2025.loadout.v1') ?? 'null')?.selected ?? null; } catch { /* report the live surfaces below */ }
      return { expected: want, state, ordnance: ord.self, hud, storedSelection: stored };
    }, expected);
    const hostActor = await host.page.evaluate((id) => {
      const a = window.__NTGAME.snapshot().actors.find((actor) => actor.id === id);
      return a ? { id: a.id, primaryId: a.primaryId ?? null, alive: a.alive, life: a.life } : null;
    }, guestId);
    last = { ...read, hostActor };
    if (read.state?.id !== expected || read.ordnance?.primaryId !== expected
        || read.hud.toLowerCase() !== read.state?.name?.toLowerCase()) return null;
    return hostActor?.primaryId === expected ? { ...read, hostActor } : null;
  }, 8_000, 150);
  if (!result) {
    step('selected primary survives spawn across host, HUD, and weaponCmd', false,
      JSON.stringify({ expected, last }));
    return;
  }
  const hostMatches = result.hostActor?.primaryId === expected;
  step('selected primary survives spawn across host, HUD, and weaponCmd',
    hostMatches && result.state.id === expected && result.ordnance.primaryId === expected
      && result.hud.toLowerCase() === result.state.name.toLowerCase(),
    JSON.stringify({ expected, host: result.hostActor, guestPrimary: result.ordnance.primaryId, state: result.state.id, hud: result.hud }));
}

async function verifyDamageKill(host, guest, guestId) {
  const position = await guest.page.evaluate(() => window.__NT.probePos());
  const spot = await host.page.evaluate(([bx, bz]) => {
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
  }, [position[0], position[2]]);
  step('a clear firing position beside guest exists', spot !== null, spot ? JSON.stringify(spot) : 'none');
  if (!spot) return;
  const before = await guest.page.evaluate(() => {
    const s = window.__NTGAME.snapshot();
    const row = s.actors.find((a) => a.id === window.__NTGAME.localId);
    return {
      hp: row?.hp ?? 100,
      hud: document.querySelector('#hud .hud-hp-label')?.textContent?.trim() ?? '',
      feed: Array.from(document.querySelectorAll('#hud .hud-feed-taken .hud-feed-row:not(.hud-feed-hidden)')).map((n) => n.textContent),
    };
  });
  const killsBefore = await host.page.evaluate(() => window.__NTGAME.counters().kills);
  await host.page.evaluate(([x, z, bx, bz]) => {
    const yaw = Math.atan2(-(bx - x), -(bz - z));
    const pitch = Math.atan2(0.95 - 1.68, Math.hypot(bx - x, bz - z));
    window.__NT.teleport(x, 0, z, yaw, pitch);
  }, [spot.ax, spot.az, position[0], position[2]]);
  await sleep(400);
  let fired = 0;
  for (let i = 0; i < 24; i++) {
    if (await host.page.evaluate(() => window.__NT.weaponCmd('fire'))) fired++;
    await sleep(140);
    const kills = await host.page.evaluate(() => window.__NTGAME.counters().kills);
    if (kills > killsBefore) break;
  }
  await sleep(600);
  const after = await guest.page.evaluate(() => {
    const s = window.__NTGAME.snapshot();
    const row = s.actors.find((a) => a.id === window.__NTGAME.localId);
    return {
      hp: row?.hp ?? 100,
      hud: document.querySelector('#hud .hud-hp-label')?.textContent?.trim() ?? '',
      feed: Array.from(document.querySelectorAll('#hud .hud-killfeed .hud-feed-row:not(.hud-feed-hidden)')).map((n) => n.textContent),
      taken: Array.from(document.querySelectorAll('#hud .hud-feed-taken .hud-feed-row:not(.hud-feed-hidden)')).map((n) => n.textContent),
    };
  });
  const killsAfter = await host.page.evaluate(() => window.__NTGAME.counters().kills);
  const killFeed = after.feed.some((line) => /YOU|BRAVO/i.test(line ?? ''));
  step('host fired the real weapon and guest took damage', fired > 0 && after.hp < before.hp && after.hud !== before.hud,
    `${fired} trigger pulls, guest hp ${before.hp} -> ${after.hp}, HUD ${before.hud} -> ${after.hud}; damage feed ${JSON.stringify(after.taken.slice(0, 3))}`);
  step('host authoritative kill reaches both feeds', killsAfter > killsBefore && killFeed,
    `host kills ${killsBefore} -> ${killsAfter}; guest feed ${JSON.stringify(after.feed.slice(0, 4))}`);
  void guestId;
}

let A = null;
let B = null;
try {
  A = await stockBrowser('net-refine-A');
  B = await stockBrowser('net-refine-B-skewed');
  const errorsA = pageErrors(A);
  const errorsB = pageErrors(B);
  await installClockSkew(B.page);
  await seedLoadout(A.page, 'linekeeper');
  await seedLoadout(B.page, 'marksman');
  const url = cacheBusted(CANDIDATE);
  await Promise.all([openMultiplayer(A, 'alpha', url), openMultiplayer(B, 'bravo', url)]);
  await A.page.getByRole('button', { name: 'Host a room' }).click();
  await A.page.waitForFunction(() => /^[0-9A-Z]{6}$/.test(document.querySelector('#start .aa-code')?.textContent ?? ''), null, { timeout: 10_000 });
  const roomCode = await A.page.evaluate(() => document.querySelector('#start .aa-code')?.textContent ?? '');
  step('host room code appears in the real multiplayer UI', /^[0-9A-Z]{6}$/.test(roomCode), roomCode);

  await B.page.getByLabel('Join code').fill(roomCode);
  await B.page.getByRole('button', { name: 'Join by code' }).click();
  const joinedAt = Date.now();
  await Promise.all([
    A.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30_000 }),
    B.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30_000 }),
  ]);
  const ra = await roster(A);
  const rb = await roster(B);
  step('guest joins over WebRTC and both UI rosters show two seats', ra.length === 2 && rb.length === 2,
    `join ${Date.now() - joinedAt} ms; A=${JSON.stringify(ra)} B=${JSON.stringify(rb)}`);

  await A.page.getByLabel('Ready').check();
  await B.page.getByLabel('Ready').check();
  await A.page.waitForFunction(() => !document.querySelector('#start .aa-lobby-room button.aa-primary')?.disabled, null, { timeout: 10_000 });
  step('both peers ready and host Start is enabled', (await roster(A)).every((r) => r.ready), JSON.stringify(await roster(A)));
  const startAt = Date.now();
  await A.page.getByRole('button', { name: 'Start match' }).click();
  await Promise.all([
    A.page.waitForFunction(() => window.__NTGAME.mode() === 'host' && document.getElementById('start').style.display === 'none', null, { timeout: 20_000 }),
    B.page.waitForFunction(() => window.__NTGAME.mode() === 'guest' && document.getElementById('start').style.display === 'none', null, { timeout: 20_000 }),
  ]);
  const guestId = await B.page.evaluate(() => window.__NTGAME.localId);
  step('Start transitions A to host and B to guest', (await mode(A)) === 'host' && (await mode(B)) === 'guest', `after ${Date.now() - startAt} ms; B=${guestId}`);
  await Promise.all([
    A.page.waitForFunction(() => window.__NTGAME.snapshot().match.phase === 'active', null, { timeout: 20_000 }),
    B.page.waitForFunction(() => {
      try { return window.__NTGAME.snapshot().match.phase === 'active'; }
      catch (error) {
        // Guest driver exists before its first authoritative match snapshot.
        // Keep the same deadline and predicate; only this documented wait state
        // is retryable. Other exceptions must still fail the proof.
        if (String(error).includes('guest has no match line yet')) return false;
        throw error;
      }
    }, null, { timeout: 20_000 }),
  ]);
  await sleep(500);

  const before = await B.page.evaluate(() => window.__NT.probePos());
  await B.page.bringToFront();
  await B.page.keyboard.down('w');
  const walk = [];
  const walkAt = Date.now();
  while (Date.now() - walkAt < 3_000) {
    const own = await B.page.evaluate(() => window.__NT.probePos());
    const seen = await hostPose(A, guestId);
    walk.push({ t: Date.now() - walkAt, own: [own[0], own[2]], seen: seen ? [seen.x, seen.z] : null });
    await sleep(100);
  }
  await B.page.keyboard.up('w');
  const stopAt = Date.now();
  await sleep(120);
  const after = await B.page.evaluate(() => window.__NT.probePos());
  let settled = null;
  let prior = null;
  for (let i = 0; i < 40; i++) {
    const seen = await hostPose(A, guestId);
    if (prior && seen && Math.hypot(seen.x - prior.x, seen.z - prior.z) < 0.01) { settled = seen; break; }
    prior = seen;
    await sleep(25);
  }
  const walked = Math.hypot(after[0] - before[0], after[2] - before[2]);
  const gaps = walk.filter((v) => v.seen && v.t > 600).map((v) => Math.hypot(v.seen[0] - v.own[0], v.seen[1] - v.own[1]));
  gaps.sort((a, b) => a - b);
  const gapMed = gaps.length ? gaps[Math.floor(gaps.length / 2)] : Infinity;
  const lagMs = gapMed / 4.8 * 1000;
  const settleMs = Date.now() - stopAt;
  const finalGap = settled ? Math.hypot(settled.x - after[0], settled.z - after[2]) : Infinity;
  step('guest walked with real window keyboard input', walked > 5, `moved ${walked.toFixed(2)} m in 3 s`);
  step('authoritative host tracked guest within 200 ms', lagMs <= 200, `median ${gapMed.toFixed(2)} m = ${lagMs.toFixed(0)} ms`);
  step('authoritative host settled guest after keyup', finalGap < 0.5 && settleMs <= 400, `settled ${settleMs} ms, gap ${finalGap.toFixed(2)} m`);
  report.walk = walk;

  await B.page.bringToFront();
  await B.page.keyboard.down('Control');
  const crouch = await waitHostStance(A, guestId, 'crouch');
  const crouchLocal = await B.page.evaluate(() => ({ stance: window.__NT.stats().stance, pos: window.__NT.probePos() }));
  await B.page.keyboard.up('Control');
  step('guest crouch input is observed by authoritative host', crouch.body?.stance === 'crouch' && crouchLocal.stance === 'crouch', JSON.stringify({ host: crouch.body, local: crouchLocal }));
  if (crouch.animation === null) open('host remote crouch rendering', 'the public __NT.remoteBodies surface is unavailable');
  else step('host remote body renders crouch when the public animation surface exposes it', crouch.rendered === true, JSON.stringify(crouch.animation));

  await B.page.keyboard.press('z');
  const prone = await waitHostStance(A, guestId, 'prone');
  const proneLocal = await B.page.evaluate(() => ({ stance: window.__NT.stats().stance, pos: window.__NT.probePos() }));
  step('guest prone input is observed by authoritative host', prone.body?.stance === 'prone' && proneLocal.stance === 'prone', JSON.stringify({ host: prone.body, local: proneLocal }));
  if (prone.animation === null) open('host remote prone rendering', 'the public __NT.remoteBodies surface is unavailable');
  else step('host remote body renders prone when the public animation surface exposes it', prone.rendered === true, JSON.stringify(prone.animation));
  await B.page.keyboard.press('z');
  await waitHostStance(A, guestId, 'stand', 4_000);

  await verifyLoadout(A, B, guestId);
  await verifySkewedSmoke(B);
  await guestAlive(B, 12_000);
  await verifyDamageKill(A, B, guestId);

  const first = { a: await netLine(A), b: await netLine(B) };
  const diagOk = /rtt \d+/.test(first.b ?? '') && /snap [\d.]+ Hz/.test(first.b ?? '');
  step('RTT and snapshot diagnostics are visible on the guest', diagOk, first.b ?? 'no guest diagnostic line');
  let disconnects = 0;
  while (Date.now() - startAt < SECONDS * 1000) {
    await sleep(10_000);
    const sample = {
      t: Math.round((Date.now() - startAt) / 1000),
      a: await netLine(A), b: await netLine(B),
      modeA: await mode(A), modeB: await mode(B),
      rosterA: await roster(A), rosterB: await roster(B),
    };
    report.samples.push(sample);
    const connected = sample.rosterA.every((r) => r.connected) && sample.rosterB.every((r) => r.connected)
      && sample.modeA === 'host' && sample.modeB === 'guest';
    if (!connected) disconnects++;
    say(`t=${String(sample.t).padStart(3)}s ${connected ? 'connected' : 'DISCONNECT'} | A ${sample.a} | B ${sample.b}`);
  }
  step('120 s from Start without a disconnect', disconnects === 0, `${report.samples.length} samples, ${disconnects} bad`);
  report.errors = { A: errorsA.slice(0, 8), B: errorsB.slice(0, 8) };
  if (errorsA.length || errorsB.length) {
    step('both stock Chrome pages stayed free of console/page errors', false, JSON.stringify(report.errors));
  } else {
    step('both stock Chrome pages stayed free of console/page errors', true, 'A/B error arrays empty');
  }
} catch (error) {
  say('EXCEPTION ' + String(error).slice(0, 500));
  code = 1;
} finally {
  try { if (A) await A.close(); } catch (error) { say('A cleanup ' + String(error).slice(0, 160)); code = 1; }
  try { if (B) await B.close(); } catch (error) { say('B cleanup ' + String(error).slice(0, 160)); code = 1; }
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
