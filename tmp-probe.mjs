/** Temporary probe: what does the page actually do at load? */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const ROOT = 'C:/Users/david/Desktop/stuff/nuketown';
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
const port = await freePort();
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
const url = 'http://localhost:' + port + '/';
let up = false;
for (let i = 0; i < 150; i++) {
  try { const r = await fetch(url); if (r.ok) { up = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 400));
}
if (!up) { console.error('server never up'); server.kill(); process.exit(1); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', (m) => console.log('[console:' + m.type() + '] ' + m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror] ' + String(e).slice(0, 500)));
page.on('requestfailed', (r) => console.log('[reqfail] ' + r.url().slice(0, 120) + ' ' + (r.failure()?.errorText || '')));
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => ({
    hasNT: !!window.__NT,
    ready: window.__NT && window.__NT.ready,
    start: !!document.getElementById('start'),
  }));
  console.log('t=' + ((i + 1) * 2) + 's ' + JSON.stringify(st));
  if (st.ready) break;
}
await browser.close();
server.kill();
process.exit(0);
