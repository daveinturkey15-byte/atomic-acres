# Animation R2 verdict (Animator, 2026-09-23 ~19:00Z)

Resume-in-place of the dead Sept-19 worker. No source file was edited this session:
every R2 change below was already in the dirty tree and is verified here, not redone.
`npm run check` green before and after (tsc + render-site allow-list OK).

## 1. Manifest vs disk: RECONCILED, byte-for-byte

All 15 manifest entries served from the live build (`:4173`, = `dist/anim/`)
return 200 with bodies identical in size to `public/anim/` on disk
(walk 15640, run 12820, crouch-idle 25132, crouch-walk 17392, aim-rifle-walk 13536,
jump 32928, land 27612, turn-left 32920, turn-right 32900, fire 22312, reload 41720,
hit-react 27596, death 45260, aim 24416, sprint 20580).
`dist/anim/manifest.json` is byte-identical to `public/anim/manifest.json`;
dist was built 2026-09-23 14:00 from this tree and contains the R2 code
(`carryWeight` present in the bundle).

- `dropped: ["calib-right-arm", "idle"]` accounts for the only on-disk `.glb`
  not in `clips` (`idle.glb`, 23720 bytes = the rejected seed-1001 bytes).
  `kimodo-clips.ts` fetches exactly the manifest list, never a hardcoded id,
  so the dropped-idle 404 class is dead by construction: nothing requests it.
- `renamed: {"aim-rifle-idle": "aim", "fire-recoil": "fire"}` — both targets exist.
- The 8 `.anim.json` files are covered 1:1 by `manifest-cmu.json`
  (walk, run, sprint, crouch-walk, jump, turn-left, turn-right, pirouette).
- Re-baked bytes re-verified by sha256: `aim.glb 5b848b3b…72082f2`,
  `sprint.glb 6cf5b530…9420ee` — exact match to `public/anim/LICENCES.md`.
- The single 404 any harness logs is `/favicon.ico` (confirmed by direct fetch
  on `:4173`). Pre-existing, unrelated to animation. **For lead:** `index.html`
  is not this lane's file; a one-line favicon link (or a `favicon.ico` in
  `public/`) silences it in every harness log.

`idle.glb` stays on disk, dead, per the LICENCES.md note (delete at commit time;
nothing loads it either way). This lane does not commit.

## 2. Character quality (statistics + structure, no vision calls)

- One skinned mesh per figure: exactly one `new THREE.SkinnedMesh` in
  `src/characters/mesh.ts` (line 545); per-figure cost is bones + one mixer.
- Operators, not mannequins: helmet/cap silhouette split, plate carrier +
  triple mag pouches, radio, rolled sleeves, gloves, belt/dump pouch, cargo
  pockets, kneepads, boots; dress in per-vertex colour under the single
  `mat.operator()` (`vertexColors: true` confirmed in `core/materials.ts`).
- No black/flat reads: playcap frames mean luma 96–130, centre dark-fraction
  ≤ 0.058; all 8 contact sheets luma 116–117, dark-fraction ≤ 0.005.
  Faction sheets reproduce the R1 surface numbers within mm:
  idle top 1.838/1.822 m, walk ~1.80, run ~1.77–1.81, aim ~1.71–1.73,
  lean ≤ 6.1°, LeftHand→forestock 4.0 cm in every state (carry layer on).
- Module contract holds on the game path: materials only from `ctx.mat`
  (the only `new THREE.Material` in `src/characters/` is the headless
  `demo.ts`, explicitly allowed), no `Math.random`, no inline hex.

## 3. Animation R2 per brief (walk / run / sprint / aim / blend)

R2 re-rolls accepted as-is (aim seed 1207: clip 1.804 m / 4.1° lean / 15.6°
abduction; sprint seed 1204: 2.84 m/s, abduction 53.2° → 28.3° posed,
39.0° peak over the swing cycle). Weapon-carry layer verified live:
hands 75.9/44.9 cm off the forestock with the layer off → 4.0 cm on;
10.23 cm on vs 9.90 off, diff 0.33 inside 0.63 within-arm spread, f1-audit).

## 4. Proof

- `npm run check`: green.
- `node scripts/playcap.mjs --tag anim-r2`: **4/4 lit** through the real game
  loop (spawnA 130.1, circle 99.9, spawnB 99.3, orangeInside 96.5; only console
  error is the favicon 404 above). Frames: `captures/anim-r2-*.png`.
- `node scripts/animation/capture-anim-sheets.mjs --tag r2-verdict --liveauto`:
  **8/8 sheets lit**, both factions × idle/walk/run/aim, plus live spawnA and
  an aimed live-figure frame (11 figures live, subject idle at (-8, 6.5),
  camera 4.6 m, clutter 1.4). `missing: []` — zero asset 404s.
  Frames: `captures/anim/r2-verdict-*`.
- Characters present: `__NTANIM.list()` reports 11 live figures; live-figure
  frame shows the subject mass at 4.6 m (structure-mapped, no vision calls).
- Characters moving: live-bot displacement probe over 6 s in the running game
  (11 figures live): placed figures 0-5 idle at 0.00 m; bots moved 1.27 m,
  6.82 m, 11.34 m, 3.23 m and 5.23 m with locomotion transitions
  idle -> sprint (4.3 m/s) -> run, speeds taken from `__NTANIM.list()`.

## Verdict: DONE with three exact residuals (all pre-declared, none new)

1. In-game walk skate ~10 cm vs manifest 3.8 cm offline (root-relative vs
   world-with-controller measurement domains; predates and unchanged by the
   carry layer). No concrete defect found in owned code; not edited blind.
2. Sprint peaks at 39.0° left abduction over its cycle vs the 35° R2 bar
   (posed 28.3°); three seeds spent (1004/1104/1204) — not re-rolled again.
3. Baked sprint speed 2.84 m/s sits in the blend tree's RUN band (2.3–4.1),
   so selected sprint plays at timeScale ~1.4. Band change is gameplay
   tuning, not this lane's call.

## For lead (not this lane's files, do not take as edits)

- `src/main.ts` comments are stale: "Sixteen glTF clips" (now 15 + 1 dead),
  and "`spawn()` takes no faction argument" (it takes `faction?` since R2).
- Suggested commit-time delete: `public/anim/idle.glb` (dead weight, 23 kB).
- Favicon 404 (above) if you want clean harness logs.
