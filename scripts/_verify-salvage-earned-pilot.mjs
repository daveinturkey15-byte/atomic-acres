/** Real solo menu -> five real Railgun kills -> earned piloted drone.
 * Player QA positioning/aim is the only fixture: no actor health, bot pose,
 * streak charge, effect, damage, clock or authority injection.
 * Run only in the shared serial browser slot against a built preview. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const url = option('url', 'http://127.0.0.1:4348/');
const tag = option('tag', 'salvage-earned-pilot');
const expectedCommit = option('expected-commit', null);
assert(/^[a-z0-9_-]+$/i.test(tag), 'safe report tag required');
const out = join(root, 'captures'); mkdirSync(out, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { url, tag, startedAt: new Date().toISOString(), status: 'OPEN', steps: [], kills: [], errors: [], samples: {} };
const step = (name, evidence) => { report.steps.push({ name, evidence }); console.log(`[pilot] PASS ${name}`); };
let owned;

async function state() {
  return owned.page.evaluate(() => ({
    id: window.__NTGAME.localId, snapshot: window.__NTGAME.snapshot(),
    pose: window.__NT.playerPose(), gun: window.__NT.weaponCmd('state'),
    pilot: window.__NT.pilot(), ordnance: window.__NT.ordnance(),
    counters: window.__NTGAME.counters(), effects: window.__NT.specialEffects(),
    frame: window.__NT.stats(), bots: window.__NTGAME.bots(),
    menu: window.__AA_UI.menu.state(), log: window.__NTGAME.log().slice(-25),
  }));
}
const self = s => s.snapshot.actors.find(actor => actor.id === s.id);
const pilotSlot = s => self(s).slots.find(slot => slot.streakId === 'piloted-drone');
const bodyDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const cameraDistance = (a, b) => Math.hypot(a.camX - b.camX, a.camY - b.camY, a.camZ - b.camZ);
async function until(read, accept, label, timeout = 15000) {
  const end = Date.now() + timeout; let value;
  do { value = await read(); if (accept(value)) return value; await pause(100); } while (Date.now() < end);
  throw Error(`${label}: ${JSON.stringify(value)}`);
}

/** Place the player in an empty nearby spot, then wait for a real simulation
 * frame before firing. The enemy remains the director's unmodified actor. */
async function positionForEnemy(id) {
  const result = await owned.page.evaluate(targetId => {
    const bot = window.__NTGAME.bots().find(b => b.id === targetId && b.alive);
    if (!bot) return null;
    for (let i = 0; i < 8; i++) {
      const angle = bot.yaw + i * Math.PI / 4;
      const x = bot.x + Math.sin(angle) * 3.5, z = bot.z + Math.cos(angle) * 3.5;
      const y = window.__NTGAME.groundY(x, z), eye = window.__NT.stats().eyeHeight;
      if (!Number.isFinite(y) || window.__NT.collidersAt(x, z, y + .9).length
        || !window.__NTGAME.los(x, y + eye, z, bot.x, bot.y + 1.1, bot.z)) continue;
      const dx = bot.x - x, dz = bot.z - z;
      const pitch = Math.atan2(bot.y + 1.1 - y - eye, Math.hypot(dx, dz));
      window.__NT.teleport(x, y, z, Math.atan2(-dx, -dz), pitch);
      return { x, y, z, target: targetId };
    }
    return null;
  }, id);
  assert(result, 'a clear nearby player position is required');
  await pause(200);
}

async function aimAndFire(id) {
  return owned.page.evaluate(targetId => new Promise(resolve => requestAnimationFrame(() => {
    const bot = window.__NTGAME.bots().find(b => b.id === targetId && b.alive);
    if (!bot) { resolve(false); return; }
    const p = window.__NT.playerPose(), dx = bot.x - p.x, dz = bot.z - p.z;
    const pitch = Math.atan2(bot.y + 1.1 - p.camY, Math.hypot(dx, dz));
    window.__NT.teleport(p.x, p.y, p.z, Math.atan2(-dx, -dz), pitch);
    resolve(window.__NT.weaponCmd('fire'));
  })), id);
}

