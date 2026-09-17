Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: CONCEPTS - generate the next reference set with agy

**You write no game code.**

## Files you own
`docs/reference/concept2/` (new), `docs/reference/CONCEPT-BAR-2.md` (new)

## The task
Generate a fresh concept set aimed at the build's current weak points, and write a bar
the other lanes can be held to.

Primary route - local Gemini via the `agy` CLI at `%LOCALAPPDATA%\agy\bin\agy`:

    agy --print "<prompt>" --model gemini-3.7-flash-high --effort high --dangerously-skip-permissions --print-timeout 840s

`--effort` must match the model's encoded tier or it errors. Without
`--dangerously-skip-permissions` it stalls on its own bootstrap hook and returns
nothing. It is a coding agent, so you may need to ask it to CALL an image model and
WRITE files, not to "draw". Prove it can emit an image file with ONE test before
generating a batch.

Fallback: local ComfyUI (there are `comfyui` and `comfyui-request-pipeline` skills).
**ComfyUI's output directory is swept about every 2 hours** - copy anything you
generate into your own folder in the same session or you will lose it.

If neither route works, say so plainly and deliver the written bar alone. Do not
download images as a substitute.

## Subjects, in priority order
From tonight's captures the weakest areas are: the **central turning circle and its
vehicles at eye level**; **house interiors**; the **east side and third house**;
**ground and paving up close**; **the mannequins**. Vary angle and light; harsh desert
noon is the project's look. Target 40-80 images.

Subject is an original 1960s retro-futurist American show town setting a quality bar -
NOT reproductions of Treyarch artwork.

Write `manifest.json` (id, file, prompt, route, subject, angle, light) and
`CONCEPT-BAR-2.md` of concrete falsifiable statements per subject: material behaviour,
value composition, detail density at 40 m versus 2 m, colour relationships. "More
detail" is useless; "kerb faces carry a darker wash in the bottom 40 mm where grit
collects" is useful.

Report which route actually worked, the file count (count them, do not estimate), and
total bytes.
