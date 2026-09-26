/** Visible equipment for the host's bounded streak snapshots. This module never
 * places, targets or awards anything: fixed batches render admitted state only. */
import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { StreakEffectView } from '../game/killstreaks/effect-view';
import { FALLOUT_RADIUS_M } from '../game/killstreaks/effects/fallout';
import { DART_RADIUS_M, DART_PULSE_MS } from '../game/killstreaks/effects/dart';
import { STRIKE_RELAY_PASSES, STRIKE_RELAY_RADIUS_M, STRIKE_RELAY_SPACING_M } from '../game/killstreaks/effects/strike-relay';

export const STREAK_SCENE_CAPACITY = 16;
const TAU = Math.PI * 2;
type Batch = { mesh: THREE.InstancedMesh; used: number; capacity: number };
type Edge = { id: number; shots: number; fired: number; flashUntil: number };

export function createStreakEffectsScene(mat: MaterialLibrary) {
  const group = new THREE.Group();
  group.name = 'host-streak-equipment';
  group.userData.presentationOnly = true;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const ring = new THREE.RingGeometry(0.975, 1, 48);
  ring.rotateX(-Math.PI / 2);
  const sphere = new THREE.IcosahedronGeometry(1, 0);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const localRotation = new THREE.Quaternion();
  const yawRotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const color = new THREE.Color();
  const edges: Edge[] = Array.from({ length: STREAK_SCENE_CAPACITY }, () => ({ id: -1, shots: 0, fired: 0, flashUntil: 0 }));
  let disposed = false;
  let shown = 0;

  function batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadow = false): Batch {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false;
    mesh.castShadow = shadow; mesh.receiveShadow = shadow;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    return { mesh, used: 0, capacity };
  }
  const armor = batch('olive-equipment-casings', box, mat.painted(PAL.opHelmetOlive, 0.66, 0.3), 192, true);
  const dark = batch('equipment-rubber-and-recesses', box, mat.painted(PAL.opBoot, 0.9, 0.1), 192, true);
  const metal = batch('equipment-machined-fittings', cylinder, mat.steel, 128, true);
  const markings = batch('equipment-id-and-warning-strips', box, mat.painted(PAL.hazardYellow, 0.65, 0.2), 96);
  // instanceColor tints the diffuse term, not MeshStandard's emissive term.
  // Team-coloured registry materials preserve teal/red even under bloom.
  const signalTeams = [
    batch('teal-equipment-lenses', sphere, mat.emissive(PAL.signTeal, 2.2), 64),
    batch('red-equipment-lenses', sphere, mat.emissive(PAL.applianceRed, 2.2), 64),
  ];
  const muzzle = batch('sentry-muzzle-pops', sphere, mat.emissive(PAL.sunColor, 3), 16);
  const fieldTeams = [
    batch('teal-streak-field-boundaries', ring, mat.emissive(PAL.signTeal, 0.85), 64),
    batch('red-streak-field-boundaries', ring, mat.emissive(PAL.applianceRed, 0.85), 64),
  ];
  const batches = [armor, dark, metal, markings, ...signalTeams, muzzle, ...fieldTeams];
  const teamColors = [new THREE.Color(PAL.signTeal), new THREE.Color(PAL.applianceRed)];
  const muzzleColor = new THREE.Color(PAL.sunColor);
  // Allocate instance-color buffers during construction, never when the first streak fires.
  for (const b of [...signalTeams, muzzle, ...fieldTeams]) {
    for (let i = 0; i < b.capacity; i++) b.mesh.setColorAt(i, muzzleColor);
  }

  function part(b: Batch, s: StreakEffectView, yaw: number, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, rx = 0, rz = 0, tint?: THREE.Color): void {
    if (b.used >= b.capacity) return;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    position.set(s.x + x * cos + z * sin, s.y + y, s.z - x * sin + z * cos);
    yawRotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    euler.set(rx, 0, rz);
    localRotation.setFromEuler(euler);
    rotation.copy(yawRotation).multiply(localRotation);
    scale.set(sx, sy, sz);
    matrix.compose(position, rotation, scale);
    b.mesh.setMatrixAt(b.used, matrix);
    if (tint) b.mesh.setColorAt(b.used, tint);
    b.used++;
  }
  function field(s: StreakEffectView, radius: number, tint: THREE.Color, x = 0, z = 0, yaw = 0): void {
    part(fieldTeams[s.team], s, yaw, x, 0.07, z, radius, 1, radius, 0, 0, tint);
  }
  function base(s: StreakEffectView, height: number, yaw = 0): void {
    part(dark, s, yaw, 0, 0.06, 0, 0.42, 0.12, 0.42);
    part(metal, s, yaw, 0, height / 2, 0, 0.07, height, 0.07);
    for (let leg = 0; leg < 3; leg++) {
      const a = yaw + leg * TAU / 3;
      part(metal, s, a, 0, height * 0.25, 0.24, 0.034, height * 0.72, 0.034, -0.8);
      part(dark, s, a, 0, 0.035, 0.39, 0.18, 0.07, 0.14);
    }
  }
  function update(nowMs: number, rows: readonly StreakEffectView[], snapshotAt = nowMs): void {
    if (disposed || !Number.isFinite(nowMs)) return;
    for (const b of batches) b.used = 0;
    shown = 0;
    for (let index = 0; index < Math.min(rows.length, STREAK_SCENE_CAPACITY); index++) {
      const s = rows[index];
      if (!(s.remainingMs > 0) || nowMs >= snapshotAt + s.remainingMs
        || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z)) continue;
      shown++;
      const tint = teamColors[s.team];
      const signals = signalTeams[s.team];
      let edge = edges.find((v) => v.id === s.instanceId);
      if (!edge) {
        edge = edges.find((v) => !rows.some((r) => r.instanceId === v.id)) ?? edges[index];
        edge.id = s.instanceId; edge.shots = s.shots ?? 0; edge.fired = s.fired ?? 0; edge.flashUntil = 0;
      }
      if ((s.shots ?? 0) > edge.shots) edge.flashUntil = nowMs + 85;
      edge.shots = s.shots ?? 0;
      const yaw = s.yaw ?? s.aimYaw ?? 0;
      if (s.kind === 'sentry') {
        base(s, 0.7);
        part(dark, s, yaw, 0, 0.73, 0, 0.5, 0.12, 0.4);
        part(armor, s, yaw, 0, 0.87, 0, 0.39, 0.25, 0.51);
        part(armor, s, yaw, -0.3, 0.79, 0.08, 0.2, 0.28, 0.31);
        part(markings, s, yaw, -0.405, 0.8, 0.08, 0.014, 0.04, 0.2);
        part(metal, s, yaw, 0.02, 0.87, -0.52, 0.047, 0.64, 0.047, Math.PI / 2);
        part(dark, s, yaw, 0.02, 0.87, -0.78, 0.11, 0.1, 0.16);
        part(metal, s, yaw, 0.02, 0.87, -0.875, 0.05, 0.05, 0.05, Math.PI / 2);
        part(dark, s, yaw, 0.12, 1.03, -0.1, 0.13, 0.12, 0.2);
        part(signals, s, yaw, 0.12, 1.03, -0.212, 0.037, 0.037, 0.015, 0, 0, tint);
        if (edge.flashUntil > nowMs) part(muzzle, s, yaw, 0.02, 0.87, -0.97, 0.09, 0.09, 0.2, 0, 0, muzzleColor);
        field(s, 0.7, tint);
      } else if (s.kind === 'dart') {
        base(s, 0.45);
        part(armor, s, nowMs * 0.0012, 0, 0.52, 0, 0.28, 0.16, 0.16);
        part(metal, s, 0, 0, 0.71, 0, 0.018, 0.4, 0.018);
        part(signals, s, 0, 0, 0.91, 0, 0.038, 0.038, 0.038, 0, 0, tint);
        const phase = (nowMs % DART_PULSE_MS) / DART_PULSE_MS;
        field(s, 0.65, tint);
        // Pulse is visual range information; revealed actors still come only from the host.
        color.copy(tint).multiplyScalar(0.25 + (1 - phase) * 0.75);
        field(s, Math.max(0.1, phase * DART_RADIUS_M), color);
      } else if (s.kind === 'supply-crate') {
        part(dark, s, 0, 0, 0.08, 0, 1.16, 0.16, 0.8);
        part(armor, s, 0, 0, 0.43, 0, 1.1, 0.6, 0.75);
        part(armor, s, 0, 0, 0.77, 0, 1.16, 0.12, 0.81);
        for (const x of [-0.36, 0.36]) {
          part(dark, s, 0, x, 0.47, 0, 0.09, 0.73, 0.82);
          part(markings, s, 0, x, 0.63, -0.43, 0.12, 0.13, 0.04);
          part(metal, s, 0, x, 0.43, 0.43, 0.026, 0.22, 0.026, Math.PI / 2);
        }
        part(markings, s, 0, 0, 0.44, -0.384, 0.26, 0.2, 0.014);
        part(dark, s, 0, 0, 0.44, -0.395, 0.15, 0.09, 0.014);
        part(signals, s, 0, 0, 0.92, 0, 0.035, 0.08, 0.035, 0, 0, tint);
        field(s, 1.1, tint);
        if ((s.captureProgressMs ?? 0) > 0) field(s, 1.23 + Math.sin(nowMs * 0.012) * 0.05, tint);
      } else if (s.kind === 'fallout-screen') {
        part(armor, s, 0, 0, 0.2, 0, 0.5, 0.4, 0.5);
        for (let arm = 0; arm < 4; arm++) {
          const a = arm * TAU / 4;
          part(metal, s, a, 0, 0.58, 0.19, 0.025, 0.75, 0.025, 0.18);
          part(signals, s, a, 0, 0.93, 0.26, 0.05, 0.05, 0.05, 0, 0, tint);
        }
        field(s, FALLOUT_RADIUS_M, tint);
        const phase = (nowMs % 1800) / 1800;
        color.copy(tint).multiplyScalar(0.7 - phase * 0.5);
        field(s, FALLOUT_RADIUS_M * (0.2 + phase * 0.8), color);
      } else if (s.kind === 'strike-relay') {
        // Honest marked impact line, not an invented aircraft or remote targeting ray.
        for (let n = s.fired ?? 0; n < STRIKE_RELAY_PASSES; n++) {
          field(s, STRIKE_RELAY_RADIUS_M, tint, 0, -n * STRIKE_RELAY_SPACING_M, yaw);
          part(markings, s, yaw, 0, 0.09, -n * STRIKE_RELAY_SPACING_M, 0.4, 0.03, 0.07);
          part(markings, s, yaw, 0, 0.095, -n * STRIKE_RELAY_SPACING_M, 0.07, 0.03, 0.4);
        }
      }
    }
    for (const b of batches) {
      b.mesh.count = b.used;
      if (b.used > 0) {
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      }
    }
  }
  function reset(): void {
    shown = 0;
    for (const b of batches) { b.mesh.count = 0; b.used = 0; }
    for (const e of edges) { e.id = -1; e.flashUntil = 0; }
  }
  function dispose(): void {
    if (disposed) return;
    reset(); disposed = true;
    box.dispose(); cylinder.dispose(); ring.dispose(); sphere.dispose();
    for (const b of batches) b.mesh.dispose();
    group.removeFromParent();
  }
  return { group, update, reset, dispose, counts: () => ({
    shown, instances: batches.reduce((n, b) => n + b.used, 0), capacity: STREAK_SCENE_CAPACITY,
  }) };
}
