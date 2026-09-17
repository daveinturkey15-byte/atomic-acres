# PLAN — Owner complaint "ensure the layout matches Black Ops 2 from 2012": minimap evidence settlement

Target: **BO2 Nuketown 2025 only.** Frame throughout: **+x right, +z down the page** (SPEC §2). All px figures are estimates with stated uncertainty; nothing below is surveyed to survey grade.

## 1. ASCII plan (current `layout.ts` numbers, metres on key spans)

```
      -x  <==================  STREET AXIS (E-W = map x-axis)  ==================>  +x
 (road stem off-map to plaza)                                          (cul-de-sac head + fence + THIRD HOUSE)

 BOUND_X -54                                                              HEAD_CENTER_X 26.0   BOUND_X +46   THIRD_HOUSE_X 44.5
   |  ROAD_X_MIN -52                                    ROAD_X_MAX 17.0      |<-- dia 19.2 -->|      |                |
   |    |                                                    |               |  HEAD_RADIUS 9.6 |      |                |
 ~~ out of bounds ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~+---------------|------------------+------+-THIRD HOUSE----+
                                                            | THIRD HOUSE drive + red car (beyond fence)             |
 ===== back fence BACK_FENCE 34.0 (holes) ==================|========================================================|
   -z   TEAM A BACK YARD (SPAWN_A -4.0,-31.8)   yard depth 11.2 (34.0-22.8)  |                                        |
        YARD_X -20 .. +20                                                   |                                        |
  +-----------+-------------------------------------------------+---+        |                                        |
  | GARAGE    |  ORANGE HOUSE (-z)              HOUSE_HALF_LEN 9.6|###| rear deck DECK_LEN 7.2 x DECK_OUT 3.4 @ DECK_Y 3.15, RAIL_H 1.05
  | LEN 7.6   |  frontage 19.2 (= 2 x 9.6)      HOUSE_DEPTH 9.2   |   | porch canopy CANOPY_Y 3.35, CANOPY_LEN 6.4 x CANOPY_OUT 2.9
  | DEPTH 8.0 |  HOUSE_BACK 22.8  FLOOR_H 3.15  UPPER_H 3.05      |   | GARAGE_H 3.65, GARAGE_BAYS 3 (contested, kept)
  | BAYS 3    |  EAVE_Y 6.20                                    |   | FENCE_H 2.1 (sibling contract, kept)
  +-----------+-------------------------------------------------+---+
    apron                FRONT_LAWN_OUTER 13.6 (kerb-to-wall 9.0 = 13.6 - 4.6)
 ---------------- kerb KERB 0.15/0.3 / pavement PAVEMENT_OUTER 7.2 (2.6/side) ----------------
                                        [COACH static — NO minimap icon in any f- frame]
  ROAD kerb-to-kerb 9.2 (= 2 x ROAD_HALF_WIDTH 4.6)   EYE_HEIGHT 1.68 (kept)
                                        [TRUCK] [dk saloon] [green classic]
 ---------------- kerb / pavement ----------------
                  [BLUE appliance bank]                 apron
  +---+-------------------------------------------------+-----------+
  |###|  WHITE HOUSE (+z) frontage 19.2   DEPTH 9.2     | GARAGE    |
  |   |  BACK 22.8  FLOOR_H 3.15 / UPPER_H 3.05 / EAVE 6.20 | LEN 7.6 / DEPTH 8.0 / H 3.65 |
  +---+-------------------------------------------------+-----------+
    stair down + rear deck (7.2 x 3.4 @ 3.15)
   +z  TEAM B BACK YARD (SPAWN_B -1.2,+31.2)   yard depth 11.2
 ===== back fence 34.0 (holes) ==============================================================
   BOUND_Z 38 (both sides)     YARD_X -20..+20
```

Key spans (metres, current values): street 9.2 kerb-to-kerb; pavement outer 7.2 half-width (2.6/side); kerb-to-wall 9.0; house frontage 19.2 × depth 9.2; yard depth 11.2; bound width 100 (-54..+46); bound depth 76 (±38); head dia 19.2 @ x=26.0; road x -52..+17.0; spawns A (-4.0,-31.8) / B (-1.2,+31.2).

## 2. What the minimap actually is (premise correction)

The brief's implicit premise — minimap = orthographic schematic of the whole playable area — is **FALSE** on the evidence. All four scouts agree the pane shows **1–2 houses at a time**, never the island:

