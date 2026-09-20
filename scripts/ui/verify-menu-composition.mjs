// Menu-composition acceptance source for the solo pre-match panel.
// Runs at ROOT (browser/GPU there). Source-only delivery: root executes it.
// Run from the repo root:  RECOVERY_URL=http://127.0.0.1:4192/ QA_TAG=menu-composition node scripts/ui/verify-menu-composition.mjs
// What it proves over scripts/ui/verify-menu-hud-live.mjs:
//  - solo view at 390/1280/1600 px wide: no horizontal overflow past client+1,
//    every loadout/setup child inside the viewport bounds;
//  - every difficulty radio keeps its own accessible name inside a labelled
//    radiogroup (Recruit/Regular/Veteran), roles preserved;
//  - all setup rows + Deploy visible without scrolling at 1600x900 and
//    1280x720; at 390x844 the overlay scrolls Deploy into reach;
//  - a real MP5 + Semtex choice persists across reload, prints ONE pair on the
//    deploy line, and Deploys into an active match whose weaponCmd state reads
//    MP5 and whose ordnance projection reads Semtex (not a HUD rectangle).
//    On a Deploy-active timeout it keeps one bounded mode/match/weapon/
//    ordnance/start-panel snapshot plus a frame, so a missed click stays
//    distinguishable from a stalled match.
// Uses the repo's own launcher (scripts/lib/stock-browser.mjs) and served
// build identity (dist/ over vite preview) like the other live gates.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from '../lib/stock-browser.mjs';

