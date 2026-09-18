/**
 * Connectivity instrument.
 *
 * `traverse.mjs` walks straight lines between hand-written waypoints. That conflates
 * two completely different failures: "the map is sealed" and "I picked a waypoint
 * inside a flowerbed". Every layout argument on this project has cost hours to the
 * second one masquerading as the first.
 *
 * This asks the only question that matters instead: from where you spawn, what can you
 * actually reach? It builds the collision world as an occupancy grid, erodes it by the
 * player's radius (so a 0.5 m slot between two crates is correctly impassable), floods
 * from each spawn, and reports which landmarks are in the flooded region - and for the
 * ones that are, the actual path.
 *
 * Reachable-but-awkward is a design question. Unreachable is a bug. Only this can tell
 * them apart.
 *
 *   node scripts/paths.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const X0 = -22, X1 = 20, Z0 = -42, Z1 = 42;
const STEP = 0.2;                 // grid pitch, metres
const PLAYER_R = 0.42;            // erode by this; matches the controller's capsule
// A single sample height is wrong in both directions. Sampling only at 1.0 m calls a
// 0.9 m counter walkable (it is not - STEP_UP in player.ts is 0.38 m) and a kerb a
// wall. Block a cell if anything occupies the band between what the player can step
// onto and the top of their body.
const STEP_UP = 0.38;             // must match src/core/player.ts
const BODY_TOP = 1.7;
const SAMPLE_Y = [0.45, 0.8, 1.2, 1.6];

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
async function waitForServer(url, ms = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const port = await freePort();
// windowsHide: node defaults it to FALSE, and with shell:true on Windows every
// one of these spawns a visible cmd.exe window. Running captures in a loop put
// console windows over the owner's screen and stole his keyboard focus.
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
const url = 'http://localhost:' + port + '/';
if (!await waitForServer(url)) { console.error('[paths] server never came up'); server.kill(); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 240000 });

const data = await page.evaluate(([X0, X1, Z0, Z1, STEP, SAMPLE_Y, STEP_UP, BODY_TOP]) => {
  const nt = window.__NT;
  const nx = Math.round((X1 - X0) / STEP);
  const nz = Math.round((Z1 - Z0) / STEP);
  const blocked = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      // collidersAt() pads by 0.35 m on x/z, so query the raw AABBs would be better;
      // instead undo the pad by requiring the point to be INSIDE a hit's bounds.
      const x = X0 + ix * STEP, z = Z0 + iz * STEP;
      let solid = 0;
      for (const y of SAMPLE_Y) {
        for (const h of nt.collidersAt(x, z, y)) {
          // collidersAt() pads by 0.35 m on x/z, so require the point to be genuinely
          // inside the AABB, and the AABB to reach above what the player can step onto.
          if (x < h.min[0] || x > h.max[0] || z < h.min[2] || z > h.max[2]) continue;
          if (h.max[1] <= STEP_UP) continue;          // a kerb: walk straight over it
          if (h.min[1] >= BODY_TOP) continue;         // a canopy: walk straight under it
          solid = 1; break;
        }
        if (solid) break;
      }
      blocked[iz * nx + ix] = solid;
    }
  }
  return { nx, nz, blocked: Array.from(blocked) };
}, [X0, X1, Z0, Z1, STEP, SAMPLE_Y, STEP_UP, BODY_TOP]);

await browser.close();
server.kill();

const { nx, nz } = data;
const blocked = Uint8Array.from(data.blocked);

// --- erode by the player radius: a cell is standable only if every cell within
//     PLAYER_R of it is clear. This is what turns "there is a gap" into "you fit".
const r = Math.ceil(PLAYER_R / STEP);
const standable = new Uint8Array(nx * nz);
for (let iz = 0; iz < nz; iz++) {
  for (let ix = 0; ix < nx; ix++) {
    let ok = 1;
    for (let dz = -r; dz <= r && ok; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        if (blocked[jz * nx + jx]) { ok = 0; break; }
      }
    }
    standable[iz * nx + ix] = ok;
  }
}

const idx = (x, z) => {
  const ix = Math.round((x - X0) / STEP), iz = Math.round((z - Z0) / STEP);
  return (ix < 0 || iz < 0 || ix >= nx || iz >= nz) ? -1 : iz * nx + ix;
};
const xyOf = (i) => [X0 + (i % nx) * STEP, Z0 + Math.floor(i / nx) * STEP];

/** nearest standable cell to a world point, so a landmark 20 cm inside a wall still works */
function snap(x, z) {
  const want = idx(x, z);
  if (want >= 0 && standable[want]) return want;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < standable.length; i++) {
    if (!standable[i]) continue;
    const [cx, cz] = xyOf(i);
    const d = (cx - x) ** 2 + (cz - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function bfs(from) {
  const prev = new Int32Array(standable.length).fill(-1);
  const seen = new Uint8Array(standable.length);
  const q = [from]; seen[from] = 1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % nx, cz = (c / nx) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const jx = cx + dx, jz = cz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jz * nx + jx;
      if (seen[j] || !standable[j]) continue;
      seen[j] = 1; prev[j] = c; q.push(j);
    }
  }
  return { seen, prev };
}

