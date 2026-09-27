/** CPU-only integration falsifiers. Reads actual function bodies; never imports
 * a browser capture entry, builds the app, starts a renderer, or writes a file. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import Info from '../node_modules/three/src/renderers/common/Info.js';
import Animation from '../node_modules/three/src/renderers/common/Animation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frozen = '537ddb76477b8be7953c9bcd651458f255ce48da';
// Git blobs use LF and this checkout uses CRLF. Normalize only parsed source;
// the report below hashes untouched file bytes.
const read = path => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const before = path => execFileSync('git', ['show', `${frozen}:${path}`], { cwd: root, encoding: 'utf8', windowsHide: true });
const checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Actual source anchors missing: ${start}`);
  return source.slice(a, b);
}
function declarations(source, names) {
  const file = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true);
  const nodes = file.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
  assert.equal(nodes.length, names.length);
  // Erase types in these declarations only; no imports or application build.
  return ts.transpileModule(nodes.map(n => n.getText(file).replace(/^export /, '')).join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}

const qaPath = 'src/characters/anim-qa.ts', qaSource = read(qaPath);
const calls = { getter: 0, measure: 0, reset: 0, pose: 0, raf: 0 };
let coverage = { state: 'unmeasured', reason: 'no-samples', sampleCount: 0,
  eligibleCompletedStances: 0, pendingStances: 0 };
const rig = { skateCoverage() { calls.getter++; return { ...coverage }; },
  measureSkate() { calls.measure++; throw Error('Getter sampled'); },
  resetSkate() { calls.reset++; throw Error('Getter reset'); } };
const subject = { rig, root: new Proxy({}, { get() { calls.pose++; throw Error('Getter read pose'); } }) };
const context = vm.createContext({ fixture: { characters: [subject] }, requestAnimationFrame() { calls.raf++; } });
vm.runInContext('let system = null;\n' + declarations(qaSource, ['pick', 'installAnimQA']) + '\ninstallAnimQA(fixture);', context);
assert(context.__NTANIM?.ready);
for (const state of ['unmeasured', 'incomplete', 'measured']) {
  coverage = { ...coverage, state };
  const got = context.__NTANIM.skateCoverage(0);
  assert.deepEqual(got, coverage); got.state = 'caller-mutated';
  assert.equal(coverage.state, state);
}
assert.equal(context.__NTANIM.skateCoverage(999), null);
assert.deepEqual(calls, { getter: 3, measure: 0, reset: 0, pose: 0, raf: 0 });
const installed = context.__NTANIM;
context.fixture = { characters: [] };
vm.runInContext('installAnimQA(fixture);', context);
assert.equal(context.__NTANIM, installed);
assert.equal(installed.skateCoverage(0), null, 'existing registration observes current system');
pass('actual AnimQA registration forwards only getter; absent/replaced actors return null; no sampling/reset/pose/RAF');

const capturePath = 'scripts/animation/capture-anim-views.mjs', capture = read(capturePath), oldCapture = before(capturePath);
const exitLine = capture.match(/^process\.exit\(.*\);$/m)?.[0]; assert(exitLine);
const exitFor = (slide, dark = []) => {
  let code; vm.runInNewContext(exitLine, { slide, dark, process: { exit(value) { code = value; } } }); return code;
};
assert.equal(exitFor(null), 0, 'stationary route preserves prior behavior');
for (const row of [{}, { contactCoverage: null }, ...['unmeasured', 'incomplete'].map(state => ({ contactCoverage: { state } }))]) {
  assert.equal(exitFor(row), 1, 'moving clip missing coverage fails');
}
assert.equal(exitFor({ worstCm: 0, contactCoverage: { state: 'measured' } }), 0);
assert.equal(exitFor({ worstCm: 999, contactCoverage: { state: 'measured' } }), 0,
  'coverage is not a slip-quality threshold; original capture has no numeric slip rejection');
for (const row of [null, {}, { contactCoverage: { state: 'measured' } }]) assert.equal(exitFor(row, [{}]), 1);
for (const source of [capture, oldCapture]) {
  assert(source.includes('const DARK_THRESHOLD = 40;'));
  assert(source.includes('if (spec.speed > 0.25) {'));
  assert(source.includes('await page.waitForTimeout(9000);'));
}
assert.equal(between(capture, 'const VIEWS = [', '\nfunction freePort'), between(oldCapture, 'const VIEWS = [', '\nfunction freePort'));
const observation = between(capture, '    const r = window.__NTANIM.skate(0);', '\n  });');
let measured = 0, readCoverage = 0, stopped = 0;
const projected = vm.runInNewContext('(function(){' + observation + '})()', { window: { __NTANIM: {
  skate() { measured++; return { worstCm: 0, strides: 0 }; },
  skateCoverage() { readCoverage++; return { state: 'unmeasured' }; }, skateStop() { stopped++; },
} } });
assert.equal(exitFor(projected), 1); assert.deepEqual([measured, readCoverage, stopped], [1, 1, 1]);
pass('actual capture attachment/exit rejects all unknown contact states; darkness, cameras and 9s sampling unchanged');

assert.equal(JSON.parse(read('node_modules/three/package.json')).version, '0.180.0');
const inspectionPath = 'scripts/_inspect-overnight-heavy-rig.mjs', inspection = read(inspectionPath), oldInspection = before(inspectionPath);
for (const prefix of ['const camera=', 'const renderer=', 'renderer.toneMapping=', 'const target=', 'const views=',
  'scene.add(new THREE.HemisphereLight(', 'const key=', 'const fill=']) {
  const line = source => source.split(/\r?\n/).find(l => l.startsWith(prefix));
  assert(line(inspection)); assert.equal(line(inspection), line(oldInspection), prefix + ' changed');
}
const actualDraw = between(inspection, "let current='threeQuarter'", '\nfor(const name');
const info = new Info();
const resetMode = inspection.match(/^renderer\.info\.autoReset=.*;$/m)?.[0]; assert(resetMode);
vm.runInNewContext(resetMode, { renderer: { info } });
let nextRaf, renderVertices = 36, rejectRender = false, draws = 0, poseWrites = 0;
const animation = new Animation({ nodeFrame: { frameId: 0, update() { this.frameId++; } } }, info);
animation.setContext({ requestAnimationFrame(fn) { nextRaf = fn; return 1; }, cancelAnimationFrame() {} });
animation.start();
const drawContext = vm.createContext({ window: {}, scene: {}, currentTime: 100,
  performance: { now: () => 100 },
  camera: { position: { set() {} }, lookAt() {} }, target: {},
  views: { front: [0, 0, 0], right: [1, 0, 0] }, parsed: { animations: [] }, materials: { dispose() {} },
  rig: { group: { updateMatrixWorld() { poseWrites++; } }, stats: {}, dispose() {},
    hands: { updateReload() {}, root: { userData: { heavyFitVersion: 'fixture' } } } },
  renderer: { info, backend: { isWebGPUBackend: true }, dispose() {},
    async renderAsync() { if (rejectRender) throw Error('fixture render rejection'); draws++; info.render.calls++;
      if (renderVertices) info.update({ isMesh: true }, renderVertices, 1); } },
});
vm.runInContext(actualDraw, drawContext);
const viewer = drawContext.window.__HEAVY_INSPECT;
assert.equal(viewer.stats().triangles, 0, 'no completed draw starts at zero');
await viewer.view('front');
const firstDraw = structuredClone(viewer.stats().lastDraw);
assert.equal(firstDraw.triangles, 12); assert.equal(firstDraw.drawCalls, 1);
nextRaf(16); assert.equal(viewer.stats().triangles, 12, 'internal RAF preserves manual-mode draw receipt');
assert.equal(viewer.stats().liveCounters.triangles, 12, 'actual source disables internal automatic reset');
info.reset(); assert.equal(viewer.stats().liveCounters.triangles, 0); assert.equal(viewer.stats().triangles, 12);
renderVertices = 0; await viewer.reload(.5);
assert.equal(viewer.stats().triangles, 0, 'successful empty draw replaces previous positive receipt');
assert.equal(viewer.stats().lastDraw.drawCalls, 0);
assert.equal(firstDraw.triangles, 12, 'previous receipt values stay independent');
renderVertices = 18; await viewer.view('right');
assert.equal(viewer.stats().triangles, 6); assert.equal(viewer.stats().lastDraw.view, 'right');
const completed = JSON.stringify(viewer.stats().lastDraw);
rejectRender = true; await assert.rejects(viewer.reload(.75), /fixture render rejection/);
assert.equal(JSON.stringify(viewer.stats().lastDraw), completed, 'failed render cannot forge a new completion');
assert.equal(draws, 3); assert.equal(poseWrites, 4); animation.stop();
const auto = new Info(); let autoRaf;
const oldAnimation = new Animation({ nodeFrame: { frameId: 0, update() {} } }, auto);
oldAnimation.setContext({ requestAnimationFrame(fn) { autoRaf = fn; return 1; }, cancelAnimationFrame() {} });
oldAnimation.start(); auto.update({ isMesh: true }, 36, 1); assert.equal(auto.render.triangles, 12);
autoRaf(16); assert.equal(auto.render.triangles, 0); oldAnimation.stop();
pass('actual draw/stats body with r180 Info/Animation retains completion, replaces empty draw and propagates render failure; original auto-reset negative retained');

const neutralPath = 'scripts/_capture-overnight-heavy-neutral.mjs', neutral = read(neutralPath), oldNeutral = before(neutralPath);
const guard = between(neutral, 'const args = process.argv.slice(2);', '// buildMaterials()');
function pins(args) {
  return vm.runInNewContext(guard + '\n({RETAINED,PINS})', { assert, createHash, process: { argv: ['node', 'capture', ...args] } });
}
assert.equal(pins([]).RETAINED, 'captures/overnight-heavy-neutral-repair1');
const explicit = ['--retained', 'captures/openpass-heavy-observer', '--expected-html-sha256', 'a'.repeat(64),
  '--expected-manifest-sha256', 'b'.repeat(64), '--expected-bundle-sha256', 'c'.repeat(64)];
assert.equal(pins(explicit).PINS['inspection.js'], 'c'.repeat(64));
for (const bad of ['../outside', 'captures/../outside', 'C:/outside', 'captures/nested/path', 'captures/%2e%2e']) {
  assert.throws(() => pins(['--retained', bad, ...explicit.slice(2)]));
}
assert.throws(() => pins(['--retained', 'captures/openpass-heavy-observer']));
assert.throws(() => pins([...explicit.slice(0, -1), 'invalid']));
const verify = between(neutral, 'function verifyBytes(', '\nfunction preflight()');
vm.runInNewContext(verify + '\nassert.throws(()=>verifyBytes(Buffer.from("changed"), "a".repeat(64), "fixture"));',
  { assert, Buffer, sha });
assert.equal(between(neutral, 'const SHOTS = Object.freeze([', '\nfunction verifyBytes'),
  between(oldNeutral, 'const SHOTS = Object.freeze([', '\nfunction verifyBytes'));
for (const source of [neutral, oldNeutral]) {
  assert(source.includes("assert(state.calls > 0 && state.triangles > 0, 'No actual rendered component');"));
  assert(source.includes('assert.deepEqual(state.viewport, [1600, 900, 1]); assert.deepEqual(state.buffer, [1600, 900]);'));
}
pass('actual neutral identity guards reject path escape, omitted pins and tampering; seven poses and nonzero/viewport gates unchanged');

const paths = [qaPath, 'src/characters/blend.ts', capturePath, inspectionPath, neutralPath,
  'node_modules/three/src/renderers/common/Info.js', 'node_modules/three/src/renderers/common/Animation.js'];
console.log(JSON.stringify({ status: 'PASS_CPU_ONLY', frozen, checks,
  source: paths.map(path => ({ path, sha256: sha(readFileSync(join(root, path))) })),
  helperSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  limits: 'Actual selected function bodies, fake rig/renderer ports, installed r180 counters. No browser/GPU/app build, pixels, real contact, motion or performance acceptance. Capture coverage is not a slip-quality threshold; original failure cause remains OPEN.' }, null, 2));
