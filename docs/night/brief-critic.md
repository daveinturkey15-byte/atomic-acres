Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: CRITIC - independent review, report only

**Do not fix anything. Do not edit any source file.** You write one document.

## Files you own
`docs/CRITIC-NIGHT.md` (overwrite it if it exists - you are the newest pass)

## Produce your own evidence

    npm run build
    npm run capture -- --tag critic
    npm run traverse

Then **open every `captures/critic-*.png` with the Read tool and look at it.** Do not
report on a frame you did not open.

## Judge against
- `docs/SPEC.md`, `docs/REAL-REFERENCE.md`, `docs/PLAN.md`, `docs/DIMENSIONS.md`
- the real gameplay frames in `docs/reference/gameplay/` (1100+, `f-*.jpg`, `g-*.jpg`)
- `src/core/stations.ts` names the reference frame each fidelity camera answers to

**Big recent change:** the turning circle moved to the map CENTRE tonight. Check what
that broke as much as what it fixed.

## What I want back
A ranked list, worst first. For each: the frame, what you see and where, which
expectation it violates, the owning file (read it before attributing), and how
damaging it is. Prioritise in this order:

1. anything actually BROKEN - floating, intersecting, z-fighting, missing surfaces,
   crushed blacks, blown whites, anything that reads as a bug
2. anything that stops it reading as Black Ops 2's Nuketown at a glance
3. polish

Then: **the five highest-value changes**, each with its owning file, ordered. The next
lane works straight from that list, so make it specific and actionable - a file, a
symptom, and what "fixed" looks like.

Finish with one honest line: does this read as BO2 Nuketown to someone who knows the
map? Say what is genuinely good too, so the next lane does not break it.
