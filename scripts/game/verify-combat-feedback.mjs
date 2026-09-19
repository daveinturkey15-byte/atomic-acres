/**
 * Nuketown 2025 — CPU proof for the floating combat text lane.
 *
 * Runs the REAL `src/ui/combat-feedback.ts` (Node 24 strips its erasable
 * types; the module has no runtime imports) against a minimal DOM fake and a
 * manual frame pump. No browser, no server, no GPU, no network.
 *
 *   node scripts/game/verify-combat-feedback.mjs
 *
 * Proves, against the actual module:
 *   admission   — nonlocal / world / friendly / self / non-finite damage
 *                 produces nothing;
 *   placement   — popups anchor at the VICTIM world position; the attack
 *                 origin (`sourceX/sourceZ`) is never projected;
 *   presentation— body vs head-critical vs lethal classes and summed text;
 *   merge       — rapid hits on one victim merge into one bounded number;
 *   bounds      — pool cap holds under spam, expiry returns nodes, the frame
 *                 callback self-stops when idle and cancels on dispose;
 *   fallback    — no projection → deterministic crosshair-anchored marker;
 *   duplicates  — a repeated identical tuple is rejected;
 *   lifecycle   — reset()/epoch re-admission, warmup auto-reset, ended kept,
 *                 dispose unsubscribes, clears and detaches only its layer.
 */

import assert from 'node:assert/strict';
import {
  createCombatFeedback,
  CFB_POOL_MAX,
  CFB_LIFETIME_MS,
  CFB_MERGE_MS,
} from '../../src/ui/combat-feedback.ts';

// ---------------------------------------------------------------------------
// Minimal DOM fake — only the surface `FeedbackElement`/`FeedbackContainer` name
// ---------------------------------------------------------------------------

function makeEl(tag) {
  return {
    tag,
    className: '',
    textContent: '',
    style: {},
    attrs: Object.create(null),
    children: [],
    parent: null,
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parent = null;
      return child;
    },
    remove() {
      if (this.parent) this.parent.removeChild(this);
    },
  };
}

const doc = { createElement: (tag) => makeEl(tag) };

// ---------------------------------------------------------------------------
// Harness — manual clock, manual frame queue, recording ports
// ---------------------------------------------------------------------------

function makeHarness(overrides = {}) {
  const root = makeEl('#hud');
  const container = {
    ownerDocument: doc,
    appendChild: (c) => root.appendChild(c),
    removeChild: (c) => root.removeChild(c),
  };
  const state = {
    now: 1000,
    unsubCalls: 0,
    projected: [],
    scheduleCount: 0,
    cancelCount: 0,
    reducedMotion: false,
    projectResult: undefined, // undefined = pass-through, null = offscreen
    victims: new Map(),
  };
  const pending = new Set();
  let emitFn = null;
  const ports = {
    subscribe(fn) {
      emitFn = fn;
      return () => {
        state.unsubCalls++;
      };
    },
    localActorId: () => 'you',
    victimPosition: (id) => state.victims.get(id) ?? null,
    project(x, y, z) {
      state.projected.push([x, y, z]);
      if (state.projectResult !== undefined) return state.projectResult;
      return { x: x * 10, y: y * 10 };
    },
    anchor: () => ({ x: 400, y: 300 }),
    now: () => state.now,
    schedule(cb) {
      state.scheduleCount++;
      const entry = { cb };
      pending.add(entry);
      return () => {
        if (pending.delete(entry)) state.cancelCount++;
      };
    },
    reducedMotion: () => state.reducedMotion,
    container,
  };
  Object.assign(state, overrides);
  const harness = { root, state, cfb: createCombatFeedback(ports), emit: null, pump() {
    const q = [...pending];
    pending.clear();
    for (const e of q) e.cb();
  } };
  harness.emit = (e) => emitFn(e);
  // Run the frame callback until the layer goes idle (self-stopping loop).
  harness.drain = function drain(ms = 0) {
    state.now += ms;
    let guard = 0;
    while (pending.size > 0 && guard++ < 200) harness.pump();
  };
  return harness;
}

function dmg(over = {}) {
  return Object.freeze({
    type: 'damage',
    at: 1000,
    attackerId: 'you',
    attackerTeam: 0,
    victimId: 'bot-1',
    victimTeam: 1,
    amount: 25,
    cause: 'bullet',
    zone: 'body',
    weaponId: 'longhorn',
    distance: 12,
    healthAfter: 75,
    sourceX: 999,
    sourceZ: -999,
    ...over,
  });
}

const WARMUP = Object.freeze({
  type: 'match-phase',
  at: 0,
  phase: 'warmup',
  endsAt: 0,
  winner: null,
  winnerId: null,
  endReason: null,
});

