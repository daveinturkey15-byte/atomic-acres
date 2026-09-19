/**
 * _heapregs - how many DISTINCT objects registered the listeners piling up on one
 * texture? The answer decides whether de-duplicating them is correct or arbitrary:
 * if N registrants produced M >> N entries, the extra entries are duplicates that
 * upstream failed to remove, and removing them restores the intended state.
 *
 *   node --max-old-space-size=8192 scripts/_heapregs.mjs <snapshot> "UnrealBloomPass.h0"
 */
import { readFileSync } from 'node:fs';

const [file, wanted = 'UnrealBloomPass.h0'] = process.argv.slice(2);
const j = JSON.parse(readFileSync(file, 'utf8'));
const meta = j.snapshot.meta;
const nf = meta.node_fields.length, ef = meta.edge_fields.length;
const F = Object.fromEntries(meta.node_fields.map((k, i) => [k, i]));
const E = Object.fromEntries(meta.edge_fields.map((k, i) => [k, i]));
const { nodes, edges, strings } = j;
const count = j.snapshot.node_count;
const types = meta.node_types[0], etypes = meta.edge_types[0];

const firstEdge = new Int32Array(count + 1);
for (let i = 0, o = F.edge_count; i < count; i++, o += nf) firstEdge[i + 1] = firstEdge[i] + nodes[o];
const label = (i) => {
  const t = types[nodes[i * nf + F.type]];
  const n = strings[nodes[i * nf + F.name]];
  return t === 'object' || t === 'native' || t === 'closure' ? (n || '(anon)') : `(${t})`;
};
const out = (i) => {
  const r = [];
  for (let e = firstEdge[i]; e < firstEdge[i + 1]; e++) {
    const o = e * ef;
    const t = etypes[edges[o + E.type]];
    const n = edges[o + E.name_or_index];
    r.push({ t, name: (t === 'element' || t === 'hidden') ? String(n) : strings[n], to: edges[o + E.to_node] / nf });
  }
  return r;
};

// find the Texture whose `name` property is the wanted string
let tex = -1;
for (let i = 0; i < count && tex < 0; i++) {
  // Do NOT filter on the constructor label: in a minified build `Texture` is a
  // one-letter name. The texture's `name` STRING literal survives minification.
  for (const e of out(i)) {
    if (e.name === 'name' && strings[nodes[e.to * nf + F.name]] === wanted) { tex = i; break; }
  }
}
if (tex < 0) { console.error('texture not found: ' + wanted); process.exit(1); }

const listeners = out(tex).find((e) => e.name === '_listeners');
const arr = out(listeners.to).find((e) => e.name === 'dispose');
const entries = out(arr.to).filter((e) => e.t === 'element');
console.log(`${wanted}: ${entries.length} dispose listeners`);

const registrants = new Map();   // node id of the captured `this` -> count
let noThis = 0;
for (const e of entries) {
  const ctx = out(e.to).find((x) => x.name === 'context');
  if (!ctx) { noThis++; continue; }
  const self = out(ctx.to).find((x) => x.t === 'context' && x.name === 'this');
  if (!self) { noThis++; continue; }
  const id = nodes[self.to * nf + F.id];
  const key = id + ' ' + label(self.to);
  registrants.set(key, (registrants.get(key) ?? 0) + 1);
}
console.log(`distinct registrants (closure's captured \`this\`): ${registrants.size}   (unattributed ${noThis})`);
for (const [k, v] of [...registrants].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(v).padStart(6)} duplicate registrations  <- ${k}`);
}
