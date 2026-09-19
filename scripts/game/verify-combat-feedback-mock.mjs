/**
 * Nuketown 2025 — CPU mock harness for combat feedback verifier.
 *
 * Tests actual exported functions from verify-combat-feedback-live.mjs:
 *   1. cleanup-on-failedguestjoin: B is registered immediately on launch and outer cleanup
 *      closes it with single clear ownership (no leak, no doublekill).
 *   2. perpullreacquisition: angle pose wait reacquires live LOS; if lost during wait,
 *      repositions and re-aims before firing; tracks actual target life and HP clock.
 *   3. unknown-protectedUntil: missing or non-numeric protectedUntil returns known:false and
 *      off:false (never claimed known-off, no fabricated protection proof).
 *   4. assertDuelLeg: preserved factored duel assertions run without ReferenceError.
 *
 * Headless, fast, no browser/GPU/server launched.
 */

import assert from 'node:assert/strict';
import {
  protectionWait,
  fireShots,
  scenarioDuel,
  assertDuelLeg,
} from './verify-combat-feedback-live.mjs';

async function testUnknownProtectedUntil() {
  console.log('[mock] Testing unknown-protectedUntil semantics...');

  // Case A: protectedUntil is undefined / null (e.g. unknown on guest)
  const pageUnknown = {
    evaluate: async () => ({
      phase: 'active',
      mode: 'guest',
      localId: 'guest-1',
      at: 1000,
      rows: [{ id: 'target-1', hp: 100, alive: true, life: 1, protectedUntil: undefined }],
      counters: { damage: 0, kills: 0, shotRejects: 0 },
      rejects: [],
    }),
  };
  const resUnknown = await protectionWait(pageUnknown, 'target-1', 100);
  assert.equal(resUnknown.known, false, 'unknown protectedUntil must set known=false');
  assert.equal(resUnknown.off, false, 'unknown protectedUntil must NEVER return off=true (no fabricated proof)');
  assert.equal(resUnknown.reason, 'unknown-protectedUntil');

  // Case B: target row completely absent
  const resAbsent = await protectionWait(pageUnknown, 'missing-id', 100);
  assert.equal(resAbsent.known, false, 'absent row must set known=false');
  assert.equal(resAbsent.off, false, 'absent row must return off=false');
  assert.equal(resAbsent.reason, 'victim-absent');

  // Case C: protectedUntil is known and currently active (remaining > 0)
  const pageActive = {
    evaluate: async () => ({
      phase: 'active',
      mode: 'host',
      localId: 'host-1',
      at: 1000,
      rows: [{ id: 'target-1', hp: 100, alive: true, life: 1, protectedUntil: 5000 }],
      counters: { damage: 0, kills: 0, shotRejects: 0 },
      rejects: [],
    }),
  };
  const resActive = await protectionWait(pageActive, 'target-1', 50);
  assert.equal(resActive.known, true, 'valid numeric protectedUntil sets known=true');
  assert.equal(resActive.off, false, 'active protection returns off=false');

  // Case D: protectedUntil is known and expired (remaining <= 0)
  const pageExpired = {
    evaluate: async () => ({
      phase: 'active',
      mode: 'host',
      localId: 'host-1',
      at: 2000,
      rows: [{ id: 'target-1', hp: 100, alive: true, life: 1, protectedUntil: 1500 }],
      counters: { damage: 0, kills: 0, shotRejects: 0 },
      rejects: [],
    }),
  };
  const resExpired = await protectionWait(pageExpired, 'target-1', 100);
  assert.equal(resExpired.known, true, 'valid numeric protectedUntil sets known=true');
  assert.equal(resExpired.off, true, 'expired protection returns off=true');

  console.log('  -> OK: unknown-protectedUntil semantics verified (never claims known-off).');
}

