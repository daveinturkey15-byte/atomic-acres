/** Mechanical fixture adapter for admission contract 2. The original verifier
 * remains byte-exact; no assertion, group, timing or threshold is changed.
 * CPU only. Retains original/adapted sources, substitutions and execution output. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const originalPath = join(root, 'scripts/_verify-overnight-weapon-state-wire.mjs');
const expectedOriginalSha256 = '60076d70b998ea93bd50c41d9df0c1109ff8a11680e130a968ee5f567c0716fd';
const hash = value => createHash('sha256').update(value).digest('hex');
const originalBytes = readFileSync(originalPath);
assert.equal(hash(originalBytes), expectedOriginalSha256, 'Original verifier drift: inspect before adapting');
const original = originalBytes.toString('utf8');
const substitutions = [
  {
    reason: 'Retained scratch copy must resolve the same live project root.',
    before: "const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');",
    after: `const root = ${JSON.stringify(root)};`,
  },
  {
    reason: 'Current contract 2 is valid; old contract 1 and wrong contract 3 must both be rejected.',
    before: "for (const capability of [undefined, 0, 2, '1', { version: 1 }])",
    after: "for (const capability of [undefined, 0, 1, 3, '1', { version: 1 }])",
  },
  {
    reason: 'Guest rejection fixtures likewise retain legacy 1 and unknown 3 as invalid.',
    before: "for (const capability of [undefined, 2, '1'])",
    after: "for (const capability of [undefined, 1, 3, '1'])",
  },
  {
    reason: 'A terminally rejected guest must stay rejected even after a valid current welcome.',
    before: "t.receive('legacy-host', { ...welcome, weaponStateProtocol: 1 }); assert.equal(guest.getState(), 'rejected');",
    after: "t.receive('legacy-host', { ...welcome, weaponStateProtocol: 2 }); assert.equal(guest.getState(), 'rejected');",
  },
];
let adapted = original;
for (const substitution of substitutions) {
  assert.equal(adapted.split(substitution.before).length - 1, 1, 'Expected exactly one substitution: ' + substitution.reason);
  adapted = adapted.replace(substitution.before, substitution.after);
}
let restored = adapted;
for (const { before, after } of [...substitutions].reverse()) {
  assert.equal(restored.split(after).length - 1, 1, 'Adapter reversal must be unambiguous');
  restored = restored.replace(after, before);
}
assert.equal(restored, original, 'Only the declared substitutions may differ');
assert.equal((adapted.match(/\bcheck\('/g) ?? []).length, 17, 'All 17 original groups are required');
assert.equal((adapted.match(/\bassert(?:\.|\()/g) ?? []).length,
  (original.match(/\bassert(?:\.|\()/g) ?? []).length, 'Assertion count must stay unchanged');

const tag = new Date().toISOString().replace(/[:.]/g, '-');
const retained = join(root, 'captures', 'openpass-wire-contract-' + tag);
assert(!existsSync(retained), 'Refuse to overwrite an existing receipt');
mkdirSync(retained);
writeFileSync(join(retained, 'original.mjs'), originalBytes, { flag: 'wx' });
const adaptedPath = join(retained, 'adapted.mjs');
writeFileSync(adaptedPath, adapted, { flag: 'wx' });
const receipt = {
  startedAt: new Date().toISOString(), scope: 'CPU fixture adaptation; no runtime or browser acceptance',
  originalPath, originalSha256: expectedOriginalSha256, adaptedSha256: hash(adapted),
  wrapperSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  currentAdmissionContract: 2, originalGroups: 17, substitutions,
  assertionCount: (original.match(/\bassert(?:\.|\()/g) ?? []).length,
  outcome: 'PREPARED',
};
const receiptPath = join(retained, 'receipt.json');
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
const result = spawnSync(process.execPath, [adaptedPath], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
});
writeFileSync(join(retained, 'stdout.txt'), result.stdout ?? '', { flag: 'wx' });
writeFileSync(join(retained, 'stderr.txt'), result.stderr ?? '', { flag: 'wx' });
const originalAfterSha256 = hash(readFileSync(originalPath));
const passes = (result.stdout ?? '').split(/\r?\n/).filter(line => /^PASS /.test(line));
const passed = result.status === 0 && !result.error && passes.length === 18
  && passes.at(-1)?.startsWith('PASS 17 weapon-wire checks:')
  && originalAfterSha256 === expectedOriginalSha256;
Object.assign(receipt, {
  finishedAt: new Date().toISOString(), originalAfterSha256,
  exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
  completedGroups: Math.max(0, passes.length - Number(passes.at(-1)?.startsWith('PASS 17 weapon-wire checks:'))),
  outcome: passed ? 'PASS' : 'FAIL',
});
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
console.log('Retained fixture adaptation: ' + receiptPath);
assert.equal(originalAfterSha256, expectedOriginalSha256, 'Original verifier changed during execution');
assert(passed, 'Adapted verifier failed; retain its failure without further substitutions');
