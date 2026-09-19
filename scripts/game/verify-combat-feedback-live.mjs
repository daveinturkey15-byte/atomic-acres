/**
 * Nuketown 2025 — LIVE actual-game browser proof for floating combat text.
 *
 * Sole-owner lane file: scripts/game/verify-combat-feedback-live.mjs
 * (companion doc: docs/combat-browser-proof.md). No game source, no existing
 * gate, no other worktree touched. No recursive delegation. No commit.
 *
 * What this proves (through the REAL game loop, never fixtures):
 *   S1 solo admitted shot -> positive finite bounded popup near victim.
 *   S2 host fires at guest -> guest HP drops AND host damage counter moves
 *      AND shooter-only popup on host, zero new outgoing popups on guest.
 *   S3 guest fires at host -> mirror of S2.
 *   S4 body/head/lethal styling follows admitted evidence; lethal asserted
 *      only when a REAL kill happened (alive->dead + kills+1).
 *   S5 leave clears visible numbers (resetPresentation/bindClient(null) path).
 *   S6 no new popup from remote/nonlocal attacks (victim-side silence).
 * Always: WebGPU backend, no stale build, <=24 active popups, no page/console
 * errors, screenshots of real combat frames, bounded <=150 s overall.
 *
 * What this is NOT: fixture/replay injection is never claimed as match
 * behavior. The 900 ms popups are retained with a bounded MutationObserver
 * plus synchronous DOM sweeps; the game is never modified and no lifetime
 * is extended.
 *
 * Patterns: scripts/lib/stock-browser.mjs (reused IN PLACE — lane copy
 * already exists and is functionally identical to root (CRLF/LF-only;
 * sha differs, diff shows no content change), so nothing was copied; see
 * doc) and scripts/_verify-net-refinement.mjs (two stock Chromes, real
 * Multiplayer UI, real weaponCmd('fire'), __NTGAME snapshots/counters).
 *
 * Root run (candidate 4192 from root dist-next, relay 4310 — never 4188):
 *   AA_PREVIEW_PORT=4192 node scripts/game/verify-combat-feedback-live.mjs \
 *     --url http://127.0.0.1:4192/ --dist dist-next --signal-port 4310 --tag cfb-live
 * (--dist also accepts NT_DIST; default dist-next. 4191 accepted K untouched.)
 *
 * Worker validation (NO browser launch here): node --check this file.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stockBrowser } from '../lib/stock-browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
 const DIST_DIR = opt('dist', process.env.NT_DIST ?? 'dist-next');
const CANDIDATE = opt('url', process.env.NT_URL ?? process.env.CANDIDATE_URL ?? 'http://127.0.0.1:4192/');
const SIGNAL_URL = opt('signal-url', process.env.SIGNAL_URL ?? ('http://127.0.0.1:' + opt('signal-port', '4310')));
const TAG = String(opt('tag', 'cfb-live') + '-' + Date.now());
const OUT = join(ROOT, 'captures', 'cfb-live');
const OVERALL_MS = 150_000;
const T0 = Date.now();
const left = () => OVERALL_MS - (Date.now() - T0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { candidate: CANDIDATE, signalUrl: SIGNAL_URL, tag: TAG, steps: [], open: [], errors: {}, shots: {}, resultPath: join(OUT, TAG + '-result.json') };
let code = 0;
const log = [];
function say(line) { const t = '[cfb-live] ' + line; console.log(t); log.push(t); }
function step(name, ok, detail) {
  report.steps.push({ name, state: ok ? 'VERIFIED' : 'FAIL', detail });
  say((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) code = 1;
}
function open(name, detail) {
  // A missing actual scenario stays OPEN and non-green: it sets the exit code.
  report.open.push({ name, detail });
  report.steps.push({ name, state: 'OPEN', detail });
  say('OPEN ' + name + (detail ? '  ' + detail : ''));
  code = 1;
}
function cacheBusted(url) { const u = new URL(url); u.searchParams.set('qa', TAG); return u.href; }
function pageErrors(peer) {
  const errors = [];
  peer.page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
  peer.page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 240)));
  return errors;
}
async function waitUntil(fn, timeoutMs, intervalMs = 100) {
  const end = Date.now() + Math.min(timeoutMs, Math.max(0, left()));
  let last = null;
  while (Date.now() < end) { try { last = await fn(); } catch { last = null; } if (last) return last; await sleep(intervalMs); }
  return last;
}
function distAsset(dir = DIST_DIR) {
  try {
    const html = readFileSync(join(ROOT, dir, 'index.html'), 'utf8');
    const m = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    const asset = m ? m[1] : null;
    let mtime = 0;
    try { mtime = statSync(join(ROOT, dir, 'assets')).mtimeMs; } catch { /* dir absent -> reported below */ }
    let bytes = -1, sha256 = null;
    try {
      if (asset !== null) {
        const buf = readFileSync(join(ROOT, dir, 'assets', asset));
        bytes = buf.length;
        sha256 = createHash('sha256').update(buf).digest('hex');
      }
    } catch { bytes = -1; sha256 = null; }
    return { dir, asset, mtime, bytes, sha256, exists: asset !== null && existsSync(join(ROOT, dir, 'assets', asset)) };
  } catch { return { dir, asset: null, mtime: 0, bytes: -1, sha256: null, exists: false }; }
}
async function liveAssetBytes(asset) {
  // Exact live JS bytes the candidate serves, fetched over HTTP like a player
  // would load them (4192 serves dist-next, never dist). SHA256, not length:
  // equal length with different bytes is a stale build this must refuse.
  const res = await fetch(new URL('assets/' + asset, CANDIDATE).href, { cache: 'no-store' });
  if (!res.ok) return { ok: false, bytes: -1, sha256: null };
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

// ---- .cfb-layer observation (bounded, game untouched, lifetime untouched) ----
async function installCfbObserver(page) {
  return page.evaluate(() => {
    const w = window;
    if (w.__CFB_PROOF && w.__CFB_PROOF.observer) return true;
    const store = { records: [], max: 200, observer: null };
    const push = (num) => {
      try {
        store.records.push({
          text: (num.textContent ?? '').trim().slice(0, 24),
          cls: String(num.className ?? '').slice(0, 120),
          transform: String(num.style?.transform ?? '').slice(0, 96),
          t: performance.now(),
        });
        if (store.records.length > store.max) store.records.splice(0, store.records.length - store.max);
      } catch { /* observation never breaks the game */ }
    };
    const hud = document.getElementById('hud');
    if (!hud) return false;
    // Sweep nodes already present, then watch additions (CFB_MERGE_MS merges
    // rewrite text in place — spaced shots below avoid the merge window, and
    // synchronous sweeps after each shot catch whatever is live).
    for (const num of hud.querySelectorAll('.cfb-layer .cfb-num')) push(num);
    store.observer = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n instanceof Element) {
          if (n.classList?.contains('cfb-num')) push(n);
          for (const d of n.querySelectorAll?.('.cfb-num') ?? []) push(d);
        }
      }
    });
    const layer = hud.querySelector('.cfb-layer') ?? hud;
    store.observer.observe(layer, { childList: true, subtree: true });
    w.__CFB_PROOF = store;
    return true;
  });
}
const cfbRead = (page) => page.evaluate(() => {
  const nodes = [...document.querySelectorAll('#hud .cfb-layer .cfb-num')].map((n) => ({
    text: (n.textContent ?? '').trim().slice(0, 24),
    cls: String(n.className ?? '').slice(0, 120),
    transform: String(n.style?.transform ?? '').slice(0, 96),
  }));
  return { count: nodes.length, nodes: nodes.slice(0, 26), layer: !!document.querySelector('#hud .cfb-layer') };
});
const cfbRecords = (page) => page.evaluate(() => (window.__CFB_PROOF?.records ?? []).slice(-200));
const cfbClear = (page) => page.evaluate(() => { if (window.__CFB_PROOF) window.__CFB_PROOF.records = []; return true; });
const cfbParse = (text) => {
  const v = Number(String(text).trim());
  return Number.isFinite(v) ? v : NaN;
};

 async function ready(page, url) {
   // Every wait is capped by the overall 150 s budget: no fixed 60 s wait may
   // run past it (item 7). Launches use stockBrowser's own bounded CDP retry.
   const budget = Math.max(1_000, Math.min(60_000, left()));
   await page.goto(url, { waitUntil: 'load', timeout: budget });
   await page.waitForFunction(() => window.__NT?.ready === true && window.__AA_UI && window.__NTGAME, null, { timeout: Math.max(1_000, Math.min(60_000, left())) });
 }
 // waitForFunction capped by the same overall deadline. Callers pass the
 // nominal timeout; the effective one never exceeds what is left of 150 s.
 async function wf(page, fn, timeoutMs, arg = null) {
   return page.waitForFunction(fn, arg, { timeout: Math.max(1_000, Math.min(timeoutMs, left())) });
 }
 // Capped action timeout for every menu click/fill/check: no UI interaction
 // may wait past the overall 150 s budget either.
 const T = (ms) => Math.max(1_000, Math.min(ms, left()));
