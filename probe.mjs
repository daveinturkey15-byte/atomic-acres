// Throwaway: project every mannequin's head + outstretched hand into the
// capture stations to test the critic's item-2 claims as screen-space reads.
const D = Math.PI / 180;
// ---- layout consts (copied from src/core/layout.ts)
const ROAD_HALF_WIDTH = 4.6, KERB_HEIGHT = 0.14, KERB_WIDTH = 0.3;
const PAVEMENT_OUTER = 7.2, ROAD_X_MIN = -52, ROAD_X_MAX = 17.0;
const HEAD_CENTER_X = 26.0, HEAD_RADIUS = 9.6;
const FRONT_LAWN_OUTER = 13.6, HOUSE_DEPTH = 9.2, HOUSE_BACK = 22.8, HOUSE_HALF_LEN = 9.6;
const BACK_FENCE = 34.0, YARD_X_MIN = -20, YARD_X_MAX = 20;
const ORANGE = { side: -1, garageEnd: -1, deckX: 3.6 };
const WHITE = { side: 1, garageEnd: 1, deckX: -3.6 };
const HOUSES = [ORANGE, WHITE];
const Y_APRON = 0, Y_ROAD = 0.030, Y_HEAD = 0.044;
const Y_ARC = KERB_HEIGHT - 0.002, Y_PAVE = KERB_HEIGHT, Y_LAWN = KERB_HEIGHT + 0.001;
const PAVE_MID = (ROAD_HALF_WIDTH + KERB_WIDTH + PAVEMENT_OUTER) / 2;
const KERB_EDGE = ROAD_HALF_WIDTH + KERB_WIDTH + 0.45;
const RING_R = HEAD_RADIUS + KERB_WIDTH + 1.1;
const yx = (t) => YARD_X_MIN + t * (YARD_X_MAX - YARD_X_MIN);
const yz = (h, t) => h.side * (HOUSE_BACK + t * (BACK_FENCE - HOUSE_BACK));
const fz = (h, t) => h.side * (PAVEMENT_OUTER + t * (FRONT_LAWN_OUTER - PAVEMENT_OUTER));
const hx = (t) => t * HOUSE_HALF_LEN;
const stx = (t) => ROAD_X_MIN + t * (ROAD_X_MAX - ROAD_X_MIN);
const ringX = (a) => HEAD_CENTER_X + Math.cos(a) * RING_R;
const ringZ = (a) => Math.sin(a) * RING_R;
const O = ORANGE, W = WHITE;
// ---- PLACES (copied from src/build/mannequins.ts)
const PLACES = [
  [hx(0.05), fz(O, 0.28), Y_LAWN, 2.9, 'stand', -1],
  [hx(0.30), fz(O, 0.50), Y_LAWN, 3.6, 'armOut', -1],
  [hx(-0.88), fz(O, 0.35), Y_LAWN, 2.2, 'lean', -1],
  [hx(-0.62), O.side * PAVE_MID, Y_PAVE, Math.PI, 'stand', 0],
  [hx(-0.30), O.side * KERB_EDGE, Y_PAVE, 2.1, 'armsUp', -1],
  [hx(-0.10), fz(W, 0.40), Y_LAWN, 0.3, 'stand', -1],
  [hx(-0.42), fz(W, 0.62), Y_LAWN, 0.9, 'lean', -1],
  [hx(0.72), fz(W, 0.24), Y_LAWN, -0.4, 'sit', -1],
  [hx(0.15), W.side * PAVE_MID, Y_PAVE, 0.1, 'armOut', -1],
  [hx(-0.85), W.side * KERB_EDGE, Y_PAVE, -0.7, 'stand', -1],
  [stx(0.50), O.side * ROAD_HALF_WIDTH * 0.42, Y_ROAD, 1.5, 'stand', -1],
  [stx(0.94), W.side * ROAD_HALF_WIDTH * 0.62, Y_ROAD, -1.2, 'stand', -1],
  [HEAD_CENTER_X - HEAD_RADIUS * 0.45, -HEAD_RADIUS * 0.80, Y_HEAD, -1.9, 'stand', -1],
  [HEAD_CENTER_X + HEAD_RADIUS * 0.70, -HEAD_RADIUS * 0.12, Y_HEAD, 1.7, 'armsUp', -1],
  [ringX(-1.15), ringZ(-1.15), Y_ARC, 0.6, 'lean', -1],
  [ringX(1.35), ringZ(1.35), Y_ARC, -2.4, 'stand', -1],
  [yx(0.32), yz(O, 0.18), Y_LAWN, 2.8, 'stand', -1],
  [yx(0.72), yz(O, 0.70), Y_LAWN, 1.6, 'fallen', -1],
  [yx(0.78), yz(W, 0.18), Y_LAWN, 0.4, 'sit', -1],
  [yx(0.72), yz(W, 0.88), Y_LAWN, -0.9, 'fallen', -1],
  [O.deckX + 7.2 * 0.22, O.side * (HOUSE_BACK + 3.4 * 0.45), 3.15, 3, 'stand', -1],
  [W.deckX - 7.2 * 0.22, W.side * (HOUSE_BACK + 3.4 * 0.45), 3.15, 0.2, 'armsUp', -1],
  [yx(0.30), -(BACK_FENCE + 1.9), Y_APRON, 2.6, 'stand', -1],
  [yx(0.68), -(BACK_FENCE + 2.9), Y_APRON, 3.3, 'lean', -1],
  [yx(0.36), BACK_FENCE + 2.2, Y_APRON, 0.5, 'armOut', -1],
  [yx(0.80), BACK_FENCE + 1.6, Y_APRON, -0.3, 'fallen', -1],
  [stx(0.13), O.side * PAVE_MID, Y_PAVE, 1.4, 'stand', -1],
  [stx(0.17), O.side * (PAVEMENT_OUTER + 1.6), Y_APRON, 1.9, 'sit', -1],
  [stx(0.10), W.side * PAVE_MID, Y_PAVE, -1.5, 'armsUp', 1],
  [stx(0.22), W.side * (PAVEMENT_OUTER + 2.4), Y_APRON, -1.1, 'stand', -1],
  [stx(0.05), W.side * (PAVEMENT_OUTER + 1.2), Y_APRON, 0.8, 'armOut', -1],
  [stx(0.48), O.side * PAVE_MID, Y_PAVE, 2.7, 'lean', -1],
  [stx(0.53), O.side * KERB_EDGE, Y_PAVE, 3.5, 'stand', -1],
  [stx(0.66), W.side * PAVE_MID, Y_PAVE, -0.2, 'sit', -1],
  [stx(0.72), W.side * KERB_EDGE, Y_PAVE, -2.6, 'armOut', -1],
  [hx(0.49), fz(O, 0.53), Y_LAWN, 3.1, 'stand', -1],
  [stx(0.72), O.side * KERB_EDGE, Y_PAVE, 2.4, 'lean', -1],
  [O.deckX, O.side * (HOUSE_BACK + 0.3), 3.15, -0.2, 'stand', -1],
  [hx(-0.60), fz(W, 0.45), Y_LAWN, -0.9, 'stand', -1],
  [yx(0.52), BACK_FENCE + 2.8, Y_APRON, 2.2, 'armsUp', -1],
];
// ---- pose body points (unit height, then scaled by H=1.78)
const H = 1.78;
function headPos(px, py, pz, yaw, pose) {
  // local head (0, 0.945+o, 0), o=0 except sit(-0.2225)/fallen(0)
  const o = pose === 'sit' ? 0.270 - 0.4925 : 0;
  const tilt = pose === 'lean' ? -0.17 : pose === 'fallen' ? 1.55 : 0;
  const roll = pose === 'lean' ? 0.07 : pose === 'fallen' ? 0.10 : 0;
  let v = [0, (0.945 + o) * H, 0];
  // Euler YXZ: yaw, then tilt about X, then roll about Z
  const cx = Math.cos(tilt), sx = Math.sin(tilt);
  v = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
  const cz = Math.cos(roll), sz = Math.sin(roll);
  v = [cz * v[0] - sz * v[1], sz * v[0] + cz * v[1], v[2]];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  v = [cy * v[0] + sy * v[2], v[1], -sy * v[0] + cy * v[2]];
  return [px + v[0], py + v[1], pz + v[2]];
}
function handPos(px, py, pz, yaw, k) {
  // armOut right arm (k=1): armF=0.18 armS=1.48 elb=-0.10 elbS=0.04
  const aF = 0.18, aS = 1.48, e = -0.10, eS = 0.04;
  const dir = (rx, rz) => [Math.sin(rz), -Math.cos(rz) * Math.cos(rx), -Math.cos(rz) * Math.sin(rx)];
  const sho = [0.100, 0.815, 0];
  const d1 = dir(aF, aS), elb = sho.map((s, i) => s + d1[i] * 0.165);
  const d2 = dir(aF + e, aS + eS), hand = elb.map((s, i) => s + d2[i] * 0.155);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const w = [cy * hand[0] + sy * hand[2], hand[1], -sy * hand[0] + cy * hand[2]];
  return [px + w[0] * H, py + w[1] * H, pz + w[2] * H];
}
// ---- stations
const ST = {
  midStreet: { pos: [0, 1.68, 0], yaw: Math.PI, pitch: 0, fov: 70 },
  streetElevation: { pos: [-3, 1.68, 4.0], yaw: 0, pitch: 4 * D, fov: 70 },
  plaza: { pos: [6, 2.6, -1.0], yaw: 90 * D, pitch: -1 * D, fov: 72 },
  spawnB: { pos: [-1.2, 1.68, 31.2], yaw: 0, pitch: 0, fov: 70 },
};
const Wpx = 1600, Hpx = 900;
function project(st, p) {
  const [cx, cy, cz] = st.pos;
  let dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
  // yaw about Y: forward=(-sin yaw,0,-cos yaw); camZ = -forward
  const cf = [-Math.sin(st.yaw), 0, -Math.cos(st.yaw)];
  const cr = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)]; // screen-right? check: yaw=pi -> (-1,0,0)? cos pi=-1 -> cr=(-1,0,-0). yes matches earlier (-1,0,0)
  // apply pitch about right axis
  const cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
  // camera coords: x = d.cr, y0 = d.up, zc = -(d.cf)
  let xc = dx * cr[0] + dz * cr[2];
  let yc = dy;
  let zf = dx * cf[0] + dz * cf[2];
  // pitch: rotate (yc, zf)
  const yc2 = cp * yc - sp * zf, zf2 = sp * yc + cp * zf;
  if (zf2 <= 0.1) return null;
  const t = Math.tan((st.fov * D) / 2);
  return [Wpx / 2 + (xc / zf2 / t / (Wpx / Hpx)) * (Wpx / 2), Hpx / 2 - (yc2 / zf2 / t) * (Hpx / 2), zf2];
}
// solids (AABB [minx,miny,minz,maxx,maxy,maxz])
const blueBank = { n: 'BLUE bank', b: [4.032 - 1.44, 0, 9.76 - 0.44, 4.032 + 1.44, 1.62, 9.76 + 0.44] };
const redBank = { n: 'RED bank', b: [-4.032 - 1.44, 0, -9.76 - 0.44, -4.032 + 1.44, 1.62, -9.76 + 0.44] };
const solids = [blueBank, redBank,
  { n: 'dais', b: [-62 - 4.3, 0, -17 - 2.9, -62 + 4.3, 1.9, -17 + 2.9] },
  { n: 'kiosk', b: [-60 - 2.0, 0, 9.6 - 1.8, -60 + 2.0, 3.2, 9.6 + 1.8] },
  { n: 'fountain plinth', b: [-37 - 1.5, 0, 23.8 - 1.5, -37 + 1.5, 1.2, 23.8 + 1.5] },
  { n: 'pod', b: [-12 - 2.1, 0, 28.9 - 2.1, -12 + 2.1, 2.65, 28.9 + 2.1] },
  { n: 'windbreak', b: [16.5 - 0.2, 0.141, 28.0 - 1.6, 16.5 + 0.2, 1.2, 28.0 + 1.6] },
  { n: 'glasshouse', b: [-14.8 - 1.85, 0, -30.4 - 1.45, -14.8 + 1.85, 2.8, -30.4 + 1.45] },
];
function boxOverlap2D(st, s, p, r) {
  const c = s.b, corners = [];
  for (const x of [c[0], c[3]]) for (const y of [c[1], c[4]]) for (const z of [c[2], c[5]]) corners.push(project(st, [x, y, z]));
  if (corners.some((q) => q === null)) return null;
  const xs = corners.map((q) => q[0]), ys = corners.map((q) => q[1]);
  const q = project(st, p);
  if (!q) return null;
  const rad = r / q[2] * (Hpx / 2) / Math.tan((st.fov * D) / 2);
  const inside = q[0] > Math.min(...xs) - rad && q[0] < Math.max(...xs) + rad && q[1] > Math.min(...ys) - rad && q[1] < Math.max(...ys) + rad;
  return { q, inside, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}
console.log('--- lean heads vs solids (3D dist + screen overlap) ---');
const leanIdx = PLACES.map((p, i) => [p, i]).filter(([p]) => p[4] === 'lean').map(([, i]) => i);
for (const i of leanIdx) {
  const [px, pz, py, yaw, pose] = [PLACES[i][0], PLACES[i][1], PLACES[i][2], PLACES[i][3], PLACES[i][4]];
  const hd = headPos(px, py, pz, yaw, pose);
  let best = null;
  for (const s of solids) {
    const c = s.b;
    const d = Math.hypot(Math.max(c[0] - hd[0], 0, hd[0] - c[3]), Math.max(c[1] - hd[1], 0, hd[1] - c[4]), Math.max(c[2] - hd[2], 0, hd[2] - c[5]));
    if (!best || d < best.d) best = { n: s.n, d };
  }
  console.log(`#${i} lean at (${px.toFixed(2)},${pz.toFixed(2)}) head=(${hd.map((v) => v.toFixed(2)).join(',')}) nearest=${best.n} ${best.d.toFixed(2)}m`);
}
console.log('--- armOut right hands vs banks (3D) ---');
for (const i of PLACES.map((p, i) => [p, i]).filter(([p]) => p[4] === 'armOut').map(([, i]) => i)) {
  const [px, pz, py, yaw] = [PLACES[i][0], PLACES[i][1], PLACES[i][2], PLACES[i][3]];
  const hn = handPos(px, py, pz, yaw, 1);
  for (const s of [blueBank, redBank]) {
    const c = s.b;
    const d = Math.hypot(Math.max(c[0] - hn[0], 0, hn[0] - c[3]), Math.max(c[1] - hn[1], 0, hn[1] - c[4]), Math.max(c[2] - hn[2], 0, hn[2] - c[5]));
    console.log(`#${i} armOut hand=(${hn.map((v) => v.toFixed(2)).join(',')}) vs ${s.n}: ${d.toFixed(2)}m`);
  }
}
console.log('--- all figures projected into midStreet (identify garage-corner leaner) ---');
for (let i = 0; i < PLACES.length; i++) {
  const [px, pz, py, yaw, pose] = [PLACES[i][0], PLACES[i][1], PLACES[i][2], PLACES[i][3], PLACES[i][4]];
  const hd = headPos(px, py, pz, yaw, pose);
  const q = project(ST.midStreet, hd);
  if (q) console.log(`#${i} ${pose} head -> (${q[0].toFixed(0)}, ${q[1].toFixed(0)}) depth ${q[2].toFixed(1)}m`);
}
console.log('--- #8 hand vs blue bank in midStreet pixels ---');
{
  const [px, pz, py, yaw] = [PLACES[8][0], PLACES[8][1], PLACES[8][2], PLACES[8][3]];
  const hn = handPos(px, py, pz, yaw, 1);
  const r = boxOverlap2D(ST.midStreet, blueBank, hn, 0.1);
  console.log('hand px:', r && r.q.map((v) => v.toFixed(0)).join(','), 'inside bank bbox:', r && r.inside, 'bank bbox:', r && r.box.map((v) => v.toFixed(0)).join(','));
}
