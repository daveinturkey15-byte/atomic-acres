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
 *   controls plus the __NTANIM overlay path on the live rig. The game's own
 *   rAF loop draws every frame: teleport + release only, never
 *   __NT.goto/__NT.render.
 * - VISUAL CLIP PLAYBACK ONLY, now with a QA-only frame-loop beat scrub:
 *   __NTANIM.scrubThrow pins rig.upper to an exact authored beat every rAF
 *   (and zeroes heldFor, so the rig's anticipation watchdog cannot drop the
 *   coil mid-run). No game event is fired or claimed - grenade event
 *   admission is CPU-proved in verify-throw-presentation.mjs; live network
 *   admission stays OPEN.
 *
 * REVISION 2 - why 1935 was rejected (root looked at the PNGs):
 * 1. The stage scan trusted __NT.collidersAt only. (-14,-10) scored clutter 0
 *    but the front lens teleported INSIDE the orange house's west annex -
 *    visual geometry with no colliders - and photographed an interior wall
 *    with no actor. Occupancy is not LOS. The stage is now constrained to the
 *    central turning circle (open by construction), and EVERY frame must pass
 *    a rig-measured visibility gate: __NTANIM.visibility (chest bone world
 *    frame) requires visible + in-frustum + expected facing + sane distance,
 *    read AFTER the screenshot so the recorded gate describes the presented
 *    surface.
 * 2. Beats were free-played: screenshot + luma + stats outran the 0.45 s
 *    release, so every release/recovery frame recorded phase 'none' while the
 *    check green-lit from a stale earlier read. Beats are now SCRUB-PINNED:
 *    windup 0.18 hold / release 0.45 / recovery 0.70 re-asserted on the frame
 *    loop, and throwDetail is sampled immediately BEFORE and AFTER the
 *    screenshot. A frame may only be labelled windup/release/recovery when
 *    both samples carry the beat phase within 50 ms of the pinned elapsed -
 *    the phase is proven at the captured render, not after it.
 * 3. Framing: the old 'front' view sat at dz:+D, i.e. BEHIND a yaw-0 actor
 *    (actor yaw 0 faces -z; the 1935 three-quarter PNG shows its back). All
 *    four lenses now sit in the actor's FRONT hemisphere with
 *    camYaw = atan2(dx, dz) so the lens aims at the chest, and D drops
 *    3.6 -> 2.4 so the operator fills the frame. Facing expectations are
 *    strict for the stand scenario (front/side/threequarter/low) and
 *    reject-'back' for crouch/prone/moving, whose pitched chest frames can
 *    legitimately soften the label.
 * - Views: front / side / three-quarter / low across windup, release and
 *   recovery, plus crouch / prone / moving (treadmill) stances. The low lens
 *   sits at 0.38 m (y=-1.30), never an invalid floor camera. HUD is hidden
 *   for frames only (owned style tag, removed on cleanup).
 * - Bounded: MAX_FRAMES 24, per-shot timeouts, dark-frame / budget / error
 *   checks, owned cleanup (scrub unpin, showAll, unpin, style removal, close).
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
const LENS_HEIGHT = 1.68; // EYE_HEIGHT, core/layout.ts - teleport y is the feet
const D = 2.4; // was 3.6: the operator read far too small in the 1935 frames

if (URL.includes(':4188')) {
  console.error(`[motion-live] refusing ${URL}: :4188 is another checkout's build; set MOTION_URL to the 4194 candidate`);
  process.exit(2);
}

