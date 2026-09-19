/**
 * _verify-semtex-live-analysis — CPU falsifier and invariant test suite for
 * `scripts/lib/semtex-analysis.mjs`. Pure CPU, no browser, no GPU, finishes in < 1 s.
 *
 * Verifies that `analyseSemtexRun`:
 *   1. Accepts a valid, golden live run with verdict === 'HOLDS' and 18/18 checks passing.
 *   2. Rejects each specific failure mode independently:
 *      - missing qa().flights projection
 *      - loadout tacticalId not semtex, HUD not naming SEMTEX, or panel button never pressed
 *      - release before arm / unordered release
 *      - live flight not marked sticky
 *      - no contact before ceiling
 *      - moving casing (< 3 stationary frames within tolerance)
 *      - duplicate throw or resurrected flight ID (presence gap + reappearance)
 *      - unconsumed tactical pouch / uncleared armed state / respawn mid-window
 *      - missing, duplicate, or mismatched detonation event
 *      - fuse running from throw instead of contact (outside 1100 +/- 200 ms)
 *      - detonation displaced from stuck position (> 0.5 m)
 *      - missing blast smoke announcement
 *      - bundle hash mismatch across run
 *      - WebGL2 fallback backend instead of actual WebGPU
 *      - page errors
 *      - stunted frame loop / zero fps
 *      - missing stuck or after screenshots, or screenshots without a stuck-casing proof
 */

import assert from 'node:assert/strict';
import { analyseSemtexRun, SEMTEX_FUSE_MS } from './lib/semtex-analysis.mjs';

function makeGolden() {
  const selfId = 'you';
  const flightId = 42;
  const armT = 1000;
  const relT = 1450;
  const contactT = 2000;
  const detT = contactT + SEMTEX_FUSE_MS; // 3100
  const stuckPos = { x: -6.0, y: 0.1, z: 5.5 };

  const frames = [];
  // 120 frames at ~16.6ms intervals (2000ms span: 800ms to 2800ms)
  for (let i = 0; i < 140; i++) {
    const t = 800 + i * 16.6;
    const isArmed = t >= armT && t < relT;
    const tactical = t < relT ? 1 : 0;
    const armed = isArmed ? 'semtex' : null;
    const flights = [];

    if (t >= relT && t <= detT) {
      const isResting = t >= contactT;
      const pos = isResting ? stuckPos : { x: -6.0, y: 1.5 - (t - relT) * 0.002, z: (t - relT) * 0.01 };
      flights.push({
        id: flightId,
        grenadeId: 'semtex',
        ownerId: selfId,
        sticky: true,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        resting: isResting,
        bornAt: relT,
        detonatesAt: detT,
      });
    }

    frames.push({
      t,
      n: i,
      selfId,
      tactical,
      armed,
      spawnSeq: 1,
      lineCount: 10 + (t > relT ? 1 : 0) + (t >= detT ? 2 : 0),
      flights,
    });
  }

  const lineTail = [
    `${Math.round(relT)} grenade-thrown you semtex id=${flightId}`,
    `${Math.round(detT)} grenade-detonated you semtex id=${flightId} victims=1 at=${stuckPos.x.toFixed(3)},${stuckPos.y.toFixed(3)},${stuckPos.z.toFixed(3)}`,
    `${Math.round(detT + 10)} smoke-volume id=99 blast x=${stuckPos.x.toFixed(3)} y=${stuckPos.y.toFixed(3)} z=${stuckPos.z.toFixed(3)}`,
  ];

  return {
    frames,
    lineTail,
    baselineLineCount: 5,
    armPerfNow: armT,
    releasePerfNow: relT,
    hudTacticalPre: '◆ SEMTEX 1',
    hudTacticalPost: '◆ SEMTEX 0',
    tacticalIdReadback: 'semtex',
    webgpu: { renderer: 'webgpu', post: 'webgpu', postEnabled: true },
    panelSemtexPressed: true,
    bundleStart: { sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' },
    bundleEnd: { sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' },
    expectSha: null,
    pageErrors: [],
    fpsBefore: 60,
    fpsAfter: 60,
    screenshots: { stuck: 125000, after: 132000 },
  };
}

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    throw err;
  }
}