// __NT_BACKEND shape verified in src/core/renderer.ts: { requested, actual }
// where actual is 'webgpu' | 'webgl2'; the render canvas dataset.ntBackend
// mirrors it (renderer.domElement.dataset.ntBackend = actual).
const backend = (page) => page.evaluate(() => ({
  report: window.__NT_BACKEND ?? null,
  // The render canvas carries data-nt-backend (core/renderer.ts sets
  // renderer.domElement.dataset.ntBackend = actual). A bare
  // querySelector('canvas') selects the UI overlay canvas, which has no
  // dataset — root r1 read canvas:null while WebGPU was actually live.
  canvas: document.querySelector('canvas[data-nt-backend]')?.dataset?.ntBackend ?? null,
  post: (() => { try { const p = window.__NTPOST; return p ? { backend: p.backend, enabled: p.enabled } : null; } catch { return null; } })(),
}));
const bundle = (page) => page.evaluate(() => {
  const urls = [...performance.getEntriesByType('resource')].map((r) => r.name);
  const hit = urls.find((u) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(u)) ?? null;
  return { bundle: hit ? (hit.match(/index-[A-Za-z0-9_-]+\.js/) || [])[0] ?? null : null };
});
async function openMultiplayer(peer, callsign, url) {
  await ready(peer.page, url);
  // The menu must be back at Main with a VISIBLE Multiplayer button. Root r1
  // called __NTGAME.leave() (teardown to idle, no menu transition — menus.ts
  // only returns to a panel on its own return-pre-match path), then ready()
  // to the SAME cache-busted URL and found Multiplayer attached but
  // invisible: 15 s click timeout. A fresh qa tag forces a real reload, and
  // the visible-wait fails closed with a named step instead of a timeout.
  await peer.page.getByRole('button', { name: 'Multiplayer' }).waitFor({ state: 'visible', timeout: T(15_000) });
  await peer.page.getByRole('button', { name: 'Multiplayer' }).click({ timeout: T(15_000) });
  await peer.page.getByLabel('Link').selectOption('lan', { timeout: T(15_000) });
  await peer.page.getByLabel('Signal server').fill(SIGNAL_URL, { timeout: T(15_000) });
  await peer.page.getByLabel('Signal server').dispatchEvent('change');
  await peer.page.getByLabel('Callsign').fill(callsign, { timeout: T(15_000) });
  await peer.page.getByLabel('Callsign').dispatchEvent('change');
}
const actors = (page) => page.evaluate(() => {
  const g = window.__NTGAME;
  const s = g.snapshot();
  return {
    phase: s.match.phase, mode: g.mode(), localId: g.localId, at: s.at ?? null,
    // life/protectedUntil ride the live HostSnapshot rows (game/host.ts
    // builds them from health.life/invulnerableUntil); absent on a narrowed
    // projection reads null, never a guess. They name spawn-protection and
    // life-epoch refusals per pull instead of leaving damage-0 unexplained.
    rows: s.actors.map((a) => ({ id: a.id, team: a.team, bot: a.bot, hp: a.hp, alive: a.alive, life: a.life ?? null, protectedUntil: a.protectedUntil ?? null })),
    counters: g.counters(),
    rejects: (() => { try { return g.log().filter((l) => /shot-reject/.test(l)).slice(-4); } catch { return []; } })(),
  };
});
const bodies = (page) => page.evaluate(() => window.__NTGAME.bots().map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z, alive: b.alive })));
 // Firing solution beside a live HOSTILE victim: empty of colliders, real LOS
 // at chest height. Victim re-read at aim time. Hostility comes from the live
 // snapshot (actual team/localId, never guessed): BotBody carries no team, so
 // bots() positions are joined to snapshot().actors here, inside the page.
 // Returns { victim, spot } or null. victimId pins one target; otherwise the
 // nearest hostile bot is chosen. Friendlies can never be selected.
 async function firingSolution(page, victimId = null) {
   return page.evaluate((only) => {
     const g = window.__NTGAME;
     const snap = g.snapshot();
     const me = snap.actors.find((a) => a.id === g.localId);
     const hostile = new Set(snap.actors.filter((a) => {
       if (!a.alive) return false;
       if (only) return a.id === only;
       if (!a.bot) return false;
       if (snap.match.mode === 'ffa') return a.id !== g.localId;
       return me ? a.team !== me.team : a.id !== g.localId;
     }).map((a) => a.id));
     const list = g.bots().filter((b) => b.alive && hostile.has(b.id));
     if (!list.length) return null;
     const here = window.__NT.probePos();
     list.sort((a, b) => (Math.hypot(a.x - here[0], a.z - here[2]) - Math.hypot(b.x - here[0], b.z - here[2])));
     const tries = [[0, 6], [6, 0], [0, -6], [-6, 0], [4, 4], [-4, 4], [4, -4], [-4, -4], [0, 9], [9, 0]];
     for (const v of list.slice(0, 4)) {
       for (const [dx, dz] of tries) {
         const ax = v.x + dx, az = v.z + dz;
         if (window.__NT.collidersAt(ax, az, 1.0).length > 0) continue;
        // Eye-height LOS both ends: probePos/teleport carry feet (y=0), the
        // eye rides EYE_HEIGHT 1.68 above (core/layout.ts; game/host-life.ts
        // resolves occupants as p.y + EYE_HEIGHT the same way).
        if (!g.los(ax, 1.68, az, v.x, (v.y ?? 0) + 1.68, v.z)) continue;
         return { victim: { id: v.id, x: v.x, y: v.y, z: v.z }, spot: { ax, az } };
       }
     }
     return null;
   }, victimId);
 }
 // Exact remote-human id from the live snapshot (non-bot, not local). The
 // duel aims at THIS id and no other body — never a nearby bot.
 const remoteHumanId = (page) => page.evaluate(() => {
   const g = window.__NTGAME;
   const rows = g.snapshot().actors;
  const hit = rows.find((a) => !a.bot && a.id !== g.localId);
  return hit ? hit.id : null;
});

