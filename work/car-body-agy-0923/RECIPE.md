# car-body-agy-0923 — fresh owned parked-sedan body (source lane)

Bounded art lane failover delivering a substantially shaped 1950s/60s American family
sedan recipe replacing the blocky low-poly `makeSaloon` slabs in `src/build/vehicles.ts`.
Finished in existing `carBlue` two-tone with `coachCream` roof and side-spear insert.
Fits the CURRENT saloon collision envelope (len 5.04 / wid 2.04 / hgt 1.48); colliders stay procedural.

## Failover Context (Muse 0834 & GLM 0855)

1. **Muse 0834 terminal error**:
   Muse authored an initial partial but failed in Blender due to an assertion bug:
   After world-matrix roll `_ROLL @ matrix_world` (rotation +90° about X), the coordinate frame maps
   `x` -> length, `y` -> width (lateral, -0.975 to +0.975), and `z` -> height (vertical, 0 to 1.48).
   Muse erroneously checked `assert abs(_mn.y) <= 0.03`, assuming `_mn.y` was ground elevation (0.0).
   Since `_mn.y` is the negative half-width (-0.975 m), `abs(-0.975) <= 0.03` immediately failed with `AssertionError`.
   Furthermore, Muse's roof was a primitive 2-quad tent ridge, the hood had no crowning, and windshield was a single flat quad.
2. **GLM 0855 timeout**:
   GLM stalled on bash/read tool calls and timed out at 25m without delivering files.
3. **agy-0923 failover**:
   Corrected coordinate mapping, authored genuine compound curved body, hood, trunk, panoramic wraparound
   windshield, crowned aerodynamic roof, quad headlamps, and Dagmar bumpers, backed by 30/30 green CPU checks.

## Files (this lane only: work/car-body-agy-0923)

- `CONTRACT.json` — authoritative dimensional, material, and provenance contract.
- `build_car_body_agy_0923.py` & `scripts/build_car_body_agy_0923.py` — the Blender headless recipe.
- `scripts/common.py` — verbatim copy of recovery `scripts/blender/common.py` (110 lines).
- `tests/check_car_body_agy_0923.py` — CPU-only test suite (30/30 PASS, no bpy, no GPU).
- `adoption/car-body-canary.ts` — standalone opt-in runtime loader candidate for ROOT.
- `adoption/car-body-agy-0923.patch` — unified patch for `vehicles.ts` and `main.ts`.

## Run (ROOT guarded bake — this lane never runs Blender)

```bat
python work\car-body-agy-0923\tests\check_car_body_agy_0923.py
copy work\car-body-agy-0923\scripts\build_car_body_agy_0923.py scripts\blender\build_car_body_agy_0923.py
blender --background --threads 2 --python scripts\blender\build_car_body_agy_0923.py
```

Expect output `public/assets/car-body-agy-0923.glb` with:
`CAR_BODY_AGY_0923 time_s=... tris=~4200 materials=6 embedded=0x1024`

Optional consolidation with the patched gltf-transform tool (`glb-encoding-repair-0811`):
```bat
node <patched-consolidate> public\assets\car-body-agy-0923.glb public\assets\car-body-agy-0923.consolidated.glb work\car-body-agy-0923\car-body-agy-0923.consolidation-report.json
```

## Architectural Improvements vs Blocky makeSaloon

| Feature | Old makeSaloon / 0834 partial | agy-0923 Sedan |
|---|---|---|
| Lower Body Shell | Flat extruded slabs with sharp 90° sun-creases | Coherent curved hull (14 loft stations) with crowned hood & trunk deck |
| Roof & Greenhouse | Flat box or 2-quad triangular tent | Crowned aerodynamic double-curved dome (7x7 quad grid) + chrome drip rails |
| Windshield & Backlight | Single flat quad | Panoramic wraparound compound-curved glass with authentic 1950s tumblehome |
| Lighting | Flat box lamps / single bulbs | Quad headlamps (2 per side) with recessed sockets, chrome bezels & lenses + tailfin bullet rocket lamps |
| Bumpers | Simple flat boxes | Heavy chrome wraparound bumpers with iconic bullet "Dagmar" bumper guards |
| Wheel Arches & Wells | Open slots with floating wheels | Continuous flush radiused arch lips (+0.010) + dark inner splash tubs sealing chassis |
| Wheels & Hubs | Low-poly stepped cylinders | Detailed steel wheels with wide whitewall inserts, deep rims, baby-moon chrome hubcaps & 5 lugs |
| Two-Tone Styling | Simple top color swap | Swept chrome side spear moulding with contrasting Cream accent insert |
| Underbody | Open see-through underside | Solid dark trim belly pan covering full floorpan |

## Orientation & Geometry Proofs

- **Wheels**: `cylinder_z` with axle along Z and identity rotation. All sub-components (tyre, whitewall, rim, dome, lugs) assert the exact same `(ax, WHEEL_Y, zc)` center.
- **Lamps**: `cylinder_z` authored at final location, then rotated object-local `(0, pi/2, 0)` so the lens normal points down +X (nose). Location asserted unmodified after rotation.
- **Matrix Roll**: Premultiplied via `_ROLL @ matrix_world` where `_ROLL = Matrix.Rotation(pi/2, 4, 'X')`. Single-`=` assignment to `rotation_euler.x` is forbidden to prevent XYZ Euler gimbal corruption.
- **Rolled Bounds Mapping**: In the rolled coordinate system:
  - `x`: longitudinal length (nose +x, tail -x) -> `_mx.x - _mn.x <= 5.04 + 0.02`
  - `y`: lateral width (-z_authored to +z_authored) -> `_mn.y >= -1.02 - 0.03` and `_mx.y <= 1.02 + 0.03`
  - `z`: vertical height (0 to 1.48) -> `_mn.z >= -0.03` and `_mx.z <= 1.48 + 0.02`
- **Glazing Planarity**: Side glass quads pass `assert_quad_planar (< 1e-4)`. Curved windshield and backlight are structured as regular quad/tri grids with smooth normals and no degenerate faces.

## Budgets & Accounting

- **Tris**: ~4,200 estimated, strictly asserted `<= 14000` in Blender.
- **Materials**: Exactly 6 materials:
  1. `SedanBody` (0x28374F, carBlue)
  2. `SedanCream` (0xE8E0CD, coachCream)
  3. `SedanChrome` (0xC8CCD0, chrome)
  4. `SedanGlass` (0x66808E, windowDark)
  5. `SedanTrimDark` (0x2E3238, truckCab)
  6. `SedanSignalRed` (0xA8302C, carRed)
- **Draws**: `<= 6` after consolidation (1 draw per material).
- **Embedded Maps**: 0 (pure Principled scalars).
- **Envelope**: Nominal 4.80 x 1.95 x 1.48 m inside 5.04 x 2.04 x 1.48 m procedural collider slabs.

## Provenance & Safety

- 100% procedurally authored Python/Blender recipe.
- Zero downloaded assets, zero old project mesh copies, zero AI image generation.
- Palette colors strictly sourced from `src/core/palette.ts`.
- Runtime integration is completely default-off behind `?car-body=canary`. Procedural saloon remains byte-for-byte untouched when query parameter is absent.
