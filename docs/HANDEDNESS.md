# Nuketown 2025 — is it a 180° rotational pair or a mirror pair?

**Verdict: 180° ROTATIONAL PAIR. The invariant in `AGENTS.md` holds, and
`layout.ts::garageIsOnTheRight()` needs no sign change.**

Written 2026-09-18 by the handedness lane. Documentation only — no file under `src/**`
was touched, and `layout.ts` was read but not edited. `npx tsc --noEmit` is clean.

> **Re-tested independently on 2026-09-19 by a second pass, which reached the same
> verdict by the same cue and added the map's absolute compass orientation and a
> measured end for the orange garage. See §8. Nothing in §1–§7 is retracted.**

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

---

# 8. Second, independent pass — 2026-09-19 — CONFIRMS the verdict, and makes it absolute

Run by the wave-2 `handedness` lane. It re-read the frames from scratch and reached the
same answer by the same cue, plus three things §1–§7 above did not have: the map's
**absolute compass orientation**, a **measured** end for the orange garage, and a second
instance of the both-houses artefact. Documentation only; no file under `src/**` was
touched; `npx tsc --noEmit -p tsconfig.json` exits 0 with no output.

**Result: unchanged. 180° ROTATIONAL PAIR. `layout.ts` needs no sign change.**

## 8.1 The descent cue, re-read on six frames

The carrier of the verdict above is: *from your own back yard, which way does the rear
external stair descend?* Rotational ⇒ the same apparent direction from both yards;
mirror ⇒ opposite. Re-read independently, at 1500–1600 px and on zoomed crops:

| frame | house, and the cue that identified it | stair |
|---|---|---|
| `g-tB35IKluv0g-148` *(new)* | ORANGE — **yellow kitchen** visible through the undercroft opening; terracotta glazing behind a white finned roof canopy; glass X-braced deck rail | head upper-LEFT, foot lower-RIGHT |
| `g-tB35IKluv0g-110` *(new)* | WHITE — rounded capsule end at the left, teal-lit undercroft doorway, slim square posts | head upper-LEFT, foot lower-RIGHT |
| `f-aICKIbuo8zQ-179` | ORANGE — yellow back room, round wall clock, seated mannequin through the back door | head upper-LEFT, foot lower-RIGHT |
| `g-1icNQzMgLUM-102` | ORANGE — terracotta panels, orange-painted stair, the tan patio with round stepping pads that the aerial shows in the orange yard | head upper-LEFT, foot lower-RIGHT |
| `g-1icNQzMgLUM-246` | WHITE — white render, curved cantilevered roof, grey stair, green-lit back door | head upper-LEFT, foot lower-RIGHT |
| `f-FKQOEO-1ceE-060` | ORANGE — terracotta panels, white roof louvres (low weight: death cam, camera not player-controlled) | head upper-LEFT, foot lower-RIGHT |

Six for six, three clips, **both** houses — including one frame whose house identity is
beyond argument in each direction (`-148`, yellow kitchen = orange; `-110`, rounded
capsule = white). Unanimous. If the pair were a mirror, at least one of these would have
to run the other way.

## 8.2 NEW — the map's absolute orientation

Every frame carries a HUD compass ribbon under the minimap. In five of the six clips the
YouTube encode destroys it. In **`g-tB35IKluv0g`** it survives and can be read after a
percentile contrast stretch at 5–6×.

- The HUD minimap panel spans **x 20–271** in the 1600-px frame (measured from the
  column-mean edge step, identical in `-011` and `-148`), so the player's heading is the
  bearing at **x ≈ 145.5**. Letters run left→right in increasing bearing; N→E measures
  ≈ 77 px, i.e. ≈ 0.86 px per degree.
- **`g-tB35IKluv0g-011`** — standing **inside the orange garage, looking out through the
  open vehicle bay** across the crazy-paving driveway (the coach and the pale curved
  other house are visible through the opening; the left wall is concrete with a
  rubble-stone dado and a "TARGET B" board, so this is not the white pool garage).
  W at x ≈ 39, N at 116, E at 193 ⇒ **heading ≈ 034°** (± ~10°, the uncertainty is in
  reading the glyph centres, not in the sign).
