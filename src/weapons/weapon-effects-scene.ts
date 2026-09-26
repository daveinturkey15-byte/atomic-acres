/** Host-admitted special-weapon presentation. Fixed pools, registry materials,
 * no lights/colliders, and absolute-time animation so replay does not accumulate drift. */
import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { GameEvent, WeaponEffectEvent } from '../game/events';
import { behaviorFor } from './behavior';

export const SPECIAL_EFFECT_SLOTS = 32;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const GOLDEN = 2.3999632297;
type Slot = {
  effect: WeaponEffectEvent['effect']; actorId: string; id: number; at: number;
  duration: number; radius: number; live: boolean; origin: THREE.Vector3; dir: THREE.Vector3;
};
type Batch = { mesh: THREE.InstancedMesh; capacity: number; used: number };

/** Reconstruct the host's fixed-substep ballistic launch without per-frame integration. */
export function flarePositionAt(ageMs: number, speed: number, gravity: number,
  out = { travel: 0, drop: 0 }): { travel: number; drop: number } {
  const seconds = Math.max(0, ageMs) / 1000;
  const step = 1 / 120;
  const steps = Math.floor(seconds / step);
  const tail = seconds - steps * step;
  out.travel = speed * seconds;
  out.drop = gravity * (step * step * steps * (steps + 1) / 2 + step * steps * tail + tail * tail);
  return out;
}

export interface WeaponEffectsScene {
  readonly group: THREE.Group;
  onEvent(event: GameEvent, nowMs?: number): void;
  update(nowMs: number): void;
  reset(): void;
  dispose(): void;
  counts(): { live: number; instances: number; capacity: number };
}

