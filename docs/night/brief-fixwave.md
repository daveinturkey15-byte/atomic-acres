Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: FIXWAVE - action the critic's list

## Files you own
Anything under `src/build/` **except** files another lane in your wave holds, plus
`src/core/palette.ts`. You may NOT edit `src/core/layout.ts`, `src/main.ts`,
`src/ui/`, `src/weapons/` or `src/game/`.

## The task
Read `docs/CRITIC-NIGHT.md` - the newest independent review of the build - and work
its **five highest-value changes**, in its order, as far as you get.

For each one: read the file that owns it, read the reference frames the critic cites,
make the change, rebuild, and **open the capture and look** before moving to the next.

## Rules that matter most here
- Take them in priority order. Three done properly beats five done badly.
- If a change makes a frame worse, **revert it yourself** and say so in your report.
  Nobody is watching; an honest revert is worth more than a claimed fix.
- The runner's gate after your wave is: tsc clean, build OK, handedness PASS, 4/4
  house faces, at least 4/5 traverse routes. Fail it and your whole wave is reverted.
- Never construct a material in a builder. `ctx.rand()`, not `Math.random()`.

## Verify
`npm run build`, `npm run traverse`, `npm run capture -- --tag fix`. Open the captures
covering each change you made. Report per item: what you changed, what you saw, and
whether you consider it actually fixed or only improved.
