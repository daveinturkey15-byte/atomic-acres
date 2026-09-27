/** Actual-source CPU proof. Inert visual panels only; no browser/GPU/gesture acceptance.
 * Prior Resume-only proposed recovery is retained in captures/openpass-playflow-helper-before-freecursor.mjs.
 * Owner now specifies playable free cursor without another start gate. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const paths=['index.html','src/main.ts','src/core/player.ts','src/core/pointer-input.ts','src/core/pilot-controls.ts','src/ui/menus.ts','src/ui/menu-lifecycle.ts','src/ui/settings-apply.ts'];
const sources=Object.fromEntries(paths.map(p=>[p,readFileSync(join(root,p),'utf8')]));
const visualFixtures={
 'menu-views.ts': `const el=()=>document.createElement('div'); export const button=el;
 export const buildMain=()=>globalThis.__playflowViews.main={root:el(),solo:el(),multiplayer:el(),options:el(),credits:el()};
 export const buildPause=()=>globalThis.__playflowViews.pause={root:el(),resume:el(),options:el(),leave:el()};
 export const buildCredits=()=>({root:el(),back:el()}); export const buildEnd=()=>({root:el(),rematch:el(),leave:el(),update(){}});
 export const buildDeploying=el; export const buildError=el;`,
 'solo-setup.ts': `export function buildSoloSetupPanel(options){globalThis.__playflowViews.solo=options; return {root:document.createElement('div'),refresh(){},setMode(){},setLoadoutEditable(){},setup:()=>({mode:'tdm'}),loadout:()=>({}),streakLoadout:()=>[]};}`,
 'lobby.ts': `export const buildLobbyPanel=()=>({root:document.createElement('div'),refresh(){}});`,
 'settings-panel.ts': `export const buildSettingsPanel=()=>({root:document.createElement('div'),refresh(){},capturing:()=>false});`,
};
const folder=mkdtempSync(join(tmpdir(),'aa-openpass-playflow-')),outfile=join(folder,'actual.mjs');
await build({stdin:{loader:'ts',resolveDir:root,contents:`export * as THREE from 'three'; export {Player} from './src/core/player'; export {PilotControlView} from './src/core/pilot-controls'; export * from './src/core/pointer-input'; export * from './src/ui/menu-lifecycle'; export {initMenus} from './src/ui/menus';`},outfile,platform:'node',format:'esm',bundle:true,logLevel:'silent',define:{'import.meta.env.BASE_URL':'"/"'},plugins:[{
 name:'frozen-source-and-inert-visual-panels',setup(builder){builder.onLoad({filter:/\.ts$/},args=>{
  const relative=args.path.replaceAll('\\','/').slice(root.replaceAll('\\','/').length+1);
  const contents=(relative.startsWith('src/ui/')?visualFixtures[relative.split('/').at(-1)]:undefined)??sources[relative];
  return contents===undefined?undefined:{contents,loader:'ts',resolveDir:resolve(args.path,'..')};
 });}}]});
const api=await import(pathToFileURL(outfile).href),checks=[],observations={};
async function check(name,fn){try{await fn();checks.push({name,status:'PASS'});console.log('PASS '+name);}catch(error){checks.push({name,status:'FAIL',message:error.message});console.log('FAIL '+name+': '+error.message);}}
class NodeFixture{
 listeners=new Map();style={};children=[];classList={toggle(){}};
 addEventListener(type,fn,options){this.listeners.set(type,[...(this.listeners.get(type)??[]),{fn,capture:options===true||options?.capture===true}]);}
 removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)??[]).filter(r=>r.fn!==fn));}
 emit(type,data={}){const event={type,target:this,buttons:0,movementX:0,movementY:0,isTrusted:false,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){this.stopped=true;},...data};for(const {fn} of [...(this.listeners.get(type)??[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){fn(event);if(event.stopped)break;}return event;}
 append(...nodes){this.children.push(...nodes);}setAttribute(){}querySelector(){return null;}querySelectorAll(){return [];}focus(){}remove(){}
}
async function withDOM(fn){
 const globals=['document','addEventListener','removeEventListener','__playflowViews'];const saved=Object.fromEntries(globals.map(k=>[k,globalThis[k]]));
 const doc=new NodeFixture(),win=new NodeFixture(),canvas=new NodeFixture(),overlay=new NodeFixture(),hud=new NodeFixture(),camera=new api.THREE.PerspectiveCamera(72);let focused=true;
 doc.pointerLockElement=null;doc.hasFocus=()=>focused;doc.getElementById=id=>id==='start'?overlay:id==='hud'?hud:null;doc.createElement=()=>new NodeFixture();
 doc.exitPointerLock=()=>{if(doc.pointerLockElement!==null){doc.pointerLockElement=null;doc.emit('pointerlockchange');}};
 globalThis.document=doc;globalThis.addEventListener=win.addEventListener.bind(win);globalThis.removeEventListener=win.removeEventListener.bind(win);globalThis.__playflowViews={};
 try{await fn({doc,win,canvas,overlay,hud,camera,focus(v){focused=v;}});}finally{for(const[k,v]of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
}
const drain=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
const move=(env,data={})=>env.win.emit('mousemove',{target:env.canvas,movementX:10,movementY:5,buttons:2,...data});
function createMenu(env,player){let mode='idle',begins=0;const match={begin(){mode='solo';begins++;},configure(){},mode:()=>mode,leave(){mode='idle';},ended:()=>false,lobby:{active:()=>false,onChange(){},view:()=>({error:null})}};
 const menu=api.initMenus({player,world:{renderer:{domElement:env.canvas}},hud:{setAccessibility(){}},match:()=>match,names:()=>new Map()});return{menu,begins:()=>begins};}
await check('boot has honest loading status and no unbound click-to-play promise',()=>{
 const html=sources['index.html'];observations.boot={staticClickPrompt:/click\s+to\s+play/i.test(html),loadingStatus:/role="status"[^>]*>Loading/.test(html)};assert(!observations.boot.staticClickPrompt);assert(observations.boot.loadingStatus);
});
await check('single request owner catches sync async and missing APIs without unhandled rejection',()=>withDOM(async env=>{
 let requests=0,rejected=0;const unhandled=[],listener=r=>unhandled.push(String(r));process.on('unhandledRejection',listener);
 try{env.canvas.requestPointerLock=()=>{requests++;return Promise.reject(Error('AUDIT_NATIVE_LOCK_DENIED'));};new api.Player(env.camera,env.canvas);env.canvas.emit('click');await drain();assert.equal(requests,0,'Player must not duplicate menu-owned request');
 for(const canvas of [env.canvas,{requestPointerLock(){throw Error('WrongDocumentError');}},{},undefined]){const before=rejected;api.requestGamePointerLock(canvas,()=>rejected++);await drain();assert.equal(rejected,before+1);}
 api.requestGamePointerLock({requestPointerLock(){}},()=>rejected++);api.requestGamePointerLock({requestPointerLock:()=>Promise.resolve()},()=>rejected++);await drain();assert.equal(rejected,4);assert.equal(requests,1);assert.deepEqual(unhandled,[]);observations.requests={requests,rejected,unhandled};
 }finally{process.removeListener('unhandledRejection',listener);}
}));
await check('actual Player fallback requires focused canvas RMB; capture and settings preserve gain',()=>withDOM(async env=>{
 const player=new api.Player(env.camera,env.canvas);player.teleport(0,0,0);move(env);close(player.state.yaw,0);player.setFreeCursorLook(true);move(env);close(player.state.yaw,-.022);close(player.state.pitch,-.011);
 for(const data of [{buttons:0},{buttons:1},{target:env.overlay},{target:env.win}]){player.teleport(0,0,0);move(env,data);close(player.state.yaw,0);}
 env.focus(false);move(env);close(player.state.yaw,0);env.focus(true);player.setSensitivity(2);player.setInvertY(true);move(env);close(player.state.yaw,-.044);close(player.state.pitch,.022);
 player.teleport(0,0,0);player.setFreeCursorLook(false);move(env);close(player.state.yaw,0);env.doc.pointerLockElement=env.canvas;env.doc.emit('pointerlockchange');move(env,{target:env.win,buttons:0});close(player.state.yaw,-.044);close(player.state.pitch,.022);
 player.setInputSuspended(true);const yaw=player.state.yaw;move(env);close(player.state.yaw,yaw);
}));
await check('actual menu enables playable fallback after denial with no repeat request or extra play gate',()=>withDOM(async env=>{
 let requests=0;env.canvas.requestPointerLock=()=>{requests++;return Promise.reject(Error('WrongDocumentError'));};const player=new api.Player(env.camera,env.canvas),{menu,begins}=createMenu(env,player);
 env.overlay.emit('click',{isTrusted:true});assert.equal(menu.state().surface,'pre-match');assert.equal(begins(),0);globalThis.__playflowViews.solo.onDeploy();await drain();
 assert.equal(begins(),1);assert.equal(menu.state().surface,'hidden');assert(menu.freeCursor());assert.equal(menu.state().pointerLock,'denied');assert.equal(env.overlay.style.display,'none');assert.equal(env.hud.children[0].style.display,'');assert.match(env.hud.children[0].textContent,/hold right mouse/);
 player.teleport(0,0,0);move(env);assert(player.state.yaw<0);assert(api.gamePointerActive(env.canvas,menu.freeCursor()));env.canvas.emit('click');await drain();assert.equal(requests,1,'refused capture must not retry every shot click');
 env.focus(false);assert(!api.gamePointerActive(env.canvas,menu.freeCursor()));env.focus(true);env.win.emit('keydown',{key:'Escape',code:'Escape'});assert.equal(menu.state().surface,'paused-match');assert(!menu.freeCursor());const yaw=player.state.yaw;move(env);close(player.state.yaw,yaw);assert.equal(env.hud.children[0].style.display,'none');
 env.win.emit('keydown',{key:'Escape',code:'Escape'});assert.equal(menu.state().surface,'hidden');assert(menu.freeCursor());assert.equal(requests,1);observations.menu={requests,directFallback:true,trustedBlankIgnored:true};
}));
await check('real WASD collision remains; paused menus clear held movement and reject typing without freezing gravity',()=>withDOM(async env=>{
 env.canvas.requestPointerLock=()=>Promise.reject(Error('AUDIT_DENIED'));const player=new api.Player(env.camera,env.canvas),{menu}=createMenu(env,player);globalThis.__playflowViews.solo.onDeploy();await drain();player.teleport(0,0,0);
 player.setColliders([{min:new api.THREE.Vector3(-2,0,-2),max:new api.THREE.Vector3(2,3,-1)}]);env.win.emit('keydown',{code:'KeyW',key:'w'});for(let i=0;i<20;i++)player.update(.05);assert(player.state.pos.z<-.1&&player.state.pos.z>=-.701,'walk must move and collide before wall');
 player.setColliders([]);player.teleport(0,0,0);player.update(.05);assert(player.state.pos.z<0);env.win.emit('keydown',{key:'Escape',code:'Escape'});assert.equal(menu.state().surface,'paused-match');const pose=player.state.pos.clone(),stance=player.getStance();
 for(const code of ['KeyW','Space','KeyZ'])env.win.emit('keydown',{code,key:code});for(let i=0;i<5;i++)player.update(.05);observations.pauseMovement={before:pose.toArray(),after:player.state.pos.toArray(),stanceBefore:stance,stanceAfter:player.getStance()};assert(player.state.pos.distanceTo(pose)<1e-9,'pause must clear movement and reject editing keys');assert.equal(player.getStance(),stance,'menu Z must not change body stance');
 menu.open('options');env.win.emit('keydown',{code:'KeyW',key:'w'});player.update(.05);assert(player.state.pos.distanceTo(pose)<1e-9);
 player.teleport(0,2,0);player.state.grounded=false;for(let i=0;i<60;i++)player.update(1/60);assert.equal(player.state.pos.y,0,'menu must preserve live gravity and landing');assert(player.state.grounded);
 player.setInputSuspended(true);menu.pause();player.teleport(0,2,0);player.update(.05);assert.equal(player.state.pos.y,2,'separate pilot body parking remains');
}));
await check('successful Deploy and Resume remain one action and native Escape pauses',()=>withDOM(async env=>{
 let requests=0;env.canvas.requestPointerLock=()=>{requests++;env.doc.pointerLockElement=env.canvas;env.doc.emit('pointerlockchange');};const player=new api.Player(env.camera,env.canvas),{menu,begins}=createMenu(env,player);globalThis.__playflowViews.solo.onDeploy();assert.equal(begins(),1);assert.equal(requests,1);assert.equal(menu.state().surface,'hidden');assert.equal(menu.state().pointerLock,'locked');assert(!menu.freeCursor());env.doc.exitPointerLock();assert.equal(menu.state().surface,'paused-match');globalThis.__playflowViews.pause.resume.emit('click');assert.equal(menu.state().surface,'hidden');assert.equal(menu.state().pointerLock,'locked');assert.equal(requests,2);
}));
await check('actual pilot fallback aim fire focus menu and blur-return fences',()=>withDOM(async env=>{
 let freeCursor=true,allowed=true,exits=0;const sent=[],transitions=[];const pilot=new api.PilotControlView({canvas:env.canvas,hud:env.hud,camera:env.camera,send:v=>sent.push(v),exit:()=>exits++,streak(){},transition:v=>transitions.push(v),lookSettings:()=>({sensitivity:2,invertY:true}),freeCursor:()=>freeCursor,controlsAllowed:()=>allowed});
 try{pilot.sync([{kind:'aircraft',variant:'piloted-drone',instanceId:'owned',actorId:'self',controlled:true,x:0,y:8,z:0,yaw:0,pitch:0,remainingMs:10000,health:100}],'self',true,1000,1000);assert(pilot.active());move(env,{buttons:0});close(pilot.snapshot().yaw,0);move(env,{target:env.overlay});close(pilot.snapshot().yaw,0);move(env);close(pilot.snapshot().yaw,-.044);close(pilot.snapshot().pitch,.022);
 env.focus(false);const yaw=pilot.snapshot().yaw;move(env);close(pilot.snapshot().yaw,yaw);env.win.emit('mousedown',{target:env.canvas,button:0});assert(!pilot.snapshot().firing);env.focus(true);env.win.emit('mousedown',{target:env.overlay,button:0});assert(!pilot.snapshot().firing);env.win.emit('mousedown',{target:env.canvas,button:0});env.win.emit('keydown',{code:'KeyW'});pilot.update(1050);assert(sent.at(-1).fire);assert.equal(sent.at(-1).forward,1);
 allowed=false;pilot.update(1100);assert(!sent.at(-1).fire);assert.equal(sent.at(-1).forward,0);move(env);close(pilot.snapshot().yaw,yaw);env.win.emit('keydown',{code:'KeyW'});env.win.emit('mousedown',{target:env.canvas,button:0});pilot.update(1150);assert(!sent.at(-1).fire);assert.equal(sent.at(-1).forward,0);
 allowed=true;freeCursor=false;move(env);close(pilot.snapshot().yaw,yaw);env.doc.pointerLockElement=env.canvas;move(env,{buttons:0,target:env.win});assert(pilot.snapshot().yaw<yaw);env.win.emit('blur');assert.equal(exits,1);pilot.update(1200);assert(!sent.at(-1).fire);assert(pilot.snapshot().returning);
 }finally{pilot.dispose();}assert.deepEqual(transitions,[true,false]);
}));
const hash=v=>createHash('sha256').update(v).digest('hex');
const report={at:new Date().toISOString(),status:checks.some(c=>c.status==='FAIL')?'FAILED_SOURCE_CPU':'PASS_SOURCE_CPU',scope:'Actual frozen Player/pointer/Pilot/menu/reducer/settings, inert visual panels only. No browser, GPU, app build, native gesture or owner/IAB acceptance.',refinement:'Owner explicitly rejects extra play gate. Original Resume-only proposed recovery and failure retained; free-cursor acceptance requires actual usable controls plus stricter focus/menu gates.',preserved:{helper:'captures/openpass-playflow-helper-before-freecursor.mjs',sha256:hash(readFileSync(join(root,'captures/openpass-playflow-helper-before-freecursor.mjs'))),receipt:'captures/openpass-playflow-audit.json'},observations,checks,source:paths.map(path=>({path,sha256:hash(sources[path])})),helperSha256:hash(readFileSync(join(root,'scripts/_verify-openpass-playflow.mjs'))),open:['Native gesture and owner/IAB acceptance require separately authorized parent verification.','Main admission is source-bound only; fixture does not boot renderer or main.']};
const target=process.argv[2]?resolve(root,process.argv[2]):join(root,'captures/openpass-playflow-freecursor-actual.json');writeFileSync(target,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,target,observations},null,2));if(checks.some(c=>c.status==='FAIL'))process.exitCode=1;
