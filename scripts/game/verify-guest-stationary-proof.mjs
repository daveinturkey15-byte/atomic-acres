/**
 * Nuketown 2025 — guest-stationary proof for floating combat text (source-only).
 *
 * Owner: Muse Spark 1.3 Contributor, bounded lane `nuketown-combat-feedback-20260919`.
 * Sole-owner file: this proof. No game source, no existing gate, no other worktree
 * changed. No browser, GPU, or server launched in this worker; root alone runs it.
 *
 * Directive: `nuketown-recovery-20260919/docs/orchestration/overnight-20260919/
 * muse-guest-stationary-proof.md`. Prior GLM guest-position run timed out; root ran it
 * (`captures/cfb-live/cfb-duel-2052-1789847206006-result.json` in the recovery lane):
 * host body/crit/kill passed again, guest walked 7.53 m with host agreement exactly
 * (approvedDiv 0) but stopped at (-3.83, 26.86) and all 20 pulls ended `no-los-spot`
 * with zero trigger pulls. The two-repair budget for that placement approach is
 * exhausted. This file does NOT touch the walking/reposition loop in
 * `verify-combat-feedback-live.mjs` (no `walkTo`, no `placeBesidePeer`, no
 * `reposition` import/call here); it is a SMALL separately selectable proof.
 *
 * Approach: the guest stays STATIONARY at its real host-approved position for the
 * whole firing phase. The HOST-CONTROLLED target moves through the existing supported
 * host QA teleport (`__NT.teleport`, the same surface `soak.mjs` and the host leg of
 * `placeBesidePeer` use) to a nearby collider-free point with real eye-height LOS to
 * the guest. Poses settle (400 ms, the `_verify-net-refinement.mjs` pattern), the
 * guest aims by angle-only teleport (x/z unchanged, so the guest reconcile loop in
 * `src/net/match-guest.ts` never sees divergence), then fires the REAL guest weapon
 * (`__NT.weaponCmd('fire')`). Host HP and the outgoing guest popup are read from live
 * surfaces only. Strict damage/admission/HP/popup/crit/silence thresholds match
 * `docs/combat-browser-proof.md` exactly. No fabricated snapshots/events/damage/input
 * datachannel; no game/network edits; LOS and spawn-protection gates unweakened.
 * Honestly FAILS (non-zero exit) when host placement or guest shooting does not work.
 *
 * Reference geometry from the preserved partial (report-only, never an input):
 * host firing line (-3.58, 24.40) -> victim (-3.58, 18.40), dist 6 m, LOS true;
 * guest stationary candidate (-3.83, 26.86), host-approved exactly (approvedDiv 0).
 * This proof records its own actual coordinates at runtime in `report.placement`.
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
const TAG = String(opt('tag', 'cfb-guest-stationary') + '-' + Date.now());
const OUT = join(ROOT, 'captures', 'cfb-live');
const OVERALL_MS = 150_000;
const T0 = Date.now();
const left = () => OVERALL_MS - (Date.now() - T0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { candidate: CANDIDATE, signalUrl: SIGNAL_URL, scenario: 'guest-stationary', tag: TAG, steps: [], open: [], errors: {}, shots: {}, placement: null, resultPath: join(OUT, TAG + '-result.json') };
let code = 0;
const log = [];
function say(line) { const t = '[cfb-guest-stationary] ' + line; console.log(t); log.push(t); }
function step(name, ok, detail) {
  report.steps.push({ name, state: ok ? 'VERIFIED' : 'FAIL', detail });
  say((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) code = 1;
}
function open(name, detail) {
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

// ---- focused placement gate (pure; CPU-tested without browsers) ----
// Blocked spots, unknown poses, missing LOS, and host/guest disagreement can never
// pass. Mirrors the live checks below; the live path re-evaluates every field from
// real surfaces and never trusts these defaults.
export function hostSpotAccepts({ blocked, losChest, losHead, approvedDiv, guestKnown, hostSeen }) {
  if (guestKnown !== true) return { ok: false, reason: 'unknown-guest-pose' };
  if (hostSeen !== true) return { ok: false, reason: 'unknown-host-pose' };
  if (blocked) return { ok: false, reason: 'blocked' };
  if (!losChest || !losHead) return { ok: false, reason: 'no-los' };
  if (approvedDiv !== null && approvedDiv > 1.5) return { ok: false, reason: 'no-agreement' };
  return { ok: true };
}

function distAsset(dir = DIST_DIR) {
  try {
    const html = readFileSync(join(ROOT, dir, 'index.html'), 'utf8');
    const m = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    const asset = m ? m[1] : null;
    let mtime = 0;
    try { mtime = statSync(join(ROOT, dir, 'assets')).mtimeMs; } catch { /* reported below */ }
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
  const res = await fetch(new URL('assets/' + asset, CANDIDATE).href, { cache: 'no-store' });
  if (!res.ok) return { ok: false, bytes: -1, sha256: null };
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

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
  const budget = Math.max(1_000, Math.min(60_000, left()));
  await page.goto(url, { waitUntil: 'load', timeout: budget });
  await page.waitForFunction(() => window.__NT?.ready === true && window.__AA_UI && window.__NTGAME, null, { timeout: Math.max(1_000, Math.min(60_000, left())) });
}
async function wf(page, fn, timeoutMs, arg = null) {
  return page.waitForFunction(fn, arg, { timeout: Math.max(1_000, Math.min(timeoutMs, left())) });
}
const T = (ms) => Math.max(1_000, Math.min(ms, left()));
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
    rows: s.actors.map((a) => ({ id: a.id, team: a.team, bot: a.bot, hp: a.hp, alive: a.alive, life: a.life ?? null, protectedUntil: a.protectedUntil ?? null })),
    counters: g.counters(),
    rejects: (() => { try { return g.log().filter((l) => /shot-reject/.test(l)).slice(-4); } catch { return []; } })(),
  };
});
const remoteHumanId = (page) => page.evaluate(() => {
  const g = window.__NTGAME;
  const rows = g.snapshot().actors;
  const hit = rows.find((a) => !a.bot && a.id !== g.localId);
  return hit ? hit.id : null;
});
const probePos = (page) => page.evaluate(() => {
  const p = window.__NT.probePos();
  return { x: +p[0].toFixed(2), y: +(p[1] ?? 0).toFixed(2), z: +p[2].toFixed(2), eyeY: +((p[1] ?? 0) + 1.68).toFixed(2) };
});
const bodyAt = (page, id) => page.evaluate((vid) => {
  const b = (window.__NTGAME.bots() ?? []).find((x) => x.id === vid);
  return b ? { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), alive: b.alive } : null;
}, id);

