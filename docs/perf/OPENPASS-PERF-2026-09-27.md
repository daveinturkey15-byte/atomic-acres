# Open-items performance and animation investigation — 27 September 2026

VERIFIED — Independent CPU investigation began from `537ddb76477b8be7953c9bcd651458f255ce48da`, branch `salvage/full-game-20260926`. Read AGENTS, START_HERE, CURRENT, OPEN-PASS and frozen VISUAL-BAR. Applied the Atomic Acres coordination and Three.js frame-loop audit skills; the restart routing in the current repository overrides the older skill's predecessor routing. Native Codex check passed with control digest `97f85288e0601aaca785e992545e42f7a6324e12a4afb70f1756adaeac42f04e`; audit returned no Codex FAIL/AMBER row. High performance was active. AKP pull-only currency remains OPEN under the previously declared doctor hold.

VERIFIED — Local promoted `dist/preview-identity.json` names runtime `2f837ae3d53cc1d7c3a78610e1276ab085a271cb`; actual entry bytes match `assets/index-BFvUiAGm.js`, SHA256 `35e31151acac08c75e3d8ed2a15af078f1879d8cf4d6f578dcf1fb0a1abd464f`. No browser, GPU job, application build, commit or push was run by this worker. The parent retained the GPU admission hold. Original captures, prior failures, scorecard and old review documents remain unchanged.

## Performance decision

VERIFIED — The only retained V8 CPU profiles in this checkout are **ac3f1d4 baseline and 2f4d577 shadow canary**, not 2f837ae. The accepted runtime has a 210-second soak: 22 HUD game-FPS observations range **44–55**, while page RAF is **58.72 callbacks/s**. Memory acceptance does not close S9. S9 remains the original 60 FPS at 1920×1080 on the 5080 through the full post chain, with no quality, geometry, animation-cadence or authority reduction.

VERIFIED — Recomputed time-delta-weighted samples from the retained raw/mapped profiles, checking identical samples, time deltas and node counts. The helper reproduces the stored total sampled time. These are inclusive categories and overlap; do not add them.

| Measured historical category | Baseline ac3f1d4 | Canary 2f4d577 |
|---|---:|---:|
| Total sampled time | 10,243.956 ms | 10,199.455 ms |
| World render, inclusive | 86.96% | 83.74% |
| Shadow render, inclusive | 45.94% | 24.81% |
| Binding updates, inclusive | 19.31% | 26.53% |
| Material cache keys, inclusive | 21.99% | no samples |
| Character work, inclusive | 1.09% | 1.56% |
| Simulation/net work, inclusive | 0.65% | 0.55% |

VERIFIED — Canary native `writeBuffer` self time is 732.307 ms (7.18%); the dominant sampled call chains reach it through uniform binding updates. This is CPU/native submission attribution, not GPU duration. Canary game median/p95 intervals across three unchanged 45-second windows are **19.1/23.9, 18.0/22.6, 18.4/22.8 ms**; callback CPU median/p95 is **18.2/22.2, 17.0/21.5, 17.5/21.5 ms**. Corresponding observed game rates are **51.83, 54.73, 54.11 FPS**. There is no measured remaining animation bottleneck that would justify lowering animation cadence.

OPEN — The current CPU/GPU split cannot be established from these artifacts. Both profiles retained owner load and varying 6–7 actors; whole-GPU utilization is not this game's GPU time. The canary's mapped report survives, but its original `dist-next/assets/index-Bnr1MLy7.js.map` no longer exists at the recorded path. The baseline map still exists and its hash matches. Canary attribution is therefore retained capture-time mapping, not a fresh independent remap. New traces must preserve their actual JS and map alongside the receipt.