const LANDMARKS = [
  ['spawn A (orange yard)', -4.0, -34.3],
  ['spawn B (white yard)', 1.2, 34.3],
  ['turning circle centre', 0, 0],
  ['orange front door', 1.54, -14.0],
  ['orange back door', -2.05, -28.0],
  ['white front door', -1.02, 14.0],
  ['white back door', 1.66, 28.0],
  ['orange house interior', 1.54, -21.0],
  ['white house interior', -1.02, 21.0],
  ['west road stem', -17.5, 0],
  ['east apron', 15.0, 0],
  ['orange east flank', 12.2, -20],
  ['orange west flank', -12.2, -20],
  ['white east flank', 12.2, 20],
  ['white west flank', -12.2, 20],
];

const start = snap(-4.0, -34.3);
const { seen, prev } = bfs(start);

const total = standable.reduce((a, v) => a + v, 0);
const reached = seen.reduce((a, v) => a + v, 0);
console.log(`[paths] grid ${nx}x${nz} @ ${STEP} m, player radius ${PLAYER_R} m`);
console.log(`[paths] ${total} standable cells; ${reached} reachable from spawn A `
  + `(${(100 * reached / total).toFixed(1)}%)`);
console.log('\n[paths] reachable from SPAWN A:');
let unreachable = 0;
for (const [name, x, z] of LANDMARKS) {
  const t = snap(x, z);
  const ok = t >= 0 && seen[t];
  if (!ok) unreachable++;
  const [sx, sz] = t >= 0 ? xyOf(t) : [NaN, NaN];
  let steps = 0;
  if (ok) { for (let c = t; c !== start && c !== -1; c = prev[c]) steps++; }
  console.log('  ' + (ok ? 'YES' : 'NO ') + '  ' + name.padEnd(24)
    + ` (nearest standable ${sx.toFixed(1)}, ${sz.toFixed(1)})`
    + (ok ? `  ~${(steps * STEP).toFixed(0)} m` : ''));
}

/** compress a cell chain into ~n waypoints traverse.mjs can walk */
function waypoints(goal, n = 10) {
  if (!seen[goal]) return null;
  const chain = [];
  for (let c = goal; c !== -1; c = prev[c]) chain.push(c);
  chain.reverse();
  const out = [];
  const stride = Math.max(1, Math.floor(chain.length / n));
  for (let i = 0; i < chain.length; i += stride) {
    const [x, z] = xyOf(chain[i]);
    out.push([+x.toFixed(1), +z.toFixed(1)]);
  }
  const [gx, gz] = xyOf(goal);
  out.push([+gx.toFixed(1), +gz.toFixed(1)]);
  return out;
}

console.log('');
console.log('[paths] waypoint sets (paste into traverse.mjs ROUTES):');
for (const [name, x, z] of LANDMARKS.slice(1)) {
  const w = waypoints(snap(x, z), 8);
  if (w) console.log('  ' + name.padEnd(24) + JSON.stringify(w));
}

// the actual spawn-to-spawn path, as waypoints traverse.mjs could use
const goal = snap(1.2, 34.3);
if (seen[goal]) {
  const chain = [];
  for (let c = goal; c !== -1; c = prev[c]) chain.push(c);
  chain.reverse();
  const pts = [];
  for (let i = 0; i < chain.length; i += Math.max(1, Math.floor(chain.length / 12))) {
    const [x, z] = xyOf(chain[i]);
    pts.push([+x.toFixed(1), +z.toFixed(1)]);
  }
  const [gx, gz] = xyOf(goal);
  pts.push([+gx.toFixed(1), +gz.toFixed(1)]);
  console.log('\n[paths] spawn A -> spawn B, a path that exists:');
  console.log('  ' + JSON.stringify(pts));
}

// write the flood as an image so the shape of any sealed pocket is visible
const W = nx, H = nz;
const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  const o = i * 3;
  if (!standable[i]) { px[o] = 24; px[o + 1] = 24; px[o + 2] = 28; }
  else if (seen[i]) { px[o] = 70; px[o + 1] = 190; px[o + 2] = 110; }
  else { px[o] = 210; px[o + 1] = 70; px[o + 2] = 60; }   // standable but SEALED OFF
}
mkdirSync(join(ROOT, 'captures'), { recursive: true });
writeFileSync(join(ROOT, 'captures/paths.ppm'),
  Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), px]));
console.log('\n[paths] wrote captures/paths.ppm  (green = reachable, red = standable but sealed off)');
process.exit(unreachable ? 1 : 0);