console.log('[semtex-analysis] Running synthetic invariant and falsifier suite');

// 1. Golden case
test('golden run holds with 18/18 checks passing', () => {
  const input = makeGolden();
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'HOLDS');
  assert.equal(res.checks.length, 18);
  for (const c of res.checks) {
    assert.equal(c.pass, true, `Expected ${c.name} to pass: ${c.detail}`);
  }
  assert.equal(res.facts.flightIds.length, 1);
  assert.equal(res.facts.stuckFrames >= 3, true);
});

// 2. Missing projection patch
test('falsifier: missing qa().flights projection is refuted', () => {
  const input = makeGolden();
  input.frames = input.frames.map((f) => {
    const { flights, ...rest } = f;
    return rest;
  });
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'projection-flights');
  assert.equal(c.pass, false);
});

// 3. Loadout mismatch
test('falsifier: tacticalId not semtex is refuted', () => {
  const input = makeGolden();
  input.tacticalIdReadback = 'flash';
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'loadout-bound-semtex');
  assert.equal(c.pass, false);
});

// 4. Missing HUD tactical readout
test('falsifier: missing pre-match HUD tactical label is refuted', () => {
  const input = makeGolden();
  input.hudTacticalPre = null;
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'loadout-bound-semtex');
  assert.equal(c.pass, false);
});

// 5. Unordered release
test('falsifier: release before arm is refuted', () => {
  const input = makeGolden();
  input.releasePerfNow = input.armPerfNow - 100;
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'release-ordered');
  assert.equal(c.pass, false);
});

// 6. Flight not sticky
test('falsifier: flight reporting sticky=false is refuted', () => {
  const input = makeGolden();
  for (const f of input.frames) {
    for (const fl of f.flights) fl.sticky = false;
  }
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'own-flight-appeared');
  assert.equal(c.pass, false);
});

// 7. No contact
test('falsifier: semtex never resting is refuted', () => {
  const input = makeGolden();
  for (const f of input.frames) {
    for (const fl of f.flights) fl.resting = false;
  }
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'first-contact');
  assert.equal(c.pass, false);
});

// 8. Moving casing (drifting position)
test('falsifier: casing drifting > 2cm after contact is refuted', () => {
  const input = makeGolden();
  let shift = 0;
  for (const f of input.frames) {
    for (const fl of f.flights) {
      if (fl.resting) {
        shift += 0.05; // 5 cm per frame
        fl.x += shift;
      }
    }
  }
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'stationary-3-frames');
  assert.equal(c.pass, false);
});

// 9. Fewer than 3 stuck frames
test('falsifier: casing detonating immediately after 1 frame is refuted', () => {
  const input = makeGolden();
  let contactSeen = 0;
  for (const f of input.frames) {
    f.flights = f.flights.filter((fl) => {
      if (fl.resting) {
        contactSeen++;
        return contactSeen <= 1;
      }
      return true;
    });
  }
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'stationary-3-frames');
  assert.equal(c.pass, false);
});

// 10. Duplicate throw line
test('falsifier: duplicate grenade-thrown line is refuted', () => {
  const input = makeGolden();
  input.lineTail.unshift('1451 grenade-thrown you semtex id=43');
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'single-throw-single-id');
  assert.equal(c.pass, false);
});

// 11. Inventory not spent
test('falsifier: tactical charge not decremented after throw is refuted', () => {
  const input = makeGolden();
  for (const f of input.frames) f.tactical = 1; // never spent
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'inventory-consumed');
  assert.equal(c.pass, false);
});

// 12. Respawn during window
test('falsifier: respawn inside observation window is refuted', () => {
  const input = makeGolden();
  // Player died and respawned (spawnSeq increased)
  for (let i = 80; i < input.frames.length; i++) input.frames[i].spawnSeq = 2;
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'inventory-consumed');
  assert.equal(c.pass, false);
});

