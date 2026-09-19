import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';

/** One pooled bullet scar atlas: chipped radial edge, recessed dark centre. */
export function createImpactMaterial(): { material: THREE.Material; dispose(): void } {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const angle = Math.atan2(ny, nx);
      const radius = Math.hypot(nx, ny);
      const edge = 0.78 + Math.sin(angle * 13 + 1.3) * 0.055 + Math.sin(angle * 23) * 0.028;
      const grain = ((Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663)) >>> 0) % 37;
      const center = Math.min(1, radius / 0.36);
      const rim = Math.max(0, 1 - Math.abs(radius - 0.43) / 0.17);
      const light = Math.round(18 + 28 * center + 44 * rim + grain * 0.55);
      const i = (y * size + x) * 4;
      pixels[i] = light;
      pixels[i + 1] = Math.round(light * 0.92);
      pixels[i + 2] = Math.round(light * 0.82);
      // Alpha test clips the plane's corners; no transparent MRT blending.
      pixels[i + 3] = Math.round(255 * Math.min(1, Math.max(0, (edge - radius) / 0.13)));
    }
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  const material = new MeshStandardNodeMaterial({
    map, alphaTest: 0.12, roughness: 1, metalness: 0,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  return { material, dispose() { material.dispose(); map.dispose(); } };
}
