# Operator Sand Anatomy 0845 — Source-Only Visual Repair Handoff

Stage: **Recipe-authored, source-only visual repair 1**.
Lane scope: Strictly `work/operator-anatomy-0845/` (no modifications to root, runtime, or other lanes).
Root serializes the guarded bake and owns visual acceptance.

---

## 1. Files Owned (Only `work/operator-anatomy-0845/`)

- `build_operator_sand_anatomy_0845.py`: New Blender build recipe delivering an authentically anatomical, clothed tactical operator silhouette.
- `check_anatomy_0845.py`: Pure-Python CPU envelope, geometry, skeleton, blend, and radial clearance assertion checker (passes all checks cleanly in < 1s).
- `PROVENANCE.md`: License, originality, and reference tracking documentation.
- `HANDOFF.md`: This handoff document.

---

## 2. Root Bake & Verification Invocation

```powershell
# 1. Run the headless Blender build (2 threads, <2 GiB memory, <180s):
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python work/operator-anatomy-0845/build_operator_sand_anatomy_0845.py

# 2. Verify pure-Python CPU envelope & clearance contracts:
python work/operator-anatomy-0845/check_anatomy_0845.py

# 3. Verify standard structural GLB contract:
node scripts/assets/verify-operator-sand.mjs work/operator-anatomy-0845/operator-sand-anatomy-0845.glb

# 4. Verify decoded PBR texture content contract:
node scripts/assets/verify-operator-sand-texture-content.mjs work/operator-anatomy-0845/operator-sand-anatomy-0845.glb
```

---

## 3. Geometry & Budget Comparison (Pure-Python CPU Verified)

| Metric | Baseline (`0800`) | New Anatomy (`0845`) | Delta / Budget Contract |
|---|---|---|---|
| **Body Triangles** | 10,632 | **11,000** | +368 (+1,048 over 9,952 base; required > +400) |
| **Gear Triangles** | 3,968 | **4,112** | +144 (+468 over 3,644 base; required > +200) |
| **Total Triangles** | 14,600 | **15,112** | In target 14k–19k band (budget [12k, 22k]) |
| **Total Vertices** | 8,342 | **8,628** | Clean geometry expansion |
| **X Extents (Width)** | [-0.2964, 0.2964] | **[-0.2837, 0.2837]** | Symmetrical (max <= 0.31 shoulder cap) |
| **Y Extents (Height)** | [0.0000, 1.8585] | **[0.0000, 1.8585]** | Exact ground contact (y=0.0) & crown height |
| **Z Extents (Depth)** | 0.2440 | **0.2320** | Controlled forward reach (0.15 <= z <= 0.30) |
| **Elbow Blends** | 164 / 164 | **184 / 184** | Exceeds >= 100 threshold |
| **Knee Blends** | 160 / 160 | **531 / 531** | Exceeds >= 100 threshold (includes kneepad/straps) |
| **Rigid Verts** | Head 2116, Chest 480, Feet 140 | **Head 2116, Chest 480, Feet 176** | All >= 100 rigid verts |
| **Knee Strap Clearance** | Intersecting / z-fight (0.0mm) | **+3.8 mm radial proud** | Mathematically guaranteed zero z-fight |
| **Crouch Kneepad Skin** | Rigid `Leg` (detached in crouch) | **`w_knee(side)` blend** | Zero detachment / 0 floating rings in crouch |

---

## 4. Visual & Architectural Upgrades Addressed

### A. Elimination of Cylindrical Toy Mannequin Limbs
- **Arms**:
  - Deltoid cap now flows naturally from the clavicle/acromion down into the bicep/tricep with athletic shoulder width.
  - Bicep (+Z) and Tricep (-Z) have anatomical muscle volume (rx=0.065, rz=0.075), tapering towards the elbow.
  - Posterior olecranon point at the elbow joint (cz=-0.004, y=1.138) with natural fabric bunching above and below.
  - Forearm now exhibits authentic muscular taper: wide proximal brachioradialis/flexor mass (rx=0.054, rz=0.053 at y=1.06) tapering down to a tailored wrist cuff (rx=0.043, rz=0.042).
