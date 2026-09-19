VERIFIED: playable standalone checkpoint J, September 19, 2026, 16:15 UK.

[Play the game](http://127.0.0.1:4191/) → Play solo → Deploy. Refresh an older tab. Multiplayer is available from the same menu. This URL runs on this PC; it is not a public deployment.

VERIFIED: this is the new project begun September 17. Recovery branch: recovery/wave7-20260919. Source: 0138f85e151ea495f5bf2dfdba91c9aa134af1c3. The original Claude checkout, initial raw snapshot, later Fable delta and accepted checkpoint G remain preserved. The older Atomic Acres project remains a systems reference.

VERIFIED changes:

| Area | Result |
|---|---|
| Performance | Orange-house opaque geometry batched. Worst draw calls across the same four gameplay views fell from 1,189 to 891 (25.1%). Geometry, UV, materials, shadows and all 233 house colliders have an actual source equivalence proof; deliberately corrupted geometry/UV/shadows fail it. |
| Timber fencing | Three byte-preserved 1k photo maps, one merged fence mesh. Two poor UV versions were rejected before the accepted single-plank crop. Root viewed all three fence frames. A modest material refinement. |
| Match rejoin | A real guest browser refresh/rejoin restores the active match, weapon, equipment, life and shot/input counters. The 16-check test includes movement and an accepted post-rejoin shot. CPU tests cover changed peer ID, countdown and rematch boundaries. |
| Fable recovery | Recovered later animation scratch-object reuse; 648 real animation frames across nine states have zero pose difference. |
| Retained systems | Menu/HUD, weapons, ordnance, killstreaks, weather/time, smoke, recorded gunfire/foley, Kimodo clips, prone/gait refinements, vehicles/hedges/operator details, barrels and two small Quiver plants. Each remains subject to its documented limits. |

VERIFIED validation:

- Fresh source build and all 92 runtime files (24,659,833 bytes) match the tested candidate. Live HTTP readback identifies J and the same JS hash.
- Stock installed Chrome opened the live menu, selected solo/deploy and entered an active match: zero browser errors or failed resources. Root viewed the actual frames.
- Four gameplay captures and 13 QA stations passed, as did five traversal routes and four house-face checks. All 652 collider rows and owners match G.
- J's 210.7-second soak passed: 12,041 frames, about 57 fps average, JS floor fit -0.232 MB/min, renderer net +9.46 MB, and 173 listeners before/after. Geometry/texture counts settled after warmup. This does not prove indefinite leak freedom.
- Unchanged network source passed H2's two-browser 24-check/120-second test, H3 rejoin and nine-check ungraceful host-loss test. Both browsers ran on this PC.

OPEN limits:

- The scene remains stylized. Houses, mature trees, mountains, weapons and operator need stronger modeling/texturing; no photorealistic claim.
- Exact magazine/reserve split across a mid-reload rejoin is unresolved; host total-round estimates restore a usable loadout.
- WAN/two-device multiplayer is untested. Correct bearer-token reclaim by an old transport remains a policy question.
- Bedroom clearance passes at 0.30 m radius; the 0.42 m stress-radius case remains open.
- The static reflection canary was visually rejected and stays disabled; possible derived-resource residue is under investigation.
- Recorded sounds are integrated and lifecycle-tested; subjective balance and weapon character still need listening.
- Trellis/H3 inference remains deferred because its measured model footprint cannot preserve the requested VRAM reserve. Existing Kimodo assets and a CPU Blender conversion were used; no output is attributed to unrun models.

VERIFIED orchestration:

OMP was updated to 18.2.6. The authorized Z.ai credential uses the protected local secret helper, never the repository or provider receipts. Prior completed GLM and Muse runs returned route attribution. AGY requested Gemini 3.8 Flash high but did not return serving-model attribution. Union Alpha was absent from the refreshed local catalog.

Three new GLM 5.3 Flash max jobs and one Muse Spark 1.3 contributor xhigh job are launched: Searsia tree conversion, respawn-delay repair, reflection-resource lifetime and arm/glove geometry. They have separate ownership, 20–25 minute limits and run-ledger entries. New outputs remain OPEN until independently reviewed.

The last resource sample had 34.37 GiB free system RAM and 5,078/16,303 MiB VRAM used. Browser/GPU jobs are serialized; CPU Blender uses two threads. Owner processes are preserved. The continuation heartbeat runs every 15 minutes, reads CURRENT.json and reconciles existing jobs before new dispatch. It stays quiet for unchanged state.

VERIFIED recovery paths:

- Source: C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919
- Frozen J artifact: C:/Users/david/Desktop/stuff/nuketown-recovery/20260919T085155Z/checkpoint-j-dist
- Previous accepted fallback: C:/Users/david/Desktop/stuff/nuketown-recovery/20260919T085155Z/checkpoint-g-dist
- Source bundles and recovery archive: C:/Users/david/Desktop/stuff/nuketown-recovery/20260919T085155Z
- Current ownership/state: docs/handoff/CURRENT.json
- Root acceptance: docs/verification/2026-09-19/checkpoint-j.json
- Provider evidence: docs/PROVIDER-RUN-RECEIPTS.md and local metadata receipts

VERIFIED JS: index-CZ1WkqZ7.js
SHA-256: b59626e64bf9d57d59dd4f40d0db18431dd97e6cf3cc19ca24f6d6258d8ec0d1
