import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';
const ROOT='C:/Users/david/Desktop/stuff/nuketown';
const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const server=spawn('npx.cmd',['vite','preview','--port',String(port),'--strictPort'],{cwd:ROOT,stdio:'ignore',shell:true});
const url='http://localhost:'+port+'/';
for(let i=0;i<960;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
const b=await chromium.launch();const p=await b.newPage();
await p.goto(url,{waitUntil:'load',timeout:120000});
await p.waitForFunction(()=>window.__NT&&window.__NT.ready===true,null,{timeout:240000});
const out=await p.evaluate(()=>{
  const nt=window.__NT, res={};
  const spansAtZ=(z)=>{const o=[];for(let x=-19;x<=19;x+=0.25){if(!nt.collidersAt(x,z,1.0).length)o.push(+x.toFixed(2));}
    const s=[];for(const v of o){const l=s[s.length-1];if(l&&v-l[1]<0.4)l[1]=v;else s.push([v,v]);}
    return s.filter(q=>q[1]-q[0]>=0.9).map(q=>q[0]+'..'+q[1]);};
  const spansAtX=(x)=>{const o=[];for(let z=-42;z<=42;z+=0.25){if(!nt.collidersAt(x,z,1.0).length)o.push(+z.toFixed(2));}
    const s=[];for(const v of o){const l=s[s.length-1];if(l&&v-l[1]<0.4)l[1]=v;else s.push([v,v]);}
    return s.filter(q=>q[1]-q[0]>=0.9).map(q=>q[0]+'..'+q[1]);};
  for(const z of [-35,-33,-30,-28,-12,-8,-4,0,4,8,12,28,30,33,35]) res['z='+z]=spansAtZ(z);
  for(const x of [-12.2,-10,-8,0,8,10,12.2]) res['x='+x]=spansAtX(x);
  return res;});
for(const [k,v] of Object.entries(out)) console.log(k.padEnd(9), v.join('  '));
await b.close();server.kill();
