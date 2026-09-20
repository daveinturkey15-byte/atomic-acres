/**
 * Assembly. main.ts owns the scene; builders never do.
 *
 * Adding a module is one line in BUILDERS. That is the whole extension point -
 * there is deliberately no registry framework, no plugin loader and no pass system.
 */
import * as THREE from 'three';
import { createWorld } from './core/world';
import { buildMaterials } from './core/materials';
import { installArchitecturalMaterials } from './core/architectural-materials';
import { installReflectiveSurfaces } from './core/reflective-surfaces';
import { makeRng, type AABB, type BuildContext, type Builder } from './core/kit';
import { Player, type MoveMode } from './core/player';
import { presentBody } from './characters/body-presentation';
import { SPAWN_A, SPAWN_B, EYE_HEIGHT, HOUSES, garageIsOnTheRight } from './core/layout';
import { STATIONS, type Station } from './core/stations';
import { WeaponsController } from './weapons/controller';
import { isCrossbowCanaryOptIn } from './weapons/crossbow-runtime';
import { OrdnanceScene } from './weapons/ordnance-scene';
import { initUI } from './ui/index';
import { wireNetcode } from './net/wire';
import { createCharacterSystem, type CharacterHandle } from './characters';
import { isAuthoredOperatorEnabled, preloadAuthoredOperator } from './characters/operator-authored';
import { disposeWorldWeaponArt } from './characters/world-weapon-art';
import { ThrowBodyPresentation } from './characters/throw-body';
import { loadBakedClips } from './characters/kimodo-clips';
import { createLocalMatch, type LocalMatch, type MatchUi } from './game/session';
import { PAL } from './core/palette';
import { loadLoadout, resolveLoadout } from './game/loadout';
import { WorldAudio } from './audio/world-audio';
import { createStaticReflectionProbe, type StaticReflectionProbe } from './core/static-reflection-probe';
import { createCombatFeedbackAdapter } from './ui/combat-feedback-adapter';
import './ui/combat-feedback.css';
import { getEnvironmentFlags } from './core/environment-flags';
import { installLawnCanaryQA } from './core/lawn-canary-qa';
import { isAuthoredMountainsOptIn } from './build/authored-mountains';
import { isMountainTerrainOptIn } from './build/mountain-terrain';
import { preloadAssets, releaseAsset } from './core/assets';

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
import { buildFieldCases } from './build/field-cases';
import { loadFieldCase } from './assets/field-case';
import { buildIndustrialBarrels } from './build/industrial-barrels';
import { preloadIndustrialBarrel } from './props/industrial-barrel';
import { buildDesertTrees } from './build/desert-trees';
import { preloadQuiverTree } from './props/quiver-tree';
import {
  coachOwnedCanaryReport,
  isCoachOwnedCanaryOptIn,
  preloadCoachOwnedCanary,
  releaseCoachOwnedCanary,
} from './build/coach-owned-canary';
import { buildFacadeDetailCanary } from './build/facade-detail-canary';
import { buildOrangeFacadeKitGated, isOrangeFacadeKitOptIn } from './build/orange-facade-kit';

/** Facade detail canary opt-in: ?facade=canary only. Any absent or other value
 * keeps the baseline registry untouched. The __NT_OVERRIDE global exists so CPU
 * and browser QA can force the lane without a query string. Same shape as
 * isMountainTerrainOptIn() in ./build/mountain-terrain. */
function isFacadeDetailCanaryOptIn(): boolean {
  const g = globalThis as { __NT_OVERRIDE_FACADE_DETAIL__?: boolean };
  if (typeof g.__NT_OVERRIDE_FACADE_DETAIL__ === 'boolean') return g.__NT_OVERRIDE_FACADE_DETAIL__;
  if (typeof window !== 'undefined' && window.location?.search) {
    const v = new URLSearchParams(window.location.search).get('facade')?.toLowerCase();
    return v === 'canary';
  }
  return false;
}

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
  ['field-cases', buildFieldCases],
  ['industrial-barrels', buildIndustrialBarrels],
  ['desert-trees', buildDesertTrees],
];

