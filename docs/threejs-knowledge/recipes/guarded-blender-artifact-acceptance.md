# Guarded Blender artifact acceptance

Observed September19 overnight: Blender exited after a Python assertion while leaving yesterday's GLB untouched; the original wrapper also lost Process.ExitCode. A successful launch and existing asset were insufficient evidence.

For project-owned CPU authoring use --background --factory-startup --threads2 --python-exit-code9; retain the Windows Process.Handle, cap private/RSS at2GiB, sample >=12GiB freeRAM and>=3GiB freeVRAM, and cancel only that owned process on breach/deadline. Preserve stdout/stderr and pre/post output hashes and timestamps. Require expected completion marker, fresh artifact, strict decodedGLB validation and actual matching-camera pixels. Do not let a staleGLB satisfy a repairedrecipe gate.

GLB bufferView offsets are relative to the BIN payload; node.mesh is a numeric mesh index. Accumulate node transforms when validating socket/magazine bounds. A texture exported does not prove its UV/material region is correct: ORM and basecolor atlas regions must match the intended part.

Shared loader geometry/material/texture identities require deduplicated disposal, including one ORM texture in multiple material slots. Test the actual bundled loader with controlled delayed loads; clone detach precedes master release, unrelated masters remain usable.

Mechanical green does not establish art. Authored-mountain candidate passed48CPU+28browser checks yet actualframes resembled blank towers and failed the frozenpanorama target. Retain failedreferenceevidence and change representation after bounded repairs; never relax the visualbar or relabel procedural art as image-to-3D.

Evidence: docs/handoff/REVIEW-2026-09-19-2305.md; .recovery-runtime/heroes-build-2300-r1/; .recovery-runtime/mountains-build-2306-r2/; captures/authored-mountains-2309/.

## September 20 export and construction lessons

VERIFIED - The operator CPU recipe counted 12,520 triangles while its first actual GLB contained 11,980. Appended kneepad and lens faces used local indices without the destination vertex offset; Blender discarded invalid geometry. The final external repair corrected those offsets and both unchanged GLB guards passed. Validate the exported triangle, primitive, skin and texture data, not only source arrays. Evidence: `work/operator-export-final2-muse-1030/`, `.recovery-runtime/operator-export-final2-1035/`.

VERIFIED - A cylinder helper placed coordinates in world-space vertices but left object location at zero. Later rotations moved the part around the wrong origin. The repaired sedan then failed its actual width envelope, so that approach stopped after two repairs. New construction must define local coordinates, object transforms and the complete wheel/body envelope before producing vertices; neither scaling the finished asset to pass nor loosening the envelope is acceptance. Evidence: `work/car-bake-muse-repair2-0955/` and its preserved Blender failure.

VERIFIED - Browser QA was cancelled when free VRAM dropped to 763 MiB despite adequate launch headroom. A cancelled run remains incomplete. Require measured launch headroom and live reserve monitoring; cancel only the owned QA tree on resource breach. A later healthy point reading alone is insufficient. Evidence: `.recovery-runtime/soak-preview-operator-1048-guard.json`, `.recovery-runtime/headroom-1105.json`.

VERIFIED - Blender object location assignments had not reached `matrix_world` before a later transform read. CPU coordinate math passed while the real mesh sank 0.36 m below ground. Evaluating first, validating world centres, baking transforms, then rolling mesh data fixed all 42 cylinder centres. Joining by material produced six actual exported primitives. Material count alone had not proved draw count. The same export still lost 16 triangles from eight rear-window quads with repeated coordinates; the invalid-mesh warning correctly remains a failed artifact gate. Evidence: `.recovery-runtime/sedan-repair1-1135/`, `work/sedan-evaluated-export-repair1-muse-1117/`.
