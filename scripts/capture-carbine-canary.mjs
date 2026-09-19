/**
 * Browser capture verification script for the Catalog Carbine Canary.
 *
 * Authored for root execution (DO NOT RUN in sub-agent lane).
 * Run command when dev/preview server is live:
 *   node scripts/capture-carbine-canary.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const out = join(process.cwd(), 'captures', 'carbine-canary');
mkdirSync(out, { recursive: true });

const result = { errors: [], frames: [], pass: false };
const owned = await stockBrowser('carbine-canary');

try {
  const { page } = owned;
  page.on('pageerror', (e) => result.errors.push(String(e)));
  page.on('console', (e) => {
    if (e.type() === 'error') result.errors.push(e.text());
  });

  // Opt-in via ?carbine=canary query flag
  const targetUrl = 'http://127.0.0.1:4173/?carbine=canary&tod=noon&weather=clear';
  await page.goto(targetUrl, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });

  // Enter solo deployment if menu is active
  const soloBtn = page.getByRole('button', { name: /play solo/i });
  if (await soloBtn.isVisible()) {
    await soloBtn.click();
    const deployBtn = page.getByRole('button', { name: /deploy/i });
    if (await deployBtn.isVisible()) {
      await deployBtn.click();
    }
  }

  // Wait for weapons controller and carbine canary rig to be ready
  await page.waitForFunction(
    () => {
      try {
        const state = window.__NT?.weaponCmd?.('state');
        return state && state.name === 'Longhorn';
      } catch {
        return false;
      }
    },
    null,
    { timeout: 45000 },
  );

  // Allow async GLTF load and swap to complete
  await page.waitForTimeout(1000);

  // Capture 1: Hipfire idle viewmodel
  for (let i = 0; i < 5; i++) await measureFrame(page);
  const hipStats = await measureFrame(page);
  await page.screenshot({ path: join(out, 'carbine-hip.png') });
  result.frames.push({ pose: 'hip', stats: hipStats });

  // Capture 2: ADS aimed viewmodel
  await page.evaluate(() => window.__NT?.weaponCmd?.('ads', true));
  await page.waitForTimeout(400);
  for (let i = 0; i < 5; i++) await measureFrame(page);
  const adsStats = await measureFrame(page);
  await page.screenshot({ path: join(out, 'carbine-ads.png') });
  result.frames.push({ pose: 'ads', stats: adsStats });
  await page.evaluate(() => window.__NT?.weaponCmd?.('ads', false));

  // Capture 3: Reload reach viewmodel
  await page.evaluate(() => window.__NT?.weaponCmd?.('reload'));
  await page.waitForTimeout(500); // mid-reload where support hand reaches mag
  const reloadStats = await measureFrame(page);
  await page.screenshot({ path: join(out, 'carbine-reload.png') });
  result.frames.push({ pose: 'reload', stats: reloadStats });

  // Check passes
  result.pass =
    !result.errors.length &&
    result.frames.length === 3 &&
    result.frames.every((f) => sceneWasMeasured(f.stats));
} catch (e) {
  result.fatal = String(e);
  result.pass = false;
} finally {
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
  await owned.close();
}

console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
