/** Art-only captures of admitted menu kits; no fabricated inventory, damage or streak charges. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { stockBrowser } from './lib/stock-browser.mjs';
import { usePreview } from './lib/preview.mjs';
import { waitForRenderedPage } from './lib/render-ready.mjs';
const {url}=await usePreview();
const owned=await stockBrowser('reference-models'),{page}=owned;
const errors=[],report={url,status:'OPEN',images:[],rows:[]};
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
mkdirSync('captures',{recursive:true});
try {
  await page.goto(url,{waitUntil:'load',timeout:90000});await waitForRenderedPage(page);
  report.identity=await page.evaluate(async()=>await(await fetch('./preview-identity.json')).json());
  await page.waitForFunction(()=>Object.keys(window.__NT.weaponCmd('state').referenceModels??{}).length===3,null,{timeout:30000});
  await page.getByRole('button',{name:'Play solo',exact:true}).click();
  const primaries=page.getByRole('group',{name:'Primary weapon',exact:true});
  await primaries.getByRole('button',{name:/^Mini Uzi\b/i}).click();
  await page.getByRole('button',{name:'Magnum',exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.aa-weapon-art img')).every(i=>i.complete&&i.naturalWidth>0),null,{timeout:30000});
  await page.screenshot({path:'captures/salvage-reference-menu.png'});report.images.push('salvage-reference-menu.png');
  await page.getByRole('button',{name:'Deploy',exact:true}).click();
  await page.waitForFunction(()=>{try{return window.__NTGAME.snapshot().match.phase==='active'}catch{return false}},null,{timeout:30000});
  const initial=await page.evaluate(()=>window.__NTGAME.snapshot().actors.find(a=>a.id===window.__NTGAME.localId));
  assert.equal(initial.primaryId,'mini-uzi');assert.equal(initial.sidearmId,'magnum');
  await page.evaluate(()=>window.__NT.teleport(-6,0,0,-Math.PI/2));
  for(const [id,key] of [['mini-uzi','Digit1'],['magnum','Digit2']]) {
    await page.keyboard.press(key);await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>window.__NT.weaponCmd('state').id),id);
    for(const pose of ['hip','ads']) {
      if(pose==='ads')await page.evaluate(()=>window.__NT.weaponCmd('ads',true));
      await page.waitForTimeout(350);
      const path=`salvage-reference-${id}-${pose}.png`;await page.screenshot({path:'captures/'+path});report.images.push(path);
      report.rows.push({id,pose,state:await page.evaluate(()=>window.__NT.weaponCmd('state')),stats:await page.evaluate(()=>window.__NT.stats())});
    }
    await page.evaluate(()=>window.__NT.weaponCmd('ads',false));
  }
  assert.equal(errors.length,0,errors.join('\n'));report.status='PASS';
  console.log('PASS reference thumbnail decode and admitted Mini Uzi/Magnum hip+ADS captures; Minigun appearance remains OPEN');
}finally{report.errors=errors;writeFileSync('captures/salvage-reference-models.json',JSON.stringify(report,null,2));await owned.close();}
