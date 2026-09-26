import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import net from 'node:net';
import { spawnGuarded, killTree } from './proc-guard.mjs';

/** One owned stock Chrome, no feature overrides and no owner browser profile. */
export async function stockBrowser(label = 'qa') {
  const profile = mkdtempSync(join(tmpdir(), `nuketown-${label}-`));
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
  const child = spawnGuarded('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--mute-audio', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let browser;
  async function close() {
    try { if (browser) await browser.close(); }
    finally {
      killTree(child.pid);
      const rel = relative(tmpdir(), profile);
      if (!rel.startsWith('..') && rel.startsWith('nuketown-')) {
        try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); }
        catch { /* A closing Chrome process may still hold a profile handle. */ }
      }
    }
  }
  try {
    for (let n = 0; n < 100 && !browser; n++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port); }
      catch { await new Promise(r => setTimeout(r, 200)); }
    }
    if (!browser) throw new Error('Owned Chrome CDP unavailable');
    const page = browser.contexts()[0].pages()[0];
    await page.setViewportSize({ width: 1600, height: 900 });
    return { browser, page, close };
  } catch (error) { await close(); throw error; }
}
