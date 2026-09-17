# Report: DEPLOY — GitHub Pages, one click, plus a local launcher

## What I changed (my file set only)

- **`vite.config.ts`** (modified): added a `base` resolver. Order: `PAGES_BASE`
  env var when set, else `GITHUB_REPOSITORY` (`owner/repo`, always present in
  Actions) mapped to `/<repo>/`, else `./` locally. No repo name hardcoded or
  guessed. Minimal ambient `process` typing so no new devDependency was needed.
  `server`/`preview` ports untouched.
- **`.github/workflows/pages.yml`** (new): push-to-`master` plus
  `workflow_dispatch`; `contents: read` / `pages: write` / `id-token: write`;
  `github-pages` environment; `checkout@v4`, `setup-node@v4` (Node 22, npm
  cache), `npm ci`, `npm run build` with `PAGES_BASE: /${{
  github.event.repository.name }}/`, then `configure-pages@v5`,
  `upload-pages-artifact@v3` (`dist`), `deploy-pages@v4`.
- **`Play-Nuketown.cmd`** (new): `cd /d "%~dp0"`, clear message + pause if Node
  missing, `npm install` on first run only, `npm run build`, then
  `npm run preview -- --open` (opens the browser exactly when the server
  listens — no connect-refused race). Serves the production preview, per brief.
- **`docs/DEPLOY.md`** (new): two routes, PowerShell-safe (one command per line,
  no `&&`). Documents the auto-derive base strategy and the exact go-live steps.
- **`package.json`, `.gitignore`: intentionally untouched.** Scripts already
  cover `dev`/`build`/`preview`; `traverse`/`verify` belong to other lanes and
  `dist/` staying ignored is correct for Pages (CI uploads the artifact, nothing
  is committed). Nothing under `src/` touched.

Note: the orchestrator committed my four files mid-run as `199362d`. Content on
disk is mine, verified by size/timestamp after the commit.

## What I measured

- `npx tsc --noEmit`: **clean** at the time (before a concurrent src edit).
- `npm run build`: succeeds in ~1s, 23 modules, in all three env variants:
  - no env → `src="./assets/index-….js"` (relative, loads from any path)
  - `PAGES_BASE=/nuketown-2025/` → `src="/nuketown-2025/assets/…"`
  - `GITHUB_REPOSITORY=someowner/some-repo` (no `PAGES_BASE`) →
    `src="/some-repo/assets/…"` (derive branch works)
- **Pages-base build served from `/nuketown-2025/`** (throwaway Node static
  server, Playwright Chromium): canvas 1280×720 live, `window.__NT.stations`
  present, **zero 404s, zero console/page errors**. Screenshot opened: real
  scene — orange-house back yard, stair LEFT, garage bays RIGHT, mow-striped
  lawn, HUD `316 calls / 123k tris`. The blank-page-with-404 failure mode is
  disproven for the Pages configuration.
- **Local relative-base build served from `/arbitrary-sub/`**: bundle resolves
  relatively, **zero 404s**, JS executes — but the page throws one runtime
  error (see below). Screenshot opened: house/stairs/props render, lawn is
  void (ground module threw). Asset resolution from a subpath is proven; the
  visual defect is not mine.
- `npm run dev` (spare port 5190, to avoid colliding with anyone's 5188):
  root 200 with `/src/main.ts` entry, `main.ts` transforms (30 KB). Unaffected
  by the `base` change.
- `Play-Nuketown.cmd` launched from `C:\Users\david` (foreign cwd): transcript
  shows build OK, `vite preview --port 4173 --open` listening; preview root 200
  with relative bundle ref, bundle 200 (613,702 bytes). (`--open` also popped a
  localhost tab on this machine — that is the launcher's documented behavior.)
- `npx --yes js-yaml .github/workflows/pages.yml`: parses.
- No `&&` in any owned file (only the prose phrase "no `&&`" in DEPLOY.md).

## What I looked at

Both subpath screenshots (opened, not assumed), `dist/index.html` bytes for all
three base variants, the launcher transcript, dev-server responses. Per
`capture.mjs`'s own warning I strip `#start` via evaluate in my probe — a real
click can't dismiss it (the overlay eats clicks by design) and my first shot
was just the title card.

## What I could not resolve

- **The Pages deploy itself was never run** — the repo still has no remote.
  DEPLOY.md gives the exact go-live path (`gh repo create … --push`, then
  Settings → Pages → Source: GitHub Actions). `gh` is authenticated here as
  `daveinturkey15-byte` with `repo`+`workflow` scopes, so the automatic route is
  primary. First push + toggle is the live test.
- **Concurrent breakage, not mine, blocking a fully-green re-verification:**
  while I was testing, another lane saved `src/build/ground.ts` referencing
  `T_ARC` (lines 429–430), which is not defined anywhere (only `Y_ARC` exists,
  in `mannequins.ts`). Current `tsc` fails solely on those two lines and any
  bundle built from this tree throws `[nuketown] module "ground" threw…
  ReferenceError: T_ARC is not defined` at runtime. I did not touch `src/` and
  left it for the owning lane. My earlier Pages-base check ran against the
  pre-breakage tree and is fully green; the local-subpath check documents the
  breakage's exact symptom. `index.html`, `main.ts`, `player.ts`, `yards.ts`,
  `vehicles.ts`, `third-house.ts` also have concurrent uncommitted edits.
- `dist/` currently holds a bundle built from the T_ARC-broken tree (`dist/`
  is gitignored, so this affects only local serving until the ground lane fixes
  it and someone rebuilds).
