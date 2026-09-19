/**
 * _verify-streak-reject — the no-placement backoff falsifier. Deterministic,
 * headless, NO browser: it bundles the real `src/game/` modules with esbuild
 * (already a vite dependency; no install) and runs one seeded match loop in
 * node.
 *
 * WHY A SECOND HARNESS. `scripts/_verify-match.mjs` drives the built page for
 * minutes and reads aggregates; it cannot force a specific refusal, and the
 * livelock this file is about is invisible in an aggregate — the counter it
 * would show is exactly the counter the bug zeroes. This one forces ONE
 * `no-placement` reject and counts presses in the 4 s that follow.
 *
 * HOW THE REJECT IS FORCED, without a mock: the bot is parked outside the
 * playable rectangle (`core/layout.ts:BOUND_X_MAX`), so
 * `killstreaks/effects/sentry.ts:validateSentryPlacement` answers
 * `out-of-bounds` and `runtime.activate` takes its real `reject('no-placement')`
 * branch. Every module on the path is the shipped one; the only wrapper is a
 * pass-through `BotHost` that records what the director pressed and what the
 * host answered.
 *
 * THE ASSERTION (exit 1 on failure):
 *   - exactly ONE press is refused with a reason (not silently),
 *   - exactly ONE `streak-denied` event reaches the event stream,
 *   - ZERO further presses in the `BOT_STREAK_RETRY_MS` (4 s) that follow.
 *
 *   node scripts/_verify-streak-reject.mjs                      # the backoff
 *   node scripts/_verify-streak-reject.mjs --scenario rematch   # the counters
 *
 * The second scenario answers a different question with the same machinery:
 * `session.ts` rebuilds the BotDirector on every rematch, so a number read off
 * the live director reads 0 after one however much happened before. It drives a
 * real LocalMatch on a SYNTHETIC clock through a whole match and its rematch in
 * about a second, and fails if any director counter falls across the boundary.
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = Number(opt('seconds', '16'));
const TAG = opt('tag', 'run');
const JSON_OUT = argv.includes('--json');
/** 'reject' (default) forces one unplaceable claim; 'rematch' crosses a match boundary. */
const SCENARIO = opt('scenario', 'reject');

