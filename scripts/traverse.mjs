/**
 * Traversability probe.
 *
 * A map that photographs well and cannot be walked is not a map. This drives the real
 * player controller (not a raycast approximation) along a set of routes a player must
 * be able to take, and reports where it gets stuck.
 *
 *   node scripts/traverse.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on('error', rej);
  });
}

// 60 s was not enough with sibling build lanes saturating the CPU: the harness
// reported 'server never came up' for a server that was merely slow to start,
// which reads as a map failure rather than a busy machine.
async function waitForServer(url, ms = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const port = await freePort();
const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
);
const url = 'http://localhost:' + port + '/';
if (!await waitForServer(url)) {
  console.error('[traverse] server never came up');
  server.kill();
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.waitForTimeout(600);

/**
 * Routes a player must be able to walk. Waypoints are world x/z and must stay OUT of
 * the house footprints - going around is the player's normal path; going through needs
 * a door, which the door scan below locates rather than assumes.
 */
const ROUTES = [
  // Waypoints READ from the built collision world (scripts/_spans.mjs prints the open
  // x-spans at a set of z), not guessed from the dimension table. Every previous route
  // set on this project was written from what the map was supposed to be, so it failed
  // for two different reasons at once - a real seal, and a waypoint in a flowerbed -
  // and the two were indistinguishable in the output.
  //
  // Geometry after the 2026-09-18 re-proportioning: yards x -13.2..13.2, z +/-26.6..37,
  // main block x -6.4..6.4, each garage wing on its own end out to +/-11.2.
  { name: 'spawnA -> spawnB, east flank (the long way round)',
    pts: [[-4, -34], [0, -33], [0, -30], [4.5, -28], [10, -28], [12.2, -22],
          [12.2, -10], [12.2, 6], [12.2, 20], [12.2, 27.5], [10.5, 30], [7.5, 33], [1.2, 34.3]] },
  { name: 'spawnA -> the central circle, west side',
    pts: [[-4, -34], [-6, -32], [-11, -30], [-12.2, -28], [-12.2, -24], [-9, -21.8]] },
  { name: 'circle -> west road stem',
    pts: [[-8, -2], [-12, -1], [-16, -1], [-17.5, -1]] },
  { name: 'circle -> east apron',
    pts: [[8, -2], [12, -2], [15, -2]] },
  { name: 'street crossing, orange lawn -> white lawn',
    pts: [[-8, -8], [-10, -4], [-10, 4], [-8, 8], [-4, 10]] },
];

const results = await page.evaluate(async (routes) => {
  const nt = window.__NT;
  const out = [];
  for (const route of routes) {
    nt.probeReset(route.pts[0][0], route.pts[0][1]);
    let stuck = null;
    let reached = 0;
    for (let i = 1; i < route.pts.length; i++) {
      const [tx, tz] = route.pts[i];
      if (!nt.probeWalkTo(tx, tz, 1400)) {
        stuck = { target: [tx, tz], at: nt.probePos() };
        break;
      }
      reached = i;
    }
    out.push({ name: route.name, reached, legs: route.pts.length - 1, stuck });
  }
  return out;
}, ROUTES);

/**
 * Door scan. Walk at the wall from 2 m out, at 0.5 m intervals along it, and record
 * every x that gets through. This finds the doors instead of assuming where they are,
 * and it fails loudly if a house has no way in at all.
 */
const doors = await page.evaluate(() => {
  const nt = window.__NT;
  const FRONT = 15.4;   // FRONT_LAWN_OUTER
  const BACK = 26.6;    // HOUSE_BACK
  const scan = (side, wallZ, fromOutside) => {
    const open = [];
    for (let x = -6.2; x <= 6.2; x += 0.4) {
      const startZ = side * (wallZ + (fromOutside ? 2.4 : -2.4));
      const endZ = side * (wallZ - (fromOutside ? 2.6 : -2.6));
      nt.probeReset(x, startZ);
      if (nt.probeWalkTo(x, endZ, 420)) open.push(+x.toFixed(1));
    }
    // collapse consecutive hits into spans
    const spans = [];
    for (const v of open) {
      const last = spans[spans.length - 1];
      if (last && Math.abs(v - last[1]) < 0.75) last[1] = v;
      else spans.push([v, v]);
    }
    return spans;
  };
  return {
    orangeStreet: scan(-1, FRONT, true),
    orangeYard: scan(-1, BACK, false),
    whiteStreet: scan(1, FRONT, true),
    whiteYard: scan(1, BACK, false),
  };
});

/**
 * Verge scan. A continuous hedge along a front lawn would wall a team into its own
 * half without any single collider looking wrong. Walk lawn -> street at intervals
 * and report where the boundary is actually permeable.
 */
const verge = await page.evaluate(() => {
  const nt = window.__NT;
  const scan = (side) => {
    const open = [];
    for (let x = -13; x <= 13; x += 0.5) {
      nt.probeReset(x, side * 12.5);
      if (nt.probeWalkTo(x, side * 5.5, 420)) open.push(+x.toFixed(1));
    }
    const spans = [];
    for (const v of open) {
      const last = spans[spans.length - 1];
      if (last && Math.abs(v - last[1]) < 0.75) last[1] = v;
      else spans.push([v, v]);
    }
    return spans;
  };
  return { orangeVerge: scan(-1), whiteVerge: scan(1) };
});

// the one invariant, read from the running scene rather than re-derived here
const hand = await page.evaluate(() => window.__NT.stats().handedness);

await browser.close();
server.kill();

let bad = 0;
console.log('[traverse] routes:');
for (const r of results) {
  const ok = r.stuck === null;
  if (!ok) bad++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + r.name
    + '  (' + r.reached + '/' + r.legs + ' legs)'
    + (r.stuck ? '  stuck heading to ' + JSON.stringify(r.stuck.target)
        + ' at ' + JSON.stringify(r.stuck.at.map((n) => +n.toFixed(1))) : ''));
}

console.log('\n[traverse] door scan - x spans where the player got through the wall:');
let faceless = 0;
for (const [k, spans] of Object.entries(doors)) {
  if (!spans.length) faceless++;
  const txt = spans.length
    ? spans.map((v) => (v[0] === v[1] ? String(v[0]) : v[0] + '..' + v[1])).join(',  ')
    : 'NONE - no way through this face';
  console.log('  ' + k.padEnd(14) + txt);
}

const handOk = Array.isArray(hand) && hand.every(Boolean);
console.log('\n[traverse] invariant - garage on the RIGHT from both back yards: '
  + (handOk ? 'PASS' : 'FAIL ' + JSON.stringify(hand)));

console.log('\n[traverse] verge scan - x spans where lawn -> street is passable:');
let walled = 0;
for (const [k, spans] of Object.entries(verge)) {
  const total = spans.reduce((a, v) => a + (v[1] - v[0]) + 0.5, 0);
  if (total < 8) walled++;
  console.log('  ' + k.padEnd(14) + (spans.length
    ? spans.map((v) => v[0] + '..' + v[1]).join(',  ') + '   (' + total.toFixed(1) + ' m open)'
    : 'NONE - this team is walled into its own half'));
}

console.log('\n[traverse] ' + (results.length - bad) + '/' + results.length
  + ' routes passed;  ' + (4 - faceless) + '/4 house faces enterable');
process.exit(bad || faceless || walled || !handOk ? 1 : 0);
