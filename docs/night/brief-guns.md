Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: GUNS - more weapons, better feel

## Files you own
`src/weapons/`

Do not touch `src/main.ts` (another lane holds it), `src/ui/`, `src/core/` or
`src/build/`. If you need a hook in `main.ts`, state the exact one-line change in your
report for the orchestrator to apply.

## Reference, for DESIGN only
`C:/Users/david/Desktop/stuff/atomic-acres/src/` has the owner's earlier weapon work:
`weapon-presentation-state.ts`, `weapon-presentation-anatomy.ts`,
`ads-physical-aperture.ts`, `railgun-scope-state.ts`. Read for approach - how ADS,
recoil, presentation states and hit confirmation were modelled. **Write fresh. Do not
copy files.**

## What to build
Today there is one rifle with fire / ADS / reload / switch. Extend to a small arsenal
that is our own take on a BO2-era loadout, with our own names:

- an SMG (fast, wide bloom), a rifle (balanced), a shotgun or LMG, and a pistol
- per-weapon stats as DATA, not branching code: RPM, damage falloff, spread, recoil
  pattern, ADS time, magazine and reserve
- distinct recoil patterns you can feel, with recovery
- a hit-confirm path the HUD can hitmarker from (`main.ts` already pushes
  `weapons.snapshot()` every frame - extend the snapshot rather than adding a setter)
- weapon switch with a real swap animation and a time cost

Keep the depth-cleared viewmodel overlay. It is what stops the gun clipping into world
geometry, and solving that with clipping planes caused shader recompiles in the
previous project.

## Verify
`npm run build`, `npm run traverse` (must hold), `npm run capture -- --tag guns`.
The viewmodel must stay suppressed at capture stations. Fire each weapon for 30 s
headlessly and confirm `__NT.stats().programs` does not climb. Open two captures and
confirm no gun leaks into a fidelity frame.
