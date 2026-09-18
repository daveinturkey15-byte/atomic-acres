# Nuketown 2025 — is it a 180° rotational pair or a mirror pair?

**Verdict: 180° ROTATIONAL PAIR. The invariant in `AGENTS.md` holds, and
`layout.ts::garageIsOnTheRight()` needs no sign change.**

Written 2026-09-18 by the handedness lane. Documentation only — no file under `src/**`
was touched, and `layout.ts` was read but not edited. `npx tsc --noEmit` is clean.

This supersedes `INTERIORS-TOPOLOGY.md` §7, which recorded the invariant as
**CONTRADICTED**. §7's contradiction was a **misreading of one frame**
(`g-1icNQzMgLUM-102`) at 1600 px. Read at 2.85× the same frame agrees with every other
back-yard frame in the library. Details in §5.

---

## 1. The test, defined before looking

Written down first so the answer could not be chosen to fit.

> **T.** Stand in your own back yard. Face your own house. Report
>   (a) which hand the **garage wing** is on, and
>   (b) which hand the **top of the external rear stair** is on.

And the decision rule:

| the two yards answer | conclusion |
|---|---|
| the **same** | **180° rotational pair** — rotating 180° about the map centre maps one yard's view onto the other's unchanged |
| **opposite** | **mirror pair** — reflecting across the street centre line flips left and right |

**Why left/right in an oblique frame is still valid.** A perspective camera that is
outside a wall and in front of it preserves the left-to-right **order** of features that
lie on that wall. Moving sideways along the yard, or standing near one end and looking
along the face, changes how compressed the face looks but never reverses the order. So
"the stair's head is to the left of its foot" is a property of the house, not of where
the player happened to be standing — provided the camera is in the yard, outside the
house, which it is in every frame cited below. The only thing that would reverse it is
crossing to the other side of the house, where the rear stair is not visible at all.

**Which house is which.** Classified by cladding and finish only, per
`INTERIORS-TOPOLOGY.md` §1, and the cue used is stated for every frame:

- **ORANGE** — terracotta/salmon curtain-wall panels with white glazing bars on the
  upper storey; rubble-stone dado on the undercroft back wall; **orange-painted** steel
  stair and deck handrails; X-braced (asterisk-fitting) balustrade.
- **WHITE** — white render; wide flat **cantilevered roof with a curved overhanging
  edge**; rounded capsule end; **grey/galvanised** stair and balustrade, no terracotta
  anywhere.

No memory of BO1 / Cold War '84 / BO6 / BO7 Nuketown was used. Nothing below is derived
from `AGENTS.md`, `layout.ts` or `INTERIORS-TOPOLOGY.md`; those were read, then set
aside, and the frames were re-read from scratch.

---

## 2. The result

Five frames, three independent clips, both houses. Every one read at 2.6–3.5× on the
stair region, not at thumbnail size.

| frame | house | cladding cue used | external rear stair |
|---|---|---|---|
| `f-aICKIbuo8zQ-179` | ORANGE | terracotta curtain wall + white glazing bars; rubble-stone dado; yellow back room through the undercroft door | head **LEFT**, descends to the **RIGHT** |
| `g-1icNQzMgLUM-102` | ORANGE | terracotta panels; **orange-painted** handrails; rubble-stone dado | head **LEFT**, descends to the **RIGHT** |
| `g-1icNQzMgLUM-246` | WHITE | white render; curved cantilevered roof; grey stair; green-lit undercroft door | head **LEFT**, descends to the **RIGHT** |
| `g-1icNQzMgLUM-101` | WHITE | white render; curved roof; capsule end; grey stair | head **LEFT**, descends to the **RIGHT** |
| `f-mGpZaLy5_hM-097` | WHITE | white render; curved roof; glass/metal balustrade; grey open treads | head **LEFT**, descends to the **RIGHT** |

**Both yards give the same answer. The two back-yard scenes are not mirror images of
each other. Therefore: rotational pair.**

