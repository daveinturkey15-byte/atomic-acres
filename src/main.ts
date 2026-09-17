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
import { Player } from './core/player';
import { SPAWN_A, SPAWN_B, EYE_HEIGHT } from './core/layout';
import { STATIONS, type Station } from './core/stations';

import { buildGround } from './build/ground';
import { buildOrangeHouse } from './build/orange-house';
import { buildWhiteHouse } from './build/white-house';
import { buildThirdHouse } from './build/third-house';
import { buildVehicles } from './build/vehicles';
import { buildYards } from './build/yards';
import { buildSkyline } from './build/skyline';

const BUILDERS: [string, Builder][] = [
  ['ground', buildGround],
  ['orange-house', buildOrangeHouse],
  ['white-house', buildWhiteHouse],
  ['third-house', buildThirdHouse],
  ['vehicles', buildVehicles],
  ['yards', buildYards],
  ['skyline', buildSkyline],
];

const world = createWorld(document.body);
const mat = buildMaterials();
const player = new Player(world.camera, world.renderer.domElement);

const colliders: AABB[] = [];
const moduleStats: Record<string, { objects: number; colliders: number; ms: number }> = {};

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

// ---------------------------------------------------------------- HUD
const hud = document.getElementById('hud')!;
const startOverlay = document.getElementById('start')!;
world.renderer.domElement.addEventListener('click', () => {
  startOverlay.style.display = 'none';
});

let frames = 0;
let fps = 0;
let acc = 0;
let last = performance.now();

function frame(): void {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;

  player.update(dt);
  world.renderer.render(world.scene, world.camera);

  frames++;
  acc += dt;
  if (acc >= 0.5) {
    fps = Math.round(frames / acc);
    frames = 0;
    acc = 0;
    const i = world.renderer.info;
    const p = player.state.pos;
    hud.textContent =
      fps + ' fps   ' +
      i.render.calls + ' calls   ' +
      (i.render.triangles / 1000).toFixed(0) + 'k tris   ' +
      'x ' + p.x.toFixed(1) + '  y ' + p.y.toFixed(2) + '  z ' + p.z.toFixed(1) +
      (player.state.grounded ? '' : '   [air]');
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
  stats: () => Record<string, unknown>;
  moduleStats: typeof moduleStats;
  colliderCount: number;
  render: () => void;
}

const qa: QA = {
  ready: true,
  stations: STATIONS,
  goto(name) {
    const s = STATIONS[name];
    if (!s) return false;
    world.camera.position.set(s.pos[0], s.pos[1], s.pos[2]);
    world.camera.rotation.set(0, 0, 0, 'YXZ');
    world.camera.rotation.y = s.yaw;
    world.camera.rotation.x = s.pitch;
    world.camera.fov = s.fov ?? 72;
    world.camera.updateProjectionMatrix();
    world.renderer.render(world.scene, world.camera);
    return true;
  },
  spawn(team) {
    const s = team === 'a' ? SPAWN_A : SPAWN_B;
    player.teleport(s.x, 0, s.z, s.yaw);
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
    };
  },
  moduleStats,
  colliderCount: colliders.length,
  render() {
    world.renderer.render(world.scene, world.camera);
  },
};

(window as unknown as { __NT: QA }).__NT = qa;
console.log('[nuketown] built', Object.keys(moduleStats).length, 'modules,',
  colliders.length, 'colliders');