let passed = 0;
/** The first popup wrapper: root → layer → popup. */
function popupEl(h) {
  return h.root.children[0].children[0];
}
function ok(label, fn) {
  fn();
  passed++;
  console.log('  ok  ' + label);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

console.log('verify-combat-feedback — CPU proof over src/ui/combat-feedback.ts\n');

ok('admission: nonlocal / world / friendly / self / non-finite show nothing', () => {
  const h = makeHarness();
  h.emit(dmg({ attackerId: 'bot-2' })); // nonlocal attacker (spectated fight)
  h.emit(dmg({ attackerId: null, attackerTeam: null })); // world damage
  h.emit(dmg({ victimTeam: 0 })); // friendly fire — no feedback
  h.emit(dmg({ victimId: 'you' })); // self
  h.emit(dmg({ amount: 0 }));
  h.emit(dmg({ amount: Number.NaN }));
  h.emit(dmg({ healthAfter: Number.NaN }));
  assert.equal(h.cfb.stats.active, 0);
  assert.equal(h.root.children.length, 1); // the layer itself, attached
  assert.equal(h.root.children[0].children.length, 0); // no popups
  assert.equal(h.state.projected.length, 0);
  h.cfb.dispose();
});

ok('placement: projected at the VICTIM position; attack origin never projected', () => {
  const h = makeHarness();
  h.state.victims.set('bot-1', { x: 5, y: 1, z: 7 });
  h.emit(dmg({ sourceX: 999, sourceZ: -999 }));
  assert.equal(h.cfb.stats.active, 1);
  const el = h.root.children[0].children[0];
  assert.equal(el.style.transform, 'translate(50px,10px)'); // x*10, y*10
  for (const [x, , z] of h.state.projected) {
    assert.equal(x, 5);
    assert.equal(z, 7);
  }
  assert.ok(!h.state.projected.some(([x, , z]) => x === 999 || z === -999));
  h.cfb.dispose();
});

ok('presentation: body default; head crit; lethal accent; head+lethal stack', () => {
  const h = makeHarness();
  h.state.victims.set('bot-1', { x: 2, y: 1, z: 3 });
  h.state.victims.set('v2', { x: 2, y: 1, z: 3 });
  h.state.victims.set('v3', { x: 2, y: 1, z: 3 });
  h.state.victims.set('v4', { x: 2, y: 1, z: 3 });
  h.emit(dmg());
  let el = popupEl(h);
  assert.equal(el.className, 'cfb-num');
  assert.equal(el.children[0].textContent, '25');
  h.cfb.reset();

  h.emit(dmg({ victimId: 'v2', zone: 'head', at: 1001 }));
  el = popupEl(h);
  assert.ok(el.className.includes('cfb-crit'));
  assert.ok(!el.className.includes('cfb-lethal'));
  h.cfb.reset();

  h.emit(dmg({ victimId: 'v3', healthAfter: 0, at: 1002 }));
  el = popupEl(h);
  assert.ok(el.className.includes('cfb-lethal'));
  assert.ok(!el.className.includes('cfb-crit'));
  h.cfb.reset();

  h.emit(dmg({ victimId: 'v4', zone: 'head', healthAfter: 0, at: 1003 }));
  el = popupEl(h);
  assert.ok(el.className.includes('cfb-crit'));
  assert.ok(el.className.includes('cfb-lethal'));
  h.cfb.dispose();
});

ok('layer: aria-hidden, presentation role, reduced-motion still class', () => {
  const h = makeHarness({ reducedMotion: true });
  h.emit(dmg({ victimId: 'v5' }));
  const layer = h.root.children[0];
  assert.equal(layer.attrs['aria-hidden'], 'true');
  assert.equal(layer.attrs['role'], 'presentation');
  assert.ok(layer.className.includes('cfb-still'));
  h.cfb.dispose();
});

ok('merge: rapid hits on one victim become one accumulating number', () => {
  const h = makeHarness();
  h.state.now = 2000;
  h.emit(dmg({ victimId: 'm1', amount: 10, at: 2000 }));
  h.state.now = 2100;
  h.emit(dmg({ victimId: 'm1', amount: 15, at: 2100 })); // inside 140 ms window
  assert.equal(h.cfb.stats.active, 1);
  assert.equal(popupEl(h).children[0].textContent, '25');
  // Past the merge window the same victim starts a fresh engagement on the
  // SAME recycled node: one layer child, new amount.
  h.state.now = 2300;
  h.emit(dmg({ victimId: 'm1', amount: 30, at: 2300 }));
  assert.equal(h.cfb.stats.active, 1);
  assert.equal(h.root.children[0].children.length, 1);
  assert.equal(popupEl(h).children[0].textContent, '30');
  // A different victim gets its own number.
  h.emit(dmg({ victimId: 'm2', amount: 7, at: 2301 }));
  assert.equal(h.cfb.stats.active, 2);
  h.cfb.dispose();
});

ok('bounds: pool cap holds under spam; expiry returns nodes; loop self-stops', () => {
  const h = makeHarness();
  for (let i = 0; i < 40; i++) {
    h.emit(dmg({ victimId: 'spam-' + i, at: 1000 + i }));
  }
  assert.equal(h.cfb.stats.active, CFB_POOL_MAX);
  assert.equal(h.cfb.stats.pooled, 0);
  assert.equal(h.root.children[0].children.length, CFB_POOL_MAX);
  h.drain(CFB_LIFETIME_MS + 1);
  assert.equal(h.cfb.stats.active, 0);
  assert.equal(h.cfb.stats.pooled, CFB_POOL_MAX);
  assert.equal(h.root.children.length, 1); // only the layer remains
  assert.equal(pendingSize(h), 0); // no timers while idle
  h.cfb.dispose();
});

ok('fallback: no/offscreen projection → deterministic crosshair-anchored marker', () => {
  const h = makeHarness({ projectResult: null });
  h.state.victims.set('bot-1', { x: 5, y: 1, z: 7 }); // has position, project fails
  h.emit(dmg({ at: 3000 }));
  let el = popupEl(h);
  assert.ok(el.className.includes('cfb-anchored'));
  const t1 = el.style.transform;
  const ax = 400;
  const ay = 300;
  const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\)/.exec(t1);
  assert.ok(m, 'anchored popup carries a screen transform');
  assert.ok(Math.abs(Number(m[1]) - ax) <= 50 && Math.abs(Number(m[2]) - ay) <= 50);
  // Same victim, next engagement: the SAME deterministic offset.
  h.state.now = 3400;
  h.emit(dmg({ at: 3400 }));
  assert.equal(popupEl(h).style.transform, t1);
  // Unknown victim anchors too.
  h.emit(dmg({ victimId: 'ghost', at: 3401 }));
  assert.ok(h.cfb.stats.active === 2);
  h.cfb.dispose();
});

