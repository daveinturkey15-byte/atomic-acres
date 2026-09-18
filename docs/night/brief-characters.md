# Lane `characters` - animated player characters, with no account anywhere

Read `docs/night/_COMMON.md` first.

## The owner's constraint, which is absolute

> "im not going to do an adobe login, surely there is another way?"

**No Mixamo. No Adobe. No Reallusion/ActorCore, no Meshcapade, no SMPL, no
ReadyPlayerMe, no Sketchfab account, no anything that needs a sign-up, an email, an
API key or a EULA click-through.** If a source asks you to register, it is out - do not
work around it, do not use someone's re-upload of it, and do not ask the owner to sign
in. Say in your report that you rejected it and why.

## The insight this lane is built on

What Mixamo actually provides is an **animation library**, not meshes. Replace that and
the mesh becomes a detail you can swap later. So build the SYSTEM first and keep the
mesh pluggable:

  BVH / glTF clip  ->  retarget onto a standard humanoid skeleton  ->  blend tree
                                          |
                        mesh: procedural today, generated later

Get that right and swapping in a better character costs an afternoon instead of a
rewrite.

## Everything you need is already installed - add no dependencies

`three@0.180.0` ships all of it. Verified present:

- `three/examples/jsm/loaders/BVHLoader.js` - parses BVH into a skeleton + AnimationClip
- `three/examples/jsm/utils/SkeletonUtils.js` - `retarget()` and `retargetClip()`
- `three/examples/jsm/loaders/GLTFLoader.js`, `FBXLoader.js`

## Sources that need no account (verified responding on 2026-09-18)

1. **CMU Graphics Lab Motion Capture Database** - `http://mocap.cs.cmu.edu/`. 2500+
   clips: walk, run, crouch, jump, turn, aim, climb. Free for all uses, no
   registration. BVH conversions are mirrored on GitHub (e.g. `una-dinosauria/cmu-mocap`
   and other public mirrors). **This is the Mixamo replacement.** Note the CMU captures
   are 120 fps and in a Z-up skeleton - resample and reorient on import, once, offline.
2. **three.js's own sample BVH** -
   `https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/bvh/pirouette.bvh`
   - use this to prove your loader/retarget path before touching a big corpus.
3. **Quaternius** - `https://quaternius.com/packs/universalbasecharacters.html`. CC0,
   rigged, already animated, direct download, no account. Use as a **working
   placeholder and a skeleton-naming reference**, not as the final look: it is stylised
   low-poly and the owner is aiming at photorealism.

## What we already own, and it is more than it looks

`src/build/mannequins.ts` is a **forward-kinematic humanoid rig written in code**: a
joint/bone chain where a pose is a table of angles, instanced about 40 times for ~26
draw calls. It is a skeleton in all but name, it is already the signature Nuketown
prop, and it is cheap. Read it before you design anything.

## Files you own

- `src/characters/**` (new - create it)
- `src/build/mannequins.ts` (granted to you this wave; the rest of `src/build/` is not)
- `public/anim/**` and `public/characters/**` (new - downloaded clips and meshes)
- `scripts/fetch-anim.mjs` (new - the download + convert step)

**Do NOT touch `src/main.ts`** - two sibling lanes are already editing it. Export a
single documented entry point from `src/characters/index.ts` and say in your report
exactly how to wire it; the orchestrator will do that.

## What to build, in this order

1. **A standard humanoid skeleton definition** - bone names, rest pose, proportions -
   in one file, as data. Everything else keys off it. Use the common humanoid naming
   (Hips, Spine, Chest, Neck, Head, Left/RightShoulder, Arm, ForeArm, Hand, UpLeg, Leg,
   Foot, Toe) so any future source retargets without inventing a mapping.
2. **An offline fetch-and-convert step** (`scripts/fetch-anim.mjs`) that pulls a SMALL
   named set of clips, resamples 120 -> 30 fps, reorients Z-up to Y-up, trims, and
   writes compact glTF/JSON into `public/anim/`. Offline, not at page load. Record
   every source URL and its licence in `public/anim/LICENCES.md`. Do not commit
   hundreds of megabytes - a dozen good clips beats a corpus.
3. **A clip set that covers the game**: idle, walk, run, sprint, crouch-idle,
   crouch-walk, jump, land, turn-left/right, aim, fire, reload, hit-react, death.
   If CMU has no good "aim rifle", say so rather than shipping a wrong one.
4. **Retarget + a blend tree**: locomotion blended on speed and direction, an upper-body
   layer for aim/fire so the character can aim while running, and proper foot handling
   (at minimum no visible skating - measure it, do not eyeball it).
5. **The mesh, pluggable**: a `CharacterMesh` interface with at least a procedural
   implementation driven by the same skeleton. If you also wire the Quaternius
   placeholder behind the same interface, good - that proves the seam works.
6. **Instancing/LOD sanity**: this is a 12-player map in a browser. Say what your
   budget is and measure against it.

## Licence hygiene - this is a deliverable, not paperwork

This project's standing contract is "everything generated in code, nothing downloaded".
This lane is an explicit, owner-authorised exception for character animation ONLY.
So: keep every downloaded byte under `public/anim/` and `public/characters/`, write
`LICENCES.md` naming each file, its source URL, its licence and the date fetched, and
never mix downloaded data into `src/`. If you cannot establish a licence for something,
do not use it.

## Verify before you report

```
npx tsc --noEmit -p tsconfig.json
npm run build
npm run traverse
npm run capture -- --tag characters
```

Traverse must still report 4/4 house faces enterable and handedness PASS; ignore its
route PASS/FAIL, which is red for a geometry reason the orchestrator owns.

Then prove the animation actually runs: drive the built page headlessly, play each clip,
and report frame time with 12 characters on screen, JS heap at start and after two
minutes, draw calls, and the measured foot-skate in cm per stride. Open your captures
and look at them - a T-posing character is the classic retarget failure and it is
obvious in a frame and invisible in a log.

Be honest about what you could not get working. A clean skeleton + loader + two good
clips is worth far more than fourteen clips that all look wrong.
