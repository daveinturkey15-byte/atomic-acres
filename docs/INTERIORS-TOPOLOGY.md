# Nuketown 2025 — real interior topology of the two houses

Written 2026-09-18 from the 1371 BO2 gameplay frames already in
`docs/reference/gameplay/`, the official minimap and aerial in `docs/reference/img/`,
and nothing else. **No memory of BO1 / Cold War '84 / BO6 Nuketown was used as a
source.** Every claim below is tagged:

- **VERIFIED** — a named frame shows it, and I opened that frame and describe what is in it.
- **INFERRED** — derived from the plan, the aerial, or a chain of frames; not directly seen.
- **UNKNOWN** — I could not establish it from the evidence I have.
- **CONTRADICTED** — two frames disagree. One of these is important; see §7.

Documentation only. No file under `src/**` was touched.

---

## 0. How to read a frame citation

`f-mGpZaLy5_hM-049` means `docs/reference/gameplay/f-mGpZaLy5_hM-049.jpg`.
Frames `f-*` are 1 frame / 3 s, `g-*` are 1 frame / 4 s, all 1600 px wide, six clips.
Consecutive numbers are therefore **3–4 s apart**, not adjacent: a two-frame chain is
suggestive, not proof, and is marked as such.

Every frame carries a **rotating** HUD minimap (player always centred, north not up) and,
on most frames, one or two compass letters on its lower edge. The minimap is useful for
"which part of the map" and useless for precise position; I did not build any claim on it.

---

## 1. The two houses, and how to tell them apart in a frame

The map has exactly two enterable houses. Their interiors share a plan but have
completely different finishes, which is the reliable way to tell which house a frame is in:

| | ORANGE house (our `-z`) | WHITE house (our `+z`) |
|---|---|---|
| Upper-floor exterior | terracotta / salmon curtain-wall panels with white glazing bars (`f-aICKIbuo8zQ-179`, `nt2025-sniper-boii.png`) | white render, wide flat cantilevered roof, pale-blue roof deck (`g-1icNQzMgLUM-246`, aerial) |
| Plan of the main block | rectangular, ribbed mono-pitch roof (aerial x 480–830, y 210–620) | **two rounded-cornered capsules** (aerial x 1150–1440, y 400–740) |
| Kitchen | **yellow** wall + base units, orange counter (`f-aICKIbuo8zQ-148`, `g-tB35IKluv0g-023`) | **pale mint + white**, blue base units, built-in **diner booth** with navy seats (`g-1icNQzMgLUM-041`, `g-VfcKHcDJXpM-122`) |
| Living room | olive-green walls with tan vertical panel strips, **orange 3-seat sofa** + white egg chair, white shag rug on green carpet, framed picture gallery, starburst clock (`g-1icNQzMgLUM-106`, `-116`, `-180`) | full-height glazing with **teal patterned curtains**, grey-green carpet (`g-VfcKHcDJXpM-113`) |
| Internal stair | grey-green carpet, **yellow-painted nosings**, red circular wall-art disc at the head (`f-mGpZaLy5_hM-049`, `g-1icNQzMgLUM-126`) | pale grey-green carpet, no nosings, **two large magenta circular discs** on the flank wall (`f-mGpZaLy5_hM-088`, `g-1icNQzMgLUM-184`) |
| Upper floor | terracotta walls, **dark timber floor**, patterned rugs (`f-mGpZaLy5_hM-051`, `-053`, `-014`) | **purple** diamond wallpaper + purple carpet bedroom, and a **pale-green** room (`g-1icNQzMgLUM-249`…`-263`, `f-aICKIbuo8zQ-024`) |
| Garage | white built-in cupboard doors, exposed rustic beams, a ball hanging from the ceiling, plain concrete floor (`f-FKQOEO-1ceE-070`, `-089`, `-090`, `g-tB35IKluv0g-011`) | green back-lit display shelving, three "Nuka Energy" vending machines, **an indoor swimming pool** (`g-tB35IKluv0g-085`, `-091`, `f-mGpZaLy5_hM-030`, `g-VfcKHcDJXpM-171`) |

All VERIFIED. The colour split is consistent across all six clips; I found no frame that
mixes a yellow kitchen with green display shelving, or a purple bedroom with a dark
timber floor.

