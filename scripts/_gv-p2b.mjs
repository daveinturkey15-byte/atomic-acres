// Diagnose what stands between the back-yard ring and each flight's foot.
const NT = window.__NT;
function at(x, z) {
  const out = new Map();
  for (let y = 0.30; y <= 2.2; y += 0.1) {
    for (const h of NT.collidersAt(x, z, +y.toFixed(2))) {
      if (x - 0.3 >= h.max[0] || x + 0.3 <= h.min[0]) continue;
      if (z - 0.3 >= h.max[2] || z + 0.3 <= h.min[2]) continue;
      if (h.max[1] <= 0.30) continue;
      out.set(h.i, h.owner + '#' + h.i + ' ' + JSON.stringify(h.min) + '..' + JSON.stringify(h.max));
    }
  }
  return [...out.values()];
}
// all non-ground colliders in each back yard above 0.3 m, by owner
function census(zmin, zmax) {
  const seen = new Map();
  for (let x = -14.8; x <= 14.8; x += 0.2) {
    for (let z = zmin; z <= zmax; z += 0.2) {
      for (let y = 0.35; y <= 2.5; y += 0.15) {
        for (const h of NT.collidersAt(+x.toFixed(2), +z.toFixed(2), +y.toFixed(2))) {
          if (h.max[1] <= 0.3) continue;
          if (!seen.has(h.i)) seen.set(h.i, h);
        }
      }
    }
  }
  return [...seen.values()]
    .filter((h) => h.owner === 'yards' || h.owner === 'mannequins' || h.owner === 'vehicles')
    .map((h) => h.owner + '#' + h.i + ' x' + h.min[0] + '..' + h.max[0] + ' z' + h.min[2] + '..' + h.max[2] + ' y' + h.min[1] + '..' + h.max[1]);
}
return {
  orange_10_9__30_4: at(10.9, -30.4),
  orange_10_8__30_9: at(10.8, -30.9),
  orange_11_2__30_1: at(11.2, -30.1),
  orange_13_2__30_2: at(13.25, -30.17),
  white_m11_32: at(-11.0, 32.0),
  white_m10_9_31: at(-10.9, 31.0),
  white_m7_5_34_2: at(-7.47, 34.21),
  white_m10_7_31_8: at(-10.67, 31.76),
  orangeYardProps: census(-37.0, -26.6),
  whiteYardProps: census(26.6, 37.0),
};
