# Nuketown 2025 — Concept Quality Bar (CONCEPT-BAR)

Target: **BO2-2025 only.** Not BO1, not '84, not BO6/BO7.
Status of `docs/reference/concept/manifest.json`: **not present at time of writing**
(sibling Lane A may still be generating). This bar is deliberately **useful without
images** — every statement below is actionable from text alone.

How to use this file: each subject area has five lenses —
**(a)** material behaviour, **(b)** value composition, **(c)** silhouette and detail
density, **(d)** colour relationships, **(e)** what currently reads as "clean shapes"
rather than "a photographed place". Statements are falsifiable on purpose: a builder
can implement them, a critic can check them in a capture.

Global notes that apply everywhere:

- Palette values in `src/core/palette.ts` are **picks within observed families, not
  calibrated droppers** (SPEC section 3). Never treat a hex here or there as ground
  truth. Judge families and relationships, not numbers.
- SPEC OPEN items are **not mandated** anywhere below: no front-window ledge
  requirement, no mailboxes, no exact turning-head inset dimension, no calibrated hex.
- Light is harsh desert noon: sun near-overhead, shadows short and dark, sky bounce
  strong. Speculars are small and hard, ambient occlusion lives in corners and under
  eaves, never as a global wash.

---

## 1. Orange butterfly-roof house (−z house)

Reference reads: SPEC NT03 (owner viewpoint from own back yard), NT04 (street face),
NT02 (plan: white curved-roof carport, red-flower beds).

**(a) Material behaviour.** Terracotta upper wall: painted timber/concrete panels,
roughness ~0.7–0.85, almost no specular except a weak sheen at grazing angles;
panel joints are the only gloss break. Cream ground floor and roof fascia:
smooth stucco, roughness ~0.5–0.65, picks up a soft sky specular on the fascia
curve. Window glass: roughness ~0.08–0.15, must return sky (pale blue-grey), never
near-black at noon. Solar panels on the low roof slope: roughness ~0.25–0.35 with a
hard rectangular glint per cell. Timber stair/deck: roughness ~0.75, anisotropic
streak along the board, no mirror highlight. Dirt: dust films on the cream ground
floor in the bottom ~150 mm above grade and on stair-tread nosings; terracotta
collects streak grime **below** each window sill, not uniform darkening; fascia
leading edge collects a thin grey insect/dust line.

**(b) Value composition.** Brightest: roof fascia and cream ground floor in full sun
(~85–90% lightness). Darkest: solar panels, barrel-vault garage interiors, window
reveals in shadow (~10–20%). Terracotta upper sits mid (~45–55%) and is the
mid-tone anchor of the whole street. Contrast budget: sun-side fascia to shaded
ground-floor recess must span at least 4:1 luminance; terracotta sun-to-shadow on
the same wall at least 2.5:1, or the wall reads as flat paint.

**(c) Silhouette and detail density.** At 40 m the read is: deep butterfly-V roof
sweep rising toward the garage end, cantilevered eave line, dark barrel vaults as
one mass, stair as a diagonal. Nothing else may compete with the V. At 2 m the
read is: panel joints on the terracotta, vertical mullion rhythm of the tall narrow
windows, stair baluster spacing, deck-board gaps (~8–12 mm shadow lines). Panel
joints must be actual recessed grooves (≥15 mm deep in shadow), not texture lines —
at noon a groove throws a line shadow; a painted line does not.

**(d) Colour relationships.** Accent-to-neutral: terracotta covers roughly 30–40% of
the street/back elevation; everything else (cream, white roof, pale paving) is
neutral. Blue appears **only** as sky reflection in glass from this house — no blue
paint on the orange house. What never saturates: the cream ground floor (keep
chroma low; if it goes yellow the whole house looks dirty, not sunny).

**(e) Clean shapes vs photographed place.** Today the rear reads as flat cream box +
flat orange band + white lid. What would photograph: (1) a shadow gap between upper
terracotta and cream lower (the floors must read as separate construction);
(2) mullion shadows thrown **onto** the glass at noon; (3) the deep cantilever
throwing the upper ground-floor wall into real shade. A house with no shaded recess
under a deep eave cannot photograph as a place.

