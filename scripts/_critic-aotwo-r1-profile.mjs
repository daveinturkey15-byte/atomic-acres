import { readPng } from './_critic-png.mjs';
import { join } from 'node:path';
const ROOT=process.cwd();
const a=readPng(join(ROOT,'captures/gauntlet/ao-twoscale/round-0/g-ao-twoscale-r0-ao-interiorOrange.png'));
const b=readPng(join(ROOT,'captures/g-ao-twoscale-r1-ao-interiorOrange.png'));
function col(img,x,y0,y1){let s=0,n=0;for(let y=y0;y<y1;y++){const i=(y*img.width+x)*img.bpp;s+=0.2126*img.data[i]+0.7152*img.data[i+1]+0.0722*img.data[i+2];n++;}return +(s/n).toFixed(1);}
function row(img,y,x0,x1){let s=0,n=0;for(let x=x0;x<x1;x++){const i=(y*img.width+x)*img.bpp;s+=0.2126*img.data[i]+0.7152*img.data[i+1]+0.0722*img.data[i+2];n++;}return +(s/n).toFixed(1);}
console.log('horizontal across LEFT window glazing, y 290..320 averaged, x 930..1070 step 10');
let A=[],B=[];for(let x=930;x<=1070;x+=10){A.push(col(a,x,290,320));B.push(col(b,x,290,320));}
console.log(' x      '+Array.from({length:15},(_,i)=>String(930+i*10).padStart(6)).join(''));
console.log(' r0     '+A.map(v=>String(v).padStart(6)).join(''));
console.log(' r1     '+B.map(v=>String(v).padStart(6)).join(''));
console.log('vertical down LEFT window glazing, x 990..1020 averaged, y 250..650 step 25');
let C=[],D=[];for(let y=250;y<=650;y+=25){C.push(row(a,y,990,1020));D.push(row(b,y,990,1020));}
console.log(' r0  '+C.map(v=>String(v).padStart(6)).join(''));
console.log(' r1  '+D.map(v=>String(v).padStart(6)).join(''));
