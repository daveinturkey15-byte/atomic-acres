import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync('src/characters/body-presentation.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { sampleBody, readBody, presentBody } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const pose = (x, time, yaw=0) => ({ x, y:0, z:0, yaw, time });
const track = { previous:pose(0,0), current:pose(0,0), alive:true };
const out=pose(0,0); let previous=0, zeroSteps=0, maxStep=0;
for(let frame=1;frame<=120;frame++){
  const now=frame*1000/60;
  const tick=Math.floor((now+1e-7)/50)*50;
  sampleBody(track,pose(tick*.0043,tick),true);
  readBody(track,now,out);
  if(frame>6){ const delta=out.x-previous; if(delta<1e-5)zeroSteps++;maxStep=Math.max(maxStep,delta); assert.ok(delta>=0); assert.ok(Math.abs(delta-4.3/60)<1e-5,`uneven movement at frame ${frame}: ${delta}`); }
  previous=out.x;
}
assert.equal(zeroSteps,0);
sampleBody(track,pose(30,2050),true);readBody(track,2050,out);assert.equal(out.x,30,'respawns snap rather than crossing the level');
sampleBody(track,pose(30.1,2100,Math.PI-.01),true);sampleBody(track,pose(30.2,2150,-Math.PI+.01),true);
readBody(track,2175,out);assert.ok(Math.abs(Math.abs(out.yaw)-Math.PI)<1e-7,'shortest arc across pi');
readBody(track,5000,out);assert.equal(out.x,30.2,'never extrapolate beyond an admitted pose');
sampleBody(track,pose(31,2200),false);readBody(track,2200,out);assert.equal(out.x,31,'death pose resets');
const fake={root:{position:{set(x,y,z){this.x=x;this.y=y;this.z=z}},rotation:{y:0}},yaw:0};
presentBody(fake,{...pose(2,0),id:'guest',alive:true,speed:0},50);
assert.equal(fake.root.position.x,2,'network-interpolated poses have no added delay');
assert.equal(fake.root.rotation.y,Math.PI,'negative-Z simulation faces positive-Z rig correctly');
assert.equal(fake.rootMotion,false,'no second root integration');
console.log(JSON.stringify({pass:true,steadyFrames:114,zeroSteps,maxStep,checks:['uniform 20Hz→60Hz interpolation','shortest yaw arc','teleport','death','no extrapolation','guest no extra delay','rig forward axis','single root owner']}));
