/**
 * Opt-in thin glazing with approximate STATIC local reflection probes.
 *
 * The probes contain layout-derived architectural massing, not captured scene
 * pixels. Five anchors keep front/rear glazing in the correct neighbourhood;
 * this remains an approximation (no reflected actors, fine props or exact
 * parallax). No scene render, new light, transmission pass or SSR is added.
 * Install once after static assembly, before the first frame. post.ts refreshes
 * the existing byte buffers only when the atmosphere's environment version changes.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { dot, equirectUV, float, mix, mrt, normalView, positionViewDirection,
  positionWorld, reflectVector, texture, vec2, vec3 } from 'three/tsl';
import type { MaterialLibrary } from './materials';
import type { Atmosphere, EffectiveState } from './atmosphere';
import { EAVE_Y, FLOOR_H, FRONT_LAWN_OUTER, GARAGE_DEPTH, GARAGE_H, GARAGE_LEN,
  HOUSES, HOUSE_BACK, HOUSE_HALF_LEN, PAVEMENT_OUTER, ROAD_HALF_WIDTH,
  THIRD_HOUSE_X, YARD_X_MAX } from './layout';
import { PAL } from './palette';

const WIDTH = 256, HEIGHT = 128, PROBES = 5;
const PROBE_Y = FLOOR_H * 0.65;
const CENTRES = [0, -FRONT_LAWN_OUTER + 1, -HOUSE_BACK - 1,
  FRONT_LAWN_OUTER - 1, HOUSE_BACK + 1];
type SurfaceSet = Pick<MaterialLibrary, 'glass' | 'roofGlazing' | 'windowDark' | 'chrome'>;
type Standard = THREE.MeshStandardMaterial;
interface Proxy { min: number[]; max: number[]; colour: THREE.Color; windows: boolean }
interface Binding { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }
export interface ReflectiveSurfaces {
  readonly materials: readonly MeshBasicNodeMaterial[];
  readonly atlas: THREE.DataTexture;
  readonly street: THREE.DataTexture;
  readonly changedMeshes: number;
  readonly bytes: number;
  readonly bakeCount: number;
  readonly lastBakeMs: number;
  readonly disposed: boolean;
  refresh(): void;
  dispose(): void;
}
const installed = new WeakMap<THREE.Scene, ReflectiveSurfaces>();
const lin = (hex: number) => new THREE.Color(hex);
const colours = { asphalt: lin(PAL.asphalt), paving: lin(PAL.concrete),
  lawn: lin(PAL.lawn), sand: lin(PAL.sand), window: lin(PAL.windowDark),
  roof: lin(PAL.roofWhite) };

export function isReflectiveSurfacesEnabled(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('glazing') === 'canary';
}

function proxies(): Proxy[] {
  const result: Proxy[] = [];
  for (const house of HOUSES) {
    const z0 = Math.min(house.frontZ, house.backZ), z1 = Math.max(house.frontZ, house.backZ);
    result.push({ min: [-HOUSE_HALF_LEN, 0, z0], max: [HOUSE_HALF_LEN, FLOOR_H, z1],
      colour: lin(PAL.houseCream), windows: true });
    result.push({ min: [-HOUSE_HALF_LEN, FLOOR_H, z0], max: [HOUSE_HALF_LEN, EAVE_Y, z1],
      colour: lin(house.side < 0 ? PAL.terracotta : PAL.capsuleWhite), windows: true });
    const end = house.frontZ + house.side * GARAGE_DEPTH;
    result.push({ min: [house.garageX - GARAGE_LEN / 2, 0, Math.min(house.frontZ, end)],
      max: [house.garageX + GARAGE_LEN / 2, GARAGE_H, Math.max(house.frontZ, end)],
      colour: lin(PAL.houseCream), windows: false });
  }
  result.push({ min: [THIRD_HOUSE_X, 0, -HOUSE_HALF_LEN],
    max: [THIRD_HOUSE_X + GARAGE_DEPTH, EAVE_Y, HOUSE_HALF_LEN],
    colour: lin(PAL.thirdWall), windows: true });
  return result;
}

/** Slab intersection: axis-parallel rays never divide by zero. Normal is encoded
 * as +/- (axis + 1), and distance<0 denotes a miss. Exported for finite controls. */
export function reflectionBoxHit(origin: readonly number[], direction: readonly number[],
  lo: readonly number[], hi: readonly number[], out: [number, number] = [-1, 0]): [number, number] {
  let enter = -Infinity, exit = Infinity, face = 0;
  out[0] = -1; out[1] = 0;
  for (let axis = 0; axis < 3; axis++) {
    const d = direction[axis], o = origin[axis];
    if (!Number.isFinite(d) || !Number.isFinite(o) || !Number.isFinite(lo[axis]) || !Number.isFinite(hi[axis])) {
      throw new RangeError('non-finite reflection proxy');
    }
    if (Math.abs(d) < 1e-8) {
      if (o < lo[axis] || o > hi[axis]) return out;
      continue;
    }
    const a = (lo[axis] - o) / d, b = (hi[axis] - o) / d;
    const near = Math.min(a, b), far = Math.max(a, b);
    if (near > enter) { enter = near; face = (d > 0 ? -1 : 1) * (axis + 1); }
    exit = Math.min(exit, far);
    if (exit < enter) return out;
  }
  // A probe inside a proxy must not reflect its own opaque interior mass.
  if (enter > 0.05 && exit >= enter && Number.isFinite(enter)) { out[0] = enter; out[1] = face; }
  return out;
}