try {
  const response = await fetch(new URL('preview-identity.json', url), { signal: AbortSignal.timeout(5000) });
  assert(response.ok, 'built preview identity required'); report.identity = await response.json();
  assert.equal(report.identity.project, 'atomic-acres');
  if (expectedCommit) assert.equal(report.identity.sourceCommit, expectedCommit);
  owned = await stockBrowser(tag); const { page } = owned;
  // Chrome 131+ prompts for this permission. Grant it only in this disposable
  // browser, equivalent to the player accepting the site's pointer-lock prompt.
  // The real browser lock and trusted mouse path are still asserted below.
  // https://developer.chrome.com/blog/keyboard-lock-pointer-lock-permission
  const permissionSession = await owned.browser.newBrowserCDPSession();
  await permissionSession.send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['pointerLock'] });
  await permissionSession.detach();
  report.browserPermissions = { origin: new URL(url).origin, granted: ['pointerLock'], scope: 'owned disposable browser' };
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text().slice(0, 400)); });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready && window.__NT.pilot && window.__NTGAME, null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.__NT_BACKEND?.actual), 'webgpu');
  const firstRender = await page.evaluate(() => window.__NT.stats().renderCallsTotal);
  await page.waitForFunction(before => {
    const s = window.__NT.stats(); return s.fps > 0 && s.renderCallsTotal > before;
  }, firstRender, { polling: 100, timeout: 90000 });

  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await page.locator('.aa-prim').filter({ has: page.locator('.aa-prim-name', { hasText: /^Railgun$/ }) }).click();
  await page.getByLabel('Bots', { exact: true }).evaluate(input => {
    input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('radio', { name: 'Recruit', exact: true }).click();
  await page.getByLabel('Mode', { exact: true }).selectOption('ffa');
  await page.getByLabel('Kill limit', { exact: true }).selectOption('25');
  await page.getByLabel('Time limit', { exact: true }).selectOption('600000');
  await page.getByLabel('Killstreak slot 3', { exact: true }).selectOption('piloted-drone');
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.waitForFunction(() => {
    try { return window.__NTGAME.snapshot().match.phase === 'active'; } catch { return false; }
  }, null, { timeout: 30000 });
  let current = await state(); report.samples.initial = current;
  assert.equal(current.gun.id, 'railgun'); assert.equal(pilotSlot(current).slot, 3);
  assert.equal(pilotSlot(current).charges, 0, 'drone begins unearned');
  step('real solo class and piloted-drone slot admitted', { gun: current.gun.id, slot: pilotSlot(current) });

  const earnDeadline = Date.now() + 180000;
  while (self(current).kills < 5 && Date.now() < earnDeadline) {
    assert.equal(self(current).deaths, 0, 'five kills must be earned in one uninterrupted life');
    assert.equal(current.snapshot.match.phase, 'active');
    if (current.gun.mag === 0 && !current.gun.reloading) await page.evaluate(() => window.__NT.weaponCmd('reload'));
    if (current.gun.mag === 0 || current.gun.reloading || current.gun.cool > 0) {
      await pause(150); current = await state(); continue;
    }
    const enemy = current.bots.find(b => b.alive && b.id !== current.id);
    if (!enemy) { await pause(150); current = await state(); continue; }
    const kills = self(current).kills;
    await positionForEnemy(enemy.id);
    assert.equal(await aimAndFire(enemy.id), true, 'normal controller accepts earned-kill shot');
    await pause(180); current = await state();
    if (self(current).kills > kills) {
      report.kills.push({ kills: self(current).kills, weapon: current.gun.id, mag: current.gun.mag,
        stats: current.snapshot.stats, actor: self(current), victim: current.snapshot.actors.find(a => a.id === enemy.id) });
      console.log(`[pilot] earned ${self(current).kills}/5 kills`);
    }
  }
  assert.equal(self(current).kills, 5, 'five real kills required');
  assert.equal(self(current).deaths, 0); assert.equal(pilotSlot(current).charges, 1);
  assert(current.snapshot.stats.shotsAdmitted >= 5); assert(current.snapshot.stats.hitsLanded >= 5);
  report.samples.earned = current; step('five firearm kills earn one actual drone charge', self(current));

  await page.evaluate(() => window.__NT.spawn('a')); await pause(300);
  await page.locator('canvas[data-nt-backend="webgpu"]').click();
  await page.waitForFunction(() => document.pointerLockElement !== null, null, { timeout: 5000 });
  await page.keyboard.press('Digit5');
  const entered = await until(state, s => s.pilot.active, 'earned drone did not enter possession');
  assert.equal(pilotSlot(entered).charges, 0); assert(entered.pose.camY > entered.pose.y + 5);
  assert.equal(await page.evaluate(() => window.__NT.weaponCmd('fire')), false, 'body weapon suppressed while piloting');
  report.samples.entered = entered;

  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyE'); await pause(600);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyE');
  const moved = await state();
  assert(moved.pilot.active); assert(bodyDistance(entered.pose, moved.pose) < .02, 'W/E must park the body');
  assert(cameraDistance(entered.pose, moved.pose) > 1, 'host aircraft must move the camera');
  assert(moved.pose.camY > entered.pose.camY + .3, 'E must climb the aircraft');
  await page.mouse.move(820, 450); await page.mouse.move(844, 464); await pause(120);
  const aimed = await state();
  assert(Math.abs(aimed.pilot.yaw - moved.pilot.yaw) + Math.abs(aimed.pilot.pitch - moved.pilot.pitch) > .001,
    'actual pointer-locked mouse movement must aim the aircraft');
  await page.mouse.down(); await pause(180);
  const firing = await state(); await page.mouse.up();
  assert.equal(firing.pilot.firing, true); assert.equal(firing.gun.mag, entered.gun.mag, 'drone trigger must not spend body ammo');
  assert.equal(self(firing).deaths, 0); report.samples.controlled = firing;
  await page.screenshot({ path: join(out, `${tag}-controlled.png`) });
  step('host-driven camera, movement, mouse aim and body-fire suppression', { before: entered.pose, after: moved.pose, pilot: firing.pilot });

  await page.keyboard.press('Escape');
  const returned = await until(state, s => !s.pilot.active, 'Escape did not release possession');
  assert(bodyDistance(entered.pose, returned.pose) < .02, 'return restores the same body location');
  assert(Math.abs(returned.pose.camY - returned.pose.y - returned.frame.eyeHeight) < .05, 'return restores body eye height');
  assert.equal(returned.menu.surface, 'hidden', 'Escape returns from drone without opening pause');
  await page.keyboard.press('Digit5');
  const reentered = await until(state, s => s.pilot.active, 'same paid platform could not be re-entered');
  assert.equal(reentered.pilot.instanceId, entered.pilot.instanceId); assert.equal(pilotSlot(reentered).charges, 0);
  report.samples.reentered = reentered;
  await page.keyboard.press('Escape'); await until(state, s => !s.pilot.active, 'second exit did not release control');
  const fired = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const p = window.__NT.playerPose(); window.__NT.teleport(p.x, p.y, p.z, p.yaw, 1.1);
    resolve(window.__NT.weaponCmd('fire'));
  })));
  assert.equal(fired, true, 'normal body fire resumes after possession');
  report.samples.returned = await state();
  await page.screenshot({ path: join(out, `${tag}-returned.png`) });
  step('Escape restores body and same paid platform re-enters without a charge', { instanceId: reentered.pilot.instanceId, slot: pilotSlot(reentered) });
  assert.equal(report.errors.length, 0, 'browser errors remain failures'); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
  if (owned) try { report.samples.failure = await state(); } catch { /* failed before live match */ }
  console.error(report.failure);
} finally {
  await owned?.close(); report.endedAt = new Date().toISOString();
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, kills: report.kills.length, steps: report.steps.length, report: `captures/${tag}.json` }));
}
