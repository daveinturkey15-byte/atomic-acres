// Same source/cameras, fresh active matches. Keeps HUD/bots and every original frame.
// Additional room-first evidence avoids treating a bot-obscured frame as art approval.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { enterSoakScenario } from './lib/soak-scenario.mjs';
const [label, candidate] = process.argv.slice(2);
if(!label || !candidate)throw Error('label and candidate URL required');
const out=join('captures','room-pairs',label);if(existsSync(out))throw Error('Existing evidence is immutable');mkdirSync(out,{recursive:true});
const baseline=new URL(candidate);baseline.searchParams.delete('room-light');
const result={label,comparisons:[],errors:[]};
for(const [name,url] of [['baseline',baseline.href],['baked',candidate]]){
 const owned=await stockBrowser('room-pair-'+name);
 const receipt={name,url,frames:[]};result.comparisons.push(receipt);
 try{
  const {page}=owned;page.on('pageerror',e=>result.errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')result.errors.push(e.text());});
  await page.goto(url,{waitUntil:'load',timeout:90000});await page.waitForFunction(()=>window.__NT?.ready,null,{timeout:90000});
  receipt.admission=await enterSoakScenario(page,'solo-gameplay');
  receipt.identity=await page.evaluate(()=>({scripts:[...document.scripts].map(x=>x.src).filter(Boolean),backend:window.__NT_BACKEND}));
  for(const [view,pos,yaw,pitch] of [['orangeLiving',[1.5,1.68,-20.2],-Math.PI/2,-.08],['interiorOrange',null,null,null],['orangeUpper',[-2,4.83,-23.5],0,-.05],['spawnA',null,null,null]]){
   const station=await page.evaluate(({view,pos,yaw,pitch})=>{
    const q=window.__NT,s=pos?{pos,yaw,pitch}:q.stations[view];q.release();q.setMode('noclip');
    q.teleport(s.pos[0],s.pos[1]-q.stats().eyeHeight,s.pos[2],s.yaw,s.pitch);return s;
   },{view,pos,yaw,pitch});
   await page.waitForTimeout(400);await page.screenshot({path:join(out,name+'-'+view+'.png')});
   receipt.frames.push({view,station,stats:await page.evaluate(()=>window.__NT.stats())});
  }
 }catch(e){result.errors.push(String(e));}finally{await owned.close();}
}
result.pass=result.errors.length===0 && result.comparisons.every(c=>c.frames.length===4&&c.frames.every(f=>f.stats.calls>2&&f.stats.calls<=1200&&f.stats.triangles<=900000));
writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,errors:result.errors,frames:result.comparisons.map(c=>c.frames.length)}));
if(!result.pass)process.exitCode=1;
