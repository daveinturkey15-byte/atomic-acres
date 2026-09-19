import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const out = join(process.cwd(), 'captures', 'weather-cycle');
mkdirSync(out, { recursive: true });
const result = { errors: [], samples: [], checks: [] };
const owned = await stockBrowser('weather-cycle');
try {
  const { page } = owned;
  page.on('pageerror', e => result.errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') result.errors.push(e.text()); });
  await page.goto('http://127.0.0.1:4192/', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });
  await page.addStyleTag({ content: '#start,#hud,#crosshair{display:none!important}' });
  await page.evaluate(() => window.__NT.goto('yardWhite'));
  const presets = await page.evaluate(() => ({ times: window.__NTATMO.presets, weathers: window.__NTATMO.weathers }));
  for (let round = 0; round < 3; round++) {
    for (const tod of presets.times) for (const weather of presets.weathers) {
      await page.evaluate(([t, w]) => {
        if (!window.__NTATMO.set(t) || !window.__NTATMO.weather(w)) throw new Error('preset refused');
      }, [tod, weather]);
      // Let the existing PMREM/shadow resources refresh before observing them.
      for (let i = 0; i < 4; i++) { await measureFrame(page); await page.waitForTimeout(80); }
      const stats = await measureFrame(page);
      const state = await page.evaluate(() => window.__NTATMO.state());
      result.samples.push({ round, tod, weather, stats, lights: state.lights });
      if (round === 2 && ['noon', 'goldenHour', 'dusk'].includes(tod) && weather !== 'overcast') {
        await page.screenshot({ path: join(out, `${tod}-${weather}.png`) });
      }
    }
  }
  const check = (name, pass, detail) => result.checks.push({ name, pass, detail });
  check('all time/weather combinations repeated three times', result.samples.length === 3 * presets.times.length * presets.weathers.length, result.samples.length);
  check('fixed three-light rig survives all switches', result.samples.every(s => s.lights === 3));
  check('actual render stays within scene budgets', result.samples.every(s => sceneWasMeasured(s.stats) && s.stats.calls <= 1200 && s.stats.triangles <= 900000));
  const middle = result.samples.filter(s => s.round === 1), last = result.samples.filter(s => s.round === 2);
  check('warmed resource counts do not grow across a full repeated cycle', last.every((s, i) => s.stats.geometries === middle[i].stats.geometries && s.stats.textures === middle[i].stats.textures),
    last.map((s, i) => ({ tod:s.tod, weather:s.weather, geometries:[middle[i].stats.geometries,s.stats.geometries], textures:[middle[i].stats.textures,s.stats.textures] })));
  check('no page errors', !result.errors.length, result.errors);
  result.pass = result.checks.every(c => c.pass);
} catch (e) { result.fatal = String(e); result.pass = false; }
finally { writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2)); await owned.close(); }
console.log(JSON.stringify({ pass: result.pass, checks: result.checks, fatal: result.fatal }, null, 2));
if (!result.pass) process.exitCode = 1;
