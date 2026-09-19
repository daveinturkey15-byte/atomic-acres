// ITEM 2 - collider ownership sweep + exact pairwise AABB overlap.
const NT = window.__NT;
const t0 = performance.now();
const seen = new Map();   // index -> {owner,min,max}

function collect(x, z, y) {
  const hits = NT.collidersAt(x, z, y);
  for (const h of hits) if (!seen.has(h.i)) seen.set(h.i, h);
}

// --- the sweep the brief asks for: 0.25 m grid, 12 heights 0.1 .. 6.0
const H12 = [];
for (let k = 0; k < 12; k++) H12.push(+(0.1 + k * (5.9 / 11)).toFixed(3));
let calls = 0;
for (const y of H12) {
  for (let x = -14.8; x <= 14.8001; x += 0.25) {
    for (let az = 26.6; az <= 37.0001; az += 0.25) {
      collect(+x.toFixed(3), +az.toFixed(3), y); collect(+x.toFixed(3), -az.toFixed(3), y); calls += 2;
    }
  }
  for (let x = -12.6; x <= 12.6001; x += 0.25) {
    for (let az = 13.0; az <= 26.6001; az += 0.25) {
      collect(+x.toFixed(3), +az.toFixed(3), y); collect(+x.toFixed(3), -az.toFixed(3), y); calls += 2;
    }
  }
}
const afterBrief = seen.size;

// --- adversarial top-up: same xz regions at 0.5 m (the 0.35 m pad guarantees every
// AABB is hit in xz) but y every 0.05 m, so a collider thinner than the 12-level
// spacing cannot hide from the overlap test.
for (let y = 0.025; y <= 6.6; y += 0.05) {
  const yy = +y.toFixed(3);
  for (let x = -14.8; x <= 14.8001; x += 0.5) {
    for (let az = 26.6; az <= 37.0001; az += 0.5) {
      collect(+x.toFixed(3), +az.toFixed(3), yy); collect(+x.toFixed(3), -az.toFixed(3), yy); calls += 2;
    }
  }
  for (let x = -12.6; x <= 12.6001; x += 0.5) {
    for (let az = 13.0; az <= 26.6001; az += 0.5) {
      collect(+x.toFixed(3), +az.toFixed(3), yy); collect(+x.toFixed(3), -az.toFixed(3), yy); calls += 2;
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
    const exemptA = A.max[1] <= 0.15, exemptB = B.max[1] <= 0.15;
    pairs.push({
      a: A.owner, b: B.owner, ai: A.i, bi: B.i,
      ov: [+ox.toFixed(3), +oy.toFixed(3), +oz.toFixed(3)],
      box: [
        [+Math.max(A.min[0], B.min[0]).toFixed(2), +Math.max(A.min[1], B.min[1]).toFixed(2), +Math.max(A.min[2], B.min[2]).toFixed(2)],
        [+Math.min(A.max[0], B.max[0]).toFixed(2), +Math.min(A.max[1], B.max[1]).toFixed(2), +Math.min(A.max[2], B.max[2]).toFixed(2)],
      ],
      A: [A.min, A.max], B: [B.min, B.max],
      exempt: exemptA || exemptB,
    });
  }
}
const yardsVsHouse = pairs.filter((p) => {
  const o = [p.a, p.b];
  return !p.exempt && o.includes('yards') && (o.includes('orange-house') || o.includes('white-house'));
});
pairs.sort((p, q) => (q.ov[0] * q.ov[1] * q.ov[2]) - (p.ov[0] * p.ov[1] * p.ov[2]));

return {
  colliderCount: NT.colliderCount, stats_colliders: NT.stats().colliders,
  calls, enumerated: list.length, afterBriefSweep: afterBrief,
  ms: Math.round(performance.now() - t0),
  byOwner,
  crossOwnerPairs: pairs.length,
  crossOwnerNonExempt: pairs.filter((p) => !p.exempt).length,
  yardsVsHouseFails: yardsVsHouse.length,
  yardsVsHouse: yardsVsHouse.slice(0, 40),
  top: pairs.filter((p) => !p.exempt).slice(0, 30),
};
