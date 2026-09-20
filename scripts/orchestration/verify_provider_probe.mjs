// Only for the three reviewed synthetic JSON answers, never arbitrary worker code.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';

const directory = path.resolve(process.argv[2] ?? '.recovery-runtime/pipeline-completion-20260920');
const cases = [0, Math.PI, -Math.PI, 2*Math.PI, -2*Math.PI, 3*Math.PI,
  -3*Math.PI, .2, -.2, NaN, Infinity];
const results = [];
for (const route of ['glm', 'muse', 'agy']) {
  const dir = path.join(directory, route+'-probe-1');
  const raw = fs.readFileSync(path.join(dir, 'answer.txt'));
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json')));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), receipt.answer_sha256);
  const answer = JSON.parse(raw.toString());
  assert.equal(answer.missingEvidence, 'hold');
  for (const x of cases) {
    const result = vm.runInNewContext(`(${answer.wrap})(x)`, {x}, {timeout: 50});
    assert(Number.isFinite(result) && result >= -Math.PI && result < Math.PI);
    const expected = Number.isFinite(x) ? ((x+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI : 0;
    assert(Math.abs(result-expected) < 1e-12);
  }
  results.push({route, passed:true, cases:cases.length, missingEvidence:'hold',
    answer_sha256:receipt.answer_sha256, actual_model:receipt.actual_model,
    scope:'synthetic answer only; not native tooling or game implementation'});
}
console.log(JSON.stringify(results, null, 2));
