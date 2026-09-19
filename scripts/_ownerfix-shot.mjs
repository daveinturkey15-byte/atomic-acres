/**
 * _ownerfix-shot - owner-fixes lane: photograph the REAL game loop at named player
 * positions (same launch block and same rules as scripts/playcap.mjs: real Chrome over
 * CDP, __NT.teleport + release, never goto()/probeReset(), one browser at a time).
 *
 * Walk mode: the controller drops the player onto whatever floor is under the point, so
 * an upper-floor shot at y 3.3 stands at eye height on the slab exactly as a player
 * would. The viewmodel is hidden through __NT.weaponCmd('visible', false) so the room
 * is measured, not the gun.
 *
 *   node scripts/_ownerfix-shot.mjs --set garage --tag before
 *   node scripts/_ownerfix-shot.mjs --set upstairs --tag before
 *   node scripts/_ownerfix-shot.mjs --set car --tag after
 *   node scripts/_ownerfix-shot.mjs --at name,x,y,z,yawDeg,pitchDeg [--at ...]
 *
 * Writes captures/ownerfix-<tag>-<name>.png and prints mean luma + draw calls per shot.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
const argv = process.argv.slice(2);
const opt = (name, dflt = '') => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const tag = opt('tag', 'shot');
const setName = opt('set', '');
const D = Math.PI / 180;

// layout.ts values, restated here because this is a probe and must not import src/
const WHITE_GARAGE_X = 6.4 + 6.2 / 2;   // 9.5
const WHITE_FRONT_Z = 15.4;
const EYE = 1.68;

const SETS = {
  garage: [
    // from the street at eye height, looking at the two bays (+z)
    { name: 'garage-street', x: WHITE_GARAGE_X, y: 0, z: WHITE_FRONT_Z - 8, yaw: 180 * D, pitch: 2 * D },
    // a step closer, on the drive, so the bays fill the frame
    { name: 'garage-drive', x: WHITE_GARAGE_X - 0.6, y: 0, z: WHITE_FRONT_Z - 4.5, yaw: 180 * D, pitch: 3 * D },
    // inside the garage looking out through the open bay
    { name: 'garage-inside-out', x: 8.3, y: 0, z: 21.6, yaw: 0, pitch: 0 },
    // inside, in front of the vending run, looking across the pool at the shut bay
    { name: 'garage-inside-shut', x: 8.3, y: 0, z: 21.0, yaw: -27 * D, pitch: -3 * D },
  ],
  upstairs: [
    // arriving at the top of the internal stair, facing the way the flight climbs (+z)
    { name: 'up-stairhead', x: 1.92, y: 3.3, z: 24.0, yaw: 180 * D, pitch: -4 * D },
    // the same spot, turned left toward the hall, the green room's door and the deck door
    { name: 'up-stairhead-left', x: 1.92, y: 3.3, z: 24.0, yaw: 125 * D, pitch: -4 * D },
    // the landing / rear hall, east end, looking west down the hall to the deck door
    { name: 'up-landing', x: 3.0, y: 3.3, z: 25.5, yaw: 100 * D, pitch: -3 * D },
    // at the bedroom's hall door, looking into the bedroom
    { name: 'up-bedroom-door', x: -3.6, y: 3.3, z: 25.3, yaw: 0, pitch: -4 * D },
    // inside, at the deck door, looking out onto the deck
    { name: 'up-deck-door', x: -3.4, y: 3.3, z: 25.6, yaw: 180 * D, pitch: -2 * D },
    // in the bedroom's window corner looking back at the bed, unit and door
    { name: 'up-bedroom-in', x: -5.2, y: 3.3, z: 22.6, yaw: 225 * D, pitch: -4 * D },
    // in the green room by its hall door, looking at the window wall and the opening to the bedroom
    { name: 'up-green-room', x: 0.3, y: 3.3, z: 24.2, yaw: 30 * D, pitch: -3 * D },
    // from the green room through the corner opening into the bedroom (g-1icNQzMgLUM-256's reverse)
    { name: 'up-opening', x: -0.6, y: 3.3, z: 22.9, yaw: 90 * D, pitch: -3 * D },
  ],
  car: [
    // orange-side pavement at eye height looking at the head: coach, saloon, bus
    { name: 'car-pavement', x: -6.5, y: 0, z: -7.2, yaw: 172 * D, pitch: 0 },
    // orange pavement east of the head, looking back west across coach and saloon
    { name: 'car-pavement-2', x: 4.0, y: 0, z: -6.9, yaw: 125 * D, pitch: 0 },
    // on the carriageway south of the saloon: saloon tail, coach nose, the gap between
    { name: 'car-road', x: -8.0, y: 0, z: -6.0, yaw: 195 * D, pitch: 0 },
  ],
};

let shots = setName ? SETS[setName] : [];
if (!shots) { console.error('[ownerfix-shot] unknown set ' + setName + '; have ' + Object.keys(SETS).join(', ')); process.exit(2); }
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--at') continue;
  const [name, x, y, z, yaw, pitch] = argv[i + 1].split(',');
  shots.push({ name, x: +x, y: +y, z: +z, yaw: (+yaw) * D, pitch: (+(pitch || 0)) * D });
}
if (!shots.length) { console.error('[ownerfix-shot] nothing to shoot'); process.exit(2); }

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
const distStamp = () => { try { return statSync(join(ROOT, 'dist', 'assets')).mtimeMs; } catch { return 0; } };
const stampAtStart = distStamp();

const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[ownerfix-shot] no Chrome found'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-ownerfix-shot-' + cdpPort),
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
if (!browser) { console.error('[ownerfix-shot] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));

  console.log('[ownerfix-shot] ' + url);
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
  await page.evaluate(() => { try { window.__NT.weaponCmd('visible', false); } catch {} });

  mkdirSync(OUT, { recursive: true });
  const results = [];
  // The match is LIVE while we photograph (start was clicked, bots spawn and shoot), so a
  // stationary camera can be killed and respawned across the map mid-set - the third
  // upstairs shot of two runs came back from the orange house. Place, settle, and
  // verify the player is still within a metre of the target before AND after the
  // frame; re-place and re-shoot when not.
  const place = async (s) => {
    await page.evaluate(([x, y, z, yaw, pitch]) => {
      window.__NT.setMode('walk');
      window.__NT.teleport(x, y, z, yaw, pitch);
      if (window.__NT.release) window.__NT.release();
      try { window.__NT.weaponCmd('visible', false); } catch {}
    }, [s.x, s.y, s.z, s.yaw, s.pitch]);
  };
  const near = async (s) => {
    const p = await page.evaluate(() => window.__NT.probePos());
    return Math.hypot(p[0] - s.x, p[2] - s.z) < 1.0;
  };
  for (const s of shots) {
    let shot = null, tries = 0;
    for (; tries < 4 && !shot; tries++) {
      await place(s);
      await page.waitForTimeout(tries ? 700 : 1000);
      if (!(await near(s))) continue;
      const png = await page.screenshot({ type: 'png' });
      if (await near(s)) shot = png;
    }
    if (!shot) { console.log(`  ${s.name.padEnd(20)} FAILED: the player kept being moved away from the target`); continue; }
    if (tries > 1) console.log(`  ${s.name.padEnd(20)} (re-placed ${tries - 1}x: the player had been respawned)`);
    const file = join(OUT, `ownerfix-${tag}-${s.name}.png`);
    writeFileSync(file, shot);
    const info = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 200; c.height = 112;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 200, 112);
      const d = g.getImageData(0, 0, 200, 112).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const st = window.__NT.stats();
      const p = window.__NT.probePos();
      return { luma: sum / (d.length / 4), calls: st.calls, pos: p.map((v) => +v.toFixed(2)), mode: st.mode };
    }, shot.toString('base64'));
    results.push({ name: s.name, file, ...info });
    console.log(`  ${s.name.padEnd(20)} luma ${info.luma.toFixed(1).padStart(6)}  calls ${String(info.calls).padStart(5)}  stood at ${info.pos.join(',')}  -> ${file}`);
  }
  if (errors.length) console.log('[ownerfix-shot] console errors:\n  ' + errors.slice(0, 6).join('\n  '));
  const stampAtEnd = distStamp();
  if (stampAtEnd !== stampAtStart) console.log('[ownerfix-shot] WARNING: dist/assets changed during the run (sibling rebuild) - rerun once');
  writeFileSync(join(OUT, `ownerfix-${tag}-summary.json`), JSON.stringify({ url, results, errors, distChanged: stampAtEnd !== stampAtStart }, null, 2));
} finally {
  await browser.close().catch(() => {});
  killTree(chrome.pid);
}
