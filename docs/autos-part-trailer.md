# autos-part-trailer — `makeTrailer(ctx)` snippet for `src/build/vehicles.ts`

Drop-in: paste into `src/build/vehicles.ts` beside `makeBoxTruck`. Relies on the
module's existing helpers (`group`/`box`/`inst`/`xform`/`wheels`/`tailLamps`/
`brightwork`, `Vehicle`, `WHEEL_REST` via `wheels()`) — no new imports.
PAL keys only (`trailerBody`/`trailerRoof`/`trailerTrim` + existing neutrals);
materials only via `ctx.mat.*`; randomness only via `ctx.rand()`.

```ts
/**
 * Towed box trailer: cream corrugated upper over a slate-blue lower band,
 * flat pale roof slab, A-frame drawbar, tandem rear wheels only. ~7.5 x 2.5
 * x 2.9 m body, nose (+x) is the drawbar end. Box-only: no cab, no engine.
 */
function makeTrailer(ctx: BuildContext): Vehicle {
  const L = 7.5, W = 2.5, H = 2.9;
  const floorY = 0.85;                 // body underside
  const bandH = 0.62;                  // slate-blue lower band height
  const bodyH = H - floorY;            // 2.05 of body above the floor
  const upperH = bodyH - bandH;
  const g = group('trailer');
  const trim = brightwork(ctx);
  const steel = ctx.mat.steel;
  const cream = ctx.mat.painted(PAL.trailerBody, 0.68, 0.04);
  // NOTE(palette-mismatch): PAL comments trailerRoof as the "blue-grey roof",
  // but this lane spends it as the LOWER band under the cream upper; the
  // actual roof slab below is pale truckWhite. Rename on a palette pass.
  const band = ctx.mat.painted(PAL.trailerRoof, 0.6, 0.08);
  const dark = ctx.mat.painted(PAL.truckCab, 0.7, 0.1);

  // shell: lower band + cream upper + pale roof slab
  g.add(box(L, bandH, W, band, 0, floorY + bandH / 2, 0));
  g.add(box(L, upperH, W, cream, 0, floorY + bandH + upperH / 2, 0));
  g.add(box(L + 0.08, 0.09, W + 0.08,
    ctx.mat.painted(PAL.truckWhite, 0.62, 0.05), 0, H + 0.045, 0));

  // horizontal siding ribs down both flanks, instanced
  const ribXf: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      ribXf.push(xform(0, floorY + bandH + 0.24 + i * 0.24, s * (W / 2 + 0.008)));
    }
  }
  g.add(inst(new THREE.BoxGeometry(L - 0.3, 0.05, 0.035),
    ctx.mat.painted(PAL.steel, 0.55, 0.12), ribXf));

  // rub-rail at the band seam + underbody skirt, both steel
  g.add(box(L + 0.06, 0.1, W + 0.06, steel, 0, floorY + bandH, 0));
  g.add(box(L - 1.2, 0.18, W - 0.6, steel, -0.5, floorY - 0.09, 0));

  // red side markers: 4 upper + 1 lower (forward of the axles) per flank
  const markXf: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    for (const mx of [-2.9, -1.0, 0.9, 2.8]) {
      markXf.push(xform(mx, H - 0.35, s * (W / 2 + 0.02)));
    }
    markXf.push(xform(0.6, floorY + bandH / 2, s * (W / 2 + 0.02)));
  }
  g.add(inst(new THREE.BoxGeometry(0.14, 0.1, 0.05),
    ctx.mat.painted(PAL.trailerTrim, 0.4, 0.1), markXf));
  tailLamps(g, ctx, -L / 2, 1.0, [-0.95, 0.95], 0.09);

  // tall open side doorway, forward half of the +z flank: dark interior mass,
  // dark opening inset, brightwork frame, leaf swung flat alongside (aft side)
  const doorX = 1.55, doorW = 1.25, doorH = 1.8;
  const doorY = floorY + doorH / 2 + 0.06;
  g.add(box(doorW - 0.06, doorH - 0.06, 0.5, dark, doorX, doorY, W / 2 - 0.3));
  g.add(box(doorW, doorH, 0.08, ctx.mat.windowDark, doorX, doorY, W / 2 - 0.01));
  for (const e of [-1, 1]) {
    g.add(box(0.08, doorH + 0.1, 0.06, trim, doorX + e * doorW / 2, doorY, W / 2 + 0.02));
    g.add(box(doorW + 0.16, 0.08, 0.06, trim, doorX, doorY + e * doorH / 2, W / 2 + 0.02));
  }
  g.add(box(doorW - 0.06, doorH - 0.06, 0.06, cream,
    doorX - doorW - 0.12, doorY, W / 2 + 0.07));
  for (const hy of [doorY - 0.6, doorY + 0.6]) {
    g.add(box(0.1, 0.12, 0.08, steel, doorX - doorW / 2 - 0.03, hy, W / 2 + 0.05));
  }

  // rear doorway + deployed ramp (sloped steel slab, sill to ground)
  const rearW = 1.5, rearH = 1.7;
  const rearY = floorY + rearH / 2 + 0.05;
  g.add(box(0.5, rearH - 0.06, rearW - 0.06, dark, -L / 2 + 0.2, rearY, 0));
  g.add(box(0.08, rearH, rearW, ctx.mat.windowDark, -L / 2 - 0.01, rearY, 0));
  for (const s of [-1, 1]) {
    g.add(box(0.09, rearH + 0.12, 0.09, trim, -L / 2 - 0.02, rearY, s * (rearW / 2 + 0.04)));
  }
  g.add(box(0.09, 0.09, rearW + 0.17, trim, -L / 2 - 0.02, rearY + rearH / 2 + 0.04, 0));
  const rampLen = 2.3;
  const rampAng = Math.asin((floorY - 0.02) / rampLen);
  const ramp = box(rampLen, 0.08, rearW - 0.12, steel,
    -L / 2 - (rampLen * Math.cos(rampAng)) / 2, floorY / 2, 0);
  ramp.rotation.z = rampAng;
  g.add(ramp);

  // INTERPRETIVE: frames never resolved a vent here; a small 3-slat louvre
  // high on the -z flank keeps the aft panel from reading blank. Drop if refs disagree.
  const ventX = -1.6, ventY = H - 0.55;
  g.add(box(0.5, 0.4, 0.06, trim, ventX, ventY, -(W / 2 + 0.01)));
  g.add(inst(new THREE.BoxGeometry(0.42, 0.05, 0.04), dark,
    [0, 1, 2].map((i) => xform(ventX, ventY - 0.11 + i * 0.11, -(W / 2 + 0.045)))));

  // abstract scuff streaks on the lower band, no text; jitter from ctx.rand()
  const scuff = ctx.mat.painted(PAL.truckCab, 0.85, 0);
  const jz = (ctx.rand() - 0.5) * 0.1;
  g.add(box(1.9, 0.1, 0.02, scuff, -0.4, floorY + 0.32 + jz, W / 2 + 0.012));
  g.add(box(1.2, 0.07, 0.02, scuff, 0.2 - jz, floorY + 0.18, -(W / 2 + 0.012)));

  // A-frame drawbar converging to the hitch plate + twin landing legs
  const drawLen = 1.5;               // fleet grounding: ~1.5 m drawbar, collider len ~9.0
  for (const s of [-1, 1]) {
    const arm = box(drawLen + 0.5, 0.12, 0.12, steel, L / 2 + drawLen / 2 - 0.2, 0.62, s * 0.55);
    arm.rotation.y = s * 0.26;
    g.add(arm);
    g.add(box(0.12, 0.75, 0.12, steel, L / 2 - 0.6, 0.38, s * 0.85));
    g.add(box(0.3, 0.06, 0.3, steel, L / 2 - 0.6, 0.05, s * 0.85));
  }
  g.add(box(0.4, 0.1, 0.3, steel, L / 2 + drawLen - 0.05, 0.55, 0));

  // tandem REAR wheels only; whitewall rings come free with wheels()
  wheels(g, ctx, [-1.7, -2.75], 1.08, 0.46, 0.28);
  return { obj: g, len: L + drawLen + 0.15, wid: W + 0.12, hgt: H + 0.09 };
}
```
