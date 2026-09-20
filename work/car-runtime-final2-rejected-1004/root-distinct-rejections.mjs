import * as THREE from 'three';
import * as c from './.car-body-canary-repair2.fixture.mjs';
globalThis.__NT_OVERRIDE_CAR_BODY__ = true;
let loads=0, geoms=0, mats=0;
const roots=[];
const result=await c.preloadCarBodyCanary(200, async()=>{
 loads++;
 const group=new THREE.Group(); const g=new THREE.BoxGeometry(20,20,20); const m=new THREE.MeshStandardMaterial();
 g.addEventListener('dispose',()=>geoms++);m.addEventListener('dispose',()=>mats++);
 group.add(new THREE.Mesh(g,m));roots.push(group);return group;
});
const evidence={result,loads,geoms,mats,distinctRoots:roots[0]!==roots[1],expectedEach:2};
console.log(JSON.stringify(evidence));
if(loads!==2||geoms!==2||mats!==2)process.exitCode=1;
