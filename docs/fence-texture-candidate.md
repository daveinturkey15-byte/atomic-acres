ROOT FOLLOW-UP: this is the original intake record. Runtime I1 and I2 UV proposals were visually rejected. The accepted J mapping uses the measured single-plank crops and uniform art scale documented in docs/fence-uv-canary.md. Provider JPEG bytes and provenance remain unchanged.

# Fence texture candidate â€” Poly Haven `wooden_planks` (1k JPEG, CC0)

Lane: fence-texture intake, 2026-09-19. Importer: `scripts/assets/import-fence-texture.py`
(deterministic, idempotent: provider metadata cached in `work/fence-texture/`, md5-guarded
files, 2 attempts max per file, no map transforms, no wall-clock fields in the manifest).
Verification manifest: `docs/assets/wooden-planks/manifest.json` (byte-stable across re-runs,
md5 `172df1e145f026b152ddae1f91620564`). Re-run proven offline + byte-identical.

## Imported files (verified)

| file | bytes | md5 | verified |
|---|---|---|---|
| `public/assets/wooden-planks/wooden_planks_diff_1k.jpg` | 489,587 | `045a70f787fcb4b60ee5c9878a9bd674` | JPEG 1024x1024, provider md5+size match, sRGB |
| `public/assets/wooden-planks/wooden_planks_nor_gl_1k.jpg` | 705,118 | `03206d820a026239db91a1ff3d8c589d` | JPEG 1024x1024, OpenGL Y+, linear |
| `public/assets/wooden-planks/wooden_planks_rough_1k.jpg` | 233,217 | `006e1ad8b5a59e783c25b3b36c3a9e9b` | JPEG 1024x1024, linear |

Total 1,427,922 B (budget <= 3,000,000 B). Bytes untouched from provider.

## Provenance

- Asset: https://polyhaven.com/a/wooden_planks â€” "Wooden Planks", 2 m x 2 m surface
  (info API `dimensions: [2000, 2000]` mm), published 2022-08.
- Authors: Charlotte Baglioni (Photography), Dario Barresi (Processing).
- License: CC0 1.0 â€” https://polyhaven.com/license ("all assets ... licensed as CC0").
- API: https://api.polyhaven.com/files/wooden_planks (snapshot cached at
  `docs/assets/wooden-planks/api-files.json`; `apiFilesHash 3bd84dff0e4cc93dd451fa92de3ddaa553a80e3e`).

## Measured texture facts (from the imported files, not filenames)

- Albedo mean `#7e6650` sRGB (linear 0.207/0.132/0.081, R/B = 2.6). Current `PAL.timber`
  `0xb0763f` is linear R/B 8.7, saturation proxy 0.89 vs photo 0.62 â€” the photo is far
  less orange; neutral tint will visibly de-saturate the fences.
- Luminance flat: mean 0.41, p10-p90 0.36-0.46 (even, matte, weathered).
- Planks run HORIZONTALLY in the file (gradient-energy ratio 3.64). Seam pitch is
  irregular: FFT dominant 34.1 px (30/tile = 6.7 cm), direct seam-count median 51 px
  (10.0 cm). Call it 7-10 cm plank heights.
- End joints (vertical seams) sparse and irregular: 12 strong seams across the tile, no
  stable period â€” they will read as occasional natural joints.
- Roughness near-uniform matte: mean 0.70, std 0.009 (p10-p90 0.690-0.710). Current
  procedural timber base is 0.80 â€” the photo path is slightly glossier but in family.

## Current fence UV quantification (from code, measured)

Fence = `yards.ts` `fence()`: 5 stacked course boxes of 0.25 m (pitch 0.27 m = 0.25 + 0.02
real gap), ONE box per course spanning the whole run; `mat.timber` (materials.ts:814)
carries canvas `boardTex` (256 px, 8 vertical seam lines/tile) at isotropic repeat 4.
Box faces are 0-1 UVs, and `upgrade()`/`loadExternalSurfaceSet()` hardcode an ISOTROPIC
`texture.repeat.set(r, r)` (material-surfaces.ts) â€” no rotation, no per-axis, no UV bake.

Consequences for any square photo tile on a course's long face (u = run length, v = 0.25 m):

| run | length | face aspect | anisotropic squash at any repeat r |
|---|---|---|---|
| back runs | 29.6 m | 118:1 | 118:1 vertical squeeze |
| side returns | ~22.6 m | 90:1 | 90:1 |
| cul-de-sac boundary | 84 m | 336:1 | 336:1 |

The procedural texture survives this only because it draws vertical lines exclusively â€”
a photograph cannot. Also, today's faked vertical joints sit at `len/32` (0.93 m back
runs, 0.71 m returns, 2.63 m on the boundary run â€” drift with length, non-physical).

## Seam-conflict verdict (the specific question)

The photo's plank pitch (6.7-10 cm) does NOT match the real course geometry (0.25 m
boards, 0.27 m pitch). Used as a whole-face texture at physical 1:1, the fence would read
as 7-10 cm slats â€” a different object than the BO2 reference's ~0.25 m stacked boards â€”
and the photo seams inside each real board would fight the real 0.02 m course gaps as a
double rhythm. Used through the existing `upgrade()` isotropic-repeat path, it is squashed
90-336:1 into horizontal streaks. **As a zero-code A/B: NOT suitable. Reject.**

Suitable ONLY as per-board cladding with builder-side UV work:

1. A dedicated `fenceBoard` material singleton â€” never `upgrade(lib.timber, ...)`;
   `mat.timber` is shared (crates yards.ts:689/893, planter :920, sandbox :758, dice :962)
   and would spill the photo onto all of them.
2. Bake world-scale UVs in the `fence()` course boxes: u = physical 1:1 (1 tile = 2 m of
   run, `repeat (1,1)`), v magnified x3.75 (0.25 m board face = ONE photo plank; ratio
   2.5-3.75 given the irregular 7-10 cm pitch). Residual texel anisotropy ~3.75:1, ~270 px
   across each board face â€” acceptable at fence view distances (>= 5 m).
3. Per-course v offset `v0 = fract(y_course / (2 m * 3.75)) * plankPitch` (deterministic
   from layout values) so each face samples a plank interior and photo seams never cross a
   board. No rotation needed (planks already run along the fence).
4. Neutral tint: keep `material.color` at its 0xffffff default â€” `std()`/`upgrade()` never
   touch color. Do NOT tint toward `PAL.timber`: the albedo is already warm (R/B 2.6) and
   tinting would double-warm it.
5. Channels: diffuse sRGB, rough/normal NoColorSpace, `normalScale` 0.7 like the sibling
   board sets; roughness map's 0.70 replaces the 0.80 procedural base (slightly glossier).

The photo's irregular end joints replace today's drifting `len/32` fakes with
non-periodic, physical ones â€” an improvement on all three run lengths if (1)-(3) land.

## OPEN (root owns)

- In-game review via `playcap`/`capture` stations at the back-fence and spawn views; this
  lane captured nothing by design. A file existing is not visual acceptance.
- Placement convention: lane grant put files under `public/assets/wooden-planks/`; the
  repo's existing convention is `public/textures/polyhaven/<id>/{diffuse,normal,rough}.jpg`
  + an entry in `public/textures/polyhaven/manifest.json` (root-owned). Relocate/rename at
  merge if consistency is wanted; the manifest carries channel + current path per file.
- 2k variants total ~6.0 MB â€” outside this lane's 3 MB budget; only worth revisiting if
  the x3.75 v magnification reads soft in-game.
- Decision needed: spend the UV-bake work for the fence family, or keep the procedural
  boards and leave this import unused (it is inert until wired).
