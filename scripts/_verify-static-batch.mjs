/**
 * _verify-static-batch - the silent-skip falsifier for src/core/static-batch.ts.
 *
 * WHY. The batcher is correct on the vehicle fleet, and that is the problem: none
 * of its dangerous cases occurs there, so every one of them is a trap armed for
 * the next lane. A Light under a batched root used to be DELETED by the
 * empty-group prune; a `visible === false` part would have been merged and shown;
 * an InstancedMesh's `instanceColor` would have been dropped on expansion; and a
 * mirrored (negative-determinant) placement would have been baked with reversed
 * winding and rendered inside-out. Every one of those produces a plausible-looking
 * scene and no error.
 *
 * WHAT THIS DOES. It bundles the REAL module with esbuild (already a vite
 * dependency; no install), builds one small scene that contains every hazard next
 * to four ordinary mergeable boxes, runs `batchStatic` and asserts that
 *   - each hazardous object is still in the tree, with its parent, its data and
 *     its geometry intact (a dispose listener on every one proves nothing was
 *     freed under it),
 *   - the batcher still did its job on the ordinary boxes (four meshes -> one),
 *   - the only node it removed is the Group it emptied itself; a Group that was
 *     already empty before it ran survives,
 *   - each hazard is counted in `report.left` and named in `report.hazards`,
 *   - and the whole thing THROWS under `import.meta.env.DEV` with every object's
 *     name and reason in the message, after the tree is already correct.
 *
 * IT ALSO PROVES THE HAZARDS ARE REAL, not theoretical: it applies the OLD prune
 * predicate to the finished tree and lists what that rule would have deleted, and
 * it bakes the mirrored matrix into a throwaway geometry and measures the triangle
 * winding reversing. Without those two controls the assertions above could pass on
 * a batcher that does nothing at all.
 *
 * Runs the module twice, once bundled with DEV=false and once with DEV=true, and
 * requires the scene assertions to hold on BOTH - the throwing path must leave the
 * same correct tree behind.
 *
 *   node scripts/_verify-static-batch.mjs
 *   node scripts/_verify-static-batch.mjs --json
 *
 * Exit 0 only if every assertion holds.
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_OUT = process.argv.includes('--json');

// The scene, in TypeScript, compiled against the real module. Kept as a string so
// the whole falsifier is ONE file and nothing stale can be left on disk beside it.
// No backticks and no dollar-brace in here - this is a template literal.
const ENTRY = `
import * as THREE from 'three';
import { batchStatic } from '../src/core/static-batch';

export function run() {
  const root = new THREE.Group();
  root.name = 'testRoot';
  const paint = new THREE.MeshStandardMaterial({ color: 0x808080 });

  // --- ORDINARY WORK. Four same-material boxes in a child group, so the batcher
  // has something real to merge and a group of its own to empty.
  const consumedGroup = new THREE.Group();
  consumedGroup.name = 'consumedGroup';
  root.add(consumedGroup);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint);
    m.name = 'plain-' + i;
    m.position.set(i * 2, 0, 0);
    consumedGroup.add(m);
  }

  // --- A Group that was ALREADY empty before the batcher arrived. It did not
  // empty this one, so it does not get to judge it.
  const preEmptyGroup = new THREE.Group();
  preEmptyGroup.name = 'preEmptyGroup';
  root.add(preEmptyGroup);

  // --- HAZARD 1: things that are neither Mesh nor Group. The old prune removed
  // ANY childless non-Mesh, so every one of these vanished without a word.
  const lightHolder = new THREE.Group();
  lightHolder.name = 'lightHolder';
  root.add(lightHolder);
  const light = new THREE.PointLight(0xffeedd, 3, 10);
  light.name = 'key-light';
  light.position.set(1, 2, 3);
  lightHolder.add(light);

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff0000 }));
  sprite.name = 'decal-sprite';
  root.add(sprite);

  const ptsGeo = new THREE.BufferGeometry();
  ptsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 3, 0]), 3));
  const points = new THREE.Points(ptsGeo, new THREE.PointsMaterial());
  points.name = 'dust-points';
  root.add(points);

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial());
  line.name = 'guide-line';
  root.add(line);

  const bone = new THREE.Bone();
  bone.name = 'stray-bone';
  root.add(bone);

  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  cam.name = 'rig-camera';
  root.add(cam);

  // --- HAZARD 2: switched off. One mesh off directly, one visible mesh under a
  // group that is off - the second is the one a per-mesh test would miss.
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint);
  hidden.name = 'debug-only';
  hidden.visible = false;
  hidden.position.set(0, 5, 0);
  root.add(hidden);

  const hiddenGroup = new THREE.Group();
  hiddenGroup.name = 'hiddenGroup';
  hiddenGroup.visible = false;
  root.add(hiddenGroup);
  const underHidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint);
  underHidden.name = 'under-hidden';
  underHidden.position.set(2, 5, 0);
  hiddenGroup.add(underHidden);

  // --- HAZARD 3: per-instance colour. Same material and attribute set as the
  // plain boxes, so without the guard these three WOULD join that merge.
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), paint, 3);
  im.name = 'coloured-instances';
  const wantColours = [];
  for (let i = 0; i < 3; i++) {
    im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, 1, 0));
    const c = new THREE.Color(i / 3, 1 - i / 3, 0.5);
    im.setColorAt(i, c);
    // instanceColor is a Float32 buffer, so the readback is the fround of what
    // went in; comparing the doubles would fail on storage, not on the guard.
    wantColours.push([Math.fround(c.r), Math.fround(c.g), Math.fround(c.b)]);
  }
  im.instanceMatrix.needsUpdate = true;
  root.add(im);

  // --- HAZARD 4: mirrored placement, negative determinant.
  const mirrored = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint);
  mirrored.name = 'mirrored-flank';
  mirrored.position.set(-3, 0, 0);
  mirrored.scale.set(-1, 1, 1);
  root.add(mirrored);

  // Dispose spies. A geometry the batcher freed under an object it claims to have
  // left alone is still a silent corruption.
  const disposed = {};
  const spy = (name, geo) => {
    disposed[name] = false;
    geo.addEventListener('dispose', () => { disposed[name] = true; });
  };
  spy('debug-only', hidden.geometry);
  spy('under-hidden', underHidden.geometry);
  spy('coloured-instances', im.geometry);
  spy('mirrored-flank', mirrored.geometry);
  spy('dust-points', points.geometry);
  spy('guide-line', line.geometry);

  const mirroredGeo = mirrored.geometry;
  const hiddenGeo = hidden.geometry;
  const imGeo = im.geometry;
  const objectsBefore = (() => { let n = 0; root.traverse(() => n++); return n; })();

  // ------------------------------------------------------------------ THE RUN
  let report = null;
  let thrown = null;
  try {
    report = batchStatic(root, 'T');
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }

  // ------------------------------------------------------------- ASSERTIONS
  const inTree = (o: THREE.Object3D): boolean => {
    let p: THREE.Object3D | null = o;
    while (p && p !== root) p = p.parent;
    return p === root;
  };
  const named = (n: string): THREE.Object3D | undefined => root.getObjectByName(n);

  const readColours = [];
  if (im.instanceColor) {
    const c = new THREE.Color();
    for (let i = 0; i < im.count; i++) { im.getColorAt(i, c); readColours.push([c.r, c.g, c.b]); }
  }

  const merged = [];
  root.traverse((o) => { if (o.name.indexOf('T-b') === 0) merged.push(o.name); });
  const mergedTris = (() => {
    const m = named('T-b0') as THREE.Mesh | undefined;
    if (!m || !m.geometry) return -1;
    const g = m.geometry;
    return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  })();

  // CONTROL A: what the OLD prune rule (any childless non-Mesh under root) would
  // have deleted from the finished tree. If this list is empty the hazard is not
  // being demonstrated and the assertions below are vacuous.
  const oldRuleWouldDelete: string[] = [];
  root.traverse((o) => {
    if (o !== root && o.children.length === 0 && !(o as THREE.Mesh).isMesh) {
      oldRuleWouldDelete.push((o.name || '<unnamed>') + ' [' + o.type + ']');
    }
  });

  // CONTROL B: the mirror really does turn the surface inside out. applyMatrix4
  // transforms the STORED normals through the normal matrix but leaves the INDEX
  // ORDER alone, so the two disagree afterwards: the face the winding says is
  // front is the one the normal says is back. Measured as the dot of the
  // winding-derived normal of triangle 0 with its own stored normal - +1 before,
  // -1 after. (Comparing the winding normal to itself is not the test: for a
  // triangle whose normal lies ALONG the mirror axis that dot is +1 and nothing
  // looks wrong.)
  const windingFlip = (() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const agree = (geo: THREE.BufferGeometry) => {
      const p = geo.attributes.position as THREE.BufferAttribute;
      const nAttr = geo.attributes.normal as THREE.BufferAttribute;
      const idx = geo.index;
      const i0 = idx ? idx.getX(0) : 0, i1 = idx ? idx.getX(1) : 1, i2 = idx ? idx.getX(2) : 2;
      const a = new THREE.Vector3().fromBufferAttribute(p, i0);
      const b = new THREE.Vector3().fromBufferAttribute(p, i1);
      const c = new THREE.Vector3().fromBufferAttribute(p, i2);
      const wind = b.sub(a).cross(c.sub(a)).normalize();
      const stored = new THREE.Vector3().fromBufferAttribute(nAttr, i0).normalize();
      return wind.dot(stored);
    };
    const before = agree(g);
    mirrored.updateMatrix();
    g.applyMatrix4(mirrored.matrix);
    const after = agree(g);
    g.dispose();
    return {
      before: +before.toFixed(4),
      after: +after.toFixed(4),
      reversed: before > 0.5 && after < -0.5,
    };
  })();

  let objectsAfter = 0;
  root.traverse(() => objectsAfter++);

  return {
    thrown,
    report,
    objectsBefore,
    objectsAfter,
    merged,
    mergedTris,
    disposed,
    oldRuleWouldDelete,
    windingFlip,
    survives: {
      'key-light': inTree(light) && light.parent === lightHolder
        && named('key-light') === light && light.intensity === 3
        && light.position.x === 1 && light.position.y === 2 && light.position.z === 3,
      lightHolder: inTree(lightHolder) && lightHolder.parent === root,
      'decal-sprite': inTree(sprite) && sprite.parent === root,
      'dust-points': inTree(points) && points.parent === root && points.geometry === ptsGeo,
      'guide-line': inTree(line) && line.parent === root && line.geometry === lineGeo,
      'stray-bone': inTree(bone) && bone.parent === root,
      'rig-camera': inTree(cam) && cam.parent === root,
      preEmptyGroup: inTree(preEmptyGroup) && preEmptyGroup.parent === root
        && preEmptyGroup.children.length === 0,
      'debug-only': inTree(hidden) && hidden.parent === root && hidden.visible === false
        && hidden.geometry === hiddenGeo && hidden.geometry.attributes.position.count === 24,
      hiddenGroup: inTree(hiddenGroup) && hiddenGroup.visible === false
        && hiddenGroup.children.length === 1,
      'under-hidden': inTree(underHidden) && underHidden.parent === hiddenGroup
        && underHidden.visible === true,
      'coloured-instances': inTree(im) && im.parent === root
        && (im as THREE.InstancedMesh).isInstancedMesh === true && im.count === 3
        && im.instanceColor !== null && im.geometry === imGeo,
      'mirrored-flank': inTree(mirrored) && mirrored.parent === root
        && mirrored.geometry === mirroredGeo
        && mirrored.matrix.determinant() < 0,
    },
    colours: { want: wantColours, got: readColours },
    consumedGroupGone: !inTree(consumedGroup) && consumedGroup.parent === null,
  };
}
`;

const outDir = join(tmpdir(), 'aa-verify-static-batch');
mkdirSync(outDir, { recursive: true });

async function runWith(dev) {
  const outfile = join(outDir, 'scene-' + (dev ? 'dev' : 'prod') + '-' + Date.now() + '.mjs');
  await build({
    stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'scene.ts', loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    define: { 'import.meta.env.DEV': dev ? 'true' : 'false' },
    outfile,
    logLevel: 'warning',
  });
  const mod = await import(pathToFileURL(outfile).href);
  return mod.run();
}

const prod = await runWith(false);
const dev = await runWith(true);

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); return cond; };

// ---- controls first: if these do not hold, nothing below means anything.
ok(prod.windingFlip.reversed,
  'CONTROL B: baking the mirror matrix did NOT turn triangle 0 inside out (winding.normal '
  + prod.windingFlip.before + ' -> ' + prod.windingFlip.after
  + '); the mirrored hazard is not being demonstrated.');
for (const want of ['key-light [PointLight]', 'decal-sprite [Sprite]', 'dust-points [Points]',
  'guide-line [Line]', 'stray-bone [Bone]', 'rig-camera [PerspectiveCamera]']) {
  ok(prod.oldRuleWouldDelete.includes(want),
    'CONTROL A: the old prune rule would NOT have deleted ' + want
    + ' - the scene does not reproduce the hazard.');
}
ok(prod.merged.length === 1 && prod.mergedTris === 48,
  'CONTROL C: the batcher did not do its ordinary job (merged=' + JSON.stringify(prod.merged)
  + ', triangles=' + prod.mergedTris + ', expected one mesh of 48).');

// ---- the four guards, on BOTH the returning and the throwing build.
for (const [mode, r] of [['prod', prod], ['dev', dev]]) {
  for (const [name, held] of Object.entries(r.survives)) {
    ok(held, '[' + mode + '] ' + name + ' did not survive the batcher untouched.');
  }
  ok(JSON.stringify(r.colours.want) === JSON.stringify(r.colours.got),
    '[' + mode + '] instanceColor changed: wanted ' + JSON.stringify(r.colours.want)
    + ' got ' + JSON.stringify(r.colours.got));
  for (const [name, gone] of Object.entries(r.disposed)) {
    ok(gone === false, '[' + mode + '] geometry of ' + name + ' was DISPOSED under an object '
      + 'the batcher claims to have left alone.');
  }
  ok(r.consumedGroupGone, '[' + mode + '] the group the batcher emptied was not pruned.');
}

// ---- stats and the dev throw.
ok(prod.thrown === null, 'the non-DEV build threw instead of reporting: ' + prod.thrown);
ok(prod.report !== null, 'the non-DEV build returned no report.');
if (prod.report) {
  const L = prod.report.left;
  for (const [key, want] of [['foreign-object', 6], ['hidden', 2], ['instance-color', 1], ['mirrored', 1]]) {
    ok(L[key] === want, 'report.left[' + key + '] = ' + L[key] + ', expected ' + want);
  }
  ok(prod.report.hazards.length === 10,
    'report.hazards has ' + prod.report.hazards.length + ' entries, expected 10');
  ok(prod.report.groups === 1, 'report.groups = ' + prod.report.groups + ', expected 1');
  ok(prod.report.pruned === 1, 'report.pruned = ' + prod.report.pruned + ', expected 1');
}
ok(typeof dev.thrown === 'string' && dev.thrown.length > 0,
  'the DEV build did NOT throw - a silent skip can still ship.');
if (typeof dev.thrown === 'string') {
  for (const n of ['key-light', 'decal-sprite', 'dust-points', 'guide-line', 'stray-bone',
    'rig-camera', 'debug-only', 'under-hidden', 'coloured-instances', 'mirrored-flank']) {
    ok(dev.thrown.includes(n), 'the DEV throw does not name ' + n);
  }
  for (const reason of ['not a Mesh and not a Group', 'visible=false', 'instanceColor',
    'negative-determinant']) {
    ok(dev.thrown.includes(reason), 'the DEV throw does not give the reason "' + reason + '"');
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ prod, dev, fails }, null, 2));
} else {
  console.log('[static-batch] CONTROL A - objects the OLD prune rule would have deleted from the');
  console.log('              finished tree (each one now survives):');
  for (const n of prod.oldRuleWouldDelete) console.log('                ' + n);
  console.log('[static-batch] CONTROL B - mirror matrix baked into a box: triangle-0 winding vs its'
    + ' own stored normal ' + prod.windingFlip.before + ' -> ' + prod.windingFlip.after
    + ' (inside-out=' + prod.windingFlip.reversed + ')');
  console.log('[static-batch] CONTROL C - ordinary work still done: ' + prod.merged.join(', ')
    + ' carrying ' + prod.mergedTris + ' triangles; objects ' + prod.objectsBefore
    + ' -> ' + prod.objectsAfter);
  console.log('[static-batch] report.left      ' + JSON.stringify(prod.report && prod.report.left));
  console.log('[static-batch] report.groups    ' + (prod.report && prod.report.groups)
    + '   pruned ' + (prod.report && prod.report.pruned));
  console.log('[static-batch] hazards (' + (prod.report ? prod.report.hazards.length : 0) + '):');
  for (const h of (prod.report ? prod.report.hazards : [])) console.log('    ' + h);
  console.log('[static-batch] DEV build threw:  '
    + (dev.thrown ? dev.thrown.split('\n')[0] : 'NOTHING'));
  console.log('[static-batch] survivors (dev/prod both):');
  for (const [name, held] of Object.entries(prod.survives)) {
    console.log('    ' + (held && dev.survives[name] ? 'ok   ' : 'FAIL ') + name);
  }
}

if (fails.length) {
  console.error('\n[static-batch] ' + fails.length + ' ASSERTION(S) FAILED:');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\n[static-batch] all assertions hold: every hazard left untouched, counted, named,'
  + '\n               and thrown on in DEV; the ordinary merge and prune still happen.');
