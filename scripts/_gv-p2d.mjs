// ITEM 3, protocol sensitivity: identical 11 starts, four route protocols.
const NT = window.__NT;
const DECK_Y = 3.15, RING = 3.5, N = 11;
const HOUSES = [
  { name: 'orange', foot: [10.32, -28.25], land: [10.92, -28.25], deck: [3.40, -28.25],
    out: [11.90, -28.25], zlo: -36.5, zhi: -26.9 },
  { name: 'white', foot: [-10.17, 28.30], land: [-10.77, 28.30], deck: [-3.40, 28.30],
    out: [-11.75, 28.30], zlo: 26.9, zhi: 36.5 },
];
const XLO = -14.3, XHI = 14.3;
function blockers(x, z) {
  const out = new Map();
  for (let y = 0.30; y <= 1.78; y += 0.1) {
    for (const h of NT.collidersAt(x, z, +y.toFixed(2))) {
      if (x - 0.3 >= h.max[0] || x + 0.3 <= h.min[0]) continue;
      if (z - 0.3 >= h.max[2] || z + 0.3 <= h.min[2]) continue;
      if (h.max[1] <= 0.30 || h.min[1] >= 1.78) continue;
      out.set(h.i, h.owner + '#' + h.i);
    }
  }
  return [...out.values()];
}
const inYard = (H, x, z) => x >= XLO && x <= XHI && z >= Math.min(H.zlo, H.zhi) && z <= Math.max(H.zlo, H.zhi);
function pickStart(H, th) {
  const cands = [];
  for (const dr of [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, -0.5, -0.75, 2.0, 2.5]) {
    for (const da of [0, 0.12, -0.12, 0.24, -0.24, 0.36, -0.36]) {
      const r = RING + dr, a = th + da;
      const x = H.foot[0] + r * Math.cos(a), z = H.foot[1] + r * Math.sin(a);
      if (!inYard(H, x, z)) continue;
      cands.push({ x, z, cost: Math.abs(dr) + Math.abs(da) * 6 });
    }
  }
  cands.sort((p, q) => p.cost - q.cost);
  for (const c of cands) if (!blockers(+c.x.toFixed(2), +c.z.toFixed(2)).length)
    return [+c.x.toFixed(2), +c.z.toFixed(2)];
  return [+(H.foot[0] + RING * Math.cos(th)).toFixed(2), +(H.foot[1] + RING * Math.sin(th)).toFixed(2)];
}
function route(H, s, legs) {
  NT.probeReset(s[0], s[1]);
  for (const [tx, tz, n] of legs) NT.probeWalkTo(tx, tz, n);
  const p = NT.probePos();
  return { ok: Math.abs(p[1] - DECK_Y) <= 0.1, end: p.map((v) => +v.toFixed(2)) };
}
const out = [];
for (const H of HOUSES) {
  const P = { A: 0, B: 0, C: 0, D: 0 }, detail = [];
  for (let k = 0; k < N; k++) {
    const th = (k * 2 * Math.PI) / N;
    const s = pickStart(H, th);
    const A = route(H, s, [[...H.deck, 2200]]);                                   // straight at the deck
    const B = route(H, s, [[...H.land, 900], [...H.deck, 1400]]);                 // landing -> deck
    const C = route(H, s, [[...H.land, 700], [...H.foot, 400], [...H.deck, 1400]]); // landing -> foot -> deck
    const D = route(H, s, [[...H.out, 800], [...H.land, 500], [...H.foot, 400], [...H.deck, 1400]]); // outboard gather first
    if (A.ok) P.A++; if (B.ok) P.B++; if (C.ok) P.C++; if (D.ok) P.D++;
    detail.push({ k, s, A: A.ok, B: B.ok, C: C.ok, D: D.ok, endC: C.end, endD: D.end });
  }
  out.push({ house: H.name, counts: P, detail });
}
return { out };
