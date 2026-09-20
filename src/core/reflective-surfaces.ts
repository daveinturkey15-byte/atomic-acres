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
import { cameraPosition, dot, equirectUV, float, Fn, mix, modelWorldMatrixInverse,
  mrt, normalLocal, normalView, positionLocal, positionViewDirection, positionWorld,
  reference, reflectVector, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
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
interface Binding { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; cabin?: unknown; virtualCabin: boolean }
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

function makeTexture(height: number, name: string, hdr: boolean): THREE.DataTexture {
  const data = hdr ? new Uint16Array(WIDTH * height * 4) : new Uint8Array(WIDTH * height * 4);
  const tex = new THREE.DataTexture(data, WIDTH, height, THREE.RGBAFormat,
    hdr ? THREE.HalfFloatType : THREE.UnsignedByteType);
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
  const src = source.image.data as Uint8Array | Uint16Array;
  const sw = source.image.width, sh = source.image.height;
  const dst = atlas.image.data as Uint8Array | Uint16Array;
  const hdr = source.type === THREE.HalfFloatType;
  const encode = hdr ? THREE.DataUtils.toHalfFloat : (value: number) => Math.min(255, Math.round(value * 255));
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
          dst[o] = encode(colour.r * (ambient + direct * light.sunColor.r));
          dst[o + 1] = encode(colour.g * (ambient + direct * light.sunColor.g));
          dst[o + 2] = encode(colour.b * (ambient + direct * light.sunColor.b));
        } else {
          const so = (Math.floor((y + 0.5) / HEIGHT * sh) * sw + Math.floor((x + 0.5) / WIDTH * sw)) * 4;
          dst[o] = src[so]; dst[o + 1] = src[so + 1]; dst[o + 2] = src[so + 2];
        }
        dst[o + 3] = hdr ? 15360 : 255; // binary16 1.0, not byte 255 in an HDR texture
      }
    }
  }
  (street.image.data as Uint8Array | Uint16Array).set(dst.subarray(0, WIDTH * HEIGHT * 4));
  atlas.needsUpdate = true;
  street.needsUpdate = true;
  street.needsPMREMUpdate = true;
}

/** Virtual cabin shading for the opaque vehicle covers. The ray exits a box
 * derived from that mesh's existing glazing bounds, while seats sit halfway
 * across it: two distinct depths retain camera-motion parallax. This is shading,
 * not reconstructed interior geometry; vehicle colliders remain solid. */
function cabinRadiance(atlas: THREE.DataTexture, light: ReturnType<typeof uniform<number>>) {
  return Fn(() => {
    const lo = reference('userData.reflectiveCabin.min', 'vec3', null);
    const hi = reference('userData.reflectiveCabin.max', 'vec3', null);
    const cells = reference('userData.reflectiveCabin.cells', 'float', null);
    const localEye = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
    const ray = positionLocal.sub(localEye).normalize().toVar();
    // Signed nonzero denominator, including exactly axis-parallel views.
    // r180 select() lowers its condition to scalar bool; do not use a bvec3
    // condition here or the first axis would choose the sign of every axis.
    const safe = vec3(
      ray.x.greaterThanEqual(0).select(ray.x.abs().max(0.0001), ray.x.abs().max(0.0001).negate()),
      ray.y.greaterThanEqual(0).select(ray.y.abs().max(0.0001), ray.y.abs().max(0.0001).negate()),
      ray.z.greaterThanEqual(0).select(ray.z.abs().max(0.0001), ray.z.abs().max(0.0001).negate()),
    );
    const far = lo.sub(positionLocal).div(safe).max(hi.sub(positionLocal).div(safe)).toVar();
    const distance = far.x.min(far.y).min(far.z).max(0).toVar();
    const extent = hi.sub(lo).max(vec3(0.001)).toVar();
    const q = positionLocal.add(ray.mul(distance)).sub(lo).div(extent).clamp(0, 1).toVar();
    const side = normalLocal.z.abs().greaterThan(normalLocal.x.abs());
    const centre = lo.add(hi).mul(0.5);
    const seatDistance = side.select(centre.z.sub(positionLocal.z).div(safe.z),
      centre.x.sub(positionLocal.x).div(safe.x)).clamp(0, distance);
    const seat = positionLocal.add(ray.mul(seatDistance)).sub(lo).div(extent).clamp(0, 1).toVar();
    const along = side.select(q.x.mul(cells), q.z.mul(2));
    const mullion = float(1).sub(smoothstep(0.035, 0.07, along.fract().sub(0.5).abs().oneMinus().sub(0.5)));
    const windowBand = smoothstep(0.55, 0.62, q.y).mul(float(1).sub(smoothstep(0.93, 0.99, q.y)));
    const wall = far.y.lessThanEqual(distance.add(0.001)).select(0, 1);
    const window = windowBand.mul(float(1).sub(mullion)).mul(wall);
    const through = positionWorld.sub(cameraPosition).normalize();
    const skyUV = equirectUV(through);
    // Street probe only: this branch is never used on architecture. Exterior
    // radiance is attenuated through the shaded cabin and its opposite glass.
    const exterior = texture(atlas, vec2(skyUV.x, skyUV.y.clamp(0.5 / HEIGHT, 1 - 0.5 / HEIGHT).div(PROBES)))
      .level(float(2)).rgb;
    const seatAlong = side.select(seat.x.mul(cells), seat.z.mul(2)).fract().sub(0.5).abs();
    const back = float(1).sub(smoothstep(0.29, 0.37, seatAlong))
      .mul(float(1).sub(smoothstep(0.47, 0.57, seat.y)));
    const head = float(1).sub(smoothstep(0.14, 0.22, seatAlong))
      .mul(float(1).sub(smoothstep(0.64, 0.72, seat.y)));
    const seats = back.max(head).mul(smoothstep(0.02, 0.08, seat.y));
    const dark = vec3(colours.window.r, colours.window.g, colours.window.b).mul(0.11).mul(light);
    const cabin = mix(dark.mul(0.6), exterior.mul(0.32), window);
    return mix(cabin, dark.mul(0.38), seats);
  })();
}

