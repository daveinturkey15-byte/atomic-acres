# Astra contribution record — 20 September 2026

VERIFIED: Dave authorized exactly two Astra xhigh implementation specialists until 09:00 Europe/London. Both are dispatched as gpt-6-astra / xhigh. They must stop implementation by 08:58; the root checks the cutoff on continuation. No separate timer service is claimed. External models continue afterwards.

| Specialist | Authored work | Root evidence and status |
|---|---|---|
| astra_shading | Window shading, static layout reflection probes and analytic vehicle cabin shading | VERIFIED: root commits de788b5, fd4a2f3, 508d63c, 439df6e. CPU ownership/cache and eight matched WebGPU frames pass. Viewed windows improve readability. This approximates reflections; it does not ray-trace the live scene. |
| astra_shading | Scanned plaster and timber response across seven material identities | VERIFIED: native c3d5504 became root 6158ab2; repair 87c4fd4 became ef3e74b. Four runtime maps, approximately 13.33 MiB decoded, zero extra draw calls. Original trial visually rejected. Repair 1 removes exterior scallops, but the interior still looks stained; repair 2 is in progress. Not promoted. |
| astra_motion | Time-based look/recoil settling, reload reach/roll, ADS endpoint and constant-length sleeves | VERIFIED: root fa4c7f5 / 8f4ea3e. 6,970 CPU controller frames and 172 unchanged action comparisons; 17 real-game poses pass. Temporal observer captured six reload phases and actual sprint successfully. |
| astra_motion | New pistol fingers, palms and forearms; contact-aware reload path | VERIFIED: root c033ade, ed9dd26, b59a64a. Actual 241 reload, 1,205 offhand and 980 stance samples pass; minimum floor clearance 34.981 mm. Live images show clearer fingers/reach. OPEN: two temporal captures each observed five of six required in-reload phases, with no game errors. Geometry remains optional, pistol only. |
| astra_motion | Rifle-family adoption of the hand rig | OPEN: new contract f95de1d freezes 28 actual rifle solids, physical contact points, draw/triangle/clearance limits and unchanged pistol hashes. Implementation is underway, target 08:05. No gameplay or controller-timing changes authorized. |

VERIFIED: Observer-only commits fe78a8f and ca48ca5 restore visible-menu startup waits and preserve failed-entry diagnostics. Tests now enter through Play solo and Deploy. New geometry is not accepted merely because the script exits zero.

VERIFIED: Root performs orchestration, review, focused acceptance and mechanical integration. No OpenAI image generation is used. The original failed geometry, clipping and visual receipts are retained; thresholds were not weakened.

Evidence: captures/astra-motion-0634; captures/astra-hands-temporal-2026-09-20T06-15-46-859Z-YdHj98; captures/astra-hands-temporal-2026-09-20T06-21-29-218Z-Ap0HEs; captures/gauntlet/glazing/round-r1-0648; captures/gauntlet/architecture/round-0715 and round-r1-0725.

VERIFIED 07:46: final architecture repair native25b2c96 became root4f23513. Actual r180 cache-key collision reproduced in CPU negative control; stable material/texture keys correct it. Four matching viewpoints render without errors or extra draw calls; viewed interior bands are gone and finish is finer. Whole candidate210s soak passes at53.1fps; 60fps is still OPEN. Shading now authors a separate bounded foliage canary; no more architecture repairs are authorized in this inner loop.

VERIFIED rifle source02217fc is ready in its privateworktree, with frozen contractf95de1d and observer15101c7. Root has not integrated or viewed the rifle variant yet.
