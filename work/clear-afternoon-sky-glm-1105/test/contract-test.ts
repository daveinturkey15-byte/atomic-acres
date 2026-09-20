/**
 * Headless contract test for the clear-afternoon sky candidate
 * (work/clear-afternoon-sky-glm-1105). No GPU, no DOM: the bake is pure CPU
 * and the ownership contracts are plain object state.
 * Run: node test/run-test.mjs  (from work/clear-afternoon-sky-glm-1105)
 */
import * as THREE from 'three';
import { createAfternoonSky, AfternoonSkyDisposedError } from '../src/core/skyAfternoon';

const TAU = Math.PI * 2;
let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error('FAIL: ' + msg);
  passed++;
  console.log('ok - ' + msg);
}

// Same alignment formula the main.ts wiring uses: the live sun light's position
// relative to its shadow target, normalized.
const SUN = new THREE.Vector3(58, 72, -92).normalize();
const sunAz = (Math.atan2(SUN.z, SUN.x) * 180) / Math.PI;
const sunEl = (Math.asin(SUN.y) * 180) / Math.PI;

/** Mirrors three's equirectUv: u = atan2(z,x)/TAU + 0.5, v = asin(y)/PI + 0.5. */
function sample(tex: THREE.DataTexture, dx: number, dy: number, dz: number): [number, number, number] {
  const img = tex.image;
  const u = Math.atan2(dz, dx) / TAU + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, dy))) / Math.PI + 0.5;
  const i = Math.min(img.width - 1, Math.floor(u * img.width));
  const j = Math.min(img.height - 1, Math.floor(v * img.height));
  const o = (j * img.width + i) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

function dirAt(elevDeg: number, azimDeg: number): [number, number, number] {
  const e = (elevDeg * Math.PI) / 180;
  const a = (azimDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
}

// ---- determinism ----------------------------------------------------------
const a = createAfternoonSky({ scene: new THREE.Scene(), sunDir: SUN });
const b = createAfternoonSky({ scene: new THREE.Scene(), sunDir: SUN.clone() });
const da = a.texture.image.data;
const db = b.texture.image.data;
let identical = da.length === db.length;
if (identical) for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) { identical = false; break; }
ok(identical, 'bake is deterministic (byte-identical for equal inputs)');

// ---- texture shape (three 0.180 API surface) -------------------------------
ok(a.texture instanceof THREE.DataTexture, 'background is a THREE.DataTexture');
ok(a.texture.mapping === THREE.EquirectangularReflectionMapping, 'equirect mapping');
ok(a.texture.colorSpace === THREE.SRGBColorSpace, 'sRGB colorSpace');
ok(a.texture.format === THREE.RGBAFormat, 'RGBA8 format');
ok(a.texture.image.width === 2048 && a.texture.image.height === 1024, 'bounded 2K equirect (2048x1024)');
ok(a.texture.wrapS === THREE.RepeatWrapping, 'azimuth wrap is repeat (seamless)');
ok(a.texture.minFilter === THREE.LinearFilter, 'linear filtering, no mipmap generation');

// ---- physical read of the bake ---------------------------------------------
// near-sun sky (2 deg off the disc) vs the same elevation on the anti-sun side
const [sr, , sb] = sample(a.texture, ...dirAt(sunEl + 2, sunAz));
const [ar, , ab] = sample(a.texture, ...dirAt(sunEl + 2, sunAz + 180));
ok(sr > ar && sr / Math.max(1, sb) > ar / Math.max(1, ab), 'near-sun sky is brighter and warmer than anti-sun');
// zenith vs horizon on the anti-sun meridian: air-mass gradient
const [zr, , zb] = sample(a.texture, ...dirAt(70, sunAz + 90));
const [hr, , hb] = sample(a.texture, ...dirAt(4, sunAz + 90));
ok(zb - zr > hb - hr && zb > 100, 'zenith saturated blue, horizon pales (air-mass gradient)');
ok(hr > 170, 'horizon reads as bright hazy pale');
const [dr, , db2] = sample(a.texture, ...dirAt(3, sunAz));
const [dr2, , db3] = sample(a.texture, ...dirAt(3, sunAz + 180));
ok(dr / Math.max(1, db2) > dr2 / Math.max(1, db3), 'low sky is warm on the sun side (dust term)');

// ---- ownership / restore / disposal contracts ------------------------------
const scene = new THREE.Scene();
const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4));
dome.name = 'sky';
scene.add(dome);

const h = createAfternoonSky({ scene, sunDir: SUN });
ok(!h.enabled, 'create() does not enable: default OFF');
ok(scene.background === null && dome.visible, 'disabled: scene untouched');

h.enable();
const tex = h.texture;
ok(h.enabled && scene.background === tex, 'enable() installs the owned background');
ok(!dome.visible, 'enable() hides the TSL dome before the first frame');

h.disable();
ok(scene.background === null && dome.visible, 'disable() restores background AND dome');
h.enable();
ok(h.enabled && scene.background === tex && !dome.visible, 're-enable reuses the same texture instance (no realloc)');

h.dispose();
ok(scene.background === null && dome.visible, 'dispose() while enabled restores original state');
ok(h.disposed, 'dispose() marks the handle disposed');
let threw = false;
try {
  void h.texture;
} catch (e) {
  threw = e instanceof AfternoonSkyDisposedError;
}
ok(threw, 'texture getter throws AfternoonSkyDisposedError after dispose');
threw = false;
try {
  h.enable();
} catch (e) {
  threw = e instanceof AfternoonSkyDisposedError;
}
ok(threw, 'enable() after dispose throws (late-arrival guard)');
h.dispose();
ok(true, 'double dispose() is an idempotent no-op');

console.log('PASS ' + passed + ' assertions');
