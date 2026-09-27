/** Admit one existing frozen gate against the isolated polish build. No OS input. */
import { execFileSync } from 'node:child_process';
import { freemem } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnGuarded, cleanupAll } from './lib/proc-guard.mjs';

const gates = {
  menu: ['scripts/_run-polish-fixture-gate.mjs', 'menu'],
  motion: ['scripts/_capture-polish-loop.mjs', 'captures/polish-motion-video-20260927-repair2'],
  composition: ['scripts/ui/verify-menu-composition.mjs'],
  playcap: ['scripts/playcap.mjs', '--tag', 'polish-20260927'],
  baseline: ['scripts/playcap.mjs', '--tag', 'polish-material-baseline-20260927', '--query', 'surface-finish=off&weapon-fx=off'],
  traverse: ['scripts/traverse.mjs'],
  net: ['scripts/_verify-net-two-browsers.mjs', '--seconds', '120', '--delay-sdp-ms', '500', '--signal-port', '4316'],
  rejoin: ['scripts/_run-polish-fixture-gate.mjs', 'rejoin', '--url', 'http://127.0.0.1:4362/', '--tag', 'polish-rejoin'],
  soak: ['scripts/soak.mjs', '--seconds', '210', '--tag', 'polish-20260927'],
};
const name = process.argv[2];
if (!Object.hasOwn(gates, name)) throw Error('Choose one frozen polish gate');
const pass = JSON.parse(readFileSync('docs/handoff/CURRENT.json', 'utf8')).polishPass20260927;
const used = (Date.now() - Date.parse(pass.startedAt)) / 1000;
if (used + 600 > pass.maxWorkSeconds) throw Error('Insufficient admitted pass time for bounded gate');
const gpuFreeMiB = Number(execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true }).trim().split('\n')[0]);
const ramGiB = freemem() / 2 ** 30;
const receipt = { name, at: new Date().toISOString(), gpuFreeMiB, ramGiB, requiredGpuMiB: 4096, requiredRamGiB: 12, state: 'HELD', elapsedPassSeconds: used };
const out = 'captures/polish-gates-20260927';
mkdirSync(out, { recursive: true });
const dest = `${out}/${name}-${Date.now()}`;
if (!(gpuFreeMiB >= 4096 && ramGiB >= 12)) {
  writeFileSync(dest + '.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt)); process.exit(2);
}
const identity = await (await fetch('http://127.0.0.1:4362/preview-identity.json')).json();
const local = JSON.parse(readFileSync('dist-polish/preview-identity.json', 'utf8'));
if (identity.sourceCommit !== local.sourceCommit || identity.entrySha256 !== local.entrySha256) throw Error('Candidate HTTP identity mismatch');
receipt.sourceCommit = identity.sourceCommit;
receipt.state = 'ADMITTED';
writeFileSync(dest + '.json', JSON.stringify(receipt, null, 2));
const args = gates[name].slice();
if (name === 'rejoin') args.push('--expected-commit', identity.sourceCommit);
const child = spawnGuarded(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AA_PREVIEW_PORT: '4362', RECOVERY_URL: 'http://127.0.0.1:4362/', QA_TAG: 'polish-composition' } });
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => appendFileSync(dest + '.log', bytes));
const timeout = setTimeout(() => { receipt.state = 'FAILED_BUDGET_600S'; writeFileSync(dest+'.json', JSON.stringify(receipt,null,2)); cleanupAll(); process.exit(2); }, 600000);
child.on('exit', code => { clearTimeout(timeout); receipt.state = code === 0 ? 'EXIT_0_REQUIRES_REPORT_REVIEW' : 'FAILED'; receipt.exitCode = code; receipt.finishedAt = new Date().toISOString(); writeFileSync(dest+'.json', JSON.stringify(receipt,null,2)); cleanupAll(); console.log(JSON.stringify(receipt)); process.exit(code ?? 2); });
