# Semtex contact repair — follow-up handoff (2026-09-19)

Follow-up to the scoped semtex patch root already applied. Starting point
snapshot (pre-repair copies): `work/semtex-contact-start/`. Follow-up diff
ONLY (not the previous full patch): `work/semtex-contact-followup-20260919T2135.diff`
(408 lines, 4 files). Everything below is this pass alone.

## The gap (root-found, confirmed)

Wall scenario face at z=2.8, detonation at z=2.15: the sticky branch reused the
bounce path's snapped-back pre-step point (`nx = b.x` on a wall hit), up to a
whole step (0.9 m host tick) off the face. The broad `z > 2.0` assertion
admitted the hover.

## Changed paths (this pass only)

- `src/game/ordnance-physics.ts` — sticky contact placement (only change to
  product flight code; non-sticky bounce/roll path untouched).
- `src/game/ordnance.ts` — comment-only contract corrections (no numbers).
- `scripts/_verify-ordnance.scenario.ts` — 10 new contact checks (73 kept).
- `scripts/_verify-ordnance-browser.mjs` — semtex through the real path.

Untouched as ordered: main, controller, characters, damage, menus, lighting,
network, host-ordnance (fuse/ceiling BEHAVIOR unchanged — see contract note).

## Product fix

`stepBallistic` saves the integrated end `[s, e]` before bounce/bounds/ground
snap-back, then the sticky branch bisects it (`stickyFraction`, 8 rounds,
bounded, no allocation) using ONLY the existing three `WorldQuery` contracts
(`inBounds`, `groundY`, `lineOfSight`). Contact is backed off along travel by
`GRENADE_RADIUS_M` so the casing SKIN touches the face, floor sticks lift to
`groundY + R`, and a corner seam that still reads blocked falls back to the
step start. One stick edge, zero velocity, `resting` short-circuit preserved;
host fuse rewrite (`detonatesAt = stick + fuseMs`) and pool cleanup untouched.

Radius lives in exactly one place: the predicate uses raw `groundY` (an
earlier draft double-counted `R` and hovered floor sticks at `2R`; caught and
fixed before verification).

## Contract correction (comments only, behavior unchanged)

- Old: "never goes off in the air" / "it cannot [miss] on this map".
- Actual: no fuse runs in flight, but the release arms
  `release + fuseMs + SEMTEX_MAX_FLIGHT_MS`, which CAN expire mid-air without
  contact. Stated in `ordnance.ts`; detonation logic untouched.
- Player sticking remains OPEN.

## Verification (this lane)

- `node scripts/_verify-ordnance.mjs --tag contact` → **83/83 hold**
  (73 preserved + 10 new). Wall detonation now at **z=2.71** (was 2.15);
  floor rests at 0.08–0.10 m; boundary sticks at 41.92 (never outside).
- `npm run check` (tsc + render-site allow-list) → clean.
- `node --check scripts/_verify-ordnance-browser.mjs` → OK.
- Browser/GPU NOT run here per orders — root runs the harness below.

## Exact commands for root (after integration)

```bash
npm run check
node scripts/_verify-ordnance.mjs --tag contact
node scripts/_verify-ordnance-browser.mjs --port 4192 --tag j-play
```

Harness routing is explicit (`--url` > `--port` > shared preview), output tag
required, `--seconds` over 135 refused (≤150 s budget), owned browser cleanup
in `finally` (browser.close + killTree). Semtex rides the real
deployment/loadout/`weaponCmd`/admitted-event path: custom semtex loadout
seeded pre-bind, `tacticalId === 'semtex'` required on the HUD level, thrown
and exactly-once detonated required on the client log, live flight observed
between release and detonation, no page errors. Frag/flash/smoke/knife/pickup
checks kept.

## Proposed SEPARATE small patch (not included — no backdoor smuggled)

The existing QA view exposes live flight COUNTS, not casing positions, so the
browser leg cannot measure the contact point. Proposed read-only addition to
`OrdnanceScene.qa()`: `flights: view.flights.filter(f => f.live).map(f =>
({ id, grenadeId, x, y, z, resting }))`. Projection copy only; no product
control path. Awaiting root approval before touching it.

## Honest unresolved points

- Glancing wall hits embed up to `R(1−cosθ)` (≈2 cm at 45°): pullback runs
  along travel, and no distance-to-face query exists on the port. Centre is
  provably clear (segment test); skin graze is visual-only.
- Corner fallback sticks the step start on adversarial seams; covered by a
  region test, not an exhaustive seam sweep.
- `sawLive` in the browser leg counts all live flights (bot frags share the
  pool); the gate is the conjunction with own thrown/exactly-once lines, not
  the count alone.
- Semtex browser timing assumes a tactical pouch within `whenSupplied`'s 45 s
  window (next life); a long death streak could refuse it — the step logs why.
- One repair only, per orders; frag/smoke/flash trajectories byte-unchanged.
