/* Lane verification for fences brief. Uses the warm hub server on :5201.
 * Part 1: traverse.mjs ROUTES/door/verge/handedness logic, verbatim.
 * Part 2: lane checks (hole permeability, item colliders, teleport screenshots).
 * Does NOT modify any repo file. Exits nonzero on any failure. */
import { chromium } from 'playwright';

const URL = 'http://localhost:5201/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__NT && window.__NT.stations, undefined,
  { timeout: 180000, polling: 500 });
await page.waitForTimeout(1500);

// ---- Part 1: verbatim traverse logic ------------------------------------
const ROUTES = [
  { name: 'spawnA -> spawnB, west flank',
    pts: [[0, -29], [-13, -27], [-20, -16], [-20, 0], [-20, 16], [-13, 27], [0, 29]] },
  { name: 'spawnA -> spawnB, east flank',
    pts: [[0, -29], [13, -27], [18, -16], [18, -8], [18, 8], [18, 16], [13, 27], [0, 29]] },
  { name: 'spawnA -> cul-de-sac turning head',
    pts: [[0, -29], [13, -27], [16, -16], [16, -8], [20, -1], [26, -0.5]] },
  { name: 'spawnA -> open end of the street',
    pts: [[0, -29], [-13, -27], [-20, -10], [-30, -2], [-44, 0]] },
  { name: 'along the street, open end -> head',
    pts: [[-44, 0], [-24, 0], [-8, 0], [8, 0], [20, 0], [26, 0]] },
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
const doors = await page.evaluate(() => {
  const nt = window.__NT;
  const FRONT = 13.6;
  const BACK = 22.8;
  const scan = (side, wallZ, fromOutside) => {
    const open = [];
    for (let x = -9.5; x <= 9.5; x += 0.5) {
      const startZ = side * (wallZ + (fromOutside ? 2.4 : -2.4));
      const endZ = side * (wallZ - (fromOutside ? 2.6 : -2.6));
      nt.probeReset(x, startZ);
      if (nt.probeWalkTo(x, endZ, 420)) open.push(+x.toFixed(1));
    }
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
const verge = await page.evaluate(() => {
  const nt = window.__NT;
  const scan = (side) => {
    const open = [];
    for (let x = -19; x <= 19; x += 0.5) {
      nt.probeReset(x, side * 11.0);
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
const hand = await page.evaluate(() => window.__NT.stats().handedness);
const programs = await page.evaluate(() => window.__NT.stats().programs);

let bad = 0;
console.log('[traverse] routes:');
for (const r of results) {
  const ok = r.stuck === null;
  if (!ok) bad++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + r.name
    + '  (' + r.reached + '/' + r.legs + ' legs)'
    + (r.stuck ? '  stuck -> ' + JSON.stringify(r.stuck.target)
        + ' at ' + JSON.stringify(r.stuck.at.map((n) => +n.toFixed(1))) : ''));
}
console.log('[traverse] doors: ' + JSON.stringify(doors));
let faceless = 0;
for (const spans of Object.values(doors)) if (!spans.length) faceless++;
const handOk = Array.isArray(hand) && hand.every(Boolean);
console.log('[traverse] handedness: ' + (handOk ? 'PASS' : 'FAIL ' + JSON.stringify(hand)));
let walled = 0;
for (const [k, spans] of Object.entries(verge)) {
  const total = spans.reduce((a, v) => a + (v[1] - v[0]) + 0.5, 0);
  if (total < 8) walled++;
  console.log('[traverse] verge ' + k + ': '
    + (spans.length ? spans.map((v) => v[0] + '..' + v[1]).join(', ') : 'NONE')
    + ' (' + total.toFixed(1) + ' m open)');
}
console.log('[traverse] programs: ' + programs);
console.log('[traverse] ' + (results.length - bad) + '/' + results.length
  + ' routes; ' + (4 - faceless) + '/4 faces enterable');

// ---- Part 2: lane checks -------------------------------------------------
const lane = await page.evaluate(() => {
  const nt = window.__NT;
  const out = {};
  // back-fence holes must let the player through (walk yard -> beyond)
  const holes = [
    ['o-h1', -8.0, -1], ['o-h2', 9.6, -1],
    ['w-h1', -11.6, 1], ['w-h2', 2.8, 1], ['w-h3', 14.4, 1],
  ];
  for (const [k, x, s] of holes) {
    nt.probeReset(x, s * 31.5);
    out[k] = nt.probeWalkTo(x, s * 36.5, 420);
  }
  // solid fence must block
  nt.probeReset(0, -31.5);
  out['o-solid'] = !nt.probeWalkTo(0, -36.5, 420);
  nt.probeReset(8, 31.5);
  out['w-solid'] = !nt.probeWalkTo(8, 36.5, 420);
  // item colliders present (count hits at each placement)
  const spots = {
    'mailbox': [-6.5, -24.14], 'w-crates': [-17.6, 28.96],
    'w-domebin': [10.5, 31.76], 'o-trash': [12.5, -31.4],
    'o-turf': [17.9, -21.5], 'o-hydrant': [-11.5, -32.3],
    'f-barrierW': [-43, 12.5], 'f-pierW': [-39.4, -12.8],
    'f-louvre': [-30, -13], 'f-crates': [-30, 13],
    'f-mound': [32.5, 14], 'f-trefoil': [28.9, 14.8],
    'f-security': [33.1, 17.2], 'f-hydrant': [29.6, -12.9],
    'f-vent': [31.9, -16.9],
  };
  for (const [k, [x, z]] of Object.entries(spots)) {
    const hits = nt.collidersAt(x, z);
    out[k] = Array.isArray(hits) ? hits.length : -1;
  }
  return out;
});
console.log('[lane] ' + JSON.stringify(lane));

// ---- Part 3: teleport screenshots ----------------------------------------
await page.evaluate(() => window.__NT.release());
const shots = [
  ['fencechk-mailbox', -6.5, -27.2, Math.PI, 0],
  ['fencechk-crates', -13.5, 28.96, Math.PI / 2, 0],
  ['fencechk-barrier', -36.5, -12.8, Math.PI / 2, 0],
  ['fencechk-mound', 32.5, 10.5, Math.PI, 0],
];
for (const [name, x, z, yaw, pitch] of shots) {
  await page.evaluate(([sx, sz, sy, sp]) => window.__NT.teleport(sx, 0, sz, sy, sp),
    [x, z, yaw, pitch]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'captures/' + name + '.png' });
  console.log('[shot] captures/' + name + '.png');
}
console.log('PAGEERRORS:' + JSON.stringify(errs.slice(0, 8)));
await browser.close();

const holesOk = ['o-h1', 'o-h2', 'w-h1', 'w-h2', 'w-h3'].every((k) => lane[k] === true)
  && lane['o-solid'] === true && lane['w-solid'] === true;
const itemsOk = Object.entries(lane)
  .filter(([k]) => !k.startsWith('o-h') && !k.startsWith('w-h') && !k.endsWith('solid'))
  .every(([, v]) => v >= 1);
const fail = bad || faceless || walled || !handOk || !holesOk || !itemsOk || errs.length;
console.log('[verify] holesOk=' + holesOk + ' itemsOk=' + itemsOk
  + ' pageErrors=' + errs.length);
process.exit(fail ? 1 : 0);
