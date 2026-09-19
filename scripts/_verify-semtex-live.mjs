/**
 * _verify-semtex-live — Strict live-game proof for Semtex tactical ordnance.
 *
 * Runs on the BUILT candidate bundle through the game's actual frame loop,
 * real menu/deploy flow, WebGPU rendering, host countdown, and player action.
 *
 * What this proves:
 *   1. Real menu & Deploy: Play solo pressed, then the tactical Semtex button
 *      pressed in the now-visible pre-match loadout panel (.aa-tac, required
 *      selected state), then the real Deploy button pressed; active match
 *      entered after host countdown. No localStorage seeding, no #start
 *      container clicks — a missing panel or button refuses, never falls back.
 *   2. Loadout binding: panel press required, HUD includes SEMTEX
 *      (.hud-grenade-tactical) and weapons controller reports
 *      tacticalId === 'semtex'.
 *   3. Real rAF sampling: frame-by-frame sampling of read-only qa().flights projection
 *      (patches/0001-qa-flight-projection.patch) during throw, flight, stick, and fuse.
 *   4. First contact & stationary casing: own semtex flight touches surface and
 *      remains stationary (dx, dy, dz <= 0.02 m) for >= 3 distinct rAF frames.
 *   5. Fuse timing from stick: detonation occurs 1100 +/- 200 ms after first contact,
 *      not from release.
 *   6. Single throw & single ID: exactly one thrown line, one detonation line,
 *      matching flight ID, no duplicate throws or resurrections.
 *   7. Inventory consumption: tactical pouch transitions 1 -> 0, armed clears to null,
 *      no mid-window respawn.
 *   8. Blast placement: detonation at stuck coordinates (<= 0.5 m); blast smoke volume
 *      announced on event bus.
 *   9. Photographic evidence: screenshots captured while casing is stuck and after
 *      blast effect via real rAF.
 *  10. Machine hygiene: owned stock Chrome via scripts/lib/stock-browser.mjs,
 *      strict <= 150 s total deadline, clean finally-block teardown.
 *  11. Receipt: the JSON receipt preserves the raw bounded rAF frames, the
 *      event-log tail, both bundle SHAs and every actual input, and is written
 *      on failure too — a failed run stays reconstructible. Screenshots are
 *      real page captures of the still-live stuck casing; nothing synthetic.
 *
 * Usage:
 *   node scripts/_verify-semtex-live.mjs --url http://127.0.0.1:4196/ --tag live --sha <root-expected-sha>
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stockBrowser } from './lib/stock-browser.mjs';
import { usePreview } from './lib/preview.mjs';
import { analyseSemtexRun } from './lib/semtex-analysis.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const SECONDS = Number(opt('seconds', '60'));
const TAG = opt('tag', 'live');
const URL_OPT = opt('url', null);
const PORT_OPT = opt('port', null);
const EXPECT_SHA = opt('sha', null);

// The bundle digest is evidence, not decoration: root publishes the expected
// SHA of the candidate under test and this runner refuses to run without it.
if (!EXPECT_SHA || !/^[0-9a-f]{16,128}$/i.test(EXPECT_SHA)) {
  console.error('[verify-semtex-live] refuse: --sha <root-expected-sha> is required (full or abbreviated hex digest)');
  process.exit(2);
}

// Strict deadline: script cannot exceed 135 s run parameter, absolute 150 s watchdog
if (SECONDS > 135) {
  console.error('[verify-semtex-live] refuse: --seconds ' + SECONDS + ' exceeds 135s headroom for 150s budget');
  process.exit(2);
}

const { url } = URL_OPT
  ? { url: URL_OPT }
  : PORT_OPT
    ? { url: 'http://127.0.0.1:' + PORT_OPT + '/' }
    : await usePreview();

/** Teleport position: open street by circle, looking east and slightly down toward asphalt */
const THROW_POSE = { x: -6.0, z: 0.0, yaw: -Math.PI / 2, pitch: 0.1 };

