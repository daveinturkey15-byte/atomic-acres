/**
 * ATMOSPHERE lane verifier - one real Chrome over CDP (playcap's launch block), the
 * shared preview on :4188, 1600x900, WebGPU. Produces the evidence the brief asks for:
 *
 *   1. LIGHT-COUNT ASSERTION: THREE.Light count before and after every preset and
 *      weather switch (PASS 82), plus the env re-bake cost and the shadow fit per preset.
 *   2. PRESET / WEATHER FRAMES: turningHead, spawnA, interiorOrange for each time of
 *      day (clear) and for noon x overcast / rain, switched at runtime through
 *      __NTATMO (no reload), with the draw-call count per frame.
 *   3. EFFECT TOGGLES: ?post=ao whole-frame mean with ao on/off (off must read > 225);
 *      bloom on/off at turningHead with the 20 px block that lost the most luma; fog
 *      on/off with the turningHead mountains rect; draw calls before/after every toggle.
 *   4. SMOKE: two grenade volumes + one blast puff injected through the QA hook,
 *      photographed from 6 m and from inside (real loop, weapon hidden), and the
 *      ?post=smoke opacity mask of the same layout.
 *   5. FPS through the REAL loop (__NT.stats().fps sampled once a second for 10 s):
 *      spawnA as a player, whitePoolRoom with the two grenades + blast in view, and
 *      whitePoolRoom clear.
 *   6. URL ROUTE: ?tod=dusk&weather=rain reports dusk/rain on load.
 *
 *   node scripts/_verify-atmo.mjs            # writes captures/atmo-*.png + atmo-verify.json
 */
import { chromium } from 'playwright';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { readPng, rectStats, luma } from './_critic-png.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const PI = Math.PI;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
const TAG = process.env.ATMO_TAG || 'atmo';
const STATIONS = ['turningHead', 'spawnA', 'interiorOrange'];
const TODS = ['noon', 'morning', 'goldenHour', 'dusk', 'overcastNoon'];
const WEATHERS = ['overcast', 'rain'];
const WHITE_POOL = { x: 9.0, y: 0, z: 20.0, yaw: PI };
/** spawnA faces +z; the test cloud sits 6 m down the lawn toward the orange house. */
const SMOKE_6M = { cam: { x: -4.0, y: 0, z: -34.3, yaw: PI }, vols: [
  ['grenade', -6.0, 1.2, -28.3], ['grenade', -1.5, 1.2, -27.5], ['blast', -4.0, 1.6, -30.5, 2.3]] };
const SMOKE_INSIDE = { x: -6.0, y: 0, z: -28.3, yaw: PI };
const POOL_SMOKES = [['grenade', 6.5, 1.3, 26], ['grenade', 11.5, 1.3, 25], ['blast', 9, 1.6, 23.5, 2.3]];

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function chromePath() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  return c.find((p) => existsSync(p)) ?? null;
}

