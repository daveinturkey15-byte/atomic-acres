/**
 * Assembly. main.ts owns the scene; builders never do.
 *
 * Adding a module is one line in BUILDERS. That is the whole extension point -
 * there is deliberately no registry framework, no plugin loader and no pass system.
 */
import * as THREE from 'three';
import { createWorld } from './core/world';
import { buildMaterials } from './core/materials';
import { makeRng, type AABB, type BuildContext, type Builder } from './core/kit';
import { Player, type MoveMode } from './core/player';
import { SPAWN_A, SPAWN_B, EYE_HEIGHT, HOUSES, garageIsOnTheRight } from './core/layout';
import { STATIONS, type Station } from './core/stations';
import { WeaponsController } from './weapons/controller';
import { initUI } from './ui/index';

import { buildGround } from './build/ground';
import { buildOrangeHouse } from './build/orange-house';
import { buildWhiteHouse } from './build/white-house';
import { buildThirdHouse } from './build/third-house';
import { buildVehicles } from './build/vehicles';
import { buildYards } from './build/yards';
import { buildSkyline } from './build/skyline';
import { buildPlaza } from './build/plaza';
import { buildMannequins } from './build/mannequins';
import { buildSurround } from './build/surround';

const BUILDERS: [string, Builder][] = [
  ['ground', buildGround],
  ['orange-house', buildOrangeHouse],
  ['white-house', buildWhiteHouse],
  ['third-house', buildThirdHouse],
  ['vehicles', buildVehicles],
  ['yards', buildYards],
  ['skyline', buildSkyline],
  ['plaza', buildPlaza],
  ['mannequins', buildMannequins],
  ['surround', buildSurround],
];

// The one invariant, asserted rather than commented. From either back yard, facing
// your own house, the garage is on your RIGHT - and because the houses are a 180
// degree rotational pair, both must agree. A half-mirror breaks exactly this.
const handedness = HOUSES.map(garageIsOnTheRight);
if (!handedness.every(Boolean)) {
  console.error('[nuketown] HANDEDNESS VIOLATION: garage-on-the-right is',
    handedness, '- the houses are no longer a 180 degree rotational pair.');
}

const world = createWorld(document.body);
const mat = buildMaterials();
const player = new Player(world.camera, world.renderer.domElement);

const colliders: AABB[] = [];
const moduleStats: Record<string, { objects: number; colliders: number; ms: number }> = {};
const worldTargets: THREE.Object3D[] = [];

for (const [name, build] of BUILDERS) {
  const t0 = performance.now();
  const ctx: BuildContext = { mat, rand: makeRng('nuketown-2025:' + name) };
  let res;
  try {
    res = build(ctx);
  } catch (err) {
    console.error('[nuketown] module "' + name + '" threw during build:', err);
    continue;
  }
  res.group.name = name;
  world.scene.add(res.group);
  worldTargets.push(res.group);
  colliders.push(...res.colliders);
  let objects = 0;
  res.group.traverse(() => objects++);
  moduleStats[name] = {
    objects,
    colliders: res.colliders.length,
    ms: +(performance.now() - t0).toFixed(1),
  };
}
player.setColliders(colliders);
player.teleport(SPAWN_A.x, 0, SPAWN_A.z, SPAWN_A.yaw);
const ammoDiv = document.createElement('div');
const weapons = new WeaponsController({
  camera: world.camera,
  scene: world.scene,
  mat,
  targets: worldTargets,
  onHud: (line) => { ammoDiv.textContent = line; },
});

// ---------------------------------------------------------------- HUD
// All overlay UI lives in #hud and #start: scripts/capture.mjs removes #start and
// hides #hud/#crosshair before every shot, so a new top-level element would leak
// into captures. Children of #hud are hidden with it.
const hud = document.getElementById('hud')!;
const hudStats = document.createElement('div');
const hudMode = document.createElement('div');
const hudHelp = document.createElement('div');
hudHelp.textContent =
  'WASD move · SHIFT sprint/boost · SPACE jump/up · E up · Q/X down · ' +
  'F fly · C noclip · wheel/[ ] speed · H help · Esc free mouse · ' +
  'LMB fire · RMB aim · R reload · 1/2 or wheel weapons';
hud.append(hudStats, hudMode, hudHelp, ammoDiv);
// ---- HUD and menus. Built by the ui lane; this is the wiring step it asked for.
// initUI owns everything inside #hud and #start, so the capture harness still
// hides all of it by hiding those two ids.
const { hud: gameHud } = initUI({ player, world });

