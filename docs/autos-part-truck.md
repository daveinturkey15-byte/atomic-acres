# autos-part-truck — rewritten makeBoxTruck (drop-in for src/build/vehicles.ts)

Target: replaces the existing `makeBoxTruck` body (~8 m white-box variant).
Signature: `(ctx: BuildContext) => Vehicle`. Nose along local +x.
Uses only existing helpers (`group/box/slab/extrude/inst/xform/lamps/tailLamps/brightwork`),
`PAL` keys (`truckWhite/busNavy/truckCab/applianceRed/chrome/steel/timber/timberDark/glass/windowBand`),
and `ctx.mat` (`painted/signText/windowDark/chrome/steel`). No `new THREE.Material`.
`ctx.rand()` for crate yaw; never `Math.random()`.

Deviations (deliberate, per ticket):
- Custom black-tyre wheels instead of shared `wheels()`: that helper bakes in
  whitewall rings, and acceptance demands black tyres + chrome domes. Same
  `inst`/`xform` idiom and `WHEEL_REST` as the shared helper.
- `wid` covers the hatch crates (ground crate outboard of the +z flank), so the
  collider stays honest. If collider budget bites, delete the three crate meshes
  (marked CRATES below) and drop `wid` back to `W + 0.12`; the dark recess +
  rolled shutter still read as an open hatch.

