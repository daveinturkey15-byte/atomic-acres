# Library tools

Four small read-only Python scripts. They need `pillow` and `numpy` and nothing else,
they touch no repository file outside `docs/reference/library/`, and they spawn no
processes and no browsers.

Run them in order from this directory:

```sh
python 1-census.py        # decode + measure every image under docs/reference/
                          # -> census.json next to this file. This IS the
                          #    error-page check: a 5.8 kB HTML "PNG" fails here.
python 2-build-json.py    # -> ../manifest.json ../shot-matrix.json ../frame-index.json
python 3-build-md.py      # -> ../MANIFEST.md ../shot-matrix.md ../hero-references.md
```

`../README.md` is hand-written and is **not** regenerated.

`census.json` is checked in on purpose. The images themselves are gitignored, so a
fresh clone cannot run step 1 — but with `census.json` present it can still run steps 2
and 3 and rebuild the whole index. Re-run step 1 whenever images are added or changed;
the `sha256` values in `manifest.json` are what tell you the bar has moved.

All the hand-written content — the hero list with its `saw` and `why`, the shot matrix,
the per-clip notes, the frozen style block — lives inside `2-build-json.py` as data at
the top of the file. Edit it there, then re-run steps 2 and 3. That way regenerating
can never silently drop curation, and the markdown can never drift from the JSON.

`contact-sheets.py` is the tool used to look at the corpus: it lays every gameplay
frame onto labelled 10x6 contact sheets under `index/` so a reviewer can go through all
1371 in 26 images instead of 1371. It writes only into its own directory.

Note on `census.py` features: `mean_l`, `p05`, `p95` are **display-value** luminance of
a 160 px thumbnail, not linear radiance — the footage is already tone-mapped and so is
`?post=ao` output from our own harness. They are for shortlisting. Then look.
