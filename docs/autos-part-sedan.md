# Autos lane, part: display sedan + plinth + chicane placement (SedanSnippet)

Drop-in TypeScript for `src/build/vehicles.ts`. Orchestrator integrates; this file
is the only thing I wrote — no repo source was edited.

Assumes everything already in `vehicles.ts`: `THREE`, `BuildContext`/`Builder`/`AABB`,
`group/box/slab/extrude`, `aabbSlab`, `xform/inst`, `wheels/lamps/tailLamps/arcBar`,
`brightwork`, `Pt`, `Vehicle`, `park/parkOnHead` + `skew/nudge`, `NOSE_DOWN_STEM`,
`PAL`, layout consts. No new imports needed. No hex, no `new THREE.Material` —
`ctx.mat.painted / signText / windowDark / chrome / steel` only. No `Math.random`
(`skew`/`nudge` wrap `ctx.rand`). The ground.ts steel gate and manhole covers are
NOT rebuilt here — the plinth is placed to defer to that existing mouth furniture
(orchestrator nudges ±1 m if a verge box overlaps).

> Paint note: single-tone `PAL.carTeal` is the closest existing key. The reference
> display green is deeper; a future `displayGreen` key can replace it 1:1.

## Snippet 1 — `makeDisplaySedan` + `makeDisplayPlinth`

