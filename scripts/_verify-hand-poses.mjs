/**
 * Live first-person hand pose capture on the frozen candidate.
 *
 * This is deliberately a capture harness, not a source-only assertion. It uses
 * the real menu and Deploy action, then the documented __NT.weaponCmd surface to
 * choose the catalog weapons and request a reload. It never calls __NT.render,
 * __NT.goto, or a synthetic pose API: the game's own requestAnimationFrame loop
 * draws every saved frame.
 *
 * The candidate server is expected to be the frozen stock build on :4192:
 *   node scripts/_verify-hand-poses.mjs
 *   RECOVERY_URL=http://127.0.0.1:4192/ node scripts/_verify-hand-poses.mjs
 *
 * This file is intentionally not run by the animation lane. It owns no server
 * and starts no browser until an operator explicitly invokes it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';

const CANDIDATE = process.env.RECOVERY_URL || 'http://127.0.0.1:4192/';
const OUT = join(process.cwd(), 'captures', 'hand-poses');
const CALL_BUDGET = 1200;
const TRIANGLE_BUDGET = 900_000;
const MAX_FRAMES = 12;
const WEAPONS = [
  { id: 'longhorn', label: 'rifle' },
  { id: 'duster', label: 'pistol' },
  { id: 'coachman', label: 'shotgun' },
];

mkdirSync(OUT, { recursive: true });
const result = {
  candidate: CANDIDATE,
  route: 'real menu -> Play solo -> Deploy -> game rAF loop',
  budgets: { calls: CALL_BUDGET, triangles: TRIANGLE_BUDGET, maxFrames: MAX_FRAMES },
  frames: [],
  errors: [],
  checks: [],
};
const check = (name, pass, value) => result.checks.push({ name, pass, value });

let owned = null;
try {
  owned = await stockBrowser('hand-poses');
  const { page } = owned;
  await page.setViewportSize({ width: 1600, height: 900 });
  page.on('pageerror', error => result.errors.push('PAGEERROR ' + String(error).slice(0, 400)));
  page.on('console', message => {
    if (message.type() === 'error') result.errors.push('CONSOLE ' + message.text().slice(0, 400));
  });

  await page.goto(CANDIDATE, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => window.__NT?.ready === true, null, { timeout: 90_000 });

  // The menu path is part of the evidence: do not remove #start or bypass it.
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await page.getByRole('button', { name: /deploy/i }).click();
  await page.waitForFunction(() => {
    try {
      const phase = window.__NTGAME?.snapshot?.().match?.phase;
      const state = window.__NT?.weaponCmd?.('state');
      return phase === 'active' && state?.visible === true;
    } catch { return false; }
  }, null, { timeout: 45_000 });

  // Hide only DOM chrome so the saved pixels make the firearm and hands legible;
  // the canvas and the game's own render loop remain untouched.
  await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

  const read = () => page.evaluate(() => ({
    state: window.__NT.weaponCmd('state'),
    stats: window.__NT.stats(),
  }));

  async function waitState(predicate, label, timeoutMs = 4_000) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      last = await read();
      if (predicate(last)) return last;
      await page.waitForTimeout(45);
    }
    throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
  }

  async function sampleCurrentFrame() {
    // Read after a browser frame boundary so calls/triangles belong to a real
    // game frame, rather than a zeroed counter between renderer resets.
    return page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => resolve({
        state: window.__NT.weaponCmd('state'),
        stats: window.__NT.stats(),
      }));
    }));
  }

  async function capture(name, note) {
    if (result.frames.length >= MAX_FRAMES) throw new Error(`frame limit ${MAX_FRAMES} exceeded`);
    const file = join(OUT, `${String(result.frames.length + 1).padStart(2, '0')}-${name}.png`);
    await page.waitForTimeout(140);
    await page.screenshot({ path: file });
    const sample = await sampleCurrentFrame();
    const s = sample.stats;
    const state = sample.state;
    const measured = Number.isFinite(s.calls) && Number.isFinite(s.triangles)
      && s.calls > 2 && s.triangles > 2 && s.renderCallsTotal > 0;
    const budgetOk = measured && s.calls <= CALL_BUDGET && s.triangles <= TRIANGLE_BUDGET;
    const frame = {
      index: result.frames.length + 1,
      name,
      note,
      file,
      weapon: state?.id ?? null,
      stance: s?.stance ?? null,
      ads: state?.ads ?? null,
      reloading: state?.reloading ?? null,
      reloadProgress: state?.reloadProgress ?? null,
      hands: state?.hands ?? null,
      stats: {
        fps: s?.fps ?? null,
        calls: s?.calls ?? null,
        triangles: s?.triangles ?? null,
        renderCallsTotal: s?.renderCallsTotal ?? null,
        geometries: s?.geometries ?? null,
        textures: s?.textures ?? null,
      },
      measured,
      budgetOk,
    };
    result.frames.push(frame);
    console.log(`[hand-poses] ${budgetOk ? 'PASS' : 'OPEN'} ${name} ${s.calls} calls/${s.triangles} tris`);
    return frame;
  }

  async function ensureStand() {
    await page.keyboard.up('Control');
    await page.keyboard.up('z');
    const current = await read();
    if (current.stats.stance === 'prone') await page.keyboard.press('z');
    await waitState(v => v.stats.stance === 'stand', 'stand reset');
  }

  async function selectWeapon(id) {
    const selected = await page.evaluate(weaponId => window.__NT.weaponCmd('switch', weaponId), id);
    if (selected !== true) throw new Error(`weapon switch rejected: ${id} -> ${JSON.stringify(selected)}`);
    await waitState(v => v.state?.id === id && v.state?.reloading === false, `select ${id}`);
    const refilled = await page.evaluate(() => window.__NT.weaponCmd('refill'));
    if (refilled !== true) throw new Error(`refill rejected: ${id}`);
    await page.evaluate(() => window.__NT.weaponCmd('ads', false));
    await waitState(v => v.state?.id === id && v.state?.ads === false, `reset ${id}`);
  }

  async function captureWeapon({ id, label }) {
    await ensureStand();
    await selectWeapon(id);
    await capture(`${label}-${id}-hip`, 'standing hip-fire bind pose');

    await page.mouse.down({ button: 'right' });
    try {
      await waitState(v => v.state?.id === id && v.state?.ads === true, `${id} ADS`);
      await page.waitForTimeout(320);
      await capture(`${label}-${id}-ads`, 'standing fully blended ADS pose');
    } finally {
      await page.mouse.up({ button: 'right' });
    }

    await page.evaluate(() => window.__NT.weaponCmd('ads', false));
    await waitState(v => v.state?.ads === false, `${id} hip reset`);
    await page.evaluate(() => window.__NT.weaponCmd('refill'));
    const fired = await page.evaluate(() => window.__NT.weaponCmd('fire'));
    if (fired !== true) throw new Error(`${id} QA shot did not fire before reload`);
    const started = await page.evaluate(() => window.__NT.weaponCmd('reload'));
    if (started !== true) throw new Error(`${id} reload did not start after QA shot`);
    await waitState(v => v.state?.reloading === true
      && v.state.reloadProgress >= 0.28 && v.state.reloadProgress <= 0.48, `${id} reload midreach`);
    await capture(`${label}-${id}-reload-midreach`, 'reload support hand reaching measured magazine/breech target');
    await waitState(v => v.state?.reloading === false, `${id} reload completion`, 5_000);
  }

  for (const weapon of WEAPONS) await captureWeapon(weapon);

  // Two additional real stance frames use the rifle, keeping the total at 11.
  await ensureStand();
  await selectWeapon('longhorn');
  await page.keyboard.down('Control');
  await waitState(v => v.stats.stance === 'crouch', 'crouch stance');
  await capture('rifle-longhorn-crouch', 'Control-held crouch with rifle at hip');
  await page.keyboard.up('Control');
  await waitState(v => v.stats.stance === 'stand', 'stand before prone');
  await page.keyboard.press('z');
  await waitState(v => v.stats.stance === 'prone', 'prone stance');
  await capture('rifle-longhorn-prone', 'Z-toggled prone with rifle at hip');
  await page.keyboard.press('z');
  await waitState(v => v.stats.stance === 'stand', 'final stand reset');

  check('real menu and Deploy path completed', true, result.route);
  check('capture count is bounded', result.frames.length <= MAX_FRAMES, result.frames.length);
  check('every frame has a live hand state', result.frames.every(v => v.hands?.supportHand && v.hands?.triggerHand),
    result.frames.map(v => ({ name: v.name, weapon: v.weapon, reloading: v.reloading })));
  check('every frame is within renderer budgets', result.frames.every(v => v.budgetOk),
    result.frames.map(v => ({ name: v.name, calls: v.stats.calls, triangles: v.stats.triangles })));
  check('no page or console errors', result.errors.length === 0, result.errors);
} catch (error) {
  result.fatal = String(error);
  console.error('[hand-poses] FATAL ' + result.fatal);
} finally {
  result.finishedAt = new Date().toISOString();
  result.pass = !result.fatal && result.errors.length === 0
    && result.frames.length <= MAX_FRAMES
    && result.frames.every(v => v.budgetOk)
    && result.checks.every(v => v.pass);
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  if (owned) await owned.close();
}

console.log(JSON.stringify({ pass: result.pass, frames: result.frames.length, checks: result.checks, fatal: result.fatal }, null, 2));
if (!result.pass) process.exitCode = 1;
