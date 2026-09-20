# Glove-shell canary — receipt (muse-fp-glove-shell-1105)

## What
Fitted tactical-glove read over the accepted grip volumes. Dorsal shell +
metacarpal knuckle bar, 4 curled finger volumes, thumb volume, wrist
transition swallowing the cuff end, knuckle plate + 2 seam welts + cuff welt
in the rougher detail singleton. Old palm + digit-bundle meshes untouched
(they are the contacts); shells contain them with >=2 mm to spare.

Vision note: this session has no image-read path to
`captures/art-live-1035/mountain-before/yardWhite.png`, so the mitten baseline
was taken from the scope text, not the pixels. Root's fixed-camera pixel
compare is the acceptance; this lane makes no look claim.

## Files (owned lane only, nothing else touched)
- `work/fp-glove-shell-muse-1105/glove-shell.ts` — source (gate, builders, merge, attach/dispose)
- `work/fp-glove-shell-muse-1105/check-glove-shell.mjs` — CPU proof, see below
- `work/fp-glove-shell-muse-1105/glove-shell.patch` — the only src change root needs
- `work/fp-glove-shell-muse-1105/receipt.md` — this file

## Measured (real transpiled geometry + all 5 real rigs, headless)
- Pair: **2128 tris** (<=3500), **4 draws**, **0 new materials** (borrows the
  two existing `painted(PAL.opBoot, …)` singletons — no new program)
- Sockets: live palm/bundle positions + palm volumes bit-exact on all weapons
- Reload fns untouched; bind pose restores; muzzle world pos unchanged;
  dispose removes all 4 meshes and re-attach works
- Swept clearance (sight floor / muzzle keep-out), per weapon:
  rifle +46.2/+146.8 mm · pistol +46.2/**+1.8** · smg +41.2/+41.8 ·
  shotgun +36.2/+151.8 · sniper +36.2/+316.8
- Pistol +1.8 mm is over a self-imposed double-conservative guard (30 mm
  keep-out + 4 mm sweep margin): true clearance 31.8 mm vs 38 mm before —
  the 3 mm skin plus sweep margin, not sprawl. Geometry left uniform rather
  than gaming the guard. Flagging, not hiding.

## Verify
`node work/fp-glove-shell-muse-1105/check-glove-shell.mjs` → `GLOVE-SHELL CHECK: PASS`
(P1–P10 positives on live objects; N1–N5 negatives all falsify: sprawl,
over-budget, floater throws, sight intruder, shifted palm.)
`npx tsc work/fp-glove-shell-muse-1105/glove-shell.ts src/weapons/first-person-hands.ts
--noEmit --strict --skipLibCheck` → clean. (Repo-wide `tsc` stays red on the
pre-existing missing `src/audio/service.ts`, unrelated.)

## Integrate (root)
1. `git apply work/fp-glove-shell-muse-1105/glove-shell.patch` from the
   animation worktree root (adds one gated call at the end of
   `createFirstPersonHands`; default adds nothing).
2. Serve + fixed-camera pixel compare, default vs `?glove-shell=canary`,
   through the REAL game loop (playcap path, not `__NT.goto`).
3. Accept looks + no budget/program-count movement, or reject.
4. On accept, root may relocate the module to `src/weapons/`; the patch's
   import path is the only coupling.

## Provenance
No shared skill workflow applied (none read — no citation claimed). Merge
discipline follows the `src/characters/mesh.ts` lesson (own indexed merge;
`mergeGeometries` null risk). Primitives + math from installed three r180.
