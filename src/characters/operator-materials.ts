/**
 * Shared operator surface material.
 *
 * mesh.ts deliberately bakes the faction dress into one vertex-colour attribute
 * so a skinned operator stays one draw. This material keeps that contract: it
 * reads the existing vertex colour exactly once, then adds a restrained woven
 * detail/wear signal from one tiled data texture. Skin remains colour-stable and
 * no normal map is used, because high-frequency normals on the low-poly figure
 * shimmer before the cloth weave is readable.
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  float,
  luminance,
  materialRoughness,
  oneMinus,
  smoothstep,
  texture,
  uv,
  vec3,
  vec4,
} from 'three/tsl';

const DETAIL_SIZE = 256;
const DETAIL_TILES = 10;

export interface OperatorMaterialStats {
  readonly materials: number;
  readonly textures: number;
  readonly textureBytes: number;
  readonly normalMaps: number;
  readonly drawCallsPerFigure: number;
}

export interface OperatorMaterialSet {
  readonly material: MeshStandardNodeMaterial;
  readonly detail: THREE.DataTexture;
  readonly stats: OperatorMaterialStats;
  dispose(): void;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Generate one small, deterministic material signal at startup. The channels
 * are intentionally low contrast: R is fine weave, G is broad wear, and B is a
 * sparse dry scuff signal. It is data, not an sRGB colour texture.
 */
function createDetailTexture(): THREE.DataTexture {
  const data = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4);
  for (let y = 0; y < DETAIL_SIZE; y++) {
    for (let x = 0; x < DETAIL_SIZE; x++) {
      const fineX = Math.sin(x * Math.PI * 2 / 13);
      const fineY = Math.sin(y * Math.PI * 2 / 11);
      const cross = fineX * fineY;
      const broad = Math.sin((x + y * 0.31) * Math.PI * 2 / 79);
      const scuff = Math.sin((x * 17 + y * 29) * 0.031) * 0.5 + 0.5;
      const i = (y * DETAIL_SIZE + x) * 4;
      data[i] = clampByte(128 + cross * 34);
      data[i + 1] = clampByte(128 + broad * 30);
      data[i + 2] = clampByte(128 + (scuff - 0.5) * 42);
      data[i + 3] = 255;
    }
  }
  const detail = new THREE.DataTexture(data, DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat);
  detail.name = 'operator-woven-detail';
  detail.colorSpace = THREE.NoColorSpace;
  detail.wrapS = THREE.RepeatWrapping;
  detail.wrapT = THREE.RepeatWrapping;
  detail.magFilter = THREE.LinearFilter;
  detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.generateMipmaps = true;
  detail.needsUpdate = true;
  return detail;
}

/**
 * Build the one material used by all procedural operators and factions.
 * `mesh.ts` supplies the existing `color` attribute; no geometry, skin weights,
 * draw groups, or per-figure textures are added here.
 */
export function createOperatorMaterial(roughness = 0.80, metalness = 0.02): OperatorMaterialSet {
  const detail = createDetailTexture();
  const material = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness,
    metalness,
    // colorNode consumes the existing attribute explicitly, so NodeMaterial
    // must not multiply the vertex colour a second time.
    vertexColors: false,
  });

  const vertexColor = attribute('color', 'vec3');
  const luma = luminance(vertexColor);
  // The baked operator palette is linear by the time mesh.ts writes it. Skin
  // has a stronger red-minus-green separation than either fatigue family;
  // this keeps the weave/wear signal off exposed skin while retaining both
  // faction colours. Dark leather/webbing is the low-value branch.
  const skinMask = smoothstep(0.14, 0.28, vertexColor.r.sub(vertexColor.g))
    .mul(smoothstep(0.10, 0.45, luma));
  const darkMask = oneMinus(smoothstep(0.05, 0.20, luma));
  const clothMask = smoothstep(0.12, 0.46, luma).mul(skinMask.oneMinus());
  const surfaceMask = clothMask.mul(0.92).add(darkMask.mul(0.68)).clamp(0, 1);
  const sampled = texture(detail, uv().mul(DETAIL_TILES));
  const weave = sampled.r.sub(0.5);
  const wear = sampled.g.sub(0.5);
  const scuff = sampled.b.sub(0.5);

  // Preserve the palette at its base. Only a few percent of deterministic
  // breakup reaches albedo; roughness carries most of the readability.
  const albedoFactor = float(1)
    .add(weave.mul(surfaceMask).mul(0.20))
    .add(scuff.mul(darkMask).mul(0.10));
  material.colorNode = vec4(vertexColor.mul(albedoFactor), 1);
  material.roughnessNode = materialRoughness
    .add(weave.mul(surfaceMask).mul(0.24))
    .add(wear.mul(surfaceMask).mul(0.14))
    .clamp(0.34, 0.98);

  let disposed = false;
  return {
    material,
    detail,
    stats: {
      materials: 1,
      textures: 1,
      textureBytes: detail.image.data.byteLength,
      normalMaps: 0,
      drawCallsPerFigure: 1,
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      material.dispose();
      detail.dispose();
    },
  };
}
