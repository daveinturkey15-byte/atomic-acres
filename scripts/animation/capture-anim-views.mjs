/**
 * Photograph an animated figure IN THE GAME, from four camera views.
 *
 * docs/LICENCES-ANIMATION.md obligation 6: a clip is never accepted from a
 * preview that renders on its own body model at its own scale - only from the
 * game, from four views, with a measured foot-slide figure. This is that gate.
 *
 * It is modelled on scripts/playcap.mjs and keeps its two load-bearing
 * properties, because breaking either of them is how a black screen shipped
 * behind ten green captures on 2026-09-18:
 *
 *   - REAL CHROME OVER CDP. Playwright's bundled Chromium has no WebGPU adapter,
 *     so `chromium.launch()` silently measures the WebGL2 fallback.
 *   - THE GAME'S OWN FRAME LOOP. It clicks to play and never calls __NT.render()
 *     or __NT.goto(), both of which set cameraHeldByQA and take the QA path the
 *     player does not.
 *
 * The subject is PINNED (see __NTANIM.pin) so all four views frame it the same
 * way while the clip keeps playing at its authored speed. Skate is then measured
 * with the pin OFF and the controller advancing the root, because a pinned foot
 * is sliding by definition and would report the clip as perfect.
 *
 *   node scripts/animation/capture-anim-views.mjs --clip walk --tag canary
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from '../lib/preview.mjs';
import { spawnGuarded, killTree } from '../lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'captures', 'anim');
const argv = process.argv.slice(2);
const opt = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const clipName = opt('clip', 'walk');
const tag = opt('tag', clipName);
/** Same floor playcap uses. A lit exterior sits 90-140; the black-screen bug read 1.4. */
const DARK_THRESHOLD = 40;

// Open ground in the turning circle, which scripts/paths.mjs reports reachable
// from either spawn, so the subject cannot be standing inside a collider.
let SUBJECT = { x: -6.0, z: 0.0, yaw: 0 };   // yaw 0 = facing +Z, the rig's forward; refined below
const D = 3.6;
/**
 * Camera yaw convention: the camera looks down -Z at yaw 0, so a camera placed
 * at +Z of the subject with yaw 0 is looking back at its FACE.
 */
const VIEWS = [
  { name: 'front', dx: 0, dz: D, yaw: 0, pitch: -0.06, y: null },
  { name: 'side', dx: D, dz: 0, yaw: Math.PI / 2, pitch: -0.06, y: null },
  { name: 'threequarter', dx: D * 0.72, dz: D * 0.72, yaw: Math.PI / 4, pitch: -0.08, y: null },
  // `y` here is the PLAYER's feet, not the camera: syncCamera() puts the camera
  // at pos.y + EYE_HEIGHT (1.68 m). A "low" camera therefore needs a NEGATIVE
  // y, and passing 0.32 puts the lens at 2.0 m - above head height, which is
  // how the first low shot came back pointing at the sky. -1.30 = lens at 38 cm.
  { name: 'low', dx: D * 0.42, dz: D * 0.52, yaw: Math.PI / 4 + 0.10, pitch: 0.20, y: -1.30 },
];

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function chromePath() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}

const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[anim] no real Chrome; this harness needs a WebGPU adapter'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-anim-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  // Monitor 2 - never over the owner's screen.
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('[anim] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));

console.log('[anim] ' + url + '   clip=' + clipName);
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.__NTANIM && window.__NTANIM.ready === true, null, { timeout: 30000 });
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

// Which clips actually came from the bakery, straight from the running game.
const load = await page.evaluate(async () => {
  await window.__NTANIM.load();
  return { report: window.__NTANIM.report(), count: window.__NTANIM.count() };
});
console.log('[anim] figures ' + load.count);
for (const [k, v] of Object.entries(load.report)) console.log('       ' + k.padEnd(16) + v);

// Prove the SHIPPED wiring, not only the harness path.
const subst = await page.evaluate(() => window.__NTANIM.verifySubstitution());
const bakedNames = Object.entries(subst).filter(([, v]) => v.startsWith('BAKED')).map(([k]) => k);
const failed = Object.entries(subst).filter(([, v]) => v.includes('FAILED')).map(([k]) => k);
console.log(`[anim] library substitution: ${bakedNames.length} of ${Object.keys(subst).length} ClipNames come back BAKED`
  + (failed.length ? `   FAILED: ${failed.join(', ')}` : '   (no failures)'));
