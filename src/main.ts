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
import { OrdnanceScene } from './weapons/ordnance-scene';
import { initUI } from './ui/index';
import { wireNetcode } from './net/wire';
import { createCharacterSystem, type CharacterHandle } from './characters';
import { loadBakedClips } from './characters/kimodo-clips';
import { createLocalMatch, type LocalMatch, type MatchUi } from './game/session';
import { PAL } from './core/palette';
import { createWorldQuery } from './game/world-query';
import type { GameClient } from './game/client';
import {
  AC130_105_RELOAD_MS,
  AC130_25_CADENCE_MS,
  AC130_25_COOL_MS,
  AC130_25_OVERHEAT_ROUNDS,
  AC130_40_CADENCE_MS,
  AC130_40_CLIP,
  AC130_40_RELOAD_MS,
  AC130_CALIBERS,
  AC130_DURATION_MS,
  AC130_ZOOM_FOVS,
  ac130PoseAt,
  createAc130,
  type Ac130Caliber,
  type Ac130State,
} from './game/killstreaks/effects/ac130';

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
/** which module contributed colliders[i]. Answers "what IS that?" in one step
 *  instead of grepping every builder for a matching box size. */
const colliderOwner: string[] = [];
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
  for (let i = 0; i < res.colliders.length; i++) colliderOwner.push(name);
  let objects = 0;
  res.group.traverse(() => objects++);
  moduleStats[name] = {
    objects,
    colliders: res.colliders.length,
    ms: +(performance.now() - t0).toFixed(1),
  };
}
player.setColliders(colliders);

