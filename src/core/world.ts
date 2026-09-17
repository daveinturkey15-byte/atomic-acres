/**
 * Renderer, scene, sky and the light rig.
 *
 * Look target: bright hazy desert daylight over bleached concrete. The lift in the
 * reference frames comes from OCCLUSION contrast, not from raising ambient - a flat
 * global ambient bump makes every enclosed space read wrong. So: one strong sun with a
 * tight, high-resolution shadow camera fitted to the playable area, a hemisphere fill
 * that is genuinely sky-vs-ground coloured, and fog matched to the horizon.
 */
import * as THREE from 'three';
import { PAL } from './palette';
import { BOUND_X_MIN, BOUND_X_MAX, BOUND_Z } from './layout';

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  resize: () => void;
  dispose: () => void;
}

/** Vertical gradient sky dome, drawn in a shader so it costs one draw call. */
function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(PAL.skyTop).convertSRGBToLinear() },
      horizonColor: { value: new THREE.Color(PAL.skyHorizon).convertSRGBToLinear() },
      sunDir: { value: new THREE.Vector3(0.45, 0.55, -0.7).normalize() },
      sunColor: { value: new THREE.Color(PAL.sunColor).convertSRGBToLinear() },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      varying vec3 vWorld;
      void main() {
        vec3 d = normalize(vWorld);
        // horizon -> zenith ramp, biased so most of the visible sky is pale
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.85));
        // broad warm glow around the sun, plus a hotter core
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * pow(s, 8.0) * 0.28;
        col += sunColor * pow(s, 180.0) * 0.9;
        // slight warm haze right at the horizon band
        col = mix(col, horizonColor * 1.02, smoothstep(0.30, -0.04, d.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'sky';
  m.frustumCulled = false;
  return m;
}

export function createWorld(canvasParent: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.09;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PAL.fog, 0.0031);

  const sky = makeSky();
  scene.add(sky);

  // ---- environment map, prefiltered from the sky itself.
  // Without this every metalness>0.7 material (chrome bumpers, trim, steel) has no
  // indirect specular to reflect and renders near-BLACK. That is not a "dark metal"
  // look, it is a missing term. Generating it from the sky dome keeps the reflections
  // consistent with the lighting for free.
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  const envSky = makeSky();
  envScene.add(envSky);
  // a large dim ground disc so the lower hemisphere reflects bleached concrete,
  // not the black void below the dome
  const envGround = new THREE.Mesh(
    new THREE.CircleGeometry(880, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.bounce), side: THREE.DoubleSide }),
  );
  envGround.rotation.x = -Math.PI / 2;
  envGround.position.y = -1;
  envScene.add(envGround);
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 1.0;
  envSky.geometry.dispose();
  (envSky.material as THREE.Material).dispose();
  envGround.geometry.dispose();
  envGround.material.dispose();
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 1400);

  // ---- sun. High and slightly behind the +x end so the houses catch a raking light.
  const sun = new THREE.DirectionalLight(PAL.sunColor, 3.05);
  sun.position.set(58, 72, -92);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;

  // Fit the shadow camera to the playable area only. A shadow camera sized to the
  // skyline would waste almost all of its texels on empty desert.
  const cx = (BOUND_X_MIN + BOUND_X_MAX) / 2;
  const halfX = (BOUND_X_MAX - BOUND_X_MIN) / 2 + 6;
  const halfZ = BOUND_Z + 6;
  const half = Math.max(halfX, halfZ);
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half;
  sc.top = half; sc.bottom = -half;
  sc.near = 1; sc.far = 320;
  sc.updateProjectionMatrix();
  sun.target.position.set(cx, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  // ---- fill. Sky above, warm bleached-concrete bounce below.
  const hemi = new THREE.HemisphereLight(PAL.skyHorizon, PAL.bounce, 1.15);
  hemi.position.set(0, 60, 0);
  scene.add(hemi);

  // A weak opposing fill so north-facing walls do not go to mud, kept low so that
  // occlusion still does the work.
  const fill = new THREE.DirectionalLight(PAL.skyTop, 0.34);
  fill.position.set(-70, 40, 80);
  fill.castShadow = false;
  scene.add(fill);

  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', resize);

  const dispose = () => {
    removeEventListener('resize', resize);
    envRT.dispose();
    renderer.dispose();
  };

  return { renderer, scene, camera, sun, resize, dispose };
}
