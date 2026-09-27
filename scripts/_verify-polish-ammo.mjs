/** Execute the actual HUD setter: capacity switches, full small mags, cache and legacy fallback. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
const path = 'src/ui/hud.ts';
async function setter(source) {
  const body = source.match(/setAmmo\(mag: number, reserve: number(?:, capacity\?: number)?\): void \{([\s\S]*?)\n    },/)[1];
  const { code } = await transform(`
    export function create() {
      let cMag=-1,cRes=-1,cCapacity=-1,cLowAmmo=false;
      const LOW_AMMO=5,ASSUMED_MAG=30;
      const n={mag:{textContent:''},reserve:{textContent:''},ammo:{classList:{toggle(_,low){ n.low=low; n.toggles++; }}},low:false,toggles:0};
      return { n, setAmmo(mag:number,reserve:number,capacity?:number){${body}} };
    }`, { loader:'ts', format:'esm' });
  return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).create();
}
const current = await setter(readFileSync(path,'utf8'));
const old = await setter(execFileSync('git',['show','c2be8ba:'+path],{encoding:'utf8',windowsHide:true}));
old.setAmmo(6,36,6); assert.equal(old.n.low,true,'negative control reproduces full Magnum warning');
for (const capacity of [1,2,5,6,8,12,20,30,40,50,100]) {
  current.setAmmo(capacity,36,capacity); assert.equal(current.n.low,false,`full ${capacity}-round magazine`);
  current.setAmmo(0,36,capacity); assert.equal(current.n.low,true,'empty warning');
}
current.setAmmo(6,36,6); assert.equal(current.n.low,false);
current.setAmmo(6,36,30); assert.equal(current.n.low,true,'same counts but changed weapon capacity updates warning');
current.setAmmo(6,36,6); assert.equal(current.n.low,false);
const before=current.n.toggles; current.setAmmo(6,36,6); assert.equal(current.n.toggles,before,'unchanged cache writes nothing');
current.setAmmo(1,36,6); assert.equal(current.n.low,true);
current.setAmmo(2,36,6); assert.equal(current.n.low,false);
current.setAmmo(6,36); assert.equal(current.n.low,true,'two-argument fallback preserved');
console.log('PASS actual HUD ammo setter: full/empty 11 capacities, switch cache, Magnum boundary, old failure and legacy fallback');
