import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const out = join(process.cwd(), 'captures', 'reflection-canary');
mkdirSync(out, { recursive: true });
const result = { errors: [], frames: [] };
const owned = await stockBrowser('reflection-canary');
try {
  const { page } = owned;
  page.on('pageerror', e => result.errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') result.errors.push(e.text()); });
  await page.goto('http://127.0.0.1:4192/?tod=noon&weather=clear', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });
  result.backend = await page.evaluate(() => ({ renderer: window.__NT_BACKEND.actual, post: window.__NTPOST.backend }));
  if (result.backend.renderer !== 'webgpu' || result.backend.post !== 'webgpu') throw new Error('actual WebGPU required');
  await page.addStyleTag({ content: '#start,#hud,#crosshair{display:none!important}' });
  for (const variant of ['baseline', 'probe', 'disposed']) {
    if (variant !== 'baseline') result[variant] = await page.evaluate(v => window.__NT.reflection(v === 'probe'), variant);
    if (variant === 'probe' && result.probe.status !== 'captured') throw new Error(JSON.stringify(result.probe));
    for (const station of ['streetElevation', 'turningHead']) {
      await page.evaluate(s => window.__NT.goto(s), station);
      for (let i = 0; i < 5; i++) { await measureFrame(page); await page.waitForTimeout(60); }
      const stats = await measureFrame(page);
      await page.screenshot({ path: join(out, `${station}-${variant}.png`) });
      result.frames.push({ station, variant, stats });
    }
  }
  result.pass = result.frames.length === 6 && result.frames.every(f => sceneWasMeasured(f.stats) && f.stats.calls <= 1200 && f.stats.triangles <= 900000) && !result.errors.length;
} catch (e) { result.fatal = String(e); result.pass = false; }
finally { writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2)); await owned.close(); }
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
