/** Actual boot-status source; controlled clocks/DOM, no graphics acceptance. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = join(mkdtempSync(join(tmpdir(), 'aa-boot-status-')), 'status.mjs');
await build({ entryPoints: ['src/core/boot-status.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const elements = [];
function node() { return { textContent: '', children: [], attributes: {}, style: {}, handlers: {},
  setAttribute(k, v) { this.attributes[k] = v; },
  append(...v) { this.children.push(...v); }, replaceChildren(...v) { this.children = v; },
  addEventListener(k, fn) { this.handlers[k] = fn; } }; }
const status = node(), overlay = node(); let reloads = 0;
globalThis.document = { querySelector: () => status, getElementById: () => overlay,
  createElement: () => { const n = node(); elements.push(n); return n; } };
globalThis.window = { location: { reload: () => reloads++ } };
const api = await import(pathToFileURL(out).href);
assert.equal(api.BOOT_STEP_TIMEOUT_MS, 30000); assert.equal(api.BOOT_TIMEOUT_MS, 45000);
api.bootStage('Loading animations'); assert.equal(status.textContent, 'Loading animations…');
assert.equal(await api.bootStep('Ready asset', () => Promise.resolve(42)), 42);
assert.equal(status.textContent, 'Ready asset…');
await assert.rejects(api.bootStep('Rejected asset', () => Promise.reject(Error('decode failed'))), /decode failed/);
let release; const pending = new Promise(r => release = r);
await assert.rejects(api.bootStep('Hung asset', () => pending, 5), /Hung asset took longer/);
release('late result'); // A late fulfilled fetch must not resume the rejected caller.
const originalError = console.error; console.error = () => {};
try { api.showBootError(Error('<img src=x onerror=alert(1)>')); } finally { console.error = originalError; }
assert.equal(overlay.style.display, 'flex'); assert.equal(overlay.children.length, 4);
assert.equal(overlay.children[1].attributes['data-boot-error'], 'true');
assert.equal(overlay.children[2].textContent, '<img src=x onerror=alert(1)>');
assert.equal(overlay.children[3].textContent, 'Retry loading');
overlay.children[3].handlers.click(); assert.equal(reloads, 1);
assert.throws(() => api.bootStage('Late assembly'), /Startup stopped/);
api.showBootError(Error('later')); assert.equal(overlay.children.length, 4);
const main = readFileSync('src/main.ts', 'utf8');
assert(main.indexOf("await bootStep('Starting graphics'") < main.indexOf('const ui = initUI'));
for (const stage of ['Loading surface textures', 'Loading room lighting', 'Loading scenery', 'Loading animations', 'Loading operators']) assert(main.includes(`bootStep('${stage}'`));
assert(main.indexOf("bootStage('Preparing menu')") < main.indexOf('const ui = initUI'));
assert(readFileSync('index.html', 'utf8').includes('src="/src/boot.ts"'));
assert(readFileSync('src/boot.ts', 'utf8').includes("import('./main')"));
console.log('PASS actual-source startup progress, bounded waits, rejection, late fetch, sticky error, text safety and retry; fixed 30/45s product deadlines retained');
