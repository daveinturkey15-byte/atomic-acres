/**
 * Real two-Chrome LAN resume proof.
 *
 * This consumes an already-running candidate page and signalling relay. It
 * deliberately reloads the guest in the same owned Chrome profile, waits for
 * the old RTC peer to disappear and the host seat to become a reservation,
 * then uses the real Rejoin room UI. The current broken resume path must fail
 * the live-match gate; the authority/resume repair must pass it.
 *
 * Run only when a live QA pass is requested:
 *   node scripts/_verify-resume-live.mjs --url http://127.0.0.1:4192/ --signal-port 4310
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
const RUN_TAG = 'resume-live-' + Date.now();
const MAX_RUN_MS = 90_000;
const RESERVATION_MS = 6_000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'captures', 'resume-live');
const RESULT_PATH = join(OUT_DIR, 'result.json');
const POST_RESUME_PATH = join(OUT_DIR, 'postresume.png');
const EXPECTED_PRIMARY = 'deadeye';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const startedAt = Date.now();
const log = [];
const report = {
  candidate: CANDIDATE,
  signalUrl: SIGNAL_URL,
  maxRunMs: MAX_RUN_MS,
  reservationMs: RESERVATION_MS,
  lossMethod: 'same-profile guest page reload; old RTC peer must go to lan peers 0',
  rejoinMethod: 'real Rejoin room button with persisted room identity',
  steps: [],
  preResume: null,
  disconnect: null,
  postResume: null,
  errors: { host: [], guest: [] },
  resultPath: RESULT_PATH,
  postResumePath: POST_RESUME_PATH,
  expectedCurrentBaseline: 'FAIL live resume gate until welcome/start/state and sequence repair are integrated',
};
let code = 0;

function say(line) {
  const text = '[resume-live] ' + line;
  console.log(text);
  log.push(text);
}

function step(name, ok, detail = '') {
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

async function seedLoadout(page, id) {
  await page.addInitScript(({ selected }) => {
    localStorage.setItem('nuketown2025.loadout.v1', JSON.stringify({
      version: 1,
      custom: [null, null, null],
      selected: { kind: 'kit', id: selected },
    }));
  }, { selected: id });
}

async function roster(peer) {
  return peer.page.evaluate(() => window.__NTGAME.lobby.view().roster.map((r) => ({
    id: r.id, name: r.name, connected: r.connected, ready: r.ready, isHost: r.isHost,
  })));
}

async function mode(peer) {
  return peer.page.evaluate(() => window.__NTGAME.mode());
}

/** Use the lobby's net line for LAN peer count; gameplay driver netLine has no LAN suffix. */
async function lanLine(peer) {
  return peer.page.evaluate(() => window.__NTGAME.lobby.netLine(performance.now()) ?? '');
}

async function driverLine(peer) {
  return peer.page.evaluate(() => {
    try { return window.__NTGAME.netLine(performance.now()) ?? null; } catch { return null; }
  });
}

async function hostPose(host, id) {
  return host.page.evaluate((playerId) => {
    const room = window.__NTGAME.lobby.hostRoom();
    const p = room?.poseOf(playerId);
    return p ? { x: p.x, y: p.y, z: p.z, yaw: p.yaw, stance: p.stance ?? 'stand' } : null;
  }, id);
}

async function snapshot(peer) {
  return peer.page.evaluate(() => {
    try { return window.__NTGAME.snapshot(); } catch { return null; }
  });
}

async function counters(peer) {
  return peer.page.evaluate(() => {
    try { return window.__NTGAME.counters(); } catch { return null; }
  });
}

async function ordnanceSelf(peer) {
  return peer.page.evaluate(() => {
    try {
      const self = window.__NT.ordnance()?.self;
      if (!self) return null;
      return {
        lethal: self.lethal,
        tactical: self.tactical,
        primaryId: self.primaryId,
        rounds: self.rounds,
        armed: self.armed,
      };
    } catch {
      return null;
    }
  });
}

