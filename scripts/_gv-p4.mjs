// ITEM 5 - mannequin colliders, plus three walk-into tests. Plus two cleaner frames
// of the white -z upper face.
const NT = window.__NT;
const PLACES = [
  [7.680, -10.276, 'orange lawn, stand'],
  [9.728, -10.360, 'orange lawn, armOut'],
  [8.576, -9.688, 'orange lawn, child'],
  [1.280, 12.292, 'white lawn, stand'],
  [2.432, 11.788, 'white lawn, lean'],
  [9.920, 9.520, 'white drive, stand'],
  [-12.400, -5.250, 'bus stop, stand'],
  [-14.388, -5.250, 'bus stop, stand'],
  [-13.394, -5.150, 'bus stop, armsUp'],
  [8.900, 5.850, 'east pavement, armOut'],
  [-5.328, -28.472, 'orange yard, stand'],
  [10.656, -33.152, 'orange yard, fallen'],
  [8.288, 28.680, 'white yard, lean'],
  [-6.512, 35.752, 'white yard, stand'],
];
const rows = PLACES.map(([x, z, why], i) => {
  const hits = NT.collidersAt(x, z, 0.9);
  const mine = hits.filter((h) => h.owner === 'mannequins');
  const exact = mine.filter((h) => x > h.min[0] && x < h.max[0] && z > h.min[2] && z < h.max[2]);
  return { i, x, z, why,
    mannequinHere: mine.length > 0, exactContain: exact.length > 0,
    boxes: mine.map((h) => '#' + h.i + ' x' + h.min[0] + '..' + h.max[0] + ' y' + h.min[1] + '..' + h.max[1] + ' z' + h.min[2] + '..' + h.max[2]),
    otherOwners: [...new Set(hits.filter((h) => h.owner !== 'mannequins').map((h) => h.owner))],
  };
});

// total mannequins-owned colliders anywhere on the map (0.5 m grid, 0.2 m in y)
const all = new Map();
for (let x = -20; x <= 22; x += 0.4) {
  for (let z = -38; z <= 38; z += 0.4) {
    for (let y = 0.25; y <= 2.1; y += 0.2) {
      for (const h of NT.collidersAt(+x.toFixed(2), +z.toFixed(2), +y.toFixed(2))) {
        if (h.owner === 'mannequins') all.set(h.i, h);
      }
    }
  }
}

// walk into three of them from 3 m away and see whether the controller stops short
const targets = [0, 6, 12];
const walks = targets.map((ti) => {
  const [tx, tz] = PLACES[ti];
  const bx = all.get([...all.keys()].find((k) => {
    const h = all.get(k);
    return tx > h.min[0] - 0.05 && tx < h.max[0] + 0.05 && tz > h.min[2] - 0.05 && tz < h.max[2] + 0.05;
  }));
  const from = [tx + 3.0, tz];
  NT.probeReset(from[0], from[1]);
  const p0 = NT.probePos();
  NT.probeWalkTo(tx - 1.2, tz, 600);       // aim PAST the figure
  const p1 = NT.probePos();
  const gap = Math.hypot(p1[0] - tx, p1[2] - tz);
  return { i: ti, from, start: p0.map((v) => +v.toFixed(2)), end: p1.map((v) => +v.toFixed(2)),
    distToFigure: +gap.toFixed(2), passedThrough: p1[0] < tx - 0.3,
    box: bx ? ('#' + bx.i + ' x' + bx.min[0] + '..' + bx.max[0] + ' z' + bx.min[2] + '..' + bx.max[2]) : null };
});

const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
return {
  rows,
  present: rows.filter((r) => r.mannequinHere).length,
  exact: rows.filter((r) => r.exactContain).length,
  totalMannequinColliders: all.size,
  boxes: [...all.values()].map((h) => '#' + h.i + ' x' + h.min[0] + '..' + h.max[0] + ' y' + h.min[1] + '..' + h.max[1] + ' z' + h.min[2] + '..' + h.max[2]),
  walks,
  shots: [
    { name: 'white-negz-face-clean', mode: 'fly', x: -1.0, y: 5.4 - 1.62, z: 13.6,
      yaw: yawTo(-1, 13.6, -1, 22), pitch: -0.02 },
    { name: 'white-negz-face-clean-e', mode: 'fly', x: 4.6, y: 5.4 - 1.62, z: 13.6,
      yaw: yawTo(4.6, 13.6, 2.0, 22), pitch: -0.02 },
  ],
};
