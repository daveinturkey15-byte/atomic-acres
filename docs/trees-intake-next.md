# Root review: tree intake is metadata only

VERIFIED: the cached Searsia glTF descriptor declares variant triangle counts
361,558 / 210,262 / 44,516. Its leaves and twigs use BLEND, and its wood is
opaque. The three source material definitions and their texture references need
an exact equivalence review before any proposed consolidation.

OPEN: the worker's RAM numbers, decimation-quality claims, future GLB size,
and all conversion-budget PASS labels below are estimates, not measurements.
Root does not accept them as passed gates. BLEND-to-MASK would be a deliberate
visual change requiring transparent-edge review. No mesh binary or maps were
downloaded, converted, installed or rendered by this intake.

VERIFIED: 302,220 bytes of local metadata including its generated manifest.
Official license was checked at https://polyhaven.com/license on September19.
The next canary must run a bounded CPU conversion with actual peak-memory
monitoring, retain its native dimensions, and be inspected in the game before
promotion. The current tree remains live until that canary passes.

The AGY run requested gemini-3.8-flash-high/high. Its process completed and
returned this document; actual serving-model attribution was not returned.
The original research follows as attributed worker claims, with source metadata
preserved in docs/assets/tree-intake-next/.

---

# Next Realistic Yard Trees: Candidate Feasibility & Intake Review

Date: 2026-09-19  
Harness: Antigravity (CPU/network metadata research lane)  
Workspace: `C:/Users/david/Desktop/stuff/worktrees/nuketown-agy-desert-tree-20260919`  
Metadata Cache: `docs/assets/tree-intake-next/` (13 metadata files, 296,638 bytes total <= 5 MB cap)

---

## 1. Context & Scope

- **Problem**: The standalone Nuketown yard retains visibly primitive spherical/topiary tree crowns with floating leaf clusters.
- **Root Priority**: Root is addressing orange-house draw call reductions first. This research lane evaluates obtainable mature canopy replacements before any conversion pass is scheduled.
- **Quiver Tree 02 Status**: Quiver Tree 02 (37,500 triangles, 1.47 m tall) is accepted specifically as two small desert succulent plants. It is explicitly not a mature canopy replacement.
- **Target Map Aesthetic**: Southwestern suburban residential yard: small branching deciduous tree or realistic arid/desert ornamental canopy approximately **4–7 m tall** (not giant conifers/pines or dense tropical jungle).
- **Constraints Enforced**:
  - Metadata inspection only (zero `.bin` downloads, zero texture downloads, zero GPU/rendering, zero runtime changes).
  - Whole final single tree target budget: `<= 60,000` triangles, `<= 2` material slots, `<= 3x 1k` maps, and `<= 6.0 MB` GLB.
  - Memory limit: Highpoly CPU conversion must be evaluated against a hard `<= 700 MB RAM` ceiling.

---

## 2. Poly Haven Catalog Candidates

Poly Haven was queried directly via its official REST endpoints (`https://api.polyhaven.com/assets?t=models&c=trees` and `&c=plants`). Three concrete candidates matching the suburban/desert canopy criteria were evaluated, plus one lightweight arid shrub fallback.

### Candidate 1: Searsia Burchellii (`searsia_burchellii`) — RANK 1 (Recommended Canary)

