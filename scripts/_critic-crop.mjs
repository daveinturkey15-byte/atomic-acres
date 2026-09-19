import { readPng } from './_critic-png.mjs';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}let crc=0xffffffff;for(const b of buf)crc=t[(crc^b)&0xff]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([len,td,c]);}
function writePng(path,w,h,rgb){const stride=w*3;const raw=Buffer.alloc((stride+1)*h);for(let y=0;y<h;y++){raw[y*(stride+1)]=0;rgb.copy(raw,y*(stride+1)+1,y*stride,y*stride+stride);}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;writeFileSync(path,Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
const [,,src,dst,X0,Y0,X1,Y1,S] = process.argv;
const img=readPng(src);const x0=+X0,y0=+Y0,x1=+X1,y1=+Y1,s=+(S||1);
const w=(x1-x0)*s,h=(y1-y0)*s;const out=Buffer.alloc(w*h*3);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=x0+Math.floor(x/s),sy=y0+Math.floor(y/s);const i=(sy*img.width+sx)*img.bpp;const o=(y*w+x)*3;out[o]=img.data[i];out[o+1]=img.data[i+1];out[o+2]=img.data[i+2];}
writePng(dst,w,h,out);console.log('wrote '+dst+' '+w+'x'+h);