console.log('       baked: ' + bakedNames.join(', '));
console.log('       still procedural: ' + Object.entries(subst).filter(([, v]) => v.startsWith('procedural (')).map(([k]) => k).join(', '));

const spec = await page.evaluate(async ([name]) => {
  const m = window.__NTANIM.manifest();
  return (m && m.clips ? m.clips.find((c) => c.id === name) : null) ?? null;
}, [clipName]);
if (!spec) { console.error(`[anim] ${clipName} is not in the baked manifest`); await browser.close(); killTree(chrome.pid); process.exit(2); }
console.log(`[anim] ${clipName}: ${spec.frames}f  ${spec.duration}s  speed ${spec.speed} m/s  offline slide ${spec.footSlideCm} cm`);

// ---- pick a CLEAR stage, do not assume one.
// The first run put the subject on the turning circle at (-6, 0) and a signpost
// ran straight through it in the front view. A canary photographed through a
// pole is not evidence about a clip. `collidersAt(x, z, y)` already answers
// "what is here?", so the harness asks it instead of guessing: score a grid on
// how clear the subject's own footprint is AND how clear the four camera stands
// are, and take the best.
SUBJECT = await page.evaluate(([base, d]) => {
  const busy = (x, z) => {
    let n = 0;
    for (const y of [0.4, 1.0, 1.7]) n += window.__NT.collidersAt(x, z, y).length;
    return n;
  };
  const cams = [[0, d], [d, 0], [d * 0.72, d * 0.72], [d * 0.5, d * 0.62]];
  let best = null;
  for (let x = -14; x <= 10; x += 2) {
    for (let z = -12; z <= 12; z += 2) {
      let n = busy(x, z) * 8;
      // the subject's own breathing room
      for (let a = 0; a < 8; a++) n += busy(x + Math.cos(a) * 1.3, z + Math.sin(a) * 1.3) * 2;
      // and the sight line each camera will look down
      for (const [dx, dz] of cams) {
        n += busy(x + dx, z + dz) * 3;
        n += busy(x + dx * 0.5, z + dz * 0.5) * 4;
      }
      if (!best || n < best.n) best = { x, z, n };
    }
  }
  return { x: best.x, z: best.z, yaw: base.yaw, clutter: best.n };
}, [SUBJECT, D]);
console.log(`[anim] stage (${SUBJECT.x}, ${SUBJECT.z})  clutter score ${SUBJECT.clutter} (0 = nothing within the frame)`);

// Subject: one figure, on the mark, driven at the clip's own speed so the blend
// tree picks this clip and sets timeScale to exactly 1.
mkdirSync(OUT, { recursive: true });
const armed = await page.evaluate(async ([s, speed, name]) => {
  // main.ts does not call characters.update() on this branch, so nothing ticks
  // the rigs; the harness drives them until that line lands. See the report.
  window.__NTANIM.selfTick(true);
  window.__NTANIM.solo(0);
  window.__NTANIM.place(0, s.x, s.z, s.yaw);
  window.__NTANIM.drive(0, speed);
  // The BAKED clip, from the bakery registry - not rig.library, which was built
  // before the fetch resolved and still holds the procedural set.
  const ok = await window.__NTANIM.external(0, name);
  window.__NTANIM.pin(0, s.x, s.z, s.yaw);
  return ok;
}, [SUBJECT, Math.max(0.01, spec.speed), clipName]);
if (!armed) { console.error(`[anim] ${clipName} is not in the loaded bakery registry - refusing to photograph the procedural clip and call it the canary`); await browser.close(); killTree(chrome.pid); process.exit(2); }
await page.waitForTimeout(1500);
// Prove the rig is actually MOVING before any shutter opens. A frozen rest pose
// photographs beautifully and means nothing.
const motion = await page.evaluate(async () => {
  const s = [];
  for (let k = 0; k < 12; k++) {
    s.push(window.__NTANIM.skate(0).hipsY);
    await new Promise((r) => setTimeout(r, 60));
  }
  return { min: Math.min(...s), max: Math.max(...s) };
});
console.log(`[anim] hipsY moved ${(motion.min).toFixed(3)}..${(motion.max).toFixed(3)} m over 0.7 s`
  + `  -> ${motion.max - motion.min > 0.003 ? 'the rig is animating' : 'FROZEN - nothing is driving the mixer'}`);