VERIFIED — Installed Three is 0.180.0. Read the [current official documentation index](https://threejs.org/docs/llms.txt), then checked installed r180 and [r180 Bindings](https://github.com/mrdoob/three.js/blob/r180/src/renderers/common/Bindings.js), [WebGPUAttributeUtils](https://github.com/mrdoob/three.js/blob/r180/src/renderers/webgpu/utils/WebGPUAttributeUtils.js) and [Renderer](https://github.com/mrdoob/three.js/blob/r180/src/renderers/common/Renderer.js). Current documentation examples use a newer revision and do not establish installed API compatibility. The r180 binding path updates uniform buffers when their update reports changed data; skipping it globally would require dependency proof. Current renderer boot does not enable timestamp tracking. An adapter supporting timestamp-query alone provides no duration measurement.

OPEN — Prioritized next performance action: once root has headroom, use the unchanged profiling route on an exact current sourcemap build, preserving actual entry/map bytes and full settings. Add separate diagnostic observation of submission work by pass/material/object before choosing a batching target. If GPU timing is needed, root may admit a separately labelled, default-off r180 `trackTimestamp` diagnostic and bounded asynchronous resolution; do not wait for GPU completion in ordinary frame timing. Compare uninstrumented timing windows separately. No production optimization is justified here solely by static complexity or a newer Three version. Repeated static opaque objects may eventually be a batching candidate, but the retained trace does not identify their object/material ownership, so no speculative batch patch is proposed.

## Animation evidence and the bounded change

VERIFIED — All **15 GLBs** in `public/anim/manifest.json` are present, total **392,764 bytes**, with 21 addressed joints and 22 channels each. All carry `kimodo-soma-rp-v1.1` metadata, and their bytes exactly match promoted `dist/anim/`. The helper emits each clip's SHA256. Idle and prone are procedural clips, not missing Kimodo load failures. Offline manifest slide numbers include walk 3.8 cm, run 6.2 cm, sprint 4.0 cm and crouch-walk 2.4 cm; one-shot entries deliberately distinguish foot travel from slide. These values are metadata from the offline retarget, not current blended gameplay measurements.

VERIFIED — Runtime uses speed-scaled clips and a plant/carry/blend layer. Accepted-source `blend.ts`, `system.ts`, `kimodo-clips.ts`, `anim-qa.ts`, `body-presentation.ts` and the manifest were unchanged at investigation start after normalizing Git LF versus checkout CRLF. Current registry evidence proves loading, not foot contact, transitions or motion acceptance. Viewed original full frames `captures/overnight-2f837ae-play-circle.png` and `captures/perf/overnight-pass1-shadow-canary/run-2-interior.png`: neither provides a close moving character/contact view; the latter is an outdoor respawn/route endpoint despite its filename. No animation-quality grade is inferred from them.

VERIFIED — Exact coverage gap: `CharacterRig.measureSkate()` originally returns a numeric worst value initialized to zero. Its stance predicate rejects high horizontal world foot speeds (`blend.ts`, original lines 847–849). `capture-anim-views.mjs` prints that value but its final exit depends on dark frames, not contact coverage. A zero with no eligible contacts is unmeasured. It must not be interpreted as proven zero sliding. The helper executes the actual frozen method against deterministic prescribed contacts, without running or replacing animation:

| CPU fixture, five contact windows | Foot travel across sampled low window | Legacy worst | Completed legacy stances | New coverage |
|---|---:|---:|---:|---|
| Stationary feet | 0 cm | 0 cm | 10 | measured; 8 eligible |
| Slow residual drift, 0.2 m/s | 9.67 cm | 9.33 cm | 10 | measured; 8 eligible |
| Fast excluded drift, 2 m/s | 96.67 cm | 0 cm | 0 | unmeasured |
| No samples | — | 0 cm | 0 | unmeasured |
| First stance unfinished | — | 0 cm | 0 | incomplete; 2 pending feet |
| Warm-up contacts only | — | 0 cm | 2 | incomplete |
| Contacts below legacy duration gate | — | 0 cm | 10 | incomplete |

VERIFIED — Root explicitly granted sole `src/characters/blend.ts` ownership for an additive observer, following the counterexample. The change adds two counters, reset bookkeeping, exported `SkateCoverage` and **`CharacterRig.skateCoverage(): SkateCoverage`**. Existing pose, mixer, stance predicates, speed gates, duration/warm-up gates, numerical slip accumulation and `debugSkate()` shape remain unchanged. The getter is read-only and allocates only when called. Normal animation update gains no observer calls.

VERIFIED — Getter fields are `state`, `reason`, `sampleCount`, `eligibleCompletedStances`, `pendingStances`. `sampleCount` counts estimator calls, not unique rendered frames. `measured` means at least one completed stance passed the existing duration and warm-up gates; it is not a quality pass and does not claim both feet or every requested action is covered. `incomplete` means a stance was admitted but none has yet qualified. `unmeasured` means no samples or no admitted stance. Pending feet are unfinished windows excluded from the current worst value; a measured completed prefix can coexist with pending contacts.

OPEN — Root owns the QA/capture integration: expose this separate getter, refuse contact acceptance when state is unmeasured/incomplete, and retain actual raw trajectories when evaluating excluded fast contact. Do not weaken or replace the existing slip predicate, threshold or old failed helper. Root should admit a fresh walk/run/sprint/crouch/prone observation using actual gameplay speeds and real root motion, close front/side/three-quarter/low frames plus motion. No animation authoring, motion fix, new clip, geometry cut or game-pixel improvement is claimed by this observer.

## Reproduction and evidence binding

VERIFIED — Fresh CPU helper: `node scripts/_profile-openpass-retained.mjs`. It writes nothing and starts no child except read-only `git show` of the frozen source. It retains the before-method counterexample from immutable dispatch commit `537ddb7`, checks legacy numerical results and root coordinates at every synthetic sample, tests missing/unfinished/warm-up/short contacts, reset and getter non-mutation, and confirms measured-prefix/pending-contact semantics. Its only TypeScript erasure is the fixed tuple `as const` assertion. It neither bundles nor builds application code. `node --check` passes; full helper and typecheck status recorded at final freeze below.

| VERIFIED retained evidence | SHA256 |
|---|---|
| Baseline raw CPU profile | `1be2aa67e57a0b5394238e4315c9cb32f7de33b9849d4f6433d0dad79d9c1eea` |
| Baseline mapped profile | `557f9e8aaaf1088d2fbf63dbd1a76cd60a8ec0ffe7e5ba1782fa8f47266474b9` |
| Canary raw CPU profile | `a7de062486ead9d795fb1707ffa1bf84a6d8b5241f8d99f0320e53b501eb686f` |
| Canary mapped profile | `ae1f6531a7478dd5533fa1cbcf434ef6ea4cd7b6b643645810f0fa98813855aa` |
| 2f837ae soak receipt | `d0b2de031d77cddc0944dd5633faa489476b43b92160c7cacc27fc159dc3f4f3` |
| Frozen blend Git blob, dispatch/accepted source | `8208ce9388a989fc67f7f5d0ca22d2b8542438f298e5ded5c6e55827aba6930e` |
| Original checkout blend bytes, CRLF | `9b5705273160571ee24c1a74a3079004f4708f1141ed13eccc41f06c4c837322` |
| Original extracted method, before type erasure, CRLF | `faa5f0405cbefe96c8120e851f768ca904f831b477ef601da60dbceae45607b9` |
| Manifest checkout bytes | `f487d7acd3fb1e2de4aef265fa994793a76fa00afe970ba09de130429b5b49e3` |

OPEN — Current GPU timing, sustained S9, actual contact coverage and owner motion acceptance remain unresolved. This pass repairs the distinction between zero measured slip and missing measurement; it does not close those runtime gates.

VERIFIED — Final source freeze: 36 additive lines in `src/characters/blend.ts`. `node node_modules/typescript/bin/tsc --noEmit`, `node --check scripts/_profile-openpass-retained.mjs`, the full CPU helper (eight cases / 1,610 samples, all legacy results equal) and scoped `git diff --check` passed. Candidate blend SHA256 `1dad35aa231a7285bc854aae742544664f6959d212e419bfc25ac5795ceb664c`; helper SHA256 `85df1fc6589fa173f6895e84d132d3795deeff7f979bb3015554e1c1761c628f`. Frozen for root integration; no common capture, main, renderer or other worker source was edited by this worker.

## Independent observer-integration review, 2026-09-27

VERIFIED — Root's subsequent integration was independently read and exercised with `node scripts/_verify-openpass-observer-integration.mjs`. Four CPU groups pass. The helper executes the actual `pick`/`installAnimQA` function declarations, actual capture observation and exit statements, actual embedded neutral draw/stats functions, and actual neutral identity argument guards. TypeScript erasure applies only to the two selected declarations, in memory; no application bundle or build is produced. Renderer/rig ports are deterministic fixtures. No browser, GPU, source-module edit or network-helper edit occurred during this review.

VERIFIED — Actual QA registration calls only the rig coverage getter, with zero sampling, reset, pose or RAF calls. Missing and replaced actors return null. The actual capture route attaches the getter after its pre-existing final skate sample and refuses missing/null/unmeasured/incomplete moving coverage. The image darkness threshold of 40, four views, movement predicate and nine-second measurement window equal the frozen `537ddb7` source. The retained estimator helper was rerun: eight cases / 1,610 samples still preserve all legacy results, including fast excluded drift reporting zero legacy slip but unmeasured coverage.

VERIFIED — The current neutral viewer's actual `autoReset` assignment and draw/stats functions were exercised with installed Three.js 0.180.0 `Info`/`Animation`. The original automatic-reset negative changes 12 triangles to zero on an internal RAF without a user render. The new manual mode and completion receipt preserve the observation. A subsequent successful empty draw replaces the prior positive receipt with zero triangles; a rejected render propagates its error and cannot create a new completion. Manual per-draw reset prevents triangle accumulation. Perspective, fixed view coordinates, lighting/exposure, viewport, seven capture poses and the nonzero rendered-component assertion match the frozen source. Explicit retained-directory guards reject traversal/absolute/nested paths; a fresh path requires all three SHA256 pins, and tampered bytes fail the real hash checker.

OPEN — No material new defect was found in the reviewed integration, but **measured coverage is not foot-contact quality acceptance**. The original capture has no numerical slip rejection; the CPU test explicitly demonstrates that a measured high-slip result can still pass this coverage/image exit. No new threshold was invented or relaxed. A measured completed prefix can retain pending contacts and does not establish coverage of every foot/action. The manual draw proof exercises the capture's serial await pattern, not concurrent human camera/reload requests. Full retained-viewer preflight against a newly built exact manifest, actual WebGPU frames, real motion/contact and the original failed capture's precise cause remain OPEN.

VERIFIED — Development-only helper correction: Git's frozen text is LF while this checkout uses CRLF; the first camera comparison stopped on that byte-format difference. Parsed source comparisons now normalize CRLF only. Evidence hashes below remain raw bytes. `node --check scripts/_verify-openpass-observer-integration.mjs` and the existing `node scripts/_verify-openpass-manual-metrics.mjs` also passed.

| VERIFIED integration source/proof | SHA256 |
|---|---|
| `scripts/_verify-openpass-observer-integration.mjs` | `ad482ba07b08f0ada6d3aa33598dd1ff436c86a6cc2e18cf51b4eb8ff2833218` |
| `src/characters/anim-qa.ts` | `4c365b15e616b69d78cc7b10745baf3851dcb18f71420f52f152e42e02f914af` |
| `scripts/animation/capture-anim-views.mjs` | `56e07821e7838d1c83e05f687c03c87a711b6d61bba1e3a403e13083dedb9599` |
| `scripts/_inspect-overnight-heavy-rig.mjs` | `c75a7aa5dc4b24d0f08a8a39f91dbeedde5157e2cbd1bad8d31be31ebc6556b2` |
| `scripts/_capture-overnight-heavy-neutral.mjs` | `c8e2424d066065f9afa01629b3e68f756a92efab30ae30f766f501297fd088ba` |
| Installed r180 `Info.js` | `1cdb5cbaea924a9f62a3bad7fad3cea146083756a89e1a7e68fb25e04732443b` |
| Installed r180 `Animation.js` | `7d852501826f7c8d0f466b1c219acf0c6e866ccda62e2e707e0f75e53c75318b` |
