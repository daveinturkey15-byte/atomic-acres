# Pipeline audit — 20 September 2026

VERIFIED: Dave paused game development to focus on this audit. The development
automation is PAUSED; scheduled game inspections have been withdrawn pending his
resumption. One Astra task owns this work. No new model worker, generation job,
shared-skill edit, credential change or paid decision service was launched.

VERIFIED: both supplied audit documents were read as proposals. Their instructions
to add workers, install Jev or roll out global policy do not override Dave's current
single-agent direction. The scope here is a bounded diagnosis and two local guard
repairs, not completion of every proposed programme in those documents.

## Three main bottlenecks

### 1. Source and integration evidence did not travel with the work

VERIFIED from current source and the retained `SOURCE-BASE-CORRECTION-2026-09-20-1142.json`:
the glove patch referenced a missing current material and an obsolete factory;
the sky module passed 23 CPU assertions but its game wiring was only a note;
the crate patch targeted APIs absent from the actual integration source. The sedan
export ran successfully while decoded mesh geometry and rear glass still failed.
These are specific integration/asset failures, not evidence that inexpensive models
are inherently incapable.

VERIFIED: exact-current private source seeding had already been introduced before
this audit. It was not a new fix made here. The OMP launcher checks the Git
project identity but does not itself enforce the seeded source SHA, writable
scope or unchanged baseline; those controls still depend on the lead and prompts.
The AGY launcher lacks OMP's same-project Git admission check.

VERIFIED: 181 retained OMP summary receipts contain 100 process completions,
77 failures and four interruptions. All intentionally retain `accepted: false`;
root acceptance lives in separate records. That does **not** mean no work was
accepted. It means these process rows cannot calculate accepted throughput.

OPEN: join each accepted artifact to its source/run, review and live-build hash
before using these numbers to compare models or increase parallelism. The file
hashes and grouped counts are preserved in the audit evidence below.

### 2. Some checks validated activity rather than the intended deliverable

VERIFIED: before this repair, the default soak clicked the obsolete hidden start
overlay; real Play solo -> Deploy admission was opt-in via `--solo`. A rendered
menu could therefore receive a clean soak result without exercising combat.

VERIFIED correction: default soak now observes an active solo match before sampling.
`--menu-only` remains an explicitly labelled diagnostic. Missing, throwing or
inactive game APIs fail admission. Receipts record scenario and gameplay entry.
Fault injection happens after entry, so stopping the loop tests liveness rather
than preventing deployment. Memory, frame and resource thresholds are unchanged.

VERIFIED: the current production catalogue has 39 rows: 38 at `reference-generated`
and one queued; none has a populated model/runtime link. This demonstrates an
unfinished catalogue-to-runtime chain, not absence of all assets in the repository.
The game already has authored GLBs and Kimodo animation clips outside that chain.

VERIFIED: the retained active-gameplay noon candidate failed its memory criterion
(0.700 MB/min, r² 0.313); the earlier 4240 comparison passed (0.549, r² 0.165) under
the existing combined slope/fit rule. This audit does not erase that failure,
promote 4242, or claim stronger graphics.

### 3. Shared discovery and operational budgets are only partially enforced

VERIFIED: the fresh shared-bootstrap route guard finds 138/144 matching skills for
Codex, Claude, OMP, AGY, Continue and dsh, and 144/144 for Hermes's nested store.
This is filesystem evidence, not proof of runtime skill use.

VERIFIED: five Codex entries are absent: `game-recording-to-engine-import`,
`generated-asset-rigging`, `likeness-to-game-character`, `making-decent-games` and
`github`. `blocked-page-recovery` points to the old research location. All six
candidate locations are uncommitted in the shared vault, and the regression report
lists all six evaluation records as missing. Across the library the report records
23 additions, 32 removals and 12 updates: 67 unaccepted changes. Its report command
exits zero while reporting drift; that exit code is not acceptance.

VERIFIED: fresh adoption audit reports Claude's expired receipt and Hermes's
expired/hash-stale receipt. Codex's check passes and audit reports no Codex failure.
Native adapter file parity from the earlier report does not establish fresh-session
inheritance. Other harnesses must attest natively; this task cannot attest for them.

VERIFIED: OMP has a 1–30 minute process limit, a 1536 MiB V8 old-space setting and
bounded audit retention. That V8 setting is not a whole-process RAM cap. The
project wrappers do not enforce aggregate spend, token consumption, central
concurrency or repair counts. Writable-file scopes are prompt rules, not a sandbox.
None of the 181 summary objects contains top-level cost/token/usage budget fields.

VERIFIED correction: existing OMP/AGY entrypoints now reject an absent, malformed,
disabled or route-mismatched `CURRENT.json.dispatch_policy` before a provider/ledger
launch. The PowerShell check precedes credential access. Dave's policy currently
disables every external route. This is local admission enforcement only; raw CLI
calls outside these entrypoints are not intercepted.

## Model and tool evidence

| Route | Verified evidence | Current role / limits |
|---|---|---|
| This Astra task | Owner-selected route; no fresh serving-model header inspected | Single audit implementer and reviewer; no independent-review claim |
| OMP `meta-contributor/muse-spark-1.3-contributor`, requested xhigh | 113 receipts; model reported in their assistant envelopes; 83 completed, 29 failed, 1 interrupted | Disabled. Contributor billing and effective reasoning acknowledgement unknown |
| OMP `zai/glm-5.3-flash`, requested max | 68 receipts; 66 report the model, 2 attribution unknown; 17 completed, 48 failed, 3 interrupted | Disabled. Different task mixes prohibit a quality ranking from these totals |
| AGY `gemini-3.8-flash-high`, requested high | Launcher configuration verified; actual serving model remains unknown | Disabled. No model attribution invented from CLI configuration |
| Jev | Primary docs describe typed text decisions, not a visual/implementation model | Not installed or invoked; deterministic checks suffice for the repaired guards |

