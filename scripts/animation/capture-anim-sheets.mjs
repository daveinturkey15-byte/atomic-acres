/**
 * Four-view contact sheets of BOTH factions in four states, from the game.
 *
 * LICENCES-ANIMATION obligation 6 wants four camera views per clip; this lane's
 * round 2 has two factions and four states, which is thirty-two frames. Thirty-
 * two loose PNGs is a set nobody opens, and a set nobody opens is how a lane
 * reports "captures taken" about pictures it never looked at. So the four views
 * are composed into ONE 2x2 sheet per faction-and-state - eight sheets, each of
 * which can actually be read - and the composition is done on a canvas IN THE
 * PAGE, so the harness needs no ffmpeg and cannot be blocked by an overwrite
 * prompt (the characters lane lost three hours to exactly that on 2026-09-19).
 *
 * Same two load-bearing properties as playcap.mjs: real Chrome over CDP for a
 * WebGPU adapter, and the game's own frame loop.
 *
 *   node scripts/animation/capture-anim-sheets.mjs [--tag r2]
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
const tag = opt('tag', 'r2');
/** Same floor playcap uses. A lit exterior sits 90-140; the black-screen bug read 1.4. */
const DARK_THRESHOLD = 40;

const D = Number(opt('dist', '3.2'));
const ONLY = opt('only', '');
const ONLY_F = opt('faction', '');
const VIEWS = [
  { name: 'front', dx: 0, dz: D, yaw: 0, pitch: -0.10, y: null },
  { name: 'side', dx: D, dz: 0, yaw: Math.PI / 2, pitch: -0.10, y: null },
  { name: 'threequarter', dx: D * 0.72, dz: D * 0.72, yaw: Math.PI / 4, pitch: -0.10, y: null },
  // `y` is the PLAYER's feet: syncCamera puts the lens at pos.y + 1.68 m, so a
  // LOW camera needs a negative y. -1.30 puts the lens at 38 cm.
  { name: 'low', dx: D * 0.42, dz: D * 0.52, yaw: Math.PI / 4 + 0.10, pitch: 0.22, y: -1.30 },
];
const ALL_STATES = [
  { name: 'idle', speed: 0, aim: 0 },
  { name: 'walk', speed: 1.1, aim: 0 },
  { name: 'run', speed: 3.2, aim: 0 },
  { name: 'aim', speed: 0, aim: 1 },
];
const STATES = ONLY ? ALL_STATES.filter((s) => ONLY.split(',').includes(s.name)) : ALL_STATES;

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
if (!exe) { console.error('[sheet] no real Chrome; this harness needs a WebGPU adapter'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-sheet-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('[sheet] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const errors = [];
const missing = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));
page.on('response', (r) => { if (r.status() === 404) missing.push(r.url()); });

const sheets = [];
mkdirSync(OUT, { recursive: true });
try {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__NTANIM && window.__NTANIM.ready === true, null, { timeout: 30000 });
  await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

  // ---- LIVE frames first, before anything is soloed, pinned or moved: the game
  // exactly as it runs. `--livepos` adds stations; spawnA is always taken,
  // because that is the station every other gate in this repo reports.
  const LIVE = [{ name: 'spawnA', x: -4.0, z: -34.3, yaw: Math.PI, pitch: -0.02 }];
  for (const extra of opt('livepos', '').split(';').filter(Boolean)) {
    const [x, z, yaw, name] = extra.split(',');
    LIVE.push({ name: name || `at${x}_${z}`, x: +x, z: +z, yaw: +yaw, pitch: -0.02 });
  }
  for (const st of LIVE) {
    await page.evaluate(([s]) => {
      window.__NT.setMode('walk');
      window.__NT.teleport(s.x, 0, s.z, s.yaw, s.pitch);
      if (window.__NT.release) window.__NT.release();
    }, [st]);
    await page.waitForTimeout(1400);
    writeFileSync(join(OUT, `${tag}-live-${st.name}.png`), await page.screenshot({ type: 'png' }));
    const liveStats = await page.evaluate(() => window.__NT.stats());
    console.log(`[sheet] live ${st.name}  calls ${liveStats.calls}  fps ${liveStats.fps}  -> ${tag}-live-${st.name}.png`);
  }

  // ---- a live frame that actually CONTAINS a figure.
  //
  // spawnA looks away from every figure the match placed, so a spawnA frame
  // proves the game runs and says nothing about the characters. This waits for
  // the match to move its bots, asks the game where they are, and puts the
  // camera four metres from the nearest one with nothing soloed or pinned.
  if (argv.includes('--liveauto')) {
    await page.waitForTimeout(Number(opt('livewait', '20')) * 1000);
    const shot = await page.evaluate(() => {
      const list = window.__NTANIM.list();
      if (!list.length) return null;
      // Prefer a figure out in the open street: the circle is at (-6, 0).
      let best = null;
      for (const f of list) {
        const d = Math.hypot(f.x + 6, f.z);
        if (!best || d < best.d) best = { ...f, d };
      }
      const yaw = Math.atan2(best.x - (best.x - Math.sin(best.yaw + Math.PI) * 4),
        best.z - (best.z - Math.cos(best.yaw + Math.PI) * 4));
      const cx = best.x + Math.sin(best.yaw) * 4.2;
      const cz = best.z + Math.cos(best.yaw) * 4.2;
      window.__NTANIM.showAll();
      window.__NT.setMode('walk');
      window.__NT.teleport(cx, 0, cz, best.yaw + Math.PI, -0.05);
      if (window.__NT.release) window.__NT.release();
      return { subject: best, cam: { x: +cx.toFixed(2), z: +cz.toFixed(2) }, yaw };
    });
    if (shot) {
      await page.waitForTimeout(1400);
      writeFileSync(join(OUT, `${tag}-live-figure.png`), await page.screenshot({ type: 'png' }));
      console.log('[sheet] live figure frame, subject ' + JSON.stringify(shot.subject)
        + `  -> ${tag}-live-figure.png`);
    }
  }

  // ---- two pinned figures, one per faction, on a clear stage.
  const stage = await page.evaluate(([d]) => {
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
        for (let a = 0; a < 8; a++) n += busy(x + Math.cos(a) * 1.3, z + Math.sin(a) * 1.3) * 2;
        for (const [dx, dz] of cams) { n += busy(x + dx, z + dz) * 3; n += busy(x + dx * 0.5, z + dz * 0.5) * 4; }
        if (!best || n < best.n) best = { x, z, n };
      }
    }
    return best;
  }, [D]);
  console.log(`[sheet] stage (${stage.x}, ${stage.z})  clutter ${stage.n}`);

  const wantFactions = ONLY_F === '' ? [0, 1] : ONLY_F.split(',').map(Number);
  const subjects = await page.evaluate(([s, fs]) => {
    const out = [];
    for (const f of fs) {
      const n = window.__NTANIM.spawn(s.x, s.z, 0, f);
      out.push({ faction: f, index: n - 1 });
    }
    return out;
  }, [stage, wantFactions]);
  console.log('[sheet] subjects ' + JSON.stringify(subjects));

  for (const sub of subjects) {
    for (const st of STATES) {
      const armed = await page.evaluate(async ([i, s, state]) => {
        window.__NTANIM.solo(i);
        window.__NTANIM.pin(i, s.x, s.z, 0);
        window.__NTANIM.drive(i, state.speed);
        window.__NTANIM.aim(i, state.aim, 0);
        await new Promise((r) => setTimeout(r, 1400));
        return window.__NTANIM.surface(i);
      }, [sub.index, stage, st]);

      const frames = [];
      for (const v of VIEWS) {
        await page.evaluate(([s, view]) => {
          if (view.y !== null) window.__NT.setMode('fly'); else window.__NT.setMode('walk');
          window.__NT.teleport(s.x + view.dx, view.y ?? 0, s.z + view.dz, view.yaw, view.pitch);
          if (window.__NT.release) window.__NT.release();
          // AFTER release(): release() turns the viewmodel back on, so hiding it
          // first just gets it switched straight back on.
          try { window.__NT.weaponCmd('visible', false); } catch { /* weapons lane may change */ }
        }, [stage, v]);
        await page.waitForTimeout(650);
        frames.push((await page.screenshot({ type: 'png' })).toString('base64'));
      }

      // Compose the 2x2 sheet in the page - no ffmpeg, no overwrite prompt.
      const sheet = await page.evaluate(async ([b64s, labels, title]) => {
        const imgs = await Promise.all(b64s.map(async (b) => {
          const im = new Image(); im.src = 'data:image/png;base64,' + b; await im.decode(); return im;
        }));
        const W = 800, H = 450;
        const c = document.createElement('canvas');
        c.width = W * 2; c.height = H * 2 + 28;
        const g = c.getContext('2d');
        g.fillStyle = '#101010'; g.fillRect(0, 0, c.width, c.height);
        let luma = 0;
        imgs.forEach((im, k) => {
          const x = (k % 2) * W, y = Math.floor(k / 2) * H + 28;
          g.drawImage(im, x, y, W, H);
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x, y, 150, 20);
          g.fillStyle = '#fff'; g.font = '13px monospace';
          g.fillText(labels[k], x + 6, y + 15);
        });
        g.fillStyle = '#fff'; g.font = '16px monospace'; g.fillText(title, 8, 19);
        const d = g.getImageData(0, 28, c.width, c.height - 28).data;
        for (let i = 0; i < d.length; i += 4) luma += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        luma /= d.length / 4;
        return { png: c.toDataURL('image/png').split(',')[1], luma: +luma.toFixed(1) };
      }, [frames, VIEWS.map((v) => v.name), `${tag}  faction ${sub.faction}  ${st.name}  top ${armed.surfaceTop} m  lean ${armed.leanDeg} deg  hand->stock ${armed.handToStockCm} cm`]);

      const file = join(OUT, `${tag}-f${sub.faction}-${st.name}.png`);
      writeFileSync(file, Buffer.from(sheet.png, 'base64'));
      const ok = sheet.luma >= DARK_THRESHOLD;
      sheets.push({ faction: sub.faction, state: st.name, luma: sheet.luma, ok, file, surface: armed });
      console.log(`  ${ok ? 'OK  ' : 'DARK'}  f${sub.faction} ${st.name.padEnd(6)} luma ${String(sheet.luma).padStart(6)}`
        + `  top ${armed.surfaceTop}  lean ${armed.leanDeg}  hand ${armed.handToStockCm} cm  -> ${file}`);
    }
  }
  await page.evaluate(() => { window.__NTANIM.unpin(); window.__NTANIM.showAll(); });
} finally {
  await browser.close().catch(() => {});
  killTree(chrome.pid);
}

writeFileSync(join(OUT, `${tag}-sheets.json`), JSON.stringify({ url, sheets, errors, missing }, null, 2));
if (missing.length) console.log('[sheet] 404s: ' + [...new Set(missing)].join(', '));
if (errors.length) console.log('[sheet] console errors:\n  ' + errors.slice(0, 6).join('\n  '));
const dark = sheets.filter((s) => !s.ok);
console.log(`[sheet] ${sheets.length - dark.length}/${sheets.length} sheets lit through the real game loop`);
process.exit(dark.length ? 1 : 0);
