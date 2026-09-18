/**
 * Static guard: no new direct render of the world scene.
 *
 * On three r180's WebGPURenderer, NodeMaterial reads renderer.getMRT() when a shader is
 * BUILT, but the material cache key does not include the MRT. So whichever code path
 * renders the world scene FIRST fixes every material's output count for the session.
 * One "harmless" `renderer.render(scene, camera)` before the post chain's first frame
 * compiles single-output shaders, WebGPU then silently refuses the chain's
 * four-attachment pipeline, and the world goes black - with no exception and nothing in
 * the console. That is exactly what shipped to the owner on 2026-09-18.
 *
 * playcap.mjs catches the SYMPTOM, but only when someone runs it. This catches the
 * CAUSE at check time: every `renderer.render(` of a scene in src/ must be on the
 * allow-list below, with a reason. Adding a new one means editing this list on purpose,
 * with the rule in front of you.
 *
 *   node scripts/check-render-sites.mjs        (wired into `npm run check`)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** file -> reasons. A site is allowed only if its file is listed AND the line's
 *  surrounding text matches one of the reasons (a substring that must appear on the
 *  same line or the two lines above it). */
const ALLOW = {
  'src/core/post.ts': [
    'direct-render fallback',            // buildPost's enabled:false path when the chain cannot build
    'falling back to direct',            // chainBroken: chain threw at render, degrade once
    'renderer.render(scene, camera)',    // the doc comment at the top of the file
  ],
  'src/core/world.ts': [
    'bootFailed',                        // no backend initialised at all: last-ditch pixels
    'however harmless it looks',         // the rule, stated in a comment
  ],
  'src/characters/demo.ts': [
    'renderer.render(scene, camera)',    // standalone demo page with its own renderer + scene, never the world
  ],
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // a render of a SCENE (not the viewmodel overlay, which is its own single-output pass)
    if (!/renderer\.render\(/.test(line)) return;
    if (/overlay/.test(line)) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // a comment that mentions it is not a call
    const ctx = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
    const reasons = ALLOW[rel] || [];
    const ok = reasons.some((r) => ctx.includes(r));
    if (!ok) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

if (offenders.length) {
  console.error('[check-render-sites] direct scene render(s) not on the allow-list:');
  for (const o of offenders) console.error('  ' + o);
  console.error('\nA direct render before the post chain\'s first frame poisons the shader cache');
  console.error('and blacks out the world on WebGPU. Route through world.render(), or add the');
  console.error('site to ALLOW in scripts/check-render-sites.mjs with its reason.');
  process.exit(1);
}
console.log('[check-render-sites] OK - every direct scene render is on the allow-list');
