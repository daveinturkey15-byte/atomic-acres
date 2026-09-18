# Atomic Acres reference library - HERO REFERENCES

The 40 gameplay frames a critic compares against **first**, plus the 2 official
stills that outrank all of them. Chosen on 2026-09-18 after every one of the 1371
gameplay frames was put on a labelled contact sheet and looked at, and after each
frame below was reopened at 480 px or larger.


`saw` is what was actually visible in the frame. `why` is what it is for.


## The two that outrank everything


### `img/nt2025-aerial-boii`

- **subject** whole-map plan
- **why** The layout source of record. `src/core/layout.ts` traces to it, and the 2026-09-18 re-proportioning was measured off it. Verified real (1920x1080, decodes, sha in manifest).

### `img/nt2025-minimap-boii`

- **subject** HUD minimap silhouette
- **why** The layout source of record. `src/core/layout.ts` traces to it, and the 2026-09-18 re-proportioning was measured off it. Verified real (512x512, decodes, sha in manifest).

## Whole map and layout (6)


### 1. `gameplay/f-FKQOEO-1ceE-115`  -  map/street-axis, eye

- **saw** Standing in the road: coach on the left, white house right, kerb line and the mountains closing the axis.
- **why** The eye-height street read the `streetElevation` station is trying to match.

### 2. `gameplay/f-FKQOEO-1ceE-150`  -  map/street-axis, eye

- **saw** The Nuketown pylon sign mid-frame with the box truck under it and smoke from a kill; road, kerb and apron all visible.
- **why** Pins the pylon sign's position relative to the road and the truck.

### 3. `gameplay/f-aICKIbuo8zQ-117`  -  map/plan, plan

- **saw** Both gloved hands holding the killstreak tablet; the screen shows the map from directly above with building footprints and player icons.
- **why** An in-engine top-down plan. Cross-check for `scripts/plan.mjs` output and for the minimap the HUD lane has to draw.

### 4. `gameplay/f-aICKIbuo8zQ-203`  -  map/overview, high-3/4

- **saw** VICTORY screen: box truck and the street from a raised angle, both garage faces, the deep cantilevered eave of the far house, mountains behind.
- **why** Second, opposing whole-street angle. Confirms the street is SHORT and the house-to-house axis long - the correction made on 2026-09-18.

### 5. `gameplay/g-VfcKHcDJXpM-104`  -  map/title, eye

- **saw** The in-game NUKETOWN 2025 load screen: pylon sign with the atom motif, teal classic car, cream-and-red coach, mannequins, trees, flag masts, space-needle tower, over a dark caption bar.
- **why** The art department's own composed hero shot of the plaza. Best single reference for the pylon sign, flags and the plaza dressing.

### 6. `gameplay/g-tB35IKluv0g-182`  -  map/overview, aerial

- **saw** End-of-round free camera from outside and above the south-west corner: the whole map in one frame with NO viewmodel and NO crosshair - turning circle, coach, red saloon, teal saloon, both houses, the plaza and the mountains.
- **why** The single best whole-map read in 1371 frames. First comparison for the `aerial` station; the only frame that shows relative building masses without a weapon eating a third of the picture.

## Vehicles (3)


### 7. `gameplay/f-FKQOEO-1ceE-025`  -  vehicle/coach, front

- **saw** Coach front three-quarter at close range: chrome grille bars, round headlamps, cream body, the teal classic saloon beside it.
- **why** Front-end geometry and the chrome/paint reflection behaviour on a curved cream panel in direct sun.

### 8. `gameplay/f-aICKIbuo8zQ-090`  -  vehicle/trailer, 3/4

- **saw** Box trailer flank with an oval logo panel, dual wheels, a carport behind and a red saloon on the drive.
- **why** Trailer proportions and the carport it parks against; also a good concrete-drive material read.

### 9. `gameplay/f-mGpZaLy5_hM-105`  -  vehicle/coach, side

- **saw** Near-orthographic side profile of the cream-and-maroon streamline coach with its window band and painted slogan along the flank.
- **why** The only clean side profile of the coach. Use for length:height ratio and for the two-tone split line.

## Orange house (3)


### 10. `gameplay/f-FKQOEO-1ceE-160`  -  house-orange/interior-edge, eye

- **saw** Interior/exterior junction: an orange banded wall, a wall notice board with printed text, floor and a bright doorway.
- **why** The only good read on interior wall banding and on how bright the doorway blows out relative to the interior - a direct exposure target.

### 11. `gameplay/f-FKQOEO-1ceE-205`  -  house-orange/exterior, eye

- **saw** Cream and terracotta stucco, deep eave, glazing band, mountains behind, the lawn and its kerb in the foreground.
- **why** The most-cited frame in the project's own REAL-REFERENCE.md (25 citations). Already the de-facto bar for wall colour and eave depth.