// The scenario, in TypeScript, compiled against the real sources. Kept as a
// string so the whole falsifier is ONE file and nothing stale can be left on
// disk beside it. No template literals inside — this is one.
const ENTRY = [
  "import { BotDirector } from '../src/game/bots';",
  "import { BOT_STREAK_RETRY_MS } from '../src/game/bot-sense';",
  "import { GameHost } from '../src/game/host';",
  "import { StreakRuntime } from '../src/game/killstreaks/runtime';",
  "import { streakPort } from '../src/game/session';",
  "import { createWorldQuery } from '../src/game/world-query';",
  "import { TEAM_A, TEAM_B, WARMUP_MS, rulesFor } from '../src/game/rules';",
  "import { BOUND_X_MAX } from '../src/core/layout';",
  "import { TICK_HZ } from '../src/net/snapshot';",
  "import { createLocalMatch } from '../src/game/session';",
  "",
  "export function run(seconds: number) {",
  "  const TICK_MS = 1000 / TICK_HZ;",
  "  const BOT = 'bot-01';",
  "  const HUMAN = 'you';",
  "  // Far outside the playable rectangle: inBounds() is false here, so a",
  "  // sentry claim anchored on this bot cannot be placed.",
  "  const OUT_X = BOUND_X_MAX + 50;",
  "  const world = createWorldQuery([]);",
  "  const runtime = new StreakRuntime({ seed: 7, matchEpoch: 1 });",
  "  const host = new GameHost({",
  "    world, rules: rulesFor('tdm', 25), now: 0, seed: 7,",
  "    deps: { streaks: streakPort(runtime, 1) },",
  "  });",
  "  host.addActor(HUMAN, TEAM_A);",
  "",
  "  const pressLog: { t: number; slot: number; answer: string | null }[] = [];",
  "  let nowRef = 0;",
  "  // A RECORDING PASS-THROUGH, not a mock: every call reaches the real host.",
  "  const botHost = {",
  "    addActor: (id: string, team: 0 | 1, o?: { bot?: boolean }) => host.addActor(id, team, o),",
  "    updatePose: (id: string, x: number, y: number, z: number, at?: number) => host.updatePose(id, x, y, z, at),",
  "    submitInput: (id: string, m: never) => host.submitInput(id, m),",
  "    submitShot: (id: string, c: never, r?: number) => host.submitShot(id, c, r),",
  "    submitStreakIntent: (id: string, m: { type: 'streak-intent'; slot: number; toggle: boolean }) => {",
  "      const answer = host.submitStreakIntent(id, m);",
  "      pressLog.push({ t: nowRef, slot: m.slot, answer });",
  "      return answer;",
  "    },",
  "  };",
  "  const director = new BotDirector({ host: botHost as never, world, rand: host.rand, maxBots: 5 });",
  "  if (director.add(TEAM_B) === null) throw new Error('scenario: the roster refused a bot');",
  "",
  "  const denied: { t: number; actorId: string; slot: number; reason: string; detail: string | null }[] = [];",
  "  let banked = false;",
  "  let parked = false;",
  "",
  "  for (let step = 0; step * TICK_MS <= seconds * 1000; step++) {",
  "    const now = step * TICK_MS;",
  "    nowRef = now;",
  "    // Bank the rungs only once the match is ACTIVE. During warmup the gate",
  "    // answers 'match-inactive', which is terminal for a bot's whole life and",
  "    // would end the scenario before the placement path is ever reached.",
  "    if (!banked && now >= WARMUP_MS + 1000) {",
  "      for (let k = 1; k <= 5; k++) runtime.recordElimination(BOT, k, now);",
  "      banked = true;",
  "    }",
  "    host.updatePose(HUMAN, 0, 0, 0, now);",
  "    host.submitInput(HUMAN, {",
  "      type: 'input', seq: step + 1, mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false,",
  "    });",
  "    const snap = host.snapshot();",
  "    const me = snap.actors.find((a) => a.id === HUMAN);",
  "    const human = me === undefined ? [] : [{ id: me.id, team: me.team, alive: me.alive, x: 0, y: 0, z: 0 }];",
  "    director.tick(now, TICK_MS / 1000, human, snap.actors);",
  "    for (const e of host.tick(now)) {",
  "      if (e.type === 'spawn') director.onSpawn(e.actorId, e.x, e.y, e.z, e.yaw);",
  "      else if (e.type === 'death') director.onDeath(e.victimId, TEAM_A);",
  "      if (e.type === 'streak-denied') {",
  "        denied.push({",
  "          t: now, actorId: e.actorId, slot: e.slot, reason: e.reason,",
  "          detail: (e as { detail?: string }).detail ?? null,",
  "        });",
  "      }",
  "    }",
  "    // After the host's own deploy has been routed, park the bot outside the",
  "    // arena. Every movement try is then out of bounds and refused, so it",
  "    // stays there and every sentry claim it makes is unplaceable.",
  "    if (!parked) { director.onSpawn(BOT, OUT_X, 0, 0, 0); parked = true; }",
  "  }",
  "",
  "  const sentryPresses = pressLog.filter((p) => p.slot === 3);",
  "  const first = sentryPresses[0] ?? null;",
  "  // The hold is [first, first + RETRY). A press at EXACTLY first + RETRY is",
  "  // the hold expiring on schedule (`now < streakHoldUntil` in bots.ts), not a",
  "  // re-press, so the window is half-open or the gate fails a correct backoff.",
  "  const inHold = (t: number) => first !== null && t > first.t && t < first.t + BOT_STREAK_RETRY_MS;",
  "  const deniedSlot3 = denied.filter((d) => d.slot === 3);",
  "  return {",
  "    retryMs: BOT_STREAK_RETRY_MS,",
  "    seconds,",
  "    pressTotal: pressLog.length,",
  "    pressLog: pressLog.slice(0, 12),",
  "    sentryPressTotal: sentryPresses.length,",
  "    firstSentryPressAt: first === null ? null : first.t,",
  "    firstSentryAnswer: first === null ? null : first.answer,",
  "    repressesInHoldWindow: sentryPresses.filter((p) => inHold(p.t)).length,",
  "    deniedEvents: denied.length,",
  "    deniedForSlot3: deniedSlot3,",
  "    deniedInHoldWindow: deniedSlot3.filter((d) => inHold(d.t)).length + (first === null ? 0 : deniedSlot3.filter((d) => d.t === first.t).length),",
  "    metrics: { ...director.metrics },",
  "  };",
  "}",
  "",
  "/**",
  " * SCENARIO 2 - the counter that resets. `session.ts` builds a whole new",
  " * BotDirector on every rematch, so any number read off the live one drops to",
  " * zero the instant a match ends, however much happened in the one before.",
  " * This drives a real LocalMatch on a synthetic clock (no browser, no wall",
  " * clock) straight through a rematch and reads `counters()` on the tick before",
  " * and the tick after the epoch changes. A per-director number falls to 0",
  " * across that boundary; a session-cumulative one cannot.",
  " */",
  "export function runRematch(maxTicks: number) {",
  "  const TICK_MS = 1000 / TICK_HZ;",
  "  const ui = { bindClient: () => undefined, setNames: () => undefined };",
  "  // A 50-kill match, not the 10-kill default: match 1 has to run long enough",
  "  // for a bot to still be HOLDING a banked charge when the phase flips, which",
  "  // is the refusal (`match-inactive`, terminal) that 8ba75f7 left at one per",
  "  // match end. A 30 s match ends before anyone banks one and measures nothing.",
  "  const match = createLocalMatch({ colliders: [], ui, bots: 5, seed: 11, rules: rulesFor('tdm', 50) });",
  "  match.begin();",
  "  let now = 0;",
  "  let epoch = 0;",
  "  let before: Record<string, number> | null = null;",
  "  let after: Record<string, number> | null = null;",
  "  let atMs = 0;",
  "  for (let i = 0; i < maxTicks && after === null; i++) {",
  "    now += TICK_MS;",
  "    match.tick(now, 0, 0, 0, 0, 0);",
  "    const c = match.counters();",
  "    if (c.epoch !== epoch) {",
  "      if (epoch >= 1) { after = c; atMs = now; break; }",
  "      epoch = c.epoch;",
  "    } else if (epoch >= 1) {",
  "      before = c;",
  "    }",
  "  }",
  "  return { before, after, rematchAtMs: atMs, ticks: Math.round(now / TICK_MS) };",
  "}",
].join('\n');

