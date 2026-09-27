/** Bounded actual-DOM boot observation; never sends input or activates a window.
 * Software mode is diagnostic only and does not establish hardware acceptance. */
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnGuarded, cleanupAll } from './lib/proc-guard.mjs';
const url = process.argv[2];
if (!/^http:\/\/(?:localhost|127\.0\.0\.1):(?:4361|4348)\//.test(url ?? '')) throw Error('Expected owned local preview');
const hardware = process.argv.includes('--hardware');
const faultArg = process.argv.indexOf('--fault');
const fault = faultArg >= 0 ? process.argv[faultArg + 1] : null;
if (fault && !['entry', 'module', 'scenery'].includes(fault)) throw Error('Unknown loading fault');
const dir = join('captures', 'loading-' + new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(dir, { recursive: true });
const port = 9461;
const args = ['--headless=new', '--remote-debugging-port=' + port,
  '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'aa-loading-')),
  '--no-first-run', '--no-default-browser-check', '--window-size=1024,768', 'about:blank'];
if (!hardware) args.push('--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
let browser;
const report = { url, mode: hardware ? 'hardware' : 'software-diagnostic', fault, errors: [], failedRequests: [], console: [] };
const began = Date.now();
const deadline = setTimeout(() => {
  report.harnessError = 'Diagnostic exceeded its 90-second budget';
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
  cleanupAll(); process.exit(2);
}, 90_000);
try {
  spawnGuarded('C:/Program Files/Google/Chrome/Application/chrome.exe', args, { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port); }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!browser) throw Error('Owned diagnostic Chrome did not connect');
  const page = browser.contexts()[0].pages()[0];
  if (fault === 'entry') await page.route('**/index-*.js', route => route.abort('failed'));
  if (fault === 'module') await page.route('**/main-*.js', route => route.abort('failed'));
  if (fault === 'scenery') await page.route('**/field-case/field-case.glb', () => { /* deliberately pending until browser closes */ });
  page.on('pageerror', e => report.errors.push({ message: e.message, stack: e.stack }));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) report.console.push({ level: m.type(), text: m.text().slice(0, 500) }); });
  page.on('requestfailed', r => report.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) report.failedRequests.push({ url: r.url(), status: r.status() }); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  try { await page.waitForFunction(() => !!document.querySelector('.aa-root') || document.querySelector('#start [role=status]')?.getAttribute('data-boot-error') === 'true', null, { timeout: fault ? 50000 : 30000 }); }
  catch { report.menuTimedOut = true; }
  report.elapsedMs = Date.now() - began;
  report.dom = await page.evaluate(() => ({ title: document.title, url: location.href,
    start: document.querySelector('#start')?.innerText, menu: !!document.querySelector('.aa-root'),
    backend: document.querySelector('canvas')?.dataset.ntBackend, ready: window.__NT?.ready === true,
    bootError: document.querySelector('#start [role=status]')?.getAttribute('data-boot-error') === 'true',
    retry: Array.from(document.querySelectorAll('#start button')).some(b => b.textContent === 'Retry loading') }));
  try { await page.screenshot({ path: join(dir, 'boot.png'), timeout: 15000 }); }
  catch (e) { report.screenshotError = String(e); }
} catch (e) { report.harnessError = String(e); }
finally { if (browser) await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 2000))]); cleanupAll(); clearTimeout(deadline); }
writeFileSync(join(dir, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ dir, ...report }, null, 2));
if (fault ? !report.dom?.bootError || !report.dom?.retry || report.dom?.menu || report.dom?.ready : !report.dom?.menu || report.errors.length) process.exitCode = 1;
if (report.harnessError) process.exitCode = 1;