function makeTexture(height: number, name: string): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(WIDTH * height * 4), WIDTH, height);
  tex.name = name;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  return tex;
}

/** Fills preallocated maps. Radiance is linear; source sky remains authoritative.
 * Proxy faces use the live sun direction/colour and ambient state, so a weather
 * switch cannot leave a noon reflection pasted onto a dusk window. */
function bake(atlas: THREE.DataTexture, street: THREE.DataTexture,
  source: THREE.DataTexture, light: Readonly<EffectiveState>, boxes: Proxy[]): void {
  const src = source.image.data as Uint8Array;
  const sw = source.image.width, sh = source.image.height;
  const dst = atlas.image.data as Uint8Array;
  const origin = [0, PROBE_Y, 0], dir = [0, 0, 0];
  const hit: [number, number] = [-1, 0];
  const sun = light.sunDir;
  const sunLength = Math.hypot(sun.x, sun.y, sun.z) || 1;
  for (let p = 0; p < PROBES; p++) {
    origin[2] = CENTRES[p];
    for (let y = 0; y < HEIGHT; y++) {
      const elevation = ((y + 0.5) / HEIGHT - 0.5) * Math.PI;
      const ce = Math.cos(elevation);
      dir[1] = Math.sin(elevation);
      for (let x = 0; x < WIDTH; x++) {
        const azimuth = ((x + 0.5) / WIDTH - 0.5) * Math.PI * 2;
        dir[0] = ce * Math.cos(azimuth); dir[2] = ce * Math.sin(azimuth);
        let distance = dir[1] < -1e-6 ? -PROBE_Y / dir[1] : Infinity;
        let face = 2, colour: THREE.Color | undefined;
        if (Number.isFinite(distance)) {
          const gx = dir[0] * distance, gz = origin[2] + dir[2] * distance;
          colour = Math.abs(gz) < ROAD_HALF_WIDTH ? colours.asphalt
            : Math.abs(gz) < PAVEMENT_OUTER ? colours.paving
              : Math.abs(gx) < YARD_X_MAX && Math.abs(gz) < HOUSE_BACK ? colours.lawn : colours.sand;
        }
        for (const box of boxes) {
          reflectionBoxHit(origin, dir, box.min, box.max, hit);
          if (hit[0] < 0 || hit[0] >= distance) continue;
          distance = hit[0]; face = hit[1]; colour = Math.abs(face) === 2 ? colours.roof : box.colour;
          const hy = PROBE_Y + dir[1] * distance;
          // Coarse window rhythm communicates massing only; no signage or copied art.
          if (box.windows && Math.abs(face) !== 2 && hy % FLOOR_H > FLOOR_H * 0.32
            && hy % FLOOR_H < FLOOR_H * 0.79) {
            const along = Math.abs(face) === 1 ? origin[2] + dir[2] * distance : dir[0] * distance;
            if (Math.abs(along / 1.8 - Math.round(along / 1.8)) < 0.34) colour = colours.window;
          }
        }
        const o = ((p * HEIGHT + y) * WIDTH + x) * 4;
        if (colour) {
          const component = Math.abs(face) === 1 ? sun.x : Math.abs(face) === 2 ? sun.y : sun.z;
          const ndl = Math.max(0, component * Math.sign(face) / sunLength);
          const direct = light.sunIntensity * ndl / Math.PI;
          const ambient = 0.19 * light.hemiIntensity + 0.12 * light.envIntensity;
          dst[o] = Math.min(255, Math.round(colour.r * (ambient + direct * light.sunColor.r) * 255));
          dst[o + 1] = Math.min(255, Math.round(colour.g * (ambient + direct * light.sunColor.g) * 255));
          dst[o + 2] = Math.min(255, Math.round(colour.b * (ambient + direct * light.sunColor.b) * 255));
        } else {
          const so = (Math.floor((y + 0.5) / HEIGHT * sh) * sw + Math.floor((x + 0.5) / WIDTH * sw)) * 4;
          dst[o] = src[so]; dst[o + 1] = src[so + 1]; dst[o + 2] = src[so + 2];
        }
        dst[o + 3] = 255;
      }
    }
  }
  (street.image.data as Uint8Array).set(dst.subarray(0, WIDTH * HEIGHT * 4));
  atlas.needsUpdate = true;
  street.needsUpdate = true;
  street.needsPMREMUpdate = true;
}

