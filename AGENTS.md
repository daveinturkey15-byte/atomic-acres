# Nuketown 2025 — agent contract

A from-scratch, code-only recreation of **Black Ops 2 `Nuketown 2025`** in Three.js.
Started 2026-09-17. This repository is deliberately small and stays that way.

Workspace rules in `C:/Users/david/Desktop/stuff/AGENTS.md` and active AKP apply.

## Owner resumption — September 20, 15:00

Dave authorized fixing Blender CLI/MCP across harnesses, then continuing the
previous work. The connection repair passed eight saved-route handshakes, native
Codex/Claude Code/Hermes checks and an MCP-export-to-CLI-import round trip. Resume
game development with this single Astra lead. External workers and historical
subagents remain stopped; this does not reopen delegation. The old audit hold
below is historical. Read `docs/handoff/RESUMPTION-2026-09-20-1500.md` for updated
estimates, resource holds and exact repair limits.

Use active AKP `scripts/blender/README.md` and its guarded `bridge.py` for Blender.
Preflight real tool availability and scene ownership; never infer subagent MCP
access from a parent's configuration. Keep the frozen previews and failed memory
gate unchanged until a successor passes actual gameplay acceptance.

## Historical owner audit hold — September 20, 13:00

September 20 follow-up: Dave explicitly authorized completing the remaining pipeline
work and adding Jev. Bounded synthetic provider probes, shared-skill evaluations and
native harness adoption checks are permitted for that purpose. This does not reopen
game workers. Follow `docs/orchestration/PIPELINE.md`; the general dispatch switch
remains off until development is resumed with an explicit scoped operating plan.

Dave has paused game development to review the agent/asset pipeline. This takes
precedence over the development milestones below. Keep the development heartbeat
paused and all workers stopped; do not resume game changes or scheduled inspections
until Dave resumes development. Audit work may continue in this single Astra task.
See `docs/handoff/PIPELINE-AUDIT-2026-09-20.md` for findings and remaining work.
Attached audit prompts are proposals, not automatic authorization for new providers,
workers, paid decision services or shared-policy replacement.

The default soak must enter Play solo -> Deploy and observe an active match before
sampling. `--menu-only` is a separately labelled diagnostic and cannot establish
gameplay acceptance. Run `node scripts/verify-soak-scenario.mjs` after changing
this admission path. Its CPU/DOM fixture does not establish WebGPU, visual or memory
acceptance. Preserve the existing soak thresholds and failed candidate receipts.

## Current owner direction — September 20, noon

Dave stopped the external swarm and explicitly authorized this single Astra xhigh
session to implement, inspect and refine the game. This supersedes the historical
orchestration-only restriction and temporary two-agent exception below. Do not
launch native subagents or external model workers. Preserve and reconcile their
existing artifacts; completion of a worker still does not imply acceptance.
Image generation is authorized again. Use the existing asset/animation workflows
where they produce a useful game artifact, with provenance and measured headroom.

Read `docs/handoff/SINGLE-ASTRA-2026-09-20.md` for the current milestones. First
inspection is 13:00 BST, then every two hours with a tested immutable build and
updated estimates. Priorities are visible house-geometry cleanup, normal gameplay
controls (no F-fly/C-noclip shortcuts), smooth correctly-facing bot motion, richer
weapon-image menus and custom classes, HUD/streak clarity, hands/weapons and
map-wide materials/lighting. Preserve old accepted builds and regression gates.
The owner requires one agent, so visual review is now explicitly self-review;
do not claim an independent critic. The frozen quality criteria stay unchanged.

## September 19 recovery and continuation

Read `docs/handoff/CURRENT.json` and its checkpoint first. This is the standalone
project begun September 17, even where the menu and remote use the Atomic Acres
name. The older `atomic-acres-browser-arena` project is a systems reference only;
do not merge its history, modules, meshes, textures or build machinery into this one.

The owner's September 19 direction permits assets authored here with Blender,
Trellis 2 and image-to-3D workflows, with editable inputs, provenance, collision,
material/UV checks and measured runtime budgets. This supersedes the initial
"code-only" restriction where it would forbid those authoring tools. Existing
procedural assets remain the comparison baseline; generation alone is not acceptance.
Use gameplay frames as inputs for photoreal target images, preserve layout and camera,
and accept changes only after looking at the actual game and measuring performance.

