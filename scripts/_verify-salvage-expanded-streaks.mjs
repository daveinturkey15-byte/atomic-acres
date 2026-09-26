/** Real native host/runtime CPU proof. Seeded ledgers are fixtures, not played-match evidence. */
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const source = `
import assert from 'node:assert/strict';
import { StreakRuntime, WIRED_STREAK_IDS } from './src/game/killstreaks/runtime';
import { STREAK_CATALOG, DEFAULT_STREAK_LOADOUT, validateStreakLoadout, streakById } from './src/game/killstreaks/catalog';
import { createAircraft, acceptPilotInput, stepAircraft } from './src/game/killstreaks/effects/aircraft';
import { carpetCorridor, createCarpet, stepCarpet, CARPET_BOMBS } from './src/game/killstreaks/effects/carpet';
import { GameHost } from './src/game/host';
import { streakPort } from './src/game/session-streaks';
const world={lineOfSight:()=>true,groundY:()=>0,inBounds:(x,z)=>Math.abs(x)<=40&&Math.abs(z)<=40};
const owner={id:'owner',team:0,alive:true,health:100,x:0,y:0,z:0};
const enemy={id:'enemy',team:1,alive:true,health:100,x:0,y:0,z:-8};
const ally={...enemy,id:'ally',team:0};
const context={alive:true,matchPhase:'active',inputEnabled:true,menuOpen:false,targetingOpen:false,arenaSupported:true,possessionActive:false};
let cases=0;
function test(name,fn){fn();cases++;console.log('PASS '+name)}
function fixture(id,opts={}){
 const def=streakById(id),slot=def.tier==='low'?1:def.tier==='mid'?3:4;
 const loadout=[...DEFAULT_STREAK_LOADOUT];loadout[slot-1]=id;
 if(id==='recon-sweep')loadout[1]='tracker-dart';
 if(id==='signal-jam')loadout[1]='tracker-dart';
 if(id==='fallout-screen')loadout[1]='tracker-dart';
 const rt=new StreakRuntime({seed:12,matchEpoch:7,...opts});rt.registerActor('owner',0,loadout);
 for(let k=1;k<=def.cost;k++)rt.recordElimination('owner',k,k);
 let seq=0;
 const activate=(extra={},now=0,w=world)=>rt.activate({actorId:'owner',slot,seq:seq++,claimId:'fixture:'+seq,life:rt.lifeOf('owner'),matchEpoch:7,
 toggle:false,origin:{x:0,y:0,z:0},aimYaw:0,context,...extra},now,w);
 return {rt,activate,slot,loadout};
}
test('16 selectable definitions wired; prior four-slot loadout valid; top reaches slot4',()=>{
 assert.equal(WIRED_STREAK_IDS.length,16);assert(validateStreakLoadout(DEFAULT_STREAK_LOADOUT).valid);
 for(const id of ['drone-swarm','last-resort'])assert(validateStreakLoadout(['recon-sweep','signal-jam','sentry-post',id]).valid);
 assert(!validateStreakLoadout(['recon-sweep','signal-jam','sentry-post','fallout-screen']).valid);
});
test('fixed crate shares remain exact field10/crimson10/last1 with nonrecursive source',()=>{
 const pool=STREAK_CATALOG.rewardPool;
 for(const [id,percent]of [['field-repair',10],['crimson-flamethrower',10],['last-resort',1]])assert.equal(pool.entries.find(e=>e.id===id).weightUnits*100,pool.totalUnits*percent);
 assert(!pool.entries.some(e=>e.id==='supply-crate'));
});
test('every selectable row spends earned charge once and rejects replay',()=>{
 for(const def of STREAK_CATALOG.definitions.filter(d=>d.availability==='selectable')){
 const f=fixture(def.id),out=f.activate();assert(out.accepted,def.id);assert.equal(f.rt.chargesOf('owner',def.id),0);
 const duplicate=f.rt.activate({actorId:'owner',slot:f.slot,seq:0,claimId:'fixture:1',life:0,matchEpoch:7,toggle:false,origin:{x:0,y:0,z:0},aimYaw:0,context},0,world);
 assert(!duplicate.accepted,def.id+' replay'); }
});
test('autonomous aircraft attack only visible enemies; swarms stay bounded and hunters detonate',()=>{
 for(const id of ['yardhawk','chopper','hunter-swarm','drone-swarm']){
 const f=fixture(id);f.activate();let hits=[];f.rt.advance(0,world,[owner,enemy,ally]);
 for(let now=50;now<=4000;now+=50)hits.push(...f.rt.advance(now,world,[owner,enemy,ally]));
 assert(hits.some(e=>e.type==='damage'&&e.victimId==='enemy'),id+' no hit');assert(!hits.some(e=>e.type==='damage'&&e.victimId==='ally'),id+' team hit');
 assert(f.rt.aircraftTargets().length<=5);if(id==='hunter-swarm')assert(hits.some(e=>e.type==='mortar-impact'));
 const blocked=fixture(id);blocked.activate();let blockedHits=[];blocked.rt.advance(0,{...world,lineOfSight:()=>false},[enemy]);
 for(let now=50;now<=2500;now+=50)blockedHits.push(...blocked.rt.advance(now,{...world,lineOfSight:()=>false},[enemy]));
 assert(!blockedHits.some(e=>e.type==='damage'),id+' shot through cover'); }
});
test('FFA aircraft and existing sentry damage same-team enemies with real victim team',()=>{
 for(const id of ['yardhawk','sentry-post']){const f=fixture(id,{mode:'ffa'});f.activate();f.rt.advance(0,world,[owner,ally]);let events=[];
 for(let now=50;now<=6000;now+=50)events.push(...f.rt.advance(now,world,[owner,ally]));
 assert(events.some(e=>e.type==='damage'&&e.victimId==='ally'&&e.victimTeam===0),id);assert(!events.some(e=>e.type==='damage'&&e.victimId==='owner'));}
});
test('FFA sensor samples are owner-scoped and enemy jam suppresses same-team observers',()=>{
 const f=fixture('recon-sweep',{mode:'ffa'});f.activate();f.rt.advance(0,world,[owner,ally]);
 for(let now=250;now<=2500;now+=250){f.rt.advance(now,world,[owner,ally]);if(f.rt.liveInstances().some(i=>i.kind==='recon'&&i.pulsed))break;}
 assert(f.rt.radarFor(0,[owner,ally],'owner').some(s=>s.id==='ally'));
 assert.equal(f.rt.radarFor(0,[owner,ally],'ally').length,0);assert.equal(f.rt.radarFor(0,[owner,ally]).length,0);
 f.rt.registerActor('jammer',0);for(let k=1;k<=4;k++)f.rt.recordElimination('jammer',k,k);
 assert(f.rt.activate({actorId:'jammer',slot:2,seq:0,claimId:'ffa-jammer',life:0,matchEpoch:7,toggle:false,origin:{x:0,y:0,z:0},aimYaw:0,context},2501,world).accepted);
 assert.equal(f.rt.radarFor(0,[owner,ally],'owner').length,0);
});
test('pilot is owner-only, accepts bounded monotonic input, moves and stops after stale input',()=>{
 const f=fixture('piloted-drone');f.activate();f.rt.advance(0,world,[owner,enemy]);
 const input={seq:1,forward:1,strafe:0,ascend:0,yaw:0,pitch:0,fire:false};
 assert(!f.rt.submitPilotInput('intruder',input,0,world));assert(f.rt.submitPilotInput('owner',input,0,world));
 assert(!f.rt.submitPilotInput('owner',input,0,world));assert(!f.rt.submitPilotInput('owner',{...input,seq:2,forward:99},0,world));
 assert(f.rt.submitPilotInput('owner',{...input,seq:2,yaw:Math.PI*20},0,world));
 f.rt.advance(100,world,[owner,enemy]);assert.equal(f.rt.pilotFor('owner').z,-1);
 f.rt.advance(350,world,[owner,enemy]);assert.equal(f.rt.pilotFor('owner').z,-1);
 const toggled=f.activate({toggle:true},351);assert(toggled.accepted);assert.equal(f.rt.pilotFor('owner'),null);assert.equal(f.rt.chargesOf('owner','piloted-drone'),0);
 assert(f.activate({toggle:true},352).accepted);assert(f.rt.pilotFor('owner'));f.rt.recordDisconnect('owner',353);assert.equal(f.rt.pilotFor('owner'),null);
 assert(f.activate({toggle:true},354).accepted);f.rt.recordDeath('owner',355);assert.equal(f.rt.pilotFor('owner'),null);
});
test('pilot fire follows aim and line of sight; no autonomous hits while uncommanded',()=>{
 let s=createAircraft(1,'owner',0,'piloted-drone',30000,{x:0,y:0,z:0},0,1);
 const high={...enemy,y:6.8};s=acceptPilotInput(s,{seq:1,forward:0,strafe:0,ascend:0,yaw:0,pitch:0,fire:true},600);
 let tick=stepAircraft(s,250,{now:600,world,targets:[high]});s={...tick.state,drones:tick.state.drones.map(d=>({...d,cooldownMs:0}))};
 tick=stepAircraft(s,50,{now:650,world,targets:[high]});assert(tick.events.some(e=>e.type==='damage'));
 assert.equal(stepAircraft(s,50,{now:650,world:{...world,lineOfSight:()=>false},targets:[high]}).events.length,0);
 assert.equal(stepAircraft(s,50,{now:1000,world,targets:[high]}).events.length,0);
});
test('aircraft counterplay excludes owner/friendly, applies damage and retires exactly once',()=>{
 const f=fixture('drone-swarm');const result=f.activate();assert.equal(f.rt.aircraftTargets().length,5);
 f.rt.damageAircraft(result.instanceId,'owner',1,100,1);f.rt.damageAircraft(result.instanceId,'ally',0,100,1);
 assert.equal(f.rt.aircraftTargets()[0].health,100);f.rt.damageAircraft(result.instanceId,'enemy',1,40,2);assert.equal(f.rt.aircraftTargets()[0].health,60);
 assert.equal(f.rt.damageAircraft(result.instanceId,'enemy',1,60,3).filter(e=>e.type==='streak-ended').length,1);
 assert.equal(f.rt.aircraftTargets().length,0);assert.equal(f.rt.damageAircraft(result.instanceId,'enemy',1,100,4).length,0);
});
test('carpet validates all20 points before payment, then warns and emits20 bounded bombs',()=>{
 const f=fixture('carpet-bomber'),fail=f.activate({anchor:{x:39,y:0,z:39}});assert(!fail.accepted);assert.equal(f.rt.chargesOf('owner','carpet-bomber'),1);
 assert(f.activate().accepted);let events=[];f.rt.advance(0,world,[enemy]);
 for(let now=100;now<=12000;now+=100)events.push(...f.rt.advance(now,world,[enemy]));
 assert.equal(events.filter(e=>e.type==='mortar-impact').length,CARPET_BOMBS);
 assert(events.findIndex(e=>e.type==='mortar-telegraph')<events.findIndex(e=>e.type==='mortar-impact'));
 assert(events.some(e=>e.type==='damage'));
 const covered=fixture('carpet-bomber');covered.activate();let hidden=[];const wall={...world,lineOfSight:()=>false};covered.rt.advance(0,wall,[enemy]);
 for(let now=100;now<=5000;now+=100)hidden.push(...covered.rt.advance(now,wall,[enemy]));assert(!hidden.some(e=>e.type==='damage'),'carpet wall cover');
 const roof=fixture('carpet-bomber');roof.activate();let roofed=[];const upstairs={...enemy,y:8};roof.rt.advance(0,world,[upstairs]);
 for(let now=100;now<=5000;now+=100)roofed.push(...roof.rt.advance(now,world,[upstairs]));assert(!roofed.some(e=>e.type==='damage'),'carpet floor separation');
});
test('adrenaline grants once; death clears queued rewards; last resort is lethal hostile-only',()=>{
 const f=fixture('adrenaline');f.activate();const grants=f.rt.drainRewardGrants();assert.equal(grants.length,1);assert.equal(grants[0].durationMs,15000);assert.equal(f.rt.drainRewardGrants().length,0);
 const queued=fixture('adrenaline');queued.activate();queued.rt.recordDeath('owner',1);assert.equal(queued.rt.drainRewardGrants().length,0);
 const last=fixture('last-resort');last.activate();last.rt.advance(0,world,[owner,enemy,ally]);const events=last.rt.advance(50,world,[owner,enemy,ally]);
 assert.equal(events.filter(e=>e.type==='damage').length,1);assert.equal(events.find(e=>e.type==='damage').healthAfter,0);
});
function capturedReward(wanted, selected=false){
 for(let seed=0;seed<400;seed++){
 const f=fixture('supply-crate',{seed});if(selected)f.rt.registerActor('owner',0,['recon-sweep','signal-jam','supply-crate',wanted]);
 f.activate();const crate=f.rt.liveInstances().find(i=>i.kind==='supply-crate');if(crate.reward!==wanted)continue;
 f.rt.advance(0,world,[owner]);for(let now=250;now<=1500;now+=250)f.rt.advance(now,world,[owner]);return f;
 }throw Error('fixture seed not found for '+wanted);
}
test('captured unslotted support appears in bonus5, activates once and leaves four saved slots unchanged',()=>{
 const f=capturedReward('yardhawk');assert.equal(f.rt.snapshotFor('owner').length,5);assert.equal(f.rt.snapshotFor('owner')[4].streakId,'yardhawk');
 assert(f.activate({slot:5},1600).accepted);assert.equal(f.rt.snapshotFor('owner').length,4);assert(!f.activate({slot:5},1601).accepted);
 const pilot=capturedReward('piloted-drone');assert(pilot.activate({slot:5},1600).accepted);assert.equal(pilot.rt.snapshotFor('owner').length,4);
 assert(pilot.activate({slot:5,toggle:true},1601).accepted);assert.equal(pilot.rt.pilotFor('owner'),null);
});
test('captured selected support banks realslot; Crimson capture grants45s once without bonus row',()=>{
 const selected=capturedReward('chopper',true);assert.equal(selected.rt.snapshotFor('owner')[3].charges,1);assert.equal(selected.rt.snapshotFor('owner').length,4);
 const crimson=capturedReward('crimson-flamethrower');assert.equal(crimson.rt.snapshotFor('owner').length,4);
 const grants=crimson.rt.drainRewardGrants();assert.equal(grants[0].reward,'crimson-flamethrower');assert.equal(grants[0].durationMs,45000);assert.equal(crimson.rt.drainRewardGrants().length,0);
});
test('bounded snapshot contains realcraft poses and no private targeting/control/roll state',()=>{
 const f=fixture('drone-swarm');f.activate();f.rt.advance(0,world,[enemy]);f.rt.advance(100,world,[enemy]);const row=f.rt.effectSnapshot()[0];
 assert.equal(row.craft.length,5);assert.deepEqual(row.craft.map(c=>[c.x,c.y,c.z]),f.rt.aircraftTargets().map(c=>[c.x,c.y,c.z]));
 for(const key of ['drones','input','lastInputSeq','anchor','targetId','reward','rollUnit'])assert(!(key in row));
 f.rt.endMatch(200);assert.equal(f.rt.effectSnapshot().length,0);assert.equal(f.rt.aircraftTargets().length,0);
});
test('real GameHost applies autonomous support damage and credits streak kills without ladder farming',()=>{
 const f=fixture('chopper');const host=new GameHost({world,now:0,rules:{mode:'tdm',scoreLimit:null,durationMs:null,friendlyFire:false},deps:{streaks:streakPort(f.rt,7)}});
 host.addActor('owner',0,{streakLoadout:f.loadout});host.addActor('enemy',1);host.tick(3000);
 host.updatePose('owner',0,0,0,3000);host.updatePose('enemy',0,0,-8,3000);assert.equal(host.submitStreakIntent('owner',{type:'streak-intent',slot:4,toggle:false}),null);
 let events=[];for(let now=3050;now<=9000;now+=50){host.updatePose('owner',0,0,0,now);host.updatePose('enemy',0,0,-8,now);events.push(...host.tick(now));}
 assert(events.some(e=>e.type==='damage'&&e.cause==='streak'));assert(events.some(e=>e.type==='kill'&&e.cause==='streak'));assert.equal(f.rt.chargesOf('owner','chopper'),0);
 const reconBank=f.rt.chargesOf('owner','recon-sweep');f.rt.recordElimination('owner',20,9100,'bullet');f.rt.recordElimination('owner',21,9200,'bullet');
 assert.equal(f.rt.chargesOf('owner','recon-sweep'),reconBank,'streak kill advanced the earning ladder');
});
console.log('PASS expanded native streaks: '+cases+' scenarios');
`;
const result=await build({stdin:{contents:source,loader:'ts',resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false,logLevel:'warning'});
const file=resolve(mkdtempSync(resolve(tmpdir(),'aa-expanded-streak-proof-')),'proof.mjs');
writeFileSync(file,result.outputFiles[0].contents);
await import(pathToFileURL(file).href);
