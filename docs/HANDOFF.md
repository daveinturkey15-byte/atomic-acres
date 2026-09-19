# Atomic Acres — handoff, 2026-09-18 18:30

Written so the next session (Fable, orchestrating) can pick this up cold. Everything
below is verified state, not intention. Where something is unproven it says so.

---

## 1. Where the code is

- **Branch: `layout-boii-proportions`** — all of today's work, pushed.
- **`master` is what GitHub Pages serves** and is deliberately stale. It carries the
  older, wrongly-proportioned but playable build. **Do not publish to Pages** until the
  branch is genuinely playable; that was the owner's standing instruction all day.
- Local preview the owner inspects: **http://localhost:4173/** (`npx vite preview`).
  Port 4173 is pinned in `leak-watch/protected-ports.txt` so the reaper never kills it.

Commits today, newest first:

| | |
|---|---|
| `b989327` | Fix the black screen: take the interactive path off the post chain |
| `911f769` | Land the characters, netcode and weapons lanes; wire characters in |
| `34d7bf9` | Open the west flank; stop the path exporter cutting its own corners |
| `3669346` | Make the AO actually visible; stop every harness popping console windows |
| `c76e1f0` | photoreal lane: light rebalance and two-scale surface breakup |
| `98bf4d1` | The post chain had never run, and both houses were sealed |
| `8e4829d` | Re-proportion the map to the official BO2 minimap |

**Uncommitted right now:** the process-leak fix (`scripts/lib/proc-guard.mjs`,
`scripts/lib/preview.mjs`, and the rewiring of all seven harnesses). It is finished and
verified — capture writes 10 frames, traverse reports 4/4 house faces — but not yet
committed. Commit it before starting new work.

---

## 2. The five things that will waste your time if you do not know them

These each cost hours today. They are all still true.

1. **The post chain now WORKS on the interactive path** (commit `001324d`, 21:40). Two
   root causes, both real, neither guessed: (a) three r180's material cache key ignores
   the MRT, so a direct render of the scene BEFORE the chain's first frame compiles
   single-output shaders for the session and WebGPU silently refuses the chain's
   four-attachment pipeline; (b) `Renderer.clear()` blitted an unwritten frame-buffer
   target over the post frame. The chain is now the first and only thing that renders
   the world; it draws its own QuadMesh with a linear output node. **Never add a
   `renderer.render(scene, camera)` anywhere** - `npm run check` now fails on one that
   is not on the allow-list in `scripts/check-render-sites.mjs`. `?post=chain` is gone
   (the loop always takes the chain); `?post=off` and `?post=ao` swap the output node
   without changing the route. `stats().calls` is now per-frame (info.reset() each
   frame), so the 1200-call budget is measurable; `triangles` still reads 0 on WebGPU.
   `?post=ao` is contrast-stretched for legibility - do not read its pixels as the
   shipped AO strength.

2. **The capture harness tests a path the player does not take.** Captures drive
   `qa.render()`; the game drives the frame loop. That difference is exactly how a black
   screen shipped behind ten green captures and a clean traverse. Any visual claim must
   be checked in the interactive page, not only in a capture.

3. **`traverse.mjs` cannot distinguish "sealed" from "waypoint in a flowerbed".** Use
   `node scripts/paths.mjs` for the real question — it floods the collision world from a
   spawn with the player radius eroded out and reports what is genuinely reachable, then
   emits line-of-sight-simplified waypoints. Never re-simplify a path by taking every
   Nth cell; the chord cuts the corner back through whatever the path walked around.

4. **`?post=ao` output is tone-mapped.** Its pixel values are display values, not linear
   shader values. Reading them as linear sends you down a wrong path.

5. **Playwright's bundled Chromium has no WebGPU adapter.** `chromium.launch()` gives
   `navigator.gpu === undefined`, so `buildPost` silently returns `enabled:false`.
   `capture.mjs` now spawns real Chrome and attaches over CDP. If you write a new
   browser harness, do the same or you will be measuring the WebGL2 fallback.

---

## 3. What the map is now

Re-proportioned today from the **genuine** official BO2 minimap at
`docs/reference/img/nt2025-minimap-boii.png`. Every previous file in that directory was
a 5.8 kB HTML error page — the fetch had no browser User-Agent and nobody checked the
bytes, so every "measured off the minimap" claim before today was void.

Scale assumption is stated with its falsifier in the provenance block at the top of
`src/core/layout.ts`. The headline correction: the **house-to-house axis is the long
one** and the street is short — the turning circle is most of it. The map had been
~2.8× too long along the street, which is why it read as an empty boulevard.

Verified by `scripts/paths.mjs`: **every landmark reachable from spawn A** — both
spawns, both house interiors, all four flanks, the circle, the west road stem, the east
apron. **4/4 house faces enterable** (was 2/4). Handedness invariant PASS.

Still open on layout:
- `traverse` reports 1/5 routes. The map is connected; the stalls are a
  controller-vs-probe disagreement at a point verified clear at every height 0.1–1.7 m.
- Interior topology has **not** been checked against the real map — garage access,
  stairs, both floors. That is in the owner's new brief.

---

## 4. Instruments (use these, they are the point)

| script | what it answers |
|---|---|
| `scripts/paths.mjs` | what is genuinely reachable; emits safe waypoints |
| `scripts/plan.mjs` | top-down collision plan next to the reference at matched scale |
| `scripts/traverse.mjs` | are the specific lanes a player runs still clear |
| `scripts/capture.mjs` | ten camera stations through real Chrome + WebGPU |
| `__NT.collidersAt(x,z,y)` | now reports **which module owns** each collider |

