// Root acceptance: a rejected precondition must not poison future valid installs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { float, vec3 } from 'three/tsl';
const root=resolve('.');
const out=join(root,'.recovery-runtime/presence-lifecycle-1106.mjs');
await build({entryPoints:[join(root,'work/surface-presence-muse-1035/architectural-presence-macro.ts')],outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
const {installArchitecturalPresence:install}=await import(pathToFileURL(out).href);
const keys=['stuccoCream','stuccoTerracotta','capsuleWhite','roofWhite','timber','timberDark'];
function library(){return Object.fromEntries([...keys.map(k=>[k,new THREE.MeshStandardMaterial()]),['dispose',()=>{}]]);}
function hook(lib){for(const k of keys){lib[k].colorNode=vec3(1);lib[k].roughnessNode=float(.7);lib[k].normalNode=vec3(0,0,1);}}
const maps=Array.from({length:4},()=>new THREE.Texture());
const clean=library();hook(clean);
const control=await install(clean,maps,true);assert.equal(control.materialCount,6);control.dispose();
const retry=library();
await assert.rejects(install(retry,maps,true),/requires installArchitecturalMaterials/);
hook(retry);
try {
  const installed=await install(retry,maps,true);
  assert.equal(installed.materialCount,6);installed.dispose();
  console.log('PASS valid retry after rejected precondition');
} catch(error){
  console.error('FAIL valid retry poisoned by rejected install:',error.message);
  process.exitCode=1;
} finally {for(const t of maps)t.dispose();for(const lib of [clean,retry])for(const k of keys)lib[k].dispose();}