// Facade detail canary: opt-in dressing only (?facade=canary). Without the flag
// the registry above is untouched: zero extra draws, zero colliders, no light,
// material or collider changes. Remove the entry to revert.
if (isFacadeDetailCanaryOptIn()) {
  BUILDERS.splice(3, 0, ['facade-detail-canary', buildFacadeDetailCanary]);
}

// Orange facade kit: opt-in dressing only (?facade-kit=canary). Without the
// flag the registry above is untouched: zero extra draws, zero colliders, no
// light, material or collider changes. Remove the entry to revert. Gated
// wrapper falls back to an empty group on any load failure, so the baseline
// house always survives. Independent batch tag 'orange-facade-kit'.
if (isOrangeFacadeKitOptIn()) {
  BUILDERS.splice(4, 0, ['orange-facade-kit', buildOrangeFacadeKitGated]);
}

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
await installArchitecturalMaterials(mat);
installLawnCanaryQA(mat.lawn);
const player = new Player(world.camera, world.renderer.domElement);

const colliders: AABB[] = [];
/** which module contributed colliders[i]. Answers "what IS that?" in one step
 *  instead of grepping every builder for a matching box size. */
const colliderOwner: string[] = [];
const moduleStats: Record<string, { objects: number; colliders: number; ms: number }> = {};
const worldTargets: THREE.Object3D[] = [];

// Load the reviewed asset once before scene assembly. A failed optional prop
// remains absent instead of blocking the playable map or retrying each frame.
await Promise.all([
  loadFieldCase().catch((error: unknown) => console.warn('[field-case] unavailable', error)),
  // Authored mountains GLB: opt-in only (?mountains=authored). Baseline and
  // canary runs must not fetch the file at all - no request, no 404 noise.
  // A miss warns once and the skyline keeps the procedural canary fallback.
  ...(isAuthoredMountainsOptIn()
    ? [preloadAssets(['authored-mountains']).catch((error: unknown) => console.warn('[authored-mountains] unavailable, canary fallback', error))]
    : []),
  // Connected mountain terrain GLB: opt-in only (?mountains=terrain).
  // Same fetch guard as authored: baseline, authored and canary runs must
  // not fetch the file at all. A miss warns once, canary fallback holds.
  ...(isMountainTerrainOptIn()
    ? [preloadAssets(['mountain-terrain']).catch((error: unknown) => console.warn('[mountain-terrain] unavailable, canary fallback', error))]
    : []),
  preloadIndustrialBarrel().catch((error: unknown) => console.warn('[industrial-barrel] unavailable', error)),
  preloadQuiverTree().catch((error: unknown) => console.warn('[quiver-tree] unavailable', error)),
  // Owned coach canary (?coach=canary only): opt-in fetch guard like the
  // mountains above - baseline runs never fetch. The preload resolves
  // 'ready' or 'fallback' and never rejects, so a missing file or a slow
  // fetch (8s bound) degrades to the procedural coach inside the same await.
  ...(isCoachOwnedCanaryOptIn() ? [preloadCoachOwnedCanary()] : []),
]);

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
installReflectiveSurfaces(world.scene, mat, world.atmosphere);
player.setColliders(colliders);
world.atmosphere.setRainShelter(worldTargets);