### 12. `gameplay/f-aICKIbuo8zQ-030`  -  house-orange/street-face, eye

- **saw** Box truck and coach in the turning circle, the far house's street face, the third house beyond the boundary, mountains.
- **why** Ties the two houses and the third building into one frame - the layout relationship the map was re-proportioned for.

## White house (2)


### 13. `gameplay/f-FKQOEO-1ceE-055`  -  house-white/exterior, eye

- **saw** Cream ashlar stone wall, a recessed doorway, the pylon sign beyond, a soldier running across bleached paving.
- **why** Stone-veneer masonry reference. REAL-REFERENCE says we have none of this in the build; this frame is the bar.

### 14. `gameplay/g-VfcKHcDJXpM-158`  -  house-white/interior, eye

- **saw** White interior with a black starburst wall clock, a turquoise glazed opening and pale terrazzo-like floor.
- **why** Mid-century interior dressing and the fresnel behaviour of the turquoise glazing seen from inside.

## Interiors - stairs, kitchen, bedroom, lounge, garage (8)


### 15. `gameplay/f-FKQOEO-1ceE-141`  -  interior/garage, eye

- **saw** Garage / utility interior: glowing green display shelving, lockers, a black and white chequerboard floor, a blue tiled plunge bath marked '2', and the car-port door open to the street.
- **why** Garage access and its interior - directly on the owner's brief, and the emissive shelving is a lighting case we have no equivalent for.

### 16. `gameplay/f-aICKIbuo8zQ-023`  -  interior/bedroom, eye

- **saw** Purple bedroom: lilac patterned floor-length curtains, deep purple shag carpet, a glazed wall looking out to the street.
- **why** Upper-floor bedroom. The saturated interior palette the build does not have.

### 17. `gameplay/f-aICKIbuo8zQ-148`  -  interior/kitchen, eye

- **saw** Yellow kitchen: upper cabinets, a fridge, a wall telephone, a domed ceiling light, a mannequin in a dress, tiled floor.
- **why** Kitchen dressing and the interior light level relative to the window.

### 18. `gameplay/f-mGpZaLy5_hM-023`  -  interior/lounge, eye

- **saw** Turquoise lounge: sliding glass door blown out to daylight, turquoise curtains, teal carpet, a coral sofa.
- **why** Interior-to-exterior exposure ratio through a slider - the hardest lighting case in the map.

### 19. `gameplay/f-mGpZaLy5_hM-049`  -  interior/stairs, eye

- **saw** Straight-run internal staircase, pale treads, a half-landing, red-painted wall above, handrail on the left.
- **why** THE stair reference. Interior topology has never been checked against the real map; this frame sets the run, rise and landing.

### 20. `gameplay/f-mGpZaLy5_hM-088`  -  interior/stairs, low

- **saw** Stair seen from below with a magenta circular wall feature beside it and a doorway through to daylight.
- **why** Shows how the stair meets the ground-floor plan and where the daylight comes from.

### 21. `gameplay/g-VfcKHcDJXpM-045`  -  interior/stairs, eye

- **saw** Second staircase, terracotta-orange walls, narrower, with a framed picture on the half-landing wall.
- **why** The other house's stair - proves the two houses do NOT share a stair design.

### 22. `gameplay/g-VfcKHcDJXpM-145`  -  interior/utility, eye

- **saw** Pale green utility room with a patterned feature wall, a mannequin in a dress, and a doorway straight out to the street.
- **why** Shows a ground-floor room that is a through-route, not a dead end.

## Exterior stairs and upper-floor access (3)


### 23. `gameplay/f-FKQOEO-1ceE-044`  -  exterior/stairs, low

- **saw** External stair with an orange-painted handrail against a stone-clad wall, under a deep cantilevered eave.
- **why** Second access route, with the rail colour and the stone cladding together.

### 24. `gameplay/f-mGpZaLy5_hM-201`  -  exterior/stairs, eye

- **saw** External steel stair with an intermediate landing climbing to the first floor, under the eave.
- **why** Answers 'how do you get upstairs from outside' - the owner's explicit question about access.

### 25. `gameplay/g-VfcKHcDJXpM-006`  -  exterior/stairs, eye

- **saw** From under the stair: patio paving, the supporting columns, painted court markings on the ground and the yard beyond.
- **why** The undercroft the stair creates - a playable space our build may not have.

## Yards, ground and fences (3)


### 26. `gameplay/g-1icNQzMgLUM-078`  -  yard/garden, eye

- **saw** Rows of white hydroponic troughs planted with lettuce, a cast plaque on a post, the orange slat fence and a curved white building behind.
- **why** The back-yard produce garden. Visible in the official aerial and absent from our build; a whole prop family nobody has modelled.

### 27. `gameplay/g-1icNQzMgLUM-100`  -  yard/court, eye

