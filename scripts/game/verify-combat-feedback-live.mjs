/**
 * Nuketown 2025 — LIVE actual-game browser proof for floating combat text.
 *
 * Sole-owner lane file: scripts/game/verify-combat-feedback-live.mjs
 * (companion doc: docs/combat-browser-proof.md). No game source, no existing
 * gate, no other worktree touched. No recursive delegation. No commit.
 *
 * Repair3 (2026-09-19, scenario rewrite). Root r2 proved the game fine and
 * the harness broken: the host→guest leg dealt real damage (34/51/15) and
 * headshot-killed the guest, then the report block referenced `b`/`h` that
 * were never bound in that leg (the guest leg had the binding, the host leg
 * lost it) — ReferenceError before any assertion. The solo leg fired all six
 * pulls with zero damage because the pinned bot ran behind cover after pull 0
 * (los:false from pull 1 on) and the harness never re-acquired a firing spot,
 * while the first pull raced the bot's spawn-protection window (its
 * protectedUntil is an ABSOLUTE snapshot-clock stamp, not remaining ms).
 * This revision replaces the monolithic per-leg control flow with small,
 * independently callable scenarios:
 *
 *   --scenario solo   S1+S5: one bot, chest pulls to one admitted HP step,
 *                     then the leave-clears-presentation proof.
 *   --scenario duel   S2+S3+S4+S6: real WebRTC host→guest AND guest→host,
 *                     body phase then head/fatal phase per direction.
 *   --scenario all    both, in that order (default; the old behavior).
 *
 * Per-pull engine (shared by every phase — r2's lessons are structural):
 *   wait the victim's REAL protection deadline (protectedUntil vs snapshot.at,
 *   same performance.now() domain) → aim the exact live pinned victim →
 *   on lost LOS, re-acquire a collider-free, LOS-true spot for the SAME
 *   victim, settle, re-aim → fire ONLY with live LOS. The AI is never frozen,
 *   no event is injected, the 900 ms lifetime and 24 cap are untouched.
 *
 * Always on: WebGPU backend/post, dist-next SHA256 identity (name + live
 * bytes + stable mtime), zero console/page errors, ≤150 s overall, owned
 * Chrome cleanup, failure screenshots plus per-peer authoritative snapshots
 * on exception. Exit non-zero on any FAIL or OPEN — a missing actual scenario
 * never slides into green.
 *
 * Patterns: scripts/lib/stock-browser.mjs (reused in place) and
 * scripts/_verify-net-refinement.mjs (teleport → settle → fire; two stock
 * Chromes over real WebRTC).
 *
 * Root run (candidate 4192 from dist-next, relay 4310 — never 4188):
 *   AA_PREVIEW_PORT=4192 node scripts/game/verify-combat-feedback-live.mjs \
 *     --url http://127.0.0.1:4192/ --dist dist-next --signal-port 4310 \
 *     --tag cfb-live --scenario all
 *
 * Worker validation (NO browser launch here): node --check plus a CPU mock
 * of the full orchestration path (see docs/combat-browser-proof.md).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
const SCENARIO = String(opt('scenario', 'all')).toLowerCase();
const TAG = String(opt('tag', 'cfb-live') + '-' + Date.now());
const OUT = join(ROOT, 'captures', 'cfb-live');
const OVERALL_MS = 150_000;
const T0 = Date.now();
const left = () => OVERALL_MS - (Date.now() - T0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { candidate: CANDIDATE, signalUrl: SIGNAL_URL, scenario: SCENARIO, tag: TAG, steps: [], open: [], errors: {}, shots: {}, resultPath: join(OUT, TAG + '-result.json') };
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
  // run past it. Launches use stockBrowser's own bounded CDP retry.
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
// mirrors it (a bare querySelector('canvas') selects the UI overlay canvas,
// which has no dataset — root r1 read canvas:null while WebGPU was live).
const backend = (page) => page.evaluate(() => ({
  report: window.__NT_BACKEND ?? null,
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
  // __NTGAME.leave() tears the match down to idle but performs no menu
  // transition, so a reused URL can reshow an attached-but-invisible
  // Multiplayer (root r1's 15 s timeout). Every leg loads a FRESH qa tag
  // (real reload back at a visible Main) and waits for visibility first.
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
    // builds them from health.life/invulnerableUntil). protectedUntil is an
    // ABSOLUTE stamp on the same performance.now() domain as snapshot.at
    // (session-solo.ts builds the host clock there) — compare the two,
    // never against page time.
    rows: s.actors.map((a) => ({ id: a.id, team: a.team, bot: a.bot, hp: a.hp, alive: a.alive, life: a.life ?? null, protectedUntil: a.protectedUntil ?? null })),
    counters: g.counters(),
    rejects: (() => { try { return g.log().filter((l) => /shot-reject/.test(l)).slice(-4); } catch { return []; } })(),
  };
});
// Exact remote-human id from the live snapshot (non-bot, not local). The
// duel aims at THIS id and no other body — never a nearby bot.
const remoteHumanId = (page) => page.evaluate(() => {
  const g = window.__NTGAME;
  const rows = g.snapshot().actors;
  const hit = rows.find((a) => !a.bot && a.id !== g.localId);
  return hit ? hit.id : null;
});
// Firing solution beside a live HOSTILE victim: empty of colliders, real LOS
// at eye height. Victim re-read at aim time. Hostility comes from the live
// snapshot (actual team/localId, never guessed): BotBody carries no team, so
// bots() positions are joined to snapshot().actors here, inside the page.
// victimId pins one target across repositions; otherwise the nearest hostile
// bot is chosen. Friendlies can never be selected.
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
        // resolves occupants the same way).
        if (!g.los(ax, 1.68, az, v.x, (v.y ?? 0) + 1.68, v.z)) continue;
        return { victim: { id: v.id, x: v.x, y: v.y, z: v.z }, spot: { ax, az } };
      }
    }
    return null;
  }, victimId);
}
// Aim and trigger are SEPARATE evaluates, never one. The camera updates
// synchronously, but the authoritative host pose/input (PoseTrack,
// tick-carried yaw/pitch) needs a frame/tick to settle — r1 fired in the
// same evaluate as the teleport and six admitted pulls dealt zero damage.
// The pattern is root _verify-net-refinement.mjs: teleport, settle, fire.
// kind chest -> +1.0 m over feet (body band LIMB_Y 0.9..HEAD_Y 1.55);
// head -> +1.65 m (inside the head band at/above HEAD_Y 1.55,
// game/host-shot.ts). Eye is feet + EYE_HEIGHT 1.68.
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
// __NTGAME.log() 'shot-reject <shooter> <reason>' lines name host-level
// refusal. A dry mag refills through the real QA surface soak.mjs uses — an
// empty gun refusing is not evidence.
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
// Waits out the victim's REAL spawn-protection deadline on the live snapshot
// clock. protectedUntil and snapshot.at share one performance.now() domain
// (session-solo.ts builds the host clock there; host.ts copies
// health.invulnerableUntil into the row and events.ts documents the field),
// so remaining = protectedUntil - at is authoritative. Returns off:false at
// the cap — the caller must NOT fire, because an invulnerable hit is a
// refused admission (host-life.ts admitPreResolved) and would pollute the
// window with a no-damage pull (exactly r2's silent first shot).
async function protectionWait(page, victimId, capMs = 2_500, authPage = null) {
  const t0 = Date.now();
  let known = false;
  const auth = authPage ?? page;
  while (Date.now() - t0 < Math.min(capMs, Math.max(0, left()))) {
    const s = await actors(auth);
    const row = s.rows.find((r) => r.id === victimId) ?? null;
    if (!row || row.protectedUntil === null || row.protectedUntil === undefined || typeof row.protectedUntil !== 'number') {
      return { waited: Date.now() - t0, known: false, off: false, remaining: null, reason: !row ? 'victim-absent' : 'unknown-protectedUntil' };
    }
    known = true;
    const remaining = row.protectedUntil - s.at;
    if (remaining <= 0) return { waited: Date.now() - t0, known: true, off: true, remaining: 0, life: row.life, at: s.at };
    await sleep(Math.min(120, remaining));
  }
  return { waited: Date.now() - t0, known: true, off: false, remaining: null };
}
// Re-acquires a supported, collision-free, LOS-true spot for the SAME pinned
// victim (r2's bot ran behind cover and the harness kept firing blind).
async function reposition(page, victimId) {
  const sol = await firingSolution(page, victimId);
  if (!sol) return null;
  await page.evaluate(([x, z]) => window.__NT.teleport(x, 0, z), [sol.spot.ax, sol.spot.az]);
  return sol;
}
// The ONE per-pull engine behind every scenario/phase. Fires only at a
// settled pose, only with live LOS, only after the real protection deadline.
// Reacquires LOS after the angle pose wait (moving bot can leave LOS during wait).
// Tracks actual target life epoch and snapshot HP clock consistently.
// stop 'first-step' ends at the first admitted HP step (one clean window for
// popup-vs-HP equality); 'crit-step' keeps pulling for crit/fatal evidence
// and folds every admitted step (cumulative HP deltas). Kill evidence is the
// victim's alive flip or the shooter's kills counter moving — never assumed.
async function fireShots(page, victimId, kind, opts) {
  const { bound, stop, gateMs = 15_000, kills0, authPage = null } = opts;
  const auth = authPage ?? page;
  const diag = [], steps = [], lethal = [];
  let fired = 0, admitted = 0, rejected = 0, repositions = 0, kill = false, crit = false, killsSeen = kills0;
  for (let i = 0; i < bound && left() > gateMs && !kill; i++) {
    const pre = await actors(auth);
    const vb = pre.rows.find((r) => r.id === victimId) ?? null;
    if (vb && !vb.alive) { diag.push({ pull: i, skip: 'victim-dead' }); break; }
    const prot = await protectionWait(page, victimId, 2_500, auth);
    if (prot.known && !prot.off) { diag.push({ pull: i, skip: 'still-protected', protWaitedMs: prot.waited }); continue; }
    let aim = await aimAt(page, victimId, kind);
    if (!aim.aimed) { diag.push({ pull: i, aimed: false, reason: aim.reason }); break; }
    if (!aim.los) {
      const sol = await reposition(page, victimId);
      if (!sol) { diag.push({ pull: i, los: false, repositioned: false, reason: 'no-los-spot' }); continue; }
      repositions++;
      await sleep(400); // pose settles after the teleport before re-aim
      aim = await aimAt(page, victimId, kind);
      if (!aim.los) { diag.push({ pull: i, los: false, repositioned: true, reason: 'los-after-reposition' }); continue; }
    }
    await sleep(150); // one tick carries the fresh angles; position static
    // Reacquire LOS after angle pose wait — moving bot can leave LOS during the wait
    aim = await aimAt(page, victimId, kind);
    if (!aim.los) {
      const sol = await reposition(page, victimId);
      if (!sol) { diag.push({ pull: i, los: false, repositioned: false, reason: 'no-los-spot-after-pose-wait' }); continue; }
      repositions++;
      await sleep(400);
      aim = await aimAt(page, victimId, kind);
      if (!aim.los) { diag.push({ pull: i, los: false, repositioned: true, reason: 'los-after-second-reposition' }); continue; }
      await sleep(150);
      aim = await aimAt(page, victimId, kind);
      if (!aim.los) { diag.push({ pull: i, los: false, reason: 'los-unconfirmed-after-pose-wait' }); continue; }
    }

    // Capture target life and HP clock immediately before trigger pull
    const prePull = await actors(auth);
    const targetPre = prePull.rows.find((r) => r.id === victimId) ?? null;
    if (!targetPre || !targetPre.alive) { diag.push({ pull: i, skip: 'victim-dead-pre-pull' }); break; }
    const hp0 = targetPre.hp ?? null;
    const life0 = targetPre.life ?? null;
    const clock0 = prePull.at ?? null;

    const rec0 = (await cfbRecords(page)).length;
    const r = await pullTrigger(page);
    if (r.fired) fired++;
    admitted += r.triggerAdmitted ?? 0;
    rejected += r.rejectDelta ?? 0;
    await sleep(320); // > CFB_MERGE_MS 140, far below REGEN_DELAY_MS 5000

    const post = await actors(auth);
    const targetPost = post.rows.find((x) => x.id === victimId) ?? null;
    const recs = await cfbRecords(page);
    const fresh = recs.slice(rec0);
    const hp1 = targetPost?.hp ?? null;
    const life1 = targetPost?.life ?? null;
    const clock1 = post.at ?? null;

    let delta = NaN;
    if (hp0 !== null && hp1 !== null) {
      if (life0 === life1) {
        delta = hp0 - hp1;
      } else if (life0 !== null && life1 !== null && life1 > life0) {
        // Target died and respawned into new life
        delta = hp0;
      }
    }

    crit = crit || fresh.some((x) => /cfb-crit/.test(x.cls ?? ''));
    const nowKill = (targetPre.alive && targetPost && (!targetPost.alive || (life1 !== null && life0 !== null && life1 > life0)))
      || (post.counters.kills ?? 0) > killsSeen;
    if (nowKill) {
      kill = true;
      killsSeen = post.counters.kills ?? killsSeen;
      lethal.push(...fresh.filter((x) => /cfb-lethal/.test(x.cls ?? '')));
    }
    if (r.fired && delta > 0) {
      steps.push({
        hp0, hp1, hpDelta: delta, life0, life1, clock0, clock1,
        popup: fresh.length ? fresh[fresh.length - 1] : null,
        newPopups: fresh.length,
        alive: targetPost?.alive ?? false,
      });
    }
    diag.push({
      pull: i, kind, dist: aim.dist, los: aim.los, protWaitedMs: prot.waited, protKnown: prot.known, repositions,
      fired: r.fired, admitted: r.triggerAdmitted, mag: r.mag, cool: r.cool, reloading: r.reloading,
      hp0, hp1, hpDelta: delta, life0, life1, clock0, clock1, dmgDelta: r.dmgDelta, rejectDelta: r.rejectDelta, rejects: r.rejects,
      newPopups: fresh.length, popups: fresh.slice(-2).map((p) => ({ text: p.text, cls: p.cls })),
    });
    if (stop === 'first-step' && steps.length > 0) break;
    if (stop === 'crit-step' && crit && steps.length > 0 && left() < 25_000) break;
    await sleep(130);
  }
  return { fired, admitted, rejected, repositions, kill, crit, lethal, steps, diag };
}
// Places the shooter beside the live (stationary-through-its-own-control)
// remote human: collider-free spot with real eye-height LOS, then settle.
async function placeBesidePeer(shooter, victim) {
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
}

// ---- scenario: solo (S1 admitted popup + S5 leave clears) ----
async function scenarioSolo(A) {
  // Controlled supported solo setup through the player's own persisted key
  // (same key _verify-lobby-screens.mjs uses): 1 recruit bot, all-hostile
  // TDM. Supported table values (SOLO_MIN_BOTS, recruit, enemies), so the
  // match is real but no background bot-vs-bot fight pollutes the window.
  await A.page.evaluate(() => {
    localStorage.setItem('atomic-acres-solo-setup', JSON.stringify({ mode: 'tdm', bots: 1, difficulty: 'recruit', teams: 'enemies' }));
  });
  await ready(A.page, cacheBusted(CANDIDATE));
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
  if (!soloActive) { open('solo admitted shot', 'no active match inside 20 s'); return; }
  const sol = await firingSolution(A.page);
  step('clear firing position with LOS beside a moving hostile bot exists', sol !== null, sol ? JSON.stringify(sol) : 'none (friendlies excluded by snapshot team join)');
  if (!sol) { open('solo admitted shot', 'no firing solution'); return; }
  await A.page.evaluate(([x, z]) => window.__NT.teleport(x, 0, z), [sol.spot.ax, sol.spot.az]);
  await sleep(400);
  await cfbClear(A.page);
  const shot = await fireShots(A.page, sol.victim.id, 'chest', { bound: 6, stop: 'first-step', kills0: 0, authPage: A.page });
  const first = shot.steps[0] ?? null;
  const value = first?.popup ? cfbParse(first.popup.text) : NaN;
  const hpDelta = first ? first.hpDelta : NaN;
  report.shots.solo = {
    victimId: sol.victim.id, pulls: shot.fired, fired: shot.fired, admitted: shot.admitted,
    rejected: shot.rejected, repositions: shot.repositions, hpDelta, popup: first?.popup ?? null, diag: shot.diag,
  };
  const okPopup = first?.popup != null && Number.isFinite(value) && value > 0 && value <= 100;
  step('solo admitted shot yields a positive finite bounded popup', okPopup,
    JSON.stringify({ value, hpDelta, pulls: shot.fired, admitted: shot.admitted, rejected: shot.rejected, repositions: shot.repositions, cls: first?.popup?.cls, transform: first?.popup?.transform }));
  if (okPopup) {
    if (Number.isFinite(hpDelta)) {
      step('solo popup value equals the admitted HP delta', value === hpDelta,
        `popup=${value} hp ${first.hp0}->${first.hp1} (victim ${sol.victim.id}, this shot only; regen cannot intrude inside the window: REGEN_DELAY_MS 5000 vs 450 ms spacing)`);
    } else open('solo popup-vs-HP equality', 'popup=' + value + ' hpDelta=' + hpDelta);
    step('solo popup sits at the victim, not the crosshair fallback',
      !/cfb-anchored/.test(first.popup.cls ?? '') && /translate\(/.test(first.popup.transform ?? ''),
      JSON.stringify({ cls: first.popup.cls, transform: first.popup.transform }));
    if (!/cfb-crit/.test(first.popup.cls ?? '') && !/cfb-lethal/.test(first.popup.cls ?? '') && first.alive && first.hp1 > 0) {
      step('solo chest shot reads body style (no crit, no lethal while alive)', true, first.popup.cls);
    } else open('solo body style', 'chest-aimed popup class was ' + first.popup.cls + ' (zone evidence is host-internal; see doc)');
    step('popup pool cap holds (<=24)', (await cfbRead(A.page)).count <= 24, 'count via .cfb-layer sweep');
    await A.page.screenshot({ path: join(OUT, TAG + '-solo-hit.png') });
  }
  // S5 (solo): a FRESH popup must be on screen immediately before leave, and
  // leave must clear it before the 900 ms lifetime expires naturally.
  const preLeave = await cfbRead(A.page);
  const ageRef = first?.popup?.t ?? null;
  const freshAge = ageRef !== null ? (await A.page.evaluate(() => performance.now())) - ageRef : Infinity;
  step('a fresh popup is visible immediately before leave', first?.popup != null && preLeave.count > 0 && freshAge < 900,
    `visible=${preLeave.count} age=${Number.isFinite(freshAge) ? Math.round(freshAge) : 'n/a'}ms (lifetime 900)`);
  await A.page.evaluate(() => window.__NTGAME.leave());
  await sleep(250);
  const afterLeave = await cfbRead(A.page);
  const idleMode = await A.page.evaluate(() => window.__NTGAME.mode());
  step('leaving clears visible numbers before natural expiry', first?.popup != null && freshAge < 900 && idleMode === 'idle' && afterLeave.count === 0,
    `mode=${idleMode} remaining=${afterLeave.count} preLeaveAge=${Number.isFinite(freshAge) ? Math.round(freshAge) : 'n/a'}ms`);
}

// ---- scenario: duel (S2/S3 both directions + S4 styles + S6 silence) ----
// One leg of the duel. The shooter fires the REAL trigger at the LIVE REMOTE
// HUMAN; the victim idles through its own controls (no freeze, no injection).
// The peer id is derived from both ends of the actual API and cross-checked
// (victim's own localId === the non-bot stranger the shooter sees); the
// engine pins that id — a nearby bot can never be aimed at.
async function duelLeg(shooter, victim, dirLabel, authPage = null) {
  const want = (await actors(victim.page)).localId;
  const seen = await remoteHumanId(shooter.page);
  if (!want || !seen || want !== seen) {
    open(dirLabel + ' pins the live peer', 'victim localId=' + want + ' shooter sees remote=' + seen + ' (refusing to shoot a stranger)');
    return null;
  }
  const targetId = want;
  const sActors0 = await actors(shooter.page);
  const kills0 = sActors0.counters.kills ?? 0;
  const damage0 = sActors0.counters.damage ?? 0;
  await cfbClear(shooter.page);
  await cfbClear(victim.page);
  // Baseline AFTER the clear: the mirror leg's victim still holds the first
  // leg's records, and a pre-clear baseline reads as negative "new" popups
  // (the CPU mock caught exactly that on the guest-fires leg).
  const vRec0 = (await cfbRecords(victim.page)).length;
  if (!(await placeBesidePeer(shooter, victim))) {
    open(dirLabel + ' firing position', 'no LOS spot beside the live peer');
    return null;
  }
  // Body phase: chest pulls to one admitted HP step (protection waited out
  // by the engine — the duel spawns under SPAWN_PROTECT_MS 1350 too).
  const body = await fireShots(shooter.page, targetId, 'chest', { bound: 10, stop: 'first-step', kills0, authPage });
  await shooter.page.screenshot({ path: join(OUT, TAG + '-' + dirLabel + '.png') });
  // Head/fatal phase: respawn bound, re-place, then head pulls to crit/kill.
  const revived = await waitUntil(() => victim.page.evaluate(() => {
    try {
      const g = window.__NTGAME;
      const s = g.snapshot();
      const me = s.actors.find((a) => a.id === g.localId);
      return me && me.alive ? true : null;
    } catch { return null; }
  }), 12_000);
  let head = { fired: 0, admitted: 0, rejected: 0, repositions: 0, kill: false, crit: false, lethal: [], steps: [], diag: [] };
  if (!revived) open(dirLabel + ' head phase entry', 'victim not alive inside the 12 s bound; head/fatal stays unproven');
  else if (!(await placeBesidePeer(shooter, victim))) open(dirLabel + ' head-phase firing position', 'no LOS spot after respawn; head/fatal stays unproven');
  else {
    await cfbClear(shooter.page);
    head = await fireShots(shooter.page, targetId, 'head', { bound: 10, stop: 'crit-step', kills0, authPage });
  }
  const vActors1 = await actors(victim.page);
  const sActors1 = await actors(shooter.page);
  return {
    targetId, body, head,
    victimNew: (await cfbRecords(victim.page)).length - vRec0,
    dmgDelta: (sActors1.counters.damage ?? 0) - damage0,
    killsDelta: (sActors1.counters.kills ?? 0) - kills0,
    victimAlive: (vActors1.rows.find((r) => r.id === vActors1.localId)?.alive) ?? null,
  };
}
// ONE assertion block per duel leg — the host leg of repair2 lost its
// `const b = ...` binding and crashed after a real kill. Both directions now
// share this block; the mirror leg reports crit/kill without asserting them
// (lethal is already covered once) and is otherwise identical.
function assertDuelLeg(leg, dirLabel, victimNoun, mirror) {
  const b = leg.body.steps[0] ?? null;
  const bValue = b?.popup ? cfbParse(b.popup.text) : NaN;
  const bDelta = b ? b.hpDelta : NaN;
  const headHpDelta = leg.head.steps.reduce((s, x) => s + (Number.isFinite(x.hpDelta) ? x.hpDelta : 0), 0);
  const kill = leg.body.kill || leg.head.kill;
  const lethal = [...leg.body.lethal, ...leg.head.lethal];
  report.shots[dirLabel === 'host-fires' ? 'hostFires' : 'guestFires'] = {
    targetId: leg.targetId,
    body: { fired: leg.body.fired, admitted: leg.body.admitted, rejected: leg.body.rejected, repositions: leg.body.repositions, hpDelta: bDelta, popup: b?.popup ?? null, diag: leg.body.diag },
    head: { fired: leg.head.fired, admitted: leg.head.admitted, rejected: leg.head.rejected, repositions: leg.head.repositions, hpDelta: headHpDelta, crit: leg.head.crit, kill, lethal: lethal.slice(-2), diag: leg.head.diag },
    victimNew: leg.victimNew, dmgDelta: leg.dmgDelta, killsDelta: leg.killsDelta,
  };
  step(dirLabel + ' fires the real weapon and ' + victimNoun + ' HP drops (body phase)',
    leg.body.fired > 0 && Number.isFinite(bDelta) && bDelta > 0,
    `${leg.body.fired} chest pulls at ${leg.targetId}, ${victimNoun} hp ${b ? b.hp0 : '?'}->${b ? b.hp1 : '?'} (delta ${bDelta}) admitted=${leg.body.admitted} rejected=${leg.body.rejected} repositions=${leg.body.repositions}`);
  step(dirLabel + ' shows its own outgoing popup only', b?.popup != null && Number.isFinite(bValue) && bValue > 0,
    JSON.stringify(b?.popup ?? null));
  step(victimNoun + ' shows no outgoing damage text for incoming fire', leg.victimNew === 0,
    victimNoun + ' new popups=' + leg.victimNew + ' (incoming damage is nonlocal to the victim)');
  if (b?.popup != null && Number.isFinite(bDelta) && b.newPopups === 1) {
    step(dirLabel + ' popup value equals the admitted ' + victimNoun + ' HP step', bValue === bDelta,
      `popup=${bValue} delta=${bDelta} (this chest pull only)`);
  } else open(dirLabel + ' popup-vs-HP equality', `popup=${bValue} hpDelta=${bDelta} newInWindow=${b?.newPopups ?? 'n/a'} (equality only claimed for one popup in one pull window)`);
  if (b?.popup && !/cfb-crit/.test(b.popup.cls ?? '') && !/cfb-lethal/.test(b.popup.cls ?? '') && b.alive && b.hp1 > 0) {
    step(dirLabel + ' body phase reads body style (no crit, no lethal while alive)', true, b.popup.cls);
  } else open(dirLabel + ' body style', 'chest-aimed popup class was ' + (b?.popup?.cls ?? 'none') + ' (zone evidence is host-internal; see doc)');
  if (leg.head.crit) {
    step('head-aimed window produced a critical style', true, 'cfb-crit observed through the real ' + dirLabel + ' path');
  } else if (mirror) say('mirror leg produced no crit inside the bound — reported, not asserted');
  else open('critical style from a real headshot', 'no cfb-crit inside the 10-pull head window; zone is host-internal (see doc), not guessed');
  if (kill) {
    step('real kill carries the fatal class', lethal.length > 0, JSON.stringify(lethal.slice(-2)));
  } else if (mirror) say('mirror leg produced no kill inside the bound — non-fatal proof stands, lethal already covered above');
  else open(dirLabel + ' kill with fatal class', 'no kill inside the 10-pull head bound; lethal stays unproven, not green');
}
async function scenarioDuel(A, onRegisterB, stockBrowserFn = stockBrowser) {
  // Fresh qa tags: __NTGAME.leave() (solo leg above) tears down to idle
  // without a menu transition, so a reused URL may reshow an
  // attached-but-invisible Multiplayer (root r1's 15 s timeout).
  // Register owned B to outer cleanup immediately after launch to eliminate leak on failure.
  const B = await stockBrowserFn('cfb-live-B');
  if (onRegisterB) onRegisterB(B);
  errorsB = pageErrors(B);
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
  if (left() > 30_000) {
    const hg = await duelLeg(A, B, 'host-fires', A.page);
    if (hg) assertDuelLeg(hg, 'host-fires', 'guest', false);
    // Revive the guest before the mirror leg (bounded by the overall cap).
    await waitUntil(() => B.page.evaluate(() => {
      try {
        const g = window.__NTGAME;
        const s = g.snapshot();
        const me = s.actors.find((a) => a.id === g.localId);
        return me && me.alive ? true : null;
      } catch { return null; }
    }), 12_000);
  } else open('host fires at guest', 'overall 150 s budget exhausted before the leg');
  if (left() > 25_000) {
    const gh = await duelLeg(B, A, 'guest-fires', A.page);
    if (gh) assertDuelLeg(gh, 'guest-fires', 'host', true);
  } else open('guest fires at host', 'overall 150 s budget exhausted before the leg');
  return { B, errorsB };
}

let A = null, B = null;
let errorsA = [], errorsB = [];

async function run() {
  try {
    if (!['solo', 'duel', 'all'].includes(SCENARIO)) throw new Error('bad --scenario "' + SCENARIO + '" (solo|duel|all)');
    if (/127\.0\.0\.1:4188|localhost:4188/.test(CANDIDATE)) throw new Error('refusing stale default 4188: ' + CANDIDATE);
    if (left() <= 0) throw new Error('overall budget already spent before start');
    mkdirSync(OUT, { recursive: true });
    const disk0 = distAsset();
    step('dist-next bundle present on disk', disk0.exists, JSON.stringify(disk0));
    if (!disk0.exists) throw new Error('build first: ' + DIST_DIR + '/index.html names no index-*.js asset');
    report.distDir = DIST_DIR;

    // ---- peer A: identity always; solo scenario first, then reused as host ----
    A = await stockBrowser('cfb-live-A');
    errorsA = pageErrors(A);
    const url = cacheBusted(CANDIDATE);
    await ready(A.page, url);
    step('candidate page ready (real game loop)', true, CANDIDATE + ' dist=' + DIST_DIR);
    const be = await backend(A.page);
    step('installed backend is WebGPU', be.report?.actual === 'webgpu' && be.canvas === 'webgpu', JSON.stringify(be));
    const bun = await bundle(A.page);
    step('no stale build (loaded bundle matches ' + DIST_DIR + ')', bun.bundle === disk0.asset, 'page=' + bun.bundle + ' disk=' + disk0.asset);
    if (bun.bundle !== disk0.asset) throw new Error('stale build: reload the candidate and rerun');
    const live = await liveAssetBytes(disk0.asset);
    step('live JS matches ' + DIST_DIR + ' on disk (SHA256)', live.ok && live.sha256 !== null && live.sha256 === disk0.sha256,
      'live sha256=' + live.sha256 + ' disk sha256=' + disk0.sha256 + ' bytes=' + live.bytes + '/' + disk0.bytes + ' asset=' + disk0.asset);
    if (!(await installCfbObserver(A.page))) open('cfb observer installs on #hud', 'no #hud at ready');
    await cfbClear(A.page);

    if (SCENARIO !== 'duel') await scenarioSolo(A);
    if (SCENARIO !== 'solo') {
      const duel = await scenarioDuel(A, (peerB) => { B = peerB; });
      if (!B) B = duel.B;
      report.errors = { A: errorsA.slice(0, 8), B: errorsB.slice(0, 8) };
    } else report.errors = { A: errorsA.slice(0, 8), B: [] };

    const disk1 = distAsset();
    step('no sibling rebuild mid-run (' + DIST_DIR + '/assets mtime stable)', disk1.mtime === disk0.mtime && disk1.asset === disk0.asset && disk1.sha256 === disk0.sha256,
      disk0.asset + ' mtime ' + disk0.mtime + ' -> ' + disk1.mtime);
    const capA = await cfbRead(A.page);
    const capB = B ? await cfbRead(B.page) : { count: 0 };
    step('popup pool cap holds on every launched peer (<=24)', capA.count <= 24 && capB.count <= 24,
      `A=${capA.count} B=${B ? capB.count : 'not-launched'}`);
    step('every launched stock Chrome stayed free of console/page errors',
      errorsA.length === 0 && (!B || errorsB.length === 0), JSON.stringify(report.errors));
  } catch (error) {
    // An exception still collects whatever evidence exists — console/page
    // errors, one failure screenshot per live peer, authoritative counters —
    // inside the same 150 s budget, then the finally below closes both Chromes.
    say('EXCEPTION ' + String(error).slice(0, 500));
    try { report.errors = { A: errorsA.slice(0, 8), B: errorsB.slice(0, 8) }; } catch { report.errors = { note: 'error-list-unreadable' }; }
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
    try {
      if (A) {
        const peerA = A;
        A = null;
        await peerA.close();
      }
    } catch (e) { say('A cleanup ' + String(e).slice(0, 160)); code = 1; }
    try {
      if (B) {
        const peerB = B;
        B = null;
        await peerB.close();
      }
    } catch (e) { say('B cleanup ' + String(e).slice(0, 160)); code = 1; }
    report.exitCode = code;
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.now() - T0;
    report.log = log;
    try { mkdirSync(OUT, { recursive: true }); writeFileSync(report.resultPath, JSON.stringify(report, null, 2) + '\n', 'utf8'); } catch (e) { say('report persistence ' + String(e).slice(0, 240)); code = 1; }
    console.log(JSON.stringify(report));
  }
  process.exit(code);
}

export {
  scenarioSolo,
  scenarioDuel,
  duelLeg,
  assertDuelLeg,
  fireShots,
  protectionWait,
  aimAt,
  firingSolution,
  pullTrigger,
  reposition,
  placeBesidePeer,
  openMultiplayer,
  actors,
  remoteHumanId,
  cfbRead,
  cfbRecords,
  cfbClear,
  cfbParse,
  distAsset,
  liveAssetBytes,
  run,
  report,
  step,
  open,
};

const isDirectRun = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isDirectRun) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
