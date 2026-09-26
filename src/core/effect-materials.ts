/** Registry-owned soft weapon particles. Deterministic masks, no canvas, lights,
 * shader strings or per-shot resources. Compatible with the existing r180 MRT. */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mrt, vec4 } from 'three/tsl';
import { PAL } from './palette';

export interface SpecialEffectMaterials {
  readonly flame: THREE.Material;
  readonly core: THREE.Material;
  readonly smoke: THREE.Material;
  dispose(): void;
}

function softMask(smoke: boolean): THREE.DataTexture {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const edge = Math.max(0, 1 - Math.max(Math.abs(u), Math.abs(v)));
    const bend = u + 0.13 * Math.sin(v * 6.4) + 0.07 * Math.sin(v * 15.2);
    const radius = smoke ? u * u + v * v : bend * bend * (1.4 + 0.4 * v) + v * v;
    const grain = 0.75 + Math.sin(u * 14 + v * 9) * 0.1 + Math.sin(v * 20 - u * 7) * 0.1;
    const alpha = Math.exp(-radius * (smoke ? 3.6 : 3)) * Math.min(1, edge * 7) * grain;
    const at = (y * size + x) * 4;
    data[at] = data[at + 1] = data[at + 2] = 255;
    data[at + 3] = x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 0 : Math.round(alpha * 255);
  }
  const map = new THREE.DataTexture(data, size, size);
  map.name = smoke ? 'special-fx-soft-dust' : 'special-fx-turbulent-flame';
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.generateMipmaps = false; map.needsUpdate = true;
  return map;
}

export function createSpecialEffectMaterials(): SpecialEffectMaterials {
  const flameMask = softMask(false), smokeMask = softMask(true);
  function material(name: string, map: THREE.DataTexture, tint: number, energy: number, opacity: number): THREE.Material {
    const result = new MeshBasicNodeMaterial({
      name, map, color: new THREE.Color(tint).multiplyScalar(energy), opacity,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    });
    // Preserve opaque geometry's normal/metalness/roughness under the soft alpha.
    result.mrtNode = mrt({ normal: vec4(0), metalness: vec4(0), roughness: vec4(0) });
    return result;
  }
  const flame = material('special-fx-orange-envelope', flameMask, PAL.sunDuskGlow, 1.6, 0.72);
  const core = material('special-fx-hot-core', flameMask, PAL.sunColor, 2.2, 0.8);
  const smoke = material('special-fx-soft-smoke', smokeMask, PAL.asphalt, 0.9, 0.28);
  let disposed = false;
  return { flame, core, smoke, dispose() {
    if (disposed) return;
    disposed = true;
    flame.dispose(); core.dispose(); smoke.dispose(); flameMask.dispose(); smokeMask.dispose();
  } };
}
