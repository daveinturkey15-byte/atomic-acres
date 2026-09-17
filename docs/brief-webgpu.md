# Task brief: WEBGPU RENDERER, with a fallback that cannot lose us the build

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `src/core/world.ts`
- `src/core/renderer.ts` (new, if you want the selection logic separate)
- `package.json` **only** if the three.js version genuinely must move — if you touch it,
  say so loudly in your report, because another agent owns the build config.

You may NOT touch `src/main.ts`, `src/core/player.ts`, `index.html`, `vite.config.ts`
or anything in `src/build/`. Other agents own all of those right now.

**`createWorld(canvasParent)` must keep its exact exported signature and its returned
`World` shape (`renderer, scene, camera, sun, resize, dispose`).** That is the seam that
lets you do this without touching `main.ts`.

## The goal

The owner wants "super high quality WebGPU". Move the renderer to
`THREE.WebGPURenderer` **with an automatic, silent fallback to WebGL2** so that a
machine or browser without WebGPU still gets exactly what it gets today.

## Source-priority rule — follow it, do not work from memory

This project's owner has a standing rule for all Three.js work. Look things up in this
order and prefer current upstream over recollection:

1. current Three.js docs — `https://threejs.org/docs/llms.txt` and `llms-full.txt`
2. the Poimandres docs MCP at `docs.pmnd.rs/api/mcp` for R3F/Drei/ecosystem
3. current source and examples — `mrdoob/three.js`, especially the `webgpu_*` examples

**Check the installed three.js version first** (`node -e "console.log(require('three/package.json').version)"`)
and do not copy an API off HEAD that the installed version does not have. If the
installed version's WebGPU support is not good enough, say so in your report rather
than upgrading three across the project without warning.

## The hard part, so you are not surprised by it

`world.ts` builds the sky as a hand-written `THREE.ShaderMaterial` writing
`gl_FragColor`. **That is GLSL and it will not run under WebGPU.** You must port it,
almost certainly to TSL (`three/tsl`) node material, or replace it with an equivalent
node-based gradient.

Two properties of that sky that were hard-won and must survive the port:

1. The **visible** dome must apply tone mapping and colour-space conversion; the dome
   used to prefilter the **environment map** must not, because PMREM renders into a
   linear target and double-converting breaks every reflection. The current code takes
   a `target: 'screen' | 'env'` parameter for exactly this. Keep the distinction.
2. Without the PMREM environment map every `metalness > 0.7` material renders
   near-black — that is a missing specular term, not a dark material. The env map must
   still be generated and assigned under both backends.

Everything else in the scene is `MeshStandardMaterial`, which three's node system
handles under WebGPU without per-material rewrites — verify that rather than assume it.

## Fallback contract — this is the part that matters most

The owner is about to get a published link. **A WebGPU path that fails closed and shows
a black page is far worse than staying on WebGL2.** So:

- detect support properly (`navigator.gpu` plus an actual adapter request, not just the
  property), and fall back to WebGL2 on any failure, including an async device-loss
- allow a forced override for testing via a URL query parameter (e.g. `?gl=webgl`)
- log which backend actually came up, and expose it on the QA surface so the capture
  harness can record it
- **the headless capture harness must still pass on the fallback path**, because CI and
  the Pages build may not have WebGPU

A known trap on this machine: a WebGPU renderer that requests no `requiredLimits` can
silently roll back to a lower-capability device and quietly lose features. Be explicit.

## Verify — and be honest

```
node -e "console.log(require('three/package.json').version)"
npx tsc --noEmit -p tsconfig.json          # must be clean
npm run capture -- --tag gpu               # 10 stations, zero page errors
npm run traverse                           # must stay 5/5, handedness PASS
```

Then **open** `captures/gpu-streetElevation.png`, `gpu-yardOrange.png`,
`gpu-turningHead.png` and `gpu-aerial.png` with the Read tool and compare them against
the current `captures/ship-*.png` set. The WebGPU frames must be **at least as good**
— same exposure, same sky gradient, same reflections, no black metals, no missing
geometry. If they are not, say so plainly.

Also confirm the fallback: force WebGL2 and re-capture, and confirm those frames match
today's output.

**If WebGPU cannot be made to match on the installed three.js version inside your time
budget, leave the WebGL2 path as the default, ship the WebGPU path behind the query
parameter, and say exactly that in your report.** A working WebGL2 build is the floor
and must not be lost. Do not report success on the basis that the code compiles.
