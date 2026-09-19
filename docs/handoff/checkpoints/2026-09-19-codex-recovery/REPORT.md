# Standalone Nuketown recovery — 19 September 2026

**VERIFIED playable recovery:** [Open the recovered build](http://127.0.0.1:4191/). This is a local URL on this PC. Choose **Play solo → Deploy**. Multiplayer uses the local signalling relay on port 4310 and the Network connection tier. The old public website is not this build.

**VERIFIED source:** `b5c5403a5eefe104b50ebe66707938909c618ca2` on `recovery/wave7-20260919`.
Bundle: `index-DKATjAJS.js`; SHA-256 `609fbe2206184dd518882ed69663a64fa5a1ac2fd853d52ba97b95e3903a4ead`. Live identity: [build-info.json](http://127.0.0.1:4191/build-info.json).

## Identity and preserved work

- VERIFIED: original repository `C:/Users/david/Desktop/stuff/nuketown`, branch `layout-boii-proportions`, HEAD `b1a310005f2f2133364f7b20c3e842ff161a2eff`. Started 17 September 2026.
- VERIFIED: new remote `daveinturkey15-byte/atomic-acres`, created 17 September; distinct from the older `atomic-acres-browser-arena` repository. Existing Atomic Acres branding is retained. No old-project code/history/assets were imported during recovery.
- VERIFIED: the original lane was 28 commits ahead of its remote branch. Owner fixes `39db6b1` and ordnance/lobby integration `3183693` are ancestors of its HEAD. No stashes, registered alternative worktrees or unreachable commits were found before this recovery worktree was created.
- VERIFIED: original checkout retained. A snapshot of **5,511 files / 2,831,500,640 bytes**, including references and captures, was copied and every copy SHA-256 checked; Git history was bundled and verified. Regenerable dependencies, Git internals, private harness data and log files were excluded from the file copy; Git history is separately in the bundle.
- VERIFIED: snapshot `C:\Users\david\Desktop\stuff\nuketown-recovery\20260919T085155Z`. Seven additional project artifacts from Claude's known scratchpad were copied and hash-checked under `claude-scratch-artifacts`, including the adversarial ordnance scenario/results, coplanar results, older atmosphere draft and bedroom-door brief. No unlanded bedroom repair was found. This is evidence from inspected locations, not a claim that every possible temporary file on the PC was searched.
- VERIFIED: readback confirmed **282 original source/script/public files unchanged** after recovery. The original intentionally deleted idle animation remains absent there; this branch retains the old unused idle file, while the recovered manifest selects procedural idle and does not load it.
- VERIFIED: working branch is `C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919`. Its dependency directory points to the existing installed dependencies. Use the lockfile to reinstall if that directory becomes unavailable.
- OPEN: off-machine backup of the recovered branch. The configured remote is public; this recovery did not publish source, generated references or captures. The previous public deployment remains older than this candidate.

## What was actually verified now

| Check | Result and boundary |
|---|---|
| TypeScript and render-site allow-list | PASS, `npm run check` |
| Production build | PASS, Vite 6.4.3, installed Three.js 0.180.0 |
| Real player loop | 4/4 gameplay positions rendered; actual frames opened |
| Stock installed Chrome | Play solo → Deploy, controls exercised, match active; zero page/console/resource errors after favicon repair |
| Map capture | 10 frames generated; aerial, white yard, menu and gameplay views opened. Nine stations had meaningful counts, maximum 1,133 draws and approximately 342k triangles. Aerial reports only 2 post draws and remains invalid as performance evidence |
| Traversal | 5/5 routes, 4/4 house faces, garage-right invariant PASS |
| Ordnance | 53/53 deterministic grenade, flash, smoke-LOS, knife, drops, bot and hand-input checks PASS |
| Killstreak refusal | PASS, original assertion retained; stale import corrected to the current `session-streaks` module |
| Memory soak | PASS, 210.7 seconds, 23,254 frames. JS post-GC slope 0.314 MB/min (limit 0.5); renderer net +7.07 MB during the fit, 47% upward samples (limit 20 MB monotonic). This is bounded evidence, not a claim of indefinite leak freedom |
| Two independent browsers | PASS: room create/join, ready/start, movement, damage and kill visible at both ends, 120 seconds with zero disconnects and zero console errors. LAN/WAN were not tested |

The 120-second match diagnostic accidentally targeted the pre-existing :4188 preview; its results are **not** counted as evidence for :4191. The retained candidate tests above explicitly used :4191. No thresholds were relaxed. The aerial counter discrepancy and historical atmosphere AO check remain open despite process exit codes.

## Reconciled feature ledger

| Area | State | Evidence / remaining work |
|---|---|---|
| Car / white garage / upstairs | VERIFIED source landed; partial acceptance | Committed owner fixes preserved; fresh traversal passes. Bedroom hall doorway still blocked by the bed collider; alternate room route exists |
| Z-fighting | OPEN | Dirty geometry cleanup recovered. White-house/vehicle joints need source scan plus pixel comparison; not declared globally fixed |
| Guns, grenades, knife, damage and drops | VERIFIED core checks | Rebuilt host/client systems present; 53/53 deterministic checks. Knife is V at runtime while part of the UI says F; fix label/binding consistency |
| Killstreaks | VERIFIED source and refusal regression | Four-slot systems present. Full balance, every effect and rematch behavior still need their dedicated acceptance pass |
| Menus, bot rules and HUD | VERIFIED playable path | Solo setup/deploy, HUD and real local multiplayer work. Settings, lifecycle polish and arm/HUD presentation remain review targets |
| Atmosphere / time / weather | RECOVERED, OPEN integration | Five time presets and weather/fog/post code retained. Historical QA generated weather/smoke frames, but its AO result is false. Gameplay smoke is still the placeholder: no binding from client ordnance into the atmosphere smoke adapter |
| Animation | RECOVERED, OPEN visual acceptance | Aim/sprint rerolls, blend work, audits and manifest retained. All manifest asset files/byte sizes checked by the review. Idle rejection is intentional. Sprint stride/threshold and final motion sheets need validation |
| Blender / Trellis 2 | CAPABILITY EVIDENCE, not shipped-quality proof | Existing pipelines/reports preserved. Earlier generated coach and Trellis canary were not accepted over the procedural baseline. Do not assume generated assets are in the game merely because tooling exists |
| Photoreal comparison loop | RECOVERED, OPEN | Source frames, target work, manifests and generation scripts retained. No claim that all planned target pairs or subsequent visual loops completed |

## Next passes — three lanes maximum, one GPU verifier

1. **Close the integration gaps first.** Fix the bedroom collider and knife-label conflict. Bind `world.atmosphere.smoke` to the current client's `ordnance.smokes` at `bindClient`, including null/rematch/guest lifecycle. Remove duplicate placeholder presentation only after the real volumetric path is verified. Validate smoke visibility and gameplay LOS from the same live event; do not substitute QA-injected smoke. Resolve the AO/aerial measurement discrepancy without loosening checks.
2. **Finish atmosphere and animation separately.** One lane owns world/post/materials and time/weather/options; one owns animation/viewmodel only. Keep the light set constant, verify effect toggles, smoke expiry, rain/wetness, resize and memory. Run posture/contact/stride sheets and live bot motion; preserve rejected takes and provenance.
3. **Run the visual improvement loop on this one map.** Fixed gameplay cameras → generated photoreal targets that preserve layout → identify a few measurable gaps → rebuild materials/UV/PBR, hero assets, lighting and shadows with the relevant tools → compare actual game frames → keep only improvements within frame, draw and memory budgets. Prioritize house interiors, exterior materials, contact shadows/reflections, vegetation and skyline. Tools serve the visual target; there is no requirement to invoke all 50+ skills per pass.
4. **Then multiplayer reach and release.** Re-run options/rematch and ordnance in two browsers; add two-device LAN then WAN/TURN tests when that scope is requested. Publish only an accepted build of this standalone repository with an explicit previous build fallback.

Scoped skill routes: `threejs-game-development`, `webgpu-tsl-arena-forging`, `game-animation-asset-pipeline`, `game-hud-menu-overhaul`, `browser-multiplayer-netcode`, `ai-3d-asset-generation-loop`, `comfyui-3d-native-pipeline`, `img2threejs`, `photoreal-procedural-scene-forge`, `visual-gauntlet-loop`, and `realtime-browser-qa`. These are continuation routes, not claims all were invoked today. Recovery used the handoff/live-state/Three.js workflows plus bounded read-only audits. Current upstream documentation was consulted; no Three.js upgrade was performed.

## Run and restore

- Current preview: `http://127.0.0.1:4191/`; provenance at `/build-info.json`.
- Relaunch silently: double-click `Play-Recovered.vbs` in the recovery worktree, or the launcher supplied with this report. It starts the preview and local relay; it does not build, reset or overwrite source. No automatic startup/scheduled task was installed.
- The existing :4190 preview was left running in Claude's temporary snapshot. Treat it as an older fallback, not the continuation source.
- Ports 4191 and 4310 were added to the existing dev-reaper protected-port list so the owner's preview is not culled while idle; prior list is backed up in the recovery snapshot.
- Git history recovery: `all-refs.bundle` plus `dirty.patch`; exact dirty files and original generated evidence are in `snapshot/` with `manifest.json`. Recover into a new directory and compare hashes before replacing anything.
- Source recovery commit and final handoff are also preserved in `reconciled-refs.bundle` after the handoff commit. No original branch was reset, stashed or cleaned.

## Handoff rules

The current request authorizes recovery, reconciliation, a working local URL and a continuation plan. The attached historical prompt supplies requirements and evidence; its old 09:30 deadline, model choices and indefinite work-loop instructions were not scheduled as new work. The new AGENTS.md clarification preserves the standalone boundary and explicitly permits newly authored Blender/Trellis assets with provenance and runtime acceptance.

`docs/handoff/CURRENT.json` is the current recovery index. Earlier `docs/HANDOFF.md`, `docs/SPEC.md` and the old START_HERE text remain historical context where they conflict with this dated ledger. No active builder remains from this recovery's three read-only delegated audits; no ongoing agent loop was scheduled.
