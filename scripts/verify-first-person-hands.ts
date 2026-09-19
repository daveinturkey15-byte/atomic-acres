import * as THREE from 'three';
import type { MaterialLibrary } from '../src/core/materials';
import {
  buildPistolViewmodel,
  buildRifleViewmodel,
  buildSmgViewmodel,
  buildSniperViewmodel,
  buildShotgunViewmodel,
} from '../src/weapons/viewmodel';

type Hands = NonNullable<ReturnType<typeof buildRifleViewmodel>['hands']>;

const cache = new Map<string, THREE.MeshBasicMaterial>();
function painted(color: number, rough = 0.42, metal = 0.25): THREE.MeshBasicMaterial {
  const key = `${color}:${rough}:${metal}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const material = new THREE.MeshBasicMaterial({ color });
  cache.set(key, material);
  return material;
}

// Builders only need these singleton slots for a browser-free geometry audit.
// MeshBasicMaterial is intentional: no renderer, lights, textures, or GPU path.
const mat = {
  painted,
  timber: painted(0x8b5a2b, 1, 0),
  timberDark: painted(0x4d3116, 1, 0),
  steel: painted(0x687078, 1, 0.7),
  chrome: painted(0xc8ccd0, 1, 0.95),
  glass: painted(0x66808e, 0.08, 0),
  viewmodel: {
    sleeve: painted(0x39452e), darkGlove: painted(0x10100e), gloveDetail: painted(0x10100e),
    woodFurniture: painted(0x4d200c), parkerizedSteel: painted(0x202723),
  },
} as unknown as MaterialLibrary;

function fail(message: string): never {
  throw new Error(`[first-person-hands] ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function pose(hand: Hands): number[] {
  const p = hand.supportHand.position;
  const q = hand.supportHand.quaternion;
  return [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
}

function equalPose(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

function assertBind(hand: Hands, bind: number[], label: string): void {
  assert(equalPose(pose(hand), bind), `${label}: support pose did not restore exactly`);
}

const builders = [
  { name: 'rifle', build: buildRifleViewmodel, supportZ: -0.36, supportY: -0.055, target: [0.010, -0.065, 0.230], targetCenter: [0, -0.120, -0.130] },
  { name: 'pistol', build: buildPistolViewmodel, supportZ: -0.08, supportY: -0.055, target: [0.010, -0.020, 0.080], targetCenter: [0, -0.075, 0] },
  { name: 'smg', build: buildSmgViewmodel, supportZ: -0.22, supportY: -0.05, target: [0.010, -0.040, 0.130], targetCenter: [0, -0.090, -0.090] },
  { name: 'shotgun', build: buildShotgunViewmodel, supportZ: -0.30, supportY: -0.045, target: [0.010, 0.020, 0.280], targetCenter: [0, -0.025, -0.020] },
  { name: 'sniper', build: buildSniperViewmodel, supportZ: -0.32, supportY: -0.045, target: [0.010, 0.000, 0.220], targetCenter: [0, -0.045, -0.100] },
] as const;

for (const spec of builders) {
  const { name } = spec;
  const rig = spec.build(mat);
  const hand = rig.hands;
  assert(hand !== undefined, `${name}: builder did not expose first-person hands`);
  const bind = pose(hand);
  assert(equalPose(bind, [0, 0, 0, 0, 0, 0, 1]), `${name}: unexpected bind pose`);

  const seen = new Set<string>();
  for (const phase of [0.07, 0.30, 0.57, 0.82]) {
    hand.updateReload(phase);
    const current = pose(hand);
    assert(!equalPose(current, bind), `${name}: phase ${phase} did not move support hand`);
    seen.add(current.map((value) => value.toFixed(6)).join(','));
  }
  assert(seen.size === 4, `${name}: reload phases collapsed to one support pose`);

  // At the seat pause, the main palm centre should be within the authored
  // loading target. This catches a plausible-looking generic reach that stops
  // short of the rifle magazine or shotgun loading port.
  hand.updateReload(0.57);
  const p = hand.supportHand.position;
  assert(Math.abs(p.x - spec.target[0]) < 1e-9, `${name}: measured target x drifted`);
  assert(Math.abs(p.y - (spec.target[1] - 0.002)) < 1e-9, `${name}: measured target y drifted`);
  assert(Math.abs(p.z - (spec.target[2] + 0.003)) < 1e-9, `${name}: measured target z drifted`);
  const palmAtSeat = [-0.010 + p.x, spec.supportY + p.y, spec.supportZ + p.z];
  const distance = Math.hypot(
    palmAtSeat[0] - spec.targetCenter[0],
    palmAtSeat[1] - spec.targetCenter[1],
    palmAtSeat[2] - spec.targetCenter[2],
  );
  assert(distance <= 0.008, `${name}: seat palm is ${distance.toFixed(4)} m from measured reload target`);

  for (const terminal of [0, 1, Number.NaN, -0.25, 1.25, Number.POSITIVE_INFINITY]) {
    hand.updateReload(terminal);
    assertBind(hand, bind, `${name}: updateReload(${String(terminal)})`);
  }
  hand.updateReload(0.57);
  hand.resetReload();
  assertBind(hand, bind, `${name}: resetReload`);
  console.log(`[first-person-hands] ${name}: phases and bind restoration PASS`);

  rig.group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}
for (const material of cache.values()) material.dispose();
console.log(`[first-person-hands] ${builders.length} weapon rigs verified CPU-only`);
