# Facade detail canary — orange + white houses

Lane: glm facade canary, 2026-09-19, 25-minute bounded run.
Owned NEW paths (only these three files are written; no root source touched, no commit):

- `src/build/facade-detail-canary.ts` — the additive builder
- `scripts/assets/verify-facade-detail-canary.mjs` — CPU-only proof
- `docs/facade-detail-canary.md` — this record

## STATUS: complete (CPU proof PASS, tsc clean; visual acceptance deliberately OPEN)

## What the root builders actually lack (read, not guessed)

Read in full or in targeted ranges: `orange-house.ts` (1042 ln), `white-house.ts`
(1233 ln), `core/layout.ts`, `core/materials.ts`, `core/kit.ts`, `core/palette.ts`.

| gap | orange | white |
|---|---|---|
| roof fascia / drip edge | NONE — the swept roof is an `extrude()` of `ROOF_T=0.32`; street/yard/end edges are raw slab edges. Only the porch canopy has a fascia lip (o-h.ts:1048). | PARTIAL — capsule roofs end in bare `prism()` rims (0.16/0.14 thick); windows carry head drips but the roof rims do not. |
| base / foundation transition | NONE — ground walls meet the lawn plateau raw (`KERB_HEIGHT` appears only as `DECK_T`/`G_FLOOR`). | HAS a rubble skirt (w-h.ts:1174–1191) — not re-done. |
| recessed vent / louvre | NONE. | ONE (rooftop plant drum, w-h.ts:399). |

## What the canary adds (both houses)

1. **Orange roof fascia + drip**: 40 fascia boards (16 street eave + 16 yard eave +
   2×4 end returns) sheared to the local sweep slope and the constant `TILT_K` fall,
   covering the raw slab edge proud by ~50 mm top and bottom; a steel drip strip under
   each board. Material: existing `mat.roofWhite` / `mat.steel`.
2. **Orange base plinth**: concrete skirt band, y 0→0.50, proud 50 mm, on yard face,
   both ends, garage street/yard/end faces — broken at the front door, back door and
   both garage bay mouths. Material: existing `mat.concrete`.
3. **Orange recessed louvres**: 2 above the garage bays (y≈2.95, in the 1.35 m apron
   between bay head 2.30 and garage top 3.65) + 2 in the upper GE-end spandrel
   (BAND_HEAD 5.56 → eave ≈6.13). Dark recess box 0.12 deep into a 0.25–0.28 wall +
   5 tilted steel slats each. `mat.windowDark` / `mat.steel`.
4. **White roof fascia rings**: one ring of boxes around the REAR capsule roof prism
   (top 6.36) and the FRONT capsule roof prism (top 4.45), proud of the shell face,
   covering the raw prism edge/wall-top junction. `mat.capsuleWhite`.
5. **White recessed louvres**: 2 above the garage bays + 2 on the FRONT capsule flat
   street face (x∈[−2.56,1.02] is the only straight stretch; y=3.85 clears the entry
   canopy top 3.35 and G_HEAD 2.46). Same recess+slat construction.

## Constraints honoured (asserted by the verifier)

- 8 added draws (InstancedMesh, one per material per feature) ≤ 12.
- 184 boxes = 2208 added triangles ≤ 12000 (meshes: fascia 40, drip 32, plinth 8,
  orange vents 4 + slats 16, white rings 62, white vents 4 + slats 18).
- Zero colliders returned; zero lights; zero `new THREE.Material*` — only `ctx.mat`
  singletons (`roofWhite`, `capsuleWhite`, `steel`, `windowDark`, `concrete`); no
  `ctx.rand()` (fully deterministic constants); doors, windows, transparency
  untouched; plinth runs break across the FULL `DOOR_APRON_HALF_W` (1.35 m) of every
  door and bay mouth, and runs under 0.4 m are dropped rather than left as slivers.
- Deterministic placement bounds are asserted as world AABBs inside the house
  envelopes; door aprons (`DOOR_APRON_HALF_W`/`DEPTH`) asserted clear.

## Proof (CPU only — no browser, no server, no GPU)

`node scripts/assets/verify-facade-detail-canary.mjs` esbuild-bundles the canary
against root `node_modules` (read-only use), instantiates it with a material stub
(`core/materials.ts` needs a DOM canvas, which a CPU run must not require), and checks:
draw count, triangle count, empty colliders, material identity (every instance's
material is one of the five stub singletons — no new material), determinism (two
builds, byte-equal instance matrices), world bounds per house, door-apron and
bay-mouth clearance, vent height clearances, recess depth < wall thickness.
Result: see `## Proof result` below (filled after the run).

## Minimal root integration patch (NOT applied)

In `src/main.ts` (root lines 27–28 import, 45–46 registry):

```ts
import { buildFacadeDetailCanary } from './build/facade-detail-canary';
// registry, after 'white-house':
  ['facade-detail-canary', buildFacadeDetailCanary],
```

The builder imports ONLY `three`, `../core/layout` and types from `../core/kit` —
no builder-to-builder imports, per the module contract. Remove the entry to revert.

## Comparison (kept open, per brief)

Held `docs/reference/refinement-targets/yard-white.png` beside the design: the white
capsule's roof rim reads as a crisp pale band with a shadow gap under it — the fascia
ring reproduces that edge condition with `capsuleWhite`; its ground meeting is already
served by the existing rubble skirt (not duplicated). Concept folders under
`C:/Users/david/Desktop/stuff/nuketown/docs/reference/concept{,2}` were not re-opened
inside the timebox; the fascia/vent targets come from the root frames named above.
No visual (GPU) acceptance is claimed — this is a CPU geometry/material proof plus an
integration patch; the real bar stays `playcap` + `capture` + a fresh critic in root.

## Proof result

`node scripts/assets/verify-facade-detail-canary.mjs` (2026-09-19, node v24.12.0,
root tree):

```json
{ "draws": 8, "instances": 184, "triangles": 2208, "colliders": 0, "deterministic": true }
```

`VERIFY-FACADE-DETAIL-CANARY: PASS`; `tsc --noEmit --strict` on the canary: clean
(three ^0.180.0 types). The proof is not vacuous — its first run FAILED and caught
three real defects, each fixed at the source, never in the checker:

1. verifier AABB extraction read matrix rows as dims (checker bug) — rewritten to the
   scaled-column form `half = Σ_j |e[4j+row]| / 2`;
2. plinth runs cut at ±0.78 m of door centres still stood inside the ±1.35 m
   keep-clear aprons — cuts widened to `DOOR_APRON_HALF_W`;
3. two 0.32 m jamb slivers survived the wider cuts (one brushing an apron at the last
   ulp) — sub-0.4 m runs are now dropped by design.

## Not claimed

- No GPU/browser run was made (per brief). The fascia/slat silhouette, shadow-line
  value and vent readability are UNVERIFIED against pixels; the real gate stays
  root `playcap` + `capture` + a fresh critic per `docs/night/VISUAL-BAR.md`.
- `painted()` materials were deliberately avoided (a new colour key would add a
  program); the white house's existing rubble skirt is left alone.
