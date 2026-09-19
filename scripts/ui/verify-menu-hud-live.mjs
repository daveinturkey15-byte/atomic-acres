import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from '../lib/stock-browser.mjs';

const url = process.env.RECOVERY_URL || 'http://127.0.0.1:4192/';
const out = join(process.cwd(), 'captures', process.env.QA_TAG || 'menu-hud-k');
mkdirSync(out, { recursive: true });
const result = { url, checks: [], errors: [] };
const check = (name, pass, data) => result.checks.push({name,pass,data});
const owned = await stockBrowser('menu-hud');
const { page } = owned;
page.on('pageerror', e => result.errors.push(String(e)));
page.on('console', m => { if(m.type()==='error') result.errors.push(m.text()); });
const ready = () => page.waitForFunction(() => window.__NT?.ready, null, {timeout:90000});
try {
  await page.goto(url, {waitUntil:'load',timeout:90000}); await ready();
  for (const [width,height] of [[1920,1080],[1280,720],[2560,1080],[390,844]]) {
    await page.setViewportSize({width,height});
    const bounds = await page.evaluate(() => {
      const root=document.querySelector('#start .aa-root');
      const cards=[...document.querySelectorAll('#start .aa-map')];
      return {scrollWidth:root.scrollWidth,clientWidth:root.clientWidth,
        cards:cards.map(c=>{const r=c.getBoundingClientRect();return {left:r.left,right:r.right};}),
        images:[...document.querySelectorAll('.aa-map-hero')].map(i=>i.complete&&i.naturalWidth>0)};
    });
    check(`Menu ${width} no horizontal overflow and preview loaded`, bounds.scrollWidth<=bounds.clientWidth+1 && bounds.cards.every(r=>r.left>=0&&r.right<=width) && bounds.images.every(Boolean),bounds);
    await page.screenshot({path:join(out,`menu-${width}.png`)});
  }
  await page.setViewportSize({width:1600,height:900});
  await page.getByRole('button',{name:'Options',exact:true}).click();
  await page.keyboard.press('Tab');
  check('Keyboard focus remains visible',await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle!=='none'));
  await page.screenshot({path:join(out,'options.png')});
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Play solo',exact:true}).click();
  await page.screenshot({path:join(out,'solo.png')});
  await page.getByRole('button',{name:/deploy/i}).click();
  await page.waitForFunction(()=>window.__NTGAME.snapshot().match.phase==='active',null,{timeout:45000});
  await page.evaluate(()=>{window.__NT.teleport(1.2,0,34.3,0,0);window.__NT.release();});
  await page.waitForTimeout(600);
  for(const [width,height] of [[1600,900],[1280,720],[390,844]]) {
    await page.setViewportSize({width,height});
    const rects = await page.evaluate(()=>{
      const box=s=>{const e=document.querySelector(s);const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
      return {weapon:box('.hud-weapon'),ammo:box('.hud-ammo'),equipment:box('.hud-grenades'),health:box('.hud-health'),streak:box('.hud-streak'),minimap:box('.hud-minimap'),match:box('.hud-matchbar')};
    });
    const overlap=(a,b)=>Math.min(a.right,b.right)>Math.max(a.x,b.x)&&Math.min(a.bottom,b.bottom)>Math.max(a.y,b.y);
    check(`HUD ${width} equipment/weapon/ammo separated`,!overlap(rects.weapon,rects.ammo)&&!overlap(rects.weapon,rects.equipment)&&!overlap(rects.ammo,rects.equipment),rects);
    check(`HUD ${width} minimap and score separated`,!overlap(rects.minimap,rects.match));
    check(`HUD ${width} streak and corner readouts separated`,!overlap(rects.streak,rects.health)&&!overlap(rects.streak,rects.ammo)&&!overlap(rects.streak,rects.equipment));
    await page.screenshot({path:join(out,`play-${width}.png`)});
  }
  await page.setViewportSize({width:1600,height:900});
  await page.keyboard.down('Tab');
  await page.screenshot({path:join(out,'scoreboard.png')});
  await page.keyboard.up('Tab');
  // Layout stress fixture only; explicitly not a gameplay-result assertion.
  await page.evaluate(()=>{
    window.__NTGAME.leave();
    document.querySelector('#start').style.display='none';
    const score=document.querySelector('.hud-score');score.classList.remove('hud-score-hidden');
    score.innerHTML='<div class="hud-score-title">LAYOUT FIXTURE</div>'+Array.from({length:9},(_,i)=>'<div class="hud-score-row"><span>Operator '+i+'</span><span>10</span><span>2</span><span>90</span></div>').join('');
    const banner=document.querySelector('.hud-banner');banner.classList.remove('hud-hidden');banner.innerHTML='<div class="hud-banner-text">MATCH OVER</div><div class="hud-banner-sub">LAYOUT FIXTURE</div>';
  });
  for(const [width,height] of [[1600,900],[390,600]]) {
    await page.setViewportSize({width,height});
    const layout=await page.evaluate(()=>{const r=document.querySelector('.hud-score').getBoundingClientRect();const b=document.querySelector('.hud-banner').getBoundingClientRect();return {score:{left:r.left,right:r.right,bottom:r.bottom},banner:{top:b.top}};});
    check(`Score/banner stress ${width} contained and separated`,layout.score.left>=0&&layout.score.right<=width&&layout.score.bottom<=layout.banner.top,layout);
    await page.screenshot({path:join(out,`score-stress-${width}.png`)});
  }
  // Broken hero uses the retained schematic, including deployment under subpaths.
  await page.goto(url,{waitUntil:'load'});await ready();
  await page.evaluate(()=>document.querySelector('.aa-map-hero').dispatchEvent(new Event('error')));
  check('Image error restores visible map schematic',await page.locator('.aa-thumb-fallback .aa-thumb').isVisible());
  check('No browser errors',result.errors.length===0,result.errors);
} catch(error) {result.fatal=String(error);process.exitCode=1;}
finally {writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));await owned.close();}
console.log(JSON.stringify(result,null,2));
if(result.fatal||result.checks.some(c=>!c.pass))process.exitCode=1;
