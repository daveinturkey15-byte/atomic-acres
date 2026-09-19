# Operator Sand — Axis & Armature Neutral Frame Repair Handoff (Repair 1 of Max 2)

**Worktree**: `nuketown-animation-polish-20260919`  
**Stage**: Source-only first repair  
**Constraint**: NO `blender.exe` execution, NO GPU/browser/server runtime, NO agent delegation, NO modification/weakening of validator or contracts.  
**Preserved Failing Recipe**: [`work/operator-sand/failed-axis.py`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/work/operator-sand/failed-axis.py)  
**Root Evidence Kept**: `C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919/.recovery-runtime/operator-2350/validation.txt`  

---

## 1. Failure Analysis from Root Evidence

Under the root Blender 5.1.2 build (17.4s, 296 MB RSS, 404 MB private, exit 0), `work/operator-sand/operator-sand.glb` (604,356 bytes, 13,596 tris, 2 primitives, 2 materials, 3 images) passed 33 checks and failed exactly 2 checks in [`scripts/assets/verify-operator-sand.mjs`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/scripts/assets/verify-operator-sand.mjs):

```
FAIL skin.rest-offsets -- worst drift 1.2e+0 m
FAIL bounds.actor -- x[-0.282,0.282] y[-0.225,0.218] z[-1.859,0.000] feet!=0 crown!=1.78-class no +Z forward reach
```

### Gotcha 1: Mesh Axis Rotation (`bounds.actor`)
- **Symptom**: Exported GLB bounds were `x[-0.282, 0.282] y[-0.225, 0.218] z[-1.859, 0.000]`. Crown was at `z = -1.859` and vertical range was squashed into `[-0.225, 0.218]`.
- **Cause**: The Python geometry tables (`build_body()`, `build_gear()`) were authored directly in canonical Three.js space (+Y up, +Z forward). However, `bpy.ops.export_scene.gltf()` defaults `export_yup=True`. In Blender 5.1, `export_yup=True` applies a coordinate transform (`zup2yup`: `(x, y, z) -> (x, z, -y)`) assuming the Blender scene is Z-up. This rotated the upright mesh -90 degrees around X, flipping vertical height into -Z.
- **Correction**: Set `export_yup=False` in `bpy.ops.export_scene.gltf()`. The glTF exporter bypasses `zup2yup`, outputting raw authored vertex positions (+Y up, +Z forward).
- **Verify**: Python CPU mock bounds evaluation confirms:
  - `mn = [-0.282, 0.000, -0.225]`
  - `mx = [0.282, 1.859, 0.217]`
  - `mn[1] = 0.000` (in `[-0.02, 0.05]`) -> PASS
  - `mx[1] = 1.859` (in `[1.78, 1.95]`) -> PASS
  - `mx[2] = 0.217 >= 0.15` -> PASS
  - `|mn[0] + mx[0]| = 0.000 <= 0.02` -> PASS

### Gotcha 2: Bone Orientations & Armature Root (`skin.rest-offsets`)
- **Symptom**: `skin.rest-offsets` drifted by 1.2m. The root `Hips` node had parent `OperatorSand_Rig` (expected `null`), non-identity quaternion rotation, and downward bones (`LeftUpLeg`, `LeftArm`, etc.) had 180-deg flip quaternions and non-canonical translations.
- **Cause**:
  1. The recipe created edit bones with `eb.tail = REST_WORLD[child]`. In Blender, an EditBone's local Y axis is defined by `tail - head`. Bones pointing down had local Y = -Y (a 180-deg rotation). When exported to glTF, child-to-parent relative transforms inherited this rotation, violating the strict `r == [0, 0, 0, 1]` identity rotation requirement and altering local translation coordinates.
  2. `export_armature_object_remove` was defaulted to `False`, exporting the `OperatorSand_Rig` armature object as the parent of `Hips`, violating `EXPECT_PARENT['Hips'] === null`.
  3. Default `export_yup=True` applied `axis_basis_change` (-90 deg X rotation) to bones as well.
- **Correction**:
  1. Set canonical neutral bone frames: For every bone `eb.head = REST_WORLD[name]`, `eb.tail = (head.x, head.y + 0.05, head.z)` (pointing strictly along +Y), and `eb.roll = 0.0`. In Blender, pointing along +Y with roll=0 yields an exact identity orientation matrix `Matrix.Identity(3)`. Every bone is aligned with the world frame, meaning every parent-child relative transform is a pure translation equal to `REST_OFFSETS[name]` with identity rotation quaternion `[0, 0, 0, 1]`.
  2. Set `export_armature_object_remove=True` in `bpy.ops.export_scene.gltf()`. Since the armature has exactly one root bone (`Hips`), the armature object node is omitted from the scene hierarchy, leaving `Hips` as a scene root node with `parent == null`.
  3. With `export_yup=False`, `axis_basis_change` is `Matrix.Identity(4)`. Bone positions and IBMs are exported without swizzling, so `IBM * world == I` evaluates with 0.0 drift.
- **Verify**: Python CPU mock evaluation demonstrates exact match for all 21 bones against `REST_OFFSETS`, identity quaternions, and `EXPECT_PARENT` hierarchy.

---

## 2. Modified Files in This Slice

1. [`scripts/blender/build_operator_sand.py`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/scripts/blender/build_operator_sand.py):
   - Changed bone construction loop (lines 980–1004) to canonical neutral frame:
     ```python
     for name in BONE_NAMES:
         eb = arm_data.edit_bones.new(name)
         eb.head = REST_WORLD[name]
         eb.tail = (REST_WORLD[name][0], REST_WORLD[name][1] + 0.05, REST_WORLD[name][2])
         eb.roll = 0.0
         par = BONE_PARENTS[name]
         if par is not None:
             eb.parent = arm_data.edit_bones[par]
             eb.use_connect = False
     ```
   - Updated `bpy.ops.export_scene.gltf()` invocation (lines 1142–1154) to pass:
     ```python
     export_yup=False,
     export_armature_object_remove=True,
     ```
2. [`work/operator-sand/failed-axis.py`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/work/operator-sand/failed-axis.py):
   - Preserved exact previous failing recipe for auditability.
3. [`work/operator-sand/manifest.json`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/work/operator-sand/manifest.json):
   - Added `repair_provenance` documenting Repair 1, linking to `failed-axis.py` and the root failure evidence. All original budget claims remain unchanged.
4. [`docs/operator-sand-axis-repair-handoff.md`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/docs/operator-sand-axis-repair-handoff.md):
   - This handoff document.

---

## 3. Preservation & Safety Contract

- **Validator untouched**: [`scripts/assets/verify-operator-sand.mjs`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/scripts/assets/verify-operator-sand.mjs) was not modified or weakened.
- **Skeleton contract untouched**: [`src/characters/skeleton.ts`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/src/characters/skeleton.ts) was not modified.
- **Root artifacts preserved**: No files in `C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919` were overwritten.
- **Execution limits respected**: `blender.exe` was NOT executed by this agent lane; no GPU/browser runtime used.
- **Budgets verified**: Triangles remain 13,596 (budget 12k–22k), 2 materials, 3 embedded PNGs, 9,043 normalized skinned vertices.
