import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';
const out=join(process.cwd(),'captures','operator-close');
mkdirSync(out,{recursive:true});
const result={errors:[],frames:[]};
const owned=await stockBrowser('operator-close');
try{
  const {page}=owned;
  page.on('pageerror',e=>result.errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')result.errors.push(e.text());});
  await page.goto('http://127.0.0.1:4192/?tod=noon&weather=clear',{waitUntil:'load',timeout:90000});
  await page.waitForFunction(()=>window.__NT?.ready,null,{timeout:90000});
  await page.getByRole('button',{name:'Play solo',exact:true}).click();
  await page.getByRole('button',{name:/deploy/i}).click();
  await page.waitForFunction(()=>{try{return window.__NTANIM?.ready&&window.__NTGAME?.snapshot?.().match?.phase==='active';}catch{return false;}},null,{timeout:45000});
  await page.addStyleTag({content:'#hud,#crosshair{display:none!important}'});
  const subject=await page.evaluate(()=>{
    const a=window.__NTANIM,i=a.spawn(-14,-8,0,0)-1;
    a.solo(i);a.pin(i,-14,-8,0);a.drive(i,0,false,false,false);a.selfTick(true);return i;
  });
  for(const v of [
    {name:'three-quarter',dx:.65,dz:1.9,y:1.35,targetY:.9,fov:65},
    {name:'cloth-close',dx:.35,dz:1.15,y:1.32,targetY:1.12,fov:50},
    {name:'prone-carry',dx:1.9,dz:.4,y:.85,targetY:.4,fov:65,prone:true},
  ]){
    await page.evaluate(([i,v])=>{
      const a=window.__NTANIM;a.drive(i,0,false,!!v.prone,false);a.pin(i,-14,-8,0);
      window.__NT.stations[v.name]={pos:[-14+v.dx,v.y,-8+v.dz],yaw:Math.atan2(v.dx,v.dz),pitch:-Math.atan2(v.y-v.targetY,Math.hypot(v.dx,v.dz)),fov:v.fov,ref:null,note:'Operator material inspection, fixed close cameras'};
      window.__NT.goto(v.name);window.__NT.weaponCmd('visible',false);
    },[subject,v]);
    await page.waitForTimeout(650);
    for(let i=0;i<5;i++)await measureFrame(page);
    const stats=await measureFrame(page);
    await page.screenshot({path:join(out,v.name+'.png')});
    const pose=await page.evaluate(i=>({state:window.__NTANIM.list()[i],surface:window.__NTANIM.surface(i),ticks:window.__NTANIM.ticks()}),subject);
    result.frames.push({name:v.name,stats,pose});
  }
  const prone=result.frames.find(f=>f.name==='prone-carry')?.pose;
  result.pass=!result.errors.length&&result.frames.length===3&&result.frames.every(f=>sceneWasMeasured(f.stats)&&f.stats.calls<=1200&&f.stats.triangles<=900000&&f.pose.ticks.n>0&&!f.pose.ticks.error)&&prone?.state.loco==='prone-idle'&&prone.surface.surfaceTop<=.52;
}catch(e){result.fatal=String(e);result.pass=false;}
finally{writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));await owned.close();}
console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
