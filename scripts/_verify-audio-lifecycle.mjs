import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { stockBrowser } from './lib/stock-browser.mjs';

// This is a browser proof, not a source-pattern test. It bundles the service
// into an isolated fixture and drives the fixture with trusted browser input.
const servicePath = join(process.cwd(), 'src', 'audio', 'service.ts');
const outDir = join(process.cwd(), 'captures', 'audio-lifecycle');
mkdirSync(outDir, { recursive: true });
const bundle = (await build({
  entryPoints: [servicePath],
  bundle: true,
  format: 'iife',
  globalName: 'AudioBundle',
  platform: 'browser',
  target: 'es2022',
  write: false,
})).outputFiles[0].text.replaceAll('</script>', '<\\/script>');

const fixture = `<!doctype html>
<meta charset="utf-8">
<base href="http://127.0.0.1/">
<title>Audio lifecycle fixture</title>
<button id="unlock">Unlock audio</button>
<label>Environment <select id="environment" aria-label="Environment">
  <option value="clear">clear</option><option value="wind">wind</option>
  <option value="rain">rain</option><option value="storm">storm</option>
</select></label>
<label>Master volume <input id="master" aria-label="Master volume" type="range" min="0" max="1" step="0.01" value="0.8"></label>
<label>Effects volume <input id="effects" aria-label="Effects volume" type="range" min="0" max="1" step="0.01" value="0.9"></label>
<button id="fire">Fire 32 cues</button>
<button id="repeat">Repeat current environment</button>
<button id="recreate">Dispose and recreate</button>
<button id="fallback">Missing recorded bank</button>
<button id="race">Late decode race</button>
<pre id="state"></pre>
<script>${bundle}</script>
<script>
(() => {
  const counters = { contexts: 0, sources: 0, loopStarts: 0, starts: 0, targetCalls: 0, decodes: 0, fetches: 0, fetchErrors: 0 };
  const pendingFetches = [];
  let deferFetch = false;
  let missingRecorded = false;
  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  const NativeStart = window.AudioBufferSourceNode?.prototype.start;
  if (NativeStart && window.AudioBufferSourceNode) {
    window.AudioBufferSourceNode.prototype.start = function(...args) {
      counters.starts++;
      if (this.loop) counters.loopStarts++;
      return NativeStart.apply(this, args);
    };
  }
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) { super(...args); counters.contexts++; }
    createBufferSource(...args) {
      counters.sources++;
      return super.createBufferSource(...args);
    }
    createGain(...args) {
      const gain = super.createGain(...args);
      const param = gain.gain;
      const original = param.setTargetAtTime.bind(param);
      param.setTargetAtTime = (value, time, tau) => {
        counters.targetCalls++;
        return original(value, time, tau);
      };
      return gain;
    }
    decodeAudioData(...args) {
      counters.decodes++;
      return super.decodeAudioData(...args);
    }
  };
  // A tiny valid PCM WAV is enough for the browser's real decoder. Every URL
  // returns it, so the service's 21-entry bank is loaded without network data.
  const wav = new Uint8Array(44 + 160);
  const view = new DataView(wav.buffer);
  const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data');
  view.setUint32(40, 160, true);
  window.fetch = async (_url, _opts) => {
    counters.fetches++;
    if (deferFetch) return await new Promise(resolve => pendingFetches.push(resolve));
    if (missingRecorded && (String(_url).includes('/audio-recorded/') || String(_url).includes('/audio-foley/'))) return new Response('', { status: 404 });
    try {
      return new Response(wav.slice().buffer, { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    } catch (error) {
      counters.fetchErrors++;
      throw error;
    }
  };
  const resolvePending = () => {
    deferFetch = false;
    for (const resolve of pendingFetches.splice(0)) {
      resolve(new Response(wav.slice().buffer, { status: 200, headers: { 'Content-Type': 'audio/wav' } }));
    }
  };

  let service = new AudioBundle.AudioService();
  service.setEnvironment('storm', 0.75);
  // These calls happen before the trusted click. They must stay inert.
  service.shot('longhorn'); service.impact(5, false); service.preload();
  const preGesture = { stats: service.audioStats(), contexts: counters.contexts, sources: counters.sources };

  const show = () => document.querySelector('#state').textContent = JSON.stringify({ stats: service.audioStats(), counters }, null, 2);
  document.querySelector('#unlock').addEventListener('click', () => { service.resume(); show(); });
  document.querySelector('#environment').addEventListener('change', event => {
    service.setEnvironment(event.target.value, 0.75); show();
  });
  document.querySelector('#master').addEventListener('input', event => { service.setMasterVolume(Number(event.target.value)); show(); });
  document.querySelector('#effects').addEventListener('input', event => { service.setEffectsVolume(Number(event.target.value)); show(); });
  document.querySelector('#fire').addEventListener('click', () => {
    for (let i = 0; i < 32; i++) service.shot('longhorn'); show();
  });
  document.querySelector('#repeat').addEventListener('click', () => {
    const kind = document.querySelector('#environment').value;
    for (let i = 0; i < 32; i++) service.setEnvironment(kind, 0.75);
    show();
  });
  document.querySelector('#recreate').addEventListener('click', () => {
    service.dispose();
    service.setMasterVolume(0.6); service.setEffectsVolume(0.35); service.setEnvironment('wind', 0.5);
    service.resume(); show();
  });
  document.querySelector('#race').addEventListener('click', () => {
    service.dispose(); service.setEnvironment('storm', 0.75); deferFetch = true; service.resume();
    service.dispose(); resolvePending(); show();
  });
  document.querySelector('#fallback').addEventListener('click', () => {
    service.dispose(); missingRecorded = true; service.resume(); show();
  });
  window.__audioFixture = { counters, preGesture, get service() { return service; }, resolvePending, show };
  show();
})();
</script>`;

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const fixtureUrl = `http://127.0.0.1:${address.port}/`;
const owned = await stockBrowser('audio-lifecycle');
const { page } = owned;
const result = { checks: [], errors: [], url: 'isolated browser fixture' };
const check = (name, pass, value) => result.checks.push({ name, pass, value });
page.on('pageerror', error => result.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
const stats = () => page.evaluate(() => window.__audioFixture.service.audioStats());
try {
  await page.goto(fixtureUrl, { waitUntil: 'load' });
  const before = await page.evaluate(() => window.__audioFixture.preGesture);
  check('Pre-gesture cues are inert', before.stats.state === 'none' && !before.stats.unlocked && before.contexts === 0 && before.sources === 0, before);

  await page.getByRole('button', { name: 'Unlock audio' }).click();
  await page.waitForFunction(() => window.__audioFixture.service.audioStats().buffers === 21, null, { timeout: 15000 });
  const unlocked = await stats();
  check('Trusted unlock creates one context and decodes 21 buffers', unlocked.unlocked && unlocked.buffers === 21 && unlocked.state !== 'none' && (await page.evaluate(() => window.__audioFixture.counters.contexts)) === 1, unlocked);
  check('Available recorded shots replace five authored buffers without growing the bank', unlocked.recordedShots === 5 && unlocked.buffers === 21, unlocked);
  check('Six recorded steps and two mechanisms share the same bounded bank', unlocked.recordedFoley === 8 && unlocked.buffers === 21, unlocked);

  const setRange = async (label, steps) => {
    const control = page.getByLabel(label);
    await control.press('Home');
    for (let i = 0; i < steps; i++) await control.press('ArrowRight');
  };
  await setRange('Master volume', 60);
  await setRange('Effects volume', 35);
  await page.waitForTimeout(150);
  const volumes = await stats();
  check('Volume controls reach actual graph gains', Math.abs(volumes.masterGain - 0.36) < 0.002 && Math.abs(volumes.effectsGain - 0.35) < 0.002, volumes);

  await page.getByLabel('Environment').selectOption('storm');
  await page.waitForFunction(() => window.__audioFixture.service.audioStats().ambientLoops === 2, null, { timeout: 5000 });
  const loops = await stats();
  const targetBefore = await page.evaluate(() => window.__audioFixture.counters.targetCalls);
  await page.getByRole('button', { name: 'Repeat current environment' }).click();
  const targetAfter = await page.evaluate(() => window.__audioFixture.counters.targetCalls);
  check('Repeated identical weather keeps two owned loops and no extra automation', loops.ambientLoops === 2 && targetAfter === targetBefore, { loops, targetBefore, targetAfter });

  await page.getByRole('button', { name: 'Fire 32 cues' }).click();
  const burst = await stats();
  check('Transient voices stay at the hard cap', burst.voices <= 16 && burst.dropped > 0, burst);
  await page.waitForTimeout(350);
  check('Transient voices retire after decay', (await stats()).voices === 0, await stats());

  await page.getByRole('button', { name: 'Dispose and recreate' }).click();
  await page.waitForFunction(() => window.__audioFixture.service.audioStats().buffers === 21, null, { timeout: 15000 });
  const recreated = await stats();
  check('Dispose/recreate restores configured gains and bounded loops', Math.abs(recreated.masterGain - 0.36) < 0.002 && Math.abs(recreated.effectsGain - 0.35) < 0.002 && recreated.ambientLoops <= 2 && recreated.unlocked, recreated);

  const fetchBefore = await page.evaluate(() => window.__audioFixture.counters.fetches);
  await page.getByRole('button', { name: 'Missing recorded bank' }).click();
  await page.waitForFunction(() => window.__audioFixture.service.audioStats().buffers === 21, null, { timeout: 15000 });
  const fallback = await stats();
  const fallbackRequests = await page.evaluate(() => window.__audioFixture.counters.fetches) - fetchBefore;
  check('Missing recorded files fall back once to the bounded authored bank', fallback.recordedShots === 0 && fallback.recordedFoley === 0 && fallback.buffers === 21 && fallbackRequests === 34, { fallback, fallbackRequests });

  await page.getByRole('button', { name: 'Late decode race' }).click();
  await page.waitForTimeout(300);
  const raced = await stats();
  check('Late decodes cannot repopulate a disposed service', raced.buffers === 0 && raced.recordedShots === 0 && raced.ambientLoops === 0 && raced.voices === 0 && !raced.unlocked, raced);
  check('No browser errors', result.errors.length === 0, result.errors);
} catch (error) {
  result.fatal = String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  await owned.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify(result, null, 2));
if (result.fatal || result.errors.length || result.checks.some(item => !item.pass)) process.exitCode = 1;
