# Task brief: CRITIC FIX PASS 2 — yards and mannequins

Read `docs/SPARK-CONTEXT.md` first. It binds you.

**You are on a hard 35-minute budget and the owner is waiting on a published build.**
Do these five things, in this order, and stop. Do not start anything else. If you run
short, a correct fix to items 1 and 2 alone is a good outcome — say what you did not
reach.

## Files you own exclusively

- `src/build/yards.ts`
- `src/build/mannequins.ts`

Nothing else. Other agents are in the two team houses, `vehicles.ts`,
`third-house.ts`, `src/core/world.ts` and `docs/reference/`.

## The findings (from an independent critic who opened every frame)

### 1. The shuffleboard court reads as a swimming pool — HIGHEST VALUE
`COURT = mat.painted(PAL.carTeal)` (a deep teal, 0x2f8f8a) on a bed raised 60 mm with a
grey lip and white coping. From a 1.68 m eye at 3 m it is unmistakably a sunken pool,
and it now **fills the lower third of the spawn-B frame** — the white team's first view
of the map. `docs/SPEC.md` section 3's NT02 read says "a green court".

Take it off `PAL.carTeal`. Use a **pale painted court green** that separates from mown
lawn by value rather than by saturation, keep the white markings, and make sure the
result cannot be mistaken for water — no deep saturated fill, no dark inset bed. If you
need a new colour, add it to `src/core/palette.ts`... **no — you do not own that file.**
Use an existing pale `PAL` entry and modulate via `mat.painted(colour, roughness, 0)`
with a high roughness so it reads as paint on concrete, not liquid.

Verify by opening `captures/fix2-spawnB.png` and asking: pool or court?

### 2. Seated mannequins sit on thin air
Four `'sit'` poses in `mannequins.ts` are placed on bare lawn and pavement with nothing
under them. The benches are in `surround.ts`, which you do not own and must not edit.

So: either move each seated figure so it sits on something that already exists (a kerb,
a step, a low wall, the sand-pit kerb, a patio edge, a crate), or change those figures
to a standing/leaning pose. Do not add furniture to `mannequins.ts` — that is not its
job. Whichever you choose, no figure may be left floating.

Two more in the same file: one `'lean'` figure at the plaza has its **head inside a
plinth**, and an `'armOut'` figure's forearm **passes through the blue appliance bank**.
Move both.

### 3. An orphan fence panel stands in the white house's front lawn
About 5 m of tan picket with a capped post at each end and no run continuing either
way, in the middle of the lawn — visible in the NT05 plaza frame. It is emitted by the
fence-run code in `yards.ts`. Find why a segment is being placed there and remove it.

### 4. Stepping stones read as scattered plates
Large high-contrast grey ellipses on saturated green. Make them smaller, closer in
value to the ground, and more regularly spaced so they read as a path.

### 5. Re-check nothing you touch is buried
`ground.ts` puts the lawn plateau top at `KERB_HEIGHT + 0.001`. Your file has a
documented y-ladder derived from `KERB_HEIGHT`. Anything you move keeps its rung.

## Rules

Colours from `PAL` only. Materials from `ctx.mat` — never construct one. `ctx.rand()`,
never `Math.random()`. Dimensions from `src/core/layout.ts`.

## Verify — and be quick about it

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "yards|mannequins"   # must be empty
npm run capture -- --tag fix2 spawnB spawnA yardWhite plaza
npm run traverse                                                       # must stay 5/5
```

Then **open** `captures/fix2-spawnB.png` and `captures/fix2-plaza.png` with the Read
tool and look at them. Report what you saw, and be explicit about item 1: does the
court still read as water?
