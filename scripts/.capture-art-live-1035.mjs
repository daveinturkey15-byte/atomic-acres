import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';
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


const label=process.env.ART_LABEL||'before';
const url=process.env.RECOVERY_URL;
const out=join(process.cwd(),'captures','art-live-1035',label);mkdirSync(out,{recursive:true});
const result={url,label,errors:[],actions:[],frames:[],claim:'Real Play solo / Deploy and released player camera; screenshots from natural game frame, no __NT.render measurement.'};
const owned=await stockBrowser('art-live-1035');
try{
const {page}=owned;page.on('pageerror',e=>result.errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')result.errors.push(e.text())});
await page.goto(url,{waitUntil:'load',timeout:90000});await page.waitForFunction(()=>window.__NT?.ready,null,{timeout:90000});await enterSolo(page,result);
result.identity=await page.evaluate(()=>({scripts:[...document.scripts].map(x=>x.src).filter(Boolean),backend:window.__NT_BACKEND,colliders:window.__NT.colliderCount}));
for(const name of ['yardWhite','yardOrange','plaza','aerial']){
const station=await page.evaluate(n=>{const q=window.__NT,s=q.stations[n];q.goto(n);q.release();q.setMode('noclip');q.teleport(s.pos[0],s.pos[1]-q.stats().eyeHeight,s.pos[2],s.yaw,s.pitch);return s;},name);
await page.waitForTimeout(1000);
const samples=await page.evaluate(async()=>{const values=[];for(let i=0;i<12;i++){await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));values.push(window.__NT.stats());}return values;});
const pose=await page.evaluate(()=>window.__NT.playerPose());
await page.screenshot({path:join(out,name+'.png')});
result.frames.push({name,station,pose,samples});
}
result.pass=result.errors.length===0&&result.identity.colliders===652&&result.frames.every(f=>f.samples.every(s=>s.calls>2&&s.triangles>2&&s.calls<=1200&&s.triangles<=900000)&&Math.abs(f.pose.camY-f.station.pos[1])<.02&&Math.abs(f.pose.camX-f.station.pos[0])<.02&&Math.abs(f.pose.camZ-f.station.pos[2])<.02&&f.samples.at(-1).renderCallsTotal>f.samples[0].renderCallsTotal);
}catch(e){result.fatal=String(e);result.pass=false;}finally{writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));await owned.close();}
console.log(JSON.stringify({pass:result.pass,fatal:result.fatal,errors:result.errors,frames:result.frames.map(f=>({name:f.name,calls:f.samples.at(-1).calls,triangles:f.samples.at(-1).triangles,pose:f.pose}))}));if(!result.pass)process.exitCode=1;
