/** Temporary: what collider blocks (5.1,-27.5)? Lives in repo root, deleted after. */
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
for (let i = 0; i < 150; i++) {
  try { const r = await fetch(url); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 400));
}
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror] ' + String(e).slice(0, 200)));
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, { timeout: 60000 });
const out = await page.evaluate(() => {
  const nt = window.__NT;
  const res = {};
  // sweep x=2..16 at the stuck z, at foot and head height
  for (let x = 2; x <= 16; x += 1) {
    res['x=' + x] = {
      y0: nt.collidersAt(x, -27.5, 0.2),
      y1: nt.collidersAt(x, -27.5, 1.0),
    };
  }
  res.stats = nt.stats();
  return res;
});
console.log(JSON.stringify(out, null, 1).slice(0, 4000));
await browser.close();
server.kill();
process.exit(0);
