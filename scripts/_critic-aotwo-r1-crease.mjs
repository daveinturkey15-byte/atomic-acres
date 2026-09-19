import { readPng } from './_critic-png.mjs';
import { join } from 'node:path';
const ROOT=process.cwd();
function L(img,x,y){const i=(y*img.width+x)*img.bpp;return 0.2126*img.data[i]+0.7152*img.data[i+1]+0.0722*img.data[i+2];}
function vprof(img,x0,x1,y0,y1){const o=[];for(let y=y0;y<y1;y++){let s=0,n=0;for(let x=x0;x<x1;x++){s+=L(img,x,y);n++;}o.push(+(s/n).toFixed(1));}return o;}
const r0=readPng(join(ROOT,'captures/gauntlet/ao-twoscale/round-0/g-ao-twoscale-r0-interiorOrange.png'));
const r1=readPng(join(ROOT,'captures/gauntlet/ao-twoscale/round-1/g-ao-twoscale-r1-interiorOrange.png'));
const a0=readPng(join(ROOT,'captures/gauntlet/ao-twoscale/round-0/g-ao-twoscale-r0-ao-interiorOrange.png'));
const a1=readPng(join(ROOT,'captures/gauntlet/ao-twoscale/round-1/g-ao-twoscale-r1-ao-interiorOrange.png'));
console.log('interiorOrange, wall below the ceiling beam, x 250..520, rows y 98..200');
const a=vprof(r0,250,520,98,200), b=vprof(r1,250,520,98,200);
const p=vprof(a0,250,520,98,200), q=vprof(a1,250,520,98,200);
for(let i=0;i<a.length;i+=6) console.log('  y='+String(98+i).padStart(4)+'  chain r0 '+String(a[i]).padStart(6)+'  r1 '+String(b[i]).padStart(6)+'   |  ao r0 '+String(p[i]).padStart(6)+'  r1 '+String(q[i]).padStart(6));
const base=b[b.length-1], base0=a[a.length-1];
const cnt=(arr,bs)=>arr.filter(v=>v<bs*0.93).length;
console.log('  chain rows >7% below the settled wall value:  r0 '+cnt(a,base0)+' px,  r1 '+cnt(b,base)+' px   (wall base r0 '+base0+' r1 '+base+')');
console.log('  ao    rows >7% below the settled wall value:  r0 '+cnt(p,p[p.length-1])+' px,  r1 '+cnt(q,q[q.length-1])+' px');
// grass at the foot of the spawnA crate vs open lawn
const s0=readPng(join(ROOT,'captures/gauntlet/ao-twoscale/round-0/g-ao-twoscale-r0-spawnA.png'));
const s1=readPng(join(ROOT,'captures/gauntlet/ao-twoscale/round-1/g-ao-twoscale-r1-spawnA.png'));
function rect(img,[x0,y0,x1,y1]){let s=0,n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){s+=L(img,x,y);n++;}return +(s/n).toFixed(2);}
const rs={'grass at crate foot':[750,672,930,692],'open lawn (control)':[300,690,500,740],'stepping stone rim':[640,830,800,880]};
for(const [k,r] of Object.entries(rs)) console.log('  spawnA '+k.padEnd(22)+rect(s0,r)+' -> '+rect(s1,r)+'   ('+(((rect(s1,r)-rect(s0,r))/rect(s0,r))*100).toFixed(2)+'%)');
