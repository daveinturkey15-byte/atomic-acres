# Nuketown 2025 — build spec

Target: **Black Ops 2 `Nuketown 2025`** (tag **BO2-2025**). Not BO1 Nuketown, not
Nuketown '84, not the BO6/BO7 versions. Those are controls only.

Everything is **built in code**. No downloaded meshes, no downloaded textures, no assets
copied from any previous project. Textures are drawn procedurally on a canvas.

---

## 1. What the map actually is

A **retro-futurist 1960s "world of tomorrow" show town** dropped in the desert as a
nuclear test target. Bright hazy daylight, bleached concrete, saturated accent colours,
blue-grey mountains and a hazy city skyline on every horizon. It is *not* the drab
1950s tract-housing of BO1 Nuketown. Two modernist show homes face each other across a
short street; a lollipop cul-de-sac closes one end; the road runs off-map at the other
toward an entrance plaza with a neon pylon sign, a geodesic dome, a flying-saucer house
and a space-needle tower.

The playable space is **small** — spawn to spawn is about 60 m. Everything is close.

---

## 2. Frame and layout (authoritative: `src/core/layout.ts`)

y-up, right-handed. Plan seen from above: **+x right of page, +z down the page**.

```
      -x  <==================  STREET AXIS  ==================>  +x
 (road stem runs off-map,                          (CUL-DE-SAC end: turning head,
  open end, toward the plaza)                       boundary fence, THIRD HOUSE beyond)

 ~~~~~~~~~~~~~~~~~~~~~~ out of bounds ~~~~~~~~~~~~~~~~~+--------------+
                                                       | THIRD HOUSE  |
 ========== back fence (holes) ========================| drive + red  |
  -z    TEAM A BACK YARD  =  SPAWN A                   |    car       |
        glasshouse . cold frames . crate store         +--------------+
        curved-roof carport . circular patio . stepping stones
                                                  rear deck |+ stair down
  +-----------+------------------------------------------+---+
  |  GARAGE   |          ORANGE  HOUSE   ( -z )           |###|
  | 3 barrel  |  terracotta upper wall / cream lower      |   |
  | vault bays|  butterfly roof + solar panels            |   |
  +-----------+------------------------------------------+---+
    apron           [RED 3-unit appliance bank]    porch canopy
 ------------------------ kerb / pavement ----------------------------
                                        [ COACH ]        _ - - - _
  ROAD  [green classic car]                             /  TURNING \
                                        [ TRUCK ]      |    HEAD    |
                                        [dk saloon]     \ _ - - - _/
 ------------------------ kerb / pavement ----------------------------
                  [BLUE 3-unit appliance bank]                 apron
  +---+------------------------------------------+-----------+
  |###|       WHITE / CREAM  HOUSE   ( +z )       |  GARAGE   |
  |   |  rounded modernist capsules, blue trim    |           |
  +---+------------------------------------------+-----------+
    |
  stair down + rear deck
       garden pod . sand pit . shuffleboard court . stepping stones
  +z    TEAM B BACK YARD  =  SPAWN B
 ========== back fence (holes) =======================================
```

### The one invariant

**From either back yard, facing your own house, the garage is on your RIGHT.**
This is a **180-degree rotational pair, not a mirror pair**. `layout.ts` derives this
(`garageIsOnTheRight`) rather than hardcoding a sign. Do not break it.

### The cheap chirality anchors

- Front lawns carry a three-unit appliance bank: **RED tops on the orange house's lawn,
  BLUE tops on the white house's lawn.**
- The two back yards are **different, not mirrored dressing**: orange gets
  glasshouse + cold frames + curved-roof carport + crate store + circular patio;
  white gets garden pod + sand pit + shuffleboard court.
- The **third house with the red car on its drive** sits past the boundary fence at the
  `+x` cul-de-sac end. It is the single best landmark for telling the ends apart.

---

## 3. What I saw in each reference frame

I opened each of these in a browser and looked at it. These are my reads, not prose from
a wiki. Where something is not visible in a BO2-2025 frame it is marked **OPEN** and you
should build the cheapest plausible thing rather than inventing detail.

### NT02 `Nuketown_2025_Aerial_View_BOII.jpg` — the plan
Near-top-down over the whole map, rotated roughly 45°. Confirms:
- a **circular kerbed turning head** mid-frame with vehicles standing on it, and a
  straight road stem leaving it;
- the **third house** beyond the head: dark pitched roof, two big white window bands,
  its own driveway with a **red car** on it;
- **bright saturated lawns with a visible mow-stripe checker** — this reads strongly
  from above and is worth getting right;
- pale concrete apron surrounding everything, then out of bounds;
- the orange house's back yard carries a **white curved-roof carport** and planting beds
  with red flowers; the white house's yard carries a **tan sand pit** and a green court;
- street lamps, clipped hedges and chain-and-post edging along the verges.

### NT03 `Nuketown_2025_BOII.jpg` — the orange house from its own back yard
Small (640x345) but decisive. **This is the owner's viewpoint.** Shows:
- a dramatic **swooping butterfly roof**, cream/white, sweeping upward toward the
  garage end with a deep cantilever;