// Aim and trigger are SEPARATE evaluates, never one. Root r1 teleported and
// fired in the same evaluate: the camera updates synchronously, but the
// authoritative host pose/input (PoseTrack, tick-carried yaw/pitch) needs a
// frame/tick to settle — the claim left with a stale origin against a fresh
// direction and six admitted pulls dealt zero damage. The pattern is root
// _verify-net-refinement.mjs: teleport, sleep 400, then fire. Here:
// place/teleport -> sleep 400 (caller) -> aimAt (angles only, position
// static so the muzzle stays consistent with the settled pose) -> short
// tick gap -> pullTrigger. kind chest -> +1.0 m over feet (body band
// LIMB_Y 0.9..HEAD_Y 1.55); head -> +1.65 m (inside the head band at/above
// HEAD_Y 1.55, game/host-shot.ts). Eye is feet + EYE_HEIGHT 1.68.
async function aimAt(page, victimId, kind = 'chest') {
  return page.evaluate(({ only, k }) => {
    const g = window.__NTGAME;
    const body = g.bots().find((b) => b.id === only && b.alive);
    if (!body) return { aimed: false, reason: 'pinned-victim-absent', victimId: only };
    const me = window.__NT.probePos();
    const ty = (body.y ?? 0) + (k === 'head' ? 1.65 : 1.0);
    const ey = me[1] + 1.68;
    const dx = body.x - me[0], dz = body.z - me[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(ty - ey, Math.hypot(dx, dz));
    window.__NT.teleport(me[0], 0, me[2], yaw, pitch);
    const los = g.los(me[0], ey, me[2], body.x, ty, body.z);
    return { aimed: true, victimId: only, dist: +Math.hypot(dx, dz).toFixed(2), los, body: { x: +body.x.toFixed(2), y: +body.y.toFixed(2), z: +body.z.toFixed(2) } };
  }, { only: victimId, k: kind });
}
// One REAL trigger pull with claim/admission diagnostics from live surfaces
// only: weaponCmd('state') (mag/reloading/cool/shotsFired, weapons/
// controller.ts) names trigger-level refusal; counters().shotRejects +
// __NTGAME.log() 'shot-reject <shooter> <reason>' lines (game/client.ts,
// session-log.ts) name host-level refusal. A dry mag refills through the
// real QA surface soak.mjs uses — an empty gun refusing is not evidence.
async function pullTrigger(page) {
  return page.evaluate(() => {
    const q = window.__NT;
    const g = window.__NTGAME;
    let st0 = null;
    try { st0 = q.weaponCmd('state'); } catch { st0 = null; }
    if (st0 && (st0.mag ?? 1) <= 0) { try { q.weaponCmd('refill'); } catch { /* refill best-effort */ } }
    const c0 = g.counters();
    const sf0 = st0?.shotsFired ?? null;
    let fired = false;
    try { fired = !!q.weaponCmd('fire'); } catch { fired = false; }
    let st1 = null;
    try { st1 = q.weaponCmd('state'); } catch { st1 = null; }
    const c1 = g.counters();
    let rejects = [];
    try { rejects = g.log().filter((l) => /shot-reject/.test(l)).slice(-2); } catch { rejects = []; }
    return {
      fired,
      triggerAdmitted: sf0 !== null && st1 ? (st1.shotsFired ?? 0) - sf0 : null,
      mag: st1?.mag ?? null, cool: st1?.cool ?? null, reloading: st1?.reloading ?? null,
      dmgDelta: (c1.damage ?? 0) - (c0.damage ?? 0),
      rejectDelta: (c1.shotRejects ?? 0) - (c0.shotRejects ?? 0),
      rejects,
    };
  });
}

let A = null, B = null;
try {
  if (/127\.0\.0\.1:4188|localhost:4188/.test(CANDIDATE)) throw new Error('refusing stale default 4188: ' + CANDIDATE);
  if (left() <= 0) throw new Error('overall budget already spent before start');
  mkdirSync(OUT, { recursive: true });
   const disk0 = distAsset();
   step('dist-next bundle present on disk', disk0.exists, JSON.stringify(disk0));
   if (!disk0.exists) throw new Error('build first: ' + DIST_DIR + '/index.html names no index-*.js asset');
   report.distDir = DIST_DIR;

   // ---- peer A: solo proof, then reused as host ----
   A = await stockBrowser('cfb-live-A');
   const errorsA = pageErrors(A);
   const url = cacheBusted(CANDIDATE);
   await ready(A.page, url);
   step('candidate page ready (real game loop)', true, CANDIDATE + ' dist=' + DIST_DIR);
   const be = await backend(A.page);
   step('installed backend is WebGPU', be.report?.actual === 'webgpu' && be.canvas === 'webgpu',
     JSON.stringify(be));
   const bun = await bundle(A.page);
   step('no stale build (loaded bundle matches ' + DIST_DIR + ')', bun.bundle === disk0.asset,
     'page=' + bun.bundle + ' disk=' + disk0.asset);
   if (bun.bundle !== disk0.asset) throw new Error('stale build: reload the candidate and rerun');
  const live = await liveAssetBytes(disk0.asset);
  step('live JS matches ' + DIST_DIR + ' on disk (SHA256)', live.ok && live.sha256 !== null && live.sha256 === disk0.sha256,
    'live sha256=' + live.sha256 + ' disk sha256=' + disk0.sha256 + ' bytes=' + live.bytes + '/' + disk0.bytes + ' asset=' + disk0.asset);
   if (!(await installCfbObserver(A.page))) open('cfb observer installs on #hud', 'no #hud at ready');
   await cfbClear(A.page);

   // Controlled supported solo setup through the player's own persisted key
   // (same key _verify-lobby-screens.mjs uses): 1 recruit bot, all-hostile
   // TDM. Supported table values (SOLO_MIN_BOTS, recruit, enemies), so the
   // match is real but no background bot-vs-bot fight can pollute the
   // per-shot window. Simulation keeps running; nothing is frozen.
   await A.page.evaluate(() => {
     localStorage.setItem('atomic-acres-solo-setup', JSON.stringify({ mode: 'tdm', bots: 1, difficulty: 'recruit', teams: 'enemies' }));
   });
   await ready(A.page, url);
   await installCfbObserver(A.page);
   await cfbClear(A.page);

   // Start the solo match exactly as a player does: Play solo -> Deploy.
   await A.page.getByRole('button', { name: 'Play solo', exact: true }).click({ timeout: T(15_000) });
   await A.page.getByRole('button', { name: /deploy/i }).click({ timeout: T(15_000) });
   const soloActive = await waitUntil(() => A.page.evaluate(() => {
     try {
       const g = window.__NTGAME;
       return g.snapshot().match.phase === 'active' && g.bots().some((b) => b.alive) ? true : null;
     } catch { return null; }
   }), 20_000);
   step('solo match active with live bots (real Play solo -> Deploy)', soloActive === true, 'phase via __NTGAME.snapshot; setup 1x recruit/enemies');
   if (!soloActive) open('solo firing solution', 'no active match inside 20 s');
   else {
     const sol = await firingSolution(A.page);
     step('clear firing position with LOS beside a moving hostile bot exists', sol !== null, sol ? JSON.stringify(sol) : 'none (friendlies excluded by snapshot team join)');
     if (sol) {
       await A.page.evaluate(([x, z]) => window.__NT.teleport(x, 0, z), [sol.spot.ax, sol.spot.az]);
       await sleep(400);
       await cfbClear(A.page);
       // Per-shot evidence: victim HP immediately before vs after ONE real
       // admitted pull. The global damage counter is diagnostic only — it
       // counts every bot in the match, not this shot.
      let popup = null, victimBefore = null, hpAfter = null, pulls = 0, diagDamage = null, admitted = 0, rejected = 0;
      const diag = [];
      for (let i = 0; i < 6 && left() > 40_000; i++) {
        const pre = await actors(A.page);
        const vb = pre.rows.find((r) => r.id === sol.victim.id);
        const rec0 = (await cfbRecords(A.page)).length;
        // Settle-then-aim-then-fire: the teleport above already settled the
        // host pose (400 ms); each pull re-aims at the EXACT live body
        // (the bot moves), waits a tick gap, then pulls the real trigger.
        const aim = await aimAt(A.page, sol.victim.id, 'chest');
        if (!aim.aimed) { diag.push({ pull: i, aimed: false, reason: aim.reason }); break; }
        await sleep(150); // one frame/tick carries the new angles; position static
        const r = await pullTrigger(A.page);
        pulls += r.fired ? 1 : 0;
        admitted += r.triggerAdmitted ?? 0;
        rejected += r.rejectDelta ?? 0;
        diag.push({ pull: i, dist: aim.dist, los: aim.los, fired: r.fired, admitted: r.triggerAdmitted, mag: r.mag, cool: r.cool, reloading: r.reloading, dmgDelta: r.dmgDelta, rejectDelta: r.rejectDelta, rejects: r.rejects, vProt: vb?.protectedUntil ?? null, vLife: vb?.life ?? null, vHp: vb?.hp ?? null });
        await sleep(450); // > CFB_MERGE_MS 140 so hits stay separate numbers
        const read = await cfbRead(A.page);
        const recs = await cfbRecords(A.page);
        const now = await actors(A.page);
        const v = now.rows.find((x) => x.id === sol.victim.id);
        diagDamage = now.counters.damage ?? null;
        if (r.fired && vb && v && v.hp < vb.hp && recs.length > rec0) {
          popup = recs[recs.length - 1]; victimBefore = vb; hpAfter = v; break;
        }
        if (read.count > 24) { step('popup pool cap holds (<=24)', false, 'count=' + read.count); break; }
      }
      const hpDelta = victimBefore && hpAfter ? victimBefore.hp - hpAfter.hp : NaN;
      const value = popup ? cfbParse(popup.text) : NaN;
      report.shots.solo = { victimId: sol.victim.id, pulls, admitted, rejected, victimBefore, hpAfter, hpDelta, popup, diagDamage, diag };
       const okPopup = popup !== null && Number.isFinite(value) && value > 0 && value <= 100;
      step('solo admitted shot yields a positive finite bounded popup', okPopup,
        JSON.stringify({ value, hpDelta, pulls, admitted, rejected, cls: popup?.cls, transform: popup?.transform }));
       if (okPopup) {
         // Single-shot window: this pull's popup must equal this victim's HP
         // step. (Regen cannot intrude: REGEN_DELAY_MS is 5000; spacing is
         // 450 ms. No armor system exists; spawn protection would show as no
         // HP change and simply retries the next spaced shot. 1-bot enemies
         // setup leaves no background fight to widen the window.)
         if (Number.isFinite(hpDelta)) {
           step('solo popup value equals the admitted HP delta', value === hpDelta,
             `popup=${value} hp ${victimBefore.hp}->${hpAfter.hp} (victim ${sol.victim.id}, this shot only)`);
         } else open('solo popup-vs-HP equality', 'popup=' + value + ' hpDelta=' + hpDelta);
         step('solo popup sits at the victim, not the crosshair fallback',
           !/cfb-anchored/.test(popup.cls ?? '') && /translate\(/.test(popup.transform ?? ''),
           JSON.stringify({ cls: popup.cls, transform: popup.transform }));
         if (!/cfb-crit/.test(popup.cls ?? '') && !/cfb-lethal/.test(popup.cls ?? '') && (hpAfter?.alive ?? true) && (hpAfter?.hp ?? 0) > 0) {
           step('solo chest shot reads body style (no crit, no lethal while alive)', true, popup.cls);
         } else open('solo body style', 'chest-aimed popup class was ' + popup.cls + ' (zone evidence is host-internal; see doc)');
         step('popup pool cap holds (<=24)', (await cfbRead(A.page)).count <= 24, 'count via .cfb-layer sweep');
         await A.page.screenshot({ path: join(OUT, TAG + '-solo-hit.png') });
       }
       // S5 (solo half): a FRESH popup must be on screen immediately before
       // leave, and leave must clear it before the 900 ms lifetime expires.
       const preLeave = await cfbRead(A.page);
       const freshAge = popup ? (await A.page.evaluate(() => performance.now())) - popup.t : Infinity;
       step('a fresh popup is visible immediately before leave', popup !== null && preLeave.count > 0 && freshAge < 900,
         `visible=${preLeave.count} age=${Number.isFinite(freshAge) ? Math.round(freshAge) : 'n/a'}ms (lifetime 900)`);
       await A.page.evaluate(() => window.__NTGAME.leave());
       await sleep(250);
       const afterLeave = await cfbRead(A.page);
       const idleMode = await A.page.evaluate(() => window.__NTGAME.mode());
       step('leaving clears visible numbers before natural expiry', popup !== null && freshAge < 900 && idleMode === 'idle' && afterLeave.count === 0,
         `mode=${idleMode} remaining=${afterLeave.count} preLeaveAge=${Math.round(freshAge)}ms`);
     }
   }

  // ---- host + guest: real WebRTC via the real Multiplayer UI ----
  // Fresh qa tag: __NTGAME.leave() above tears the match down to idle but
  // performs no menu transition, so the SAME cache-busted URL may reshow an
  // attached-but-invisible Multiplayer (root r1's 15 s timeout). A new tag
  // forces a real reload back at a visible Main; openMultiplayer waits for
  // that visibility before the first click.
  B = await stockBrowser('cfb-live-B');
  const errorsB = pageErrors(B);
  const urlMp = cacheBusted(CANDIDATE) + '-mp';
  await Promise.all([openMultiplayer(A, 'cfb-host', urlMp), openMultiplayer(B, 'cfb-guest', urlMp)]);
   await A.page.getByRole('button', { name: 'Host a room' }).click({ timeout: T(15_000) });
   await wf(A.page, () => /^[0-9A-Z]{6}$/.test(document.querySelector('#start .aa-code')?.textContent ?? ''), 10_000);
   const roomCode = await A.page.evaluate(() => document.querySelector('#start .aa-code')?.textContent ?? '');
   step('host room code appears in the real multiplayer UI', /^[0-9A-Z]{6}$/.test(roomCode), roomCode);
   await B.page.getByLabel('Join code').fill(roomCode, { timeout: T(15_000) });
   await B.page.getByRole('button', { name: 'Join by code' }).click({ timeout: T(15_000) });
   await Promise.all([
     wf(A.page, () => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, 30_000),
     wf(B.page, () => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, 30_000),
   ]);
   step('guest joins over WebRTC, both rosters show two seats', true, 'code ' + roomCode);
   await A.page.getByLabel('Ready').check({ timeout: T(15_000) });
   await B.page.getByLabel('Ready').check({ timeout: T(15_000) });
   await wf(A.page, () => !document.querySelector('#start .aa-lobby-room button.aa-primary')?.disabled, 10_000);
   await A.page.getByRole('button', { name: 'Start match' }).click({ timeout: T(15_000) });
   await Promise.all([
     wf(A.page, () => window.__NTGAME.mode() === 'host' && document.getElementById('start').style.display === 'none', 20_000),
     wf(B.page, () => window.__NTGAME.mode() === 'guest' && document.getElementById('start').style.display === 'none', 20_000),
   ]);
   const guestId = await B.page.evaluate(() => window.__NTGAME.localId);
   step('Start transitions A to host and B to guest', true, 'guest=' + guestId);
   await Promise.all([
     wf(A.page, () => window.__NTGAME.snapshot().match.phase === 'active', 20_000),
     wf(B.page, () => { try { return window.__NTGAME.snapshot().match.phase === 'active'; } catch (e) { if (String(e).includes('guest has no match line yet')) return false; throw e; } }, 20_000),
   ]);
   await sleep(500);
   await installCfbObserver(A.page);
   await installCfbObserver(B.page);

   async function duel(shooter, victim, dirLabel) {
     // Shooter fires the REAL trigger at the LIVE REMOTE HUMAN; victim idles.
     // The peer id is derived from both ends of the actual API and
     // cross-checked (victim's own localId === the non-bot stranger the
    // shooter sees). aimAt/pullTrigger pin that id — a nearby bot can never be
    // aimed at, and firingSolution is not used here at all.
     // Phase B (body): chest pulls until the peer's HP drops. Phase H
     // (head/fatal): bounded respawn wait + reposition, then head pulls
     // until a crit or a real kill. Shooter-only popups, exact HP steps,
     // victim-side silence, and lethal-only-on-kill are asserted per phase.
     const want = (await actors(victim.page)).localId;
     const seen = await remoteHumanId(shooter.page);
     if (!want || !seen || want !== seen) {
       open(dirLabel + ' pins the live peer', 'victim localId=' + want + ' shooter sees remote=' + seen + ' (refusing to shoot a stranger)');
       return null;
     }
     const targetId = want;
     const sActors0 = await actors(shooter.page);
     const kills0 = sActors0.counters.kills ?? 0;
    const placeBesidePeer = async () => {
      const vPos = await victim.page.evaluate(() => window.__NT.probePos());
      const spot = await shooter.page.evaluate(([bx, bz, by]) => {
        const g = window.__NTGAME;
        for (const [dx, dz] of [[0, 6], [6, 0], [0, -6], [-6, 0], [4, 4], [-4, 4], [4, -4], [-4, -4]]) {
          const ax = bx + dx, az = bz + dz;
          if (window.__NT.collidersAt(ax, az, 1.0).length > 0) continue;
          if (!g.los(ax, 1.68, az, bx, by + 1.68, bz)) continue;
          return { ax, az };
        }
        return null;
      }, [vPos[0], vPos[2], vPos[1] ?? 0]);
      if (!spot) return false;
      await shooter.page.evaluate(([x, z]) => window.__NT.teleport(x, 0, z), [spot.ax, spot.az]);
      await sleep(400);
      return true;
    };
     if (!(await placeBesidePeer())) { open(dirLabel + ' firing position', 'no LOS spot beside the live peer'); return null; }
     await cfbClear(shooter.page);
     await cfbClear(victim.page);
     const vRec0 = (await cfbRecords(victim.page)).length;
     const selfOf = async (p) => { const a = await actors(p.page); return a.rows.find((x) => x.id === a.localId) ?? null; };
    // ---- phase B: chest pulls, one HP step ----
    const phaseB = { fired: 0, admitted: 0, rejected: 0, hpBefore: null, hpAfter: null, hpDelta: NaN, popup: null, newPopups: 0, diag: [] };
    for (let i = 0; i < 10 && left() > 15_000; i++) {
      const hp0 = await selfOf(victim);
      const rec0 = (await cfbRecords(shooter.page)).length;
      const aim = await aimAt(shooter.page, targetId, 'chest');
      if (!aim.aimed) { phaseB.diag.push({ pull: i, aimed: false, reason: aim.reason }); break; }
      await sleep(150);
      const r = await pullTrigger(shooter.page);
      if (r.fired) phaseB.fired++;
      phaseB.admitted += r.triggerAdmitted ?? 0;
      phaseB.rejected += r.rejectDelta ?? 0;
      phaseB.diag.push({ pull: i, dist: aim.dist, los: aim.los, fired: r.fired, admitted: r.triggerAdmitted, mag: r.mag, cool: r.cool, dmgDelta: r.dmgDelta, rejectDelta: r.rejectDelta, rejects: r.rejects, vProt: hp0?.protectedUntil ?? null, vHp: hp0?.hp ?? null });
      await sleep(300); // > CFB_MERGE_MS 140, far below REGEN_DELAY_MS 5000
      const hp1 = await selfOf(victim);
      const recs = await cfbRecords(shooter.page);
      if (r.fired && hp0 && hp1 && hp1.hp < hp0.hp && recs.length > rec0) {
        phaseB.hpBefore = hp0; phaseB.hpAfter = hp1; phaseB.hpDelta = hp0.hp - hp1.hp;
        phaseB.popup = recs[recs.length - 1]; phaseB.newPopups = recs.length - rec0;
        break;
      }
    }
     await shooter.page.screenshot({ path: join(OUT, TAG + '-' + dirLabel + '.png') });
     // ---- phase H: bounded respawn + reposition, then head pulls ----
    const phaseH = { fired: 0, admitted: 0, rejected: 0, hpBefore: null, hpAfter: null, hpDelta: NaN, popup: null, newPopups: 0, crit: false, kill: false, lethal: [], diag: [] };
    if (phaseB.hpAfter && !phaseB.hpAfter.alive) {
      await waitUntil(() => victim.page.evaluate(() => {
        try { const g = window.__NTGAME; const s = g.snapshot(); const me = s.actors.find((a) => a.id === g.localId); return me && me.alive ? true : null; } catch { return null; }
      }), 12_000);
    }
    const aliveNow = await selfOf(victim);
    if (!aliveNow || !aliveNow.alive) {
      open(dirLabel + ' head phase entry', 'victim did not respawn inside the 12 s bound; head/fatal stays unproven');
    } else if (!(await placeBesidePeer())) {
      open(dirLabel + ' head-phase firing position', 'no LOS spot after respawn; head/fatal stays unproven');
    } else {
      // Spawn protection is SPAWN_PROTECT_MS 1350 in team modes (game/
      // rules.ts), not 300: the first head pulls must wait it out or they
      // read as refusals. The loop still retries inside its 10-pull bound.
      await sleep(1400);
      for (let i = 0; i < 10 && left() > 15_000; i++) {
        const hp0 = await selfOf(victim);
        const rec0 = (await cfbRecords(shooter.page)).length;
        const aim = await aimAt(shooter.page, targetId, 'head');
        if (!aim.aimed) { phaseH.diag.push({ pull: i, aimed: false, reason: aim.reason }); break; }
        await sleep(150);
        const r = await pullTrigger(shooter.page);
        if (r.fired) phaseH.fired++;
        phaseH.admitted += r.triggerAdmitted ?? 0;
        phaseH.rejected += r.rejectDelta ?? 0;
        phaseH.diag.push({ pull: i, dist: aim.dist, los: aim.los, fired: r.fired, admitted: r.triggerAdmitted, mag: r.mag, dmgDelta: r.dmgDelta, rejectDelta: r.rejectDelta, rejects: r.rejects, vProt: hp0?.protectedUntil ?? null, vHp: hp0?.hp ?? null });
        await sleep(300);
        const hp1 = await selfOf(victim);
        const recs = await cfbRecords(shooter.page);
        const fresh = recs.slice(rec0);
        if (fresh.some((x) => /cfb-crit/.test(x.cls ?? ''))) phaseH.crit = true;
        if (r.fired && hp0 && hp1 && hp1.hp < hp0.hp && fresh.length > 0) {
          if (phaseH.hpBefore === null) {
            phaseH.hpBefore = hp0; phaseH.hpAfter = hp1; phaseH.hpDelta = hp0.hp - hp1.hp;
            phaseH.popup = fresh[fresh.length - 1]; phaseH.newPopups = fresh.length;
          } else { phaseH.hpAfter = hp1; phaseH.hpDelta = phaseH.hpBefore.hp - hp1.hp; }
        }
        const sNow = await actors(shooter.page);
        if ((hp0 && hp1 && hp0.alive && !hp1.alive) || (sNow.counters.kills ?? 0) > kills0) {
          phaseH.kill = true;
          phaseH.lethal = (await cfbRecords(shooter.page)).filter((x) => /cfb-lethal/.test(x.cls ?? ''));
          break;
        }
        if (phaseH.crit && phaseH.hpBefore !== null && left() < 25_000) break;
      }
    }
     const vActors1 = await actors(victim.page);
     const sActors1 = await actors(shooter.page);
     const victimRecs = await cfbRecords(victim.page);
     return {
       targetId, phaseB, phaseH,
       victimNew: victimRecs.length - vRec0,
       dmgDelta: (sActors1.counters.damage ?? 0) - (sActors0.counters.damage ?? 0),
       killsDelta: (sActors1.counters.kills ?? 0) - kills0,
       victimAlive: (vActors1.rows.find((r) => r.id === vActors1.localId)?.alive) ?? null,
     };
   }

   if (left() > 30_000) {
     const hg = await duel(A, B, 'host-fires');
     if (hg) {
      report.shots.hostFires = { targetId: hg.targetId, phaseB: { fired: b.fired, admitted: b.admitted, rejected: b.rejected, hpDelta: b.hpDelta, popup: b.popup, diag: b.diag }, phaseH: { fired: h.fired, admitted: h.admitted, rejected: h.rejected, hpDelta: h.hpDelta, crit: h.crit, kill: h.kill, lethal: h.lethal.slice(-2), diag: h.diag }, dmgDelta: hg.dmgDelta, killsDelta: hg.killsDelta, victimNew: hg.victimNew };
      const bValue = b.popup ? cfbParse(b.popup.text) : NaN;
      step('host fires the real weapon and guest HP drops (body phase)', b.fired > 0 && Number.isFinite(b.hpDelta) && b.hpDelta > 0,
        `${b.fired} chest pulls at ${hg.targetId}, guest hp ${b.hpBefore?.hp}->${b.hpAfter?.hp} (delta ${b.hpDelta}) admitted=${b.admitted} rejected=${b.rejected}`);
       step('host shows its own outgoing popup only', b.popup !== null && Number.isFinite(bValue) && bValue > 0,
         JSON.stringify(b.popup));
       step('guest shows no outgoing damage text for incoming fire', hg.victimNew === 0,
         'guest new popups=' + hg.victimNew + ' (incoming damage is nonlocal to the victim)');
       if (b.popup !== null && Number.isFinite(b.hpDelta) && b.newPopups === 1) {
         step('host popup value equals the admitted guest HP step', bValue === b.hpDelta, `popup=${bValue} delta=${b.hpDelta} (this chest pull only)`);
       } else open('host popup-vs-HP equality', `popup=${bValue} hpDelta=${b.hpDelta} newInWindow=${b.newPopups} (equality only claimed for one popup in one pull window)`);
       if (b.popup && !/cfb-crit/.test(b.popup.cls ?? '') && !/cfb-lethal/.test(b.popup.cls ?? '') && (b.hpAfter?.alive ?? true) && (b.hpAfter?.hp ?? 0) > 0) {
         step('host body phase reads body style (no crit, no lethal while alive)', true, b.popup.cls);
       } else open('host body style', 'chest-aimed popup class was ' + b.popup?.cls + ' (zone evidence is host-internal; see doc)');
       if (h.crit) {
         step('head-aimed window produced a critical style', true, 'cfb-crit observed through the real host path');
       } else open('critical style from a real headshot', 'no cfb-crit inside the 10-pull head window; zone is host-internal (see doc), not guessed');
       if (h.kill) {
         step('real kill carries the fatal class', h.lethal.length > 0, JSON.stringify(h.lethal.slice(-2)));
       } else open('host-guest kill with fatal class', 'no kill inside the 10-pull head bound; lethal stays unproven, not green');
       // Revive the guest before the mirror leg (bounded by the overall cap).
       await waitUntil(() => B.page.evaluate(() => {
         try { const g = window.__NTGAME; const s = g.snapshot(); const me = s.actors.find((a) => a.id === g.localId); return me && me.alive ? true : null; } catch { return null; }
       }), 12_000);
     }
   } else open('host fires at guest', 'overall 150 s budget exhausted before the leg');

   if (left() > 25_000) {
     const gh = await duel(B, A, 'guest-fires');
     if (gh) {
       const b = gh.phaseB, h = gh.phaseH;
      report.shots.guestFires = { targetId: gh.targetId, phaseB: { fired: b.fired, admitted: b.admitted, rejected: b.rejected, hpDelta: b.hpDelta, popup: b.popup, diag: b.diag }, phaseH: { fired: h.fired, admitted: h.admitted, rejected: h.rejected, hpDelta: h.hpDelta, crit: h.crit, kill: h.kill, lethal: h.lethal.slice(-2), diag: h.diag }, dmgDelta: gh.dmgDelta, killsDelta: gh.killsDelta, victimNew: gh.victimNew };
      const bValue = b.popup ? cfbParse(b.popup.text) : NaN;
      step('guest fires the real weapon and host HP drops (body phase)', b.fired > 0 && Number.isFinite(b.hpDelta) && b.hpDelta > 0,
        `${b.fired} chest pulls at ${gh.targetId}, host hp ${b.hpBefore?.hp}->${b.hpAfter?.hp} (delta ${b.hpDelta}) admitted=${b.admitted} rejected=${b.rejected}`);
       step('guest shows its own outgoing popup only', b.popup !== null && Number.isFinite(bValue) && bValue > 0,
         JSON.stringify(b.popup));
       step('host shows no outgoing damage text for incoming fire', gh.victimNew === 0,
         'host new popups=' + gh.victimNew);
       if (b.popup !== null && Number.isFinite(b.hpDelta) && b.newPopups === 1) {
         step('guest popup value equals the admitted host HP step', bValue === b.hpDelta, `popup=${bValue} delta=${b.hpDelta} (this chest pull only)`);
       } else open('guest popup-vs-HP equality', `popup=${bValue} hpDelta=${b.hpDelta} newInWindow=${b.newPopups}`);
       if (b.popup && !/cfb-crit/.test(b.popup.cls ?? '') && !/cfb-lethal/.test(b.popup.cls ?? '') && (b.hpAfter?.alive ?? true) && (b.hpAfter?.hp ?? 0) > 0) {
         step('guest body phase reads body style (no crit, no lethal while alive)', true, b.popup.cls);
       } else open('guest body style', 'chest-aimed popup class was ' + b.popup?.cls);
       if (h.kill) step('mirror-leg real kill carries the fatal class', h.lethal.length > 0, JSON.stringify(h.lethal.slice(-2)));
       else say('mirror leg produced no kill inside the bound — non-fatal proof stands, lethal already covered above');
       if (h.crit) {
         step('mirror-leg critical style observed', true, 'cfb-crit through the real guest path');
       } else say('mirror leg produced no crit inside the bound — reported, not asserted');
     }
   } else open('guest fires at host', 'overall 150 s budget exhausted before the leg');

  const disk1 = distAsset();
  step('no sibling rebuild mid-run (' + DIST_DIR + '/assets mtime stable)', disk1.mtime === disk0.mtime && disk1.asset === disk0.asset && disk1.sha256 === disk0.sha256,
    disk0.asset + ' mtime ' + disk0.mtime + ' -> ' + disk1.mtime);
  const capA = await cfbRead(A.page);
  const capB = await cfbRead(B.page);
  step('popup pool cap holds on both peers (<=24)', capA.count <= 24 && capB.count <= 24,
    `A=${capA.count} B=${capB.count}`);
  report.errors = { A: errorsA.slice(0, 8), B: errorsB.slice(0, 8) };
  step('both stock Chromes stayed free of console/page errors', errorsA.length === 0 && errorsB.length === 0,
    JSON.stringify(report.errors));
} catch (error) {
  // Root r1 died here with errors={} and no screenshot: undiagnosable. An
  // exception still collects whatever evidence exists — console/page
  // errors, one failure screenshot, authoritative counters — inside the
  // same 150 s budget, then the finally below still closes both Chromes.
  say('EXCEPTION ' + String(error).slice(0, 500));
  try { report.errors = { A: (typeof errorsA !== 'undefined' ? errorsA : []).slice(0, 8), B: (typeof errorsB !== 'undefined' && errorsB ? errorsB.slice(0, 8) : []) }; } catch { report.errors = { note: 'error-list-unreadable' }; }
  for (const [key, peer] of [['A', A], ['B', B]]) {
    if (!peer) continue;
    try {
      const snap = await peer.page.evaluate(() => {
        const g = window.__NTGAME;
        const s = g.snapshot();
        return { phase: s.match.phase, mode: g.mode(), localId: g.localId, counters: g.counters(), actors: s.actors.map((a) => ({ id: a.id, hp: a.hp, alive: a.alive })) };
      });
      report['exception_' + key] = snap;
    } catch (e) { report['exception_' + key] = { note: String(e).slice(0, 160) }; }
    try { await peer.page.screenshot({ path: join(OUT, TAG + '-exception-' + key + '.png') }); report.shots['exception_' + key] = TAG + '-exception-' + key + '.png'; } catch { /* best-effort */ }
  }
  code = 1;
} finally {
  try { if (A) await A.close(); } catch (e) { say('A cleanup ' + String(e).slice(0, 160)); code = 1; }
  try { if (B) await B.close(); } catch (e) { say('B cleanup ' + String(e).slice(0, 160)); code = 1; }
  report.exitCode = code;
  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - T0;
  report.log = log;
  try { mkdirSync(OUT, { recursive: true }); writeFileSync(report.resultPath, JSON.stringify(report, null, 2) + '\n', 'utf8'); } catch (e) { say('report persistence ' + String(e).slice(0, 240)); code = 1; }
  console.log(JSON.stringify(report));
}
process.exit(code);