---

## 2. White streamline-capsule house (+z house)

Reference reads: NT02 plan (tan sand pit, green court in its yard); stations note:
rounded capsule volumes, blue-grey roof glazing, rooftop drum.

**(a) Material behaviour.** Capsule white: gel-coat smooth stucco/fibreglass,
roughness ~0.35–0.5 — the **glossiest large wall on the map**, with a broad soft
sky sheen on every curve. Blue trim bands: enamel, roughness ~0.3, mild specular
streak. Roof glazing: roughness ~0.1–0.2, sky mirror with mullion grid breaking it.
Rooftop drum: matte metal, roughness ~0.6–0.7. Dirt: white shows everything, so
dirt must be localised — splash-back stipple in the bottom ~100 mm, streak below
each sill and below the drum base ring, hand-touch darkening on deck rails only.
Never a global beige overlay.

**(b) Value composition.** Brightest on the map: sunlit capsule curve (~90%+).
Darkest: window band interiors and drum shadow side (~15–25%). Blue trim sits just
below mid (~50–60%) and is the value step that traces the curve — if trim and wall
are too close in value, the streamline read collapses at distance.

**(c) Silhouette and detail density.** At 40 m: one continuous horizontal speed-line
— rounded corners, unbroken blue belt trim wrapping the curve, flat glazed roof
disc. No vertical element may break the belt. At 2 m: trim edge sharpness (a crisp
6–10 mm step shadow), window gasket lines, roof-edge drip bead. Curves must be
faceted no coarser than ~5° per segment or highlights band visibly.

**(d) Colour relationships.** White dominates (~70% of the elevation); blue trim is
the single accent (~10–15% by area) plus transient sky blue in glass. No red, no
terracotta, no timber colour on this house except the rear deck boards. What never
saturates: the white itself — chroma stays near zero; warmth comes from sun, not
from the paint.

**(e) Clean shapes vs photographed place.** Today the capsule already curves, but
the trim reads as painted stripes on a tub. What would photograph: (1) trim as a
raised/rebated band with its own highlight and shadow edge; (2) glass set back
≥50 mm behind the white skin so reveals throw shade; (3) the roof disc visibly
thinner than the body (a lid, not a slice of the same extrusion).

---

## 3. Cul-de-sac + coach

Reference reads: NT02 (circular kerbed turning head with vehicles standing on it);
NT07 (coach: cream/silver body, maroon swoosh, chrome belt, rivets, round
headlights, "Nuketown" script — Greyhound-style intercity coach, not a school bus).

**(a) Material behaviour.** Coach paint: enamel, roughness ~0.25–0.4, long soft
body-side highlight; chrome belt trim and wheel arches: roughness ~0.08–0.15, hard
sun glints. Rivet rows: matte dots that catch light only as a stipple line, no
continuous shine. Asphalt of the head: roughness ~0.9, zero specular except a faint
sheen in the wheel-polish arcs. Kerb faces: rough concrete ~0.85 with a darker
grit wash in the bottom 40 mm where grit collects — this line must exist. Dirt:
tyre-polish darkening arcs where the coach and truck habitually stand; oil-drop
dark spots (~100–200 mm) under engine positions; dust drift against the kerb upstand.

**(b) Value composition.** Darkest large plane on the map: the asphalt bulb
(~15–25%). Brightest: coach cream flank in sun (~85%). The coach must pop against
the asphalt at 5:1 or better — that contrast **is** the NT02 read. Kerb ring reads
as a pale ellipse (~70%) framing the dark disc; lose that ring and the head reads
as a car park, not a lollipop.

