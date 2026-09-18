# -*- coding: utf-8 -*-
"""Build docs/reference/library/ for Atomic Acres.

Reads the measured census (census.json), the three existing collection manifests,
and the hand-curated hero/shot-matrix data below, and emits:
  MANIFEST.md, manifest.json, shot-matrix.md, shot-matrix.json,
  hero-references.md, frame-index.json, README.md
Creates nothing outside docs/reference/library/. Moves and renames nothing.
"""
import json, os, hashlib, re, datetime
from collections import defaultdict, OrderedDict

REPO = r"C:\Users\david\Desktop\stuff\nuketown"
REF = os.path.join(REPO, "docs", "reference")
LIB = os.path.join(REF, "library")
SCR = os.path.dirname(os.path.abspath(__file__))
os.makedirs(LIB, exist_ok=True)

STAMP = "2026-09-18"

# ---------------------------------------------------------------- style block
STYLE_ID = "AA-STYLE-2026-09-18"
STYLE_BLOCK = (
    "Original concept photograph for a fan game. Subject: an invented 1960s "
    "American 'world of tomorrow' nuclear-test show town in the Nevada desert - "
    "Googie and streamline-moderne architecture, bleached concrete, mown lawns, "
    "saturated accent colours on cream and terracotta stucco. "
    "Light: hard high slightly-warm afternoon sun about 60 degrees elevation, "
    "intense diffuse blue skylight fill into every shaded face so shadows stay "
    "open and blue-tinted and never crush to black, clear cloudless desert sky, "
    "hazy dry mountains on the horizon. "
    "Camera: full-frame stills lens, realistic neutral exposure, unclipped "
    "speculars, readable shadow detail, no cinematic grade."
)
NEG_BLOCK = (
    "No logos, no brand marks, no readable signage, no real-world trademarks, "
    "no game HUD, no watermark, no text overlay, no people's faces, "
    "no copyrighted character or weapon designs, no 1950s tract housing, "
    "no school buses, no snow, no rain, no night."
)
LIGHT_SLOTS = {
    "afternoon": "hard high slightly-warm afternoon sun (the fixed condition)",
    "lowsun": "golden-hour low raking sun, long shadows (variation slot)",
    "overcast": "high thin overcast, soft shadowless fill (variation slot)",
    "interior": "interior lit only by window sun patch plus blue skylight bounce",
}

# ------------------------------------------------------- source clip metadata
CLIPS = {
    "f-aICKIbuo8zQ": dict(
        yt="aICKIbuo8zQ", frames=210, w=1600, h=900, fps_note="1 frame / 3 s",
        title="Call Of Duty Black Ops 2: Team Deathmatch (Nuketown 2025) Gameplay "
              "(No Commentary) [1080p60FPS] PC",
        uploader="Leva", uploaded="2020-07-05", duration_s=629,
        platform="PC", client="Plutonium T6 (community client, vanilla renderer)",
        strengths="interiors (kitchen, purple bedroom, garage), killstreak tablet, "
                  "victory + final-killcam wide shots, scope frames",
    ),
    "f-FKQOEO-1ceE": dict(
        yt="FKQOEO-1ceE", frames=212, w=1600, h=900, fps_note="1 frame / 3 s",
        title="Call Of Duty Black Ops 2: Kill Confirmed (Nuketown 2025) Gameplay "
              "(No Commentary) [1080p60FPS] PC",
        uploader="Leva", uploaded="2021-05-05", duration_s=637,
        platform="PC", client="Plutonium T6 (community client, vanilla renderer)",
        strengths="street axis, coach and box truck, stone masonry, pylon sign; "
                  "WARNING a very large bright organic weapon camo occupies the "
                  "lower third of most frames",
    ),
    "f-mGpZaLy5_hM": dict(
        yt="mGpZaLy5_hM", frames=212, w=1600, h=900, fps_note="1 frame / 3 s",
        title="Black Ops 2 - Nuketown 2025 is Chaotic as Always (No Commentary)",
        uploader="Antz3 FPS", uploaded="2022-06-11", duration_s=636,
        platform="PC", client="Plutonium T6 (community client, vanilla renderer)",
        strengths="best optics coverage (iron / red dot / ACOG / sniper scope), "
                  "both staircases, garage shelving, pistol held side-on",
    ),
    "g-1icNQzMgLUM": dict(
        yt="1icNQzMgLUM", frames=284, w=1600, h=900, fps_note="1 frame / 4 s",
        title="Black Ops 2 Nuketown - 2 Guys Vs 9 Bots! (No commentary)",
        uploader="Gaming N nostalgia", uploaded="2023-04-18", duration_s=1138,
        platform="PC", client="Plutonium T6 (community client, vanilla renderer)",
        strengths="back-yard vegetable troughs, shuffleboard court, breeze-block "
                  "screen walls, skyline; frames 001-007 and 281-284 are the "
                  "uploader's title / outro cards and contain no map",
    ),
    "g-VfcKHcDJXpM": dict(
        yt="VfcKHcDJXpM", frames=265, w=1600, h=1200, fps_note="1 frame / 4 s",
        title="Call of Duty Black Ops II Multiplayer - NUKETOWN (NO COMMENTARY)",
        uploader="It's Lucky", uploaded="2022-06-05", duration_s=1062,
        platform="console-shaped 4:3 capture (1600x1200 after scale)",
        client="retail Black Ops II",
        strengths="the ONLY clip with the menu chain - CUSTOM GAMES, the full "
                  "SCORESTREAKS grid, CHOOSE CLASS, and the in-game NUKETOWN 2025 "
                  "load screen; smallest HUD occlusion of the six",
    ),
    "g-tB35IKluv0g": dict(
        yt="tB35IKluv0g", frames=188, w=1600, h=900, fps_note="1 frame / 4 s",
        title="Call of Duty Black Ops 2 - Demolition (Nuketown 2025) Gameplay "
              "(No Commentary)",
        uploader="Neff", uploaded="2021-08-30", duration_s=752,
        platform="PC", client="Plutonium T6 (community client, vanilla renderer)",
        strengths="Demolition objective HUD, thermal/night scope frames, and the "
                  "single best whole-map overview in the corpus (182-183); "
                  "frames 185-188 are the uploader's outro card",
    ),
}