> **Naming caution.** "ORANGE = `-z`" and "WHITE = `+z`" are the *project's* assignment
> from `src/core/layout.ts`. Nothing in the frames tells me which of the two real houses
> is at `-z` in our frame, because our `z` axis is our own invention. The assignment is
> arbitrary and self-consistent; keep it. Everything below is written "orange house" =
> the one with the yellow kitchen.

---

## 2. Ground floor

### 2.1 The shared plan (both houses)

**VERIFIED.** Both houses have the same four-part ground floor:

```
   STREET  (front)
   ┌──────────────────────────────┬──────────────┐
   │        LIVING ROOM           │              │
   │  full-height glazed sliding  │   GARAGE     │  ← bays face the STREET
   │  door onto the front porch   │  (2 bays)    │
   ├───── wide cased opening ─────┤              │
   │        KITCHEN / DINER       │◄── door ─────┤  ← internal door, garage → kitchen
   ├──────────────────────────────┴──────────────┤
   │  STAIR HALL + back room, under the upper    │
   │  floor which cantilevers over an UNDERCROFT │
   └──────────────────────────────────────────────┘
   BACK YARD  (rear deck above, external stair down to the yard)
```

Evidence, item by item:

- **Living room opens directly into the kitchen through one wide cased opening with a
  deep header** — not a door. `f-mGpZaLy5_hM-005`: standing at the kitchen end, yellow
  wall and base units and a cooker hood on the left, a round dining table with three
  chairs in front of them, then a square-headed opening roughly 2.5–3 m wide, and
  through it the living room with its TV, picture-gallery wall, a mannequin and the white
  rug. `f-aICKIbuo8zQ-145` and `-148` show the same opening from the living-room side
  (mannequin in a yellow dress standing at the kitchen counter, retro wall telephone on
  the return wall). VERIFIED, orange house.
- **The street wall of the living room is a full-height glazed sliding door.**
  `f-mGpZaLy5_hM-006` (orange): the door is at one end of the olive wall, and through it
  you see the pavement, the kerb and the parked coach. `f-FKQOEO-1ceE-125`/`-126`/`-127`
  (orange): the same opening from further inside, with the porch canopy soffit visible
  above it and shrubs outside. `g-VfcKHcDJXpM-113` (white): a full-height glazed wall with
  teal patterned curtains drawn to either side of a central sliding opening, street and a
  car beyond. VERIFIED both houses.
- **A back door at ground level, under the cantilevered upper floor.**
  `f-aICKIbuo8zQ-179` (orange): an open doorway in the back wall, and through it a
  yellow-walled room with a round wall clock, a chair and a seated mannequin.
  `f-mGpZaLy5_hM-022` (white): an open doorway in the back wall showing a teal-walled
  room with a red/pink bed. `g-1icNQzMgLUM-246` (white): the same doorway, green-lit
  inside. VERIFIED both houses.
- **The upper floor cantilevers over an open undercroft at the back**, carried on slim
  square posts, with a rubble-stone dado on the back wall and a concrete slab patio
  underfoot. `f-aICKIbuo8zQ-179`, `g-1icNQzMgLUM-102`, `f-aICKIbuo8zQ-183` (a big white
  square column with the yard beyond). VERIFIED.

### 2.2 Orange house ground floor, room by room

- **Living room** (street side). Olive-green walls with tan vertical panel strips; a
  framed picture-gallery wall; a large starburst wall clock; a retro TV on a stand; a
  sideboard; potted plants; an **orange three-seat sofa**, a **white egg swivel chair**,
  a low table and a **white shag rug** on green carpet; a tall tan built-in closet at one
  end and a white cylindrical element (flue or column) beside it.
  `g-1icNQzMgLUM-106`, `-116`, `g-VfcKHcDJXpM-180`, `f-mGpZaLy5_hM-042`. VERIFIED.
  - Cover value: the sofa is chest-high from the kitchen side and waist-high from the
    door; the closet block is full-height and breaks the sightline from the front door to
    the stair hall.
- **Kitchen / diner.** Yellow wall and base units along the long wall, orange counter
  top, cooker hood, pendant light over a round dining table with three chairs, a wall-
  mounted telephone in a tall recess, a white fridge.
  `f-aICKIbuo8zQ-145`, `-148`, `f-mGpZaLy5_hM-005`, `g-tB35IKluv0g-023`. VERIFIED.
  - Cover value: the counter run is waist-high hard cover along one wall; the table and
    chairs are not cover, they are a trip hazard for pathing.