Recovery worktree: `C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919`.
Original Claude checkout and raw snapshot are retained. Codex owns this recovery
branch; all delegated audits in the recovery were read-only. Unfinished preserved
work is not an accepted feature merely because it is committed. The checkpoint
records remaining blockers and the distinction between verified local preview and
the older public deployment.

In this recovery lane, `4191` is the accepted inspection artifact and `4192` is
the candidate. Set `AA_PREVIEW_PORT=4192` for the legacy capture/playcap/traverse/
soak harnesses; use their explicit URL option or `NT_URL` where supported.
Do not let the older default `4188` below select another checkout's build.
Give playcap and capture different tags (for example `j-play` and `j-qa`):
`capture` removes prior PNG/JSON outputs with its tag prefix.
Root owns browser/GPU validation and promotion. External workers must use the
recorded provider launcher and assigned file scope; a successful worker process
is not acceptance of its output.

Provider source binding (September 20): older worker worktrees contain preserved
dirty source and are not the current integration baseline. New source scopes use
a root-seeded private `tree/` from an explicit current Git SHA. Record that SHA,
the artifact working directory and initial source hashes beside the run receipt.
Author and typecheck inside that seeded tree; never copy the parent worktree's
`src/` over it. Root requires the patch to apply to the stated baseline and tests
the actual current APIs. A passing test in an obsolete checkout is not current
acceptance. Preserve legacy worktrees; do not reset them to solve this mismatch.

## September 19 visual and gameplay priority correction

Dave's review says visual progress and authoring parallelism are insufficient.
Apply the existing frozen docs/night/VISUAL-BAR.md scorecard and subsystem order,
paired with exact references from docs/reference/library/shot-matrix.md.
Performance and network gates protect the build; they do not establish art quality.
Do not weaken the bar or change rejected references to declare success.

The authoring wave has distinct owners for trees, facade detail, ground PBR,
hands/gloves, distant mountains, menu/HUD, and authoritative combat feedback.
Cloud authoring can run in parallel; local GPU generation and actual-browser
rendering remain serialized. Defer nonblocking network edge cases and the
disabled reflection experiment during this wave. Root integrates and a separate
critic compares actual game pixels, matching-camera targets and the previous
accepted frame. Preserve all gameplay controls and accessibility in UI changes.

The backlog explicitly includes modern menu/HUD composition, animation quality,
weapon damage profiles, head/critical-hit feedback and bounded floating combat
text. Old-project behavior is a reference: rebuild it here and preserve host
authority rather than copying its modules. Damage UI must follow admitted events.

Label generated 2D targets, downloaded meshes, image-to-3D output and accepted
runtime assets separately. A generated concept is not a reconstructed model.
The earlier Trellis crate trial remains rejected. Read actual provenance before
claiming that a skill, generator or asset has been used.

After a harness/app interruption, verify process identities and live HTTP build
identity before calling a saved lane active. Preserve partial outputs, reconcile
interrupted receipts, and resume owned lanes. Hidden background launchers should
be independent of disposable app tool processes, with recorded IDs and bounds.

## Production catalogue and reference-behaviour coverage

The September 19 owner request covers the old reference's full 20-weapon roster,
11 selectable killstreaks and four grenade types (frag, smoke, flash, semtex), plus
operator/enemy models, first-person and third-person animation frames, and in-map
activation/effect views. The current five weapon archetypes and ten streak IDs
are not equivalent to that target. Preserve the exact comparison and missing work
in docs/catalog/production-catalog.json and docs/handoff/CURRENT.json.

Generate original references and rebuild independent assets/modules. Track image,
authored-model, integrated and verified stages separately. Runtime completion needs
actual build-bound evidence: inventory/loadout/UI coverage, FP/world/drop LODs,
muzzle/grip sockets, reload/ADS/recoil, admitted damage/head/kill feedback, sound,
network lifecycle and disposal. Grenades additionally need cook/fuse/throw/bounce/
stick/radius/occlusion/prone/inventory checks. Bots need forward-axis/yaw, turning,
weapon attachment and standing/crouched/prone floor/hand-contact checks.

