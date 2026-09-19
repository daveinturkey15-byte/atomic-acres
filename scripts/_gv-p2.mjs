// ITEM 3 - external stairs: 11 approach headings per flight, real controller, walk mode.
const NT = window.__NT;
const DECK_Y = 3.15;
const RING = 3.5;
const N = 11;

const HOUSES = [
  { name: 'orange', foot: [10.32, -28.25], head: [6.40, -28.25], deck: [3.40, -28.25],
    land: [10.92, -28.25], fp: { minX: 6.40, maxX: 11.12, minZ: -29.175, maxZ: -27.325 } },
  { name: 'white', foot: [-10.17, 28.30], head: [-6.40, 28.30], deck: [-3.40, 28.30],
    land: [-10.77, 28.30], fp: { minX: -10.97, maxX: -6.40, minZ: 27.325, maxZ: 29.275 } },
];

/** any collider overlapping the 0.6 m capsule box [y 0.30 .. 1.78] at this xz? */
function blockers(x, z) {
  const out = new Map();
  for (let y = 0.30; y <= 1.78; y += 0.1) {
    for (const h of NT.collidersAt(x, z, +y.toFixed(2))) {
      if (x - 0.3 >= h.max[0] || x + 0.3 <= h.min[0]) continue;
      if (z - 0.3 >= h.max[2] || z + 0.3 <= h.min[2]) continue;
      if (h.max[1] <= 0.30 || h.min[1] >= 1.78) continue;
      out.set(h.i, h.owner);
    }
  }
  return [...out.entries()].map(([i, o]) => o + '#' + i);
}

const res = [];
for (const H of HOUSES) {
  const rows = [];
  for (let k = 0; k < N; k++) {
    const th = (k * 2 * Math.PI) / N;
    let sx = H.foot[0] + RING * Math.cos(th);
    let sz = H.foot[1] + RING * Math.sin(th);
    let pushed = 0, bl = blockers(sx, sz);
    while (bl.length && pushed < 3.0) {
      pushed += 0.25; sx += 0.25 * Math.cos(th); sz += 0.25 * Math.sin(th);
      bl = blockers(sx, sz);
    }
    const startClear = bl.length === 0;

    // routed approach: start -> landing past the bottom tread -> deck centre
    NT.probeReset(sx, sz);
    NT.probeWalkTo(H.land[0], H.land[1], 900);
    const atLand = NT.probePos();
    NT.probeWalkTo(H.deck[0], H.deck[1], 1400);
    const end = NT.probePos();

    // control: straight at the deck centre, no waypoint
    NT.probeReset(sx, sz);
    NT.probeWalkTo(H.deck[0], H.deck[1], 2000);
    const endDirect = NT.probePos();

    rows.push({
      k, heading: +th.toFixed(3), start: [+sx.toFixed(2), +sz.toFixed(2)], pushed,
      startClear, startBlockers: bl,
      atLand: atLand.map((v) => +v.toFixed(2)),
      end: end.map((v) => +v.toFixed(2)),
      onDeck: Math.abs(end[1] - DECK_Y) <= 0.1,
      loose: end[1] >= 2.85,
      endDirect: endDirect.map((v) => +v.toFixed(2)),
      onDeckDirect: Math.abs(endDirect[1] - DECK_Y) <= 0.1,
    });
  }
  // what stands inside the flight's own footprint, at tread height
  const inFootprint = new Map();
  for (let x = H.fp.minX; x <= H.fp.maxX + 1e-6; x += 0.1) {
    for (let z = H.fp.minZ; z <= H.fp.maxZ + 1e-6; z += 0.1) {
      for (let y = 0.2; y <= 3.4; y += 0.1) {
        for (const h of NT.collidersAt(+x.toFixed(2), +z.toFixed(2), +y.toFixed(2))) {
          if (x >= h.max[0] || x <= h.min[0]) continue;
          if (z >= h.max[2] || z <= h.min[2]) continue;
          inFootprint.set(h.i, h.owner);
        }
      }
    }
  }
  const owners = {};
  for (const o of inFootprint.values()) owners[o] = (owners[o] || 0) + 1;
  res.push({
    house: H.name,
    onDeck: rows.filter((r) => r.onDeck).length,
    loose285: rows.filter((r) => r.loose).length,
    onDeckDirect: rows.filter((r) => r.onDeckDirect).length,
    startsClear: rows.filter((r) => r.startClear).length,
    footprintOwners: owners,
    rows,
  });
}

// also: where do the stair treads actually live? sample the flight axis.
function axisProfile(z, x0, x1) {
  const out = [];
  const step = x1 > x0 ? 0.2 : -0.2;
  for (let x = x0; step > 0 ? x <= x1 : x >= x1; x += step) {
    let top = 0;
    for (let y = 0.05; y <= 3.4; y += 0.05) {
      for (const h of NT.collidersAt(+x.toFixed(2), z, +y.toFixed(2))) {
        if (x >= h.max[0] || x <= h.min[0]) continue;
        if (z >= h.max[2] || z <= h.min[2]) continue;
        if (h.max[1] > top) top = h.max[1];
      }
    }
    out.push([+x.toFixed(2), +top.toFixed(2)]);
  }
  return out;
}

const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));

return {
  res,
  orangeAxis: axisProfile(-28.25, 5.6, 11.6),
  whiteAxis: axisProfile(28.30, -5.6, -11.6),
  shots: [
    { name: 'stair-orange-from-yard', mode: 'fly', x: 11.6, y: 0.16, z: -33.4,
      yaw: yawTo(11.6, -33.4, 8.6, -28.25), pitch: 0.05 },
    { name: 'stair-orange-side', mode: 'fly', x: 13.6, y: 0.16, z: -28.25,
      yaw: yawTo(13.6, -28.25, 7.0, -28.25), pitch: 0.02 },
    { name: 'stair-orange-foot', mode: 'fly', x: 12.6, y: 0.16, z: -31.0,
      yaw: yawTo(12.6, -31.0, 9.5, -28.4), pitch: 0.0 },
    { name: 'stair-white-from-yard', mode: 'fly', x: -11.6, y: 0.16, z: 33.4,
      yaw: yawTo(-11.6, 33.4, -8.6, 28.3), pitch: 0.05 },
    { name: 'stair-white-side', mode: 'fly', x: -13.6, y: 0.16, z: 28.30,
      yaw: yawTo(-13.6, 28.3, -7.0, 28.3), pitch: 0.02 },
    { name: 'stair-white-foot', mode: 'fly', x: -12.6, y: 0.16, z: 31.0,
      yaw: yawTo(-12.6, 31.0, -9.5, 28.45), pitch: 0.0 },
  ],
};
