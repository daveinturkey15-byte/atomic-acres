// Run AFTER root's bounded Blender bake. CPU only, root consolidator is read-only.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../nuketown-recovery-20260919');
const { consolidateGlb } = await import(pathToFileURL(resolve(root, 'work/coach-batch-0712/tools/lib/consolidate.mjs')));
const { parseGlb, readImage } = await import(pathToFileURL(resolve(root, 'work/coach-batch-0712/tools/lib/glb.mjs')));
const source = resolve(process.argv[2] ?? resolve(here, 'coach-geometry-0824.glb'));
const output = resolve(here, 'coach-geometry-0824.consolidated.glb');
const bytes = readFileSync(source);
const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const result = consolidateGlb(input, { padMissingUv: true, deadlineMs: 20000 });
try {
  const bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  for (const g of result.geometries) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) for (let a = 0; a < 3; a++) {
      const v = p.array[i * 3 + a]; assert.ok(Number.isFinite(v));
      assert.ok(v >= [-5.8, 0, -1.435][a] - 1e-5 && v <= [5.8, 3.4, 1.435][a] + 1e-5,
        `GLB vertex outside unchanged collider envelope: axis ${a}, coordinate ${v}`);
      bounds[0][a] = Math.min(bounds[0][a], v); bounds[1][a] = Math.max(bounds[1][a], v);
    }
  }
  const cpu = JSON.parse(readFileSync(resolve(here, 'geometry-check.json'), 'utf8'));
  for (let b = 0; b < 2; b++) for (let a = 0; a < 3; a++) assert.ok(Math.abs(bounds[b][a] - cpu.bounds[b][a]) < 0.0001);
  assert.equal(result.report.source.triangles, cpu.triangles);
  assert.equal(result.report.output.triangles, cpu.triangles);
  assert.ok(result.report.output.triangles <= 12000);
  assert.equal(result.gltf.meshes.length, 6); assert.equal(result.gltf.materials.length, 6);
  assert.equal(result.gltf.images.length, 3);
  const parsed = parseGlb(result.glb);
  for (let i = 0; i < parsed.gltf.images.length; i++) {
    const data = readImage(parsed.gltf, parsed.bin, parsed.gltf.images[i]);
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
    assert.equal(buffer.readUInt32BE(16), 1024); assert.equal(buffer.readUInt32BE(20), 1024);
  }
  const out = Buffer.from(result.glb);
  assert.equal(out.length, out.readUInt32LE(8));
  JSON.parse(new TextDecoder().decode(out.subarray(20, 20 + out.readUInt32LE(12))));
  writeFileSync(output, out);
  const report = { status: 'BAKED_GLB_CPU_PASS_GPU_OPEN', source, output, bounds,
    sha256: createHash('sha256').update(out).digest('hex'), ...result.report };
  writeFileSync(resolve(here, 'consolidated-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { for (const geometry of result.geometries) geometry.dispose(); }
