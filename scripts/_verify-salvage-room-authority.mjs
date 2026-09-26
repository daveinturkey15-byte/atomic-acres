import { build } from 'esbuild';
import { resolve } from 'node:path';

const source = `
import assert from 'node:assert/strict';
import { HostRoom, GuestClient, liveRoomCount } from './src/net/room';
import { isNetMessage } from './src/net/protocol';
import { DEFAULT_STREAK_LOADOUT } from './src/game/killstreaks/catalog';
import { integrateInput, createPose, intentFromVelocity, SPRINT_SPEED } from './src/net/room-core';

const peers = new Map();
const queue = [];
const transport = (id) => {
  const handlers = new Set();
  const t = { localId: id, closed: false,
    send(to, msg) { queue.push({from:id,to,msg}); },
    onMessage(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    close() { this.closed = true; handlers.clear(); },
    receive(from,msg) { if (!this.closed) for (const fn of handlers) fn(from,msg); },
  }; peers.set(id,t); return t;
};
const pump = () => { let count=0; while(queue.length) {
  assert(++count<10000,'bounded message exchange');
  const m=queue.shift(); peers.get(m.to)?.receive(m.from,m.msg);
} };
let now=0;
const ht=transport('host-peer'), gt=transport('guest-peer');
const host = new HostRoom(ht,{code:'ABC234',now:()=>now,capacity:2});
const guest = new GuestClient(gt,'host-peer','ABC234','GUEST',{
  now:()=>now, localLoadout:()=>({primary:'mp5',sidearm:'railgun',grenade:'smoke'}),
  localStreakLoadout:()=>DEFAULT_STREAK_LOADOUT,
});
pump();
const id=guest.getPlayerId(); assert(id);
assert.equal(host.loadoutOf(id)?.primary,'mp5');
assert.notEqual(host.loadoutOf(id)?.sidearm,'railgun','sidearm is authored, not forged');
assert.equal(host.loadoutOf(id)?.grenade,'smoke');
assert.deepEqual(host.streakLoadoutOf(id),DEFAULT_STREAK_LOADOUT);
const accepted=[]; host.onGame((seat,msg)=>accepted.push({seat,...msg}));
const press=(seq)=>gt.send('host-peer',{type:'streak-intent',slot:1,toggle:false,seq});
press(0); pump(); assert.equal(accepted.length,0,'lobby presses cannot activate');
host.setReady(true); guest.setReady(true); pump(); assert.equal(host.start(),null);
for(let i=0;i<21;i++){now+=50;host.tickOnce(now);pump();}
assert.equal(guest.getState(),'playing');
const pilot={forward:1,strafe:0,ascend:0,yaw:0,pitch:0,fire:true};
guest.sendPilot(pilot); pump();
assert.equal(accepted.length,1);assert.equal(accepted[0].type,'pilot-input');
gt.send('host-peer',{type:'pilot-input',...pilot,seq:0});
gt.send('host-peer',{type:'pilot-input',...pilot,seq:2,ascend:Infinity});
gt.send('host-peer',{type:'pilot-input',...pilot,seq:3,yaw:1_000_001});pump();
assert.equal(accepted.length,1,'pilot replay and nonfinite/unbounded controls refused');
let movement={suspended:true,speedMultiplier:1.25};host.setMovementState(()=>movement);
const parked=host.poseOf(id);guest.sendMoveAt(1,1,1,0,true,.05,2,'crouch');pump();
assert.deepEqual(host.poseOf(id),parked,'possession parks body including stance and height');
now+=50;host.tickOnce(now);pump();movement={suspended:false,speedMultiplier:1.25};
guest.sendMoveAt(1,1,0,0,true,.05,0);pump();const moved=host.poseOf(id);
assert(Math.abs(Math.hypot(moved.x-parked.x,moved.z-parked.z)-SPRINT_SPEED*1.25*.05)<1e-8,
  'host buff remains capped with diagonal input');
const expected=createPose();integrateInput(expected,1,1,0,true,.05,'stand',999);
assert(Math.abs(Math.hypot(expected.x,expected.z)-SPRINT_SPEED*1.25*.05)<1e-8);
const intent={mx:0,mz:0,sprint:false};intentFromVelocity(0,-4.8*1.25,0,intent,'stand',1.25);
assert.equal(intent.sprint,false,'adrenaline walking does not become sprint');assert.equal(intent.mz,1);
accepted.length=0;
guest.sendGame({type:'streak-intent',slot:1,toggle:false}); pump();
assert.equal(accepted.length,1); assert.equal(accepted[0].seat,id);
press(0); press(0); press(-1); press(NaN); pump();
assert.equal(accepted.length,1,'duplicate and invalid intents are refused');
press(5);press(4);pump();assert.equal(accepted.length,2,'reordered intent is stale');
gt.send('host-peer',{type:'ready',ready:true,loadout:{primary:'deadeye',sidearm:'duster',grenade:'flash'}});pump();
assert.equal(host.loadoutOf(id)?.primary,'mp5','class cannot change after Start');
const claim=guest.identity(); assert(claim);
now+=7000;host.tickOnce(now);pump();
const fresh=transport('fresh-peer');
const refreshed=new GuestClient(fresh,'host-peer','ABC234','GUEST',{now:()=>now,resume:claim});
pump();assert.equal(refreshed.getPlayerId(),id);
assert.equal(refreshed.resumeState()?.lastStreakSeq,5);
assert.equal(refreshed.resumeState()?.lastPilotSeq,0);
refreshed.sendPilot(pilot);pump();assert.equal(accepted.at(-1).seq,1,'pilot rejoin continues above fence');
assert.equal(accepted.at(-1).seat,id);accepted.pop();
refreshed.sendGame({type:'streak-intent',slot:1,toggle:false});pump();
assert.equal(accepted.length,3);assert.equal(accepted[2].seq,6,'rejoin continues above fence');
press(99);pump();assert.equal(accepted.length,3,'old transport lost its seat');
assert(!isNetMessage({type:'streak-intent',slot:1,toggle:false}),'legacy unsequenced press fails closed');
refreshed.dispose();guest.dispose();host.dispose();pump();
assert.equal(liveRoomCount(),0,'all room listeners/timers disposed');
console.log('PASS room: immutable class, pilot replay/rejoin/control bounds, parked body, capped diagonal buff, canonical sidearm/streaks, replay/reorder fence, authenticated rejoin, stale transport and teardown');
`;
const result = await build({ stdin:{contents:source,loader:'ts',resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false,logLevel:'warning' });
await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
