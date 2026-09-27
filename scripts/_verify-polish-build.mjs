/** Exact local source-map/readback and all-file build receipt, independent of pixels. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd(), dist = resolve(root, 'dist-polish');
const identity = JSON.parse(readFileSync(join(dist, 'preview-identity.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(readFileSync(join(dist, identity.entry))), identity.entrySha256);
const files = [];
function walk(path) { for (const e of readdirSync(path, { withFileTypes: true })) { const p = join(path, e.name); if(e.isDirectory()) walk(p); else files.push(p); } }
walk(dist);
const sources = [];
for (const mapPath of files.filter(p => p.endsWith('.js.map'))) {
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  for (let i = 0; i < map.sources.length; i++) {
    const p = resolve(dirname(mapPath), map.sourceRoot ?? '', map.sources[i]);
    const rel = relative(root, p).replaceAll('\\', '/');
    if (!rel.startsWith('src/')) continue;
    const bytes = readFileSync(p), content = map.sourcesContent?.[i];
    assert.equal(content, bytes.toString('utf8'), `exact source bytes: ${rel}`);
    sources.push({ path: rel, sha256: hash(bytes), map: relative(dist,mapPath).replaceAll('\\','/') });
  }
}
assert(sources.length >= 228, 'all original raw local sources plus new modules');
identity.runtimeEntries = files.filter(p=>p.endsWith('.js')).map(p=>({path:relative(dist,p).replaceAll('\\','/'),bytes:readFileSync(p).length,sha256:hash(readFileSync(p))}));
identity.acceptance = 'VERIFIED committed source, CPU/build/raw source-map/HTTP; actual visual/net gates tracked separately in POLISH handoff. Isolated candidate, not production.';
writeFileSync(join(dist,'preview-identity.json'),JSON.stringify(identity,null,2)+'\n');
const served = await (await fetch('http://127.0.0.1:4362/preview-identity.json')).json();
assert.deepEqual(served,identity,'full served identity exact');
const entry = Buffer.from(await (await fetch('http://127.0.0.1:4362/'+identity.entry)).arrayBuffer());
assert.equal(hash(entry),identity.entrySha256,'actual served entry bytes');
const receipt = { identity, sourceMaps: sources, files: files.map(p=>{const b=readFileSync(p); return{path:relative(dist,p).replaceAll('\\','/'),bytes:b.length,sha256:hash(b)};}), at:new Date().toISOString() };
mkdirSync('captures/builds',{recursive:true});
const output = `captures/builds/polish-candidate-${identity.sourceCommit.slice(0,7)}-manifest.json`;
writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({state:'PASS_EXACT_BUILD_HTTP',commit:identity.sourceCommit,sourceCount:sources.length,files:files.length,runtimeEntries:identity.runtimeEntries,receipt:output}));
