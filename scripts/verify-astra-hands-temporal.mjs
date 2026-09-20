/** ROOT-RUN ONLY: one owned stock Chrome at a time; actual game rAF, no pose seeking.
 * RECOVERY_URL='http://127.0.0.1:PORT/?lighting=...' ASTRA_HANDS_MODE=both node scripts/verify-astra-hands-temporal.mjs
 * Modes: motion | rigged | both (default). Existing URL flags are preserved.
 * --self-check exercises observer failure controls without a browser or server.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = { calls: 1200, triangles: 900_000, captureMs: 20_000, screenshots: 10, samples: 450 };
const RELOAD_TARGETS = [0, .16, .32, .48, .64, .80];
const ENTRY_TIMEOUT = 30_000; // Same action budget as the passed 17-pose observer.
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function modeUrl(base, mode) {
  const url = new URL(base); url.searchParams.set('motion', 'canary');
  if (mode === 'rigged') url.searchParams.set('hands', 'rigged'); else url.searchParams.delete('hands');
  return url.href;
}
function withinBudget(s) {
  return !!s && Number.isFinite(s.calls) && Number.isFinite(s.triangles)
    && s.calls > 2 && s.triangles > 2 && s.renderCallsTotal > 0
    && s.calls <= LIMIT.calls && s.triangles <= LIMIT.triangles;
}
function sprintEvidence(samples) {
  const rows = samples.filter(s => s.stage === 'sprint' && s.pose?.mode === 'walk');
  let distance = 0, maxSpeed = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i], seconds = (b.t - a.t) / 1000;
    if (!(seconds > 0)) continue;
    const step = Math.hypot(b.pose.x - a.pose.x, b.pose.z - a.pose.z);
    distance += step; maxSpeed = Math.max(maxSpeed, step / seconds);
  }
  return { status: distance > .25 && maxSpeed > 6.5 ? 'PASS' : 'OPEN', samples: rows.length,
    distanceM: distance, maxHorizontalSpeedMps: maxSpeed,
    note: 'Derived from real playerPose displacement/timestamps while W+Shift held. A blocked spawn route stays OPEN.' };
}
function entryRecoveryAction(entry) {
  if (entry.matchMode && entry.matchMode !== 'idle') {
    if (entry.surface === 'hidden') return 'pause';
    if (entry.surface === 'paused-match' || entry.surface === 'match-over') return 'leave';
  }
  if (entry.surface === 'pre-match' && entry.panel && entry.panel !== 'main') return 'back';
  return null;
}
async function enterSolo(page, result) {
  result.entryTrace = [];
  const inspect = async label => {
    const entry = await page.evaluate(() => {
      const overlay = document.getElementById('start');
      const menu = window.__AA_UI?.menu;
      return { t: performance.now(), surface: menu?.state?.().surface ?? null,
        panel: menu?.panel?.() ?? null, matchMode: window.__NTGAME?.mode?.() ?? null,
        overlay: overlay ? { display: getComputedStyle(overlay).display, visibility: getComputedStyle(overlay).visibility, rects: overlay.getClientRects().length } : null,
        visibleButtons: [...document.querySelectorAll('#start button')]
          .filter(b => b.getClientRects().length > 0 && getComputedStyle(b).visibility === 'visible')
          .map(b => b.textContent?.trim()).filter(Boolean) };
    });
    result.entryTrace.push({ label, ...entry }); return entry;
  };
  try {
    // An entry state is observed before choosing any recovery action. Returning
    // via the real menu preserves the same Play solo -> Deploy route for both modes.
    for (let attempt = 0; attempt < 3; attempt++) {
      const entry = await inspect(`entry-${attempt}`), action = entryRecoveryAction(entry);
      if (!action) break;
      result.actions.push({ action: `entry-${action}`, t: entry.t });
      if (action === 'leave') {
        await page.getByRole('button', { name: 'Leave match', exact: true }).click({ timeout: ENTRY_TIMEOUT });
        await page.waitForFunction(() => window.__NTGAME?.mode?.() === 'idle', null, { timeout: ENTRY_TIMEOUT });
      } else {
        await page.keyboard.press('Escape');
        await page.waitForFunction(previous => {
          const m = window.__AA_UI?.menu;
          return m?.state?.().surface !== previous.surface || m?.panel?.() !== previous.panel;
        }, { surface: entry.surface, panel: entry.panel }, { timeout: ENTRY_TIMEOUT });
      }
    }
    const solo = page.getByRole('button', { name: 'Play solo', exact: true });
    await solo.waitFor({ state: 'visible', timeout: ENTRY_TIMEOUT });
    await inspect('before-play-solo'); await solo.click({ timeout: ENTRY_TIMEOUT });
    const deploy = page.getByRole('button', { name: 'Deploy', exact: true });
    await deploy.waitFor({ state: 'visible', timeout: ENTRY_TIMEOUT });
    await inspect('before-deploy'); await deploy.click({ timeout: ENTRY_TIMEOUT });
    await page.waitForFunction(() => {
      try { return window.__NTGAME?.snapshot?.().match?.phase === 'active' && window.__NT?.weaponCmd?.('state')?.visible === true; }
      catch { return false; }
    }, null, { timeout: 45_000 });
    await inspect('deployed');
  } catch (error) {
    try { await inspect('entry-failed'); } catch { /* Preserve the original entry error. */ }
    throw error;
  }
}
function selfCheck() {
  const base = 'http://127.0.0.1:4192/?lighting=glm&glazing=foo&hands=old';
  assert.equal(new URL(modeUrl(base, 'motion')).searchParams.get('hands'), null);
  assert.equal(new URL(modeUrl(base, 'rigged')).searchParams.get('hands'), 'rigged');
  for (const mode of ['motion', 'rigged']) {
    const u = new URL(modeUrl(base, mode)); assert.equal(u.searchParams.get('lighting'), 'glm');
    assert.equal(u.searchParams.get('glazing'), 'foo'); assert.equal(u.searchParams.get('motion'), 'canary');
  }
  assert.equal(withinBudget({ calls: 1200, triangles: 900000, renderCallsTotal: 3 }), true);
  for (const s of [null, {}, { calls: 0, triangles: 0 }, { calls: 1201, triangles: 3, renderCallsTotal: 4 }, { calls: 4, triangles: 900001, renderCallsTotal: 4 }]) assert.equal(withinBudget(s), false);
  const row = (t, x) => ({ t, stage: 'sprint', pose: { mode: 'walk', x, z: 0 } });
  assert.equal(sprintEvidence([row(0, 0), row(100, .66)]).status, 'PASS');
  assert.equal(sprintEvidence([row(0, 0), row(100, 0)]).status, 'OPEN');
  assert.equal(sprintEvidence([row(0, 0), row(100, .48)]).status, 'OPEN');
  assert.equal(entryRecoveryAction({ surface: 'pre-match', panel: 'main', matchMode: 'idle' }), null);
  assert.equal(entryRecoveryAction({ surface: 'hidden', panel: 'main', matchMode: 'solo' }), 'pause');
  assert.equal(entryRecoveryAction({ surface: 'paused-match', panel: 'main', matchMode: 'solo' }), 'leave');
  assert.equal(entryRecoveryAction({ surface: 'pre-match', panel: 'solo', matchMode: 'idle' }), 'back');
  console.log('PASS: URL/budget/movement controls and observed-state entry recovery. No browser started.');
}