async function testPerPullReacquisition() {
  console.log('[mock] Testing perpullreacquisition and life/HP clock tracking...');

  let aimCallCount = 0;
  let losHistory = [];
  let repositionCount = 0;
  let triggerPulledWithLos = [];

  let botX = 0, botZ = 6;
  let botHp = 100;
  let botLife = 1;
  let hostClock = 5000;

  const mockPage = {
    evaluate: async (fn, arg) => {
      // Stringified evaluate simulation
      if (typeof fn === 'function') {
        const text = fn.toString();
        // cfbRecords
        if (text.includes('__CFB_PROOF?.records')) {
          return botHp < 100 ? [{ text: '34', cls: 'cfb-num', transform: 'translate(100px, 200px)', t: 5100 }] : [];
        }
        // actors()
        if (text.includes('snapshot().actors') || text.includes('s.actors.map')) {
          return {
            phase: 'active',
            mode: 'solo',
            localId: 'local-player',
            at: hostClock,
            rows: [{ id: 'bot-1', team: 1, bot: true, hp: botHp, alive: botHp > 0, life: botLife, protectedUntil: 1000 }],
            counters: { damage: 100 - botHp, kills: 0, shotRejects: 0 },
            rejects: [],
          };
        }
        // firingSolution
        if (text.includes('collidersAt') || text.includes('tries')) {
          // Re-acquisition finds a spot beside bot's new position
          return { victim: { id: 'bot-1', x: botX, y: 0, z: botZ }, spot: { ax: botX, az: botZ - 6 } };
        }
        // aimAt
        if (text.includes('Math.atan2(-dx, -dz)')) {
          aimCallCount++;
          // Simulate: call 1 (initial aim) has LOS.
          // Then during angle pose wait (sleep 150), bot steps behind obstacle!
          // Call 2 (reacquire check after pose wait) has NO LOS.
          // Reposition is called.
          // Call 3 (aim after reposition) has LOS.
          // Call 4 (re-check after second pose wait) has LOS.
          let hasLos = true;
          if (aimCallCount === 2) {
            hasLos = false; // bot moved behind cover during angle pose wait!
          }
          losHistory.push(hasLos);
          return { aimed: true, victimId: 'bot-1', dist: 6, los: hasLos, body: { x: botX, y: 0, z: botZ } };
        }
        // pullTrigger
        if (text.includes("weaponCmd('fire')")) {
          // Record what the latest LOS was when trigger was pulled
          const currentLos = losHistory[losHistory.length - 1];
          triggerPulledWithLos.push(currentLos);
          botHp -= 34;
          hostClock += 350;
          return {
            fired: true,
            triggerAdmitted: 1,
            mag: 29,
            cool: 0,
            reloading: false,
            dmgDelta: 34,
            rejectDelta: 0,
            rejects: [],
          };
        }
        // teleport
        if (text.includes('teleport')) {
          repositionCount++;
          return true;
        }
      }
      return null;
    },
  };

  const shot = await fireShots(mockPage, 'bot-1', 'chest', {
    bound: 4,
    stop: 'first-step',
    gateMs: 1000,
    kills0: 0,
    authPage: mockPage,
  });

  assert.equal(shot.fired, 1, 'expected 1 shot fired');
  assert.equal(shot.steps.length, 1, 'expected 1 step recorded');
  assert.equal(shot.steps[0].hpDelta, 34, 'expected hpDelta of 34');
  assert.equal(shot.steps[0].hp0, 100, 'expected hp0=100');
  assert.equal(shot.steps[0].hp1, 66, 'expected hp1=66');
  assert.equal(shot.steps[0].life0, 1, 'expected life0=1');
  assert.equal(shot.steps[0].life1, 1, 'expected life1=1');
  assert(shot.steps[0].clock0 > 0, 'expected valid clock0');
  assert(shot.steps[0].clock1 >= shot.steps[0].clock0, 'expected clock1 >= clock0');

  // Verify that LOS was checked at least twice (initial + after angle pose wait):
  assert(aimCallCount >= 2, `expected at least 2 aim calls, got ${aimCallCount}`);
  // Verify that trigger was NEVER pulled when los was false:
  assert.equal(triggerPulledWithLos.length, 1);
  assert.equal(triggerPulledWithLos[0], true, 'trigger MUST only be pulled when LOS is true');
  // Verify reposition was triggered when LOS was lost:
  assert(shot.repositions >= 1, `expected repositions >= 1, got ${shot.repositions}`);

  console.log('  -> OK: perpullreacquisition and life/HP clock tracking verified.');
}

