/** CPU-only standalone inspection builder. Never launches a browser or runtime build. */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), index = args.indexOf('--out');
if (index < 0 || !args[index + 1]) throw Error('--out requires a new inspection-only directory');
const out = resolve(root, args[index + 1]);
if (existsSync(out)) throw Error('Refusing to overwrite retained inspection');
mkdirSync(join(out, 'assets/reference-weapons/minigun'), { recursive: true });
const asset = 'public/assets/reference-weapons/minigun/minigun-fp-lod0.glb';
copyFileSync(join(root, asset), join(out, 'assets/reference-weapons/minigun/minigun-fp-lod0.glb'));
const source = `
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { buildMaterials } from './src/core/materials';
import { createReferenceWeaponLoader, adaptReferenceWeaponModel } from './src/weapons/reference-weapon-models';
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x687176);
const camera=new THREE.PerspectiveCamera(40,1600/900,.01,20);
const renderer=new WebGPURenderer({antialias:true}); renderer.setSize(1600,900); renderer.setPixelRatio(1);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
document.body.append(renderer.domElement); await renderer.init();
if (!renderer.backend.isWebGPUBackend) throw Error('Neutral inspection requires actual WebGPU');
const materials=buildMaterials();
const parsed=await createReferenceWeaponLoader().loadAsync('./assets/reference-weapons/minigun/minigun-fp-lod0.glb');
const rig=adaptReferenceWeaponModel('minigun',parsed,materials,{heavyHands:true});scene.add(rig.group);
scene.add(new THREE.HemisphereLight(0xf1f4f4,0x434743,2.2));
const key=new THREE.DirectionalLight(0xfff2db,3.2);key.position.set(-2,3,4);scene.add(key);
const fill=new THREE.DirectionalLight(0xddeaff,1.4);fill.position.set(3,1,-2);scene.add(fill);
const target=new THREE.Vector3(.1,-.03,-.03);
const views={front:[.1,.25,-1.75],right:[1.75,.3,.35],left:[-1.7,.3,.35],threeQuarter:[1.25,.6,1.45]};
let current='threeQuarter',progress=0,disposed=false,tail=Promise.resolve();
function draw(){tail=tail.then(async()=>{if(disposed)return;rig.group.updateMatrixWorld(true);await renderer.renderAsync(scene,camera);});return tail;}
function view(name){if(!views[name])throw Error('Unknown inspection view');current=name;camera.position.set(...views[name]);camera.lookAt(target);return draw();}
function reload(p){if(!Number.isFinite(p)||p<0||p>1)throw Error('Invalid reload sample');progress=p;rig.hands.updateReload(p);return draw();}
window.__HEAVY_INSPECT={view,reload,stats:()=>({label:'NEUTRAL INSPECTION ONLY; not gameplay acceptance',view:current,reload:progress,
  backend:renderer.backend.isWebGPUBackend?'webgpu':'other',gun:rig.stats,sourceClips:parsed.animations.length,
  handFit:rig.hands.root.userData.heavyFitVersion,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}),
  dispose:async()=>{await tail;if(disposed)return;disposed=true;rig.dispose();materials.dispose();renderer.dispose();}};
for(const name of Object.keys(views)){const b=document.createElement('button');b.textContent=name;b.onclick=()=>view(name);document.querySelector('nav').append(b);}
document.querySelector('input').oninput=e=>reload(Number(e.target.value));
await view(current);document.documentElement.dataset.ready='true';
`;
await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, outfile: join(out, 'inspection.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Minigun neutral inspection</title>
<style>body{margin:0;background:#222;color:white;font:14px sans-serif}header{position:absolute;padding:10px;background:#111d}button{margin:5px}canvas{display:block}</style>
<header>NEUTRAL INSPECTION — actual adapter, unchanged gun/materials; separate from gameplay camera acceptance.
<nav></nav><label>Reload sample <input type="range" min="0" max="1" step="0.025" value="0"></label></header>
<script type="module" src="./inspection.js"></script>`);
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest = { label: 'CPU-built neutral inspection; browser and visual acceptance OPEN',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(['src/weapons/reference-weapon-models.ts','src/weapons/reference-heavy-hands.ts',
    'src/core/materials.ts','scripts/_inspect-overnight-heavy-rig.mjs'].map(p=>[p,sha(join(root,p))])),
  modelSha256: sha(join(root, asset)), bundleSha256: sha(join(out,'inspection.js')),
  viewport: [1600,900], DPR: 1, camera: '40 degree perspective; fixed front, left, right, threeQuarter',
  limitations: 'Neutral lighting/inspection cameras differ from gameplay. No hidden geometry, substitute materials, or CPU-only art acceptance.' };
writeFileSync(join(out, 'inspection-identity.json'), JSON.stringify(manifest,null,2));
console.log(JSON.stringify({out,...manifest},null,2));