async function loadoutSurfaces(host, guest, guestId) {
  const [guestSurface, hostSurface] = await Promise.all([
    guest.page.evaluate(() => {
      try {
        const state = window.__NT.weaponCmd('state');
        const hud = document.querySelector('#hud .hud-weapon-name')?.textContent?.trim() ?? '';
        return { state: { id: state.id, name: state.name }, hud };
      } catch (error) {
        return { error: String(error), state: null, hud: '' };
      }
    }),
    host.page.evaluate((id) => {
      try {
        const actor = window.__NTGAME.snapshot().actors.find((a) => a.id === id) ?? null;
        return { primaryId: actor?.primaryId ?? null };
      } catch (error) {
        return { error: String(error), primaryId: null };
      }
    }, guestId),
  ]);
  const stateId = guestSurface.state?.id ?? null;
  const stateName = guestSurface.state?.name ?? '';
  const preflight = stateId === EXPECTED_PRIMARY && hostSurface.primaryId === EXPECTED_PRIMARY
    && guestSurface.hud.toLowerCase() === stateName.toLowerCase();
  return { expected: EXPECTED_PRIMARY, guest: guestSurface, host: hostSurface, preflight };
}

async function waitLoadoutSurfaces(host, guest, guestId, timeoutMs = 8_000) {
  let last = null;
  const stable = await waitUntil(async () => {
    last = await loadoutSurfaces(host, guest, guestId);
    return last.preflight ? last : null;
  }, timeoutMs, 150);
  return stable ?? last;
}

async function waitUntil(fn, timeoutMs, intervalMs = 100) {
  const until = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < until && Date.now() - startedAt < MAX_RUN_MS) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

async function waitReadyAfterReload(page) {
  await page.waitForFunction(
    () => window.__NT?.ready === true && window.__AA_UI && window.__NTGAME,
    null,
    { timeout: 30_000 },
  );
  const multiplayer = page.getByRole('button', { name: 'Multiplayer' });
  if (await multiplayer.count() && await multiplayer.first().isVisible().catch(() => false)) {
    await multiplayer.first().click();
  }
}

async function clickRejoin(page) {
  const button = page.getByRole('button', { name: /Rejoin room/i });
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  const label = await button.first().innerText();
  await button.first().click();
  return label;
}

