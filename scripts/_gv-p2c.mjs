// ITEM 3, second pass - same 11 headings, but (a) start points kept INSIDE the yard
// and chosen as the nearest clear point to the nominal ring position, and (b) if the
// straight two-leg approach fails, a mechanical 3-leg retry through each clear gather
// point on a 2.5 m ring round the landing. Reports both numbers.
const NT = window.__NT;
const DECK_Y = 3.15;
const RING = 3.5, N = 11;

const HOUSES = [
  { name: 'orange', foot: [10.32, -28.25], land: [10.92, -28.25], deck: [3.40, -28.25],
    zlo: -36.5, zhi: -26.9 },
  { name: 'white', foot: [-10.17, 28.30], land: [-10.77, 28.30], deck: [-3.40, 28.30],
    zlo: 26.9, zhi: 36.5 },
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
const inYard = (H, x, z) => x >= XLO && x <= XHI
  && z >= Math.min(H.zlo, H.zhi) && z <= Math.max(H.zlo, H.zhi);

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
  for (const c of cands) {
    const bl = blockers(+c.x.toFixed(2), +c.z.toFixed(2));
    if (!bl.length) return { x: +c.x.toFixed(2), z: +c.z.toFixed(2), cost: +c.cost.toFixed(2), clear: true };
  }
  const x = H.foot[0] + RING * Math.cos(th), z = H.foot[1] + RING * Math.sin(th);
  return { x: +x.toFixed(2), z: +z.toFixed(2), cost: -1, clear: false, bl: blockers(+x.toFixed(2), +z.toFixed(2)) };
}

function run(H, s, gather) {
  NT.probeReset(s.x, s.z);
  if (gather) NT.probeWalkTo(gather[0], gather[1], 700);
  NT.probeWalkTo(H.land[0], H.land[1], 900);
  NT.probeWalkTo(H.deck[0], H.deck[1], 1400);
  const p = NT.probePos();
  return { end: p.map((v) => +v.toFixed(2)), ok: Math.abs(p[1] - DECK_Y) <= 0.1 };
}

const out = [];
for (const H of HOUSES) {
  const gathers = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * 2 * Math.PI) / 8;
    const gx = H.land[0] + 2.5 * Math.cos(a), gz = H.land[1] + 2.5 * Math.sin(a);
    if (!inYard(H, gx, gz)) continue;
    if (blockers(+gx.toFixed(2), +gz.toFixed(2)).length) continue;
    gathers.push([+gx.toFixed(2), +gz.toFixed(2)]);
  }
  const rows = [];
  for (let k = 0; k < N; k++) {
    const th = (k * 2 * Math.PI) / N;
    const s = pickStart(H, th);
    const direct = run(H, s, null);
    let via = null, viaRes = null;
    if (!direct.ok) {
      for (const g of gathers) {
        const r = run(H, s, g);
        if (r.ok) { via = g; viaRes = r; break; }
        if (!viaRes) viaRes = r;
      }
    }
    rows.push({ k, th: +th.toFixed(3), start: [s.x, s.z], startClear: s.clear, startCost: s.cost,
      startBlockers: s.bl || [], direct: direct.end, directOk: direct.ok,
      via, viaOk: !!via, viaEnd: viaRes ? viaRes.end : null });
  }
  out.push({ house: H.name, gathers,
    directOnDeck: rows.filter((r) => r.directOk).length,
    anyOnDeck: rows.filter((r) => r.directOk || r.viaOk).length,
    startsClear: rows.filter((r) => r.startClear).length, rows });
}
return { out };