- **`g-tB35IKluv0g-148`** — orange back-yard spawn ⇒ **heading ≈ 023°**.

⇒ **The orange garage bays, and the orange house's street face, look NORTH.**
⇒ **ORANGE is the SOUTH house; WHITE is the NORTH house.**
⇒ From the orange back yard facing the orange house, **your right hand points EAST**.
  From the white back yard facing the white house, **your right hand points WEST**.

Two consequences worth recording for any future measurement on the two plan images:

- **The official minimap is NORTH-UP.** Min-area rectangle of the playable polygon
  (threshold > 60) is **179.8 × 427.0 px at 0.0°**, bbox x 168–349, y 44–471 — axis
  aligned, long axis vertical. And the HUD minimap at heading ≈ 034° (i.e. ≈ north-up)
  reproduces the official minimap's outline in the **same orientation and the same
  handedness**: west road-stem wedge on the left at mid-height, east apron bump on the
  right. A 180° turn or a mirror of the official image would swap those.
  ⇒ **minimap LOWER house = ORANGE, UPPER = WHITE.**
- **The official aerial is the north-up plan rotated 90° clockwise**: aerial-right =
  NORTH, aerial-left = SOUTH, **aerial-down = EAST, aerial-up = WEST**. (Orange on the
  left of the aerial, and orange = south.) §4.1's caution about perspective still
  applies, but at least the axes are now named.

## 8.3 NEW — the orange garage's end is measured, not inferred

§2 part (b) above marks the garage hand INFERRED. For the **orange** house it no longer
is. Three independent sources put its garage at the **EAST** end:

| source | observation |
|---|---|
| minimap | the crazy-paving **hatch** patch on the south house's street (north) side sits at minimap x ≈ 247–283, against that house's footprint x 206–293 (centre ≈ 249) |
| aerial | the garage wing — two bays, one open and one closed with a pale-green ribbed sectional door, a car nosed in, a large flagstone apron — is at the aerial-**bottom** end of the orange house (bays ≈ x 613–657 y 620–677; apron ≈ x 657–780 y 600–717), and aerial-down = east |
| `g-tB35IKluv0g-146` / `-182` / `-183` | the fixed end-of-round camera (§8.4). Orange (south) is on the left and white (north) on the right, so the camera is beyond the **east** end looking west; the orange garage is the large **near** element at the bottom-left ⇒ near = east |

Filled-footprint numbers for whoever re-measures the minimap: threshold > 155, dilate 2,
fill holes, take the component containing each house — **south/orange** x 206–293,
y 298–382, area 3995 px; **north/white** x 208–295, y 137–212, area 4399 px.

So the invariant, stated absolutely and no longer only relatively:

> **The ORANGE (south) house's garage is at the EAST end and its rear deck and stair at
> the WEST end. By the rotational verdict the WHITE (north) house is the point
> reflection of that: garage WEST, deck and stair EAST. From either back yard, facing
> your own house, the garage is on your RIGHT.**

That is consistent with everything above, and with the aerial: the only flagstone patch
on the white house's street side (≈ x 1068–1135, y 512–613, about 4.6 × 6.8 m) lies
**west** of the white house's mid-length, on the paved path straight from the circle.

## 8.4 NEW — falsifier #1 also exists as gameplay frames

`INTERIORS-TOPOLOGY.md` §7 asked first for "any single frame containing BOTH back
yards". §4.1 above notes the aerial technically satisfies it. There is a second kind on
disk: the **fixed end-of-round overview camera**, which contains both houses in one
frame —

- `g-tB35IKluv0g-146` ("SWITCHING SIDES"), `-182` and `-183` ("VICTORY").

In them the orange garage is plainly legible (pale-green ribbed sectional door,
flagstone apron, red car) and the geometry gives the camera's end of the street (§8.3).
What they do **not** give is the white house's garage: the Nuketown trailer and the
articulated truck are parked across the white house's street frontage at exactly the
point where its garage would be. I first read that trailer *as* a white garage wing at
2×; at 5× it resolves into the trailer and the truck cab, and that reading is withdrawn.