- Rotating player-centred viewport (G, FKQ agree; AICK dissents — see OPEN-1), square ~1:1 + compass strip (~0.15–0.2H per FKQ).
- Stepped house footprints; house mass ~0.5–0.6 minimap-widths (MW) with 2 infills + lot lines (FKQ).
- House footprint ~1/3 viewport, depth 0.8–1.0× width (G).
- Street renders as a void/corridor line-weight, **not** a surveyed polygon: ~0.15–0.25 MW void (FKQ) or ~8 px corridor 6–12 px (CoachAnchor); house-vs-street ~2–3× (FKQ), ~2.5–3.5× big-house/street (AICK).
- Player arrow + dots occlude the centre; no bulb resolved in any scout; capsule/pill outlines present in BOTH families — `mm-g-1icNQzMgLUM-040.png` diagonal pill top edge ~150+/-50 x 15+/-5px, `mm-g-VfcKHcDJXpM-060.png` horizontal capsule top-centre ~120+/-30 x 20+/-6px, `mm-f-FKQOEO-1ceE-080.png` two horizontal pills stacked north (longest ~130+/-30px) + small vertical east, `mm-f-aICKIbuo8zQ-100.png` vertical pills west-central ~100+/-30px tall + small horizontal SW (all px-estimates, blur-limited) — while the `f-FKQOEO-1ceE-105.jpg` FULL minimap shows no capsule, neither does the `g-1icNQzMgLUM-040.jpg` FULL minimap despite the bus on screen in 3D, so absence = zoomed viewport excluding it (or unresolvable at ~150px pane), NOT a G-vs-F art difference; capsule identity (bus vs planter/wall outline) is OPEN — anomaly OPEN: in the 040 crop the capsule runs ~20-30 deg steeper than the house long edges (non-parallel, +/-10 deg blur noise), which a world-parallel bus would not do.
- Consequence: **no absolute scale, no island aspect, no metre rescale** can come out of this pane. It corroborates relative blocks only, within large uncertainty.

## 3. Scout evidence (exact frames, px-estimates marked, uncertainty honest)

