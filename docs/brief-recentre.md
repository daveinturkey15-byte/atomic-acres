# Task brief: THE TURNING CIRCLE IS CENTRAL — fix the plan

Read `docs/SPARK-CONTEXT.md` first. This brief overrides parts of `docs/SPEC.md`
section 2 and parts of `docs/REAL-REFERENCE.md`; where they disagree with this, **this
wins** and you should correct them.

## Files you own exclusively

- `src/core/layout.ts`
- `src/build/ground.ts`
- `src/core/stations.ts`
- `docs/SPEC.md` (section 2 only — the plan diagram)

Another lane owns `src/build/vehicles.ts` and `src/build/yards.ts`. Do not touch them.

## The error, and where it came from

The owner has said three times that the layout does not match Black Ops 2. He is right,
and the error is structural, not a matter of a few metres.

**What we built:** two houses facing each other across a straight street, with a
lollipop cul-de-sac *at the `+x` end* (`HEAD_CENTER_X = 26.0`, `HEAD_RADIUS = 9.6`) and
the road running off-map at `-x`.

**What the real map is:** the **turning circle is the CENTRE of the map**. The two team
houses sit on either side of it. The vehicles (tour coach and the second bus) park *on*
that central circle and are the map's principal central cover. One road leaves the
circle and runs off-map; the circle is not at the end of a street, the circle IS the
middle.

**Evidence, both first-party Treyarch art, both re-verified just now by the orchestrator:**
- the official in-game minimap,
  `https://static.wikia.nocookie.net/callofduty/images/e/eb/Nuketown_2025_Minimap_BOII.png/revision/latest?format=original`
  — a clean 512×512 top-down. The circle is dead centre with two elongated vehicle
  capsules lying on it; the two house footprints are above and below it; each house
  footprint is a **notched / stepped cross shape, not a rectangle**.
- the official aerial,
  `https://static.wikia.nocookie.net/callofduty/images/6/6f/Nuketown_2025_Aerial_View_BOII.jpg/revision/latest?format=original`
  — same structure in a photo: central circle with vehicles on it, a house either side,
  the third house beyond, one road leaving.

**Load both yourself in a browser and look before you change anything.** The Fandom CDN
is behind a Cloudflare check, so `curl` returns a ~6 KB HTML challenge page, not an
image — use a real browser (the built-in browser pane, or Playwright). If you cannot
load them, say so and stop rather than guessing.

The old project's `docs/references/nuketown-2025/FINDINGS.md` called this a "lollipop
cul-de-sac" at one end. That claim is **wrong** and we inherited it. Note the correction.

## What to change

1. **`layout.ts`: put the circle in the centre.** `HEAD_CENTER_X` → near 0, between the
   two houses. Re-derive `ROAD_X_MIN` / `ROAD_X_MAX` and the road stem so exactly one
   road leaves the circle and runs off-map, instead of a street running the full length
   with a bulb bolted on one end.
2. **Size the circle from the minimap.** Its diameter is a large fraction of the gap
   between the two houses — measure the ratio off the minimap rather than keeping 9.6.
3. **`ground.ts`:** rebuild the road, kerbs and pavements around the new arrangement.
   Keep the documented y-offset ladder and its depth-buffer reasoning intact — the rungs
   exist because an 8 mm step was inside the resolvable limit at aerial range and the
   street broke out in stipple.
4. **`stations.ts`:** the `turningHead` and `plaza` stations are aimed at the old
   geometry and will point at nothing. Re-aim them. Keep the yaw-convention comment.
5. **`SPEC.md` section 2:** redraw the ASCII plan to match, and mark the old
   cul-de-sac-at-one-end description as a corrected error with the reason.

## Do not break

- The handedness invariant: from either back yard, facing your own house, the garage is
  on the RIGHT. `main.ts` asserts it and `traverse` gates on it.
- Do not rename or remove any exported symbol from `layout.ts` — eleven builder modules
  import from it.
- `src/build/vehicles.ts` parks the coach and buses relative to `HEAD_CENTER_X` and
  `HEAD_RADIUS`. You are not editing that file, so **the constants must stay meaningful**
  — if the vehicles end up floating in a lawn after your change, say so clearly in your
  report so the vehicles lane can follow up.

## Verify

```
npx tsc --noEmit -p tsconfig.json
npm run build
npm run traverse
npm run capture -- --tag centre
```

Both harnesses serve the **built** artifact — run `npm run build` first.
`traverse` will likely need its route waypoints to still make sense; if a route now runs
through the circle, that is fine as long as the player can get around the vehicles.
Report the before/after traverse output honestly — **do not delete a failing route to
get a green line.**

Then **open** `captures/centre-aerial.png` and put it beside the real aerial you loaded.
The test is simple and visual: **does our plan now read like theirs?** Say plainly
whether it does, and what still differs.