# ------------------------------------------------------------ the 40 heroes
# Every frame below was opened and looked at during this pass, either at full
# resolution or in a 480 px contact cell. `saw` is what was actually visible.
HEROES = [
 # ---- whole-map / layout
 ("g-tB35IKluv0g-182", "map/overview", "aerial",
  "End-of-round free camera from outside and above the south-west corner: the "
  "whole map in one frame with NO viewmodel and NO crosshair - turning circle, "
  "coach, red saloon, teal saloon, both houses, the plaza and the mountains.",
  "The single best whole-map read in 1371 frames. First comparison for the "
  "`aerial` station; the only frame that shows relative building masses without "
  "a weapon eating a third of the picture."),
 ("f-aICKIbuo8zQ-203", "map/overview", "high-3/4",
  "VICTORY screen: box truck and the street from a raised angle, both garage "
  "faces, the deep cantilevered eave of the far house, mountains behind.",
  "Second, opposing whole-street angle. Confirms the street is SHORT and the "
  "house-to-house axis long - the correction made on 2026-09-18."),
 ("g-VfcKHcDJXpM-104", "map/title", "eye",
  "The in-game NUKETOWN 2025 load screen: pylon sign with the atom motif, teal "
  "classic car, cream-and-red coach, mannequins, trees, flag masts, space-needle "
  "tower, over a dark caption bar.",
  "The art department's own composed hero shot of the plaza. Best single "
  "reference for the pylon sign, flags and the plaza dressing."),
 ("f-aICKIbuo8zQ-117", "map/plan", "plan",
  "Both gloved hands holding the killstreak tablet; the screen shows the map "
  "from directly above with building footprints and player icons.",
  "An in-engine top-down plan. Cross-check for `scripts/plan.mjs` output and "
  "for the minimap the HUD lane has to draw."),
 # ---- street, circle, vehicles
 ("f-FKQOEO-1ceE-115", "map/street-axis", "eye",
  "Standing in the road: coach on the left, white house right, kerb line and "
  "the mountains closing the axis.",
  "The eye-height street read the `streetElevation` station is trying to match."),
 ("f-FKQOEO-1ceE-150", "map/street-axis", "eye",
  "The Nuketown pylon sign mid-frame with the box truck under it and smoke from "
  "a kill; road, kerb and apron all visible.",
  "Pins the pylon sign's position relative to the road and the truck."),
 ("f-mGpZaLy5_hM-105", "vehicle/coach", "side",
  "Near-orthographic side profile of the cream-and-maroon streamline coach with "
  "its window band and painted slogan along the flank.",
  "The only clean side profile of the coach. Use for length:height ratio and "
  "for the two-tone split line."),
 ("f-FKQOEO-1ceE-025", "vehicle/coach", "front",
  "Coach front three-quarter at close range: chrome grille bars, round "
  "headlamps, cream body, the teal classic saloon beside it.",
  "Front-end geometry and the chrome/paint reflection behaviour on a curved "
  "cream panel in direct sun."),
 ("f-aICKIbuo8zQ-090", "vehicle/trailer", "3/4",
  "Box trailer flank with an oval logo panel, dual wheels, a carport behind and "
  "a red saloon on the drive.",
  "Trailer proportions and the carport it parks against; also a good "
  "concrete-drive material read."),
 # ---- orange house
 ("f-FKQOEO-1ceE-205", "house-orange/exterior", "eye",
  "Cream and terracotta stucco, deep eave, glazing band, mountains behind, the "
  "lawn and its kerb in the foreground.",
  "The most-cited frame in the project's own REAL-REFERENCE.md (25 citations). "
  "Already the de-facto bar for wall colour and eave depth."),
 ("f-FKQOEO-1ceE-160", "house-orange/interior-edge", "eye",
  "Interior/exterior junction: an orange banded wall, a wall notice board with "
  "printed text, floor and a bright doorway.",
  "The only good read on interior wall banding and on how bright the doorway "
  "blows out relative to the interior - a direct exposure target."),
 ("f-aICKIbuo8zQ-030", "house-orange/street-face", "eye",
  "Box truck and coach in the turning circle, the far house's street face, the "
  "third house beyond the boundary, mountains.",
  "Ties the two houses and the third building into one frame - the layout "
  "relationship the map was re-proportioned for."),
 # ---- white house
 ("f-FKQOEO-1ceE-055", "house-white/exterior", "eye",
  "Cream ashlar stone wall, a recessed doorway, the pylon sign beyond, a soldier "
  "running across bleached paving.",
  "Stone-veneer masonry reference. REAL-REFERENCE says we have none of this in "
  "the build; this frame is the bar."),
 ("g-VfcKHcDJXpM-158", "house-white/interior", "eye",
  "White interior with a black starburst wall clock, a turquoise glazed opening "
  "and pale terrazzo-like floor.",
  "Mid-century interior dressing and the fresnel behaviour of the turquoise "
  "glazing seen from inside."),
 # ---- interiors and vertical circulation  (owner brief: garage, stairs, floors)
 ("f-mGpZaLy5_hM-049", "interior/stairs", "eye",
  "Straight-run internal staircase, pale treads, a half-landing, red-painted "
  "wall above, handrail on the left.",
  "THE stair reference. Interior topology has never been checked against the "
  "real map; this frame sets the run, rise and landing."),
 ("g-VfcKHcDJXpM-045", "interior/stairs", "eye",
  "Second staircase, terracotta-orange walls, narrower, with a framed picture "
  "on the half-landing wall.",
  "The other house's stair - proves the two houses do NOT share a stair design."),
 ("f-mGpZaLy5_hM-088", "interior/stairs", "low",
  "Stair seen from below with a magenta circular wall feature beside it and a "
  "doorway through to daylight.",
  "Shows how the stair meets the ground-floor plan and where the daylight "
  "comes from."),
 ("f-mGpZaLy5_hM-201", "exterior/stairs", "eye",
  "External steel stair with an intermediate landing climbing to the first "
  "floor, under the eave.",
  "Answers 'how do you get upstairs from outside' - the owner's explicit "
  "question about access."),
 ("f-FKQOEO-1ceE-044", "exterior/stairs", "low",
  "External stair with an orange-painted handrail against a stone-clad wall, "
  "under a deep cantilevered eave.",
  "Second access route, with the rail colour and the stone cladding together."),
 ("g-VfcKHcDJXpM-006", "exterior/stairs", "eye",
  "From under the stair: patio paving, the supporting columns, painted court "
  "markings on the ground and the yard beyond.",
  "The undercroft the stair creates - a playable space our build may not have."),
 ("f-aICKIbuo8zQ-148", "interior/kitchen", "eye",
  "Yellow kitchen: upper cabinets, a fridge, a wall telephone, a domed ceiling "
  "light, a mannequin in a dress, tiled floor.",
  "Kitchen dressing and the interior light level relative to the window."),
 ("f-aICKIbuo8zQ-023", "interior/bedroom", "eye",
  "Purple bedroom: lilac patterned floor-length curtains, deep purple shag "
  "carpet, a glazed wall looking out to the street.",
  "Upper-floor bedroom. The saturated interior palette the build does not have."),
 ("f-mGpZaLy5_hM-023", "interior/lounge", "eye",
  "Turquoise lounge: sliding glass door blown out to daylight, turquoise "
  "curtains, teal carpet, a coral sofa.",
  "Interior-to-exterior exposure ratio through a slider - the hardest lighting "
  "case in the map."),
 ("f-FKQOEO-1ceE-141", "interior/garage", "eye",
  "Garage / utility interior: glowing green display shelving, lockers, a black "
  "and white chequerboard floor, a blue tiled plunge bath marked '2', and the "
  "car-port door open to the street.",
  "Garage access and its interior - directly on the owner's brief, and the "
  "emissive shelving is a lighting case we have no equivalent for."),
 ("f-aICKIbuo8zQ-209", "ui/scoreboard", "menu",
  "The end-of-match scoreboard, headed 'Team Deathmatch - Nuketown 2025', with "
  "the full two-team table: score, kills, deaths, ratio, assists, ping.",
  "Two jobs. It is the scoreboard layout the UI lane has to answer, and it is "
  "the frame that PROVES the corpus is Nuketown 2025 - the map name is printed "
  "in the game's own header, not inferred from a video title."),
 ("g-VfcKHcDJXpM-145", "interior/utility", "eye",
  "Pale green utility room with a patterned feature wall, a mannequin in a "
  "dress, and a doorway straight out to the street.",
  "Shows a ground-floor room that is a through-route, not a dead end."),
 # ---- yards, ground, fences
 ("g-1icNQzMgLUM-078", "yard/garden", "eye",
  "Rows of white hydroponic troughs planted with lettuce, a cast plaque on a "
  "post, the orange slat fence and a curved white building behind.",
  "The back-yard produce garden. Visible in the official aerial and absent from "
  "our build; a whole prop family nobody has modelled."),
 ("g-1icNQzMgLUM-100", "yard/court", "eye",
  "Painted shuffleboard court on pale concrete, a pierced breeze-block screen "
  "wall, timber fence, flag masts in the distance.",
  "Ground decals and the breeze-block screen - two materials we do not have."),
 ("g-VfcKHcDJXpM-195", "yard/fence", "eye",
  "A long run of tall vertical timber fence in full sun with the coach roof "
  "just visible over it.",
  "Fence board width, cap detail and how the sun/shade ratio reads on dry timber."),
 # ---- surroundings
 ("f-mGpZaLy5_hM-099", "surroundings/plaza", "eye",
  "Space-needle tower, hypar petal roofs, plaza paving and the pale city "
  "skyline behind.",
  "The backdrop the `plaza` station is judged against; sets silhouette scale "
  "for everything beyond the fence."),
 ("g-1icNQzMgLUM-232", "surroundings/skyline", "eye",
  "Pierced breeze-block wall in the near field with a bank of pale mid-rise "
  "towers receding into haze behind it.",
  "Aerial-perspective falloff: how much contrast and saturation the distant "
  "city loses."),
 # ---- weapons
 ("f-mGpZaLy5_hM-147", "weapon/world-pose", "side",
  "A pistol held out at arm's length, near side-on, gloved hands, lawn and "
  "fence behind.",
  "The cleanest side profile of a weapon in the corpus - grip angle, slide "
  "proportion, hand placement for the Duster viewmodel."),
 ("f-mGpZaLy5_hM-154", "weapon/ads-optic", "scope",
  "Sniper scope: circular vignette, mil-dot reticle, heavy blur outside the "
  "tube, a 'hold to steady' prompt.",
  "The ADS optic treatment for the Deadeye - vignette radius, reticle weight, "
  "how much of the screen the tube occupies."),
 ("f-aICKIbuo8zQ-176", "weapon/ads-fire", "scope",
  "Through the scope at an enemy who is firing: a bright cone of muzzle flash "
  "off his weapon, dust behind.",
  "Muzzle flash seen from the receiving end - shape, colour and how briefly it "
  "reads at distance."),
 ("g-tB35IKluv0g-081", "weapon/ads-thermal", "scope",
  "Green phosphor thermal scope: the world reduced to green luminance with hot "
  "targets picked out.",
  "A second optic mode. If thermal is ever wanted, this is the whole look in "
  "one frame."),
 ("f-FKQOEO-1ceE-026", "weapon/hip-idle", "eye",
  "Hip-fire pose with a red-dot sight, the weapon filling the lower-right third, "
  "street beyond.",
  "Viewmodel screen footprint at hip - our rig sits at (0.22,-0.20,-0.45); this "
  "is the proportion to match."),
 ("f-aICKIbuo8zQ-180", "weapon/world-model", "plan",
  "Two dropped weapons lying flat on pale concrete - a rifle and a carbine seen "
  "from above and slightly behind.",
  "Near-orthographic top views of weapon world models, plus the red pickup "
  "marker treatment."),
 # ---- effects
 ("g-VfcKHcDJXpM-067", "effect/explosion", "eye",
  "A point-blank explosion: the frame is a white and orange bloom with the "
  "weapon silhouetted black against it.",
  "Explosion exposure and colour ramp at the extreme - how far the bloom is "
  "allowed to blow out."),
 ("g-VfcKHcDJXpM-236", "effect/shell-eject", "eye",
  "A brass case tumbling in mid-air with a thrown charge behind it, against a "
  "corrugated roller-shutter door.",
  "Shell scale against a known object and the tumble attitude - our pool "
  "ejects 24 shells and has never been compared to a real one."),
 # ---- UI / HUD / killstreaks
 ("g-VfcKHcDJXpM-094", "ui/scorestreaks", "menu",
  "The full SCORESTREAKS selection grid: every streak icon and name, the cost "
  "of the selected one, and the three chosen slots.",
  "The owner asked for killstreaks 'in a familiar way'. This is the entire "
  "roster and the selection UI in one frame."),
]