`npm run build` first — both harnesses serve the **built** artifact.

---

## 5. Process hygiene — read before spawning anything

Two leaks cost the owner real time. Both are now defended, but the defences only work
if you use them.

- **`scripts/lib/preview.mjs`** — ONE shared `vite preview` on port **4188** (pinned in
  `leak-watch/protected-ports.txt`). Every harness uses `usePreview()`. Previously each
  spawned its own and killed only the vite parent, orphaning esbuild: 52 servers, 104
  processes, 4.67 GB and 52 listening sockets in three hours.
- **`scripts/lib/proc-guard.mjs`** — `spawnGuarded` / `killTree` / `stopServer`. Kills
  the whole tree and reaps on exit, SIGINT, SIGTERM, uncaughtException and
  unhandledRejection. Chrome in `capture.mjs` uses it; ~600 orphaned Chromes exhausted
  the ephemeral port pool on 2026-09-17 and made the machine unusable for 15 hours.
- A scheduled task **`DevLeakReaper`** runs every 15 min as a safety net. It skips
  anything under 20 min old, anything with an ESTABLISHED connection, and any port in
  `protected-ports.txt`.
- **Launching background agents:** `CREATE_NO_WINDOW` is **ignored** by CreateProcess
  when `DETACHED_PROCESS` is set, and a detached process has no console so its children
  allocate visible ones. Use `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP |
  CREATE_BREAKAWAY_FROM_JOB` (see the scratchpad `spark.py`). Node's `spawn` also
  defaults `windowsHide` to **false** — always pass `windowsHide: true`.

---

## 6. Characters and animation — the licence position

> **Resolved 2026-09-18 18:40 — see `docs/LICENCES-ANIMATION.md`.** The owner asked for
> the Llama-3 question to be answered, not parked. Decision: proceed with the Kimodo text
> bundle under the Meta Llama 3 Community License; weights never leave the machine;
> "Built with Meta Llama 3" in credits and `public/anim/LICENCES.md`. CMU BVH and
> procedural IK remain as second and third sources. The animation lane is unblocked.


The owner **will not create an Adobe account**, so Mixamo is out permanently. Do not ask.

The chosen route is **Kimodo** (local text-to-motion) + Blender retarget, with the
character mesh built procedurally in code. Verified on disk today:

- `C:\Users\david\projects\kimodo.cpp`, binaries built: `kmd-generate.exe`,
  `kmd-generate-embed.exe`, `kmd-encode.exe`
- Motion weights `kimodo-soma-rp-v1.1-f32.gguf`, manifest traces to
  `nvidia/Kimodo-SOMA-RP-v1.1` — NVIDIA Open Model License, commercial use permitted,
  no country exclusion. The prohibited SMPL-X checkpoint is **not** present.

**Two traps:**
1. The port's README says Kimodo "gives you SMPL-X". That is true only of the SMPL-X
   checkpoint, which we may not use. `soma-rp-v1.1` emits **SOMA-30, not 22 joints**.
   Carry both layouts and select by joint count at import. This has already cost a
   rewrite once.
2. **Unresolved licence question.** Kimodo takes a text prompt *or* a precomputed
   4096-float LLM2Vec embedding. **Both** go through the Llama-3-derived text bundle at
   `weights/generated/llm2vec-text-bundle/` (present, 2.8 GB, built from
   `llama3-8b-instruct-base`). So "don't use the Llama bundle" and "drive it from text"
   are mutually exclusive. Someone must read the Meta Llama 3 Community License and
   decide. **This blocks the animation lane.**

Reference wiring exists in the OLD project (`stuff/atomic-acres/scripts/animation/…`
and `scripts/blender/retarget-kimodo-motion.py`) — read it, it is not in this repo.
`docs/PASS77_KIMODO_SKELETAL_ANIMATION_ASSESSMENT.md` in that project is **stale**: it
predates the SOMA weights and describes the SMPL-X route we are rejecting.

`src/characters/` already contains a skeleton, retarget, clip library, blend tree,
procedural mesh and a budgeted system, wired into `main.ts` with six figures spawned.
The **system** is right and transfers unchanged; only the clip source moves to Kimodo.
The clips currently in it came from a CMU-mocap brief written before the owner's
Kimodo direction and are **not** the ones to keep.

---

## 7. What the lanes delivered, and what they did not

Delivered and committed: `src/characters/**`, `src/net/**` (transport, protocol, room,
snapshot, diagnostics, loopback proof — self-wired via `net/wire.ts`),
`src/weapons/catalog.ts` plus controller/effects/viewmodel revisions, `src/ui/`
reskin with `glyphs.ts`, `layout.ts`, `lobby.ts`.

**Not delivered:** `src/game/` was never created — **killstreaks, scoring and match
state do not exist**. No lane wrote a report except `photoreal` and `light`
(`docs/report-photoreal.md`, `docs/report-light.md` — both worth reading).

Reference imagery: `docs/reference/gameplay/` has 1371 real BO2 frames across six
clips; `docs/reference/img/` has the genuine minimap, aerial, load screen and a
2560×1440 frame; `docs/reference/photoreal/` has 14 agy-generated material studies
(the run was interrupted at 14 of a planned 24).

---

