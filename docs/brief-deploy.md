# Task brief: DEPLOY — GitHub Pages, one click, plus a local launcher

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `vite.config.ts`
- `package.json` (scripts and any devDependency you genuinely need)
- `.github/workflows/pages.yml` (new)
- `Play-Nuketown.cmd` (new, repo root)
- `docs/DEPLOY.md` (new)
- `.gitignore` (only if you must)

Do not touch anything under `src/`. Another agent is working there right now.

## Why this exists

The owner wants to **click one link and be walking around the map**. He is not going to
run a terminal. He tried a `cd ... && npm run dev` one-liner in **PowerShell 5.1**,
where `&&` is a parse error, and concluded the project was broken. It was not — but
that is exactly the failure this task must make impossible.

## What to deliver

### 1. A production build that actually works when served from a subpath

GitHub Pages serves a project site at `https://<user>.github.io/<repo>/`, **not** at the
domain root. A Vite build with the default `base: '/'` produces absolute `/assets/...`
URLs that 404 there, and the page comes up blank with no obvious error. Set Vite's
`base` correctly for the Pages build, and make sure it still works for local
`npm run dev` and `npm run preview`.

Do **not** hardcode a repo name you have guessed. Derive it, or drive it from an env
var the workflow sets, and document the choice.

Verify by actually serving the built output from a subdirectory and loading it — not by
reasoning that it should work. A blank page with a 404 on the JS bundle is the exact
failure mode here, and it looks identical to "the build is fine" in the build log.

### 2. A GitHub Actions workflow that publishes to Pages

`.github/workflows/pages.yml` — build on push to the default branch, upload the
artifact, deploy to Pages, using the official `actions/configure-pages`,
`actions/upload-pages-artifact` and `actions/deploy-pages` actions with the
`pages: write` / `id-token: write` permissions and a `github-pages` environment.

The repo currently has **no git remote** — check with `git remote -v`. So the workflow
cannot be tested by pushing. Write it correctly, and in `docs/DEPLOY.md` give the owner
the **exact** steps to go live, as **PowerShell-safe** commands (no `&&`), covering:
creating the repo with `gh repo create`, pushing, and the one Settings toggle
(Settings → Pages → Source: GitHub Actions). Tell him the resulting URL shape.

If the `gh` CLI is available and already authenticated (`gh auth status`), say so in
DEPLOY.md and give the fully-automatic path as the primary route.

### 3. A one-click local launcher

`Play-Nuketown.cmd` at the repo root. Double-clicking it must build-or-serve the game
and open the browser at the right URL, with no terminal knowledge required. Make it
robust: if `node_modules` is missing, install first; print a clear message if Node is
absent. It must work when double-clicked from Explorer, where the working directory is
not guaranteed — resolve paths from the script's own location (`%~dp0`).

Prefer serving the **production preview** over the dev server for this — it starts
clean and does not depend on HMR.

### 4. `docs/DEPLOY.md`

Short. Two routes: "play locally right now" (double-click the .cmd) and "publish to
GitHub Pages" (the exact commands). PowerShell-safe throughout. No `&&`.

## Verify before you report

- `npm run build` succeeds and the output loads when served from a **subpath**
- `npx tsc --noEmit -p tsconfig.json` is clean
- `npm run dev` still works
- the `.cmd` launcher works when run from a different working directory
- the workflow YAML parses (`npx --yes js-yaml .github/workflows/pages.yml`, or any
  YAML parse you can run)

Report exactly what you verified and how, what you could not verify (the Pages deploy
itself, without a remote), and the precise steps the owner must take.
