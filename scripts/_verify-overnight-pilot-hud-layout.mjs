/** Standalone PilotControlView DOM layout fixture. Authored aircraft data is
 * deliberate component input, never earned-streak/gameplay/authority evidence.
 * Default: CPU-only preparation. --run --fixture <directory>: root's serial
 * headless lane only. Does not build or launch the game. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { stockBrowser } from './lib/stock-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePath = join(root, 'src/core/pilot-controls.ts');
const viewports = [{ width: 1600, height: 900 }, { width: 390, height: 844 }];
const scope = 'UI COMPONENT FIXTURE ONLY. Authored aircraft snapshot; no earned charge, host, match, renderer or gameplay proof.';
const negativeRef = opt('negative-ref', '56006ef65f813f1215f62608587661ffb0152322');
const fixtureArg = opt('fixture', null);
const tag = opt('tag', 'overnight-pilot-hud-layout-source');
assert(/^[a-z0-9_-]+$/i.test(tag), 'safe unique tag required');
const out = fixtureArg ? resolve(root, fixtureArg) : join(root, 'captures', tag);
const within = relative(join(root, 'captures'), out);
assert(within && !isAbsolute(within) && !within.startsWith('..'), 'fixture must be inside this repository captures directory');

function transpile(bytes, fileName) {
  const result = ts.transpileModule(bytes.toString('utf8'), { fileName, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true } });
  assert(!result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error), 'component transpilation must succeed');
  // This class imports Three and protocol types only. A runtime dependency now
  // would require an explicit fixture update, never silently a game bundle.
  assert(!/^import\s/m.test(result.outputText), 'unexpected runtime import in isolated component');
  return result.outputText;
}

function prepare() {
  assert(!existsSync(out), 'choose a fresh tag; preserve all earlier fixtures and receipts');
  assert(/^[a-f0-9]{40}$/i.test(negativeRef), 'negative control requires an exact Git commit');
  const previous = spawnSync('git', ['show', `${negativeRef}:src/core/pilot-controls.ts`], { cwd: root, windowsHide: true });
  assert.equal(previous.status, 0, 'exact previous component must exist');
  const current = readFileSync(sourcePath), legacy = previous.stdout, index = readFileSync(join(root, 'index.html'));
  assert(legacy.includes(Buffer.from("position: 'absolute'")), 'previous source must retain original absolute positioning');
  assert(current.includes(Buffer.from("position: 'fixed'")), 'candidate source must be the proposed fixed layout');
  assert.notEqual(digest(current), digest(legacy), 'negative control must differ');
  const hudRule = index.toString('utf8').match(/#hud\s*\{[^}]+\}/)?.[0];
  assert(hudRule && /position:fixed/.test(hudRule), 'literal legacy #hud rule required');
  mkdirSync(out, { recursive: true });
  const files = { 'current-source.ts': current, 'negative-source.ts': legacy, 'index-source.html': index,
    'current.js': transpile(current, 'current-source.ts'), 'negative.js': transpile(legacy, 'negative-source.ts') };
  files['fixture.js'] = `
const variant = new URL(location.href).searchParams.get('variant');
if (!['current', 'negative'].includes(variant)) throw Error('Explicit component variant required');
const { PilotControlView } = await import('./' + variant + '.js');
const calls = { transitions: [], sends: [], exits: 0, streaks: [], projectionUpdates: 0 };
// Minimal camera dependency is an explicit component double; no renderer exists.
const camera = { fov: 84, position: { set(...v) { this.value = v; } }, rotation: { set(...v) { this.value = v; } },
  updateProjectionMatrix() { calls.projectionUpdates++; } };
const view = new PilotControlView({ camera, canvas: document.querySelector('canvas'), hud: document.querySelector('#hud'),
  send: input => calls.sends.push(input), exit: () => calls.exits++, streak: slot => calls.streaks.push(slot),
  transition: active => calls.transitions.push(active), lookSettings: () => ({ sensitivity: 1, invertY: false }) });
const row = Object.freeze({ kind: 'aircraft', variant: 'piloted-drone', instanceId: 901,
  actorId: 'layout-fixture', team: 0, streakId: 'piloted-drone', x: 3, y: 8, z: 2,
  yaw: 0, pitch: 0, remainingMs: 30000, health: 100, controlled: true, units: 1 });
let now = 1000;
function read() {
  const hint = document.querySelector('.hud-pilot'), hud = document.querySelector('#hud');
  const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  const style = hint && getComputedStyle(hint), lines = new Map();
  if (hint?.firstChild && style.display !== 'none') {
    const node = hint.firstChild, range = document.createRange();
    for (let i = 0; i < node.textContent.length; i++) {
      if (node.textContent[i] === '\\n') continue;
      range.setStart(node, i); range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const key = Math.round(r.top * 100) / 100;
      const line = lines.get(key) ?? { top: key, left: r.left, right: r.right, text: '' };
      line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.text += node.textContent[i]; lines.set(key, line);
    }
  }
  return { variant, viewport: { width: innerWidth, height: innerHeight }, hud: rect(hud),
    hint: hint ? { rect: rect(hint), text: hint.textContent, display: style.display, position: style.position,
      fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), scrollWidth: hint.scrollWidth,
      clientWidth: hint.clientWidth, lines: [...lines.values()] } : null,
    active: view.active(), snapshot: view.snapshot(), cameraFov: camera.fov, calls: structuredClone(calls) };
}
window.__pilotLayout = {
  scope: ${JSON.stringify(scope)}, read,
  activate() { now += 1000; view.sync([row], row.actorId, true, now, now); view.update(now); return read(); },
  hide() { view.sync([], row.actorId, true, now, now); return read(); },
  reset() { view.reset(); return read(); },
  stale() { view.sync([row], row.actorId, true, now, now + 751); return read(); },
  dispose() { view.dispose(); view.update(now + 50); return read(); },
};
window.__pilotLayoutReady = true;
`;
  files['index.html'] = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Pilot HUD component fixture</title><style>
html,body{margin:0;height:100%;background:#0b0d10;overflow:hidden}canvas{display:block;width:100%;height:100%}
${hudRule}
#fixture-label{position:fixed;bottom:12px;left:12px;right:12px;color:#aaa;font:12px system-ui}
</style></head><body><canvas></canvas><div id="hud"><div>29 FPS</div></div><div id="fixture-label">${scope}</div><script type="module" src="./fixture.js"></script></body></html>`;
  for (const [file, bytes] of Object.entries(files)) writeFileSync(join(out, file), bytes);
  const manifest = { status: 'PREPARED_NOT_BROWSER_VERIFIED', scope, preparedAt: new Date().toISOString(), negativeRef,
    harnessSha256: digest(readFileSync(fileURLToPath(import.meta.url))), viewports, hudRule,
    sourceSha256: digest(current), negativeSourceSha256: digest(legacy), files: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, digest(bytes)])) };
  writeFileSync(join(out, 'fixture-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ status: manifest.status, fixture: out, sourceSha256: manifest.sourceSha256, negativeSourceSha256: manifest.negativeSourceSha256 }));
}

function layoutChecks(s) {
  const h = s.hint, r = h.rect, w = s.viewport.width, tall = s.viewport.height;
  return {
    compactLegacyContainer: s.hud.width < 100 && s.hud.height < 40,
    visibleAndActive: h.display !== 'none' && s.active,
    whollyInsideViewport: r.x >= 0 && r.y >= 0 && r.right <= w && r.bottom <= tall,
    noHorizontalOverflow: h.scrollWidth <= h.clientWidth,
    readableFont: h.fontSize >= 12 && h.lineHeight >= 18,
    sensibleWidth: w >= 1000 ? r.width >= 560 && r.width <= 640 : r.width >= 300 && r.width <= w - 24,
    readableLines: h.lines.length >= 2 && h.lines.length <= (w >= 1000 ? 3 : 6),
    completeControlText: /PILOTED DRONE/.test(h.text) && /WASD fly/.test(h.text) && /Esc return/.test(h.text),
  };
}

async function run() {
  assert(fixtureArg, '--run requires --fixture pointing to a prepared unique directory');
  assert(!existsSync(join(out, 'report.json')), 'refusing to overwrite a previous run');
  const manifest = JSON.parse(readFileSync(join(out, 'fixture-manifest.json'), 'utf8'));
  assert.equal(manifest.sourceSha256, digest(readFileSync(sourcePath)), 'live source drifted; prepare a new exact-source fixture');
  assert.equal(manifest.harnessSha256, digest(readFileSync(fileURLToPath(import.meta.url))), 'helper drifted since preparation');
  for (const [file, expected] of Object.entries(manifest.files)) assert.equal(digest(readFileSync(join(out, file))), expected, `fixture drift: ${file}`);
  const report = { status: 'OPEN', scope, manifest, startedAt: new Date().toISOString(), checks: [], samples: [], screenshots: [], errors: [] };
  const serve = new Set(['index.html', 'fixture.js', 'current.js', 'negative.js']);
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
    if (!serve.has(path)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    response.end(readFileSync(join(out, path)));
  });
  let owned;
  const check = (name, pass, evidence) => { report.checks.push({ name, pass, evidence }); };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    owned = await stockBrowser('pilot-hud-layout'); const { page } = owned;
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    for (const variant of ['negative', 'current']) for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(url + '?variant=' + variant, { waitUntil: 'load', timeout: 15000 });
      await page.waitForFunction(() => window.__pilotLayoutReady, null, { timeout: 5000 });
      await page.evaluate(() => window.__pilotLayout.activate());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const sample = await page.evaluate(() => window.__pilotLayout.read());
      const checks = layoutChecks(sample); report.samples.push({ variant, viewport, sample, checks });
      const file = `${variant}-${viewport.width}x${viewport.height}.png`;
      await page.screenshot({ path: join(out, file) }); report.screenshots.push({ file, sha256: digest(readFileSync(join(out, file))) });
      if (variant === 'current') for (const [name, pass] of Object.entries(checks)) check(`${variant} ${viewport.width} ${name}`, pass);
      else check(`negative ${viewport.width} original layout is rejected`,
        !checks.whollyInsideViewport || !checks.noHorizontalOverflow || !checks.sensibleWidth || !checks.readableLines, checks);
      for (const action of ['hide', 'reset', 'stale']) {
        await page.evaluate(() => window.__pilotLayout.activate());
        const result = await page.evaluate(action => window.__pilotLayout[action](), action);
        check(`${variant} ${viewport.width} ${action} hides and restores`, !result.active && result.hint.display === 'none' && result.cameraFov === 84, result);
      }
      await page.evaluate(() => window.__pilotLayout.activate());
      const disposed = await page.evaluate(() => window.__pilotLayout.dispose());
      check(`${variant} ${viewport.width} dispose removes card and deactivates`, !disposed.hint && !disposed.active && disposed.cameraFov === 84, disposed);
    }
    check('no browser errors', report.errors.length === 0, report.errors);
    assert(report.checks.every(c => c.pass), 'component layout/lifecycle or negative-control gate failed');
    report.status = 'PASS_COMPONENT_ONLY';
  } catch (error) { report.status = 'FAIL'; report.failure = String(error?.stack ?? error); process.exitCode = 1; }
  finally {
    await owned?.close(); await new Promise(resolve => server.close(resolve));
    report.endedAt = new Date().toISOString(); writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: join(out, 'report.json') }));
  }
}

if (args.includes('--run')) await run(); else prepare();
