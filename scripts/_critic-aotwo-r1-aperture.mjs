// read-only: measure fixed rects over PNGs already on disk. No render, no edit.
import { readPng } from './_critic-png.mjs';
import { join } from 'node:path';
const ROOT = process.cwd();
const R0 = join(ROOT, 'captures/gauntlet/ao-twoscale/round-0');
const R1 = join(ROOT, 'captures');
const rects = {
  'L-window edge TL':   [935, 252, 975, 292],
  'L-window edge top':  [990, 250, 1050, 270],
  'L-window centre':    [980, 420, 1040, 470],
  'R-window edge TL':   [1200, 256, 1240, 296],
  'R-window centre':    [1300, 430, 1360, 480],
  'doorway edge top':   [200, 250, 400, 275],
  'doorway centre':     [280, 430, 420, 500],
  'wall-ceiling crease':[200, 88, 520, 104],
};
function stat(img, [x0,y0,x1,y1]) {
  let s=0,n=0,mn=255;
  for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++){
    const i=(y*img.width+x)*img.bpp;
    const l=0.2126*img.data[i]+0.7152*img.data[i+1]+0.0722*img.data[i+2];
    s+=l;n++; if(l<mn)mn=l;
  }
  return {mean:+(s/n).toFixed(2), min:+mn.toFixed(1)};
}
for (const pass of ['', 'ao-']) {
  const a = readPng(join(R0, `g-ao-twoscale-r0-${pass}interiorOrange.png`));
  const b = readPng(join(R1, `g-ao-twoscale-r1-${pass}interiorOrange.png`));
  console.log('== interiorOrange ' + (pass ? '?post=ao' : 'chain'));
  for (const [k,r] of Object.entries(rects)) {
    const A=stat(a,r), B=stat(b,r);
    const d=((B.mean-A.mean)/A.mean*100).toFixed(2);
    console.log('  '+k.padEnd(22)+String(A.mean).padStart(8)+' -> '+String(B.mean).padStart(8)+'  '+String(d).padStart(7)+'%   min '+A.min+' -> '+B.min);
  }
}
