/**
 * _heapdiff - attribute heap growth to a constructor, then to a retainer path.
 *
 * A .heapsnapshot is JSON: snapshot.meta describes the flat `nodes` and `edges` arrays.
 * Node ids are STABLE across snapshots of the same page, so the honest question is not
 * "which constructor got bigger" (that moves with ordinary churn) but "which objects
 * are in the late snapshot, were NOT in the early one, and are still reachable after a
 * forced GC". Those are the leak. This groups exactly that set by constructor.
 *
 *   node --max-old-space-size=8192 scripts/_heapdiff.mjs A.heapsnapshot B.heapsnapshot
 *   node --max-old-space-size=8192 scripts/_heapdiff.mjs A B --retain "Float32Array" --paths 3
 */
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const opt = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const retainName = opt('retain', '');
const nPaths = Number(opt('paths', '2'));
const topN = Number(opt('top', '25'));
if (files.length < 2) { console.error('usage: _heapdiff.mjs <early.heapsnapshot> <late.heapsnapshot>'); process.exit(2); }

function load(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const meta = j.snapshot.meta;
  return {
    nodes: j.nodes, edges: j.edges, strings: j.strings,
    nf: meta.node_fields.length, ef: meta.edge_fields.length,
    nodeTypes: meta.node_types[0], edgeTypes: meta.edge_types[0],
    F: Object.fromEntries(meta.node_fields.map((k, i) => [k, i])),
    E: Object.fromEntries(meta.edge_fields.map((k, i) => [k, i])),
    count: j.snapshot.node_count,
  };
}

// ---- pass 1: every node id alive in the EARLY snapshot
const a = load(files[0]);
let maxId = 0;
for (let i = 0, o = a.F.id; i < a.count; i++, o += a.nf) if (a.nodes[o] > maxId) maxId = a.nodes[o];
const early = new Uint8Array(maxId + 2);
for (let i = 0, o = a.F.id; i < a.count; i++, o += a.nf) early[a.nodes[o]] = 1;
const earlyCount = a.count;
console.log(`[heapdiff] early ${files[0]}: ${earlyCount} nodes`);

// ---- pass 2: the LATE snapshot, split into "was there" and "arrived since"
const b = load(files[1]);
console.log(`[heapdiff] late  ${files[1]}: ${b.count} nodes`);

const label = (i) => {
  const o = i * b.nf;
  const t = b.nodeTypes[b.nodes[o + b.F.type]];
  const name = b.strings[b.nodes[o + b.F.name]];
  if (t === 'object' || t === 'native' || t === 'closure') return (t === 'closure' ? 'closure ' : '') + (name || '(anonymous)');
  return `(${t})` + (t === 'array' && name ? ' ' + name : '');
};

const groups = new Map();
const newNodes = [];
for (let i = 0; i < b.count; i++) {
  const o = i * b.nf;
  const id = b.nodes[o + b.F.id];
  if (id <= maxId && early[id]) continue;     // survived from before: not this leak
  const key = label(i);
  let g = groups.get(key);
  if (!g) { groups.set(key, g = { key, count: 0, self: 0, first: i }); }
  g.count++; g.self += b.nodes[o + b.F.self_size];
  newNodes.push(i);
}

const rows = [...groups.values()].sort((x, y) => y.self - x.self);
const totalSelf = rows.reduce((s, r) => s + r.self, 0);
console.log(`\n  objects present at LATE and absent at EARLY: ${newNodes.length} nodes, ${(totalSelf / 1048576).toFixed(2)} MB self size\n`);
console.log('    selfMB    count  constructor');
for (const r of rows.slice(0, topN)) {
  console.log(`  ${(r.self / 1048576).toFixed(3).padStart(8)}  ${String(r.count).padStart(7)}  ${r.key}`);
}

// ---- which closure IS it? Four different `onDispose` functions exist in three.js.
// The variables a closure captured name it uniquely, so dump its Context scope.
const ctxName = opt('ctx', '');
if (ctxName) {
  const firstEdgeC = new Int32Array(b.count + 1);
  for (let i = 0, o = b.F.edge_count; i < b.count; i++, o += b.nf) firstEdgeC[i + 1] = firstEdgeC[i] + b.nodes[o];
  const out = (i) => {
    const r = [];
    for (let e = firstEdgeC[i]; e < firstEdgeC[i + 1]; e++) {
      const o = e * b.ef;
      const t = b.edgeTypes[b.edges[o + b.E.type]];
      const n = b.edges[o + b.E.name_or_index];
      const to = b.edges[o + b.E.to_node] / b.nf;
      r.push({ t, name: (t === 'element' || t === 'hidden') ? String(n) : b.strings[n], to });
    }
    return r;
  };
  const hits = newNodes.filter((i) => label(i) === ctxName);
  console.log(`\n[heapdiff] scope of "${ctxName}" (${hits.length} new instances) - sampling 2`);
  for (const h of hits.slice(0, 2)) {
    console.log(`  closure #${b.nodes[h * b.nf + b.F.id]}`);
    for (const e of out(h)) {
      console.log(`    ${e.t} .${e.name} -> ${label(e.to)}`);
      if (e.name === 'context' || e.t === 'context') {
        for (const c of out(e.to)) console.log(`        ${c.t} .${c.name} -> ${label(c.to)}`);
      }
    }
  }
}

