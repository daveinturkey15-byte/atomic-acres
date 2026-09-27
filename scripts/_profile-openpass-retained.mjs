/** CPU-only retained-evidence audit. No browser, renderer, build or file writes.
 * Reads the frozen profiles and executes only the real measureSkate method body
 * with deterministic synthetic coordinates/clock. This is instrument coverage,
 * never visible contact acceptance or a measurement of the live game. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p));
const json = p => JSON.parse(read(p).toString('utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = p => ({ path: p, sha256: sha(read(p)) });

function profile(tag) {
  const prefix = `captures/perf/${tag}`;
  const report = json(`${prefix}/report.json`);
  const raw = json(`${prefix}/active-route.cpuprofile`);
  const mapped = json(`${prefix}/active-route-mapped.json`);
  assert.deepEqual(raw.samples, mapped.samples);
  assert.deepEqual(raw.timeDeltas, mapped.timeDeltas);
  assert.equal(raw.nodes.length, mapped.nodes.length);
  const nodes = new Map(mapped.nodes.map(n => [n.id, n]));
  const parents = new Map();
  for (const n of mapped.nodes) for (const c of n.children ?? []) parents.set(c, n.id);
  const groups = {
    worldRender: n => n.original?.source.endsWith('/src/core/world.ts'),
    shadowRender: n => n.callFrame.functionName === 'renderShadow',
    bindingUpdate: n => n.callFrame.functionName === '_updateBindings',
    materialCacheKey: n => n.callFrame.functionName === 'getMaterialCacheKey',
    characterWork: n => n.original?.source.includes('/src/characters/'),
    simulationAndNet: n => /\/src\/(game|net)\//.test(n.original?.source ?? ''),
  };
  const inclusiveUs = Object.fromEntries(Object.keys(groups).map(k => [k, 0]));
  const self = new Map(); let totalUs = 0;
  for (let i = 0; i < mapped.samples.length; i++) {
    const us = mapped.timeDeltas[i]; totalUs += us;
    const leaf = nodes.get(mapped.samples[i]);
    const o = leaf.original;
    const location = o?.source ? `${o.source}:${o.line} ${o.name ?? leaf.callFrame.functionName}`
      : `native ${leaf.callFrame.functionName}`;
    self.set(location, (self.get(location) ?? 0) + us);
    let id = leaf.id; const seen = new Set(), hits = new Set();
    while (id && !seen.has(id)) {
      seen.add(id); const n = nodes.get(id); assert(n);
      for (const [key, predicate] of Object.entries(groups)) if (predicate(n)) hits.add(key);
      id = parents.get(id);
    }
    for (const key of hits) inclusiveUs[key] += us;
  }
  assert.equal(totalUs, report.profile.sampledUs);
  return {
    sourceCommit: report.identity.sourceCommit, entrySha256: report.identity.entrySha256,
    evidence: ['report.json', 'active-route.cpuprofile', 'active-route-mapped.json'].map(f => digest(`${prefix}/${f}`)),
    mapReceipts: report.mapReceipts.map(m => ({ ...m, retainedMapPresent: existsSync(m.map),
      retainedMapHashMatches: existsSync(m.map) ? sha(readFileSync(m.map)) === m.mapSha256 : null })),
    totalSampleMs: totalUs / 1000,
    inclusive: Object.fromEntries(Object.entries(inclusiveUs).map(([k, us]) => [k, { ms: us / 1000, percent: us * 100 / totalUs }])),
    topSelf: [...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([location, us]) => ({ location, ms: us / 1000, percent: us * 100 / totalUs })),
    runs: report.runs.map(r => ({ durationMs: r.elapsedMs, actualGameFps: r.gameObservedFramesPerSecond,
      gameMedianMs: r.gameFrames.medianMs, gameP95Ms: r.gameFrames.p95Ms,
      callbackMedianMs: r.gameSubmittedCpu.medianMs, callbackP95Ms: r.gameSubmittedCpu.p95Ms })),
    gpuTiming: report.gpuTiming,
    limit: 'Inclusive categories overlap; never add them. Sampling time is not GPU completion or exact function duration. These are historical builds, not 2f837ae.',
  };
}

class Vec {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec(this.x, this.y, this.z); }
}
function methodBody(source, signature, nextMarker) {
  const start = source.indexOf(signature), end = source.indexOf(nextMarker, start);
  assert(start >= 0 && end > start);
  const method = source.slice(start, end);
  return method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
}
function skateCoverage() {
  const source = read('src/characters/blend.ts').toString('utf8');
  const frozenCommit = '537ddb76477b8be7953c9bcd651458f255ce48da';
  const frozenSource = execFileSync('git', ['show', `${frozenCommit}:src/characters/blend.ts`], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(sha(frozenSource), '8208ce9388a989fc67f7f5d0ca22d2b8542438f298e5ded5c6e55827aba6930e');
  const measureBody = text => {
    const typed = methodBody(text, '  measureSkate(): number {', '\n  resetSkate(): void {');
    // Erase this one TypeScript-only tuple assertion; preserve every operation.
    assert.equal(typed.split("['Left', 'Right'] as const").length, 2);
    return typed.replace("['Left', 'Right'] as const", "['Left', 'Right']");
  };
  const coverageBody = methodBody(source, '  skateCoverage(): SkateCoverage {', '\n  /** Completed strides');
  const resetBody = methodBody(source, '  resetSkate(): void {', '\n  /** Read-only coverage.');
  const getter = vm.runInNewContext(`(function () {${coverageBody}\n})`, {}, { timeout: 1000 });
  const reset = vm.runInNewContext(`(function () {${resetBody}\n})`, {}, { timeout: 1000 });
  const cases = [
    { name: 'stationary', speed: 0, frames: 300, want: 'measured' },
    { name: 'slow-slide', speed: .2, frames: 300, want: 'measured' },
    { name: 'fast-excluded-slide', speed: 2, frames: 300, want: 'unmeasured' },
    { name: 'no-samples', speed: 0, frames: 0, want: 'unmeasured' },
    { name: 'unfinished-first-contact', speed: 0, frames: 25, want: 'incomplete' },
    { name: 'warmup-only', speed: 0, frames: 60, want: 'incomplete' },
    { name: 'too-short-contacts', speed: .2, frames: 300, lowEnd: 12, want: 'incomplete' },
    { name: 'measured-prefix-with-pending-contact', speed: 0, frames: 325, want: 'measured' },
  ];
  const exercise = (text, test) => {
    let seconds = 0; const pos = new Vec();
    const measure = vm.runInNewContext(`(function () {${measureBody(text)}\n})`, { performance: { now: () => seconds * 1000 } }, { timeout: 1000 });
    const fixture = { root: { position: new Vec(), updateMatrixWorld() {} }, groundY: 0,
      footWorld: new Vec(), rootPrev: new Vec(), lastSkateT: 0, worstStrideCm: 0, stridesDone: 0,
      skateSampleCount: 0, eligibleSkateStances: 0,
      bones: { LeftFoot: { getWorldPosition: v => v.copy(pos) }, RightFoot: { getWorldPosition: v => v.copy(pos) } } };
    for (const k of ['footPrev', 'stanceActive', 'strideSkate', 'stanceSince', 'footPrevY', 'footPrevT']) fixture[k] = new Map();
    // Five prescribed low-contact windows, each 0.5 s; lift to 0.3 m between.
    // Root travels at 2 m/s in all controls; low feet drift at the stated speed.
    const legacy = [];
    for (let i = 1; i <= test.frames; i++) {
      seconds = i / 60; const phase = i % 60;
      fixture.root.position.z = seconds * 2;
      pos.z = seconds * test.speed; pos.y = phase >= 10 && phase < (test.lowEnd ?? 40) ? 0.02 : 0.3;
      legacy.push({ worstCm: measure.call(fixture), strides: fixture.stridesDone,
        stance: [...fixture.stanceActive], accumulated: [...fixture.strideSkate], position: { ...fixture.root.position } });
    }
    return { fixture, legacy };
  };
  const rows = cases.map(test => {
    const before = exercise(frozenSource, test), after = exercise(source, test);
    assert.deepEqual(after.legacy, before.legacy, `${test.name}: all legacy metrics and positions must remain identical`);
    const coverage = getter.call(after.fixture);
    assert.equal(coverage.state, test.want, test.name);
    if (test.name === 'measured-prefix-with-pending-contact') assert.equal(coverage.pendingStances, 2);
    const snapshot = JSON.stringify(after.fixture);
    assert.deepEqual(getter.call(after.fixture), coverage, 'getter is stable');
    assert.equal(JSON.stringify(after.fixture), snapshot, 'getter does not mutate');
    reset.call(after.fixture);
    const resetCoverage = getter.call(after.fixture);
    assert.equal(resetCoverage.state, 'unmeasured'); assert.equal(resetCoverage.reason, 'no-samples');
    assert.equal(resetCoverage.sampleCount, 0); assert.equal(resetCoverage.eligibleCompletedStances, 0); assert.equal(resetCoverage.pendingStances, 0);
    return { name: test.name, prescribedLowContactFootSpeedMps: test.speed,
      lowContactSampledTravelCm: test.speed * ((test.lowEnd ?? 40) - 11) / 60 * 100,
      reportedWorstCm: before.fixture.worstStrideCm, reportedCompletedStances: before.fixture.stridesDone,
      coverage, legacyEverySampleEqual: true, resetCoverage };
  });
  assert(rows[0].reportedWorstCm === 0 && rows[0].reportedCompletedStances > 2, 'stationary positive contact control');
  assert(rows[1].reportedWorstCm > 5, 'slow residual slide must be detected');
  assert(rows[2].reportedWorstCm === 0 && rows[2].reportedCompletedStances === 0, 'retain the fast-slide unmeasured counterexample');
  return { source: digest('src/characters/blend.ts'), frozenCommit, frozenSourceSha256: sha(frozenSource),
    frozenMethodBodySha256: sha(measureBody(frozenSource)), rows,
    verdict: 'VERIFIED additive coverage detects the retained fast-slide unmeasured counterexample without changing legacy measurements. Synthetic instrument proof only; runtime contact/pixels OPEN.' };
}

function clips() {
  const manifest = json('public/anim/manifest.json');
  return { manifest: digest('public/anim/manifest.json'), clips: manifest.clips.map(entry => {
    const bytes = read(`public/anim/${entry.file}`);
    assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    const channels = gltf.animations[0].channels;
    const addressed = [...new Set(channels.map(c => gltf.nodes[c.target.node].name))];
    return { id: entry.id, sha256: sha(bytes), bytes: bytes.length, jointsAddressed: addressed.length,
      channels: channels.length, speedMps: entry.speed, durationS: entry.duration,
      offlineFootSlideCm: entry.footSlideCm, offlineFootTravelCm: entry.footTravelCm,
      loop: entry.loop, gltfSource: gltf.extras?.source ?? null };
  }), limit: 'Structural GLB inventory and offline manifest values only. Does not verify current runtime contact, transitions or pixels.' };
}

const soak = json('captures/leak/overnight-2f837ae-soak-soak.json');
console.log(JSON.stringify({
  claim: 'CPU-only independent retained-evidence audit; no live profiling or animation acceptance',
  profiles: ['overnight-pass1-baseline', 'overnight-pass1-shadow-canary'].map(profile),
  acceptedRuntimeSoak: { evidence: digest('captures/leak/overnight-2f837ae-soak-soak.json'),
    actualHudFpsMin: Math.min(...soak.rows.map(r => r.fps)), actualHudFpsMax: Math.max(...soak.rows.map(r => r.fps)),
    pageRafFps: soak.frames / soak.elapsed, samples: soak.rows.length, fails: soak.fails,
    limit: 'No source-mapped CPU profile or GPU duration in this soak; page RAF is not game FPS.' },
  animation: clips(), contactInstrument: skateCoverage(),
}, null, 2));