const startOverlay = document.getElementById('start')!;
// The first click lands on the overlay (it covers the canvas), so dismiss and lock
// here; later clicks hit the canvas and re-lock via Player. Esc releases (browser
// default) and Player drops held keys so nothing spins or keeps walking.
startOverlay.addEventListener('click', () => {
  startOverlay.style.display = 'none';
  world.renderer.domElement.requestPointerLock();
});
world.renderer.domElement.addEventListener('click', () => {
  startOverlay.style.display = 'none';
});
// H toggles the key legend. Owned here, not in Player, because the legend is DOM.
addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && !e.repeat) {
    hudHelp.style.display = hudHelp.style.display === 'none' ? '' : 'none';
  }
});
// Weapon input. Every handler is headless-safe (try/catch, no direct
// requestPointerLock) so capture-harness probes never trip on missing APIs.
const canvas = world.renderer.domElement;
canvas.addEventListener('mousedown', (e) => {
  try {
    if (e.button === 0 || e.button === 2) weapons.pointerDown(e.button);
  } catch { /* headless: no pointer, no weapon input */ }
});
addEventListener('mouseup', (e) => {
  try {
    if (e.button === 0 || e.button === 2) weapons.pointerUp(e.button);
  } catch { /* headless: no pointer, no weapon input */ }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyR' || e.code === 'Digit1' || e.code === 'Digit2') {
    try { weapons.keyDown(e.code); } catch { /* headless-safe */ }
  }
});
canvas.addEventListener('wheel', (e) => {
  if (player.getMode() !== 'walk') return;
  try { weapons.wheel(e.deltaY); } catch { /* headless-safe */ }
}, { passive: true });

let frames = 0;
let fps = 0;
let acc = 0;
let last = performance.now();
// Last mode/speed written to the HUD. Compared every frame so a mode toggle
// shows up immediately instead of at the next 0.5 s stats tick.
let lastMode: MoveMode = 'walk';
let lastSpeed = -1;

/**
 * When the capture harness drives a camera station it must OWN the camera. The
 * animation loop syncs the camera to the player every frame, so without this flag
 * `goto()` is overwritten before the screenshot is taken and every station silently
 * photographs the spawn view - identical stats at every station is the tell.
 */
let cameraHeldByQA = false;

