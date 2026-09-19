import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const url = process.env.RECOVERY_URL || 'http://127.0.0.1:4192/';
const out = join(process.cwd(), 'captures', 'options-live');
mkdirSync(out, { recursive: true });
const result = { url, errors: [], checks: [] };
const check = (name, pass, value) => result.checks.push({ name, pass, value });
const owned = await stockBrowser('options');
const { page } = owned;
page.on('pageerror', error => result.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
const ready = () => page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });
const state = () => page.evaluate(() => ({
  atmo: window.__NTATMO.state(), effects: window.__NTPOST.getEffects(),
  fog: window.__NTPOST.getFog(), enabled: window.__NTPOST.enabled,
  audio: window.__NT.audio(),
}));
try {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 }); await ready();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByLabel('Ambient occlusion', { exact: true }).uncheck();
  await page.getByLabel('Screen-space reflections', { exact: true }).uncheck();
  await page.getByLabel('Bloom', { exact: true }).uncheck();
  await page.getByLabel('Fog (analytic haze)', { exact: true }).uncheck();
  await page.getByLabel('Time of day', { exact: true }).selectOption('goldenHour');
  await page.getByLabel('Weather', { exact: true }).selectOption('rain');
  await page.waitForTimeout(300);
  result.changed = await state();
  check('DOM controls change live post effects', result.changed.enabled && Object.values(result.changed.effects).every(v => !v) && !result.changed.fog, result.changed);
  check('DOM controls change environment without adding lights', result.changed.atmo.tod === 'goldenHour' && result.changed.atmo.weather === 'rain' && result.changed.atmo.lights === 3, result.changed.atmo);
  await page.screenshot({ path: join(out, 'options.png') });
  await page.reload({ waitUntil: 'load' }); await ready();
  result.persisted = await state();
  check('Environment and effects persist through reload', result.persisted.atmo.tod === 'goldenHour' && result.persisted.atmo.weather === 'rain' && !result.persisted.effects.ao && !result.persisted.fog, result.persisted);
  await page.goto(url + '?tod=noon&weather=clear', { waitUntil: 'load' }); await ready();
  result.query = await state();
  check('Explicit capture URL overrides saved environment', result.query.atmo.tod === 'noon' && result.query.atmo.weather === 'clear', result.query.atmo);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByLabel('Time of day', { exact: true }).selectOption('dusk');
  await page.getByLabel('Weather', { exact: true }).selectOption('overcast');
  await page.getByLabel('Ambient occlusion', { exact: true }).check();
  await page.getByLabel('Screen-space reflections', { exact: true }).check();
  await page.getByLabel('Bloom', { exact: true }).check();
  await page.getByLabel('Fog (analytic haze)', { exact: true }).check();
  result.afterQueryChange = await state();
  check('User can change environment after URL override', result.afterQueryChange.atmo.tod === 'dusk' && result.afterQueryChange.atmo.weather === 'overcast', result.afterQueryChange.atmo);
  await page.evaluate(() => { window.__NT.goto('yardWhite'); document.getElementById('start').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
  for (const [tod, weather] of [['noon', 'clear'], ['goldenHour', 'clear'], ['dusk', 'clear'], ['overcastNoon', 'rain']]) {
    await page.evaluate(([tod, weather]) => { window.__NTATMO.set(tod); window.__NTATMO.weather(weather); }, [tod, weather]);
    await page.waitForTimeout(150);
    const stats = await measureFrame(page);
    check(tod + '/' + weather + ' renders scene within budget', sceneWasMeasured(stats) && stats.calls <= 1200 && stats.triangles <= 900000, stats);
    await page.screenshot({ path: join(out, tod + '-' + weather + '.png') });
  }
  check('No runtime errors', result.errors.length === 0, result.errors);
} catch (error) { result.fatal = String(error); process.exitCode = 1; }
finally { writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2)); await owned.close(); }
console.log(JSON.stringify({ checks: result.checks, fatal: result.fatal, errors: result.errors }, null, 2));
if (result.checks.some(c => !c.pass)) process.exitCode = 1;