```ts
/**
 * Display-condition 1950s sedan for the -z pavement plinth at the -x mouth.
 * L 5.3 / W 2.0 / H ~1.5. Same construction idioms as makeSaloon (extruded
 * lower body + two-piece greenhouse, fin blades, chrome spear/bumpers/grille,
 * lamps/tailLamps, instanced shut-lines/handles) with: single-tone carTeal
 * paint, full brightwork, taller fins, and horizontal chrome slats across the
 * rear deck. Nose along local +x; whitewalls via wheels().
 */
export function makeDisplaySedan(ctx: BuildContext): Vehicle {
  const L = 5.3, W = 2.0, H = 1.52;
  const g = group('display-sedan');
  const paint = ctx.mat.painted(PAL.carTeal, 0.30, 0.35);
  const trim = brightwork(ctx);

  // lower body: rocker to beltline, bonnet down at the nose, boot up at the tail
  const body: Pt[] = [
    [-L / 2, 0.34], [L / 2, 0.34], [L / 2 + 0.02, 0.78], [1.25, 0.90],
    [-1.75, 0.94], [-L / 2 + 0.06, 0.98], [-L / 2 - 0.02, 0.76],
  ];
  g.add(extrude(body, W, paint));

  // greenhouse: wraparound screen + side band in glass, solid sail quarters
  const glass: Pt[] = [[-1.15, 0.88], [1.08, 0.88], [0.62, 1.36], [-1.15, 1.36]];
  g.add(extrude(glass, W * 0.82, ctx.mat.windowDark));
  const quarter: Pt[] = [[-1.75, 0.88], [-1.10, 0.88], [-1.10, 1.37], [-1.30, 1.37]];
  g.add(extrude(quarter, W * 0.84, paint));
  g.add(box(2.00, 0.10, W * 0.86, paint, -0.33, 1.41, 0));

  // TALLER fins than the road saloons: blades rise 0.42 above the boot lid
  const fin: Pt[] = [
    [-L / 2 + 0.10, 0.80], [-1.25, 0.88], [-L / 2 + 0.04, 0.92 + 0.42],
  ];
  for (const s of [-1, 1]) {
    const f = extrude(fin, 0.09, paint);
    f.position.z = s * (W / 2 - 0.05);
    g.add(f);
  }

  // horizontal chrome slats across the rear deck between the fin roots
  const slats: THREE.Matrix4[] = [];
  for (let i = 0; i < 4; i++) slats.push(xform(-2.02, 1.00 + i * 0.055, 0));
  g.add(inst(new THREE.BoxGeometry(0.55, 0.030, 1.20), trim, slats));

  // full brightwork: side spear, rocker, bumpers, grille, 4-lamp nose
  g.add(box(4.00, 0.07, W + 0.04, trim, 0.10, 0.72, 0));
  g.add(box(4.30, 0.05, W + 0.05, trim, 0, 0.40, 0));
  g.add(box(0.20, 0.18, W - 0.06, trim, L / 2 - 0.02, 0.46, 0));
  g.add(box(0.20, 0.18, W - 0.12, trim, -L / 2 + 0.02, 0.50, 0));
  g.add(box(0.09, 0.26, 1.50, trim, L / 2 + 0.02, 0.66, 0));
  g.add(box(0.62, 0.05, W * 0.87, trim, -1.45, 1.00, 0));
  lamps(g, ctx, L / 2 - 0.01, 0.62, [-0.80, -0.55, 0.55, 0.80], 0.12);
  // greenhouse frame: belt rail under the side glass, drip rail over it
  g.add(box(2.30, 0.05, W * 0.84 + 0.02, trim, -0.05, 0.895, 0));
  g.add(box(2.05, 0.045, W * 0.86, trim, -0.27, 1.345, 0));

  // door shut-lines (four per flank) and chrome handles, all instanced
  const shutDark = ctx.mat.painted(PAL.truckCab, 0.6, 0.2);
  const shutXf: THREE.Matrix4[] = [];
  for (const hx of [1.12, 0.06, -0.12, -1.67]) {
    shutXf.push(xform(hx, 0.62, W / 2 + 0.004));
    shutXf.push(xform(hx, 0.62, -W / 2 - 0.004));
  }
  g.add(inst(new THREE.BoxGeometry(0.035, 0.52, 0.025), shutDark, shutXf));
  g.add(inst(new THREE.BoxGeometry(0.18, 0.04, 0.03), trim, [
    xform(0.86, 0.82, W / 2 + 0.008), xform(0.86, 0.82, -W / 2 - 0.008),
    xform(-0.42, 0.82, W / 2 + 0.008), xform(-0.42, 0.82, -W / 2 - 0.008),
  ]));

  // wing mirrors on stalks at the A-pillars: chrome head, glass facing the driver
  for (const s of [-1, 1]) {
    g.add(box(0.04, 0.04, 0.18, shutDark, 0.95, 1.02, s * (W / 2 + 0.08)));
    g.add(box(0.05, 0.16, 0.12, ctx.mat.chrome, 0.95, 1.12, s * (W / 2 + 0.16)));
    g.add(box(0.02, 0.12, 0.08, ctx.mat.windowDark, 0.92, 1.12, s * (W / 2 + 0.16)));
  }

  // red lenses on the tall fin tips, plates front and rear
  tailLamps(g, ctx, -L / 2 - 0.02, 0.92 + 0.42, [W / 2 - 0.05, -(W / 2 - 0.05)], 0.09);
  const plate = ctx.mat.signText({
    text: 'NT51', color: PAL.truckCab, background: PAL.windowBand, aspect: 2.4,
  });
  g.add(box(0.05, 0.16, 0.40, plate, L / 2 + 0.09, 0.46, 0));
  g.add(box(0.05, 0.16, 0.40, plate, -L / 2 - 0.09, 0.50, 0));

  wheels(g, ctx, [1.68, -1.68], 0.90, 0.36, 0.24);
  return { obj: g, len: L + 0.24, wid: W + 0.09, hgt: H };
}

/** Plinth payload: group origin at ground under the plinth centre, top at 0.4. */
export interface DisplayPlinth {
  obj: THREE.Group;
  /** deck height the sedan's wheels rest on (pass as park surfaceY) */
  top: number;
}

/**
 * Display plinth + placard. 6.0 x 0.4 x 2.5 pale pavingWarm deck with a darker
 * lip at its base; placard on two posts at the road-side east corner, board
 * 1.0 x 0.7 sloped ~27 deg, pale face with a generic header + dark line-bars
 * as illegible rows (geometry, never transcribed sentences).
 */
export function makeDisplayPlinth(ctx: BuildContext): DisplayPlinth {
  const TOP = 0.4;
  const g = group('display-plinth');
  const deck = ctx.mat.painted(PAL.pavingWarm, 0.9, 0);
  const lip = ctx.mat.painted(PAL.concreteDark, 0.95, 0);

  g.add(slab(6.0, TOP, 2.5, deck, 0, 0, 0));
  g.add(box(6.15, 0.12, 2.65, lip, 0, 0.06, 0));

  // placard at the road-side (+z) east (+x) corner, standing on the pavement
  const post = ctx.mat.steel;
  for (const dx of [-0.35, 0.35]) g.add(box(0.08, 0.90, 0.08, post, 3.60 + dx, 0.45, 0.90));
  const board = box(1.0, 0.7, 0.06, deck, 3.60, 0.95, 0.90);
  board.rotation.x = -0.47; // ~27 deg lectern slope, face tipped to the road
  const head = box(0.50, 0.14, 0.02,
    ctx.mat.signText({ text: 'MOTORS', color: PAL.truckCab, background: PAL.windowBand, aspect: 3.4 }),
    0, 0.18, 0.045);
  board.add(head);
  const rowDark = ctx.mat.painted(PAL.truckCab, 0.7, 0.1);
  const rows: THREE.Matrix4[] = [];
  for (let i = 0; i < 3; i++) rows.push(xform(0, 0.02 - i * 0.11, 0.045));
  board.add(inst(new THREE.BoxGeometry(0.70, 0.045, 0.02), rowDark, rows));
  g.add(board);

  return { obj: g, top: TOP };
}
```

