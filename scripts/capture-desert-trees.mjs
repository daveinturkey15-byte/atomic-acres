import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';
const out=join(process.cwd(),'captures','desert-trees');
mkdirSync(out,{recursive:true});
const result={errors:[],frames:[]};
const owned=await stockBrowser('desert-trees');
try{
  const {page}=owned;
  page.on('pageerror',e=>result.errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')result.errors.push(e.text());});
  await page.goto('http://127.0.0.1:4192/?tod=noon&weather=clear',{waitUntil:'load',timeout:90000});
  await page.waitForFunction(()=>window.__NT?.ready,null,{timeout:90000});
  await page.addStyleTag({content:'#start,#hud,#crosshair{display:none!important}'});
  result.module=await page.evaluate(()=>window.__NT.moduleStats['desert-trees']);
  if(result.module?.colliders!==2)throw new Error('two loaded plants/colliders required');
  for(const [name,x,z] of [['white-yard',-3,34],['orange-yard',6.25,-34]]){
    const colliders=await page.evaluate(([name,x,z])=>{
      const dx=1.3,dz=z>0?-2:2;
      window.__NT.stations[name]={pos:[x+dx,1.35,z+dz],yaw:Math.atan2(dx,dz),pitch:-Math.atan2(.5,Math.hypot(dx,dz)),fov:58,ref:null,note:'Photogrammetry plant, native scale and honest collider'};
      window.__NT.goto(name);return window.__NT.collidersAt(x,z,.8);
    },[name,x,z]);
    for(let i=0;i<6;i++){await measureFrame(page);await page.waitForTimeout(60);}
    const stats=await measureFrame(page);
    await page.screenshot({path:join(out,name+'.png')});
    result.frames.push({name,stats,colliders});
  }
  result.pass=!result.errors.length&&result.frames.length===2&&result.frames.every(f=>sceneWasMeasured(f.stats)&&f.stats.calls<=1200&&f.stats.triangles<=900000&&f.colliders.length===1&&f.colliders[0].owner==='desert-trees');
}catch(e){result.fatal=String(e);result.pass=false;}
finally{writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));await owned.close();}
console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