export function createWeaponEffectsScene(mat: MaterialLibrary): WeaponEffectsScene {
  const group = new THREE.Group();
  group.name = 'special-weapon-effects';
  group.userData.presentationOnly = true;
  const particleGeo = new THREE.IcosahedronGeometry(1, 1);
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 7, 1, true);
  const ringGeo = new THREE.RingGeometry(0.94, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const matrix = new THREE.Matrix4();
  const orientation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const identity = new THREE.Quaternion();
  const flare = behaviorFor('flare-gun');
  const flareSpeed = flare.speed ?? 24;
  const flareGravity = flare.gravity ?? 9.81;
  const flightSample = { travel: 0, drop: 0 };
  let disposed = false;
  let next = 0;
  let live = 0;

  function batch(name: string, geo: THREE.BufferGeometry, material: THREE.Material, capacity: number): Batch {
    const mesh = new THREE.InstancedMesh(geo, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    return { mesh, capacity, used: 0 };
  }
  const warm = batch('flame-envelope-and-embers', particleGeo, mat.emissive(PAL.sunDuskGlow, 2.2), 288);
  const hot = batch('white-hot-cores', particleGeo, mat.emissive(PAL.sunColor, 3.5), 128);
  const smoke = batch('cooling-smoke-puffs', particleGeo, mat.painted(PAL.asphalt, 1, 0), 96);
  const rail = batch('rail-ion-traces', beamGeo, mat.emissive(PAL.signTeal, 3), SPECIAL_EFFECT_SLOTS);
  const rings = batch('blast-shock-rings', ringGeo, mat.emissive(PAL.sunGolden, 1.6), SPECIAL_EFFECT_SLOTS);
  const batches = [warm, hot, smoke, rail, rings];
  const slots: Slot[] = Array.from({ length: SPECIAL_EFFECT_SLOTS }, () => ({
    effect: 'flame', actorId: '', id: -1, at: 0, duration: 0, radius: 0, live: false,
    origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1),
  }));

  function emit(b: Batch, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, q = identity): void {
    if (b.used >= b.capacity || sx <= 0 || sy <= 0 || sz <= 0) return;
    position.set(x, y, z);
    scale.set(sx, sy, sz);
    matrix.compose(position, q, scale);
    b.mesh.setMatrixAt(b.used++, matrix);
  }

  function onEvent(event: GameEvent, nowMs = event.at): void {
    if (disposed || event.type !== 'weapon-effect') return;
    if (![nowMs, event.durationMs, event.radius, event.x, event.y, event.z, event.dx, event.dy, event.dz].every(Number.isFinite)) return;
    if (event.durationMs <= 0 || event.radius <= 0) return;
    // Same authoritative edge is delivered at most once, including reconnect repeats.
    if (slots.some((s) => s.live && s.id === event.id && s.actorId === event.actorId && s.effect === event.effect && s.at === nowMs)) return;
    if (event.effect === 'flare-impact') {
      for (const s of slots) if (s.live && s.effect === 'flare-launch' && s.id === event.id && s.actorId === event.actorId) s.live = false;
    }
    let chosen = -1;
    for (let i = 0; i < slots.length; i++) {
      const index = (next + i) % slots.length;
      if (!slots[index].live) { chosen = index; break; }
    }
    if (chosen < 0) chosen = next;
    next = (chosen + 1) % slots.length;
    const s = slots[chosen];
    s.effect = event.effect; s.actorId = event.actorId; s.id = event.id; s.at = nowMs;
    s.duration = Math.min(10_000, event.durationMs); s.radius = Math.min(150, event.radius); s.live = true;
    s.origin.set(event.x, event.y, event.z);
    s.dir.set(event.dx, event.dy, event.dz);
    if (s.dir.lengthSq() < 1e-8) s.dir.set(0, 0, -1);
    s.dir.normalize();
  }

  function update(nowMs: number): void {
    if (disposed || !Number.isFinite(nowMs)) return;
    for (const b of batches) b.used = 0;
    live = 0;
    for (const s of slots) {
      if (!s.live) continue;
      const age = nowMs - s.at;
      if (age < 0) continue;
      if (age >= s.duration) { s.live = false; continue; }
      live++;
      const t = age / s.duration;
      const fade = Math.min(1, (1 - t) * 4);
      const p = s.origin;
      if (s.effect === 'flame') {
        side.crossVectors(s.dir, Y_AXIS);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        up.crossVectors(side, s.dir).normalize();
        // Overlapping tapered tongues read as a continuous jet; a broad solid cone does not.
        for (let j = 0; j < 9; j++) {
          const f = (j + 1) / 10;
          const d = 0.4 + s.radius * f;
          const twist = j * GOLDEN + s.id * 0.8 + t * 2;
          const spread = (0.035 + f * 0.26) * Math.sin(twist);
          const x = p.x + s.dir.x * d + side.x * spread;
          const y = p.y + s.dir.y * d + up.y * spread + f * t * 0.3;
          const z = p.z + s.dir.z * d + side.z * spread;
          const size = (0.1 + f * 0.47) * fade;
          orientation.setFromUnitVectors(Y_AXIS, s.dir);
          emit(warm, x, y, z, size, size * 1.75, size, orientation);
          if (j < 5) emit(hot, x, y, z, size * 0.5, size, size * 0.5, orientation);
        }
      } else if (s.effect === 'flare-launch') {
        // Exact host substep formula, evaluated for the head and retained trail samples.
        for (let j = 0; j < 6; j++) {
          const sampleMs = age - j * 23;
          if (sampleMs < 0) continue;
          flarePositionAt(sampleMs, flareSpeed, flareGravity, flightSample);
          const d = flightSample.travel;
          const x = p.x + s.dir.x * d, y = p.y + s.dir.y * d - flightSample.drop, z = p.z + s.dir.z * d;
          const size = Math.max(0.025, s.radius * (1 - j / 7));
          emit(j === 0 ? hot : warm, x, y, z, size);
        }
      } else if (s.effect === 'rail') {
        orientation.setFromUnitVectors(Y_AXIS, s.dir);
        const width = 0.026 * (1 - t) + 0.005;
        emit(rail, p.x + s.dir.x * s.radius / 2, p.y + s.dir.y * s.radius / 2,
          p.z + s.dir.z * s.radius / 2, width, s.radius, width, orientation);
        for (let j = 1; j <= 5; j++) {
          const d = Math.min(s.radius, j * 3.5), angle = j * GOLDEN + age * 0.017;
          emit(hot, p.x + s.dir.x * d + Math.sin(angle) * 0.1,
            p.y + s.dir.y * d + Math.cos(angle) * 0.1, p.z + s.dir.z * d, 0.032 * fade);
        }
      } else {
        const groundFire = s.effect === 'flare-impact';
        const radius = groundFire ? s.radius * 0.55 : s.radius * (0.15 + Math.sqrt(t) * 0.8);
        emit(rings, p.x, p.y + 0.065, p.z, radius, 1, radius);
        for (let j = 0; j < 8; j++) {
          const a = j * GOLDEN + s.id * 0.4;
          const r = radius * (0.2 + (j % 3) * 0.3);
          const flicker = 0.78 + 0.22 * Math.sin(age * 0.028 + a);
          const size = (groundFire ? 0.12 : 0.2 + (1 - t) * 0.42) * fade * flicker;
          const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
          const y = p.y + (groundFire ? size * 1.1 : t * (0.9 + j * 0.13));
          emit(warm, x, y, z, size, size * 2.2, size);
          if (j % 2 === 0) emit(hot, x, y - size * 0.2, z, size * 0.52);
          if (j < 3) emit(smoke, x + Math.sin(a) * t * 0.3,
            p.y + 0.45 + t * (groundFire ? 2 : 1.4), z, (0.18 + t * 0.4) * fade);
        }
      }
    }
    for (const b of batches) {
      b.mesh.count = b.used;
      if (b.used > 0) b.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function reset(): void {
    for (const s of slots) s.live = false;
    for (const b of batches) { b.used = 0; b.mesh.count = 0; }
    next = 0; live = 0;
  }
  function dispose(): void {
    if (disposed) return;
    reset(); disposed = true;
    particleGeo.dispose(); beamGeo.dispose(); ringGeo.dispose();
    for (const b of batches) b.mesh.dispose();
    group.removeFromParent();
  }
  return { group, onEvent, update, reset, dispose, counts: () => ({
    live, instances: batches.reduce((n, b) => n + b.used, 0), capacity: SPECIAL_EFFECT_SLOTS,
  }) };
}
