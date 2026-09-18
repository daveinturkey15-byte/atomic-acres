# -*- coding: utf-8 -*-
"""Emit the markdown faces of the reference library from the generated JSON."""
import json, os
from collections import defaultdict, OrderedDict

REPO = r"C:\Users\david\Desktop\stuff\nuketown"
LIB = os.path.join(REPO, "docs", "reference", "library")
M = json.load(open(os.path.join(LIB, "manifest.json"), encoding="utf-8"))
SM = json.load(open(os.path.join(LIB, "shot-matrix.json"), encoding="utf-8"))
W = lambda name, text: open(os.path.join(LIB, name), "w", encoding="utf-8").write(text)

ent = M["entries"]
heroes = [e for e in ent if e.get("hero")]
gp_heroes = [e for e in heroes if e["collection"] == "gameplay"]

# ----------------------------------------------------------------- MANIFEST.md
L = []
A = L.append
A("# Atomic Acres reference library - MANIFEST\n")
A("Generated %s by the reference-library lane on branch `layout-boii-proportions`.\n"
  % M["generated"])
A("Machine-readable twin: `manifest.json` (same directory, same ids).\n")
A("\n> **Nothing in this library ships.** These are *targets*. The engine build is\n"
  "> original code and original geometry; a reference is something a critic looks at,\n"
  "> never something a builder copies.\n")

A("\n## 1. What is in it\n")
A("| collection | files | what it is | committed? |")
A("|---|---:|---|---|")
DESC = {
 "gameplay": "1371 frames sampled from six Nuketown 2025 gameplay videos, plus 7 "
             "minimap crops an earlier pass made",
 "img": "official / press stills of the real map",
 "photoreal": "generated photographic material and light studies",
 "concept": "generated concept art, pass 1 (subjects and light slots)",
 "concept2": "generated concept art, pass 2 (east side, ground, interiors, "
             "mannequins, turning head)",
}
COMMIT = {"gameplay": "no - gitignored", "img": "no - gitignored",
          "photoreal": "**untracked and NOT gitignored - 25 MB waiting for the "
                       "next `git add -A`**",
          "concept": "no - `*.png` gitignored, `manifest.json` committed",
          "concept2": "no - `*.png` gitignored, manifests committed"}
for c in ("gameplay", "img", "photoreal", "concept", "concept2"):
    A("| `%s/` | %d | %s | %s |" % (c, M["counts"][c], DESC[c], COMMIT[c]))
A("| **total** | **%d** | | |" % M["counts"]["total"])
A("\nEvery one of the %d files was decoded on %s. **0 failed.** No HTML error pages,\n"
  "no truncated downloads, no zero-byte files. That check is not a formality: every\n"
  "file that used to be in `img/` was a 5.8 kB HTML error page, because the fetch had\n"
  "no browser User-Agent and nobody looked at the bytes, and every 'measured off the\n"
  "minimap' claim before 2026-09-18 was void as a result. The generator decodes every\n"
  "file every time it runs, so that failure cannot be silent twice.\n"
  % (M["counts"]["total"], M["generated"]))
A("\n> **Hazard found while indexing.** `docs/reference/photoreal/` holds 25 MB of PNGs\n"
  "> that are neither committed nor gitignored. Any `git add -A` will stage them,\n"
  "> against the `AGENTS.md` rule that reference images are not committed. Add\n"
  "> `docs/reference/photoreal/*.png` to `.gitignore`, or commit them deliberately -\n"
  "> but decide; do not leave it to the next `add -A`.\n")

A("\n## 2. The six gameplay clips\n")
A("All six are **Nuketown 2025**. The evidence, in order of strength, because a video\n"
  "title is not evidence: `gameplay/f-aICKIbuo8zQ-209.jpg` is an end-of-match\n"
  "scoreboard whose header reads *Team Deathmatch - Nuketown 2025* in the game's own\n"
  "type; `gameplay/g-VfcKHcDJXpM-104.jpg` is the in-game load screen and reads\n"
  "*NUKETOWN 2025 / NEVADA, U.S.A.*; and every one of the 1371 frames was reviewed on\n"
  "contact sheets and shows the same two houses, the same central turning circle with\n"
  "the same coach and box truck in it, and the same plaza, matching\n"
  "`img/nt2025-aerial-boii.png` feature for feature.\n")
