/**
 * capture-mortar-live — blast-mortar LIVE proof through the REAL game loop.
 *
 * REPAIR PASS (glm-mortar-qa-repair-0016, 2026-09-20) over the Muse draft.
 * Every field/API below was read off the ROOT tree at 5fd4058 (mortar source
 * integrated in 45ae17b) — `src/game/session-types.ts`, `session.ts`,
 * `session-log.ts`, `killstreaks/{catalog,runtime}.ts`,
 * `killstreaks/effects/{mortar,mortar-view}.ts`, `src/main.ts` QA surface,
 * `src/ui/{menus,solo-setup,menu-views}.ts`, and the accepted harnesses
 * `scripts/ui/verify-menu-hud-live.mjs`, `scripts/soak.mjs`,
 * `scripts/_verify-semtex-live.mjs`. Repairs:
 *
 *   1. `const URL` shadowed the global URL constructor and `new URL(r, URL)`
 *      threw before any browser work — renamed to `BASE_URL`.
 *   2. The byte-equality check hashed only JS + index.html locally but
 *      compared EVERY asset ref the served HTML names (including CSS) —
 *      a guaranteed failure. Now the expected map is built from exactly the
 *      refs the server names, JS and CSS alike, read from the same paths in
 *      the local --dist. Optional `--expect-js-sha` pins the served bundle.
 *   3. A synthetic `#start.click()` starts the DEFAULT match (menus.ts
 *      one-click contract) and never deploys the configured one. The real
 *      player path is followed instead: click "Play solo", drive the solo
 *      panel's own controls (aria-labelled Mode / Kill limit / Team balance /
 *      Recruit radio / Bots arrows — each calls the documented
 *      `LocalMatch.configure()` seam via the panel's onChange), then click
 *      "Deploy" and require `__NTGAME.snapshot().match.phase === 'active'`
 *      (the accepted pattern in scripts/ui/verify-menu-hud-live.mjs).
 *      `setup()` is read back after deploy and must match the low-challenge
 *      fixture, else the run fails as misconfigured.
 *   4. Renderer stats were sampled at an arbitrary wall-clock moment where
 *      the per-frame `renderer.info` reset can read zero. Budgets are now
 *      measured with `scripts/lib/measure-frame.mjs` (`measureFrame` +
 *      `sceneWasMeasured`): one explicit render inside a fresh rAF, deltas
 *      read synchronously. A non-scene read is MEASURED NOTHING and fails.
 *   5. `snapOf()` returns a flat projection (`phase`), but the frame rows
 *      re-read `s.match.phase` off that projection — TypeError, and the
 *      Task report's "phase not match" note. Observations now take ONE
 *      read-only evaluate that returns verified `SessionSnapshot` fields
 *      only: `at`, `match.phase`, `actors[{id,team,bot,hp,alive,kills,
 *      deaths,score}]`, `stats` (admission counters), `counters()`,
 *      `log()`, `bots()` bodies, `groundY`, `los`. NO `slots`, `life` or
 *      `streak` reads — SessionActor does not carry them (verified).
 *
 * Earn state is read from the host LEDGER, the documented instrument
 * (`session-log.ts`): the line `streak-earned you blast-mortar charges=N`
 * plus the `counters().streakEarned` tally. blast-mortar costs 8 kills
 * (catalog.ts) in ONE ladder cycle; a death resets the cycle (runtime.ts
 * recordDeath) but banked charges persist, so the loop simply keeps going.
 * Own-death detection is the `humanDeaths` tally delta.
 *
 * Activation goes through the ACTUAL session API `__NTGAME.pressStreak(slot)`
 * — the exact path the Digit3..6 keys take (main.ts). The default loadout
 * (catalog.ts DEFAULT_STREAK_LOADOUT, fresh profile) holds blast-mortar at
 * slot 4; slots are not exposed on the client snapshot, so slot 4 is
 * verified by CONSEQUENCE: the ledger line must name `streak-activated you
 * blast-mortar`, a `streak-activated you <other>` line is a slot-mapping
 * FAIL, and `__NT.ordnance().mortar.telegraphs` must actually appear. The
 * mortar anchor is the actor's own origin (host.ts builds `anchor: null`),
 * so the tube lands on the shooter: staging teleports the player to the open
 * street and looks down — labelled QA staging, never claimed as a walk.
 *
 * Bounded: OVERALL 240 s, earn phase 150 s, every wait capped, cleanup in
 * `finally` (owned stock Chrome only — no owner process is touched). If the
 * 8-kill earn proves infeasible the run exits BLOCKED naming the exact step;
 * `--allow-canary-visual-only` writes an explicitly `synthetic visual-only`
 * observation that claims NO admission. Real proof is the default.
 *
 * WHAT THIS NEVER DOES: no injected bus events, no host-state or ledger
 * writes, no debug grant, no product-code edits. Telegraph-first and damage
 * co-location stay CPU-proven (`_verify-mortar-visible`); this run adds
 * LIVE visible honesty: ring-before-impact order, dust cleanup expiry.
 *
 *   node scripts/capture-mortar-live.mjs --url http://127.0.0.1:4199/ \
 *     --tag mortar-live-repair-4199 \
 *     --dist <root>/dist-review-0003 \
 *     --expect-js-sha 7bc295a49b5390a1780afc16f9f4b6cb54a877bb7bfaca2bb5db02934ff3afd4
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'captures');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const BASE_URL = opt('url', 'http://127.0.0.1:4199/');
const TAG = opt('tag', 'mortar-live');
const DIST = resolve(opt('dist', join(ROOT, 'dist')));
const EXPECT_JS_SHA = opt('expect-js-sha', null);
const CANARY = argv.includes('--allow-canary-visual-only');

const OVERALL_MS = 240_000;
const EARN_MS = 150_000;
const CALL_BUDGET = 1200;
const TRI_BUDGET = 900_000;
const EARN_KILLS = 8;
const MORTAR_ID = 'blast-mortar';
const MORTAR_SLOT = 4; // DEFAULT_STREAK_LOADOUT index 3 -> slot 4 (Digit6); verified by consequence below
/** Open street anchor (same anchor the accepted _verify-semtex-live.mjs stages). */
const OPEN = { x: -6.0, z: 0.0, yaw: -Math.PI / 2, pitch: -1.15 };

