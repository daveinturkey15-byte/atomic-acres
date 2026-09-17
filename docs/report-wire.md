# Report: WIRE lane — Blender coach evaluated, then dropped

## Outcome (one line)

I wired `coach.glb` into the map, photographed it, compared it against the
procedural coach — and then **dropped it per the brief's drop branch**: the
procedural coach stays, `public/assets/coach.glb` (8.6 MB) is deleted. The
working tree's only change vs HEAD is that deletion; `src/build/vehicles.ts`
and `src/main.ts` are byte-identical to HEAD (`git diff --stat` empty for both).

## What I changed

- **Evaluated, then reverted.** Mid-lane the tree had a working wiring
  (top-level `await gateReadiness()` in `main.ts` before the `BUILDERS` loop;
  `getAsset('coach')` + runtime `Box3` sit correction in `vehicles.ts`, same
  position / 25° yaw / stepped colliders, procedural loft as fallback). It
  verified clean (below). I reverted both files after the frame comparison.
- **Deleted `public/assets/coach.glb`.** Nothing loads it, nothing references
  it at runtime, `dist/` no longer contains it. The 8.6 MB download is gone.
- **Did not touch `src/core/assets.ts`.** It is now unimported by anything, so
  it is excluded from the bundle (JS shrank 1058.81 → 975.60 kB, i.e. the
  GLTFLoader path drops out). Left in place deliberately: the pipeline lane's
  scripts/docs/registry remain for a rebuilt asset.

## What I measured (wired state vs procedural baseline)

| | procedural (fog2 / final wire) | Blender wired |
|---|---|---|
| `vehicles` objects | 310 | 327 (+17) |
| geometries (turningHead station) | 626 | 670 (+44) |
| textures | 63 | 66 (+3 embedded PNGs) |
| decoded texture VRAM | — | **24.0 MiB** for one prop |
| download | — | **8 605 816 bytes** |
| JS bundle | 975.60 kB | 1058.81 kB (+GLTFLoader) |
| colliders | 17 | 17 (stepped boxes kept) |
| traverse | 5/5 routes, 4/4 faces, handedness PASS | same, PASS |
| capture | exit 0, no page/console errors | exit 0, no page/console errors |

- glb bounds measured from the file bytes (all 70 `POSITION` accessors):
  x −5.81…5.89 (11.70, nose +x), y 0…3.33, z ±1.56 (3.12 incl. mirrors).
  Matches the pipeline doc; sit needed no correction (min.y = 0).
- Draw-call / fps deltas are **not reportable**: the harness `calls` field read
  65 (fog2), 418 (wired), 90 (final) for the same scene at the same station,
  and `fps` read 2 / 58 across runs — the `renderer.info` shape the harness
  reads is unstable run-to-run (the blend report flagged the 0-tris artifact;
  same root cause). Object/geometry/texture counts above are the honest cost
  signal. Directionally the 70-mesh coach costs calls vs the lofted hull.
- No `__NT` contract change in the final state: nothing async loads, so
  `ready` means what it always did. (The reverted wiring proved the
  deterministic-load recipe works — coach present in frame, zero errors —
  so it is reusable as-is; see below.)

## What I looked at

- `captures/wire-turningHead.png` (Blender, mid-lane) vs
  `captures/fog2-turningHead.png` (procedural), plus 2× crops of the coach
  from both, viewed pixel-for-pixel.
- Procedural wins the frame on every NT07 beat the 25° parking angle exists
  to show: legible **Nuketown flank script**, split windscreen with divider,
  bright headlamps, gleaming chrome bumper/grille, rivet rows, whitewalls
  with chrome hubs, bright cream body.
- Blender reads flatter and muddier at the same distance: pale flat window
  band, triangular washed-out screen panes, solid-black blind box, grille and
  lamp sockets merging into dark blobs, thin bumper, tan-cast body (AO
  pre-multiplied into base), and **no flank script at all**.
- Structural proof, not just taste: `grep -i script/decal/text/nuketown/rivet
  scripts/blender/build_coach.py` returns **nothing** — the script and rivets
  were never authored. No camera angle or lighting fix recovers detail that
  is not in the file. The dark brightwork *might* respond to env tuning, but
  that polishes toward parity at 24 MiB + 8.6 MB, which is not a trade worth
  taking for a background prop.
- `captures/wire-plaza.png` (final): plaza/pylon/needle/street unchanged and
  correct — the coach swap never touched that end of the map.
- Final `captures/wire-turningHead.png` re-opened after the revert: procedural
  coach back exactly (script, screen, chrome, whitewalls all resolve).

## What I could not resolve / leftovers

- `src/core/assets.ts`, `scripts/blender/*`, `docs/ASSET-PIPELINE.md` and an
  empty `public/assets/` remain. All dead but weightless (unbundled,
  unfetched). Removing the registry is the pipeline lane's call, not mine.
- If the coach is rebuilt, the gaps to close are concrete: (1) a flank
  script decal + rivet rows, (2) brightwork that resolves against the
  in-game env map instead of near-black, (3) less AO crush in the base map.
  Rewire recipe (proven working this lane): `import { gateReadiness }` in
  `main.ts`, top-level `await` it before the `BUILDERS` loop with try/catch
  → procedural fallback; in `vehicles.ts` read `getAsset('coach')`
  synchronously, `Box3`-measure for sit/collider dims, keep the existing
  `parkOnHead` position/yaw/collider call untouched.

## Verify log (final state)

- `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npm run build` → exit 0, `dist/` contains no `coach.glb`.
- `npm run traverse` → 5/5 routes, 4/4 faces, handedness PASS, exit 0.
- `npm run capture -- --tag wire` → exit 0, 10/10 frames, no page/console
  errors; `vehicles` back to 310 objects / 17 colliders.
- Opened `wire-turningHead.png` (procedural coach correct) and
  `wire-plaza.png` (plaza correct). No fidelity station has `ref: null`
  claimed as evidence; diagnostic stations not judged.