# ------------------------------------------------------------- the shot matrix
# (group, id, subject, view, light, status, ref_or_prompt)
def P(body):
    return STYLE_BLOCK + " " + body + " NEGATIVE: " + NEG_BLOCK

MATRIX = []

def row(group, sid, subject, view, light, status, have=None, prompt=None,
        consumed_by=None, note=None):
    MATRIX.append(OrderedDict(
        group=group, id=sid, subject=subject, view=view, light=light,
        status=status, have=have or [], prompt=prompt,
        consumed_by=consumed_by or [], note=note))

# --- 1. map
row("map", "map-plan-official", "whole map from directly above", "plan",
    "afternoon", "HAVE", ["img/nt2025-aerial-boii.png"],
    consumed_by=["critic:station-aerial", "builder:core/layout.ts"],
    note="The authoritative layout source. Every dimension in core/layout.ts "
         "traces to this and to the minimap.")
row("map", "map-minimap-official", "HUD minimap silhouette", "plan", "n/a",
    "HAVE", ["img/nt2025-minimap-boii.png"],
    consumed_by=["critic:station-aerial", "builder:ui/minimap"],
    note="512x512, dark. The 2026-09-18 re-proportioning was measured off this.")
row("map", "map-overview-ingame", "whole map from an outside raised camera",
    "high-3/4", "afternoon", "HAVE",
    ["gameplay/g-tB35IKluv0g-182.jpg", "gameplay/f-aICKIbuo8zQ-203.jpg"],
    consumed_by=["critic:station-aerial"])