- **Stair hall.** Straight single flight, ~12 risers, grey-green carpet with **yellow
  painted nosings**, a **timber handrail on a posted balustrade on one side** with the
  room below visible past it, and at the head a **round red wall-art disc** and a tall
  glazed door. `f-mGpZaLy5_hM-049` (looking up the whole flight), `g-1icNQzMgLUM-126`
  (looking up the bottom of the flight; the wall is brick-red above a pale-yellow dado, a
  mannequin in a purple dress stands on the landing), `g-VfcKHcDJXpM-045`, `-237`.
  VERIFIED that the stair exists, is a single straight flight, and is open on one side.
  **Where it sits in the plan: INFERRED** (see §5).
- **Back room.** Yellow-walled, with a clock and a chair, entered from the undercroft by
  the back door. `f-aICKIbuo8zQ-179`. VERIFIED it exists; its internal connections are
  UNKNOWN.

### 2.3 White house ground floor, room by room

- **Living room.** Full-height glazed street wall with teal patterned curtains and a
  central sliding opening; potted plant; grey-green carpet. `g-VfcKHcDJXpM-113`. VERIFIED.
- **Kitchen / diner.** Pale mint-green, a **built-in diner booth** (navy banquette seats
  around a fixed table), a serving counter with cutlery graphics, a red-and-cream
  circular wall artwork, white base units, a teal-curtained window with a bench under it,
  a white tiled floor. `g-1icNQzMgLUM-041`. Seen again through the garage door in
  `g-VfcKHcDJXpM-122` (blue base units, white worktop, sink, fridge). VERIFIED.
  - Cover value: the booth is the best hard cover on this floor — a waist-high box you can
    crouch behind on three sides.
- **Stair hall.** Straight single flight, ~11–12 risers, pale grey-green carpet, a
  **slate-blue** flank wall with a picture frame and a timber handrail open over the
  space below, and on the other side a pale blue-grey wall carrying **two large magenta
  circular discs** with chrome rims. At the head: a starburst wall sculpture, a pale-green
  wall further along, and a glazed door.
  `f-mGpZaLy5_hM-088`, `g-1icNQzMgLUM-184`. VERIFIED.
- **Garage / pool room** — see §3.

---

## 3. The garage. This is the part most likely to be built wrong.

**VERIFIED, both houses:**

1. **The garage bays face the STREET, not the back yard.** `g-tB35IKluv0g-011` (orange):
   standing inside the garage looking out through an open bay across a **crazy-paving
   flagstone driveway** to the street, with the Nuketown coach and the far side of the map
   beyond. `g-tB35IKluv0g-143` (white): the same, looking out of an open bay at the coach
   and both spawn markers. `f-FKQOEO-1ceE-091` (orange): stepping out of the bay onto the
   street with the coach and the Nuketown diner sign ahead.
2. **Two bays, and one of them is normally shut.** In every garage frame there is one
   open bay and one **pale-green ribbed sectional door in the closed position** beside it:
   `f-FKQOEO-1ceE-070`, `-090`, `g-tB35IKluv0g-011`, `-085`, `f-mGpZaLy5_hM-030`,
   `g-VfcKHcDJXpM-171`, `-206`.
   → `GARAGE_BAYS = 3` in `layout.ts` is **not supported by any frame**. Build two.
3. **The garage is enterable from inside the house, through a door into the KITCHEN.**
   - Orange: `g-tB35IKluv0g-023` — the camera is in the garage doorway (a rough concrete
     floor edge and a pale-green jamb in the bottom-left corner) looking through into the
     yellow kitchen, past the dining table, and on into the living room.
   - White: `g-VfcKHcDJXpM-122` — standing in the garage with the green back-lit display
     shelving on the left and a chequer-tile / tread-plate floor, looking through an open
     internal doorway into the kitchen (blue base units, white worktop, sink, fridge).
   VERIFIED both. So the answer to "is the garage enterable from inside the house, from
   the street, or both?" is **both**, in both houses.
4. **There is also a pedestrian doorway from the garage straight out to the driveway**,
   separate from the vehicle bays. `g-tB35IKluv0g-085` shows, left to right: green display
   shelving, a cased pedestrian doorway with the paved apron and another structure visible
   through it, the open vehicle bay with its sectional door retracted overhead, and the
   second, closed sectional door. VERIFIED (white house).

**The asymmetry — the two garages are not the same room:**

- **Orange garage:** a wall of white built-in cupboard doors, exposed rustic timber/steel
  beams, a strip light, a ball hanging in a net from the ceiling, a plain concrete floor.
  No pool. `f-FKQOEO-1ceE-070`, `-089`, `-090`, `g-tB35IKluv0g-011`. VERIFIED.
