/** Real room/token/ledger with a minimal driver port: reconnect receives levels on its first tick. */
import { build } from 'esbuild';
import { resolve } from 'node:path';
const source = `
import assert from 'node:assert/strict';
import { HostRoom, GuestClient, liveRoomCount } from './src/net/room';
import { createHostDriver } from './src/net/match-host';
import { StreakRuntime } from './src/game/killstreaks/runtime';
import { DEFAULT_STREAK_LOADOUT } from './src/game/killstreaks/catalog';
const peers=new Map(),queue=[];
const transport=id=>{const handlers=new Set();const t={localId:id,
 send(to,msg){queue.push({from:id,to,msg});},onMessage(fn){handlers.add(fn);return()=>handlers.delete(fn);},
 close(){handlers.clear();},receive(from,msg){for(const fn of handlers)fn(from,msg);}};peers.set(id,t);return t;};
const pump=()=>{let n=0;while(queue.length){assert(++n<10000);const m=queue.shift();peers.get(m.to)?.receive(m.from,m.msg);}};
let now=0,spawns=0;
const ht=transport('host'),gt=transport('old');
const room=new HostRoom(ht,{code:'ABC234',now:()=>now,capacity:2});
const guest=new GuestClient(gt,'host','ABC234','GUEST',{now:()=>now});pump();
const id=guest.getPlayerId();assert(id);
const runtime=new StreakRuntime({seed:1});const ids=new Set();
const solo={localId:room.hostId,addRemote(id,name,team,primary,kit,streaks){if(ids.has(id))return;ids.add(id);spawns++;runtime.registerActor(id,team,streaks??DEFAULT_STREAK_LOADOUT);},
 removeRemote(id){ids.delete(id);},setEventSink(){},stampSample:s=>s,movementState:()=>({suspended:false,speedMultiplier:1}),
 botSamples(){},resumeFacts:()=>({life:1,shotSeq:2,primaryId:'mp5',rounds:149}),
 remotePose(){},tick(){},matchState:()=>({type:'match-state',at:now,mode:'tdm',phase:'active',endsAt:null,scoreLimit:null,
 teamScores:[0,0],scores:[],winner:null,winnerId:null,endReason:null}),
 streakStateFor:(id,at)=>runtime.streakStateFor(id,at),effectsState:at=>({type:'streak-effects',at,effects:[]}),
 radarStateFor:()=>null,dispose(){}};
const driver=createHostDriver(room,solo,{world:{}});
room.setReady(true);guest.setReady(true);pump();assert.equal(room.start(),null);
for(let i=0;i<21;i++){now+=50;room.tickOnce(now);driver.tick(now,0,0,0,0,0);pump();}
const token=guest.identity();assert(token);now+=7000;room.tickOnce(now);driver.tick(now,0,0,0,0,0);pump();
const fresh=transport('fresh'),resumed=new GuestClient(fresh,'host','ABC234','GUEST',{now:()=>now,resume:token});
const messages=[];resumed.onGame(m=>messages.push(m));pump();
assert.equal(resumed.getPlayerId(),id);assert.equal(resumed.resumeState().shotSeq,2);
now+=50;driver.tick(now,0,0,0,0,0);pump();
const ledger=messages.find(m=>m.type==='streak-state');assert(ledger,'first post-rejoin driver tick must deliver ledger');
assert.equal(ledger.actorId,id);assert.deepEqual(ledger.slots.map(s=>s.streakId),DEFAULT_STREAK_LOADOUT);
assert(messages.some(m=>m.type==='match-state'),'match level refreshed with unchanged phase');
assert.equal(spawns,1,'same reserved seat cannot acquire a replacement spawn');
assert.equal(resumed.resumeState().rounds,149,'inventory survives level refresh');
driver.dispose();resumed.dispose();guest.dispose();room.dispose();pump();assert.equal(liveRoomCount(),0);
console.log('PASS rejoin levels: actual room/token + runtime ledger refresh on first reconnect tick; same seat, shot fence, rounds and spawn count');
`;
const result=await build({stdin:{contents:source,loader:'ts',resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false,logLevel:'warning'});
await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