let exitCode = 1;
let browserInstance = null;
// Partial evidence for the failure receipt: every assignment below fills one
// more field, so a throw at any point still leaves a reconstructible record.
const evidence = {
  frames: [], lineTail: [], baselineLineCount: 0,
  armPerfNow: null, releasePerfNow: null,
  hudTacticalPre: null, hudTacticalPost: null,
  tacticalIdReadback: null, panelSemtexPressed: false,
  bundleStart: null, bundleEnd: null, webgpu: null,
  pageErrors: [], fpsBefore: null, fpsAfter: null,
  screenshots: { stuck: 0, after: 0 },
};
const receiptPath = () => join(ROOT, 'captures', `verify-semtex-live-${TAG}.json`);
const writeReceipt = (payload) => {
  mkdirSync(join(ROOT, 'captures'), { recursive: true });
  writeFileSync(receiptPath(), JSON.stringify(payload, null, 2));
};

// Overall hard deadline watchdog (150 s)
const watchdog = setTimeout(() => {
  console.error('\n[verify-semtex-live] HARD TIMEOUT: run exceeded strict 150 s budget');
  if (browserInstance) {
    try { browserInstance.close(); } catch {}
  }
  process.exit(2);
}, 150_000);
watchdog.unref();

try {
  console.log(`[verify-semtex-live] Target: ${url} (max ${SECONDS}s, tag=${TAG})`);
  browserInstance = await stockBrowser('semtex-live');
  const { page } = browserInstance;

  const pageErrors = evidence.pageErrors;
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text().slice(0, 240));
  });
  page.on('pageerror', (e) => {
    pageErrors.push('PAGEERROR ' + String(e).slice(0, 240));
  });

  // 1. Navigate to candidate URL
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 90000 });

  const hasHook = await page.evaluate(() =>
    typeof window.__NT.ordnance === 'function' && typeof window.__NTGAME === 'object'
  );
  if (!hasHook) {
    throw new Error('__NT.ordnance / __NTGAME missing — build lacks required game interface');
  }

  // 2. Sample bundle identity at start
  const bundleUrl = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.src);
    return scripts.find((s) => s.includes('/assets/') || s.includes('/src/')) ?? window.location.href;
  });
  const bundleStartText = await page.evaluate(async (bUrl) => {
    try {
      const resp = await fetch(bUrl);
      return await resp.text();
    } catch {
      return '';
    }
  }, bundleUrl);
  const bundleStart = {
    url: bundleUrl,
    sha256: createHash('sha256').update(bundleStartText).digest('hex'),
  };
  evidence.bundleStart = bundleStart;
  console.log(`[verify-semtex-live] Bundle start SHA: ${bundleStart.sha256.slice(0, 12)} (${bundleUrl})`);

  // 3. Real menu flow: Play solo -> Semtex in the now-visible loadout panel ->
  //    real Deploy button -> active match. Every press is a real button press;
  //    a missing panel or button refuses outright. There is deliberately no
  //    localStorage seeding and no #start container click: both bypass the
  //    player's path and can arm a loadout the menu never offered.
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.aa-tac').length > 0, null, { timeout: 15000 });
  await page.getByRole('button', { name: /semtex/i }).click();
  const panelSemtexPressed = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.aa-tac'));
    const semtexBtn = btns.find((b) => {
      const name = b.querySelector('.aa-tac-name');
      return (name && name.textContent.trim().toLowerCase() === 'semtex') ||
        b.textContent.toLowerCase().includes('semtex');
    });
    if (!semtexBtn) return false;
    return semtexBtn.getAttribute('aria-pressed') === 'true' || semtexBtn.classList.contains('aa-selected');
  });
  if (!panelSemtexPressed) {
    throw new Error('Semtex loadout button did not reach selected state after a real press — refusing synthetic loadout');
  }
  evidence.panelSemtexPressed = true;
  console.log('[verify-semtex-live] Loadout panel: Semtex pressed and selected');

  // 4. Press the real Deploy button and wait for match countdown -> active
  await page.getByRole('button', { name: /deploy/i }).click();

  // Helper to read player row & match state
  const selfRow = () => page.evaluate(() => {
    const s = window.__NTGAME.snapshot();
    const a = s.actors.find((x) => x.id === 'you');
    return {
      hostAt: Math.round(s.at),
      phase: s.match.phase,
      perfNow: Math.round(performance.now()),
      fps: window.__NT.stats ? window.__NT.stats().fps : 60,
      hand: window.__NT.weaponCmd('ordnance'),
      me: a ? { alive: a.alive, lethal: a.lethal, tactical: a.tactical, armed: a.armed, primaryId: a.primaryId, team: a.team } : null,
    };
  });

  // Wait until match is active and human is alive
  console.log('[verify-semtex-live] Waiting for match countdown to finish (phase -> active)...');
  const tWaitStart = Date.now();
  let row = null;
  while (Date.now() - tWaitStart < 30000) {
    row = await selfRow();
    if (row && row.me && row.me.alive && row.phase === 'active') {
      await page.waitForTimeout(300);
      const row2 = await selfRow();
      if (row2 && row2.me && row2.me.alive) {
        row = row2;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  if (!row || !row.me || !row.me.alive || row.phase !== 'active') {
    throw new Error('Match did not become active with player alive within 30s');
  }

  // 5. Verify pre-throw tactical HUD, tacticalId readback, and actual WebGPU.
  //    The fallback renderer (WebGL2, post chain off) is not this proof: both
  //    the renderer and the post backend must report webgpu.
  const tacticalIdReadback = row.hand ? row.hand.tacticalId : null;
  const hudTacticalPre = await page.evaluate(() => {
    const el = document.querySelector('.hud-grenade-tactical');
    return el ? el.textContent.trim() : null;
  });
  const webgpu = await page.evaluate(() => ({
    renderer: window.__NT_BACKEND ? window.__NT_BACKEND.actual ?? null : null,
    post: window.__NTPOST ? window.__NTPOST.backend ?? null : null,
    postEnabled: window.__NTPOST ? window.__NTPOST.enabled ?? null : null,
  }));
  evidence.tacticalIdReadback = tacticalIdReadback;
  evidence.hudTacticalPre = hudTacticalPre;
  evidence.webgpu = webgpu;
  evidence.fpsBefore = row.fps;
  console.log(`[verify-semtex-live] Active match: phase=${row.phase} tacticalId=${tacticalIdReadback} HUD="${hudTacticalPre}" gpu=${webgpu.renderer}/${webgpu.post} enabled=${webgpu.postEnabled}`);
  if (webgpu.post !== 'webgpu' || webgpu.renderer !== 'webgpu' || webgpu.postEnabled === false) {
    throw new Error(`Actual WebGPU required (renderer=${webgpu.renderer} post=${webgpu.post} enabled=${webgpu.postEnabled}) — refusing fallback proof`);
  }

  // Wait until player holds tactical charge
  const tSupplyStart = Date.now();
  while (Date.now() - tSupplyStart < 35000) {
    const r = await selfRow();
    if (r && r.me && r.me.alive && r.me.tactical >= 1) {
      row = r;
      break;
    }
    await page.waitForTimeout(300);
  }
  if (!row.me || row.me.tactical < 1) {
    throw new Error('Player never held tactical grenade charge');
  }

  // Teleport to throw pose and settle
  await page.evaluate((p) => window.__NT.teleport(p.x, 0, p.z, p.yaw, p.pitch), THROW_POSE);
  await page.waitForTimeout(350);

  // Wait for off-hand to be idle
  const tIdleStart = Date.now();
  while (Date.now() - tIdleStart < 4000) {
    const h = await page.evaluate(() => window.__NT.weaponCmd('ordnance'));
    if (h && h.hand === 'idle') break;
    await page.waitForTimeout(100);
  }

  const fpsBefore = row.fps;
  const baselineLineCount = await page.evaluate(() => {
    const o = window.__NT.ordnance ? window.__NT.ordnance() : null;
    return o && o.lines ? o.lines.length : 0;
  });

  // 6. Install high-frequency rAF frame sampler in browser page
  await page.evaluate(() => {
    window.__semtexFrames = [];
    window.__semtexSampling = true;
    let n = 0;
    function sample() {
      const o = window.__NT.ordnance ? window.__NT.ordnance() : null;
      if (o && o.bound) {
        window.__semtexFrames.push({
          t: performance.now(),
          n: n++,
          selfId: o.selfId ?? 'you',
          tactical: o.self ? o.self.tactical : null,
          armed: o.self ? o.self.armed : null,
          spawnSeq: o.self ? o.self.spawnSeq : null,
          lineCount: o.lines ? o.lines.length : 0,
          flights: o.flights ? o.flights.slice() : [],
        });
      }
      if (window.__semtexSampling) {
        requestAnimationFrame(sample);
      }
    }
    requestAnimationFrame(sample);
  });

  // 7. Arm and Release Semtex
  console.log('[verify-semtex-live] Arming Semtex...');
  const armPerfNow = await page.evaluate(() => {
    window.__NT.weaponCmd('grenade', 'semtex');
    return performance.now();
  });

  await page.waitForTimeout(400);

  console.log('[verify-semtex-live] Releasing Semtex...');
  const releasePerfNow = await page.evaluate(() => {
    window.__NT.weaponCmd('grenade');
    return performance.now();
  });

  const hudTacticalPost = await page.evaluate(() => {
    const el = document.querySelector('.hud-grenade-tactical');
    return el ? el.textContent.trim() : null;
  });

  // 8. Observe flight, stick, screenshots, and detonation.
  //    The stuck-screenshot trigger is deliberately narrow: it fires only for
  //    a CURRENTLY LIVE own flight (ownerId === selfId, grenadeId semtex,
  //    resting) with >= 3 distinct rAF frames of that same id resting, and a
  //    fresh live re-read must still show the casing at capture time. Bot
  //    semtex and post-detonation frame history can never trigger it: the
  //    projection only carries live flights, so anything retired is absent.
  mkdirSync(join(ROOT, 'captures'), { recursive: true });
  let stuckScreenshotTaken = false;
  let stuckScreenshotId = null;
  let stuckScreenshotBytes = 0;
  let afterScreenshotBytes = 0;

  const tObservationEnd = Date.now() + 10000;
  let sawDetonation = false;

  while (Date.now() < tObservationEnd) {
    const status = await page.evaluate(() => {
      const frames = window.__semtexFrames || [];
      const o = window.__NT.ordnance ? window.__NT.ordnance() : null;
      const lines = o && o.lines ? o.lines : [];
      const det = lines.some((l) => /grenade-detonated you semtex/.test(l));
      const selfId = frames.length
        ? frames[frames.length - 1].selfId
        : (o && o.selfId ? o.selfId : 'you');
      const restingFramesById = new Map();
      for (const f of frames) {
        if (f.selfId !== selfId || !Array.isArray(f.flights)) continue;
        for (const fl of f.flights) {
          if (fl.grenadeId !== 'semtex' || fl.ownerId !== selfId) continue;
          if (fl.resting === true) {
            let set = restingFramesById.get(fl.id);
            if (!set) { set = new Set(); restingFramesById.set(fl.id, set); }
            set.add(f.n);
          }
        }
      }
      const liveNow = new Map();
      if (o && Array.isArray(o.flights)) {
        for (const fl of o.flights) {
          if (fl.grenadeId === 'semtex' && fl.ownerId === selfId && fl.resting === true) {
            liveNow.set(fl.id, { x: fl.x, y: fl.y, z: fl.z });
          }
        }
      }
      const candidates = [];
      for (const [id, set] of restingFramesById) {
        if (set.size >= 3 && liveNow.has(id)) {
          candidates.push({ id, restingFrames: set.size, ...liveNow.get(id) });
        }
      }
      return { totalFrames: frames.length, selfId, det, candidates };
    });

    // Capture only while the same own casing is still live and resting.
    if (!stuckScreenshotTaken && status.candidates.length >= 1) {
      const target = status.candidates[0];
      const stillLive = await page.evaluate(({ id, selfId }) => {
        const o = window.__NT.ordnance ? window.__NT.ordnance() : null;
        const fl = o && Array.isArray(o.flights)
          ? o.flights.find((f) => f.id === id && f.grenadeId === 'semtex' && f.ownerId === selfId && f.resting === true)
          : null;
        return fl ? { x: fl.x, y: fl.y, z: fl.z } : null;
      }, { id: target.id, selfId: status.selfId });
      if (stillLive) {
        stuckScreenshotTaken = true;
        stuckScreenshotId = target.id;
        const buf = await page.screenshot();
        writeFileSync(join(ROOT, 'captures', `verify-semtex-live-stuck-${TAG}.png`), buf);
        stuckScreenshotBytes = buf.length;
        console.log(`[verify-semtex-live] Casing stuck (own id=${target.id}, ${target.restingFrames} resting frames, still live): captured verify-semtex-live-stuck-${TAG}.png (${buf.length} bytes)`);
      }
    }

    if (status.det) {
      sawDetonation = true;
      // Wait 200 ms for blast smoke expansion, then capture after screenshot
      await page.waitForTimeout(200);
      const bufAfter = await page.screenshot();
      writeFileSync(join(ROOT, 'captures', `verify-semtex-live-after-${TAG}.png`), bufAfter);
      afterScreenshotBytes = bufAfter.length;
      console.log(`[verify-semtex-live] Blast effect: captured verify-semtex-live-after-${TAG}.png (${bufAfter.length} bytes)`);
      break;
    }

    await page.waitForTimeout(100);
  }

  // Stop sampler and collect frames
  const { frames, allLines, fpsAfter } = await page.evaluate(() => {
    window.__semtexSampling = false;
    const o = window.__NT.ordnance ? window.__NT.ordnance() : null;
    return {
      frames: window.__semtexFrames || [],
      allLines: o && o.lines ? o.lines : [],
      fpsAfter: window.__NT.stats ? window.__NT.stats().fps : 60,
    };
  });

  const lineTail = allLines.slice(baselineLineCount);

  // 9. Re-verify bundle identity at end
  const bundleEndText = await page.evaluate(async (bUrl) => {
    try {
      const resp = await fetch(bUrl);
      return await resp.text();
    } catch {
      return '';
    }
  }, bundleUrl);
  const bundleEnd = {
    url: bundleUrl,
    sha256: createHash('sha256').update(bundleEndText).digest('hex'),
  };
  evidence.bundleEnd = bundleEnd;

  // 10. Run pure analysis over the actual inputs, then preserve everything.
  evidence.frames = frames;
  evidence.lineTail = lineTail;
  evidence.baselineLineCount = baselineLineCount;
  evidence.armPerfNow = armPerfNow;
  evidence.releasePerfNow = releasePerfNow;
  evidence.hudTacticalPost = hudTacticalPost;
  evidence.fpsAfter = fpsAfter;
  evidence.screenshots = { stuck: stuckScreenshotBytes, after: afterScreenshotBytes };
  evidence.stuckScreenshotId = stuckScreenshotId;
  evidence.sawDetonation = sawDetonation;
  const analysisInput = {
    frames: evidence.frames,
    lineTail: evidence.lineTail,
    baselineLineCount,
    armPerfNow,
    releasePerfNow,
    hudTacticalPre,
    hudTacticalPost,
    tacticalIdReadback,
    panelSemtexPressed,
    bundleStart,
    bundleEnd,
    webgpu,
    expectSha: EXPECT_SHA,
    pageErrors,
    fpsBefore,
    fpsAfter,
    screenshots: {
      stuck: stuckScreenshotBytes,
      after: afterScreenshotBytes,
    },
  };

  const analysis = analyseSemtexRun(analysisInput);

  console.log('\n---- Event Log Tail ----');
  for (const l of lineTail) console.log('  ' + l);
  console.log('---- End of Log ----\n');

  console.log('[verify-semtex-live] Checks:');
  for (const c of analysis.checks) {
    const symbol = c.pass ? 'PASS' : 'FAIL';
    console.log(`  ${symbol}  ${c.name.padEnd(26)} : ${c.detail}`);
  }

  // The receipt keeps the raw bounded frames, the log tail, both bundle SHAs
  // and every actual input, so a failed run is reconstructible offline.
  const resultPayload = {
    tag: TAG,
    url,
    verdict: analysis.verdict,
    checks: analysis.checks,
    facts: analysis.facts,
    sampledFrames: frames.length,
    frames,
    lineTail,
    lineTailCount: lineTail.length,
    baselineLineCount,
    armPerfNow,
    releasePerfNow,
    hudTacticalPre,
    hudTacticalPost,
    tacticalIdReadback,
    panelSemtexPressed,
    stuckScreenshotId,
    sawDetonation,
    bundleStart,
    bundleEnd,
    expectSha: EXPECT_SHA,
    webgpu,
    fpsBefore,
    fpsAfter,
    screenshots: { stuck: stuckScreenshotBytes, after: afterScreenshotBytes },
    pageErrors,
  };

  writeReceipt(resultPayload);

  if (analysis.verdict === 'HOLDS') {
    console.log(`\n[verify-semtex-live] HOLDS: All ${analysis.checks.length} checks passed. Stationary semtex proof established.`);
    exitCode = 0;
  } else {
    console.log(`\n[verify-semtex-live] REFUTED: One or more checks failed.`);
    exitCode = 1;
  }
} catch (err) {
  console.error('[verify-semtex-live] ERROR:', err);
  // A throw is not an excuse for no receipt: persist whatever was gathered.
  try {
    writeReceipt({
      tag: TAG,
      url,
      verdict: 'ERROR',
      error: String(err && err.stack ? err.stack : err).slice(0, 2000),
      checks: [],
      facts: {},
      sampledFrames: evidence.frames.length,
      frames: evidence.frames,
      lineTail: evidence.lineTail,
      lineTailCount: evidence.lineTail.length,
      baselineLineCount: evidence.baselineLineCount,
      armPerfNow: evidence.armPerfNow,
      releasePerfNow: evidence.releasePerfNow,
      hudTacticalPre: evidence.hudTacticalPre,
      hudTacticalPost: evidence.hudTacticalPost,
      tacticalIdReadback: evidence.tacticalIdReadback,
      panelSemtexPressed: evidence.panelSemtexPressed,
      stuckScreenshotId: evidence.stuckScreenshotId ?? null,
      sawDetonation: evidence.sawDetonation ?? false,
      bundleStart: evidence.bundleStart,
      bundleEnd: evidence.bundleEnd,
      expectSha: EXPECT_SHA,
      webgpu: evidence.webgpu,
      fpsBefore: evidence.fpsBefore,
      fpsAfter: evidence.fpsAfter,
      screenshots: evidence.screenshots,
      pageErrors: evidence.pageErrors,
    });
    console.error(`[verify-semtex-live] Failure receipt written: captures/verify-semtex-live-${TAG}.json`);
  } catch {}
  exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
  }
}

process.exit(exitCode);