- **White garage:** contains an **indoor swimming pool** — a rectangular sunken pool with
  pale turquoise water, white tiled coping and a large painted "2" on the pool floor —
  immediately inside the closed second bay. Also: three white-and-blue "Nuka Energy"
  vending machines along one wall, a run of **green back-lit display shelving**, a small
  window, a modern downlit ceiling on slim beams, and a blue/white/grey chequered floor
  pattern.
  `g-tB35IKluv0g-091` (pool, vending machines, shelving, crates in one frame),
  `f-mGpZaLy5_hM-030` (pool and the closed sectional door in one frame, ~2 m apart),
  `g-VfcKHcDJXpM-171` (pool with the "2", closed sectional door filling the right half),
  `g-tB35IKluv0g-085`, `-105`, `-108`, `-117`, `-131`, `-133`. VERIFIED.
  I looked at `g-tB35IKluv0g-091` at native resolution and at 4× on the pool region:
  it is water, with dropped weapons floating on the surface and a tiled coping — not a
  car bonnet, which was my first reading and was wrong.

  *Why this matters:* the pool is a hole in the floor of the most-used ground-floor room
  in the map. It changes pathing, it is a death trap for a bot navmesh, and it is the
  single most recognisable interior detail in Nuketown 2025 that our build does not have.

**Attribution of the pool garage to the white house** rests on two independent chains:
- `f-mGpZaLy5_hM-086`/`-087` (garage: green sectional door, blue "…Energy" vending unit)
  → `-088` (the stair with the magenta discs = white house) → `-089`/`-090` (the purple
  bedroom = white house, curved curtain wall). Three clip-consecutive frames, ~9 s.
- `g-VfcKHcDJXpM-122`: the green-shelving room's internal door opens onto the **blue/white**
  kitchen, which is the white house's kitchen, not the yellow one.
VERIFIED with the caveat that the first chain is a 9-second window, not a continuous shot.

---

## 4. Upper floor

### 4.1 Orange house

- **A gallery landing that is open over the living room.** `f-mGpZaLy5_hM-058`: the
  camera is at upper-floor height behind a timber handrail, looking *down* into the
  living room (the picture-gallery wall and a mannequin are below). `f-mGpZaLy5_hM-049`
  confirms the reciprocal: climbing the stair you can see past the balustrade into the
  lit room below-left. VERIFIED. This is a two-storey void, and it is the reason a player
  upstairs can hear/see the front door.
- **Terracotta room with a picture window.** Terracotta/salmon walls, **dark timber
  floor**, a large patterned rug, two small square wall reliefs, a shelf with a potted
  plant, a big window on one side, an opening to the next room on the other.
  `f-mGpZaLy5_hM-053`, `-051`. VERIFIED.
- **Sitting room.** Pale cream walls with a large abstract mural, an **orange egg chair
  and an orange chaise**, an oval mirror, dark timber floor. `f-mGpZaLy5_hM-045`. VERIFIED.
- **Built-in geometric open shelving** (a grid of open boxes) against a terracotta wall,
  beside an opening to the next room. `f-mGpZaLy5_hM-057`, `-014`. VERIFIED.
  - Cover value: the shelving is the only waist-high hard cover upstairs; everything else
    is a wall corner or a window reveal.
- **Street-facing sniping positions.** `f-mGpZaLy5_hM-046`, `-050`, `-052`, `-069`: the
  player sits back from an upper-floor window and covers the street and the far house's
  front. VERIFIED that the orange upper floor overlooks the street; whether the shot is
  from a window or from an open balcony is UNKNOWN from these frames.

### 4.2 White house

- **Purple bedroom, in the rounded capsule end.** Purple diamond-pattern wallpaper,
  purple carpet, and a **full-height curtain wall that follows the curve of the rounded
  end wall** with a window opening in it. A single bed on a yellow rug, a built-in cream
  headboard unit with shelves and a reading light, round wall speakers, a canopy bed, a
  side table with a lamp. `g-1icNQzMgLUM-249` (the curve is unmistakable), `-256`,
  `-258`, `-263`, `f-aICKIbuo8zQ-101`–`-109`, `f-mGpZaLy5_hM-089`, `-090`. VERIFIED.