if (motion.max - motion.min <= 0.003) {
  const why = await page.evaluate(() => ({
    list: window.__NTANIM.list(),
    ticking: window.__NTANIM.ticks(),
    report: window.__NTANIM.report(),
  }));
  console.error('[anim] refusing to photograph a frozen rig. state: ' + JSON.stringify(why));
  await browser.close(); killTree(chrome.pid); process.exit(3);
}

const shots = [];
for (const v of VIEWS) {
  await page.evaluate(([s, view]) => {
    if (view.y !== null) window.__NT.setMode('fly');
    else window.__NT.setMode('walk');
    window.__NT.teleport(s.x + view.dx, view.y ?? 0, s.z + view.dz, view.yaw, view.pitch);
    if (window.__NT.release) window.__NT.release();
    // AFTER release(), not before: release() calls weapons.setVisible(true), so
    // hiding the viewmodel first just gets it switched straight back on and the
    // gun eats a third of every frame.
    try { window.__NT.weaponCmd('visible', false); } catch { /* weapons lane may change */ }
  }, [SUBJECT, v]);
  await page.waitForTimeout(700);
  const cam = await page.evaluate(() => window.__NT.probePos());
  const shot = await page.screenshot({ type: 'png' });
  const file = join(OUT, `${tag}-${v.name}.png`);
  writeFileSync(file, shot);
  const luma = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = 200; c.height = 112;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 200, 112);
    const d = g.getImageData(0, 0, 200, 112).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }, shot.toString('base64'));
  const ok = luma >= DARK_THRESHOLD;
  shots.push({ view: v.name, luma: +luma.toFixed(1), ok, lensY: +(cam[1] + 1.68).toFixed(2), file });
  console.log(`  ${ok ? 'OK  ' : 'DARK'}  ${v.name.padEnd(13)} luma ${luma.toFixed(1).padStart(6)}  lens y ${(cam[1] + 1.68).toFixed(2)} m  -> ${file}`);
}

// ---- foot slide, in the game, with the controller owning the root.
// Pin OFF: the whole measurement is whether a planted foot holds world position
// while the body advances, and a pinned body advances nowhere.
let slide = null;
if (spec.speed > 0.25) {
  await page.evaluate(([s]) => {
    window.__NTANIM.unpin();
    window.__NT.setMode('walk');
    // Watch from a distance the LOD does not thin: under 25 m every rig ticks
    // every frame, and a rig ticking every 6th frame cannot be measured.
    window.__NT.teleport(s.x + 6, 0, s.z - 10, Math.PI / 4, 0);
    window.__NTANIM.place(0, s.x, s.z - 14, 0);
    window.__NTANIM.skateStart(0);
  }, [SUBJECT]);
  await page.waitForTimeout(9000);
  slide = await page.evaluate(() => {
    const r = window.__NTANIM.skate(0);
    window.__NTANIM.skateStop();
    return r;
  });
  console.log(`[anim] in-game skate: worst ${slide.worstCm} cm over ${slide.strides} strides`
    + `   footY L ${slide.footYLeft} R ${slide.footYRight}   hipsY ${slide.hipsY}`);
}

const stats = await page.evaluate(() => { try { return window.__NT.stats(); } catch { return {}; } });
await page.evaluate(() => { window.__NTANIM.showAll(); });
await browser.close();
killTree(chrome.pid);

if (errors.length) console.log('[anim] console errors:\n  ' + errors.slice(0, 8).join('\n  '));
const dark = shots.filter((s) => !s.ok);
const summary = { clip: clipName, url, threshold: DARK_THRESHOLD, spec, report: load.report, substitution: subst, motion, shots, skate: slide, stats, errors };
writeFileSync(join(OUT, `${tag}-summary.json`), JSON.stringify(summary, null, 2));
console.log(`[anim] ${shots.length - dark.length}/${shots.length} views lit through the REAL game loop`
  + `   draw calls ${stats.calls ?? '?'}  programs ${stats.programs ?? '?'}`);
process.exit(dark.length ? 1 : 0);