row("map", "map-street-axis", "eye level in the road along the long axis",
    "eye", "afternoon", "HAVE",
    ["gameplay/f-FKQOEO-1ceE-115.jpg", "gameplay/f-FKQOEO-1ceE-150.jpg"],
    consumed_by=["critic:station-streetElevation"])
row("map", "map-circle-plan", "turning circle from above, vehicles in place",
    "plan", "afternoon", "HAVE",
    ["concept/turning-head-noon-plan.png", "img/nt2025-aerial-boii.png"],
    consumed_by=["critic:station-turningHead"])
row("map", "map-quadrant-ne", "north-east quadrant from outside the fence",
    "high-3/4", "afternoon", "NEED",
    prompt=P("High three-quarter aerial of the north-east quarter of the town: "
             "one Googie show house with a butterfly roof, its rear yard, the "
             "boundary fence, the service road and the plaza edge beyond."),
    consumed_by=["critic:station-aerial"])
row("map", "map-quadrant-sw", "south-west quadrant from outside the fence",
    "high-3/4", "afternoon", "NEED",
    prompt=P("High three-quarter aerial of the south-west quarter of the town: "
             "the second show house with rounded capsule volumes and a glazed "
             "rooflight, its rear yard with a sand pit and a painted court, the "
             "boundary fence and the desert beyond."),
    consumed_by=["critic:station-aerial"])