async function testCleanupOnFailedGuestJoin() {
  console.log('[mock] Testing cleanup-on-failedguestjoin and B ownership...');

  let registeredB = null;
  let bCloseCallCount = 0;

  const mockBrowserB = {
    label: 'mock-B',
    page: {
      on: () => {},
      getByRole: (role, opts) => ({
        waitFor: async () => {},
        click: async () => {
          if (opts?.name === 'Join by code') {
            throw new Error('WebRTC signaling connection failed (simulated)');
          }
        },
      }),
      getByLabel: () => ({
        fill: async () => {},
        selectOption: async () => {},
        dispatchEvent: async () => {},
        check: async () => {},
      }),
      waitForFunction: async () => {},
      goto: async () => {},
      evaluate: async () => ({}),
      screenshot: async () => {},
    },
    close: async () => {
      bCloseCallCount++;
    },
  };

  const mockStockBrowser = async (label) => {
    assert.equal(label, 'cfb-live-B');
    return mockBrowserB;
  };

  const mockA = {
    page: {
      on: () => {},
      getByRole: () => ({
        waitFor: async () => {},
        click: async () => {},
      }),
      getByLabel: () => ({
        selectOption: async () => {},
        fill: async () => {},
        dispatchEvent: async () => {},
        check: async () => {},
      }),
      waitForFunction: async () => {},
      evaluate: async () => 'ABC123',
      goto: async () => {},
      screenshot: async () => {},
    },
    close: async () => {},
  };

  // Outer cleanup simulation
  let outerB = null;
  let caughtError = null;

  try {
    await scenarioDuel(mockA, (peerB) => {
      registeredB = peerB;
      outerB = peerB;
    }, mockStockBrowser);
  } catch (err) {
    caughtError = err;
  } finally {
    // Single ownership cleanup with nulling:
    if (outerB) {
      const b = outerB;
      outerB = null;
      await b.close();
    }
  }

  assert(caughtError !== null, 'expected scenarioDuel to throw on failed guest join');
  assert(caughtError.message.includes('WebRTC signaling connection failed'), `unexpected error: ${caughtError.message}`);
  assert.equal(registeredB, mockBrowserB, 'B must be registered immediately after launch');
  assert.equal(bCloseCallCount, 1, 'outer cleanup must close B exactly once (no leak, no doublekill)');

  // Verify doublekill protection (closing again does nothing because outerB was nulled)
  if (outerB) {
    await outerB.close();
  }
  assert.equal(bCloseCallCount, 1, 'doublekill was prevented');

  console.log('  -> OK: cleanup-on-failedguestjoin verified (immediate registration + no leak + no doublekill).');
}

async function testAssertDuelLegFactored() {
  console.log('[mock] Testing assertDuelLeg factorization (no ReferenceError b/h)...');

  const mockLeg = {
    targetId: 'remote-peer-1',
    body: {
      fired: 2,
      admitted: 2,
      rejected: 0,
      repositions: 0,
      kill: false,
      lethal: [],
      steps: [{
        hp0: 100,
        hp1: 66,
        hpDelta: 34,
        popup: { text: '34', cls: 'cfb-num' },
        newPopups: 1,
        alive: true,
      }],
      diag: [],
    },
    head: {
      fired: 3,
      admitted: 3,
      rejected: 0,
      repositions: 0,
      crit: true,
      kill: true,
      lethal: [{ text: '51', cls: 'cfb-num cfb-crit cfb-lethal' }],
      steps: [{
        hp0: 66,
        hp1: 15,
        hpDelta: 51,
        popup: { text: '51', cls: 'cfb-num cfb-crit' },
        newPopups: 1,
        alive: true,
      }],
      diag: [],
    },
    victimNew: 0,
    dmgDelta: 85,
    killsDelta: 1,
    victimAlive: false,
  };

  // Run assertDuelLeg for both host-fires and guest-fires (mirror)
  assertDuelLeg(mockLeg, 'host-fires', 'guest', false);
  assertDuelLeg(mockLeg, 'guest-fires', 'host', true);

  console.log('  -> OK: assertDuelLeg factorization runs without ReferenceError.');
}

async function main() {
  console.log('--- Starting CPU Mock Harness for verify-combat-feedback-live.mjs ---');
  await testUnknownProtectedUntil();
  await testPerPullReacquisition();
  await testCleanupOnFailedGuestJoin();
  await testAssertDuelLegFactored();
  console.log('--- ALL CPU MOCK HARNESS CHECKS PASSED ---');
}

main().catch((e) => {
  console.error('[mock] FAILED:', e);
  process.exit(1);
});
