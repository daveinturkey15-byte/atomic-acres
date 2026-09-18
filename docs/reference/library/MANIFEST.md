# Atomic Acres reference library - MANIFEST

Generated 2026-09-18 by the reference-library lane on branch `layout-boii-proportions`.

Machine-readable twin: `manifest.json` (same directory, same ids).


> **Nothing in this library ships.** These are *targets*. The engine build is
> original code and original geometry; a reference is something a critic looks at,
> never something a builder copies.


## 1. What is in it

| collection | files | what it is | committed? |
|---|---:|---|---|
| `gameplay/` | 1378 | 1371 frames sampled from six Nuketown 2025 gameplay videos, plus 7 minimap crops an earlier pass made | no - gitignored |
| `img/` | 6 | official / press stills of the real map | no - gitignored |
| `photoreal/` | 13 | generated photographic material and light studies | **untracked and NOT gitignored - 25 MB waiting for the next `git add -A`** |
| `concept/` | 53 | generated concept art, pass 1 (subjects and light slots) | no - `*.png` gitignored, `manifest.json` committed |
| `concept2/` | 59 | generated concept art, pass 2 (east side, ground, interiors, mannequins, turning head) | no - `*.png` gitignored, manifests committed |
| **total** | **1509** | | |

Every one of the 1509 files was decoded on 2026-09-18. **0 failed.** No HTML error pages,
no truncated downloads, no zero-byte files. That check is not a formality: every
file that used to be in `img/` was a 5.8 kB HTML error page, because the fetch had
no browser User-Agent and nobody looked at the bytes, and every 'measured off the
minimap' claim before 2026-09-18 was void as a result. The generator decodes every
file every time it runs, so that failure cannot be silent twice.


> **Hazard found while indexing.** `docs/reference/photoreal/` holds 25 MB of PNGs
> that are neither committed nor gitignored. Any `git add -A` will stage them,
> against the `AGENTS.md` rule that reference images are not committed. Add
> `docs/reference/photoreal/*.png` to `.gitignore`, or commit them deliberately -
> but decide; do not leave it to the next `add -A`.


## 2. The six gameplay clips

All six are **Nuketown 2025**. The evidence, in order of strength, because a video
title is not evidence: `gameplay/f-aICKIbuo8zQ-209.jpg` is an end-of-match
scoreboard whose header reads *Team Deathmatch - Nuketown 2025* in the game's own
type; `gameplay/g-VfcKHcDJXpM-104.jpg` is the in-game load screen and reads
*NUKETOWN 2025 / NEVADA, U.S.A.*; and every one of the 1371 frames was reviewed on
contact sheets and shows the same two houses, the same central turning circle with
the same coach and box truck in it, and the same plaza, matching
`img/nt2025-aerial-boii.png` feature for feature.


One caution from that review, recorded because it nearly went the other way. The
back-yard **hydroponic planting troughs** in `g-1icNQzMgLUM` (frames ~070-082) look
at first like a different map entirely - a greenhouse, indoors, wrong. They are not.
They are visible in the official aerial, in the yard on the same side, and the match
score runs unbroken across those frames. The aerial settled it; the video title
would not have.


| clip | frames | size | source | uploader / date | why you would open it |
|---|---:|---|---|---|---|
| `f-aICKIbuo8zQ` | 210 | 1600x900 | [yt:aICKIbuo8zQ] | Leva, 2020-07-05 | interiors (kitchen, purple bedroom, garage), killstreak tablet, victory + final-killcam wide shots, scope frames |
| `f-FKQOEO-1ceE` | 212 | 1600x900 | [yt:FKQOEO-1ceE] | Leva, 2021-05-05 | street axis, coach and box truck, stone masonry, pylon sign; WARNING a very large bright organic weapon camo occupies the lower third of most frames |
| `f-mGpZaLy5_hM` | 212 | 1600x900 | [yt:mGpZaLy5_hM] | Antz3 FPS, 2022-06-11 | best optics coverage (iron / red dot / ACOG / sniper scope), both staircases, garage shelving, pistol held side-on |
| `g-1icNQzMgLUM` | 284 | 1600x900 | [yt:1icNQzMgLUM] | Gaming N nostalgia, 2023-04-18 | back-yard vegetable troughs, shuffleboard court, breeze-block screen walls, skyline; frames 001-007 and 281-284 are the uploader's title / outro cards and contain no map |
| `g-VfcKHcDJXpM` | 265 | 1600x1200 | [yt:VfcKHcDJXpM] | It's Lucky, 2022-06-05 | the ONLY clip with the menu chain - CUSTOM GAMES, the full SCORESTREAKS grid, CHOOSE CLASS, and the in-game NUKETOWN 2025 load screen; smallest HUD occlusion of the six |
| `g-tB35IKluv0g` | 188 | 1600x900 | [yt:tB35IKluv0g] | Neff, 2021-08-30 | Demolition objective HUD, thermal/night scope frames, and the single best whole-map overview in the corpus (182-183); frames 185-188 are the uploader's outro card |