`g-1icNQzMgLUM-102` and `-246` are the same clip, the same match, seconds apart — the
least confounded comparison available, and the pair §7 said refuted the invariant. They
**agree**.

### Part (b) of the invariant — the garage hand

`g-1icNQzMgLUM-246` also settles which end the garage is on, for the WHITE house. Past
the foot of the stair the house continues to the **right**: a single-storey wing with a
shallower, lower roof (aerial-frame coords in that image: eave ~x 1220–1500 y 250–380, a
wall with a large recessed window at x 1250–1370 y 400–480, parapet x 1130–1450
y 480–540). A lower-roofed single-storey wing at the far end from the deck is the
**garage wing**. So from the white back yard, facing the house: **deck and stair on your
left, garage on your right.** By the rotational result the orange house is the same, and
`g-1icNQzMgLUM-102` is consistent — the orange house also continues to the right of the
stair's foot (grey undercroft wall, recessed panel and rubble-stone dado, x 1200–1600).

This part is **INFERRED, not VERIFIED**: I never saw a garage door and a rear stair in
one frame. The lower-roofed right-hand wing is the only structure that can be the
garage, but it could in principle be an outbuilding.
*Falsifier:* one frame from a back yard, standing back near the fence, that shows the
whole house including a pale-green ribbed sectional door round the corner — or any
frame showing a house's full street facade with both garage bays and the opposite end
of the main block.

**The verdict in §2 does not depend on part (b).** Mirror-vs-rotational is settled by
the stair alone, because the stair is the same feature on both houses.

---

## 3. What this means for the code

`src/core/layout.ts` is **correct as written** and needs no change:

- `ORANGE.garageEnd = -1`, `WHITE.garageEnd = +1` — the garage wings sit at **opposite
  x ends**, which is exactly the rotational arrangement. A mirror pair would put both
  garage wings at the same x end.
- `ORANGE.deckX = +(HOUSE_HALF_LEN - DECK_LEN/2)`, `WHITE.deckX = -(...)` — deck opposite
  the garage in each house. Confirmed by §2's part (b).
- `garageIsOnTheRight()` returns `true` for both houses. Re-derived independently here:
  in the project's plan convention (`+x` page-right, `+z` page-down, `y` up), a person
  facing `f = (f_x, f_z)` has right-hand `(-f_z, f_x)`. From the orange back yard
  (`z = -34.3`, facing `+z`) that is `-x`, and `ORANGE.garageX = -9.5` — on the right.
  Same for white by symmetry. **Matches the frames.**
- `SPAWN_A` / `SPAWN_B` being point-reflections of each other through the origin is the
  right construction for a rotational pair. Keep it.

The `garageIsOnTheRight()` design — derive in one place, never hardcode a sign — was the
right call and should stay, but it is no longer an open assumption. **It is now a
measured fact and can be treated as one.**

---

## 4. Evidence I ran that did NOT decide it — recorded so nobody repeats it

### 4.1 The official aerial (`docs/reference/img/nt2025-aerial-boii.png`)

This **does** contain both back yards in a single image, so falsifier #1 is technically
already satisfied on disk. It is nonetheless **not decisive at this resolution**, and
the verdict above does not rest on it:

- It is a perspective render, not an orthographic plan. Roofs sit ~6 m above ground and
  are displaced radially outward from the image centre, so roof-level and ground-level
  features cannot be mixed in one measurement.
- The two houses are **splayed relative to each other**, not parallel — the orange main
  block's long roof axis runs down-right at about +31° from image horizontal, the white
  house's capsules up-right at about −17°. Any "which side of the axis" test therefore
  needs each house's own front normal, not a single map axis.
