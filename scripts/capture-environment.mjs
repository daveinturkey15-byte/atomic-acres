import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const [tag = 'environment', weather = 'rain', tod = 'overcastNoon', station = 'yardWhite'] = process.argv.slice(2);
if (!/^[a-zA-Z0-9_-]+$/.test(tag)) throw new Error('Capture tag must be a filename component');
const url = (process.env.RECOVERY_URL || 'http://127.0.0.1:4192/') + `?weather=${encodeURIComponent(weather)}&tod=${encodeURIComponent(tod)}`;
const out = join(process.cwd(), 'captures', tag); mkdirSync(out, { recursive: true });
const owned = await stockBrowser('environment');
const result = { url, station, errors: [] };
try {
  const { page } = owned;
  page.on('pageerror', error => result.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });
  const found = await page.evaluate(station => {
    for (const id of ['start', 'hud', 'crosshair']) { const element = document.getElementById(id); if (element) element.style.display = 'none'; }
    return window.__NT.goto(station);
  }, station);
  if (!found) throw new Error('Unknown station: ' + station);
  // Warm the held station on fresh renderer frames. A one-off goto render can
  // precede the first shadow/material compilation and produce a flat capture.
  for (let i = 0; i < 8; i++) { await measureFrame(page); await page.waitForTimeout(60); }
  result.stats = await measureFrame(page);
  result.backend = await page.evaluate(() => ({ renderer: window.__NT_BACKEND.actual, post: window.__NTPOST.backend }));
  result.environment = await page.evaluate(() => window.__NTATMO.state());
  await page.screenshot({ path: join(out, station + '.png') });
  result.pass = sceneWasMeasured(result.stats) && result.stats.calls <= 1200 && result.stats.triangles <= 900000 && result.errors.length === 0;
} catch (error) { result.fatal = String(error); result.pass = false; }
finally { writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2)); await owned.close(); }
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
