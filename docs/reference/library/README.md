# Atomic Acres reference library

The visual bar for the project, in one place, with provenance.

Written 2026-09-18 on branch `layout-boii-proportions`. Nothing in `docs/reference/`
was moved, renamed or deleted to make it — this directory is an **index over what
already existed**, plus the shots that are still missing and how to make them.

```
docs/reference/library/
  README.md            this file - how to use the library
  MANIFEST.md          what is in it, where it came from, what may ship
  manifest.json        1509 rows, one per image: provenance, licence tier,
                       sha256, and which builder or critic reads it
  shot-matrix.md       113 rows: every shot the library needs, HAVE / PARTIAL /
  shot-matrix.json     NEED, with the generation prompt for each NEED
  hero-references.md   the 40 frames a critic opens first, and why each one
  frame-index.json     all 1371 gameplay frames with their measured features,
                       for shortlisting before you open anything
  tools/               three read-only scripts that regenerate the three JSON
                       files and the three generated markdown files, plus the
                       contact-sheet tool used to review the corpus
```

---

## 1. The one rule

**Nothing in this library ships, and no builder copies from it.**

A reference is something a critic *looks at*. The engine build is original code and
original geometry. Real gameplay footage is here so that an original recreation can be
measured against the thing it recreates — the same relationship a photograph of a
building has to a drawing of it. Frames are not traced, sampled, re-encoded, or turned
into textures. `gameplay/` and `img/` are gitignored so they cannot be committed by
accident; **`photoreal/` is not, and its 25 MB of PNGs are sitting untracked waiting for
the next `git add -A`** — see MANIFEST section 1.

Three provenance tiers, recorded per row in `manifest.json`:

| tier | what | ships | a builder may |
|---|---|---|---|
| **A** | `gameplay/`, `img/` — third-party copyrighted footage and press art | no | measure only |
| **B** | `photoreal/`, `concept/`, `concept2/` — generated for this project | no | match, not copy |
| **C** | `library/` — this index | yes, committed | — |

---

## 2. How a critic pairs a capture station with its reference

A station render with no named reference is not evidence of anything. That rule is
already in `AGENTS.md` and in the header of `src/core/stations.ts`. The library is
what makes it executable.

**The procedure:**

1. `npm run build` — both harnesses serve the built artifact.
2. `node scripts/capture.mjs` — writes `captures/<tag>-<station>.png` for every station
   in `src/core/stations.ts`.
3. Look up the station id in **`shot-matrix.md` → Camera stations**. That row's `have`
   column is the reference set of record.
4. Open **both** with the Read tool — the capture and the reference — at comparable
   size, and write down what differs. Not "looks flatter": *"the eave shadow reaches
   the second window mullion in the reference and the first in ours"*.
5. Cite the reference path in the verdict. A verdict with no reference path in it is a
   vibe, and the project has shipped a black screen behind ten green captures before.

**Known defect, do not trip on it:** `src/core/stations.ts` names reference files that
do not exist. `NT02 Nuketown_2025_Aerial_View_BOII.jpg`, `NT03 Nuketown_2025_BOII.jpg`,
`NT04 Nuketown_2025_Sniper_BOII.jpg` and `NT05 Nuketown_2025_Load_Screen_BOII.png` were
searched for across the whole repository on 2026-09-18 and are absent — the files on
disk are `docs/reference/img/nt2025-*.png`. Every fidelity station is therefore paired
to a filename that cannot be opened. Until `stations.ts` is corrected, the
`camera-station` rows in `shot-matrix.md` are the pairing of record:

| station | reference of record |
|---|---|
| `aerial` | `img/nt2025-aerial-boii.png` + `gameplay/g-tB35IKluv0g-182.jpg` |
| `yardOrange` | `gameplay/f-FKQOEO-1ceE-205.jpg` + `concept/backyard-orange-noon-high34.png` |
| `yardWhite` | `gameplay/g-1icNQzMgLUM-100.jpg` + `concept/backyard-white-noon-high34.png` |
| `streetElevation` | `gameplay/f-FKQOEO-1ceE-115.jpg` + `img/nt2025-sniper-boii.png` |
| `plaza` | `gameplay/g-VfcKHcDJXpM-104.jpg` + `img/nt2025-loadscreen-boii.png` |
| `turningHead` | `gameplay/f-aICKIbuo8zQ-030.jpg` + `img/nt2025-aerial-boii.png` |
| `spawnA` | `gameplay/f-FKQOEO-1ceE-026.jpg` |
| `spawnB` | `gameplay/g-VfcKHcDJXpM-137.jpg` |
| `midStreet` | `gameplay/f-FKQOEO-1ceE-115.jpg` |
| `interiorOrange` | `gameplay/f-FKQOEO-1ceE-160.jpg` + `gameplay/f-aICKIbuo8zQ-148.jpg` |

