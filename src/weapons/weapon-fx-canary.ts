/** Original, bounded weapon gas/debris. No damage, timers, scene lights or shared materials. */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mrt, vec4 } from 'three/tsl';
import { PAL } from '../core/palette';

const STRIDE = 20;
const GOLDEN = 2.399963229728653;

export function weaponFxRequested(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('weapon-fx') === 'canary';
}

/** Analytic, deterministic alpha masks; no image/download/canvas dependency. */
function mask(kind: number): THREE.DataTexture {
  const size = 64;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const edge = Math.max(0, 1 - Math.max(Math.abs(u), Math.abs(v)));
    const warp = u + 0.13 * Math.sin(v * 9 + kind);
    const r2 = warp * warp + v * v;
    const grain = 0.62 + 0.18 * Math.sin(u * 19 + Math.sin(v * 13)) + 0.12 * Math.sin(v * 31 - u * 11);
    let alpha = Math.exp(-r2 * (kind === 0 ? 3.4 : 4.8)) * grain * Math.min(1, edge * 9);
    if (kind === 0) alpha *= 0.7 + 0.3 * Math.sin(v * 8 + u * 5) ** 2;
    if (kind === 2) alpha = Math.exp(-u * u * 32 - v * v * 3) * Math.min(1, edge * 12);
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) alpha = 0;
    const o = (y * size + x) * 4;
    bytes[o] = bytes[o + 1] = bytes[o + 2] = 255;
    bytes[o + 3] = Math.round(Math.min(1, alpha) * 255);
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.name = `weapon-fx-original-mask-${kind}`;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** One indexed-quad mesh per pool. Vertex alpha avoids per-slot materials/shaders. */
class ParticleBatch {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
  readonly data: Float64Array;
  readonly positions: THREE.BufferAttribute;
  readonly normals: THREE.BufferAttribute;
  readonly colors: THREE.BufferAttribute;
  readonly texture: THREE.DataTexture;
  readonly capacity: number;
  private next = 0;
  private count = 0;
  private disposed = false;
  private readonly tint: THREE.Color;