A("\nOne caution from that review, recorded because it nearly went the other way. The\n"
  "back-yard **hydroponic planting troughs** in `g-1icNQzMgLUM` (frames ~070-082) look\n"
  "at first like a different map entirely - a greenhouse, indoors, wrong. They are not.\n"
  "They are visible in the official aerial, in the yard on the same side, and the match\n"
  "score runs unbroken across those frames. The aerial settled it; the video title\n"
  "would not have.\n")
A("\n| clip | frames | size | source | uploader / date | why you would open it |")
A("|---|---:|---|---|---|---|")
for cid, c in M["clips"].items():
    A("| `%s` | %d | %dx%d | [yt:%s] | %s, %s | %s |" % (
        cid, c["frames"], c["w"], c["h"], c["yt"], c["uploader"], c["uploaded"],
        c["strengths"]))
A("\nExtraction is recorded per clip in `manifest.json` and reproducible from\n"
  "`docs/reference/gameplay/grab.sh` and `grab2.sh` (yt-dlp -> ffmpeg, 1600 px wide,\n"
  "`-q:v 3`, one frame every 3 s or 4 s).\n")
A("\n**Five things that will cost you time in this corpus:**\n")
A("1. Not every frame is the map. Title cards, `CHOOSE CLASS`, `CUSTOM GAMES`,\n"
  "   `SCORESTREAKS`, scoreboards, killcams, blood-overlay death frames and heavy\n"
  "   motion blur are all in there. `frame-index.json` gives you `mean_l`, `sky`,\n"
  "   `flash` and `detail` per frame so you can shortlist mechanically - then look.\n"
  "2. `f-FKQOEO-1ceE` is the most-cited clip in the project's own notes but carries a\n"
  "   very large, very bright organic weapon camo across the bottom third of nearly\n"
  "   every frame. It is a poor choice for ground and lower-facade reads.\n"
  "3. `g-VfcKHcDJXpM` is 4:3 (1600x1200). Do not letterbox-compare it against a 16:9\n"
  "   capture; crop the capture instead.\n"
  "4. The back yards contain planted hydroponic troughs. They are real - they are\n"
  "   visible in the official aerial - and our build has none. They read as 'wrong\n"
  "   map' at first glance. They are not.\n"
  "5. Footage is BO2 at its own exposure and grade. Read it for geometry, layout,\n"
  "   material family and value *relationships*. Do not sample a pixel and call it a\n"
  "   linear albedo.\n")

A("\n## 3. Licence and provenance tiers\n")
A("Every row in `manifest.json` carries a `licence` key into the top-level\n"
  "`licence_tiers` table. There are three tiers.\n")
A("\n| tier | collections | status | may it ship? | may a builder copy from it? |")
A("|---|---|---|---|---|")
A("| A | `gameplay/`, `img/` | third-party copyrighted game footage and promotional art | **no** | **no** - measure only |")
A("| B | `photoreal/`, `concept/`, `concept2/` | generated for this project, original designs | no (they are targets) | no - they are a bar, not an asset |")
A("| C | `library/` | this index, written here | yes, committed | n/a |")
A("\nTier A exists so that an original recreation can be *measured* against the thing\n"
  "it recreates. It is the same relationship a photograph of a building has to a\n"
  "drawing of it. Nothing from tier A is traced, sampled, re-encoded or shipped, and\n"
  "the files are gitignored so they cannot be committed by accident.\n")
A("\nTier B prompts are recorded per file. They describe an **invented** show town and\n"
  "carry a negative block that forbids logos, signage and trade dress. Two legacy\n"
  "style blocks are in use (`legacy-concept`, `legacy-concept2`); new work uses the\n"
  "single frozen block `%s` in `shot-matrix.json`.\n" % M["style_block_id"])

A("\n## 4. Row schema (`manifest.json`)\n")
A("```")
A("id           <collection>/<file stem>, stable, used by critics and briefs")
A("path         repo-relative path, forward slashes")
A("collection   gameplay | img | photoreal | concept | concept2")
A("category     captured-gameplay | official-still | generated | derived-crop")
A("subject      what it is OF (hand-written for heroes, null for bulk frames)")
A("camera       { station, angle, note }  station = a key in src/core/stations.ts")
A("light        bo2-default-afternoon | afternoon | lowsun | overcast | interior | n/a")
A("source       { kind, clip }  -> full provenance in the top-level `clips` table")
A("             or { kind: generated, route, prompt, style_block }")
A("licence      a key into the top-level `licence_tiers` table (tier-A, tier-B, ...)")
A("consumed_by  which builder or critic reads this - the point of the row")
A("measured     mean_l p05 p95 sat sky flash detail   (hero rows; every gameplay")
A("             frame is measured in frame-index.json)")
A("hero         true for the 40 curated gameplay frames + 2 official stills")
A("saw / why    hero rows only: what was actually visible, and why it is a hero")
A("bytes width height sha256    mechanical, recomputed by the build script")
A("```")
A("\n`sha256` pins the file. If a reference changes, the hash changes and the bar has\n"
  "moved - that is a catalogue revision and needs the owner, not a quiet overwrite.\n")

