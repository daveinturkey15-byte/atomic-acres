# RECEIPT — supply-crate-solo-integration-glm-1117

Scope owned: `work/supply-crate-solo-integration-glm-1117` in
`nuketown-glm-respawn-20260919` ONLY. Root `nuketown-recovery-20260919` and
all prior scopes read-only. No GPU/browser/server/Blender used; no credentials.

## What the patch does (minimal REAL solo vertical slice)

`patches/supply-crate-solo-integration-glm-1117.patch` — 7 files, +770/−6,
`git apply --check` PASSES from the worktree root (`git apply <patch>` from
`worktrees/nuketown-glm-respawn-20260919`).

Edits to CURRENT root files:
- `src/game/events.ts` — folds the crate leaf (`events-crate.ts`) into
  `GameEvent` + `GAME_EVENT_TYPES` (the exact pattern `events-ordnance` uses).
- `src/game/killstreaks/runtime.ts` — `'supply-crate': 'supply-crate'` added to
  `EFFECT_KIND` (the earned streak now reaches the authoritative stepper;
  previously it refused `arena-unsupported`); `SupplyCrateState` in
  `LiveInstance`; placement validated BEFORE the charge moves (`no-placement`
  keeps the charge banked, Rule 5); `advance()` steps the crate with the host's
  own target table + world and performs GRANT ADMISSION: when the stepper says
  a hold completed, the runtime — the only ledger writer — admits the rolled
  reward through `crateGrantFits` (bank caps), banks the charge, emits
  `streak-earned` (slot 0: granted, not on a key) + `crate-opened` beside it,
  and deletes the instance from `live` — that deletion is the exactly-once
  guarantee. A refused grant (full bank) keeps the crate claimable; the
  stepper resets the hold when the holder walks away; expiry still retires
  `expired` honestly.
- `src/main.ts` — canary wiring ONLY: constructs the visual, feeds it the
  session's real event sink (`setEventSink` — solo session's seam; bound
  opportunistically, so a net session without the sink simply never draws a
  crate instead of pretending broadcast parity), `update(now)` in the render
  loop, `clear()` before every `match?.begin()` (generation reset),
  `dispose()` on `pagehide`, and a HUD legend line naming the canary, that it
  is SOLO ONLY, and how to activate (pick Supply Crate in loadout; when its
  slot is READY press its streak key 3–6; stand inside the crate to hold the
  pickup open and bank the reward). No menu/control semantics touched; the
  other ten streaks and their steppers are untouched.

New files (verbatim from the verified scopes, provenance in tree):
- `src/game/events-crate.ts` — from `supply-crate-signed-zero-repair1-glm-1105`
  (leaf vocabulary, `crate-landed` / `crate-opened`).
- `src/game/killstreaks/effects/supply-crate.ts` — from
  `supply-crate-agy-0912` (the authoritative stepper: secret roll at spawn,
  60 s life, hold-admission 1.25 s own / 2.5 s enemy, bank-cap helpers).
- `src/weapons/supply-crate-visual.ts` + `crate-visual-pin.ts` — from
  `supply-crate-signed-zero-repair1-glm-1105` (the repaired visual: opening
  clock pinned, first update at exact rest, inert after dispose; draw ≤3/crate,
  ~110 tris, MAX 4 live, zero per-frame allocations, compile-time pin against
  the real event shapes).

Nothing else changed: no fabricated events, no QA-spawning as product, no
wallclock authority, no host/guest inversion, no old-project copies.

## Verification (all CPU, synthetic clock)

1. `node work/supply-crate-solo-integration-glm-1117/scripts/_verify-supply-crate-solo.mjs`
   → **PASS**. Bundles `tree/scripts/_verify-supply-crate-solo.scenario.ts`
   (esbuild, a vite dep) and exercises the REAL patched `StreakRuntime`:
   earn ×5 → charge banked; activation admitted; `crate-landed` exactly once
   through `advance()`; hold completes → ONE `streak-earned` (the rolled
   reward, slot 0) + ONE `crate-opened`, instance retired, reward banked once;
   NEGATIVES: no duplicate grant on later ticks, replayed claim rejected
   (`duplicate-claim`), unclaimed crate expires `expired` with no grant,
   `no-placement` keeps the charge, bank-cap helper both ways. Presentation is
   fed the runtime's OWN event arrays through the real visual: landed → drawn,
   opened crate self-exits, `clear()`/`dispose()` lifecycle, 2000-tick
   allocation-free update loop, live cap ≤ 4.
2. `tsc -p work/supply-crate-solo-integration-glm-1117/tsconfig.verify.json`
   (strict) → **PASS** over the integration core + pin + scenario.
3. Patch applied to a scratch copy of the whole app
   (`_patchcheck/`, `cp -r src` + tree overlay), then `tsc -p tsconfig.json
   --noEmit` → **PASS** — this type-checks the `main.ts` wiring against the
   real project closure (the same thing root's `npm run check` would compile).

## Not claimed

No live browser frame, no gameplay capture, no multiplayer/broadcast parity
for the canary (explicitly unavailable; marked in the HUD). `soak`/`playcap`
remain root-owned gates for whoever applies and promotes this patch. The solo
session's event sink exists; the net path was NOT wired by design.

## One known seam for the applier

`main.ts` binds the sink via
`(match as { setEventSink?: ... }).setEventSink?.(...)` because `LocalMatch`
(session.ts) does not re-declare the solo session's `setEventSink`. When the
canary is promoted beyond solo, add the method to the shared interface and
decide the guest story then. Cost of today's shape: none (optional call).

Tree layout: `tree/` mirrors root layout (`src/game`, `src/game/killstreaks`,
`src/weapons`, `scripts/`, plus `src/game/rules.ts` + `src/core/layout.ts`
copies that exist ONLY as tsc import closure — the patch does not touch them).
`tsconfig.verify.json` excludes `tree/src/main.ts` (checked in `_patchcheck`
with full closure instead).