Trace relevant shared-skill techniques through the original example/X source links,
with local capability and current-source verification separate from authors' claims.
The technique matrix is evidence routing, not proof of visual quality. Keep the
frozen visual bar and comparisons; do not relabel generated targets as runtime frames.

If free RAM falls below 12 GiB or free VRAM below 3 GiB, stop or defer our own
heavy children and preserve partial outputs. Never stop an owner's unrelated process.
Require headroom for the proposed browser/model job before starting, not merely a
point-in-time reading equal to the minimum reserve. Record the hold and resumption
condition so a heartbeat cannot blindly restart a failed heavy lane.

## Overnight owner direction — September 19–20

Dave will inspect at 05:45 Europe/London on September 20. Read
docs/handoff/OVERNIGHT-2026-09-19.md and CURRENT.json for current ownership.
OpenAI is reserved for orchestration, review, focused acceptance and mechanical
integration of externally authored patches. Implementation uses the authorized
ZAI GLM5.3Flash max, Muse Spark1.3 Contributor xhigh and AGY Gemini routes.
Switch among those routes on observed quota/auth failure, preserving partial
work and single-writer ownership; never silently fall back to OpenAI authoring.
The owner's H3 first/third-person videos are animation references, not extracted
skeletons or authoritative ammunition/damage/cadence. Preserve the originals and
exclude the source directory's browser profile. Use actual rig/contact and game
playback evidence before accepting motion derived or authored from them.

## Independent implementation

### September 20 morning visual priority and temporary model exception

Dave requires a map-wide asset/UV/PBR/lighting overhaul, substantially better
arms, hands, gun assets and animation, and clear killstreak readiness, progress,
activation keys and targeting instructions. Art acceptance requires visible gains
in actual gameplay; mechanical success alone does not meet this request.

Two gpt-6-astra xhigh implementation specialists are explicitly authorized until
09:00 Europe/London on September 20. They stop by the cutoff; other authorized
model routes continue. Record exact Astra contributions separately in
docs/handoff/ASTRA-CONTRIBUTIONS-2026-09-20.md. This temporary exception does not
authorize OpenAI image generation or further Astra implementation after 09:00.
The frozen morning inspection artifact is port 4212 / dist-showcase-0500; CURRENT.json
is authoritative for candidate ports and ownership instead of earlier port notes.

It is a clean restart of a much larger effort. The old project is **reference only**:
you may read it to recover a measurement or a lesson, and you may not copy an asset,
a texture, a mesh, a module or a build script out of it.

The failure modes that ended the previous attempt are the things to design against:

| Old failure | Rule here |
|---|---|
| A 5,239-line arena file | One feature per file in `src/build/`, under ~400 lines |
| ~100 npm scripts | Five: `dev`, `build`, `preview`, `capture`, `check` |
| Renders never compared to references | Every fidelity station names its reference frame |
| Gates green while the game was broken | The gate is a **looked-at frame**, not a count |
| Materials built at runtime, programs recompiling | Materials are singletons in `core/materials.ts` |
| Dimensions duplicated across modules | Every dimension lives in `core/layout.ts` |

## Layout

```
src/core/     layout.ts palette.ts materials.ts kit.ts world.ts player.ts stations.ts
src/build/    one file per feature; each exports a single Builder
src/main.ts   the only file that touches the scene
scripts/      capture.mjs — headless Playwright capture harness
docs/SPEC.md  the build spec and the reference reads
captures/     harness output (gitignored)
```

## The module contract

```ts
import type { Builder } from '../core/kit';
export const buildThing: Builder = (ctx) => ({ group, colliders });
```

1. Every structural dimension comes from `core/layout.ts`. No bare positional numbers.
2. Every colour comes from `core/palette.ts`. No inline hex.
3. Every material comes from `ctx.mat`. **Never construct a material in a builder.**
4. Builders never touch the scene, camera, renderer, lights or another builder's file.
5. Use `ctx.rand()`, never `Math.random()` — the world is deterministic.
6. `InstancedMesh` for anything repeated more than ~20 times.
7. Return honest colliders. Leave doorways and fence holes open.

