/**
 * Material library. Every material has a procedural fallback drawn in code on a
 * canvas. A small, hash-pinned CC0 Poly Haven set may upgrade the asphalt,
 * concrete, lawn and deck channels asynchronously after the synchronous scene
 * build; a failed download leaves the authored fallback in place.
 * Materials are shared singletons: build them ONCE and reuse, so the renderer
 * compiles a small, fixed set of programs.
 */
import * as THREE from 'three';
import { createOperatorMaterial } from '../characters/operator-materials';
import { createTurfTextures, disposeTurfTextures } from './turf-material';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { ShaderNodeObject } from 'three/tsl';
import {
  abs,
  cameraPosition,
  cross,
  float,
  floor,
  hash,
  instanceIndex,
  length,
  materialColor,
  materialRoughness,
  mrt,
  normalize,
  oneMinus,
  positionLocal,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { PAL } from './palette';
import { createPaintedSurfaceMaps, loadExternalSurfaceSet } from './material-surfaces';
import type { SurfaceTextureSet } from './material-surfaces';
import type { RainShelter } from './rain-shelter';
import { createVegetationMaterials } from './vegetation-materials';
import { createImpactMaterial } from './impact-material';
import { createViewmodelMaterials, type ViewmodelMaterialSet } from '../weapons/viewmodel-materials';
import { isGroundPbrEnabled, isLawnCanaryEnabled } from './environment-flags';
import {
  applyGroundPbrCanaryMaps,
  GROUND_CANARY_ALBEDO_TINT,
  GROUND_CANARY_UV_M,
  GROUND_CANARY_TILE_M,
  loadCanarySurfaceSet,
} from './ground-pbr-canary';
import { buildLawnCanarySpec, LAWN_CANARY_URLS } from './lawn-pbr-canary';
import { upgradeStreetPbr } from './street-pbr';

type Ctx2D = CanvasRenderingContext2D;
type N = ShaderNodeObject<Node>;

// Material generation is part of the authored scene, so it must be reproducible.
// The old maps used Math.random(), which made a fresh build subtly different on
// every launch and made visual regression captures difficult to compare.
let proceduralSeed = 0x4d41544c;
function materialRandom(): number {
  proceduralSeed = (Math.imul(proceduralSeed ^ (proceduralSeed >>> 15), 1 | proceduralSeed) + 0x6d2b79f5) | 0;
  let t = Math.imul(proceduralSeed ^ (proceduralSeed >>> 15), 1 | proceduralSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// WEATHER SURFACES (atmosphere lane, additive). One global uniform, read by the
// ground family's factories below: rain lowers roughness and darkens albedo on
// paving / asphalt / concrete / kerb / lawn / sand through `wetStd`, which is the
// same singleton-per-surface rule as `std` with two node hooks on top. Nothing is
// constructed at runtime and no new material appears when the weather changes -
// `setWetness` writes one float and every wet-aware program reads it next frame.
// At wetness 0 the hooks multiply by exactly 1, so the default frame is unchanged.
// ---------------------------------------------------------------------------
const WETNESS = uniform(0);
/** 0 = dry (default), 1 = rain-soaked. Clamped. */
export function setWetness(v: number): void {
  WETNESS.value = Math.min(1, Math.max(0, v));
}
export function getWetness(): number {
  return WETNESS.value;
}
/** Roughness drops by this fraction at full wetness (0.65 asphalt -> ~0.25: a wet sheen, not a mirror). */
const WET_ROUGHNESS_DROP = 0.62;
/** Albedo darkens by this fraction at full wetness (wet paving reads ~a third darker). */
const WET_ALBEDO_DROP = 0.34;

function canvas(size: number, draw: (c: Ctx2D, s: number) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  draw(c, size);
  return cv;
}

function tex(
  size: number,
  repeat: number,
  draw: (c: Ctx2D, s: number) => void,
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas(size, draw));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** speckle splatter used to break up flat fills */
function speckle(c: Ctx2D, s: number, n: number, alpha: number, dark = true): void {
  for (let i = 0; i < n; i++) {
    const x = materialRandom() * s;
    const y = materialRandom() * s;
    const r = materialRandom() * (s / 180) + s / 400;
    const a = (alpha * materialRandom()).toFixed(3);
    c.fillStyle = dark ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,255,255,' + a + ')';
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
}
/** linear-data texture for roughness/normal maps: never sRGB. */
function dataTex(
  size: number,
  repeat: number,
  draw: (c: Ctx2D, s: number) => void,
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas(size, draw));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function gray(v: number): string {
  const b = Math.max(0, Math.min(255, Math.round(v)));
  return 'rgb(' + b + ',' + b + ',' + b + ')';
}

/** absolute roughness (0-1) as a canvas grey. Maps multiply, so mapped materials set roughness 1. */
function R(v: number): string {
  return gray(v * 255);
}

/**
 * Soft large-scale mottling (dust films, polish, sheen drift). Centres stay
 * inset by their radius so blobs never cross a tile edge and maps stay seamless.
 * `yMin`/`yMax` bias mottling vertically (grime low) while fading to zero at the
 * tile edges so vertical tiling never stripes.
 */
function blotches(
  c: Ctx2D, s: number, n: number,
  rMin: number, rMax: number,
  tone: (a: string) => string, aMax: number,
  yMin = 0, yMax = 1,
): void {
  for (let i = 0; i < n; i++) {
    const r = Math.min(s * 0.24, rMin + materialRandom() * (rMax - rMin));
    const x = r + materialRandom() * Math.max(1, s - 2 * r);
    const top = yMin * s + r;
    const bot = yMax * s - r;
    const y = top + materialRandom() * Math.max(1, bot - top);
    const a = (aMax * (0.4 + materialRandom() * 0.6)).toFixed(3);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, tone(a));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
}

/** Height-field canvas -> tangent-space normal-map canvas. Wrapped sampling keeps tiling seamless. */
function normalFromHeight(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const sd = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const lum = (x: number, y: number): number => {
    const k = (((y + h) % h) * w + ((x + w) % w)) * 4;
    return (sd[k] + sd[k + 1] + sd[k + 2]) / (3 * 255);
  };
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const out = c.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = -(lum(x + 1, y) - lum(x - 1, y)) * strength;
      const ny = -(lum(x, y + 1) - lum(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const k = (y * w + x) * 4;
      out.data[k] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      out.data[k + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      out.data[k + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      out.data[k + 3] = 255;
    }
  }
  c.putImageData(out, 0, 0);
  return cv;
}

function normalTex(
  size: number,
  repeat: number,
  heightDraw: (c: Ctx2D, s: number) => void,
  strength: number,
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(normalFromHeight(canvas(size, heightDraw), strength));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export interface MaterialLibrary {
  concrete: THREE.Material;
  paving: THREE.Material;
  asphalt: THREE.Material;
  kerb: THREE.Material;
  lawn: THREE.Material;
  sand: THREE.Material;
  stuccoCream: THREE.Material;
  stuccoTerracotta: THREE.Material;
  roofWhite: THREE.Material;
  solar: THREE.Material;
  barrelRoof: THREE.Material;
  capsuleWhite: THREE.Material;
  /**
   * Interior room surfaces - partitions, ceiling/floor slabs, chimney breasts.
   * The same cream stucco set as the outside, but a room is NOT open to the sky:
   * the albedo multiplies down to ~0.60 and warms off neutral, and envMapIntensity
   * drops to 0.30 so an enclosed surface stops collecting the full blue hemisphere.
   * Without this an interior reads BRIGHTER and COOLER than the sunlit street it
   * opens onto - the inverted S1 contrast the interiors gauntlet round 0 measured.
   */
  interiorWall: THREE.Material;
  roofGlazing: THREE.Material;
  glass: THREE.Material;
  windowDark: THREE.Material;
  timber: THREE.Material;
  timberDark: THREE.Material;
  deckBoards: THREE.Material;
  /** fence course boards: timber fallback, upgraded to the wooden_planks photo set */
  fenceBoard: THREE.Material;
  hedge: THREE.Material;
  leaf: THREE.Material;
  leafCards: THREE.Material;
  bark: THREE.Material;
  chrome: THREE.Material;
  steel: THREE.Material;
  impactDecal: THREE.Material;
  /** Soft radial flash sprite (masked, HDR core) for the weapon-effects flash quads. */
  flashSprite: THREE.Material;
  viewmodel: ViewmodelMaterialSet;
  painted: (color: number, rough?: number, metal?: number) => THREE.Material;
  /**
   * ONE material for a whole character (src/characters/mesh.ts).
   *
   * A figure is skin, fatigues, webbing, a helmet and boots - five values that
   * used to be five materials on 27 bone-parented meshes, which cost 27 draws
   * per pass and 54 per frame with the shadow pass. Here the dress rides in the
   * geometry's per-vertex `color` attribute instead, so the whole figure is ONE
   * draw. `color` stays white because vertex colours multiply it.
   *
   * Cached like painted(): every figure and every faction shares this one
   * material and therefore one program.
   */
  operator: (rough?: number, metal?: number) => THREE.Material;
  emissive: (color: number, strength?: number) => THREE.Material;
  /**
   * Lettering drawn on a canvas - still procedural, nothing downloaded.
   * For sign faces that need to actually read as a word. `aspect` is width/height
   * of the plane it will be mapped onto, so the glyphs are not stretched.
   */
  signText: (opts: {
    text: string;
    color: number;
    background?: number;
    aspect?: number;
    script?: boolean;
    glow?: boolean;
  }) => THREE.Material;
  dispose: () => void;
}

export function buildMaterials(): MaterialLibrary {
  // Restart the stream for every library so a reload is byte-for-byte stable.
  proceduralSeed = 0x4d41544c;
  const cache = new Map<string, THREE.Material>();
  const owned = new Set<{ dispose: () => void }>();
  const own = (resource: { dispose: () => void }): void => { owned.add(resource); };
  const vegetation = createVegetationMaterials();
  own(vegetation);
  const impact = createImpactMaterial();
  own(impact);
  // The weapon-flash sprite: one soft radial ALPHA mask on an unlit material whose
  // colour sits above 1 in linear radiance. The crossed flash quads in
  // weapons/effects.ts are stretched to ~3 x 1 m at blast scale; with the old solid
  // emissive material that read as a hard white card and bloom (threshold 1.0) lit
  // its whole rectangle. The mask keeps an HDR core that clears the bloom threshold
  // and fades the edges to nothing, so the flash reads as a bounded star. Built
  // once here like the impact atlas - never per pop, disposed with the library.
  const flashMaskTex = new THREE.CanvasTexture(canvas(128, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.26)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }));
  flashMaskTex.wrapS = flashMaskTex.wrapT = THREE.ClampToEdgeWrapping;
  flashMaskTex.colorSpace = THREE.SRGBColorSpace;
  own(flashMaskTex);
  const flashSpriteMat = new MeshBasicNodeMaterial({
    color: new THREE.Color(PAL.sunColor).multiplyScalar(2.4),
    map: flashMaskTex, transparent: true, depthWrite: false,
  });
  own(flashSpriteMat);
  const viewmodel = createViewmodelMaterials();
  own(viewmodel);
  let disposed = false;
  const wetRefresh = new Map<THREE.Material, () => void>();

  const std = (p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial(p);
    own(m);
    if (p.map) own(p.map);
    if (p.roughnessMap) own(p.roughnessMap);
    if (p.normalMap) own(p.normalMap);
    if (p.emissiveMap && p.emissiveMap !== p.map) own(p.emissiveMap);
    return m;
  };
  /**
   * `std` for a surface that gets wet. The renderer turns every MeshStandardMaterial
   * into a MeshStandardNodeMaterial anyway (NodeLibrary.fromMaterial copies the
   * properties across); building the node class directly lets roughness and albedo
   * read the WETNESS uniform. `k` is how strongly this surface responds (asphalt 1,
   * lawn 0.5). Same maps, same params, same singleton discipline.
   */
  const wetStd = (
    p: THREE.MeshStandardMaterialParameters,
    k: number,
    ownMaps = true,
  ): THREE.Material => {
    const m = new MeshStandardNodeMaterial(p);
    own(m);
    // The turf cache owns the lawn maps as one set so teardown also clears its
    // module cache. Other wet surfaces keep the historical per-map ownership.
    if (ownMaps && p.map) own(p.map);
    if (ownMaps && p.roughnessMap) own(p.roughnessMap);
    if (ownMaps && p.normalMap) own(p.normalMap);
    const wet = WETNESS.mul(k);
    const refresh = (): void => {
      // materialColor/materialRoughness resolve map fields during the Three.js
      // node build. Reinstalling these small graphs before needsUpdate makes
      // the async PBR swap explicit for WebGPU and keeps wetness in the graph.
      m.roughnessNode = materialRoughness.mul(oneMinus(wet.mul(WET_ROUGHNESS_DROP)));
      m.colorNode = materialColor.mul(vec4(vec3(oneMinus(wet.mul(WET_ALBEDO_DROP))), 1));
    };
    refresh();
    wetRefresh.set(m, refresh);
    return m;
  };

  // A single restrained detail set gives the many small painted props a shared
  // believable surface response. Keeping this outside painted() avoids one
  // albedo/roughness/normal trio per colour while still giving each material its
  // own base coat through `color`.
  const paintedSurface = createPaintedSurfaceMaps(materialRandom);
  own(paintedSurface.map);
  own(paintedSurface.roughnessMap);
  own(paintedSurface.normalMap);

  // ---- big paving slabs, the dominant surround surface
  const pavingTex = tex(512, 14, (c, s) => {
    c.fillStyle = hex(PAL.concrete);
    c.fillRect(0, 0, s, s);
    const n = 4;
    const cell = s / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = (0.04 + materialRandom() * 0.1).toFixed(3);
        c.fillStyle = 'rgba(255,255,255,' + v + ')';
        c.fillRect(i * cell + 1.5, j * cell + 1.5, cell - 3, cell - 3);
      }
    }
    c.strokeStyle = 'rgba(0,0,0,0.20)';
    c.lineWidth = 2.5;
    for (let i = 0; i <= n; i++) {
      c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell, s); c.stroke();
      c.beginPath(); c.moveTo(0, i * cell); c.lineTo(s, i * cell); c.stroke();
    }
    speckle(c, s, 900, 0.045);
    blotches(c, s, 8, s * 0.05, s * 0.16, (a) => 'rgba(216,210,198,' + a + ')', 0.1);
  });

  // Preserve the old lawn callbacks while the new turf is compared. These
  // throwaway canvases are intentionally generated and disposed in this build:
  // blotches() and speckle() consume the shared stream in draw order, so a
  // hand-counted skip would be a second implementation of those callbacks and
  // could shift every later map. The one-time CPU allocation is bounded and no
  // previous lawn resource reaches a material or GPU.
  const previousLawnTex = tex(512, 10, (c, s) => {
    c.fillStyle = hex(PAL.lawn);
    c.fillRect(0, 0, s, s);
    const band = s / 12;
    c.globalAlpha = 0.075;
    c.fillStyle = hex(PAL.lawnLight);
    for (let i = 0; i < 12; i += 2) c.fillRect(i * band, 0, band, s);
    c.globalAlpha = 0.045;
    for (let i = 0; i < 12; i += 2) c.fillRect(0, i * band, s, band);
    c.globalAlpha = 1;
    blotches(c, s, 24, s * 0.025, s * 0.11, (a) => 'rgba(24,54,24,' + a + ')', 0.07);
    blotches(c, s, 18, s * 0.02, s * 0.09, (a) => 'rgba(126,153,72,' + a + ')', 0.055);
    speckle(c, s, 1800, 0.035);
    speckle(c, s, 900, 0.028, false);
  });
  previousLawnTex.dispose();
  const turf = createTurfTextures();
  const { lawnTex, lawnRough, lawnNormal } = turf;
  own({ dispose: () => disposeTurfTextures(turf) });

  const asphaltTex = tex(512, 22, (c, s) => {
    c.fillStyle = hex(PAL.asphalt);
    c.fillRect(0, 0, s, s);
    speckle(c, s, 9000, 0.35);
    speckle(c, s, 3500, 0.14, false);
    blotches(c, s, 10, s * 0.05, s * 0.15, (a) => 'rgba(30,30,34,' + a + ')', 0.22);
    blotches(c, s, 6, 3, 9, (a) => 'rgba(18,18,20,' + a + ')', 0.4);
  });

  /**
   * Stucco family set: colour + absolute roughness + stipple normal.
   * `base` is the CONCEPT-BAR family mid (cream ~0.58, terracotta ~0.78,
   * capsule gel-coat ~0.42). Grime is irregular mottling biased to the lower
   * middle of the tile, fading to zero at the edges so tiling never stripes -
   * a true grade-anchored band cannot live in a repeating tile.
   */
  const stuccoSet = (color: number, base: number, bump: number, grubby: boolean) => {
    const map = tex(256, 6, (c, s) => {
      c.fillStyle = hex(color);
      c.fillRect(0, 0, s, s);
      speckle(c, s, 5000, 0.1);
      speckle(c, s, 2000, 0.07, false);
      blotches(c, s, 8, s * 0.06, s * 0.18, (a) => 'rgba(210,200,185,' + a + ')', 0.12);
      if (grubby) blotches(c, s, 10, 4, s * 0.07, (a) => 'rgba(96,80,64,' + a + ')', 0.22, 0.45, 0.92);
    });
    const roughnessMap = dataTex(256, 6, (c, s) => {
      c.fillStyle = R(base);
      c.fillRect(0, 0, s, s);
      speckle(c, s, 2500, 0.08);
      speckle(c, s, 1200, 0.06, false);
      blotches(c, s, 8, s * 0.08, s * 0.22, (a) => 'rgba(255,255,255,' + a + ')', 0.18);
      if (grubby) blotches(c, s, 10, 4, s * 0.07, (a) => 'rgba(255,255,255,' + a + ')', 0.3, 0.45, 0.92);
    });
    const normalMap = normalTex(256, 6, (c, s) => {
      c.fillStyle = gray(128);
      c.fillRect(0, 0, s, s);
      speckle(c, s, 5000, 0.28);
      speckle(c, s, 2000, 0.22, false);
    }, bump);
    return { map, roughnessMap, normalMap };
  };
  const creamSet = stuccoSet(PAL.houseCream, 0.58, 0.7, true);
  const terraSet = stuccoSet(PAL.terracotta, 0.78, 0.9, true);
  const capsuleSet = stuccoSet(PAL.capsuleWhite, 0.42, 0.4, false);

  // ---- vertical timber boarding for fences and decks
  const boardTex = (color: number, dark: number, n: number) => tex(256, 4, (c, s) => {
    c.fillStyle = hex(color);
    c.fillRect(0, 0, s, s);
    const w = s / n;
    for (let i = 0; i < n; i++) {
      const v = (materialRandom() * 0.18).toFixed(3);
      c.fillStyle = 'rgba(0,0,0,' + v + ')';
      c.fillRect(i * w, 0, w, s);
      c.strokeStyle = hex(dark);
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(i * w, 0); c.lineTo(i * w, s); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.10)';
      c.lineWidth = 1;
      for (let g = 0; g < 5; g++) {
        const gx = i * w + materialRandom() * w;
        c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx + (materialRandom() - 0.5) * 6, s); c.stroke();
      }
    }
  });

  const hedgeTex = tex(256, 5, (c, s) => {
    c.fillStyle = hex(PAL.hedge);
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 4500; i++) {
      const x = materialRandom() * s;
      const y = materialRandom() * s;
      const a = (materialRandom() * 0.3).toFixed(3);
      c.fillStyle = materialRandom() > 0.5
        ? 'rgba(120,170,90,' + a + ')'
        : 'rgba(0,0,0,' + a + ')';
      c.fillRect(x, y, 2 + materialRandom() * 3, 2 + materialRandom() * 3);
    }
  });

  const solarTex = tex(256, 1, (c, s) => {
    c.fillStyle = hex(PAL.solarPanel);
    c.fillRect(0, 0, s, s);
    const n = 8;
    const cell = s / n;
    c.strokeStyle = 'rgba(190,210,235,0.42)';
    c.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell, s); c.stroke();
      c.beginPath(); c.moveTo(0, i * cell); c.lineTo(s, i * cell); c.stroke();
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = (0.02 + materialRandom() * 0.05).toFixed(3);
        c.fillStyle = 'rgba(255,255,255,' + a + ')';
        c.fillRect(i * cell + 2, j * cell + 2, cell - 4, cell - 4);
      }
    }
  });
  // ---- roughness + normal companions (canvas-procedural, built once) ----
  // Paving: honed concrete ~0.65; joints grit-rough (~0.85) and recessed.
  const pavingRough = dataTex(256, 14, (c, s) => {
    c.fillStyle = R(0.65);
    c.fillRect(0, 0, s, s);
    const n = 4;
    const cell = s / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        c.fillStyle = R(0.6 + materialRandom() * 0.1);
        c.fillRect(i * cell + 1, j * cell + 1, cell - 2, cell - 2);
      }
    }
    c.strokeStyle = R(0.85);
    c.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell, s); c.stroke();
      c.beginPath(); c.moveTo(0, i * cell); c.lineTo(s, i * cell); c.stroke();
    }
    blotches(c, s, 10, s * 0.05, s * 0.16, (a) => 'rgba(235,235,235,' + a + ')', 0.25);
    speckle(c, s, 500, 0.06);
  });
  const pavingNormal = normalTex(256, 14, (c, s) => {
    c.fillStyle = gray(220);
    c.fillRect(0, 0, s, s);
    const n = 4;
    const cell = s / n;
    c.strokeStyle = gray(0);
    c.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell, s); c.stroke();
      c.beginPath(); c.moveTo(0, i * cell); c.lineTo(s, i * cell); c.stroke();
    }
    speckle(c, s, 700, 0.08);
  }, 2);
  // Asphalt: ~0.65 with a wide dim lobe; wheel-polish bands read smoother
  // (~0.5) and oil spots darker still. Was a flat 0.9, which rendered the
  // street as matte paper with no sun response at grazing angles.
  const asphaltRough = dataTex(256, 22, (c, s) => {
    c.fillStyle = R(0.65);
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 7; i++) {
      const r = s * (0.06 + materialRandom() * 0.1);
      const x = r + materialRandom() * Math.max(1, s - 2 * r);
      const y = r + materialRandom() * Math.max(1, s - 2 * r);
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 5);
      c.scale(1, 0.32);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(128,128,128,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    blotches(c, s, 10, s * 0.04, s * 0.12, (a) => 'rgba(140,140,140,' + a + ')', 0.5);
    blotches(c, s, 6, 2, 6, (a) => 'rgba(90,90,90,' + a + ')', 0.5);
    speckle(c, s, 1200, 0.1);
    speckle(c, s, 500, 0.08, false);
  });
  const asphaltNormal = normalTex(256, 22, (c, s) => {
    c.fillStyle = gray(128);
    c.fillRect(0, 0, s, s);
    speckle(c, s, 4000, 0.3);
    speckle(c, s, 1500, 0.25, false);
  }, 1.2);
  // Preserve the former lawn roughness/normal stream for downstream maps; the
  // replacement turf set supplies the live lawn maps above.
  const previousLawnRough = dataTex(256, 10, (c, s) => {
    c.fillStyle = R(0.95);
    c.fillRect(0, 0, s, s);
    const band = s / 8;
    c.fillStyle = R(0.92);
    for (let i = 0; i < 8; i += 2) c.fillRect(i * band, 0, band, s);
    blotches(c, s, 8, s * 0.05, s * 0.14, (a) => 'rgba(250,250,250,' + a + ')', 0.3);
    blotches(c, s, 5, s * 0.04, s * 0.1, (a) => 'rgba(225,225,225,' + a + ')', 0.25);
    speckle(c, s, 800, 0.08);
  });
  previousLawnRough.dispose();
  const previousLawnNormal = normalTex(256, 10, (c, s) => {
    c.fillStyle = gray(128);
    c.fillRect(0, 0, s, s);
    speckle(c, s, 5000, 0.3);
    speckle(c, s, 2500, 0.28, false);
  }, 0.8);
  previousLawnNormal.dispose();
  // Hedge: matte ~0.96 with leaf-lump roughness + blobby normals.
  const hedgeRough = dataTex(256, 5, (c, s) => {
    c.fillStyle = R(0.96);
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 2200; i++) {
      c.fillStyle = R(0.9 + materialRandom() * 0.1);
      c.fillRect(materialRandom() * s, materialRandom() * s, 2 + materialRandom() * 3, 2 + materialRandom() * 3);
    }
  });
  const hedgeNormal = normalTex(256, 5, (c, s) => {
    c.fillStyle = gray(110);
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 1200; i++) {
      c.fillStyle = gray(110 + materialRandom() * 90);
      c.beginPath();
      c.arc(materialRandom() * s, materialRandom() * s, 2 + materialRandom() * 5, 0, Math.PI * 2);
      c.fill();
    }
  }, 2);
  // Concrete apron ~0.8 with dust drift; kerb ~0.85 with polish-wear mottling + grit.
  const concreteRough = dataTex(256, 12, (c, s) => {
    c.fillStyle = R(0.8);
    c.fillRect(0, 0, s, s);
    blotches(c, s, 10, s * 0.06, s * 0.2, (a) => 'rgba(235,235,235,' + a + ')', 0.22);
    speckle(c, s, 900, 0.07);
  });
  const concreteNormal = normalTex(256, 12, (c, s) => {
    c.fillStyle = gray(128);
    c.fillRect(0, 0, s, s);
    speckle(c, s, 2500, 0.2);
    speckle(c, s, 1200, 0.18, false);
  }, 0.8);
  const kerbRough = dataTex(256, 8, (c, s) => {
    c.fillStyle = R(0.85);
    c.fillRect(0, 0, s, s);
    // edge-worn tops read as paler polished mottling on the small kerb UVs
    blotches(c, s, 9, s * 0.05, s * 0.14, (a) => 'rgba(190,190,190,' + a + ')', 0.35);
    // bottom grit wash reads as dense embedded grit + dust, rougher
    speckle(c, s, 1500, 0.12);
    blotches(c, s, 7, s * 0.05, s * 0.16, (a) => 'rgba(240,240,240,' + a + ')', 0.25);
  });
  const kerbNormal = normalTex(256, 8, (c, s) => {
    c.fillStyle = gray(140);
    c.fillRect(0, 0, s, s);
    speckle(c, s, 2200, 0.25);
  }, 0.8);
  // Sand: brightest matte ~0.95 with wind-ripple bands (16 periods/tile: seamless).
  const sandRough = dataTex(256, 6, (c, s) => {
    c.fillStyle = R(0.95);
    c.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      const ph = 0.5 + 0.5 * Math.sin((y / s) * Math.PI * 2 * 16);
      c.fillStyle = 'rgba(228,228,228,' + (0.06 + 0.1 * ph).toFixed(3) + ')';
      c.fillRect(0, y, s, 1);
    }
    speckle(c, s, 1500, 0.08);
  });
  const sandNormal = normalTex(256, 6, (c, s) => {
    c.fillStyle = gray(128);
    c.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      c.fillStyle = gray(128 + 40 * Math.sin((y / s) * Math.PI * 2 * 16));
      c.fillRect(0, y, s, 1);
    }
    speckle(c, s, 2500, 0.2);
  }, 1);
  // Timber boards: ~0.75-0.85 along the board, grime-rough dark gaps, grooved normals.
  const boardSet = (color: number, dark: number, n: number, base: number) => {
    const map = boardTex(color, dark, n);
    const roughnessMap = dataTex(256, 4, (c, s) => {
      c.fillStyle = R(base);
      c.fillRect(0, 0, s, s);
      const w = s / n;
      for (let i = 0; i < n; i++) {
        c.fillStyle = R(base - 0.06 + materialRandom() * 0.12);
        c.fillRect(i * w + 1, 0, w - 2, s);
        for (let g = 0; g < 6; g++) {
          const gx = i * w + 1 + materialRandom() * Math.max(1, w - 2);
          c.strokeStyle = 'rgba(235,235,235,' + (0.05 + materialRandom() * 0.08).toFixed(3) + ')';
          c.lineWidth = 1 + materialRandom() * 1.5;
          c.beginPath();
          c.moveTo(gx, 0);
          c.lineTo(gx + (materialRandom() - 0.5) * 8, s);
          c.stroke();
        }
      }
      c.fillStyle = R(Math.min(1, base + 0.12));
      for (let i = 0; i <= n; i++) c.fillRect(i * w - 1.5, 0, 3, s);
    });
    const normalMap = normalTex(256, 4, (c, s) => {
      c.fillStyle = gray(190);
      c.fillRect(0, 0, s, s);
      const w = s / n;
      c.fillStyle = gray(0);
      for (let i = 0; i <= n; i++) c.fillRect(i * w - 1.5, 0, 3, s);
      for (let i = 0; i < n; i++) {
        for (let g = 0; g < 8; g++) {
          const gx = i * w + materialRandom() * w;
          c.strokeStyle = materialRandom() > 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.22)';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(gx, 0);
          c.lineTo(gx + (materialRandom() - 0.5) * 6, s);
          c.stroke();
        }
      }
    }, 1.6);
    return { map, roughnessMap, normalMap };
  };
  // ---- concrete apron albedo: the dominant surround was a flat fill and read as
  // paper from the aerial (NT02 shows tonal drift across the bleached surround).
  // Subtle per-slab value drift + dust mottling + grit, neutral overlays only so
  // the PAL.concrete family never shifts hue. Repeat matches the concrete
  // roughness/normal companions (12) so breakup aligns across maps.
  const concreteTex = tex(512, 12, (c, s) => {
    c.fillStyle = hex(PAL.concrete);
    c.fillRect(0, 0, s, s);
    const n = 4;
    const cell = s / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = (0.03 + materialRandom() * 0.08).toFixed(3);
        c.fillStyle = materialRandom() > 0.5
          ? 'rgba(255,255,255,' + v + ')'
          : 'rgba(0,0,0,' + v + ')';
        c.fillRect(i * cell + 1, j * cell + 1, cell - 2, cell - 2);
      }
    }
    blotches(c, s, 10, s * 0.06, s * 0.2, (a) => 'rgba(255,255,255,' + a + ')', 0.1);
    blotches(c, s, 7, s * 0.04, s * 0.12, (a) => 'rgba(0,0,0,' + a + ')', 0.1);
    speckle(c, s, 900, 0.05);
  });
  // ---- tree canopy: smooth flat blobs read as plastic baubles at yard distance.
  // Two-scale breakup (clump blotches + leaf speckle) in albedo and roughness.
  const leafTex = tex(256, 3, (c, s) => {
    c.fillStyle = hex(PAL.treeLeaf);
    c.fillRect(0, 0, s, s);
    blotches(c, s, 12, s * 0.06, s * 0.2, (a) => 'rgba(0,0,0,' + a + ')', 0.25);
    blotches(c, s, 8, s * 0.04, s * 0.12, (a) => 'rgba(255,255,255,' + a + ')', 0.12);
    speckle(c, s, 2500, 0.12);
    speckle(c, s, 1200, 0.1, false);
  });
  const leafRough = dataTex(256, 3, (c, s) => {
    c.fillStyle = R(0.92);
    c.fillRect(0, 0, s, s);
    blotches(c, s, 10, s * 0.06, s * 0.18, (a) => 'rgba(255,255,255,' + a + ')', 0.2);
    speckle(c, s, 800, 0.08);
  });
  // ---- bark: vertical fissure streaks over the trunk base, neutral overlays.
  const barkTex = tex(256, 2, (c, s) => {
    c.fillStyle = hex(PAL.treeTrunk);
    c.fillRect(0, 0, s, s);
    for (let g = 0; g < 40; g++) {
      const x = materialRandom() * s;
      c.strokeStyle = materialRandom() > 0.4
        ? 'rgba(0,0,0,' + (0.08 + materialRandom() * 0.12).toFixed(3) + ')'
        : 'rgba(255,255,255,' + (0.04 + materialRandom() * 0.06).toFixed(3) + ')';
      c.lineWidth = 1 + materialRandom() * 3;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + (materialRandom() - 0.5) * 10, s);
      c.stroke();
    }
    speckle(c, s, 600, 0.08);
  });
  const barkRough = dataTex(256, 2, (c, s) => {
    c.fillStyle = R(0.95);
    c.fillRect(0, 0, s, s);
    speckle(c, s, 900, 0.08);
  });
  // ---- butterfly / vault roofs: large smooth sheets under a grazing sun, so sheen
  // drift (roughness mottling) sells them harder than albedo does. Roof white
  // stays near 0.6 mean; barrel vaults near 0.55 with polish drift.
  const roofTex = tex(256, 6, (c, s) => {
    c.fillStyle = hex(PAL.roofWhite);
    c.fillRect(0, 0, s, s);
    blotches(c, s, 9, s * 0.06, s * 0.2, (a) => 'rgba(0,0,0,' + a + ')', 0.06);
    blotches(c, s, 7, s * 0.05, s * 0.16, (a) => 'rgba(255,255,255,' + a + ')', 0.08);
    speckle(c, s, 700, 0.04);
  });
  const roofRough = dataTex(256, 6, (c, s) => {
    c.fillStyle = R(0.6);
    c.fillRect(0, 0, s, s);
    blotches(c, s, 10, s * 0.06, s * 0.2, (a) => 'rgba(255,255,255,' + a + ')', 0.3);
    blotches(c, s, 6, s * 0.04, s * 0.12, (a) => 'rgba(0,0,0,' + a + ')', 0.2);
    speckle(c, s, 700, 0.06);
  });
  const barrelRough = dataTex(256, 6, (c, s) => {
    c.fillStyle = R(0.55);
    c.fillRect(0, 0, s, s);
    blotches(c, s, 9, s * 0.06, s * 0.18, (a) => 'rgba(255,255,255,' + a + ')', 0.3);
    speckle(c, s, 800, 0.07);
  });
  // ---- metals: brushed row streaks break the mirror-flat read. Chrome keeps a
  // tight ~0.10-0.20 band so the baked sun disc still glints instead of hazing.
  const steelRough = dataTex(256, 4, (c, s) => {
    c.fillStyle = R(0.42);
    c.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      c.fillStyle = R(0.35 + materialRandom() * 0.15);
      c.fillRect(0, y, s, 1);
    }
    speckle(c, s, 500, 0.05);
  });
  const chromeRough = dataTex(256, 4, (c, s) => {
    c.fillStyle = R(0.12);
    c.fillRect(0, 0, s, s);
    blotches(c, s, 8, s * 0.05, s * 0.16, (a) => 'rgba(255,255,255,' + a + ')', 0.12);
    speckle(c, s, 500, 0.05);
  });
  const timberSet = boardSet(PAL.timber, PAL.timberDark, 8, 0.8);
  const timberDarkSet = boardSet(PAL.timberDark, PAL.timberGap, 8, 0.82);
  const deckSet = boardSet(PAL.deckBoard, PAL.timberDark, 10, 0.78);

  const lib: MaterialLibrary = {
    // The ground family reads the WETNESS uniform (rain): see wetStd above.
    concrete: wetStd({ map: concreteTex, roughness: 1, roughnessMap: concreteRough, normalMap: concreteNormal, normalScale: new THREE.Vector2(0.4, 0.4), metalness: 0 }, 0.9),
    paving: wetStd({ map: pavingTex, roughness: 1, roughnessMap: pavingRough, normalMap: pavingNormal, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0 }, 0.9),
    asphalt: wetStd({ map: asphaltTex, roughness: 1, roughnessMap: asphaltRough, normalMap: asphaltNormal, normalScale: new THREE.Vector2(0.6, 0.6), metalness: 0 }, 1.0),
    kerb: wetStd({ color: PAL.kerb, roughness: 1, roughnessMap: kerbRough, normalMap: kerbNormal, normalScale: new THREE.Vector2(0.4, 0.4), metalness: 0 }, 0.8),
    lawn: wetStd({ map: lawnTex, roughness: 1, roughnessMap: lawnRough, normalMap: lawnNormal, normalScale: new THREE.Vector2(0.4, 0.4), metalness: 0 }, 0.5, false),
    sand: wetStd({ color: PAL.sand, roughness: 1, roughnessMap: sandRough, normalMap: sandNormal, normalScale: new THREE.Vector2(0.5, 0.5), metalness: 0 }, 0.6),
    stuccoCream: std({ map: creamSet.map, roughness: 1, roughnessMap: creamSet.roughnessMap, normalMap: creamSet.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), metalness: 0 }),
    stuccoTerracotta: std({ map: terraSet.map, roughness: 1, roughnessMap: terraSet.roughnessMap, normalMap: terraSet.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), metalness: 0 }),
    roofWhite: std({ map: roofTex, roughness: 1, roughnessMap: roofRough, metalness: 0.05 }),
    solar: std({ map: solarTex, roughness: 0.25, metalness: 0.35, envMapIntensity: 1.2 }),
    barrelRoof: std({ color: PAL.barrelRoof, roughness: 1, roughnessMap: barrelRough, metalness: 0.15 }),
    capsuleWhite: std({ map: capsuleSet.map, roughness: 1, roughnessMap: capsuleSet.roughnessMap, normalMap: capsuleSet.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), metalness: 0.02, envMapIntensity: 0.6 }),
    // Shares creamSet's maps with stuccoCream on purpose (no new texture, no new
    // program family) - only the tint and the env term differ. See the interface.
    interiorWall: std({ map: creamSet.map, roughness: 0.85, roughnessMap: creamSet.roughnessMap, normalMap: creamSet.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), metalness: 0, color: 0x8f8a7a, envMapIntensity: 0.3 }),
    roofGlazing: std({
      color: PAL.roofGlazing, roughness: 0.14, metalness: 0.1,
      transparent: true, opacity: 0.86, envMapIntensity: 1.2,
    }),
    glass: std({
      color: PAL.glass, roughness: 0.08, metalness: 0,
      transparent: true, opacity: 0.42, envMapIntensity: 1.6,
    }),
    windowDark: std({
      color: PAL.windowDark, roughness: 0.12, metalness: 0.16, envMapIntensity: 2,
    }),
    timber: std({ map: timberSet.map, roughness: 1, roughnessMap: timberSet.roughnessMap, normalMap: timberSet.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), metalness: 0 }),
    timberDark: std({ map: timberDarkSet.map, roughness: 1, roughnessMap: timberDarkSet.roughnessMap, normalMap: timberDarkSet.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), metalness: 0 }),
    deckBoards: std({ map: deckSet.map, roughness: 1, roughnessMap: deckSet.roughnessMap, normalMap: deckSet.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), metalness: 0 }),
    // Fence course boards share the timber family's textures, so the fallback
    // looks exactly like the boards this material replaces and no new program
    // family is compiled; the async upgrade below swaps in the photo maps.
    fenceBoard: std({ map: timberSet.map, roughness: 1, roughnessMap: timberSet.roughnessMap, normalMap: timberSet.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), metalness: 0 }),
    hedge: std({ map: hedgeTex, roughness: 1, roughnessMap: hedgeRough, normalMap: hedgeNormal, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0 }),
    leaf: std({ map: leafTex, roughness: 1, roughnessMap: leafRough, metalness: 0 }),
    leafCards: vegetation.leafCards,
    impactDecal: impact.material,
    flashSprite: flashSpriteMat,
    viewmodel,
    bark: std({ map: barkTex, roughness: 1, roughnessMap: barkRough, metalness: 0 }),
    chrome: std({ color: PAL.chrome, roughness: 1, roughnessMap: chromeRough, metalness: 0.95, envMapIntensity: 1.25 }),
    steel: std({ color: PAL.steel, roughness: 1, roughnessMap: steelRough, metalness: 0.7 }),

    painted(color: number, rough = 0.42, metal = 0.25) {
      const key = 'p' + color + '_' + rough + '_' + metal;
      let m = cache.get(key);
      if (!m) {
        m = std({
          color,
          map: paintedSurface.map,
          roughness: 1,
          roughnessMap: paintedSurface.roughnessMap,
          normalMap: paintedSurface.normalMap,
          normalScale: new THREE.Vector2(0.16, 0.16),
          metalness: metal,
        });
        cache.set(key, m);
      }
      return m;
    },
    operator(rough = 0.80, metal = 0.02) {
      const key = 'op' + rough + '_' + metal;
      let m = cache.get(key);
      if (!m) {
        const surface = createOperatorMaterial(rough, metal);
        own(surface);
        m = surface.material;
        cache.set(key, m);
      }
      return m;
    },
    signText({ text, color, background, aspect = 4, script = false, glow = false }) {
      const key = 's' + text + color + background + aspect + script + glow;
      const hit = cache.get(key);
      if (hit) return hit;
      const H = 256;
      const W = Math.max(64, Math.round(H * aspect));
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const c = cv.getContext('2d')!;
      if (background === undefined) {
        c.clearRect(0, 0, W, H);
      } else {
        c.fillStyle = hex(background);
        c.fillRect(0, 0, W, H);
      }
      // A script face if the host has one, otherwise an italic serif - both read as
      // period signwriting at the distances this is seen from.
      const family = script
        ? '"Brush Script MT","Segoe Script","Lucida Handwriting",cursive'
        : '"Futura","Century Gothic","Segoe UI",sans-serif';
      let size = Math.round(H * (script ? 0.74 : 0.5));
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const weight = script ? '' : '600 ';
      for (let i = 0; i < 24; i++) {
        c.font = weight + (script ? 'italic ' : '') + size + 'px ' + family;
        if (c.measureText(text).width <= W * 0.9) break;
        size -= Math.max(1, Math.round(size * 0.06));
      }
      if (glow) {
        c.shadowColor = hex(color);
        c.shadowBlur = H * 0.12;
      }
      c.fillStyle = hex(color);
      c.fillText(text, W / 2, H * 0.54);
      if (glow) {
        c.shadowBlur = 0;
        c.strokeStyle = 'rgba(255,255,255,0.35)';
        c.lineWidth = Math.max(1, H * 0.006);
        c.strokeText(text, W / 2, H * 0.54);
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      const m = std({
        map: t,
        transparent: background === undefined,
        roughness: 0.42,
        metalness: 0.05,
        emissive: glow ? color : 0x000000,
        emissiveMap: glow ? t : null,
        emissiveIntensity: glow ? 0.85 : 0,
        side: THREE.DoubleSide,
      });
      cache.set(key, m);
      return m;
    },
    emissive(color: number, strength = 1.4) {
      const key = 'e' + color + '_' + strength;
      let m = cache.get(key);
      if (!m) {
        m = std({ color, emissive: color, emissiveIntensity: strength, roughness: 0.5 });
        cache.set(key, m);
      }
      return m;
    },
    dispose() {
      disposed = true;
      wetRefresh.clear();
      for (const o of owned) o.dispose();
      cache.clear();
      owned.clear();
    },
  };

  /**
   * Upgrade the synchronous procedural fallback atomically when a complete local
   * PBR set arrives. Ground UV scales are established in build/ground.ts: asphalt
   * is 40 world metres per UV and the paving family is 67.2, so these repeats map
   * the source dimensions to their declared real-world widths instead of guessing
   * from image pixels. Grass uses its 2 m source at repeat 48; wood stays at one
   * repeat because its callers use ordinary box UVs rather than the ground
   * metre-scaled helper.
   */
  type ExternalUpgrade = {
    maps?: SurfaceTextureSet;
    waiters: Array<(maps: SurfaceTextureSet) => void>;
  };
  const externalCache = new Map<string, ExternalUpgrade>();
  const externalKey = (urls: Parameters<typeof loadExternalSurfaceSet>[0], repeat: number): string =>
    `${urls.diffuse}|${urls.roughness}|${urls.normal}|${repeat}`;
  const upgrade = (material: THREE.Material, urls: Parameters<typeof loadExternalSurfaceSet>[0], repeat: number): void => {
    const key = externalKey(urls, repeat);
    const apply = (maps: SurfaceTextureSet): void => {
      if (disposed) {
        maps.map.dispose(); maps.roughnessMap.dispose(); maps.normalMap.dispose();
        return;
      }
      const target = material as THREE.Material & {
        map?: THREE.Texture | null;
        roughnessMap?: THREE.Texture | null;
        normalMap?: THREE.Texture | null;
      };
      target.map = maps.map;
      target.roughnessMap = maps.roughnessMap;
      target.normalMap = maps.normalMap;
      wetRefresh.get(material)?.();
      material.needsUpdate = true;
    };
    const hit = externalCache.get(key);
    if (hit) {
      if (hit.maps) apply(hit.maps);
      else hit.waiters.push(apply);
      return;
    }
    const entry: ExternalUpgrade = { waiters: [apply] };
    externalCache.set(key, entry);
    loadExternalSurfaceSet(urls, repeat, (maps) => {
      if (disposed) {
        maps.map.dispose(); maps.roughnessMap.dispose(); maps.normalMap.dispose();
        externalCache.delete(key);
        return;
      }
      entry.maps = maps;
      own(maps.map); own(maps.roughnessMap); own(maps.normalMap);
      for (const waiter of entry.waiters) waiter(maps);
      entry.waiters.length = 0;
    }, () => disposed);
  };
  // In-flight canary texture loads are owned here: library teardown releases the
  // cancel handles, and each handle late-disposes its completed maps (the loader
  // never aborts the underlying Image request - see ground-pbr-canary.ts).
  const canaryCancelHandles: Array<() => void> = [];
  const groundCanary = isGroundPbrEnabled();
  const lawnCanary = isLawnCanaryEnabled();
  if (groundCanary || lawnCanary) {
    own({
      dispose() {
        for (const cancel of canaryCancelHandles) cancel();
        canaryCancelHandles.length = 0;
      },
    });
  }
  // Ground-family texture source selection. The paving upgrade is UNCONDITIONAL:
  // the canary replaces only the asphalt and concrete singletons, and the absent-
  // flag (baseline) path must run the original asphalt -> paving -> concrete order
  // byte-for-byte. Paving keeps its Polyhaven baseline in every mode.
  if (groundCanary) {
    const asphaltHandle = loadCanarySurfaceSet({
      urls: {
        diffuse: 'assets/ground-pbr-canary/asphalt-1k-color.jpg',
        roughness: 'assets/ground-pbr-canary/asphalt-1k-roughness.jpg',
        normal: 'assets/ground-pbr-canary/asphalt-1k-normal.jpg',
      },
      isDisposed: () => disposed,
      onReady: (maps) => {
        if (disposed) {
          maps.map.dispose(); maps.roughnessMap.dispose(); maps.normalMap.dispose();
          return;
        }
        own(maps.map); own(maps.roughnessMap); own(maps.normalMap);
        applyGroundPbrCanaryMaps(lib.asphalt as THREE.MeshStandardMaterial, {
          maps,
          uvMetresPerUnit: GROUND_CANARY_UV_M.asphalt,
          tilePhysicalMetres: GROUND_CANARY_TILE_M.asphalt,
          normalScale: 0.6,
          roughness: 1.0,
          albedoTint: GROUND_CANARY_ALBEDO_TINT.asphalt,
        });
        wetRefresh.get(lib.asphalt)?.();
        lib.asphalt.needsUpdate = true;
      },
    });
    canaryCancelHandles.push(asphaltHandle.cancel);
  } else {
    // Street PBR candidate: upgrades asphalt and paving to Poly Haven CC0 scans
    // (asphalt_02 by Rob Tuytel, concrete_pavement_02 by Charlotte Baglioni).
    // Delivers authentic two-scale albedo and wide dim specular lobe in raking sun.
    const streetHandle = upgradeStreetPbr({
      asphalt: lib.asphalt,
      paving: lib.paving,
      isDisposed: () => disposed,
      onApplied: (mat) => {
        wetRefresh.get(mat)?.();
        mat.needsUpdate = true;
      },
      ownResource: own,
    });
    canaryCancelHandles.push(streetHandle.cancel);
  }
  if (groundCanary) {
    upgrade(lib.paving, {
      diffuse: 'assets/street-pbr/pavement_diff_1k.jpg',
      roughness: 'assets/street-pbr/pavement_rough_1k.jpg',
      normal: 'assets/street-pbr/pavement_nor_gl_1k.jpg',
    }, 37.333333333333336);
  }
  if (groundCanary) {
    const concreteHandle = loadCanarySurfaceSet({
      urls: {
        diffuse: 'assets/ground-pbr-canary/concrete-1k-color.jpg',
        roughness: 'assets/ground-pbr-canary/concrete-1k-roughness.jpg',
        normal: 'assets/ground-pbr-canary/concrete-1k-normal.jpg',
      },
      isDisposed: () => disposed,
      onReady: (maps) => {
        if (disposed) {
          maps.map.dispose(); maps.roughnessMap.dispose(); maps.normalMap.dispose();
          return;
        }
        own(maps.map); own(maps.roughnessMap); own(maps.normalMap);
        (lib.concrete as THREE.MeshStandardMaterial).color.setHex(PAL.concrete);
        applyGroundPbrCanaryMaps(lib.concrete as THREE.MeshStandardMaterial, {
          maps,
          uvMetresPerUnit: GROUND_CANARY_UV_M.paving,
          tilePhysicalMetres: GROUND_CANARY_TILE_M.concrete,
          normalScale: 0.35,
          roughness: 1.0,
        });
        wetRefresh.get(lib.concrete)?.();
        lib.concrete.needsUpdate = true;
      },
    });
    canaryCancelHandles.push(concreteHandle.cancel);
  } else {
    upgrade(lib.concrete, {
      diffuse: 'textures/polyhaven/concrete-pavement-03/diffuse.jpg',
      roughness: 'textures/polyhaven/concrete-pavement-03/rough.jpg',
      normal: 'textures/polyhaven/concrete-pavement-03/normal.jpg',
    }, 32);
  }
  // Lawn canary (?lawn=canary): swaps ONLY the lawn singleton's maps, on the
  // SAME wetStd material object - one program, one draw call, wetness uniform
  // and material identity (ground-detail.ts ray classification) unchanged. The
  // turf fallback above stays the default whenever the flag is absent.
  if (lawnCanary) {
    // MaterialLibrary types the lawn as THREE.Material; wetStd builds it as a
    // MeshStandardNodeMaterial, so the map-swap applier takes the standard view.
    // Same object throughout: identity (ground-detail ray classification),
    // program and draw-call count are unchanged by the swap.
    const lawnStd = lib.lawn as THREE.MeshStandardMaterial;
    const lawnHandle = loadCanarySurfaceSet({
      urls: LAWN_CANARY_URLS,
      isDisposed: () => disposed,
      onReady: (maps) => {
        if (disposed) {
          maps.map.dispose(); maps.roughnessMap.dispose(); maps.normalMap.dispose();
          return;
        }
        own(maps.map); own(maps.roughnessMap); own(maps.normalMap);
        applyGroundPbrCanaryMaps(lawnStd, buildLawnCanarySpec(maps));
        wetRefresh.get(lawnStd)?.();
        lawnStd.needsUpdate = true;
      },
    });
    canaryCancelHandles.push(lawnHandle.cancel);
  }
  upgrade(lib.deckBoards, {
    diffuse: 'textures/polyhaven/distressed-painted-planks/diffuse.jpg',
    roughness: 'textures/polyhaven/distressed-painted-planks/rough.jpg',
    normal: 'textures/polyhaven/distressed-painted-planks/normal.jpg',
  }, 1);
  // Fence course boards: the intake-lane wooden_planks set (md5-verified in
  // docs/fence-texture-candidate.md). Repeat 1 - the fence-boards helper puts
  // physical 2 m-per-tile UVs directly on the geometry.
  upgrade(lib.fenceBoard, {
    diffuse: 'assets/wooden-planks/wooden_planks_diff_1k.jpg',
    roughness: 'assets/wooden-planks/wooden_planks_rough_1k.jpg',
    normal: 'assets/wooden-planks/wooden_planks_nor_gl_1k.jpg',
  }, 1);
  // Sparse Grass remains in the reviewed asset library; the first runtime
  // comparison read as bare soil here, so this lawn retains its soft turf fallback.

  return lib;
}