VERIFIED executable versions: Codex CLI 0.153.4, OMP 18.2.6, AGY 1.2.7, Claude Code
2.1.268 and Blender 5.1.2. Hermes and ffmpeg executables were located; their versions
were not tested. No fresh external model benchmark, vision-input probe or quota
sentinel was run. Tokens, current external quota and actual spend remain unknown.
Codex's account-wide weekly window showed 66% used / 34% remaining; this is not the
cost of this task, and the short-window figure was unavailable. No reset was used.

VERIFIED: this game's installed Three.js is 0.180.0; Skills Lab declares 0.185.1.
The noon game evidence records WebGPU. A version migration is not an art fix.
Blender and the existing Kimodo route already produce usable-format artifacts;
their installation is not the missing step. Generated H3 video remains a motion
reference, not extracted mocap. Trellis's failed low-memory route stays held.
Legacy Blender npm commands also need the newer bounded resource wrapper before
reuse; `--background` by itself does not enforce two threads, 180 seconds or 2 GiB.

OPEN: actual paid/free entitlements and effective reasoning levels require
provider evidence before future routing. Subscription availability and model names
alone do not prove marginal cost or accepted-output value.

Jev primary sources inspected: [TypeSafe System One](https://docs.typesafe.ai/concepts/system-one)
and [OpenRouter's Jev listing](https://openrouter.ai/typesafe/jev-1.13).
No adapter was built. Skills Lab's explicit no-OpenRouter policy remains intact.

## What Skills Lab can contribute

VERIFIED: its active checkout at `C:/Users/david/Desktop/stuff/skills-lab` has
uncommitted sand/control work. It was inspected read-only and remains untouched.
Current artifact hashes match its rig revision 4 and UV Case reports:

- Rig GLB: 165,040 bytes, SHA-256 `fa27d92142a248faffc3afdb34b372599824aee8a8fc18f90a47e7f0aceb4b44`.
- UV Case GLB: 234,656 bytes, SHA-256 `5be77b308c751917a45ade7f91267659633f74f5360946baaea1d7910266af90`.

CLAIMED by the Lab's retained measured receipts, not rerun here: its actual clone
controller tests ground contact and sliding over four gait cycles, binds travel
calibration to the GLB hash and compares irregular frame partitions. Its UV check
examines exported triangle corners, overlaps, border/gutter spacing, coverage and
distortion. Those are concrete methods to adapt; the experimental assets retain
`productionReady: false`. They do not demonstrate turning, navigation, realistic
operators or performance with a crowd. The Lab's source links are in
`docs/rig-travel-refinement.md` and `docs/uv-case-results.md`.

OPEN next game example, only after Dave resumes: one actual bot's stand/walk/crouch
sequence, with translation and clip cadence calibrated together, fixed-camera
in-game video and measured foot contact/sliding. Alternatively choose one complete
interior/weapon scene, but do not expand the first example to the whole map.
Preserve source/code/model/output licences separately and measure the exported
asset in the actual game. No shared skill has been rewritten to declare success.

## Repairs, checks and persistence

VERIFIED changed files:

- `scripts/soak.mjs`, `scripts/lib/soak-scenario.mjs`, `scripts/verify-soak-scenario.mjs`.
- `scripts/orchestration/dispatch_policy.py`, `test_dispatch_policy.py`,
  `run-provider-lane.py`, `run-agy-overnight.py`, `Invoke-ProviderLane.ps1`.
- `AGENTS.md`, `docs/PROVIDER-ORCHESTRATION.md`, `docs/handoff/CURRENT.json`, this report.

VERIFIED reproducible focused checks:

```text
node --check scripts/soak.mjs
node --check scripts/lib/soak-scenario.mjs
node scripts/verify-soak-scenario.mjs
python -m unittest discover -s scripts/orchestration -p test_dispatch_policy.py -v
```

VERIFIED: 16 CPU/DOM admission assertions and five Python guard tests passed.
The negative tests reject missing evidence and prohibit provider/ledger calls.
Actual OMP dry-run, AGY entrypoint and PowerShell dry-run probes were also denied;
OMP receipt count stayed 181 and no AGY attempt directory appeared. No provider
model ran. These checks establish the guard behaviour, not game performance.

VERIFIED: audit resource sample was 27.36 GiB free RAM and 4107 MiB free VRAM;
GPU acceptance was deferred because that did not meet the extra browser-job
headroom rule. The DOM test disabled GPU rendering and closed its own browser.
Owner processes were untouched. There was no full game test suite or new soak.

VERIFIED: retained source before audit is `2ed04420a0ccb585a4c7fe92615efbad4abb5a7c`.
Backups and input hashes live in `.recovery-runtime/pipeline-audit-20260920/`.
`evidence.json` holds summary-receipt hashes, counts, catalogue state and unchanged
frozen-artifact hashes. The pre-existing uncommitted SHOWCASE edit is preserved and
excluded from this audit's commit. Frozen game artifacts were not rebuilt.

VERIFIED persistence scope: project instructions and executable guards only.
Automation `standalone-game-refinement` is paused and its saved prompt reflects
the hold. No AKP, vault, shared-skill, native adapter or credential file was changed.
No restart is needed for these script guards. Cross-harness fresh-session and
delegated-worker inheritance tests remain OPEN; no new worker was allowed.

OPEN next pipeline work: reconcile the six candidate skills with their authors and
frozen evaluations; link them through the existing governed workflow only after
acceptance; join run, artifact and review identities; enforce source/scope and
aggregate budgets before future delegation. This audit is complete as a bounded
diagnosis, with those remediations explicitly pending. Game development stays paused.
