#!/usr/bin/env node
/**
 * Live visual proof for the authored third-person throw body clip.
 *
 * ROOT-RUN ONLY. This file owns a browser (stock Chrome) and a server URL.
 * The animation-lane worker must NOT run it (no browser/GPU/server there).
 *
 * REVISION 3 (new-stage finish) - why 2124 was rejected (root looked at PNGs):
 * 1. AXIS. mesh.ts lays the receiver along +z ("points where the figure faces"),
 *    skeleton.ts says "Forward is +z", blend.ts follows actor-forward (+Z).
 *    Revision 2 inferred -Z from a wrongly framed photo and parked every lens
 *    at dz < 0 - BEHIND the actor - so visibility() correctly reported "back"
 *    in 17/21 cells. All staging math now lives in motion-stage.mjs (source
 *    contract: actor yaw 0 faces +Z, every front-ish lens has dz > 0) and this
 *    harness imports it instead of duplicating it.
 * 2. MENU. The old overlay.click() + 1500 ms never waited for the match: the
 *    first camera was reset by spawn during countdown/warmup and photographed
 *    the interior spawn view with no actor. Now: click Play solo -> Deploy,
 *    then await __NTGAME.snapshot().match.phase === 'active' before staging.
 * 3. STAGE. The old grid scan trusted collidersAt points only and staged the
 *    front lens inside uncollided annex geometry (interior wall, no actor) or
 *    collocated with a street-light pole. Now: named STAGE_ANCHORS in order,
 *    each probed with the whole-subject set (footprint ring + every lens feet
 *    column + point-sampled lens->chest sight-lines from stagePoints()); the
 *    first anchor with zero hits wins, else a frame-visible fatal - never a
 *    silent fallback.
 * 4. POSES. Projected/visibility numbers are accepted ONLY when the live
 *    player/lens pose (new read-only __NT.playerPose) and the live figure pose
 *    (__NTANIM.list) still match the expected stage + lens after settle. A
 *    respawn or drift reads as poseMismatch failure, not as a passed frame.
 *
 * Route:
 * - stock-browser.mjs owned Chrome: real WebGPU adapter, no feature flags.
 * - Explicit URL: --url or MOTION_URL/NT_URL (default the 4195 candidate).
 *   Refuses :4188 so a default checkout can never be photographed by mistake.
 *   Never spawns a preview server.
 * - Explicit out tag: --tag or MOTION_TAG. Every PNG/summary carries it.
 * - Dist identity + WebGPU/post: records the served index-*.js bundle and
 *   requires __NTPOST.backend === 'webgpu' with post enabled.
 * - Same in-world figures: figure 0 via place/drive/carry/pin plus the
 *   __NTANIM overlay path on the live rig. The game's own rAF loop draws every
 *   frame: teleport + release only, never __NT.goto/__NT.render.
 * - VISUAL CLIP PLAYBACK ONLY, with a QA-only frame-loop beat scrub:
 *   __NTANIM.scrubThrow pins rig.upper to an exact authored beat every rAF.
 *   No game event is fired or claimed - grenade event admission is CPU-proved
 *   in verify-throw-presentation.mjs; live network admission stays OPEN.
 * - Views: motion-stage.mjs VIEWS/BEATS. --views bounded (default) = stand x
 *   front/side/threequarter x 3 beats = 9 frames to establish staging; --views
 *   full restores the 21-frame plan. Facing is strict for stand, reject-'back'
 *   otherwise. All thresholds frozen (see checks below).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from '../lib/stock-browser.mjs';
import {
  BEATS,
  LENS_HEIGHT,
  STAGE_ANCHORS,
  expectedFacingLabel,
  pickPlan,
  stagePoints,
} from './motion-stage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'captures', 'motion-live');

const argv = process.argv.slice(2);
const opt = (name, dflt = '') => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const URL = opt('url', process.env.MOTION_URL || process.env.NT_URL || 'http://127.0.0.1:4195/');
const TAG = opt('tag', process.env.MOTION_TAG || 'motion-newstage');
const VIEW_MODE = opt('views', 'bounded');

const MAX_FRAMES = 24;
const DARK_THRESHOLD = 40;
const CALL_BUDGET = 1200;
const TRI_BUDGET = 900_000;
const ELAPSED_TOL = 0.05; // one 60 Hz frame of pin drift, far under either phase gap
const POS_TOL = 0.08; // metres: teleport readback vs expected feet
const ANG_TOL = 0.03; // radians: yaw/pitch readback vs expected

if (URL.includes(':4188')) {
  console.error(`[motion-live] refusing ${URL}: :4188 is another checkout's build; pass --url for the candidate`);
  process.exit(2);
}
let plan;
try {
  plan = pickPlan(VIEW_MODE);
} catch (e) {
  console.error(`[motion-live] ${String(e.message)}`);
  process.exit(2);
}
const expectFrames = plan.reduce((n, s) => n + s.views.length * BEATS.length, 0);
if (expectFrames > MAX_FRAMES) throw new Error(`motion-live: plan ${expectFrames} frames exceeds bound ${MAX_FRAMES}`);

mkdirSync(OUT, { recursive: true });
const result = {
  url: URL,
  tag: TAG,
  views: VIEW_MODE,
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
    hasList: typeof window.__NTANIM?.list === 'function',
    hasPlayerPose: typeof window.__NT?.playerPose === 'function',
    figureCount: typeof window.__NTANIM?.count === 'function' ? window.__NTANIM.count() : null,
    post: window.__NTPOST ? { enabled: window.__NTPOST.enabled, backend: window.__NTPOST.backend } : null,
  }));
  result.dist = identity;
  check('explicit candidate URL (not the 4188 default)', !URL.includes(':4188'), URL);
  check('dist bundle identity recorded', !!identity.bundle, identity.bundle);
  check('throwBody QA present', identity.hasThrowBody === true, identity.hasThrowBody);
  check('scrub + visibility + detail + list QA present (rebuild dist from this lane first)',
    identity.hasScrub && identity.hasVisibility && identity.hasDetail && identity.hasList,
    { scrub: identity.hasScrub, visibility: identity.hasVisibility, detail: identity.hasDetail, list: identity.hasList });
  check('playerPose readback present (settle assertion needs it)', identity.hasPlayerPose === true, identity.hasPlayerPose);
  check('WebGPU post path live', !!identity.post?.enabled && identity.post?.backend === 'webgpu', identity.post);
  if (!identity.hasThrowBody) throw new Error('__NTANIM.throwBody missing: rebuild dist from this lane first');
  if (!identity.hasScrub || !identity.hasVisibility || !identity.hasDetail || !identity.hasList || !identity.hasPlayerPose) {
    throw new Error('__NTANIM.scrubThrow/visibility/throwDetail/list or __NT.playerPose missing: the served dist predates the QA surface this harness proves with');
  }
  if (!identity.post?.enabled || identity.post?.backend !== 'webgpu') {
    throw new Error(`not the WebGPU game path (got ${JSON.stringify(identity.post)}); refusing fallback pixels`);
  }

  // REAL menu path: Play solo -> Deploy, then await the live match. The old
  // synthetic overlay.click() + fixed wait staged the first camera during
  // warmup and spawn reset it - that is how 2124 photographed an interior.
  const clickedSolo = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#start button')];
    const solo = btns.find((b) => /play solo/i.test(b.textContent ?? ''));
    if (!solo) return false;
    solo.click();
    return true;
  });
  check('menu: Play solo entered', clickedSolo === true, clickedSolo);
  if (!clickedSolo) throw new Error('Play solo button not found under #start; refusing synthetic overlay shortcut');
  const clickedDeploy = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#start button')];
    const deploy = btns.find((b) => /^deploy$/i.test((b.textContent ?? '').trim()));
    if (!deploy || deploy.classList.contains('aa-hidden')) return false;
    deploy.click();
    return true;
  });
  check('menu: Deploy pressed', clickedDeploy === true, clickedDeploy);
  if (!clickedDeploy) throw new Error('Deploy button not found/visible; refusing to stage pre-match');
  await page.waitForFunction(() => {
    try { return window.__NTGAME?.snapshot()?.match?.phase === 'active'; }
    catch { return false; }
  }, null, { timeout: 60_000 });
  const phaseAtStage = await page.evaluate(() => {
    try { return window.__NTGAME.snapshot().match.phase; } catch { return 'unknown'; }
  });
  result.menu = { playSolo: true, deploy: true, phaseAtStage };
  check('match active before staging (spawn cannot reset the lens)', phaseAtStage === 'active', phaseAtStage);

  // Hide DOM chrome for frames only; the canvas and rAF loop are untouched.
  await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

  // NAMED stage, probed whole-subject. Every STAGE_ANCHORS entry is tried in
  // order through stagePoints() (footprint ring + each lens feet column +
  // point-sampled lens->chest sight-lines); the first anchor with zero
  // collider hits wins. No blind grid, no silent fallback.
  const anchors = STAGE_ANCHORS.map((a) => ({ ...a, pts: stagePoints(a) }));
  const probe = await page.evaluate((list) => list.map((a) => {
    let hits = 0;
    const hitTags = {};
    for (const p of a.pts) {
      const n = window.__NT.collidersAt(p.x, p.z, p.y).length;
      if (n > 0) { hits += n; hitTags[p.tag] = (hitTags[p.tag] ?? 0) + n; }
    }
    return { name: a.name, x: a.x, z: a.z, hits, hitTags };
  }), anchors.map((a) => ({ name: a.name, x: a.x, z: a.z, pts: a.pts })));
  result.stageProbe = probe;
  const stage = probe.find((p) => p.hits === 0) ?? null;
  check('a named open stage probed clear (footprint + lenses + sight-lines)',
    stage !== null, probe.map((p) => ({ name: p.name, hits: p.hits, hitTags: p.hitTags })));
  if (!stage) throw new Error(`no STAGE_ANCHORS entry probed clear: ${JSON.stringify(probe.map((p) => ({ name: p.name, hits: p.hits })))}`);
  result.stage = { ...stage, yaw: 0 };
  console.log(`[motion-live] ${URL} bundle=${identity.bundle} stage=${stage.name} (${stage.x},${stage.z})`);

  const normAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
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

  /** Lens stand + figure placement for one view; asserts settle readback. */
  async function frame(sc, view) {
    await page.evaluate(([st, cfg, v]) => {
      window.__NT.setMode('walk');
      window.__NTANIM.solo(0);
      window.__NTANIM.place(0, st.x, st.z, 0);
      window.__NTANIM.drive(0, cfg.speed, cfg.crouch, cfg.prone);
      window.__NTANIM.carry(0, null);
      window.__NTANIM.pin(0, st.x, st.z, 0);
      window.__NTANIM.scrubThrow(0, null); // drop any previous beat pin; cancels the overlay
      window.__NT.teleport(st.x + v.dx, v.y, st.z + v.dz, v.yaw, v.pitch);
      if (window.__NT.release) window.__NT.release();
      try { window.__NT.weaponCmd('visible', false); } catch { /* lane-owned */ }
    }, [{ x: stage.x, z: stage.z }, sc, view]);
    await page.waitForTimeout(700); // several real frames at 60 Hz
    const live = await page.evaluate(() => ({
      player: window.__NT.playerPose(),
      figure: (window.__NTANIM.list() ?? []).find((f) => f.i === 0) ?? null,
    }));
    const expX = stage.x + view.dx;
    const expZ = stage.z + view.dz;
    const playerOk = Math.hypot(live.player.x - expX, live.player.z - expZ) <= POS_TOL
      && Math.abs(normAng(live.player.yaw - view.yaw)) <= ANG_TOL
      && Math.abs(normAng(live.player.pitch - view.pitch)) <= ANG_TOL
      && live.player.mode === 'walk';
    const figureOk = !!live.figure
      && Math.hypot(live.figure.x - stage.x, live.figure.z - stage.z) <= POS_TOL
      && Math.abs(normAng(live.figure.yaw - 0)) <= ANG_TOL;
    return { live, expected: { x: expX, z: expZ, yaw: view.yaw, pitch: view.pitch }, playerOk, figureOk };
  }

  async function shoot(scenario, view, beat) {
    if (result.frames.length >= MAX_FRAMES) throw new Error(`frame limit ${MAX_FRAMES} exceeded`);
    const b = beat;
    // QA-only VISUAL scrub: pin the authored clip to this beat on the frame
    // loop. No game event is fired or claimed.
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
        player: window.__NT.playerPose(),
        figure: (window.__NTANIM.list() ?? []).find((f) => f.i === 0) ?? null,
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

    // POSE GATE: projected points are evidence only when the live lens and the
    // live actor still match the expected stage + lens. A respawn or drift is
    // a visible failure here, never an accepted frame.
    const expX = stage.x + view.dx;
    const expZ = stage.z + view.dz;
    const lensOk = Math.hypot(after.player.x - expX, after.player.z - expZ) <= POS_TOL
      && Math.abs(normAng(after.player.yaw - view.yaw)) <= ANG_TOL
      && Math.abs(normAng(after.player.pitch - view.pitch)) <= ANG_TOL;
    const actorOk = !!after.figure
      && Math.hypot(after.figure.x - stage.x, after.figure.z - stage.z) <= POS_TOL
      && Math.abs(normAng(after.figure.yaw - 0)) <= ANG_TOL;
    const poseOk = lensOk && actorOk;
    check(`${scenario}/${view.name} ${b.name} poses match expected (lens + actor, live readback)`,
      poseOk, { player: after.player, figure: after.figure, expected: { x: expX, z: expZ, yaw: view.yaw, pitch: view.pitch } });

    // Facing: strict for stand (motion-stage expectation), reject-'back' for
    // crouch/prone/moving whose pitched chest frames soften the label. Gated
    // on poseOk: a well-framed number from the wrong pose is not evidence.
    const want = expectedFacingLabel(scenario, view);
    const facingOk = poseOk && (want === 'side'
      ? after.vis.facing === 'side'
      : want === null
        ? after.vis.facing !== 'back'
        : after.vis.facing === want);
    const visOk = after.vis.visible && after.vis.inFrustum && facingOk
      && after.vis.distance > 1.2 && after.vis.distance < 3.2;
    check(`${scenario}/${view.name} lens sees the operator (${view.name}, rig-measured, pose-gated)`, visOk, after.vis);

    const s = after.stats;
    const measured = Number.isFinite(s.calls) && Number.isFinite(s.triangles) && s.calls > 2;
    const frame = {
      name: `${scenario}-${view.name}-${b.name}`,
      file,
      proof: 'visual-clip-playback-scrubbed',
      stage: stage.name,
      phase: after.detail.phase,
      phaseAtRender: { beat: b.name, expected: b.phase, before: before.phase, after: after.detail.phase, elapsedBefore: before.elapsed, elapsedAfter: after.detail.elapsed, pinnedElapsed: b.elapsed, ok: phaseOk },
      pose: { lensOk, actorOk, ok: poseOk, player: after.player, figure: after.figure },
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

  const { VIEWS } = await import('./motion-stage.mjs');
  for (const sc of plan) {
    for (const viewName of sc.views) {
      const view = VIEWS.find((v) => v.name === viewName);
      const settle = await frame(sc, view); // lens settle; scrub left clean by frame()
      check(`${sc.name}/${view.name} lens settled on the expected pose (not the spawn view)`,
        settle.playerOk && settle.figureOk, settle);
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
  if (owned) await owned.close(); // owned stock Chrome always closed, pass or fail
}

console.log(JSON.stringify({ pass: result.pass, frames: result.frames.length, checks: result.checks, fatal: result.fatal ?? null }, null, 2));
if (!result.pass) process.exitCode = 1;