async function runMode(base, mode, directory, source) {
  const { stockBrowser } = await import('./lib/stock-browser.mjs');
  const url = modeUrl(base, mode), out = join(directory, mode); mkdirSync(out);
  const result = { schema: 1, mode, url, source, startedAt: new Date().toISOString(), limits: LIMIT,
    route: 'Play solo -> Deploy -> real game loop', actions: [], frames: [], samples: [], errors: [], checks: [], open: [], bundles: [] };
  const check = (name, pass, detail) => result.checks.push({ name, pass: !!pass, detail });
  let owned, page, captureStart = null;
  const tasks = [];
  try {
    owned = await stockBrowser(`astra-temporal-${mode}`); page = owned.page;
    page.setDefaultTimeout(5000);
    page.on('pageerror', e => result.errors.push({ type: 'pageerror', message: String(e).slice(0, 500) }));
    page.on('console', m => { if (m.type() === 'error') result.errors.push({ type: 'console', message: m.text().slice(0, 500) }); });
    page.on('response', response => {
      const u = new URL(response.url());
      if (u.origin !== new URL(url).origin || !/\/assets\/[^/]+\.js$/.test(u.pathname)) return;
      tasks.push(response.body().then(body => result.bundles.push({ url: response.url(), status: response.status(), bytes: body.length, sha256: sha256(body) }))
        .catch(e => result.open.push(`Loaded bundle response body unavailable: ${u.pathname}: ${String(e).slice(0, 160)}`)));
    });
    await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction(() => window.__NT?.ready === true, null, { timeout: 90_000 });
    await enterSolo(page, result);
    result.entryScripts = await page.evaluate(() => [...document.scripts].filter(s => s.type === 'module' && s.src).map(s => s.src));
    await Promise.all(tasks);
    const entry = result.bundles.filter(b => result.entryScripts.includes(b.url));
    if (!entry.length) result.open.push('Loaded entry bundle bytes were not captured; local checkout SHA is not served-build proof.');
    const expected = process.env.EXPECTED_BUNDLE_SHA256?.toLowerCase();
    if (expected) check('expected live entry bundle hash', entry.some(b => b.sha256 === expected), { expected, entry });
    result.identity = { localCheckoutAssociation: 'CLAIMED until root binds the served artifact', liveEntryBundles: entry };
    // Only DOM chrome is hidden, just as in the accepted 17-pose observer.
    await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
    const read = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve({
      t: performance.now(), state: window.__NT.weaponCmd('state'), stats: window.__NT.stats(), pose: window.__NT.playerPose(),
    }))));
    async function waitFor(predicate, label, timeout = 4000) {
      const start = performance.now(); let row;
      while (performance.now() - start < timeout) {
        row = await read(); if (predicate(row)) return row;
        await page.waitForTimeout(15);
      }
      throw new Error(`${label} timed out; last=${JSON.stringify(row)}`);
    }
    async function command(cmd, arg) {
      const action = await page.evaluate(({ cmd, arg }) => ({ t: performance.now(), cmd, arg, result: window.__NT.weaponCmd(cmd, arg) }), { cmd, arg });
      result.actions.push(action); return action.result;
    }
    check('switch duster', await command('switch', 'duster') === true);
    await waitFor(s => s.state.id === 'duster' && !s.state.reloading, 'duster selected');
    check('refill admitted', await command('refill') === true);
    await command('ads', false); await waitFor(s => s.state.ads === false, 'hip reset');
    captureStart = performance.now();
    // This observer only reads game state. Sampling is 20Hz, bounded to 20s/450
    // rows, and does not set clocks, poses, camera, player position or animation.
    await page.evaluate(({ maxMs, maxSamples }) => {
      const q = { start: performance.now(), last: -Infinity, stage: 'hip', rows: [], raf: 0 };
      window.__ASTRA_TEMPORAL_QA = q;
      function observe(t) {
        if (t - q.start > maxMs || q.rows.length >= maxSamples) return;
        if (t - q.last >= 50) {
          q.last = t; q.rows.push({ t, stage: q.stage, state: window.__NT.weaponCmd('state'), stats: window.__NT.stats(), pose: window.__NT.playerPose() });
        }
        q.raf = requestAnimationFrame(observe);
      }
      q.raf = requestAnimationFrame(observe);
    }, { maxMs: LIMIT.captureMs, maxSamples: LIMIT.samples });
    async function stage(value) { await page.evaluate(value => { window.__ASTRA_TEMPORAL_QA.stage = value; }, value); }
    async function capture(name, target = null) {
      if (result.frames.length >= LIMIT.screenshots || performance.now() - captureStart > LIMIT.captureMs) throw new Error('Temporal capture budget exceeded');
      const before = await read(), file = `${String(result.frames.length + 1).padStart(2, '0')}-${name}.jpg`;
      await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 85 });
      const after = await read();
      result.frames.push({ name, file, targetReloadProgress: target, before, after,
        note: 'Image occurred within these real state/time observations; no exact screenshot-time pose is asserted.',
        budgetOk: withinBudget(before.stats) && withinBudget(after.stats) });
    }
    await page.waitForTimeout(300);
    await stage('reload');
    check('actual shot admitted', await command('fire') === true);
    check('actual reload admitted', await command('reload') === true);
    await waitFor(s => s.state.reloading === true, 'reload start');
    for (const target of RELOAD_TARGETS) {
      const row = await waitFor(s => !s.state.reloading || s.state.reloadProgress >= target, `reload ${target}`);
      if (!row.state.reloading) break; // Slow capture is reported; never rewind.
      await capture(`reload-${String(Math.round(target * 100)).padStart(2, '0')}`, target);
    }
    const completion = await waitFor(s => !s.state.reloading, 'reload completion', 5000);
    check('reload completed with refilled magazine', completion.state.mag === 12 && completion.state.id === 'duster', completion);
    await stage('settle'); await page.waitForTimeout(400); await capture('reload-settled');
    await stage('sprint');
    result.actions.push({ action: 'W+Shift down', t: (await read()).t });
    await page.keyboard.down('w'); await page.keyboard.down('Shift');
    await page.waitForTimeout(650); await capture('sprint-held'); await page.waitForTimeout(550);
    await page.keyboard.up('Shift'); await page.keyboard.up('w');
    result.actions.push({ action: 'W+Shift up', t: (await read()).t });
    await stage('settle'); await page.waitForTimeout(400);
    await stage('ads'); result.actions.push({ action: 'right mouse down', t: (await read()).t });
    await page.mouse.down({ button: 'right' });
    const adsOn = await waitFor(s => s.state.ads === true, 'ADS entered'); check('ADS input entered', adsOn.state.ads, adsOn);
    await page.waitForTimeout(350); await capture('ads-settled');
    await page.mouse.up({ button: 'right' }); result.actions.push({ action: 'right mouse up', t: (await read()).t });
    await stage('ads-exit'); const adsOff = await waitFor(s => s.state.ads === false, 'ADS released');
    check('ADS input released', !adsOff.state.ads, adsOff); await page.waitForTimeout(350); await capture('ads-exit');
    check('real menu and Deploy path completed', true);
  } catch (e) { result.fatal = String(e); }
  finally {
    if (page) {
      if (result.fatal && result.frames.length === 0) {
        // One startup diagnostic, within the ten-image budget. It cannot count
        // as a gameplay frame or turn the failed capture into an art pass.
        try {
          result.entryFailure = await page.evaluate(() => {
            const overlay = document.getElementById('start');
            return { t: performance.now(), menu: window.__AA_UI?.menu?.state?.() ?? null,
              panel: window.__AA_UI?.menu?.panel?.() ?? null, matchMode: window.__NTGAME?.mode?.() ?? null,
              overlay: overlay ? { display: getComputedStyle(overlay).display, visibility: getComputedStyle(overlay).visibility, width: overlay.getBoundingClientRect().width, height: overlay.getBoundingClientRect().height } : null,
              buttons: [...document.querySelectorAll('#start button')].map(b => ({ text: b.textContent?.trim(), rects: b.getClientRects().length,
                display: getComputedStyle(b).display, visibility: getComputedStyle(b).visibility, disabled: b.disabled,
                view: b.closest('.aa-view')?.getAttribute('aria-label'), viewClass: b.closest('.aa-view')?.className })) };
          });
          await page.screenshot({ path: join(out, 'entry-failure.jpg'), type: 'jpeg', quality: 85, timeout: 5000 });
          result.entryFailure.image = 'entry-failure.jpg'; result.entryFailure.role = 'startup diagnostic, not gameplay/art evidence';
        } catch (e) { result.entryDiagnosticError = String(e).slice(0, 300); }
      }
      try { await page.keyboard.up('Shift'); await page.keyboard.up('w'); await page.mouse.up({ button: 'right' }); } catch { /* Closing failed page. */ }
      try { result.samples = await page.evaluate(() => {
        const q = window.__ASTRA_TEMPORAL_QA; if (!q) return [];
        cancelAnimationFrame(q.raf); const rows = q.rows; delete window.__ASTRA_TEMPORAL_QA; return rows;
      }); } catch (e) { result.errors.push({ type: 'observer', message: String(e).slice(0, 300) }); }
      await Promise.allSettled(tasks);
    }
    result.captureElapsedMs = captureStart === null ? null : performance.now() - captureStart;
    result.sprint = sprintEvidence(result.samples); if (result.sprint.status === 'OPEN') result.open.push('Sprint motion proof OPEN: normal input did not establish an unobstructed sprint route.');
    result.reloadFrames = result.frames.filter(f => f.name.startsWith('reload-') && f.before.state.reloading);
    if (result.reloadFrames.length < 6) result.open.push(`Temporal reload image coverage OPEN: ${result.reloadFrames.length}/6 frames observed during reload; capture latency may have skipped phases.`);
    check('no console/page/observer errors', result.errors.length === 0, result.errors);
    check('live screenshot render budgets', result.frames.length > 0 && result.frames.every(f => f.budgetOk), result.frames.length);
    check('sampled live render budgets', result.samples.length > 0 && result.samples.every(s => withinBudget(s.stats)), result.samples.length);
    check('bounded sequence and output', result.captureElapsedMs !== null && result.captureElapsedMs <= LIMIT.captureMs && result.frames.length <= LIMIT.screenshots && result.samples.length <= LIMIT.samples,
      { captureElapsedMs: result.captureElapsedMs, frames: result.frames.length, samples: result.samples.length });
    result.pass = !result.fatal && result.checks.every(c => c.pass);
    result.status = result.pass ? (result.open.length ? 'OPEN' : 'PASS') : 'FAIL';
    result.visualAcceptance = 'OPEN: root must inspect actual images and their timestamped sequence.';
    result.finishedAt = new Date().toISOString();
    writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    const cells = result.frames.map(f => `<figure><img src="${f.file}"><figcaption>${f.name} | ${(f.before.t / 1000).toFixed(3)}–${(f.after.t / 1000).toFixed(3)}s | reload ${f.before.state.reloadProgress} → ${f.after.state.reloadProgress}</figcaption></figure>`).join('\n');
    writeFileSync(join(out, 'strip.html'), `<!doctype html><meta charset="utf-8"><title>${mode} actual temporal frames</title><style>body{background:#171b1f;color:#eee;font:14px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}figure{margin:0}img{width:100%}figcaption{padding:6px}</style><h1>${mode}: ${result.status}</h1><p>Actual timestamped screenshots; see result.json for source/bundle identity, input and render evidence. Visual acceptance OPEN.</p><main>${cells}</main>`);
    if (owned) await owned.close();
  }
  console.log(JSON.stringify({ mode, status: result.status, frames: result.frames.length, reloadFrames: result.reloadFrames.length, sprint: result.sprint, out, fatal: result.fatal }));
  return result;
}