// ---------------------------------------------------------------------------
// RAIN (atmosphere lane, additive). One unlit node material for one instanced
// streak sheet around the camera. The whole particle system is in this shader:
// every instance hashes its own seed from `instanceIndex`, falls under its own
// speed plus the shared wind, and wraps inside a 24 x 14 x 24 m box centred on
// the camera, so the CPU never touches a matrix and nothing is allocated per
// frame. `amount` 0 collapses every quad to a point (no fragments); the owner of
// the mesh also sets `visible` so an off sheet costs no draw at all.
// ---------------------------------------------------------------------------
export interface RainMaterialInputs {
  /** vec3 uniform: wind velocity, m/s, world space. */
  wind: Node;
  /** float uniform 0..1: how hard it rains. */
  amount: Node;
  /** color uniform, linear: the streak tint (the horizon sky, lit by the key). */
  tint: Node;
  shelter: RainShelter;
}
/** @types/three's ShaderNodeObject<UniformNode<T>> does not assign to ShaderNodeObject<Node>; widen. */
const nn = (x: Node): N => x as unknown as N;

/** Instances the rain mesh must carry (`InstancedBufferGeometry.instanceCount`). */
export const RAIN_STREAKS = 2600;
const RAIN_BOX = [24, 14, 24] as const;