async function guestDamageHostAfterResume(host, guest) {
  const shooter = await guest.page.evaluate(() => ({ p: window.__NT.probePos() }));
  const target = await host.page.evaluate(() => {
    const p = window.__NT.probePos();
    const s = window.__NTGAME.snapshot();
    const me = s.actors.find((a) => a.id === window.__NTGAME.localId);
    return { p, hp: me?.hp ?? null, id: window.__NTGAME.localId };
  });
  // Move only the host's local body beside the guest. The guest keeps its
  // authoritative network position; only its local yaw/pitch are adjusted.
  const spot = await host.page.evaluate(([bx, bz]) => {
    const tries = [[0, 5], [5, 0], [0, -5], [-5, 0], [3.5, 3.5], [-3.5, 3.5], [3.5, -3.5], [-3.5, -3.5]];
    for (const [dx, dz] of tries) {
      const ax = bx + dx;
      const az = bz + dz;
      if (window.__NT.collidersAt(ax, az, 1.0).length > 0) continue;
      if (!window.__NTGAME.los(ax, 1.5, az, bx, 1.5, bz)) continue;
      return { ax, az };
    }
    return null;
  }, [shooter.p[0], shooter.p[2]]);
  step('post-resume host clear firing position exists', spot !== null, spot ? JSON.stringify(spot) : 'none');
  if (spot === null || target.hp === null) return { accepted: false, damaged: false, spot, target };

  const before = await snapshot(host);
  await host.page.evaluate(([x, z, bx, bz]) => {
    const yaw = Math.atan2(-(bx - x), -(bz - z));
    const pitch = Math.atan2(0.95 - 1.68, Math.hypot(bx - x, bz - z));
    window.__NT.teleport(x, 0, z, yaw, pitch);
  }, [spot.ax, spot.az, shooter.p[0], shooter.p[2]]);
  const actualGuestPos = await guest.page.evaluate(() => window.__NT.probePos());
  const actualHostPos = await host.page.evaluate(() => window.__NT.probePos());
  await guest.page.evaluate(([x, z, bx, bz]) => {
    const yaw = Math.atan2(-(bx - x), -(bz - z));
    const pitch = Math.atan2(0.95 - 1.68, Math.hypot(bx - x, bz - z));
    // Same guest x/z as before the host-side QA placement: no guest anti-warp.
    window.__NT.teleport(x, 0, z, yaw, pitch);
  }, [actualGuestPos[0], actualGuestPos[2], actualHostPos[0], actualHostPos[2]]);
  await sleep(400);
  const weaponShape = await guest.page.evaluate(() => {
    const state = window.__NT.weaponCmd('state');
    if (state.mag <= 0) window.__NT.weaponCmd('refill');
    return { id: state.id, mag: state.mag, name: state.name };
  });
  let fired = 0;
  let after = before;
  for (let i = 0; i < 16; i++) {
    if (await guest.page.evaluate(() => window.__NT.weaponCmd('fire'))) fired++;
    await sleep(140);
    after = await snapshot(host);
    const victim = after?.actors?.find((a) => a.id === target.id);
    if ((after?.stats?.shotsAdmitted ?? 0) > (before?.stats?.shotsAdmitted ?? 0)
        && victim && victim.hp < target.hp) break;
  }
  const victim = after?.actors?.find((a) => a.id === target.id) ?? null;
  const accepted = fired > 0 && (after?.stats?.shotsAdmitted ?? 0) > (before?.stats?.shotsAdmitted ?? 0);
  const damaged = victim !== null && victim.hp < target.hp;
  step('post-resume guest firearm shot is accepted by the host', accepted,
    JSON.stringify({ weaponShape, fired, admittedBefore: before?.stats?.shotsAdmitted, admittedAfter: after?.stats?.shotsAdmitted }));
  step('post-resume guest shot damages the authoritative host target', damaged,
    JSON.stringify({ targetId: target.id, targetHp: target.hp, afterHp: victim?.hp ?? null }));
  return { accepted, damaged, spot, target, shooter, weaponShape, fired, before, after, victim };
}

let host = null;
let guest = null;
const errors = { host: [], guest: [] };