// Actor yaw 0 faces -z (MEASURED on motion-root-1935: the south-east
// three-quarter camera photographed the figure's back). camYaw = atan2(dx, dz)
// makes the lens forward (-sin, -cos) point from the offset back at the chest.
const VIEWS = [
  { name: 'front', dx: 0, dz: -D, yaw: Math.PI, pitch: -0.06, y: 0, facing: 'front' },
  { name: 'side', dx: D, dz: 0, yaw: Math.PI / 2, pitch: -0.06, y: 0, facing: 'side' },
  { name: 'threequarter', dx: D * 0.72, dz: -D * 0.72, yaw: Math.PI * 0.75, pitch: -0.08, y: 0, facing: 'front' },
  // y is the PLAYER's feet; syncCamera puts the lens at +1.68 m.
  // -1.30 => lens at 0.38 m. Never below -1.30 (lens under the floor).
  { name: 'low', dx: D * 0.42, dz: -D * 0.52, yaw: Math.atan2(0.42, -0.52), pitch: 0.2, y: -1.3, facing: 'front' },
];
for (const v of VIEWS) {
  if (v.y < -1.3) throw new Error(`motion-live: invalid floor camera ${v.name} y=${v.y}`);
  const derived = Math.atan2(v.dx, v.dz);
  const err = Math.atan2(Math.sin(derived - v.yaw), Math.cos(derived - v.yaw));
  if (Math.abs(err) > 1e-9) throw new Error(`motion-live: ${v.name} yaw does not aim the lens at the actor (atan2(dx,dz)=${derived})`);
}

const SCENARIOS = [
  { name: 'stand', speed: 0, crouch: false, prone: false, views: ['front', 'side', 'threequarter', 'low'] },
  { name: 'crouch', speed: 0.8, crouch: true, prone: false, views: ['threequarter'] },
  { name: 'prone', speed: 0.5, crouch: false, prone: true, views: ['threequarter'] },
  // Treadmill: pinned on the mark so the 0.9 s overlay stays framed while
  // the blend tree keeps the run gait (speed 3.4) ticking underneath.
  { name: 'moving', speed: 3.4, crouch: false, prone: false, views: ['threequarter'] },
];
const BEATS = [
  { name: 'windup', scrub: 'windup', phase: 'hold', elapsed: 0.18 },
  { name: 'release', scrub: 'release', phase: 'release', elapsed: 0.45 },
  { name: 'recovery', scrub: 'recovery', phase: 'recovery', elapsed: 0.7 },
];
const ELAPSED_TOL = 0.05; // one 60 Hz frame of pin drift, far under either phase gap
const expectFrames = SCENARIOS.reduce((n, s) => n + s.views.length * BEATS.length, 0);
if (expectFrames > MAX_FRAMES) throw new Error(`motion-live: plan ${expectFrames} frames exceeds bound ${MAX_FRAMES}`);

