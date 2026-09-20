# Weapon FX canary — source handoff

UPDATE 08:45 BST: latest candidate is `92022485c9aa0a55ab9bffc945010b3328bdfbfd` after the second and final repair. See `astra-weapon-fx-final-repair.md` for the actual-pixel diagnosis, retained failures and new bundle identity. The original handoff below is retained as the r1 record; its one-repair-remaining statement is superseded. Runtime/art acceptance remains OPEN.

VERIFIED source candidate: `fb322d90fe66a4b791572fa26d015afc6eade258`, after contract `2ede1f421d724435e3cab0d9a45ba69f4814362c` and initial source `fbc073e4206d635165ba2bb1cb923a1c674f8d26`. Requested author route: Astra xhigh, explicitly authorized by Dave for this bounded slice. Original analytic masks and particle code; no generated images, copied game art or external gameplay modules.

The opt-in URL flag is `weapon-fx=canary`. It adds six gas lobes/wisps to each existing ordinary muzzle pop. Existing impact calls retain the decal and replace their transient square/box effects with surface-directed dust, small tumbling particles and short velocity-aligned sparks on the existing non-dusty path. The fast gas envelope decelerates; the slower wisps expand and fade. Impact debris settles against its source plane. This is bounded presentation, not a material classifier or full collision simulation.

VERIFIED scope: only `src/weapons/effects.ts` and the new `src/weapons/weapon-fx-canary.ts` alter game source. No controller, damage, ammunition, reload, input, hands, catalogue, material-library, grenade or render-loop source was changed. Default/unknown flags keep the legacy path. `blast()` bypasses the canary. No new lights, event writers, asynchronous work or timer sources exist.

## Required root integration

Cherry-pick the contract, initial source and normal-buffer repair in that order, then apply `docs/astra-weapon-fx-controller-ownership.patch`. The patch is the separately authorized one-line ownership seam: `this.effects.dispose();` after the controller's idempotence guard. It passed `git apply --check` in this lane. The new disposer releases only the helper's three geometries, three materials and three textures; it never disposes borrowed library materials. Historical ownership of legacy effects geometry is not repaired or claimed by this slice.

Build and run the same root candidate twice, changing only `weapon-fx` between absent and `canary`. Preserve the other lighting, hands and surface flags. No `main.ts` changes are required.

## Mechanical evidence

VERIFIED `node scripts/verify-weapon-fx-canary.mjs`: 15 checks and four deliberately failing negative controls pass. Evidence is in `docs/astra-weapon-fx-evidence/r1-cpu-pass.json`.

- 480-frame exact legacy traces for default, unknown flag and canary grenade-only paths; grenade emits zero helper particles.
- Three fixed single-pass quad batches, 192 total slots, 384 triangles, no added lights. Owned CPU texture/buffer storage is 119,040 bytes; conservatively duplicating everything for GPU storage gives 238,080 bytes versus the frozen 1 MiB limit.
- 6,000 saturated emission calls preserve all mesh/material/texture/attribute/array identities. Zero, negative and NaN delta times do not advance state; large delta times expire it; coordinates stay finite.
- Analytic motion agrees across time-step partitions. Zero, up, down, wall and diagonal normals remain finite, with live particle centers outside their source plane.
- Masks have transparent borders and varied interior alpha. Every quad carries unit normals aligned to the current camera. Hot-method AST audit finds no new objects, arrays, callbacks, materials or geometries.
- Double disposal emits exactly nine owned-resource releases and zero borrowed-material releases; post-dispose emission is a no-op; reconstruction creates independent resources.

VERIFIED `VIEWMODEL_FX_FLAG=canary node scripts/verify-viewmodel-motion.mjs`: 6,970 actual-controller CPU frames, five archetypes, 20 profile mappings, 172 exact admitted claims. HUD/ammo/reload/cadence/FOV/camera recoil and claim origin/direction/time remain identical to the retained controller. This harness has no target geometry and does not validate rendered impacts.

VERIFIED `npm run check` and `npm run build`. Child build: `dist/assets/index-DZqvuvAu.js`, SHA256 `ebf09c3680863cedc23854f4b31b880ddfecac372fbf1a1cdb464e8cde40aac4`. Root's combined build must record its own identity.

## Retained failure and repair budget

Initial source `fbc073e` passed its CPU contract but a subsequent installed-r180 source audit found missing normals for this project's MRT `normalView` output. That code path warns and substitutes a fixed up normal even for an unlit material. This is a source-derived incompatibility, not an observed browser result. The source commit and initial receipt are retained; `r0-mrt-normal-audit.json` records rejection. Repair 1 adds fixed normal buffers and a stronger assertion. One of two repairs remains, reserved for root's actual runtime or pixel evidence. No frozen threshold was relaxed.

## Root temporal review

OPEN: no GPU, browser or image-generation job ran in this lane. WebGPU/WebGL compilation, actual frame time, allocation/renderer soak and art quality need root evidence. Constructor/buffer identity checks do not prove the renderer's heap is stable.

Use actual Play solo/Deploy and actual firing input. Capture an ordinary single shot or short burst with recorded shot/action timestamps and ammo delta. Aim one sequence so the muzzle sits against a mid-tone scene; capture approximately 20/60/120/240/400 ms after admitted fire. Repeat close ground and wall impacts at approximately 30/100/220/450 ms. Capture latency may skip short events; retain observed timestamps and report missing intervals OPEN rather than seek, freeze or stretch effects. Never use the QA pose command or `stretchLives()` to claim temporal quality.

Review for gas departing the muzzle then dispersing, recognizable soft dust/debris fans, brief sparks, no rectangular borders, no obvious uniform marching pattern, no through-wall transparency and no lingering view obstruction. Keep the frozen whole-scene <=1,200 calls / <=900,000 triangles / zero errors gates. Compare actual peak draw delta with the three-batch upper bound. Repeat one grenade blast with the flag on to confirm the legacy presentation and check page teardown/restart with the required ownership seam.

Current upstream references: [BufferAttribute](https://threejs.org/docs/BufferAttribute.html), [MeshBasicMaterial](https://threejs.org/docs/MeshBasicMaterial.html). Installed r180 verification: `src/nodes/accessors/VertexColorNode.js`, `src/nodes/accessors/Normal.js`, `src/materials/nodes/NodeMaterial.js`, `src/materials/nodes/MeshBasicNodeMaterial.js` and `src/renderers/common/Renderer.js` under `node_modules/three`. Skills supplied workflow, not shader/API authority.
