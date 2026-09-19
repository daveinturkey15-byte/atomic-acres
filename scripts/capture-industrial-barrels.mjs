import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';
const out = join(process.cwd(), 'captures', 'industrial-barrels');
mkdirSync(out, { recursive: true });
const result = { errors: [], frames: [] };
const owned = await stockBrowser('industrial-barrels');
try {
  const { page } = owned;
  page.on('pageerror', e => result.errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') result.errors.push(e.text()); });
  await page.goto('http://127.0.0.1:4192/?tod=noon&weather=clear', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });
  await page.addStyleTag({ content: '#start,#hud,#crosshair{display:none!important}' });
  result.module = await page.evaluate(() => window.__NT.moduleStats['industrial-barrels']);
  if (result.module?.colliders !== 4) throw new Error('four loaded barrels and colliders required');
  for (const [name,x,z] of [['white-east',11.6,34.8],['white-west',-10.8,31.8],['orange-east',11.3,-33],['orange-west',-10.6,-34.2]]) {
    const at = await page.evaluate(([name,x,z]) => {
      const dx=x>0?-1.5:1.5, dz=z>0?-1.8:1.8;
      window.__NT.stations[name]={pos:[x+dx,1.35,z+dz],yaw:Math.atan2(dx,dz),pitch:-Math.atan2(.7,Math.hypot(dx,dz)),fov:60,ref:null,note:'asset/collision canary'};
      window.__NT.goto(name);
      return window.__NT.collidersAt(x,z,.6);
    },[name,x,z]);
    for(let i=0;i<6;i++){await measureFrame(page);await page.waitForTimeout(60);}
    const stats=await measureFrame(page);
    await page.screenshot({path:join(out,name+'.png')});
    result.frames.push({name,stats,colliders:at});
  }
  result.pass=result.frames.length===4&&result.frames.every(f=>sceneWasMeasured(f.stats)&&f.stats.calls<=1200&&f.stats.triangles<=900000&&f.colliders.some(c=>c.owner==='industrial-barrels'))&&!result.errors.length;
} catch(e){result.fatal=String(e);result.pass=false;}
finally{writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));await owned.close();}
console.log(JSON.stringify(result,null,2));
if(!result.pass)process.exitCode=1;
