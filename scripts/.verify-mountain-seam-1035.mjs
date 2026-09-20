import * as THREE from 'three';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const old = execFileSync('git',['show','4656c75:src/build/skyline.ts'],{encoding:'utf8'});
for(const [name, source] of [['old',old],['new',null]]){
  await build({...(source?{stdin:{contents:source,loader:'ts',resolveDir:process.cwd()+'/src/build'}}:{entryPoints:['src/build/skyline.ts']}),bundle:true,platform:'node',format:'esm',packages:'external',outfile:`.recovery-runtime/mountain-${name}-1035.mjs`});
}
const before=await import('../.recovery-runtime/mountain-old-1035.mjs');
const after=await import('../.recovery-runtime/mountain-new-1035.mjs');
const materials=new Map();let disposedMaterials=0;
const factory=(...args)=>{const k=JSON.stringify(args);if(!materials.has(k)){const m=new THREE.MeshStandardMaterial({color:typeof args[0]==='number'?args[0]:0xffffff});m.addEventListener('dispose',()=>disposedMaterials++);materials.set(k,m);}return materials.get(k);};
const mat={painted:factory,emissive:factory,signText:factory,steel:factory('steel'),windowDark:factory('window')};
function ctx(){let state=12345,calls=0;return {mat,rand(){calls++;state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;},calls:()=>calls};}
function signature(group){const h=createHash('sha256');group.traverse(o=>{h.update(JSON.stringify([o.type,o.name,o.matrix.elements,o.count,o.castShadow,o.receiveShadow]));if(o.geometry){for(const key of Object.keys(o.geometry.attributes).sort()){const a=o.geometry.attributes[key].array;h.update(key);h.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));}const ix=o.geometry.index?.array;if(ix)h.update(Buffer.from(ix.buffer,ix.byteOffset,ix.byteLength));}if(o.instanceMatrix)h.update(Buffer.from(o.instanceMatrix.array.buffer));});return h.digest('hex');}
const checks=[];const check=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw Error(name);};
globalThis.__NT_OVERRIDE_MOUNTAIN_VOLUME__=false;const ca=ctx(),cb=ctx();const a=before.buildSkyline(ca),b=after.buildSkyline(cb);
check('default geometry/instance transforms/shadows byte-identical',signature(a.group)===signature(b.group));check('default RNG calls unchanged',ca.calls()===cb.calls());check('default collider parity',JSON.stringify(a.colliders)===JSON.stringify(b.colliders));
globalThis.__NT_OVERRIDE_MOUNTAIN_VOLUME__=true;const cc=ctx(),c=after.buildSkyline(cc);const vol=c.group.getObjectByName('mountain_volume_muse_1010');check('volume exists exactly once',!!vol&&c.group.children.filter(x=>x.name==='mountain_volume_muse_1010').length===1);check('three range meshes',vol.children.length===3);check('replaces eight old ridge buckets',c.group.children.length===a.group.children.length-8+1);
for(let i=0;i<c.group.children.length-1;i++)check('unrelated object '+i,signature(c.group.children[i])===signature(a.group.children[i]));
check('zero collider change',c.colliders.length===a.colliders.length);let gd=0;vol.traverse(o=>o.geometry?.addEventListener('dispose',()=>gd++));c.group.userData.dispose();c.group.userData.dispose();check('owned geometry disposed once',gd===3);check('borrowed materials retained',disposedMaterials===0);check('volume detached',!c.group.getObjectByName('mountain_volume_muse_1010'));
writeFileSync('docs/handoff/mountain-seam-1035-cpu.json',JSON.stringify({checks,defaultRng:ca.calls(),volumeRng:cc.calls(),unrelatedObjects:c.group.children.length},null,2));console.log(JSON.stringify({pass:true,checks:checks.length,defaultRng:ca.calls(),volumeRng:cc.calls()}));