// Characters lane, wired per the contract documented in src/characters/index.ts.
// Materials are ctx.mat singletons: painted() with a new uniform set is fine, a new
// program is not. Placed on open ground the traverse routes already prove walkable,
// so a figure cannot spawn inside a wall.
// Baked Kimodo clips must be resident BEFORE the first CharacterSystem is built:
// CharacterRig creates one AnimationAction per clip in its constructor. Sixteen
// glTF clips, 350 kB, generated locally (public/anim/LICENCES.md). Top-level await
// is fine here - tsconfig and vite both target es2022.
await loadBakedClips();
// Authored sand operator GLB: opt-in only (?operator=authored). Bounded 8s
// preload BEFORE the first CharacterSystem — dressAuthored adopts the shared
// cache; a miss resolves null and every figure keeps the procedural dress.
if (isAuthoredOperatorEnabled()) {
  await preloadAuthoredOperator().catch((error: unknown) => {
    console.warn('[operator] authored GLB unavailable, procedural fallback', error);
    return null;
  });
}
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
// Inspection figures are not match actors: never populate a live arena with
// six invulnerable, motionless soldiers that players mistake for enemies.
if (new URLSearchParams(location.search).get('operator-demo') === '1') for (const [cx, cz, cyaw] of [
  [-6.5, -9.0, 0.6], [6.0, -6.0, -1.2], [-8.0, 6.5, 2.4],
  [5.5, 9.0, 3.0], [0.0, -12.5, 1.5], [-2.0, 12.0, -0.4],
] as const) {
  characters.spawn(cx, cz, cyaw);
}
player.teleport(SPAWN_A.x, 0, SPAWN_A.z, SPAWN_A.yaw);
const ammoDiv = document.createElement('div');
// The trigger is a CLAIM, not a verdict: the host resolves damage (IMPORT-PLAN s2).
let match: LocalMatch | null = null;
// Crossbow canary, bounded opt-in (`?crossbow=canary` only). Read once here so
// the controller's weapon list and the session's host flag share one source;
// absent or any other value keeps the gated id listed nowhere and admitted nowhere.
const crossbowCanary = isCrossbowCanaryOptIn(typeof window !== 'undefined' ? window.location.search : undefined);
const weapons = new WeaponsController({
  camera: world.camera,
  scene: world.scene,
  mat,
  targets: worldTargets,
  onHud: (line) => { ammoDiv.textContent = line; },
  onShot: (claim) => match?.localShot(claim),
  crossbowCanary,
});
// Share the already-baked sky for rough-metal reflections on held weapons.
// The world owns this texture; the overlay neither allocates nor disposes it.
weapons.overlay.environment = world.scene.environment;

// ---------------------------------------------------------------- HUD
// All overlay UI lives in #hud and #start: scripts/capture.mjs removes #start and
// hides #hud/#crosshair before every shot, so a new top-level element would leak
// into captures. Children of #hud are hidden with it.
const hud = document.getElementById('hud')!;
const hudStats = document.createElement('div');
const hudMode = document.createElement('div');
const hudHelp = document.createElement('div');
hudHelp.textContent =
  'WASD move · SHIFT sprint · SPACE jump · ' +
  'H help · Esc pause · ' +
  'LMB fire · RMB aim · R reload · 1/2 or wheel weapons · ' +
  'G frag (hold to cook) · Q tactical · V knife · hold E pick up · C / CTRL crouch · Z prone';
ammoDiv.classList.add('hud-debug');
hud.append(hudStats, hudMode, hudHelp, ammoDiv);
// ---- HUD and menus. Built by the ui lane; this is the wiring step it asked for.
// initUI owns everything inside #hud and #start, so the capture harness still
const ui = initUI({ player, world, audio: {
  setVolumes(master, effects) {
    weapons.setMasterVolume(master);
    weapons.setEffectsVolume(effects);
  },
} });
const gameHud = ui.hud;
const combatFeedback = createCombatFeedbackAdapter({
  hud,
  camera: world.camera,
  match: () => match,
});
// ---- Multiplayer lobby + host tech (netcode lane). Owns #hud .nt-* nodes and
// window.__NTNET only; the world, player and QA surface are untouched.
const netcode = wireNetcode({ player });
void netcode;
// ---- Ordnance (grenades, volumetric smoke, drops, flash white-out, pickup
// prompt). It reads the live GameClient, so the session's `bindClient` call is
// forwarded through it before it reaches the UI - the one seam the session
// offers, and it fires again on every rematch.
const ordnance = new OrdnanceScene({
  scene: world.scene, mat, colliders, hud: gameHud, weapons,
  volumetricSmoke: () => world.post.enabled,
});
// Third-person grenade-throw bodies. Same seam as every other ordnance
// reader: cues come off the client's projection, resolved onto bot bodies.
const throwBodies = new ThrowBodyPresentation();
const worldAudio = new WorldAudio(worldTargets, mat, weapons, colliders,
  (a, b) => match?.los(a.x, a.y, a.z, b.x, b.y, b.z) ?? true);