function frame(): void {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;

  if (!cameraHeldByQA) {
    player.update(dt);
    const speed = Math.hypot(player.state.vel.x, player.state.vel.z);
    weapons.update(dt, now / 1000, {
      speed,
      sprinting: speed > 6.5,
      grounded: player.state.grounded,
    });
    // The WORLD goes through the post chain (GTAO/SSR/bloom/vignette); the
    // viewmodel is composited on top of the finished frame with its own cleared
    // depth, so the gun never intersects the map and never gets its own AO.
    //
    // This used to call world.renderer.render() directly, which meant the whole
    // post chain - and with it the only ambient-occlusion term in the project -
    // had NEVER run, in any frame, since it was written. post.ts said so in a
    // comment and nobody read it. That single missing call is most of why the
    // build looked flat and plastic: no contact darkening anywhere, so every
    // object read as pasted onto the ground rather than standing on it.
    world.render();
    world.renderer.clearDepth();
    const ac = world.renderer.autoClear;
    world.renderer.autoClear = false;
    world.renderer.render(weapons.overlay, world.camera);
    world.renderer.autoClear = ac;
  }

  // Weapon -> HUD. snapshot() is the controller's own read API; pushing from the
  // loop means neither lane had to know about the other's internals.
  if (!cameraHeldByQA) {
    const snap = weapons.snapshot();
    gameHud.setAmmo(snap.mag, snap.reserve);
    gameHud.setADS(snap.ads);
  }

  frames++;
  acc += dt;
  const mode = player.getMode();
  const speed = player.getFlySpeed();
  if (acc >= 0.5 || mode !== lastMode || speed !== lastSpeed) {
    fps = acc >= 0.5 ? Math.round(frames / acc) : fps;
    if (acc >= 0.5) { frames = 0; acc = 0; }
    lastMode = mode;
    lastSpeed = speed;
    const i = world.renderer.info;
    const p = player.state.pos;
    hudStats.textContent =
      fps + ' fps   ' +
      i.render.calls + ' calls   ' +
      (i.render.triangles / 1000).toFixed(0) + 'k tris   ' +
      'x ' + p.x.toFixed(1) + '  y ' + p.y.toFixed(2) + '  z ' + p.z.toFixed(1) +
      (player.state.grounded ? '' : '   [air]');
    hudMode.textContent =
      mode === 'walk'
        ? '— WALK —'
        : '— ' + (mode === 'fly' ? 'FLY' : 'FLY-NOCLIP') +
          ' · ' + speed.toFixed(0) + ' m/s (wheel / [ ] adjust, SHIFT ×3) —';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- QA surface
// The capture harness drives the map through this. Keep it small and stable.
interface QA {
  ready: boolean;
  stations: Record<string, Station>;
  goto: (name: string) => boolean;
  spawn: (team: 'a' | 'b') => void;
  release: () => void;
  stats: () => Record<string, unknown>;
  moduleStats: typeof moduleStats;
  colliderCount: number;
  render: () => void;
  probeReset: (x: number, z: number) => void;
  probeWalkTo: (tx: number, tz: number, maxSteps: number) => boolean;
  probePos: () => [number, number, number];
  collidersAt: (x: number, z: number, y?: number) => unknown[];
  /** Inspection-mode control for headless fly/noclip checks. Additive only. */
  setMode: (m: MoveMode) => void;
  mode: () => MoveMode;
  teleport: (x: number, y: number, z: number, yaw?: number, pitch?: number) => void;
  setFlySpeed: (v: number) => void;
  weaponCmd: (cmd: string, arg?: string | number | boolean) => unknown;
}

const qa: QA = {
  ready: true,
  stations: STATIONS,
  goto(name) {
    weapons.setVisible(false);
    const s = STATIONS[name];
    if (!s) return false;
    cameraHeldByQA = true;
    world.camera.position.set(s.pos[0], s.pos[1], s.pos[2]);
    world.camera.rotation.set(0, 0, 0, 'YXZ');
    world.camera.rotation.y = s.yaw;
    world.camera.rotation.x = s.pitch;
    world.camera.fov = s.fov ?? 72;
    world.camera.updateProjectionMatrix();
    world.render();          // post chain, so a capture shows what a player sees
    return true;
  },
  spawn(team) {
    const s = team === 'a' ? SPAWN_A : SPAWN_B;
    cameraHeldByQA = false;
    weapons.setVisible(true);
    // The probe and the player loop assume walk physics (gravity, step-up). A
    // leftover noclip here would silently fly later checks through walls.
    player.setMode('walk');
    player.teleport(s.x, 0, s.z, s.yaw);
  },
  release() {
    cameraHeldByQA = false;
    weapons.setVisible(true);
  },
  setMode(m) {
    player.setMode(m);
  },
  mode() {
    return player.getMode();
  },
  teleport(x, y, z, yaw = 0, pitch = 0) {
    player.teleport(x, y, z, yaw, pitch);
  },
  setFlySpeed(v) {
    player.setFlySpeed(v);
  },
  weaponCmd(cmd, arg) {
    return weapons.command(cmd, arg);
  },
  stats() {
    const i = world.renderer.info;
    return {
      fps,
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
      colliders: colliders.length,
      eyeHeight: EYE_HEIGHT,
      handedness,
      mode: player.getMode(),
      flySpeed: +player.getFlySpeed().toFixed(1),
    };
  },
  moduleStats,
  colliderCount: colliders.length,
  render() {
    // Must be world.render(), not renderer.render(): the capture harness drives
    // this, and for the whole life of the project it was photographing the scene
    // with the post chain bypassed - so every frame anyone judged the look from
    // was missing occlusion, reflection, bloom and vignette.
    world.render();
  },

  // ---- traversability probe. Drives the REAL controller at a fixed timestep.
  // probeReset forces WALK: the probe injects a horizontal world-space wish, and
  // in a fly mode that wish would leave the ground or pass through walls — every
  // route would then pass vacuously. Fly/noclip have their own QA path (setMode).
  probeReset(x, z) {
    cameraHeldByQA = true;   // stop the rAF loop double-stepping the player
    player.setMode('walk');
    player.setProbeWish(null);
    player.teleport(x, 0, z, 0);
  },
  probeWalkTo(tx, tz, maxSteps) {
    const dt = 1 / 60;
    let closest = Infinity;
    let sinceImproved = 0;
    for (let i = 0; i < maxSteps; i++) {
      const p = player.state.pos;
      const dx = tx - p.x;
      const dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7) { player.setProbeWish(null); return true; }
      // bail early once it is clearly wedged rather than burning the whole budget
      if (d < closest - 0.02) { closest = d; sinceImproved = 0; }
      else if (++sinceImproved > 120) break;
      player.setProbeWish(dx / d, dz / d);
      player.update(dt);
    }
    player.setProbeWish(null);
    return false;
  },
  probePos() {
    const p = player.state.pos;
    return [p.x, p.y, p.z];
  },
  /** Which module owns the collider blocking this spot? Answers "what IS that?". */
  collidersAt(x, z, y = 1.0) {
    const hits: unknown[] = [];
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (x < c.min.x - 0.35 || x > c.max.x + 0.35) continue;
      if (z < c.min.z - 0.35 || z > c.max.z + 0.35) continue;
      if (y < c.min.y || y > c.max.y) continue;
      hits.push({
        i,
        min: [+c.min.x.toFixed(2), +c.min.y.toFixed(2), +c.min.z.toFixed(2)],
        max: [+c.max.x.toFixed(2), +c.max.y.toFixed(2), +c.max.z.toFixed(2)],
        height: +(c.max.y - c.min.y).toFixed(2),
      });
    }
    return hits;
  },
};

(window as unknown as { __NT: QA }).__NT = qa;
console.log('[nuketown] built', Object.keys(moduleStats).length, 'modules,',
  colliders.length, 'colliders');
