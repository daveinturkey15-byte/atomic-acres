/**
 * ONE preview server, shared by every harness in this repo.
 *
 * WHY THIS EXISTS. Each of capture / traverse / plan / paths / pixdiff / probe-autos /
 * verify-gpu used to spawn its own `vite preview` on a random free port and call
 * `server.kill()` at the end. Two things went wrong with that, and together they made
 * this machine unusable:
 *
 *   1. `.kill()` ends the vite parent and leaves its esbuild child running. Half of
 *      every leaked pair was an orphaned esbuild.
 *   2. The kill line only ran on the happy path. Any throw, any Ctrl-C, any failed
 *      assertion mid-capture skipped it and leaked the whole tree.
 *
 * Measured on 2026-09-18: 52 leaked preview servers in about three hours - 104
 * processes, 4.67 GB, and 52 sockets still LISTENING. The ephemeral port pool on this
 * box is 16,384 entries, and exhausting it is exactly what cost the owner 15 hours on
 * 2026-09-17.
 *
 * THE FIX IS MOSTLY NOT THE KILL. It is not spawning 52 servers in the first place.
 * A `vite preview` serves `dist/` statically, so one server serves every run and every
 * rebuild - there is nothing per-run about it. So: a single pinned port, reused if it
 * is already up, spawned guarded if it is not.
 *
 * PORT 4188 is pinned in leak-watch/protected-ports.txt so the DevLeakReaper never
 * culls it. 4173 is deliberately NOT reused here - that is the owner's own preview and
 * a harness must never disturb a server he is looking at.
 *
 *   import { usePreview } from './lib/preview.mjs';
 *   const { url } = await usePreview();     // no teardown to write, and none to forget
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawnGuarded } from './proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Pinned so it can be protected from the reaper and reused across runs. */
export const PREVIEW_PORT = Number(process.env.AA_PREVIEW_PORT || 4188);

async function alive(url, ms = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Return a URL serving the built app, starting the shared server only if needed.
 * Never tears down a server it did not start - a sibling harness may be mid-run on it.
 */
export async function usePreview({ timeoutMs = 240000 } = {}) {
  const url = `http://localhost:${PREVIEW_PORT}/`;

  if (await alive(url)) return { url, port: PREVIEW_PORT, started: false };

  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new Error('[preview] dist/index.html is missing - run `npm run build` first. '
      + 'Both harnesses serve the BUILT artifact, never the source.');
  }

  // spawnGuarded reaps the whole tree (vite AND esbuild) on exit, SIGINT, SIGTERM,
  // uncaughtException and unhandledRejection - so a throw mid-capture cannot leak it.
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  spawnGuarded(npx, ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    // windowsHide: node defaults this to FALSE, and with shell:true every spawn pops
    // a cmd window over whatever the owner is typing into.
    windowsHide: true,
  });

  // 240 s, not 60: with sibling build lanes saturating the CPU a healthy server can be
  // slow to bind, and reporting "server never came up" for a busy machine reads as a
  // map failure.
  if (!await alive(url, timeoutMs)) {
    throw new Error(`[preview] shared server never came up on ${PREVIEW_PORT}`);
  }
  return { url, port: PREVIEW_PORT, started: true };
}

/** Kept for scripts that genuinely need their own isolated server. Prefer usePreview. */
export function spawnIsolatedPreview(port) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnGuarded(npx, ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
}

export { spawn };
