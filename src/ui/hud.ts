/**
 * NUKETOWN 2025 - HUD MODULE
 *
 * Weapons-agent push pattern (one line): call the returned api every time
 * weapon state changes, e.g. `hud.setAmmo(mag, reserve)` after each
 * shot/reload and `hud.hitmarker(kill)` / `hud.damageFlash()` on hit events.
 *
 * Placeholder defaults (rendered before any pushes arrive): ammo 30/120,
 * health 100, crosshair still/hip (tight, visible), player arrow at (0, 0)
 * facing yaw 0, scoreboard hidden, debug divs hidden.
 */
import './hud.css';
import {
  ROAD_HALF_WIDTH,
  ROAD_X_MIN,
  ROAD_X_MAX,
  HEAD_CENTER_X,
  HEAD_RADIUS,
  HOUSE_HALF_LEN,
  GARAGE_LEN,
  GARAGE_DEPTH,
  BACK_FENCE,
  YARD_X_MIN,
  YARD_X_MAX,
  BOUND_X_MIN,
  BOUND_X_MAX,
  BOUND_Z,
  HOUSES,
} from '../core/layout';

export interface HudApi {
  setAmmo(mag: number, reserve: number): void;
  setHealth(hp: number): void;
  damageFlash(): void;
  hitmarker(kill?: boolean): void;
  killfeed(text: string): void;
  setMoving(moving: boolean): void;
  setFiring(firing: boolean): void;
  setADS(ads: boolean): void;
  setPlayer(x: number, z: number, yaw: number): void;
  setDebugVisible(v: boolean): void;
}