function glazing(source: Standard, atlas: THREE.DataTexture, opaque: boolean): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = `LocalProbeGlazing:${opaque ? 'dark' : source.opacity > 0.5 ? 'roof' : 'clear'}`;
  m.transparent = !opaque;
  m.depthWrite = opaque;
  m.side = source.side;
  m.fog = source.fog;
  // The existing four-output MRT remains intact. Basic materials have no PBR
  // variants, so explicitly initialise its auxiliary channels for the post chain.
  m.mrtNode = mrt({ roughness: float(source.roughness), metalness: float(0) });
  // Select by world position, so all panes share THREE materials instead of
  // allocating one per window. Architecture itself never crosses these seams.
  const zone = positionWorld.z.lessThan(-HOUSE_BACK + 0.5).select(2,
    positionWorld.z.lessThan(-FRONT_LAWN_OUTER + 0.5).select(1,
      positionWorld.z.greaterThan(HOUSE_BACK - 0.5).select(4,
        positionWorld.z.greaterThan(FRONT_LAWN_OUTER - 0.5).select(3, 0))));
  const reflectedUV = equirectUV(reflectVector);
  const atlasUV = vec2(reflectedUV.x, reflectedUV.y.clamp(0.5 / HEIGHT, 1 - 0.5 / HEIGHT).add(zone).div(PROBES));
  // Explicit low mip from the retained source roughness, with no runtime RTT.
  const reflected = texture(atlas, atlasUV).level(float(source.roughness * 14)).rgb;
  const facing = dot(normalView, positionViewDirection).abs().clamp(0, 1);
  // Two air/glass interfaces, IOR 1.5. Source-over alpha below preserves the
  // reflection term instead of attenuating it a second time with constant alpha.
  const f = float(0.08).add(float(0.92).mul(float(1).sub(facing).pow(5)));
  const tint = vec3(source.color.r, source.color.g, source.color.b);
  if (opaque) {
    m.colorNode = mix(tint.mul(0.45), reflected, f);
  } else {
    const absorption = source.opacity * 0.25;
    const alpha = f.add(float(1).sub(f).mul(absorption));
    m.colorNode = reflected.mul(f).add(tint.mul(float(1).sub(f)).mul(absorption * 0.2)).div(alpha);
    m.opacityNode = alpha;
  }
  m.userData.reflectiveSurfaces = { approximateStaticProbe: true, sourceRoughness: source.roughness,
    sourceOpacity: source.opacity, sourceTint: source.color.getHex(), transparent: source.transparent };
  return m;
}

/** Assembly-only; does not mutate the library or dispose resources it does not own. */
export function installReflectiveSurfaces(scene: THREE.Scene, surfaces: SurfaceSet,
  atmosphere: Pick<Atmosphere, 'effective'>, enabled = isReflectiveSurfacesEnabled()): ReflectiveSurfaces | null {
  if (!enabled) return null;
  const current = installed.get(scene);
  if (current && !current.disposed) return current;
  const source = scene.environment;
  if (!(source instanceof THREE.DataTexture) || !(source.image.data instanceof Uint8Array)) {
    throw new Error('glazing canary requires the existing RGBA8 atmosphere environment');
  }
  const atlas = makeTexture(HEIGHT * PROBES, 'ApproximateLocalReflectionAtlas');
  const street = makeTexture(HEIGHT, 'ApproximateStreetReflection');
  street.mapping = THREE.EquirectangularReflectionMapping;
  const materials = [glazing(surfaces.glass as Standard, atlas, false),
    glazing(surfaces.roofGlazing as Standard, atlas, false), glazing(surfaces.windowDark as Standard, atlas, true)];
  const replacements = new Map<THREE.Material, THREE.Material>([
    [surfaces.glass, materials[0]], [surfaces.roofGlazing, materials[1]], [surfaces.windowDark, materials[2]],
  ]);
  const bindings: Binding[] = [];
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material;
    const next = Array.isArray(original) ? original.map(m => replacements.get(m) ?? m) : replacements.get(original);
    if (!next || (Array.isArray(original) && !(next as THREE.Material[]).some((m, i) => m !== original[i]))) return;
    bindings.push({ mesh, material: original }); mesh.material = next;
  });
  const chrome = surfaces.chrome as Standard, previousEnv = chrome.envMap;
  chrome.envMap = street; chrome.needsUpdate = true;
  const boxes = proxies();
  let version = -1, count = 0, lastMs = 0, disposed = false;
  const api: ReflectiveSurfaces = {
    materials, atlas, street, changedMeshes: bindings.length,
    bytes: atlas.image.data.byteLength + street.image.data.byteLength,
    get bakeCount() { return count; }, get lastBakeMs() { return lastMs; }, get disposed() { return disposed; },
    refresh() {
      if (disposed || version === source.version) return;
      const started = performance.now();
      bake(atlas, street, source, atmosphere.effective(), boxes);
      version = source.version; count++; lastMs = performance.now() - started;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const binding of bindings) binding.mesh.material = binding.material;
      chrome.envMap = previousEnv; chrome.needsUpdate = true;
      for (const material of materials) material.dispose();
      atlas.dispose(); street.dispose(); bindings.length = 0;
      installed.delete(scene);
    },
  };
  installed.set(scene, api);
  api.refresh();
  return api;
}

export function updateReflectiveSurfaces(scene: THREE.Scene): void { installed.get(scene)?.refresh(); }
export function disposeReflectiveSurfaces(scene: THREE.Scene): void { installed.get(scene)?.dispose(); }