if (process.argv.includes('--self-check')) selfCheck();
else {
  const base = process.env.RECOVERY_URL;
  if (!base) throw new Error('Set RECOVERY_URL to the root-owned verified candidate; no default server is assumed.');
  const mode = process.env.ASTRA_HANDS_MODE || 'both';
  if (!['motion', 'rigged', 'both'].includes(mode)) throw new Error('ASTRA_HANDS_MODE must be motion, rigged or both');
  const captures = join(ROOT, 'captures'); mkdirSync(captures, { recursive: true });
  const directory = mkdtempSync(join(captures, `astra-hands-temporal-${new Date().toISOString().replace(/[:.]/g, '-')}-`));
  const source = { checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(),
    trackedDirtyPaths: execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim().split('\n').filter(Boolean) };
  const results = [];
  for (const selected of mode === 'both' ? ['motion', 'rigged'] : [mode]) results.push(await runMode(base, selected, directory, source));
  const hashes = results.map(r => r.identity?.liveEntryBundles?.map(b => b.sha256).sort().join(','));
  const sameLoadedBuild = hashes.every(h => !!h && h === hashes[0]);
  const summary = { output: directory, source, modes: results.map(r => ({ mode: r.mode, status: r.status, open: r.open })),
    sameLoadedBuild, pass: results.every(r => r.pass) && (results.length === 1 || sameLoadedBuild) };
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2)); if (!summary.pass) process.exitCode = 1;
}
