/** Actual source integration for five chosen streaks plus one crate bonus.
 * CPU only: seeded runtime ledger, flat WorldQuery and queued loopback transport.
 * No browser, renderer, earned-in-play, native-key, LAN or owner acceptance. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..'), target=process.argv[2];
assert(target,'Supply a unique receipt path; no overwrite');
const loaded=new Map(),temp=mkdtempSync(join(tmpdir(),'aa-streak-integration-'));
await build({stdin:{resolveDir:root,loader:'ts',contents:`
export * from './src/game/killstreaks/catalog';
export {StreakRuntime} from './src/game/killstreaks/runtime';
export * from './src/ui/streak-loadout-panel';
export {projectStreakStrip,STREAK_SLOT_CODES} from './src/ui/streak-presentation';
export {buildHud,STREAK_SLOTS} from './src/ui/hud-build';
export {bindMatchSurfaces} from './src/ui/hud-match';
export {isNetMessage} from './src/net/protocol';
export {HostRoom,GuestClient,liveRoomCount,LIVENESS_MS} from './src/net/room';
export {createHostDriver} from './src/net/match-host';
export {createGuestDriver} from './src/net/match-guest';
export {createSessionLog} from './src/game/session-log';
`},outfile:join(temp,'actual.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent',define:{'import.meta.env.BASE_URL':'"/"'},plugins:[{
 name:'freeze-and-bind-actual-source',setup(builder){builder.onLoad({filter:/\.ts$/},args=>{
  const path=args.path.replaceAll('\\','/'),prefix=root.replaceAll('\\','/')+'/';
  if(!path.startsWith(prefix+'src/'))return;
  const relative=path.slice(prefix.length),contents=readFileSync(args.path,'utf8');loaded.set(relative,contents);
  return{contents,loader:'ts',resolveDir:resolve(args.path,'..')};
 });}}]});
const api=await import(pathToFileURL(join(temp,'actual.mjs')).href),checks=[],observations={};
async function test(name,fn){try{await fn();checks.push({name,status:'PASS'});console.log('PASS '+name);}catch(error){checks.push({name,status:'FAIL',error:error.stack});console.log('FAIL '+name+'\n'+error.stack);}}
const world={lineOfSight:()=>true,groundY:()=>0,inBounds:(x,z)=>Math.abs(x)<=40&&Math.abs(z)<=40};
const context={alive:true,matchPhase:'active',inputEnabled:true,menuOpen:false,targetingOpen:false,arenaSupported:true,possessionActive:false};
// Deliberately distinct from the shipped defaults: low,mid,high,high,top.
const chosen=['supply-crate','sentry-post','carpet-bomber','chopper','drone-swarm'];
function ledger(actorId='owner',seed=1){
 const rt=new api.StreakRuntime({seed,matchEpoch:7});rt.registerActor(actorId,0,chosen);let seq=0;
 const activate=(slot,now=100,extra={})=>rt.activate({actorId,slot,seq:seq++,claimId:'proof:'+actorId+':'+seq,life:rt.lifeOf(actorId),matchEpoch:7,toggle:false,origin:{x:0,y:0,z:0},aimYaw:0,context,...extra},now,world);
 return{rt,activate,actorId};
}
function earnAll(f){const events=[];for(let k=1;k<=15;k++)events.push(...f.rt.recordElimination(f.actorId,k,k,'bullet'));return events;}
function captureBonus(wanted,actorId='owner'){
 for(let seed=0;seed<400;seed++){
  const f=ledger(actorId,seed);earnAll(f);const out=f.activate(1,100);assert(out.accepted);
  const crate=f.rt.liveInstances().find(i=>i.kind==='supply-crate');if(crate.reward!==wanted)continue;
  const collector={id:actorId,team:0,alive:true,health:100,x:0,y:0,z:0};
  f.rt.advance(100,world,[collector]);for(let now=350;now<=1600;now+=250)f.rt.advance(now,world,[collector]);
  assert.equal(f.rt.chargesOf(actorId,wanted),1,'actual capture must bank reward');return{...f,seed};
 }
 throw Error('no deterministic actual crate seed for '+wanted);
}
await test('five chosen slots earn bank and consume their own charge once, including chosen fifth',()=>{
 assert.equal(api.SLOT_COUNT,5);assert.equal(api.DEFAULT_STREAK_LOADOUT.length,5);assert(api.validateStreakLoadout(chosen).valid);
 const f=ledger(),events=earnAll(f);assert.deepEqual(events.map(e=>e.slot),[1,2,3,4,5]);
 assert.deepEqual(f.rt.snapshotFor('owner'),chosen.map((streakId,i)=>({streakId,slot:i+1,charges:1})));
 for(let slot=1;slot<=5;slot++){
  const out=f.activate(slot,100+slot);assert(out.accepted,'slot '+slot);assert.equal(out.streakId,chosen[slot-1]);
  assert.equal(out.events.find(e=>e.type==='streak-activated').slot,slot);assert.equal(f.rt.chargesOf('owner',chosen[slot-1]),0);
  const again=f.activate(slot,200+slot);assert(!again.accepted);assert.equal(again.reason,'not-earned');
 }
 assert.equal(f.rt.snapshotFor('owner').length,5);assert(f.rt.snapshotFor('owner').every(s=>s.charges===0));
 observations.selected={ids:chosen,earnedSlots:events.map(e=>e.slot),spentFifth:true};
});
await test('actual crate capture uses bonus6 independently of chosen5 and bank survives life/connection edges',()=>{
 const f=captureBonus('yardhawk'),before=f.rt.snapshotFor('owner');assert.equal(before.length,6);assert.deepEqual(before[4],{streakId:'drone-swarm',slot:5,charges:1});assert.deepEqual(before[5],{streakId:'yardhawk',slot:6,charges:1});
 f.rt.recordDeath('owner',1700);f.rt.recordDisconnect('owner',1701);f.rt.registerActor('owner',0,chosen,f.rt.lifeOf('owner'));
 assert.deepEqual(f.rt.snapshotFor('owner'),before);assert(f.activate(6,1800).accepted);assert.equal(f.rt.snapshotFor('owner').length,5);assert.equal(f.rt.chargesOf('owner','drone-swarm'),1);
 assert(f.activate(5,1801).accepted);assert.equal(f.rt.chargesOf('owner','drone-swarm'),0);assert(!f.activate(7,1802).accepted);
 observations.bonus={seed:f.seed,id:'yardhawk',slot:6,chosenFifthIndependent:true};
});
await test('wire admits five plus bonus6 and refuses overflow duplicate slots and invalid row counts',()=>{
 const f=captureBonus('yardhawk'),msg=f.rt.streakStateFor('owner',1600);assert(api.isNetMessage(msg));
 for(let slot=1;slot<=6;slot++)assert(api.isNetMessage({type:'streak-intent',slot,toggle:false,seq:slot}));
 for(const slot of [0,-1,7,99,1.5])assert(!api.isNetMessage({type:'streak-intent',slot,toggle:false,seq:1}),'invalid intent slot '+slot);
 for(const slots of [[...msg.slots,{streakId:'tracker-dart',slot:7,charges:1}],msg.slots.map((s,i)=>i===5?{...s,slot:7}:s),msg.slots.map((s,i)=>i===5?{...s,slot:5}:s)])assert(!api.isNetMessage({...msg,slots}),'malformed rows must not enter client');
 for(const charges of [-1,256,1.5])assert(!api.isNetMessage({...msg,slots:msg.slots.map((s,i)=>i===5?{...s,charges}:s)}),'invalid charges '+charges);
});
await test('legacy v1 bytes remain untouched while migrated and saved v2 five-slot records validate',()=>{
 const oldKey='nuketown2025.streak-loadout.v1',newKey='nuketown2025.streak-loadout.v2';
 assert.equal(api.LEGACY_STREAK_LOADOUT_STORAGE_KEY,oldKey);assert.equal(api.STREAK_LOADOUT_STORAGE_KEY,newKey);
 const legacy=JSON.stringify({version:1,selected:['recon-sweep','signal-jam','sentry-post','blast-mortar']}),map=new Map([[oldKey,legacy]]),writes=[];
 const storage={getItem:key=>map.get(key)??null,setItem(key,value){writes.push(key);map.set(key,value);}};
 const migrated=api.loadStreakLoadout(storage);assert.equal(migrated.version,2);assert.equal(migrated.migratedFrom,1);assert(migrated.legacyRetained);assert(api.validateStreakLoadout(migrated.selected).valid);assert.deepEqual(migrated.selected,['recon-sweep','sentry-post','blast-mortar','chopper','drone-swarm']);assert.deepEqual(writes,[]);assert.equal(map.get(oldKey),legacy);
 const current={...migrated,selected:chosen};assert(api.saveStreakLoadout(current,storage));assert.deepEqual(writes,[newKey]);assert.equal(map.get(oldKey),legacy);assert.deepEqual(api.loadStreakLoadout(storage).selected,chosen);
 const bad={...current,selected:[...chosen,'yardhawk']};assert(!api.saveStreakLoadout(bad,storage));assert.deepEqual(api.loadStreakLoadout(storage).selected,chosen);assert.equal(map.get(oldKey),legacy);
 observations.storage={oldRawPreserved:true,newVersion:JSON.parse(map.get(newKey)).version,selected:api.loadStreakLoadout(storage).selected};
});
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.style={};this.classes=new Set();this.classList={add:(...s)=>s.forEach(x=>this.classes.add(x)),remove:(...s)=>s.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x),toggle:(s,v)=>{const on=v??!this.classes.has(s);if(on)this.classes.add(s);else this.classes.delete(s);return on;}};}
 set className(v){this.classes=new Set(v.split(/\s+/).filter(Boolean));}get className(){return [...this.classes].join(' ');}setAttribute(k,v){this.attrs[k]=v;}append(...n){this.children.push(...n);}appendChild(n){this.children.push(n);return n;}querySelectorAll(){return [];}addEventListener(){}
}
await test('actual HUD builds five chosen cards and one separate bonus button, keys3..8 with stable nodes',()=>{
 const saved=globalThis.document;let made=0;globalThis.document={createElement:tag=>{made++;return new Element(tag);}};
 try{const rootNode=new Element(),nodes=api.buildHud(rootNode,null),hud=api.bindMatchSurfaces(nodes),f=captureBonus('yardhawk');assert.equal(api.STREAK_SLOTS,6);assert.equal(nodes.streakSlots.length,6);
 const rows=f.rt.snapshotFor('owner').map(s=>({id:s.streakId,charges:s.charges}));hud.setStreak({kills:15,slots:rows});assert.deepEqual(nodes.streakSlots.map(n=>n.key.textContent),['3','4','5','6','7','8']);assert.equal(nodes.streakSlots[4].root.tagName,'DIV');assert.equal(nodes.streakSlots[5].root.tagName,'BUTTON');assert.match(nodes.streakSlots[5].state.textContent,/CRATE REWARD/);assert.equal(nodes.streakSlots[4].name.textContent,'Drone Swarm');assert(nodes.streak.classList.contains('hud-streak-has-reward'));
 const count=made;for(let i=0;i<30;i++)hud.setStreak({kills:15,slots:rows});assert.equal(made,count);
 assert(f.activate(6,1800).accepted);hud.setStreak({kills:15,slots:f.rt.snapshotFor('owner').map(s=>({id:s.streakId,charges:s.charges}))});assert(nodes.streakSlots[5].root.classList.contains('hud-hidden'));assert(!nodes.streakSlots[4].root.classList.contains('hud-hidden'));assert(!nodes.streak.classList.contains('hud-streak-has-reward'));assert.equal(made,count);
 observations.hud={cards:6,keys:['3','4','5','6','7','8'],bonusButtonOnly:true,stableNodeCount:count};
 }finally{if(saved===undefined)delete globalThis.document;else globalThis.document=saved;}
});
await test('real token rejoin refreshes six bank rows; guest pilot bonus toggles6 and never consumes chosen5',()=>{
 let now=0,registrations=0,rt,activate,sink=null,lastIntent=null;const peers=new Map(),queue=[],disposers=[];
 const savedNow=Object.getOwnPropertyDescriptor(performance,'now');Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
 const transport=id=>{const handlers=new Set(),t={localId:id,send(to,msg){queue.push({from:id,to,msg:structuredClone(msg)});return true;},onMessage(fn){handlers.add(fn);return()=>handlers.delete(fn);},close(){handlers.clear();},receive(from,msg){for(const fn of handlers)fn(from,msg);}};peers.set(id,t);return t;};
 const pump=()=>{let n=0;while(queue.length){assert(++n<10000);const m=queue.shift();peers.get(m.to)?.receive(m.from,m.msg);}};
 try{
  const room=new api.HostRoom(transport('host'),{code:'ABC234',now:()=>now,capacity:2});disposers.push(()=>room.dispose());
  const guest=new api.GuestClient(transport('old'),'host','ABC234','GUEST',{now:()=>now,localStreakLoadout:()=>chosen});disposers.push(()=>guest.dispose());pump();const id=guest.getPlayerId();assert(id);
  const f=captureBonus('piloted-drone',id);rt=f.rt;activate=f.activate;const ids=new Set();
  const solo={localId:room.hostId,addRemote(remoteId,name,team,primary,kit,loadout){if(ids.has(remoteId))return;assert.deepEqual(loadout,chosen);ids.add(remoteId);registrations++;},removeRemote(remoteId){ids.delete(remoteId);},setEventSink(value){sink=value;},stampSample:s=>s,movementState:()=>({suspended:false,speedMultiplier:1}),botSamples(){},resumeFacts:()=>({life:1,shotSeq:2,primaryId:'mp5',rounds:149}),remotePose(){},tick(){},matchState:()=>({type:'match-state',at:now,mode:'tdm',phase:'active',endsAt:null,scoreLimit:null,teamScores:[0,0],scores:[],winner:null,winnerId:null,endReason:null}),streakStateFor:(actorId,at)=>rt.streakStateFor(actorId,at),effectsState:at=>({type:'streak-effects',at,effects:rt.effectSnapshot()}),radarStateFor:()=>null,dispose(){},remoteStreak(actorId,slot,toggle){assert.equal(actorId,id);lastIntent={slot,toggle};const out=activate(slot,now,{toggle});sink?.(out.events,now);}};
  const host=api.createHostDriver(room,solo,{world});disposers.push(()=>host.dispose());room.setReady(true);guest.setReady(true);pump();assert.equal(room.start(),null);
  for(let i=0;i<21;i++){now+=50;room.tickOnce(now);host.tick(now,0,0,0,0,0);pump();}
  const identity=guest.identity();assert(identity);const before=rt.snapshotFor(id);assert.equal(before.length,6);now+=api.LIVENESS_MS+1000;room.tickOnce(now);host.tick(now,0,0,0,0,0);pump();
  const resumed=new api.GuestClient(transport('new'),'host','ABC234','GUEST',{now:()=>now,resume:identity,localStreakLoadout:()=>chosen});disposers.push(()=>resumed.dispose());pump();assert.equal(resumed.getPlayerId(),id);assert.equal(resumed.resumeState().shotSeq,2);assert.equal(resumed.resumeState().rounds,149);
  const ui={bindClient(c){this.client=c;},setNames(){},resetPresentation(){}};
  const driver=api.createGuestDriver(resumed,{ui,instrument:api.createSessionLog(id),placeLocal(){}});disposers.push(()=>driver.dispose());
  now+=50;room.tickOnce(now);host.tick(now,0,0,0,0,0);pump();assert.deepEqual(ui.client.view().streak.slots,before);assert.equal(registrations,1);assert.deepEqual(rt.snapshotFor(id),before);
  driver.pressStreak(6);pump();assert.deepEqual(lastIntent,{slot:6,toggle:false});assert(rt.pilotFor(id));assert.equal(rt.chargesOf(id,'drone-swarm'),1);now+=100;host.tick(now,0,0,0,0,0);pump();
  driver.pressStreak(5);pump();assert.deepEqual(lastIntent,{slot:5,toggle:false},'chosen5 must not toggle unslotted pilot');assert.equal(rt.chargesOf(id,'drone-swarm'),1);assert(rt.pilotFor(id));
  driver.exitPilot();pump();assert.deepEqual(lastIntent,{slot:6,toggle:true});assert.equal(rt.pilotFor(id),null);assert.equal(rt.chargesOf(id,'drone-swarm'),1);
  const wireBefore=structuredClone(ui.client.view().streak.slots);peers.get('new').receive('host',{...rt.streakStateFor(id,now),slots:[...wireBefore,{streakId:'yardhawk',slot:7,charges:1}]});assert.deepEqual(ui.client.view().streak.slots,wireBefore,'malformed host rows refused at real guest receive validator');
  observations.rejoin={sameSeat:true,registrations,bankRows:before.length,life:resumed.resumeState().life,shotSeq:2,rounds:149,bonusPilotExitSlot:lastIntent.slot};
 }finally{for(const dispose of disposers.reverse())dispose();pump();if(savedNow)Object.defineProperty(performance,'now',savedNow);else delete performance.now;}
 assert.equal(api.liveRoomCount(),0);
});
const hash=value=>createHash('sha256').update(value).digest('hex');
const source=[...loaded].sort(([a],[b])=>a.localeCompare(b)).map(([path,contents])=>({path,sha256:hash(contents),stillCurrent:hash(readFileSync(join(root,path),'utf8'))===hash(contents)}));
for(const path of ['src/main.ts','src/core/pilot-controls.ts','src/game/session-solo.ts'])if(!loaded.has(path)){const contents=readFileSync(join(root,path),'utf8');source.push({path,sha256:hash(contents),stillCurrent:true,scope:'read-only source binding; not executed in this fixture'});}
if(source.some(s=>!s.stillCurrent))checks.push({name:'source unchanged while proof executed',status:'FAIL'});
const failures=checks.filter(c=>c.status==='FAIL');
const report={at:new Date().toISOString(),status:failures.length?'FAILED':'PASS',checks,observations,scope:'CPU actual runtime/room/guest drivers/validator/HUD construction and projection/storage. Flat WorldQuery, inert DOM, seeded earns and minimal SoloDriver forwarding port. No browser, native keys, GPU, LAN or played-earned acceptance.',negative:'captures/openpass-streak-integration-20260927/initial-four-slot-negative.json',source,helperSha256:hash(readFileSync(join(root,'scripts/_verify-openpass-streak-integration.mjs')))};
writeFileSync(resolve(root,target),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(`${checks.length-failures.length}/${checks.length} PASS; receipt ${target}`);if(failures.length)process.exitCode=1;
