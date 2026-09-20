// Artifact/source binding, actual visibility contrast and lifecycle falsifiers.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import StandardNodeLibrary from 'three/src/renderers/webgpu/nodes/StandardNodeLibrary.js';
const out=resolve('captures/room-visibility-cpu');mkdirSync(out,{recursive:true});
const file=resolve(out,'fixture.mjs');
await build({entryPoints:['src/core/room-visibility.ts'],outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
const {installRoomVisibility:install,roomVisibilityEnabled:enabled,ROOM_VOLUME}=await import(pathToFileURL(file));
const meta=JSON.parse(readFileSync('public/assets/room-visibility/provenance.json','utf8'));
assert.deepEqual(meta.dimensions,[32,28,24],'Frozen proof texture dimensions');
assert.deepEqual(ROOM_VOLUME.dimensions,meta.dimensions);assert.deepEqual(ROOM_VOLUME.min,meta.bounds.min);assert.deepEqual(ROOM_VOLUME.max,meta.bounds.max);
for(const [file,sha] of Object.entries({...meta.sourceHashes,...meta.authoringSourceHashes}))assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),sha,`Stale bake: ${file}`);
const load=async url=>{const b=readFileSync('public'+url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const pos=new Uint8Array(await load('/assets/room-visibility/positive.bin'));
const values=[...pos].filter((_,i)=>i%4!==3);
assert.ok(Math.min(...values)<60 && Math.max(...values)>170,'Actual room field must distinguish enclosure from apertures');
const keys=['stuccoCream','stuccoTerracotta','interiorWall','roofWhite','timber','timberDark','capsuleWhite'];
const fixture=()=>{
 let disposals=0; const room={leather:new THREE.MeshStandardMaterial()};
 const lib=Object.fromEntries(keys.map(k=>[k,new THREE.MeshStandardMaterial()]));
 lib.interior=()=>room;lib.dispose=()=>disposals++;
 return{lib,room,disposals:()=>disposals};
};
assert.equal(enabled('?room=authored'),false);assert.equal(enabled('?room-light=baked'),false);assert.equal(enabled('?room=authored&room-light=baked'),true);
const f=fixture();const oldKey=f.lib.interiorWall.customProgramCacheKey;
assert.equal(await install(f.lib,false,load),null);
const pending=install(f.lib,true,load);assert.equal(install(f.lib,true,load),pending);
const c=await pending;assert.ok(c);assert.equal(c.bytes,172032);
assert.ok(new StandardNodeLibrary().fromMaterial(f.lib.interiorWall).aoNode,'r180 adapter retains baked node');
assert.notEqual(f.lib.interiorWall.customProgramCacheKey(),oldKey.call(f.lib.interiorWall));
let frees=0;c.textures.forEach(t=>t.addEventListener('dispose',()=>frees++));
c.dispose();c.dispose();assert.equal(frees,2);assert.equal(f.lib.interiorWall.customProgramCacheKey,oldKey);assert.equal(f.lib.interiorWall.aoNode,undefined);
f.lib.dispose();assert.equal(f.disposals(),1);
// Failure cannot partially mutate any material or keep its dispose wrapper.
const bad=fixture();const old=bad.lib.dispose;const warn=console.warn;console.warn=()=>{};
try{assert.equal(await install(bad.lib,true,async()=>new ArrayBuffer(7)),null);}finally{console.warn=warn;}
assert.equal(bad.lib.dispose,old);assert.equal(bad.lib.interiorWall.aoNode,undefined);
const late=fixture();const resolvers=[];const p=install(late.lib,true,url=>new Promise(r=>resolvers.push(async()=>r(await load(url)))));
late.lib.dispose();await Promise.all(resolvers.map(r=>r()));assert.equal(await p,null);assert.equal(late.lib.interiorWall.aoNode,undefined);
console.log(JSON.stringify({pass:true,bytes:c.bytes,range:[Math.min(...values),Math.max(...values)],checks:['actual source hashes','nonuniform ray bake','r180 material adaptation','default off','stable cache key','single disposal','invalid artifact fallback','late disposal']}));