A("\n## 5. Heroes\n")
A("%d gameplay frames plus the 2 official stills are marked `hero: true`. They are\n"
  "listed with justifications in `hero-references.md`. A critic starts there.\n"
  % len(gp_heroes))

A("\n## 6. Regenerating\n")
A("This manifest is generated, not hand-maintained. The generator walks\n"
  "`docs/reference/`, decodes every image (that is the error-page check), measures\n"
  "it, hashes it, and folds in the per-collection manifests that already existed\n"
  "(`concept/manifest.json`, `concept2/manifest.json`, `photoreal/MANIFEST.md`).\n"
  "Hand-written content - the hero list, the shot matrix, the clip notes - lives in\n"
  "the generator, so regenerating never silently drops it.\n")
W("MANIFEST.md", "\n".join(L) + "\n")

# ------------------------------------------------------------- shot-matrix.md
L = []
A = L.append
A("# Atomic Acres reference library - SHOT MATRIX\n")
A("Generated %s. Machine-readable twin: `shot-matrix.json`.\n" % SM["generated"])
A("\n%d rows across eight groups. `HAVE` means at least one reference exists and is\n"
  "named. `PARTIAL` means something usable exists but it is an analogue, not the\n"
  "shot. `NEED` means it must be generated, and the prompt is given.\n" % len(SM["rows"]))

tot = defaultdict(int)
A("\n| group | HAVE | PARTIAL | NEED | total |")
A("|---|---:|---:|---:|---:|")
for g in ("map", "surroundings", "camera-station", "weapon", "animation",
          "effect", "lighting", "ui"):
    s = SM["summary"].get(g, {})
    n = sum(s.values())
    for k, v in s.items():
        tot[k] += v
    A("| %s | %d | %d | %d | %d |" % (g, s.get("HAVE", 0), s.get("PARTIAL", 0),
                                      s.get("NEED", 0), n))
A("| **all** | **%d** | **%d** | **%d** | **%d** |" % (
    tot["HAVE"], tot["PARTIAL"], tot["NEED"], sum(tot.values())))

A("\n## The frozen style block\n")
A("Every generated reference in this catalogue uses this block **byte-identical**.\n"
  "Only the subject sentence changes. Changing the block is a catalogue revision.\n")
A("\n**id `%s`**\n" % SM["style_block_id"])
A("\n```")
A(SM["style_block"])
A("```")
A("\n**Negative block, appended to every prompt:**\n")
A("\n```")
A(SM["negative_block"])
A("```")
A("\n**Light slots** (the first is the fixed condition; the others are variations a\n"
  "lane may request explicitly):\n")
for k, v in SM["light_slots"].items():
    A("- `%s` - %s" % (k, v))
A("\nBudget the subject sentence to about 60 words. CLIP-family text encoders "
  "truncate\nsilently at 77 tokens, and a subject named after the cut never renders.\n")

GROUP_TITLE = OrderedDict([
    ("map", "Map"), ("surroundings", "Surroundings"),
    ("camera-station", "Camera stations"), ("weapon", "Guns x poses"),
    ("animation", "Animations"), ("effect", "Effects"),
    ("lighting", "Lighting and reflections"), ("ui", "UI, HUD and killstreaks")])
