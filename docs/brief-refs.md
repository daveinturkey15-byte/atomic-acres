# Task brief: CONCEPT REFERENCE LIBRARY — raise the visual bar

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files and directories you own exclusively

- `docs/reference/concept/` (new directory — images and a manifest)
- `docs/reference/CONCEPT-BAR.md` (new)
- `.gitignore` — **only** to add the generated image directory if the images are large

You may NOT touch anything in `src/`. Six other agents are working there right now.
**You write no game code.** Your output is reference material and a written bar.

## The goal

The owner's words: he wants the map to look *better* than the 2012 Black Ops 2 original
— "super high quality". Right now the builders are working from `docs/SPEC.md` section
3, which is a careful written read of six low-resolution BO2 screenshots. That is
enough to be *accurate* but not enough to be *beautiful*: nobody on this project has a
picture of what "excellent" looks like for this map.

Your job is to produce that picture, as a frozen reference library plus a written bar
the builder and critic agents can be held to.

## 1. Generate the images

Target **50–100 images**. Try these routes in order and report which actually worked:

**Route A — local Gemini via the `agy` CLI.** Binary at `%LOCALAPPDATA%\agy\bin\agy`.
```
agy --print "<prompt>" --model gemini-3.7-flash-high --effort high --dangerously-skip-permissions --print-timeout 840s
```
`--effort` must match the model's encoded tier or it errors. Without
`--dangerously-skip-permissions` it stalls on its own bootstrap hook and returns
nothing. It is a coding agent, so it may need to be asked to *call an image model and
write files*, not to "draw" something. **Establish whether it can actually emit image
files before generating 100 prompts** — one test image first.

**Route B — local ComfyUI.** There is a `comfyui` skill and a `comfyui-request-pipeline`
skill on this machine; use them. Important known trap: **ComfyUI's output directory is
swept about every 2 hours**, so copy anything you generate out of `output/` into
`docs/reference/concept/` in the same session or you will lose it.

If neither route can produce images, **say so plainly and do not fake it** — fall back
to delivering section 3 (the written bar) alone, which is still valuable. Do not
download images from the web as a substitute.

## 2. What to generate — a shot matrix, not 100 random prompts

Enumerate deliberately across:

- **Subjects**: the orange butterfly-roof house; the white streamline-moderne capsule
  house; the cul-de-sac with the coach; the entrance plaza and pylon sign; back yards;
  the street elevation; mannequins; the 1950s vehicles; the desert-and-mountain surround.
- **Angles**: eye-level, low, high three-quarter, plan.
- **Light**: harsh desert noon, low sun, overcast — noon is the project's current look.
- **Era anchor**: 1960s American "world of tomorrow" show town, Googie and streamline
  moderne architecture, bleached concrete, saturated accent colours.

**Version discipline still applies.** The subject is Black Ops 2's *Nuketown 2025*.
Do not generate Black Ops 1's 1950s tract houses, Nuketown '84, or the BO6/BO7
re-releases. Do not generate anything that reproduces copyrighted game art — you are
generating *original concept imagery of this kind of place* to set a quality bar, not
reproductions of Treyarch's assets.

Write a `manifest.json` recording, for every image: id, filename, prompt, route used,
subject, angle, light. Provenance matters more than volume.

## 3. Write `docs/reference/CONCEPT-BAR.md`

This is the deliverable the other agents will actually read, and it must be useful
without the images. For each subject area, write what "excellent" means in terms a
builder can act on and a critic can measure:

- material behaviour — roughness ranges, where specular should appear, what should be
  dirty and where dirt collects
- value composition — what is darkest, what is brightest, how much contrast
- silhouette and detail density — what reads at 40 m vs what only matters at 2 m
- colour relationships — the accent-to-neutral ratio, what should never be saturated
- the specific things that currently make this build read as "clean shapes" rather than
  "a photographed place"

Be concrete and falsifiable. "More detail" is useless. "Kerb faces should carry a
darker wash in the bottom 40 mm where grit collects" is useful.

Also list, with reasons, the **five highest-leverage changes** you would make to the
current build to close the gap. Look at `captures/ship-*.png` (open them with the Read
tool) to ground that list in what the build actually looks like today.

## Verify

Report honestly: which generation route worked, how many images you actually produced
(count the files, do not estimate), total bytes, and where they are. If a route failed,
say what the error was. Zero images with an honest explanation beats a claim of 100.
