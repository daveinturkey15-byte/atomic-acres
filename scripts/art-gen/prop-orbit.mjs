/**
 * PROP-ORBIT - photograph a candidate prop in the TARGET RUNTIME CLASS.
 *
 * The `comfyui-3d-native-pipeline` skill is explicit that ComfyUI's Preview3DAdvanced
 * is NOT acceptance evidence: it supplies its own lighting and its own colour
 * handling, so a generated mesh that looks superb there can read as plastic in the
 * game. This harness is the replacement. It stands up a minimal standalone three
 * r180 WebGPURenderer page with THIS project's light rig, tone mapping and sky
 * (numbers copied from src/core/world.ts, src/core/renderer.ts and src/core/palette.ts
 * - no game code is imported, so no lane's file is touched), drops in a 1 m
 * reference cube and a ground plane, and captures the fixed acceptance cameras plus
 * a full 360 orbit and the underside.
 *
 * It renders two kinds of subject so the comparison is like-for-like:
 *   --mode glb          load a .glb with GLTFLoader (the Trellis.2 candidate)
 *   --mode procedural   build the yards.ts crateStack from boxes with the project's
 *                       timber palette (the incumbent this candidate has to beat)
 *
 * It also reports, from inside the runtime and not from a viewer:
 *   - triangles, draw calls, materials, texture dimensions and colour spaces
 *   - the world-space bounding box and where the pivot sits inside it
 *
 * Machine courtesy: real Chrome over CDP (playwright's chromium has no WebGPU
 * adapter), headless, on the second monitor, spawned through proc-guard so the tree
 * always dies; a tiny in-process static server on an ephemeral port, never dist/.
 *
 *   node scripts/art-gen/prop-orbit.mjs --mode glb --glb out/aa-crate-game.glb \
 *        --out captures/heroprop --tag trellis --size 0.6,1.18,0.6
 *   node scripts/art-gen/prop-orbit.mjs --mode procedural --out captures/heroprop \
 *        --tag procedural
 */
import { chromium } from 'playwright';
import http from 'node:http';
import net from 'node:net';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnGuarded, killTree } from '../lib/proc-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const THREE_BUILD = join(ROOT, 'node_modules/three/build');
const THREE_JSM = join(ROOT, 'node_modules/three/examples/jsm');

const argv = process.argv.slice(2);
const opt = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes('--' + n);

const mode = opt('mode', 'glb');
const glbPath = opt('glb', '');
const outDir = resolve(opt('out', join(ROOT, 'captures/heroprop')));
const tag = opt('tag', mode);
const sizeArg = opt('size', '');            // "x,y,z" metres - normalise the import to this
const strip = opt('strip', '');            // e.g. "aoMap,normalMap" - attribution falsifier
const width = Number(opt('w', 1200));
const height = Number(opt('h', 900));

if (mode === 'glb' && !existsSync(glbPath)) {
  console.error('[prop-orbit] --glb not found: ' + glbPath);
  process.exit(2);
}

// ---------------------------------------------------------------- static server ---
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.wasm': 'application/wasm', '.map': 'application/json' };

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

const PAGE = await buildPage();

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  try {
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(PAGE);
    }
    let file = null;
    if (url.startsWith('/three/')) file = join(THREE_BUILD, url.slice(7));
    else if (url.startsWith('/jsm/')) file = join(THREE_JSM, url.slice(5));
    else if (url === '/asset.glb' && glbPath) file = glbPath;
    if (!file || !existsSync(file)) { res.writeHead(404); return res.end('no'); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});
const port = await freePort();
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const base = `http://127.0.0.1:${port}/`;

// ------------------------------------------------------------------ real Chrome ---
function chromePath() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}
const exe = chromePath();
if (!exe) { console.error('[prop-orbit] no real Chrome; this harness needs a WebGPU adapter'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-proporbit-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', `--window-size=${width},${height}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('[prop-orbit] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width, height });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 400)));

let report = { tag, mode, glb: glbPath ? basename(glbPath) : null, frames: [], errors: [] };
try {
  console.log('[prop-orbit] ' + base);
  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__PO && (window.__PO.ready || window.__PO.error),
    null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__PO.error);
  if (err) throw new Error('page: ' + err);

  await mkdir(outDir, { recursive: true });
  const shots = await page.evaluate(() => window.__PO.shotList());
  for (const s of shots) {
    await page.evaluate((n) => window.__PO.shoot(n), s);
    const file = join(outDir, `${tag}-${s}.png`);
    // whole-page shot: the page is nothing but the canvas (playcap's lesson: a
    // `canvas` locator can land on the wrong hidden canvas and time out)
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(file, buf);
    const luma = await page.evaluate(() => window.__PO.lastLuma);
    report.frames.push({ name: s, path: file.replace(/\\/g, '/'), meanLuma: luma });
    console.log(`[prop-orbit] ${s.padEnd(16)} luma ${String(luma).padStart(6)}  -> ${file}`);
  }
  report = { ...report, ...(await page.evaluate(() => window.__PO.facts())) };
} catch (e) {
  report.fatal = String(e);
  console.error('[prop-orbit] FAILED: ' + e);
} finally {
  report.errors = errors;
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `${tag}-report.json`), JSON.stringify(report, null, 2));
  try { await browser.close(); } catch { /* going away anyway */ }
  killTree(chrome.pid);
  server.close();
}
console.log('[prop-orbit] report -> ' + join(outDir, `${tag}-report.json`));
if (report.fatal) process.exit(1);

