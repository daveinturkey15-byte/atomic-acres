// ITEM 4 - the white upper floor's -z face, and whether the upper floor leaks.
const NT = window.__NT;
const FLOOR_H = 3.15, UPPER_H = 3.05, EAVE_Y = 6.20;
const H_FRONT = FLOOR_H + UPPER_H * 0.38;     // 4.309
const VOID_Z = 21.922, WALL_T = 0.26;
const FACE_HX = 6.348;
const HEIGHTS = [FLOOR_H + 1.2, H_FRONT + 0.5, EAVE_Y - 0.4];

/** exact AABB containment (no collidersAt pad), white-house colliders only */
function solid(x, y, z, ownerWanted) {
  for (const h of NT.collidersAt(x, z, y)) {
    if (ownerWanted && h.owner !== ownerWanted) continue;
    if (x <= h.min[0] || x >= h.max[0]) continue;
    if (z <= h.min[2] || z >= h.max[2]) continue;
    if (y <= h.min[1] || y >= h.max[1]) continue;
    return h.owner + '#' + h.i;
  }
  return null;
}

// ---- A. the face, at three z planes through the 0.26 m wall, 0.25 m in x
const faceScan = [];
for (const z of [21.70, 21.792, 21.90]) {
  for (const y of HEIGHTS) {
    const gaps = [];
    let n = 0;
    for (let x = -FACE_HX + 0.001; x <= FACE_HX; x += 0.25) {
      n++;
      if (!solid(+x.toFixed(3), +y.toFixed(3), z, 'white-house')) gaps.push(+x.toFixed(2));
    }
    faceScan.push({ z, y: +y.toFixed(3), samples: n, gaps: gaps.length, gapX: gaps.slice(0, 30) });
  }
}

// ---- B. the same but 0.05 m, any owner, and WIDER in x than the claimed face,
//         to catch a face that simply stops short of the floor it is meant to close.
const fineScan = [];
for (const y of HEIGHTS) {
  const gaps = [];
  for (let x = -7.6; x <= 7.6; x += 0.05) {
    const xx = +x.toFixed(2);
    const hit = solid(xx, +y.toFixed(3), 21.792, null);
    if (!hit) gaps.push(xx);
  }
  // contiguous runs
  const runs = [];
  for (const g of gaps) {
    const last = runs[runs.length - 1];
    if (last && Math.abs(g - last[1]) <= 0.051) last[1] = g; else runs.push([g, g]);
  }
  fineScan.push({ y: +y.toFixed(3), gapRuns: runs.map((r) => [r[0], r[1], +(r[1] - r[0] + 0.05).toFixed(2)]) });
}

// ---- C. how wide is the upper FLOOR at the -z edge, versus how wide is the face?
function floorSpan(z) {
  let lo = null, hi = null;
  for (let x = -8.0; x <= 8.0; x += 0.05) {
    const xx = +x.toFixed(2);
    let found = false;
    for (const h of NT.collidersAt(xx, z, FLOOR_H - 0.05)) {
      if (h.owner !== 'white-house') continue;
      if (xx <= h.min[0] || xx >= h.max[0]) continue;
      if (z <= h.min[2] || z >= h.max[2]) continue;
      if (Math.abs(h.max[1] - FLOOR_H) > 0.02) continue;   // a floor slab, top at FLOOR_H
      found = true; break;
    }
    if (found) { if (lo === null) lo = xx; hi = xx; }
  }
  return [lo, hi];
}
const floorEdges = {};
for (const z of [21.95, 22.0, 22.2, 22.5, 23.0]) floorEdges['z' + z] = floorSpan(z);

// ---- D. what is at the aperture height band, across wellX
const apertureBand = [];
for (const y of [3.3, 3.8, 4.2, 4.35]) {
  const row = [];
  for (let x = 0.7; x <= 3.3; x += 0.25) {
    row.push([+x.toFixed(2), solid(+x.toFixed(2), y, 21.792, null) || '-']);
  }
  apertureBand.push({ y, row });
}

// ---- E. 24-heading walk from the landing, walk mode
const LAND = [1.92, 24.30];
NT.probeReset(LAND[0], LAND[1]);            // claims the camera, forces walk
NT.setMode('walk');
const landCheck = (() => {
  NT.teleport(LAND[0], FLOOR_H, LAND[1], 0);
  const p0 = NT.probePos();
  NT.probeWalkTo(LAND[0], LAND[1] + 0.05, 20);
  return { afterTeleport: p0.map((v) => +v.toFixed(2)), settled: NT.probePos().map((v) => +v.toFixed(2)) };
})();

const walks = [];
for (let k = 0; k < 24; k++) {
  const th = (k * 2 * Math.PI) / 24;
  const tx = LAND[0] + 40 * Math.cos(th), tz = LAND[1] + 40 * Math.sin(th);
  NT.teleport(LAND[0], FLOOR_H, LAND[1], 0);
  let dropAt = null, minY = FLOOR_H, trace = [];
  for (let it = 0; it < 70; it++) {
    NT.probeWalkTo(tx, tz, 10);
    const p = NT.probePos();
    if (p[1] < minY) minY = p[1];
    if (!dropAt && p[1] < FLOOR_H - 0.3) dropAt = [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)];
    if (it % 10 === 0) trace.push([+p[0].toFixed(1), +p[1].toFixed(2), +p[2].toFixed(1)]);
    if (p[1] < 0.5) break;
  }
  const end = NT.probePos().map((v) => +v.toFixed(2));
  // internal stairwell box: x 1.12..2.82, z 20.47..23.91 (wellX +/- 0.1, ST_Z0..ST_Z1)
  const viaStair = dropAt
    ? (dropAt[0] > 1.02 && dropAt[0] < 2.92 && dropAt[2] > 20.37 && dropAt[2] < 24.01)
    : null;
  walks.push({ k, th: +th.toFixed(3), end, ground: end[1] < FLOOR_H - 0.3,
    minY: +minY.toFixed(2), dropAt, viaStair, trace });
}

const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));

return {
  constants: { H_FRONT, VOID_Z, WALL_T, FACE_HX, HEIGHTS },
  faceScan, fineScan, floorEdges, apertureBand, landCheck,
  groundedHeadings: walks.filter((w) => w.ground).length,
  viaStairCount: walks.filter((w) => w.ground && w.viaStair).length,
  otherExits: walks.filter((w) => w.ground && !w.viaStair),
  walks,
  shots: [
    { name: 'white-from-plaza', mode: 'fly', x: -17.5, y: 2.2, z: 6.0,
      yaw: yawTo(-17.5, 6.0, -2.0, 22.0), pitch: 0.12 },
    { name: 'white-negz-face-street', mode: 'fly', x: -1.0, y: 1.6, z: 8.0,
      yaw: yawTo(-1.0, 8.0, -1.0, 22.0), pitch: 0.22 },
    { name: 'white-negz-face-east', mode: 'fly', x: 9.0, y: 2.0, z: 9.0,
      yaw: yawTo(9.0, 9.0, 0.0, 22.0), pitch: 0.16 },
    { name: 'white-landing-negz', mode: 'fly', x: 1.92, y: FLOOR_H + 1.6 - 1.62, z: 24.30,
      yaw: yawTo(1.92, 24.30, 1.92, 18.0), pitch: -0.05 },
    { name: 'white-landing-negz-wide', mode: 'fly', x: 3.6, y: FLOOR_H + 1.6 - 1.62, z: 25.2,
      yaw: yawTo(3.6, 25.2, 0.0, 21.0), pitch: -0.04 },
  ],
};
