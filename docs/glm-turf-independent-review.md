# GLM turf independent review

Review target: `C:\Users\david\Desktop\stuff\worktrees\nuketown-glm-turf-20260919`
Worker HEAD: `fb7151498ac8e826e3c1066484219420c3c7a8bc`
Source SHA-256: `072973a540d7fd8eaf17f0226d380840b9b1b5109ee1bd0f2fa0a614618252d4`

## Verdict: CPU PASS; root integration requirements resolved

The generated maps are coherent and inexpensive enough for the intended one-time
material build. The root wiring resolves the explicit `flipY` parity choice and
routes disposal through `disposeTurfTextures()` so the module cache cannot hand
out disposed textures on a later material-library rebuild.

## Checks run

The source was bundled with installed esbuild and exercised in Node without a
browser, renderer, GPU, server, or application build. The CPU checks returned:

```text
range:albedo-green-dominant       PASS  mean rgb (92.5, 123.1, 62.3)
range:albedo-no-black-no-clip     PASS  channel min 47, max 150
range:roughness-bounds            PASS  min 0.867, max 1.000, mean 0.939
roughness-green-channel-carries   PASS  all four channels identical
range:normal-unit-and-modest      PASS  max |len-1| 0.0051, max slope 0.355, mean z 0.9804
seam:albedo                       PASS  H 0.34 / V 0.04 vs interior 0.90
seam:roughness                    PASS  H 0.77 / V 0.05 vs interior 1.08
seam:normal                       PASS  H 5.30 / V 5.87 vs interior 4.97
determinism:byte-identical        PASS  regenerated 1536 KiB identical
```

An independent per-texel scan found all `262144/262144` albedo texels satisfy
`G > R > B`, with zero black, clipped, or non-opaque texels. Roughness channels
and alpha are identical, with byte range `221..255`; normal alpha is opaque, max
length error is `0.005108`, and max decoded XY slope is `0.355330`.

The produced texture properties are:

| map | size | color space | flipY | repeat | filters | anisotropy |
| --- | --- | --- | --- | --- | --- | ---: |
| lawnTex | 512² RGBA8 | sRGB | true | 48×48 | linear / trilinear mip | 8 |
| lawnRough | 256² RGBA8 | NoColorSpace | true | 48×48 | linear / trilinear mip | 4 |
| lawnNormal | 256² RGBA8 | NoColorSpace | true | 48×48 | linear / trilinear mip | 4 |

The byte/range/cache transcript above is the recorded worker CPU run. The table
is the current root integration metadata: repeat 48 matches `UV_LAWN=96` and
`flipY=true` preserves the former CanvasTexture upload orientation. These metadata
changes do not alter the pure generator bytes; no browser or GPU result is implied.

Cache behavior passed: two `createTurfTextures()` calls return the same set and
the same texture objects. First generation measured `43.65 ms`, cached access
`0.0025 ms`, CPU data `1,572,864` bytes, and the documented full-mip estimate
`2,097,152` bytes. `disposeTurfTextures(set)` dropped the cache; the next factory
call returned a new set. Repeated disposal was harmless in the CPU check.

## Integration result

**1. Vertical orientation is deliberate.** `DataTexture.flipY = true` is set on
all three maps. The old maps were `CanvasTexture` (`flipY=true`), and the installed
WebGPU upload path honors the flag for data uploads, so the replacement preserves
the old vertical convention.

**2. Disposal uses one cache owner.** `materials.ts` keeps the local `turf` set
and registers one `disposeTurfTextures(turf)` disposer. The lawn `wetStd` call
uses `ownMaps=false`, so the same three maps are not separately registered and the
cache is cleared on teardown. The current API remains safe for one owning library
at a time, matching the existing material-library lifecycle.

The range, seam, and determinism functions are pure and are not called by the
factory, so they add no frame work. Root should import only `createTurfTextures`
and `disposeTurfTextures` in production; keep the check exports for a CPU harness or
confirm that the bundler tree-shakes them.

## Scope boundary

Root owns the materials wiring and visual comparison against the lawn baseline.
This review makes no claim about final in-game lighting or appearance, and no
browser/GPU run is claimed here.
