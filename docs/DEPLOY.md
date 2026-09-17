# Play / publish Atomic Acres

Live site: `https://daveinturkey15-byte.github.io/atomic-acres/`.

Unofficial fan project — not affiliated with Activision or Treyarch.

## Play locally right now (no terminal)

Double-click **`Play-Nuketown.cmd`** in the repo root.

It checks Node is installed, installs dependencies on first run, builds the
production bundle, serves it, and opens your browser at
`http://localhost:4173/`. Keep its window open while you play. Close it to stop.

Prefer the terminal? These do the same thing by hand:

```
npm install
npm run build
npm run preview
```

`npm run dev` (at `http://localhost:5188/`) is the dev server. Same game,
hot-reload instead of the production bundle.

## Publish to GitHub Pages

The `gh` CLI is available and already authenticated here (checked 2026-09-17:
logged in as `daveinturkey15-byte` with `repo` and `workflow` scopes), so the
fully-automatic route below is the primary one.

Every command is PowerShell-safe (one per line, no `&&`).

1. Create the repo and push (pick any name; the build derives its URL base
   from it, so nothing is hardcoded):

```
gh repo create nuketown-2025 --public --source=. --remote=origin --push
```

2. Confirm where you stand:

```
git remote -v
gh auth status
```

3. Enable Pages: open the new repo in a browser, go to
**Settings → Pages → Source: GitHub Actions** (one toggle, no branch picker).

4. Push to `master`. The `pages.yml` workflow builds and deploys. Your URL is:

```
https://<user>.github.io/<repo>/
```

Example: `https://daveinturkey15-byte.github.io/atomic-acres/`

### How the subpath build works

GitHub Pages serves a project site from `/<repo>/`, not the domain root.
`vite.config.ts` resolves Vite's `base` in this order: the `PAGES_BASE` env
var the workflow sets from the repository name, else `GITHUB_REPOSITORY`
(`owner/repo`, always present in Actions), else `./` locally. Relative asset
URLs keep local `dev`/`preview` working unchanged.

### Not verified

The Pages deploy itself: this repo has no git remote yet, so the workflow has
never run. The first push plus the Settings toggle above is the live test.
