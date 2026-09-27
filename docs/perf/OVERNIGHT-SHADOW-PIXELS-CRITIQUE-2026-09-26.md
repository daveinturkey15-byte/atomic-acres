# Independent shadow-pixel critique — 2026-09-26

**VERIFIED — Static comparison supports continuing to fresh gameplay/lifecycle checks.** No visible canary-specific loss of shadows or transparency was found in these eight inspected frames. This is retained appearance, not a demonstrated art improvement. **OPEN — Dynamic, performance and owner acceptance remain unestablished.** Decision: `continue`; largest remaining gap: `missing-evidence` for moving output.

VERIFIED — Read the frozen `docs/night/VISUAL-BAR.md` and the current project contract. Opened every original, uncropped baseline/canary PNG under `captures/perf/overnight-shadow-pixels-v1/` through `view_image` at original detail. Revisited foliage/building views after examining numeric difference locations. No implementation source, builder rationale or implementation self-grades were consulted. The report's instrumentation labels were not treated as evidence of visual quality. No browser/GPU job or implementation edit was performed.

## Pixel findings at identical stations

| Feature/location in the 1600×900 frames | Baseline versus canary |
|---|---|
| Foliage holes and silhouette: turningHead left crown x0–140/y300–378 and right crown x1125–1250/y322–400; yardOrange crown x370–455/y368–432 | VERIFIED — Sky/building gaps between leaves remain open; trunks and angular branch forks remain visible. No new opaque card rectangles, filled crown holes, missing branches or erased silhouette were observed. OPEN — Fine individual leaf-shadow fidelity is difficult to judge at this on-screen size. |
| Foliage casting: turningHead left sidewalk around x0–285/y548–633; interiorOrange hedge through doorway x235–430/y474–548 | VERIFIED — Broken foliage shading on the pavement/hedge remains in both. No perceptible canary-only replacement with a solid rectangular cast shadow or disappearance of the visible pattern. |
| Contact: yardOrange deck/posts x680–1045/y622–825; turningHead foreground car x65–680/y550–850 and blue bus x845–1205/y545–666 | VERIFIED — Dark deck footprint, post joins, tyre/underbody grounding and larger cast shadows remain. No observed canary-only lift, detached shadow, or loss beneath these objects. |
| Roof/house edges: yardOrange eave x430–1295/y230–420, front facade/window band x550–1145/y360–555, deck/grass boundary x720–1040/y650–800 | VERIFIED — Eave shading, recesses and hard structural shadow boundaries retain their position and extent. No observed light leak or missing house/deck shadow introduced by the canary. |
| InteriorOrange: ceiling/wall junction y85–150, doorway x140–575/y257–845, window reveal x925–1530/y226–664 | VERIFIED — Interior remains darker than exterior; ceiling contact, doorway depth, sill/reveal shading and floor falloff persist. No visible brightening that would indicate a lost occluder, and no new black area. |
| Transparency: yardOrange house glazing and greenhouse at right; midStreet bus windows; interiorOrange window/door opening | VERIFIED — The same visible interior/exterior shapes survive through these regions. No observed new opaque pane or missing opening. This establishes visible appearance only, not every material's alpha behavior. |

VERIFIED — Minor retained roughness remains in both versions: the turningHead leaf crowns have dense, coarse leaf shards and abrupt angular branch forks; the yardOrange sloping roof/rail edges retain small stair-step raster roughness. The broad pale roof and bus surfaces also have limited surface breakup. These are not identified as canary regressions or as missing shadow/alpha geometry. No distinct new local defect was found after checking the small-change regions around house glazing, fence rails, bus edges and tree crowns.

## Frozen scorecard

VERIFIED — Scores use the existing 0–4 descriptions, with the same score for baseline and canary. They are bounded judgments against the frozen prose and paired baseline; no named external reference set was supplied for this shadow comparison, so reference fidelity is OPEN. No new acceptance threshold is introduced.

| Frozen system | Baseline | Canary | Basis/limit |
|---|---:|---:|---|
| S1 Grounding/contact | 3 | 3 | VERIFIED — Clear vehicle/deck contact and interior falloff; retained minor simplification. |
| S2 Value range | 3 | 3 | VERIFIED — Dark interiors/underbodies and bright sunlit pale surfaces remain; no visible exposure gain. |
| S3 Surface response | 2 | 2 | VERIFIED — Asphalt/timber read, but broad vehicle/roof surfaces remain simple. |
| S4 Material variation | 2 | 2 | VERIFIED — Ground/walls have grain; large roof/vehicle planes lack the bar's pervasive two-scale breakup. |
| S5 Sky/distance | 2 | 2 | VERIFIED — Hazy depth is present; distant forms remain simple and sky structure limited. |
| S6 Silhouette/detail | 3 | 3 | VERIFIED — Architecture/rails/windows and cutout foliage retain detail; coarse branches remain. |
| S7 Colour | 3 | 3 | VERIFIED — Restrained cream, orange, green and blue-grey palette retained. |
| S8 Temporal stability | OPEN | OPEN | A pair of held stills cannot establish shimmer, crawl or popping. |
| S9 Runtime | OPEN | OPEN | Scene counters are not gameplay FPS, memory/disposal or allocation proof. |
| S10 Provenance | OPEN | OPEN | Capture binding was checked; asset licences/provenance were not audited. |

