import { readPng } from './_critic-png.mjs';
import { join } from 'node:path';
const ROOT=process.cwd();
const a=readPng(join(ROOT,'captures/gauntlet/ao-twoscale/round-0/g-ao-twoscale-r0-ao-turningHead.png'));
const b=readPng(join(ROOT,'captures/gauntlet/ao-twoscale/round-1/g-ao-twoscale-r1-ao-turningHead.png'));
function px(img,x,y){const i=(y*img.width+x)*img.bpp;return +(0.2126*img.data[i]+0.7152*img.data[i+1]+0.0722*img.data[i+2]).toFixed(1);}
function band(img,y0,y1,x0,x1){let s=0,n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){s+=px(img,x,y);n++;}return +(s/n).toFixed(2);}
// horizontal scan across the LEFT lamp pole at y=200 (pole is a thin vertical silhouette in clean sky)
console.log('AO across the left lamp pole, y 195..215 avg, x 140..280');
let A=[],B=[];for(let x=140;x<=280;x+=5){A.push(band(a,195,215,x,x+5));B.push(band(b,195,215,x,x+5));}
console.log(' x  '+Array.from({length:A.length},(_,i)=>String(140+i*5).padStart(6)).join(''));
console.log(' r0 '+A.map(v=>String(v).padStart(6)).join(''));
console.log(' r1 '+B.map(v=>String(v).padStart(6)).join(''));
// clean distant-mountain patches, no foreground
const patches={'ridge A':[620,300,700,325],'ridge B':[1290,296,1345,320],'ridge C':[960,300,1000,322],'open sky high':[600,60,900,140]};
for(const [k,[x0,y0,x1,y1]] of Object.entries(patches)){
  const A=band(a,y0,y1,x0,x1),B=band(b,y0,y1,x0,x1);
  console.log('  '+k.padEnd(16)+String(A).padStart(8)+' -> '+String(B).padStart(8)+'  '+((B-A)/A*100).toFixed(2)+'%');
}
