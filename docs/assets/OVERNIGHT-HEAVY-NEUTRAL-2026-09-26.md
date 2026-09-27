# Retained heavy-weapon neutral inspection

VERIFIED — The source-only runner is `scripts/_capture-overnight-heavy-neutral.mjs`. It serves the existing `captures/overnight-heavy-neutral-repair1` bytes without rebuilding the bundle or changing the rig. Syntax and its CPU-only identity/negative fixtures passed on 2026-09-26. No server, browser or GPU job was launched by the preparing agent.

Run from the candidate worktree only after the integrator releases the serial GPU lane:

```powershell
node scripts/_capture-overnight-heavy-neutral.mjs --tag overnight-heavy-neutral-pixels-v2
```

VERIFIED — A tag is mandatory and an existing output directory is refused. The runner requires at least 4 GiB free VRAM and 14 GiB free RAM before launching its one owned stock headless Chrome. Chrome output is muted; this isolated viewer has no game audio path. Its disposable profile and random loopback server are owned by this run. The capture window is bounded to five minutes, followed by cleanup. It never stops other processes.

VERIFIED — The runner pins SHA-256 for the retained HTML, identity manifest, JavaScript bundle and minigun GLB. It checks all four manifest source-content hashes against the current TypeScript/builder files. The retained manifest records commit `56006ef65f813f1215f62608587661ffb0152322`; later Git commits do not alter those verified content hashes. The receipt records the current HEAD separately rather than relabelling the original build.

VERIFIED — `buildMaterials()` unconditionally loads four vegetation textures although the neutral scene contains no vegetation mesh. The integrator initially approved four exact read-only public-file routes: `island_tree_01_leaves_{alpha,diff,nor_gl,rough}_1k.png` beneath `public/textures/vegetation/`. Repair 1 adds the fifteen observed baseline material requests described below, for nineteen external texture dependencies in total. Each has a frozen hash checked before launch and recorded in the receipt. Every served asset is pre-read into memory after hash verification. There is no directory fallback, external origin fallback, source-file serving or network-error suppression. Unknown routes fail the capture. `/favicon.ico` is the sole explicit empty response.

VERIFIED — The frozen component has a 40-degree perspective camera, neutral background, hemisphere/key/fill lighting and its actual model adapter. The runner calls only its existing `view()` and `reload()` API, awaits their render promises and requires reported WebGPU, nonzero draw counts, a 1600×900 CSS viewport/drawing buffer and DPR 1. No geometry, material, lighting, renderer or animation-node override is installed. The full original header and canvas remain visible.

The seven uncropped PNGs are:

- Front, left, right and three-quarter views at reload 0.
- Three-quarter views at reload 0.25, 0.5 and 0.75.

VERIFIED — Each PNG receipt contains its hash, byte count, actual API view/reload phase, source clip count, hand-fit version and render statistics. The original viewer's range-control value is not rewritten by API capture; use the filename and recorded API state for the sampled phase. Requests, console warnings, errors and source/resource context remain in `report.json`. Capturing discrete poses does not demonstrate continuous motion.

OPEN — Successful browser capture and human review remain for the integrator. The initial root-run WebGPU boot produced zero accepted captures. The intended review is whether the hidden right-hand grasp has coherent palm, finger, wrist and trigger/grip contact from multiple angles, including the sampled reload poses. Successful rendering or CPU checks cannot establish anatomy quality. This neutral component is separate from gameplay camera, reload/movement behavior, authority, audio and performance acceptance; none is granted by this runner.

## Localized harness repair 1 of 2

VERIFIED — Symptom: `captures/overnight-heavy-neutral-pixels-v1/report.json` records FAILED, zero PNGs and 31 errors, including fifteen unique texture 404s. Cause: the initial source inspection missed the unconditional baseline PBR upgrades near the end of `buildMaterials()`. The exact retained neutral bundle invokes those upgrades even though the inspected weapon does not use those scene materials. This is a missing viewer dependency, not a reason to suppress resource errors or accept procedural fallbacks.

VERIFIED — Correction: added only those fifteen explicit read-only public routes, each pinned by SHA-256: six street asphalt/pavement maps, three concrete-pavement-03 maps, three distressed-painted-planks maps and three wooden-planks maps. JPEG routes use the correct `image/jpeg` MIME. The bundle, model, source hashes, cameras, lighting, rendering and failure gates are unchanged. Source review confirms additional ground/lawn canary routes require query flags absent from this viewer; interior maps are lazy and this adapter does not request them. Those conditional files remain outside the allowlist.

VERIFIED — Preservation: `captures/overnight-heavy-neutral-harness-repair1/runner-before.mjs` preserves original runner bytes with SHA-256 `fdba35286bcac956b330a49fea62ded1c6f4e4fb89498fbed69e888f056ef226`; `failed-report.json` preserves receipt bytes with SHA-256 `dcfa3e1528b551901f3ef90519c8384bef0ec97c1d1d592da7f130e13bb7321d`. `repair-identity.json` records both and the fifteen dependency hashes. The original failed directory remains unchanged.

VERIFIED — Verification: syntax and CPU self-test pass after repair. The self-test reads all 23 hash-pinned files, matches the four live source hashes, proves the fifteen added routes equal the retained failed-request set exactly, and retains hash-tampering/path-escape/unlisted-file negatives. No browser, server or GPU work was launched by the repairing agent. Root must use the new v2 tag; art and anatomy remain OPEN.

CPU-only recheck (does not open a server or browser):

```powershell
node --check scripts/_capture-overnight-heavy-neutral.mjs
node scripts/_capture-overnight-heavy-neutral.mjs --self-test
```

## Root execution - retained partial failure

VERIFIED: root v2 captured original front/left/right PNGs with no browser errors, then failed the actual-rendered-component gate before the three-quarter view. Only3/7 diagnostic stills exist; no complete neutral capture or anatomy acceptance was earned. The failing receipt and uncropped frames remain at captures/overnight-heavy-neutral-pixels-v2. The failure's numeric state was not retained, so its cause remains OPEN rather than assuming a counter race. Harness repair1/2 is used; no additional repair was admitted. The separate gameplay motion helper remains exhausted2/2 and failed. Heavy hands stay opt-in.
