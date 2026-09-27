/** Preserve original handoff/budget values exactly; account this fresh pass only. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const path='docs/handoff/CURRENT.json';
const current=JSON.parse(readFileSync(path,'utf8'));
const retained=JSON.parse(execFileSync('git',['show','b9adb96:docs/handoff/CURRENT.json'],{encoding:'utf8',windowsHide:true}));
const pass=current.polishPass20260927;
if(!pass) throw Error('Missing existing polish pass');
const now=new Date();
const elapsed=Math.ceil((now-Date.parse(pass.startedAt))/1000);
if(!(elapsed>=0)) throw Error('Invalid original start time');
pass.workSecondsUsed=Math.max(pass.workSecondsUsed,elapsed);
pass.lastAccountedAt=now.toISOString();
if(process.argv.includes('--close')) {
  pass.state='closed bounded polish; isolated owner-review canary; menu fit, motion and performance OPEN';
  pass.workSecondsUsed=Math.max(pass.workSecondsUsed,Math.min(pass.maxWorkSeconds,elapsed+60));
  pass.completedAt=now.toISOString();
  pass.finalDeliveryReserveSeconds=60;
  pass.sourceCommit='68f3f35a7d729c28e101bd6fa41d9e9111c8bf1e';
  pass.previewUrl='http://localhost:4362/?preview=68f3f35';
  pass.handoff='docs/handoff/POLISH-2026-09-27.md';
  pass.evidence='docs/evidence/POLISH-2026-09-27.json';
  pass.server={pid:43972,createdAt:'2026-09-27T15:47:55.052128+01:00',managedExecSession:70106,ownership:'Root-owned HTTP preview only; source writers frozen, all browser/GPU acceptance jobs ended'};
  pass.acceptance='VERIFIED menu/deploy, five streak slots, traversal, local two-browser delayed-SDP/rejoin and original210s memory/liveness verdict. OPEN desktop loadout fit, strict clip after initial+2repairs,15.48pageRAF/s performance, physical LAN/WAN and owner art acceptance.';
  pass.activeRun=null;
  pass.promotion='Review canary only; retained4361/4348/4188 fallback channels; no production promotion';
  pass.accounting='Cumulative elapsed admitted pass including agents/browser waits plus60s delivery reserve; no old-ledger reset';
}
retained.polishPass20260927=pass;
writeFileSync(path,JSON.stringify(retained,null,2)+'\n');
console.log(JSON.stringify({used:pass.workSecondsUsed,remaining:pass.maxWorkSeconds-pass.workSecondsUsed,oldBudgets:[retained.overnightBudget.workSecondsUsed,retained.openPass20260927.workSecondsUsed,retained.loadingFix20260927.workSecondsUsed]}));