// 13. Detonation missing
test('falsifier: no grenade-detonated event is refuted', () => {
  const input = makeGolden();
  input.lineTail = input.lineTail.filter((l) => !l.includes('grenade-detonated'));
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'detonated-exactly-once');
  assert.equal(c.pass, false);
});

// 14. Fuse timed from throw instead of stick
test('falsifier: fuse detonating 500 ms after stick (under 1100-200ms) is refuted', () => {
  const input = makeGolden();
  // Change det line to 2500 (contact at 2000 -> 500ms)
  input.lineTail = input.lineTail.map((l) =>
    l.replace(/3100 grenade-detonated/, '2500 grenade-detonated')
  );
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'fuse-from-stick');
  assert.equal(c.pass, false);
});

// 15. Detonation away from stuck position
test('falsifier: blast coordinates > 0.5m from stuck coordinates is refuted', () => {
  const input = makeGolden();
  input.lineTail = input.lineTail.map((l) =>
    l.replace(/at=-6.000,0.100,5.500/, 'at=-6.000,2.500,5.500') // 2.4 m away
  );
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'detonated-at-stuck-point');
  assert.equal(c.pass, false);
});

// 16. Missing blast smoke
test('falsifier: missing smoke-volume blast announcement is refuted', () => {
  const input = makeGolden();
  input.lineTail = input.lineTail.filter((l) => !l.includes('smoke-volume'));
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'blast-smoke-announced');
  assert.equal(c.pass, false);
});

// 17. Bundle hash changed
test('falsifier: bundle hash mutation between start and end is refuted', () => {
  const input = makeGolden();
  input.bundleEnd = { sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' };
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'bundle-identity');
  assert.equal(c.pass, false);
});

// 18. Missing screenshots
test('falsifier: missing screenshots is refuted', () => {
  const input = makeGolden();
  input.screenshots = { stuck: 0, after: 0 };
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'screenshots-captured');
  assert.equal(c.pass, false);
});

// 19. Panel button never pressed (readback + HUD alone prove a store value, not a menu action)
test('falsifier: unpressed panel button is refuted even with semtex readback and HUD', () => {
  const input = makeGolden();
  input.panelSemtexPressed = false;
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'loadout-bound-semtex');
  assert.equal(c.pass, false);
});

// 20. HUD naming the wrong tactical (any-HUD-string acceptance would pass this)
test('falsifier: HUD naming FLASH instead of SEMTEX is refuted', () => {
  const input = makeGolden();
  input.hudTacticalPre = '◆ FLASH 1';
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'loadout-bound-semtex');
  assert.equal(c.pass, false);
});

// 21. Resurrection as presence gap + reappearance in the real projected shape
// (no live flags exist on the projection; the old property read could never trip)
test('falsifier: retired flight id reappearing after a gap is refuted', () => {
  const input = makeGolden();
  input.frames = input.frames.map((f) => (f.n >= 90 && f.n <= 99 ? { ...f, flights: [] } : f));
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'single-throw-single-id');
  assert.equal(c.pass, false, 'presence gap + reappearance must read as resurrection');
  const stuck = res.checks.find((x) => x.name === 'stationary-3-frames');
  assert.equal(stuck.pass, true, 'the gap must trip resurrection, not the stick proof');
});

// 22. Screenshots claimed without any stuck-casing proof (bytes are not evidence of content)
test('falsifier: screenshots without a live stuck casing are unanchored', () => {
  const input = makeGolden();
  for (const f of input.frames) {
    for (const fl of f.flights) fl.resting = false;
  }
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'screenshot-anchored');
  assert.equal(c.pass, false);
});

// 23. WebGL2 fallback backend instead of actual WebGPU
test('falsifier: fallback renderer/post backend is refuted', () => {
  const input = makeGolden();
  input.webgpu = { renderer: 'webgl', post: 'webgl', postEnabled: false };
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'actual-webgpu');
  assert.equal(c.pass, false);
});