const { url } = await usePreview();
mkdirSync(OUT, { recursive: true });
const exe = chromePath();
if (!exe) { console.error('[atmo] no installed Chrome - refusing the swiftshader path'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-atmo-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let browser = null;
for (let i = 0; i < 200 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { killTree(chrome.pid); console.error('[atmo] no CDP'); process.exit(2); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 300)));

const out = { when: new Date().toISOString(), url, tag: TAG, lights: {}, presets: [], effects: {}, smoke: {}, fps: {}, urlRoute: {} };
const sleep = (ms) => page.waitForTimeout(ms);
const strip = () => page.evaluate(() => {
  document.getElementById('start')?.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
});
const load = async (query) => {
  await page.goto(url + (query ? '?' + query : ''), { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true && window.__NTATMO && window.__NTPOST, null, { timeout: 180000 });
  await strip();
  await sleep(2000);
};
const shoot = async (file) => { const f = join(OUT, TAG + '-' + file + '.png'); await page.screenshot({ path: f }); return f; };
const gotoShoot = async (station, file) => {
  await page.evaluate((n) => window.__NT.goto(n), station);
  await sleep(350);
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__NT.render()); await sleep(90); }
  // draw calls as a delta across ONE render, the way capture.mjs measures
  const calls = await page.evaluate(() => { const b = window.__NT.stats(); window.__NT.render(); return window.__NT.stats().calls - b.calls; });
  const f = await shoot(file);
  return { file: f, calls };
};
const teleportHidden = async (p) => {
  await page.evaluate((q) => { window.__NT.release(); window.__NT.teleport(q.x, q.y, q.z, q.yaw, q.pitch ?? 0); window.__NT.weaponCmd('visible', false); }, p);
  await sleep(700);
  await strip();
  await page.evaluate(() => window.__NT.weaponCmd('visible', false));
  await sleep(500);
};
const atmoState = () => page.evaluate(() => window.__NTATMO.state());
const blockDrop = (a, b, size = 20) => {
  // the size x size block whose mean luma dropped most from a to b
  let best = { x: 0, y: 0, before: 0, after: 0, drop: -Infinity };
  for (let y = 0; y + size <= a.height; y += size) for (let x = 0; x + size <= a.width; x += size) {
    let sa = 0, sb = 0;
    for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) { sa += luma(a, xx, yy); sb += luma(b, xx, yy); }
    sa /= size * size; sb /= size * size;
    if (sa - sb > best.drop) best = { x, y, before: +sa.toFixed(1), after: +sb.toFixed(1), drop: +(sa - sb).toFixed(1) };
  }
  return best;
};

// ------------------------------------------------------------------ pass A: default
console.log('[atmo] ' + url);
await load('');
out.backend = await page.evaluate(() => window.__NT_BACKEND ?? null);

// 1. light-count assertion through every switch
const lights0 = await page.evaluate(() => window.__NTATMO.lightCount());
out.lights.before = lights0;
out.lights.switches = [];
for (const t of TODS) {
  await page.evaluate((n) => window.__NTATMO.set(n), t);
  await sleep(120);
  const st = await atmoState();
  out.lights.switches.push({ tod: t, weather: 'clear', lights: st.lights, bakeMs: st.bakeMs, shadow: st.shadow });
}
for (const w of WEATHERS) {
  await page.evaluate((n) => window.__NTATMO.weather(n), w);
  await sleep(120);
  const st = await atmoState();
  out.lights.switches.push({ tod: 'overcastNoon', weather: w, lights: st.lights, bakeMs: st.bakeMs, shadow: st.shadow });
}
await page.evaluate(() => { window.__NTATMO.set('noon'); window.__NTATMO.weather('clear'); });
out.lights.after = await page.evaluate(() => window.__NTATMO.lightCount());
out.lights.holds = out.lights.switches.every((s) => s.lights === lights0) && out.lights.after === lights0;
console.log(`[atmo] lights before ${lights0} after ${out.lights.after} across ${out.lights.switches.length} switches -> ${out.lights.holds ? 'HOLDS' : 'CHANGED'}`);
for (const s of out.lights.switches) console.log(`   ${s.tod.padEnd(13)} ${s.weather.padEnd(9)} lights ${s.lights}  bake ${String(s.bakeMs).padStart(6)} ms  shadow half ${s.shadow.half} (fitted ${s.shadow.fitted})`);

// 2. preset / weather frames at the three stations, switched at runtime
const combos = [...TODS.map((t) => [t, 'clear']), ...WEATHERS.map((w) => ['noon', w])];
for (const [t, w] of combos) {
  await page.evaluate(([a, b]) => { window.__NTATMO.set(a); window.__NTATMO.weather(b); }, [t, w]);
  await sleep(250);
  for (const st of STATIONS) {
    const r = await gotoShoot(st, `${t}-${w}-${st}`);
    const img = readPng(r.file);
    const mean = rectStats(img, [0, 0, img.width, img.height]).mean;
    out.presets.push({ tod: t, weather: w, station: st, calls: r.calls, mean, file: r.file });
    console.log(`   ${t.padEnd(13)} ${w.padEnd(9)} ${st.padEnd(15)} calls ${String(r.calls).padStart(5)}  mean ${mean}`);
  }
}
await page.evaluate(() => { window.__NTATMO.set('noon'); window.__NTATMO.weather('clear'); });
await sleep(250);

