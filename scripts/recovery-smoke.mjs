// Stock installed Chrome and actual menu actions; no unsafe-WebGPU override.
import { chromium } from 'playwright';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const url = process.env.RECOVERY_URL || 'http://127.0.0.1:4191/';
const out = join(process.cwd(), 'captures', 'recovery-stock');
mkdirSync(out, { recursive: true });
const port = await new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
const child = spawnGuarded('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=' + port,
  '--user-data-dir=' + join(tmpdir(), 'nuketown-recovery-' + port),
  '--no-first-run', '--no-default-browser-check', '--window-size=1600,900',
  'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let browser;
const result = { url, stockFlags: true, errors: [], failedResponses: [], failedRequests: [] };
try {
  for (let i = 0; i < 100 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port); }
    catch { await new Promise(r => setTimeout(r, 200)); }
  }
  if (!browser) throw new Error('Chrome CDP unavailable');
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1600, height: 900 });
  page.on('pageerror', e => result.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) result.failedResponses.push({ url:r.url(),status:r.status() }); });
  page.on('requestfailed', r => result.failedRequests.push({url:r.url(),failure:r.failure()}));
  await page.goto(url, { waitUntil:'load', timeout:90000 });
  await page.waitForFunction(() => window.__NT?.ready, null, { timeout:90000 });
  await page.screenshot({path:join(out,'menu.png')});
  await page.getByRole('button', {name:'Play solo',exact:true}).click();
  result.soloButtons = await page.getByRole('button').allTextContents();
  await page.getByRole('button', {name:/deploy/i}).click();
  await page.waitForTimeout(6000);
  const before = await page.evaluate(() => window.__NT.stats());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  result.before=before;
  result.after=await page.evaluate(() => ({ stats:window.__NT.stats(), snapshot:window.__NTGAME?.snapshot(), atmo:window.__NTATMO?.state?.(), menu:window.__NTUI?.state?.() }));
  await page.screenshot({path:join(out,'play.png')});
  for (const [name,x,y,z,yaw] of [['street',-6,0,0,-Math.PI/2],['white-yard',1.2,0,34.3,0]]) {
    await page.evaluate(([x,y,z,yaw])=>{window.__NT.teleport(x,y,z,yaw,0);window.__NT.release();},[x,y,z,yaw]);
    await page.waitForTimeout(700);
    await page.screenshot({path:join(out,name+'.png')});
  }
  result.completed = true;
  console.log(JSON.stringify(result,null,2));
} catch(e) {
  result.fatal=String(e); console.error(e); process.exitCode=1;
} finally {
  writeFileSync(join(out,'result.json'), JSON.stringify(result,null,2));
  if(browser) await browser.close();
  killTree(child.pid);
}
if(result.errors.length || result.failedResponses.length || result.failedRequests.length) process.exitCode=1;
