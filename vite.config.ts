import { defineConfig } from 'vite';
//
// GitHub Pages serves a project site from a subpath:
//   https://<user>.github.io/<repo>/
// A build with absolute `/assets/...` URLs 404s there and shows a blank page,
// so the Pages build needs `base: '/<repo>/'`. Local dev/preview serve from
// the domain root and are unaffected by a relative base.
//
// Resolution order - no repo name is guessed or hardcoded:
//   1. PAGES_BASE when set (pages.yml sets it from the repository name,
//      so a rename needs no code change).
//   2. GITHUB_REPOSITORY (`owner/repo`, always present in Actions).
//   3. Local fallback './': relative asset URLs load from any path,
//      root or subpath.
// (Minimal ambient typing so vite.config needs no new devDependency.)
declare const process: { env: Record<string, string | undefined> };
//
function pagesBase(): string {
  const override = (process.env.PAGES_BASE ?? '').trim();
  if (override) return override.endsWith('/') ? override : override + '/';
  const repo = (process.env.GITHUB_REPOSITORY ?? '').split('/')[1]?.trim();
  if (repo) return `/${repo}/`;
  return './';
}
//
export default defineConfig({
  base: pagesBase(),
  server: { port: 5188, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
