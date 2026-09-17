# Report: CONCEPT REFERENCE LIBRARY (brief-refs)

Orchestrated two parallel lanes (ConceptImages, ConceptBar). Both completed; orchestrator verified on disk.

## What changed

- `docs/reference/concept/` (new): **53 PNGs** + `manifest.json` (53 entries, each `{id, filename, prompt, route, subject, angle, light}` plus per-file `bytes` and model map, plus an `attempts` log). Lane A only; `src/` untouched.
- `docs/reference/CONCEPT-BAR.md` (new, 28,025 bytes, 470 lines): nine subject areas × five lenses (material/value/silhouette/colour/clean-shapes), falsifiable statements, exactly **five highest-leverage changes** grounded in ship captures (§"Five highest-leverage changes"). Lane B only.
- `.gitignore`: Lane A appended one line (`docs/reference/concept/*.png`). PNGs ignored, `manifest.json` tracked — verified via `git check-ignore` both directions.

## What measured (orchestrator, not estimated)

- `ls docs/reference/concept/*.png | wc -l` → **53**.
- Python byte sum → **74,815,263 bytes (71.3 MiB)**.
- Manifest↔disk parity script → 53 entries / 53 files, **zero orphans either way**; required keys present on every entry.
- `npx tsc --noEmit -p tsconfig.json` → **EXIT 0**, no output.
- `git status --short` → our lanes touched only `docs/reference/concept/`, `docs/reference/CONCEPT-BAR.md`, `.gitignore` line 6. Other entries in the status (bak-gpu deletions, mannequin/yard/world mods, tmp/probe lines) belong to concurrently-running agents, not us.

## What looked at (opened, not assumed)

- `docs/reference/concept/orange-house-noon-eye.png` — real photographic concept frame: butterfly roof, terracotta panels, non-blank, on-brief. (Read-tool results arrived swapped with the next item; both images positively viewed.)
- `captures/ship-yardOrange.png` — current-build game render (deck, mannequins, dome, pylon), looked at as grounding reference.
- `docs/reference/CONCEPT-BAR.md` head (§1 lenses) and tail (five changes + sources footnote) — read in full sections; structure and grounding claims hold.
- `docs/reference/concept/manifest.json` head (attempts log + first entries) — Route-A test stdout recorded verbatim.

## Generation routes (honest)

- **Route A (agy CLI) WORKED on first test** and produced all 53 files: `agy --model gemini-3.7-flash-high --effort high --dangerously-skip-permissions --print-timeout 840s`. Test file `test-route-a.png` (991,344 bytes, Imagen 3) landed, then bulk batches: Imagen 3 ×9, Gemini Flash Image ×14, local Juggernaut-XL (RTX 5080) ×22, local SDXL-Turbo ×7 — per-file models in manifest `models` map.
- **Route B (ComfyUI) never attempted** — not needed once A worked. Skill decision tree not exercised; no claim about local ComfyUI state.
- **No web images downloaded.** One failure handled honestly: `white-house-noon-rear.png` first arrived as a 111,421-byte pure-black Blender Cycles render (wrong pipeline) and was regenerated correctly (1,578,417 bytes, photographic, verified non-blank). Stray `test_*.png`/`test-pipeline.png` files removed same session.

## Could not resolve / stale items

1. `CONCEPT-BAR.md` line 4 says `manifest.json` was "not present at time of writing" — true when Lane B wrote, **stale now** (manifest exists, 53 entries). Bar stands without images by design; a one-line follow-up edit can flip that status sentence.
2. `.gitignore` concurrent edit: while Lane A appended line 6, another agent added lines 7–13 (duplicate `concept/*.png` + `*.jpg` patterns, a `43MB` comment — actual is 71.3 MiB — plus `tmp-*.mjs`, `bak-gpu/`, `probe.mjs`). Lane A correctly left others' lines untouched. Harmless duplicate; the `43MB` comment is wrong and could be corrected by whoever owns those lines.
3. `test-route-a.png` (route probe) is counted among the 53 files. It is a legitimate on-brief street-elevation frame, but a strict "matrix-only" count would read 52+1 probe.
4. Did not run `npm run capture` — no `src/` changed in this brief and six builder agents are mid-flight in the tree; a capture now would photograph their half-done state, not this brief's output. Brief's Verify section requires only honest route/count/bytes reporting, which is above.