function glazing(source: Standard, atlas: THREE.DataTexture, opaque: boolean,
  cabinLight?: ReturnType<typeof uniform<number>>): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = `LocalProbeGlazing:${cabinLight ? 'vehicle-cabin' : opaque ? 'dark' : source.opacity > 0.5 ? 'roof' : 'clear'}`;
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
    m.colorNode = mix(cabinLight ? cabinRadiance(atlas, cabinLight) : tint.mul(0.45), reflected, f);
  } else {
    const absorption = source.opacity * 0.25;
    const alpha = f.add(float(1).sub(f).mul(absorption));
    m.colorNode = reflected.mul(f).add(tint.mul(float(1).sub(f)).mul(absorption * 0.2)).div(alpha);
    m.opacityNode = alpha;
  }
  m.userData.reflectiveSurfaces = { approximateStaticProbe: true, sourceRoughness: source.roughness,
    sourceOpacity: source.opacity, sourceTint: source.color.getHex(), transparent: source.transparent,
    virtualCabin: !!cabinLight };
  return m;
}

/** Assembly-only; does not mutate the library or dispose resources it does not own. */
export function installReflectiveSurfaces(scene: THREE.Scene, surfaces: SurfaceSet,
  atmosphere: Pick<Atmosphere, 'effective'>, enabled = isReflectiveSurfacesEnabled()): ReflectiveSurfaces | null {
  if (!enabled) return null;
  const current = installed.get(scene);
  if (current && !current.disposed) return current;
  const source = scene.environment;
  const hdr = source?.type === THREE.HalfFloatType;
  if (!(source instanceof THREE.DataTexture) || source.format !== THREE.RGBAFormat
    || !(hdr ? source.image.data instanceof Uint16Array
      : source.type === THREE.UnsignedByteType && source.image.data instanceof Uint8Array)) {
    throw new Error('glazing canary requires the in-place RGBA8 or RGBA16F atmosphere environment');
  }
  const atlas = makeTexture(HEIGHT * PROBES, 'ApproximateLocalReflectionAtlas', hdr);
  const street = makeTexture(HEIGHT, 'ApproximateStreetReflection', hdr);
  street.mapping = THREE.EquirectangularReflectionMapping;
  const materials = [glazing(surfaces.glass as Standard, atlas, false),
    glazing(surfaces.roofGlazing as Standard, atlas, false), glazing(surfaces.windowDark as Standard, atlas, true)];
  const replacements = new Map<THREE.Material, THREE.Material>([
    [surfaces.glass, materials[0]], [surfaces.roofGlazing, materials[1]], [surfaces.windowDark, materials[2]],
  ]);
  const bindings: Binding[] = [];
  const cabinLight = uniform(1);
  let vehicleMaterial: MeshBasicNodeMaterial | undefined;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material;
    let next = Array.isArray(original) ? original.map(m => replacements.get(m) ?? m) : replacements.get(original);
    if (!next || (Array.isArray(original) && !(next as THREE.Material[]).some((m, i) => m !== original[i]))) return;
    let vehicle = false;
    for (let parent = mesh.parent; parent && parent !== scene; parent = parent.parent) {
      if (['coach', 'coach-second', 'saloon', 'display-sedan', 'box-truck'].includes(parent.name)) { vehicle = true; break; }
    }
    const virtualCabin = vehicle && original === surfaces.windowDark && !(mesh instanceof THREE.InstancedMesh);
    const cabin = mesh.userData.reflectiveCabin;
    if (virtualCabin) {
      // Bounding metadata only; no vertex, normal, UV, index or collider changes.
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox!;
      const floor = bounds.min.clone().addScalar(-0.025);
      floor.y = Math.max(0.1, bounds.min.y - (bounds.max.y - bounds.min.y) * 1.4);
      mesh.userData.reflectiveCabin = { min: floor,
        max: bounds.max.clone().addScalar(0.025), cells: Math.max(2, Math.min(9, Math.round((bounds.max.x - bounds.min.x) / 1.05))) };
      if (!vehicleMaterial) {
        vehicleMaterial = glazing(surfaces.windowDark as Standard, atlas, true, cabinLight);
        materials.push(vehicleMaterial);
      }
      next = vehicleMaterial;
    }
    bindings.push({ mesh, material: original, cabin, virtualCabin }); mesh.material = next;
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
      const light = atmosphere.effective();
      bake(atlas, street, source, light, boxes);
      cabinLight.value = Math.min(1, 0.15 + light.sunIntensity * 0.18 + light.hemiIntensity * 0.28);
      version = source.version; count++; lastMs = performance.now() - started;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const binding of bindings) {
        binding.mesh.material = binding.material;
        if (binding.virtualCabin) {
          if (binding.cabin === undefined) delete binding.mesh.userData.reflectiveCabin;
          else binding.mesh.userData.reflectiveCabin = binding.cabin;
        }
      }
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
