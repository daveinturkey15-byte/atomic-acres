/**
 * Semtex live-proof analysis — PURE. No DOM, no clock, no I/O; the browser
 * harness (`scripts/_verify-semtex-live.mjs`) feeds it the sampled projection
 * frames and the QA event-log tail, and the CPU falsifier
 * (`scripts/_verify-semtex-live-analysis.mjs`) feeds it synthetic runs. One
 * module, two callers, so the acceptance logic cannot drift between them.
 *
 * What a run must show, all through the read-only `qa()` projection
 * (`patches/0001-qa-flight-projection.patch`) and the client's own event log —
 * never through counts of unrelated bot grenades:
 *
 *   own-flight-appeared      exactly one OWN semtex flight (ownerId === selfId,
 *                            grenadeId 'semtex', sticky as the table says)
 *   first-contact            a resting edge strictly after release, inside the
 *                            release + fuse + SEMTEX ceiling
 *   stationary-3-frames      >= 3 DISTINCT rAF frames after that edge with the
 *                            same id and the same position within tolerance —
 *                            the "stuck stationary" proof the flight COUNT
 *                            could never give
 *   single-throw-single-id   one own thrown line, one id, and the id never
 *                            comes back after it retires (no duplicate throw)
 *   inventory-consumed       the tactical pouch 1 -> 0 across the window,
 *                            armed 'semtex' between arm and release, null
 *                            after; respawn inside the window poisons it and
 *                            is reported, never papered over
 *   detonated-exactly-once   one own `grenade-detonated` line for that id
 *   fuse-from-stick          detonation timestamp - first-contact timestamp
 *                            inside fuse +/- tolerance (the fuse is rewritten
 *                            at the stick by the host; a flight-ceiling
 *                            detonation lands far outside and fails here)
 *   detonated-at-stuck-point the detonation coordinates are the stuck
 *                            coordinates — the casing that stopped is the one
 *                            that went off
 *   blast-smoke-announced    a `smoke-volume ... blast` line after the
 *                            detonation — the after-effect on the bus
 *
 * Timestamps: host events and the sampler both stamp `performance.now()` in
 * the page (grenades.ts calls it "the host clock domain"), so differences are
 * same-clock. Tolerances cover one presentation frame of stick-observation
 * latency, event routing, and the log's toFixed rounding — nothing else.
 */

/** src/game/ordnance.ts GRENADES:semtex.fuseMs — fuse rewritten at the stick. */
export const SEMTEX_FUSE_MS = 1_100;
/** src/game/ordnance.ts SEMTEX_MAX_FLIGHT_MS; the release arms fuse + ceiling. */
export const SEMTEX_CEILING_MS = 5_000;
/** Covers stick-observation latency (<= 1 frame), event routing, log rounding. */
export const FUSE_TOLERANCE_MS = 200;
/** Float-copy noise is 0; any real motion is far above 2 cm. */
export const STUCK_TOLERANCE_M = 0.02;
/** The brief: at least three distinct frames with the same id and position. */
export const STUCK_FRAMES = 3;
/** The host detonates at the stick point; the event snaps any step residue. */
export const DETONATION_DISTANCE_M = 0.5;
/** VIEW_LOG_MAX in ordnance-view.ts; a saturated log can never prove a line. */
export const VIEW_LOG_MAX = 300;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const OWN_THROW = /^\d+ grenade-thrown you semtex id=(\d+)/;
const OWN_DETONATED = /^(\d+) grenade-detonated you semtex id=(\d+) victims=\d+ at=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/;
const BLAST_SMOKE = /^(\d+) smoke-volume id=\d+ blast\b/;

/**
 * Analyse one run.
 *
 * `input.frames`: one entry per rAF tick: `{ t, n, selfId, tactical, armed,
 * spawnSeq, lineCount, flights: [{ id, grenadeId, ownerId, x, y, z, resting,
 * bornAt, sticky }] }` — own-semtex flights already filtered per frame by the
 * sampler, but re-filtered here by owner+kind so a sampler change cannot
 * widen the claim. `input.lineTail`: the event-log lines appended after the
 * sampler started. Everything else is evidence the harness gathered around
 * the window.
 */