I also re-fetched a 95-second section (t = 540–635 s) of `tB35IKluv0g` with yt-dlp and
extracted 95 frames at 1 fps, to see whether that camera pans. **It does not** — it is a
fixed shot, and the denser frames add nothing over `-146`. Nothing was written to
`docs/reference/`; the video and frames stayed in the session scratchpad and the video
was deleted. No `docs/reference/gameplay-handedness/` was created. The Steam copy was
not launched. All processing was Python/PIL plus one yt-dlp/ffmpeg pair; no browser, no
vite server, no console window.

## 8.5 The cue that fails, and how it nearly cost this pass the answer

**Read the stair's descent direction, never "which end of the house it sits on."**

This pass initially tried to place each stair *along its house* — "is the stair at the
east or the west end?" — from oblique back-yard frames. That produced: east in `-148`
and `-179`, west in `-102`, all three of them the orange house. On that basis this pass
very nearly filed a verdict of **unresolved**, and nearly filed a claim that the orange
house must have stairs at both ends. It does not. The error is that judging *which end*
requires knowing where the house ends, and in a foreshortened oblique view standing near
one end of the yard, that is a guess. The **descent direction** needs no such judgement,
which is exactly why §1 and §5 above are built on it. The same error, in the opposite
direction, is what §5 diagnoses in `INTERIORS-TOPOLOGY.md` §7.

One real observation survives from that dead end, and someone should explain it: the
stair in `-102` has **orange-painted** steel stringers and handrail, while `-148` and
`-179` — also the orange house — show pale grey/timber treads with a **glass X-braced**
balustrade. Either the orange house has two different flights, or one of those frames is
a structure this pass has mis-assigned. It does not touch the verdict (all three descend
the same way), but it is loose.

A second, procedural near-miss, recorded because it is the more dangerous one: this pass
wrote its report **before checking whether `docs/HANDEDNESS.md` already existed**. It
did, committed in `ea91fe8`, with the correct verdict — and was briefly overwritten with
the wrong one. Check `git log -- <path>` before writing a document that another lane may
already own.

## 8.6 The `handedness PASS` line in the gate output is vacuous

`garageIsOnTheRight()` compares `sign(h.garageX)` with a right-hand vector derived from
`h.side`. `ORANGE.garageX` and `WHITE.garageX` are hard-coded with opposite signs, so the
function returns `true` for both houses **by construction**. `main.ts` maps it over
`HOUSES` and exposes it as `stats().handedness`; `traverse.mjs` and `probe-autos.mjs`
print `handedness PASS`.

It is a self-consistency check on `layout.ts`'s own constants. It cannot fail unless
someone edits those constants, and it carries **no** information about the real BO2 map.
Nobody should read `handedness PASS` in a gate log as evidence about the invariant — the
evidence is this document. Keeping the check is still right: it is the tripwire that
catches a builder hardcoding a sign somewhere else.

## 8.7 One reading that dissents, recorded rather than buried

Working from **filled** footprints of the minimap (rather than §4.2's hand trace of the
outline), the north/white house's street-ward lobe looked to this pass as though it sits
at the **EAST** end — which would be the mirror signature, and disagrees with §4.2's
trace of the wings on opposite image sides. §4.2's is a 9× hand trace of the bright
outline; this one is an 8× impression of a dilated, hole-filled blob, which smears a
porch canopy and a garage wing into the same mass. It is recorded as a soft dissent, not
a contradiction, and it is not weighed against six unanimous frames. If anyone reopens
this question, that measurement is the one to redo properly.

## 8.8 Gates run by this pass

```
npx tsc --noEmit -p tsconfig.json     → exit 0, no output
```

`npm run build`, `paths.mjs`, `traverse.mjs`, `playcap.mjs`, `plan.mjs` and
`npm run capture` were deliberately **not** run. `git status` at the time showed
`src/build/orange-house.ts`, `white-house.ts`, `yards.ts`, `mannequins.ts`,
`vehicles.ts`, `plaza.ts`, `core/materials.ts`, `main.ts` and nine UI/net files modified
by the sibling lanes mid-edit. Building would have written `dist/` out from under their
captures; traverse/playcap/capture would have taken the one shared preview server and
the one headless browser while they were using them, and would have photographed their
half-finished work. That is a boundary to report rather than cross. This lane cannot
move a pixel or a collider, so none of those gates could have said anything about it.