- **Pale-green room, adjacent, through a doorway from the purple bedroom.** Vertically
  striped pale-green wallpaper, a grey-green floor with a large circular-pattern rug, a
  starburst clock, a yellow artwork, a window/opening onto the outside with a rail beyond.
  `g-1icNQzMgLUM-256` (the green room seen through the bedroom doorway), `-263`,
  `f-aICKIbuo8zQ-024`. VERIFIED.
- **A street-facing upper balcony.** `g-1icNQzMgLUM-187`: from upper-floor height, over a
  horizontal metal rail in the bottom of frame, looking down on the turning circle, the
  coach, a teal car, a red car and the orange house's facade at the right edge. VERIFIED
  that there is an upper-level open position overlooking the whole street; VERIFIED that
  it is the best sightline in the map.
- **Window camping spots (VERIFIED as used by players in these clips):**
  1. The white house's street-facing upper opening — covers the circle, both spawn areas
     and the orange house's front door (`g-1icNQzMgLUM-187`, `-089`).
  2. The purple bedroom's curved-wall window — covers the street at a shallow angle
     (`f-mGpZaLy5_hM-089`, `-090`, shooting through the curtains).
  3. The orange upper-floor window band — the reciprocal of (1)
     (`f-mGpZaLy5_hM-046`, `-050`, `-052`).
  4. Ground floor: inside the garage looking out of the open bay, covering the driveway
     and the street (`g-tB35IKluv0g-011`, `-143`, `f-FKQOEO-1ceE-090` places a Guardian
     turret in exactly this spot).

### 4.3 Getting to the upper floor

There are **two ways up in each house**, which is the single most important thing this
document adds:

