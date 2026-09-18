/**
 * Atomic Acres — HUD.
 *
 * BO2 composition (bottom-corner heavy, thin condensed type, desaturated
 * with one amber accent), our own identity: no Activision/Treyarch marks,
 * accent and danger read off `PAL` so the UI and the world agree.
 *
 * Efficiency contract (explicit requirement — the old project churned DOM
 * every frame):
 * - Every node is built ONCE in initHud. Afterwards only `textContent`
 *   writes and CSS custom-property / class flips. No `innerHTML`, no
 *   create/append/remove in any setter.
 * - Every setter caches its last-written value and returns early when
 *   nothing changed. Caches start at impossible values so the first real
 *   push always writes, whatever the weapon defs say today.
 * - Animation runs on `transform` and `opacity` only. The health bar fills
 *   via `scaleX`, not `width`. `will-change` sits on the three elements
 *   that actually animate (hitmarker, vignette, damage arc) and nowhere else.
 * - The kill feed is a fixed pool of rows, recycled round-robin. A feed
 *   event is one `textContent` write + one class flip.
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
import {
  KILLFEED_MAX,
  KILLFEED_MS,
  HIT_MS,
  HIT_KILL_MS,
  DMGDIR_MS,
  MAP_PX,
  MAP_POS_Q,
  MAP_YAW_Q,
  LOW_AMMO,
  LOW_HP,
  ASSUMED_MAG,
  XH_GAP_STILL,
  XH_GAP_MOVING,
  XH_GAP_FIRING,
  UI_ACCENT,
  UI_DANGER,
  UI_INK,
  palCss,
  palRgba,
} from './layout';
import { PAL } from '../core/palette';

export interface HudApi {
  setAmmo(mag: number, reserve: number): void;
  setWeapon(name: string, reloading?: boolean): void;
  setScore(text: string): void;
  setHealth(hp: number): void;
  damageFlash(): void;
  /** Red edge arc pointing at a world-space damage source. Event-rate. */
  damageFrom(srcX: number, srcZ: number, px: number, pz: number, yaw: number): void;
  hitmarker(kill?: boolean): void;
  killfeed(text: string): void;
  setMoving(moving: boolean): void;
  setFiring(firing: boolean): void;
  setADS(ads: boolean): void;
  setPlayer(x: number, z: number, yaw: number): void;
  setDebugVisible(v: boolean): void;
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

/**
 * Screen angle of a world-space source around the player: 0 is forward/top,
 * positive is camera-right/clockwise. Camera forward is
 * (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
 */
function sourceAngle(
  srcX: number, srcZ: number, px: number, pz: number, yaw: number,
): number {
  const dx = srcX - px;
  const dz = srcZ - pz;
  if (dx * dx + dz * dz < 1e-12) return 0;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
}

function noopApi(): HudApi {
  const noop = (): void => undefined;
  const noopStr = (_s: string): void => undefined;
  return {
    setAmmo: noop,
    setWeapon: noopStr,
    setScore: noopStr,
    setHealth: noop,
    damageFlash: noop,
    damageFrom: noop,
    hitmarker: noop,
    killfeed: noopStr,
    setMoving: noop,
    setFiring: noop,
    setADS: noop,
    setPlayer: noop,
    setDebugVisible: noop,
  };
}