const T0 = Date.now();
const deadline = T0 + OVERALL_MS;
const left = () => deadline - Date.now();
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const commands = [];
const note = (kind, args, result) => {
  if (commands.length < 400) commands.push({ t: +((Date.now() - T0) / 1000).toFixed(1), kind, args, result });
};
const fail = (m) => { fails.push(m); console.log('  FAIL: ' + m); };
const out = (n) => join(OUT, TAG + '-' + n);

let closeBrowser = async () => {};

try {
  mkdirSync(OUT, { recursive: true });

  const owned = await stockBrowser('mortar-live');
  const page = owned.page;
  closeBrowser = owned.close;
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 240)));

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 120_000 });

  // ---- identity: real WebGPU + served bytes == local dist (JS and CSS) ----
  // navigator.gpu is API existence only, not backend proof: the actual renderer
  // is __NT_BACKEND.actual + __NTPOST.backend (renderer.ts / post.ts / world.ts).
  const gpuApi = await page.evaluate(() => typeof navigator.gpu !== 'undefined');
  const backend = await page.evaluate(() => ({
    renderer: window.__NT_BACKEND?.actual ?? null,
    post: window.__NTPOST?.backend ?? null,
  }));
  console.log('[mortar-live] ' + BASE_URL + '  tag=' + TAG + '  dist=' + DIST +
    '  gpuApi=' + gpuApi + ' backend=' + JSON.stringify(backend));
  if (!gpuApi) fail('no navigator.gpu API - this is the fallback path, not the player path');
  if (backend.renderer !== 'webgpu' || backend.post !== 'webgpu') {
    fail('not the actual WebGPU renderer+post (got ' + JSON.stringify(backend) + ') - fallback refused');
  }

  const servedHtml = await (await fetch(BASE_URL)).text();
  // Vite base './' emits ./assets/…; absolute builds emit /assets/…. Both normalize to assets/… for the dist join + fetch; byte equality + --expect-js-sha pin unchanged.
  const refs = [...servedHtml.matchAll(/(?:src|href)="(?:\.\/)?(\/?assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1].replace(/^\//, ''));
  if (!refs.length) fail('served HTML names no assets/*.js|css - cannot prove served==local');
  const servedShas = { 'index.html': sha(Buffer.from(servedHtml, 'utf8')) };
  for (const r of refs) {
    servedShas[r] = sha(Buffer.from(await (await fetch(new URL(r, BASE_URL))).arrayBuffer()));
  }
  let servedJsPath = refs.find((r) => r.endsWith('.js')) ?? null;
  for (const [r, h] of Object.entries(servedShas)) {
    let local;
    try { local = sha(readFileSync(join(DIST, r))); } catch { fail('local dist missing served asset: ' + r); continue; }
    if (local !== h) fail('served!=local: ' + r + ' (stale server photograph refused)');
  }
  if (EXPECT_JS_SHA && servedJsPath) {
    if (servedShas[servedJsPath] !== EXPECT_JS_SHA) fail('served JS sha != pinned --expect-js-sha (' + servedJsPath + ')');
    else console.log('  served JS ' + servedJsPath + ' sha matches pinned candidate');
  }

  // ---- the REAL menu path: Play solo -> panel controls -> Deploy ---------
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  note('menu', { click: 'Play solo' }, 'panel open');
  await page.selectOption('[aria-label="Mode"]', 'tdm');
  await page.selectOption('[aria-label="Kill limit"]', 'none');      // scoreLimit null: no cap mid-earn
  await page.selectOption('[aria-label="Team balance"]', 'enemies'); // every bot hostile
  await page.getByRole('radio').filter({ hasText: /^Recruit$/ }).click(); // DOM-0055: wrapped <label> misnames first radio; visible text is the true selector (count 1)
  try {
    const bots = page.locator('input[aria-label="Bots"]');
    await bots.focus();
    await page.keyboard.press('ArrowLeft'); // 5 -> 4
    await page.keyboard.press('ArrowLeft'); // 4 -> 3
    note('menu', { bots: 'arrows x2' }, 'ok');
  } catch (e) { note('menu', { bots: 'arrows' }, 'kept panel default: ' + String(e).slice(0, 80)); }
  await page.screenshot({ path: out('menu-solo-panel.png') });
  await page.getByRole('button', { name: /deploy/i }).click();
  note('menu', { click: 'Deploy' }, 'requested');
  const active = await page
    .waitForFunction(() => {
      try { return window.__NTGAME?.snapshot?.().match.phase === 'active'; } catch { return false; }
    }, null, { timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  if (!active) throw new Error('match never reached active after the real Deploy click');
  const setupReadback = await page.evaluate(() => window.__NTGAME.setup());
  note('configure', setupReadback, 'panel-applied (read back via __NTGAME.setup())');
  const fixture = setupReadback;
  if (setupReadback.mode !== 'tdm' || setupReadback.difficulty !== 'recruit' ||
      setupReadback.teams !== 'enemies' || setupReadback.scoreLimit !== null) {
    fail('misconfigured session: ' + JSON.stringify(setupReadback) + ' - not the low-challenge fixture');
  }
  console.log('  deployed: ' + JSON.stringify(setupReadback));

  // ---- ONE read-only observation evaluate (verified SessionSnapshot fields)
  const observe = () => page.evaluate((id) => {
    const g = window.__NTGAME;
    const s = g.snapshot();
    const you = s.actors.find((a) => a.id === id) ?? null;
    return {
      at: Math.round(s.at),
      phase: s.match.phase,
      endsAt: s.match.endsAt,
      you: you && { id: you.id, team: you.team, hp: you.hp, alive: you.alive, kills: you.kills, deaths: you.deaths, score: you.score },
      actors: s.actors.map((a) => ({ id: a.id, team: a.team, alive: a.alive })),
      bots: g.bots().map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z, alive: b.alive })),
      counters: g.counters(),
      logTail: g.log().slice(-30),
    };
  }, 'you');
  const mortarOf = () => page.evaluate(() => window.__NT.ordnance().mortar);
  const earnedLine = (s) => s.logTail.filter((l) => l.includes('streak-earned you ' + MORTAR_ID));

  // ---- EARN: 8 admitted kills with real fire through host admission ------
  const earnT = Date.now();
  let earned = false;
  let restarts = 0;
  let lastDeaths = -1;
  let dryStreak = 0;
  const eye = await page.evaluate(() => window.__NT.stats().eyeHeight);
  while (!earned && Date.now() - earnT < EARN_MS && left() > 75_000) {
    const s = await observe();
    if (lastDeaths < 0) lastDeaths = s.counters.humanDeaths ?? 0;
    if ((s.counters.humanDeaths ?? 0) > lastDeaths) {
      restarts += (s.counters.humanDeaths ?? 0) - lastDeaths;
      lastDeaths = s.counters.humanDeaths ?? 0;
      console.log('  died mid-earn (restart ' + restarts + '; ladder cycle resets, banked charges persist per runtime.ts)');
    }
    if (earnedLine(s).length >= 1) { earned = true; break; }

    // nearest alive hostile bot, from the read-only snapshot teams + bodies
    const teams = new Map(s.actors.map((a) => [a.id, a.team]));
    const me = s.you;
    if (!me || !me.alive) { await sleep(400); continue; }
    const foes = s.bots
      .filter((b) => b.alive && teams.get(b.id) !== me.team)
      .map((b) => ({ ...b, d: Math.hypot(b.x - 0, b.z - 0) }))
      .sort((a, b) => a.d - b.d);
    if (!foes.length) { await sleep(400); continue; }

    let engaged = false;
    for (const foe of foes.slice(0, 3)) {
      const stand = await page.evaluate(([gx, gz]) => {
        const g = window.__NTGAME;
        const L = Math.hypot(gx, gz) || 1;
        const px = gx + (-gx / L) * 8, pz = gz + (-gz / L) * 8;
        return { x: px, z: pz, gy: g.groundY(px, pz) };
      }, [foe.x, foe.z]);
      const dx = foe.x - stand.x, dz = foe.z - stand.z;
      const dist = Math.hypot(dx, dz) || 1;
      const chestY = foe.y + 0.9;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(chestY - (stand.gy + eye), dist);
      const hasLos = await page.evaluate(([ax, ay, az, bx, by, bz]) => window.__NTGAME.los(ax, ay, az, bx, by, bz),
        [stand.x, stand.gy + eye, stand.z, foe.x, chestY, foe.z]);
      if (!hasLos) continue;
      await page.evaluate((t) => window.__NT.teleport(t.x, t.gy, t.z, t.yaw, t.pitch), { ...stand, yaw, pitch });
      note('teleport', { x: +stand.x.toFixed(1), z: +stand.z.toFixed(1), to: foe.id, d: +dist.toFixed(1) }, 'staged-8m');
      await sleep(350);
      engaged = true;
      for (let p = 0; p < 12 && left() > 70_000; p++) {
        const r = await page.evaluate(() => {
          const q = window.__NT;
          const st = q.weaponCmd('state');
          if (st.reloading) return { why: 'reloading' };
          if (st.cool > 0) return { why: 'cool' };
          if (st.mag <= 0) {
            if (st.reserve > 0) { q.weaponCmd('reload'); return { why: 'reload' }; }
            return { why: 'dry-no-reserve' };
          }
          return { why: 'pull', fired: !!q.weaponCmd('fire') };
        });
        note('fire', {}, r.why + ':' + (r.fired ?? ''));
        if (r.why === 'dry-no-reserve') { dryStreak++; break; }
        dryStreak = 0;
        await sleep(r.why === 'pull' ? 150 : 250);
        const chk = await observe();
        if (earnedLine(chk).length >= 1) { earned = true; break; }
        if (!chk.you || !chk.you.alive) break;
        if (chk.you.kills > 0 && chk.bots.every((b) => !b.alive)) break; // wave cleared; re-poll
      }
      if (earned) break;
    }
    if (!engaged) await sleep(500);
    if (dryStreak >= 2) { note('earn', {}, 'dry on two engagements - moving on (pickups are walk-over)'); dryStreak = 0; }
  }
  const endS = await observe();
  const earnLines = earnedLine(endS);
  console.log('  earn: you.kills=' + endS.you?.kills + ' streakEarned=' + endS.counters.streakEarned +
    ' restarts=' + restarts + ' ledger=' + JSON.stringify(earnLines));
  if (!earned) {
    const step = 'earn: no ' + MORTAR_ID + ' charge in the ledger after ' + Math.round((Date.now() - earnT) / 1000) +
      's (kills=' + endS.you?.kills + ', streakEarned=' + endS.counters.streakEarned + ', restarts=' + restarts + ')';
    if (CANARY) {
      await page.screenshot({ path: out('canary.png') });
      writeFileSync(out('json'), JSON.stringify({
        tag: TAG, url: BASE_URL, outcome: 'canary-visual-only', admission: false, blockedStep: step,
        fixture, commands, counters: endS.counters,
        note: 'SYNTHETIC VISUAL-ONLY: observed live match, no blast-mortar charge earned, no streak pressed, claims nothing.',
      }, null, 2));
      console.log('[mortar-live] CANARY (visual-only, no admission claimed): ' + step);
      throw { __canary: true };
    }
    fail('BLOCKED: ' + step);
    throw new Error('earn infeasible; exact blocked step recorded (re-run with --allow-canary-visual-only for a labelled visual-only observation)');
  }

  // ---- STAGE + ACTIVATE through the real session API ---------------------
  const staged = await observe();
  if (!staged.you?.alive) fail('human dead at press time - wait for redeploy and re-run');
  const gy = await page.evaluate(([x, z]) => window.__NTGAME.groundY(x, z), [OPEN.x, OPEN.z]);
  await page.evaluate((t) => window.__NT.teleport(t.x, t.gy, t.z, t.yaw, t.pitch),
    { x: OPEN.x, z: OPEN.z, gy, yaw: OPEN.yaw, pitch: OPEN.pitch });
  note('teleport', { x: OPEN.x, z: OPEN.z, yaw: OPEN.yaw, pitch: OPEN.pitch }, 'QA staging: frame own disc (mortar anchors on shooter origin)');
  await sleep(500);
  const beforeDeaths = (await observe()).counters.humanDeaths ?? 0;
  const beforeMortar = await mortarOf();
  await page.evaluate((slot) => window.__NTGAME.pressStreak(slot), MORTAR_SLOT);
  note('pressStreak', { slot: MORTAR_SLOT }, 'real-session press (Digit6 path)');

  // consequence checks: ledger line names blast-mortar, telegraphs appear
  let pressLog = null;
  for (let i = 0; i < 20 && left() > 55_000; i++) {
    const s = await observe();
    const act = s.logTail.filter((l) => l.includes('streak-activated you '));
    const denied = s.logTail.filter((l) => l.includes('streak-denied you slot' + MORTAR_SLOT));
    if (act.length) { pressLog = { activated: act, denied }; break; }
    if (denied.length) { pressLog = { activated: act, denied }; break; }
    await sleep(150);
  }
  const activatedLine = (pressLog?.activated ?? []).find((l) => l.includes(MORTAR_ID));
  const wrongStreak = (pressLog?.activated ?? []).filter((l) => !l.includes(MORTAR_ID));
  if (wrongStreak.length) fail('slot ' + MORTAR_SLOT + ' activated a DIFFERENT streak (loadout drift): ' + wrongStreak.join(' | '));
  if (!activatedLine) fail('no streak-activated ledger line for ' + MORTAR_ID + ' after a real press' +
    (pressLog?.denied.length ? ' (denied: ' + pressLog.denied.join(' | ') + ')' : ' (silence)'));
  else console.log('  press: ' + activatedLine);

  // ---- RING frame: warning disc BEFORE any impact ------------------------
  let tele = null;
  for (let i = 0; i < 30 && left() > 45_000; i++) {
    const m = await mortarOf();
    if (m.telegraphs.length >= 1) { tele = m; break; }
    await sleep(100);
  }
  const shotRing = (name) => page.screenshot({ path: out(name + '.png') });
  const budgetGate = async (label) => {
    const m = await measureFrame(page);
    if (!sceneWasMeasured(m)) fail('MEASURED NOTHING at ' + label + ': ' + JSON.stringify(m));
    else console.log('  frame ' + label + ': calls=' + m.calls + ' tris=' + m.triangles + ' programs=' + m.programs);
    if (m.calls > CALL_BUDGET || m.triangles > TRI_BUDGET) {
      console.log('  WARN over budget at ' + label + ': calls=' + m.calls + ' tris=' + m.triangles + ' (warning, not a gate)');
    }
    return m;
  };
  if (!tele) fail('no host-authoritative warning disc ever appeared after an admitted press');
  else {
    if (tele.impactSeq !== beforeMortar.impactSeq) fail('first telegraph sighting already had impacts - ring did NOT precede impact');
    const s = await observe();
    if (s.phase !== 'active') fail('telegraph frame in phase ' + s.phase + ' (wrong phase)');
    if (s.you && s.you.alive !== true) fail('telegraph frame shot while photographer dead (staged corpse framing)');
    if ((s.counters.humanDeaths ?? 0) !== beforeDeaths) fail('photographer died and respawned between press and ring frame (self-respawn)');
    await shotRing('mortar-ring');
    await budgetGate('mortar-ring');
    console.log('  ring: telegraphs=' + JSON.stringify(tele.telegraphs) + ' impactSeq=' + tele.impactSeq);
  }

  // ---- DETONATION frame: first impact + flash/dust -----------------------
  let sawImpact = false;
  for (let i = 0; i < 70 && left() > 30_000; i++) {
    const m = await mortarOf();
    if (m.impactSeq > (beforeMortar.impactSeq ?? 0)) { sawImpact = true; break; }
    await sleep(200);
  }
  if (!sawImpact) fail('no impacts ever reached the projection after the warning disc');
  else {
    await sleep(120); // inside the 350 ms flash window
    const s = await observe();
    if (s.phase !== 'active') fail('impact frame shot in phase ' + s.phase);
    await shotRing('mortar-detonation');
    await budgetGate('mortar-detonation');
  }

  // ---- CLEANUP: disc retired, dust expired -------------------------------
  let cleanDisc = false;
  for (let i = 0; i < 60 && left() > 12_000; i++) {
    const m = await mortarOf();
    if (m.telegraphs.length === 0) { cleanDisc = true; break; }
    await sleep(400);
  }
  if (!cleanDisc) fail('warning disc never retired (no streak-ended/expiry cleanup)');
  let cleanDust = false;
  for (let i = 0; i < 40 && left() > 6_000; i++) {
    const m = await mortarOf();
    if (m.impacts === 0) { cleanDust = true; break; }
    await sleep(300);
  }
  if (!cleanDust) console.log('  note: impact records still held at exit (view cap keeps 8; dust window 4 s each)');
  await shotRing('mortar-cleanup');
  const cleanFrame = await mortarOf();
  const cleanObs = await observe();
  if (cleanFrame.telegraphs.length !== 0) fail('cleanup frame still shows a warning disc');

  if (errors.some((e) => e.startsWith('PAGEERROR'))) fail('page threw: ' + errors.find((e) => e.startsWith('PAGEERROR')));

  mkdirSync(OUT, { recursive: true });
  writeFileSync(out('json'), JSON.stringify({
    tag: TAG, url: BASE_URL, dist: DIST, servedShas, servedJsPath,
    outcome: fails.length ? 'refuted' : 'holds', admission: true,
    webgpu: gpu, servedEqualsLocal: !fails.some((f) => f.startsWith('served!=local')),
    fixture, restarts, earnKillsYou: endS.you?.kills, ledgerEarn: earnLines,
    mortarSlot: MORTAR_SLOT, pressLedger: pressLog,
    telegraphs: tele ? tele.telegraphs : null,
    ringBeforeImpact: tele ? tele.impactSeq === beforeMortar.impactSeq : null,
    cleanup: { discRetired: cleanDisc, dustExpired: cleanDust, counts: cleanFrame.counts },
    counters: cleanObs.counters, logTail: cleanObs.logTail,
    mortarLines: cleanFrame.lines ?? null,
    errors: errors.slice(0, 8),
    stagedCamera: 'teleport-staged shooter onto own disc anchor + pitch-down framing (QA-only, not player walks)',
    audioClaim: 'none (no capture attempted)',
    repairs: ['url-shadow', 'hash-js+css', 'real-menu-deploy', 'measure-frame-budget', 'projection-phase'],
    fails,
  }, null, 2));
  if (fails.length) { console.log('[mortar-live] REFUTED:\n  - ' + fails.join('\n  - ')); process.exitCode = 1; }
  else console.log('[mortar-live] HOLDS: blast-mortar earned+activated via real seams, ring-before-impact photographed, dust retired');
} catch (e) {
  if (e && e.__canary) { process.exitCode = 0; }
  else { console.log('[mortar-live] ' + String((e && e.stack) || e)); process.exitCode = 1; }
} finally {
  try { await closeBrowser(); } catch { /* already gone; proc-guard reaps the tree */ }
}
