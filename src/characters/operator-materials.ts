/**
 * Shared operator surface material.
 *
 * mesh.ts deliberately bakes the faction dress into one vertex-colour attribute
 * so a skinned operator stays one draw. This material keeps that contract: it
 * reads the existing vertex colour exactly once, then adds woven detail, wear
 * and a coarse tonal camo from one tiled data texture sampled at two scales.
 * The camo is gated to cloth, so skin, webbing and boots keep their old
 * response. No normal map is added; this pass changes colour and roughness only.
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
// Coarse tonal-camo repeat over the same 256 texture: no second map, and any
// float repeat stays seamless because every baked signal period divides SIZE.
const CAMO_TILES = 2;

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
 * Generate one small, deterministic material signal at startup. R is fine
 * weave, G is broad wear/scuff, B is a low-frequency tonal-camo blotch. Every
 * sine period divides DETAIL_SIZE, so the texture tiles seamlessly at any
 * repeat. It is data, not an sRGB colour texture.
 */
function createDetailTexture(): THREE.DataTexture {
  const data = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4);
  const TAU = Math.PI * 2;
  const N = DETAIL_SIZE;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Integer period counts in x and y: value at (256, y) == value at (0, y).
      const cross = Math.sin((x / N) * TAU * 16) * Math.sin((y / N) * TAU * 16);
      const wear =
        Math.sin(((5 * x + 3 * y) / N) * TAU) * 0.65 +
        Math.sin(((3 * x - 5 * y) / N) * TAU) * 0.35;
      const raw =
        Math.sin(((2 * x + 3 * y) / N) * TAU) +
        Math.sin(((3 * x - 2 * y) / N) * TAU + 1.3) +
        0.6 * Math.sin(((5 * x + y) / N) * TAU + 1.7) +
        0.6 * Math.sin(((x - 4 * y) / N) * TAU + 0.6);
      const blotch = Math.max(-1, Math.min(1, (raw / 3.2) * 1.4));
      const i = (y * N + x) * 4;
      data[i] = clampByte(128 + cross * 30);
      data[i + 1] = clampByte(128 + wear * 28);
      data[i + 2] = clampByte(128 + blotch * 60);
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
  // One texture, two scales: fine weave/wear at DETAIL_TILES for the 1 m read,
  // coarse tonal camo at CAMO_TILES for the 4 m read. Both repeats stay
  // seamless because every baked period divides DETAIL_SIZE.
  const fine = texture(detail, uv().mul(DETAIL_TILES));
  const coarse = texture(detail, uv().mul(CAMO_TILES));
  const weave = fine.r.sub(0.5);
  const wear = fine.g.sub(0.5);
  // Tonal camo lives ONLY behind clothMask: olive/tan fatigues break up while
  // dark webbing, boots and skin keep exactly their old response.
  const blotch = coarse.b.sub(0.5);
  const tonal = blotch.mul(clothMask);

  // Preserve the palette at its base. Weave stays near-neutral; the camo adds
  // a few percent of olive-leaning variation (red/green lift, blue dip) so the
  // breakup reads as fabric dye, not glitter. Roughness carries the fold read.
  const grain = weave.mul(surfaceMask).mul(0.26);
  const base = float(1).add(grain).add(tonal.mul(0.14));
  const albedoFactor = vec3(
    base.add(tonal.mul(0.03)),
    base.add(tonal.mul(0.05)),
    base.sub(tonal.mul(0.05)),
  );
  material.colorNode = vec4(
    vertexColor.mul(albedoFactor).add(vec3(wear.mul(darkMask).mul(0.04))),
    1,
  );
  material.roughnessNode = materialRoughness
    .add(weave.mul(surfaceMask).mul(0.26))
    .add(wear.mul(surfaceMask).mul(0.14))
    .add(tonal.mul(0.10))
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
