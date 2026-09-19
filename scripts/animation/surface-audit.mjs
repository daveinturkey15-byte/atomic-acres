/**
 * THE ACCEPTANCE. Measure the figures from the SKINNED SURFACE, in the game,
 * through the game's own frame loop.
 *
 * WHY THE BONES ARE NOT ENOUGH. Round 1 of this lane shipped sixteen clips with
 * a green offline report - foot slide measured, loop seams measured, transfer
 * fidelity 0.22 deg - and the figures stood in the game 20 cm short with the
 * rifle in one hand. Every offline number was true and none of them was about
 * what a player sees. The surface is: `applyBoneTransform` on every vertex is
 * the same arithmetic the skinning shader runs, and the helmet is 18 cm of the
 * answer that no bone carries.
 *
 * It keeps playcap.mjs's two load-bearing properties, for the same reasons:
 *   - REAL CHROME over CDP; playwright's chromium has no WebGPU adapter.
 *   - the GAME'S frame loop; it clicks to play and never calls __NT.render().
 *
 *   node scripts/animation/surface-audit.mjs                 # the four states
 *   node scripts/animation/surface-audit.mjs --external      # ITEM 3 proof
 *   node scripts/animation/surface-audit.mjs --factions      # ITEM 4 proof
 *   node scripts/animation/surface-audit.mjs --budget        # eleven figures
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
const has = (n) => argv.includes('--' + n);
const opt = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const tag = opt('tag', 'surface');
const pad = (s, n) => String(s).padEnd(n);
const rp = (s, n) => String(s).padStart(n);

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
if (!exe) { console.error('[surf] no real Chrome; this harness needs a WebGPU adapter'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-surf-' + cdpPort),
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
if (!browser) { console.error('[surf] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));

const result = { url, states: [], clips: null, skate: null, external: null, factions: null, budget: null, report: null, errors };
try {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__NTANIM && window.__NTANIM.ready === true, null, { timeout: 30000 });

  result.report = await page.evaluate(() => window.__NTANIM.report());
  console.log('[surf] clip sources');
  for (const [k, v] of Object.entries(result.report)) console.log('       ' + k.padEnd(16) + v);

  // The game ticks characters.update() itself (main.ts, since Wave 3 landed), so
  // selfTick MUST stay off: turning it on double-steps every rig and every
  // number below would be taken at twice the clip rate.
  const ticking = await page.evaluate(() => {
    const before = window.__NTANIM.list()[0];
    return { count: window.__NTANIM.count(), first: before };
  });
  console.log(`[surf] ${ticking.count} figures live, game-driven (selfTick left OFF)`);

  // ---- ITEM 1 + ITEM 2: the four states, measured off the surface.
  //
  // Figure 0 is driven directly. Speeds are chosen to land inside each band of
  // pickLocomotion(), not at its edge: idle < 0.25, walk < 2.3, run < 4.1.
  const STATES = [
    { name: 'idle', speed: 0, aim: 0 },
    { name: 'walk', speed: 1.1, aim: 0 },
    { name: 'run', speed: 3.2, aim: 0 },
    { name: 'aim-rifle-idle', speed: 0, aim: 1 },
  ];
  for (const st of STATES) {
    for (const carry of [1, 0]) {
      const m = await page.evaluate(async ([s, c]) => {
        window.__NTANIM.solo(0);
        window.__NTANIM.pin(0, -6, 0, 0);
        window.__NTANIM.drive(0, s.speed);
        window.__NTANIM.aim(0, s.aim, 0);
        window.__NTANIM.carry(0, c);
        // Let the crossfade finish AND the carry ramp settle (4 /s), then take
        // the worst of several frames rather than one lucky one.
        await new Promise((r) => setTimeout(r, 1400));
        const rows = [];
        for (let k = 0; k < 8; k++) {
          rows.push(window.__NTANIM.surface(0));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
        const num = (key, fn) => fn(rows.map((r) => r[key]));
        return {
          loco: rows[0].loco,
          vertices: rows[0].vertices,
          carry: rows[rows.length - 1].carry,
          surfaceTopMin: +num('surfaceTop', (a) => Math.min(...a)).toFixed(4),
          surfaceTopMax: +num('surfaceTop', (a) => Math.max(...a)).toFixed(4),
          leanMax: +num('leanDeg', (a) => Math.max(...a)).toFixed(2),
          abdLeftMax: +num('abdLeftDeg', (a) => Math.max(...a)).toFixed(2),
          abdRightMax: +num('abdRightDeg', (a) => Math.max(...a)).toFixed(2),
          handToStockMax: +num('handToStockCm', (a) => Math.max(...a)).toFixed(1),
          handToStockSurfMax: +num('handToStockSurfCm', (a) => Math.max(...a)).toFixed(1),
          stockBoneVsSurf: +num('stockBoneVsSurfCm', (a) => Math.max(...a)).toFixed(1),
          barrelVsChestMax: +num('barrelVsChestDeg', (a) => Math.max(...a)).toFixed(1),
          barrelVsAimMax: +num('barrelVsAimDeg', (a) => Math.max(...a)).toFixed(1),
          barrelPitch: +num('barrelPitchDeg', (a) => Math.max(...a)).toFixed(1),
        };
      }, [st, carry]);
      result.states.push({ state: st.name, carryRequested: carry, ...m });
    }
  }
  await page.evaluate(() => { window.__NTANIM.carry(0, null); window.__NTANIM.unpin(); });

  console.log('');
  console.log(pad('state', 16) + rp('carry', 6) + rp('loco', 13) + rp('top m', 8) + rp('lean', 7)
    + rp('abdL', 7) + rp('abdR', 7) + rp('hand cm', 9) + rp('vsChest', 9) + rp('vsAim', 7) + rp('pitch', 7));
  console.log('-'.repeat(96));
  for (const r of result.states) {
    console.log(pad(r.state, 16) + rp(r.carryRequested, 6) + rp(r.loco, 13)
      + rp(r.surfaceTopMin.toFixed(3), 8) + rp(r.leanMax.toFixed(1), 7)
      + rp(r.abdLeftMax.toFixed(1), 7) + rp(r.abdRightMax.toFixed(1), 7)
      + rp(r.handToStockMax.toFixed(1), 9) + rp(r.barrelVsChestMax.toFixed(1), 9)
      + rp(r.barrelVsAimMax.toFixed(1), 7) + rp(r.barrelPitch.toFixed(1), 7));
  }

  // ---- the CLIPS themselves, standalone, in the game.
  //
  // The state table above measures what a player sees, which for `aim` is the
  // aim clip's upper body composed onto whatever locomotion is underneath. That
  // is the right thing to ship and the wrong thing to judge a SEED by, so each
  // re-rolled clip is also played whole through playExternal with the carry
  // layer off - the clip, and nothing but the clip.
  if (has('clips') || has('all')) {
    result.clips = [];
    for (const name of (opt('clips-list', 'walk,run,aim,sprint')).split(',')) {
      const m = await page.evaluate(async ([n]) => {
        window.__NTANIM.solo(0);
        window.__NTANIM.pin(0, -6, 0, 0);
        window.__NTANIM.drive(0, 0);
        window.__NTANIM.aim(0, 0, 0);
        window.__NTANIM.carry(0, 0);
        const ok = await window.__NTANIM.external(0, n);
        if (!ok) return { name: n, error: 'not in the bakery registry' };
        await new Promise((r) => setTimeout(r, 600));
        const rows = [];
        for (let k = 0; k < 14; k++) {
          rows.push(window.__NTANIM.surface(0));
          await new Promise((r) => setTimeout(r, 90));
        }
        window.__NTANIM.clearExternal(0);
        window.__NTANIM.carry(0, null);
        const col = (key) => rows.map((r) => r[key]);
        const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
        return {
          name: n,
          topMed: +med(col('surfaceTop')).toFixed(4),
          topMin: +Math.min(...col('surfaceTop')).toFixed(4),
          leanMed: +med(col('leanDeg')).toFixed(2),
          leanMax: +Math.max(...col('leanDeg')).toFixed(2),
          abdLMax: +Math.max(...col('abdLeftDeg')).toFixed(2),
          abdRMax: +Math.max(...col('abdRightDeg')).toFixed(2),
          distinctTops: new Set(col('surfaceTop').map((v) => v.toFixed(4))).size,
        };
      }, [name]);
      result.clips.push(m);
    }
    console.log('');
    console.log(pad('clip (standalone)', 20) + rp('topMed', 8) + rp('topMin', 8) + rp('leanMed', 9)
      + rp('leanMax', 9) + rp('abdL', 7) + rp('abdR', 7) + rp('moving', 8));
    console.log('-'.repeat(76));
    for (const r of result.clips) {
      if (r.error) { console.log(pad(r.name, 20) + '  ' + r.error); continue; }
      console.log(pad(r.name, 20) + rp(r.topMed.toFixed(3), 8) + rp(r.topMin.toFixed(3), 8)
        + rp(r.leanMed.toFixed(1), 9) + rp(r.leanMax.toFixed(1), 9)
        + rp(r.abdLMax.toFixed(1), 7) + rp(r.abdRMax.toFixed(1), 7) + rp(`${r.distinctTops}/14`, 8));
    }
  }

  // ---- ITEM 3: playExternal must ADVANCE, and a one-shot must SETTLE.
  if (has('external') || has('all')) {
    result.external = await page.evaluate(async () => {
      const out = {};
      const sample = async (ms, n) => {
        const s = [];
        const step = ms / n;
        for (let k = 0; k < n; k++) {
          s.push(window.__NTANIM.surface(0).surfaceTop);
          await new Promise((r) => setTimeout(r, step));
        }
        return s;
      };
      window.__NTANIM.solo(0);
      window.__NTANIM.pin(0, -6, 0, 0);
      window.__NTANIM.drive(0, 0);
      window.__NTANIM.aim(0, 0, 0);
      // Carry OFF: the layer would hold both arms still and mask a frozen clip.
      window.__NTANIM.carry(0, 0);

      await window.__NTANIM.external(0, 'walk');
      await new Promise((r) => setTimeout(r, 400));
      const walk = await sample(1000, 20);
      out.walk = { samples: walk, spreadCm: +((Math.max(...walk) - Math.min(...walk)) * 100).toFixed(2),
        distinct: new Set(walk.map((v) => v.toFixed(4))).size };

      window.__NTANIM.clearExternal(0);
      await new Promise((r) => setTimeout(r, 300));
      await window.__NTANIM.external(0, 'death');
      const death = await sample(2500, 25);
      out.death = { samples: death, finalTop: death[death.length - 1],
        spreadCm: +((Math.max(...death) - Math.min(...death)) * 100).toFixed(2),
        distinct: new Set(death.map((v) => v.toFixed(4))).size };
      window.__NTANIM.clearExternal(0);
      window.__NTANIM.carry(0, null);
      return out;
    });
    const e = result.external;
    console.log('');
    console.log(`[surf] external('walk')  surface top moved ${e.walk.spreadCm} cm over 1.0 s across `
      + `${e.walk.distinct}/20 distinct samples   -> ${e.walk.spreadCm > 2 ? 'ADVANCING' : 'FROZEN'}`);
    console.log(`[surf] external('death') settled to ${e.death.finalTop.toFixed(3)} m within 2.5 s `
      + `(${e.death.distinct}/25 distinct)   -> ${e.death.finalTop < 0.6 ? 'LYING' : 'STILL UPRIGHT'}`);
  }

  // ---- ITEM 4: faction per spawn.
  if (has('factions') || has('all')) {
    result.factions = await page.evaluate(async () => {
      const before = window.__NTANIM.count();
      window.__NTANIM.spawn(-9, -3, 0, 0);
      window.__NTANIM.spawn(-9, -1, 0, 1);
      window.__NTANIM.spawn(-9, 1, 0, 0);
      const list = window.__NTANIM.list().slice(before);
      const mesh = window.__NTMESH ? window.__NTMESH.stats() : null;
      return { before, spawned: list.map((r) => ({ i: r.i, faction: r.faction })), mesh };
    });
    console.log('');
    console.log('[surf] faction per spawn: ' + JSON.stringify(result.factions.spawned));
    console.log('[surf] baked geometries after pinned spawns: '
      + (result.factions.mesh ? result.factions.mesh.geometries : '?')
      + '  (2 = both dresses shared, no new geometry per pinned figure)');
    console.log('[surf] dresses: ' + JSON.stringify(result.factions.mesh && result.factions.mesh.dresses));
  }

  // ---- ITEM 2's "locomotion below the chest is untouched" claim, measured.
  //
  // The carry layer writes six bone quaternions, all at or above the shoulder.
  // That is an argument; foot slide is the evidence. Same figure, same clip,
  // same distance, layer on and layer off - the two numbers must agree.
  if (has('skate') || has('all')) {
    // ALTERNATING REPEATS, not one run each. `measureSkate` reports the WORST
    // stride, a max over a dozen strides, and a max is a noisy statistic: one
    // run of each would let ordinary run-to-run spread read as "the layer moved
    // the gait". Three of each, interleaved, so drift over the session cannot
    // load onto one arm of the comparison.
    result.skate = [];
    for (const carry of [1, 0, 1, 0, 1, 0]) {
      const m = await page.evaluate(async ([c, sp]) => {
        window.__NTANIM.unpin();
        window.__NTANIM.solo(0);
        window.__NT.setMode('walk');
        // Watch from under 25 m: beyond that the LOD thins the rig to every
        // third frame and a skate accumulator measures a stutter, not a gait.
        window.__NT.teleport(-6 + 6, 0, -10, Math.PI / 4, 0);
        window.__NTANIM.place(0, -6, -14, 0);
        window.__NTANIM.carry(0, c);
        window.__NTANIM.drive(0, sp);
        window.__NTANIM.aim(0, 0, 0);
        await new Promise((r) => setTimeout(r, 1200));
        window.__NTANIM.skateStart(0);
        await new Promise((r) => setTimeout(r, 9000));
        const r = window.__NTANIM.skate(0);
        window.__NTANIM.skateStop();
        window.__NTANIM.carry(0, null);
        return { carry: c, speed: sp, worstCm: r.worstCm, strides: r.strides, hipsY: r.hipsY };
      }, [carry, Number(opt('skate-speed', '1.1'))]);
      result.skate.push(m);
    }
    console.log('');
    for (const r of result.skate) {
      console.log(`[surf] walk foot-slide, carry ${r.carry}: worst ${r.worstCm} cm over ${r.strides} strides  hipsY ${r.hipsY}`);
    }
    const arm = (c) => result.skate.filter((r) => r.carry === c).map((r) => r.worstCm);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const on = arm(1), off = arm(0);
    const spread = Math.max(...on, ...off) - Math.min(...on, ...off);
    const diff = Math.abs(mean(on) - mean(off));
    result.skateSummary = { on, off, meanOn: +mean(on).toFixed(2), meanOff: +mean(off).toFixed(2),
      diff: +diff.toFixed(2), withinArmSpread: +spread.toFixed(2) };
    console.log(`[surf] carry ON  ${on.map((v) => v.toFixed(2)).join(' ')}  mean ${mean(on).toFixed(2)} cm`);
    console.log(`[surf] carry OFF ${off.map((v) => v.toFixed(2)).join(' ')}  mean ${mean(off).toFixed(2)} cm`);
    console.log(`[surf] mean difference ${diff.toFixed(2)} cm against a within-run spread of ${spread.toFixed(2)} cm`
      + `  -> ${diff <= 0.5 ? 'the layer did not touch the legs' : diff < spread ? 'difference is inside the noise; not resolvable' : 'THE LAYER MOVED THE GAIT'}`);
  }

  // ---- budget: eleven figures, frame time / draw calls / heap slope.
  if (has('budget') || has('all')) {
    result.budget = await page.evaluate(async () => {
      window.__NTANIM.showAll();
      while (window.__NTANIM.count() < 11) {
        const n = window.__NTANIM.count();
        window.__NTANIM.spawn(-12 + n * 2, 8, 0, n % 2);
      }
      const read = () => {
        const s = window.__NT.stats();
        const mem = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0;
        return { calls: s.calls, tris: s.triangles, fps: s.fps, heapMB: +mem.toFixed(1), t: performance.now() / 1000 };
      };
      const out = [];
      out.push(read());
      for (const wait of [30, 60, 60]) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        out.push(read());
      }
      return { figures: window.__NTANIM.count(), samples: out };
    });
    // A live frame with the crowd actually in shot: spawnA looks away from every
    // figure the match placed, so a spawnA frame proves the game runs and says
    // nothing about the characters.
    await page.evaluate(() => {
      window.__NT.setMode('walk');
      window.__NT.teleport(-6, 0, -6, 0.6, -0.02);
      if (window.__NT.release) window.__NT.release();
    });
    await page.waitForTimeout(1200);
    writeFileSync(join(OUT, `${tag}-live-crowd.png`), await page.screenshot({ type: 'png' }));
    console.log(`[surf] live crowd frame -> ${tag}-live-crowd.png`);
    const s = result.budget.samples;
    const dt = (s[s.length - 1].t - s[0].t) / 60;
    console.log('');
    console.log(`[surf] budget with ${result.budget.figures} figures`);
    for (const r of s) console.log(`       t+${(r.t - s[0].t).toFixed(0).padStart(3)}s  calls ${String(r.calls).padStart(5)}  fps ${String(r.fps).padStart(4)}  heap ${r.heapMB} MB`);
    console.log(`       heap slope ${((s[s.length - 1].heapMB - s[0].heapMB) / dt).toFixed(2)} MB/min`);
  }
} finally {
  await browser.close().catch(() => {});
  killTree(chrome.pid);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${tag}-audit.json`), JSON.stringify(result, null, 2));
if (errors.length) console.log('[surf] console errors:\n  ' + errors.slice(0, 8).join('\n  '));
console.log(`[surf] wrote ${join(OUT, `${tag}-audit.json`)}`);