mkdirSync(OUT, { recursive: true });
const result = {
  url: URL,
  tag: TAG,
  proof: 'VISUAL clip playback only - __NTANIM.throwBody with a QA-only frame-loop beat scrub (rig.upper pin) on in-world figures, NOT a grenade event. Event admission is CPU-proved elsewhere; live network admission stays OPEN.',
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
    hasScrub: typeof window.__NTANIM?.scrubThrow === 'function',
    hasVisibility: typeof window.__NTANIM?.visibility === 'function',
    hasDetail: typeof window.__NTANIM?.throwDetail === 'function',
    post: window.__NTPOST ? { enabled: window.__NTPOST.enabled, backend: window.__NTPOST.backend } : null,
  }));
  result.dist = identity;
  check('explicit candidate URL (not the 4188 default)', !URL.includes(':4188'), URL);
  check('dist bundle identity recorded', !!identity.bundle, identity.bundle);
  check('throwBody QA present', identity.hasThrowBody === true, identity.hasThrowBody);
  check('scrub + visibility + detail QA present (rebuild dist from this lane first)',
    identity.hasScrub && identity.hasVisibility && identity.hasDetail,
    { scrub: identity.hasScrub, visibility: identity.hasVisibility, detail: identity.hasDetail });
  check('WebGPU post path live', !!identity.post?.enabled && identity.post?.backend === 'webgpu', identity.post);
  if (!identity.hasThrowBody) throw new Error('__NTANIM.throwBody missing: rebuild dist from this lane first');
  if (!identity.hasScrub || !identity.hasVisibility || !identity.hasDetail) {
    throw new Error('__NTANIM.scrubThrow/visibility/throwDetail missing: the served dist predates the QA surface this harness proves with');
  }
  if (!identity.post?.enabled || identity.post?.backend !== 'webgpu') {
    throw new Error(`not the WebGPU game path (got ${JSON.stringify(identity.post)}); refusing fallback pixels`);
  }

  // Menu path is part of the evidence; the game loop must be running.
  await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
  await page.waitForTimeout(1500);

  // Hide DOM chrome for frames only; the canvas and rAF loop are untouched.
  await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

  // Pick a CLEAR stage. Constrained to the central turning circle
  // (layout.ts: HEAD_CENTER (0,0), HEAD_RADIUS 9.2): every lens offset is
  // <= D, so a stage at radius <= 6.8 keeps stage, lenses and sight-lines on
  // open road. The 1935 run let this scan wander to (-14,-10), where clutter
  // read 0 but the front lens landed inside uncollided annex geometry.
  const stage = await page.evaluate(([d]) => {
    const busy = (x, z) => {
      let n = 0;
      for (const y of [0.4, 1.0, 1.7]) n += window.__NT.collidersAt(x, z, y).length;
      return n;
    };
    const cams = [[0, -d], [d, 0], [d * 0.72, -d * 0.72], [d * 0.42, -d * 0.52]];
    let best = null;
    for (let x = -6; x <= 6; x += 2) {
      for (let z = -6; z <= 6; z += 2) {
        if (Math.hypot(x, z) > 6.8) continue;
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
  }, [D]);
  result.stage = stage;
  check('stage is clear of colliders', stage.clutter === 0, stage);
  check('stage sits inside the turning circle (open ground by construction)', Math.hypot(stage.x, stage.z) <= 6.8, stage);
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

  /** Camera stand + figure placement for one view; settles the frame loop. */
  async function frame(sc, view) {
    await page.evaluate(([st, cfg, v]) => {
      window.__NT.setMode('walk');
      window.__NTANIM.solo(0);
      window.__NTANIM.place(0, st.x, st.z, st.yaw);
      window.__NTANIM.drive(0, cfg.speed, cfg.crouch, cfg.prone);
      window.__NTANIM.carry(0, null);
      window.__NTANIM.pin(0, st.x, st.z, st.yaw);
      window.__NTANIM.scrubThrow(0, null); // drop any previous beat pin; cancels the overlay
      window.__NT.teleport(st.x + v.dx, v.y, st.z + v.dz, v.yaw, v.pitch);
      if (window.__NT.release) window.__NT.release();
      try { window.__NT.weaponCmd('visible', false); } catch { /* lane-owned */ }
    }, [stage, sc, view]);
    await page.waitForTimeout(700);
  }

  async function shoot(scenario, view, beat) {
    if (result.frames.length >= MAX_FRAMES) throw new Error(`frame limit ${MAX_FRAMES} exceeded`);
    const b = beat;
    // QA-only VISUAL scrub: pin the authored clip to this beat on the frame
    // loop. The pin re-asserts elapsed/hold every rAF (and holds heldFor at 0
    // for windup), so every rendered frame - including the one the screenshot
    // composites - IS the beat pose. No game event is fired or claimed.
    const pinned = await page.evaluate(([i, s]) => window.__NTANIM.scrubThrow(i, s), [0, b.scrub]);
    if (!pinned) throw new Error(`scrubThrow refused the ${b.name} pin`);
    await page.waitForTimeout(120); // the pin must have asserted on real rendered frames

    const before = await page.evaluate(() => window.__NTANIM.throwDetail(0));
    const shot = await page.screenshot({ type: 'png' });
    // Sample AFTER the shot too: with the beat pinned, both samples describe
    // the presented surface, so the phase label is proven at the captured
    // render rather than reconstructed after it.
    const [after, luma] = await Promise.all([
      page.evaluate(([cx, cy, cz, yaw, pitch]) => ({
        detail: window.__NTANIM.throwDetail(0),
        vis: window.__NTANIM.visibility(0, cx, cy, cz, yaw, pitch),
        stats: window.__NT.stats(),
      }), [stage.x + view.dx, view.y + LENS_HEIGHT, stage.z + view.dz, view.yaw, view.pitch]),
      lumaOf(shot),
    ]);

    const { default: { writeFileSync: w } } = await import('node:fs');
    const file = join(OUT, `${TAG}-${scenario}-${view.name}-${b.name}.png`);
    w(file, shot);

    const phaseOk = before.phase === b.phase
      && after.detail.phase === b.phase
      && Math.abs(before.elapsed - b.elapsed) <= ELAPSED_TOL
      && Math.abs(after.detail.elapsed - b.elapsed) <= ELAPSED_TOL;
    check(`${scenario}/${view.name} ${b.name} renders at pinned ${b.phase} @${b.elapsed}s (before AND after shot)`,
      phaseOk, { before, after: after.detail });

    // Facing is strict for the stand scenario; crouch/prone/moving pitch the
    // chest frame, so their gate is "not the actor's back".
    const facingOk = view.facing === 'side'
      ? after.vis.facing === 'side'
      : scenario === 'stand'
        ? after.vis.facing === view.facing
        : after.vis.facing !== 'back';
    const visOk = after.vis.visible && after.vis.inFrustum && facingOk
      && after.vis.distance > 1.2 && after.vis.distance < 3.2;
    check(`${scenario}/${view.name} lens sees the operator (${view.name}, rig-measured)`, visOk, after.vis);

    const s = after.stats;
    const measured = Number.isFinite(s.calls) && Number.isFinite(s.triangles) && s.calls > 2;
    const frame = {
      name: `${scenario}-${view.name}-${b.name}`,
      file,
      proof: 'visual-clip-playback-scrubbed',
      phase: after.detail.phase,
      phaseAtRender: { beat: b.name, expected: b.phase, before: before.phase, after: after.detail.phase, elapsedBefore: before.elapsed, elapsedAfter: after.detail.elapsed, pinnedElapsed: b.elapsed, ok: phaseOk },
      vis: after.vis,
      luma: +luma.toFixed(1),
      lit: luma >= DARK_THRESHOLD,
      stats: { calls: s.calls, triangles: s.triangles, renderCallsTotal: s.renderCallsTotal },
      budgetOk: measured && s.calls <= CALL_BUDGET && s.triangles <= TRI_BUDGET,
    };
    result.frames.push(frame);
    console.log(`[motion-live] ${frame.lit && frame.budgetOk && phaseOk && visOk ? 'PASS' : 'OPEN'} ${frame.name} phase=${frame.phase}@${after.detail.elapsed}s ${frame.vis.facing} d=${frame.vis.distance} luma=${frame.luma} ${s.calls}c/${s.triangles}t`);
    return frame;
  }

  for (const sc of SCENARIOS) {
    for (const viewName of sc.views) {
      const view = VIEWS.find((v) => v.name === viewName);
      await frame(sc, view); // camera settle; scrub left clean by frame()
      for (const beat of BEATS) await shoot(sc.name, view, beat);
      await page.evaluate(() => window.__NTANIM.scrubThrow(0, null));
    }
  }

  check('frame count is bounded', result.frames.length <= MAX_FRAMES, result.frames.length);
  check('every frame is lit (game loop drew)', result.frames.every((f) => f.lit), result.frames.map((f) => ({ n: f.name, luma: f.luma })));
  check('every frame shows the operator at its beat phase (gates above, none skipped)',
    result.frames.length === expectFrames
    && result.checks.filter((c) => c.name.includes('renders at pinned')).every((c) => c.pass)
    && result.checks.filter((c) => c.name.includes('lens sees the operator')).every((c) => c.pass),
    { frames: result.frames.length, expect: expectFrames });
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
        try { window.__NTANIM?.scrubThrow?.(0, null); } catch { /* cleanup */ }
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