- I read the white house's rear stair at **aerial (1440–1480, 600–680)** — about ten
  tread lines, clearly a flight — its deck landing at (1430–1500, 552–600), and its
  crazy-paving driveway at (1055–1145, 508–600). I could **not** confidently locate the
  orange house's rear deck and stair. The candidate band of ~8 pale panels at
  (460–545, 305–470) is the wrong pitch for treads (≈23 px per bay ≈ 1.5 m at the
  circle-derived scale of ~0.066 m/px, against ~7 px per tread on the white stair), so
  it is a roof or canopy, not the stair.

Useful landmark positions extracted from it, if anyone else works on this image:
turning-circle centre ≈ (950, 630), circle diameter ≈ 280 px; road stem leaves the circle
downward; the third structure (dark chevron roof, two big skylights) is aerial-**up**
of the circle with its own paved approach and red car; orange house roof ≈
(460–805, 305–610); orange garage wing with two ribbed bays, crazy-paving driveway and a
red car ≈ (505–790, 525–700); white house capsules ≈ (1120–1450, 400–760); white back
yard sandpit ≈ (1450–1550, 375–465) and shuffleboard court ≈ (1478–1540, 541–668).

### 4.2 The minimap footprints (`nt2025-minimap-boii.png`) — one useful reading, one dead end

**Useful.** Traced by hand at 9× on the bright footprint outline, the offset wing sits on
**opposite image sides** in the two houses:

- upper house: wing occupies minimap x ≈ 207–247, main block x ≈ 247–294
- lower house: wing occupies minimap x ≈ 256–293, main block x ≈ 216–269

For two houses facing each other across a street, wings on opposite image sides is the
**rotational** signature; a mirror across the street centre line would leave both wings
on the same side. This agrees with §2 but it is a hand trace of a 512 px image, so it is
corroboration, not the carrier.

**Dead end — do not redo this.** I re-ran the normalised-cross-correlation test that
`INTERIORS-TOPOLOGY.md` §9 reported as inconclusive, in a stronger form: a full
chirality test (best proper rotation of one footprint onto the other, versus best
reflection-plus-rotation), swept over 0–360° at 0.5° refinement with FFT translation
search, at three outline thresholds. Results:

| outline threshold | best PROPER (rotation) | best IMPROPER (reflection) | margin |
|---|---|---|---|
| 120 | 0.4998 at 144.5° | 0.5180 at 354.5° | 0.018 |
| 130 | 0.4360 at 146.0° | 0.4880 at 353.0° | 0.052 |
| 145 | 0.4526 at 146.0° | 0.4832 at 353.0° | 0.031 |

It nominally prefers "mirror", and it should be **ignored**, for two reasons that are
visible in the numbers themselves. All scores are low (0.44–0.52) because the windows
contain yard clutter, fences, the circle and the minimap's diagonal background hatching,
not just the footprints. And the improper peak at ~353° is a reflection about a line
running **along** the house-to-house axis, which would mean both houses face the same
way — geometrically impossible for this map. The test is measuring background, not
buildings. `INTERIORS-TOPOLOGY.md` §9's "inconclusive" was right; this closes it as a
dead end rather than as weak evidence for either side.

### 4.3 The garage-bay order — suggestive, not load-bearing

From inside either garage looking out at the street, the **closed** pale-green ribbed
sectional bay is on the **right** and the open bay on its left:

- ORANGE: `f-FKQOEO-1ceE-090` (white built-in cupboard doors on the left wall — the
  orange garage's finish per §3), `g-tB35IKluv0g-011` (ball hanging from the ceiling).
- WHITE: `g-tB35IKluv0g-085` (green back-lit display shelving, then a pedestrian
  doorway, then the open bay, then the closed bay), `g-tB35IKluv0g-143`.

Same hand in both houses, which is again the rotational signature. Left out of the
verdict because which of the two doors is shut is a prop placement and need not follow
the geometry.

### 4.4 Not done

I did **not** fetch new footage (falsifier #2). It was not needed — the existing 1371
frames answer the question. No `docs/reference/gameplay-handedness/` was created. The
Steam copy was not launched. No browser, no vite server, no Chrome, no console window;
the only processes spawned were Python/PIL in the scratchpad.

---

## 5. Why `INTERIORS-TOPOLOGY.md` §7 got the opposite answer

§7's table reads `g-1icNQzMgLUM-102` as "top of the external stair: **RIGHT**", against
`-246` as LEFT, and calls that "the least confounded comparison available… on its own
that says mirror pair, invariant refuted."

At 1600 px the orange stair in `-102` is small, back-lit, and sits in front of a long
deck whose balustrade occupies the right of frame; the eye reads "stair, then deck to
the right" as "the stair goes up to the right." Crop `-102` to `(760, 80)–(1350, 480)`
and scale 2.85× and it resolves: two **orange-painted handrails** run from about
`(800, 150)` and `(880, 145)` down and to the right, ending on orange newel caps at
about `(1010, 390)` and `(1150, 400)`, with roughly twelve treads stepping down between
them. The flight's **head is on the left and its foot on the right** — the same as every
other frame.

The three explanations §7 offered for the contradiction were all unnecessary:
`f-aICKIbuo8zQ-179` **is** the orange house (the yellow back room with the round wall
clock and the seated mannequin, seen through the undercroft door, is the orange house's
back room, `INTERIORS-TOPOLOGY.md` §2.2), `-102` **is** a back-yard view, and no house
has features at both ends of the deck.

One further trap worth recording, because it nearly cost me the same mistake in the
other direction: the same frame read from a 128 px contact-sheet thumbnail
(`g-1icNQzMgLUM-101`, white house) also appeared to run the other way. **Do not read a
staircase's direction below about 2×.** Both errors in this file came from reading a
stair at display scale.

---

## 6. Two loose ends this lane did not close

Neither affects the verdict; both are worth someone's time.

1. **The garage hand is INFERRED, not VERIFIED** — see §2, part (b), with its falsifier.
2. **The main block may be deeper than it is wide.** Both the aerial and the minimap
   read the main block's street face as *narrower* than its front-to-back depth
   (aerial ≈ 202 px front × 264 px deep; minimap bounding ratio 0.766 in the same sense),
   whereas `layout.ts` has `HOUSE_HALF_LEN * 2 = 12.8` wide against `HOUSE_DEPTH = 11.2`
   — the other way round. That is a dimensions question, not a handedness one, and
   `layout.ts` is read-only for every lane, so it is flagged here rather than acted on.
   It should go to whoever owns `docs/DIMENSIONS.md`.

---

## 7. How to reproduce every figure in this file

All of it is PIL crops of files already in the repo. Nothing was written outside
`docs/HANDEDNESS.md`.

```python
from PIL import Image
g = 'docs/reference/gameplay/'

# the decisive stair reads
Image.open(g+'g-1icNQzMgLUM-102.jpg').crop((760,  80, 1350, 480)).resize((1681,1140))  # orange
Image.open(g+'f-aICKIbuo8zQ-179.jpg').crop((380,   0, 1600, 660)).resize((1680, 909))  # orange
Image.open(g+'g-1icNQzMgLUM-246.jpg').crop((400,  40, 1250, 640)).resize((1700,1200))  # white
Image.open(g+'g-1icNQzMgLUM-101.jpg').crop((550,  60, 1020, 500)).resize((1645,1540))  # white
Image.open(g+'f-mGpZaLy5_hM-097.jpg')                                                  # white, native

# the garage-end read
Image.open(g+'g-1icNQzMgLUM-246.jpg').crop((980, 200, 1600, 620)).resize((1674,1134))

# the aerial reads (perspective - corroboration only)
a = 'docs/reference/img/nt2025-aerial-boii.png'
Image.open(a).crop((1340, 460, 1560, 740))   # white rear deck + external stair
Image.open(a).crop(( 460, 520,  860, 740))   # orange garage bays + crazy-paving driveway
```
