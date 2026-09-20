import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';
const ENTRY_TIMEOUT=30000;
function entryRecoveryAction(entry) {
  if (entry.matchMode && entry.matchMode !== 'idle') {
    if (entry.surface === 'hidden') return 'pause';
    if (entry.surface === 'paused-match' || entry.surface === 'match-over') return 'leave';
  }
  if (entry.surface === 'pre-match' && entry.panel && entry.panel !== 'main') return 'back';
  return null;
}
async function enterSolo(page, result) {
  result.entryTrace = [];
  const inspect = async label => {
    const entry = await page.evaluate(() => {
      const overlay = document.getElementById('start');
      const menu = window.__AA_UI?.menu;
      return { t: performance.now(), surface: menu?.state?.().surface ?? null,
        panel: menu?.panel?.() ?? null, matchMode: window.__NTGAME?.mode?.() ?? null,
        overlay: overlay ? { display: getComputedStyle(overlay).display, visibility: getComputedStyle(overlay).visibility, rects: overlay.getClientRects().length } : null,
        visibleButtons: [...document.querySelectorAll('#start button')]
          .filter(b => b.getClientRects().length > 0 && getComputedStyle(b).visibility === 'visible')
          .map(b => b.textContent?.trim()).filter(Boolean) };
    });
    result.entryTrace.push({ label, ...entry }); return entry;
  };
  try {
    // An entry state is observed before choosing any recovery action. Returning
    // via the real menu preserves the same Play solo -> Deploy route for both modes.
    for (let attempt = 0; attempt < 3; attempt++) {
      const entry = await inspect(`entry-${attempt}`), action = entryRecoveryAction(entry);
      if (!action) break;
      result.actions.push({ action: `entry-${action}`, t: entry.t });
      if (action === 'leave') {
        await page.getByRole('button', { name: 'Leave match', exact: true }).click({ timeout: ENTRY_TIMEOUT });
        await page.waitForFunction(() => window.__NTGAME?.mode?.() === 'idle', null, { timeout: ENTRY_TIMEOUT });
      } else {
        await page.keyboard.press('Escape');
        await page.waitForFunction(previous => {
          const m = window.__AA_UI?.menu;
          return m?.state?.().surface !== previous.surface || m?.panel?.() !== previous.panel;
        }, { surface: entry.surface, panel: entry.panel }, { timeout: ENTRY_TIMEOUT });
      }
    }
    const solo = page.getByRole('button', { name: 'Play solo', exact: true });
    await solo.waitFor({ state: 'visible', timeout: ENTRY_TIMEOUT });
    await inspect('before-play-solo'); await solo.click({ timeout: ENTRY_TIMEOUT });
    const deploy = page.getByRole('button', { name: 'Deploy', exact: true });
    await deploy.waitFor({ state: 'visible', timeout: ENTRY_TIMEOUT });
    await inspect('before-deploy'); await deploy.click({ timeout: ENTRY_TIMEOUT });
    await page.waitForFunction(() => {
      try { return window.__NTGAME?.snapshot?.().match?.phase === 'active' && window.__NT?.weaponCmd?.('state')?.visible === true; }
      catch { return false; }
    }, null, { timeout: 45_000 });
    await inspect('deployed');
  } catch (error) {
    try { await inspect('entry-failed'); } catch { /* Preserve the original entry error. */ }
    throw error;
  }
}

const out=join(process.cwd(),'captures','operator-live-1038',process.env.OPERATOR_LABEL);
mkdirSync(out,{recursive:true});
const result={errors:[],frames:[],actions:[],assets:[],claim:'Actual game frame with released player camera and staged operator input; not multiplayer movement proof'};
const owned=await stockBrowser('operator-close');
try{
  const {page}=owned;
  const assetTasks=[];
  page.on('response',res=>{if(res.url().includes('/assets/operators/')&&res.url().endsWith('.glb'))assetTasks.push(res.body().then(b=>result.assets.push({url:res.url(),status:res.status(),bytes:b.length})));});
  page.on('pageerror',e=>result.errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')result.errors.push(e.text());});
  await page.goto(process.env.RECOVERY_URL,{waitUntil:'load',timeout:90000});
  await page.waitForFunction(()=>window.__NT?.ready,null,{timeout:90000});
  await enterSolo(page,result);
  await Promise.all(assetTasks);
  result.operator=await page.evaluate(()=>window.__NTOPERATOR.status());
  if(!result.operator.loaded || !result.assets.some(a=>a.url.endsWith(process.env.OPERATOR_LABEL!=='before'?'operator-sand-export-final2-muse-1030.glb':'operator-sand.glb')))throw Error('Expected actual authored GLB not loaded');
  await page.waitForFunction(()=>{try{return window.__NTANIM?.ready&&window.__NTGAME?.snapshot?.().match?.phase==='active';}catch{return false;}},null,{timeout:45000});
  await page.addStyleTag({content:'#hud,#crosshair{display:none!important}'});
  const subject=await page.evaluate(()=>{
    const a=window.__NTANIM,i=a.spawn(-14,-8,0,0)-1;
    a.solo(i);a.pin(i,-14,-8,0);a.drive(i,0,false,false,false);a.selfTick(false);return i;
  });
  for(const v of [
    {name:'three-quarter',dx:.65,dz:1.9,y:1.35,targetY:.9,fov:65},
    {name:'cloth-close',dx:.35,dz:1.15,y:1.32,targetY:1.12,fov:50},
    {name:'crouch',dx:.65,dz:1.9,y:1.2,targetY:.65,fov:65,crouch:true},
    {name:'walk',dx:.65,dz:1.9,y:1.35,targetY:.9,fov:65,speed:3},
    {name:'prone-carry',dx:1.9,dz:.4,y:.85,targetY:.4,fov:65,prone:true},
  ]){
    await page.evaluate(([i,v])=>{
      const a=window.__NTANIM;a.drive(i,v.speed||0,!!v.crouch,!!v.prone,false);a.pin(i,-14,-8,0);
      window.__NT.stations[v.name]={pos:[-14+v.dx,v.y,-8+v.dz],yaw:Math.atan2(v.dx,v.dz),pitch:-Math.atan2(v.y-v.targetY,Math.hypot(v.dx,v.dz)),fov:v.fov,ref:null,note:'Operator material inspection, fixed close cameras'};
      const q=window.__NT,s=q.stations[v.name];q.goto(v.name);q.release();q.setMode('noclip');q.teleport(s.pos[0],s.pos[1]-q.stats().eyeHeight,s.pos[2],s.yaw,s.pitch);q.weaponCmd('visible',false);
    },[subject,v]);
    await page.waitForTimeout(650);
    const stats=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));const s=window.__NT.stats();return {...s,renders:s.renderCallsTotal};});
    await page.screenshot({path:join(out,v.name+'.png')});
    const pose=await page.evaluate(i=>({state:window.__NTANIM.list()[i],surface:window.__NTANIM.surface(i),ticks:window.__NTANIM.ticks()}),subject);
    result.frames.push({name:v.name,stats,pose});
  }
  const prone=result.frames.find(f=>f.name==='prone-carry')?.pose;
  result.pass=!result.errors.length&&result.frames.length===5&&result.frames.every(f=>sceneWasMeasured(f.stats)&&f.stats.calls<=1200&&f.stats.triangles<=900000&&!f.pose.ticks.error)&&prone?.state.loco==='prone-idle'&&prone.surface.surfaceTop<=.52;
}catch(e){result.fatal=String(e);result.pass=false;}
finally{writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));await owned.close();}
console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;