### 3a. MinimapG
- `g-1icNQzMgLUM-040.jpg` FULL-frame minimap = N-centred (N+E strip, clearest full-frame read, medium weight) — independent sample from its crop (see OPEN-8, NEVER one observation): rotating player-centred viewport, square ~1:1 + compass strip; stepped house footprints.
- `mm-g-1icNQzMgLUM-040.png` crop = S-centred diagonal (independent sample, unknown source moment, medium-low weight): diagonal pill top edge ~150+/-50 x 15+/-5px (px-estimate ±30%, viewport-relative; viewport metres unknown so no m/px follows) + round red blip ~8-12px symmetric orange-yellow circle, no elongation, NE of green+yellow triangles — explicitly NOT car-shaped; no red-car marker anywhere.
- House footprint ~1/3 viewport (px-estimate ±25%), depth 0.8–1.0× width (ratio-estimate ±20%).
- House-to-bus gap ~1/6 viewport height (px-estimate ±40%, crop-only, provisional per OPEN-8).
- `g-VfcKHcDJXpM-060.jpg` FULL-frame minimap = S/W strip SSW-SW (full-frame read, medium-low weight) — independent sample from its crop (see OPEN-8, NEVER one observation); `mm-g-VfcKHcDJXpM-060.png` crop = N-centred diagonal (independent sample, unknown source moment, medium-low weight) with horizontal capsule top-centre ~120+/-30 x 20+/-6px + round red blip top-centre ~15-25px with glow (~8-12px core), symmetric — explicitly NOT car-shaped; `g-VfcKHcDJXpM-001.jpg` (N, supporting full-frame): street axis E–W = map x-axis (directional claim, frame-conditional per OPEN-1, medium-low weight).
- `g-1icNQzMgLUM-001.jpg`: black-fade — **REJECT**, not evidence.
- Bulb end + island aspect **UNRESOLVED** (viewport too tight — G's own verdict).

### 3b. MinimapFKQ
- Best crop `mm-f-FKQOEO-1ceE-080.png`; legs `-085` (N legible), `-160` (S legible), `-025` (W + partial N), `-105`/`-135` (tiny, low weight); `-212` scoreboard — **REJECT**.
- Rotating square pane ~1:1 + strip ~0.15–0.2H (panel-geometry estimate ±25%).
- House mass ~0.5–0.6 MW with 2 infills + lot lines (px-estimate ±20%).
- 3 small rounded rects top-right, longest ~0.25–0.30 MW: **bus-vs-shed OPEN** (FKQ's own flag; do NOT anchor scale to these).
- Street void ~0.15–0.25 MW (px-estimate ±30%); house-vs-street ~2–3× (ratio ±25%).
- **NO bulb resolved. NO bus icon in 3D-coach frame -085** (high-confidence absence within pane).

### 3c. MinimapAICK
- `f-aICKIbuo8zQ-100.jpg` FULL frame = S (AICK read, kept, frame-conditional per OPEN-1, medium-low weight) — independent sample from its crop (see OPEN-8, NEVER one observation); `mm-f-aICKIbuo8zQ-100.png` crop letter DISPUTED: AICK read S vs verifier read W-centred (~25-35px glyphs, blurry) — record both, low weight each; crop shows vertical pills west-central ~100+/-30px tall + small horizontal SW (px-estimate, blur-limited) + round red blip left mid-edge, edge-clipped, with glow — explicitly NOT car-shaped.
- `f-aICKIbuo8zQ-030.jpg` FULL frame = W (AICK read, kept, frame-conditional per OPEN-1, low weight) + mm2 crop (independent sample per OPEN-8, low weight); `-105` backup (compass-conflicted, low weight); `-060` Hellstorm — **REJECT**; `-002` spawn-zoom marginal (low weight).
- Claims **FIXED north-up panel** — **DENIED** (see OPEN-1: art angle not constant across crops); rotation SUPPORTED, heading-to-art-angle coupling OPEN.
- Portrait overall w/h ~0.75–0.85 (includes strip; px-estimate ±15%).
- Street/overall width ~1/6–1/5 (px-estimate ±25%); big house/street ~2.5–3.5× (ratio ±25%); narrow-structure/street ~0.4–0.6× (ratio ±30%, structure identity OPEN); SW yard/house depth ~3–4× (ratio ±30% — see §5: different yard, not rear-yard contradiction).
- **NO bulb. NO vehicle glyph in FULL frames cited** (absence within pane, medium-high confidence; crop pills in `mm-f-aICKIbuo8zQ-100.png` / `mm-f-FKQOEO-1ceE-080.png` are recorded separately in §2, identity OPEN — NOT a contradiction).
- Full-frame tiny compass letters conflict between reads — **trust enlarged crops only** (AICK's own caution, adopted); where crop and verifier disagree (100 crop S vs W), record both at low weight.
- Crop provenance caveat: `mm-*.png` timestamps read "just now"; CONFIRMED different-moment for the 040 pair (crop S vs full N) — NEVER cite a full frame and its same-basename crop as one observation; treat every `mm-` crop as an independent sample with unknown source moment until re-cut with recorded rects (see OPEN-8) — all px figures provisional.

### 3d. CoachAnchor (scale-branch adjudication)
- `f-FKQOEO-1ceE-105.jpg` side-profile coach ~840 px, clearest, N/E compass legible; `-135` rear-3/4 supporting; `-150` is a **BLACK SEMI CAB kill-cam, NOT the coach — EXCLUDE from coach math**; confirms bulb-kerb curvature in 3D (shape only, no metres).
- **NO coach/bus icons on ANY f- minimap** (static geometry + triangles only) → direct coach-px anchoring **IMPOSSIBLE**.
- Indirect Branch B (favoured): street corridor ~8 px (range 6–12, ±35%) vs 9.2 m asphalt gives m/px ~1.0 ± 0.35; reproduces HEAD_RADIUS 9.6 (predicts ~17–19 px bulb, hidden under blur + icons — consistent) and predicts street ~8 ± 3 m vs 9.2 (agrees).
- Branch A (map-fills-panel, m/px ~0.5) **DISFAVORED**: predicts 18 px street vs 8 seen, 38 px bulb never seen.
- Compass single-point: head (+x) end reads as minimap-north in 105 (single observation, low-medium weight, consistent with street E–W axis).

## 4. Constant table (ours vs minimap-derived vs ratio vs material-or-not)

"Minimap-derived" = value the pane would imply under Branch B m/px ~1.0 ± 0.35. Where the pane cannot resolve a quantity, derivation is N/A and the ratio column carries the only check. "Material" = would a minimap contradiction force a `layout.ts` edit on this ticket.

| Constant | Ours | Minimap-derived (Branch B) | Ratio check | Material? |
|---|---|---|---|---|
| ROAD_HALF_WIDTH 4.6 (street 9.2) | 4.6 | ~8 ± 3 m street vs 9.2 (CoachAnchor corridor 6–12 px @ ~1.0 m/px) — agrees within uncertainty | street/panel ~0.04 (line-weight) or ~0.17–0.25 (viewport void, FKQ/AICK) — different denominators, indicative only | **No contradiction — NO CHANGE** |
| KERB 0.15 / 0.3 | 0.15 / 0.3 | N/A (sub-px at minimap scale) | N/A | No — NO CHANGE |
| PAVEMENT_OUTER 7.2 (2.6/side) | 7.2 | N/A (kerb/pavement lines unresolved as separate bands) | N/A | No — NO CHANGE |
| ROAD_X_MIN -52 | -52 | N/A (stem off-pane, never resolved) | N/A | No — NO CHANGE |
| ROAD_X_MAX 17.0 | 17.0 | N/A (head approach never resolved) | N/A | No — NO CHANGE |
| HEAD_CENTER_X 26.0 | 26.0 | N/A (bulb never resolved by any scout) | N/A | No — NO CHANGE |
| HEAD_RADIUS 9.6 (dia 19.2) | 9.6 | predicts ~17–19 px bulb @ Branch B — hidden under blur + icons, **consistent** (CoachAnchor); Branch A predicts 38 px never seen (disfavoured) | N/A (no bulb aspect measured) | No — NO CHANGE |
| FRONT_LAWN_OUTER 13.6 (kerb-to-wall 9.0) | 13.6 | N/A (lawn depth not separable in pane) | N/A | No — keep DIMENSIONS deferral, NO CHANGE |
| HOUSE_DEPTH 9.2 | 9.2 | footprint depth 0.8–1.0× width (G) vs ours 9.2/19.2 = 0.48× — see note¹ | house/street 2–3.5× (FKQ/AICK/G) vs ours 19.2/9.2 ≈ 2.1× — **agrees** | No contradiction on frontage; depth-aspect note¹ is OPEN, not material — NO CHANGE |
| HOUSE_BACK 22.8 | 22.8 | N/A | N/A | No — NO CHANGE |
| HOUSE_HALF_LEN 9.6 (frontage 19.2) | 9.6 | house mass 0.5–0.6 MW / ~1/3 viewport (FKQ/G) — no absolute m/px, relative only | frontage/street ≈ 2.1× vs 2–3.5× minimap — **agrees** | No — NO CHANGE (CoachAnchor: cannot reject) |
| FLOOR_H 3.15 | 3.15 | N/A (plan pane, no heights) | N/A | No — NO CHANGE |
| UPPER_H 3.05 | 3.05 | N/A | N/A | No — NO CHANGE |
| EAVE_Y 6.20 | 6.20 | N/A | N/A | No — NO CHANGE |
| GARAGE_LEN 7.6 | 7.6 | N/A (garage not separable from house mass) | N/A | No — NO CHANGE |
| GARAGE_DEPTH 8.0 | 8.0 | N/A | N/A | No — NO CHANGE |
| GARAGE_H 3.65 | 3.65 | N/A | N/A | No — NO CHANGE |
| GARAGE_BAYS 3 | 3 | N/A | N/A | No — keep contested flag per DIMENSIONS, NO CHANGE |
| DECK_Y 3.15 | 3.15 | N/A | N/A | No — NO CHANGE |
| DECK_LEN 7.2 | 7.2 | N/A | N/A | No — NO CHANGE |
| DECK_OUT 3.4 | 3.4 | N/A | N/A | No — NO CHANGE |
| RAIL_H 1.05 | 1.05 | N/A | N/A | No — NO CHANGE |
| CANOPY_Y 3.35 | 3.35 | N/A | N/A | No — NO CHANGE |
| CANOPY_LEN 6.4 | 6.4 | N/A | N/A | No — NO CHANGE |
| CANOPY_OUT 2.9 | 2.9 | N/A | N/A | No — NO CHANGE |
| BACK_FENCE 34.0 (yard depth 11.2) | 34.0 | N/A (rear fence line not resolved as yard-depth span) | yard/house 11.2/9.2 ≈ 1.2× vs AICK SW-yard 3–4× — **different yard** (side-yard enclosure, OPEN-4), not a contradiction | No — NO CHANGE |
| FENCE_H 2.1 | 2.1 | N/A | N/A | No — sibling contract keeps, NO CHANGE |
| YARD_X -20 / +20 | ±20 | N/A (lot lines seen, FKQ, but no x-extent scale) | N/A | No — NO CHANGE |
| BOUND_X -54 / +46 (width 100) | -54/+46 | N/A (bounds never in pane) | street/bound 9.2/100 = 0.09 vs minimap street/panel ~0.04 or ~0.17–0.25 — **different denominators, do not over-claim** | No — NO CHANGE |
| BOUND_Z 38 | 38 | N/A | N/A | No — NO CHANGE |
| THIRD_HOUSE_X 44.5 | 44.5 | N/A (third house never in pane) | N/A | No — NO CHANGE |
| SPAWN_A (-4.0,-31.8) | (-4.0,-31.8) | N/A | N/A | No — NO CHANGE |
| SPAWN_B (-1.2,+31.2) | (-1.2,+31.2) | N/A | N/A | No — NO CHANGE |
| EYE_HEIGHT 1.68 | 1.68 | N/A | N/A | No — kept per DIMENSIONS, NO CHANGE |

Note¹: G's depth 0.8–1.0× width describes the **rendered stepped blob including porch/deck/apron mass**, not surveyed wall-to-wall HOUSE_DEPTH; FKQ's mass (0.5–0.6 MW with 2 infills + lot lines) confirms the blob is composite. Ours (0.48× wall box) is therefore **not contradicted** — the pane cannot separate wall box from attached masses. Recorded as OPEN-5, not a change driver.

Prior record (docs/DIMENSIONS.md headline, adopted): first-person 1.8 m-ruler pass found invented numbers mostly right; only KERB_HEIGHT 0.14→0.15 applied; FRONT_LAWN_OUTER ~1–2 m-too-deep signal deliberately deferred (5-constant blast radius); GARAGE_BAYS 3 contested; FENCE_H 2.1 kept by sibling contract; EYE_HEIGHT kept. **None of these are reopened by minimap evidence.**

## 5. Verdict on the owner complaint ("ensure the layout matches Black Ops 2 from 2012")

**The minimap cannot reject the current numbers — change NO `layout.ts` constant on minimap evidence alone.** The complaint is understood as a demand for whole-island fidelity (street width, bulb aspect, house placement); the pane answers none of those at metre scale:

- For whole-island geometry (ROAD_X_MIN/MAX, HEAD_CENTER_X/RADIUS, BOUND_X/Z, THIRD_HOUSE_X, yard extents): **no measurement possible** — bulb, bounds, and third house never appear in any cited frame (`g-1icNQzMgLUM-040`, `g-VfcKHcDJXpM-060/-001`, `mm-f-FKQOEO-1ceE-080/-085/-160/-025`, `f-aICKIbuo8zQ-100/-030`, `f-FKQOEO-1ceE-105/-135`).
- For relative blocks: **corroboration, not contradiction** — houses ~2–3× street (FKQ 2–3×, AICK 2.5–3.5×, G footprint ~1/3 viewport) vs ours ~2.1× frontage/street; street E–W = map x-axis (G); head (+x) = minimap-north single-point in `f-FKQOEO-1ceE-105` (CoachAnchor). All within large stated uncertainty.
- For scale branches: Branch B (m/px ~1.0 ± 0.35, street ~8 ± 3 m vs 9.2, bulb ~17–19 px hidden) is **consistent** with ROAD_HALF_WIDTH 4.6 / HEAD_RADIUS 9.6 / HEAD_CENTER_X 26.0 / HOUSE_HALF_LEN 9.6; Branch A (m/px ~0.5) is disfavoured (CoachAnchor). So the only quantitative scale test **fails to reject** our numbers.
- Capsule/pill outlines in `mm-g-1icNQzMgLUM-040.png` (diagonal pill ~150+/-50 x 15+/-5px + round red-orange blip ~8-12px symmetric NE of triangles, NOT car-shaped) and `mm-g-VfcKHcDJXpM-060.png` (horizontal capsule ~120+/-30 x 20+/-6px + round red top-centre ~15-25px with ~8-12px core) vs pills also in f-crops (`mm-f-FKQOEO-1ceE-080.png`, `mm-f-aICKIbuo8zQ-100.png`, see §2) vs no capsule in the `f-FKQOEO-1ceE-105.jpg` FULL minimap: both absences stand as viewport effects — neither does the `g-1icNQzMgLUM-040.jpg` FULL minimap show a capsule despite the bus on screen in 3D, so absence = zoomed viewport excluding it (or unresolvable at ~150px pane), NOT a G-vs-F art difference; capsule identity (bus vs planter/wall outline) is OPEN, and no capsule anchors metres — anomaly OPEN: the 040-crop capsule runs ~20-30 deg steeper than the house long edges (non-parallel, +/-10 deg blur noise), which a world-parallel bus would not do.
- Therefore: **no material contradiction exists**. Keep all DIMENSIONS.md deferrals as-is. The honest answer to the owner is "minimap corroborates relative layout within wide error bars and cannot adjudicate island-scale fidelity — no minimap-driven change is warranted."

## 6. OPEN list (unresolvable on this evidence — do not guess)

- OPEN-1 — Panel frame: rotation SUPPORTED, FIXED north-up DENIED — art angle not constant: 040/060/080 crops + `f-FKQOEO-1ceE-105.jpg` minimap read diagonal ~25-45 deg off horizontal (house edges ~30+/-10 deg SW-NE) while the 100 crop + `g-1icNQzMgLUM-040.jpg` FULL minimap read axis-aligned H-V, which a fixed north-up map cannot produce; exact heading-to-art-angle coupling OPEN (same-compass cross-checks do not give identical art: N-centred 060 crop diagonal vs N-centred g-040 FULL-mini aligned). Settler stays §7 item 5 rotation pair; until then, treat all directional claims as frame-conditional.
- OPEN-2 — Bulb end + island aspect: never resolved in any pane (G explicit; FKQ/AICK/CoachAnchor confirm absence). Needs a clean zoomed minimap at the bulb with the player arrow ON the bulb.
- OPEN-3 — Vehicle anchoring: direct coach-px anchoring IMPOSSIBLE (no coach/bus icons on FULL f-minimaps cited). Crop pills in BOTH families (`mm-g-040/-060`, `mm-f-080/-100`) present with identity OPEN (bus vs planter/wall outline); FULL-minimap absences are viewport effects, not art differences. Needs a sedan + coach same-frame anchor (3D, daylight, known separation).
- OPEN-4 — Yard-depth ratios: AICK SW-yard/house 3–4× vs ours rear-yard/house 11.2/9.2 ≈ 1.2× — different yard (likely side-yard enclosure, not rear yard). Needs a labelled yard-identity pass; not a rear-yard contradiction.
- OPEN-5 — Footprint depth aspect: G blob 0.8–1.0× width vs wall-box 0.48× — composite blob (porch/deck/apron/infills per FKQ) vs wall box. Needs a footprint-segmentation pass; not a HOUSE_DEPTH contradiction.
- OPEN-6 — FKQ top-right rounded rects (longest ~0.25–0.30 MW): bus-vs-shed unidentified. Needs a static-geometry correlation pass; do not scale from these.
- OPEN-7 — AICK narrow-structure/street 0.4–0.6×: structure identity unknown (shed? appliance bank? fence return?). Needs identity pass.
- OPEN-8 — Crop provenance CONFIRMED different-moment for the 040 pair (crop S vs full N: `mm-g-1icNQzMgLUM-040.png` reads S-centred while `g-1icNQzMgLUM-040.jpg` full-frame minimap reads N-centred; 060 pair likewise split: crop N-centred vs full S/W SSW-SW) — NEVER cite a full frame and its same-basename crop as one observation; treat every `mm-` crop as an independent sample with unknown source moment until re-cut with recorded rects. Needs re-cut with recorded source rects before any px figure hardens.
- OPEN-9 — DIMENSIONS.md OPEN-1 carryover: daylight down-street both-kerbs shot still the cleanest street-width settler; minimap does not substitute for it.

## 7. Recommendation (what WOULD settle it)

1. Clean zoomed minimap at the bulb with the player arrow on the bulb (settles OPEN-2 + island aspect).
2. Sedan + coach same-frame 3D anchor at known separation (settles OPEN-3 + absolute scale without the minimap).
3. Daylight down-street both-kerbs shot per DIMENSIONS OPEN-1 (settles street width independent of minimap line-weight ambiguity).
4. Re-cut AICK `mm-*.png` crops with recorded source rects (settles OPEN-8, hardens §3c ratios).
5. Two-frame minimap rotation pair (settles OPEN-1 frame dispute).

Until one of those lands: **no `layout.ts` change from this ticket.**