GROUP_NOTE = {
 "camera-station": "This is the pairing a critic uses. **`src/core/stations.ts` "
   "currently names reference files that do not exist on disk** - `NT02 "
   "Nuketown_2025_Aerial_View_BOII.jpg` and three siblings were checked across the "
   "whole repo on 2026-09-18 and are absent. Until stations.ts is updated, use the "
   "`have` column here as the pairing of record.",
 "weapon": "Five weapons x seven poses. The five are the project's own invented "
   "weapons from `src/weapons/catalog.ts`, not ports. A `PARTIAL` row points at a "
   "real frame that shows the *pose* well; it shows a different, real weapon and "
   "must never be used for shape.",
 "animation": "These are **pose plates**, not motion data. The clips themselves come "
   "from Kimodo SOMA-30 (see the library README). A pose plate is what a critic "
   "holds next to a rendered frame to ask 'is the contact pose right'.",
 "ui": "Layout and information architecture only. No glyph, icon, typeface or colour "
   "is copied; the UI lane draws its own. What these frames answer is *what "
   "information is on screen and where*.",
}
for g, title in GROUP_TITLE.items():
    rows = [r for r in SM["rows"] if r["group"] == g]
    A("\n## %s (%d)\n" % (title, len(rows)))
    if g in GROUP_NOTE:
        A("> %s\n" % GROUP_NOTE[g])
    A("| id | subject | view | light | status | reference / prompt |")
    A("|---|---|---|---|---|---|")
    for r in rows:
        if r["have"]:
            ref = "<br>".join("`%s`" % h for h in r["have"])
            if r["status"] == "PARTIAL":
                ref += "<br>*(pose analogue only)*"
        elif r["prompt"]:
            ref = "*prompt:* " + r["prompt"].replace(SM["style_block"], "**[STYLE]** ") \
                                            .replace(SM["negative_block"], "**[NEG]**") \
                                            .replace("|", "/")
        else:
            ref = "*(no image needed - see note)*"
        note = ("<br>**note:** " + r["note"].replace("|", "/")) if r["note"] else ""
        A("| `%s` | %s | %s | %s | **%s** | %s%s |" % (
            r["id"], r["subject"].replace("|", "/"), r["view"], r["light"],
            r["status"], ref, note))
W("shot-matrix.md", "\n".join(L) + "\n")

# --------------------------------------------------------- hero-references.md
L = []
A = L.append
A("# Atomic Acres reference library - HERO REFERENCES\n")
A("The %d gameplay frames a critic compares against **first**, plus the 2 official\n"
  "stills that outrank all of them. Chosen on %s after every one of the 1371\n"
  "gameplay frames was put on a labelled contact sheet and looked at, and after each\n"
  "frame below was reopened at 480 px or larger.\n" % (len(gp_heroes), M["generated"]))
A("\n`saw` is what was actually visible in the frame. `why` is what it is for.\n")

order = ["map", "vehicle", "house-orange", "house-white", "interior", "exterior",
         "yard", "surroundings", "weapon", "effect", "ui"]
TITLES = {"map": "Whole map and layout", "vehicle": "Vehicles",
          "house-orange": "Orange house", "house-white": "White house",
          "interior": "Interiors - stairs, kitchen, bedroom, lounge, garage",
          "exterior": "Exterior stairs and upper-floor access",
          "yard": "Yards, ground and fences", "surroundings": "Surroundings",
          "weapon": "Weapons and optics", "effect": "Effects",
          "ui": "UI, HUD and killstreaks"}
A("\n## The two that outrank everything\n")
for e in heroes:
    if e["collection"] != "img":
        continue
    A("\n### `%s`\n" % e["id"])
    A("- **subject** %s" % e["subject"])
    A("- **why** The layout source of record. `src/core/layout.ts` traces to it, and "
      "the 2026-09-18 re-proportioning was measured off it. Verified real (%dx%d, "
      "decodes, sha in manifest)." % (e["width"], e["height"]))

n = 0
for grp in order:
    rows = [e for e in gp_heroes if e["subject"].split("/")[0] == grp]
    if not rows:
        continue
    A("\n## %s (%d)\n" % (TITLES[grp], len(rows)))
    for e in rows:
        n += 1
        A("\n### %d. `%s`  -  %s, %s\n" % (n, e["id"], e["subject"],
                                           e["camera"]["angle"]))
        A("- **saw** %s" % e["saw"])
        A("- **why** %s" % e["why"])
A("\n---\n")
A("\n%d gameplay heroes listed. Every remaining frame is still in the library and\n"
  "still indexed in `frame-index.json`; the hero list is a starting point, not a\n"
  "whitelist. If a critic needs a shot that is not here, shortlist on the measured\n"
  "columns, open the frame, and add it here with its own `saw` and `why`.\n" % n)
W("hero-references.md", "\n".join(L) + "\n")
print("wrote MANIFEST.md, shot-matrix.md, hero-references.md; heroes listed:", n)
