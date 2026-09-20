# Receipt — world-weapon-final2-close-muse-1017 (2026-09-20)

Continues final2 repair2, not a third redesign. AGY close-1010 produced no
artifact (real 429 Individual quota until 12:46 BST); this finishes the
interrupted GLM repair2 partial. Prior lanes readonly and retained:
`work/world-weapon-glm-repair2-0955`, `work/world-weapon-agy-repair1-0941`.
Root `nuketown-recovery-20260919` readonly (patch `--check` only).

## Delivered (this lane only)

- `src/authored-weapon.ts` — byte-identical to GLM repair2 (seam
  `?world-weapon=canary` → `buildWorldWeaponArt(SPECS, MUZZLES)`, detach honors
  `userData.dispose`, SPECS rx / axis / socket contracts untouched).
- `src/world-weapon-art.ts` — GLM simplest cache + one bounded delta:
  `pruneTrackedWeapons()` (one pass, dead WeakRefs only) called on build,
  `userData.dispose` (detach), and `hasLiveWorldWeapons()` (every teardown
  guard). No geometry/FP/body change. No `disposeWorldWeaponResource`
  reintroduction — its absence is the deliberate reduced API (header notes it).
- `tests/world-weapon-art.test.mjs` — stale 6i helper calls removed; replaced
  with real ownership: borrowed caller material + unrelated `BoxGeometry`
  survive the real global teardown, cache disposes exactly once (10 geos + 1
  furniture mat), one-shot no-op re-verified, plus finite 12×
  build/attach/detach boundedness (`hasLive` true only while mounted) and
  terminal teardown. Temporary-geo (81 part disposes) vs cache-once kept
  separate as before.
- `main.pagehide.patch` — root-applicable minimal diff (2 hunks, `git apply
  --check` clean on root): import `disposeWorldWeaponArt` + one terminal call
  in the existing `pagehide` listener after `releaseCoachOwnedCanary()`:
  `try { disposeWorldWeaponArt({ terminal: true }); } catch {}`.
  Prior patch had the import with no invocation; QA probe untouched.
- This receipt.

## Verification (source-only, no GPU/browser)

`node work/world-weapon-final2-close-muse-1017/tests/world-weapon-art.test.mjs`
→ **ALL CHECKS PASS** (63 PASS, 0 FAIL). Tri budget unchanged:
rifle 232 / smg 200 / shotgun 168 / sniper 256 / pistol 160 (all ≤256, 2 draws,
20 ids, +Z axis, MUZZLES/FORESTOCK/grips, detach-keeps-cache, live-guard,
deterministic rebuild). Patch dry-checked on root, never applied.

Root frames still required before any graphical claim.