Two stations are missing entirely and their references already exist:
`station-interiorStairs` (`gameplay/f-mGpZaLy5_hM-049.jpg`) and `station-garage`
(`gameplay/f-FKQOEO-1ceE-141.jpg`). Vertical circulation and garage access are both in
the owner's brief and neither has a camera pointed at it.

**Where to start when you do not know which frame you want.** Open
`hero-references.md`. Forty frames, grouped by what they answer, each with what is
actually visible in it. If none fits, shortlist mechanically from
`frame-index.json` — `sky` high for open exteriors, `mean_l` low for interiors,
`flash` high for muzzle flash and explosions, `detail` high for close material —
then **open the frame before you rely on it**.

---

## 3. How a generation lane files a new image

**Naming.** `<matrix-id>-<NN>.png`, where `<matrix-id>` is the `id` column in
`shot-matrix.md` and `NN` is the variation number from `01`. No freeform names.
`wep-deadeye-side-01.png`, not `sniper_profile_final_v2.png`.

**Where.** A new collection directory under `docs/reference/`, named for the run
(`photoreal2/`, `guns/`, `anim-plates/`). Do not add to `concept/` or `concept2/` —
those are finished passes with their own manifests and their own legacy style block.
Add the new directory's `*.png` to `.gitignore`; commit its `manifest.json`.

**Prompt.** Take the frozen style block `AA-STYLE-2026-09-18` verbatim from
`shot-matrix.json` (`style_block`), append the subject sentence from the matrix row,
append the negative block verbatim. The style text must be **byte-identical** across
the whole catalogue — that is the only reason two images from different runs can be
judged side by side. Keep the subject sentence to about 60 words: CLIP-family text
encoders truncate at 77 tokens in silence, and a subject named after the cut never
renders.

**Model.** One generator for a whole group. Record `route` (model id, revision, where
it ran) and the seed if the generator has one. Mixing models inside a group breaks
style consistency and the comparison stops meaning anything.

**Reject and regenerate** on: wrong subject, geometry or anatomy errors, style drift
against the block, any watermark or text, any logo or signage, a blank or near-black
render. The 2026-09-18 `concept/` run shipped a 111 kB pure-black Blender render as
`white-house-noon-rear.png` and only caught it because someone checked byte counts.

**Filing.** One row per image in the run's own `manifest.json`:

```json
{ "id": "wep-deadeye-side-01",
  "file": "wep-deadeye-side-01.png",
  "matrix_id": "wep-deadeye-side",
  "subject": "Deadeye - side profile, neutral",
  "angle": "side", "light": "afternoon",
  "style_block": "AA-STYLE-2026-09-18",
  "prompt": "<the full prompt, exactly as sent>",
  "route": "<model id + revision + where it ran>",
  "seed": 123456,
  "bytes": 1234567 }
```

Then re-run the library generator so the row gets a `sha256`, real dimensions, a
`consumed_by`, and a licence tier. A file with no manifest row is not in the library,
however good it looks.

**Then freeze.** Once a group is filed it is the bar for the campaign. Changing a
reference mid-run to make a render pass is moving the goalposts; it needs the owner
and it is a new catalogue revision, not an edit.

---

## 4. Animation references, and the Kimodo licence position

The `animation` rows in the shot matrix are **pose plates** — a still a critic holds
next to a rendered frame to ask "is the contact pose right, is the weight on the right
foot". They are not motion data. The clips themselves come from Kimodo
(`C:\Users\david\projects\kimodo.cpp`) retargeted onto the rig in `src/characters/`.

Two things about that pipeline belong in this library because they decide whether the
animation rows can ever be filled.

**Joint layout.** `kimodo-soma-rp-v1.1-f32.gguf` emits **SOMA-30**, not SMPL-X 22. The
port's README says Kimodo "gives you SMPL-X"; that is true only of the SMPL-X
checkpoint, which is under NVIDIA's *Internal Scientific Research and Development*
licence and is **not present on disk** and must not be used. Carry both layouts and
select by joint count at import.

