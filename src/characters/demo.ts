/**
 * Headless demo + measurement page for the characters lane.
 * Served from a dev server as /characters/ (never wired into main.ts).
 *
 * Modes by hash: #clips (hero cycles every clip, camera follows),
 * #crowd (12 mixed characters), #soak (crowd + auto stats).
 *
 * window.__CHARS QA surface: ready, playClip, setCrowd, stats, skate.
 */
import * as THREE from 'three';
import { animJsonToClip, createCharacterSystem, type AnimJsonDoc, type CharacterHandle } from './index';
import type { ClipName } from './clips';

const hash = location.hash.replace('#', '') || 'clips';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1600, 900);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2028);
scene.fog = new THREE.Fog(0x1a2028, 20, 90);

const camera = new THREE.PerspectiveCamera(55, 1600 / 900, 0.1, 300);

const hemi = new THREE.HemisphereLight(0xcdd9df, 0x3a352c, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
sun.position.set(6, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
scene.add(sun);

// Ground: big, grid-read so forward motion is visible in captures.
const groundMat = new THREE.MeshStandardMaterial({ color: 0x4c7a33, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(240, 120, 0xffffff, 0xffffff);
grid.material.transparent = true;
grid.material.opacity = 0.18;
grid.position.y = 0.01;
scene.add(grid);
// Metre posts every 5 m along the hero lane so stride is measurable by eye.
const postGeo = new THREE.BoxGeometry(0.08, 1.0, 0.08);
const postMat = new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.8 });
for (let x = -40; x <= 40; x += 5) {
  const post = new THREE.Mesh(postGeo, postMat);
  post.position.set(x, 0.5, -1.2);
  scene.add(post);
}

const skin = new THREE.MeshStandardMaterial({ color: 0xd9cfc0, roughness: 0.7 });
const cloth = new THREE.MeshStandardMaterial({ color: 0x2c8d93, roughness: 0.65 });
const cloth2 = new THREE.MeshStandardMaterial({ color: 0x8e2540, roughness: 0.65 });
const dark = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.8 });

const system = createCharacterSystem(scene, { skin, cloth, dark });

const CLIP_ORDER: ClipName[] = [
  'idle', 'walk', 'run', 'sprint', 'crouch-idle', 'crouch-walk',
  'jump', 'land', 'turn-left', 'turn-right', 'aim', 'fire',
  'reload', 'hit-react', 'death',
];
const CLIP_SPEED: Record<string, number> = {
  walk: 1.1, run: 3.4, sprint: 5.5, 'crouch-walk': 0.85,
};

let hero: CharacterHandle = system.spawn(0, 0, 0, 1);
let clipIdx = 0;
let clipTimer = 0;
let followHero = true;

function heroSpeedFor(clip: ClipName): number {
  return CLIP_SPEED[clip] ?? 0;
}

/** Manual selections hold the auto-cycle off so measurements own the pose. */
let manualHoldUntil = 0;

function applyHeroClip(clip: ClipName): void {
  const spec = system.library[clip];
  hero.input.speed = heroSpeedFor(clip);
  hero.input.crouch = clip === 'crouch-idle' || clip === 'crouch-walk';
  hero.input.aimWeight = clip === 'aim' || clip === 'fire' ? 1 : 0;
  hero.yaw = 0;
  hero.root.rotation.y = 0;
  if (!spec.loop) {
    if (clip === 'jump' || clip === 'land') hero.rig.playAir(clip);
    else if (clip === 'death') hero.rig.playDeath();
    else if (clip === 'reload' || clip === 'hit-react') hero.rig.playUpper(clip);
    else if (clip === 'fire') hero.rig.fire();
  }
  hero.rig.resetSkate();
}

function setCrowd(): void {
  while (system.characters.length) system.despawn(system.characters[0]);
  hero = system.spawn(0, 0, 0, 1);
  const gaits: ClipName[] = ['walk', 'run', 'sprint', 'crouch-walk'];
  for (let i = 1; i < 12; i++) {
    const c = system.spawn(-8 + (i % 6) * 3.2, -6 + Math.floor(i / 6) * 5, 0, 0.93 + (i % 4) * 0.05);
    const g = gaits[i % gaits.length];
    c.input.speed = heroSpeedFor(g);
    c.input.crouch = g === 'crouch-walk';
    // Alternate factions so the soak shows two kits on screen at once.
    if (i % 2 === 1) {
      c.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material === cloth) o.material = cloth2;
      });
    }
  }
  followHero = false;
}

if (hash === 'crowd' || hash === 'soak') {
  setCrowd();
  hero.input.speed = 1.5;
} else {
  applyHeroClip('idle');
}