# --- 2. surroundings
row("surroundings", "sur-plaza-pylon", "pylon sign, flags and plaza dressing",
    "eye", "afternoon", "HAVE",
    ["gameplay/g-VfcKHcDJXpM-104.jpg", "concept/plaza-pylon-noon-eye.png"],
    consumed_by=["critic:station-plaza"])
row("surroundings", "sur-tower-hypar", "space-needle tower and hypar petal roofs",
    "eye", "afternoon", "HAVE",
    ["gameplay/f-mGpZaLy5_hM-099.jpg", "concept/plaza-tower-noon-eye.png"],
    consumed_by=["critic:station-plaza"])
row("surroundings", "sur-skyline-haze", "distant city skyline in aerial haze",
    "eye", "afternoon", "HAVE",
    ["gameplay/g-1icNQzMgLUM-232.jpg", "concept/surround-mountains-noon-eye.png"],
    consumed_by=["builder:build/surround", "critic:station-plaza"])
row("surroundings", "sur-mountains", "dry desert mountains on the horizon",
    "eye", "afternoon", "NEED",
    prompt=P("Dry bare desert mountains on the horizon across fifteen kilometres "
             "of hazy air, seen over a low boundary fence, showing how much "
             "contrast and saturation the range loses to aerial perspective."),
    consumed_by=["builder:build/surround"],
    note="Listed as unproduced Subject 14 in docs/reference/photoreal/MANIFEST.md.")
row("surroundings", "sur-sky-gradient", "clear desert sky zenith to horizon",
    "up", "afternoon", "NEED",
    prompt=P("Clear cloudless desert sky filling the frame from zenith to "
             "horizon in early afternoon, showing the deep blue at the top, the "
             "pale desaturated band near the horizon and the solar aureole."),
    consumed_by=["builder:core/sky", "critic:station-aerial"])

# --- 3. camera stations (these are the pairing the critic uses)
STATION_REF = {
    "aerial":          ["img/nt2025-aerial-boii.png", "gameplay/g-tB35IKluv0g-182.jpg"],
    "yardOrange":      ["gameplay/f-FKQOEO-1ceE-205.jpg", "concept/backyard-orange-noon-high34.png"],
    "yardWhite":       ["gameplay/g-1icNQzMgLUM-100.jpg", "concept/backyard-white-noon-high34.png"],
    "streetElevation": ["gameplay/f-FKQOEO-1ceE-115.jpg", "img/nt2025-sniper-boii.png"],
    "plaza":           ["gameplay/g-VfcKHcDJXpM-104.jpg", "img/nt2025-loadscreen-boii.png"],
    "turningHead":     ["gameplay/f-aICKIbuo8zQ-030.jpg", "img/nt2025-aerial-boii.png"],
    "spawnA":          ["gameplay/f-FKQOEO-1ceE-026.jpg"],
    "spawnB":          ["gameplay/g-VfcKHcDJXpM-137.jpg"],
    "midStreet":       ["gameplay/f-FKQOEO-1ceE-115.jpg"],
    "interiorOrange":  ["gameplay/f-FKQOEO-1ceE-160.jpg", "gameplay/f-aICKIbuo8zQ-148.jpg"],
}
for st, refs in STATION_REF.items():
    row("camera-station", "station-" + st,
        "capture station `%s` in src/core/stations.ts" % st,
        "fixed", "afternoon", "HAVE", refs,
        consumed_by=["critic:station-" + st, "scripts/capture.mjs"],
        note="stations.ts currently names a reference file that does not exist "
             "on disk; this row is the replacement pairing.")
row("camera-station", "station-interiorStairs",
    "NEW station: foot of the internal stair looking up", "fixed", "interior",
    "NEED",
    prompt=None,
    consumed_by=["critic:station-interiorStairs"],
    note="No station covers vertical circulation. Reference already HAVE "
         "(gameplay/f-mGpZaLy5_hM-049.jpg); what is missing is the station.")
row("camera-station", "station-garage",
    "NEW station: inside the garage looking out to the drive", "fixed",
    "interior", "NEED", prompt=None,
    consumed_by=["critic:station-garage"],
    note="Reference already HAVE (gameplay/f-FKQOEO-1ceE-141.jpg).")

# --- 4. guns x poses
WEAPONS = [
    ("longhorn", "Longhorn", "600 rpm automatic rifle, 30-round box magazine"),
    ("rattler",  "Rattler",  "800 rpm compact automatic carbine, 32-round magazine"),
    ("coachman", "Coachman", "pump-action shotgun, tube magazine of six, 8 pellets"),
    ("deadeye",  "Deadeye",  "bolt-action marksman rifle with a long telescopic sight"),
    ("duster",   "Duster",   "semi-automatic pistol, 12-round magazine, timber grips"),
]
POSES = [
    ("idle",   "first-person hip-carry idle",
     "held at the hip in the lower right of the frame, barrel to the horizon"),
    ("ads",    "first-person aim-down-sights",
     "raised and centred, sight picture aligned, the rear of the receiver "
     "filling the bottom of the frame"),
    ("fire",   "first-person firing",
     "the instant of firing, a short bright muzzle flash and the receiver "
     "kicked up a few degrees"),
    ("reload", "first-person reload",
     "tilted inboard and lowered with the magazine out of the well and the "
     "support hand on it"),
    ("sprint", "first-person sprint carry",
     "lowered and rotated about thirty degrees inboard, barrel across the "
     "bottom of the frame"),
    ("side",   "side profile, neutral",
     "full weapon in frame, orthographic-style three-quarter left side profile "
     "on a plain bleached-concrete surface, no hands"),
    ("world",  "dropped world model",
     "lying flat on pale concrete seen from above and slightly behind, as a "
     "pickup would appear"),
]
HAVE_POSE = {
    ("duster", "side"):  ["gameplay/f-mGpZaLy5_hM-147.jpg"],
    ("longhorn", "idle"): ["gameplay/f-FKQOEO-1ceE-026.jpg"],
    ("deadeye", "ads"):  ["gameplay/f-mGpZaLy5_hM-154.jpg"],
    ("longhorn", "world"): ["gameplay/f-aICKIbuo8zQ-180.jpg"],
    ("rattler", "world"): ["gameplay/f-aICKIbuo8zQ-180.jpg"],
}
for wid, wname, wdesc in WEAPONS:
    for pid, pname, pdesc in POSES:
        have = HAVE_POSE.get((wid, pid))
        row("weapon", "wep-%s-%s" % (wid, pid),
            "%s - %s" % (wname, pname), pid,
            "afternoon" if pid in ("side", "world") else "interior",
            "PARTIAL" if have else "NEED", have,
            prompt=P("An invented fictional %s for a fan game, %s. The weapon is "
                     "%s. Plain functional military finish, no markings." %
                     (wname, wdesc, pdesc)),
            consumed_by=["builder:weapons/viewmodel.ts", "critic:viewmodel"],
            note=("Analogue only - the real frame shows a different, real "
                  "weapon; use it for pose and screen footprint, never for "
                  "shape." if have else None))