- **terracotta / burnt-orange upper storey** with a band of tall narrow windows under
  the roof, over a **cream ground floor**;
- **dark solar panels** laid on the low part of the roof;
- a **wooden exterior staircase on the LEFT** climbing to a railed deck at upper-floor
  level, with a circular patio at the foot of the flight;
- **dark barrel-vault garage bays on the RIGHT** (garage-right / stair-left confirmed);
- a maroon **hyperbolic-paraboloid pylon** structure away to the left (plaza edge);
- mountains, a hazy low city skyline, and big rounded deciduous trees behind.

### NT04 `Nuketown_2025_Sniper_BOII.jpg` — orange house street elevation, eye level
The best close look at materials:
- terracotta upper wall is **panelised**, with a band of **tall narrow windows with
  vertical mullions** that **curves around the corner**;
- a **cream curved roof fascia** sweeps over the top of the wall;
- a **grey concrete pilaster** breaks the elevation;
- the **appliance bank** is at ground level on the lawn: a tall red/pink cabinet with
  white panels and chrome trim — retro fridge/cooker styling, about chest height;
- **bright green lawn** meets **pale concrete paving with big slabs**;
- **chain-and-post edging** (short dark posts with slack chain) along the lawn edge;
- a **tan timber picket fence** and clipped dark hedges behind;
- to the right a **deep flat cantilevered eave** over a concrete deck — the porch canopy.
  Build it as a **cantilever off the house**, not a canopy on two posts.

### NT05 `Nuketown_2025_Load_Screen_BOII.png` — the entrance plaza, off the -x end
The atmosphere reference:
- the **"Nuketown" pylon sign**: pink/maroon neon script over
  *Discover the City of the Future*, on a two-post trapezoid frame, topped with a
  **maroon atom-and-orbit sphere**; a **teal oval badge** hangs below the script;
- a **cream-and-maroon vintage tour coach**, chrome trim, riveted panels;
- a **teal/turquoise 1950s classic car** with heavy chrome and whitewall tyres on a
  display plinth with an info placard; a maroon 50s car behind it;
- a **flying-saucer house** on legs, cream with a dark window band;
- a **geodesic dome**, a **space-needle tower**, rows of **flags on poles**;
- **mannequins** — one in a purple/magenta shift dress on the pavement;
- street lamps with curved orange tops; manhole covers; tan picket fencing.

### NT07 `Nuketown_2025_review_photo_BOII.jpg` — the coach
Cream/silver body with a **maroon swoosh** along the flank, chrome belt trim, riveted
panels, round headlights, chromed wheel arches, "Nuketown" script on the side. A 1950s
Greyhound-style intercity coach — **not** a yellow school bus (that is BO1).

### OPEN items — do not invent
- Exact hex colours. Nothing above is colour-calibrated. `palette.ts` picks *within*
  the observed families.
- The under-window **front ledge** on the street elevation — no BO2-2025 frame in the
  set shows a house street face at eye level other than NT04, which does not resolve it.
- **Mailboxes** — not visible along either verge in the aerial at native resolution.
- Exact inset of the turning head from the map edge.

---

## 4. Module contract

Each builder owns **exactly one file** in `src/build/` and exports **one function**:

```ts
import type { Builder } from '../core/kit';
export const buildThing: Builder = (ctx) => { ... return { group, colliders }; };
```

Rules, all of them enforceable by reading the diff:

1. **Import every dimension from `../core/layout`.** Never write a bare number for
   anything that positions geometry relative to the street, a house or a yard. Local
   detail sizes (a handle, a slat pitch) may be literals.
2. **Colours come from `../core/palette` (`PAL`).** No inline hex.
3. **Materials come from `ctx.mat`.** Never construct a `MeshStandardMaterial` in a
   builder — that is how the old project ended up recompiling programs at runtime.
   If you need a plain colour use `ctx.mat.painted(PAL.x)`.
4. **Never touch the scene, camera, renderer, lights or another module's file.**
5. **Return real colliders** for anything the player must not walk through. Use
   `aabb` / `aabbSlab` from `kit`. Do not return a collider for decorative
   sub-centimetre detail.
6. **No `Math.random()` at build time** — use `ctx.rand()` so the world is deterministic.
7. **Keep the file under ~400 lines.** If it wants to be bigger, the shapes are too
   literal — simplify the silhouette.
8. **Geometry counts**: prefer `InstancedMesh` for anything repeated more than ~20 times
   (pickets, chain posts, stepping stones, panes). Total scene target is under
   **1200 draw calls** and under **900k triangles**.
9. **Nothing floats and nothing intersects a wall.** Sit things on the surface they
   belong to.

## 5. Quality bar

The map must read as **Nuketown 2025 at a glance from the spawn**: you should be able to
stand in either back yard and immediately know which house is yours, where the garage
is, and which end the cul-de-sac is. Silhouette and colour block first; small props last.
