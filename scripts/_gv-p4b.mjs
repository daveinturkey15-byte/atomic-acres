// three clean walk-into-a-mannequin tests, from directions with nothing else in the way
const NT = window.__NT;
const T = [
  { i: 12, fig: [8.29, 28.68], from: [8.29, 31.8], to: [8.29, 26.8], name: 'white yard lean' },
  { i: 3, fig: [1.28, 12.292], from: [1.28, 15.0], to: [1.28, 9.6], name: 'white lawn stand' },
  { i: 9, fig: [8.90, 5.85], from: [8.90, 2.6], to: [8.90, 9.0], name: 'east pavement armOut' },
  { i: 11, fig: [11.4, -33.17], from: [11.4, -30.6], to: [11.4, -35.6], name: 'orange yard fallen (0.45 m box)' },
];
const out = T.map((t) => {
  NT.probeReset(t.from[0], t.from[1]);
  const s = NT.probePos();
  NT.probeWalkTo(t.to[0], t.to[1], 800);
  const e = NT.probePos();
  return { i: t.i, name: t.name, start: s.map((v) => +v.toFixed(2)), end: e.map((v) => +v.toFixed(2)),
    movedTowards: +(Math.abs(s[2] - e[2])).toFixed(2),
    distToFigure: +Math.hypot(e[0] - t.fig[0], e[2] - t.fig[1]).toFixed(2),
    passedFigure: (t.to[1] < t.from[1]) ? e[2] < t.fig[1] - 0.35 : e[2] > t.fig[1] + 0.35,
    stoppedOn: NT.collidersAt(+e[0].toFixed(2), +((e[2] + (t.to[1] < t.from[1] ? -0.35 : 0.35))).toFixed(2), 0.9)
      .map((h) => h.owner + '#' + h.i) };
});
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
return { out, shots: [
  { name: 'white-negz-face-frontal', mode: 'fly', x: -0.5, y: 5.0 - 1.62, z: 15.0,
    yaw: yawTo(-0.5, 15.0, -0.5, 22), pitch: -0.03 },
] };