Helpers used: `group/box/slab/extrude/inst/xform/wheels/lamps/tailLamps/brightwork`
— all existing. `makeDisplaySedan` is ~60 lines, `makeDisplayPlinth` ~30. No gates.

## Snippet 2 — revised `buildVehicles` placement block

Replaces placement items 1–5 in the current `buildVehicles` (keeps `park`,
`parkOnHead`, `skew`, `nudge`, `APRON_Y`). Sibling dims: `makeTrailer`
9.15/2.62/2.99 (body 7.5/2.5/2.9 + ~1.5 drawbar; TrailerSnippet), second bus
`makeSecondBus` 11.6/2.87/3.40 (BusSnippet, docs/autos-part-bus.md), rigid
`makeBoxTruck` 9.76/3.6/3.8 (TruckSnippet; wid 3.6 covers hatch crates outboard
of the +z flank — slot math below uses the full 3.6 collider, not body-only 2.5).

Chicane logic: each gate is a diagonal-parked long vehicle centred slightly to
one kerb so the FAR-side lane is the ~3 m slot (2.5–3.5 m) and the near side is
pinched; sides alternate (−z, +z, −z) so the traverse weaves. Quoted numbers are
nominals — keep the existing `+ nudge()` / `+ skew()` idioms. The "~3 m slots"
are lateral clearances, not bumper-to-bumper gaps.