  constructor(capacity: number, kind: number, color: number) {
    this.capacity = capacity;
    this.data = new Float64Array(capacity * STRIDE);
    this.positions = new THREE.BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(THREE.DynamicDrawUsage);
    // The world MRT requests normalView even for unlit transparent materials.
    this.normals = new THREE.BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(THREE.DynamicDrawUsage);
    for (let v = 0; v < capacity * 4; v++) this.normals.setXYZ(v, 0, 0, 1);
    this.colors = new THREE.BufferAttribute(new Float32Array(capacity * 16), 4).setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(capacity * 8), index = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const v = i * 4, o = i * 8, j = i * 6;
      uv[o] = 0; uv[o + 1] = 0; uv[o + 2] = 1; uv[o + 3] = 0;
      uv[o + 4] = 1; uv[o + 5] = 1; uv[o + 6] = 0; uv[o + 7] = 1;
      index[j] = v; index[j + 1] = v + 1; index[j + 2] = v + 2;
      index[j + 3] = v; index[j + 4] = v + 2; index[j + 5] = v + 3;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('normal', this.normals);
    geometry.setAttribute('color', this.colors);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.texture = mask(kind);
    this.tint = new THREE.Color(color);
    const material = new MeshBasicNodeMaterial({
      map: this.texture, vertexColors: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, forceSinglePass: true,
      blending: kind === 2 ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // The scene MRT's scalar/vec3 surface outputs otherwise acquire alpha=1,
    // even where this particle's color/map/vertex alpha is almost transparent.
    // Zero-alpha auxiliary writes preserve the opaque surface for GTAO/SSR;
    // the ordinary color output still draws this gas/dust/spark normally.
    material.mrtNode = mrt({ normal: vec4(0), metalness: vec4(0), roughness: vec4(0) });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = `weapon-fx-${kind === 0 ? 'gas' : kind === 1 ? 'dust' : 'sparks'}`;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = kind === 2 ? 3 : 2;
    // Current-camera billboards, including camera movement after the shot.
    // Fixed geometry/attributes only; renderer callbacks allocate nothing here.
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => this.write(camera);
  }

  add(p: THREE.Vector3, vx: number, vy: number, vz: number, life: number, size: number,
    growth: number, alpha: number, drag: number, gravity: number, angle: number,
    spin: number, stretch: number, brightness: number, normal?: THREE.Vector3): void {
    if (this.disposed) return;
    const o = this.next * STRIDE;
    this.next = (this.next + 1) % this.capacity;
    if (this.data[o + 6] <= 0) this.count++;
    const d = this.data;
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = life; d[o + 7] = 0; d[o + 8] = size; d[o + 9] = growth;
    d[o + 10] = alpha; d[o + 11] = drag; d[o + 12] = gravity;
    d[o + 13] = angle; d[o + 14] = spin; d[o + 15] = stretch; d[o + 16] = brightness;
    d[o + 17] = normal?.x ?? 0; d[o + 18] = normal?.y ?? 0; d[o + 19] = normal?.z ?? 0;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * STRIDE;
      if (this.data[o + 6] <= 0) continue;
      this.data[o + 7] += dt;
      if (this.data[o + 7] >= this.data[o + 6]) {
        this.data[o + 6] = 0;
        this.count--;
      }
    }
    this.mesh.visible = this.count > 0;
  }

  private write(camera: THREE.Camera): void {
    if (this.disposed) return;
    const m = camera.matrixWorld.elements, d = this.data;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * STRIDE, life = d[o + 6], age = d[o + 7];
      if (life <= 0) {
        for (let k = 0; k < 4; k++) {
          this.positions.setXYZ(i * 4 + k, 0, 0, 0);
          this.normals.setXYZ(i * 4 + k, m[8], m[9], m[10]);
          this.colors.setXYZW(i * 4 + k, 0, 0, 0, 0);
        }
        continue;
      }
      const t = life > 0 ? age / life : 1;
      const drag = d[o + 11];
      const travel = drag > 0 ? -Math.expm1(-drag * age) / drag : age;
      let px = d[o] + d[o + 3] * travel;
      let py = d[o + 1] + d[o + 4] * travel - d[o + 12] * age * age * 0.5;
      let pz = d[o + 2] + d[o + 5] * travel;
      // A chip may settle on its source plane, never fall through that plane.
      const behind = (px - d[o]) * d[o + 17] + (py - d[o + 1]) * d[o + 18] + (pz - d[o + 2]) * d[o + 19];
      if (behind < 0) { px -= behind * d[o + 17]; py -= behind * d[o + 18]; pz -= behind * d[o + 19]; }
      const size = life > 0 ? d[o + 8] + d[o + 9] * age : 0;
      let angle = d[o + 13] + d[o + 14] * age;
      if (d[o + 15] > 2) {
        const vx = d[o + 3], vy = d[o + 4] - d[o + 12] * age, vz = d[o + 5];
        angle = Math.atan2(vx * m[4] + vy * m[5] + vz * m[6], vx * m[0] + vy * m[1] + vz * m[2]) - Math.PI / 2;
      }
      const co = Math.cos(angle), si = Math.sin(angle);
      const rx = (m[0] * co + m[4] * si) * size * 0.5;
      const ry = (m[1] * co + m[5] * si) * size * 0.5;
      const rz = (m[2] * co + m[6] * si) * size * 0.5;
      const ux = (-m[0] * si + m[4] * co) * size * d[o + 15] * 0.5;
      const uy = (-m[1] * si + m[5] * co) * size * d[o + 15] * 0.5;
      const uz = (-m[2] * si + m[6] * co) * size * d[o + 15] * 0.5;
      const alpha = life > 0 ? d[o + 10] * (1 - t) ** 2 * Math.min(1, 0.35 + age * 70) : 0;
      const bright = d[o + 16] > 1 ? 1 + (d[o + 16] - 1) * (1 - t) : d[o + 16];
      for (let k = 0; k < 4; k++) {
        const sx = k === 0 || k === 3 ? -1 : 1, sy = k < 2 ? -1 : 1, v = i * 4 + k;
        this.positions.setXYZ(v, px + sx * rx + sy * ux, py + sx * ry + sy * uy, pz + sx * rz + sy * uz);
        this.normals.setXYZ(v, m[8], m[9], m[10]);
        this.colors.setXYZW(v, this.tint.r * bright, this.tint.g * bright, this.tint.b * bright, alpha);
      }
    }
    this.positions.needsUpdate = this.normals.needsUpdate = this.colors.needsUpdate = true;
  }

  liveCount(): number { return this.count; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.count = 0;
    this.data.fill(0);
    this.mesh.visible = false;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}

export class WeaponFxCanary {
  readonly group = new THREE.Group();
  private readonly gas = new ParticleBatch(48, 0, PAL.concrete);
  private readonly dust = new ParticleBatch(80, 1, PAL.sand);
  private readonly sparks = new ParticleBatch(64, 2, PAL.sunColor);
  private readonly n = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private tick = 0;
  private disposed = false;

