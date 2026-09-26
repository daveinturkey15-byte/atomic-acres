/**
 * Node driver for the headless loopback proof. No browser:
 *   node scripts/_verify-net-proof.mjs [seed]
 * The wrapper resolves the extensionless TypeScript imports as Vite does.
 * Virtual clock, deterministic per seed.
 * Structural failures exit non-zero; the numbers always print regardless.
 */
import { formatProofReport, runLoopbackProof } from './proof';

declare const process: { argv: string[]; exit(code: number): never };

const seed = process.argv[2] ?? 'nuketown-netcode-1';
const report = runLoopbackProof({ seed });
console.log(formatProofReport(report));

const failures: string[] = [];
if (report.liveBefore !== 0 || report.liveAfter !== 0) failures.push('room-leak');
if (!report.guestInterpolationOk) failures.push('interp-fail');
if (report.ticksExchanged < 2400) failures.push('short-run');
if (report.inputsRejectedCheat < 1) failures.push('cheat-not-rejected');
if (!Number.isFinite(report.ageP50) || !Number.isFinite(report.ageP95)) failures.push('no-age-samples');
if (report.finalDivergenceM > 1.0) failures.push('diverged');

if (failures.length > 0) {
  console.error('[net-proof] FAIL: ' + failures.join(','));
  process.exit(1);
}
console.log('[net-proof] PASS');