```ts
  // DISPLAY PLINTH on the -z pavement at the -x mouth. 6.0-long plinth at
  // x -50.5..-44.5 (inside ROAD_X_MIN -52), z -7.15..-4.65: fully on the
  // pavement band (|z| 4.6..7.2), carriageway clear. Sedan rides the deck.
  const plinth = makeDisplayPlinth(ctx);
  plinth.obj.position.set(-47.5, 0, -5.9);
  out.add(plinth.obj);
  colliders.push(aabbSlab(-47.5, 0, -5.9, 6.15, 0.4, 2.65));
  colliders.push(aabbSlab(-43.9, 0, -5.0, 1.1, 1.3, 0.4)); // placard post + board
  park(makeDisplaySedan(ctx), -47.5, -5.9, 0.10, plinth.top);

  // CHICANE GATE 1 — rigid truck, -z side, shallow diagonal +. Full 9.76/3.6
  // collider at yaw 0.22: swept z 5.64, x half-span 5.15. x -39.2..-28.9,
  // z -3.57..2.07; far (+z) slot = 4.6 - 2.07 = 2.5 m.
  park(makeBoxTruck(ctx),
    -34 + nudge(),
    -0.75,
    NOSE_DOWN_STEM + 0.22 + skew());

  // CHICANE GATE 2 — towed trailer, +z side, diagonal −. Collider 9.15/2.62
  // at yaw 0.46: x -22.7..-13.3 (body 7.5 + ~1.5 drawbar forward),
  // z -2.1..4.3; far (−z) slot = 4.6 - 2.1 = 2.5 m.
  park(makeTrailer(ctx),
    -18 + nudge(),
    1.1,
    NOSE_DOWN_STEM - 0.46 + skew());

  // Show-condition two-tone saloon (UNCHANGED): open stem, orange kerb side,
  // far lane open. x ≈ -2.9, z ≈ -2.39, yaw ≈ 0.18.
  park(makeSaloon(ctx, PAL.carBlue, { fin: 0.32, twoTone: true, brightwork: true }),
    -HOUSE_HALF_LEN * 0.3 + nudge(),
    ORANGE.side * ROAD_HALF_WIDTH * 0.52,
    0.18 + skew());

  // CHICANE GATE 3 — second bus, -z side, shallow diagonal +. x 3.0..15.0
  // (clear of the head disc west edge 16.4), z -3.57..1.77;
  // far (+z) slot = 4.6 - 1.77 = 2.8 m.
  park(makeSecondBus(ctx),
    9 + nudge(),
    -0.9,
    NOSE_DOWN_STEM + 0.22 + skew());

  // Tour coach ON the head, orange (-z) half, across the bulb (UNCHANGED).
  parkOnHead(makeCoach(ctx),
    HEAD_CENTER_X - 0.30 + nudge(),
    ORANGE.side * HEAD_RADIUS * 0.33,
    NOSE_DOWN_STEM - 0.44 + skew());

  // Dark blue saloon tucked outboard on the head, white (+z) half (UNCHANGED).
  // The rigid's old head slot stays empty: the head must not wall off now that
  // the stem gates force the weave.
  parkOnHead(makeSaloon(ctx, PAL.carBlue, { fin: 0.2, twoTone: false, brightwork: false }),
    HEAD_CENTER_X + HEAD_RADIUS * 0.06 + nudge(),
    WHITE.side * HEAD_RADIUS * 0.76,
    NOSE_DOWN_STEM + skew());

  // Red saloon on the orange driveway apron, nose out (UNCHANGED).
  park(makeSaloon(ctx, PAL.carRed, { fin: 0.26, twoTone: true, brightwork: false }),
    ORANGE.garageX + GARAGE_LEN * 0.1,
    ORANGE.side * (FRONT_LAWN_OUTER + PAVEMENT_OUTER) * 0.5,
    ORANGE.side * Math.PI * 0.5 + skew(),
    APRON_Y);
```

Per-vehicle numbers (nominal x / z / yaw):

| vehicle | x | z | yaw | far-side slot |
|---|---|---|---|---|
| plinth (+ sedan on deck) | −47.5 | −5.9 | 0 / sedan 0.10 | n/a (off carriageway) |
| rigid truck | −34 | −0.75 | π+0.22 | +z 2.5 m |
| trailer | −18 | +1.1 | π−0.46 | −z 2.5 m |
| show saloon (kept) | −2.9 | −2.39 | 0.18 | open lane |
| second bus | +9 | −0.9 | π+0.22 | +z 2.8 m |
| tour coach (head, kept) | 25.7 | −3.17 | π−0.44 | head bulb |
| blue saloon (head, kept) | 26.6 | +7.30 | π | head bulb |
| red saloon (driveway, kept) | garageX+0.76 | −10.4 | −π/2 | n/a |

Gate-to-gate bumper gaps: truck→trailer 6.2 m, trailer→show saloon 7.9 m,
show saloon→second bus 3.4 m — all ≥ 3 m, nothing double-parks a route. All
three gate slots land 2.5–2.8 m (inside 2.5–3.5 m), traverse stays 5/5.
