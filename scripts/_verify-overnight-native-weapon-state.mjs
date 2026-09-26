/** Weapon-state pass: native short/full Railgun holds, real magazine reload,
 * five earned kills and controlled drone. New product contract; the old instant-
 * fire pilot harness stays frozen and accepted only on its prior runtime.
 * Player position/aim is the ONLY gameplay fixture. No HP, bot, charge, clock,
 * life, admission, pointer-lock or focus-property overrides. Run serially. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';
import { waitForRenderedPage } from './lib/render-ready.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const requestedUrl = option('url', 'http://127.0.0.1:4348/');
const authoredUrl = new URL(requestedUrl);
for (const [key, value] of Object.entries({ lighting: 'authored', glazing: 'canary', motion: 'canary',
  architecture: 'canary', 'facade-kit': 'canary', foliage: 'canary', hands: 'rifle-canary',
  'street-lamps': 'canary', coach: 'canary', 'weapon-finish': 'canary', operator: 'authored',
  lawn: 'canary', audiobank: '2', 'fence-art': 'canary', room: 'authored', 'room-light': 'baked' })) {
  if (!authoredUrl.searchParams.has(key)) authoredUrl.searchParams.set(key, value);
}
const url = authoredUrl.href;
const tag = option('tag', 'overnight-native-weapon-state');
const expectedCommit = option('expected-commit', null);
assert(/^[a-z0-9_-]+$/i.test(tag), 'safe unique tag required');
assert(/^[a-f0-9]{40}$/i.test(expectedCommit ?? ''), '--expected-commit must pin the built runtime');
const out = join(root, 'captures'); mkdirSync(out, { recursive: true });
const reportPath = join(out, `${tag}.json`);
assert(!existsSync(reportPath), 'refusing to overwrite an earlier receipt');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { url, requestedUrl, tag, startedAt: new Date().toISOString(), status: 'OPEN', steps: [], kills: [],
  errors: [], samples: {}, trajectories: [], boundaries: {
    fixture: 'Only player ground position and aim; real director, weapons, damage, rewards and life',
    pointer: 'Playwright default focus emulation cleared, supported bringToFront, trusted Deploy; native lock required',
    grants: 'No permission, health, charge, life, bot, clock, admission or pointer-lock overrides',
    deadlineSeconds: 360, earnSeconds: 180,
  } };
const step = (name, evidence) => { report.steps.push({ name, evidence }); console.log(`[native-weapon-state] PASS ${name}`); };
let owned, cdp, initialLife;
const deadline = Date.now() + 360000;
const self = s => s.snapshot.actors.find(a => a.id === s.id);
const slot = s => self(s).slots.find(s => s.streakId === 'piloted-drone');
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const cameraDistance = (a, b) => Math.hypot(a.camX - b.camX, a.camY - b.camY, a.camZ - b.camZ);
function alive(s) {
  assert(self(s).alive && self(s).deaths === 0 && self(s).life === initialLife, 'one uninterrupted live actor required');
  assert.equal(s.snapshot.match.phase, 'active');
}
async function state() {
  return owned.page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-nt-backend="webgpu"]');
    const hint = document.querySelector('.hud-pilot');
    return { id: window.__NTGAME.localId, snapshot: window.__NTGAME.snapshot(),
      pose: window.__NT.playerPose(), gun: window.__NT.weaponCmd('state'), pilot: window.__NT.pilot(),
      lastWeaponShot: window.__NT.lastWeaponShot(),
      ordnance: window.__NT.ordnance(), counters: window.__NTGAME.counters(), effects: window.__NT.specialEffects(),
      frame: window.__NT.stats(), bots: window.__NTGAME.bots(), menu: window.__AA_UI.menu.state(),
      log: window.__NTGAME.log().slice(-30),
      focus: { focused: document.hasFocus(), visibility: document.visibilityState,
        connected: canvas?.isConnected, rootIsDocument: canvas?.getRootNode() === document,
        nativeLock: document.pointerLockElement === canvas, activation: navigator.userActivation?.isActive },
      pilotHud: { text: hint?.textContent, visible: !!hint && getComputedStyle(hint).display !== 'none' },
    };
  });
}
async function menuDiagnostic() {
  return owned.page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Play solo');
    const rect = button?.getBoundingClientRect();
    const style = e => { const s = getComputedStyle(e), r = e.getBoundingClientRect();
      return { tag: e.tagName, id: e.id, classes: e.className, display: s.display, visibility: s.visibility,
        opacity: s.opacity, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }; };
    const ancestors = []; for (let e = button; e; e = e.parentElement) ancestors.push(style(e));
    return { at: performance.now(), url: location.href, ready: window.__NT?.ready,
      menu: window.__AA_UI?.menu.state(), panel: window.__AA_UI?.menu.panel(), mode: window.__NTGAME?.mode(),
      stats: window.__NT?.stats(), pageFrames: window.__overnightPilotFrames,
      focus: document.hasFocus(), visibility: document.visibilityState, activeTag: document.activeElement?.tagName,
      disabled: button?.disabled, hit: rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.tagName : null,
      ancestors };
  });
}
async function until(read, accept, label, timeout = 15000) {
  const end = Math.min(deadline, Date.now() + timeout); let value;
  do { value = await read(); if (accept(value)) return value; await pause(100); } while (Date.now() < end);
  throw Error(`${label}: ${JSON.stringify(value)}`);
}
async function liveUntil(accept, label, timeout = 15000) {
  return until(state, s => { alive(s); return accept(s); }, label, timeout);
}
async function identity() {
  const r = await fetch(new URL('preview-identity.json', url), { signal: AbortSignal.timeout(5000) });
  assert(r.ok, 'preview identity required'); const value = await r.json();
  assert.equal(value.project, 'atomic-acres'); assert.equal(value.sourceCommit, expectedCommit);
  const entry = await fetch(new URL(value.entry, url), { signal: AbortSignal.timeout(10000) });
  assert(entry.ok); const bytes = new Uint8Array(await entry.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex'); assert.equal(hash, value.entrySha256);
  return { ...value, fetchedEntrySha256: hash, fetchedEntryBytes: bytes.length };
}

// Same permitted player-pose fixture as the retained test. Stand on authored
// ground with collision clearance and real LOS. No director/enemy mutation.
async function positionForEnemy(id) {
  const search = await owned.page.evaluate(targetId => {
    const bot = window.__NTGAME.bots().find(b => b.id === targetId && b.alive);
    const rejected = { bounds: 0, ground: 0, collision: 0, occluded: 0 };
    if (!bot) return { selected: null, target: null, rejected };
    for (const radius of [18, 14, 10, 6, 3.5, 2, 1.5, .8]) for (let i = 0; i < 32; i++) {
      const angle = bot.yaw + i * Math.PI / 16;
      const x = bot.x + Math.sin(angle) * radius, z = bot.z + Math.cos(angle) * radius;
      if (x < -19 || x > 23 || Math.abs(z) > 29) { rejected.bounds++; continue; }
      const y = window.__NTGAME.groundY(x, z), eye = window.__NT.stats().eyeHeight;
      if (!Number.isFinite(y) || y > .5) { rejected.ground++; continue; }
      if (window.__NT.collidersAt(x, z, y + .9).length) { rejected.collision++; continue; }
      if (!window.__NTGAME.los(x, y + eye, z, bot.x, bot.y + 1.1, bot.z)) { rejected.occluded++; continue; }
      const dx = bot.x - x, dz = bot.z - z;
      window.__NT.teleport(x, y, z, Math.atan2(-dx, -dz), Math.atan2(bot.y + 1.1 - y - eye, Math.hypot(dx, dz)));
      return { selected: { x, y, z, radius, targetId }, target: bot, rejected };
    }
    return { selected: null, target: bot, rejected };
  }, id);
  if (!search.selected) {
    report.trajectories.push({ phase: 'no-legal-ground-firing-pose', remainingEarnMs: report.earnDeadline - Date.now(), ...search });
    return null;
  }
  await pause(200); return search.selected;
}
async function aimAtEnemy(id) {
  if (id === null) return true;
  return owned.page.evaluate(targetId => {
    const bot = window.__NTGAME.bots().find(b => b.id === targetId && b.alive);
    if (!bot) return false;
    const p = window.__NT.playerPose(), dx = bot.x - p.x, dz = bot.z - p.z;
    window.__NT.teleport(p.x, p.y, p.z, Math.atan2(-dx, -dz),
      Math.atan2(bot.y + 1.1 - p.camY, Math.hypot(dx, dz)));
    return true;
  }, id);
}
async function aimAndFire(id = null) {
  const before = await state(); alive(before);
  assert(before.snapshot.weaponState, 'private host weapon state required');
  assert(before.focus.nativeLock && before.focus.focused, 'native focused lock required');
  if (!await aimAtEnemy(id)) return false;
  const phases = [], end = Math.min(deadline, Date.now() + 6000);
  await owned.page.mouse.down();
  try {
    let charged = false, current;
    do {
      await aimAtEnemy(id); await pause(70); current = await state(); alive(current);
      const w = current.snapshot.weaponState;
      assert(w && w.life === initialLife, 'host weapon state must retain current life');
      assert.equal(w.primary.chargeRequiredMs, 750, 'frozen Rail charge duration must remain 750ms');
      phases.push({ at: w.at, revision: w.revision, lastIntentSeq: w.lastIntentSeq,
        lastIntentReason: w.lastIntentReason, mag: w.primary.mag,
        chargeElapsedMs: w.primary.chargeElapsedMs, chargeRequiredMs: w.primary.chargeRequiredMs });
      report.activeChargePhases = phases;
      charged ||= w.primary.chargeElapsedMs !== null;
      const chargeHud = owned.page.locator('.hud-reload');
      const chargeText = await chargeHud.textContent();
      phases.at(-1).hud = { text: chargeText, charging: current.gun.charging, pending: current.gun.actionPending };
      // Authority can acknowledge on the input callback before the next RAF
      // presents it. Require the same actual HUD during a later live charge
      // sample, rather than treating that earlier callback as a rendered frame.
      if (!report.chargingFrame && w.primary.chargeElapsedMs !== null && w.primary.chargeElapsedMs < 750
        && current.gun.charging && !current.gun.actionPending && /CHARGING/.test(chargeText ?? '') && await chargeHud.isVisible()) {
        await owned.page.screenshot({ path: join(out, `${tag}-charging.png`) });
        report.chargingFrame = `${tag}-charging.png`;
      }
      if (self(current).rounds === self(before).rounds - 1) break;
    } while (Date.now() < end);
    assert(charged, 'host must actually acknowledge a charging phase');
    assert(report.chargingFrame, 'actual visible charge HUD must be captured during an admitted incomplete hold');
    const firstCharge = phases.find(p => p.chargeElapsedMs !== null);
    assert(firstCharge && current.lastWeaponShot.weaponId === 'railgun'
      && current.lastWeaponShot.seq > before.lastWeaponShot.seq
      && current.snapshot.weaponState.resolvedShotSeqs.includes(current.lastWeaponShot.seq),
      'exact new original firearm claim must have a private host acknowledgement');
    assert(current.lastWeaponShot.at - (firstCharge.at - firstCharge.chargeElapsedMs) >= 750,
      'the exact admitted claim timestamp must follow the fixed750ms host charge span');
    assert.equal(self(current).rounds, self(before).rounds - 1, 'native full hold admits exactly one issued round');
    const afterFirst = current;
    await pause(350); current = await state(); alive(current);
    assert.equal(self(current).rounds, self(afterFirst).rounds, 'continued hold cannot auto-repeat');
    report.trajectories.push({ phase: 'native-host-charged-shot', targetId: id, phases,
      ownRoundsBefore: self(before).rounds, ownRoundsAfter: self(current).rounds });
    return true;
  } finally { await owned.page.mouse.up(); }
}
// A real bot frag killed the earlier attempt while it waited near the corpse.
// Reposition only the player to existing clear ground away from bodies/flights.
// This is disclosed staging, not proof of human traversal or perfect survival.
async function retreat(forPilot = false) {
  const p = await owned.page.evaluate(forPilot => {
    const bots = window.__NTGAME.bots(), flights = window.__NT.ordnance().flights ?? [];
    const candidates = [];
    for (const x of [-18, -14, -8, 8, 14, 20]) for (const z of [-26, -20, 20, 26]) {
      const y = window.__NTGAME.groundY(x, z);
      if (!Number.isFinite(y) || y > .5 || window.__NT.collidersAt(x, z, y + .9).length) continue;
      const yaw = z < 0 ? Math.PI : 0;
      // The actual host spawns this aircraft at ground + 8m. Validate the
      // intended W+E diagonal corridor inside the playable rectangle, with
      // real LOS and ground queries; do not assume ground clearance is flight clearance.
      const flightStart = { x, y: y + 8, z };
      const flightEnd = { x, y: y + 14, z: z - Math.cos(yaw) * 6 };
      if (forPilot && (flightEnd.x < -19.5 || flightEnd.x > 25 || Math.abs(flightEnd.z) > 42
        || !window.__NTGAME.los(x, y + 8, z, flightEnd.x, flightEnd.y, flightEnd.z)
        || Array.from({ length: 7 }, (_, i) => window.__NTGAME.groundY(x, z - Math.cos(yaw) * i))
          .some(height => !Number.isFinite(height) || height > .5))) continue;
      const gap = Math.min(...bots.map(b => Math.hypot(b.x - x, b.z - z)), ...flights.map(f => Math.hypot(f.x - x, f.z - z)));
      const concealed = bots.every(b => !window.__NTGAME.los(x, y + 1.1, z, b.x, b.y + 1.1, b.z));
      candidates.push({ x, y, z, gap, concealed, yaw, ...(forPilot ? { flightStart, flightEnd } : {}) });
    }
    candidates.sort((a, b) => Number(b.concealed) - Number(a.concealed) || b.gap - a.gap);
    const p = candidates.find(p => p.gap > 15);
    if (!p) return null;
    window.__NT.teleport(p.x, p.y, p.z, p.yaw, 1.1); return p;
  }, forPilot);
  assert(p, 'clear retreat ground away from existing threat required');
  report.trajectories.push({ phase: 'player-only-retreat', ...p }); await pause(120);
}

try {
  report.identity = await identity();
  report.harnessSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  owned = await stockBrowser(tag); const { page } = owned;
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text().slice(0, 400)); });
  // Passive observer only: never prevent/cancel events or replace browser APIs.
  await page.addInitScript(() => {
    window.__overnightPilotEvents = [];
    window.__overnightPilotFrames = 0;
    function observeFrame() { window.__overnightPilotFrames++; requestAnimationFrame(observeFrame); }
    requestAnimationFrame(observeFrame);
    for (const type of ['focus', 'blur', 'pointerlockchange', 'pointerlockerror', 'mousedown', 'mouseup', 'click', 'keydown']) {
      addEventListener(type, e => {
        const rows = window.__overnightPilotEvents;
        rows.push({ type, at: performance.now(), trusted: e.isTrusted, code: e.code, button: e.button,
          target: e.target?.tagName, label: e.target?.tagName === 'BUTTON' ? e.target.textContent?.slice(0, 48) : null,
          focus: document.hasFocus(), visibility: document.visibilityState,
          lock: document.pointerLockElement?.tagName ?? null, active: navigator.userActivation?.isActive });
        if (rows.length > 160) rows.shift();
      }, true);
    }
  });
  cdp = await page.context().newCDPSession(page);
  report.browser = await cdp.send('Browser.getVersion');
  report.focusHarness = { playwrightDefault: 'installed1.63 sends focus emulation enabled:true on attach',
    change: 'clear that emulation, then ordinary Page.bringToFront; no synthetic focus or pointer lock' };
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  // Match the successfully executed profiler's ordering: activate this owned
  // page before navigation, without enabling emulated focus.
  await page.bringToFront();
  const expectedEntryUrl = new URL(report.identity.entry, url).href;
  const loadedModulePromise = page.waitForResponse(response => response.url() === expectedEntryUrl
    && response.request().resourceType() === 'script', { timeout: 90000 });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  const loadedModule = await loadedModulePromise;
  assert.equal(createHash('sha256').update(await loadedModule.body()).digest('hex'), report.identity.entrySha256,
    'actual browser-loaded module bytes must match exact source-stamped entry');
  const menuReadyDeadline = Date.now() + 90000;
  await waitForRenderedPage(page, 90000);
  assert.equal(await page.evaluate(() => window.__NT_BACKEND?.actual), 'webgpu');
  report.samples.beforeMenu = await menuDiagnostic();
  // A renderer invocation can precede a cold shader stall. Require three
  // actual page frames and a genuinely visible home panel before the same
  // ordinary 15s click. This is readiness, not force-click or DOM visibility.
  const beforeFrames = report.samples.beforeMenu.pageFrames;
  await page.waitForFunction(before => {
    const menu = window.__AA_UI.menu;
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Play solo');
    const r = button?.getBoundingClientRect(), s = button && getComputedStyle(button);
    return window.__overnightPilotFrames >= before + 3 && menu.state().surface === 'pre-match'
      && menu.panel() === 'main' && r?.width > 0 && r?.height > 0 && !button.disabled
      && s.display !== 'none' && s.visibility === 'visible';
  }, beforeFrames, { timeout: Math.max(1, menuReadyDeadline - Date.now()), polling: 100 });
  report.samples.menuReady = await menuDiagnostic();
  const loadedEntry = await page.evaluate(() => [...document.scripts].find(s => s.type === 'module' && s.src)?.src);
  assert.equal(new URL(loadedEntry).pathname, new URL(report.identity.entry, url).pathname,
    'actual loaded module must match the source-stamped entry');
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await page.locator('.aa-prim').filter({ has: page.locator('.aa-prim-name', { hasText: /^Railgun$/ }) }).click();
  await page.getByLabel('Bots', { exact: true }).focus(); await page.keyboard.press('Home');
  assert.equal(await page.getByLabel('Bots', { exact: true }).inputValue(), '1');
  await page.getByRole('radio', { name: 'Recruit', exact: true }).click();
  await page.getByLabel('Mode', { exact: true }).selectOption('ffa');
  await page.getByLabel('Kill limit', { exact: true }).selectOption('25');
  await page.getByLabel('Time limit', { exact: true }).selectOption('600000');
  await page.getByLabel('Killstreak slot 3', { exact: true }).selectOption('piloted-drone');
  await page.bringToFront();
  report.samples.beforeDeploy = await page.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState }));
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.waitForFunction(() => { try { return window.__NTGAME.snapshot().match.phase === 'active'; } catch { return false; } }, null, { timeout: 30000 });
  let current = await state(); initialLife = self(current).life; alive(current);
  assert.equal(current.gun.id, 'railgun'); assert.equal(slot(current).slot, 3); assert.equal(slot(current).charges, 0);
  report.samples.deployed = current;
  // Fail early with genuine focus/lock diagnostics, instead of spending five
  // kills on a platform that cannot admit the required mouse controls.
  current = await liveUntil(s => s.focus.nativeLock && s.focus.focused && s.focus.visibility === 'visible',
    'trusted Deploy must acquire real focused canvas pointer lock', 5000);
  assert(await page.evaluate(() => window.__overnightPilotEvents.some(e => e.type === 'click'
    && e.trusted && e.target === 'BUTTON' && e.label === 'Deploy' && e.active)), 'Deploy must be a trusted active browser gesture');
  report.samples.nativeLock = current;
  report.timing = { startupMs: 360000 - (deadline - Date.now()), remainingTotalMs: deadline - Date.now() };
  step('trusted real-menu deployment acquired native canvas pointer lock before any kills', current.focus);

  // This is a new native held-charge contract, not a renamed repair of the
  // exhausted prior instant-fire harness. All its life/earn/pilot gates remain.
  await retreat();
  await page.evaluate(() => document.exitPointerLock());
  await liveUntil(s => !s.focus.nativeLock && s.menu.surface === 'paused-match',
    'supported focused unlock must open the actual pause menu');
  const unlocked = await state();
  await page.keyboard.press('KeyR');
  await pause(100);
  const deniedUnlocked = await state();
  assert.equal(deniedUnlocked.snapshot.weaponState.lastIntentSeq, unlocked.snapshot.weaponState.lastIntentSeq,
    'native reload while paused cannot start an authority intent');
  assert.equal(deniedUnlocked.snapshot.weaponState.primary.chargeElapsedMs, null);
  assert.equal(self(deniedUnlocked).rounds, self(unlocked).rounds);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await liveUntil(s => s.focus.nativeLock && s.menu.surface === 'hidden',
    'ordinary Resume gesture must reacquire native lock');
  step('native reload while genuinely paused cannot start a weapon action', deniedUnlocked.snapshot.weaponState);
  const beforeShort = await state();
  assert(beforeShort.snapshot.weaponState, 'private authority must be present at deploy');
  let duringShort;
  await page.mouse.down();
  try {
    await pause(100); duringShort = await state(); alive(duringShort);
    const charging = duringShort.snapshot.weaponState;
    assert.equal(charging.primary.chargeRequiredMs, 750, 'frozen Rail charge duration');
    assert(charging.primary.chargeElapsedMs !== null && charging.primary.chargeElapsedMs < charging.primary.chargeRequiredMs,
      'short-hold negative control must first observe an admitted incomplete host charge');
    assert(charging.lastIntentSeq > beforeShort.snapshot.weaponState.lastIntentSeq
      && charging.lastIntentReason === null, 'charge start must receive a genuine accepted authority acknowledgement');
  } finally { await page.mouse.up(); }
  await pause(350);
  const afterShort = await state(); alive(afterShort);
  assert.equal(self(afterShort).rounds, self(beforeShort).rounds, 'short native hold cannot spend a round');
  assert.equal(afterShort.snapshot.weaponState.primary.chargeElapsedMs, null, 'early release cancels host charge');
  report.samples.shortHold = { before: beforeShort, during: duringShort, after: afterShort };
  step('short native hold cancels without spending authoritative ammunition', afterShort.snapshot.weaponState);
  report.nativeReloads = [];
  const earnEnd = Math.min(deadline, Date.now() + 180000);
  report.earnDeadline = earnEnd;
  while (self(current).kills < 5 && Date.now() < earnEnd) {
    alive(current); assert(current.focus.nativeLock, 'native lock lost while earning');
    if (!current.gun.mag && !current.gun.reloading) {
      const beforeReload = await state();
      await page.keyboard.press('KeyR');
      const reloading = await liveUntil(s => s.snapshot.weaponState?.primary.reloadRemainingMs > 0,
        'native reload must be admitted by host');
      report.nativeReloads.push({ before: beforeReload.snapshot.weaponState, during: reloading.snapshot.weaponState });
      await page.screenshot({ path: join(out, `${tag}-reloading.png`) });
      const completed = await liveUntil(s => s.snapshot.weaponState?.primary.reloadRemainingMs === 0
        && s.snapshot.weaponState.primary.mag > beforeReload.snapshot.weaponState.primary.mag,
        'native reload must complete through host reserve transfer');
      const beforeAmmo = beforeReload.snapshot.weaponState.primary, afterAmmo = completed.snapshot.weaponState.primary;
      assert.equal(afterAmmo.mag + afterAmmo.reserve, beforeAmmo.mag + beforeAmmo.reserve,
        'completed reload conserves issued ammunition');
      assert.equal(afterAmmo.mag - beforeAmmo.mag, beforeAmmo.reserve - afterAmmo.reserve,
        'host magazine gain must exactly match reserve loss');
      report.nativeReloads.at(-1).completed = completed.snapshot.weaponState;
      current = completed;
    }
    if (!current.gun.mag || current.gun.reloading || current.gun.cool > 0) { await pause(150); current = await state(); continue; }
    const enemy = current.bots.find(b => b.alive && b.id !== current.id);
    if (!enemy) { await pause(150); current = await state(); continue; }
    const kills = self(current).kills;
    const firingPose = await positionForEnemy(enemy.id);
    if (!firingPose) {
      // A live bot can be upstairs or behind cover. Keep the same deadline,
      // life and LOS requirements while its real director continues to move.
      await retreat(); await pause(500); current = await state(); continue;
    }
    const beforeShot = await state(); alive(beforeShot);
    assert.equal(await aimAndFire(enemy.id), true, 'normal controller accepts earned-kill shot');
    await pause(180); current = await state(); alive(current);
    assert(current.snapshot.stats.shotsAdmitted > beforeShot.snapshot.stats.shotsAdmitted, 'shot must reach authoritative admission');
    assert.equal(self(current).rounds, self(beforeShot).rounds - 1, 'this player shot must spend exactly one issued round');
    assert(!current.log.some(line => line.includes(` shot-reject ${current.id} `) && !beforeShot.log.includes(line)),
      'no new rejection of this player shot is allowed');
    if (self(current).kills > kills) {
      report.kills.push({ firingPose, ownRoundsBefore: self(beforeShot).rounds, actor: self(current), stats: current.snapshot.stats, gun: current.gun });
      console.log(`[native-weapon-state] earned ${self(current).kills}/5`);
    }
    // Real cooldown/reload and corpse-fuse time continue; no time or bot freeze.
    await retreat(); current = await state();
  }
  alive(current); assert.equal(self(current).kills, 5); assert.equal(slot(current).charges, 1);
  assert(current.snapshot.stats.shotsAdmitted >= 5 && current.snapshot.stats.hitsLanded >= 5);
  assert(report.nativeReloads.length >= 1, 'earning five kills must include a real reload of the four-round Railgun');
  report.samples.earned = current; step('five real kills in the original life earn exactly one drone charge', self(current));
  await retreat(true); current = await liveUntil(s => !s.gun.reloading && s.gun.cool <= 0, 'body weapon cooldown before possession');
  const parked = current.pose;
  await page.keyboard.press('Digit5');
  const entered = await liveUntil(s => s.pilot.active, 'earned platform did not enter possession');
  assert.equal(slot(entered).charges, 0); assert(entered.focus.nativeLock); assert(!entered.gun.visible);
  assert.equal(entered.effects.streaks.craft, 1, 'actual world aircraft pool must show the earned platform');
  assert(entered.pilotHud.visible && /PILOTED DRONE.*HP/.test(entered.pilotHud.text));
  assert(entered.pose.camY > entered.pose.y + 5); assert(distance(parked, entered.pose) < .02);
  assert.equal(await page.evaluate(() => window.__NT.weaponCmd('fire')), false, 'ordinary body firearm is suppressed');
  await page.keyboard.press('KeyG'); await page.keyboard.press('KeyV');
  report.samples.entered = entered;
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyE');
  try { await pause(600); } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('KeyE'); }
  const moved = await state(); alive(moved);
  assert(moved.pilot.active && moved.focus.nativeLock); assert(distance(entered.pose, moved.pose) < .02);
  assert(cameraDistance(entered.pose, moved.pose) > 1); assert(moved.pose.camY > entered.pose.camY + .3);
  assert(moved.pilot.lastSentAt > entered.pilot.lastSentAt);
  await page.mouse.move(820, 450); await page.mouse.move(844, 464); await pause(120);
  const aimed = await state(); alive(aimed);
  assert(Math.abs(aimed.pilot.yaw - moved.pilot.yaw) + Math.abs(aimed.pilot.pitch - moved.pilot.pitch) > .001,
    'native locked mouse must aim the aircraft');
  let firing;
  await page.mouse.down(); try { await pause(350); firing = await state(); } finally { await page.mouse.up(); }
  alive(firing); assert(firing.pilot.firing); assert.equal(firing.gun.mag, entered.gun.mag);
  assert(firing.pilot.hostShots > aimed.pilot.hostShots,
    'actual host aircraft shot counter must acknowledge the native drone trigger');
  assert(await page.evaluate(() => window.__overnightPilotEvents.some(e => e.type === 'mousedown'
    && e.trusted && e.target === 'CANVAS' && e.lock === 'CANVAS')), 'drone trigger must be a trusted pointer-locked canvas gesture');
  assert.equal(self(firing).rounds, self(entered).rounds); assert.equal(self(firing).lethal, self(entered).lethal);
  assert.equal(self(firing).tactical, self(entered).tactical);
  report.samples.controlled = firing; report.trajectories.push({ phase: 'host-derived-pilot-camera', before: entered.pose, after: moved.pose });
  await page.screenshot({ path: join(out, `${tag}-controlled.png`) });
  step('host-derived aircraft camera moves and aims while the body and issued kit stay parked', { moved: moved.pose, aimed: aimed.pilot, firing: firing.pilot });

  await page.keyboard.press('Escape');
  const returned = await liveUntil(s => !s.pilot.active, 'Escape must exit possession');
  assert(distance(parked, returned.pose) < .02); assert(returned.gun.visible && !returned.pilotHud.visible);
  assert(Math.abs(returned.pose.camY - returned.pose.y - returned.frame.eyeHeight) < .05);
  assert.equal(returned.menu.surface, 'hidden', 'drone Escape must restore the body without pausing');
  report.samples.returned = returned;
  await page.keyboard.press('Digit5');
  const again = await liveUntil(s => s.pilot.active, 'same paid platform must re-enter');
  assert.equal(again.pilot.instanceId, entered.pilot.instanceId); assert.equal(slot(again).charges, 0);
  report.samples.reentered = again;
  // Let the paid platform expire naturally while possessed. No timestamp warp.
  const expired = await liveUntil(s => !s.pilot.active, 'natural platform expiry must restore body', 35000);
  assert(distance(parked, expired.pose) < .02); assert(expired.gun.visible && !expired.pilotHud.visible);
  assert.equal(slot(expired).charges, 0); assert.equal(expired.menu.surface, 'hidden');
  assert(expired.log.some(line => line.includes('streak-ended piloted-drone expired')), 'authoritative natural-expiry event required');
  assert.equal(expired.effects.streaks.craft, 0, 'expired platform must leave the visible aircraft pool');
  report.samples.expired = expired;
  await page.keyboard.press('Digit5'); await pause(250);
  const denied = await state(); alive(denied); assert(!denied.pilot.active);
  assert(denied.counters.streakDenied > expired.counters.streakDenied, 'expired platform cannot be re-created without a charge');
  assert(denied.log.some(line => line.includes(` streak-denied ${denied.id} slot3 not-earned`)
    && !expired.log.includes(line)), 'this player slot 3 must receive a new authoritative not-earned denial');
  if (!denied.gun.mag) await page.keyboard.press('KeyR');
  await liveUntil(s => s.gun.mag > 0 && !s.gun.reloading && s.gun.cool <= 0, 'normal body weapon ready again');
  const beforeShot = await state();
  const accepted = await aimAndFire(null);
  assert.equal(accepted, true); await pause(150);
  const afterShot = await state(); alive(afterShot);
  assert.equal(self(afterShot).rounds, self(beforeShot).rounds - 1, 'body firing spends issued ammunition again');
  await page.screenshot({ path: join(out, `${tag}-returned.png`) });
  step('Escape, same-instance re-entry, natural expiry and ordinary body firing restore correctly', { instanceId: again.pilot.instanceId, ended: expired.log });
  assert.equal(report.errors.length, 0, 'browser errors remain failures');
  const finalIdentity = await identity(); assert.equal(finalIdentity.entrySha256, report.identity.entrySha256);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
  if (owned) try { report.samples.menuFailure = await menuDiagnostic(); } catch { /* no DOM */ }
  if (owned) try { report.samples.failure = await state(); } catch { /* pre-match failure still has passive events */ }
  console.error(report.failure);
} finally {
  if (owned) try { report.inputEvents = await owned.page.evaluate(() => window.__overnightPilotEvents ?? []); } catch { /* closed page */ }
  try { await cdp?.detach(); } catch { /* owned page may already be closed */ }
  await owned?.close(); report.endedAt = new Date().toISOString();
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, kills: report.kills.length, steps: report.steps.length, report: `captures/${tag}.json` }));
}
