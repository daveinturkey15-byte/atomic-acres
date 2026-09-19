# Hero visual repair handoff (repair1, source-only, prop lane)

Lane `nuketown-prop-20260919`. Source-only: no Blender, GPU, browser, or server ran here.
Root reruns the guarded build + strict validator + WebGPU pixels and LOOKS at all nine frames.
Nothing here is claimed photorealistic. This is repair 1; root views frames.

## Root rejection inputs (heroes-2346, read-only root)

- MP5: rectangular flat receiver/handguard, square front sight, heavy rails — nothing like
  `docs/reference/production-catalog/weapons/mp5.png`. ADS post ~y580 vs centre ~450.
- M14-EBR: capped tube scope reads as an opaque egg over the reticle, scope station ~y730.
  Reference `m14-ebr.png` carries OPEN IRONS on the rail, not a tube scope.
- LMG: rear block huge at ~0.14, blocks aim; sight ~y480.

## Deliverables (this lane)

1. `scripts/blender/build_roster_heroes.py` — edited in place (recipe change).
   Backup of the rejected recipe: `work/hero-visual-repair/build_roster_heroes.py.bak`
   (byte-identical to root `519d213` recipe, verified by `cmp`).
2. `work/hero-visual-repair.patch` (307 lines, 3 files) — the ONLY patch root needs.
   `git apply --check` clean against pristine root copies of all three files, then
   full-apply + CPU re-verified (see below).
3. `work/hero-visual-repair/hero-ads-calibration.root.patch` — the controller hunk
   standalone (already folded into the combined patch; kept for provenance).
4. `work/roster-heroes/manifest.json` — EBR mesh list + `repair1` block (in the patch).
5. This doc.

## Recipe changes (all inside frozen budgets, sockets, and nodes)

- MP5 rebuild to `mp5.png`: 16-seg rounded stamped tube + pressed creases (was a square
  box); curved 3-segment ribbed magazine with baseplate lip (was straight box);
  tapered/ribbed handguard with palm swells; raked grip with swell + finger ribs;
  OPEN hood front (two ears, NO top bar) on a barrel band + riser (was floating solid bar);
  aperture drum rear with capless `tube_open` peep (was capped solid); slim low claw
  (`top_z` 0.0635, below the sight line). 13 draws / 1478 tris (CPU).
- M14-EBR narrow: `ebr_scope` tube REMOVED per reference; `ebr_front_sight` (post top
  0.092 on gas block) + `ebr_rear_sight` (open aperture on the existing top rail).
  The defect was capped `cyl()` ends + a station 14 cm behind the procedural scope —
  orientation was already along-bore, so no factory-path change was needed.
  15 draws / 1386 tris (CPU).
- LMG narrow: same `lmg_sights` mesh, internals moved off the carry handle (handle kept)
  onto gas block + feed cover as open post + notch at the shared line.
  16 draws / 604 tris (CPU).
- Shared sight line: all three heroes now sit at ~0.092 Blender-Z (procedural family
  line ~0.095). Four sockets per gun byte-identical; magazine nodes
  (`mp5_magazine` / `ebr_magazine` / `lmg_ammo_box`) preserved; feed-top pivots held
  (MP5 2.2 mm, EBR 0.0 mm from `anchor_mag`); texture function untouched (same seeds,
  same 2×1K PNG recipe, same 3-mat bands), so EBR/LMG texture bytes are unchanged.
- Budgets frozen: 14k tris / 18 draws / 3 mats / 2×1K PNG per gun. No new framework,
  no new materials, no new textures, no bore/damage/cadence/roster changes.

## Root presentation patch (additive, heroes only)

`src/weapons/controller.ts`: `HERO_ADS_TRIM` (`mp5` +0.005y, `m14-ebr`/`lmg` +0.002y)
added to `tmpOffset` scaled by `adsT`, gated on `this.heroRigs.has(cur.def.id)` —
adopted GLB heroes only. The 16 baseline rigs and the carbine canary never match and
keep byte-identical placement. The GUN moves; camera and reticle untouched
(no fake shoot alignment). Values are recipe-derived residuals — tune by looking.

## Root rerun

```bash
git apply --check work/hero-visual-repair.patch && git apply work/hero-visual-repair.patch
blender --background --factory-startup --threads 2 --python scripts/blender/build_roster_heroes.py -- --gun mp5 --out <root>
node scripts/assets/verify-roster-heroes.mjs --strict
npm run check && npm run build
node scripts/capture-roster-heroes.mjs --tag=heroes-repair1   # then LOOK at all nine
```

`--gun mp5` rebuilds only the overhauled gun; `--gun all` also re-emits EBR/LMG
(iron/notch fixes). `?heroes=canary` stays opt-in; default roster untouched.

## CPU verification (this lane, no Blender/GPU)

- `py_compile` clean; builders import-safe outside Blender and run: MP5 13/1478,
  EBR 15/1386, LMG 16/604 — all inside budget, all inside frozen envelopes, mags present.
- Combined patch `git apply --check` clean on pristine root copies; full apply +
  rebuild-from-patch re-verified with identical counts; patched manifest parses.
- Negative anchor: old LMG stock min −0.450 still trips the frozen `y_min −0.42`
  assert path (unchanged `_validate`).

## Known remaining defects (not claimed)

- Reload hand contact is provisional: shared hands ride `anchor_support`/`anchor_mag`,
  verified on 9 single frames only — no final-animation claim.
- ADS trims are first estimates from recipe geometry; root sets final values by eye.
- EBR is now irons-correct per reference; a magnified optic is a separate task.
- Root 210 s soak heroes-2344 JS-slope FAIL is untouched here (root A/B owns it);
  no soak harness, gate, or threshold changed; nothing here claims leak-free.
