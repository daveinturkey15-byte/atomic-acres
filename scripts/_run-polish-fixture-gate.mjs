/** Explicit four→five-slot fixture reconciliation; original gates stay untouched.
 * Only the owner-requested reference suite/slot test data changes. All other
 * assertions, thresholds, transport, timing, health and cleanup remain exact. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const name = process.argv[2];
assert(['menu','rejoin'].includes(name));
const original = resolve(`scripts/${name==='menu'?'_verify-salvage-browser-menu':'_verify-salvage-net-rejoin'}.mjs`);
const raw = readFileSync(original,'utf8');
const hash = x => createHash('sha256').update(x).digest('hex');
const changes = name==='menu' ? [
  ["getByLabel('Killstreak slot 3',{exact:true}).selectOption('supply-crate')", "getByLabel('Killstreak slot 3',{exact:true}).selectOption('carpet-bomber')"],
  ["getByLabel('Killstreak slot 4',{exact:true}).selectOption('strike-relay')", "getByLabel('Killstreak slot 4',{exact:true}).selectOption('chopper')"],
  ["['tracker-dart','signal-jam','supply-crate','strike-relay']", "['tracker-dart','piloted-drone','carpet-bomber','chopper','drone-swarm']"],
  ["'4chosen streaks admitted'", "'5chosen reference-suite streaks admitted'"],
] : [
  ['s.streakNames.length === 4', 's.streakNames.length === 5'],
  ["'all four streak HUD slots did not arrive'", "'all five streak HUD slots did not arrive'"],
  ["'real menu class and four streak choices admitted over WebRTC'", "'real menu class and five streak choices admitted over WebRTC'"],
];
let source = raw;
for (const [before,after] of changes) {
  assert.equal(source.split(before).length-1,1,'one exact fixture replacement: '+before);
  source = source.replace(before,after);
}
const assertionCount = s => (s.match(/\bassert\./g)??[]).length;
assert.equal(assertionCount(source),assertionCount(raw),'all original assertion calls retained');
if(name==='menu') {
  source=source.replace("const primary=", "assert.equal(await page.locator('.aa-streak-select').count(),5,'all five visible suite selectors');\n  const primary=");
  source=source.replace("await page.getByRole('button',{name:'Play solo',exact:true}).click();", `
  assert.equal(await page.locator('#crosshair').evaluate(e=>getComputedStyle(e).visibility),'hidden','pre-match crosshair hidden');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'home390 no horizontal overflow');
  assert(await page.evaluate(()=>{const s=document.getElementById('start'),r=s.querySelector('.aa-root');return s.scrollWidth<=s.clientWidth+1&&r.scrollWidth<=r.clientWidth+1;}),'home390 internal panel has no horizontal overflow');
  await page.screenshot({path:'captures/polish-home-390.png'});report.screens.push('polish-home-390.png');
  await page.setViewportSize({width:1600,height:900});
  await page.getByRole('button',{name:'Play solo',exact:true}).click();`);
  source=source.replace("report.checks.push(", `
  assert.equal(await page.locator('#crosshair').evaluate(e=>getComputedStyle(e).visibility),'visible','active crosshair restored');
  assert.equal(await page.locator('.hud-ammo').evaluate(e=>e.classList.contains('hud-low')),false,'full Magnum magazine has normal colour');
  report.checks.push('home390 no horizontal overflow','pre-match crosshair hidden and active restored','full Magnum normal ammo colour');
  report.checks.push(`);
}
const adaptedHash = hash(source);
// Keep each imported library's own import.meta.url and the original gate ROOT.
source=source.replaceAll('import.meta.url',JSON.stringify(pathToFileURL(original).href))
  .replace(/from (['"])(\.\/lib\/[^'"]+)\1/g,(_m,_q,p)=>'from '+JSON.stringify(pathToFileURL(resolve('scripts',p)).href));
const out=resolve('captures/polish-fixtures-20260927');mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,name+'-original.mjs'),raw);
writeFileSync(resolve(out,name+'-receipt.json'),JSON.stringify({original,originalSha256:hash(raw),adaptedSha256:adaptedHash,changes,originalAssertionCalls:assertionCount(raw),adaptedAssertionCalls:assertionCount(source),additionalMenuChecks:name==='menu'?['five selectors','prematch crosshair','mobile home overflow','active crosshair restored','full Magnum colour']:[],state:'five-slot fixture plus stricter presentation checks; all original assertions retained; actual result separate'},null,2));
const target=resolve(out,name+'-adapted.mjs');writeFileSync(target,source);
await import(pathToFileURL(target).href);
