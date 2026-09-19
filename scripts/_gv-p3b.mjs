// ITEM 4 follow-up: clear elevated frames of the white -z upper face, and a
// see-through / shoot-through test of the one aperture the builder admits to.
const NT = window.__NT;
const solidAt = (x, y, z) => {
  const hits = [];
  for (const h of NT.collidersAt(x, z, y)) {
    if (x <= h.min[0] || x >= h.max[0]) continue;
    if (z <= h.min[2] || z >= h.max[2]) continue;
    if (y <= h.min[1] || y >= h.max[1]) continue;
    hits.push(h.owner + '#' + h.i + ' z' + h.min[2] + '..' + h.max[2]);
  }
  return hits;
};
// march -z along the stairwell aperture line at several heights: is anything solid
// between the upper floor edge (21.92) and the street (z 7)?
const rays = [];
for (const x of [1.45, 1.92, 2.4, 2.7]) {
  for (const y of [3.3, 3.6, 4.0, 4.25]) {
    const hitsAt = [];
    for (let z = 21.85; z >= 7.0; z -= 0.05) {
      const h = solidAt(x, y, +z.toFixed(2));
      if (h.length) { hitsAt.push([+z.toFixed(2), h[0]]); z -= 0.35; }
      if (hitsAt.length >= 4) break;
    }
    rays.push({ x, y, firstSolids: hitsAt });
  }
}
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
return {
  rays,
  shots: [
    { name: 'white-negz-face-high', mode: 'fly', x: 0.0, y: 7.4 - 1.62, z: 2.0,
      yaw: yawTo(0, 2, 0, 22), pitch: -0.06 },
    { name: 'white-negz-face-high-w', mode: 'fly', x: -5.0, y: 7.4 - 1.62, z: 3.0,
      yaw: yawTo(-5, 3, -1.5, 22), pitch: -0.05 },
    { name: 'white-negz-face-high-e', mode: 'fly', x: 6.0, y: 7.4 - 1.62, z: 3.0,
      yaw: yawTo(6, 3, 1.5, 22), pitch: -0.05 },
    { name: 'white-upper-from-deckside', mode: 'fly', x: -4.0, y: 5.6 - 1.62, z: 31.5,
      yaw: yawTo(-4, 31.5, -1.0, 25.0), pitch: -0.02 },
  ],
};