// 3a. bloom + fog toggles at turningHead (draws before/after)
{
  const on = await gotoShoot('turningHead', 'fx-bloom-on');
  await page.evaluate(() => window.__NTPOST.setEffects({ ao: true, ssr: true, bloom: false }));
  const off = await gotoShoot('turningHead', 'fx-bloom-off');
  await page.evaluate(() => window.__NTPOST.setEffects({ ao: true, ssr: false, bloom: true }));
  const ssrOff = await gotoShoot('turningHead', 'fx-ssr-off');
  await page.evaluate(() => window.__NTPOST.setEffects({ ao: true, ssr: true, bloom: true }));
  const a = readPng(on.file), b = readPng(off.file);
  const block = blockDrop(a, b);
  const skyRim = [block.x - 40, block.y - 40, block.x + 60, block.y + 60];
  out.effects.bloom = {
    callsOn: on.calls, callsOff: off.calls, callsSsrOff: ssrOff.calls,
    largestDropBlock20px: block,
    rectAroundIt: { rect: skyRim, on: rectStats(a, skyRim).mean, off: rectStats(b, skyRim).mean },
    frameMeanOn: rectStats(a, [0, 0, a.width, a.height]).mean, frameMeanOff: rectStats(b, [0, 0, b.width, b.height]).mean,
    getEffectsAfter: await page.evaluate(() => window.__NTPOST.getEffects()),
  };
  console.log(`[atmo] bloom off: block (${block.x},${block.y}) ${block.before} -> ${block.after}; rect around it ${out.effects.bloom.rectAroundIt.on} -> ${out.effects.bloom.rectAroundIt.off}; draws ${on.calls} -> ${off.calls}`);

  await page.evaluate(() => window.__NTPOST.setFog(false));
  const fogOff = await gotoShoot('turningHead', 'fx-fog-off');
  await page.evaluate(() => window.__NTPOST.setFog(true));
  const c = readPng(fogOff.file);
  const mtn = [180, 270, 700, 330];
  out.effects.fog = { callsOn: on.calls, callsOff: fogOff.calls, mountainsOn: rectStats(a, mtn).mean, mountainsOff: rectStats(c, mtn).mean, getFogAfter: await page.evaluate(() => window.__NTPOST.getFog()) };
  console.log(`[atmo] fog off: mountains ${out.effects.fog.mountainsOn} -> ${out.effects.fog.mountainsOff}; draws ${on.calls} -> ${fogOff.calls}`);
}

// 4. smoke frames: two grenades + a blast from 6 m and from inside (real loop, weapon hidden)
{
  await page.evaluate(() => window.__NTATMO.smoke.clear());
  await teleportHidden(SMOKE_6M.cam);
  await page.evaluate((vols) => { for (const v of vols) window.__NTATMO.smoke.test(v[0], v[1], v[2], v[3], v[4]); }, SMOKE_6M.vols);
  await sleep(2600);   // past the 1.5 s fill
  await page.evaluate(() => window.__NT.weaponCmd('visible', false));
  const f6 = await shoot('smoke-6m');
  const s6 = await page.evaluate(() => window.__NT.stats());
  await teleportHidden(SMOKE_INSIDE);
  await sleep(300);
  const fin = await shoot('smoke-inside');
  const sin = await page.evaluate(() => window.__NT.stats());
  const st = await atmoState();
  out.smoke = { from6m: { file: f6, calls: s6.calls, fps: s6.fps }, inside: { file: fin, calls: sin.calls, fps: sin.fps }, state: st };
  console.log(`[atmo] smoke 6 m: calls ${s6.calls} fps ${s6.fps}; inside: calls ${sin.calls} fps ${sin.fps}; volumes ${st.smokes}`);
  await page.evaluate(() => window.__NTATMO.smoke.clear());
}

