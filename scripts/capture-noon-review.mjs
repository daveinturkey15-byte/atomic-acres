import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {stockBrowser} from './lib/stock-browser.mjs';
const label=process.argv[2],url=process.argv[3];
if(!label||!url)throw new Error('label and exact URL required');
const out=join('captures','single-astra-noon',label);mkdirSync(out,{recursive:true});
const result={label,url,errors:[],frames:[],claim:'Solo/Deploy; screenshots from normal running frame loop at fixed documented stations.'};
const owned=await stockBrowser('noon-'+label);
try{
 const {page}=owned;
 page.on('pageerror',e=>result.errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')result.errors.push(e.text())});
 await page.goto(url,{waitUntil:'load',timeout:90000});
 await page.waitForFunction(()=>window.__NT?.ready,null,{timeout:90000});
 await page.screenshot({path:join(out,'menu.png')});
 await page.getByRole('button',{name:'Play solo',exact:true}).click();
 await page.getByRole('button',{name:'Deploy',exact:true}).click();
 await page.waitForFunction(()=>window.__NTGAME?.snapshot?.().match?.phase==='active',null,{timeout:45000});
 result.identity=await page.evaluate(()=>({scripts:[...document.scripts].map(s=>s.src).filter(Boolean),backend:window.__NT_BACKEND,colliders:window.__NT.colliderCount}));
 await page.evaluate(()=>{const q=window.__NT;q.release();q.setMode('walk');q.teleport(0,0,-34,Math.PI,0)});
 await page.keyboard.press('KeyF');await page.waitForTimeout(150);
 result.afterF=await page.evaluate(()=>window.__NT.stats());
 await page.keyboard.down('KeyC');await page.waitForTimeout(350);
 result.crouched=await page.evaluate(()=>window.__NT.stats());
 await page.keyboard.up('KeyC');await page.waitForTimeout(350);
 result.standing=await page.evaluate(()=>window.__NT.stats());
 for(const name of ['spawnA','spawnB','streetElevation','interiorOrange','yardWhite','yardOrange','midStreet']){
   const station=await page.evaluate(n=>{const q=window.__NT,s=q.stations[n];q.goto(n);q.release();q.setMode('noclip');q.teleport(s.pos[0],s.pos[1]-q.stats().eyeHeight,s.pos[2],s.yaw,s.pitch);return s},name);
   await page.waitForTimeout(500);
   await page.screenshot({path:join(out,name+'.png')});
   result.frames.push({name,station,stats:await page.evaluate(()=>window.__NT.stats())});
 }
 for(const [name,x,y,z,yaw,pitch] of [
   ['orangeLiving',1.5,1.68,-20.2,-Math.PI/2,-.08],
   ['orangeUpper',-2,4.83,-23.5,0,-.05],
   ['whiteLiving',0,1.68,18.7,Math.PI,-.04],
   ['whiteUpper',-3.3,4.83,23.3,0,-.03],
   ['whiteHall',-3.6,4.83,25.3,0,0],
 ]){
   await page.evaluate(p=>{const q=window.__NT;q.release();q.setMode('noclip');q.teleport(p[0],p[1]-q.stats().eyeHeight,p[2],p[3],p[4]);},[x,y,z,yaw,pitch]);
   await page.waitForTimeout(400);await page.screenshot({path:join(out,name+'.png')});
   result.frames.push({name,diagnostic:true,station:{pos:[x,y,z],yaw,pitch},stats:await page.evaluate(()=>window.__NT.stats())});
 }
 result.motion=await page.evaluate(async()=>{const samples=[];for(let i=0;i<90;i++){await new Promise(r=>requestAnimationFrame(r));samples.push({time:performance.now(),bodies:window.__NT.remoteBodies(),rigs:window.__NTANIM?.list()});}return samples});
 result.pass=result.errors.length===0&&result.frames.every(f=>f.stats.calls>2&&f.stats.calls<=1200&&f.stats.triangles<=900000);
}catch(e){result.error=String(e);result.pass=false}
finally{await owned.close();writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify({pass:result.pass,error:result.error,errors:result.errors,identity:result.identity,afterF:result.afterF?.mode,crouched:result.crouched?.stance,standing:result.standing?.stance,frames:result.frames.map(f=>({name:f.name,calls:f.stats.calls,triangles:f.stats.triangles}))}));
if(!result.pass)process.exitCode=1;