const url = process.env.RECOVERY_URL || 'http://127.0.0.1:4192/';
const out = join(process.cwd(), 'captures', process.env.QA_TAG || 'menu-composition');
mkdirSync(out, { recursive: true });
const result = { url, checks: [], errors: [] };
const check = (name, pass, data) => result.checks.push({ name, pass, data });
const owned = await stockBrowser('menu-composition');
const { page } = owned;
page.on('pageerror', (e) => result.errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') result.errors.push(m.text()); });
// Strict boolean: the gate must read backend-ready, never a truthy transient.
const ready = () => page.waitForFunction(() => window.__NT?.ready === true, null, { timeout: 90000 });
const count = (text, word) => (text.match(new RegExp(word, 'gi')) ?? []).length;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  // A wrapping <label> would lend "Difficulty" to the first radio, so Recruit
  // reads wrong. Each radio keeps its own name; the group stays labelled.
  for (const name of ['Recruit', 'Regular', 'Veteran']) {
    const loc = page.getByRole('radio', { name, exact: true });
    check(`Difficulty radio keeps its own name: ${name}`, (await loc.count()) === 1 && await loc.first().isVisible());
  }
  check('Difficulty group remains labelled',
    (await page.getByRole('radiogroup', { name: /difficulty/i }).count()) === 1);
  for (const [width, height] of [[390, 844], [1280, 720], [1600, 900]]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.evaluate(() => {
      const root = document.querySelector('#start .aa-root');
      const kids = [...document.querySelectorAll(
        '#start .aa-solo-cols, #start .aa-loadout, #start .aa-kits, #start .aa-prims, #start .aa-tacs, #start .aa-solo-setup',
      )].map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; });
      return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, kids };
    });
    check(
      `Solo ${width} no horizontal overflow past client+1`,
      bounds.scrollWidth <= bounds.clientWidth + 1
        && bounds.kids.every((r) => r.left >= -1 && r.right <= width + 1),
      bounds,
    );
    await page.screenshot({ path: join(out, `solo-${width}.png`) });
  }
  for (const [width, height] of [[1600, 900], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    const vis = await page.evaluate((h) => {
      const rows = [...document.querySelectorAll('#start .aa-solo-setup > *')].map((e) => {
        const r = e.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
      const d = document.querySelector('#start .aa-solo .aa-btn.aa-primary')?.getBoundingClientRect() ?? null;
      return { rows, deploy: d ? { top: d.top, bottom: d.bottom } : null };
    }, height);
    check(`All setup rows + Deploy visible without scrolling at ${width}x${height}`,
      !!vis.deploy && vis.deploy.top >= 0 && vis.deploy.bottom <= height
        && vis.rows.length >= 9 && vis.rows.every((r) => r.top >= 0 && r.bottom <= height), vis);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const scrollable = await page.evaluate(() => {
    const root = document.querySelector('#start .aa-root');
    const deploy = document.querySelector('#start .aa-solo .aa-btn.aa-primary');
    if (!root || !deploy) return null;
    const before = deploy.getBoundingClientRect();
    deploy.scrollIntoView({ block: 'nearest' });
    const after = deploy.getBoundingClientRect();
    return {
      scrollHeight: root.scrollHeight, clientHeight: root.clientHeight,
      before: { top: before.top, bottom: before.bottom },
      after: { top: after.top, bottom: after.bottom },
    };
  });
  check('Scroll reaches Deploy at 390x844',
    !!scrollable && scrollable.scrollHeight >= scrollable.clientHeight - 1
      && scrollable.after.top >= 0 && scrollable.after.bottom <= 844, scrollable);
  await page.setViewportSize({ width: 1600, height: 900 });
  const deployBox = await page.evaluate(() => {
    const r = document.querySelector('#start .aa-solo .aa-btn.aa-primary')?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom } : null;
  });
  check('Deploy visible without scrolling at 1600x900', !!deployBox && deployBox.top >= 0 && deployBox.bottom <= 900, deployBox);
  await page.getByRole('button', { name: /^MP5\b/ }).click();
  await page.getByRole('button', { name: /^Semtex\b/ }).click();
  const line = await page.evaluate(() => document.querySelector('.aa-loadline')?.textContent ?? '');
  check('MP5+Semtex prints one pair, not the mirrored name twice',
    line.includes('MP5') && line.includes('Semtex') && count(line, 'MP5') === 1 && count(line, 'Semtex') === 1, { line });
  await page.screenshot({ path: join(out, 'solo-mp5-semtex.png') });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await ready();
  // Genuine visible Play Solo after the reload: pin the post-reload menu as
  // settled before the persistence proof reads it.
  const playSoloAfterReload = page.getByRole('button', { name: 'Play solo', exact: true });
  await playSoloAfterReload.waitFor({ state: 'visible', timeout: 30000 });
  await playSoloAfterReload.click();
  // Causal pin (0158 seam): a resolved click is not proof the handler ran -
  // 0155 resolved the Deploy click yet mode stayed idle with the overlay up
  // and zero errors. Pin the panel switch here so a missed Play Solo click
  // fails fast instead of poisoning every later check.
  try {
    await page.waitForFunction(() => {
      const solo = document.querySelector('#start .aa-solo');
      return solo !== null && !solo.classList.contains('aa-hidden');
    }, null, { timeout: 10000 });
  } catch {
    throw new Error('PlaySolo click had no effect: solo panel still hidden 10 s after a resolved click');
  }
  const persisted = await page.evaluate(() => document.querySelector('.aa-loadline')?.textContent ?? '');
  check('MP5+Semtex survives a reload from the store',
    persisted.includes('MP5') && persisted.includes('Semtex'), { persisted });
  // Selected-path proof, not just line text: the reloaded store must still
  // press the MP5 + Semtex buttons the next life reads.
  check('MP5 stays pressed after reload',
    await page.getByRole('button', { name: /^MP5\b/ }).getAttribute('aria-pressed') === 'true');
  check('Semtex stays pressed after reload',
    await page.getByRole('button', { name: /^Semtex\b/ }).getAttribute('aria-pressed') === 'true');
  await page.keyboard.press('Tab');
  check('Keyboard focus stays visible on menu controls',
    await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
  const deployAfterReload = page.getByRole('button', { name: /deploy/i });
  await deployAfterReload.waitFor({ state: 'visible', timeout: 30000 });
  await deployAfterReload.click();
  // Causal pin (0158 seam): 0155 resolved this click yet mode stayed idle,
  // the overlay stayed flex and errors stayed empty, so startSolo() never
  // ran - the click never reached the Deploy listener. A product begin()
  // always hides the overlay via match-start/match-ready, and a throw always
  // surfaces as a pageerror, so idle+flex+silent is a missed click, not a
  // stalled match. Assert the click HAD an effect within a short bound and
  // keep pointer-level evidence when it did not. The 45 s active gate below
  // is untouched.
  const clickBox = await deployAfterReload.boundingBox();
  try {
    await page.waitForFunction(() => {
      try { return window.__NTGAME.mode() !== 'idle'; }
      catch { return false; }
    }, null, { timeout: 5000 });
  } catch {
    const miss = await page.evaluate((box) => {
      const el = document.querySelector('#start .aa-solo .aa-btn.aa-primary');
      const r = el?.getBoundingClientRect();
      const cx = box !== null ? box.x + box.width / 2 : (r ? r.left + r.width / 2 : null);
      const cy = box !== null ? box.y + box.height / 2 : (r ? r.top + r.height / 2 : null);
      const top = cx !== null && cy !== null ? document.elementFromPoint(cx, cy) : null;
      const ae = document.activeElement;
      const label = (n) => n ? ((n.getAttribute('aria-label') ?? n.textContent?.slice(0, 60) ?? n.tagName) + ' <' + n.tagName.toLowerCase() + '>') : null;
      return {
        clickCenter: cx !== null && cy !== null ? { x: Math.round(cx), y: Math.round(cy) } : null,
        elementFromPoint: label(top),
        deployBox: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) } : null,
        activeElement: label(ae),
        mode: (() => { try { return window.__NTGAME.mode(); } catch (e) { return String((e && e.message) || e); } })(),
        overlayDisplay: (() => { const s = document.querySelector('#start'); return s ? getComputedStyle(s).display : 'missing'; })(),
      };
    }, clickBox);
    check('Deploy click reaches its handler (mode leaves idle within 5 s)', false, miss);
    throw new Error('Deploy click had no effect: mode still idle 5 s after a resolved click');
  }
  // snapshot() throws '[session] no match yet - call begin() first' until the
  // Deploy constructs the match; a throw here is the expected transient, not a
  // failure, so the poll catches it and keeps waiting for 'active'.
  try {
    await page.waitForFunction(() => {
      try { return window.__NTGAME.snapshot().match.phase === 'active'; }
      catch { return false; }
    }, null, { timeout: 45000 });
  } catch (activeTimeout) {
    // 0117 timed out here with 14 passes and zero errors: missed click vs
    // stalled match was indistinguishable. Keep one bounded snapshot of
    // mode/match/weapon/ordnance/start-panel plus a frame, then rethrow.
    const diag = await page.evaluate(() => {
      const trunc = (s, n = 300) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '…[truncated]' : s);
      const j = (v, n = 800) => {
        try {
          const s = JSON.stringify(v);
          return s && s.length > n ? s.slice(0, n) + '…[truncated]' : JSON.parse(s);
        } catch { return trunc(String(v), n); }
      };
      const snap = (() => {
        try {
          const s = window.__NTGAME.snapshot();
          return { phase: s?.match?.phase ?? null, mode: s?.match?.mode ?? null };
        } catch (e) { return { error: trunc(String((e && e.message) || e), 200) }; }
      })();
      const mode = (() => {
        try { return window.__NTGAME.mode(); }
        catch (e) { return trunc(String((e && e.message) || e), 200); }
      })();
      const weapon = (() => {
        try { return j(window.__NT.weaponCmd('state')); }
        catch (e) { return { error: trunc(String((e && e.message) || e), 200) }; }
      })();
      const ord = (() => {
        try {
          const o = window.__NT.ordnance();
          return j({ tacticalId: o?.hand?.tacticalId ?? o?.self?.tacticalId ?? o?.tacticalId ?? null, counts: o?.counts ?? null });
        } catch (e) { return { error: trunc(String((e && e.message) || e), 200) }; }
      })();
      const startEl = document.querySelector('#start');
      const deployEl = document.querySelector('#start .aa-solo .aa-btn.aa-primary');
      const dr = deployEl?.getBoundingClientRect();
      return {
        snap, mode, weapon, ord,
        start: {
          display: startEl ? getComputedStyle(startEl).display : 'missing',
          soloHidden: document.querySelector('#start .aa-solo')?.classList.contains('aa-hidden') ?? null,
          deployVisible: deployEl ? dr.width > 0 && dr.height > 0 : false,
          deployRect: dr ? { top: Math.round(dr.top), bottom: Math.round(dr.bottom) } : null,
          loadline: trunc(document.querySelector('.aa-loadline')?.textContent ?? '', 200),
        },
      };
    });
    await page.screenshot({ path: join(out, 'deploy-timeout.png') });
    check('Deploy reaches active (bounded diag on timeout)', false, diag);
    throw activeTimeout;
  }
  const live = await page.evaluate(() => {
    let weapon = null;
    let ord = null;
    try { weapon = window.__NT.weaponCmd('state'); } catch { weapon = null; }
    try { ord = window.__NT.ordnance(); } catch { ord = null; }
    return { weapon, ord };
  });
  const wid = String(live.weapon?.id ?? live.weapon?.name ?? '');
  const tacId = String(live.ord?.hand?.tacticalId ?? live.ord?.self?.tacticalId ?? live.ord?.tacticalId ?? '');
  check('Deployed primary is the chosen MP5 via weaponCmd',
    wid.toLowerCase() === 'mp5' || wid.toLowerCase().includes('mp5'), { wid, weapon: live.weapon });
  check('Deployed tactical is the chosen Semtex via ordnance API',
    tacId.toLowerCase() === 'semtex' || tacId.toLowerCase().includes('semtex'), { tacId, ord: live.ord });
  const hud = await page.evaluate(() => {
    const seen = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return { weapon: seen('.hud-weapon'), ammo: seen('.hud-ammo'), health: seen('.hud-health') };
  });
  check('Deployed MP5+Semtex loadout reaches an active HUD', hud.weapon && hud.ammo && hud.health, hud);
  await page.screenshot({ path: join(out, 'play-mp5-semtex.png') });
  check('No browser errors', result.errors.length === 0, result.errors);
} catch (error) { result.fatal = String(error); process.exitCode = 1; }
finally { writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2)); await owned.close(); }
console.log(JSON.stringify(result, null, 2));
if (result.fatal || result.checks.some((c) => !c.pass)) process.exitCode = 1;
