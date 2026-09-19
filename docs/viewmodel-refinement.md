# Viewmodel refinement — 2026-09-19

The recovery street capture showed the active Longhorn as a hard rectangular
wood/black block with no visible first-person arms. This pass stays procedural,
uses the existing `MaterialLibrary` cache and keeps every existing muzzle and
ejection anchor unchanged.

## Changes

- Added cached `RoundedBoxGeometry` forms to the Longhorn receiver, top rail,
  handguard, stock, buttpad, pistol grip and magazine. The other catalog guns
  receive rounded receiver/slide forms where their silhouette benefits.
- Added Longhorn side rails, a gas/barrel collar and a forward machined ring;
  these are separate functional shapes rather than extra decals.
- Added a shared low-poly first-person arm rig to all five catalog builders:
  two fatigue sleeves, two dark cuffs, and two palm/thumb volumes. Support-hand
  depth is per weapon so the hand lands on the corresponding handguard or
  pump. All pieces use existing palette families and cached `mat.painted`
  materials.
- Refined that rig in a second pass without increasing its eight arm meshes per
  gun: sleeves are tapered and shorter, cuffs are narrower, and each palm now
  has a smaller offset thumb/index volume. Roughness separates olive fabric,
  webbing, and matte glove surfaces while preserving the receiver materials.
  The forearms sit lower and closer to their grip frames to recover the
  lower-right lane in the original camera composition.
- Existing `muzzle` and `eject` objects and local firearm axes are untouched.

## Budget and verification

- **VERIFIED** `npm run check` passes TypeScript and the render-site allow-list.
- **VERIFIED** no new material factory or per-frame allocation was added.
- **CLAIMED** Longhorn adds 12 mesh parts (four detail shapes plus eight arm
  parts); the other guns add eight arm parts. This is within the requested
  under-20 overlay delta, pending root's runtime renderer counter.
- **VERIFIED** The second pass keeps the arm mesh count unchanged and does not
  add a per-frame allocation or material factory.
- **OPEN** Real browser capture, reload/ADS inspection, muzzle ray alignment,
  and actual draw-call/FPS comparison remain root's serialized GPU/browser gate.