# --- 5. animations
CLIPS_ANIM = ["idle", "walk", "run", "sprint", "crouch-idle", "crouch-walk",
              "jump", "land", "turn-left", "turn-right", "aim", "fire",
              "reload", "hit-react", "death"]
ANIM_HAVE = {
    "sprint": ["gameplay/f-aICKIbuo8zQ-162.jpg"],
    "run": ["gameplay/f-aICKIbuo8zQ-162.jpg", "gameplay/f-FKQOEO-1ceE-055.jpg"],
}
for c in CLIPS_ANIM:
    for view, vdesc in (("side", "full side profile, camera level with the hips"),
                        ("front34", "front three-quarter, camera level with the chest")):
        have = ANIM_HAVE.get(c) if view == "side" else None
        row("animation", "anim-%s-%s" % (c, view),
            "character clip `%s`" % c, view, "afternoon",
            "PARTIAL" if have else "NEED", have,
            prompt=P("A single soldier figure in mid-%s, %s, on bleached "
                     "concrete against a plain cream stucco wall, full body in "
                     "frame head to boots, contact shadow visible." %
                     (c.replace("-", " "), vdesc)),
            consumed_by=["builder:characters/clips.ts", "critic:animation-pose"],
            note="Pose plate only. The clip DATA comes from Kimodo SOMA-30, not "
                 "from an image - see README section 'Animation references and "
                 "the Kimodo licence'.")

# --- 6. effects
EFFECTS = [
    ("muzzle-flash", "muzzle flash at the instant of firing",
     ["gameplay/f-aICKIbuo8zQ-176.jpg"]),
    ("impact-spark", "bullet impact on concrete: spark, chip and dust puff", None),
    ("impact-dirt", "bullet impact on lawn: turf divot and dust", None),
    ("tracer", "a tracer line in flight across the street", None),
    ("smoke", "a lingering smoke column after an explosion",
     ["gameplay/f-FKQOEO-1ceE-150.jpg"]),
    ("explosion", "the bright core of an explosion at close range",
     ["gameplay/g-VfcKHcDJXpM-067.jpg"]),
    ("shell-eject", "a brass case tumbling in the air",
     ["gameplay/g-VfcKHcDJXpM-236.jpg"]),
    ("hit-feedback", "the on-screen feedback of taking damage", None),
]
for eid, edesc, have in EFFECTS:
    row("effect", "fx-" + eid, edesc, "eye", "afternoon",
        "HAVE" if have else "NEED", have,
        prompt=P("Close study of %s in a sunlit suburban street, captured at a "
                 "short shutter so the event is frozen and its colour ramp and "
                 "extent are readable." % edesc),
        consumed_by=["builder:weapons/effects.ts", "critic:effects"])

# --- 7. lighting and reflections
LIGHTING = [
    ("sun-shade-ratio", "the luminance ratio between a sunlit and a shaded "
     "stucco face meeting at a corner",
     ["photoreal/stucco-wall-sun-shade-ratio-01.png",
      "photoreal/stucco-wall-sun-shade-ratio-02.png"]),
    ("contact-shadow", "the contact shadow where grass meets concrete",
     ["photoreal/mown-lawn-contact-shadow-01.png",
      "photoreal/mown-lawn-contact-shadow-02.png"]),
    ("asphalt-grazing", "the forward specular lobe on asphalt at a grazing angle",
     ["photoreal/asphalt-grazing-specular-01.png",
      "photoreal/asphalt-grazing-specular-02.png"]),
    ("paint-reflection", "curved glossy vehicle paint reflecting ground and sky",
     ["photoreal/streamline-bus-paint-reflections-01.png",
      "gameplay/f-FKQOEO-1ceE-025.jpg"]),
    ("chrome-mirror", "a chrome bumper and hubcap as a mirror of sky and ground",
     None),
    ("glazing-fresnel", "a window band reflecting sky versus transmitting into "
     "a shaded interior", None),
    ("soffit-bounce", "bounced ground light on the underside of a deep porch "
     "canopy", None),
    ("interior-slider", "the exposure ratio looking from a dim interior out "
     "through a sunlit slider", ["gameplay/f-mGpZaLy5_hM-023.jpg"]),
    ("emissive-shelf", "glowing green display shelving throwing light onto a "
     "chequerboard floor", ["gameplay/f-FKQOEO-1ceE-141.jpg",
                            "gameplay/f-aICKIbuo8zQ-133.jpg"]),
    ("timber-shade", "a hard shadow edge cutting across dry timber boards",
     ["photoreal/timber-fence-kerb-shadow-01.png",
      "photoreal/timber-fence-kerb-shadow-02.png"]),
]
for lid, ldesc, have in LIGHTING:
    row("lighting", "lit-" + lid, ldesc, "macro", "afternoon",
        "HAVE" if have else "NEED", have,
        prompt=P("Material and light study: %s." % ldesc),
        consumed_by=["builder:core/materials.ts", "critic:photoreal"],
        note=None if have else "One of the eight subjects the photoreal run "
             "never reached (quota exhausted at 14 of 24).")