## 8. The owner's brief for the next phase, in his words

Recorded verbatim in intent so nothing is lost in translation:

- Fable orchestrating, spinning up however many Fable sub-agents are needed; Opus 5 also
  available; **set sub-agents to extra-high** for density and quality.
- **Refine the visual art style** — a big visual overhaul. Gameplay "feels like it's
  moved in the right direction"; the gap is visual quality.
- **House interiors must match BO2 topology** — the way you access the garage, the
  stairs, and both floors.
- **Remove some mannequins** — there are far too many.
- **Make the map borders much clearer** rather than invisible walls.
- **Cover more evenly distributed and muted**, and collision must work.
- **Import guns, gameplay, UI, menus and killstreaks** from the previous build, in a
  familiar way — minimap, HUD, killstreak behaviour — but implemented more efficiently.
- **Trellis 2 + Blender locally** for high-quality PBR, mapping, lighting, reflections,
  in an **iterative gauntlet loop** (see the Dreamloop/gauntlet skills).
- **Build a reference library**: the map, the surroundings, every camera angle in
  detail, all guns in all positions, animations, effects, lighting and reflections.
  Use Fable for image gen, supplement with the existing catalogue, and the Antigravity
  CLI for more.
- **Run overnight, ~12 hours, conservative with usage** — slow, steady pace.
- Looking at BO2 on YouTube/Twitch, screenshots, or the installed Steam copy is
  explicitly allowed to get the interiors right.

---

## 9. Machine state at handoff

All Muse Spark (`omp`) agents **stopped** at the owner's request — swapping to Fable.
One `agy` process may still be finishing the photoreal reference images.
At 18:30: 36 GB RAM free, commit ~32 GB, CPU moderate, preview on 4173 alive.
`llama-server` holding ~17 GB is the owner's — leave it alone.

---

## 10. Overnight run — live state (Fable orchestrating, Opus 5 xhigh sub-agents)

Updated 21:30. If you are reading this cold after a crash, this section is the truth.

**Gate for anything touching the renderer:** `node scripts/playcap.mjs` — clicks to play
and photographs the REAL game loop at four positions; fails on a dark frame. Proven able
to fail (0/4 on `?post=chain`, 4/4 on the default path) before it was trusted.
**Do not lower `DARK_THRESHOLD`.**

**Wave 1** (launched 18:32): `renderfix` (post chain on the interactive path) still
running at 21:30 with `src/core/post.ts`, `world.ts`, `main.ts` modified; an adversarial
verifier fires when it returns. Research landed and is committed (`33e87ad`):
`docs/INTERIORS-TOPOLOGY.md`, `docs/IMPORT-PLAN.md`, `docs/reference/library/`.

**Contract change** (`6b88ef8`): `GARAGE_LEN 6.2`, `GARAGE_BAYS 2`, `YARD_X ±14.8` —
two street-facing bays per the research; yard widened to keep the 2.0 m squeeze.
Gated: all landmarks reachable, west flank 42 m → 15 m, 4/4 faces, handedness PASS.

**Wave 2** (launched 21:24, `wf_5f9c4647-341`): `interiors` / `perimeter` / `dressing`
with DECLARED COORDINATE REGIONS (see the workflow script), `handedness` falsifier
(read-only), then `geoverify` which checks collider ownership per region via
`collidersAt().owner`. Commit only if `geoverify.holds`.

**Handedness invariant is under test, not settled.** INTERIORS-TOPOLOGY §7 contradicts
it from one match's frames. It stays derived in one place (`garageIsOnTheRight`) so a
single sign flip fixes the map if the verdict is "mirror". Nobody may flip it on a hunch.

**Animation:** licence resolved (`docs/LICENCES-ANIMATION.md`); Wave 4 brief at
`docs/night/brief-kimodo.md`. Kimodo built + weights present at
`C:\Users\david\projects\kimodo.cpp`.