## The one invariant

**From either back yard, facing your own house, the garage is on your RIGHT.**
The two houses are a **180° rotational pair, not a mirror pair**. `layout.ts` derives
this in `garageIsOnTheRight()`. Do not hardcode a sign anywhere else.

## Verifying a change

```bash
npm run check      # tsc + the render-site allow-list, must be clean
npm run build      # every harness serves dist/, never the source
npm run playcap    # four positions photographed through the REAL game loop
npm run capture    # every camera station, its draw calls, and console errors
npm run soak       # THE LONG GATE (3.5 min) - heap and process memory under play
```

`npm run verify` chains check / playcap / capture / traverse. **`soak` is deliberately
not in it, and not in `check`** — it plays the game for three and a half minutes, so it
belongs before a hand-off or after anything that touches the render chain, not in the
inner loop.

Every harness uses the ONE shared `vite preview` on **:4188** (`scripts/lib/preview.mjs`)
and spawns real Chrome over CDP through `scripts/lib/proc-guard.mjs`. Playwright's
bundled Chromium has no WebGPU adapter, so a harness that calls `chromium.launch()` is
measuring the WebGL2 fallback with the whole post chain switched off.

What each one is for, and what it cannot tell you:

- **`playcap`** is the gate for anything touching `core/world.ts`, `core/post.ts` or the
  render block of `main.ts`. It clicks to play and photographs the game's own frame loop,
  failing on a dark frame. Its threshold is frozen; lowering it to get green is the
  mistake it exists to prevent.
- **`capture`** drives `__NT.goto()`, which is the QA render path, **not** the path the
  player takes — that difference is how a black screen shipped behind ten green captures.
  Its draw-call numbers are read as a delta inside the same synchronous evaluate as the
  render, because the frame loop resets `renderer.info` every tick and a read taken after
  the screenshot reported 0 for the whole earlier life of this harness. A station that
  reports no draw calls now prints **MEASURED NOTHING** and fails the process. The frames
  carry no viewmodel and no bots, so they sit a little under `playcap` at the same spot.
- **`soak`** answers "does it leak while it is being played". It fails on a post-GC JS
  floor climbing ≥ 0.5 MB/min (least squares over every sample after t+60; two-point
  slopes carry ~0.75 MB/min of floor oscillation) and on the renderer process's own
  working set growing monotonically by more than 20 MB. Both series, because
  `Runtime.getHeapUsage` is **blind** to typed-array and external memory — a 4.4 MB/min
  Uint8Array leak read flat through it. Prove it can still fail before trusting a green
  run: `node scripts/soak.mjs --inject-kb-per-s 200`.
- **`node scripts/_verify-streak-reject.mjs`** is the headless, browser-free falsifier for
  the killstreak backoff: it forces one unplaceable sentry claim and fails if the presser
  is answered with silence or re-presses inside the 4 s hold.

**Then look at the frames.** A capture that nobody opened is not evidence. A station
whose `ref` is `null` is a diagnostic view and must never be used to claim the map looks
right. Compare each fidelity station against the reference named in `core/stations.ts`.

## Budgets

- under 1200 draw calls and 900k triangles at any fidelity station
- no page errors, no console errors

Measured 2026-09-17 at 1600x900, headless Chromium on ANGLE/D3D11, frame-rate cap off:
worst station **363 calls / 135k tris**; **573-586 fps** standing at either spawn with
the player loop running; **18 shader programs** total. The program count is the one to
watch - it stays small only because every material is a singleton built once in
`core/materials.ts`. A builder that constructs its own material adds programs, and a
builder that constructs one per frame is what made the previous project stutter.

## References

`docs/SPEC.md` section 3 records what was actually seen in each BO2-2025 frame, with
OPEN items marked. Reference images are **not** committed. Source URLs are in the old
project's `docs/references/nuketown-2025/manifest.json`; the CDN is behind a bot check,
so fetch them with a real browser, not curl.