const matchUi: MatchUi = {
  bindClient: (c) => {
    combatFeedback.reset();
    // Client projection is the common solo/host/guest boundary. Rebinding also
    // releases the previous match's smoke list; no bus subscription can leak.
    world.atmosphere.smoke.bind(c ? () => c.ordnance.smokes : null);
    ordnance.bind(c);
    throwBodies.bind(c ? c.ordnance : null);
    worldAudio.bindClient(c);
    ui.bindClient(c);
  },
  setNames: (n) => ui.setNames(n),
  onEvent: (e) => combatFeedback.onEvent(e),
  resetPresentation: () => combatFeedback.reset(),
};
// ---- The match. Host + local player + bots, started by the same click that
// dismisses the lobby overlay, so nothing runs before a player asks for it.
match = createLocalMatch({
  colliders, ui: matchUi,
  localPrimaryId: () => resolveLoadout(loadLoadout()).primary,
  placeLocal: (x, y, z, yaw) => {
    player.teleport(x, y, z, yaw);
    player.setStance('stand');
  },
  crossbowCanary,
});
const botBodies = new Map<string, CharacterHandle>();

const startOverlay = document.getElementById('start')!;
// Decode the small authored bank on the first menu gesture, before the first
// shot, while retaining browser autoplay rules and persisted volume values.
startOverlay.addEventListener('pointerdown', () => weapons.resumeAudio(), { once: true });
// Candidate-geometry release. The ONLY thing this touches is owned canary geometry
// (distant-mountains canary on the skyline module); shared singleton materials stay
// live because rendering continues. Idempotent by construction (the factory guards
// re-entry), so pagehide and QA can share it. Does not touch arbitrary unrelated
// userData disposers on other scene targets.
function releaseEnvironmentCanary(): void {
  for (const target of worldTargets) {
    if (target.name !== 'skyline') continue;
    const userData: unknown = target.userData;
    if (userData && typeof userData === 'object' && 'dispose' in userData) {
      const release = (userData as { dispose?: unknown }).dispose;
      if (typeof release === 'function') {
        try {
          release();
        } catch {
          /* a torn-down backdrop must never break page teardown */
        }
      }
    }
    const canary = target.getObjectByName('distant_mountains_canary');
    if (canary?.userData && typeof canary.userData === 'object' && 'dispose' in canary.userData) {
      const release = (canary.userData as { dispose?: unknown }).dispose;
      if (typeof release === 'function') {
        try {
          release();
        } catch {
          /* idempotent release */
        }
      }
    }
    const terrain = target.getObjectByName('mountain_terrain');
    if (terrain?.userData && typeof terrain.userData === 'object' && 'dispose' in terrain.userData) {
      const release = (terrain.userData as { dispose?: unknown }).dispose;
      if (typeof release === 'function') {
        try {
          release();
        } catch {
          /* idempotent release */
        }
      }
    }
    const authored = target.getObjectByName('authored_mountains');
    if (authored?.userData && typeof authored.userData === 'object' && 'dispose' in authored.userData) {
      const release = (authored.userData as { dispose?: unknown }).dispose;
      if (typeof release === 'function') {
        try {
          release();
        } catch {
          /* idempotent release */
        }
      }
    }
    // muse-1020 seam: same double-registration pattern for the mountain volume.
    // The skyline-level userData.dispose above already releases it; this named
    // lookup collapses to the same idempotent no-op, and covers the subgroup
    // if the skyline key is ever overwritten. No other target is touched.
    const volume = target.getObjectByName('mountain_volume_muse_1010');
    if (volume?.userData && typeof volume.userData === 'object' && 'dispose' in volume.userData) {
      const release = (volume.userData as { dispose?: unknown }).dispose;
      if (typeof release === 'function') {
        try {
          release();
        } catch {
          /* idempotent release */
        }
      }
    }
  }
  // Clones are detached above; now retire the cached master for the rest of
  // the page lifetime. Exactly-once, pending-load safe, coach untouched; a
  // no-op (and a fetch guard) when the authored lane never loaded.
  releaseAsset('authored-mountains');
  // Same retirement for the terrain master; a no-op when ?mountains=terrain
  // never loaded. The shared releaseAsset path disposes exactly once and
  // never touches coach or scene objects.
  releaseAsset('mountain-terrain');
}
addEventListener('pagehide', () => {
  releaseEnvironmentCanary();
  releaseCoachOwnedCanary();
  try { disposeWorldWeaponArt({ terminal: true }); } catch { /* teardown must never break pagehide */ }
  weapons.dispose();
  ordnance.dispose();
  combatFeedback.dispose();
});
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
  // G/Q grenades, V knife, E use - on foot only: E and Q are fly-mode
  // up/down in core/player.ts, and a knife thrown from noclip is not a game.
  if ((e.code === 'KeyG' || e.code === 'KeyQ' || e.code === 'KeyV' || e.code === 'KeyE') && player.getMode() === 'walk') {
    try { weapons.keyDown(e.code); } catch { /* headless-safe */ }
  }
  // 3-6 are the four killstreak slots. A press always answers, even when it
  // is refused - a dead key is the defect IMPORT-PLAN s5.4 is written about.
  const slot = ['Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
  if (slot >= 0) match?.pressStreak(slot + 1);
});
addEventListener('keyup', (e) => {
  try { weapons.keyUp(e.code); } catch { /* headless-safe */ }
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
let reflectionCaptureBusy = false;
let reflectionProbe: StaticReflectionProbe | null = null;

function frame(): void {
  if (reflectionCaptureBusy) { last = performance.now(); requestAnimationFrame(frame); return; }
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
    worldAudio.update(player.state, player.getStance(), player.getMode() === 'walk' && !!match && match.mode() !== 'idle', world.atmosphere.weather());
    weapons.update(dt, now / 1000, {
      speed,
      sprinting: speed > 6.5,
      grounded: player.state.grounded,
      crouched: player.getStance() !== 'stand',
      prone: player.getStance() === 'prone',
    });

  }

  // Weapon -> HUD. snapshot() is the controller's own read API; pushing from the
  // loop means neither lane had to know about the other's internals.
  if (!cameraHeldByQA) {
    const snap = weapons.snapshot();
    gameHud.setAmmo(snap.mag, snap.reserve);
    gameHud.setADS(snap.ads);
  }

  // ---- Game tick and bodies. Present authoritative samples before animating;
  // root motion is disabled on these handles so the rig cannot move them twice.
  if (!cameraHeldByQA && match) {
    const st = player.state;
    match.tick(now, st.pos.x, st.pos.y, st.pos.z, st.yaw, st.pitch, player.getStance());
    ordnance.update(dt, now, st.pos.x, st.pos.y, st.pos.z);
    for (const b of match.bots()) {
      let h = botBodies.get(b.id);
      if (!h) {
        h = characters.spawn(b.x, b.z, b.yaw, 1, undefined, b.weaponId || undefined);
        botBodies.set(b.id, h);
      }
      // Host-authoritative selected weapon: a pickup swap re-dresses the
      // figure in place; rearm no-ops while the archetype is unchanged.
      if (b.weaponId) characters.rearm(h, b.weaponId);
      presentBody(h, b, now);
      h.input.speed = b.alive ? b.speed : 0;
      // Presentation-only hysteresis separates the authoritative 4.8 m/s jog
      // from 6.6 m/s sprint without changing movement or the network protocol.
      h.input.sprinting = b.alive && b.stance === 'stand'
        && b.speed > (h.input.sprinting ? 5.3 : 5.5);
      h.input.crouch = b.stance === 'crouch';
      h.input.prone = b.stance === 'prone';
      if (b.alive && h.rig.isDead) h.rig.revive();
      else if (!b.alive && !h.rig.isDead) h.rig.playDeath();
    }
    characters.update(dt, world.camera.position);
    throwBodies.update((id) => botBodies.get(id)?.rig ?? null);
  }

  // Render the freshly simulated and animated pose, not the previous frame.
  if (!cameraHeldByQA) {
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
    weapons.overlay.environmentIntensity = world.scene.environmentIntensity;
    world.renderer.clearDepth();
    const ac = world.renderer.autoClear;
    world.renderer.autoClear = false;
    world.renderer.render(weapons.overlay, world.camera);
    world.renderer.autoClear = ac;
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
  reflection: (enabled: boolean) => Promise<unknown>;
  ready: boolean;
  stations: Record<string, Station>;
  goto: (name: string) => boolean;
  spawn: (team: 'a' | 'b') => void;
  release: () => void;
  stats: () => Record<string, unknown>;
  moduleStats: typeof moduleStats;
  colliderCount: number;
  colliderSnapshot: () => {
    count: number;
    colliders: Array<{
      i: number;
      owner: string;
      min: [number, number, number];
      max: [number, number, number];
    }>;
  };
  render: () => void;
  probeReset: (x: number, z: number) => void;
  probeWalkTo: (tx: number, tz: number, maxSteps: number, tolerance?: number) => boolean;
  probePos: () => [number, number, number];
  collidersAt: (x: number, z: number, y?: number) => unknown[];
  /** Inspection-mode control for headless fly/noclip checks. Additive only. */
  setMode: (m: MoveMode) => void;
  mode: () => MoveMode;
  playerPose: () => { x: number; y: number; z: number; yaw: number; pitch: number; mode: MoveMode; camX: number; camY: number; camZ: number };
  teleport: (x: number, y: number, z: number, yaw?: number, pitch?: number) => void;
  setFlySpeed: (v: number) => void;
  weaponCmd: (cmd: string, arg?: string | number | boolean) => unknown;
  /** Ordnance lane: the client projection's log, counts and pools. Read-only. */
  ordnance: () => Record<string, unknown>;
  audio: () => ReturnType<WeaponsController['audioStats']>;
  disposeEnvironment?: () => void;
  /** Owned coach canary actual-adoption status (read-only, real geometry).
   * ROOT verifies `inScene` + `materials`, not fetch alone: `mounted` is true
   * while the owned root is live, `inScene` while its marked meshes are still
   * mounted under vehicles. Baseline (?coach absent) reports opted-out. */
  coachOwned: () => { optIn: boolean; state: string; mounted: boolean; taken: boolean; meshes: number; materials: number; geometries: number; textures: number; inScene: boolean };
  /** Bounded visual A/B controls; never persisted into player settings. */
  look: (options?: { exposure?: number; environment?: number; glass?: number }) => { exposure: number; environment: number; glass: number };
  remoteBodies: () => Array<{ id: string; x: number; y: number; z: number; crouch: boolean; prone: boolean; locomotion: string }>;
}

const qa: QA = {
  async reflection(enabled) {
    if (!enabled) { reflectionProbe?.dispose(); reflectionProbe = null; return { status: 'disposed' }; }
    if (reflectionCaptureBusy || reflectionProbe) return { status: 'already-attempted' };
    reflectionCaptureBusy = true;
    try {
      await world.backendReady;
      world.render(); // Compile against the normal post chain before any cube capture.
      const windows: THREE.Object3D[] = [];
      world.scene.traverse(o => { if (o instanceof THREE.Mesh && o.material === mat.windowDark) windows.push(o); });
      reflectionProbe = createStaticReflectionProbe({ renderer: world.renderer, scene: world.scene,
        material: mat.windowDark as THREE.MeshStandardMaterial, mrt: world.post.captureMrt,
        anchor: new THREE.Vector3(0, 4.2, 0), reflectiveMeshes: windows, size: 128 });
      const result = await reflectionProbe.capture();
      if (result.status !== 'captured') { reflectionProbe.dispose(); reflectionProbe = null; }
      return result;
    } finally { reflectionCaptureBusy = false; }
  },
  ready: false,
  look(options = {}) {
    const glass = mat.windowDark as THREE.MeshStandardMaterial;
    if (Number.isFinite(options.exposure)) world.renderer.toneMappingExposure = Math.max(0.5, Math.min(1.5, options.exposure!));
    if (Number.isFinite(options.environment)) world.scene.environmentIntensity = Math.max(0.1, Math.min(1.5, options.environment!));
    if (Number.isFinite(options.glass)) glass.metalness = Math.max(0, Math.min(0.5, options.glass!));
    return { exposure: world.renderer.toneMappingExposure, environment: world.scene.environmentIntensity, glass: glass.metalness };
  },
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
  playerPose() {
    const p = player.state.pos;
    return { x: p.x, y: p.y, z: p.z, yaw: player.state.yaw, pitch: player.state.pitch, mode: player.getMode(), camX: world.camera.position.x, camY: world.camera.position.y, camZ: world.camera.position.z };
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
  audio() {
    return weapons.audioStats();
  },
  remoteBodies() {
    return Array.from(botBodies, ([id, body]) => ({
      id, x: body.root.position.x, y: body.root.position.y, z: body.root.position.z,
      crouch: !!body.input.crouch, prone: !!body.input.prone, locomotion: body.rig.currentLocomotion,
    }));
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
      eyeHeight: player.getEyeHeight(),
      bodyHeight: player.getBodyHeight(),
      stance: player.getStance(),
      handedness,
      mode: player.getMode(),
      flySpeed: +player.getFlySpeed().toFixed(1),
      environment: getEnvironmentFlags(),
    };
  },
  moduleStats,
  colliderCount: colliders.length,
  colliderSnapshot() {
    return {
      count: colliders.length,
      colliders: colliders.map((c, i) => ({
        i,
        owner: colliderOwner[i],
        min: [c.min.x, c.min.y, c.min.z],
        max: [c.max.x, c.max.y, c.max.z],
      })),
    };
  },
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
  probeWalkTo(tx, tz, maxSteps, tolerance = 0.7) {
    const dt = 1 / 60;
    const arrival = Math.max(0.03, Math.min(0.7, tolerance));
    let closest = Infinity;
    let sinceImproved = 0;
    for (let i = 0; i < maxSteps; i++) {
      const p = player.state.pos;
      const dx = tx - p.x;
      const dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < arrival) { player.setProbeWish(null); return true; }
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
  coachOwned() {
    const r = coachOwnedCanaryReport();
    // Real-geometry check: marked meshes still mounted under the vehicles
    // module (fetch alone never sets this). Read-only traversal, no mutation.
    let inScene = false;
    for (const t of worldTargets) {
      if (t.name !== 'vehicles') continue;
      t.traverse((o) => {
        if ((o as THREE.Mesh).userData?.coachOwnedCanary) inScene = true;
      });
    }
    return { ...r, inScene };
  },
  disposeEnvironment() {
    // QA probe for the same release the pagehide lifecycle owns. Geometry only:
    // disposing the shared singleton materials mid-session would tear down live
    // rendering, so mat.dispose() must never happen here.
    releaseEnvironmentCanary();
    // The owned coach canary root likewise: exclusively-owned GPU copies,
    // idempotent release, cache untouched (it was never involved).
    releaseCoachOwnedCanary();
  },
};

(window as unknown as { __NT: QA }).__NT = qa;
(window as unknown as { __NT_FLAGS: unknown }).__NT_FLAGS = getEnvironmentFlags();
(window as unknown as { __NT_ENV: unknown }).__NT_ENV = getEnvironmentFlags();
// Assembly can finish before the asynchronous GPU device does. A capture must
// never mistake that interval for a rendered, usable scene.
void world.backendReady.then(() => { qa.ready = true; }, () => { /* world reports backend failure */ });
// The match's QA surface, additive and read-only: the integration proof drives
// the REAL built page and reads the host's own snapshot through it, because a
// proof that instantiates the modules itself is not evidence that the shipped
// bundle runs a match (HANDOFF s2, and IMPORT-PLAN s5.7). It is published HERE
// rather than in `game/session.ts` because `src/game/` is DOM-free by contract
// and this file is the one that already owns every window global.
(window as unknown as { __NTGAME: LocalMatch | null }).__NTGAME = match;
console.log('[nuketown] built', Object.keys(moduleStats).length, 'modules,',
  colliders.length, 'colliders');
