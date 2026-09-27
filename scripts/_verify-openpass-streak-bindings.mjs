/** Independent actual-source bindings proof; separate from frozen streak integration.
 * Executes the unedited main keydown statement extracted by TypeScript AST,
 * actual settings shim, actual PilotControlView and HUD cache. CPU event/DOM
 * fixtures are explicit; no native keyboard, browser or GPU acceptance. */
import assert from 'node:assert/strict';
import ts from 'typescript';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),target=process.argv[2];assert(target,'Unique receipt path required');
const main=readFileSync(join(root,'src/main.ts'),'utf8');
const ast=ts.createSourceFile('main.ts',main,ts.ScriptTarget.Latest,true);
const statements=ast.statements.filter(node=>ts.isExpressionStatement(node)&&node.getText(ast).startsWith("addEventListener('keydown'")&&node.getText(ast).includes('STREAK_SLOT_CODES.indexOf'));
assert.equal(statements.length,1,'exactly one actual foot streak input owner');const statement=statements[0].getText(ast);
const source=new Map([['src/main.ts',main]]),temp=mkdtempSync(join(tmpdir(),'aa-streak-bindings-'));
await build({stdin:{loader:'ts',resolveDir:root,contents:`
import {STREAK_SLOT_CODES} from './src/ui/streak-presentation';
export * as THREE from 'three';
export * from './src/ui/bindings';
export {DEFAULT_SETTINGS} from './src/ui/settings';
export {applySettings,installInputShims} from './src/ui/settings-apply';
export {PilotControlView} from './src/core/pilot-controls';
export {buildHud} from './src/ui/hud-build';
export {bindMatchSurfaces} from './src/ui/hud-match';
export {DEFAULT_STREAK_LOADOUT} from './src/game/killstreaks/catalog';
export function installActualMainHandler(deps){const {pilot,ui,footWeaponInputAllowed,weapons,player,match}=deps;${statement}}
`},outfile:join(temp,'actual.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'freeze-source',setup(b){b.onLoad({filter:/\.ts$/},args=>{const path=args.path.replaceAll('\\','/'),prefix=root.replaceAll('\\','/')+'/';if(!path.startsWith(prefix+'src/'))return;const contents=readFileSync(args.path,'utf8');source.set(path.slice(prefix.length),contents);return{contents,loader:'ts',resolveDir:resolve(args.path,'..')};});}}]});
const api=await import(pathToFileURL(join(temp,'actual.mjs')).href),checks=[];
async function test(name,fn){try{await fn();checks.push({name,status:'PASS'});console.log('PASS '+name);}catch(error){checks.push({name,status:'FAIL',error:error.stack});console.log('FAIL '+name+'\n'+error.stack);}}
class EventFixture{constructor(type,data={}){Object.assign(this,{type,code:'',key:'',repeat:false,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){this.stopped=true;}},data);}}
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.attrs={};this.classes=new Set();this.handlers=new Map();this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),toggle:(x,v)=>{if(v??!this.classes.has(x))this.classes.add(x);else this.classes.delete(x);},contains:x=>this.classes.has(x)};}
 set className(v){this.classes=new Set(v.split(/\s+/).filter(Boolean));}get className(){return [...this.classes].join(' ');}setAttribute(k,v){this.attrs[k]=v;}append(...n){this.children.push(...n);}appendChild(n){this.children.push(n);return n;}querySelectorAll(){return [];}remove(){}
 addEventListener(type,fn,options){this.handlers.set(type,[...(this.handlers.get(type)??[]),{fn,capture:options===true}]);}
 removeEventListener(type,fn){this.handlers.set(type,(this.handlers.get(type)??[]).filter(h=>h.fn!==fn));}
 dispatch(event){event.target??=this;for(const h of [...(this.handlers.get(event.type)??[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){h.fn(event);if(event.stopped)break;}return true;}
}
const keys=['document','addEventListener','removeEventListener','dispatchEvent','KeyboardEvent'];const prior=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
let focused=true,menuOpen=false,bindings=api.DEFAULT_BINDINGS,made=0,pilot;
const win=new Element(),doc=new Element(),canvas=new Element('canvas'),hudRoot=new Element(),foot=[],piloted=[];
doc.hasFocus=()=>focused;doc.pointerLockElement=canvas;doc.createElement=tag=>{made++;return new Element(tag);};globalThis.document=doc;globalThis.addEventListener=win.addEventListener.bind(win);globalThis.removeEventListener=win.removeEventListener.bind(win);globalThis.dispatchEvent=win.dispatch.bind(win);globalThis.KeyboardEvent=EventFixture;
const key=(code,repeat=false)=>win.dispatch(new EventFixture('keydown',{code,key:code,repeat}));
try{
 const nodes=api.buildHud(hudRoot,null),surfaces=api.bindMatchSurfaces(nodes);
 pilot=new api.PilotControlView({camera:new api.THREE.PerspectiveCamera(72),canvas,hud:hudRoot,send(){},exit(){},streak:n=>piloted.push(n),transition(){},lookSettings:()=>({sensitivity:1,invertY:false}),freeCursor:()=>false,controlsAllowed:()=>!menuOpen,streakCodes:()=>api.streakBindingCodes(bindings)});
 const targets={player:{setSensitivity(){},setInvertY(){}},world:{},hud:{setAccessibility(){},setStreakBindings:c=>surfaces.setStreakBindings(c)}};
 api.applySettings({...api.DEFAULT_SETTINGS,bindings},targets);api.installInputShims(targets,()=>menuOpen);
 api.installActualMainHandler({pilot,ui:{menu:{state:()=>({surface:menuOpen?'paused-match':'hidden'})}},footWeaponInputAllowed:()=>true,weapons:{keyDown(){}},player:{getMode:()=> 'walk'},match:{pressStreak:n=>foot.push(n)}});
 const rows=[...api.DEFAULT_STREAK_LOADOUT,'yardhawk'].map(id=>({id,charges:1}));surfaces.setStreak({kills:15,slots:rows});
 await test('actual main receives all five default selections plus bonus8 exactly once',()=>{for(const c of ['Digit3','Digit4','Digit5','Digit6','Digit7','Digit8'])key(c);assert.deepEqual(foot,[1,2,3,4,5,6]);assert.deepEqual(piloted,[]);foot.length=0;});
 const rebound=['KeyJ','KeyK','KeyL','KeyP','KeyO','KeyI'];
 await test('actual settings remap dispatches six rebound keys and disables old keys and repeats',()=>{
  bindings=api.sanitizeBindings({...api.DEFAULT_BINDINGS,...Object.fromEntries(['streak1','streak2','streak3','streak4','streak5','streakBonus'].map((id,i)=>[id,rebound[i]]))});assert.deepEqual(api.streakBindingCodes(bindings),rebound);api.applySettings({...api.DEFAULT_SETTINGS,bindings},targets);
  for(const c of rebound)key(c);assert.deepEqual(foot,[1,2,3,4,5,6]);foot.length=0;for(const c of ['Digit3','Digit4','Digit5','Digit6','Digit7','Digit8'])key(c);for(const c of rebound)key(c,true);assert.deepEqual(foot,[]);
 });
 await test('HUD cached level redraws all six rebound caps and hints without creating nodes',()=>{
  const count=made;assert.deepEqual(nodes.streakSlots.map(n=>n.key.textContent),['J','K','L','P','O','I']);assert.match(nodes.streakSlots[4].hint.textContent,/PRESS O/);assert.match(nodes.streakSlots[5].hint.textContent,/PRESS I/);surfaces.setStreak({kills:15,slots:rows});assert.equal(made,count);
  api.applySettings({...api.DEFAULT_SETTINGS,bindings:api.DEFAULT_BINDINGS},targets);assert.deepEqual(nodes.streakSlots.map(n=>n.key.textContent),['3','4','5','6','7','8']);api.applySettings({...api.DEFAULT_SETTINGS,bindings},targets);assert.equal(made,count);
 });
 await test('actual pilot consumes physical rebound keys before shim with no duplicate foot activation',()=>{
  pilot.sync([{kind:'aircraft',variant:'piloted-drone',actorId:'self',instanceId:1,controlled:true,x:0,y:8,z:0,yaw:0,pitch:0,remainingMs:10000,health:100}],'self',true,1000,1000);assert(pilot.active());for(const c of rebound)key(c);assert.deepEqual(piloted,[1,2,3,4,5,6]);assert.deepEqual(foot,[]);piloted.length=0;
  for(const c of ['Digit3','Digit4','Digit5','Digit6','Digit7','Digit8'])key(c);for(const c of rebound)key(c,true);assert.deepEqual(piloted,[]);assert.deepEqual(foot,[]);
 });
 await test('menu and lost-focus pilot cannot consume a chosen or bonus key',()=>{
  menuOpen=true;for(const c of rebound)key(c);assert.deepEqual(piloted,[]);assert.deepEqual(foot,[]);menuOpen=false;focused=false;for(const c of rebound)key(c);assert.deepEqual(piloted,[]);assert.deepEqual(foot,[]);focused=true;pilot.reset();menuOpen=true;for(const c of rebound)key(c);assert.deepEqual(foot,[]);
 });
}finally{pilot?.dispose();for(const[k,v]of Object.entries(prior)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
const hash=v=>createHash('sha256').update(v).digest('hex');const binding=[...source].sort(([a],[b])=>a.localeCompare(b)).map(([path,text])=>({path,sha256:hash(text),stillCurrent:hash(readFileSync(join(root,path),'utf8'))===hash(text)}));if(binding.some(s=>!s.stillCurrent))checks.push({name:'source remained frozen',status:'FAIL'});
const fail=checks.filter(c=>c.status==='FAIL');writeFileSync(resolve(root,target),JSON.stringify({at:new Date().toISOString(),status:fail.length?'FAILED':'PASS',scope:'CPU event delivery through actual extracted main statement, settings shim, pilot and HUD. Full renderer/native keyboard/browser untouched.',checks,mainStatementSha256:hash(statement),source:binding,helperSha256:hash(readFileSync(join(root,'scripts/_verify-openpass-streak-bindings.mjs')))},null,2)+'\n',{flag:'wx'});console.log(`${checks.length-fail.length}/${checks.length} PASS`);if(fail.length)process.exitCode=1;