// ---------------------------------------------------------------------- the page ---
async function buildPage() {
  const cfg = JSON.stringify({ mode, hasGlb: Boolean(glbPath), size: sizeArg, width, height,
    noNormalize: flag('no-normalize'),
    strip: strip ? strip.split(',').map((x) => x.trim()).filter(Boolean) : [] });
  return `<!doctype html><html><head><meta charset="utf-8"><title>prop-orbit</title>
<style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style>
<script type="importmap">{"imports":{
  "three":"/three/three.webgpu.js",
  "three/webgpu":"/three/three.webgpu.js",
  "three/tsl":"/three/three.tsl.js",
  "three/addons/":"/jsm/"
}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CFG = ${cfg};
const PO = window.__PO = { ready:false, error:null, lastLuma:0 };

try {

// ===== constants copied from the game (NOT imported - this page owns no game code)
// src/core/palette.ts
const PAL = { skyTop:0x6f9cc8, skyHorizon:0xcdd9df, sunColor:0xfff2dc, bounce:0xa8a08c,
  pavingWarm:0xcfc4ad, fog:0xccd4d4, sand:0xc4ab7e, timber:0xb0763f, timberDark:0x7d5228 };
// src/core/world.ts
const SUN_DIR = new THREE.Vector3(0.45, 0.55, -0.7).normalize();
const ENV_W = 512, ENV_H = 256;
const ENV_INTENSITY = 0.9;
const FOG_DENSITY = 0.0016;
const CAM_FOV = 72;
// src/core/renderer.ts
const TONE = THREE.ACESFilmicToneMapping, EXPOSURE = 1.09;

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(CFG.width, CFG.height);
renderer.toneMapping = TONE;
renderer.toneMappingExposure = EXPOSURE;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
await renderer.init();
PO.backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl';

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(PAL.fog, FOG_DENSITY);

function smoothstepCpu(e0, e1, x) { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t*t*(3-2*t); }
function bakeEnvironment() {
  const top = new THREE.Color(PAL.skyTop).convertSRGBToLinear();
  const horizon = new THREE.Color(PAL.skyHorizon).convertSRGBToLinear();
  const sun = new THREE.Color(PAL.sunColor).convertSRGBToLinear();
  const paving = new THREE.Color(PAL.pavingWarm).convertSRGBToLinear();
  const bounce = new THREE.Color(PAL.bounce).convertSRGBToLinear();
  const data = new Uint8Array(ENV_W * ENV_H * 4);
  const d = new THREE.Vector3();
  for (let y = 0; y < ENV_H; y++) {
    const v = (y + 0.5) / ENV_H, el = (v - 0.5) * Math.PI, ce = Math.cos(el);
    for (let x = 0; x < ENV_W; x++) {
      const az = ((x + 0.5) / ENV_W - 0.5) * Math.PI * 2;
      d.set(ce * Math.cos(az), Math.sin(el), ce * Math.sin(az));
      let r, g, b;
      if (d.y < 0) {
        const t = Math.pow(Math.min(-d.y * 2.2, 1), 0.6);
        r = paving.r + (bounce.r - paving.r) * t;
        g = paving.g + (bounce.g - paving.g) * t;
        b = paving.b + (bounce.b - paving.b) * t;
      } else {
        const t = Math.pow(Math.min(Math.max(d.y, 0), 1), 0.85);
        r = horizon.r + (top.r - horizon.r) * t;
        g = horizon.g + (top.g - horizon.g) * t;
        b = horizon.b + (top.b - horizon.b) * t;
        const s = Math.max(d.dot(SUN_DIR), 0);
        const glow = Math.pow(s, 8) * 0.28 + Math.pow(s, 180) * 0.9 + Math.pow(s, 1500) * 3.0;
        r += sun.r * glow; g += sun.g * glow; b += sun.b * glow;
        const hz = 1 - smoothstepCpu(-0.04, 0.3, d.y);
        r += (horizon.r * 1.02 - r) * hz;
        g += (horizon.g * 1.02 - g) * hz;
        b += (horizon.b * 1.02 - b) * hz;
      }
      const o = (y * ENV_W + x) * 4;
      data[o] = Math.min(255, Math.round(r * 255));
      data[o+1] = Math.min(255, Math.round(g * 255));
      data[o+2] = Math.min(255, Math.round(b * 255));
      data[o+3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, ENV_W, ENV_H, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
scene.environment = bakeEnvironment();
scene.environmentIntensity = ENV_INTENSITY;
scene.background = new THREE.Color(PAL.skyHorizon).convertSRGBToLinear();

// ---- the game's three lights, same tints, same intensities, same directions
const sunTint = new THREE.Color(PAL.sunColor).offsetHSL(-0.008, 0.05, -0.004);
const sun = new THREE.DirectionalLight(sunTint, 3.35);
sun.position.copy(SUN_DIR).multiplyScalar(40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.00022;
sun.shadow.normalBias = 0.055;
{ const sc = sun.shadow.camera; sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4;
  sc.near = 1; sc.far = 120; sc.updateProjectionMatrix(); }
scene.add(sun); scene.add(sun.target);
const hemi = new THREE.HemisphereLight(PAL.skyTop, PAL.bounce, 0.95);
hemi.position.set(0, 60, 0); scene.add(hemi);
const fillTint = new THREE.Color(PAL.skyTop).offsetHSL(0.02, 0.04, -0.02);
const fill = new THREE.DirectionalLight(fillTint, 0.25);
fill.position.set(-70, 40, 80).normalize().multiplyScalar(40);
scene.add(fill);

// ---- ground + 1 m reference cube
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: PAL.sand, roughness: 1, metalness: 0 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const refCube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 0.85, metalness: 0 }));
refCube.position.set(1.6, 0.5, 0); refCube.castShadow = true; refCube.receiveShadow = true;
scene.add(refCube);

// ---- the subject
const subject = new THREE.Group();
scene.add(subject);
const facts = { materials: [], textures: [], triangles: 0, meshes: 0 };

function measure(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  return { box: { min: box.min.toArray(), max: box.max.toArray() }, size: size.toArray() };
}

if (CFG.mode === 'glb') {
  const gltf = await new GLTFLoader().loadAsync('/asset.glb');
  const root = gltf.scene;
  // record what the loader produced BEFORE anything is changed
  root.updateWorldMatrix(true, true);
  const pre = measure(root);
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    facts.meshes++;
    const g = o.geometry;
    facts.triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (seen.has(m.uuid)) continue; seen.add(m.uuid);
      facts.materials.push({ type: m.type, name: m.name, roughness: m.roughness,
        metalness: m.metalness, side: m.side, vertexColors: m.vertexColors });
      for (const slot of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']) {
        const t = m[slot]; if (!t) continue;
        facts.textures.push({ slot, colorSpace: t.colorSpace,
          width: t.image?.width ?? null, height: t.image?.height ?? null,
          flipY: t.flipY, channel: t.channel });
      }
      // ATTRIBUTION FALSIFIER: knock one map out and re-shoot. A defect that
      // survives its own map is not that map's fault; one that vanishes is.
      for (const slot of CFG.strip) { if (m[slot] !== undefined) { m[slot] = null; m.needsUpdate = true; } }
      facts.stripped = CFG.strip;
    }
    facts.hasUV = Boolean(g.attributes.uv);
    facts.hasUV2 = Boolean(g.attributes.uv1);
    facts.hasNormals = Boolean(g.attributes.normal);
    facts.hasVertexColor = Boolean(g.attributes.color);
  });
  facts.triangles = Math.round(facts.triangles);
  facts.rawBounds = pre;

  // scale + seat on the ground; record the pivot's place inside the box
  let scale = 1;
  if (CFG.size && !CFG.noNormalize) {
    const want = CFG.size.split(',').map(Number);
    const s = pre.size;
    scale = Math.min(want[0] / s[0], want[1] / s[1], want[2] / s[2]);
  }
  root.scale.setScalar(scale);
  root.updateWorldMatrix(true, true);
  const mid = measure(root);
  root.position.set(-(mid.box.min[0] + mid.box.max[0]) / 2, -mid.box.min[1],
                    -(mid.box.min[2] + mid.box.max[2]) / 2);
  subject.add(root);
  facts.appliedScale = scale;
  facts.pivotInBoxNormalised = [
    (0 - pre.box.min[0]) / (pre.size[0] || 1),
    (0 - pre.box.min[1]) / (pre.size[1] || 1),
    (0 - pre.box.min[2]) / (pre.size[2] || 1)];
} else {
  // ---- the incumbent: src/build/yards.ts crateStack(high=true), numbers copied.
  // CU 0.58 unit crate; two side by side at ox -0.5/+0.5, one on top at ox 0.04.
  // Materials: PAL.timber / PAL.timberDark, roughness 1, metalness 0 - the game's
  // procedural timber textures are not reproduced here, so this is the FLAT-COLOUR
  // floor of the incumbent, i.e. the easiest possible thing for the candidate to beat.
  const CU = 0.58;
  const matA = new THREE.MeshStandardMaterial({ color: PAL.timberDark, roughness: 1, metalness: 0 });
  const matB = new THREE.MeshStandardMaterial({ color: PAL.timber, roughness: 1, metalness: 0 });
  const rows = [[-0.5, 0], [0.5, 0], [0.04, 1]];
  for (const [ox, oy] of rows) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(CU, CU, CU), oy ? matB : matA);
    m.position.set(ox * CU, oy * CU + CU / 2, 0);
    m.rotation.y = (ox === 0.04 ? 0.06 : (ox < 0 ? -0.05 : 0.04));
    m.castShadow = true; m.receiveShadow = true;
    subject.add(m);
    facts.meshes++; facts.triangles += 12;
  }
  facts.materials.push({ type: 'MeshStandardMaterial', name: 'timberDark', roughness: 1, metalness: 0 },
                       { type: 'MeshStandardMaterial', name: 'timber', roughness: 1, metalness: 0 });
  facts.appliedScale = 1;
}
subject.updateWorldMatrix(true, true);
facts.finalBounds = measure(subject);
sun.target.position.set(0, 0.5, 0);

// ---- cameras. "player" distances are the ones the brief names: 3 m and 15 m at eye
// height; the rest are the acceptance set (front/side/3-4/low/back/underside + orbit).
const camera = new THREE.PerspectiveCamera(CAM_FOV, CFG.width / CFG.height, 0.05, 1400);
const b = facts.finalBounds;
const h = b.size[1], rad = Math.max(b.size[0], b.size[2]) * 0.5;
const D = Math.max(1.5, rad * 4 + h * 0.9);
const mid = new THREE.Vector3(0, h * 0.5, 0);

function place(az, el, dist, look = mid) {
  const ce = Math.cos(el);
  camera.position.set(Math.sin(az) * ce * dist, Math.sin(el) * dist + look.y, Math.cos(az) * ce * dist);
  camera.lookAt(look);
}
const VIEWS = {
  front:      () => place(0, 0.18, D),
  side:       () => place(Math.PI / 2, 0.18, D),
  threequarter: () => place(Math.PI * 0.25, 0.38, D),
  low:        () => { camera.position.set(0.45 * D, 0.12, 0.9 * D); camera.lookAt(0, h * 0.45, 0); },
  back:       () => place(Math.PI, 0.18, D),
  underside:  () => { ground.visible = false; place(0.6, -0.95, D * 0.9, new THREE.Vector3(0, h * 0.4, 0)); },
  player3m:   () => { camera.position.set(2.1, 1.62, 2.1); camera.lookAt(0, h * 0.5, 0); },
  player15m:  () => { camera.position.set(10.6, 1.62, 10.6); camera.lookAt(0, h * 0.5, 0); },
};
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  VIEWS['orbit' + String(i).padStart(2, '0')] = () => place(a, 0.28, D);
}

PO.shotList = () => Object.keys(VIEWS);
PO.lastLuma = 0;

const lumaCanvas = document.createElement('canvas');
lumaCanvas.width = 160; lumaCanvas.height = 120;
const lctx = lumaCanvas.getContext('2d');

PO.shoot = async (name) => {
  ground.visible = name !== 'underside';
  VIEWS[name]();
  // two frames: the first compiles the pipelines, the second is the photograph
  await renderer.renderAsync(scene, camera);
  await renderer.renderAsync(scene, camera);
  lctx.drawImage(renderer.domElement, 0, 0, 160, 120);
  const d = lctx.getImageData(0, 0, 160, 120).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2];
  PO.lastLuma = Math.round((s / (d.length / 4)) * 10) / 10;
  ground.visible = true;
};

PO.facts = () => {
  const info = renderer.info;
  return { ...facts, renderInfo: { drawCalls: info.render.drawCalls, triangles: info.render.triangles },
    backend: PO.backend,
    toneMapping: 'ACESFilmic', exposure: EXPOSURE, outputColorSpace: renderer.outputColorSpace,
    sunDirection: SUN_DIR.toArray(), sunIntensity: 3.35, hemiIntensity: 0.95,
    fillIntensity: 0.25, environmentIntensity: ENV_INTENSITY, fov: CAM_FOV };
};

PO.ready = true;
} catch (e) {
  PO.error = String(e && e.stack ? e.stack : e);
  PO.ready = true;
}
</script></body></html>`;
}