1. **The internal stair** (§2.2, §2.3).
2. **An external open-tread staircase from the back yard up to a rear deck at
   upper-floor level.** VERIFIED for both houses:
   - Orange: `g-1icNQzMgLUM-102` (orange-painted steel handrail and X-braced deck
     balustrade, treads open, rising from the yard's concrete apron), `f-aICKIbuo8zQ-179`.
   - White: `f-mGpZaLy5_hM-097` (grey open treads, glass/metal balustrade, up to a glazed
     upper landing under the curved roof), `f-aICKIbuo8zQ-201`, `g-1icNQzMgLUM-246`,
     `-176`, `f-mGpZaLy5_hM-022`, `f-FKQOEO-1ceE-192`.
   The deck is at upper-floor level and the ground beneath it is the open undercroft.
   `DECK_Y = FLOOR_H` in `layout.ts` is right.

**Consequence for our build:** a player must be able to go back-yard → external stair →
deck → upper floor without entering the ground floor at all. If our houses only have an
internal stair, the whole back-yard flank plays wrong.

---

## 5. What I could NOT establish

- **Where in the plan each internal stair sits** (which wall it runs along, and whether it
  climbs toward the street or toward the yard). The frames show the flight and what is at
  its head, never the stair and an exterior wall in the same shot. UNKNOWN. The §6 plan
  puts it against the back half of the main block; that is a guess with a falsifier.
- **Whether the ground-floor back room connects internally to the kitchen/living room, or
  only to the undercroft.** UNKNOWN.
- **Exact bay widths, pool size, room dimensions.** No frame gives a scale reference I
  trust. Everything in §6 is proportioned from `layout.ts`, not measured.
- **Whether the orange house's street-facing upper opening is a window or a balcony.**
  UNKNOWN.
- **The dark chevron-roofed building** at the top of `nt2025-aerial-boii.png`
  (aerial x 780–1290, y 60–400, two big white skylights, its own driveway and red car) is
  a **third structure**. From the circle it lies ~75° off the house-to-house axis, and the
  official minimap's playable polygon contains only two building masses, so I read it as
  out-of-bounds scenery. INFERRED, not verified — but it is worth knowing it exists,
  because it is easy to mistake for one of the two houses when reading the aerial.

---

## 6. Proposed plan in OUR coordinates

Using `src/core/layout.ts` constants only. `FRONT_LAWN_OUTER = 15.4`,
`HOUSE_BACK = 26.6`, `HOUSE_HALF_LEN = 6.4`, `FLOOR_H = 3.15`, `UPPER_H = 3.05`,
`GARAGE_LEN = 4.8`, `GARAGE_DEPTH = 7.4`, `DECK_LEN = 6.0`, `DECK_OUT = 3.4`.

Written for the **ORANGE** house (`side = -1`, front wall at `z = -15.4`, back wall at
`z = -26.6`, garage wing at `x ∈ [-11.2, -6.4]`). The white house is the same plan with
`x → -x, z → -z` **if** the rotational-pair invariant survives §7; if it does not, it is
the same plan with `z → -z` only.

### 6.1 Ground floor, y ∈ [0, 3.15]

| element | our coordinates | confidence | falsifier |
|---|---|---|---|
| Living room | `x ∈ [-1.0, 6.4]`, `z ∈ [-15.4, -21.2]` | INFERRED (room exists VERIFIED; extent guessed) | a frame showing the living room's full width against a known wall |
| Front sliding door | centred `x = ORANGE.frontDoorX` (+1.54), in the `z = -15.4` wall, 2.4 m wide, full height | VERIFIED it exists and is full-height glazed; x position INFERRED from `layout.ts` | a frame showing the door and a house corner together |
| Kitchen / diner | `x ∈ [-6.4, -1.0]`, `z ∈ [-15.4, -21.2]` | INFERRED | as above |
| Cased opening living↔kitchen | at `x = -1.0`, `z ∈ [-16.4, -19.0]`, 2.6 m wide, header at 2.3 m | VERIFIED (wide square-headed opening, `f-mGpZaLy5_hM-005`); position INFERRED | a frame showing the opening and both exterior walls |
| Kitchen units | run along `x = -6.4` from `z = -15.8` to `z = -20.4`, 0.95 m high, 0.65 m deep | VERIFIED (units + hood + pendant) | — |
| Dining table + 3 chairs | centred `(-4.0, -18.0)`, Ø1.1 m | VERIFIED | — |
| Orange sofa | against `x = 6.4`, centred `z = -18.0`, 2.2 m long, 0.85 m high | VERIFIED | — |
| Egg chair + low table + rug | around `(3.0, -19.0)` | VERIFIED | — |
| Tall closet block | `x ∈ [-1.0, 0.6]`, at `z = -20.4`, full height | VERIFIED it exists at one end | — |
| **Garage** | `x ∈ [-11.2, -6.4]`, `z ∈ [-15.4, -22.8]` | VERIFIED as a street-facing garage wing | — |
| Garage bays | **two**, each 2.4 m wide × 2.3 m high, in the `z = -15.4` wall at `x = -10.4` and `x = -7.6`. Bay at `x = -7.6` open; bay at `x = -10.4` closed with a ribbed sectional door | VERIFIED (two bays, one closed); which bay is open INFERRED | a frame showing both bays and the house corner |
| Garage pedestrian door | in the `z = -15.4` wall at `x = -11.0`, 1.0 m wide | VERIFIED it exists (`g-tB35IKluv0g-085`); position INFERRED | — |
| **Garage → kitchen door** | in the `x = -6.4` wall at `z = -18.2`, 1.0 m wide | VERIFIED it exists (`g-tB35IKluv0g-023`, `g-VfcKHcDJXpM-122`); position INFERRED | a frame showing that door and the garage's street bay together |
| Stair hall | `x ∈ [1.8, 6.4]`, `z ∈ [-21.2, -26.6]` | INFERRED | see §5 |
| Internal stair | straight flight, 12 risers × 0.2625 m, going 0.27 m; from `(4.2, -21.6)` climbing to `(4.2, -24.8)` at `y = 3.15`; open on the `x = 1.8` side with a 1.0 m timber balustrade | VERIFIED shape and open side; VERIFIED 12 risers ±1; position and direction INFERRED | a frame showing the stair with an exterior window in the same shot |
| Back room | `x ∈ [-6.4, 1.8]`, `z ∈ [-21.2, -26.6]` | INFERRED | — |
| Back door | in the `z = -26.6` wall at `x = ORANGE.backDoorX` (−2.05), 1.1 m wide | VERIFIED it exists under the deck; x INFERRED from `layout.ts` | — |
| Undercroft | open, `z ∈ [-26.6, -30.0]` under the deck, 4 posts 0.35 m square, rubble-stone dado 1.1 m high on the `z = -26.6` wall | VERIFIED | — |

**White house only:** the second garage bay is an **indoor pool**, sunken 1.4 m, water at
`y = -0.15`, roughly 5.0 × 2.6 m, its long axis parallel to the street wall, coping
0.35 m wide. Green back-lit display shelving 1.6 m long on the wall opposite the vending
machines; three vending machines 0.9 m wide each along the other wall. VERIFIED as
contents; dimensions INFERRED.
*Falsifier:* any frame showing a player walk across where we put the pool.

### 6.2 Upper floor, y ∈ [3.15, 6.20]

| element | our coordinates | confidence | falsifier |
|---|---|---|---|
| Gallery void over the living room | `x ∈ [1.8, 6.4]`, `z ∈ [-16.8, -20.4]` open to below, 1.0 m timber rail on the `x = 1.8` edge | VERIFIED a void + rail exists (`f-mGpZaLy5_hM-058`) | a frame showing the whole upper floor solid |
| Front room (terracotta, picture window) | `x ∈ [-6.4, -0.5]`, `z ∈ [-15.4, -20.6]`, window band in the `z = -15.4` wall | VERIFIED the room; position INFERRED | — |
| Sitting room (orange chaise + egg chair) | `x ∈ [-0.5, 6.4]`, `z ∈ [-20.6, -24.0]` | VERIFIED the room; position INFERRED | — |
| Built-in shelving | against `x = -0.5` at `z = -22.0`, 2.0 m long × 2.2 m high | VERIFIED | — |
| Rear deck | `x` centred on `ORANGE.deckX` (+3.4), `DECK_LEN` 6.0, projecting `DECK_OUT` 3.4 beyond `z = -26.6`, rail `RAIL_H` 1.05 | VERIFIED a rear deck at upper level exists | — |
| External stair | from the deck's outer edge down to the yard, 12 risers, landing on the concrete apron at `z ≈ -30.4` | VERIFIED it exists; which end it starts from is **CONTRADICTED**, see §7 | §7 |
| Door deck → upper floor | in the `z = -26.6` wall at `x = 3.4`, 1.0 m | INFERRED | a frame of the deck showing its door |

**White house upper floor:** same envelope, but the room in the rounded end is the
**purple bedroom** (its outer wall must be curved, with the curtain wall following the
curve and a window opening in it — `g-1icNQzMgLUM-249` is the reference frame), and the
adjacent room is the **pale-green** one. The street-facing opening onto the balcony
(`g-1icNQzMgLUM-187`) sits over the front porch canopy.

---

## 7. The 180° rotational pair: **NOT CONFIRMED, and one test refutes it**

`AGENTS.md` states the project's one invariant: *"From either back yard, facing your own
house, the garage is on your RIGHT. The two houses are a 180° rotational pair, not a
mirror pair."* The brief asked me to confirm or refute it against the frames. I cannot
confirm it, and the cleanest available test currently **refutes** it. Here is exactly what
I have, so the next lane can finish the job rather than re-do it.

**Why the test is valid.** For a true 180° rotational pair, a player standing in their own
back yard facing their own house sees an *identical* scene in both yards — same features
on the same side. For a mirror pair, the two scenes are left-right flipped. The external
back stair is the strongest handedness cue in the map, because it is large, unambiguous,
and visible from the whole back yard.

**The evidence.**

| frame | house (by cladding) | where the TOP of the external stair is |
|---|---|---|
| `g-1icNQzMgLUM-102` | orange (terracotta panels, orange-painted balustrade, rubble-stone dado) | **RIGHT** |
| `g-1icNQzMgLUM-246` | white (white render, curved overhanging roof, grey stair) | **LEFT** |
| `f-mGpZaLy5_hM-022` | white | **LEFT** |
| `f-FKQOEO-1ceE-192` | white | LEFT (partly out of frame) |
| `f-aICKIbuo8zQ-179` | **orange** (orange curtain wall, rubble-stone dado, glass X-braced deck rail) | **LEFT** |

`g-1icNQzMgLUM-102` and `-246` are **from the same clip and the same match**, seconds
apart, same encode, same settings — the least confounded comparison available. They show
**opposite** handedness. On its own that says **mirror pair, invariant refuted**.

But `f-aICKIbuo8zQ-179` shows the *orange* house's back with the stair top on the LEFT,
which contradicts `g-1icNQzMgLUM-102`. One of three things is true and I could not
determine which:

1. `f-aICKIbuo8zQ-179` is actually the white house and I mis-read the cladding (it has an
   orange curtain wall *and* a rubble-stone dado, both of which I attributed to orange).
2. `g-1icNQzMgLUM-102` is not a back-yard view — it could be a side passage looking back
   along the house, which would flip the apparent handedness.
3. A house has features at both ends and I am comparing different faces.

**Status: CONTRADICTED. Do not encode either answer yet.**

**Falsifier — the cheapest way to settle it (in priority order):**

1. One frame, or one short capture, that contains **both back yards in a single shot**
   (an aerial killcam, a care-package plane view, or a Combat Training spectator flyover).
   If the two stairs mirror each other about the street, it is a mirror pair; if they are
   point-reflections, it is a rotational pair.
2. Or: in a Steam BO2 local/Combat-Training match on Nuketown 2025, stand in each back
   yard on the house's centre line, face the house, screenshot. Two screenshots settle it
   permanently. **The owner was using the machine when this lane ran, so I did not launch
   the game** — this is the right first job for whoever can.
3. Or: re-fetch gameplay specifically searching for *back yard* footage of both houses in
   the same clip, into `docs/reference/gameplay-interiors/` with a `SOURCES.md`. I did not
   fetch anything new; the existing 1371 frames already contain both yards, just never in
   one shot.

**Until it is settled**, `garageIsOnTheRight()` in `layout.ts` is an *assumption we chose*,
not a measured fact. Keep deriving it in one place — that part of the design is right,
and it means a single sign flip fixes the whole map if the answer comes back "mirror".

One thing the frames *do* support either way: **the garage is at the opposite end of the
house from the rear deck and its external stair.** That is consistent with the aerial
(the orange house's carport wing at aerial (610–1000, 510–670) is at the far end from the
rear-deck side) and with `layout.ts` already placing `deckX` opposite `garageX`. INFERRED.

---

## 8. Concrete deltas for whoever builds this

Ordered by how much they change play, not by how hard they are.

1. **Add the external back stair and the rear deck as a real route.** Two ways up per
   house. Currently the brief implies only the internal stair. (§4.3, VERIFIED)
2. **Make the garage open onto the STREET and put a door from the garage into the
   kitchen.** Both houses. (§3, VERIFIED)
3. **Two garage bays, not three**, one of them shut with a ribbed sectional door.
   Change `GARAGE_BAYS` to 2 and widen `GARAGE_LEN` — 4.8 m will not take two 2.4 m bays
   plus jambs; ~6.2 m will. (§3, VERIFIED; the width is a calculation, not a measurement)
4. **Put the swimming pool in the white house's second garage bay.** It is the most
   recognisable interior feature in the map and it is a real hole in the floor — get it
   into the collision world and the bot navmesh, not just the art. (§3, VERIFIED)
5. **One wide cased opening between living room and kitchen, not a door**; a full-height
   glazed sliding door in the street wall; a back door under the undercroft. (§2.1,
   VERIFIED)
6. **Open the upper landing over the living room** as a two-storey void with a rail.
   (§4.1, VERIFIED)
7. **Give the white house's upper rooms a curved outer wall** in the capsule end — the
   purple bedroom's curtain wall follows an arc, and that curve is what makes the room
   read as Nuketown 2025 rather than a generic box. (§4.2, VERIFIED)
8. **Do not resolve the handedness invariant from this document.** Run the §7 falsifier
   first.

---

## 9. Method, and what it cost

- Built 20 labelled contact sheets covering all 1371 frames (80 per sheet, 150 px tiles)
  and opened every one, to triage interior frames out of 1371 without opening 1371 images.
- Opened ~90 frames as side-by-side composites at 760–900 px with their HUD minimaps
  enlarged 3×, and ~10 frames at native 1600 px, plus four 4× crops of specific details
  (the pool, the stair directions, the aerial's two houses).
- Numerically extracted the two house footprints from `nt2025-minimap-boii.png` by row
  scanning at threshold 150, and ran a normalised-cross-correlation test of the
  rotational-pair hypothesis against the mirror hypotheses. **The correlation test was
  inconclusive** (rot180 0.291, flipY 0.322, flipX 0.339, translate 0.299 — all low and
  all within noise of each other) and I am reporting it as inconclusive rather than
  reading a winner out of a 0.05 gap. The one suggestive detail: the rot180 match placed
  the implied centre of symmetry at minimap (269.5, 277.5), against the independently
  measured turning-circle centre of (271, 281) — 3.7 px, 0.7 m. That is a point in favour
  of the rotational reading, and it is not enough on its own.
- **Fetched no new footage.** The existing frames answered every question except §7, and
  §7 is better answered by two screenshots from the installed Steam copy than by another
  300 YouTube frames. No `docs/reference/gameplay-interiors/` was created.
- No process was spawned outside Python/PIL in the scratchpad. No browser, no vite, no
  Chrome, no game launch.
