// Bind a freshly built local preview to its source and entry bytes. Run after build.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const runtime = ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts'];
if (git('diff', '--name-only', 'HEAD', '--', ...runtime)) {
  throw new Error('Commit reviewed runtime inputs before stamping a preview.');
}
const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
const entry = html.match(/<script[^>]+src="(?:\.\/)?([^"?]+\.js)"/)?.[1];
if (!entry?.startsWith('assets/')) throw new Error('Expected a local Vite assets entry.');
const stamp = {
  project: 'atomic-acres',
  repository: 'daveinturkey15-byte/atomic-acres',
  lineage: 'standalone restart begun 2026-09-17',
  branch: git('branch', '--show-current'),
  sourceCommit: git('rev-parse', 'HEAD'),
  stampedAt: new Date().toISOString(),
  entry,
  entrySha256: createHash('sha256').update(readFileSync(resolve(root, 'dist', entry))).digest('hex'),
  untrackedPublicFiles: git('ls-files', '--others', '--exclude-standard', 'public').split('\n').filter(Boolean),
  acceptance: 'Local tested preview; not a production release or complete feature/art acceptance.',
};
writeFileSync(resolve(root, 'dist/preview-identity.json'), JSON.stringify(stamp, null, 2) + '\n');
console.log(JSON.stringify(stamp, null, 2));
