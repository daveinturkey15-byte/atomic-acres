/**
 * Nuketown 2025 — focused CPU checks for the guest-stationary placement gate.
 *
 * Headless, fast, no browser/GPU/server launched. Tests the pure `hostSpotAccepts`
 * gate exported by `verify-guest-stationary-proof.mjs` plus two honest-wiring guards
 * on that file's source: the stationary proof never walks the guest (`walkTo`,
 * `placeBesidePeer`, `reposition` absent) and still fires the real weapon plus the
 * supported host QA teleport.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostSpotAccepts } from './verify-guest-stationary-proof.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'scripts', 'game', 'verify-guest-stationary-proof.mjs'), 'utf8');

function checkBlockedCannotPass() {
  console.log('[gs-placement] blocked spots cannot pass...');
  const r = hostSpotAccepts({ blocked: true, losChest: true, losHead: true, approvedDiv: 0, guestKnown: true, hostSeen: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'blocked');
}

function checkUnknownPoseCannotPass() {
  console.log('[gs-placement] unknown poses cannot pass...');
  const g = hostSpotAccepts({ blocked: false, losChest: true, losHead: true, approvedDiv: 0, guestKnown: false, hostSeen: true });
  assert.equal(g.ok, false);
  assert.equal(g.reason, 'unknown-guest-pose');
  const h = hostSpotAccepts({ blocked: false, losChest: true, losHead: true, approvedDiv: 0, guestKnown: true, hostSeen: false });
  assert.equal(h.ok, false);
  assert.equal(h.reason, 'unknown-host-pose');
}

function checkNoLosCannotPass() {
  console.log('[gs-placement] missing LOS cannot pass...');
  for (const v of [{ losChest: false, losHead: true }, { losChest: true, losHead: false }, { losChest: false, losHead: false }]) {
    const r = hostSpotAccepts({ blocked: false, approvedDiv: 0, guestKnown: true, hostSeen: true, ...v });
    assert.equal(r.ok, false, JSON.stringify(v));
    assert.equal(r.reason, 'no-los');
  }
}

function checkNoAgreementCannotPass() {
  console.log('[gs-placement] host/guest disagreement cannot pass...');
  const r = hostSpotAccepts({ blocked: false, losChest: true, losHead: true, approvedDiv: 2.4, guestKnown: true, hostSeen: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-agreement');
  const edge = hostSpotAccepts({ blocked: false, losChest: true, losHead: true, approvedDiv: 1.5, guestKnown: true, hostSeen: true });
  assert.equal(edge.ok, true, 'divergence at exactly 1.5 m still agrees (same bound as the duel engine)');
}

function checkValidPasses() {
  console.log('[gs-placement] agreed collider-free LOS spot passes...');
  const r = hostSpotAccepts({ blocked: false, losChest: true, losHead: true, approvedDiv: 0, guestKnown: true, hostSeen: true });
  assert.equal(r.ok, true);
}
function checkNoGuestWalkingLoop() {
  console.log('[gs-placement] stationary proof never walks or repositions the guest...');
  // Call-site shapes only (the header comments name the banned helpers so a
  // reviewer can verify the directive; reason strings like
  // 'no-los-no-reposition' and fields like `repositioned` are data, not calls).
  for (const pat of [/\bwalkTo\s*\(/, /\bplaceBesidePeer\s*\(/, /\breposition\s*\(/]) {
    assert(!pat.test(src), `stationary proof must never call ${pat}`);
  }
  assert(!src.includes("from './verify-combat-feedback-live.mjs'"),
    'stationary proof is standalone: the walking loop is unreachable even by import');
}
function checkRealWeaponAndHostTeleport() {
  console.log('[gs-placement] proof fires the real weapon and moves only the host...');
  assert(src.includes("weaponCmd('fire')"), 'must fire the REAL guest weapon');
  assert(src.includes('__NT.teleport'), 'must use the supported QA teleport for the host target');
  assert(src.includes('no-los-no-reposition'), 'LOS loss must be recorded honestly, never repaired by movement');
}

async function main() {
  checkBlockedCannotPass();
  checkUnknownPoseCannotPass();
  checkNoLosCannotPass();
  checkNoAgreementCannotPass();
  checkValidPasses();
  checkNoGuestWalkingLoop();
  checkRealWeaponAndHostTeleport();
  console.log('[gs-placement] PASS (7 focused groups, no browser/GPU/server).');
}

main().catch((e) => { console.error(e); process.exit(1); });