try {
  host = await stockBrowser('resume-live-host');
  guest = await stockBrowser('resume-live-guest');
  errors.host = pageErrors(host);
  errors.guest = pageErrors(guest);
  await seedLoadout(guest.page, 'marksman');
  const url = cacheBusted(CANDIDATE);
  await Promise.all([
    openMultiplayer(host, 'resume-host', url),
    openMultiplayer(guest, 'resume-guest', url),
  ]);

  await host.page.getByRole('button', { name: 'Host a room' }).click();
  await host.page.waitForFunction(() => /^[0-9A-Z]{6}$/.test(document.querySelector('#start .aa-code')?.textContent ?? ''), null, { timeout: 10_000 });
  const roomCode = await host.page.evaluate(() => document.querySelector('#start .aa-code')?.textContent ?? '');
  step('real host UI publishes a LAN room code', /^[0-9A-Z]{6}$/.test(roomCode), roomCode);
  await guest.page.getByLabel('Join code').fill(roomCode);
  await guest.page.getByRole('button', { name: 'Join by code' }).click();
  await Promise.all([
    host.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30_000 }),
    guest.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30_000 }),
  ]);
  await host.page.getByLabel('Ready').check();
  await guest.page.getByLabel('Ready').check();
  await host.page.waitForFunction(() => !document.querySelector('#start .aa-lobby-room button.aa-primary')?.disabled, null, { timeout: 10_000 });
  await host.page.getByRole('button', { name: 'Start match' }).click();
  await Promise.all([
    host.page.waitForFunction(() => window.__NTGAME.mode() === 'host' && window.__NTGAME.snapshot().match.phase === 'active', null, { timeout: 20_000 }),
    guest.page.waitForFunction(() => {
      try { return window.__NTGAME.mode() === 'guest' && window.__NTGAME.snapshot().match.phase === 'active'; }
      catch (error) { if (String(error).includes('guest has no match line yet')) return false; throw error; }
    }, null, { timeout: 20_000 }),
  ]);
  const guestId = await guest.page.evaluate(() => window.__NTGAME.localId);
  const preLoadout = await waitLoadoutSurfaces(host, guest, guestId);
  step('pre-refresh Deadeye loadout agrees across weaponCmd, HUD, and host actor', preLoadout.preflight,
    JSON.stringify(preLoadout));
  const preShotBefore = await snapshot(host);
  const preShotState = await guest.page.evaluate(() => {
    const state = window.__NT.weaponCmd('state');
    if (state.mag <= 0) window.__NT.weaponCmd('refill');
    return { id: state.id, mag: state.mag, fired: window.__NT.weaponCmd('fire') };
  });
  const preShotAccepted = await waitUntil(async () => {
    const current = await snapshot(host);
    return (current?.stats?.shotsAdmitted ?? 0) > (preShotBefore?.stats?.shotsAdmitted ?? 0) ? current : null;
  }, 4_000, 100);
  step('pre-refresh guest firearm claim is accepted with a nonzero shot sequence',
    preShotState.fired === true && preShotAccepted !== null,
    JSON.stringify({ state: preShotState, admittedBefore: preShotBefore?.stats?.shotsAdmitted, admittedAfter: preShotAccepted?.stats?.shotsAdmitted ?? null }));
  const preHostSnapshot = await snapshot(host);
  let preInventory = null;
  await waitUntil(async () => {
    const [guestSelf, hostState] = await Promise.all([ordnanceSelf(guest), snapshot(host)]);
    const hostActor = hostState?.actors?.find((a) => a.id === guestId) ?? null;
    if (!guestSelf || !hostActor) return null;
    // Require a positive retained charge so a zeroed projection cannot pass by
    // matching itself after reload. The normal kit starts with one of each.
    if (!(guestSelf.lethal > 0 || guestSelf.tactical > 0)) return null;
    preInventory = {
      guest: guestSelf,
      host: {
        lethal: hostActor.lethal,
        tactical: hostActor.tactical,
        primaryId: hostActor.primaryId,
        rounds: hostActor.rounds,
        armed: hostActor.armed,
      },
    };
    return preInventory;
  }, 8_000, 150);
  const preGuestCounters = await counters(guest);
  const preRoster = await roster(host);
  const preLanLine = await lanLine(host);
  report.preResume = {
    guestId,
    loadout: preLoadout,
    preShot: { state: preShotState, admittedBefore: preShotBefore?.stats?.shotsAdmitted, admittedAfter: preShotAccepted?.stats?.shotsAdmitted ?? null },
    inventory: preInventory,
    hostSnapshot: preHostSnapshot,
    guestCounters: preGuestCounters,
    hostRoster: preRoster,
    hostLanLine: preLanLine,
    guestDriverLine: await driverLine(guest),
  };
  step('pre-resume host and guest are active on one LAN peer',
    preLanLine.includes('lan peers 1') && preRoster.filter((r) => r.id === guestId).length === 1,
    JSON.stringify({ guestId, preLanLine, preRoster }));

  const oldReloadAt = Date.now();
  await guest.page.reload({ waitUntil: 'load', timeout: 30_000 });
  await waitReadyAfterReload(guest.page);
  const oldPeer = await waitUntil(async () => {
    const line = await lanLine(host);
    const rows = await roster(host);
    const seat = rows.find((r) => r.id === guestId) ?? null;
    return line.includes('lan peers 0') && seat?.connected === false ? { line, rows } : null;
  }, 15_000, 150);
  const disconnectedAt = Date.now();
  const oldPeerGone = oldPeer !== null;
  if (oldPeerGone) await sleep(RESERVATION_MS);
  const reservationHeldMs = oldPeerGone ? Date.now() - disconnectedAt : 0;
  report.disconnect = {
    oldReloadAt,
    disconnectedAt,
    reloadToDisconnectMs: disconnectedAt - oldReloadAt,
    reservationHeldMs,
    oldPeerGone,
    hostLanLine: await lanLine(host),
    hostRoster: await roster(host),
  };
  step('old guest RTC peer is gone and host seat is reserved',
    oldPeerGone && reservationHeldMs >= RESERVATION_MS,
    JSON.stringify(report.disconnect));

  let rejoinLabel = null;
  try {
    rejoinLabel = await clickRejoin(guest.page);
    step('reload preserves the saved identity and exposes Rejoin room', true, rejoinLabel);
  } catch (error) {
    step('reload preserves the saved identity and exposes Rejoin room', false, String(error));
  }
  const rejoinedSeat = await waitUntil(async () => {
    const rows = await roster(host);
    const line = await lanLine(host);
    const seat = rows.find((r) => r.id === guestId) ?? null;
    return line.includes('lan peers 1') && seat?.connected === true ? { rows, line } : null;
  }, 20_000, 150);
  const postHostRoster = await roster(host);
  const postGuestRoster = await roster(guest);
  const sameId = rejoinedSeat !== null && postHostRoster.filter((r) => r.id === guestId).length === 1
    && postGuestRoster.filter((r) => r.id === guestId).length === 1;
  const uniqueHostIds = new Set(postHostRoster.map((r) => r.id)).size === postHostRoster.length;
  step('fresh RTC peer rejoins the original seat exactly once', sameId && uniqueHostIds,
    JSON.stringify({ guestId, rejoinedSeat, hostRoster: postHostRoster, guestRoster: postGuestRoster }));

  await guest.page.screenshot({ path: POST_RESUME_PATH, fullPage: true });
  report.postResumeCapture = POST_RESUME_PATH;
  const active = await waitUntil(async () => {
    const [hm, gm, hs, gs] = await Promise.all([mode(host), mode(guest), snapshot(host), snapshot(guest)]);
    return hm === 'host' && gm === 'guest' && hs?.match?.phase === 'active' && gs?.match?.phase === 'active'
      ? { hostMode: hm, guestMode: gm, hostSnapshot: hs, guestSnapshot: gs } : null;
  }, 20_000, 150);
  report.postResume = {
    guestId,
    hostMode: await mode(host),
    guestMode: await mode(guest),
    hostLanLine: await lanLine(host),
    guestDriverLine: await driverLine(guest),
    hostRoster: await roster(host),
    guestRoster: await roster(guest),
    active,
  };
  step('rejoined guest returns to the live match with both drivers active', active !== null,
    JSON.stringify({ hostMode: report.postResume.hostMode, guestMode: report.postResume.guestMode, hostLanLine: report.postResume.hostLanLine }));

  const postLoadout = await waitLoadoutSurfaces(host, guest, guestId);
  const retainedLoadout = preLoadout.preflight && postLoadout.preflight
    && postLoadout.guest.state?.id === preLoadout.guest.state?.id
    && postLoadout.host.primaryId === preLoadout.host.primaryId;
  report.postResume.loadout = { pre: preLoadout, post: postLoadout, retained: retainedLoadout };
  step('post-resume loadout retains Deadeye across weaponCmd, HUD, and host actor', retainedLoadout,
    JSON.stringify(report.postResume.loadout));

  let postInventory = null;
  await waitUntil(async () => {
    const [guestSelf, hostState] = await Promise.all([ordnanceSelf(guest), snapshot(host)]);
    const hostActor = hostState?.actors?.find((a) => a.id === guestId) ?? null;
    if (!guestSelf || !hostActor) return null;
    postInventory = {
      guest: guestSelf,
      host: {
        lethal: hostActor.lethal,
        tactical: hostActor.tactical,
        primaryId: hostActor.primaryId,
        rounds: hostActor.rounds,
        armed: hostActor.armed,
      },
    };
    if (!preInventory) return null;
    const retainedCharges = guestSelf.lethal === preInventory.guest.lethal
      && guestSelf.tactical === preInventory.guest.tactical;
    const matchesHost = guestSelf.lethal === preInventory.host.lethal
      && guestSelf.tactical === preInventory.host.tactical;
    const hostStable = hostActor.lethal === preInventory.host.lethal
      && hostActor.tactical === preInventory.host.tactical;
    return retainedCharges && matchesHost && hostStable ? postInventory : null;
  }, 8_000, 150);
  const inventoryParity = preInventory !== null && postInventory !== null
    && (preInventory.guest.lethal > 0 || preInventory.guest.tactical > 0)
    && postInventory.guest.lethal === preInventory.guest.lethal
    && postInventory.guest.tactical === preInventory.guest.tactical
    && postInventory.guest.lethal === preInventory.host.lethal
    && postInventory.guest.tactical === preInventory.host.tactical
    && postInventory.host.lethal === preInventory.host.lethal
    && postInventory.host.tactical === preInventory.host.tactical;
  report.postResume.inventory = { pre: preInventory, post: postInventory, parity: inventoryParity };
  step('post-resume lethal/tactical charges retain positive host-authoritative inventory', inventoryParity,
    JSON.stringify(report.postResume.inventory));

  const postHostSnapshot = active?.hostSnapshot ?? await snapshot(host);
  const postGuestCounters = await counters(guest);
  const preActor = preHostSnapshot?.actors?.find((a) => a.id === guestId) ?? null;
  const postActor = postHostSnapshot?.actors?.find((a) => a.id === guestId) ?? null;
  const lifeStable = preActor !== null && postActor !== null && postActor.life === preActor.life;
  const guestLifeAligned = postGuestCounters !== null && postActor !== null
    && postGuestCounters.lives === postActor.life && postGuestCounters.epoch >= 1;
  report.postResume.life = { preHost: preActor?.life ?? null, postHost: postActor?.life ?? null, guest: postGuestCounters };
  step('life epoch remains authoritative and aligned after rejoin', lifeStable && guestLifeAligned,
    JSON.stringify(report.postResume.life));

  if (active !== null && sameId) {
    const beforeMove = await hostPose(host, guestId);
    await guest.page.bringToFront();
    await guest.page.keyboard.down('w');
    await sleep(2_000);
    await guest.page.keyboard.up('w');
    await sleep(300);
    const afterMove = await hostPose(host, guestId);
    const delta = beforeMove && afterMove ? Math.hypot(afterMove.x - beforeMove.x, afterMove.z - beforeMove.z) : 0;
    report.postResume.move = { before: beforeMove, after: afterMove, deltaM: delta };
    step('rejoined guest movement advances the original host seat by 5 m', delta > 5, JSON.stringify(report.postResume.move));
    await guestDamageHostAfterResume(host, guest);
  } else {
    step('rejoined guest movement advances the original host seat by 5 m', false, 'skipped because live resume gate failed');
    step('post-resume guest firearm shot is accepted by the host', false, 'skipped because live resume gate failed');
    step('post-resume guest shot damages the authoritative host target', false, 'skipped because live resume gate failed');
  }
} catch (error) {
  say('EXCEPTION ' + String(error).slice(0, 600));
  code = 1;
} finally {
  report.errors = { host: errors.host.slice(0, 12), guest: errors.guest.slice(0, 12) };
  const noErrors = report.errors.host.length === 0 && report.errors.guest.length === 0;
  step('both stock Chrome pages stayed free of console/page errors', noErrors, JSON.stringify(report.errors));
  try { if (guest) await guest.close(); } catch (error) { say('guest cleanup ' + String(error).slice(0, 220)); code = 1; }
  try { if (host) await host.close(); } catch (error) { say('host cleanup ' + String(error).slice(0, 220)); code = 1; }
  report.exitCode = code;
  report.elapsedMs = Date.now() - startedAt;
  report.log = log;
  try {
    mkdirSync(dirname(RESULT_PATH), { recursive: true });
    writeFileSync(RESULT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
  } catch (error) {
    say('report persistence ' + String(error).slice(0, 240));
    code = 1;
    report.exitCode = code;
  }
  console.log(JSON.stringify(report));
}
process.exit(code);