// Characters lane, wired per the contract documented in src/characters/index.ts.
// Materials are ctx.mat singletons: painted() with a new uniform set is fine, a new
// program is not. Placed on open ground the traverse routes already prove walkable,
// so a figure cannot spawn inside a wall.
// Baked Kimodo clips must be resident BEFORE the first CharacterSystem is built:
// CharacterRig creates one AnimationAction per clip in its constructor. Fifteen
// glTF clips, 350 kB, generated locally (public/anim/LICENCES.md). Top-level await
// is fine here - tsconfig and vite both target es2022.
await loadBakedClips();
const characters = createCharacterSystem(world.scene, {
  // `material` is the shipped path: ONE ctx.mat singleton for the whole figure,
  // with the dress carried per-vertex by the baked skinned mesh, so a figure is
  // one draw per pass instead of twenty-seven. skin/cloth/dark stay for the
  // headless demo page, which has no vertex-colour material of its own.
  material: mat.operator(),
  skin: mat.painted(PAL.opSkin, 0.78, 0),
  cloth: mat.painted(PAL.opFatigueTan, 0.84, 0),
  dark: mat.painted(PAL.opBoot, 0.86, 0),
  // Two sides, separated at 20 m by BOTH headgear silhouette and cloth value:
  // sand fatigues under a ballistic helmet, olive fatigues under a patrol cap.
  // Assigned round-robin in spawn order - CharacterSystem.spawn() takes no
  // faction argument and src/characters/system.ts is not this lane's file.
  factions: [
    {
      head: 'helmet',
      skin: PAL.opSkin,
      fatigue: PAL.opFatigueTan,
      helmet: PAL.opHelmetTan,
      webbing: PAL.opWebbing,
      boot: PAL.opBoot,
    },
    {
      head: 'cap',
      skin: PAL.opSkin,
      fatigue: PAL.opFatigueOlive,
      helmet: PAL.opHelmetOlive,
      webbing: PAL.opWebbingDark,
      boot: PAL.opBoot,
    },
  ],
});
for (const [cx, cz, cyaw] of [
  [-6.5, -9.0, 0.6], [6.0, -6.0, -1.2], [-8.0, 6.5, 2.4],
  [5.5, 9.0, 3.0], [0.0, -12.5, 1.5], [-2.0, 12.0, -0.4],
] as const) {
  characters.spawn(cx, cz, cyaw);
}
player.teleport(SPAWN_A.x, 0, SPAWN_A.z, SPAWN_A.yaw);
// The trigger is a CLAIM, not a verdict: the host resolves damage (IMPORT-PLAN s2).
let match: LocalMatch | null = null;
const weapons = new WeaponsController({
  camera: world.camera,
  scene: world.scene,
  mat,
  targets: worldTargets,
  // The game HUD reads the controller snapshot below; a second ammo line here
  // duplicated it over the minimap.
  onHud: () => undefined,
  onShot: (claim) => match?.localShot(claim),
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
  'LMB fire · RMB aim · R reload · 1/2 or wheel weapons · ' +
  'G frag (hold to cook) · Q tactical · V knife · hold E pick up';
hud.append(hudStats, hudMode, hudHelp);
// ---- HUD and menus. Built by the ui lane; this is the wiring step it asked for.
// initUI owns everything inside #hud and #start, so the capture harness still
const ui = initUI({ player, world });
const gameHud = ui.hud;
// ---- Multiplayer lobby + host tech (netcode lane). Owns #hud .nt-* nodes and
// window.__NTNET only; the world, player and QA surface are untouched.
const netcode = wireNetcode({ player });
void netcode;
// ---- Ordnance (grenades, smoke placeholder, drops, flash white-out, pickup
// prompt). It reads the live GameClient, so the session's `bindClient` call is
// forwarded through it before it reaches the UI - the one seam the session
// offers, and it fires again on every rematch.
const ordnance = new OrdnanceScene({ scene: world.scene, mat, colliders, hud: gameHud, weapons });
// Live smoke feed: game smoke events drive the volumetric pass (pull route,
// zero alloc, no light-set change). Null client reads as empty.
world.atmosphere.smoke.bind(() => ordnance.smokes);
// ---- AC-130 possession (gunner seat). The host owns damage; this owns the
// camera, the seat controls and the overlay, and submits aimed fire missions
// (crosshair anchor + caliber) that the host resolves through the same
// stepper the autopilot uses. The client handle arrives over the session's
// `bindClient` seam — the same seam ordnance uses. Seat truth (possessed)
// stays host-authored in `game/client.ts`; caliber/zoom/thermal are
// seat-local, caliber included, and the anchor rides the mission press.
let gunnerClient: GameClient | null = null;
// Read-only collider port for the gunner's crosshair solve. Same boxes the
// session built its own port from, so the seat and the host name one ground.
const gunnerQuery = createWorldQuery(colliders);
const gunnerAimDir = new THREE.Vector3();
/**
 * Crosshair ray → ground column for fire missions. Marches until the ray
 * sinks to standable ground, else the farthest standable column on a
 * level aim; sky aim names nothing and the trigger holds its fire.
 */
function solveGunnerAnchor(): { x: number; y: number; z: number } | null {
  world.camera.getWorldDirection(gunnerAimDir);
  const cp = world.camera.position;
  const len = gunnerAimDir.length();
  if (!Number.isFinite(len) || len < 1e-6) return null;
  const nx = gunnerAimDir.x / len;
  const ny = gunnerAimDir.y / len;
  const nz = gunnerAimDir.z / len;
  let farthest: { x: number; y: number; z: number } | null = null;
  for (let t = 0.5; t <= 120; t += 0.5) {
    const x = cp.x + nx * t;
    const z = cp.z + nz * t;
    const g = gunnerQuery.groundY(x, z);
    if (!Number.isFinite(g)) continue;
    if (gunnerQuery.inBounds(x, z)) farthest = { x, y: g, z };
    if (cp.y + ny * t <= g + 0.15) return { x, y: g, z };
  }
  if (ny > 0.05) return null;
  return farthest;
}
const gunner = {
  active: false,
  slot: 0,
  pendingSlot: 0,
  mountedAt: 0,
  orbit: null as Ac130State | null,
  caliber: '40mm' as Ac130Caliber,
  zoomStep: 0,
  thermal: false,
  savedFov: 72,
  triggerHeld: false,
  firingUntil: 0,
  last105: Number.NEGATIVE_INFINITY,
  last40: Number.NEGATIVE_INFINITY,
  last25: Number.NEGATIVE_INFINITY,
  clip40: AC130_40_CLIP,
  reloadUntil40: 0,
  heat25: 0,
  overheatUntil25: 0,
};

/** Local mirror of the sim's per-gun gates, so the HUD reload bars and the
 *  trigger tell the truth about the seat. Same constants, same rules. */
function gunnerTickMirror(now: number): void {
  if (gunner.clip40 === 0 && now >= gunner.reloadUntil40) gunner.clip40 = AC130_40_CLIP;
  if (gunner.overheatUntil25 > 0 && now >= gunner.overheatUntil25) {
    gunner.heat25 = 0;
    gunner.overheatUntil25 = 0;
  }
}

function gunnerCanFire(caliber: Ac130Caliber, now: number): boolean {
  if (caliber === '105mm') return now - gunner.last105 >= AC130_105_RELOAD_MS;
  if (caliber === '40mm') {
    return now >= gunner.reloadUntil40 && gunner.clip40 > 0 && now - gunner.last40 >= AC130_40_CADENCE_MS;
  }
  return now >= gunner.overheatUntil25 && now - gunner.last25 >= AC130_25_CADENCE_MS;
}

function gunnerRecordFire(caliber: Ac130Caliber, now: number): void {
  if (caliber === '105mm') {
    gunner.last105 = now;
  } else if (caliber === '40mm') {
    gunner.last40 = now;
    gunner.clip40 -= 1;
    if (gunner.clip40 <= 0) gunner.reloadUntil40 = now + AC130_40_RELOAD_MS;
  } else {
    gunner.last25 = now;
    gunner.heat25 += 1;
    if (gunner.heat25 >= AC130_25_OVERHEAT_ROUNDS) gunner.overheatUntil25 = now + AC130_25_COOL_MS;
  }
  gunner.firingUntil = now + 150;
}

function gunnerReady(caliber: Ac130Caliber, now: number): number {
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  if (caliber === '105mm') return clamp01((now - gunner.last105) / AC130_105_RELOAD_MS);
  if (caliber === '40mm') {
    if (now < gunner.reloadUntil40) return clamp01(1 - (gunner.reloadUntil40 - now) / AC130_40_RELOAD_MS);
    return gunner.clip40 / AC130_40_CLIP;
  }
  if (gunner.overheatUntil25 > now) return clamp01(1 - (gunner.overheatUntil25 - now) / AC130_25_COOL_MS);
  return 1 - gunner.heat25 / AC130_25_OVERHEAT_ROUNDS;
}

function mountGunner(): void {
  const st = player.state;
  gunner.active = true;
  gunner.slot = gunner.pendingSlot;
  gunner.mountedAt = performance.now();
  gunner.orbit = createAc130(0, 'you', 0, 'ac130-gunship', AC130_DURATION_MS,
    { x: st.pos.x, y: st.pos.y, z: st.pos.z }, 0);
  gunner.caliber = '40mm';
  gunner.zoomStep = 0;
  gunner.thermal = false;
  gunner.triggerHeld = false;
  gunner.last105 = Number.NEGATIVE_INFINITY;
  gunner.last40 = Number.NEGATIVE_INFINITY;
  gunner.last25 = Number.NEGATIVE_INFINITY;
  gunner.clip40 = AC130_40_CLIP;
  gunner.reloadUntil40 = 0;
  gunner.heat25 = 0;
  gunner.overheatUntil25 = 0;
  gunner.savedFov = world.camera.fov;
  world.camera.fov = AC130_ZOOM_FOVS[0] as number;
  world.camera.updateProjectionMatrix();
}

function dismountGunner(): void {
  if (!gunner.active) return;
  gunner.active = false;
  gunner.triggerHeld = false;
  gunner.orbit = null;
  try { gunnerClient?.gunnerDismount(); } catch { /* headless-safe */ }
  try { world.post.setThermal(false); } catch { /* headless-safe */ }
  world.camera.fov = gunner.savedFov;
  world.camera.updateProjectionMatrix();
  gameHud.setGunner(null);
}

function selectGunnerCaliber(caliber: Ac130Caliber): void {
  if (!AC130_CALIBERS.includes(caliber)) return;
  gunner.caliber = caliber;
  try { gunnerClient?.gunnerSelectCaliber(caliber); } catch { /* headless-safe */ }
}

function setGunnerZoom(zoomStep: number): void {
  const z = Math.max(0, Math.min(AC130_ZOOM_FOVS.length - 1, Math.floor(zoomStep)));
  if (z === gunner.zoomStep) return;
  gunner.zoomStep = z;
  try { gunnerClient?.gunnerSetZoom(z); } catch { /* headless-safe */ }
  world.camera.fov = AC130_ZOOM_FOVS[z] as number;
  world.camera.updateProjectionMatrix();
}

function setGunnerThermal(on: boolean): void {
  gunner.thermal = on === true;
  try { gunnerClient?.gunnerSetThermal(gunner.thermal); } catch { /* headless-safe */ }
  try { world.post.setThermal(gunner.thermal); } catch { /* headless-safe */ }
}

const matchUi: MatchUi = {
  bindClient: (c) => { gunnerClient = c; if (c === null) dismountGunner(); ordnance.bind(c); ui.bindClient(c); },
  setNames: (n) => ui.setNames(n),
};
// ---- The match. Host + local player + bots, started by the same click that
// dismisses the lobby overlay, so nothing runs before a player asks for it.
match = createLocalMatch({
  colliders, ui: matchUi, placeLocal: (x, y, z, yaw) => player.teleport(x, y, z, yaw),
});
const botBodies = new Map<string, CharacterHandle>();

const startOverlay = document.getElementById('start')!;
// The first click lands on the overlay (it covers the canvas), so dismiss and lock
// here; later clicks hit the canvas and re-lock via Player. Esc releases (browser
// default) and Player drops held keys so nothing spins or keeps walking.
startOverlay.addEventListener('click', () => {
  startOverlay.style.display = 'none';
  match?.begin();
  // requestPointerLock returns a PROMISE in current Chrome, so a refusal is an
  // unhandled rejection, not a throw - which is the PAGEERROR WrongDocumentError
  // every playcap run has been printing. try/catch alone never caught it.
  try { void Promise.resolve(world.renderer.domElement.requestPointerLock()).catch(() => {}); } catch { /* no API */ }
});
world.renderer.domElement.addEventListener('click', () => {
  startOverlay.style.display = 'none';
  match?.begin();
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
  // Possession owns the trigger: LMB holds the guns, RMB cycles the caliber.
  // Nothing reaches the weapons controller while riding the gun.
  if (gunner.active) {
    if (e.button === 0) gunner.triggerHeld = true;
    else if (e.button === 2) {
      const i = AC130_CALIBERS.indexOf(gunner.caliber);
      selectGunnerCaliber(AC130_CALIBERS[(i + 1) % AC130_CALIBERS.length] as Ac130Caliber);
    }
    return;
  }
  try {
    if (e.button === 0 || e.button === 2) weapons.pointerDown(e.button);
  } catch { /* headless: no pointer, no weapon input */ }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) gunner.triggerHeld = false;
  try {
    if (e.button === 0 || e.button === 2) weapons.pointerUp(e.button);
  } catch { /* headless: no pointer, no weapon input */ }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // Possession owns Digit1-3 (calibers), T (thermal) and the owning slot key
  // (dismount). Everything else a gunner presses is suppressed: the body
  // stays where it was left, and no second platform stacks onto this one.
  if (gunner.active) {
    const owned = ['Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code) + 1;
    if (owned === gunner.slot && owned >= 1) {
      match?.pressStreak(gunner.slot);
      dismountGunner();
      return;
    }
    if (e.code === 'Digit1') { selectGunnerCaliber('105mm'); return; }
    if (e.code === 'Digit2') { selectGunnerCaliber('40mm'); return; }
    if (e.code === 'Digit3' && gunner.slot !== 1) { selectGunnerCaliber('25mm'); return; }
    if (e.code === 'KeyT') { setGunnerThermal(!gunner.thermal); return; }
    return;
  }
  if (e.code === 'KeyR' || e.code === 'Digit1' || e.code === 'Digit2') {
    try { weapons.keyDown(e.code); } catch { /* headless-safe */ }
  }
  // G/Q grenades, V knife, E use - on foot only: E and Q are fly-mode
  // up/down in core/player.ts, and a knife thrown from noclip is not a game.
  if ((e.code === 'KeyG' || e.code === 'KeyQ' || e.code === 'KeyV' || e.code === 'KeyE') && player.getMode() === 'walk') {
    try { weapons.keyDown(e.code); } catch { /* headless-safe */ }
  }
  // 3-6 are the four killstreak slots. A press always answers, even when it
  // is refused - a dead key is the defect IMPORT-PLAN s5.4 is written about.
  const slot = ['Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
  if (slot >= 0) {
    gunner.pendingSlot = slot + 1;
    match?.pressStreak(slot + 1);
  }
});
addEventListener('keyup', (e) => {
  try { weapons.keyUp(e.code); } catch { /* headless-safe */ }
});
canvas.addEventListener('wheel', (e) => {
  // Possession owns the wheel: three FOV steps, in on wheel-up, out on down.
  if (gunner.active) {
    setGunnerZoom(gunner.zoomStep + (e.deltaY < 0 ? 1 : -1));
    return;
  }
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
  // Per-frame counters. The WebGPU renderer's info accumulates across the session, so
  // stats().calls read 2192 -> 4116 -> 5754 across four captures and could not be
  // compared with the 1200-call budget in AGENTS.md. Reset at the top of every frame;
  // a stats() read between frames then reports the LAST frame, which is the number a
  // budget is about. (Memory counts are not touched by reset().)
  //
  // autoReset must be OFF: with it on, Info resets at the start of EVERY render() call,
  // and the post chain makes several per frame, so a read between frames saw only the
  // final quad pass - 1 draw call, 2 triangles - which is why triangles read 0.
  if (world.renderer.info.autoReset) world.renderer.info.autoReset = false;
  world.renderer.info.reset();

  if (!cameraHeldByQA) {
    player.update(dt);
    const speed = Math.hypot(player.state.vel.x, player.state.vel.z);
    weapons.update(dt, now / 1000, {
      speed,
      sprinting: speed > 6.5,
      grounded: player.state.grounded,
    });
    // POSSESSION. After the player writes the camera, the gun takes it: ride
    // the locally mirrored pylon turn and look down the column. The seat
    // mounts on the host activation edge (seen via the client projection)
    // and leaves on death, expiry, match end — or the owning slot key.
    if (gunnerClient !== null) {
      const seat = gunnerClient.gunnerView();
      if (!gunner.active && seat.possessed) mountGunner();
    }
    if (gunner.active) {
      const seat = gunnerClient === null ? null : gunnerClient.gunnerView();
      const view = gunnerClient === null ? null : gunnerClient.view();
      const lifetimeLeft = AC130_DURATION_MS - (now - gunner.mountedAt);
      if (seat === null || !seat.possessed || view === null || !view.alive
        || view.match.phase !== 'active' || lifetimeLeft <= 0) {
        dismountGunner();
      } else {
        gunnerTickMirror(now);
        // Live fire mission: crosshair anchor + seat caliber, throttled by
        // the same mirror the HUD bars read. The host resolves damage
        // through the gun stepper; the mirror only paces submissions.
        if (gunner.triggerHeld && gunnerCanFire(gunner.caliber, now) && match !== null) {
          const aim = solveGunnerAnchor();
          if (aim !== null) {
            match.pressStreakAt(gunner.slot, aim, gunner.caliber);
            gunnerRecordFire(gunner.caliber, now);
          }
        }
        // Host truth steers the camera: the seat mirror's local orbit is
        // display-only fallback until the first pose lands. Ground point is
        // the orbit centre the host publishes with every pose.
        const pose = view.ac130Pose;
        if (pose !== null) {
          world.camera.position.set(pose.x, pose.y, pose.z);
          const gy = match?.groundY(pose.cx, pose.cz) ?? 0;
          world.camera.lookAt(pose.cx, gy, pose.cz);
        } else {
          const orbit = gunner.orbit;
          if (orbit !== null) {
            const fallback = ac130PoseAt(orbit, now - gunner.mountedAt);
            world.camera.position.set(fallback.x, fallback.y, fallback.z);
            world.camera.lookAt(orbit.centreX, orbit.centreY, orbit.centreZ);
          }
        }
        gameHud.setGunner({
          caliber: gunner.caliber,
          zoomFov: AC130_ZOOM_FOVS[gunner.zoomStep] as number,
          thermal: gunner.thermal,
          remainingMs: lifetimeLeft,
          firing: now < gunner.firingUntil,
          ready: [
            gunnerReady('105mm', now),
            gunnerReady('40mm', now),
            gunnerReady('25mm', now),
          ],
        });
      }
    }
    // RENDER PATH. The world goes through the post chain (GTAO / SSR / bloom / vignette),
    // and the viewmodel composites over the finished frame with depth cleared so the
    // gun can never intersect the map. `?post=off` and `?post=ao` swap the chain's
    // output node for a diagnostic one inside core/post.ts; they do NOT change the
    // route, so what you measure there is what the player is looking at.
    //
    // This used to branch on `?post=chain` because the chain shipped a BLACK world
    // from here while working from the capture harness. Two separate faults, both
    // now fixed in core/post.ts - read the note at the top of that file before
    // touching this block, and re-run `node scripts/playcap.mjs --tag chain
    // --query "post=chain"`, which photographs THIS loop and fails on a dark frame.
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

  // ---- Game tick and bodies. characters.update() runs FIRST: it integrates
  // its own root motion, and the authoritative bot pose written just after is
  // what survives. One rig for players, bots and corpses - a bot is hidden by
  // nothing and substituted by nothing (AGENTS.md durable gotcha).
  if (!cameraHeldByQA && match) {
    characters.update(dt, world.camera.position);
    const st = player.state;
    match.tick(now, st.pos.x, st.pos.y, st.pos.z, st.yaw, st.pitch);
    ordnance.update(dt, now, st.pos.x, st.pos.y, st.pos.z);
    for (const b of match.bots()) {
      let h = botBodies.get(b.id);
      if (!h) { h = characters.spawn(b.x, b.z, b.yaw); botBodies.set(b.id, h); }
      h.root.position.set(b.x, b.y, b.z);
      h.root.rotation.y = b.yaw;
      h.yaw = b.yaw;
      h.input.speed = b.alive ? b.speed : 0;
      if (b.alive && h.rig.isDead) h.rig.revive();
      else if (!b.alive && !h.rig.isDead) h.rig.playDeath();
    }
    // Rematch may field a different roster: despawn rigs whose bots are gone
    // so stale bodies never stand around the new match.
    for (const [id, h] of botBodies) {
      if (!match.bots().some((b) => b.id === id)) { characters.despawn(h); botBodies.delete(id); }
    }
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
  /** Ordnance lane: the client projection's log, counts and pools. Read-only. */
  ordnance: () => Record<string, unknown>;
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
  ordnance() {
    return ordnance.qa();
  },
  stats() {
    const i = world.renderer.info;
    return {
      fps,
      // per-frame (frame() resets Info at the top of each frame with autoReset off):
      // drawCalls and triangles are what the 1200-call / 900k-tri budget is about.
      // render.calls is the number of render() invocations since page load - useful
      // as a liveness counter, useless as a budget, so it is exposed under its own name.
      calls: i.render.drawCalls,
      renderCallsTotal: i.render.calls,
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
        owner: colliderOwner[i],
        min: [+c.min.x.toFixed(2), +c.min.y.toFixed(2), +c.min.z.toFixed(2)],
        max: [+c.max.x.toFixed(2), +c.max.y.toFixed(2), +c.max.z.toFixed(2)],
        height: +(c.max.y - c.min.y).toFixed(2),
      });
    }
    return hits;
  },
};

(window as unknown as { __NT: QA }).__NT = qa;
// The match's QA surface, additive and read-only: the integration proof drives
// the REAL built page and reads the host's own snapshot through it, because a
// proof that instantiates the modules itself is not evidence that the shipped
// bundle runs a match (HANDOFF s2, and IMPORT-PLAN s5.7). It is published HERE
// rather than in `game/session.ts` because `src/game/` is DOM-free by contract
// and this file is the one that already owns every window global.
(window as unknown as { __NTGAME: LocalMatch | null }).__NTGAME = match;
console.log('[nuketown] built', Object.keys(moduleStats).length, 'modules,',
  colliders.length, 'colliders');
