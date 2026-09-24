# Atomic Acres restart reconciliation — 2026-09-24

Owner request: find the latest restarted game, preview it, reconcile outstanding
commits and clearly redirect agents from the old project. Codex on dave-gaming-pc
owns this bounded reconciliation; no new development workers or recurring jobs.

## Identity

- Current repository: `daveinturkey15-byte/atomic-acres`, begun 2026-09-17.
- Current checkout: `C:/Users/david/Desktop/stuff/nuketown`.
- Current development branch: `layout-boii-proportions`; latest pre-task source
  `954f8270bd192252b854a4e024ebf0bdc40c401c` (2026-09-23), matching the remote branch.
- Local preview: `http://localhost:4188/`. Read `preview-identity.json` on that
  server and compare its entry-script hash; a listening port alone proves nothing.
- `master` and GitHub Pages are older. This task does not publish a release.
- Predecessor: `daveinturkey15-byte/atomic-acres-browser-arena`, including
  `Desktop/stuff/atomic-acres`, Build19, Pass95, and older pass worktrees.
  Those are reference material, never the default target for new game work.
  Recover measurements and lessons only; do not copy its modules/assets/history.

## Preserved alternate and pending work

`recovery/wave7-20260919` at `c3afc077fafa3aa4c01b9721232dda9165ec663f`
in `worktrees/nuketown-recovery-20260919` is a separate September20 development
line of the NEW repository. It has 123 unique commits versus 6 unique on the
September23 line at task start. Its authored-room preview is source `ce6e283`.
It is preserved, not silently discarded or merged. Muse partial `52facc6` remains
unaccepted there. Newer dates do not prove these alternate features were integrated.

The September23 checkout held pending ParityScout source (two guns and mortar/dart
logic), its tests/report, and an animation capture fix. These are reviewed and
checkpointed separately from production acceptance. Mortar/dart have no complete
3D presentation, dart blip consumer is absent, and new guns use existing rifle
presentation. See `docs/HANDOFF-PARITY.md`; these are unfinished feature foundations.
Untracked captures, comparison assets and historical scripts stay on disk; private
`.claude/` state is not staged. No blanket clean, reset, stash or historical merge.

Before edits, `work/reconcile-20260924/before.bundle` passed `git bundle verify`
with complete history for all three named branches. `before.patch` retains the
three tracked preexisting edits. The workspace lifecycle guard passed with policy
SHA `b7cbfb7424fa464b58dd9b9a3d55fda90088616733dae954321de6f1d8e25f02`.

## Verification contract

1. Fresh Git/remote identity and preserved alternate history.
2. Typecheck and render-site allowlist; 60 weapon, 34 mortar, 14 dart checks;
   retained streak-rejection regression with its moved import corrected.
3. Built preview, real Play solo -> Deploy flow and active match, inspected pixels,
   no browser errors, traversal and unchanged 210-second memory gate.
4. Documentation pointers resolve to this repository and distinguish the old
   predecessor from the alternate recovery branch. No claim of hot adoption by
   already-running agents.

Symptom -> Cause -> Correction -> Verify: the shared Atomic Acres entry opened
Build19 from September13 instead of the September17 restart -> workspace/AKP/native
adapter pointers still named the predecessor -> prepend successor pointers and one
current handoff identity -> compare repository remotes, branch, live JS hash and
actual gameplay frame before saying the preview is the restart.

Symptom -> Cause -> Correction -> Verify: streak rejection check failed to bundle
-> `streakPort` moved to `session-streaks.ts` but the harness imported `session.ts`
-> update that import only -> run the original assertion without changing its hold.

The old synthetic overlay click does start a default match on this branch. The
reconciliation additionally checks the normal visible buttons and active-state
admission; this is stronger route coverage, not proof the prior click was broken.

VERIFIED: typecheck/render allowlist, 108 focused checks, streak rejection,
4/4 gameplay frames, 5/5 traversal routes, 4/4 house entry faces and 4/4 sprint
views passed. Actual gameplay and animation pixels were opened. The unchanged
210-second soak passed: JS slope 0.219 MB/min (limit 0.5), renderer net -2.24 MB.
Sprint still has measured in-game skate up to 5.9 cm; full art quality remains OPEN.

VERIFIED: shared AKP/vault signposts were committed and remote-readback verified.
The old local checkout and integration entry have scoped documentation commits;
their routing/preflight receipts pass at those clean HEADs. Repository descriptions
on GitHub identify the predecessor and current development branch. Historical
runtime and Pages were not published or merged. Existing scratch is preserved.

Symptom -> Cause -> Correction -> Verify: an IPv4 preview link refused while QA
passed -> the existing Vite listener is bound to localhost/IPv6 -> use the actual
`http://localhost:4188/` route -> opened the Atomic Acres menu in the Codex browser.
No owner process was stopped and no second preview service was needed.

Final measured results are recorded in CURRENT.json and the local task report.
