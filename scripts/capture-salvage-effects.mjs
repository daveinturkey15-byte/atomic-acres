/** Real custom-loadout -> Deploy -> trigger -> host effect -> game-loop pixels.
 * QA teleports frame the shots; no synthetic event/charge/health injection. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i < 0 ? fallback : argv[i + 1]; };
const baseUrl = option('url', 'http://127.0.0.1:4193/');
const tag = option('tag', 'salvage-special-effects');
assert(/^[a-z0-9_-]+$/i.test(tag), 'safe capture tag required');
const out = join(root, 'captures');
mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { kind: 'actual-host special-weapon presentation; no damage-victim claim', url: baseUrl,
  tag, start: new Date().toISOString(), frames: [], errors: [], status: 'OPEN' };
let owned;
try {
  owned = await stockBrowser(tag);
  const { page } = owned;
  page.on('pageerror', (e) => report.errors.push(String(e)));
  page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.addInitScript(() => {
    const primary = new URL(location.href).searchParams.get('fx-weapon');
    if (!primary) return;
    localStorage.setItem('nuketown2025.loadout.v1', JSON.stringify({ version: 1,
      custom: [{ name: 'Effect proof', primary, sidearm: 'duster', grenade: 'frag' }, null, null],
      selected: { kind: 'custom', slot: 0 } }));
  });
  for (const weapon of ['flamethrower', 'railgun', 'flare-gun', 'explosive-crossbow']) {
    const url = new URL(baseUrl); url.searchParams.set('fx-weapon', weapon);
    await page.goto(url.href, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90_000 });
    assert.equal(await page.evaluate(() => window.__NT_BACKEND?.actual), 'webgpu', 'actual WebGPU backend required');
    await page.getByRole('button', { name: 'Play solo', exact: true }).click();
    // Quiet sandbox through the shipped visible setting; active phase still required.
    await page.getByLabel('Bots', { exact: true }).evaluate((element) => {
      element.value = element.min;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByRole('radio', { name: 'Recruit', exact: true }).click();
    await page.getByRole('button', { name: 'Deploy', exact: true }).click();
    await page.waitForFunction(() => {
      try { return window.__NTGAME?.snapshot().match.phase === 'active'; } catch { return false; }
    }, null, { timeout: 30_000 });
    await page.evaluate(() => window.__NT.teleport(-6, 0, 0, -Math.PI / 2, -0.17));
    await pause(350);
    const before = await page.evaluate(() => ({
      gun: window.__NT.weaponCmd('state'), effects: window.__NT.specialEffects(),
      stats: window.__NTGAME.snapshot().stats, counters: window.__NTGAME.counters(),
    }));
    assert.equal(before.gun.id, weapon, 'host-issued selected custom weapon');
    // The flame cadence keeps its short-lived tongue visible while the screenshot is read.
    // Every iteration is the same normal trigger path, still checked by the controller and host.
    if (weapon === 'flamethrower') {
      await page.evaluate(() => { window.__fxProofTimer = setInterval(() => window.__NT.weaponCmd('fire'), 55); });
      await pause(180);
    } else {
      assert.equal(await page.evaluate(() => window.__NT.weaponCmd('fire')), true, 'trigger admitted by controller');
    }
    if (weapon === 'railgun') await pause(25);
    if (weapon === 'flare-gun') await pause(180);
    if (weapon === 'explosive-crossbow') await pause(200);
    const during = await page.evaluate(() => ({ gun: window.__NT.weaponCmd('state'), effects: window.__NT.specialEffects(),
      stats: window.__NTGAME.snapshot().stats, counters: window.__NTGAME.counters(), phase: window.__NTGAME.snapshot().match.phase,
      pose: window.__NT.playerPose(), frame: window.__NT.stats(), ordnance: window.__NT.ordnance(),
    }));
    const image = `${tag}-${weapon}.png`;
    await page.screenshot({ path: join(out, image) });
    if (weapon === 'flamethrower') await page.evaluate(() => clearInterval(window.__fxProofTimer));
    report.frames.push({ weapon, image, before, during });
    assert.equal(during.phase, 'active');
    assert(during.gun.shotsFired > before.gun.shotsFired, 'normal controller fired');
    assert.equal(during.counters.shotRejects, before.counters.shotRejects, 'host rejected no fixture shot');
    assert(during.stats.shotsAdmitted > before.stats.shotsAdmitted, 'actual host shot admission increased');
    assert(during.effects.weapons.instances > 0 || weapon === 'explosive-crossbow' && during.ordnance.crossbow.live.length > 0,
      `no visible admitted ${weapon} effects`);
    console.log(`${weapon}: host presentation ${during.effects.weapons.live} effects / ${during.effects.weapons.instances} instances`);
    if (weapon === 'flare-gun') {
      await pause(650);
      const impact = await page.evaluate(() => ({ effects: window.__NT.specialEffects(), phase: window.__NTGAME.snapshot().match.phase }));
      const impactImage = `${tag}-flare-impact.png`;
      await page.screenshot({ path: join(out, impactImage) });
      report.frames.push({ weapon: 'flare-impact', image: impactImage, during: impact });
    }
  }
  assert.equal(report.errors.length, 0, 'zero browser errors');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
} finally {
  await owned?.close();
  report.end = new Date().toISOString();
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, frames: report.frames.length, errors: report.errors, failure: report.failure ?? null }));
}