OPEN — This does not clear the complete visual bar: retained S3–S5 scores remain below its existing completion requirement, and S8–S10 are ungraded. No pixel evidence suggests B1/B3/B6 occurred here, but interactive black-frame gates, source changes, lights/clipping lifecycle, collision and provenance blockers cannot be cleared by these PNGs.

## Binding and comparison limits

VERIFIED — All eight local SHA-256 values match `report.json`, and all PNG headers are 1600×900. Report SHA-256: `c5ec9c6fcf83031b0a5d9a55775fd5b3e3df3d300776cfae80501f93480a3971`. It records capture 22:34:31–22:35:54 UTC, Chrome 153.0.8010.54, actual WebGPU, DPR 1, 1600×900 buffers and no errors. These are verified report contents, not a runtime independently launched by this critic.

| Report binding | Baseline | Canary |
|---|---|---|
| Source commit | `ac3f1d45b31c5516fa9504980ce4aa4828674ffa` | `2f4d577227416c0f1a52dc65002534e019d11947` |
| Entry SHA-256 | `567d233ee689950bebc44f0d535951a140a13d2f6c9def48b5390973e7052180` | `f248c20746ecbb205167ab354c803f899910515fb1e925e184b2d1be4f2de71f` |
| Local preview | `127.0.0.1:4360` | `127.0.0.1:4361`, `shadow-material=canary` |

VERIFIED — Reported settings are identical for every pair: 4096 shadow map, AO/SSR/bloom/fog enabled, resolution scale 1, noon/clear, authored lighting, three lights, shadow half 57/fitted 56.5/near 1/far 320. Recorded camera XYZ equals the named station in both sides. The report supplies the same station yaw/pitch/FOV; it does not separately sample actual camera yaw/pitch/FOV per PNG.

| Station | Position; yaw/pitch/FOV | Equal recorded scene counters: calls / triangles / geometries |
|---|---|---|
| yardOrange | (10,8.5,-38); 2.609267 / -0.244346 / 62 | 847 / 626705 / 446 |
| midStreet | (0,1.68,0); 3.141593 / 0 / 72 | 618 / 573129 / 446 |
| interiorOrange | (0,1.68,-18.5); 3.141593 / 0 / 72 | 743 / 607411 / 446 |
| turningHead | (-14,2.6,1); -1.570796 / -0.017453 / 72 | 694 / 597673 / 447 |

VERIFIED — Every pair also records 25 renders, 147 textures and `programs: 0`. Zero here is only the recorded counter; it does not establish absence of shader work or compilation. Actor count is two, with one listed bot at matching position/yaw/stance/weapon. Its sample times differ by about 58.9 ms (34171.3 versus 34230.2). The figure beside the blue bus is small and partly occluded; this is not an animation comparison.

VERIFIED — The largest obvious full-frame difference is HUD timing: turningHead shows `ENGAGE` in baseline but not canary, around x704–893/y316–346. The other seven frames retain it. It obscures a small part of the sky/roof region. All full-frame HUD, minimap, crosshair and lower overlays remain in the evidence; midStreet is largely obstructed by the close bus and cannot establish street-wide coverage.

VERIFIED — Reported mean absolute RGB differences are 0.2637, 0.0878, 0.1574 and 0.3383 on the 0–255 scale for yardOrange, midStreet, interiorOrange and turningHead. Roughly 16–21% of pixels differ by at least one channel value; that is not a defect rate. Independent numeric inspection located most small differences at fine surface/edge/glazing detail, while turningHead's largest region is the transient overlay. OPEN — Noise, subpixel/temporal sampling and the small actor-time mismatch are confounders; these stills do not attribute their causes. Neither tiny mean differences nor equal counters prove visual parity everywhere.

| PNG station | Baseline SHA-256 | Canary SHA-256 |
|---|---|---|
| yardOrange | `91bd8f7a7327771da404f91aaecf3e3ae34b4574ba467c7f73708db4f4c3d5b8` | `651d394059be61d67b6f246d6df0e358c90ccfaadd1e6b0191cddb280ea85a3d` |
| midStreet | `9b61adce5dc87a961819674fcfcb3ce4746c980d12eb768a3b34c70b03aaf687` | `8b0ba2fcb073e29235292e9ca3cfc586448f32502c3719577d6b353700c0a96a` |
| interiorOrange | `9c3d71d0dc5804a9939bd7a190e4f97aee0ac466569d3a769f449f812a3b1e04` | `13d135b9930fadb0ea8646c59929d449abaa03f0ec476cf9206394e385a1ae8f` |
| turningHead | `cf3d119302667ae33e5f62b94433ae00663626b0e4c07d71f2b9e8e08c41d542` | `31a09e20aeb26f39ca9579333b76039aa4e90c82a9b4fb7f814efa7402f808f4` |

OPEN — Root's next checks should exercise moving camera/foliage/actors and actual gameplay, then verify lifecycle and performance under the existing gates. Static appearance supports that next step; it does not authorize promotion or claim an optimization benefit.