const outfile = join(tmpdir(), 'aa-streak-reject-' + process.pid + '.mjs');
await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'scenario.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'warning',
});

const scenario = await import(pathToFileURL(outfile).href);

if (SCENARIO === 'rematch') {
  const r = scenario.runRematch(Number(opt('max-ticks', '40000')));
  if (JSON_OUT) console.log(JSON.stringify(r, null, 2));
  const fails = [];
  if (r.after === null) fails.push('no rematch happened in ' + r.ticks + ' ticks - nothing was measured');
  else {
    // Every one of these is a BotDirector number, and `session.ts` throws the
    // director away on a rematch. Under the old reading all of them read 0 on
    // the first tick of match 2 however large they were on the last tick of
    // match 1 - which is the whole defect, and what the right column proves.
    const KEYS = ['streakRefused', 'streakPresses', 'shots', 'botTicks', 'botDeaths', 'reinforcements'];
    console.log('[rematch-counters] a real LocalMatch on a synthetic clock, rematch at t='
      + (r.rematchAtMs / 1000).toFixed(1) + 's (' + r.ticks + ' ticks)');
    console.log('  key                last tick of match 1   first tick of match 2');
    for (const k of KEYS) {
      const b = r.before === null ? 0 : (r.before[k] ?? 0);
      const a = r.after[k] ?? 0;
      console.log('  ' + k.padEnd(18) + String(b).padStart(20) + String(a).padStart(23)
        + (a < b ? '   <-- LOST' : ''));
    }
    console.log('  epoch              ' + String(r.before === null ? '?' : r.before.epoch).padStart(20)
      + String(r.after.epoch).padStart(23));
    // Non-vacuity first: a boundary crossed with every counter at zero proves
    // nothing, and would pass silently.
    const nonZero = KEYS.filter((k) => (r.before === null ? 0 : (r.before[k] ?? 0)) > 0);
    if (nonZero.length < 3) {
      fails.push('only ' + nonZero.length + ' director counters were non-zero in match 1 - '
        + 'the boundary was crossed but nothing was measured across it');
    }
    for (const k of KEYS) {
      const was = r.before === null ? 0 : (r.before[k] ?? 0);
      if ((r.after[k] ?? 0) < was) {
        fails.push(k + ' fell from ' + was + ' to ' + (r.after[k] ?? 0) + ' across the rematch');
      }
    }
    // streakRefused is the headline counter but it is not reliably non-zero in
    // a synthetic match: bots spend a charge on the tick after they bank it, so
    // one is only ever HELD into the ended phase by timing. Reported, never
    // asserted here - `scripts/_verify-match.mjs --seconds 240` is where that
    // specific number is read after a real rematch.
    console.log('  streakRefused in match 1: ' + (r.before === null ? '?' : r.before.streakRefused)
      + (Number(r.before === null ? 0 : r.before.streakRefused) === 0
        ? '   (none occurred this run - see _verify-match.mjs for that one)' : ''));
  }
  mkdirSync(join(ROOT, 'captures'), { recursive: true });
  writeFileSync(join(ROOT, 'captures', 'rematch-counters-' + TAG + '.json'),
    JSON.stringify({ tag: TAG, fails, ...r }, null, 2));
  if (fails.length) {
    console.log('[rematch-counters] REFUTED:\n  - ' + fails.join('\n  - '));
    process.exit(1);
  }
  console.log('[rematch-counters] HOLDS: every director number survived the rematch');
  process.exit(0);
}