**(c) Silhouette and detail density.** At 40 m: perfect circle of pale kerb, coach
as a long rounded slab on the −z side, box truck + dark saloon as a blockier mass
on the +z side, third house closing the vista. At 2 m: coach window rubber
gaskets, rivet pitch (~50 mm), destination-blind recess, wheel whitewall ring,
"Nuketown" script as a decal with a hairline shadow. Coach windows sit proud of
the pillars in section — a flat printed window band kills the read instantly.

**(d) Colour relationships.** Coach: ~75% cream/silver neutral, ~15% maroon swoosh,
~10% chrome/glass. Maroon is the only saturated colour allowed to touch the
asphalt in this area. What never saturates: the asphalt (keep chroma ~0), the kerb
(warm grey only), the boundary fence timber behind (mid brown, never orange).

**(e) Clean shapes vs photographed place.** Today the vehicles sit on an unmarked
dark disc like toys on a table. What would photograph: (1) faint white edge-wear
on the kerb nose where tyres kiss it; (2) the oil/tyre marks named above; (3) a
drainage fall readable as a 1–2% sheen gradient toward the outer edge, not a
perfect matte disc.

---

## 4. Entrance plaza + pylon sign (−x end)

Reference reads: SPEC NT05 (load screen): pink/maroon neon script over *Discover
the City of the Future*, two-post trapezoid frame, maroon atom-and-orbit sphere on
top, teal oval badge below script; saucer house on legs, geodesic dome,
space-needle tower, flag rows, curved-orange-top lamps, manholes, tan picket fence.

**(a) Material behaviour.** Pylon sign: painted steel frame roughness ~0.5; neon
script tubes roughness ~0.2 with emissive pink/maroon — at noon the emissive is
subtle (tubes read saturated, not glowing); atom sphere: glossy enamel ~0.3 with a
hard sun glint. Saucer house: cream fibreglass ~0.4 with a dark window band at
~0.15. Dome struts: matte aluminium ~0.55. Dirt: plaza paving dust in joints only;
flag-pole bases carry a rust weep ≤30 mm; sign-frame feet carry splash stipple.
Neon never weathers — tubes are replaced, frames weather.

**(b) Value composition.** Brightest: saucer-house white and needle tower in sun.
Darkest: saucer window band, dome interior triangles (~10%). The sign must read as
a mid-value trapezoid frame carrying a **high-chroma** script — legibility comes
from chroma against sky, not from lightness. Sky behind the sign is ~75–80%, so
the script needs saturation, not brightness, to separate.

**(c) Silhouette and detail density.** At 40 m down the road stem: vertical needle,
tripod/atom sphere, saucer disc on legs — three distinct prongs against the sky.
If any two merge into one blob the plaza fails. At 2 m: script tube standoffs
(~50 mm off the board), badge bolts, flag halyard cleats, dome hub plates. The
atom orbits must be genuinely open rings (see sky through them), never a solid disc.

**(d) Colour relationships.** Plaza is the map's colour climax: maroon script +
teal badge + orange lamp heads + flag multicolour against pale concrete and sky.
Accent-to-neutral here may reach 25–30% (highest on the map). What never
saturates: the paving (pale warm grey, chroma near zero) and the sky-side of the
dome (pale aluminium, not blue paint).

**(e) Clean shapes vs photographed place.** Today the plaza elements stand on bare
paving with no ground story. What would photograph: (1) each structure's footing
detail (plinth, bolts, shadow gap); (2) pennant/flag strings throwing thin line
shadows across the paving at noon; (3) the teal display car on its plinth with an
info placard — a museum label, bolts, and a plinth edge shadow are what say
"show town" instead of "car park".

---

## 5. Back yards (spawn ends)

Reference reads: NT02 (orange yard: white curved-roof carport, red-flower beds;
white yard: tan sand pit, green court); NT03 (circular patio at stair foot,
stepping stones, deck at upper-floor level).

