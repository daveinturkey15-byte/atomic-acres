/**
 * Minimal ambient for the CPU scenario runner. The shared node_modules carries
 * no @types/node; the runner bundles with esbuild (which resolves node:assert
 * at runtime), so only the names the scenario uses are declared here.
 */
declare module 'node:assert/strict' {
  function equal(actual: unknown, expected: unknown, message?: string): void;
  function notEqual(actual: unknown, expected: unknown, message?: string): void;
  function ok(value: unknown, message?: string): void;
  function deepEqual(actual: unknown, expected: unknown, message?: string): void;
}
