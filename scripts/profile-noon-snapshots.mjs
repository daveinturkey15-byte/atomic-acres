import { writeFileSync, mkdirSync } from 'node:fs';
import { stockBrowser } from './lib/stock-browser.mjs';
const url=process.argv[2]; if(!url)throw new Error('exact URL required');
const owned=await stockBrowser('noon-heap');
mkdirSync('captures/single-astra-noon/heap',{recursive:true});
try {
 const {page}=owned;
 await page.goto(url,{waitUntil:'load',timeout:90000});
 await page.waitForFunction(()=>window.__NT?.ready,null,{timeout:90000});
 await page.getByRole('button',{name:'Play solo',exact:true}).click();
 await page.getByRole('button',{name:'Deploy',exact:true}).click();
 await page.waitForFunction(()=>window.__NTGAME?.snapshot?.().match?.phase==='active');
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('HeapProfiler.enable');
 await page.waitForTimeout(30000);
 await cdp.send('HeapProfiler.collectGarbage');
 const start=await cdp.send('Runtime.getHeapUsage');
 async function snap(name){const chunks=[];const on=p=>chunks.push(p.chunk);cdp.on('HeapProfiler.addHeapSnapshotChunk',on);await cdp.send('HeapProfiler.takeHeapSnapshot');cdp.off('HeapProfiler.addHeapSnapshotChunk',on);writeFileSync('captures/single-astra-noon/heap/'+name+'.heapsnapshot',chunks.join(''));}
 await snap('at30');
 await cdp.send('HeapProfiler.startSampling',{samplingInterval:8192});
 await page.waitForTimeout(60000);
 await snap('at90');
 await cdp.send('HeapProfiler.collectGarbage');
 const end=await cdp.send('Runtime.getHeapUsage');
 const {profile}=await cdp.send('HeapProfiler.stopSampling');
 const rows=[];
 function walk(n,parents=[]) {if(n.selfSize)rows.push({bytes:n.selfSize,frame:n.callFrame,parents:parents.slice(-4)});for(const c of n.children)walk(c,[...parents,n.callFrame]);}
 walk(profile.head);rows.sort((a,b)=>b.bytes-a.bytes);
 const result={url,start,end,top:rows.slice(0,35),game:await page.evaluate(()=>({stats:window.__NT.stats(),counters:window.__NTGAME.counters()}))};
 writeFileSync('captures/single-astra-noon/heap/profile-snapshots.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({startMB:start.usedSize/1048576,endMB:end.usedSize/1048576,top:rows.slice(0,8)}));
}finally{await owned.close()}
