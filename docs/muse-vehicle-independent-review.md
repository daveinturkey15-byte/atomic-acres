# Muse vehicle independent review — resolved

Review target: `C:\Users\david\Desktop\stuff\worktrees\nuketown-muse-vehicle-20260919`
Base: `fb7151498ac8e826e3c1066484219420c3c7a8bc`
Current root source SHA-256: `641b89e6776f406d14e8dec308ef1dce8643fd73952b38e70895afe0f94a0a0e`

## Verdict: CPU PASS; runtime visual admission remains OPEN

The independent review found and root repaired the missing lower-body attachment in
the copied candidate. `makeSaloon` now contains one `g.add(extrude(body, W, paint))`
site immediately after the 9-point body profile. The strengthened verifier now
instantiates the real function from frozen base and current source, compares the
returned scene, and includes a missing-body negative control.

## Exact CPU proof

```text
node scripts/assets/verify-vehicle-refinement.mjs
```

The proof exited 0 and reported:

```text
actual base/current draws: 30/30
actual base/current expanded tris: 4492/4508
actual base body attached       count=1 tris=24
actual current body attached    count=1 tris=32
actual roof attached            count=1 tris=20
actual draw count preserved     base=30 current=30
actual material usage preserved base=9 signatures current=9 signatures
actual saloon triangle delta    +16 per saloon
world tri budget                +48 <= +5000 world tris
negative control rejects missing body attachment  body=0 draws=29 trisDelta=-16
```

The actual instantiated body bounds are identical between base and current:
`x -2.420000..2.420000`, `y 0.340000..0.980000`, `z -0.975000..0.975000`.
The full scene bounds are also preserved within the verifier tolerance. Material
usage signatures and draw-bearing mesh count remain unchanged.

The negative control removes the body attachment in the in-memory wrapper. It
produces zero attached body meshes, one fewer draw, and a `-16` per-saloon triangle
delta; the verifier correctly rejects it. This closes the gap in the earlier
profile-only verifier, which had falsely passed the missing-body candidate.

## Geometry checks

The exact current profiles still pass the independent Three.js CPU geometry audit:

| profile | triangles | minimum triangle area | zero-area triangles | cap-facing triangles |
| --- | ---: | ---: | ---: | ---: |
| body, 9 points | 32 | 0.00979999 | 0 | 7 +z / 7 -z |
| roof, 6 points | 20 | 0.00504999 | 0 | 4 +z / 4 -z |

The signed 2D profile areas are positive (`2.7118` body, `0.1731` roof), with no
degenerate triangles or apparent winding inversion. `git diff --check` against
`fb715149` also passed.

## OPEN

No browser, GPU, server, application build, or visual capture was run. Root still
needs the requested runtime three-quarter frame, actual scene traversal, and draw
counter review before shipping the refinement.