**(a) Material behaviour.** Lawns: matte ~0.9, no specular ever; the mow-stripe
checker is a **value** pattern, not a colour pattern. Timber fences/decks:
~0.75–0.85, silvered top faces, darker crevices. Carport curved roof: white
fibreglass ~0.45 with a soft sheen along the crown. Sand pit: ~0.95, brightest
matte on the map. Shuffleboard/green court: painted concrete ~0.55 with a faint
roller stipple. Dirt: lawn edges brown-frayed within ~100 mm of fences and paths;
sand spills ≤200 mm outside the pit frame; patio joints moss-darkened.

**(b) Value composition.** Lawns are mid (~40–50%) — darker than every wall, paler
than asphalt. The mow checker alternates ~5–8% lightness; visible from standing
height, decisive from above. Brightest in yards: sand pit (~80%) and carport crown
(~85%). Darkest: fence shadow lines, crate-store interior, under-deck void
(~10–15%) — every yard needs one genuinely dark recess or it reads as a lawn with
toys.

**(c) Silhouette and detail density.** At 40 m (aerial): yard programmes must
differ — carport curve + red beds vs sand rectangle + green court; that asymmetry
is the chirality anchor. At 2 m: picket gaps with see-through slits, cold-frame
lid handles, crate slat gaps (~10 mm shadow lines), stepping-stone grout joints
(~20–30 mm recessed, grit-filled). Stones sit **in** the lawn (top face ≤20 mm
proud), never floating discs.