**The text-encoder question, as found on disk on 2026-09-18.** The handoff records this
as a blocker: text prompts *and* precomputed embeddings both go through the
Llama-3-derived bundle, so "don't use the Llama bundle" and "drive it from text" cannot
both hold. What is actually on disk:

- `kimodo.cpp/weights/generated/llm2vec-text-bundle/` — **35 GGUF files, 14.14 GB**
  (32 layers at 421 MB each, a 1002 MB embedding, a 7 MB tokeniser, a final norm).
  The handoff says 2.8 GB; measured today it is 14.14 GB / 15,184,997,550 bytes.
  The motion model beside it is 1.06 GB.
- `kimodo.cpp/scripts/hf/Llama-3-Kimodo-GGML/README.md`: *"converted from Meta
  Llama-3-8B-Instruct and the MIT-licensed McGill LLM2Vec MNTP and supervised
  adapters. **Built with Meta Llama 3.**"* It states that
  `LICENSE-META-LLAMA-3.txt` and `NOTICE` accompany the distribution.
- **Neither of those two files is present.** A recursive search of the whole
  `kimodo.cpp` tree for `*META-LLAMA*` returns nothing, and the `NOTICE` at the
  repository root is 0 bytes. So the licence text has not in fact been read here, by
  anyone, because it is not here to read.
- `kimodo.cpp/README.md` line 111 documents `--motion-only` for *"supplying a
  precomputed 4096-float LLM2Vec embedding"*. That flag is the lever.

The blocker as written assumes the constraint is "never execute the Llama bundle". If
the real constraint is the licence's own — **do not redistribute Llama Materials
without its conditions** — then both halves hold at once, because the bundle is a local
build tool whose output is a motion clip, and the bundle itself never leaves this
machine and never enters this repository.

The concrete steps, in order, before the animation lane runs:

1. Fetch `LICENSE-META-LLAMA-3.txt` from the canonical Meta Llama 3 model card and put
   it next to the bundle, then read it. This is the step that has not happened — and it
   cannot happen by accident, because the file is not on this machine.
2. Check the four clauses that actually bite: the redistribution conditions (ship a
   copy of the agreement, display *"Built with Meta Llama 3"*), the model-naming rule
   (a distributed *model* built with it must be named `Llama 3 …`), the 700-million
   monthly-active-user commercial threshold, and the acceptable-use policy. A fan
   project ships motion data, not a model, and is nowhere near the user threshold.
3. Run the encoder **once**, locally, over the finished prompt list; write the
   4096-float embeddings into a small cached JSON in the animation lane's own working
   directory. From then on every generation is `--motion-only` and the bundle is never
   touched again — not in CI, not at build time, not by another machine.
4. If the licence text turns out to require attribution for a product that merely
   *used* the materials, satisfy it the cheap way: one line in the game credits and a
   copy of the licence in a `THIRD-PARTY-NOTICES` file. That costs nothing and removes
   the ambiguity permanently.

What does **not** work, so nobody spends a night on it: swapping in a different text
encoder. The motion model is conditioned on a vector in LLM2Vec's specific 4096-d
space. An arbitrary encoder of the same width produces noise, not a different accent.
The choice is "cache embeddings from this encoder" or "no text conditioning at all" —
there is no third encoder.

> Everything in this section above the numbered list was read off this machine's disk
> today. The four clauses in step 2 are recalled, not quoted: the licence file is not
> present locally and was not fetched during this pass. Read it before relying on it.

---

## 5. What this library does not claim

- **Frame-level subject labels for all 1371 gameplay frames.** Every frame was put on a
  labelled contact sheet (`tools/contact-sheets.py`, 26 sheets of 10x6) and looked at
  once, at 192 px. Forty were reopened at 480 px or larger and are described in
  `hero-references.md`. The other 1331 carry clip-level provenance and measured
  features only, and `subject` is `null` for them. That is deliberate: an invented
  label is worse than none.
- **That every frame shows the map.** Title cards, menus, scoreboards, killcams and
  blood-overlay frames are in the corpus and are not excluded. See MANIFEST section 2.
- **Pixel values as linear radiance.** The footage is BO2 at its own exposure and
  grade, and `?post=ao` output in our own captures is tone-mapped too. Read
  relationships, not absolutes.
- **That the `NEED` prompts have been run.** 71 of the 113 matrix rows are `NEED`
  (35 `HAVE`, 7 `PARTIAL`). **No image was generated during this pass.** The prompts
  are written and frozen; nothing has been spent on them yet.
- **That any render was compared to any reference during this pass.** The library is
  the apparatus. The first comparison is the next lane's job.