- **saw** Painted shuffleboard court on pale concrete, a pierced breeze-block screen wall, timber fence, flag masts in the distance.
- **why** Ground decals and the breeze-block screen - two materials we do not have.

### 28. `gameplay/g-VfcKHcDJXpM-195`  -  yard/fence, eye

- **saw** A long run of tall vertical timber fence in full sun with the coach roof just visible over it.
- **why** Fence board width, cap detail and how the sun/shade ratio reads on dry timber.

## Surroundings (2)


### 29. `gameplay/f-mGpZaLy5_hM-099`  -  surroundings/plaza, eye

- **saw** Space-needle tower, hypar petal roofs, plaza paving and the pale city skyline behind.
- **why** The backdrop the `plaza` station is judged against; sets silhouette scale for everything beyond the fence.

### 30. `gameplay/g-1icNQzMgLUM-232`  -  surroundings/skyline, eye

- **saw** Pierced breeze-block wall in the near field with a bank of pale mid-rise towers receding into haze behind it.
- **why** Aerial-perspective falloff: how much contrast and saturation the distant city loses.

## Weapons and optics (6)


### 31. `gameplay/f-FKQOEO-1ceE-026`  -  weapon/hip-idle, eye

- **saw** Hip-fire pose with a red-dot sight, the weapon filling the lower-right third, street beyond.
- **why** Viewmodel screen footprint at hip - our rig sits at (0.22,-0.20,-0.45); this is the proportion to match.

### 32. `gameplay/f-aICKIbuo8zQ-176`  -  weapon/ads-fire, scope

- **saw** Through the scope at an enemy who is firing: a bright cone of muzzle flash off his weapon, dust behind.
- **why** Muzzle flash seen from the receiving end - shape, colour and how briefly it reads at distance.

### 33. `gameplay/f-aICKIbuo8zQ-180`  -  weapon/world-model, plan

- **saw** Two dropped weapons lying flat on pale concrete - a rifle and a carbine seen from above and slightly behind.
- **why** Near-orthographic top views of weapon world models, plus the red pickup marker treatment.

### 34. `gameplay/f-mGpZaLy5_hM-147`  -  weapon/world-pose, side

- **saw** A pistol held out at arm's length, near side-on, gloved hands, lawn and fence behind.
- **why** The cleanest side profile of a weapon in the corpus - grip angle, slide proportion, hand placement for the Duster viewmodel.

### 35. `gameplay/f-mGpZaLy5_hM-154`  -  weapon/ads-optic, scope

- **saw** Sniper scope: circular vignette, mil-dot reticle, heavy blur outside the tube, a 'hold to steady' prompt.
- **why** The ADS optic treatment for the Deadeye - vignette radius, reticle weight, how much of the screen the tube occupies.

### 36. `gameplay/g-tB35IKluv0g-081`  -  weapon/ads-thermal, scope

- **saw** Green phosphor thermal scope: the world reduced to green luminance with hot targets picked out.
- **why** A second optic mode. If thermal is ever wanted, this is the whole look in one frame.

## Effects (2)


### 37. `gameplay/g-VfcKHcDJXpM-067`  -  effect/explosion, eye

- **saw** A point-blank explosion: the frame is a white and orange bloom with the weapon silhouetted black against it.
- **why** Explosion exposure and colour ramp at the extreme - how far the bloom is allowed to blow out.

### 38. `gameplay/g-VfcKHcDJXpM-236`  -  effect/shell-eject, eye

- **saw** A brass case tumbling in mid-air with a thrown charge behind it, against a corrugated roller-shutter door.
- **why** Shell scale against a known object and the tumble attitude - our pool ejects 24 shells and has never been compared to a real one.

## UI, HUD and killstreaks (2)


### 39. `gameplay/f-aICKIbuo8zQ-209`  -  ui/scoreboard, menu

- **saw** The end-of-match scoreboard, headed 'Team Deathmatch - Nuketown 2025', with the full two-team table: score, kills, deaths, ratio, assists, ping.
- **why** Two jobs. It is the scoreboard layout the UI lane has to answer, and it is the frame that PROVES the corpus is Nuketown 2025 - the map name is printed in the game's own header, not inferred from a video title.

### 40. `gameplay/g-VfcKHcDJXpM-094`  -  ui/scorestreaks, menu

- **saw** The full SCORESTREAKS selection grid: every streak icon and name, the cost of the selected one, and the three chosen slots.
- **why** The owner asked for killstreaks 'in a familiar way'. This is the entire roster and the selection UI in one frame.

---


40 gameplay heroes listed. Every remaining frame is still in the library and
still indexed in `frame-index.json`; the hero list is a starting point, not a
whitelist. If a critic needs a shot that is not here, shortlist on the measured
columns, open the frame, and add it here with its own `saw` and `why`.

