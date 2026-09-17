# Task brief: MINE THE REAL GAMEPLAY FOOTAGE — authoritative layout and artstyle corrections

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `docs/REAL-REFERENCE.md` (new — your deliverable)
- `docs/SPEC.md` (you may correct section 3 where the footage contradicts it)

You write **no game code**. Six other agents are in `src/`. Do not touch it.

## Why this exists — the owner's verdict

The owner looked at the build and said: *"this doesn't look like the map artstyle or
layout of nuketown from black ops 2 to me"*. He is right. Everything in `docs/SPEC.md`
section 3 was derived from **six low-resolution wiki screenshots** and careful prose.
It produced something accurate in outline and wrong in feel.

That is now fixed at the root: **`docs/reference/gameplay/` contains 422 frames
extracted at 1600 px wide from three real Black Ops 2 Nuketown 2025 gameplay captures**
(`f-<videoid>-NNN.jpg`, one frame every 3 seconds, 1080p60 PC footage). This is the
real map from hundreds of angles.

## Your job

**Open a large, deliberate sample of those frames with the Read tool** — at least 60,
spread across all three video ids and across the whole run of each, not just the first
few. Then write `docs/REAL-REFERENCE.md`: a concrete, actionable correction list that
the builder agents will be held to.

Note the frames are gameplay, so a weapon viewmodel and HUD occupy the lower third and
the corners. Read around them.

## What I already saw in four frames — confirm, correct and extend this

Seeded so you do not start cold. Treat every line as a hypothesis to verify, not fact:

- **Fences are HORIZONTAL timber slats**, warm orange-brown, with visible gaps between
  boards. Our build uses vertical pickets. This is wrong and it is everywhere.
- **Random stone / rubble masonry cladding** appears on low walls. We have none.
- There is a **trailer / caravan** (cream, corrugated flank) as a prop. We have none.
- **Concrete is warm and tan**, not the cool pale grey we use.
- **Interiors are dressed**: signage plaques with real text ("No Hassle Car Wash"),
  a horizontal **orange stripe band** around interior walls, fuse boxes, wall fittings.
  Our interiors are bare shells.
- The **coach** is cream with a maroon swoosh and chrome — our version is close, confirm.
- The **saucer house** has a cream shell with a **mauve/purple underside** carrying
  recessed downlights, on slim splayed legs.
- The map feels **much tighter and more cluttered** than ours.

## What `docs/REAL-REFERENCE.md` must contain

1. **Layout corrections.** Measure against our plan in `src/core/layout.ts`. Are the
   houses too far apart? Is the street too wide? Is the turning head the right size and
   in the right place relative to the houses? Cite frame filenames for every claim.
   Where you can estimate a real dimension (using a 1.8 m player as the ruler), give a
   number and say how you got it.

2. **Artstyle corrections**, per surface family: what colour it actually is, how dirty,
   how glossy, what pattern. Name the `PAL` entry or material in
   `src/core/palette.ts` / `src/core/materials.ts` that is wrong and what it should be.

3. **Missing props and features**, ranked by how often they appear in frames. Anything
   appearing in many frames is load-bearing for recognition.

4. **The signage and text layer.** BO2's Nuketown is covered in period signage, decals,
   posters and stencilled text. We have almost none and it is a large part of why ours
   reads as a clean model. List the signs you can actually read.

5. **The ten highest-leverage changes**, ordered, each with the file that owns it.

## Rules

- **Cite a frame filename for every claim.** A statement with no frame behind it does
  not belong in the document.
- Mark anything you cannot resolve as **OPEN**, with the shot that would settle it —
  the existing SPEC does this and it is why it has been trustworthy.
- This is a **fan project inspired by BO2**, starting close then diverging. You are
  documenting the real map so the build can get close deliberately. Do not copy any
  game asset; describe.
- Where the footage contradicts `docs/SPEC.md` section 3, **correct SPEC** and note in
  the diff that the correction came from footage, not from the wiki stills.

Report the number of frames you actually opened, the corrections you are most confident
in, and what remains OPEN.