export function analyseSemtexRun(input = {}) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: String(detail) });
  const facts = {};

  const {
    frames = [], lineTail = [], baselineLineCount = 0,
    armPerfNow = null, releasePerfNow = null,
    hudTacticalPre = null, hudTacticalPost = null,
    tacticalIdReadback = null, panelSemtexPressed = null,
    bundleStart = null, bundleEnd = null, expectSha = null,
    webgpu = null,
    pageErrors = [], fpsBefore = null, fpsAfter = null,
    screenshots = {},
  } = input;

  // Own semtex flights only, re-filtered at the point of judgement.
  const own = [];
  for (const f of frames) {
    if (!f || !Array.isArray(f.flights)) continue;
    for (const fl of f.flights) {
      if (fl.grenadeId === 'semtex' && f.selfId && fl.ownerId === f.selfId) {
        own.push({ t: f.t, n: f.n, ...fl });
      }
    }
  }
  const ids = [...new Set(own.map((f) => f.id))];
  facts.flightIds = ids;
  facts.ownFlightSamples = own.length;

  // --- projection present -------------------------------------------------
  add('projection-flights', frames.length > 0 && frames.some((f) => Array.isArray(f.flights)),
    frames.length === 0 ? 'no sampled frames reached the analysis' :
      frames.some((f) => Array.isArray(f.flights)) ? 'qa().flights visible to the page' :
        'qa().flights missing - the projection patch is not in this build');

  // --- loadout bound to semtex --------------------------------------------
  // All three must hold: the panel button was actually pressed AND selected,
  // the controller readback is semtex, and the HUD names SEMTEX. A readback
  // alone (or any HUD string) proves a store value, not a menu action.
  const boundOk = panelSemtexPressed === true &&
    tacticalIdReadback === 'semtex' &&
    typeof hudTacticalPre === 'string' && /semtex/i.test(hudTacticalPre);
  add('loadout-bound-semtex', boundOk,
    'tacticalId=' + String(tacticalIdReadback) + ' hud="' + String(hudTacticalPre) + '"' +
    ' panelPressed=' + String(panelSemtexPressed));

  // --- release ordering ----------------------------------------------------
  const released = typeof releasePerfNow === 'number' && typeof armPerfNow === 'number' && releasePerfNow > armPerfNow;
  add('release-ordered', released, 'arm=' + armPerfNow + ' release=' + releasePerfNow);

  // --- one own flight, sticky ----------------------------------------------
  add('own-flight-appeared', ids.length >= 1 && own.every((f) => f.sticky === true),
    ids.length === 0 ? 'no own semtex flight was ever live in the pool' :
      own.every((f) => f.sticky === true) ? 'id=' + ids.join(',') + ' sticky as the table says' :
        'a live own flight reported sticky=false');

  // --- first contact: the resting edge --------------------------------------
  let contact = null;
  if (released) {
    contact = own.find((f) => f.resting === true && f.t > releasePerfNow) ?? null;
    const inCeiling = contact !== null && (contact.t - releasePerfNow) <= SEMTEX_FUSE_MS + SEMTEX_CEILING_MS;
    add('first-contact', inCeiling,
      contact === null ? 'no resting edge after release' :
        inCeiling ? 'contact at +' + Math.round(contact.t - releasePerfNow) + ' ms after release' :
          'resting edge only at +' + Math.round(contact.t - releasePerfNow) + ' ms, past the flight ceiling');
  } else {
    add('first-contact', false, 'no ordered arm/release pair to judge contact from');
  }

  // --- stuck stationary: >= N distinct frames, same id, same position -------
  let stuck = [];
  if (contact !== null) {
    const post = own.filter((f) => f.id === contact.id && f.n > contact.n);
    stuck = post.filter((f) => dist(f, contact) <= STUCK_TOLERANCE_M);
    const times = new Set(stuck.map((f) => f.t));
    add('stationary-3-frames', times.size >= STUCK_FRAMES,
      times.size + ' distinct post-contact frames within ' + STUCK_TOLERANCE_M + ' m of ' +
      JSON.stringify({ x: +contact.x.toFixed(3), y: +contact.y.toFixed(3), z: +contact.z.toFixed(3) }));
    facts.stuckPos = { x: contact.x, y: contact.y, z: contact.z };
    facts.stuckFrames = times.size;
  } else {
    add('stationary-3-frames', false, 'no contact frame to be stationary at');
  }

  // --- single throw, single id, no resurrection ------------------------------
  // The projection only carries LIVE flights (the patch filters f.live) and
  // omits any live flag, so resurrection cannot be read off a property: it is
  // the disappearance of the id from the per-frame presence sets followed by
  // its reappearance — a retired flight coming back. A clean retirement
  // (absent after detonation, never back) is not resurrection.
  const thrownLines = lineTail.filter((l) => OWN_THROW.test(l));
  let resurrected = false;
  if (contact !== null) {
    let seenLive = false;
    let absentAfterLive = false;
    for (const f of frames) {
      if (!Array.isArray(f.flights)) continue;
      const present = f.flights.some((fl) =>
        fl.grenadeId === 'semtex' && f.selfId && fl.ownerId === f.selfId && fl.id === contact.id);
      if (present) {
        if (absentAfterLive) { resurrected = true; break; }
        seenLive = true;
      } else if (seenLive) {
        absentAfterLive = true;
      }
    }
  }
  add('single-throw-single-id', ids.length === 1 && thrownLines.length === 1 && !resurrected,
    'ids=[' + ids.join(',') + '] ownThrownLines=' + thrownLines.length +
    (resurrected ? ' the retired flight reappeared' : ''));

  // --- inventory consumed -----------------------------------------------------
  if (released) {
    const before = frames.filter((f) => f.t <= releasePerfNow);
    const after = frames.filter((f) => f.t > releasePerfNow);
    const respawned = new Set(frames.map((f) => f.spawnSeq)).size > 1;
    const hadCharge = before.some((f) => f.tactical >= 1);
    const spent = after.some((f) => f.tactical === 0);
    const armedSeen = before.some((f) => f.armed === 'semtex');
    const disarmed = after.some((f) => f.armed === null);
    const stillArmed = after.some((f) => f.armed === 'semtex');
    add('inventory-consumed', hadCharge && spent && armedSeen && disarmed && !stillArmed && !respawned,
      (respawned ? 'RESPAWN inside the window poisons this check; ' : '') +
      'pouch ' + (hadCharge ? 'had a charge' : 'never had one') + ' -> ' + (spent ? '0' : 'not seen at 0') +
      ', armed seen=' + armedSeen + ' cleared=' + disarmed + (stillArmed ? ' STILL ARMED after release' : ''));
    facts.respawnedDuringWindow = respawned;
  } else {
    add('inventory-consumed', false, 'no ordered arm/release pair');
  }

  // --- exactly one own detonation ---------------------------------------------
  const detLines = lineTail.map((l) => OWN_DETONATED.exec(l)).filter(Boolean);
  const det = detLines.length === 1
    ? { at: Number(detLines[0][1]), id: Number(detLines[0][2]), x: Number(detLines[0][3]), y: Number(detLines[0][4]), z: Number(detLines[0][5]) }
    : null;
  facts.detonation = det;
  add('detonated-exactly-once', det !== null && ids.length === 1 && det.id === ids[0],
    detLines.length === 0 ? (baselineLineCount >= VIEW_LOG_MAX
      ? 'no own detonation line AND the log was already saturated at ' + VIEW_LOG_MAX + ' lines - the log cannot prove anything'
      : 'no own detonation line reached the client log') :
      detLines.length > 1 ? detLines.length + ' own semtex detonation lines - duplicate' :
        det.id === ids[0] ? 'one line, id matches the flight' : 'one line but id ' + det.id + ' != flight ' + ids[0]);

  // --- fuse runs from the stick ------------------------------------------------
  if (contact !== null && det !== null) {
    const measured = det.at - contact.t;
    const ok = measured >= SEMTEX_FUSE_MS - FUSE_TOLERANCE_MS && measured <= SEMTEX_FUSE_MS + FUSE_TOLERANCE_MS;
    add('fuse-from-stick', ok,
      'detonation - first contact = ' + Math.round(measured) + ' ms (fuse ' + SEMTEX_FUSE_MS + ' +/- ' + FUSE_TOLERANCE_MS + ')');
  } else {
    add('fuse-from-stick', false, 'needs both the contact frame and one detonation line');
  }

  // --- the stuck point is the blast point ---------------------------------------
  if (stuck.length > 0 && det !== null) {
    const d = dist(det, contact);
    add('detonated-at-stuck-point', d <= DETONATION_DISTANCE_M,
      'blast ' + d.toFixed(3) + ' m from the stuck casing (limit ' + DETONATION_DISTANCE_M + ')');
  } else {
    add('detonated-at-stuck-point', false, 'needs the stuck frames and the detonation line');
  }

  // --- actual WebGPU, not the fallback -------------------------------------------
  // The WebGL2 fallback disables the post chain, so a proof taken on it is a
  // different renderer. Both the renderer and the post backend must say webgpu.
  const gpuOk = !!webgpu && webgpu.post === 'webgpu' && webgpu.postEnabled !== false &&
    (webgpu.renderer == null || webgpu.renderer === 'webgpu');
  add('actual-webgpu', gpuOk,
    webgpu ? 'renderer=' + String(webgpu.renderer) + ' post=' + String(webgpu.post) + ' enabled=' + String(webgpu.postEnabled) :
      'no GPU backend evidence reached the analysis');

  // --- after-effect announced on the bus -----------------------------------------
  const blastSmoke = det !== null ? lineTail.filter((l) => { const m = BLAST_SMOKE.exec(l); return m && Number(m[1]) >= det.at; }) : [];
  add('blast-smoke-announced', blastSmoke.length >= 1,
    blastSmoke.length + ' blast smoke-volume line(s) at or after the detonation');

  // --- run-level evidence -----------------------------------------------------------
  const bundleOk = !!bundleStart && !!bundleEnd && bundleStart.sha256 === bundleEnd.sha256 &&
    (!expectSha || bundleStart.sha256 === expectSha);
  add('bundle-identity', bundleOk,
    bundleStart && bundleEnd ? 'start ' + bundleStart.sha256.slice(0, 12) + ' end ' + bundleEnd.sha256.slice(0, 12) +
      (expectSha ? (bundleStart.sha256 === expectSha ? ' == expected' : ' != EXPECTED ' + expectSha) : '') :
      'bundle digest missing');

  const badErrors = pageErrors.filter((e) => String(e).startsWith('PAGEERROR'));
  add('no-page-errors', pageErrors.length === 0, pageErrors.length === 0 ? 'clean console' : JSON.stringify(pageErrors.slice(0, 4)));

  const intervals = [];
  for (let i = 1; i < frames.length && intervals.length < 200; i++) intervals.push(frames[i].t - frames[i - 1].t);
  const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : Infinity;
  add('real-frame-loop', frames.length >= 100 && avg < 50 && fpsBefore > 0 && fpsAfter > 0,
    frames.length + ' frames, avg ' + avg.toFixed(1) + ' ms, fps ' + fpsBefore + ' -> ' + fpsAfter);

  const shotsOk = !!screenshots.stuck && screenshots.stuck > 0 && !!screenshots.after && screenshots.after > 0;
  add('screenshots-captured', shotsOk,
    'stuck=' + (screenshots.stuck ?? 'none') + ' after=' + (screenshots.after ?? 'none') + ' bytes');

  // --- screenshots anchored to the live stuck casing --------------------------------
  // Byte counts prove files exist, not what they show: a claimed stuck shot
  // must sit on the stationary proof (same own id, >= 3 resting frames), or a
  // post-detonation or bot-flight capture could pass as the casing.
  const anchored = !shotsOk || (contact !== null && (facts.stuckFrames ?? 0) >= STUCK_FRAMES);
  add('screenshot-anchored', anchored,
    !shotsOk ? 'no screenshots claimed, nothing to anchor' :
      contact !== null && (facts.stuckFrames ?? 0) >= STUCK_FRAMES
        ? 'stuck shot anchored to own id=' + contact.id + ' with ' + facts.stuckFrames + ' resting frames'
        : 'screenshots claimed without a live stuck-casing proof');

  const verdict = checks.every((c) => c.pass) ? 'HOLDS' : 'REFUTED';
  return { verdict, checks, facts };
}