**(d) Colour relationships.** Each yard: ~60% lawn green neutral base, ~25% pale
paving/timber neutrals, ≤15% accents (red flowers, blue appliance tops on white's
side, red on orange's). Accents never mix across yards — red beds belong to
orange, sand/court to white. What never saturates: fence timber and deck boards
(keep them tan/brown, never orange stain).

**(e) Clean shapes vs photographed place.** Today both yards read as striped lawns
with furniture placed on top. What would photograph: (1) edging stories — a steel
or timber edge between lawn and bed with soil mounded above the lawn; (2) wear
paths (thinner, yellower grass) from deck stair to patio to fence hole; (3) the
under-deck void dark and visibly supported (posts + bearers), not a floating box.

---

## 6. Street elevation (house fronts, lawns, road section)

Reference reads: SPEC NT04: panelised terracotta with tall narrow windows and
vertical mullions curving around the corner, cream curved fascia, grey concrete
pilaster, chest-height retro appliance bank (red/pink cabinet, white panels,
chrome trim), bright lawn to big-slab pale paving, chain-and-post edging, tan
picket fence and dark hedges behind, deep flat cantilevered porch eave (cantilever,
not posted canopy).

**(a) Material behaviour.** Paving slabs: honed concrete ~0.6–0.7 with a faint
broom streak; joints recessed ~10 mm and grit-dark. Kerbs: rougher ~0.85; kerb
**faces** carry the bottom-40-mm grit wash; kerb **tops** are edge-worn paler for
~15 mm where feet and tyres polish them. Appliance enamel: ~0.25 with chrome trim
at ~0.1 throwing hard glints; white side panels ~0.35. Chain: galvanised steel
~0.45 with sag-catenary highlights; posts matte black ~0.6. Dirt: lawn clippings
on the first slab row; rust weep under each chain-post base (≤20 mm halo);
appliance feet kick-scuffed.

**(b) Value composition.** Road (~15–20%) is the dark datum; pavements (~70–75%)
and lawns (~40–50%) step up from it; house fronts (~80–90%) crown the section.
The appliance bank must read as a saturated mid (~40%) cabinet with near-white
panels — a two-value object legible at 30 m. Chain-and-post edging must hold a
dark dotted line (~20%) against lawn and paving or the lawn edge dissolves.

**(c) Silhouette and detail density.** At 40 m: two level lawn planes, two pale
pavement bands, dark road trench between, appliance banks as coloured ticks
(red on orange side, blue on white side), porch canopy as a deep shade slot. At
2 m: slab joints (600–900 mm module, never random), chain sag (~80–120 mm dip per
span), appliance door gaps + handles + feet, pilaster board-mark lines. Slab
module must be consistent along the whole street — mixed module sizes read as a
path, not a municipal pavement.

**(d) Colour relationships.** Street section is ~80% neutral (grey road, pale
paving, green lawn, cream/white houses); appliances + hedges + trim are the ~20%
accent. Red tops face orange, blue tops face white — never swapped, never both on
one lawn. What never saturates: paving, kerbs, road, pilaster concrete (all near-
achromatic; warmth ≤ a hint).

**(e) Clean shapes vs photographed place.** Today the section reads as: lawn slab,
pavement slab, road slab with a fridge on the grass. What would photograph:
(1) the kerb as a three-face object (top worn pale, face grit-washed, joint gaps
every ~900 mm with a 5 mm recess); (2) the porch eave as a thin deep slab with a
dark soffit plane (soffits in shade are the darkest flat surfaces in daylight);
(3) the window band wrapping the corner as a curve, not a chamfer — NT04's corner
curve is the detail that separates Googie from a box with windows.

---

## 7. Mannequins

Reference reads: NT05 (figure in purple/magenta shift dress on the pavement);
ship captures show articulated display figures (some dressed, some bare) posed
around lawns, street and plaza.

**(a) Material behaviour.** Fibreglass bodies: smooth matte ~0.5–0.6, a soft limb
highlight but no skin specular. Painted clothing panels: cloth-rough ~0.85, no
sheen at all — the body/cloth roughness step is what reads as "dressed". Joints
(neck, shoulder, wrist, knee): slightly polished ~0.4 from handling, with a
hairline seam shadow. Dirt: scuff-blackened feet and lower legs (they stand on
paving), dust on shoulders and heads, seam-line grime. Never rust, never chipped
to substrate — these are maintained showroom figures, not ruins.

**(b) Value composition.** Bare bodies are near-white (~80–85%) — second-brightest
figures on the map after sunlit walls. Dressed torsos (magenta/blue/red shifts)
drop to mid (~35–50%) and are the eye-catch at 20 m. Joints and recesses (armpit,
crotch, neck socket) must hold ~30–40% so limbs separate; an all-85% figure melts
into one white worm in sun.

**(c) Silhouette and detail density.** At 40 m: pose only — outstretched arms,
seated figure, dress A-line. Pose variety is the entire distant read. At 2 m:
fingers suggested as a mitten split (two grooves, not five modelled digits),
facial features absent or a brow/nose hint ≤3 mm — fully sculpted faces at this
scale read as dolls, not display dummies. Dress hems need a 5–8 mm thickness edge
so cloth doesn't read as body paint.

**(d) Colour relationships.** Bodies neutral warm-white; garments carry the accent:
magenta/purple shift, teal/blue shifts, dark suits for standing males. One garment
colour per figure, never patterned. What never saturates: the bodies themselves
(no tan "skin" — sun-tanned dummies read as people and break the test-target
unease).

**(e) Clean shapes vs photographed place.** Today figures read as glossy toy
people. What would photograph: (1) matte bodies with scuffed feet; (2) cloth
dresses as separate shells with a hem shadow gap off the legs; (3) posed
asymmetry — display figures are arranged, never in identical T-poses, and at
least one seated and one mid-gesture figure per cluster.

---

## 8. 1950s vehicles (green classic, truck, dark saloon, red car, teal display car)

Reference reads: NT05 (teal 50s classic with heavy chrome + whitewalls on a plinth
with placard; maroon 50s car behind); NT02 (vehicles on the head; red car on the
third-house drive); NT07 (coach covered under §3).

**(a) Material behaviour.** Paint: period enamel, roughness ~0.2–0.35, long
flank highlight following the body crown. Chrome (bumpers, grilles, arches,
mirrors): ~0.08–0.12, hard glints only — chrome that blooms white is blown out,
not shiny. Whitewalls: matte cream ~0.7 with a raised ring edge; tread black
~0.9. Glass: ~0.1, sky mirror with a chrome surround shadow line. Dirt:
road-film on lower sills and behind wheels (≤150 mm band), whitewall browning at
the tread junction, number-plate and badge edges dust-caught. Showroom cars (teal
plinth car) are cleaner — sill film only, no spray.

**(b) Value composition.** Dark saloon and truck cab are the darkest vehicles
(~10–20%); teal and red cars sit mid (~30–45%); chrome and whitewalls are the
bright accents (~80%). Each car needs all three bands (dark glass/cab, mid paint,
bright chrome) or it reads as a monochrome toy. Tyres must stay near-black — grey
tyres flatten the whole car.

**(c) Silhouette and detail density.** At 40 m: fin/tail profile, glasshouse
daylight-opening shape, whitewall ring. Period correctness lives in the
glasshouse — a 50s car with a modern slit-glass read is wrong at any distance.
At 2 m: panel gaps (~4–5 mm shadow lines), door handles, round headlamp lenses
with a reflector glint, badge/plate rectangles, tyre sidewall ring + tread hint.
Headlamps must be concave lenses (a dark rim + bright core), never flat white
discs.

**(d) Colour relationships.** Each car is one saturated colour + chrome + whitewall
+ dark glass. Teal, maroon/red, dark blue-green, near-black — one hue per car,
roofs may go white/cream (two-tone) on the 50s cars only. What never saturates:
tyres, sills, glass rubber, plinth concrete (all neutral).

**(e) Clean shapes vs photographed place.** Today cars read as smooth lumps with
painted windows. What would photograph: (1) glass set into a chrome frame with a
rubber seal line (three nested edges: paint → chrome → rubber → glass);
(2) a ground shadow that is hard directly under the sills and softens outward —
floating cars come from a uniform blob shadow; (3) the plinth car's placard and
plinth edge (museum framing is what makes the plaza car a display, not traffic).

---

## 9. Desert-mountain surround (horizons on every side)

Reference reads: NT03 (mountains + hazy low city skyline + big rounded deciduous
trees behind the house); stations: hazy blue-grey mountains behind plaza and
head; SPEC: bleached concrete apron, then out of bounds.

**(a) Material behaviour.** Everything distant is matte (~0.9–1.0) — no specular
beyond the town apron. Mountains: rock matte with scree streaks darker in gullies.
City skyline: flat pale slabs, no window detail at this range — windows would be
sub-pixel noise. Apron concrete: ~0.8, dust-drifted. Dirt: the apron's story is
dust — windrows against fence lines, tyre-faint tracks off the road stem, spinifex
clumps where paving gives up.

**(b) Value composition.** Sky zenith (~55–60%) down to a near-white horizon
(~85%); far mountains (~65–70%) lighter than near ones (~50–55%) — aerial
perspective stacks values toward the horizon, never away. The town (pale concrete
~70%, white houses ~85–90%) must sit **paler** than its desert foreground and
**darker** than the horizon haze, or it floats. Darkest surround element: near-
mountain gullies (~35%); nothing out-of-bounds may go darker than the road.

**(c) Silhouette and detail density.** At 40 m+ the surround is pure silhouette:
jagged near ridge, soft far ridge, thin city slab band, needle/dome/saucer
prongs. Detail density falls with range — near bushes get leaf clumps, mid trees
get canopy blobs, mountains get zero detail below the ridgeline except gully
wash. Any crisp texture on a far mountain destroys the depth (atmospheric
perspective is a low-pass filter).

**(d) Colour relationships.** Surround is desaturated blue-grey (mountains), warm
pale (apron/desert), near-white haze. Saturation budget: distant chroma ≤
one-third of lawn green or car-teal chroma. The only saturated surround notes are
living trees (deep green) and red flowers in beds — both **inside** the town, both
marking habitation against the desert. What never saturates: mountains, skyline,
haze, apron (if the desert goes orange the town stops looking bleached).

**(e) Clean shapes vs photographed place.** Today the horizon reads as grey paper
cut-outs behind a concrete tray. What would photograph: (1) a graded haze band
(horizon whitest, melting the mountain feet — currently feet are hard-edged);
(2) the apron breaking up (cracks, dust tongues, scrub dots) instead of a uniform
slab to the fog wall; (3) big rounded deciduous trees **behind** the back fences
(NT03) to close the yard vista — currently yards look onto bare fence and void.

---

## Five highest-leverage changes (grounded in `captures/ship-*.png` as seen today)

1. **Give the glass its sky back.** In `ship-streetElevation.png` and
   `ship-midStreet.png` the window bands read as flat dark grey-blue holes while
   walls blaze white — real noon glass mirrors the pale sky and reads **brighter**
   than shaded wall. Reason: the single darkest-large-plane error; it makes both
   houses look unlit from the street. Observable outcome: in the next streetElevation
   capture, sunlit window glass measures paler than any shaded cream wall and shows
   a mullion-shadow rhythm instead of a uniform fill.

2. **Seat every ground object in a contact story.** In `ship-turningHead.png` the
   coach, truck and saloon sit on an unmarked disc with soft blob shadows; in
   `ship-spawnA.png` stepping stones float as pale ellipses on stripe-perfect lawn;
   kerbs have no grit line. Reason: floating objects are the strongest "clean
   shapes" signal across all stations. Observable outcome: next turningHead shows
   oil-drop spots under engines, tyre-polish arcs on the asphalt, and the kerb's
   bottom-40-mm grit wash; next spawnA shows stones ≤20 mm proud with grout shadow
   joints and lawn fray within 100 mm of each stone.

3. **Break the concrete tray with haze and dust.** In `ship-aerial.png` the apron
   runs as a uniform slab to a hard mountain foot; in `ship-plaza.png` mountain
   feet are razor-edged against sky. Reason: missing aerial perspective flattens
   the whole map into a diorama base. Observable outcome: next aerial shows a
   whitest haze band swallowing mountain feet, dust windrows against fence lines,
   and scrub dots on the apron — with far-ridge values paler than near-ridge by a
   visible step.

4. **Material-separate white paint from white walls.** In `ship-yardWhite.png` and
   `ship-plaza.png` mannequin bodies, capsule walls, saucer elements and sign
   boards all share one chalky white, so figures melt into buildings. Reason:
   cheapest global legibility win: bodies matte-fibreglass with scuffed feet,
   capsule walls glossier with trim shadow edges, garments as separate matte cloth
   shells. Observable outcome: in the next yardWhite capture, limbs separate from
   the capsule wall at 20 m by roughness/sheen alone, and at 2 m each dressed
   figure shows a hem shadow gap plus darkened joint recesses.

5. **Finish the street section as municipal construction.** In
   `ship-streetElevation.png` the pavement is a jointless sheet, the kerb a single
   pale strip, the porch eave thin without a dark soffit, and the appliance bank
   reads as one red block (chrome/feet/gaps invisible). Reason: NT04's specifics —
   slab module, chain sag, enamel + chrome appliance, cantilevered shade slot —
   are all absent, so the street has no scale cues. Observable outcome: next
   streetElevation shows a consistent 600–900 mm slab module with grit joints,
   chain spans sagging 80–120 mm on posted catenaries, appliances with door gaps,
   handles, feet and chrome glints, and the porch canopy underside as the darkest
   flat surface in the frame.

---

*Lane B (ConceptBar). Sources read: SPARK-CONTEXT.md, brief-refs.md, SPEC.md
(§3 + OPEN items honoured), layout.ts (dims/invariant), palette.ts (families, not
calibrated values), stations.ts (station intents), captures/ship-aerial,
ship-yardOrange, ship-yardWhite, ship-streetElevation, ship-midStreet,
ship-spawnA, ship-turningHead, ship-plaza (+ interiorOrange/spawnB summaries).
`docs/reference/concept/manifest.json` did not exist at write time; this bar
stands without it. No mandates on front ledge, mailboxes, turning-head inset, or
calibrated hex. BO2-2025 only. Files written: `docs/reference/CONCEPT-BAR.md`
only.*
