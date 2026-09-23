/**
 * Throwaway probe for the white-bedroom hall-door fix (HANDOFF 09:12 follow-up).
 * Floods the upper-floor grid from the white internal stair head twice:
 *   (a) as built - bedroom must be reachable (was already, via green room);
 *   (b) with the green-room corner opening sealed - bedroom reachable ONLY if the
 *       hall doorway walks. Before the fix this was NO (bed collider across it).
 * Prints doorway-cell states too. Exit 0 iff (a) YES and (b) YES.
 * DELETE after use; do not commit.
 */
import { chromium } from 'playwright';
import { usePreview } from './lib/preview.mjs';

const X0 = -22, X1 = 20, Z0 = -42, Z1 = 42, STEP = 0.2, PLAYER_R = 0.42;
const STEP_UP = 0.38, BODY_TOP = 1.7, UP_Y = 3.3;
const SAMPLE_Y = [0.45, 0.8, 1.2, 1.6];

const { url } = await usePreview();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 240000 });
const data = await page.evaluate(([X0, X1, Z0, Z1, STEP, SAMPLE_Y, STEP_UP, BODY_TOP, UP_Y]) => {
  const nt = window.__NT;
  const nx = Math.round((X1 - X0) / STEP), nz = Math.round((Z1 - Z0) / STEP);
  const blocked = new Uint8Array(nx * nz);
  const floorTop = (x, z) => {
    let top = -Infinity;
    for (const py of [UP_Y - 0.1, UP_Y - 0.3, UP_Y - 0.6]) {
      for (const h of nt.collidersAt(x, z, py)) {
        if (x < h.min[0] || x > h.max[0] || z < h.min[2] || z > h.max[2]) continue;
        if (h.max[1] > UP_Y + STEP_UP || h.max[1] < UP_Y - 0.65) continue;
        if (h.max[1] > top) top = h.max[1];
      }
    }
    return top;
  };
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = X0 + ix * STEP, z = Z0 + iz * STEP;
    const base = floorTop(x, z);
    if (base === -Infinity) { blocked[iz * nx + ix] = 1; continue; }
    let solid = 0;
    for (const y of SAMPLE_Y) {
      for (const h of nt.collidersAt(x, z, base + y)) {
        if (x < h.min[0] || x > h.max[0] || z < h.min[2] || z > h.max[2]) continue;
        if (h.max[1] <= base + STEP_UP) continue;
        if (h.min[1] >= base + BODY_TOP) continue;
        solid = 1; break;
      }
      if (solid) break;
    }
    blocked[iz * nx + ix] = solid;
  }
  return { nx, nz, blocked: Array.from(blocked) };
}, [X0, X1, Z0, Z1, STEP, SAMPLE_Y, STEP_UP, BODY_TOP, UP_Y]);
await browser.close();

const { nx, nz } = data;
const blocked = Uint8Array.from(data.blocked);
const r = Math.ceil(PLAYER_R / STEP);
const standable = new Uint8Array(nx * nz);
for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
  let ok = 1;
  for (let dz = -r; dz <= r && ok; dz++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dz * dz > r * r) continue;
    const jx = ix + dx, jz = iz + dz;
    if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
    if (blocked[jz * nx + jx]) { ok = 0; break; }
  }
  standable[iz * nx + ix] = ok;
}
const idx = (x, z) => {
  const ix = Math.round((x - X0) / STEP), iz = Math.round((z - Z0) / STEP);
  return (ix < 0 || iz < 0 || ix >= nx || iz >= nz) ? -1 : iz * nx + ix;
};
function bfs(grid, sx, sz) {
  const s0 = idx(sx, sz);
  const seen = new Uint8Array(grid.length);
  const q = [s0]; seen[s0] = 1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % nx, cz = (c / nx) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const jx = cx + dx, jz = cz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jz * nx + jx;
      if (seen[j] || !grid[j]) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}
// nearest standable cell within 1.2 m, same contract as paths.mjs snapNear
function snapNear(grid, x, z) {
  let best = -1, bestD = 1.2 * 1.2 + 1e-9;
  const ix0 = Math.round((x - X0) / STEP), iz0 = Math.round((z - Z0) / STEP);
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
    const ix = ix0 + dx, iz = iz0 + dz;
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
    const i = iz * nx + ix;
    if (!grid[i]) continue;
    const d = (dx * STEP) ** 2 + (dz * STEP) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
// seal the bedroom<->green-room corner opening (x=BX=-2.4 wall, z 21.9..23.6)
function sealedGrid() {
  const grid = Uint8Array.from(standable);
  for (let z = 21.8; z <= 23.7; z += STEP)
    for (let x = -3.0; x <= -1.8; x += STEP) { const i = idx(x, z); if (i >= 0) grid[i] = 0; }
  return grid;
}
// open bedroom floor east of the rotated bed
const BED_MARK = [-3.4, 23.4];

const plainSeen = bfs(standable, 1.9, 24.6);
const plainT = snapNear(standable, ...BED_MARK);
const plainOk = plainT >= 0 && plainSeen[plainT];
console.log(`[probe] as built: bedroom from stair head: ${plainOk ? 'YES' : 'NO'}`);
const gridS = sealedGrid();
const sealedSeen = bfs(gridS, 1.9, 24.6);
const sealedT = snapNear(gridS, ...BED_MARK);
const sealedOk = sealedT >= 0 && sealedSeen[sealedT];
console.log(`[probe] green opening sealed: bedroom from stair head (hall-door route): ${sealedOk ? 'YES' : 'NO'}`);
for (const [x, z] of [[-3.65, 24.6], [-3.8, 24.2], [-3.8, 23.8], [-3.4, 23.4]]) {
  const i = idx(x, z);
  console.log(`[probe] cell (${x}, ${z}): standable=${i < 0 ? 'OOB' : (standable[i] ? 'free' : 'BLOCKED')} seen-plain=${plainSeen[i] ? 1 : 0} seen-sealed=${sealedSeen[i] ? 1 : 0}`);
}
const ok = plainOk && sealedOk;
console.log(`[probe] ${ok ? 'PASS' : 'FAIL'}: hall-door route ${sealedOk ? 'walks' : 'blocked'}`);
process.exit(ok ? 0 : 1);