export function initHud(): HudApi {
  const hud = document.getElementById('hud');
  const cross = document.getElementById('crosshair');
  if (!hud) return noopApi();

  // Palette agreement: one write each at startup, then never again.
  hud.style.setProperty('--aa-accent', palCss(UI_ACCENT));
  hud.style.setProperty('--aa-danger', palCss(UI_DANGER));
  hud.style.setProperty('--aa-ink', palCss(UI_INK));

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
  let lastGap = -1;
  const applyGap = (): void => {
    if (!gapHost) return;
    let gap = XH_GAP_STILL;
    if (moving) gap += XH_GAP_MOVING;
    if (firing) gap += XH_GAP_FIRING;
    if (gap === lastGap) return;
    lastGap = gap;
    gapHost.style.setProperty('--xh-gap', gap + 'px');
  };
  applyGap();

  // Tag the pre-existing debug divs main.ts appended (first three div
  // children at init, if present) so setDebugVisible can hide ONLY those.
  try {
    const kids = hud.querySelectorAll(':scope > div');
    for (let i = 0; i < 3 && i < kids.length; i++) kids[i].classList.add('hud-debug');
  } catch { /* never throw when absent */ }

  // --- weapon block + ammo (bottom-right) -----------------------------------
  const weapon = el('div', 'hud-own hud-weapon');
  const weaponName = document.createElement('span');
  weaponName.className = 'hud-weapon-name';
  weaponName.textContent = 'Longhorn';
  const reloadEl = document.createElement('span');
  reloadEl.className = 'hud-reload hud-reload-hidden';
  reloadEl.textContent = 'RELOADING';
  weapon.append(weaponName, reloadEl);

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
  const hpLabel = document.createElement('span');
  hpLabel.className = 'hud-hp-label';
  hpLabel.textContent = '100';
  hpTrack.appendChild(hpFill);
  health.append(hpTrack, hpLabel);
  const vignette = el('div', 'hud-own hud-vignette');

  // --- damage-direction arc: rotated via transform only ----------------------
  const dmgdir = el('div', 'hud-own hud-dmgdir hud-dmgdir-hidden');
  const dmgArc = el('div', 'hud-dmgdir-arc');
  dmgdir.appendChild(dmgArc);
  let dmgTimer = 0;

  // --- hitmarker (centered X, opacity only) ----------------------------------
  const hit = el('div', 'hud-own hud-hitmarker');
  for (let i = 0; i < 4; i++) hit.appendChild(el('span', 'hm-a hm-' + i));
  let hitTimer = 0;

  // --- killfeed (top-right): fixed pool, recycled, never churned -------------
  const feed = el('div', 'hud-own hud-killfeed');
  const pool: Array<{ row: HTMLElement; timer: number }> = [];
  for (let i = 0; i < KILLFEED_MAX; i++) {
    const row = el('div', 'hud-feed-row hud-feed-hidden');
    feed.appendChild(row);
    pool.push({ row, timer: 0 });
  }
  let feedNext = 0;

  // --- score / streak line (top-center, hidden until a backend sets it) ------
  const scoreLine = el('div', 'hud-own hud-score-line hud-score-line-hidden');

  // --- minimap (top-left): geometry ONLY from layout.ts constants ------------
  const mapWrap = el('div', 'hud-own hud-minimap');
  const mapTitle = document.createElement('div');
  mapTitle.className = 'hud-map-title';
  mapTitle.textContent = 'NUKETOWN';
  const canvas = document.createElement('canvas');
  canvas.width = MAP_PX;
  canvas.height = MAP_PX;
  canvas.className = 'hud-map-canvas';
  mapWrap.append(mapTitle, canvas);
  const mapCtx = canvas.getContext('2d');

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

  hud.append(weapon, ammo, health, vignette, dmgdir, hit, feed, scoreLine, mapWrap, score);

  const drawMap = (px: number, pz: number, pyaw: number): void => {
    if (!mapCtx) return;
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

    mapCtx.clearRect(0, 0, W, W);
    mapCtx.fillStyle = 'rgba(8,12,8,0.72)';
    mapCtx.fillRect(0, 0, W, W);

    // yard bounds
    mapCtx.strokeStyle = 'rgba(220,230,220,0.35)';
    mapCtx.lineWidth = 1;
    mapCtx.strokeRect(X(YARD_X_MIN), Z(-BACK_FENCE), (YARD_X_MAX - YARD_X_MIN) * s, BACK_FENCE * 2 * s);

    // road stem
    mapCtx.fillStyle = palRgba(PAL.concreteDark, 0.5);
    mapCtx.fillRect(X(ROAD_X_MIN), Z(-ROAD_HALF_WIDTH), (ROAD_X_MAX - ROAD_X_MIN) * s, ROAD_HALF_WIDTH * 2 * s);

    // turning-head circle
    mapCtx.beginPath();
    mapCtx.arc(X(HEAD_CENTER_X), Z(0), HEAD_RADIUS * s, 0, Math.PI * 2);
    mapCtx.fillStyle = palRgba(PAL.concreteDark, 0.45);
    mapCtx.fill();

    // house blocks: main block + attached garage wing per side
    for (const h of HOUSES) {
      const zA = Math.min(h.frontZ, h.backZ);
      const zB = Math.max(h.frontZ, h.backZ);
      mapCtx.fillStyle = h.side < 0 ? palRgba(PAL.terracotta, 0.8) : palRgba(PAL.capsuleWhite, 0.8);
      mapCtx.fillRect(X(-HOUSE_HALF_LEN), Z(zA), HOUSE_HALF_LEN * 2 * s, (zB - zA) * s);
      // garage wing: centred on garageX, extends GARAGE_DEPTH past the front wall
      const gx0 = h.garageX - GARAGE_LEN / 2;
      const gzA = h.side < 0 ? h.frontZ - GARAGE_DEPTH : h.frontZ;
      const gzB = h.side < 0 ? h.frontZ : h.frontZ + GARAGE_DEPTH;
      mapCtx.fillStyle = palRgba(PAL.barrelRoof, 0.65);
      mapCtx.fillRect(X(gx0), Z(Math.min(gzA, gzB)), GARAGE_LEN * s, Math.abs(gzB - gzA) * s);
    }

    // back fences
    mapCtx.strokeStyle = palRgba(PAL.fenceRail, 0.7);
    mapCtx.beginPath();
    mapCtx.moveTo(X(YARD_X_MIN), Z(-BACK_FENCE));
    mapCtx.lineTo(X(YARD_X_MAX), Z(-BACK_FENCE));
    mapCtx.moveTo(X(YARD_X_MIN), Z(BACK_FENCE));
    mapCtx.lineTo(X(YARD_X_MAX), Z(BACK_FENCE));
    mapCtx.stroke();

    // player arrow: forward = (-sin yaw, -cos yaw) in xz
    const fx = -Math.sin(pyaw);
    const fz = -Math.cos(pyaw);
    const ang = Math.atan2(fz, fx);
    const cx = X(px);
    const cy = Z(pz);
    const r = 7;
    mapCtx.save();
    mapCtx.translate(cx, cy);
    mapCtx.rotate(ang);
    mapCtx.beginPath();
    mapCtx.moveTo(r, 0);
    mapCtx.lineTo(-r * 0.7, r * 0.55);
    mapCtx.lineTo(-r * 0.7, -r * 0.55);
    mapCtx.closePath();
    mapCtx.fillStyle = palCss(UI_ACCENT);
    mapCtx.fill();
    mapCtx.restore();
  };
  drawMap(0, 0, 0);

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

  // --- last-written caches: every setter below returns early on no-change.
  // Seeds are impossible values (not current defs) so the first real push
  // always writes even if it matches the static placeholder text above. -----
  let cMag = -1;
  let cRes = -1;
  let cLowAmmo = false;
  let cWeapon = '';
  let cReloading = false;
  let cScore = '';
  let cHp = -1;
  let cLowHp = false;
  let cAds = false;
  let cDebugHidden = true;
  let cMapX = 0;
  let cMapZ = 0;
  let cMapYaw = 0;
  let mapDrawn = false;

  return {
    setAmmo(mag: number, reserve: number): void {
      const m = Math.max(0, Math.round(mag));
      const r = Math.max(0, Math.round(reserve));
      if (m === cMag && r === cRes) return;
      cMag = m;
      cRes = r;
      magEl.textContent = String(m);
      resEl.textContent = String(r);
      const low = m <= LOW_AMMO || m <= ASSUMED_MAG * 0.2;
      if (low !== cLowAmmo) {
        cLowAmmo = low;
        ammo.classList.toggle('hud-low', low);
      }
    },
    setWeapon(name: string, reloading = false): void {
      if (name === cWeapon && reloading === cReloading) return;
      cWeapon = name;
      cReloading = reloading;
      weaponName.textContent = name;
      reloadEl.classList.toggle('hud-reload-hidden', !reloading);
    },
    setScore(text: string): void {
      if (text === cScore) return;
      cScore = text;
      scoreLine.textContent = text;
      scoreLine.classList.toggle('hud-score-line-hidden', text.length === 0);
    },
    setHealth(hp: number): void {
      const v = Math.max(0, Math.min(100, Math.round(hp)));
      if (v === cHp) return;
      cHp = v;
      // scaleX keeps the fill on the compositor; width would lay out every hit.
      hpFill.style.transform = 'scaleX(' + v / 100 + ')';
      hpLabel.textContent = String(v);
      const low = v <= LOW_HP;
      if (low !== cLowHp) {
        cLowHp = low;
        health.classList.toggle('hud-low', low);
      }
    },
    damageFlash(): void {
      vignette.classList.remove('hud-flash');
      void vignette.offsetWidth;
      vignette.classList.add('hud-flash');
    },
    damageFrom(srcX: number, srcZ: number, px: number, pz: number, yaw: number): void {
      const ang = sourceAngle(srcX, srcZ, px, pz, yaw);
      dmgdir.style.transform = 'rotate(' + ang + 'rad)';
      dmgdir.classList.remove('hud-dmgdir-hidden');
      window.clearTimeout(dmgTimer);
      dmgTimer = window.setTimeout(() => {
        dmgdir.classList.add('hud-dmgdir-hidden');
      }, DMGDIR_MS);
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
      const slot = pool[feedNext];
      feedNext = (feedNext + 1) % pool.length;
      window.clearTimeout(slot.timer);
      slot.row.textContent = text;
      slot.row.classList.remove('hud-feed-hidden');
      slot.timer = window.setTimeout(() => {
        slot.row.classList.add('hud-feed-hidden');
      }, KILLFEED_MS);
    },
    setMoving(m: boolean): void {
      if (m === moving) return;
      moving = m;
      applyGap();
    },
    setFiring(f: boolean): void {
      if (f === firing) return;
      firing = f;
      applyGap();
    },
    setADS(ads: boolean): void {
      if (ads === cAds) return;
      cAds = ads;
      if (gapHost) gapHost.classList.toggle('xh-hidden', ads);
    },
    setPlayer(x: number, z: number, yaw: number): void {
      const qx = Math.round(x / MAP_POS_Q) * MAP_POS_Q;
      const qz = Math.round(z / MAP_POS_Q) * MAP_POS_Q;
      const qy = Math.round(yaw / MAP_YAW_Q) * MAP_YAW_Q;
      if (mapDrawn && qx === cMapX && qz === cMapZ && qy === cMapYaw) return;
      cMapX = qx;
      cMapZ = qz;
      cMapYaw = qy;
      mapDrawn = true;
      drawMap(x, z, yaw);
    },
    setDebugVisible(v: boolean): void {
      const hidden = !v;
      if (hidden === cDebugHidden) return;
      cDebugHidden = hidden;
      hud.classList.toggle('hud-debug-hidden', hidden);
    },
  };
}