const r = scenario.run(SECONDS);

if (JSON_OUT) console.log(JSON.stringify(r, null, 2));

console.log('[streak-reject] forced no-placement on slot 3 (sentry-post), ' + SECONDS + 's at ' + (1000 / 50) + ' Hz');
console.log('  first sentry press at t=' + r.firstSentryPressAt + ' ms   host answered: ' + String(r.firstSentryAnswer));
console.log('  sentry presses total       ' + r.sentryPressTotal);
console.log('  re-presses inside the ' + r.retryMs + ' ms hold   ' + r.repressesInHoldWindow
  + '      denied events inside it   ' + r.deniedInHoldWindow);
console.log('  streak-denied events total ' + r.deniedEvents
  + (r.deniedForSlot3.length ? '   (slot3: ' + r.deniedForSlot3.map((d) => d.reason + (d.detail ? '/' + d.detail : '')).join(', ') + ')' : ''));
console.log('  director.streakRefused     ' + r.metrics.streakRefused
  + '   streakPresses ' + r.metrics.streakPresses);

const fails = [];
if (r.firstSentryPressAt === null) fails.push('the bot never pressed the sentry slot - the scenario measured nothing');
if (r.firstSentryAnswer === null) fails.push('the host answered null to an unplaceable claim - the presser cannot back off');
if (r.deniedInHoldWindow !== 1) fails.push('expected exactly 1 streak-denied event for slot 3 in the hold, got ' + r.deniedInHoldWindow);
if (r.repressesInHoldWindow !== 0) fails.push('expected 0 re-presses inside the ' + r.retryMs + ' ms hold, got ' + r.repressesInHoldWindow);
// One press per hold is the DESIGNED rate. Anything near the 20 Hz tick rate is
// the livelock back: 16 s of hold-respecting presses is 4, not 240.
if (r.sentryPressTotal > Math.ceil((r.seconds * 1000) / r.retryMs) + 1) {
  fails.push('sentry pressed ' + r.sentryPressTotal + ' times in ' + r.seconds + 's - the backoff is not engaging');
}

mkdirSync(join(ROOT, 'captures'), { recursive: true });
writeFileSync(join(ROOT, 'captures', 'streak-reject-' + TAG + '.json'),
  JSON.stringify({ tag: TAG, fails, ...r }, null, 2));

if (fails.length) {
  console.log('[streak-reject] REFUTED:\n  - ' + fails.join('\n  - '));
  process.exit(1);
}
console.log('[streak-reject] HOLDS: one refusal, one event, no re-press inside the hold');