Extraction is recorded per clip in `manifest.json` and reproducible from
`docs/reference/gameplay/grab.sh` and `grab2.sh` (yt-dlp -> ffmpeg, 1600 px wide,
`-q:v 3`, one frame every 3 s or 4 s).


**Five things that will cost you time in this corpus:**

1. Not every frame is the map. Title cards, `CHOOSE CLASS`, `CUSTOM GAMES`,
   `SCORESTREAKS`, scoreboards, killcams, blood-overlay death frames and heavy
   motion blur are all in there. `frame-index.json` gives you `mean_l`, `sky`,
   `flash` and `detail` per frame so you can shortlist mechanically - then look.
2. `f-FKQOEO-1ceE` is the most-cited clip in the project's own notes but carries a
   very large, very bright organic weapon camo across the bottom third of nearly
   every frame. It is a poor choice for ground and lower-facade reads.
3. `g-VfcKHcDJXpM` is 4:3 (1600x1200). Do not letterbox-compare it against a 16:9
   capture; crop the capture instead.
4. The back yards contain planted hydroponic troughs. They are real - they are
   visible in the official aerial - and our build has none. They read as 'wrong
   map' at first glance. They are not.
5. Footage is BO2 at its own exposure and grade. Read it for geometry, layout,
   material family and value *relationships*. Do not sample a pixel and call it a
   linear albedo.


## 3. Licence and provenance tiers

Every row in `manifest.json` carries a `licence` key into the top-level
`licence_tiers` table. There are three tiers.


| tier | collections | status | may it ship? | may a builder copy from it? |
|---|---|---|---|---|
| A | `gameplay/`, `img/` | third-party copyrighted game footage and promotional art | **no** | **no** - measure only |
| B | `photoreal/`, `concept/`, `concept2/` | generated for this project, original designs | no (they are targets) | no - they are a bar, not an asset |
| C | `library/` | this index, written here | yes, committed | n/a |

Tier A exists so that an original recreation can be *measured* against the thing
it recreates. It is the same relationship a photograph of a building has to a
drawing of it. Nothing from tier A is traced, sampled, re-encoded or shipped, and
the files are gitignored so they cannot be committed by accident.


Tier B prompts are recorded per file. They describe an **invented** show town and
carry a negative block that forbids logos, signage and trade dress. Two legacy
style blocks are in use (`legacy-concept`, `legacy-concept2`); new work uses the
single frozen block `AA-STYLE-2026-09-18` in `shot-matrix.json`.


## 4. Row schema (`manifest.json`)

```
id           <collection>/<file stem>, stable, used by critics and briefs
path         repo-relative path, forward slashes
collection   gameplay | img | photoreal | concept | concept2
category     captured-gameplay | official-still | generated | derived-crop
subject      what it is OF (hand-written for heroes, null for bulk frames)
camera       { station, angle, note }  station = a key in src/core/stations.ts
light        bo2-default-afternoon | afternoon | lowsun | overcast | interior | n/a
source       { kind, clip }  -> full provenance in the top-level `clips` table
             or { kind: generated, route, prompt, style_block }
licence      a key into the top-level `licence_tiers` table (tier-A, tier-B, ...)
consumed_by  which builder or critic reads this - the point of the row
measured     mean_l p05 p95 sat sky flash detail   (hero rows; every gameplay
             frame is measured in frame-index.json)
hero         true for the 40 curated gameplay frames + 2 official stills
saw / why    hero rows only: what was actually visible, and why it is a hero
bytes width height sha256    mechanical, recomputed by the build script
```

`sha256` pins the file. If a reference changes, the hash changes and the bar has
moved - that is a catalogue revision and needs the owner, not a quiet overwrite.


## 5. Heroes

40 gameplay frames plus the 2 official stills are marked `hero: true`. They are
listed with justifications in `hero-references.md`. A critic starts there.


## 6. Regenerating

This manifest is generated, not hand-maintained. The generator walks
`docs/reference/`, decodes every image (that is the error-page check), measures
it, hashes it, and folds in the per-collection manifests that already existed
(`concept/manifest.json`, `concept2/manifest.json`, `photoreal/MANIFEST.md`).
Hand-written content - the hero list, the shot matrix, the clip notes - lives in
the generator, so regenerating never silently drops it.