```ts
/** Rigid COE box truck: bulbous navy cab, two-tone cream/navy box. ~9.4 x 2.5 x 3.7 m. */
function makeBoxTruck(ctx: BuildContext): Vehicle {
  const L = 9.4, W = 2.5, ROOF = 3.7;
  const g = group('box-truck');
  const trim = brightwork(ctx);
  const navy = ctx.mat.painted(PAL.busNavy, 0.45, 0.2);
  const cabDark = ctx.mat.painted(PAL.truckCab, 0.7, 0.1);
  const cream = ctx.mat.painted(PAL.truckWhite, 0.62, 0.05);
  const alloy = ctx.mat.painted(PAL.steel, 0.55, 0.12);
  const glass = ctx.mat.windowDark;
  const red = ctx.mat.painted(PAL.applianceRed, 0.28, 0.15);

  // chassis + two-tone box shell (navy lower, cream upper, split rail at 2.35)
  g.add(box(7.6, 0.16, W - 0.55, ctx.mat.steel, -0.4, 0.68, 0));
  const BOX_X = -1.45, BOX_L = 6.5; // spans -4.7..1.8: ~6.5 box + ~2.5 cab + nose
  g.add(box(BOX_L, 1.35, W, navy, BOX_X, 1.675, 0));
  g.add(box(BOX_L, 1.35, W, cream, BOX_X, 3.025, 0));
  g.add(box(BOX_L + 0.04, 0.09, W + 0.06, alloy, BOX_X, 2.35, 0));
  g.add(box(BOX_L + 0.04, 0.08, W + 0.06, alloy, BOX_X, ROOF - 0.02, 0));

  // fine-pitch HORIZONTAL corrugation rails, both bands, full length, both flanks
  const railY = [1.22, 1.42, 1.62, 1.82, 2.02, 2.2, 2.56, 2.76, 2.96, 3.16, 3.36, 3.54];
  const rails: THREE.Matrix4[] = [];
  for (const y of railY) for (const s of [-1, 1]) rails.push(xform(BOX_X, y, s * (W / 2 + 0.015)));
  g.add(inst(new THREE.BoxGeometry(BOX_L - 0.1, 0.045, 0.03), alloy, rails));

  // bulbous COE cab: rounded snub nose, high roof (flanks at +-1.22)
  const cab: Pt[] = [
    [2.0, 0.6], [4.3, 0.6], [4.68, 0.95], [4.7, 1.6],
    [4.5, 2.3], [4.0, 2.72], [3.3, 2.88], [2.0, 2.88],
  ];
  g.add(extrude(cab, W - 0.06, navy));

  // raked windscreen + chrome header/sill rails
  const screen = box(0.1, 0.82, W - 0.62, glass, 4.42, 2.2, 0);
  screen.rotation.z = 0.25;
  g.add(screen);
  for (const e of [-1, 1]) {
    const rail = box(0.08, 0.07, W - 0.54, trim, 4.42 - e * 0.10, 2.2 + e * 0.40, 0);
    rail.rotation.z = 0.25;
    g.add(rail);
  }
  // grille throat + slats, chrome bumper, headlamps
  g.add(box(0.08, 0.36, 1.5, cabDark, 4.70, 1.15, 0));
  const slats: THREE.Matrix4[] = [];
  for (let i = 0; i < 3; i++) slats.push(xform(4.74, 1.05 + i * 0.10, 0));
  g.add(inst(new THREE.BoxGeometry(0.05, 0.035, 1.44), trim, slats));
  g.add(box(0.16, 0.26, W - 0.2, trim, L / 2 - 0.02, 0.62, 0));
  lamps(g, ctx, 4.66, 1.15, [-0.95, 0.95], 0.15);

  // 3 thin chrome cowl speed-lines per flank
  const speeds: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) speeds.push(xform(2.62, 1.42 + i * 0.16, s * 1.232));
  g.add(inst(new THREE.BoxGeometry(1.05, 0.035, 0.025), trim, speeds));

  // tall door seams + handle, small upper side window with chrome frame, both flanks
  const seams: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const winRails: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    seams.push(xform(2.35, 1.62, s * 1.226));
    seams.push(xform(3.50, 1.62, s * 1.226));
    posts.push(xform(2.50, 2.32, s * 1.232));
    posts.push(xform(3.34, 2.32, s * 1.232));
    winRails.push(xform(2.92, 2.05, s * 1.232));
    winRails.push(xform(2.92, 2.59, s * 1.232));
  }
  g.add(inst(new THREE.BoxGeometry(0.045, 1.90, 0.02), cabDark, seams));
  g.add(box(1.19, 0.045, 0.02, cabDark, 2.925, 2.58, 1.226));
  g.add(box(1.19, 0.045, 0.02, cabDark, 2.925, 2.58, -1.226));
  g.add(box(0.85, 0.50, 0.035, glass, 2.92, 2.32, 1.226));
  g.add(box(0.85, 0.50, 0.035, glass, 2.92, 2.32, -1.226));
  g.add(inst(new THREE.BoxGeometry(0.06, 0.60, 0.03), trim, posts));
  g.add(inst(new THREE.BoxGeometry(0.90, 0.06, 0.03), trim, winRails));
  g.add(inst(new THREE.BoxGeometry(0.22, 0.05, 0.04), trim, [
    xform(3.28, 1.70, 1.238), xform(3.28, 1.70, -1.238),
  ]));

  // ribbed alloy step + rivet row under each door
  g.add(box(1.15, 0.10, 0.30, alloy, 2.92, 0.72, 1.22));
  g.add(box(1.15, 0.10, 0.30, alloy, 2.92, 0.72, -1.22));
  const stepRibs: THREE.Matrix4[] = [];
  for (let i = 0; i < 5; i++) {
    stepRibs.push(xform(2.52 + i * 0.20, 0.78, 1.22));
    stepRibs.push(xform(2.52 + i * 0.20, 0.78, -1.22));
  }
  g.add(inst(new THREE.BoxGeometry(0.06, 0.03, 0.32), trim, stepRibs));
  const rivets: THREE.Matrix4[] = [];
  for (let i = 0; i < 8; i++) {
    rivets.push(xform(2.42 + i * 0.143, 0.92, 1.226, Math.PI / 2));
    rivets.push(xform(2.42 + i * 0.143, 0.92, -1.226, Math.PI / 2));
  }
  g.add(inst(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), trim, rivets));

  // cream oval-swoosh on the navy lower band, both flanks behind the cab
  const swoosh: Pt[] = [
    [-1.6, -0.05], [0.4, -0.02], [1.6, 0.22], [1.6, 0.40], [0.4, 0.32], [-1.6, 0.24],
  ];
  for (const s of [-1, 1]) {
    const m = extrude(swoosh, 0.024, cream);
    m.position.set(-0.7, 1.62, s * (W / 2 + 0.03));
    g.add(m);
  }

  // running-figure mascot silhouette (abstract: head + leaning torso + limbs) on cream
  const fig = ctx.mat.painted(PAL.busNavy, 0.5, 0.15);
  for (const s of [-1, 1]) {
    const z = s * (W / 2 + 0.035);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10), fig);
    head.rotation.x = Math.PI / 2;
    head.position.set(1.02, 3.28, z);
    const torso = box(0.14, 0.52, 0.03, fig, 0.82, 2.98, z);
    torso.rotation.z = 0.5;
    const legA = box(0.11, 0.44, 0.03, fig, 0.62, 2.66, z);
    legA.rotation.z = -0.7;
    const legB = box(0.11, 0.44, 0.03, fig, 0.98, 2.64, z);
    legB.rotation.z = 0.9;
    const arm = box(0.09, 0.36, 0.03, fig, 0.86, 3.06, z);
    arm.rotation.z = 1.1;
    for (const m of [head, torso, legA, legB, arm]) { m.castShadow = true; g.add(m); }
  }

  // one small slogan line under the mascot, both flanks (generic haulier patter)
  const slogan = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.9, 1.9 / 5),
    ctx.mat.signText({ text: 'MOVES THE TOWN', color: PAL.busNavy, aspect: 5 }),
    2,
  );
  slogan.setMatrixAt(0, xform(-1.35, 3.02, W / 2 + 0.045));
  slogan.setMatrixAt(1, xform(-1.35, 3.02, -W / 2 - 0.045, 0, Math.PI));
  slogan.instanceMatrix.needsUpdate = true;
  slogan.computeBoundingSphere();
  g.add(slogan); // no castShadow: alpha cut-out, same idiom as the coach script

  // red corner markers at the box front-top, small square roof vent
  for (const s of [-1, 1]) g.add(box(0.12, 0.12, 0.14, red, 1.76, 3.52, s * (W / 2 - 0.06)));
  g.add(box(0.40, 0.06, 0.40, cabDark, -2.5, ROOF + 0.01, 0));
  g.add(box(0.50, 0.08, 0.50, alloy, -2.5, ROOF + 0.06, 0));

  // open roller-shutter hatch on the +z flank: dark recess, rolled shutter head,
  // ally frame, 2 crates in the mouth + 1 on the ground (CRATES: delete to save collider)
  g.add(box(2.2, 1.15, 0.06, cabDark, -1.2, 1.675, W / 2 - 0.02));
  g.add(box(2.2, 0.16, 0.10, alloy, -1.2, 2.18, W / 2 - 0.02));
  g.add(box(2.3, 0.06, 0.05, trim, -1.2, 2.29, W / 2 + 0.01));
  g.add(box(2.3, 0.06, 0.05, trim, -1.2, 1.07, W / 2 + 0.01));
  g.add(box(0.06, 1.28, 0.05, trim, -2.33, 1.68, W / 2 + 0.01));
  g.add(box(0.06, 1.28, 0.05, trim, -0.07, 1.68, W / 2 + 0.01));
  const crateMat = ctx.mat.painted(PAL.timber, 0.85, 0);
  const crateA = box(0.45, 0.45, 0.45, crateMat, -1.62, 1.325, W / 2 - 0.10);
  crateA.rotation.y = (ctx.rand() - 0.5) * 0.3;
  const crateB = box(0.45, 0.45, 0.45, crateMat, -1.10, 1.325, W / 2 - 0.12);
  crateB.rotation.y = (ctx.rand() - 0.5) * 0.3;
  g.add(crateA, crateB);
  const crateC = slab(0.5, 0.5, 0.5, ctx.mat.painted(PAL.timberDark, 0.9, 0), -0.30, 0, W / 2 + 0.28);
  crateC.rotation.y = (ctx.rand() - 0.5) * 0.6;
  g.add(crateC);

  // rear face: tail lamps, steel bumper, mudflaps, plates (front + rear)
  tailLamps(g, ctx, -L / 2, 1.05, [-0.95, 0.95], 0.12);
  g.add(box(0.15, 0.18, W, ctx.mat.steel, -L / 2 - 0.05, 0.55, 0));
  for (const s of [-1, 1]) g.add(box(0.06, 0.42, 0.40, cabDark, -2.55, 0.32, s * 1.0));
  const plateMat = ctx.mat.signText({
    text: 'NT25', color: PAL.truckCab, background: PAL.windowBand, aspect: 2.4,
  });
  g.add(box(0.06, 0.18, 0.44, plateMat, L / 2 + 0.06, 0.62, 0));
  g.add(box(0.06, 0.18, 0.44, plateMat, -L / 2 - 0.14, 0.55, 0));

  // black tyres + chrome domes, NO whitewalls; tight black arches; rear axle aft -3.0
  const tyre = ctx.mat.painted(PAL.truckCab, 0.94, 0);
  const hubs: THREE.Matrix4[] = [];
  const caps: THREE.Matrix4[] = [];
  const arches: THREE.Matrix4[] = [];
  for (const x of [3.3, -3.0]) {
    for (const s of [-1, 1]) {
      hubs.push(xform(x, WHEEL_REST + 0.5, s * 1.02, Math.PI / 2));
      caps.push(xform(x, WHEEL_REST + 0.5, s * 1.02, s * Math.PI / 2));
      arches.push(xform(x, WHEEL_REST + 0.5, s * (1.02 + 0.17)));
    }
  }
  g.add(inst(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18), tyre, hubs));
  const dome = new THREE.SphereGeometry(0.23, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.52);
  dome.scale(1, 0.55, 1);
  dome.translate(0, 0.18, 0);
  g.add(inst(dome, ctx.mat.painted(PAL.chrome, 0.18, 0.28), caps));
  g.add(inst(new THREE.TorusGeometry(0.56, 0.05, 6, 14, Math.PI), cabDark, arches));

  return { obj: g, len: L + 0.36, wid: 3.6, hgt: ROOF + 0.1 };
}
```