export function buildRainMaterial(inp: RainMaterialInputs): THREE.Material {
  const m = new MeshBasicNodeMaterial();
  m.name = 'rain';
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = THREE.DoubleSide;
  m.fog = false;

  const wind = nn(inp.wind);
  const amount = nn(inp.amount);
  const box = vec3(RAIN_BOX[0], RAIN_BOX[1], RAIN_BOX[2]);
  const i4 = instanceIndex.mul(4);
  const h0 = hash(i4), h1 = hash(i4.add(1)), h2 = hash(i4.add(2)), h3 = hash(i4.add(3));
  const seed = vec3(h0, h1, h2);
  const speed = float(9).add(h3.mul(3));                       // 9..12 m/s terminal
  const vel = vec3(wind.x, speed.negate(), wind.z);
  // world lattice point, drifting with velocity, wrapped into the box around the camera
  const rel = seed.mul(box).add(vel.mul(time)).sub(cameraPosition).add(box.mul(0.5));
  const wrapped = rel.sub(box.mul(floor(rel.div(box))));
  const centre = cameraPosition.add(wrapped).sub(box.mul(0.5));
  const toCam = centre.sub(cameraPosition);
  const dist = length(toCam);
  const viewDir = toCam.div(dist.max(0.001));
  const fallDir = normalize(vel);
  const right = normalize(cross(fallDir, viewDir));
  const len = float(0.30).add(h1.mul(0.30));
  // width grows with distance so a far streak still covers ~2 px instead of shimmering
  const width = float(0.012).add(dist.mul(0.0035));
  const scale = amount.mul(4).clamp(0, 1);
  const worldPoint = centre
    .add(right.mul(positionLocal.x.mul(width).mul(scale)))
    .add(fallDir.mul(positionLocal.y.mul(len).mul(scale)));
  m.positionNode = worldPoint;

  const distV = varying(dist);
  const fadeNear = smoothstep(float(0.4), float(1.2), distV);
  const fadeFar = oneMinus(smoothstep(float(9), float(13), distV));
  const along = oneMinus(abs(uv().y.mul(2).sub(1)).mul(abs(uv().y.mul(2).sub(1))));
  const across = oneMinus(abs(uv().x.mul(2).sub(1)));
  const rainWorld = varying(worldPoint);
  const roofUV = vec2(
    rainWorld.x.sub(inp.shelter.minX).div(inp.shelter.spanX),
    rainWorld.z.sub(inp.shelter.minZ).div(inp.shelter.spanZ),
  );
  const roofHeight = texture(inp.shelter.texture, roofUV).r;
  const aboveRoof = smoothstep(roofHeight.add(0.02), roofHeight.add(0.12), rainWorld.y);
  m.opacityNode = amount.mul(0.30).mul(fadeNear).mul(fadeFar).mul(along).mul(across).mul(aboveRoof);
  m.colorNode = nn(inp.tint);
  // Rain changes colour only. With depthWrite off, opaque normal/roughness MRT
  // writes described a raindrop at the background depth and GTAO drew dark rods.
  // Alpha-zero auxiliary attachments preserve the opaque surface below it.
  m.mrtNode = mrt({ normal: vec4(0), metalness: vec4(0), roughness: vec4(0) });
  return m;
}