# --- 8. UI
UI = [
    ("hud-ingame", "the in-game HUD: ammo, minimap, killfeed, scorestreak icons",
     ["gameplay/g-VfcKHcDJXpM-104.jpg", "gameplay/f-aICKIbuo8zQ-117.jpg"]),
    ("scorestreaks", "the scorestreak selection grid",
     ["gameplay/g-VfcKHcDJXpM-094.jpg"]),
    ("choose-class", "the class / loadout screen",
     ["gameplay/f-FKQOEO-1ceE-001.jpg"]),
    ("scoreboard", "the end-of-match scoreboard",
     ["gameplay/f-aICKIbuo8zQ-209.jpg"]),
    ("loadscreen", "the map load screen with its title card",
     ["gameplay/g-VfcKHcDJXpM-104.jpg", "img/nt2025-loadscreen-boii.png"]),
    ("killcam", "the final killcam framing", ["gameplay/f-aICKIbuo8zQ-205.jpg"]),
]
for uid, udesc, have in UI:
    row("ui", "ui-" + uid, udesc, "menu", "n/a", "HAVE", have,
        consumed_by=["builder:ui/", "builder:game/killstreaks"],
        note="Layout and information architecture only. Do not copy glyphs, "
             "icons, type or colour - the UI lane draws its own.")

# --------------------------------------------------------------- census load
census = json.load(open(os.path.join(SCR, "census.json")))
CROWS = {r["rel"]: r for r in census["rows"]}

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()

# existing collection manifests -> prompt/subject/angle/light by filename
gen_meta = {}
for coll, mf in (("concept", "manifest.json"), ("concept2", "manifest.json")):
    p = os.path.join(REF, coll, mf)
    if not os.path.exists(p):
        continue
    d = json.load(open(p, encoding="utf-8"))
    for e in d.get("entries", []):
        fn = e.get("file") or e.get("filename")
        if not fn:
            continue
        gen_meta["%s/%s" % (coll, fn)] = dict(
            subject=e.get("subject"), angle=e.get("angle"), light=e.get("light"),
            prompt=e.get("prompt"), route=e.get("route"), local_id=e.get("id"))

HERO_IDS = {h[0] for h in HEROES}
HERO_BY_ID = {h[0]: h for h in HEROES}

entries = []
for rel in sorted(CROWS):
    r = CROWS[rel]
    coll = rel.split("/")[0]
    base = os.path.basename(rel)
    stem = os.path.splitext(base)[0]
    full = os.path.join(REF, rel.replace("/", os.sep))
    e = OrderedDict()
    e["id"] = "%s/%s" % (coll, stem)
    e["path"] = "docs/reference/" + rel
    e["collection"] = coll
    e["bytes"] = r["bytes"]
    e["width"] = r["w"]
    e["height"] = r["h"]
    e["sha256"] = sha(full)
    if coll == "gameplay" and stem.startswith("mm"):
        src = re.sub(r"^mm2?-", "", re.sub(r"-\d+$", "", stem))
        e["category"] = "derived-crop"
        e["subject"] = "HUD minimap crop taken from a gameplay frame"
        e["camera"] = {"station": None, "angle": "plan", "note": "HUD overlay"}
        e["light"] = "n/a"
        e["source"] = {"kind": "derived", "derived_from_clip": src,
                       "origin": "crop of docs/reference/gameplay/%s-*.jpg" % src}
        e["licence"] = "tier-A-derived"
        e["hero"] = False
        e["consumed_by"] = ["builder:ui/minimap"]
    elif coll == "gameplay":
        clip = re.sub(r"-\d+$", "", stem)
        meta = CLIPS.get(clip, {})
        e["category"] = "captured-gameplay"
        e["subject"] = None
        e["camera"] = {"station": None, "angle": None,
                       "note": "player-controlled, unknown FOV"}
        e["light"] = "bo2-default-afternoon"
        e["source"] = {"kind": "captured-gameplay", "clip": clip}
        e["licence"] = "tier-A"
        if stem in HERO_IDS:
            h = HERO_BY_ID[stem]
            e["hero"] = True
            e["subject"] = h[1]
            e["camera"]["angle"] = h[2]
            e["saw"] = h[3]
            e["why"] = h[4]
            e["measured"] = {k: r[k] for k in ("mean_l", "p05", "p95", "sat",
                                               "sky", "flash", "detail")}
        else:
            e["hero"] = False
        e["consumed_by"] = ["critic:frame-compare"]
    elif coll == "img":
        e["category"] = "official-still"
        e["subject"] = {
            "nt2025-aerial-boii": "whole-map plan",
            "nt2025-minimap-boii": "HUD minimap silhouette",
            "nt2025-loadscreen-boii": "load screen / plaza hero",
            "nt2025-sniper-boii": "street elevation at 2560x1440",
            "nt2025-hero-boii": "small promotional crop",
            "nt2025-review-photo-boii": "press screenshot",
        }.get(stem)
        e["camera"] = {"station": None, "angle": "plan" if "aerial" in stem or
                       "minimap" in stem else "eye", "note": ""}
        e["light"] = "bo2-default-afternoon"
        e["source"] = {"kind": "official-still",
                       "origin": "publisher / wiki still, fetched with a real "
                                 "browser User-Agent on 2026-09-18"}
        e["licence"] = "tier-A-still"
        e["hero"] = stem in ("nt2025-aerial-boii", "nt2025-minimap-boii")
        e["consumed_by"] = ["builder:core/layout.ts", "critic:station-aerial"]
    else:
        gm = gen_meta.get("%s/%s" % (coll, base), {})
        e["category"] = "generated"
        e["subject"] = gm.get("subject")
        e["camera"] = {"station": None, "angle": gm.get("angle"), "note": ""}
        e["light"] = gm.get("light") or "afternoon"
        e["source"] = {"kind": "generated", "route": gm.get("route"),
                       "prompt": gm.get("prompt"),
                       "style_block": "legacy-%s" % coll}
        e["licence"] = "tier-B"
        e["hero"] = False
        e["consumed_by"] = (["critic:photoreal", "builder:core/materials.ts"]
                            if coll == "photoreal" else ["critic:concept-bar"])
    entries.append(e)

