#!/usr/bin/env node
/**
 * Live visual proof for the authored third-person throw body clip.
 *
 * ROOT-RUN ONLY. This file owns a browser (stock Chrome) and a server URL.
 * The animation-lane worker must NOT run it (no browser/GPU/server there).
 *
 * Route (all requirements from the lane brief):
 * - stock-browser.mjs owned Chrome: real WebGPU adapter, no feature flags.
 * - Explicit URL: MOTION_URL (default http://127.0.0.1:4194/, the
 *   dist-animation-review candidate). Refuses :4188 so a default checkout
 *   can never be photographed by mistake. Never spawns a preview server.
 * - Dist identity + WebGPU/post: records the served index-*.js bundle and
 *   requires __NTPOST.backend === 'webgpu' with post enabled.
 * - Same in-world figures: figure 0 via the existing place/drive/carry
 *   controls plus the small __NTANIM.throwBody(phase) overlay path
 *   (rig.playThrowBody on the live rig). The game's own rAF loop draws
 *   every frame: teleport + release only, never __NT.goto/__NT.render.
 * - VISUAL CLIP PLAYBACK ONLY. Frames are labelled as such: they prove what
 *   the authored clip looks like in the world, never that a grenade event
 *   was admitted. Event admission is CPU-proved in
 *   verify-throw-presentation.mjs; live network admission stays OPEN.
 * - Views: front / side / three-quarter / low (D=3.6 m) across windup
 *   (anticipation hold), release (authoritative entry at 0.45 s) and
 *   recovery (follow-through), plus crouch / prone / moving (treadmill)
 *   stances. Camera stands are scored clear with the existing
 *   __NT.collidersAt helper; the low lens sits at 0.38 m (y=-1.30), never
 *   an invalid floor camera. HUD is hidden for frames only (owned style
 *   tag, removed on cleanup).
 * - Bounded: MAX_FRAMES 24, per-shot timeouts, dark-frame / budget /
 *   error checks, owned cleanup (showAll, unpin, style removal, close).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from '../lib/stock-browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'captures', 'motion-live');
const URL = process.env.MOTION_URL || process.env.NT_URL || 'http://127.0.0.1:4194/';
const TAG = process.env.MOTION_TAG || 'throw-live';
const MAX_FRAMES = 24;
const DARK_THRESHOLD = 40;
const CALL_BUDGET = 1200;
const TRI_BUDGET = 900_000;
const D = 3.6;

if (URL.includes(':4188')) {
  console.error(`[motion-live] refusing ${URL}: :4188 is another checkout's build; set MOTION_URL to the 4194 candidate`);
  process.exit(2);
}

const VIEWS = [
  { name: 'front', dx: 0, dz: D, yaw: 0, pitch: -0.06, y: 0 },
  { name: 'side', dx: D, dz: 0, yaw: Math.PI / 2, pitch: -0.06, y: 0 },
  { name: 'threequarter', dx: D * 0.72, dz: D * 0.72, yaw: Math.PI / 4, pitch: -0.08, y: 0 },
  // y is the PLAYER's feet; syncCamera puts the lens at +1.68 m.
  // -1.30 => lens at 0.38 m. Never below -1.30 (lens under the floor).
  { name: 'low', dx: D * 0.42, dz: D * 0.52, yaw: Math.PI / 4 + 0.1, pitch: 0.2, y: -1.3 },
];
for (const v of VIEWS) {
  if (v.y < -1.3) throw new Error(`motion-live: invalid floor camera ${v.name} y=${v.y}`);
}

const SCENARIOS = [
  { name: 'stand', speed: 0, crouch: false, prone: false, views: ['front', 'side', 'threequarter', 'low'] },
  { name: 'crouch', speed: 0.8, crouch: true, prone: false, views: ['threequarter'] },
  { name: 'prone', speed: 0.5, crouch: false, prone: true, views: ['threequarter'] },
  // Treadmill: pinned on the mark so the 0.9 s overlay stays framed while
  // the blend tree keeps the run gait (speed 3.4) ticking underneath.
  { name: 'moving', speed: 3.4, crouch: false, prone: false, views: ['threequarter'] },
];
const BEATS = ['windup', 'release', 'recovery'];
const expectFrames = SCENARIOS.reduce((n, s) => n + s.views.length * BEATS.length, 0);
if (expectFrames > MAX_FRAMES) throw new Error(`motion-live: plan ${expectFrames} frames exceeds bound ${MAX_FRAMES}`);

mkdirSync(OUT, { recursive: true });
const result = {
  url: URL,
  tag: TAG,
  proof: 'VISUAL clip playback only — __NTANIM.throwBody on in-world figures, NOT a grenade event. Event admission is CPU-proved elsewhere; live network admission stays OPEN.',
  budgets: { calls: CALL_BUDGET, triangles: TRI_BUDGET, maxFrames: MAX_FRAMES, dark: DARK_THRESHOLD },
  frames: [],
  errors: [],
  checks: [],
};
const check = (name, pass, value) => result.checks.push({ name, pass, value });

let owned = null;
try {
  owned = await stockBrowser('motion-live');
  const { page } = owned;
  await page.setViewportSize({ width: 1600, height: 900 });
  page.on('pageerror', (e) => result.errors.push('PAGEERROR ' + String(e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') result.errors.push('CONSOLE ' + m.text().slice(0, 400)); });

  await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => window.__NT?.ready === true, null, { timeout: 90_000 });
  await page.waitForFunction(() => window.__NTANIM?.ready === true, null, { timeout: 30_000 });

  const identity = await page.evaluate(() => ({
    href: location.href,
    bundle: document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src') ?? null,
    hasThrowBody: typeof window.__NTANIM?.throwBody === 'function',
    post: window.__NTPOST ? { enabled: window.__NTPOST.enabled, backend: window.__NTPOST.backend } : null,
  }));
  result.dist = identity;
  check('explicit candidate URL (not the 4188 default)', !URL.includes(':4188'), URL);
  check('dist bundle identity recorded', !!identity.bundle, identity.bundle);
  check('throwBody QA present', identity.hasThrowBody === true, identity.hasThrowBody);
  check('WebGPU post path live', !!identity.post?.enabled && identity.post?.backend === 'webgpu', identity.post);
  if (!identity.hasThrowBody) throw new Error('__NTANIM.throwBody missing: rebuild dist from this lane first');
  if (!identity.post?.enabled || identity.post?.backend !== 'webgpu') {
    throw new Error(`not the WebGPU game path (got ${JSON.stringify(identity.post)}); refusing fallback pixels`);
  }

  // Menu path is part of the evidence; the game loop must be running.
  await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
  await page.waitForTimeout(1500);

  // Hide DOM chrome for frames only; the canvas and rAF loop are untouched.
  await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

  // Pick a CLEAR stage with the existing collider helper, not a guess.
  const stage = await page.evaluate(([bx, bz, d]) => {
    const busy = (x, z) => {
      let n = 0;
      for (const y of [0.4, 1.0, 1.7]) n += window.__NT.collidersAt(x, z, y).length;
      return n;
    };
    const cams = [[0, d], [d, 0], [d * 0.72, d * 0.72], [d * 0.42, d * 0.52]];
    let best = null;
    for (let x = -14; x <= 10; x += 2) {
      for (let z = -12; z <= 12; z += 2) {
        let n = busy(x, z) * 8;
        for (let a = 0; a < 8; a++) n += busy(x + Math.cos(a) * 1.3, z + Math.sin(a) * 1.3) * 2;
        for (const [dx, dz] of cams) {
          n += busy(x + dx, z + dz) * 3;
          n += busy(x + dx * 0.5, z + dz * 0.5) * 4;
        }
        if (!best || n < best.n) best = { x, z, n };
      }
    }
    return { x: best.x, z: best.z, yaw: 0, clutter: best.n };
  }, [-6.0, 0.0, D]);
  result.stage = stage;
  check('stage is clear of colliders', stage.clutter === 0, stage);
  console.log(`[motion-live] ${URL} bundle=${identity.bundle} stage=(${stage.x},${stage.z}) clutter=${stage.clutter}`);

  const lumaOf = (shot) => page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 200; c.height = 112;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 200, 112);
    const d = g.getImageData(0, 0, 200, 112).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }, shot.toString('base64'));

  async function shoot(scenario, view, beat) {
    if (result.frames.length >= MAX_FRAMES) throw new Error(`frame limit ${MAX_FRAMES} exceeded`);
    const file = join(OUT, `${TAG}-${scenario}-${view}-${beat}.png`);
    await page.waitForTimeout(120);
    const shot = await page.screenshot({ type: 'png' });
    const { default: { writeFileSync: w } } = await import('node:fs');
    w(file, shot);
    const luma = await lumaOf(shot);
    const sample = await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => resolve({
        phase: window.__NTANIM.throwPhase(0),
        stats: window.__NT.stats(),
      }));
    }));
    const s = sample.stats;
    const measured = Number.isFinite(s.calls) && Number.isFinite(s.triangles) && s.calls > 2;
    const frame = {
      name: `${scenario}-${view}-${beat}`,
      file,
      proof: 'visual-clip-playback',
      phase: sample.phase,
      luma: +luma.toFixed(1),
      lit: luma >= DARK_THRESHOLD,
      stats: { calls: s.calls, triangles: s.triangles, renderCallsTotal: s.renderCallsTotal },
      budgetOk: measured && s.calls <= CALL_BUDGET && s.triangles <= TRI_BUDGET,
    };
    result.frames.push(frame);
    console.log(`[motion-live] ${frame.lit && frame.budgetOk ? 'PASS' : 'OPEN'} ${frame.name} phase=${frame.phase} luma=${frame.luma} ${s.calls}c/${s.triangles}t`);
    return frame;
  }

  for (const sc of SCENARIOS) {
    for (const viewName of sc.views) {
      const view = VIEWS.find((v) => v.name === viewName);
      // Frame the shot first; the overlay finishes in 0.9 s, so the throw
      // is triggered AFTER the camera settles, then beats are caught in one run.
      await page.evaluate(([st, cfg, v]) => {
        window.__NT.setMode('walk');
        window.__NTANIM.solo(0);
        window.__NTANIM.place(0, st.x, st.z, st.yaw);
        window.__NTANIM.drive(0, cfg.speed, cfg.crouch, cfg.prone);
        window.__NTANIM.carry(0, null);
        window.__NTANIM.pin(0, st.x, st.z, st.yaw);
        window.__NT.teleport(st.x + v.dx, v.y, st.z + v.dz, v.yaw, v.pitch);
        if (window.__NT.release) window.__NT.release();
        try { window.__NT.weaponCmd('visible', false); } catch { /* lane-owned */ }
      }, [stage, sc, view]);
      await page.waitForTimeout(700);

      // Windup: anticipation plays 0→0.18 s and HOLDS the coil.
      await page.evaluate(() => window.__NTANIM.throwBody(0, 'anticipation'));
      await page.waitForTimeout(350);
      const windupPhase = await page.evaluate(() => window.__NTANIM.throwPhase(0));
      check(`${sc.name} windup holds the coil`, windupPhase === 'hold', windupPhase);
      await shoot(sc.name, view.name, 'windup');

      // Release: the authoritative entry AT the 0.45 s beat.
      await page.evaluate(() => window.__NTANIM.throwBody(0, 'release'));
      await page.waitForTimeout(120);
      const releasePhase = await page.evaluate(() => window.__NTANIM.throwPhase(0));
      check(`${sc.name}/${view.name} release entered`, releasePhase === 'release', releasePhase);
      await shoot(sc.name, view.name, 'release');

      // Recovery: follow-through, still under the same overlay.
      await page.waitForTimeout(300);
      await shoot(sc.name, view.name, 'recovery');
    }
  }

  check('frame count is bounded', result.frames.length <= MAX_FRAMES, result.frames.length);
  check('every frame is lit (game loop drew)', result.frames.every((f) => f.lit), result.frames.map((f) => ({ n: f.name, luma: f.luma })));
  check('every frame is within renderer budgets', result.frames.every((f) => f.budgetOk),
    result.frames.map((f) => ({ n: f.name, c: f.stats.calls, t: f.stats.triangles })));
  check('no page or console errors', result.errors.length === 0, result.errors);
} catch (error) {
  result.fatal = String(error?.stack ?? error);
  console.error('[motion-live] FATAL ' + result.fatal);
} finally {
  try {
    if (owned) {
      const { page } = owned;
      await page.evaluate(() => {
        try { window.__NTANIM?.showAll?.(); } catch { /* cleanup */ }
        try { window.__NTANIM?.unpin?.(); } catch { /* cleanup */ }
        try { window.__NT?.release?.(); } catch { /* cleanup */ }
        for (const el of document.querySelectorAll('style')) {
          if (el.textContent?.includes('#hud,#crosshair')) el.remove();
        }
      });
    }
  } catch { /* cleanup must not mask the verdict */ }
  result.finishedAt = new Date().toISOString();
  result.pass = !result.fatal && result.checks.every((c) => c.pass);
  writeFileSync(join(OUT, `${TAG}-summary.json`), JSON.stringify(result, null, 2));
  if (owned) await owned.close();
}

console.log(JSON.stringify({ pass: result.pass, frames: result.frames.length, checks: result.checks, fatal: result.fatal ?? null }, null, 2));
if (!result.pass) process.exitCode = 1;