- **Primary Records**:
  - Asset Page: [polyhaven.com/a/searsia_burchellii](https://polyhaven.com/a/searsia_burchellii)
  - Metadata API: [api.polyhaven.com/info/searsia_burchellii](https://api.polyhaven.com/info/searsia_burchellii)
  - File Manifest API: [api.polyhaven.com/files/searsia_burchellii](https://api.polyhaven.com/files/searsia_burchellii)
  - License: [CC0 1.0 Universal](https://polyhaven.com/license) (Public Domain Dedication)
- **Attribution**:
  - 3D asset authors: `James Ray Cock` (modeling) and `Jenelle van Heerden` (photography).
- **Morphology & Setting Fit**:
  - Arid/desert woody ornamental canopy shrub-tree (Karoo kunibush, South African Namaqualand desert collection).
  - Spreading, intricate branching structure with realistic arid foliage clusters. Excellent aesthetic fit for southwestern suburban xeriscaping or arid residential yards.
- **Dimensions & Bounding Box (glTF Y-Up)**:
  - Info API published dimensions: `[8356.37, 5062.77, 3246.98]` mm.
  - The model file contains three distinct tree/shrub size variants:
    - **Variant 0 (`Cube.014`, Large Canopy)**: Width 4.16 m (X: `[-1.77, +2.38]`), Depth 5.05 m (Z: `[-2.30, +2.75]`), **Height 3.24 m** (Y: `[-0.03, +3.21]`).
    - **Variant 1 (`Cube.015`, Medium)**: Width 3.58 m, Depth 2.61 m, **Height 2.59 m** (Y: `[-0.03, +2.56]`).
    - **Variant 2 (`Cube.016`, Compact)**: Width 1.65 m, Depth 2.27 m, **Height 1.94 m** (Y: `[-0.04, +1.90]`).
  - Height assessment: 3.24 m natural height is slightly below the ideal 4–7 m range, but its 5.05 m horizontal canopy spread delivers substantial yard coverage. Can be scaled 1.25–1.35x if a true 4.0–4.4 m crown height is needed.
- **Triangle Counts**:
  - Info API published polycount: **1,427,042 triangles** (source highpoly scan).
  - Official 1k glTF total across all 3 variants: **616,336 triangles**.
  - **Variant 0 (`Cube.014`)**: **361,558 triangles** (leaves: 123,624; wood: 197,888; twigs: 40,046).
  - **Variant 1 (`Cube.015`)**: **210,262 triangles** (leaves: 75,260; wood: 96,730; twigs: 38,272).
  - **Variant 2 (`Cube.016`)**: **44,516 triangles** (leaves: 13,726; wood: 24,690; twigs: 6,100) — *already below the 60ktri budget without decimation*.
- **Download Variants & Measured Payload**:
  - Formats available: `blend`, `gltf`, `usd`, `fbx`.
  - 1k glTF Package Breakdown:
    - Descriptor `searsia_burchellii_1k.gltf`: 15,079 bytes
    - Binary `searsia_burchellii.bin`: 33,273,876 bytes (~33.27 MB)
    - Texture `textures/searsia_burchellii_diff_1k.jpg`: 421,041 bytes
    - Texture `textures/searsia_burchellii_nor_gl_1k.jpg`: 468,430 bytes
    - Texture `textures/searsia_burchellii_arm_1k.jpg`: 432,403 bytes
    - **Total 1k Package Size**: **34,610,829 bytes (~33.01 MiB)**.
  - Other resolutions: 2k (36.58 MB), 4k (50.64 MB), 8k (103.94 MB).
- **Material Slots & Texture Map Count**:
  - Unique texture maps: **Exactly 3 files** (1 diffuse, 1 normal GL, 1 ARM). Total texture bytes: **1,321,874 bytes (~1.32 MB)**.
  - GLTF materials defined: 3 (`searsia_burchellii_leaves`, `searsia_burchellii`, `searsia_burchellii_twigs`).
  - Consolidation: All three materials share the identical 3 texture maps. Leaves and twigs use alpha blending/testing, while trunk/wood is opaque. Consolidating leaves and twigs into a single alpha-masked material yields **exactly 2 material slots** (Opaque Wood + Alpha Foliage) with **zero texture re-authoring or baking**.
- **Budget Compliance (<=60ktri, <=2 mats, <=3 maps, <=6MB GLB)**:
  - Materials: 2 slots (**PASS**).
  - Texture maps: 3x 1k maps (**PASS**).
  - Triangle budget: Decimating Variant 0 from 361.5k down to 60k (ratio 0.166) or selecting Variant 2 directly (44.5k) (**PASS**).
  - Expected GLB payload: Estimated at **~3.2 to 4.2 MB** (well under 6.0 MB cap — **PASS**).
- **CPU Conversion RAM Feasibility (<= 700 MB RAM)**:
  - **Feasible with single-variant isolation**:
    - The full `.bin` is 33.3 MB. Loading all 3 variations into Blender at once creates 616k triangles and will peak near **550–650 MB RAM**, dangerously close to the 700 MB limit.
    - If the conversion script filters the JSON/mesh buffers to import and decimate *only* `Cube.014` (361.5k triangles) or `Cube.016` (44.5k triangles), peak RAM during decimation stays safely at **~380–450 MB RAM**.

---

### Candidate 2: Tree Small 02 (`tree_small_02`) — RANK 2 (Deciduous Yard Tree, Heavy / Material-Exceeding)

- **Primary Records**:
  - Asset Page: [polyhaven.com/a/tree_small_02](https://polyhaven.com/a/tree_small_02)
  - Metadata API: [api.polyhaven.com/info/tree_small_02](https://api.polyhaven.com/info/tree_small_02)
  - File Manifest API: [api.polyhaven.com/files/tree_small_02](https://api.polyhaven.com/files/tree_small_02)
  - License: [CC0 1.0 Universal](https://polyhaven.com/license)
- **Attribution**:
  - 3D asset authors: `Rico Cilliers` (All).
- **Morphology & Setting Fit**:
  - Classical small branching deciduous garden tree (Burkea africana / wild syringa).
  - Exact aesthetic match for a suburban residential yard tree.
- **Dimensions & Bounding Box (glTF Y-Up)**:
  - Info API published dimensions: `[2921.43, 4292.87, 4649.93]` mm.
  - Single mesh `BezierCurve.002`: Width 2.92 m (X: `[-1.31, +1.61]`), Depth 4.29 m (Z: `[-1.38, +2.91]`), **Height 4.56 m** (Y: `[-0.02, +4.53]`).
  - Height assessment: **4.56 m tall** lands squarely inside the desired 4–7 m canopy window.
- **Triangle Counts**:
  - Info API published polycount: **4,652,585 triangles** (source highpoly scan).
  - Official 1k glTF total: **2,062,487 triangles** (branches: 94,814; leaves: 1,939,380; trunk: 28,293).
- **Download Variants & Measured Payload**:
  - Formats available: `blend`, `fbx`, `gltf`, `usd`.
  - 1k glTF Package Breakdown:
    - Descriptor `tree_small_02_1k.gltf`: 9,075 bytes
    - Binary `tree_small_02.bin`: 95,102,324 bytes (~95.10 MB)
    - Textures: 9 distinct JPEG maps totaling 5,862,744 bytes
    - **Total 1k Package Size**: **100,974,143 bytes (~96.30 MiB)**.
  - Other resolutions: 2k (109.99 MB), 4k (153.45 MB), 8k (281.03 MB).
- **Material Slots & Texture Map Count**:
  - Unique texture maps: **9 distinct texture files** (3 for trunk, 3 for branches, 3 for leaves). Total texture bytes: **5.86 MB**.
  - GLTF materials: **3 separate materials** (`tree_small_02_branches`, `tree_small_02_leaves`, `tree_small_02_trunk`), each with independent UV unwraps.
  - Budget conflict: Exceeds both `<= 2 material slots` and `<= 3x 1k maps`. Consolidating would require re-baking UVs into a combined atlas.
- **Budget Compliance**:
  - Triangles: 2,062,487 triangles require a massive 97.1% decimation to reach 60k.
  - Package bytes: 96.3 MB package download.
  - Resulting GLB: With 9 embedded 1k textures, the GLB payload would reach **~8.5–9.5 MB**, exceeding the 6.0 MB limit.
- **CPU Conversion RAM Feasibility (<= 700 MB RAM)**:
  - **FAILS**: Loading a 95.1 MB `.bin` file with 2.06 million triangles (1.78 million vertices) into Blender constructs huge heap meshes. Evaluating decimation modifiers across 2M triangles typically peaks between **1.5 GB and 2.5 GB RAM**. It is virtually impossible to process on CPU within 700 MB RAM.

---

### Candidate 3: Island Tree 02 (`island_tree_02`) — RANK 3 (Alternative Branching Broadleaf)

- **Primary Records**:
  - Asset Page: [polyhaven.com/a/island_tree_02](https://polyhaven.com/a/island_tree_02)
  - Metadata API: [api.polyhaven.com/info/island_tree_02](https://api.polyhaven.com/info/island_tree_02)
  - File Manifest API: [api.polyhaven.com/files/island_tree_02](https://api.polyhaven.com/files/island_tree_02)
  - License: [CC0 1.0 Universal](https://polyhaven.com/license)
- **Attribution**:
  - 3D asset authors: `Rob Tuytel` (scanning, processing) and `Rico Cilliers` (cleanup, processing).
- **Morphology & Setting Fit**:
  - Branching broadleaf deciduous tree with a curved single trunk and broad canopy.
- **Dimensions & Bounding Box (glTF Y-Up)**:
  - Info API published dimensions: `[8485.51, 4078.62, 3408.90]` mm.
  - Single mesh `mesh.001`: Width 4.21 m (X: `[-2.05, +2.16]`), Depth 4.07 m (Z: `[-1.11, +2.96]`), **Height 3.41 m** (Y: `[-0.02, +3.39]`).
- **Triangle Counts**:
  - Info API published polycount: **1,762,064 triangles**.
  - Official 1k glTF total: **1,072,213 triangles**.
- **Download Variants & Measured Payload**:
  - Formats available: `blend`, `fbx`, `gltf`, `usd`.
  - 1k glTF Package Breakdown:
    - Descriptor `island_tree_02_1k.gltf`: 8,545 bytes
    - Binary `island_tree_02.bin`: 40,686,576 bytes (~40.69 MB)
    - Textures: 9 distinct JPEG maps totaling 5,477,285 bytes
    - **Total 1k Package Size**: **46,172,406 bytes (~44.03 MiB)**.
- **Material Slots & Texture Map Count**:
  - Unique texture maps: **9 distinct texture files** (trunk, leaves, branches).
  - GLTF materials: **3 separate materials** (`island_tree_02`, `island_tree_02_leaves`, `island_tree_02_branches`).
  - Existing repo synergy: Leaf maps share hashes with the Island Tree family textures already present under `public/textures/vegetation/`.
  - Budget conflict: Exceeds `<= 2 material slots` and `<= 3x 1k maps`.
- **CPU Conversion RAM Feasibility (<= 700 MB RAM)**:
  - **UNLIKELY**: 40.7 MB `.bin` and 1.07 million triangles. Decimating 1.07M triangles down to 60k (94.4% reduction) in Blender background mode peaks around **850 MB to 1.1 GB RAM**, exceeding the 700 MB boundary.

---

### Supplemental Candidate: Searsia Lucida (`searsia_lucida`) — (Lightweight Arid Shrub Fallback)

- **Primary Records**: [polyhaven.com/a/searsia_lucida](https://polyhaven.com/a/searsia_lucida), Authors: `James Ray Cock` (modeling), `Jenelle van Heerden` (photography). CC0 1.0.
- **Dimensions**: Largest variant (Mesh 0) is Width 1.81 m, Depth 1.97 m, **Height 2.34 m**.
- **Triangles**: Info API published: **841,648 triangles**. 1k glTF total across 7 variants: **377,192 triangles**. Largest variant (Mesh 0) is **113,405 triangles**.
- **Package & Textures**: Binary is 17.9 MB; package total is 19.8 MB. Uses **exactly 3 shared 1k JPEG maps** (1.87 MB).
- **RAM Feasibility**: **Easily fits <= 700 MB RAM** (peak ~250–320 MB).
- **Limitation**: At 2.34 m tall, it is a dense arid shrub rather than a mature 4–7 m canopy tree.

---

## 3. Candidate Comparison Matrix

| Candidate Asset | Category / Morphology | Height (Y-up) | Published Triangles | 1k glTF Triangles | 1k Package Bytes | Texture Files | Material Slots | RAM <=700MB Feasible? | Final GLB <=6MB? | Rank |
|---|---|---:|---:|---:|---:|---:|---:|:---:|:---:|:---:|
| **Searsia Burchellii** (`searsia_burchellii`) | Arid ornamental canopy tree (Namaqualand) | 3.24 m (Var 0) / 1.94 m (Var 2) | 1,427,042 | 361,558 (Var 0) / 44,516 (Var 2) | 34,610,829 (~33.0 MB) | **3 maps** (shared) | 3 -> **2 slots** (natural) | **YES** (isolated variant) | **YES** (~3.5 MB) | **1** |
| **Tree Small 02** (`tree_small_02`) | Branching deciduous tree (Wild Syringa) | 4.56 m | 4,652,585 | 2,062,487 | 100,974,143 (~96.3 MB) | 9 maps (unique) | 3 slots (unique) | **NO** (~1.5–2.5 GB) | NO (~8.5 MB) | **2** |
| **Island Tree 02** (`island_tree_02`) | Coastal/broadleaf branching tree | 3.41 m | 1,762,064 | 1,072,213 | 46,172,406 (~44.0 MB) | 9 maps (unique) | 3 slots (unique) | **UNLIKELY** (~0.9–1.1 GB) | NO (~7.5 MB) | **3** |
| *Searsia Lucida* (`searsia_lucida`) | Arid glossy currant shrub (fallback) | 2.34 m | 841,648 | 113,405 (Var 0) | 19,816,833 (~18.9 MB) | **3 maps** (shared) | 3 -> **2 slots** (natural) | **YES** (~300 MB) | **YES** (~2.8 MB) | *Sub* |

---

## 4. Canary Selection & Conversion / Visual Acceptance Gates

### Selected Canary: Searsia Burchellii (`searsia_burchellii`)

Searsia Burchellii is selected as the only candidate in the Poly Haven CC0 library that satisfies the strict budget constraints:
1. It shares **exactly 3 texture maps** across all primitives, natively satisfying `<= 3x 1k maps`.
2. It consolidates into **exactly 2 material slots** (1 Opaque bark/wood + 1 Alpha Mask foliage) without requiring UV repacking or baking.
3. Decimating Variant 0 (361.5k tris) or selecting Variant 2 (44.5k tris) yields an estimated GLB of **~3.5 MB**, well below the 6.0 MB limit.
4. Its 33.3 MB source binary can be processed on CPU within the **<= 700 MB RAM** boundary if isolated.

### Precise Conversion Gates (for Future Conversion Script)

1. **Source Variant Isolation Gate**:
   - The conversion script must parse `searsia_burchellii_1k.gltf` and extract **Variant 0 (`Cube.014`)** alone. Discard meshes `Cube.015` and `Cube.016` to avoid multi-tree bloat.
2. **RAM Budget Gate**:
   - Headless conversion command: `blender.exe --background --threads 2 --python ...`
   - Peak RSS must not exceed **700 MB**. If standard glTF importer exceeds 700 MB by loading all meshes, the importer must selectively read only `Cube.014` vertex/index buffers.
3. **Decimation & Topology Gate**:
   - Target: `<= 60,000` triangles total (e.g. ratio `0.165` on Variant 0's 361,558 triangles).
   - Maximum decimation passes allowed: **2 attempts**.
   - Primitives: Exactly 2 primitives (Primitive 0: Wood; Primitive 1: Foliage).
4. **Material & Texture Gate**:
   - Slot 0: `searsia_burchellii_wood` (Opaque, PBR Metallic-Roughness).
   - Slot 1: `searsia_burchellii_foliage` (Alpha Mode `MASK`, cutoff `0.5`, `doubleSided: true`).
   - Embedded textures: Embed the 3 official 1k JPEGs untouched (MD5 matched to API manifest: `diff` `2e19b9...`, `nor_gl` `eea5d6...`, `arm` `adf187...`). Zero re-compression.
5. **Origin & Dimensions Gate**:
   - X and Z centered at `0.0`.
   - Foot clamped at ground level `Y = 0.000 m`.
   - Bounding height preserved at **3.24 m** (or uniformly scaled by a documented multiplier if root requests a taller crown).
6. **Payload Size Gate**:
   - Output GLB file size must be **<= 6,291,456 bytes (6.0 MB)**.

### Visual Acceptance Gates (Runtime Frame Verification by Root)

*No visual photorealism, FPS, or quality claims are made in this research note. Visual acceptance is strictly gated on actual root in-game frame captures:*
1. **Canopy Silhouette Gate**:
   - Root in-game capture from player eye level (Y = 1.65 m) in the front yard.
   - Crown must present a coherent, natural branching silhouette without floating, disconnected leaf planes or jagged polygon slivers.
2. **Direct Sun & Shadow Gate**:
   - Inspection under Nuketown midday directional sunlight.
   - Leaves must cast clean directional shadow-map silhouettes without severe self-shadow moiré or harsh black alpha borders.
3. **Upper-Floor Perspective Gate**:
   - Inspection from the yellow and green house second-story bedroom windows looking down onto the crown.
   - Canopy must retain believable volume and depth rather than flattening into obvious cross-quad billboards.
4. **Draw Call Gate**:
   - Instance rendering must consume at most **2 draw calls** per tree instance (or 1 draw if batched/instanced).

---

## 5. Architectural Honesty Note on the CC0 Tree Catalog

If a true **5–7 m tall branching deciduous tree** (like an oak, birch, or wild syringa) is strictly required rather than a 3.2 m desert canopy shrub-tree:
- The CC0 Poly Haven catalog **does not currently offer an out-of-the-box deciduous tree that meets all three budget conditions** (<=700 MB RAM CPU import, <=2 material slots, <=3 texture maps).
- `tree_small_02` has the exact required morphology and 4.56 m height, but is fundamentally an offline film/archviz asset (95 MB binary, 2.06M triangles, 9 separate texture maps across 3 material slots). It would require an offline high-RAM workstation baking pass to atlas its 9 textures into 1 material before it could enter this lightweight pipeline.
- Therefore, `searsia_burchellii` is the only technically compliant CC0 canary available for automated, low-RAM CPU intake.
