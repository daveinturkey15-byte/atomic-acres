// Integration proof: real Q press -> host event -> client -> volumetric uniforms.
// No injected smoke is used for the gameplay verdict.
import { chromium } from 'playwright';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

const url = process.env.RECOVERY_URL || 'http://127.0.0.1:4192/';
const out = join(process.cwd(), 'captures', 'live-smoke');
mkdirSync(out, { recursive: true });
const port = await new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => {
    const p = s.address().port; s.close(() => r(p));
  });
});
const child = spawnGuarded('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=' + port,
  '--user-data-dir=' + join(tmpdir(), 'nt-smoke-' + port),
  '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let browser;
const result = { url, checks: [], errors: [], samples: [] };
function check(name, pass, value) { result.checks.push({ name, pass, value }); }
try {
  for (let i = 0; i < 100 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port); }
    catch { await new Promise(r => setTimeout(r, 200)); }
  }
  if (!browser) throw new Error('Chrome unavailable');
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1600, height: 900 });
  page.on('pageerror', e => result.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('nuketown2025.loadout.v1', JSON.stringify({
    version: 1, custom: [null, null, null], selected: { kind: 'kit', id: 'marksman' },
  })));
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready && window.__NTATMO, null, { timeout: 90000 });
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await page.getByRole('button', { name: /deploy/i }).click();
  await page.waitForFunction(() => {
    try { return window.__NTGAME.snapshot().match.phase === 'active' && window.__NT.ordnance().self.spawnSeq > 0; }
    catch { return false; }
  }, null, { timeout: 45000 });
  await page.evaluate(() => {
    window.__NT.teleport(-4, 0, -34.3, Math.PI, 0.12); window.__NT.release();
  });
  const state = () => page.evaluate(() => ({
    at: performance.now(), projection: window.__NT.ordnance(),
    atmosphere: window.__NTATMO.state(), stats: window.__NT.stats(),
    post: { enabled: window.__NTPOST.enabled, backend: window.__NTPOST.backend },
  }));
  result.before = await state();
  check('WebGPU atmosphere active', result.before.post.enabled && result.before.post.backend === 'webgpu', result.before.post);
  await page.screenshot({ path: join(out, 'before.png') });
  await page.keyboard.down('KeyQ'); await page.waitForTimeout(500); await page.keyboard.up('KeyQ');
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(i === 0 ? 3000 : 4200);
    const sample = await state(); result.samples.push(sample);
    if (i === 0) await page.screenshot({ path: join(out, 'smoke.png') });
  }
  const counts = result.samples.map(s => s.atmosphere.smokes);
  check('Actual grenade feeds volumetric uniforms', counts.some(n => n > 0), counts);
  check('Smoke volume expires', counts.some(n => n > 0) && counts.at(-1) === 0, counts);
  await page.evaluate(() => window.__NTGAME.leave());
  await page.waitForTimeout(250);
  result.afterLeave = await state();
  check('Leave releases live smoke projection', result.afterLeave.atmosphere.smokes === 0 && result.afterLeave.projection.bound === false, result.afterLeave.atmosphere);
  check('No runtime errors', result.errors.length === 0, result.errors);
} catch (e) {
  result.fatal = String(e); process.exitCode = 1;
} finally {
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  killTree(child.pid);
}
console.log(JSON.stringify({ checks: result.checks, fatal: result.fatal, errors: result.errors }, null, 2));
if (result.checks.some(c => !c.pass) || result.fatal) process.exitCode = 1;