const clock = new THREE.Clock();
let frameMs = 0;
let frames = 0;

function tick(): void {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  frameMs = frameMs * 0.95 + dt * 1000 * 0.05;
  frames++;
  if (hash === 'clips' && performance.now() > manualHoldUntil) {
    clipTimer += dt;
    if (clipTimer > 2.2) {
      clipTimer = 0;
      if (CLIP_ORDER[clipIdx] === 'death') hero.rig.revive();
      clipIdx = (clipIdx + 1) % CLIP_ORDER.length;
      applyHeroClip(CLIP_ORDER[clipIdx]);
    }
  }
  // Walkers march +z; wrap the lane so a soak never runs out of ground.
  for (const c of system.characters) {
    if (c.root.position.z > 38) c.root.position.z = -38;
  }
  system.update(dt, camera.position);
  if (hash === 'clips') hero.rig.measureSkate();
  if (followHero) {
    camera.position.set(hero.root.position.x + 4.4, 1.5, hero.root.position.z + 0.8);
    camera.lookAt(hero.root.position.x, 0.95, hero.root.position.z);
  } else {
    camera.position.set(0, 9, 14);
    camera.lookAt(0, 0.8, -2);
  }
  renderer.render(scene, camera);
}
tick();

function heapMB(): number {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  return perf.memory ? Math.round((perf.memory.usedJSHeapSize / 1048576) * 10) / 10 : -1;
}

interface CharsQA {
  ready: boolean;
  mode: string;
  playClip: (name: string) => boolean;
  setCrowd: () => void;
  stats: () => Record<string, number | string>;
  skate: () => number;
  skateReset: () => void;
  skateDebug: () => Record<string, number>;
  heroState: () => Record<string, number | string>;
  /** Spawn a second character playing a retargeted public/anim clip. */
  showRetarget: (name: string) => Promise<Record<string, number | string>>;
  clips: string[];
}

const qa: CharsQA = {
  ready: true,
  mode: hash,
  playClip(name: string): boolean {
    const clip = name as ClipName;
    if (!system.library[clip]) return false;
    if (hero.rig.isDead) hero.rig.revive();
    const idx = CLIP_ORDER.indexOf(clip);
    if (idx >= 0) clipIdx = idx;
    clipTimer = 0;
    manualHoldUntil = performance.now() + 8000;
    applyHeroClip(clip);
    return true;
  },
  setCrowd(): void {
    setCrowd();
  },
  stats(): Record<string, number | string> {
    const info = renderer.info;
    return {
      mode: hash,
      characters: system.characters.length,
      frameMs: Math.round(frameMs * 100) / 100,
      fps: Math.round(1000 / Math.max(frameMs, 0.01)),
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: renderer.info.programs ? renderer.info.programs.length : 0,
      heapMB: heapMB(),
      heroClip: CLIP_ORDER[clipIdx],
      heroSpeed: hero.input.speed,
      heroX: Math.round(hero.root.position.x * 100) / 100,
      heroZ: Math.round(hero.root.position.z * 100) / 100,
    };
  },
  skate(): number {
    return Math.round(hero.rig.measureSkate() * 100) / 100;
  },
  skateReset(): void {
    hero.rig.resetSkate();
  },
  skateDebug(): Record<string, number> {
    return hero.rig.debugSkate();
  },
  heroState(): Record<string, number | string> {
    const b = hero.rig.bones.Hips;
    return {
      locomotion: hero.rig.currentLocomotion,
      hipsLocalY: Math.round(b.position.y * 1000) / 1000,
      rootY: hero.root.position.y,
      mixerTime: Math.round(hero.rig.mixer.time * 1000) / 1000,
      speed: hero.input.speed,
    };
  },
  async showRetarget(name: string): Promise<Record<string, number | string>> {
    const res = await fetch(`/anim/${name}.anim.json`);
    if (!res.ok) return { ok: 0, error: res.status };
    const doc = (await res.json()) as AnimJsonDoc;
    const clip = animJsonToClip(doc);
    const first = doc.motion[0];
    const last = doc.motion[doc.motion.length - 1];
    const travel = Math.hypot(last[0] - first[0], last[2] - first[2]);
    const speed = travel / clip.duration;
    const ghost = system.spawn(hero.root.position.x - 2.2, hero.root.position.z, 0, 1);
    ghost.input.speed = speed;
    ghost.rig.playExternal(clip, speed);
    followHero = true;
    return {
      ok: 1,
      tracks: clip.tracks.length,
      duration: Math.round(clip.duration * 100) / 100,
      speed: Math.round(speed * 100) / 100,
    };
  },
  clips: CLIP_ORDER,
};

(window as unknown as { __CHARS: CharsQA }).__CHARS = qa;