/** Assumed mag size for the low-ammo warning when only the count is known. */
const ASSUMED_MAG = 30;
const KILLFEED_MAX = 5;
const KILLFEED_MS = 5000;
const HIT_MS = 110;
const HIT_KILL_MS = 350;
const MAP_PX = 148;

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export function initHud(): HudApi {
  const hud = document.getElementById('hud');
  const cross = document.getElementById('crosshair');

  // --- crosshair: 4 child spans driven by a --xh-gap CSS var ---------------
  let gapHost: HTMLElement | null = null;
  if (cross) {
    cross.classList.add('xh-lines');
    for (const c of ['xh-n', 'xh-s', 'xh-e', 'xh-w']) {
      const s = document.createElement('span');
      s.className = 'xh ' + c;
      cross.appendChild(s);
    }
    gapHost = cross;
  }
  let moving = false;
  let firing = false;
  const applyGap = (): void => {
    if (!gapHost) return;
    let gap = 3; // still/hip = tight visible cross
    if (moving) gap += 6;
    if (firing) gap += 9;
    gapHost.style.setProperty('--xh-gap', gap + 'px');
  };
  applyGap();

  if (!hud) {
    const noop = (): void => undefined;
    return {
      setAmmo: noop, setHealth: noop, damageFlash: noop,
      hitmarker: noop, killfeed: noop, setMoving: noop,
      setFiring: noop, setADS: noop, setPlayer: noop, setDebugVisible: noop,
    };
  }

  // Tag the pre-existing debug divs main.ts appended (first three div
  // children at init, if present) so setDebugVisible can hide ONLY those.
  try {
    const kids = hud.querySelectorAll(':scope > div');
    for (let i = 0; i < 3 && i < kids.length; i++) kids[i].classList.add('hud-debug');
  } catch { /* never throw when absent */ }

  // --- ammo (bottom-right) --------------------------------------------------
  const ammo = el('div', 'hud-own hud-ammo');
  const magEl = document.createElement('span');
  magEl.className = 'hud-mag';
  magEl.textContent = '30';
  const sep = document.createElement('span');
  sep.className = 'hud-ammo-sep';
  sep.textContent = ' / ';
  const resEl = document.createElement('span');
  resEl.className = 'hud-reserve';
  resEl.textContent = '120';
  ammo.append(magEl, sep, resEl);

  // --- health (bottom-left) + damage vignette --------------------------------
  const health = el('div', 'hud-own hud-health');
  const hpTrack = el('div', 'hud-hp-track');
  const hpFill = el('div', 'hud-hp-fill');
  hpFill.style.width = '100%';
  const hpLabel = document.createElement('span');
  hpLabel.className = 'hud-hp-label';
  hpLabel.textContent = '100';
  hpTrack.appendChild(hpFill);
  health.append(hpTrack, hpLabel);
  const vignette = el('div', 'hud-own hud-vignette');

  // --- hitmarker (centered X) ------------------------------------------------
  const hit = el('div', 'hud-own hud-hitmarker');
  for (let i = 0; i < 4; i++) hit.appendChild(el('span', 'hm-a hm-' + i));
  let hitTimer = 0;

  // --- killfeed (top-right) ---------------------------------------------------
  const feed = el('div', 'hud-own hud-killfeed');

  // --- minimap (top-left) ------------------------------------------------------
  const mapWrap = el('div', 'hud-own hud-minimap');
  const mapTitle = document.createElement('div');
  mapTitle.className = 'hud-map-title';
  mapTitle.textContent = 'NUKETOWN';
  const canvas = document.createElement('canvas');
  canvas.width = MAP_PX;
  canvas.height = MAP_PX;
  canvas.className = 'hud-map-canvas';
  mapWrap.append(mapTitle, canvas);

  // --- scoreboard (hold Tab, hidden by default) ---------------------------------
  const score = el('div', 'hud-own hud-score hud-score-hidden');
  const scoreTitle = document.createElement('div');
  scoreTitle.className = 'hud-score-title';
  scoreTitle.textContent = 'SCOREBOARD';
  score.appendChild(scoreTitle);
  const placeholderRows: Array<[string, string]> = [
    ['ORANGE — you', '1250'],
    ['WHITE — enemy', '1100'],
    ['ORANGE — ally', '850'],
    ['WHITE — enemy', '600'],
  ];
  for (const [name, pts] of placeholderRows) {
    const row = el('div', 'hud-score-row');
    const n = document.createElement('span');
    n.className = 'hud-score-name';
    n.textContent = name;
    const p = document.createElement('span');
    p.className = 'hud-score-pts';
    p.textContent = pts;
    row.append(n, p);
    score.appendChild(row);
  }

  hud.append(mapWrap, feed, ammo, health, vignette, hit, score);

  // --- minimap drawing: geometry ONLY from layout.ts constants ------------------
  let px = 0;
  let pz = 0;
  let pyaw = 0;
  const drawMap = (): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = MAP_PX;
    const pad = 6;
    const xMin = BOUND_X_MIN;
    const xMax = BOUND_X_MAX;
    const zMin = -BOUND_Z;
    const zMax = BOUND_Z;
    const s = Math.min((W - pad * 2) / (xMax - xMin), (W - pad * 2) / (zMax - zMin));
    const ox = pad + (W - pad * 2 - (xMax - xMin) * s) / 2;
    const oy = pad + (W - pad * 2 - (zMax - zMin) * s) / 2;
    const X = (x: number): number => ox + (x - xMin) * s;
    const Z = (z: number): number => oy + (z - zMin) * s;

    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = 'rgba(8,12,8,0.72)';
    ctx.fillRect(0, 0, W, W);

    // yard bounds
    ctx.strokeStyle = 'rgba(220,230,220,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(X(YARD_X_MIN), Z(-BACK_FENCE), (YARD_X_MAX - YARD_X_MIN) * s, BACK_FENCE * 2 * s);

    // road stem
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.fillRect(X(ROAD_X_MIN), Z(-ROAD_HALF_WIDTH), (ROAD_X_MAX - ROAD_X_MIN) * s, ROAD_HALF_WIDTH * 2 * s);

    // turning-head circle
    ctx.beginPath();
    ctx.arc(X(HEAD_CENTER_X), Z(0), HEAD_RADIUS * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200,200,200,0.45)';
    ctx.fill();

    // house blocks: main block + attached garage wing per side
    for (const h of HOUSES) {
      const zA = Math.min(h.frontZ, h.backZ);
      const zB = Math.max(h.frontZ, h.backZ);
      ctx.fillStyle = h.side < 0 ? 'rgba(255,150,80,0.75)' : 'rgba(240,240,240,0.75)';
      ctx.fillRect(X(-HOUSE_HALF_LEN), Z(zA), HOUSE_HALF_LEN * 2 * s, (zB - zA) * s);
      // garage wing: centred on garageX, extends GARAGE_DEPTH past the front wall
      const gx0 = h.garageX - GARAGE_LEN / 2;
      const gzA = h.side < 0 ? h.frontZ - GARAGE_DEPTH : h.frontZ;
      const gzB = h.side < 0 ? h.frontZ : h.frontZ + GARAGE_DEPTH;
      ctx.fillStyle = 'rgba(180,180,180,0.6)';
      ctx.fillRect(X(gx0), Z(Math.min(gzA, gzB)), GARAGE_LEN * s, Math.abs(gzB - gzA) * s);
    }

    // back fences
    ctx.strokeStyle = 'rgba(255,220,150,0.7)';
    ctx.beginPath();
    ctx.moveTo(X(YARD_X_MIN), Z(-BACK_FENCE));
    ctx.lineTo(X(YARD_X_MAX), Z(-BACK_FENCE));
    ctx.moveTo(X(YARD_X_MIN), Z(BACK_FENCE));
    ctx.lineTo(X(YARD_X_MAX), Z(BACK_FENCE));
    ctx.stroke();

    // player arrow: forward = (-sin yaw, -cos yaw) in xz
    const fx = -Math.sin(pyaw);
    const fz = -Math.cos(pyaw);
    const ang = Math.atan2(fz, fx);
    const cx = X(px);
    const cy = Z(pz);
    const r = 7;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.7, r * 0.55);
    ctx.lineTo(-r * 0.7, -r * 0.55);
    ctx.closePath();
    ctx.fillStyle = '#ffd25c';
    ctx.fill();
    ctx.restore();
  };
  drawMap();

  // --- scoreboard Tab hold -------------------------------------------------------
  addEventListener('keydown', (e) => {
    if (e.code === 'Tab' && !e.repeat) {
      e.preventDefault();
      score.classList.remove('hud-score-hidden');
    }
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'Tab') score.classList.add('hud-score-hidden');
  });
  addEventListener('blur', () => score.classList.add('hud-score-hidden'));

  // Default: debug hidden.
  hud.classList.add('hud-debug-hidden');

  return {
    setAmmo(mag: number, reserve: number): void {
      magEl.textContent = String(mag);
      resEl.textContent = String(reserve);
      const low = mag <= 5 || mag <= ASSUMED_MAG * 0.2;
      ammo.classList.toggle('hud-low', low);
    },
    setHealth(hp: number): void {
      const v = Math.max(0, Math.min(100, hp));
      hpFill.style.width = v + '%';
      hpLabel.textContent = String(Math.round(v));
      health.classList.toggle('hud-low', v <= 30);
    },
    damageFlash(): void {
      vignette.classList.remove('hud-flash');
      void vignette.offsetWidth;
      vignette.classList.add('hud-flash');
    },
    hitmarker(kill?: boolean): void {
      hit.classList.remove('hm-show', 'hm-kill');
      void hit.offsetWidth;
      hit.classList.add('hm-show');
      if (kill) hit.classList.add('hm-kill');
      window.clearTimeout(hitTimer);
      hitTimer = window.setTimeout(() => {
        hit.classList.remove('hm-show', 'hm-kill');
      }, kill ? HIT_KILL_MS : HIT_MS);
    },
    killfeed(text: string): void {
      const row = el('div', 'hud-feed-row');
      row.textContent = text;
      feed.prepend(row);
      while (feed.children.length > KILLFEED_MAX) feed.lastChild?.remove();
      window.setTimeout(() => row.remove(), KILLFEED_MS);
    },
    setMoving(m: boolean): void {
      moving = m;
      applyGap();
    },
    setFiring(f: boolean): void {
      firing = f;
      applyGap();
    },
    setADS(ads: boolean): void {
      if (gapHost) gapHost.classList.toggle('xh-hidden', ads);
    },
    setPlayer(x: number, z: number, yaw: number): void {
      px = x;
      pz = z;
      pyaw = yaw;
      drawMap();
    },
    setDebugVisible(v: boolean): void {
      hud.classList.toggle('hud-debug-hidden', !v);
    },
  };
}
