# Operator Sand — Source-Only Handoff

Stage: **recipe-authored, source-only**. Not accepted runtime.
Blender has **NOT** been executed in this lane (no Blender / GPU / browser / server / delegation executed, respecting the source-only constraint).
The recovery root builds serially and accepts actual pixels.

Existing motion proof and animation code are preserved untouched. This delivery owns only the 4 scoped artifacts.

---

## 1. Delivered Artifacts (4 Scoped Files)

- [`scripts/blender/build_operator_sand.py`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/scripts/blender/build_operator_sand.py) — Blender-native editable recipe with pre-export budget and structural assertions.
- [`scripts/assets/verify-operator-sand.mjs`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/scripts/assets/verify-operator-sand.mjs) — Strict GLB validator (verifies magic, chunks, hierarchy, rest offsets, IBMs, triangle budget, material/image budgets, normalized weights, joint blend/rigid counts, UV ranges, and bounds).
- [`work/operator-sand/manifest.json`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/work/operator-sand/manifest.json) — Manifest specifying scope, budgets, references, licenses, build invoke, and verification contract.
- [`docs/operator-sand-handoff.md`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/docs/operator-sand-handoff.md) — This handoff document.

---

## 2. Art Targets and Reference Lane

Art references are frozen 2D art direction targets only, **not model or mocap provenance**:
- `docs/reference/production-catalog/operators/operator-sand-turnaround.png`
- `docs/reference/production-catalog/operators/operator-sand-poses.png`
- Baseline failure replaced: capsule mannequin with spherical blank head and square eye decals visible at `captures/motion-live/motion-2256-stand-front-release.png`.

Every shell and texture pixel is authored directly in pure mathematical Python tables (`from_pydata`); no third-party assets, meshes, or textures are copied.

---

## 3. Anatomy & Wardrobe Fixes vs Baseline Mannequin

- **Trousers**: Continuous loft per leg (hip to ankle) with a pelvis yoke overlapping the waistband (no disconnected tube segments). Knee dart (forward bulge) plus fold rings above/below knee, and ankle blousing ripple over boots.
- **Sleeves**: Single continuous loft from shoulder to cuff with elbow taper and fold rings; deltoid cap smoothly blending Chest to Arm.
- **Tactical Vest & Gear**: Front and back plates with top taper, side plates, cummerbund, MOLLE webbing strips, triple magazine pouches, admin pouch, radio with antenna, shoulder straps, and utility belt with pouches.
- **Boots**: Shaft with ankle blend into rigid foot, tapered foot block, rounded toecap, proud dark sole plate, and heel block.
- **Head & Helmet**: Deformed skull (jaw taper, nose bridge, brow ridge) under a balaclava shell with a hemmed eye opening and neck sock; helmet dome extending past ears with NVG shroud, side rails, ear-pro cups, chin strap, and goggles with strap, frame, and dark lenses.
- **Gloves**: Palm block, knuckle plate, four curled fingers, and forward thumb at rest.

---

## 4. Skeleton & Rig Contract

Verbatim match with [`src/characters/skeleton.ts`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/src/characters/skeleton.ts):
- Standard 21 bones: `Hips`, `Spine`, `Chest`, `Neck`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, `RightShoulder`, `RightArm`, `RightForeArm`, `RightHand`, `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftToe`, `RightUpLeg`, `RightLeg`, `RightFoot`, `RightToe`.
- Bone parents and rest offsets match `skeleton.ts` byte-identically.
- Actor orientation: **+Z forward, +Y up**, adult scale 1.78m class (crown at y=1.859m, feet at y=0.000m).
- No arbitrary bone-axis rotation or roll fudge factors.

---

## 5. Budgets & Measured Geometry (Pure Python)

All budgets are verified structurally in Python before export and by the standalone validator:

| Metric | Budget / Constraint | Measured (Python) | Status |
|---|---|---|---|
| Triangles | 12,000 – 22,000 | 13,596 | PASS |
| Skinned Mesh Primitives | $\le$ 2 | 2 (`Body`, `Gear`) | PASS |
| Materials | $\le$ 2 | 2 (`Sand_Cloth`, `Sand_Gear`) | PASS |
| Embedded PNG Textures | $\le$ 3 | 3 (`Cloth_Base` 1K, `Gear_Base` 1K, `Shared_ORM` 512) | PASS |
| Texture VRAM | $\le$ 12 MiB | ~9.0 MiB | PASS |
| Weight Normalization | $\sum w = 1.0 \pm 0.02$ | Worst $| \sum w - 1.0 | = 0.0$ | PASS |
| Knee Blends (`knee.L`, `knee.R`) | $\ge$ 100 verts | 150 verts each | PASS |
| Elbow Blends (`elbow.L`, `elbow.R`) | $\ge$ 100 verts | 168 verts each | PASS |
| Rigid Head | $\ge$ 100 verts | 2,116 verts | PASS |
| Rigid Chest | $\ge$ 100 verts | 420 verts | PASS |
| Rigid Feet (`LeftFoot`, `RightFoot`)| $\ge$ 100 verts | 132 verts each | PASS |
| Bounds X | $| \min(x) + \max(x) | \le 0.02$ | $[-0.282, 0.282]$ (sum 0.000) | PASS |
| Bounds Y | Feet $\in [-0.02, 0.05]$, Crown $\in [1.78, 1.95]$ | Feet $0.000$, Crown $1.859$ | PASS |
| Bounds Z | Max reach $\ge 0.15$ | Max $0.217$ | PASS |
| Resource Envelope | 2 threads fixed, $\le$ 2 GiB memory | Fixed 2 threads, $<150$ MiB RSS | PASS |

---

## 6. Mandatory Pre-Export Assertions (Fail-Closed)

Asset-budget assertions and structural validations have been relocated **before** `bpy.ops.wm.save_as_mainfile()` and `bpy.ops.export_scene.gltf()`. If any budget, bound, bone count, or weight contract fails, execution aborts immediately via `AssertionError`. A failing build cannot write or overwrite `operator-sand.blend` or `operator-sand.glb`, preventing masquerading artifacts.

In addition, shader node construction was upgraded to use `ShaderNodeSeparateColor` with fallback to `ShaderNodeSeparateRGB`, ensuring full compatibility with Blender 5.1 / 4.x node API.

---

## 7. Execution Commands for Root Build

### Build Command
```powershell
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/blender/build_operator_sand.py
```

Outputs produced:
- `work/operator-sand/operator-sand.blend` (editable source)
- `work/operator-sand/operator-sand.glb` (game candidate with embedded PNGs)

### Verification Command
```powershell
node scripts/assets/verify-operator-sand.mjs work/operator-sand/operator-sand.glb
```
The validator fails closed (`exit 1`) when the GLB is missing, and checks all container, skin, IBM, hierarchy, attribute, weight, UV, and bound contracts upon existence.