by_coll = defaultdict(list)
for e in entries:
    by_coll[e["collection"]].append(e)

manifest = OrderedDict()
manifest["schema"] = "atomic-acres/reference-library/1"
manifest["generated"] = STAMP
manifest["generated_by"] = "reference-library lane, branch layout-boii-proportions"
manifest["root"] = "docs/reference"
manifest["style_block_id"] = STYLE_ID
manifest["style_block"] = STYLE_BLOCK
manifest["negative_block"] = NEG_BLOCK
manifest["light_slots"] = LIGHT_SLOTS
manifest["licence_tiers"] = {
 "tier-A": {"status": "third-party copyrighted game footage",
            "ships": False, "committed": False,
            "notes": "Local measurement reference only. Never redistributed, never "
                     "an asset source, never committed (gitignored). Full source "
                     "provenance is in the `clips` table above, keyed by "
                     "`source.clip`."},
 "tier-A-still": {"status": "third-party copyrighted promotional / press art",
            "ships": False, "committed": False,
            "notes": "Measurement only. Every earlier file in docs/reference/img "
                     "was a 5.8 kB HTML error page; these six are verified real "
                     "images (decode checked 2026-09-18, sha256 per row)."},
 "tier-A-derived": {"status": "derived from third-party game footage",
            "ships": False, "committed": False,
            "notes": "HUD minimap crops made by an earlier pass. Local only; kept "
                     "because the in-game minimap is a second witness to the map "
                     "silhouette."},
 "tier-B": {"status": "generated for this project, original design",
            "ships": False, "committed": False,
            "notes": "Target imagery, not an asset. The PNGs are local; this "
                     "manifest row and its prompt are the durable record."},
}
manifest["counts"] = {k: len(v) for k, v in sorted(by_coll.items())}
manifest["counts"]["total"] = len(entries)
manifest["clips"] = CLIPS
manifest["hero_count"] = sum(1 for e in entries if e.get("hero"))
manifest["entries"] = entries
json.dump(manifest, open(os.path.join(LIB, "manifest.json"), "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)

# frame-index.json: compact per-frame measured index, no shas, easy to grep
fi = OrderedDict()
fi["schema"] = "atomic-acres/reference-library/frame-index/1"
fi["generated"] = STAMP
fi["note"] = ("Every gameplay frame, measured. mean_l/p05/p95 are display-value "
              "luminance on the 160px thumbnail, sky is the fraction of the top "
              "quarter that is bright and blue-dominant, flash is the fraction "
              "of hot warm pixels, detail is mean absolute gradient. Use these "
              "to shortlist, then LOOK at the frame.")
fi["clips"] = {}
for clip, meta in CLIPS.items():
    rows = [e for e in entries if e["collection"] == "gameplay"
            and e["source"].get("clip") == clip]
    fi["clips"][clip] = OrderedDict(
        meta=meta,
        frames={os.path.basename(e["path"]): {
            k: CROWS[e["path"][len("docs/reference/"):]][k]
            for k in ("mean_l", "p05", "p95", "sat", "sky", "flash", "detail")}
            for e in sorted(rows, key=lambda x: x["path"])})
json.dump(fi, open(os.path.join(LIB, "frame-index.json"), "w", encoding="utf-8"),
          indent=0, ensure_ascii=False)

sm = OrderedDict()
sm["schema"] = "atomic-acres/reference-library/shot-matrix/1"
sm["generated"] = STAMP
sm["style_block_id"] = STYLE_ID
sm["style_block"] = STYLE_BLOCK
sm["negative_block"] = NEG_BLOCK
sm["light_slots"] = LIGHT_SLOTS
sm["rows"] = MATRIX
counts = defaultdict(lambda: defaultdict(int))
for m in MATRIX:
    counts[m["group"]][m["status"]] += 1
sm["summary"] = {g: dict(v) for g, v in counts.items()}
json.dump(sm, open(os.path.join(LIB, "shot-matrix.json"), "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)

print("manifest entries:", len(entries))
print("heroes:", manifest["hero_count"])
print("matrix rows:", len(MATRIX))
for g, v in sorted(counts.items()):
    print("  %-16s %s" % (g, dict(v)))
