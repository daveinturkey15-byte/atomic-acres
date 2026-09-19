// Final adversarial sweeps: (a) map-wide cross-owner AABB overlaps involving the NEW
// mannequin colliders, (b) anything non-house within 0.30 m of either stair footprint.
const NT = window.__NT;
const seen = new Map();
for (let x = -20; x <= 22; x += 0.4) {
  for (let z = -38.5; z <= 38.5; z += 0.4) {
    for (let y = 0.05; y <= 6.5; y += 0.15) {
      for (const h of NT.collidersAt(+x.toFixed(2), +z.toFixed(2), +y.toFixed(2))) {
        if (!seen.has(h.i)) seen.set(h.i, h);
      }
    }
  }
}
const list = [...seen.values()];
const byOwner = {};
for (const c of list) byOwner[c.owner] = (byOwner[c.owner] || 0) + 1;
const MIN = 0.05;
const pairs = [];
for (let a = 0; a < list.length; a++) {
  for (let b = a + 1; b < list.length; b++) {
    const A = list[a], B = list[b];
    if (A.owner === B.owner) continue;
    const ox = Math.min(A.max[0], B.max[0]) - Math.max(A.min[0], B.min[0]);
    const oy = Math.min(A.max[1], B.max[1]) - Math.max(A.min[1], B.min[1]);
    const oz = Math.min(A.max[2], B.max[2]) - Math.max(A.min[2], B.min[2]);
    if (ox <= MIN || oy <= MIN || oz <= MIN) continue;
    if (A.max[1] <= 0.15 || B.max[1] <= 0.15) continue;
    pairs.push({ a: A.owner + '#' + A.i, b: B.owner + '#' + B.i,
      ov: [+ox.toFixed(2), +oy.toFixed(2), +oz.toFixed(2)],
      box: [[+Math.max(A.min[0], B.min[0]).toFixed(2), +Math.max(A.min[1], B.min[1]).toFixed(2), +Math.max(A.min[2], B.min[2]).toFixed(2)],
            [+Math.min(A.max[0], B.max[0]).toFixed(2), +Math.min(A.max[1], B.max[1]).toFixed(2), +Math.min(A.max[2], B.max[2]).toFixed(2)]] });
  }
}
const manPairs = pairs.filter((p) => p.a.startsWith('mannequins') || p.b.startsWith('mannequins'));

const FP = [
  { n: 'orange', minX: 6.40, maxX: 11.12, minZ: -29.175, maxZ: -27.325, owner: 'orange-house' },
  { n: 'white', minX: -10.97, maxX: -6.40, minZ: 27.325, maxZ: 29.275, owner: 'white-house' },
];
const near = FP.map((f) => {
  const inside = [], within30 = [];
  for (const c of list) {
    if (c.owner === f.owner || c.owner === 'ground') continue;
    if (c.max[1] <= 0.16) continue;
    const ox = Math.min(c.max[0], f.maxX) - Math.max(c.min[0], f.minX);
    const oz = Math.min(c.max[2], f.maxZ) - Math.max(c.min[2], f.minZ);
    const tag = c.owner + '#' + c.i + ' x' + c.min[0] + '..' + c.max[0] + ' y' + c.min[1] + '..' + c.max[1] + ' z' + c.min[2] + '..' + c.max[2];
    if (ox > 0 && oz > 0) inside.push(tag + '  overlap dx=' + ox.toFixed(2) + ' dz=' + oz.toFixed(2));
    else if (ox > -0.30 && oz > -0.30) within30.push(tag + '  gapx=' + (-ox).toFixed(2) + ' gapz=' + (-oz).toFixed(2));
  }
  return { footprint: f.n, inside, within30 };
});
return { total: list.length, byOwner, crossOwnerNonGround: pairs.length, manPairs, allPairs: pairs.slice(0, 40), near };
