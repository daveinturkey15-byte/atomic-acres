# First-person hands pass — 2026-09-19

This pass keeps the current connected `armSegment` joint correction and moves
the shared hand construction into `src/weapons/first-person-hands.ts`. The
weapon geometry, muzzle/eject anchors, ADS mount, and damage path are untouched.

## Authored result

- Each firearm now exposes a named `FirstPersonHands` root with
  `TriggerHand`, `SupportHand`, and `SupportForearm` groups.
- The eight existing hand/arm meshes per firearm remain the same count. The
  sleeves still span measured elbow-to-wrist points; a smaller roughness-shifted
  curled digit bundle sits beside each palm as the thumb/index break, making the
  glove silhouette less mitten-like without adding overlay draws.
- Existing cached palette materials remain in use: olive fatigue, dark
  webbing cuff, and matte glove. No material factory, light, geometry, or
  allocation is used by the animation update.
- `ViewmodelRig.hands?.updateReload(progress)` moves only the support hand in a
  short, four-phase envelope: release, reach to the weapon-local magazine or
  breech, brief seat pause, and smooth return. The reach is clamped to a small
  per-weapon depth envelope so it does not cross the sight picture.
- Reload targets are measured from the authored viewmodel parts: the rifle
  magazine centre, pistol grip/magazine well, SMG magazine, shotgun loading
  port, and sniper magazine plate. The shotgun uses the longer local reach to
  z −0.02 because its loading port is ahead of the support-hand bind at z
  −0.30; the other weapons use shorter envelopes.
- `resetReload()` writes the exact construction-time bind transform. It is safe
  to call on reload completion, cancellation, visibility reset, weapon switch,
  spawn, or QA refill.

## Root controller hook

`src/weapons/controller.ts` now calls the new API while preserving the existing
weapon timer and whole-rig reload dip. The active reload block uses the following
hook:

```ts
// Existing reload block, immediately after progress is computed:
const progress = 1 - Math.max(0, cur.reloadT) / cur.reloadDur;
cur.rig.hands?.updateReload(progress);

// Existing completion branch, before or after cur.reloading = false:
if (cur.reloadT <= 0) {
  cur.rig.hands?.resetReload();
  cur.reloading = false;
  // existing magazine/audio/HUD work
}
```

The controller also calls `cur.rig.hands?.resetReload()` beside every path that writes
`reloading = false` or `reloadT = 0` without reaching the completion branch:

```ts
// ordnance cancellation
if (this.ord.busy) {
  const cur = this.weapons[this.active];
  cur.reloading = false;
  cur.reloadT = 0;
  cur.rig.hands?.resetReload();
}

// switchTo, before hiding the previous rig
prev.reloading = false;
prev.reloadT = 0;
prev.rig.hands?.resetReload();

// setVisible(false), inside the weapon reset loop
w.reloading = false;
w.reloadT = 0;
w.rig.hands?.resetReload();
```

The applied controller also resets the hand rig in `adoptWeapon`, `onSelfSpawn`,
and QA `refill`. No stable runtime reload pose claim is made until root captures
the live rifle, pistol, and shotgun through the real frame loop.

## Frozen-candidate capture harness

`_verify-hand-poses.mjs` drives the stock candidate at `:4192` through the real
`Play solo` → `Deploy` menu path. It selects `longhorn` (rifle), `duster`
(pistol), and `coachman` (shotgun) through the existing documented
`window.__NT.weaponCmd('switch', id)` API, then saves standing hip, ADS, and
mid-reach reload frames for each. It adds rifle crouch and prone frames, for a
bounded total of eleven PNGs under `captures/hand-poses`.

The explicit `weaponCmd('state')` QA read includes `reloadProgress` and the
current local `triggerHand`, `supportHand`, and `supportForearm` transforms.
Those fields are added only to the explicit QA state command; the per-frame HUD
snapshot does not allocate the transform arrays. The capture result records the
support-hand pose alongside each image and checks the live renderer frame stays
within 1,200 calls and 900,000 triangles. The harness does not call the QA
render or station APIs, so its pixels come from the game's own frame loop.

## Verification and open evidence

- **VERIFIED** current source retains connected elbow-to-wrist `armSegment`
  endpoints and existing firearm anchors.
- **VERIFIED** the update path only writes `SupportHand.position` and
  `SupportHand.rotation`; it creates no frame-time objects, materials,
  geometries, or lights.
- **VERIFIED** static JSON/type intent is represented in `ViewmodelRig.hands`;
  runtime capture is root-owned.
- **VERIFIED** `npm run check` passes in the recovery tree after the controller
  hooks and measured targets were integrated.
- **OPEN** the live capture harness is authored but not run in this lane. Root's
  serialized browser run must inspect the eleven frames and confirm the support
  hand reaches the visible magazine/breech without obscuring the sightline.