ok('duplicates: identical tuple rejected; distinct tuple admitted', () => {
  const h = makeHarness();
  const e = dmg();
  h.emit(e);
  h.emit(e); // double delivery of the same admitted event
  assert.equal(h.cfb.stats.active, 1);
  h.emit(dmg({ amount: 26, at: 1001 })); // distinct tuple, same victim, fast → merges
  assert.equal(h.cfb.stats.active, 1);
  assert.equal(popupEl(h).children[0].textContent, '51');
  h.emit(dmg({ victimId: 'bot-9', amount: 26, at: 1002 })); // distinct victim → own number
  assert.equal(h.cfb.stats.active, 2);
  h.cfb.dispose();
});

ok('lifecycle: reset()/epoch re-admits; warmup auto-resets; ended does not', () => {
  const h = makeHarness();
  h.emit(dmg({ at: 5000 }));
  assert.equal(h.cfb.stats.epoch, 0);
  h.cfb.reset();
  assert.equal(h.cfb.stats.epoch, 1);
  assert.equal(h.cfb.stats.active, 0);
  assert.equal(h.cfb.stats.seenEvents, 0);
  h.emit(dmg({ at: 5000 })); // replay under the new epoch — admitted again
  assert.equal(h.cfb.stats.active, 1);
  h.emit({ ...WARMUP, at: 5001 });
  assert.equal(h.cfb.stats.active, 0); // fresh match clears the layer
  h.emit(dmg({ at: 5002 }));
  h.emit({ type: 'match-phase', at: 5003, phase: 'ended', endsAt: 5003, winner: 0, winnerId: null, endReason: 'score' });
  assert.equal(h.cfb.stats.active, 1); // end-of-match numbers fade, not snap
  h.cfb.dispose();
});

ok('dispose: unsubscribes, detaches ONLY its layer, goes inert', () => {
  const h = makeHarness();
  const stranger = makeEl('#stranger');
  h.root.appendChild(stranger);
  h.emit(dmg({ at: 6000 }));
  h.cfb.dispose();
  assert.equal(h.state.unsubCalls, 1);
  assert.ok(h.cfb.stats.disposed);
  assert.deepEqual(h.root.children, [stranger]); // layer gone, foreign node kept
  h.emit(dmg({ at: 6001 })); // inert after dispose
  assert.equal(h.cfb.stats.active, 0);
  h.cfb.dispose(); // idempotent
  assert.equal(h.state.unsubCalls, 1);
});

ok('frame callback: scheduled on demand; dispose cancels a PENDING tick', () => {
  const h = makeHarness();
  h.emit(dmg({ at: 7000 }));
  assert.ok(h.state.scheduleCount >= 1);
  h.cfb.dispose(); // a frame is still queued here — it must be cancelled
  assert.ok(h.state.cancelCount >= 1);
});

ok('idle layer stays silent: no frame callbacks once expired', () => {
  const h = makeHarness();
  h.emit(dmg({ at: 7000 }));
  h.drain(CFB_LIFETIME_MS + 1);
  assert.equal(h.cfb.stats.active, 0);
  const before = h.state.scheduleCount;
  h.pump();
  assert.equal(h.state.scheduleCount, before);
  h.cfb.dispose();
});

ok('reduced motion still lives and expires through the same loop', () => {
  const h = makeHarness({ reducedMotion: true });
  h.emit(dmg({ at: 8000 }));
  h.drain(CFB_LIFETIME_MS + 1);
  assert.equal(h.cfb.stats.active, 0);
  h.cfb.dispose();
});

console.log('\nPASS ' + passed + ' scenario groups — real module, headless.');
process.exit(0);

function pendingSize(h) {
  // Indirect: a further drain must be a no-op when the loop is stopped.
  const before = h.state.scheduleCount;
  h.pump();
  return h.state.scheduleCount - before === 0 ? 0 : 1;
}