  constructor(parent: THREE.Group) {
    this.group.name = 'weapon-fx-canary';
    this.group.add(this.gas.mesh, this.dust.mesh, this.sparks.mesh);
    parent.add(this.group);
  }

  muzzle(point: THREE.Vector3, orientation: THREE.Quaternion): void {
    if (this.disposed) return;
    this.tick++;
    this.n.set(0, 0, -1).applyQuaternion(orientation);
    this.right.set(1, 0, 0).applyQuaternion(orientation);
    this.up.set(0, 1, 0).applyQuaternion(orientation);
    for (let k = 0; k < 6; k++) {
      const angle = (this.tick + k) * GOLDEN, side = Math.cos(angle) * (0.16 + k * 0.035), lift = Math.sin(angle) * 0.18;
      const speed = k < 3 ? 2.7 - k * 0.4 : 0.65 + k * 0.07;
      this.p.copy(point).addScaledVector(this.n, 0.025 + k * 0.015);
      this.gas.add(this.p, this.n.x * speed + this.right.x * side + this.up.x * lift,
        this.n.y * speed + this.right.y * side + this.up.y * lift + 0.08,
        this.n.z * speed + this.right.z * side + this.up.z * lift,
        0.19 + k * 0.044, 0.065 + k * 0.009, 0.32 + k * 0.035, k < 3 ? 0.46 : 0.29,
        5.5, -0.35, angle, (k % 2 ? 1 : -1) * 0.8, 1.15 + k * 0.09, 0.9);
    }
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, dusty: boolean): void {
    if (this.disposed) return;
    this.tick++;
    this.n.copy(normal);
    if (this.n.lengthSq() < 1e-8) this.n.set(0, 1, 0);
    this.n.normalize();
    this.right.set(Math.abs(this.n.y) < 0.9 ? 0 : 1, Math.abs(this.n.y) < 0.9 ? 1 : 0, 0).cross(this.n).normalize();
    this.up.crossVectors(this.n, this.right);
    this.p.copy(point).addScaledVector(this.n, 0.025);
    for (let k = 0; k < (dusty ? 9 : 6); k++) {
      const a = (this.tick * 3 + k) * GOLDEN, spread = 0.3 + (k % 4) * 0.17;
      const dx = Math.cos(a) * spread, dy = Math.sin(a) * spread, speed = 0.65 + (k % 3) * 0.28;
      const chip = k >= (dusty ? 6 : 3);
      this.dust.add(this.p, this.n.x * speed + this.right.x * dx + this.up.x * dy,
        this.n.y * speed + this.right.y * dx + this.up.y * dy,
        this.n.z * speed + this.right.z * dx + this.up.z * dy,
        chip ? 0.22 + k * 0.018 : 0.42 + (k % 3) * 0.11,
        chip ? 0.015 + (k % 3) * 0.008 : 0.09 + (k % 3) * 0.025,
        chip ? 0 : 0.6, chip ? 0.95 : 0.68, chip ? 0.4 : 3.5, chip ? 9.8 : -0.1,
        a, chip ? 7 : 0.8, chip ? 0.7 : 1.2, chip ? 0.5 : 0.85, this.n);
    }
    if (!dusty) for (let k = 0; k < 5; k++) {
      const a = (this.tick + k) * GOLDEN, dx = Math.cos(a) * 1.4, dy = Math.sin(a) * 1.4, speed = 1.5 + k * 0.45;
      this.sparks.add(this.p, this.n.x * speed + this.right.x * dx + this.up.x * dy,
        this.n.y * speed + this.right.y * dx + this.up.y * dy,
        this.n.z * speed + this.right.z * dx + this.up.z * dy,
        0.085 + k * 0.022, 0.012 + (k % 2) * 0.005, -0.02, 1, 1.2, 9.8, a, 0, 3.5 + k * 0.6, 3.2, this.n);
    }
  }

  update(dt: number): void { this.gas.update(dt); this.dust.update(dt); this.sparks.update(dt); }
  liveCount(): number { return this.gas.liveCount() + this.dust.liveCount() + this.sparks.liveCount(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gas.dispose(); this.dust.dispose(); this.sparks.dispose();
    this.group.removeFromParent();
  }
}
