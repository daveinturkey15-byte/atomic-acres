# Autos part — second bus livery (drop-in for `src/build/vehicles.ts`)

Drop-in builder reusing the `makeCoach` idiom (`loftHull`, `flankHalf`,
`noseX`, glazing `bandSec`, `wheels`, `lamps`, `tailLamps`, `arcBar`,
`brightwork`, `inst`/`xform`). Nose along local +x. Orchestrator pastes the
function into `vehicles.ts`; nothing else changes.

```ts
/** Second bus: near-black top, cream banner band, navy lower. ~11.6 x 2.87 x 3.40 m. */
function makeSecondBus(ctx: BuildContext): Vehicle {
  const g = group('coach-second');
  const trim = brightwork(ctx);
  const navy = ctx.mat.painted(PAL.busNavy, 0.5, 0.15);
  const black = ctx.mat.painted(PAL.busBlack, 0.55, 0.12);
  const cream = ctx.mat.painted(PAL.coachCream, 0.5, 0.12);
  const glazing = ctx.mat.windowDark;
  const shadowGap = ctx.mat.painted(PAL.truckCab, 0.7, 0.1);

  // navy lower hull; black roof cap and cream banner are proud overlays
  const hull = new THREE.Mesh(loftHull(), navy);
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);

  // black roof cap: proud slab over the crown, stops short of nose/tail turn-in
  g.add(box(8.6, 0.55, 2 * (flankHalf(3.05) + 0.030), black, -0.30, 3.05, 0));

  // cream swoosh-banner mid-band, both flanks in one extrusion
  const banner = ctx.mat.painted(PAL.coachCream, 0.5, 0.12);
  g.add(extrude([
    [-5.00, 0.95], [-0.60, 0.95], [3.00, 1.48], [4.90, 1.55],
    [4.90, 1.90], [3.00, 1.83], [-0.60, 1.30], [-5.00, 1.30],
  ], 2 * (flankHalf(1.40) + 0.030), banner));

  // dark glazing band + mullions, same tumblehome-following section as makeCoach
  const bandSec = (pad: number): Pt[] => {
    const h = (y: number): number => flankHalf(y) + pad;
    return [
      [-h(2.05), 2.05], [h(2.05), 2.05], [h(2.45), 2.45],
      [h(2.82), 2.82], [-h(2.82), 2.82], [-h(2.45), 2.45],
    ];
  };
  const band = extrude(bandSec(0.012), 8.2, glazing);
  band.rotation.y = Math.PI / 2;
  band.position.x = -0.35;
  g.add(band);
  const mullGeo = extrude(bandSec(0.030), 0.07, ctx.mat.chrome).geometry;
  mullGeo.rotateY(Math.PI / 2);
  const mull: THREE.Matrix4[] = [];
  for (let i = 0; i < 9; i++) mull.push(xform(-4.25 + i * 0.98, 0, 0));
  g.add(inst(mullGeo, ctx.mat.chrome, mull));

  // chrome rub-rails above/below the banner + rivet rows through both flanks
  g.add(box(9.6, 0.08, 2 * (flankHalf(1.95) + 0.050), trim, -0.20, 1.95, 0));
  g.add(box(9.5, 0.07, 2 * (flankHalf(0.80) + 0.020), trim, -0.15, 0.80, 0));
  const rivets: THREE.Matrix4[] = [];
  const rivet = new THREE.CylinderGeometry(0.026, 0.026, 2 * (flankHalf(1.83) + 0.05), 6);
  for (let i = 0; i < 20; i++) {
    const x = -4.6 + i * 0.47;
    rivets.push(xform(x, 1.83, 0, Math.PI / 2));
    rivets.push(xform(x, 0.92, 0, Math.PI / 2));
  }
  g.add(inst(rivet, ctx.mat.chrome, rivets));

  // banner lettering: plausible-spirit civic wording, not the reference sentence
  const wordZ = flankHalf(1.62) + 0.055;
  const words = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(3.4, 3.4 / 6.0),
    ctx.mat.signText({ text: 'BUILDING TOMORROW', color: PAL.coachCream, background: PAL.busBlack, aspect: 6.0 }),
    2,
  );
  words.setMatrixAt(0, xform(-0.4, 1.62, wordZ));
  words.setMatrixAt(1, xform(-0.4, 1.62, -wordZ, 0, Math.PI));
  words.instanceMatrix.needsUpdate = true;
  words.computeBoundingSphere();
  g.add(words);

  // running-figure mascot: pure-geometry striding silhouette, one per flank.
  // head disc + leaning torso + stride limbs from thin slabs, cream on black.
  const figure: Pt[] = [
    // torso leaning forward (+x), legs in stride, arms counter-swinging
    [0.00, 0.00], [0.42, 0.02], [0.30, 0.34], [0.62, 0.52], [0.55, 0.62],
    [0.28, 0.48], [0.34, 0.78], [0.52, 0.92], [0.44, 1.00], [0.24, 0.86],
    [0.10, 0.60], [-0.22, 0.72], [-0.30, 0.64], [-0.02, 0.48],
    [-0.30, 0.22], [-0.24, 0.12], [0.02, 0.32],
  ];
  const figGeo = extrude(figure, 0.03, cream).geometry;
  figGeo.scale(0.62, 0.62, 1);
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(figGeo, cream);
    m.position.set(2.55, 1.02, s * (flankHalf(1.20) + 0.045));
    if (s < 0) m.rotation.y = Math.PI;
    g.add(m);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), cream);
    head.position.set(2.55 + 0.36, 1.66, s * (flankHalf(1.20) + 0.045));
    g.add(head);
  }

  // split screen, blind box, grille + lamps, bumpers, tail — same idiom as NT07
  const sillY = 1.92;
  const headY = 2.64;
  const scrY = (sillY + headY) / 2;
  const rake = Math.atan2(noseX(sillY) - noseX(headY), headY - sillY);
  const scrH = Math.hypot(noseX(sillY) - noseX(headY), headY - sillY) - 0.06;
  for (const s of [-1, 1]) {
    const pane = box(0.06, scrH, 0.84, glazing, noseX(scrY) - 0.02, scrY, s * 0.52);
    pane.rotation.set(0, -s * 0.15, rake);
    g.add(pane);
  }
  const pillar = box(0.07, scrH + 0.08, 0.12, trim, noseX(scrY) + 0.012, scrY, 0);
  pillar.rotation.z = rake;
  g.add(pillar);
  g.add(box(0.09, 0.24, 1.30, trim, 5.315, 2.80, 0));
  g.add(box(0.08, 0.17, 1.15, ctx.mat.signText({
    text: 'CIVIC PRIDE', color: PAL.coachCream, background: PAL.busBlack, aspect: 6.8,
  }), 5.340, 2.80, 0));
  g.add(box(0.12, 0.42, 1.50, trim, 5.625, 1.28, 0));
  g.add(box(0.07, 0.32, 1.36, black, 5.675, 1.28, 0));
  const slats: THREE.Matrix4[] = [];
  for (let i = 0; i < 5; i++) slats.push(xform(5.705, 1.15 + i * 0.065, 0));
  g.add(inst(new THREE.BoxGeometry(0.05, 0.032, 1.30), trim, slats));
  lamps(g, ctx, 5.50, 1.32, [-1.00, 1.00], 0.19);
  g.add(inst(arcBar(2.2, 0.115, 1.05), ctx.mat.chrome, [xform(5.62 - 2.2, 1.00, 0)]));
  g.add(inst(arcBar(2.2, 0.05, 1.0), shadowGap, [xform(5.60 - 2.2, 0.855, 0)]));
  g.add(inst(arcBar(2.2, 0.115, 1.05), ctx.mat.steel, [xform(-5.52 + 2.2, 1.00, 0, 0, Math.PI)]));
  g.add(box(0.08, 0.72, 1.50, glazing, -5.50, 2.30, 0));
  tailLamps(g, ctx, -5.44, 1.15, [-0.95, -0.65, 0.65, 0.95], 0.10);

  // entry door, mirrors, wipers, roof pods, hatches, plates, stack
  g.add(box(0.90, 1.38, 0.04, navy, 4.10, 1.31, 1.315));
  g.add(box(0.60, 0.40, 0.045, glazing, 4.10, 1.72, 1.33));
  g.add(inst(new THREE.BoxGeometry(0.035, 1.44, 0.045), shadowGap, [
    xform(3.63, 1.31, 1.33), xform(4.57, 1.31, 1.33),
  ]));
  g.add(box(0.94, 0.035, 0.045, shadowGap, 4.10, 2.03, 1.33));
  g.add(box(0.16, 0.045, 0.05, trim, 4.47, 1.28, 1.345));
  for (const s of [-1, 1]) {
    g.add(box(0.05, 0.76, 0.05, shadowGap, 5.446, 1.93, s * 0.955));
    g.add(box(0.06, 0.26, 0.16, ctx.mat.chrome, 5.476, 2.38, s * 0.99));
    g.add(box(0.02, 0.22, 0.12, glazing, 5.44, 2.38, s * 0.99));
    const wiper = box(0.025, 0.55, 0.03, shadowGap, 5.565, 2.18, s * 0.52);
    wiper.rotation.set(0, -s * 0.15, s * 0.38);
    g.add(wiper);
  }
  const plateMat = ctx.mat.signText({
    text: 'NT08', color: PAL.truckCab, background: PAL.windowBand, aspect: 2.4,
  });
  g.add(box(0.05, 0.18, 0.44, plateMat, 5.72, 1.00, 0));
  g.add(box(0.05, 0.18, 0.44, plateMat, -5.61, 1.00, 0));

  // six dark-tyred wheels with chrome hubs; white arch lips via the arch torus
  // in brightwork so the black-on-navy flank still reads at distance
  wheels(g, ctx, [3.55, -2.95, -4.45], 1.22, 0.54, 0.30);
  const tyreMute = new THREE.CylinderGeometry(0.86 * 0.54, 0.86 * 0.54, 0.30 * 1.06, 18);
  const mutes: THREE.Matrix4[] = [];
  for (const x of [3.55, -2.95, -4.45]) for (const s of [-1, 1]) mutes.push(xform(x, 0.56, s * 1.22, Math.PI / 2));
  g.add(inst(tyreMute, ctx.mat.painted(PAL.truckCab, 0.9, 0), mutes));
  return { obj: g, len: 11.6, wid: 2.87, hgt: 3.40 };
}
```
