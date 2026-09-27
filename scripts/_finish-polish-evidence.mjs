/** Read-only evidence assembly except the named project receipt. No browser/OS input. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
const identity=json('dist-polish/preview-identity.json');
assert.equal(git('branch','--show-current'),'salvage/full-game-20260926');
assert.equal(git('remote','get-url','origin'),'https://github.com/daveinturkey15-byte/atomic-acres.git');
assert.equal(git('diff','--name-only',identity.sourceCommit,'HEAD','--','src','public','index.html','package.json','package-lock.json','vite.config.ts'),'','served runtime inputs unchanged by later QA/docs commits');
assert.deepEqual(await(await fetch('http://127.0.0.1:4362/preview-identity.json')).json(),identity);
const runtimeReadback=[];
for(const e of identity.runtimeEntries){
  const bytes=Buffer.from(await(await fetch('http://127.0.0.1:4362/'+e.path)).arrayBuffer());
  assert.equal(bytes.length,e.bytes);assert.equal(hash(bytes),e.sha256);
  runtimeReadback.push({...e,state:'VERIFIED actual HTTP bytes'});
}
const fallbackReadback=[];
for(const [port,expected] of [[4361,'ec8eba38613dcbe9e171b064fae831ad925433a3'],[4348,'2f837ae3d53cc1d7c3a78610e1276ab085a271cb']]){
  const base=`http://127.0.0.1:${port}/`,id=await(await fetch(base+'preview-identity.json')).json();
  assert.equal(id.sourceCommit,expected);
  const bytes=Buffer.from(await(await fetch(base+id.entry)).arrayBuffer());assert.equal(hash(bytes),id.entrySha256);
  fallbackReadback.push({port,sourceCommit:id.sourceCommit,entry:id.entry,entrySha256:id.entrySha256,state:'VERIFIED retained HTTP identity/entry'});
}
const gateDir='captures/polish-gates-20260927';
const gates=readdirSync(gateDir).filter(p=>p.endsWith('.json')).map(p=>({receipt:gateDir+'/'+p,...json(gateDir+'/'+p)}));
const latest={};
for(const r of gates.sort((a,b)=>a.at.localeCompare(b.at))) if(r.sourceCommit===identity.sourceCommit) latest[r.name]=r;
const proof=(p,summarize)=>existsSync(p)?{path:p,sha256:hash(readFileSync(p)),...summarize(json(p))}:{path:p,state:'OPEN not run'};
const reports={
  composition:proof('captures/polish-composition/result.json',r=>({checks:r.checks.map(c=>({name:c.name,pass:c.pass,data:c.pass?undefined:c.data})),errorCount:r.errors.length,fatal:r.fatal,state:'FAILED: two desktop setup/Deploy visibility checks plus ambiguous post-reload MP5 locator'})),
  menu:proof('captures/salvage-browser-menu.json',r=>({checks:r.checks,errorCount:r.errors.length,streaks:r.ledger.slots.map(s=>s.streakId)})),
  playcap:proof('captures/polish-20260927-summary.json',r=>({threshold:r.threshold,results:r.results,errorCount:r.errors.length})),
  baseline:proof('captures/polish-material-baseline-20260927-summary.json',r=>({query:r.url,results:r.results,errorCount:r.errors.length})),
  net:proof('captures/net-two-browsers.json',r=>({seconds:r.seconds,delaySdpMs:r.delaySdpMs,steps:r.steps,errorCount:Array.isArray(r.errors)?r.errors.length:Object.values(r.errors).reduce((n,v)=>n+v.length,0),earlyIce:r.qaEarlyIce})),
  rejoin:proof('captures/polish-rejoin.json',r=>({status:r.status,steps:r.steps.map(s=>s.name),errorCount:r.errors.length,failure:r.failure})),
  soak:proof('captures/leak/polish-20260927-soak.json',r=>({seconds:r.seconds,limits:r.limits,fails:r.fails,frames:r.frames,elapsed:r.elapsed,pageRafFps:r.frames/r.elapsed,framePerformanceState:r.frames/r.elapsed>=30?'at least30 page rAF/s; real game-frame/performance acceptance separate':'OPEN below30 page rAF/s; original gate uses multi-pass render.calls and cannot establish30gameFPS',js:r.js,proc:r.proc,procMono:r.procMono,samples:r.rows.length,first:r.rows[0],last:r.rows.at(-1)})),
};
const pixels=[];
for(const folder of ['captures/polish-68f3f35-menu','captures'])for(const name of readdirSync(folder).filter(p=>p.endsWith('.png')&&(folder.includes('-menu')||p.startsWith('polish-20260927-')||p.startsWith('polish-material-baseline-')))){
  const path=folder+'/'+name;pixels.push({path,sha256:hash(readFileSync(path))});
}
const motion=['captures/polish-motion-video-20260927','captures/polish-motion-video-20260927-repair1','captures/polish-motion-video-20260927-repair2'].map(dir=>proof(dir+'/report.json',r=>({status:r.status,failure:r.failure,elapsedMs:r.elapsedMs,errorCount:r.errors.length,sourceCommit:r.sourceCommit})));
assert(motion.every(r=>r.status==='FAIL'),'failed motion gates must remain failed');
const required=['menu','playcap','traverse','net','rejoin','soak'];
const acceptance=required.map(name=>({name,sourceCommit:identity.sourceCommit,state:latest[name]?.state??'OPEN not run on final build',receipt:latest[name]?.receipt}));
assert.equal(reports.menu.errorCount,0);
assert.equal(reports.menu.streaks.length,5);
assert(reports.playcap.results.every(r=>r.ok&&r.luma>=40&&r.calls<1200&&r.tris<900000));
assert.equal(reports.playcap.errorCount,0);
assert.equal(reports.net.seconds,120);assert.equal(reports.net.delaySdpMs,500);
assert(reports.net.steps.every(s=>s.ok));assert.equal(reports.net.errorCount,0);
assert.equal(reports.rejoin.status,'PASS');assert.equal(reports.rejoin.errorCount,0);
assert.equal(reports.soak.seconds,210);assert.equal(reports.soak.fails.length,0);
const traversal=readFileSync(latest.traverse.receipt.replace(/\.json$/,'.log'),'utf8');
assert(traversal.includes('5/5 routes passed;  4/4 house faces enterable')&&traversal.includes('backend=webgpu runtimeErrors=0'));
for(const a of acceptance)a.state=a.name==='soak'?'VERIFIED original memory/liveness verdict PASS;30FPS/performance remains OPEN':'VERIFIED reviewed actual local gate PASS';
const receipt={schemaVersion:1,project:'atomic-acres',checkedAt:new Date().toISOString(),sourceCommit:identity.sourceCommit,gitHead:git('rev-parse','HEAD'),previewUrl:'http://localhost:4362/?preview='+identity.sourceCommit.slice(0,7),identity,runtimeReadback,fallbackReadback,exactBuildManifest:`captures/builds/polish-candidate-${identity.sourceCommit.slice(0,7)}-manifest.json`,latestGates:latest,acceptance,reports,pixels,motion,open:['Strict short-motion capture failed initial plus2repairs; no automatic retry','Full contact/settled ADS/third-person temporal and owner art acceptance','Physical LAN/WAN, native owner browser and sustained60FPS target','Matched model/prompt/resource readiness for new generated assets','H3 original source-video location'],claimState:'VERIFIED exact source/build/HTTP and individually reviewed receipts; isolated owner-review canary, no production/full-art acceptance'};
writeFileSync('docs/evidence/POLISH-2026-09-27.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({sourceCommit:receipt.sourceCommit,httpChunks:runtimeReadback.length,retainedFallbacks:fallbackReadback.length,acceptance,failedMotion:motion.length,receipt:'docs/evidence/POLISH-2026-09-27.json'}));
