import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';

const out = join(process.cwd(), 'captures', 'bedroom-live');
mkdirSync(out, { recursive: true });
const owned = await stockBrowser('bedroom');
const result = { checks: [], errors: [] };
try {
  const { page } = owned;
  page.on('pageerror', e => result.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  await page.goto(process.env.RECOVERY_URL || 'http://127.0.0.1:4192/');
  await page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });
  result.checks = await page.evaluate(() => {
    const qa = window.__NT;
    qa.goto('yardWhite'); // hold render loop; walk through the real collision controller below
    qa.setMode('walk');
    const routes = [
      ['hall to bedroom', [-3.3, 25.2], [[-3.3, 23.1], [-5.2, 23.1]]],
      ['bedroom to hall', [-5.2, 23.1], [[-3.3, 23.1], [-3.3, 25.2]]],
      ['green room to bedroom', [-2, 22.6], [[-3.3, 22.6], [-5.2, 23.1]]],
      ['bedroom to green room', [-5.2, 23.1], [[-3.3, 22.6], [-2, 22.6]]],
    ];
    return routes.map(([name, start, points]) => {
      qa.teleport(start[0], 3.151, start[1]);
      const segments = points.map(([x, z]) => ({ target: [x, z], pass: qa.probeWalkTo(x, z, 600, 0.08), end: qa.probePos() }));
      return { name, pass: segments.every(s => s.pass && Math.hypot(s.end[0] - s.target[0], s.end[2] - s.target[1]) < 0.08 && Math.abs(s.end[1] - 3.15) < 0.1), segments };
    });
  });
  result.doorColliders = await page.evaluate(() => [3.4, 4, 4.8].map(y => ({ y, hits: window.__NT.collidersAt(-3.3, 24.5, y) })));
  await page.evaluate(() => {
    for (const id of ['start', 'hud']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    window.__NT.teleport(-3.3, 3.151, 25.2, 0, -0.08);
    window.__NT.release();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'hall-door.png') });
  result.pass = result.checks.every(c => c.pass) && result.errors.length === 0;
} catch (error) { result.fatal = String(error); result.pass = false; }
finally { writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2)); await owned.close(); }
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