// 5. fps through the real loop, 10 samples a second apart
const sampleFps = async () => {
  const s = [];
  for (let i = 0; i < 10; i++) { await sleep(1000); s.push(await page.evaluate(() => window.__NT.stats().fps)); }
  const calls = await page.evaluate(() => window.__NT.stats().calls);
  return { samples: s, min: Math.min(...s), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1), calls };
};
await page.evaluate(() => { window.__NT.spawn('a'); });
await sleep(1500);
out.fps.spawnA = await sampleFps();
console.log(`[atmo] fps spawnA (player, weapon on): min ${out.fps.spawnA.min} mean ${out.fps.spawnA.mean} calls ${out.fps.spawnA.calls}  [${out.fps.spawnA.samples.join(' ')}]`);
await page.evaluate((q) => { window.__NT.release(); window.__NT.teleport(q.x, q.y, q.z, q.yaw, 0); window.__NT.weaponCmd('visible', true); }, WHITE_POOL);
await page.evaluate((vols) => { for (const v of vols) window.__NTATMO.smoke.test(v[0], v[1], v[2], v[3], v[4]); }, POOL_SMOKES);
await sleep(2500);
out.fps.whitePoolRoomSmoke = await sampleFps();
await shoot('fps-whitePoolRoom-smoke');
console.log(`[atmo] fps whitePoolRoom + 2 grenades + blast: min ${out.fps.whitePoolRoomSmoke.min} mean ${out.fps.whitePoolRoomSmoke.mean} calls ${out.fps.whitePoolRoomSmoke.calls}  [${out.fps.whitePoolRoomSmoke.samples.join(' ')}]`);
await page.evaluate(() => window.__NTATMO.smoke.clear());
await sleep(800);
out.fps.whitePoolRoomClear = await sampleFps();
console.log(`[atmo] fps whitePoolRoom clear: min ${out.fps.whitePoolRoomClear.min} mean ${out.fps.whitePoolRoomClear.mean} calls ${out.fps.whitePoolRoomClear.calls}`);

// ------------------------------------------------------------------ pass B: ?post=ao
await load('post=ao');
{
  const on = await gotoShoot('interiorOrange', 'fx-ao-on');
  await page.evaluate(() => window.__NTPOST.setEffects({ ao: false, ssr: true, bloom: true }));
  const off = await gotoShoot('interiorOrange', 'fx-ao-off');
  const a = readPng(on.file), b = readPng(off.file);
  out.effects.ao = { meanOn: rectStats(a, [0, 0, a.width, a.height]).mean, meanOff: rectStats(b, [0, 0, b.width, b.height]).mean, callsOn: on.calls, callsOff: off.calls };
  out.effects.ao.holds = out.effects.ao.meanOff > 225 && on.calls === off.calls;
  console.log(`[atmo] ?post=ao interiorOrange mean ${out.effects.ao.meanOn} -> ao:false ${out.effects.ao.meanOff} (must be > 225); draws ${on.calls} -> ${off.calls}`);
}

// ------------------------------------------------------------------ pass C: ?post=smoke mask + ?post=fog
{
  const q = 'post=smoke&smoke=' + SMOKE_6M.vols.map((v) => `${v[1]},${v[2]},${v[3]}${v[4] ? ',' + v[4] : ''},${v[0]}`).join(';');
  await load(q);
  await teleportHidden(SMOKE_6M.cam);
  await sleep(1200);
  out.smoke.maskFile = await shoot('smoke-mask-6m');
  out.smoke.urlSmokeCount = (await atmoState()).smokes;
  await load('post=fog');
  const r = await gotoShoot('turningHead', 'fx-fog-factor');
  out.effects.fogFactorFile = r.file;
}

// ------------------------------------------------------------------ pass D: URL route
await load('tod=dusk&weather=rain');
{
  const st = await atmoState();
  const r = await gotoShoot('spawnA', 'url-dusk-rain-spawnA');
  out.urlRoute = { state: st, file: r.file, calls: r.calls, holds: st.tod === 'dusk' && st.weather === 'rain' };
  console.log(`[atmo] ?tod=dusk&weather=rain -> ${st.tod}/${st.weather} lights ${st.lights} calls ${r.calls}`);
}

out.consoleErrors = consoleErrors;
writeFileSync(join(OUT, TAG + '-verify.json'), JSON.stringify(out, null, 2));
await browser.close();
killTree(chrome.pid);
console.log('[atmo] done. console errors: ' + consoleErrors.length + (consoleErrors.length ? '\n  ' + consoleErrors.slice(0, 6).join('\n  ') : ''));
process.exit(0);
