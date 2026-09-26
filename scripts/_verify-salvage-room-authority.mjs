import { build } from 'esbuild';
import { resolve } from 'node:path';

const source = `
import assert from 'node:assert/strict';
import { HostRoom, GuestClient, liveRoomCount } from './src/net/room';
import { isNetMessage } from './src/net/protocol';
import { DEFAULT_STREAK_LOADOUT } from './src/game/killstreaks/catalog';

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
refreshed.sendGame({type:'streak-intent',slot:1,toggle:false});pump();
assert.equal(accepted.length,3);assert.equal(accepted[2].seq,6,'rejoin continues above fence');
press(99);pump();assert.equal(accepted.length,3,'old transport lost its seat');
assert(!isNetMessage({type:'streak-intent',slot:1,toggle:false}),'legacy unsequenced press fails closed');
refreshed.dispose();guest.dispose();host.dispose();pump();
assert.equal(liveRoomCount(),0,'all room listeners/timers disposed');
console.log('PASS room: immutable class, canonical sidearm/streaks, replay/reorder fence, authenticated rejoin, stale transport and teardown');
`;
const result = await build({ stdin:{contents:source,loader:'ts',resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false,logLevel:'warning' });
await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