// 24. Replay of live 2224 beat shape: 7 frames armed after release INTENTION,
// committed at the own thrown line, cleared one delivery frame after commit,
// then held null/0 to the blast. Mirrors the actual receipt (arm 19872.9,
// release 20275.5, thrown 20387, last armed 20396.8, first clear 20414.8, det
// 21889): the beat between intent and commit MUST NOT fail inventory.
test('replay: 2224 release->commit beat with delivery frame holds inventory', () => {
  const input = makeGolden();
  const relT = 1450;
  const throwT = 1562; // +112 ms ~= THROW_RELEASE_S, as 20275.5 -> 20387
  const detT = 3100;
  input.armPerfNow = 1000;
  input.releasePerfNow = relT;
  input.lineTail = [
    `${throwT} grenade-thrown you semtex id=42`,
    `${detT} grenade-detonated you semtex id=42 victims=1 at=-6.000,0.100,5.500`,
    `${detT + 10} smoke-volume id=99 blast x=-6.000 y=0.100 z=5.500`,
  ];
  // Beat window: frames in (relT, throwT] still read armed/tac=1 (correct).
  // One delivery frame just after commit still reads armed, then clears and
  // stays cleared to the blast — the 20396.8 -> 20414.8 shape.
  for (const f of input.frames) {
    if (f.t <= throwT) {
      f.tactical = 1;
      f.armed = f.t >= 1000 ? 'semtex' : null;
      f.flights = [];
    } else if (f.t <= throwT + 18) {
      f.tactical = 1; // delivery lag: commit admitted, view not yet applied
      f.armed = 'semtex';
      f.flights = [];
    } else {
      f.tactical = 0;
      f.armed = null;
    }
  }
  const res = analyseSemtexRun(input);
  const c = res.checks.find((x) => x.name === 'inventory-consumed');
  assert.equal(c.pass, true, `2224 beat shape must hold inventory: ${c.detail}`);
});

// 25. Falsifier: genuinely STUCK armed after admission — never clears before
// the blast. The beat admits transient armed before the first clear; it MUST
// NOT admit armed that persists to detonation.
test('falsifier: armed never clearing after admission is refuted', () => {
  const input = makeGolden();
  for (const f of input.frames) {
    if (f.t >= 1000) f.armed = 'semtex'; // stuck: clear never comes
    if (f.t > 1450) f.tactical = 0; // pouch moved, hand did not
  }
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'inventory-consumed');
  assert.equal(c.pass, false, 'stuck-armed must fail inventory even with the pouch spent');
});

// 26. Falsifier: armed clears then RESURRECTS after admission. Bounded
// completion is not enough — the hand must STAY empty after the first clear.
test('falsifier: armed resurrecting after the first clear is refuted', () => {
  const input = makeGolden();
  let cleared = false;
  for (const f of input.frames) {
    if (f.t > 1450 && f.armed === null) cleared = true;
    if (cleared && f.t > 2500 && f.t < 2900) f.armed = 'semtex'; // resurrection
  }
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'inventory-consumed');
  assert.equal(c.pass, false, 'armed resurrection after clear must fail inventory');
});

// 27. Falsifier: pouch NEVER consumed after admission — charge held past the
// commit while the hand clears. Anchored to the admission line, not to the
// release intention: frames after the thrown timestamp never reach 0.
test('falsifier: tactical never reaching 0 after admission is refuted', () => {
  const input = makeGolden();
  for (const f of input.frames) f.tactical = 1; // never spent, before or after
  const res = analyseSemtexRun(input);
  assert.equal(res.verdict, 'REFUTED');
  const c = res.checks.find((x) => x.name === 'inventory-consumed');
  assert.equal(c.pass, false);
});

console.log(`\n[semtex-analysis] All ${passed}/${total} CPU tests passed.`);