- **Legs**:
  - Quadriceps S-curve: Anterior thigh (+Z) bulges forward with quad volume (rz_pos=0.105), while vastus lateralis flares laterally on the outer thigh.
  - Gastrocnemius Calf Belly: Trousers now model the iconic teardrop calf muscle in the posterior (-Z) reaching rz_neg=0.086 at y=0.34, tapering down into the Achilles tendon at y=0.22 (rz=0.067).
  - Trouser Blousing: Cloth gathers and blouses outward over the combat boot tops at y=0.155 (rx=0.069, rz=0.077), cinching neatly into the boot collar.

### B. Pelvis Seat & Buttocks Definition
- Replaced the flat vertical tube pelvis with an anatomically contoured trouser seat:
  - Gluteal prominence extends backward (-Z) to z ~ -0.124 at y=0.985–1.015.
  - Midline gluteal crease (`glute_crease=True`) indents the medial seam, giving the rear silhouette two distinct, clothed trouser cheeks matching the production turnaround reference.

### C. Kneepad Fixes: Zero Z-Fight & Zero Crouch Detachment
- **Z-Fighting / Jagged Rim Seams**:
  - Straps are now mathematically offset proud (+6mm) from the underlying trouser rings across all 360 degrees.
  - Pure-Python radial clearance test proves min clearance is **3.8 mm** (exceeding the 3.0 mm bar everywhere), preventing rasterizer depth collisions.
- **Crouch / Bent-Pose Detachment**:
  - In `0800`, kneepads and upper straps were rigidly bound to `Leg`, causing the upper strap at y=0.51 to swing backwards into empty air when the character kneeled in crouch.
  - Both kneepad cups and retention straps now use `w_knee(side)` joint-blend weighting. Upper straps receive ~85% `UpLeg` weight, staying glued to the thigh; lower straps receive ~95% `Leg` weight, staying glued to the calf; the cup articulates smoothly across the patella.

### D. Tactical Gloves & Curled Hand Silhouette
- Palm body contoured with thicker thenar muscle mass on the thumb side.
- Curved dorsal knuckle armor plate across the metacarpophalangeal joints.
- 4 articulated fingers in tactical ready-carry curve with progressive stagger curling naturally around the weapon stock/grip.
- Opposed thumb with thenar base mass angled into tactical grip.
- Gauntlet wrist cuff cleanly overlapping the sleeve cuff.

### E. Combat Boots & Lugged Soles
- Boot shaft tailored around ankle malleoli.
- Sloping instep lace throat wedge connecting ankle to forefoot.
- Rounded composite tactical toecap (curved forward contour, not a flat cube).
- Rounded heel counter wrapping the calcaneus.
- Outsole perimeter welt and lugged heel and forefoot tread blocks (ground plane contact exactly y=0.0000).

### F. Plate Carrier & Equipment
- Shooter's cut front plate providing arm mobility and clean weapon weld.
- Snug back plate carrying tactical radio with whip antenna.
- Padded shoulder straps conforming to the trapezius slope.
- 3 Mag pouches with protective flap lids, admin pouch, and duty belt with utility pouches.

---

## 5. Non-Weakened Assertion Contracts

- All 28 checks in `check_anatomy_0845.py` pass cleanly.
- Triangle budget: 15,112 triangles (comfortably inside the 14k–19k shape band and 12k–22k hard budget).
- Exactly 21 bones, matching `src/characters/skeleton.ts` names and rest offsets.
- Exactly 2 skinned primitives, 2 materials, and 3 embedded PNG textures.
- Texture lifecycle contract (`img.update()` + `img.pack()`) strictly preserved.
- No modifications made outside `work/operator-anatomy-0845/`.
