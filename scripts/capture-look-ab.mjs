import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const out = join(process.cwd(), 'captures', 'look-ab');
mkdirSync(out, { recursive: true });
const result = { errors: [], frames: [] };
const owned = await stockBrowser('look-ab');
try {
  const { page } = owned;
  page.on('pageerror', e => result.errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') result.errors.push(e.text()); });
  await page.goto('http://127.0.0.1:4192/?tod=noon&weather=clear', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__NT_BACKEND?.actual != null, null, { timeout: 90000 });
  result.backend = await page.evaluate(() => ({ renderer: window.__NT_BACKEND.actual, post: window.__NTPOST.backend }));
  if (result.backend.renderer !== 'webgpu' || result.backend.post !== 'webgpu') throw new Error('WebGPU A/B admission failed');
  await page.addStyleTag({ content: '#start,#hud,#crosshair{display:none!important}' });
  const baseline = await page.evaluate(() => window.__NT.look());
  result.baseline = baseline;
  for (const station of ['yardWhite', 'turningHead']) {
    for (const variant of [
      { name: 'baseline', values: baseline },
      { name: 'exposure098', values: { ...baseline, exposure: 0.98 } },
      { name: 'environment055', values: { ...baseline, environment: 0.55 } },
    ]) {
      await page.evaluate(([station, v]) => { window.__NT.look(v); window.__NT.goto(station); }, [station, variant.values]);
      await page.waitForTimeout(250);
      const stats = await measureFrame(page);
      await page.screenshot({ path: join(out, `${station}-${variant.name}.png`) });
      result.frames.push({ station, variant: variant.name, stats, measured: sceneWasMeasured(stats) });
    }
  }
  for (const glass of [baseline.glass, 0.35]) {
    for (const ssr of [false, true]) {
      await page.evaluate(([b, glass, ssr]) => {
        window.__NT.look({ ...b, glass });
        window.__NTPOST.setEffects({ ao: true, ssr, bloom: true });
        window.__NT.goto('turningHead');
      }, [baseline, glass, ssr]);
      await page.waitForTimeout(250);
      const stats = await measureFrame(page);
      await page.screenshot({ path: join(out, `reflection-${glass}-${ssr}.png`) });
      result.frames.push({ station: 'turningHead', glass, ssr, stats, measured: sceneWasMeasured(stats) });
    }
  }
  result.pass = result.frames.length === 10 && result.frames.every(f => f.measured && f.stats.calls <= 1200 && f.stats.triangles <= 900000) && !result.errors.length;
} catch (e) { result.fatal = String(e); result.pass = false; }
finally { writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2)); await owned.close(); }
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
