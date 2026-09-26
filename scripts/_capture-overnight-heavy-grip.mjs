/** Art-only actual-game capture. No director/inventory/authority mutation.
 * One minimum Recruit remains live because the product has no zero-bot option.
 * Root owns the serial GPU slot; this script never builds or starts a server. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';
import { waitForRenderedPage } from './lib/render-ready.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const expectedCommit = opt('expected-commit', ''), expectedHash = opt('expected-entry-sha256', '');
const tag = opt('tag', 'overnight-heavy-grip-canary'), variant = opt('variant', 'canary');
const poseFrom = opt('pose-from', null);
const motionRequested = args.includes('--motion');
assert(/^[a-f0-9]{40}$/i.test(expectedCommit)); assert(/^[a-f0-9]{64}$/i.test(expectedHash));
assert(/^[a-z0-9_-]+$/i.test(tag)); assert(['canary', 'baseline'].includes(variant));
assert(variant !== 'canary' || poseFrom, 'canary requires --pose-from <fresh baseline report.json> for identical cameras');
const url = new URL(opt('url', 'http://127.0.0.1:4361/'));
for (const [key, value] of Object.entries({ lighting: 'authored', glazing: 'canary', motion: 'canary',
  architecture: 'canary', 'facade-kit': 'canary', foliage: 'canary', hands: 'rifle-canary',
  'street-lamps': 'canary', coach: 'canary', 'weapon-finish': 'canary', operator: 'authored',
  lawn: 'canary', audiobank: '2', 'fence-art': 'canary', room: 'authored', 'room-light': 'baked' })) {
  if (!url.searchParams.has(key)) url.searchParams.set(key, value);
}
if (variant === 'canary') url.searchParams.set('heavy-hands', 'canary');
else url.searchParams.delete('heavy-hands');
const out = join(root, 'captures', tag);
assert(!existsSync(out), 'preserve earlier/rejected frames: choose a fresh tag'); mkdirSync(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { status: 'OPEN', scope: 'Art capture only, not gameplay/performance/art acceptance',
  startedAt: new Date().toISOString(), url: url.href, variant, expectedCommit, expectedHash,
  harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))), frames: [], errors: [], samples: {},
  dynamicActors: 'Minimum1 live Recruit through actual menu; no zero-bot option, removal, freeze, HP or authority override',
  fixedView: { width: 1600, height: 900, x: -4, z: -34.3, yaw: Math.PI, pitch: 0 },
  browserSetup: 'Clear default Playwright focus emulation; bringToFront before navigation; native trusted Deploy/canvas lock',
  mountBudgetReadout: 'Current public weapon state exposes hands transforms and imported socket names, not mount matrices or mesh/triangle budgets; use separate actual-loader CPU receipt',
  openReview: 'Neutral front/side/three-quarter model views remain open; sky backdrop is not a neutral model turntable. Optional motion requires separate pixel review.',
  motion: { requested: motionRequested, status: motionRequested ? 'OPEN' : 'NOT_REQUESTED',
    settings: { format: 'jpeg', quality: 80, everyNthFrame: 1 }, targetSeconds: [8, 15],
    note: 'Actual CDP frame timestamps; action-phase labels include real transitions. No interpolation or animation override.',
    frames: [], phaseChanges: [], errors: [] },
  poseFixture: 'Only player ground position and aim for fixed art views. All weapon states use native mouse/keyboard.' };
let owned, cdp, initialLife;
let motionPhase = null, motionAccept = false, motionTimer, motionStopPromise, motionHandler;
const motionAcks = new Set();
function motionPhaseTo(phase) {
  if (!motionAccept) return;
  motionPhase = phase;
  report.motion.phaseChanges.push({ phase, receivedAtMs: Date.now() });
}
async function startMotion() {
  if (!motionRequested) return;
  mkdirSync(join(out, 'motion'));
  motionAccept = true; report.motion.startedAtMs = Date.now(); motionPhaseTo('hip');
  motionHandler = event => {
    // Acknowledge immediately, before decoding/writing. Never block Chrome's
    // next frame on filesystem completion or synthesize a renderer callback.
    const ack = cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
      .catch(error => report.motion.errors.push(`ack: ${error}`));
    motionAcks.add(ack); void ack.finally(() => motionAcks.delete(ack));
    if (!motionAccept) return;
    try {
      const timestamp = event.metadata.timestamp;
      assert(Number.isFinite(timestamp), 'CDP frame swap timestamp required');
      const index = report.motion.frames.length;
      assert(index < 1000, 'bounded motion frame count exceeded');
      const first = report.motion.frames[0];
      if (first && timestamp - first.timestampSeconds > 15) return;
      const file = `frame-${String(index).padStart(5, '0')}-${Math.round(timestamp * 1000000)}.jpg`;
      const bytes = Buffer.from(event.data, 'base64');
      writeFileSync(join(out, 'motion', file), bytes);
      report.motion.frames.push({ file, phase: motionPhase, timestampSeconds: timestamp,
        receivedAtMs: Date.now(), metadata: event.metadata, bytes: bytes.length, sha256: hash(bytes) });
    } catch (error) {
      motionAccept = false; report.motion.errors.push(String(error));
    }
  };
  cdp.on('Page.screencastFrame', motionHandler);
  await cdp.send('Page.startScreencast', report.motion.settings);
  motionTimer = setTimeout(() => { void stopMotion('15-second capture cap').catch(error => report.motion.errors.push(String(error))); }, 15000);
}
async function stopMotion(reason = 'completed native Minigun sequence') {
  if (!report.motion.startedAtMs) return;
  if (motionStopPromise) return motionStopPromise;
  motionAccept = false; clearTimeout(motionTimer);
  motionStopPromise = (async () => {
    try { await cdp.send('Page.stopScreencast'); }
    finally {
      cdp.off('Page.screencastFrame', motionHandler); await Promise.all(motionAcks);
      report.motion.stoppedAtMs = Date.now(); report.motion.stopReason = reason;
    }
  })();
  return motionStopPromise;
}
function writeMotionManifest() {
  if (!report.motion.startedAtMs) return;
  const frames = report.motion.frames;
  report.motion.durationSeconds = frames.length < 2 ? 0 : frames.at(-1).timestampSeconds - frames[0].timestampSeconds;
  writeFileSync(join(out, 'motion', 'manifest.json'), JSON.stringify(report.motion, null, 2));
  // Preserve source timing for root's separately verified local ffmpeg encode.
  // No invented duration or duplicate frame is appended at the end.
  const lines = ['ffconcat version 1.0'];
  frames.forEach((frame, i) => {
    lines.push(`file '${frame.file}'`);
    if (i + 1 < frames.length) lines.push(`duration ${(frames[i + 1].timestampSeconds - frame.timestampSeconds).toFixed(6)}`);
  });
  writeFileSync(join(out, 'motion', 'frames.ffconcat'), lines.join('\n') + '\n');
}
async function identity() {
  const r = await fetch(new URL('preview-identity.json', url), { signal: AbortSignal.timeout(5000) });
  assert(r.ok); const value = await r.json();
  assert.equal(value.project, 'atomic-acres'); assert.equal(value.sourceCommit, expectedCommit);
  assert.equal(value.entrySha256, expectedHash);
  const entry = await fetch(new URL(value.entry, url), { signal: AbortSignal.timeout(10000) }); assert(entry.ok);
  const bytes = new Uint8Array(await entry.arrayBuffer()); assert.equal(hash(bytes), expectedHash);
  return { ...value, fetchedEntryBytes: bytes.length, fetchedEntrySha256: hash(bytes) };
}
async function menuDiagnostic() {
  return owned.page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Play solo');
    const r = button?.getBoundingClientRect(), s = button && getComputedStyle(button);
    return { menu: window.__AA_UI?.menu.state(), panel: window.__AA_UI?.menu.panel(), mode: window.__NTGAME?.mode(),
      focus: document.hasFocus(), visibility: document.visibilityState, frames: window.__heavyGripPageFrames,
      stats: window.__NT?.stats(), button: r && { x: r.x, y: r.y, width: r.width, height: r.height,
        display: s.display, visibility: s.visibility, disabled: button.disabled } };
  });
}
async function state() {
  return owned.page.evaluate(() => {
    const snapshot = window.__NTGAME.snapshot(), canvas = document.querySelector('canvas[data-nt-backend="webgpu"]');
    return { at: performance.now(), snapshot, actor: snapshot.actors.find(a => a.id === window.__NTGAME.localId),
      gun: window.__NT.weaponCmd('state'), kit: window.__NT.weaponCmd('loadout'),
      pose: window.__NT.playerPose(), stats: window.__NT.stats(), menu: window.__AA_UI.menu.state(),
      nativeLock: document.pointerLockElement === canvas, focus: document.hasFocus(),
      bots: window.__NTGAME.bots(), ordnance: window.__NT.ordnance(),
      logs: window.__NTGAME.log().slice(-20), activeQuery: location.search };
  });
}
async function until(accept, label, timeout = 15000) {
  const end = Date.now() + timeout; let s;
  do {
    s = await state(); assert(s.actor.alive && s.actor.life === initialLife && s.actor.deaths === 0, 'live initial actor required');
    assert.equal(s.snapshot.match.phase, 'active'); assert.equal(s.kit.primary, 'minigun'); assert.equal(s.kit.sidearm, 'magnum');
    if (accept(s)) return s; await pause(80);
  } while (Date.now() < end);
  throw Error(`${label}: ${JSON.stringify(s)}`);
}
async function selectFixedPose() {
  const inherited = poseFrom ? JSON.parse(readFileSync(poseFrom, 'utf8')) : null;
  if (inherited) {
    assert.equal(inherited.variant, 'baseline');
    assert(inherited.samples?.poseAdmission, 'baseline receipt must contain actual admitted pose evidence');
    assert(inherited.frames.some(f => f.name === 'minigun-hip'), 'baseline hip comparison frame required');
  }
  const selection = await owned.page.evaluate(pinned => {
    const bots = window.__NTGAME.bots(), flights = window.__NT.ordnance().flights ?? [];
    const points = pinned ? [pinned] : [
      { x: -6, z: 0, yaw: -Math.PI / 2 },
      ...[-17, -12, -6, 6, 16, 22].flatMap(x => [-38, -31, 31, 38].map(z => ({ x, z, yaw: z < 0 ? Math.PI : 0 }))),
    ];
    const candidates = [];
    for (const p of points) {
      const y = window.__NTGAME.groundY(p.x, p.z);
      if (!Number.isFinite(y) || y > .5 || p.x < -19.5 || p.x > 25 || Math.abs(p.z) > 42
        || window.__NT.collidersAt(p.x, p.z, y + .9).length) continue;
      const botGap = Math.min(...bots.map(b => Math.hypot(b.x - p.x, b.z - p.z)));
      const flightGap = Math.min(...flights.map(f => Math.hypot(f.x - p.x, f.z - p.z)));
      const concealed = bots.every(b => !b.alive || !window.__NTGAME.los(p.x, y + 1.1, p.z, b.x, b.y + 1.1, b.z));
      if (botGap < 30 || flightGap < 15 || !concealed) continue;
      candidates.push({ ...p, y, botGap, flightGap: Number.isFinite(flightGap) ? flightGap : null, concealed });
    }
    candidates.sort((a, b) => b.botGap - a.botGap);
    const selected = candidates[0];
    if (selected) window.__NT.teleport(selected.x, selected.y, selected.z, selected.yaw, 0);
    return { selected, candidates, bots, flights };
  }, inherited?.fixedView ?? null);
  report.samples.poseAdmission = selection;
  assert(selection.selected, 'one fixed concealed grounded view must have >30m bot and >15m projectile clearance');
  report.fixedView = { width: 1600, height: 900, ...selection.selected, pitch: 0 };
  if (inherited) report.poseSource = { file: poseFrom, sha256: hash(readFileSync(poseFrom)), fixedView: inherited.fixedView };
  await pause(180);
}
async function stage(pitch = 0, yaw = report.fixedView.yaw) {
  const placed = await owned.page.evaluate(p => {
    const y = window.__NTGAME.groundY(p.x, p.z);
    if (!Number.isFinite(y) || y > .5 || window.__NT.collidersAt(p.x, p.z, y + .9).length) return null;
    window.__NT.teleport(p.x, y, p.z, p.yaw, p.pitch); return { ...p, y };
  }, { ...report.fixedView, pitch, yaw });
  assert(placed, 'fixed actual-ground view must be clear'); await pause(180); return placed;
}
async function frame(name, accept) {
  const before = await until(accept, name);
  const path = join(out, `${name}.png`); await owned.page.screenshot({ path });
  const after = await state(); assert(after.actor.alive && after.actor.life === initialLife);
  assert(accept(after), `${name} state changed during screenshot; retain image as rejected evidence`);
  report.frames.push({ name, file: `${name}.png`, sha256: hash(readFileSync(path)), before, after });
  console.log(`[heavy-grip] captured ${name}`);
}
try {
  report.identity = await identity(); owned = await stockBrowser(tag); const { page } = owned;
  await page.setViewportSize({ width: 1600, height: 900 }); page.setDefaultTimeout(15000);
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text().slice(0, 400)); });
  await page.addInitScript(() => {
    window.__heavyGripPageFrames = 0;
    function observe() { window.__heavyGripPageFrames++; requestAnimationFrame(observe); }
    requestAnimationFrame(observe);
  });
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await page.bringToFront();
  report.browser = await cdp.send('Browser.getVersion');
  await page.goto(url.href, { waitUntil: 'load', timeout: 90000 }); await waitForRenderedPage(page, 90000);
  report.samples.menuEarly = await menuDiagnostic(); const firstFrame = report.samples.menuEarly.frames;
  await page.waitForFunction(before => window.__heavyGripPageFrames >= before + 3
    && window.__AA_UI.menu.state().surface === 'pre-match' && window.__AA_UI.menu.panel() === 'main',
  firstFrame, { timeout: 90000, polling: 100 });
  report.samples.menuReady = await menuDiagnostic();
  assert.equal(await page.evaluate(() => window.__NT_BACKEND?.actual), 'webgpu');
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await page.locator('.aa-prim').filter({ has: page.locator('.aa-prim-name', { hasText: /^Minigun$/ }) }).click();
  await page.locator('.aa-sidearm').filter({ has: page.locator('.aa-prim-name', { hasText: /^Magnum$/ }) }).click();
  await page.getByLabel('Bots', { exact: true }).focus(); await page.keyboard.press('Home');
  assert.equal(await page.getByLabel('Bots', { exact: true }).inputValue(), '1');
  await page.getByRole('radio', { name: 'Recruit', exact: true }).click();
  await page.getByLabel('Mode', { exact: true }).selectOption('ffa');
  await page.getByLabel('Time limit', { exact: true }).selectOption('600000');
  await page.getByLabel('Kill limit', { exact: true }).selectOption('25');
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.waitForFunction(() => { try { return window.__NTGAME.snapshot().match.phase === 'active'; } catch { return false; } }, null, { timeout: 30000 });
  // Same successful profiler path: the ordinary canvas click may perform a
  // genuine trigger pull. Its resulting ammo remains spent and is recorded.
  await page.locator('canvas[data-nt-backend="webgpu"]').click();
  await page.waitForFunction(() => document.pointerLockElement === document.querySelector('canvas[data-nt-backend="webgpu"]'), null, { timeout: 5000 });
  const initial = await state(); initialLife = initial.actor.life; report.samples.initial = initial;
  assert.equal(initial.snapshot.actors.filter(a => a.bot).length, 1);
  assert.equal(initial.actor.primaryId, 'minigun'); assert.equal(initial.actor.sidearmId, 'magnum');
  await selectFixedPose();
  await until(s => !!s.gun.referenceModels?.minigun && !!s.gun.referenceModels?.magnum, 'actual imported kit rig load');
  for (const [id, key] of [['minigun', 'Digit1'], ['magnum', 'Digit2']]) {
    const recordThisGun = motionRequested && id === 'minigun';
    await page.keyboard.press(key); await until(s => s.gun.id === id && !s.gun.reloading && s.gun.cool <= 0, `${id} issued selection`);
    await stage();
    if (recordThisGun) { report.motion.before = await state(); await startMotion(); }
    await frame(`${id}-hip`, s => s.gun.id === id && !s.gun.ads && !s.gun.reloading);
    if (recordThisGun) motionPhaseTo('ads');
    await page.mouse.down({ button: 'right' });
    try { await pause(350); await frame(`${id}-ads`, s => s.gun.id === id && s.gun.ads && !s.gun.reloading); }
    finally { await page.mouse.up({ button: 'right' }); }
    if (!recordThisGun) {
      await stage(1.1); await pause(350);
      await frame(`${id}-neutral-sky`, s => s.gun.id === id && !s.gun.ads && !s.gun.reloading);
    }
    if (recordThisGun) motionPhaseTo('hip');
    await stage(); const preFire = await state();
    if (recordThisGun) motionPhaseTo('fire');
    await page.mouse.down();
    try {
      await until(s => s.gun.mag < preFire.gun.mag && (id === 'minigun'
        ? s.actor.rounds < preFire.actor.rounds : s.actor.sidearmRounds < preFire.actor.sidearmRounds),
        `${id} genuine admitted primary/backup firing`);
      await frame(`${id}-firing`, s => s.gun.id === id && s.gun.mag < preFire.gun.mag && !s.gun.reloading);
    } finally { await page.mouse.up(); }
    // Host primary rounds apply to Minigun; Magnum uses the separate issued
    // sidearm inventory. No magazine or reserve is rewritten for a frame.
    if (recordThisGun) motionPhaseTo('reload');
    await page.keyboard.press('KeyR');
    await until(s => s.gun.id === id && s.gun.reloading && s.gun.reloadProgress > .15 && s.gun.reloadProgress < .8, `${id} reload middle`);
    await frame(`${id}-reload`, s => s.gun.id === id && s.gun.reloading);
    await until(s => !s.gun.reloading, `${id} reload completion`);
    if (recordThisGun) motionPhaseTo('turn');
    await stage(); await page.mouse.move(800, 450); await page.mouse.move(900, 450);
    await frame(`${id}-turn`, s => s.gun.id === id && !s.gun.reloading);
    if (recordThisGun) {
      for (let i = 0; i < 12; i++) {
        await page.mouse.move(900 + Math.sin(i * Math.PI / 3) * 45, 450 + Math.cos(i * Math.PI / 3) * 8);
        await pause(170);
        const live = await until(s => s.gun.id === id && !s.gun.reloading, 'live native turn motion');
        assert(live.nativeLock && live.focus, 'motion requires actual focused native pointer lock');
      }
      await stopMotion(); report.motion.after = await state();
      writeMotionManifest();
      assert.equal(report.motion.errors.length, 0, 'screencast failures stay failures');
      const frames = report.motion.frames;
      assert(report.motion.durationSeconds >= 8 && report.motion.durationSeconds <= 15, 'actual motion must span 8–15 seconds');
      assert(frames.every((f, i) => i === 0 || f.timestampSeconds > frames[i - 1].timestampSeconds), 'frame timestamps must advance');
      for (const phase of ['hip', 'ads', 'fire', 'reload', 'turn']) {
        assert(frames.filter(f => f.phase === phase).length >= 2, `actual ${phase} motion frames required`);
      }
      report.motion.status = 'CAPTURED_PENDING_PIXEL_REVIEW';
      await stage(1.1); await pause(350);
      await frame(`${id}-neutral-sky`, s => s.gun.id === id && !s.gun.ads && !s.gun.reloading);
    }
  }
  report.samples.final = await state(); await identity(); assert.equal(report.errors.length, 0, 'browser errors stay failed');
  report.status = 'CAPTURED_PENDING_PIXEL_REVIEW';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
  if (owned) { try { report.samples.menuFailure = await menuDiagnostic(); } catch { /* no page */ }
    try { report.samples.failure = await state(); } catch { /* before active match */ } }
  console.error(report.failure);
} finally {
  try { await stopMotion('capture ended before completed sequence'); }
  catch (error) { report.motion.errors.push(String(error)); report.status = 'FAIL'; process.exitCode = 1; }
  if (report.motion.startedAtMs) {
    if (report.status === 'FAIL') report.motion.status = 'INCOMPLETE_OR_REJECTED';
    writeMotionManifest();
  }
  try { await cdp?.detach(); } catch { /* already closed */ }
  await owned?.close(); report.endedAt = new Date().toISOString();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[heavy-grip] ${report.status}: ${join(out, 'report.json')}`);
}