// Aim by angle controls only: x/z preserved, so the guest reconcile loop never sees
// divergence (net/match-guest.ts snaps past GUEST_SNAP_M 1.0 m). Records drift so the
// stationary claim is measured, not asserted.
async function aimAtStationary(page, victimId, kind = 'chest') {
  const before = await probePos(page);
  const r = await page.evaluate(({ only, k }) => {
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
    return { aimed: true, victimId: only, dist: +Math.hypot(dx, dz).toFixed(2), los, body: { x: +body.x.toFixed(2), y: +body.y.toFixed(2), z: +body.z.toFixed(2) },
      shooter: { x: +me[0].toFixed(2), y: +me[1].toFixed(2), z: +me[2].toFixed(2), eyeY: +ey.toFixed(2) }, endpointY: +ty.toFixed(2) };
  }, { only: victimId, k: kind });
  const after = await probePos(page);
  const drift = +Math.hypot(after.x - before.x, after.z - before.z).toFixed(3);
  return { ...r, drift, before, after };
}

async function pullTrigger(page) {
  return page.evaluate(() => {
    const q = window.__NT;
    const g = window.__NTGAME;
    let st0 = null;
    try { st0 = q.weaponCmd('state'); } catch { st0 = null; }
    if (st0 && (st0.mag ?? 1) <= 0) { try { q.weaponCmd('refill'); } catch { /* best-effort */ } }
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

// Move the HOST (authoritative; teleport supported) to a collider-free spot near the
// STATIONARY guest with real LOS at BOTH firing endpoints (chest feet+1.0, head
// feet+1.65). Bounded to 10 offset probes and 3 teleport agreements. The guest never
// moves here. Returns { ok, placement } with actual coordinates and LOS endpoints.
const HOST_OFFSETS = [[0, 6], [6, 0], [0, -6], [-6, 0], [4, 4], [-4, 4], [4, -4], [-4, -4], [0, 9], [9, 0]];
async function placeHostNearGuest(hostPage, guestPage, authPage, guestPos) {
  const placement = { guest: guestPos, tried: [] };
  const cands = await guestPage.evaluate(([gx, gz, gy]) => {
    const g = window.__NTGAME;
    const out = [];
    for (const [dx, dz] of [[0, 6], [6, 0], [0, -6], [-6, 0], [4, 4], [-4, 4], [4, -4], [-4, -4], [0, 9], [9, 0]]) {
      const ax = gx + dx, az = gz + dz;
      const blocked = window.__NT.collidersAt(ax, az, 1.0).length > 0;
      const losChest = g.los(gx, gy + 1.68, gz, ax, 1.0, az);
      const losHead = g.los(gx, gy + 1.68, gz, ax, 1.65, az);
      out.push({ ax: +ax.toFixed(2), az: +az.toFixed(2), blocked, losChest, losHead });
    }
    return out;
  }, [guestPos.local.x, guestPos.local.z, guestPos.local.y]);
  for (const c of cands) {
    const gate = hostSpotAccepts({ blocked: c.blocked, losChest: c.losChest, losHead: c.losHead, approvedDiv: null, guestKnown: guestPos.known, hostSeen: true });
    if (!gate.ok) { placement.tried.push({ spot: { ax: c.ax, az: c.az }, gate }); continue; }
    const hostBlocked = await hostPage.evaluate(([x, z]) => window.__NT.collidersAt(x, z, 1.0).length > 0, [c.ax, c.az]);
    if (hostBlocked) { placement.tried.push({ spot: { ax: c.ax, az: c.az }, gate: { ok: false, reason: 'host-blocked' } }); continue; }
    await hostPage.evaluate(([x, z]) => window.__NT.teleport(x, 0, z), [c.ax, c.az]);
    await sleep(400);
    const hostLocal = await probePos(hostPage);
    const hostId = (await actors(hostPage)).localId;
    const hostSeen = await bodyAt(guestPage, hostId);
    const guestStill = await probePos(guestPage);
    const guestApproved = await bodyAt(authPage, guestPos.id);
    const hostDiv = hostSeen ? +Math.hypot(hostSeen.x - hostLocal.x, hostSeen.z - hostLocal.z).toFixed(2) : null;
    const guestDiv = guestApproved ? +Math.hypot(guestApproved.x - guestStill.x, guestApproved.z - guestStill.z).toFixed(2) : null;
    const guestDrift = +Math.hypot(guestStill.x - guestPos.local.x, guestStill.z - guestPos.local.z).toFixed(2);
    const agree = hostSpotAccepts({ blocked: false, losChest: c.losChest, losHead: c.losHead, approvedDiv: hostDiv, guestKnown: guestApproved !== null, hostSeen: hostSeen !== null });
    const tried = { spot: { ax: c.ax, az: c.az }, gate: { ok: true }, hostLocal, hostSeen, hostDiv, guestStill, guestApproved, guestDiv, guestDrift,
      endpoints: { guestEyeY: guestStill.eyeY, chestY: 1.0, headY: 1.65 } };
    placement.tried.push(tried);
    if (!agree.ok) continue;
    if (guestDiv !== null && guestDiv > 1.5) continue;
    if (guestDrift > 1.0) continue;
    return { ok: true, placement: { ...placement, chosen: tried, hostId } };
  }
  return { ok: false, placement };
}

// Stationary firing engine: the guest NEVER repositions and the host NEVER moves
// mid-phase. LOS loss is recorded honestly (`no-los-no-reposition`, zero pulls) —
// never repaired by movement. Life epoch and HP clock tracked as in the duel engine.
async function fireStationary(shooterPage, victimId, kind, { bound, stop, gateMs = 15_000, kills0, authPage }) {
  const auth = authPage ?? shooterPage;
  const diag = [], steps = [], lethal = [];
  let fired = 0, admitted = 0, rejected = 0, kill = false, crit = false, killsSeen = kills0, maxDrift = 0;
  for (let i = 0; i < bound && left() > gateMs && !kill; i++) {
    const pre = await actors(auth);
    const vb = pre.rows.find((r) => r.id === victimId) ?? null;
    if (vb && !vb.alive) { diag.push({ pull: i, skip: 'victim-dead' }); break; }
    const prot = await protectionWait(shooterPage, victimId, 2_500, auth);
    if (prot.known && !prot.off) { diag.push({ pull: i, skip: 'still-protected', protWaitedMs: prot.waited }); continue; }
    let aim = await aimAtStationary(shooterPage, victimId, kind);
    maxDrift = Math.max(maxDrift, aim.drift ?? 0);
    if (!aim.aimed) { diag.push({ pull: i, aimed: false, reason: aim.reason }); break; }
    if (!aim.los) { diag.push({ pull: i, los: false, repositioned: false, reason: 'no-los-no-reposition', dist: aim.dist }); continue; }
    await sleep(150);
    aim = await aimAtStationary(shooterPage, victimId, kind);
    maxDrift = Math.max(maxDrift, aim.drift ?? 0);
    if (!aim.los) { diag.push({ pull: i, los: false, repositioned: false, reason: 'no-los-after-pose-wait', dist: aim.dist }); continue; }
    const prePull = await actors(auth);
    const targetPre = prePull.rows.find((r) => r.id === victimId) ?? null;
    if (!targetPre || !targetPre.alive) { diag.push({ pull: i, skip: 'victim-dead-pre-pull' }); break; }
    const hp0 = targetPre.hp ?? null;
    const life0 = targetPre.life ?? null;
    const clock0 = prePull.at ?? null;
    const rec0 = (await cfbRecords(shooterPage)).length;
    const r = await pullTrigger(shooterPage);
    if (r.fired) fired++;
    admitted += r.triggerAdmitted ?? 0;
    rejected += r.rejectDelta ?? 0;
    await sleep(320);
    const post = await actors(auth);
    const targetPost = post.rows.find((x) => x.id === victimId) ?? null;
    const recs = await cfbRecords(shooterPage);
    const fresh = recs.slice(rec0);
    const hp1 = targetPost?.hp ?? null;
    const life1 = targetPost?.life ?? null;
    const clock1 = post.at ?? null;
    let delta = NaN;
    if (hp0 !== null && hp1 !== null) {
      if (life0 === life1) delta = hp0 - hp1;
      else if (life0 !== null && life1 !== null && life1 > life0) delta = hp0;
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
      steps.push({ hp0, hp1, hpDelta: delta, life0, life1, clock0, clock1,
        popup: fresh.length ? fresh[fresh.length - 1] : null, newPopups: fresh.length, alive: targetPost?.alive ?? false });
    }
    diag.push({ pull: i, kind, dist: aim.dist, los: aim.los, drift: aim.drift, protWaitedMs: prot.waited, protKnown: prot.known,
      shooter: aim.shooter ?? null, victim: aim.body ?? null, endpointY: aim.endpointY ?? null,
      fired: r.fired, admitted: r.triggerAdmitted, mag: r.mag, cool: r.cool, reloading: r.reloading,
      hp0, hp1, hpDelta: delta, life0, life1, clock0, clock1, dmgDelta: r.dmgDelta, rejectDelta: r.rejectDelta, rejects: r.rejects,
      newPopups: fresh.length, popups: fresh.slice(-2).map((p) => ({ text: p.text, cls: p.cls })) });
    if (stop === 'first-step' && steps.length > 0) break;
    if (stop === 'crit-step' && crit && steps.length > 0 && left() < 25_000) break;
    await sleep(130);
  }
  return { fired, admitted, rejected, kill, crit, lethal, steps, diag, maxDrift };
}

async function scenarioGuestStationary(A, B) {
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
  const hostId = await A.page.evaluate(() => window.__NTGAME.localId);
  step('Start transitions A to host and B to guest', !!guestId && !!hostId, 'guest=' + guestId + ' host=' + hostId);
  await Promise.all([
    wf(A.page, () => window.__NTGAME.snapshot().match.phase === 'active', 20_000),
    wf(B.page, () => { try { return window.__NTGAME.snapshot().match.phase === 'active'; } catch (e) { if (String(e).includes('guest has no match line yet')) return false; throw e; } }, 20_000),
  ]);
  await sleep(500);
  await installCfbObserver(A.page);
  await installCfbObserver(B.page);

  // Pin the peers by cross-checked live ids (never a nearby bot).
  const wantHost = (await actors(A.page)).localId;
  const seenFromGuest = await remoteHumanId(B.page);
  if (!wantHost || !seenFromGuest || wantHost !== seenFromGuest) {
    open('guest-stationary pins the live host', 'host localId=' + wantHost + ' guest sees remote=' + seenFromGuest);
    return;
  }
  const targetId = wantHost;

  // Guest STATIONARY anchor: real spawn position plus host-approved readback.
  const gLocal = await probePos(B.page);
  const gApproved = await bodyAt(A.page, guestId);
  const gDiv = gApproved ? +Math.hypot(gApproved.x - gLocal.x, gApproved.z - gLocal.z).toFixed(2) : null;
  const guestPos = { id: guestId, local: gLocal, approved: gApproved, approvedDiv: gDiv, known: gApproved !== null };
  step('guest stationary anchor is host-approved', guestPos.known && gDiv !== null && gDiv <= 1.5,
    JSON.stringify({ local: gLocal, approved: gApproved, approvedDiv: gDiv }));
  if (!guestPos.known || gDiv === null || gDiv > 1.5) {
    open('guest-stationary firing position', 'no host-approved guest anchor: ' + JSON.stringify(guestPos).slice(0, 300));
    return;
  }

  const sActors0 = await actors(B.page);
  const kills0 = sActors0.counters.kills ?? 0;
  const damage0 = sActors0.counters.damage ?? 0;
  await cfbClear(A.page);
  await cfbClear(B.page);
  const vRec0 = (await cfbRecords(A.page)).length;

  // Move the HOST target near the stationary guest (guest never moves).
  const placed = await placeHostNearGuest(A.page, B.page, A.page, guestPos);
  report.placement = placed.placement;
  step('host target placed near the stationary guest with LOS', placed.ok,
    placed.ok ? JSON.stringify(placed.placement.chosen) : JSON.stringify(placed.placement.tried ?? []).slice(0, 500));
  if (!placed.ok) {
    open('guest-stationary host placement', 'no agreed collider-free LOS spot near the stationary guest');
    return;
  }

  const body = await fireStationary(B.page, targetId, 'chest', { bound: 10, stop: 'first-step', kills0, authPage: A.page });
  await B.page.screenshot({ path: join(OUT, TAG + '-guest-stationary-body.png') });
  const revived = await waitUntil(() => A.page.evaluate(() => {
    try {
      const g = window.__NTGAME;
      const s = g.snapshot();
      const me = s.actors.find((a) => a.id === g.localId);
      return me && me.alive ? true : null;
    } catch { return null; }
  }), 12_000);
  let head = { fired: 0, admitted: 0, rejected: 0, kill: false, crit: false, lethal: [], steps: [], diag: [], maxDrift: 0 };
  if (!revived) open('guest-stationary head phase entry', 'host not alive inside the 12 s bound; head/fatal stays unproven');
  else {
    await cfbClear(B.page);
    head = await fireStationary(B.page, targetId, 'head', { bound: 10, stop: 'crit-step', kills0, authPage: A.page });
  }
  await B.page.screenshot({ path: join(OUT, TAG + '-guest-stationary-head.png') });
  const vActors1 = await actors(A.page);
  const sActors1 = await actors(B.page);
  const leg = { targetId, body, head,
    victimNew: (await cfbRecords(A.page)).length - vRec0,
    dmgDelta: (sActors1.counters.damage ?? 0) - damage0,
    killsDelta: (sActors1.counters.kills ?? 0) - kills0,
    victimAlive: (vActors1.rows.find((r) => r.id === vActors1.localId)?.alive) ?? null };
  report.shots.guestStationary = { targetId: leg.targetId,
    body: { fired: leg.body.fired, admitted: leg.body.admitted, rejected: leg.body.rejected, maxDrift: leg.body.maxDrift,
      hpDelta: leg.body.steps[0]?.hpDelta ?? NaN, popup: leg.body.steps[0]?.popup ?? null, diag: leg.body.diag },
    head: { fired: leg.head.fired, admitted: leg.head.admitted, rejected: leg.head.rejected, maxDrift: leg.head.maxDrift,
      hpDelta: leg.head.steps.reduce((s, x) => s + (Number.isFinite(x.hpDelta) ? x.hpDelta : 0), 0),
      crit: leg.head.crit, kill: leg.body.kill || leg.head.kill, lethal: [...leg.body.lethal, ...leg.head.lethal].slice(-2), diag: leg.head.diag },
    victimNew: leg.victimNew, dmgDelta: leg.dmgDelta, killsDelta: leg.killsDelta, placement: placed.placement };

  const b = leg.body.steps[0] ?? null;
  const bValue = b?.popup ? cfbParse(b.popup.text) : NaN;
  const bDelta = b ? b.hpDelta : NaN;
  const headHpDelta = leg.head.steps.reduce((s, x) => s + (Number.isFinite(x.hpDelta) ? x.hpDelta : 0), 0);
  const kill = leg.body.kill || leg.head.kill;
  const lethal = [...leg.body.lethal, ...leg.head.lethal];
  step('stationary guest fires the real weapon and host HP drops (body phase)',
    leg.body.fired > 0 && Number.isFinite(bDelta) && bDelta > 0,
    `${leg.body.fired} chest pulls at ${leg.targetId}, host hp ${b ? b.hp0 : '?'}->${b ? b.hp1 : '?'} (delta ${bDelta}) admitted=${leg.body.admitted} rejected=${leg.body.rejected} maxDrift=${leg.body.maxDrift}`);
  step('stationary guest shows its own outgoing popup only', b?.popup != null && Number.isFinite(bValue) && bValue > 0,
    JSON.stringify(b?.popup ?? null));
  step('host shows no outgoing damage text for incoming fire', leg.victimNew === 0,
    'host new popups=' + leg.victimNew + ' (incoming damage is nonlocal to the victim)');
  if (b?.popup != null && Number.isFinite(bDelta) && b.newPopups === 1) {
    step('stationary-guest popup value equals the admitted host HP step', bValue === bDelta,
      `popup=${bValue} delta=${bDelta} (this chest pull only)`);
  } else open('stationary-guest popup-vs-HP equality', `popup=${bValue} hpDelta=${bDelta} newInWindow=${b?.newPopups ?? 'n/a'}`);
  if (b?.popup && !/cfb-crit/.test(b.popup.cls ?? '') && !/cfb-lethal/.test(b.popup.cls ?? '') && b.alive && b.hp1 > 0) {
    step('stationary-guest body phase reads body style (no crit, no lethal while alive)', true, b.popup.cls);
  } else open('stationary-guest body style', 'chest-aimed popup class was ' + (b?.popup?.cls ?? 'none'));
  step('guest never walked (angle-only aim, drift <= 1.0 m)', (leg.body.maxDrift ?? 99) <= 1.0 && (leg.head.maxDrift ?? 99) <= 1.0,
    `bodyDrift=${leg.body.maxDrift} headDrift=${leg.head.maxDrift} (reconcile snap bound 1.0 m)`);
  if (leg.head.crit) step('head-aimed window produced a critical style', true, 'cfb-crit observed through the real stationary-guest path');
  else open('critical style from a real stationary-guest headshot', 'no cfb-crit inside the 10-pull head window');
  if (kill) step('real kill carries the fatal class', lethal.length > 0, JSON.stringify(lethal.slice(-2)));
  else open('stationary-guest kill with fatal class', 'no kill inside the 10-pull head bound; lethal stays unproven, not green');
}

let A = null, B = null;
let errorsA = [], errorsB = [];

async function run() {
  try {
    if (/127\.0\.0\.1:4188|localhost:4188/.test(CANDIDATE)) throw new Error('refusing stale default 4188: ' + CANDIDATE);
    if (left() <= 0) throw new Error('overall budget already spent before start');
    mkdirSync(OUT, { recursive: true });
    const disk0 = distAsset();
    step('dist-next bundle present on disk', disk0.exists, JSON.stringify(disk0));
    if (!disk0.exists) throw new Error('build first: ' + DIST_DIR + '/index.html names no index-*.js asset');
    report.distDir = DIST_DIR;

    A = await stockBrowser('cfb-gs-A');
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

    B = await stockBrowser('cfb-gs-B');
    errorsB = pageErrors(B);
    try {
      await scenarioGuestStationary(A, B);
      report.errors = { A: errorsA.slice(0, 8), B: errorsB.slice(0, 8) };
    } catch (e) {
      say('SCENARIO EXCEPTION ' + String(e).slice(0, 500));
      try { report.errors = { A: errorsA.slice(0, 8), B: errorsB.slice(0, 8) }; } catch { report.errors = { note: 'error-list-unreadable' }; }
      code = 1;
    }

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
    try { if (A) { const p = A; A = null; await p.close(); } } catch (e) { say('A cleanup ' + String(e).slice(0, 160)); code = 1; }
    try { if (B) { const p = B; B = null; await p.close(); } } catch (e) { say('B cleanup ' + String(e).slice(0, 160)); code = 1; }
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
  scenarioGuestStationary,
  fireStationary,
  placeHostNearGuest,
  aimAtStationary,
  protectionWait,
  pullTrigger,
  openMultiplayer,
  actors,
  remoteHumanId,
  bodyAt,
  probePos,
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
