// Menu-composition acceptance source for the solo pre-match panel.
// Runs at ROOT (browser/GPU there). Source-only delivery: root executes it.
// Run from the repo root:  RECOVERY_URL=http://127.0.0.1:4192/ QA_TAG=menu-composition node scripts/ui/verify-menu-composition.mjs
// What it proves over scripts/ui/verify-menu-hud-live.mjs:
//  - solo view at 390/1280/1600 px wide: no horizontal overflow past client+1,
//    every loadout/setup child inside the viewport bounds;
//  - Deploy visible without scrolling at 1600x900 (composition acceptance);
//  - a real MP5 + Semtex choice persists across reload, prints ONE pair on the
//    deploy line, and Deploys into an active HUD.
// Uses the repo's own launcher (scripts/lib/stock-browser.mjs) and served
// build identity (dist/ over vite preview) like the other live gates.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from '../lib/stock-browser.mjs';

const url = process.env.RECOVERY_URL || 'http://127.0.0.1:4192/';
const out = join(process.cwd(), 'captures', process.env.QA_TAG || 'menu-composition');
mkdirSync(out, { recursive: true });
const result = { url, checks: [], errors: [] };
const check = (name, pass, data) => result.checks.push({ name, pass, data });
const owned = await stockBrowser('menu-composition');
const { page } = owned;
page.on('pageerror', (e) => result.errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') result.errors.push(m.text()); });
const ready = () => page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });
const count = (text, word) => (text.match(new RegExp(word, 'gi')) ?? []).length;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  for (const [width, height] of [[390, 844], [1280, 720], [1600, 900]]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.evaluate(() => {
      const root = document.querySelector('#start .aa-root');
      const kids = [...document.querySelectorAll(
        '#start .aa-solo-cols, #start .aa-loadout, #start .aa-kits, #start .aa-prims, #start .aa-tacs, #start .aa-solo-setup',
      )].map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; });
      return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, kids };
    });
    check(
      `Solo ${width} no horizontal overflow past client+1`,
      bounds.scrollWidth <= bounds.clientWidth + 1
        && bounds.kids.every((r) => r.left >= -1 && r.right <= width + 1),
      bounds,
    );
    await page.screenshot({ path: join(out, `solo-${width}.png`) });
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  const deployBox = await page.evaluate(() => {
    const r = document.querySelector('#start .aa-solo .aa-btn.aa-primary')?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom } : null;
  });
  check('Deploy visible without scrolling at 1600x900', !!deployBox && deployBox.top >= 0 && deployBox.bottom <= 900, deployBox);
  await page.getByRole('button', { name: /^MP5\b/ }).click();
  await page.getByRole('button', { name: /^Semtex\b/ }).click();
  const line = await page.evaluate(() => document.querySelector('.aa-loadline')?.textContent ?? '');
  check('MP5+Semtex prints one pair, not the mirrored name twice',
    line.includes('MP5') && line.includes('Semtex') && count(line, 'MP5') === 1 && count(line, 'Semtex') === 1, { line });
  await page.screenshot({ path: join(out, 'solo-mp5-semtex.png') });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  const persisted = await page.evaluate(() => document.querySelector('.aa-loadline')?.textContent ?? '');
  check('MP5+Semtex survives a reload from the store',
    persisted.includes('MP5') && persisted.includes('Semtex'), { persisted });
  await page.keyboard.press('Tab');
  check('Keyboard focus stays visible on menu controls',
    await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
  await page.getByRole('button', { name: /deploy/i }).click();
  await page.waitForFunction(() => window.__NTGAME.snapshot().match.phase === 'active', null, { timeout: 45000 });
  const hud = await page.evaluate(() => {
    const seen = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return { weapon: seen('.hud-weapon'), ammo: seen('.hud-ammo'), health: seen('.hud-health') };
  });
  check('Deployed MP5+Semtex loadout reaches an active HUD', hud.weapon && hud.ammo && hud.health, hud);
  await page.screenshot({ path: join(out, 'play-mp5-semtex.png') });
  check('No browser errors', result.errors.length === 0, result.errors);
} catch (error) { result.fatal = String(error); process.exitCode = 1; }
finally { writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2)); await owned.close(); }
console.log(JSON.stringify(result, null, 2));
if (result.fatal || result.checks.some((c) => !c.pass)) process.exitCode = 1;
