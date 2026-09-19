import * as THREE from 'three';
import { BOUND_X_MIN, BOUND_X_MAX, BOUND_Z } from './layout';

/** Static world-space roof height field. Built once from the actual triangles,
 * including curved roofs and overhangs, rather than gameplay wall colliders. */
export class RainShelter {
  readonly minX = BOUND_X_MIN - 12;
  readonly minZ = -BOUND_Z - 12;
  readonly spanX = BOUND_X_MAX - BOUND_X_MIN + 24;
  readonly spanZ = BOUND_Z * 2 + 24;
  readonly width = 256;
  readonly height = 384;
  private heights = new Float32Array(this.width * this.height);
  private pixels = new Uint16Array(this.heights.length);
  readonly texture = new THREE.DataTexture(
    this.pixels, this.width, this.height, THREE.RedFormat, THREE.HalfFloatType,
  );
  private triangles = 0;
  private buildMs = 0;

  constructor() {
    this.texture.name = 'static-rain-shelter-height';
    this.texture.needsUpdate = true;
  }

  build(roots: readonly THREE.Object3D[]): void {
    const started = performance.now();
    this.heights.fill(0);
    this.triangles = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const instance = new THREE.Matrix4(), transform = new THREE.Matrix4();
    for (const root of roots) {
      root.updateWorldMatrix(true, true);
      root.traverseVisible((object) => {
        if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        // Cutout leaves are porous and must not become solid rectangular roofs.
        if (materials.every(material => !material.visible || material.alphaTest > 0)) return;
        const geometry = object.geometry;
        const position = geometry.getAttribute('position');
        if (!position) return;
        const index = geometry.index;
        const count = index?.count ?? position.count;
        const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
        for (let n = 0; n < instances; n++) {
          if (object instanceof THREE.InstancedMesh) {
            object.getMatrixAt(n, instance);
            transform.multiplyMatrices(object.matrixWorld, instance);
          } else transform.copy(object.matrixWorld);
          for (let i = 0; i + 2 < count; i += 3) {
            a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(transform);
            b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(transform);
            c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(transform);
            this.rasterize(a, b, c);
          }
        }
      });
    }
    for (let i = 0; i < this.heights.length; i++) this.pixels[i] = THREE.DataUtils.toHalfFloat(this.heights[i]);
    this.texture.needsUpdate = true;
    this.buildMs = performance.now() - started;
  }

  private rasterize(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(den) < 1e-8 || Math.max(a.y, b.y, c.y) <= 0) return;
    const sx = this.width / this.spanX, sz = this.height / this.spanZ;
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - this.minX) * sx));
    const x1 = Math.min(this.width - 1, Math.floor((Math.max(a.x, b.x, c.x) - this.minX) * sx));
    const z0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - this.minZ) * sz));
    const z1 = Math.min(this.height - 1, Math.floor((Math.max(a.z, b.z, c.z) - this.minZ) * sz));
    if (x0 > x1 || z0 > z1) return;
    this.triangles++;
    for (let iz = z0; iz <= z1; iz++) {
      const z = this.minZ + (iz + 0.5) / sz;
      for (let ix = x0; ix <= x1; ix++) {
        const x = this.minX + (ix + 0.5) / sx;
        const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den;
        const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
        const w = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
        const at = iz * this.width + ix;
        this.heights[at] = Math.max(this.heights[at], u * a.y + v * b.y + w * c.y);
      }
    }
  }

  heightAt(x: number, z: number): number {
    const ix = Math.floor((x - this.minX) / this.spanX * this.width);
    const iz = Math.floor((z - this.minZ) / this.spanZ * this.height);
    return ix < 0 || ix >= this.width || iz < 0 || iz >= this.height ? 0 : this.heights[iz * this.width + ix];
  }

  stats(): { triangles: number; buildMs: number; bytes: number } {
    return { triangles: this.triangles, buildMs: this.buildMs, bytes: this.pixels.byteLength };
  }

  dispose(): void { this.texture.dispose(); }
}
