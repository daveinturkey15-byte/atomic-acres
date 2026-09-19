# Image and asset production pipeline

This file closes the missing handoff document from the original night lane. It is a status record, not evidence that a generator ran.

## Verified distinction

- Generated concept sheets are saved under docs/reference/production-catalog with prompts, source paths and SHA-256 receipts. They specify appearance and animation poses. They are not meshes or animation clips.
- Existing Poly Haven barrel and Quiver foliage assets were licensed mesh imports with CPU Blender conversion. They were not reconstructed from images.
- The earlier Trellis crate trial produced a scratch game export but was rejected: colour, underside geometry and texture/draw costs did not improve the existing prop. It is not in the accepted runtime.
- Earlier Blender coach geometry was compared and rejected. Existing editable field-case work is separate from automated image reconstruction.
- A new carbine authoring lane is assigned to image-guided, reproducible CPU Blender modelling from the newly generated carbine sheet. Its output is OPEN until the file, topology, PBR, sockets and actual game view have been inspected.

## Required route

1. Freeze the subject ID, original reference and prompt. Generate coherent isolated multiview images and separate animation pose targets. Scene storyboards are for composition; do not feed a crowded multi-panel image into single-object reconstruction without selecting an appropriate input.
2. Pick a route: reference-guided original Blender modelling, procedural Three.js modelling, licensed mesh adaptation, or a measured image-to-mesh generator. Record which actually ran. Keep editable sources and provenance.
3. Inspect scale, forward/up axes, silhouette, topology, UVs, physical material scale, colour/data texture spaces, decoded texture memory, transparency, normals and LODs. Weapon magazine/bolt nodes and muzzle/hand sockets must be named and testable.
4. For characters, verify skeleton compatibility, foot contact, floor clearance, yaw/aim conventions and hand-to-weapon constraints across standing/crouched/prone states. A generated video or pose sheet is motion reference, not automatically a skinned rig.
5. Integrate the asset into this independent project. Cover loadout/menu preview, first-person/world/drop rendering, host damage/ordnance/streak lifecycle, audio and teardown. No old-project module or asset copying.
6. Capture actual game frames at fixed cameras and animation phases, inspect them against the source target and the previous accepted build, and run the smallest relevant collision/network/performance/disposal gates. A static model screenshot cannot replace this stage.
7. Promote only the reviewed immutable candidate, retain the previous accepted artifact, and record build/source hashes. The catalog gate tracks evidence and missing stages; it cannot judge art quality by itself.

## Resource constraints and Trellis follow-up

The prior recorded Trellis peak was approximately 15.8 GB on a 16 GB card. Owner workloads currently occupy several GB and the required reserve is 3 GB. The existing wrapper's timeout stops client polling without necessarily cancelling server inference. It must not be used as a safe bounded runner in that state.

Before another local trial: expose the actual graph resolution/remesh/texture controls; implement cancellation that checks ownership of the running job; measure peak RAM/VRAM on a bounded canary; keep at least 12 GiB free RAM and 3 GiB free VRAM. Do not stop owner processes or clear their queues. Lower-resolution quality and memory are OPEN until measured. CPU Blender modelling can proceed independently while this is repaired.

## Catalogue scope

The owner requested 20 old-reference weapon families, 11 old-reference killstreaks, four grenade types, operator/enemy turnarounds and animation poses, in-map deployment views, improved menus/HUD and authoritative damage/critical feedback. See docs/handoff/CURRENT.json for ownership and the production catalogue for item-level evidence. Current standalone IDs and behavior must be mapped explicitly; similar names are not parity.
