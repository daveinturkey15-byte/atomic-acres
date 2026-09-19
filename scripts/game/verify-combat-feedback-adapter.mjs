/**
 * Nuketown 2025 — adapter-level CPU proof for the combat-feedback wiring.
 *
 * The leaf proof (`verify-combat-feedback.mjs`) drives `createCombatFeedback`
 * with recording ports. This drives the REAL `createCombatFeedbackAdapter`
 * (the shipped `src/main.ts` plumbing: HUD container, camera projection,
 * match gating) with a fake HUD, a real PerspectiveCamera, and a stub match,
 * and asserts the adapter-owned contracts: idle gating, victim anchoring with
 * a dead record kept, local-only admission, replay dedupe, non-finite
 * rejection, reset/dispose delegation, and a self-stopping frame loop.
 *
 * Each scenario uses its own victim: the leaf merges rapid hits on one victim
 * (CFB_MERGE_MS on the real `performance.now()` clock), so sharing a victim
 * across scenarios would merge instead of adding.
 *
 * Headless, deterministic, no browser/GPU/server. Run via esbuild bundle
 * (the adapter's extensionless relative imports resolve under vite/tsc, not
 * under node's type-stripping ESM):
 *   npm exec -- esbuild scripts/game/verify-combat-feedback-adapter.mjs \
 *     --bundle --platform=node --format=esm --outfile=work/cfb-adapter.probe.mjs
 *   node work/cfb-adapter.probe.mjs
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCombatFeedbackAdapter } from '../../src/ui/combat-feedback-adapter.ts';

// ---------------------------------------------------------------------------
// Browser globals the adapter reads at call time (never at import time)
// ---------------------------------------------------------------------------

globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;

const rafQueue = new Set();
let scheduleCount = 0;
let cancelCount = 0;
globalThis.requestAnimationFrame = (cb) => {
  scheduleCount++;
  const entry = { cb };
  rafQueue.add(entry);
  return entry;
};
globalThis.cancelAnimationFrame = (entry) => {
  if (rafQueue.delete(entry)) cancelCount++;
};
globalThis.matchMedia = () => ({ matches: false });

// ---------------------------------------------------------------------------
// Minimal DOM fake — same surface as the leaf proof
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

const hud = makeEl('#hud');
hud.ownerDocument = { createElement: (tag) => makeEl(tag) };

// ---------------------------------------------------------------------------
// Camera + match stub
// ---------------------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(90, 1600 / 900, 0.1, 200);
camera.position.set(0, 1.6, 8);
camera.lookAt(0, 1, 0);
camera.updateMatrixWorld(true);

function body(id, x, z, alive = true) {
  return { id, x, y: 1, z, yaw: 0, speed: 0, alive };
}
const VICTIMS = new Map([
  ['bot-A', body('bot-A', 0, 0)],
  // Host snapshot can mark death before/after the event; the adapter keeps it.
  ['bot-B', body('bot-B', 1.5, -1, false)],
  ['bot-C', body('bot-C', -1.5, -1)],
  ['bot-E', body('bot-E', 0, -2)],
  ['bot-F', body('bot-F', 2, 1)],
  ['bot-G', body('bot-G', -2, 1)],
]);
let mode = 'solo';
const match = {
  get localId() {
    return 'you';
  },
  mode: () => mode,
  bots: () => [...VICTIMS.values()],
};

const adapter = createCombatFeedbackAdapter({
  hud,
  camera,
  match: () => match,
});

const layer = () => hud.children[0];
const popups = () => (layer() ? layer().children : []);
const pump = () => {
  const q = [...rafQueue];
  rafQueue.clear();
  for (const e of q) e.cb();
};
const drain = (guard = 200) => {
  let n = 0;
  while (rafQueue.size > 0 && n++ < guard) pump();
};

function dmg(over = {}) {
  return Object.freeze({
    type: 'damage',
    at: 1000,
    attackerId: 'you',
    attackerTeam: 0,
    victimId: 'bot-A',
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

let passed = 0;
function ok(label, fn) {
  fn();
  passed++;
  console.log('  ok  ' + label);
}

console.log('verify-combat-feedback-adapter — adapter proof over the real adapter + leaf\n');

ok('idle match admits nothing (localActorId null gate)', () => {
  mode = 'idle';
  adapter.onEvent(dmg({ victimId: 'bot-A', at: 900 }));
  drain();
  assert.equal(popups().length, 0);
  mode = 'solo';
});

ok('admitted local body shot anchors at the victim, default style', () => {
  adapter.onEvent(dmg({ victimId: 'bot-A', at: 1001 }));
  drain(1);
  assert.equal(popups().length, 1);
  const el = popups()[0];
  assert.equal(el.className, 'cfb-num');
  assert.match(el.style.transform ?? '', /^translate\(.+px,.+px\)$/);
  assert.ok(!el.className.includes('cfb-anchored'), 'world-anchored, not fallback');
});

ok('fatal victim with a dead record still places at the victim', () => {
  adapter.onEvent(dmg({ victimId: 'bot-B', at: 2000, amount: 100, healthAfter: 0 }));
  drain(1);
  const lethal = popups().at(-1);
  assert.ok(lethal.className.includes('cfb-lethal'));
  assert.ok(!lethal.className.includes('cfb-anchored'), 'dead record kept, no fallback');
});

ok('head shot is critical; remote/self/friendly/world/NaN admit nothing', () => {
  const before = popups().length;
  adapter.onEvent(dmg({ victimId: 'bot-C', at: 3000, zone: 'head', amount: 34 }));
  drain(1);
  assert.equal(popups().length, before + 1);
  assert.ok(popups().at(-1).className.includes('cfb-crit'));
  adapter.onEvent(dmg({ victimId: 'bot-C', at: 3001, attackerId: 'bot-9', attackerTeam: 1 }));
  adapter.onEvent(dmg({ victimId: 'you', victimTeam: 0, at: 3002 }));
  adapter.onEvent(dmg({ victimId: 'bot-C', at: 3003, attackerTeam: 0, victimTeam: 0 }));
  adapter.onEvent(dmg({ victimId: 'bot-C', at: 3004, attackerId: null, attackerTeam: null }));
  adapter.onEvent(dmg({ victimId: 'bot-C', at: 3005, amount: Number.NaN }));
  adapter.onEvent(dmg({ victimId: 'bot-C', at: 3006, amount: Number.POSITIVE_INFINITY }));
  drain();
  assert.equal(popups().length, before + 1, 'only the local head shot added');
});

ok('identical tuple replay admits nothing (exactly-once)', () => {
  const event = dmg({ victimId: 'bot-E', at: 4000, amount: 11 });
  const before = popups().length;
  adapter.onEvent(event);
  drain(1);
  assert.equal(popups().length, before + 1);
  adapter.onEvent({ ...event });
  drain();
  assert.equal(popups().length, before + 1, 'replay rejected');
});

ok('reset clears the layer and re-admits; loop self-stops when idle', () => {
  adapter.reset();
  assert.equal(popups().length, 0);
  adapter.onEvent(dmg({ victimId: 'bot-F', at: 5000 }));
  drain(1);
  assert.equal(popups().length, 1);
  // Expire the popup (900 ms lifetime) by advancing the real clock past it.
  const t0 = performance.now();
  while (performance.now() - t0 < 1100) {
    // busy-wait: deterministic, no timers in the leaf
  }
  drain();
  assert.equal(popups().length, 0);
  const scheduled = scheduleCount;
  pump();
  assert.equal(scheduleCount, scheduled, 'no frame callbacks once idle');
});

ok('dispose detaches ONLY its layer, cancels a pending tick, goes inert', () => {
  adapter.onEvent(dmg({ victimId: 'bot-G', at: 6000 }));
  assert.ok(rafQueue.size > 0, 'a tick is pending');
  const hudKids = hud.children.length;
  adapter.dispose();
  assert.ok(cancelCount >= 1, 'pending tick cancelled');
  assert.equal(rafQueue.size, 0);
  assert.equal(hud.children.length, hudKids - 1, 'layer detached');
  adapter.onEvent(dmg({ victimId: 'bot-G', at: 6001 }));
  pump();
  assert.equal(hud.children.length, hudKids - 1, 'inert after dispose');
});

console.log('\nPASS ' + passed + ' adapter groups — real adapter + leaf, headless.');
process.exit(0);