// ---- retainer paths. Build a reverse (retainer) CSR over the late snapshot's edges.
const fatMin = Number(opt('fat', '0'));
if (retainName || fatMin) {
  const firstEdge = new Int32Array(b.count + 1);
  for (let i = 0, o = b.F.edge_count; i < b.count; i++, o += b.nf) firstEdge[i + 1] = firstEdge[i] + b.nodes[o];
  const nEdges = firstEdge[b.count];
  const toNode = new Int32Array(nEdges);
  for (let e = 0; e < nEdges; e++) toNode[e] = b.edges[e * b.ef + b.E.to_node] / b.nf;

  const indeg = new Int32Array(b.count + 1);
  for (let e = 0; e < nEdges; e++) indeg[toNode[e] + 1]++;
  for (let i = 0; i < b.count; i++) indeg[i + 1] += indeg[i];
  const rStart = indeg;                              // now a prefix-sum offset table
  const rFrom = new Int32Array(nEdges);
  const rEdge = new Int32Array(nEdges);
  const fill = new Int32Array(b.count);
  for (let i = 0; i < b.count; i++) {
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e++) {
      const t = toNode[e];
      const slot = rStart[t] + fill[t]++;
      rFrom[slot] = i; rEdge[slot] = e;
    }
  }

  const edgeLabel = (e) => {
    const t = b.edgeTypes[b.edges[e * b.ef + b.E.type]];
    const n = b.edges[e * b.ef + b.E.name_or_index];
    return t === 'element' || t === 'hidden' ? `${t}[${n}]` : `${t} .${b.strings[n]}`;
  };

  let targets = [];
  if (fatMin) {
    // Who is ACCUMULATING listeners? Walk every object's ._listeners.<type> array and
    // report the ones whose element count is absurd - that is the leak's victim, and
    // its retainer path names the subsystem that owns it.
    const outEdges = (i) => {
      const r = [];
      for (let e = firstEdge[i]; e < firstEdge[i + 1]; e++) {
        const o = e * b.ef;
        const t = b.edgeTypes[b.edges[o + b.E.type]];
        const n = b.edges[o + b.E.name_or_index];
        r.push({ t, name: (t === 'element' || t === 'hidden') ? String(n) : b.strings[n], to: toNode[e] });
      }
      return r;
    };
    const fat = [];
    for (let i = 0; i < b.count; i++) {
      for (const e of outEdges(i)) {
        if (e.name !== '_listeners') continue;
        for (const k of outEdges(e.to)) {
          const len = firstEdge[k.to + 1] - firstEdge[k.to];
          if (len >= fatMin) fat.push({ owner: i, type: k.name, len });
        }
      }
    }
    fat.sort((x, y) => y.len - x.len);
    console.log(`\n[heapdiff] objects whose _listeners.<type> array exceeds ${fatMin} entries`);
    for (const f of fat.slice(0, 10)) {
      const nm = outEdges(f.owner).find((e) => e.name === 'name');
      console.log(`  ${String(f.len).padStart(6)}  ${label(f.owner)}.${f.type}   name="${nm ? label(nm.to).replace(/^\(string\)$/, b.strings[b.nodes[nm.to * b.nf + b.F.name]]) : ''}"`);
    }
    targets = fat.slice(0, nPaths).map((f) => f.owner);
  } else {
    targets = newNodes.filter((i) => label(i) === retainName || label(i).includes(retainName));
    // Prefer the biggest instances - a leak's payload is usually the large one.
    targets.sort((x, y) => b.nodes[y * b.nf + b.F.self_size] - b.nodes[x * b.nf + b.F.self_size]);
    targets = targets.slice(0, nPaths);
  }
  console.log(`\n[heapdiff] retainer paths (${targets.length})`);
  for (const target of targets) {
    // BFS backwards to node 0 (the synthetic root) so the path is the SHORTEST one.
    const prev = new Int32Array(b.count).fill(-1);
    const via = new Int32Array(b.count).fill(-1);
    const seen = new Uint8Array(b.count);
    const q = [target]; seen[target] = 1;
    let found = -1;
    for (let h = 0; h < q.length && found < 0; h++) {
      const cur = q[h];
      for (let s = rStart[cur]; s < rStart[cur + 1]; s++) {
        const from = rFrom[s];
        if (seen[from]) continue;
        seen[from] = 1; prev[from] = cur; via[from] = rEdge[s];
        if (from === 0) { found = from; break; }
        q.push(from);
      }
    }
    const selfKB = (b.nodes[target * b.nf + b.F.self_size] / 1024).toFixed(1);
    console.log(`\n  --- instance #${b.nodes[target * b.nf + b.F.id]}  self ${selfKB} kB  (${label(target)})`);
    if (found < 0) { console.log('    (no path to root - unreachable at snapshot time)'); continue; }
    let n = 0;
    for (let cur = 0; cur !== target && n < 40; cur = prev[cur], n++) {
      console.log(`    ${label(cur)}  --${edgeLabel(via[cur])}-->`);
    }
    console.log(`    ${label(target)}`);
  }
}