**Trellis.2:** ComfyUI 0.34.0 running on :8188 (started 21:05 by the orchestrator via the
old client's launch; never restarted/updated). All Trellis.2/Pixal3D nodes present.
Weights were ABSENT (API-verified); fetching the Trellis.2-only set (~8.5 GB) from
`Comfy-Org/TRELLIS.2` into the default models dir — resumable, log at scratchpad
`agylogs/trellis_fetch.log`, provenance note written beside the weights.
Owner authorised: "we do have trellis 2 … keep working through the waves" (18:55).

**Next waves, in order:** 3 gameplay (IMPORT-PLAN §3: vocabulary → lanes A/B/C/D →
integration), 4 animation (Kimodo), 5–7 visual gauntlets per `visual-gauntlet-loop`
(≤6 corrections per loop, fresh blind critic each round, evidence per round).
Concurrency cap ≈5 Opus xhigh. Pages stays on `master`.

**Runtime baseline, 21:52 (first honest per-frame numbers):** draw calls/frame
spawnA 1735 · circle 1160 · spawnB 1729 · orangeInside 1505; triangles/frame 296k–356k.
AGENTS.md budget is 1200 calls / 900k tris. **Over the call budget at 3 of 4 positions**
(the shadow pass roughly doubles the scene's draws). Holds 60 fps here only because vsync
caps it. This is gauntlet item S9; mannequin thinning and vehicle batching are the first
levers. Measured through `scripts/playcap.mjs` — `captures/perframe-summary.json`.

**21:55.** Wave 3 (gameplay, `wf_9803433a-ea2`) launched: vocabulary writer first, then
lanes A/B/C/D, integrator, verifier - exactly IMPORT-PLAN §3. Wave 4 (Kimodo) and Wave 5
(visual gauntlet, one script per subsystem via `args`) are drafted at the session
scratchpad `wave4-animation.js` / `wave5-gauntlet.js` and launch after Wave 2 lands.
Trellis.2 weights: 4/4 on disk and visible to the server (`comfy_up.py` preflight).

**21:58.** Wave 4 (Kimodo animation, `wf_8faff9c6-e08`) launched - single bake agent then
adversarial verifier. Three workflows in flight: geometry, gameplay, animation. Street
gauntlet waits for geometry to land so its critics score final pixels.

**22:15.** Wave 2 landed and is committed (`ea91fe8`): real interiors on both floors,
visible borders, handedness = ROTATIONAL (settled, `docs/HANDEDNESS.md`). traverse is
now 5/5. The dressing lane died on a transient DNS error and is re-running
(`wf_5f9c4647-341` resumed - others replay from cache). Interiors gauntlet launched
(`wf_6b26f3be-4ab`). Open items from the verifier: draw calls 1851/frame at spawnA;
white house reads as a round ring vs the minimap's orthogonal L-block (OWNER QUESTION -
not changed on a hunch); roofless dead-end slot into the white house x 4.3..5.9;
plan.mjs writes .ppm only; the pool cannot be sunk while player.ts clamps the world
floor at y=0.

**23:50.** Wave 4 bake landed: 16 Kimodo clips in `public/anim/`, 30 joints on every
export, canary through four views, foot-slide measured (walk 3.8 cm). Verifier running.
WIRING PENDING until Wave 3's integrator releases `src/main.ts` / `src/ui`: two lines
(`import { loadBakedClips }` + `await loadBakedClips()` before createCharacterSystem) and
the credits line in the UI. Brief corrected: SOMA is Y-up and mirrored; Blender optional.
Wave 3: vocabulary + lanes A-D returned; integrator running.

**23:50.** Wave 4 committed (see its message for the open list). BLOCKED ON WAVE 3 LANDING:
(1) wire clips - `import { loadBakedClips } from './characters/kimodo-clips'` +
`await loadBakedClips()` immediately before `createCharacterSystem` in main.ts;
(2) a credits surface in src/ui carrying "Built with Meta Llama 3" and "Motion: NVIDIA
Kimodo SOMA-RP v1.1 (NVIDIA Open Model License)"; (3) a LEAK HUNT - heap post-GC floor
climbs ~4.2 MB/min with zero figures (verifier's control run) - heap snapshots at t+30/90/
150 s through the real loop, diff retained objects, one bounded fix.

**00:20 (19 Sep).** Interiors gauntlet: 1 round, average 1.5 -> 1.5, state request-input,
integration verdict "improved". Structural fix converged on: AO radius 0.9 -> 3.0 m with
AO_DEEP/AO_OPEN re-measured - running as its own bounded round now. FOR THE OWNER:
(a) "Nuketown" livery text on the coaches - our own procedural text, historical project
name; keep or rename? (b) white upper floor may have a hole at (-3, 19). Also: the white
house is a single-skin capsule shell, so interior/exterior materials cannot differ there
without splitting its geometry - a geometry task, not a material one.

**01:05 (19 Sep).** Wave 3 committed (`3e9e651`): a TDM match runs end to end with bots,
streaks, scoreboard - verifier ran its own headless match (kills 2 -> 12 / 195 s). Clips
WIRED and credits line landed (`7e8f587`); playcap 4/4. Running now: dressing verifier
(`wf_5f9c4647-341`), AO room-scale retune (`wf_6e400e5c-43f`, post.ts only), leak hunt
(`wf_b2a8e68c-585`: heap floor +4.2 MB/min with zero figures), gameplay fixes
(`wf_15ddb204-3ce`: streak-denial livelock backoff, friendly-fire in the pre-resolved
branch, __NTGAME out of src/game, un-export HostLife). Next: street / exteriors / sky /
vehicles gauntlets once the AO retune releases post.ts and dressing lands.
Draw calls now 1348-2112/frame with five bot rigs (~300-380 each) - S9 remains open.


**01:50 (19 Sep).** Geometry verifier (wf_5f9c4647-341) REFUTED the wave on ownership,
not on any numbered gate (paths 15/15, --y 3.3 22/22, traverse 5/5 + 4/4 + handedness,
playcap 4/4 all green): (1) yards props built INTO the external stairs - planter in the
white stair's bottom four treads, patio table in the orange stair's foot - because the
yards keep-out is derived from the DECK and both stairs run past it; (2) the white upper
floor has NO -z face (see-through, shoot-through; the "hole at (-3,19)" is a whole face);
(3) 14 mannequins with zero colliders (pre-existing). Repair running as
wf_8cdb6581-97c: re-aim the orange flight along x per HANDEDNESS.md evidence, each house
EXPORTS its stair footprint and yards consumes + asserts it, close the white face with
wall + glass + chord colliders, mannequin colliders; fresh verifier; max two rounds.
Dressing lane's four files (mannequins 40 -> 14, yards cover rebuilt, vehicles, plaza)
stay uncommitted until that verdict holds. Leak hunt FOUND IT: three r180
Sampler.set texture removes a brand-new onDispose closure so the unsubscribe never
matches, and BloomNode re-points its samplers twice per frame - 132,780 dead listeners
in 2 min; fixed in post.ts (repairSamplerUnsubscribe), floor 4.44 -> 0.02 MB/min;
verifier soak running. Gameplay fixes: 4/4 done (livelock was bots re-pressing a banked
streak at 20 Hz through the 9 s rematch hold), verifier running. AO retune critic1
running. Two 7.5 h orphan vite previews (59359/51235) reaped; :4173 and :4188 intact.
Other open items from the verifier, not this round: capture.mjs draw-call gate prints 0
(blind); plan.mjs writes .ppm only; two sub-metre sealed pockets behind the orange
kitchen counters; draw calls 1348-2112/frame (S9); white house round-ring vs L-block
(OWNER QUESTION).

**02:20 (19 Sep).** Gameplay round 2 committed (`8ba75f7`, verifier HOLDS: one refusal
per match end instead of 179; open: streakRefused resets per rematch, no-placement
sentry rejects bypass the backoff and emit no event, main.ts 480 lines). AO retune
round 1 (`wf_6e400e5c-43f`): radius 0.9 -> 3.0 bought real contact everywhere at zero
draw-call cost, exteriors within 1%, average 1.8 -> 1.9 - but the interior wall FIELD is
still raw 1.0 because GTAONode gates samples on thickness (0.6 m discards every
room-scale occluder; three GTAONode.js:357/371). Round 2 running (`wf_d60fcfb8-ef9`):
thickness 0.6 -> 3.0 + AO_DEEP re-derived on CLEAN goto() frames - the 0.672 came from a
teleport frame where the weapon overlay is 6% of the pixels, p5 was the gun; the true
p5 at radius 3.0 was 0.167. post.ts is uncommitted (AO round 1 + the bloom-sampler
leak fix) until the leak verifier reports. B5 DECIDED (reversible, one-line each): the
billboard, strapline and coach livery now carry the project's own name and an original
line - skyline.ts 'Atomic Acres' / 'Tomorrow Lives Here', vehicles.ts 'Atomic Acres' -
consistent with the 2026-09-17 rename; five critic rounds had failed on it. If the owner
wants the source text back it is two string constants. Characters lane launched
(`wf_e07c393b-832`): one SkinnedMesh per figure (34 meshes -> <=3 draws/pass) and an
operator dress instead of mannequin teal; verifier measures draws/figure, heap, four
views. Geometry repair (`wf_8cdb6581-97c`) still in round 1.

**02:35 (19 Sep).** Leak verifier HOLDS (its own harness, 30 floor samples per run,
calibrated with an injected on-heap leak it read at 2.73 MB/min): zero rigs 0.145,
eleven rigs 0.295 MB/min, worst estimator 0.348, all bloom textures' listener counts
identical at t+60 and t+300 across 14k frames (was 8089 at t+80 before). post.ts
committed at the exact bytes all three critics measured (md5 507376fb: AO round 1 +
the sampler shim). Carried: no regression guard sees this leak yet (only the untracked
_heap*.mjs instruments, now tracked); Runtime.getHeapUsage is BLIND to typed-array /
external memory (a 4.4 MB/min Uint8Array leak read flat) - a GPU or ArrayBuffer leak
needs a different metric; the shim retires the oldest same-function registration, not
the caller's own - harmless only while RenderTarget.dispose dispatches on the target.

**03:55 (19 Sep).** Geometry repair HOLDS in one round and is committed (see its
message): stair footprints exported and asserted, orange flight along the back wall,
white upper front wall closed (0 gaps), 14 mannequin colliders; dressing lane's four
files landed with it. OPEN: descent direction contradicts HANDEDNESS.md (outboard vs
toward the garage - builder's case in the commit), turf roll + crate stack crowd the
orange flight, white house round-ring vs L-block. Hardening lane: H2-H5 committed
(`5856fcc`); H1's soak gate was refuted on one clause (its frame floor counted its OWN
rAF tick, so a dead game loop read as flat) - fixed by the orchestrator: liveness now
comes from __NT.stats().renderCallsTotal (the game's own render() total), the JS gate
needs slope >= 0.5 WITH r2 >= 0.25 (or >= 1.0 at any fit; two clean runs read 0.27 and
0.38 at r2 0.05), the process gate fires at >= 60% of steps up; proven three ways:
clean 120 s PASS (0.182 MB/min, 182k render calls), --kill-loop 60 s FAILS with 0 game
render calls while the page ticked 3720 frames, --inject-kb-per-s 200 FAILS at 12.4
MB/min r2 0.965. `npm run soak` is the long gate (3.5 min), not in check/verify.
Running: characters (`wf_e07c393b-832`), AO round 2 integration (`wf_d60fcfb8-ef9`).
Next: street / exteriors / sky gauntlets once post.ts is free; a vehicles budget lane
(310 objects, the other S9 lever).

**04:05 (19 Sep).** AO round 2 (`wf_d60fcfb8-ef9`, thickness 0.6 -> 3.0, AO_DEEP re-derived
0.672 -> 0.194 on a CLEAN goto() frame - and the 'AO_DEEP never satisfied its rule' finding
is RETRACTED: on the clean route at thickness 0.6 the p5 was 0.669, the shipped 0.672
was right; the 0.167 was itself a teleport-frame reading). Gain, measured: interior wall
fields occlude for the first time (interiorOrange wall gradient p95-p5 12.3 -> 24.0
against 24.1 on the reference frame; whitePoolRoom 11 -> 29 - the white house moved for
the first time), light pool inverted the right way (0.65 -> 1.07), no halo, sky
bit-identical, mountains +2.5%, draws unchanged. Cost: the two rects that used to CLAMP
got lighter (crate base 65 -> 71, threshold floor +7%), the crisp junction creases of the
r=0.9 kernel are gone, and a NEW false wash at midStreet - a flat coach panel reads 229 ->
160 with nothing occluding it (grazing-angle self-occlusion at thickness 3). Integration:
'improved', average 2.2 flat, NO single lever fixes both halves - every probe (AO_CURVE,
distanceExponent, denoise radius) trades wall field against contact on one axis.
Committed as the improved state. Round 3 launched: TWO-SCALE AO - keep the far term
(r 3 / t 3, the wall field) and multiply in a near term (r 0.9 / t 0.6, the kernel that
drew the creases and the crate base), one bounded correction. aperture/wall 0.82 vs the
references' 1.33-1.67 is NOT an occlusion problem: interiors need enclosure-aware
ambient (lighting lane, after the street gauntlet).

**04:20 (19 Sep).** B5 fully closed: every in-world and HUD string now reads Atomic Acres
(skyline pylon + strapline `c6491a3`, coach flank `e474937`, coach destination board
`a917326`, HUD minimap title `8d6863a`); reversible string constants. Running: AO round 3
two-scale (`wf_05b69780-de8`), characters (`wf_e07c393b-832`, still in its builder after
2.5 h), vehicles budget (`wf_be3e8e1b-7b4`: 310 static objects -> batch per material,
pixel-identical, colliders byte-identical), Trellis.2 hero-prop canary (`wf_879d90a4-d08`:
one crate through the owner's ComfyUI, recipe + evaluation record only, nothing enters
public/ or src/; ComfyUI preflight 04:10 - 0.34.0, 15 GB VRAM free, queue empty, all
Trellis.2 nodes present, geometry_estimation empty so Pixal3D route unavailable).
After these: street / exteriors / sky gauntlets (post.ts and materials.ts free), then an
interior-lighting lane for the aperture/wall ratio (0.82 vs 1.33-1.67, not an AO
problem), then the lobby/menu/killstreak UI polish from IMPORT-PLAN.

**04:45 (19 Sep).** Hero-prop canary landed (`4b8f13a`, verifier HOLDS): the Trellis.2
route works end to end through the owner's ComfyUI - peak VRAM 15,759/16,303 MiB (the
whole card), 346 s a prop, Pixal3D/MoGe unavailable here (geometry_estimation empty) -
and the honest verdict on a set-dressing crate is KEEP PROCEDURAL (shards baked into the
base colour, invented back, hollow underside, +2 draws +64 MiB vs 36 instanced tris).
Capability + recipe + dated record in scripts/art-gen and docs/reference/library; the
measured datum is in AKP register row 45. Use the route for a genuine hero prop seen
close from the front, one owner decision per asset. Untracked and left so: the 14
concept plates in docs/reference/photoreal (26 MB; reference frames are not tracked -
9 of 1371 gameplay frames are), docs/report-light.md (an earlier light-lane report),
scripts/_gv-*.mjs (a verifier's scratch).

**05:15 (19 Sep).** Vehicles batching (`wf_be3e8e1b-7b4`): verifier held every count -
objects 310 -> 120 (-61%), calls -17..-25% at sixteen stations, turningHead 1469 -> 1180
and midStreet 1203 -> 982 BACK UNDER the 1200 budget, playcap circle 1348 -> 1110,
colliders and cast shadows bit-identical, geometries 742 -> 553 - and refuted on ONE
visible artefact: a pre-existing coplanar z-fight in makeTrailer's rear doorway that
batching moved (better at plaza, plainly worse at the slalom gate the traverse routes
walk through), plus four silent hazards in the new src/core/static-batch.ts (prunes any
childless non-Mesh incl. lights; ignores visible=false; drops instanceColor; no winding
flip on mirrored transforms). Round 2 running (`wf_07a0d8ef-016`): millimetres of
separation at source + guards that leave such objects untouched and throw in dev.
Uncommitted until it holds: src/build/vehicles.ts, src/core/static-batch.ts.
CHARACTERS LANE WAS WEDGED 01:53-05:08 (an ffmpeg contact-sheet loop without -y
prompted to overwrite and blocked the tool call; no timeout fired; nothing touched) -
stopped and relaunched fresh as `wf_3f9f5abf-3fa` with shell hygiene in the brief.
Detect a wedged lane by its agent-*.jsonl mtime, not its journal. Also found: two dead
factories in vehicles.ts (makeDisplaySedan, makeDisplayPlinth - the teal show car on its
plinth is written and never placed); the pixel-diff method needs Math.random seeded
from the harness because materials.ts paints 43 random textures per load.

**05:40 (19 Sep).** AO round 3 (`wf_05b69780-de8`) - TWO-SCALE AO shipped: a near GTAO
term (r0.9/t0.6/16 samples, its own AO_DEEP_NEAR 0.721 measured on a clean frame)
combined with the far term by min(), not the briefed geometric mean - the builder built
the mean first, photographed it (it square-roots the far term's own darkening and gave
back a third of the wall field: gradient 24.0 -> 16.3) and shipped min, which is
idempotent on an idle term. Average 2.2 -> 2.3; 7 of 8 gates: crate base 72 -> 64.5,
junction crease back to a full-strength ink line, wall gradients 24.1 / 28.9 preserved,
exteriors within 3%, sky bit-identical, no halo, whitePoolRoom fps certified 60 with the
extra pass. FAILED gate: the midStreet grazing wash on the coach flank is bit-unchanged -
min() can only darken. NEW at integration: at distance the far kernel invents solid
fields on large planes at grazing incidence (aerial skyline slabs 0 -> 42-47% solid,
yardWhite ridge 62%, farthest geometry now darkest in frame - aerial perspective
inverted), so S5 3 -> 2 at aerial stations. Committed as the improved state. Round 4:
fade the FAR term by grazing angle (|n.v| from the MRT normal) and by view depth beyond
~35 m - the two things a false grazing/distant sample has that a real room occluder does
not - measured separately, near term and interiors untouched.

**06:20 (19 Sep).** Vehicles batching round 2 HOLDS and is committed: 310 -> 120 objects,
the trailer z-fight fixed at source (panel deleted, not recessed - the recess made the
doorway a shut glazed shutter), static-batch.ts guarded against lights / hidden /
instanceColor / mirrored with a bundled test. EVERY STATION IS UNDER 1200 CALLS for the
first time (playcap 1162/775/1159/974; captures 702-1138) - partly the characters lane's
uncommitted single-mesh figures, so re-measure when that lands. Frozen HEAD build for
the owner: http://127.0.0.1:4190/ (scratchpad snapshot, port pinned in
leak-watch/protected-ports.txt, refreshed after each landing). Running: characters
(`wf_3f9f5abf-3fa`), AO round 4 far-term fades (`wf_8eee1ee3-f74`). Open from this
round: side-doorway panel/rub-rail coplanar strip; the unplaced show car; capture.mjs's
'2 calls' stats-reset race.

**06:40 (19 Sep).** Characters lane HOLDS and is committed: one SkinnedMesh per figure
(54 -> 2 draws each, verified two ways), two factions of operators in earth tones, no
mannequin confusion, heap 0.04 MB/min. The remaining gap is CLIP DATA: idle and aim hunch
~40 degrees (surface top 1.565 m vs ~1.86 m), rifle one-handed, __NTANIM.external()
frozen for all clips, spawn() has no faction argument. Animation round 2 lane next
(src/characters/{clips,blend,kimodo-clips,system,anim-qa}.ts + scripts/animation):
re-roll idle/aim/sprint seeds for an upright stance, a two-handed carry layer, fix
playExternal, faction per spawn. Frozen HEAD build refreshed on :4190 after each landing.

**06:50 (19 Sep, clock-true - the 06:20/06:40 stamps above ran ~10 min fast).** THE OWNER
IS AWAKE. He walked the frozen build (:4190) and liked the layout and the feel. His
brief, verbatim where it matters: (1) "the car in between the two buses is going into
one of the buses"; (2) "not the house I've been spawning in but the one across the
street - the garage door is still opaque"; (3) "once you get upstairs there's z fighting
... there is z fighting throughout the map ... the layout of upstairs in that other
house isn't very good"; (4) bring in from the old project: killstreaks, grenades (frags,
flashbangs, smokes - "any grenade should do a little damage and leave a little smoke,
the smoke grenade 5-10x that with volumetric fog"), knife, arm animations, HUD, menu
with all the graphical options, solo vs bots with bot rules, multiplayer lobby host or
guest on the stable netcode, ammo pickup from kills - "rebuilt to be smoother and more
cleanly implemented"; (5) keep refining graphics: lighting, shading, shadows, colour
correction, volumetric fog, dynamic weather, times of day; (6) the image-gen loop:
capture our world, ask Claude/Gemini via the Antigravity CLI bridge to make it
photoreal (effects, particles, lighting), use those as targets, refine with Blender /
WebGPU / img2threejs / Trellis in a loop; (7) mainly FABLE sub-agents at xhigh or max,
some Opus fine; loop to 09:30 with a committed built version, then keep going; other
harnesses may join later; everything stays on this one map. LAUNCHED (all Fable xhigh
builders + Fable max verifiers): owner-fixes (`wf_2c1da24d-b5f`: car, white garage,
white upstairs z-fight + layout), zfight-sweep (`wf_ead9fbbc-608`: scripts/coplanar.mjs
instrument + fixes across src/build), ordnance (`wf_ef17ac2d-971`: grenades with a
smoke-volume bus contract, knife, death drops, bot blindness/smoke LOS), lobby
(`wf_4c123b6c-df6`: menu, options that move the renderer, bot rules, host/join by room
code with a two-browser proof). Still running from before: AO round 4 (post.ts),
animation round 2 (src/characters). Queued behind post.ts: atmosphere lane (volumetric
fog from the smoke contract, time of day, weather), image-gen target loop, street /
exteriors / sky gauntlets. File ownership per lane is in each script under the session
scratchpad (wave7-*.js).

**07:05 (19 Sep).** AO round 4 (`wf_8eee1ee3-f74`): the briefed mechanism was WRONG and
the gauntlet proved it - the distant false fields were bound by the NEAR term, not the
far one, and the failing rects sit at |n.v| 0.51-0.84 (not grazing), so a grazing fade
on the far term moved nothing at five of five guards. The integration critic built and
measured the right lever - a DEPTH fade on the near term at the combine, mNear2 =
mix(1, mNear, 1 - smoothstep(30, 70, viewZ)) - and reverted it (its mandate); the
orchestrator applied it verbatim and re-measured with the inherited scripts: aerial /
yardWhite / yardOrange fields 0.00% (yardWhite ridge right ao 172.5 -> 222.38, the
far-only value exactly), interiorOrange wall gradient 23.1, whitePoolRoom 28.1, crate
base 64.0, sky 229 bit-identical, mountains 226.6, playcap 4/4 at 1162/774/1159/974.
Committed. STILL OPEN: the midStreet coach-flank wash (far term, 2 m away, |n.v| ~0.8
- neither fade reaches it; a per-pixel thickness scaled by depth, or a normal-aware
horizon clamp, is the next idea - one coach panel, low priority). Atmosphere lane
launched now that post.ts is free (`wf_...` below).

**07:50 (19 Sep).** ALL SEVEN LANES DIED AT ONCE at ~07:20: "You've hit your session
limit - resets 7:40am". Seven Fable xhigh builders (+ max verifiers queued) burned the
window in about 30 minutes. Their partial work survived in the tree (2,589 insertions
across 35 tracked files + ~35 new files: ordnance host/physics/view/pickups modules,
lobby room-core/rtc/lobby-session/match-host/guest, animation blend/anim-qa, the
coplanar instrument, owner-fix probes, a 938-line atmosphere draft). The tree still
BUILDS (vite) and is 3 tsc errors from clean (src/ui/settings-panel.ts, lobby's); the
orphaned atmosphere draft was moved to the session scratchpad (atmo-draft/) so it could
not block anyone. RELAUNCHED AS RESUME-IN-PLACE (each brief now opens with a RESUME NOTE
naming its predecessor's partial files): owner-fixes `wf_c2023c92-337`, zfight-sweep
`wf_8c6e175e-299`, ordnance `wf_faac0cc9-e99`, lobby `wf_edb62d8a-986`. Verifiers
dropped from max to xhigh; FOUR lanes at a time, not seven. Deferred until two of those
land: atmosphere (draft in scratchpad), animation r2 (blend/anim-qa partials), photoreal
targets. The frozen build on :4190 is HEAD `3067718` (AO depth fade) and is unaffected.
For the 09:30 inspection: whatever has been verified and committed by then is what
:4190 shows; the working tree is NOT it.

**08:58 (19 Sep).** LOBBY lane HOLDS (`wf_edb62d8a-986`): main / solo-setup / multiplayer /
options / credits / pause / end-of-match / rematch; a bot-rules panel projected from
rules.ts tables and applied (verified: 3 Veteran bots, kill limit 10, FF on, team
balance); options that measurably move the renderer (FOV 72->110 moved a landmark edge
632->715 px as predicted, resolution scale halves the drawing buffer, shadow map select
changes the live shadow RT 4096->1024); persistence across reload; every menu state
photographed at 1280x720; and a REAL two-browser multiplayer proof - WebRTC data
channels (reliable ctl + unordered fast) signalled by scripts/net-signal.mjs (SSE/POST,
:4310, spawnGuarded), two separate Chromes host/join by room code through the menus,
guest movement tracked within 17 ms median, a kill registered on both HUDs, 120 s no
disconnect, with a NEGATIVE control (BroadcastChannel cannot cross the two instances).
Not proved: LAN (relay needs --host 0.0.0.0) and WAN (iceServers empty by design). Also
removed a real netcode defect: the host 'coast' double-counted jittered input (992
forward snaps / 4.3 m lead in the seeded proof -> 110 / 0 m). STAGED, NOT COMMITTED:
bots.ts imports the ORDNANCE lane's uncommitted modules (bot-sense exports, ./ordnance,
ActorSnapshot kit fields) so the lobby cannot build standalone - it lands together with
ordnance when that verifier reports. REQUESTS for other owners: main.ts - ui.bindMatch
(match) after createLocalMatch, and hide bodies whose id left match.bots() (stale rigs
after Leave); post.ts/world.ts - setEffects({ao,ssr,bloom}) as uniforms + world.post
(folded into the atmosphere brief); player.ts - setSensitivity / setInvertY / setFov
(input shims work today); weapons - a master gain hook; host-life.ts - respawn delayMs
pass-through from MatchRules; mouse-button rebinding. ATMOSPHERE lane launching now
(post.ts, world.ts free). tsc clean on the whole tree at 08:52.

**09:12 (19 Sep).** OWNER-FIXES landed (`39db6b1`): the saloon slid 6 m west out of the
coach (0.49 m clearance, 0 vehicle intersections), the white garage has a genuinely open
bay with the leaf rolled overhead and a shut sectional door with a collider, and the
white upstairs is re-planned into a plum bedroom / green room / glazed hall round the
void with the concrete-prism-under-slab z-fight deleted and the capsule shell's chord
overlaps mitred. Verifier refuted two clauses: (a) my scan threshold - 180 same-material
pairs remain at curved chord joints with NO visible dither (box chords cannot mitre a
curve; accepted); (b) the bedroom's hall door is blocked by the bed collider (reachable
via the green-room opening) - FOLLOW-UP. :4190 now serves HEAD `39db6b1` (AO depth fade
+ owner fixes + vehicles batching + characters). Waiting: ordnance verifier (then the
staged lobby commits with it), z-fight sweep verifier, atmosphere builder.
