/**
 * proc-guard - reference implementation for spawning dev children that always die.
 *
 * WHY: two leaks on dave-gaming-pc, one bug shape.
 *   2026-09-17  ~600 orphaned Chrome processes exhausted the ephemeral port pools
 *               and made the machine unusable for 15 hours.
 *   2026-09-18  52 leaked `vite preview` servers (104 processes with their esbuild
 *               pairs, 4.67 GB, 52 listening ports) accumulated in ~3 hours.
 *
 * Both came from the same two mistakes:
 *
 *   1. `process.kill(child.pid)` ends ONLY the parent. Chrome spawns 8-10
 *      renderer/GPU/network children and `vite preview` spawns esbuild; all of
 *      them survive as orphans. On Windows the fix is `taskkill /T` (kill tree).
 *      A child spawned `detached: true` + `.unref()` has no process group to
 *      fall back on, so there is no POSIX-style negative-pid rescue either.
 *
 *   2. Cleanup lived only at explicit exit paths. Any throw elsewhere, a Ctrl-C,
 *      or an unhandled rejection skipped it entirely and leaked the whole tree.
 *
 * Usage - replace `spawn(...)` with `spawnGuarded(...)` and delete your manual
 * kill lines. Nothing else changes:
 *
 *     import { spawnGuarded, killTree } from './proc-guard.mjs';
 *     const chrome = spawnGuarded(CHROME, args, { detached: true, stdio: 'ignore', windowsHide: true });
 *     // ...work...
 *     // no cleanup code needed - exit, throw or Ctrl-C all reap the tree.
 *
 * If you must keep your own spawn call, wrap it: `guard(spawn(...))`.
 */

import { spawn, spawnSync } from 'node:child_process';

const tracked = new Set();
let installed = false;
let cleaning = false;

const isWindows = process.platform === 'win32';

/** Kill a process AND everything it spawned. Synchronous, so it is safe in an 'exit' handler. */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (isWindows) {
      // /T = tree, /F = force. This is the whole point: without /T, Chrome's
      // renderers and vite's esbuild survive the parent and become the leak.
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      // Negative pid targets the process group - only valid if spawned detached.
      try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); }
    }
  } catch {
    /* already gone - that is the success case, not an error */
  }
}

/** Register an already-spawned child for guaranteed cleanup. Returns the child. */
export function guard(child) {
  if (!child || !child.pid) return child;
  install();
  tracked.add(child);
  child.once('exit', () => tracked.delete(child));
  return child;
}

/** Drop-in replacement for child_process.spawn that cannot leak. */
export function spawnGuarded(cmd, args = [], opts = {}) {
  return guard(spawn(cmd, args, opts));
}

/** Reap every tracked child. Idempotent - safe to call from several handlers. */
export function cleanupAll() {
  if (cleaning) return;
  cleaning = true;
  for (const child of tracked) killTree(child.pid);
  tracked.clear();
  cleaning = false;
}

function install() {
  if (installed) return;
  installed = true;

  // 'exit' must be synchronous - hence spawnSync in killTree.
  process.on('exit', cleanupAll);

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(sig, () => {
      cleanupAll();
      // Re-raise the default behaviour rather than swallowing the signal.
      process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  }

  // The two paths that leaked whole trees before: a throw or a rejection
  // anywhere outside the explicit exit sites.
  process.on('uncaughtException', (err) => {
    cleanupAll();
    console.error('[proc-guard] uncaughtException - children reaped:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    cleanupAll();
    console.error('[proc-guard] unhandledRejection - children reaped:', err);
    process.exit(1);
  });
}

/**
 * Close a spawned dev server cleanly, tree and all.
 * `vite preview` in particular holds a listening port and an esbuild child;
 * letting it linger is what produced 52 idle servers on 2026-09-18.
 */
export function stopServer(child) {
  if (!child) return;
  tracked.delete(child);
  killTree(child.pid);
}
