# Character animation - sources, provenance and licence obligations

Two independent supply routes are represented in this directory. The obligations in
`docs/LICENCES-ANIMATION.md` (decided 2026-09-18 18:40) are binding on the first of them,
and this file is where they are discharged.

> **Built with Meta Llama 3**

---

## 1. Kimodo (local text-to-motion) - the shipped `.glb` clips

Baked 2026-09-18 on `dave-gaming-pc`. Every `.glb` here is skeletal motion generated locally by
NVIDIA's Kimodo SOMA-RP v1.1 checkpoint from a text prompt, then retargeted onto this
project's own 21-bone rig (`src/characters/skeleton.ts`) by
`scripts/animation/retarget-soma.mjs`.

**No weights, no embeddings and no raw motion are in this repository** - obligation 1. They
stay in `C:\Users\david\projects\kimodo.cpp` and in a session scratch directory, and
`scripts/animation/bake-motion.mjs` refuses outright to write raw motion to any path inside
the repo.

### Licences

| component | licence | commercial use |
|---|---|---|
| `kimodo.cpp` port and its tools (`kmd-encode`, `kmd-generate-embed`) | Apache-2.0 | yes |
| Motion weights `kimodo-soma-rp-v1.1-f32.gguf` (`nvidia/Kimodo-SOMA-RP-v1.1`) | **NVIDIA Open Model License** - "NVIDIA claims no ownership rights in outputs" | yes, no country exclusion |
| Text encoder bundle (LLM2Vec conversion of Llama 3 8B Instruct) | **Meta Llama 3 Community License** | yes, with the attribution below |
| SMPL-X RP checkpoint | NVIDIA internal-R&D licence; derivative distribution prohibited | **not obtained, not used** |

The SMPL-X checkpoint is absent from this machine and was never fetched (obligation 4). The
port's README sentence "gives you SMPL-X" is true only of that checkpoint. `soma-rp-v1.1`
emits **SOMA-30**, and `scripts/animation/inspect-motion.mjs` fails hard if a raw export
reports any joint count other than 30 - twenty-two would mean the forbidden weights were
loaded, and the pipeline stops rather than retargeting them.

### Attribution required in the game (obligation 3)

The credits screen must carry, verbatim:

```
Built with Meta Llama 3
Motion: NVIDIA Kimodo SOMA-RP v1.1 (NVIDIA Open Model License)
```

### Exact commands

```
kmd-encode.exe         <textBundle> <prompt.txt> <embedding.f32>
kmd-generate-embed.exe <motion.gguf> <embedding.f32> <frames> 50 <seed> <outDir> --device cpu
```

50 DDIM steps, 30 fps, CPU only - the GPU was deliberately left free for sibling
capture lanes. Embeddings are 4096 float32 = 16,384 bytes each; the encoder ran with
`KIMODO_TEXT_LAYER_CHUNK=4`. Measured cost: 13 s to encode a prompt, ~55 s to generate a
120-frame clip.

### Model files and SHA-256 (obligation 2)

| file | bytes | sha256 |
|---|---|---|
| `kimodo-soma-rp-v1.1-f32.gguf` | 1,133,166,784 | `3bf1229f4c1eff1d28f5196a854113da2df9a11a5e21c60694630903bf948ee4` |

Text encoder bundle, `weights/generated/llm2vec-text-bundle/` (35 files, 14.14 GiB):

| file | bytes | sha256 |
|---|---|---|
| `embedding.gguf` | 1,050,674,240 | `8d2c16c7996d2d2a6b5071d623fbff413432c881a998a0b4d442786b47c63560` |
| `final-norm.gguf` | 9,248 | `3d705ae86b5ac9c49634f8517abfdedb2266a03758750bc707dd0cc67927c95c` |
| `layer-00.gguf` | 441,469,344 | `b4fbf81fa84d08c4c657dc7956fccdbd9d50c83e11fe291d9f3a58dddb4ba4cc` |
| `layer-01.gguf` | 441,469,344 | `6ac62e2961540327478b6a7487392f404ee98da4e9206b49b129d9b28fa54ab2` |
| `layer-02.gguf` | 441,469,344 | `c47cef118e2a8e48a479f4823e330bd2e861d8b31b3239a02e78fc31ca97dd04` |
| `layer-03.gguf` | 441,469,344 | `8539ec5b283159d38aad68115b99a12b7a54b38e65ca205d7297873a7bdfa509` |
| `layer-04.gguf` | 441,469,344 | `204f009bb401aaaab7a4a14adc57ce8b94896cdc4ae4e2e80b8df2f97954cad0` |
| `layer-05.gguf` | 441,469,344 | `b20a74d09ba0abb5135fdb900067cca02e6d5cc34d05a37147cb78c63b388c04` |
| `layer-06.gguf` | 441,469,344 | `c00d620a46a111786b340bce68f47ae89a62f3d05d31acde830c0a71d9060200` |
| `layer-07.gguf` | 441,469,344 | `578064ffe7a38b9c4a014780ac5ca99de2497ac93544c04ba849bb262470a563` |
| `layer-08.gguf` | 441,469,344 | `4a6319773a5e19b6e17bb55ee2629ddaa97f6a8fb22d37c3ea6be9e58e3c3087` |
| `layer-09.gguf` | 441,469,344 | `49a13e69f524144afed1c52fa819ec48f40014c3561f4e62ccf5eac1808e940e` |
| `layer-10.gguf` | 441,469,344 | `122fac4b17d800f84fbd2e9c0d5510ad773818e604d9e396328bd9cafcf72008` |
| `layer-11.gguf` | 441,469,344 | `aaddc4180b44bac7a0be466d7f4812fb338bbdefae188b4195580cf4cef64266` |
| `layer-12.gguf` | 441,469,344 | `889d22f1f7b01e5cbb74f3e8d48a3af0c1d03d075c997c660a1ec00ab9014b32` |
| `layer-13.gguf` | 441,469,344 | `4fbf6d5ef2e4001a8fd5e356702294ebe60799f79ae39a7495290ccd616f9ba4` |
| `layer-14.gguf` | 441,469,344 | `683b753e7778f774f819141d745fb8aee27b59186f18f0b6e7e4b2501c9aa779` |
| `layer-15.gguf` | 441,469,344 | `ebc5ec00c746ad1c4bf5b83a381f76de7354e756a514abfa741aa25a42cecd98` |
| `layer-16.gguf` | 441,469,344 | `195fb02a1828a5cdf10a1babca4346539c8e79c986051f246def49691cb0928b` |
| `layer-17.gguf` | 441,469,344 | `89010f85d6d65f6565d87ea973ae3478c0c50318bec65092677a0629037e4b29` |
| `layer-18.gguf` | 441,469,344 | `c792d2a68d5694c4b3c5f6ecb34ccdf58a9b70eecb0f2b4e088a0e000a2ce003` |
| `layer-19.gguf` | 441,469,344 | `8eea4627aa980a6af4c398fab8bd2722afbbddcf06eae20ebba8eabe1b9b4cff` |
| `layer-20.gguf` | 441,469,344 | `e78a1a63c518163180fcad8834ad2aafded81724a89b39a2b08c14868387e532` |
| `layer-21.gguf` | 441,469,344 | `5f299eab47553e622c0a8a21592ff54d9c5117ae612efb482f200186e588f718` |
| `layer-22.gguf` | 441,469,344 | `70a85e4fbcb4420d56f2ae919293a21a311c32ef2dd19ffead2392350af8d772` |
| `layer-23.gguf` | 441,469,344 | `1f91267d870d917fda9e2a3e7a9e99ba4c90746f24bc0c0a26a8263847def38c` |
| `layer-24.gguf` | 441,469,344 | `705fb89b13fe8aeb4207d95a9c83f54078983062719148859269238723015b49` |
| `layer-25.gguf` | 441,469,344 | `883f02a1d6d960f54ad109b7c0d546babc774a68857efbb7e7043c4916d948af` |
| `layer-26.gguf` | 441,469,344 | `7c7dcf9ce30093dd5bcb74e69215d7685bc451af7760e7c07f43ac0792aefc4f` |
| `layer-27.gguf` | 441,469,344 | `59babbcac45cce55247ecf582e30d6ef7987126517c504bf929c32fb925acc4a` |
| `layer-28.gguf` | 441,469,344 | `ac4575ab811d1e2b844133bf1d4076c8938de7de7801493701a45e2a7fb7ddaa` |
| `layer-29.gguf` | 441,469,344 | `c5a4c71d0ee6570cd8e6964500c2acd65a263cff3c61aaa45a01a911dd34695b` |
| `layer-30.gguf` | 441,469,344 | `2af5c0c42fea1b91bfe2f6a52918fc11724c09a9faf0beb08177c22d5b56ffb0` |
| `layer-31.gguf` | 441,469,344 | `a2e6086de679aa0e07c5fd8f7768c5eda0e00b5863ac2c1773622c90d619c16f` |
| `tokenizer.gguf` | 7,295,054 | `81614aca62a98846c02b72cc2e5378e5bdce8b4d507b88f96eb1faa90dae607e` |

### Shipped clips

`speed` is measured at the planted foot, never assumed from the prompt, and it is the number
`blend.ts` divides by to set `timeScale`. `foot slide` is the worst single-stride slide over
the looped window; it is `n/a` for one-shots, where the feet are supposed to move. `loop
seam` is the pose distance between the first and last key of a loop.

| clip | seed | keys | duration | speed | foot slide | loop seam | embedding sha256 |
|---|---|---|---|---|---|---|---|
| `walk.glb` | 1102 | 26 | 0.83 s | 1.97 m/s | 3.8 cm | 0.124 | `a55cd27acf3ac3b4` |
| `run.glb` | 1003 | 18 | 0.57 s | 2.67 m/s | 6.2 cm | 0.126 | `e47dbee53455e1b9` |
| `sprint.glb` | **1211** | 16 | 0.50 s | 2.98 m/s | 0.0 cm | 0.144 | `d6800cdfa0a79497` |
| `crouch-idle.glb` | 1105 | 53 | 1.73 s | 0.00 m/s | 0.5 cm | 0.030 | `b9deca0259f834d2` |
| `crouch-walk.glb` | 1106 | 31 | 1.00 s | 1.40 m/s | 2.4 cm | 0.138 | `5a0b2dbba4761e8b` |
| `aim.glb` | **1207** | 51 | 1.67 s | 0.00 m/s | 0.9 cm | 0.040 | `f802c2874ca0fffc` |
| `aim-rifle-walk.glb` | 1008 | 20 | 0.63 s | 1.95 m/s | 1.4 cm | 0.081 | `5482a68569fe0b3b` |
| `jump.glb` | 2001 | 75 | 2.47 s | 0.20 m/s | n/a (one-shot) | 0.358 | `e4d55931b19b445b` |
| `land.glb` | 2002 | 60 | 1.97 s | 0.05 m/s | n/a (one-shot) | 1.479 | `6a7fbe86cdfc633a` |
| `turn-left.glb` | 2003 | 75 | 2.47 s | 0.01 m/s | n/a (one-shot) | 1.795 | `9811633424e0dbee` |
| `turn-right.glb` | 2004 | 75 | 2.47 s | 0.00 m/s | n/a (one-shot) | 1.935 | `230111f5332f4453` |
| `fire.glb` | 2005 | 45 | 1.47 s | 0.00 m/s | n/a (one-shot) | 0.202 | `c44e18755b866a71` |
| `reload.glb` | 2006 | 100 | 3.30 s | 0.00 m/s | n/a (one-shot) | 0.881 | `25ab0d44ac461cec` |
| `hit-react.glb` | 2007 | 60 | 1.97 s | 0.00 m/s | n/a (one-shot) | 0.826 | `a393cd38c9c874f9` |
| `death.glb` | 2008 | 110 | 3.63 s | 0.07 m/s | n/a (one-shot) | 7.637 | `d18310d9a27567d7` |

`idle` is absent from this table on purpose - see "Rejected clips" below. The game uses the
authored idle from `src/characters/clips.ts`.

Re-rolled on 2026-09-19, with the sha256 of the shipped bytes:

| file | bytes | sha256 |
|---|---|---|
| `aim.glb` (seed 1207, prompt sha `6221157f1887a2d9`) | 24,416 | `5b848b3b0ea0ba4f1b2dec03e79783677f853d1da77994bd7c95fa49e72082f2` |
| `sprint.glb` (seed 1211, prompt sha `32132894bb532daf`) | 12,104 | `d6800cdfa0a79497ba68ec6adbdc59c4a61ec1b42bbc3d9ed139dc3a69b91d09` |

The embedding cache is now keyed on the prompt TEXT (`bake-motion.mjs` writes a
`<embedding>.f32.txt` stamp beside each one). Before that it was keyed on the clip id alone,
which meant a re-rolled prompt silently reused the OLD sentence's embedding and only the seed
actually changed - the exact failure mode a re-roll exists to avoid.

### Prompts

- `walk` - seed 1102, 26 keys
  > a soldier walks forward slowly and casually at an unhurried stroll, short relaxed steps, arms swinging gently, loopable
  **Second seed.** second seed. The first (1002, 'steady relaxed pace') measured 2.14 m/s at the planted foot - a jog, not a walk, and the blend tree would have played it at half timeScale for a 1.1 m/s character.
- `run` - seed 1003, 18 keys
  > a soldier jogs forward at a steady pace holding a rifle at the ready, elbows bent, even strides, loopable
- `sprint` - **seed 1211**, 16 keys (re-rolled 2026-09-23)
  > a soldier sprints forward flat out at top speed, long fast strides, tall through the chest with the head up, arms driving straight forward and back close to the sides, elbows in, loopable
  **Third prompt.** Seed 1104's "body low and forward" gave 53.2 deg of left upper-arm abduction - arms out sideways - and 1.660 m to the top of the helmet. The prompt now asks for the arm PATH (forward and back, elbows in) instead of a body attitude: abduction 53.2 -> 28.3 deg, lean 11.9 -> 7.5 deg. Height is unchanged at 1.63 m and a sprint is allowed to be low; speed 2.74 -> 2.84 m/s, still below the blend tree's 4.1 sprint threshold, so it plays at timeScale 1.4 when selected. Seed 1211 (2026-09-23): 2.98 m/s, slide 0.0 cm (was 4.0), seam 0.144 — still below 4.1, plays ~1.38x; the SOMA model will not sprint faster, so a true 1.0x needs a game-speed decision, not another seed. Prompt sha256 `32132894bb532daf`.
- `crouch-idle` - seed 1105, 53 keys
  > a soldier holds a half-kneeling combat crouch with his back straight and chest up, knees bent, rifle shouldered, steady
  **Second seed.** second seed. The first (1005) put the pelvis at 0.288 m - sitting on the heels, head at 0.89 m. A combat crouch keeps the torso upright, so the prompt now says so instead of saying 'low'.
- `crouch-walk` - seed 1106, 31 keys
  > a soldier advances in a combat crouch, back straight and chest up, knees bent, taking short steady steps, rifle shouldered, loopable
  **Second seed.** second seed. The first (1006, 'torso low') produced a duck-walk: pelvis 0.52 m with the torso near horizontal. Photographed at captures/anim/crouchwalk-side.png before the re-roll.
- `aim` (prompt id `aim-rifle-idle`) - **seed 1207**, 51 keys (re-rolled 2026-09-19)
  > a soldier stands upright with his legs straight and his back vertical, head level, aiming a rifle straight ahead with both hands at shoulder height, elbows tucked in close to his ribs, holding steady, loopable
  **Second prompt.** Seed 1007 measured 1.719 m to the helmet offline and 15.9 deg of torso lean - the model crouched into the shot, because the prompt named only the weapon and let it choose the stance. Naming the legs, the back and the head separately fixed it: measured in the game through playExternal, 1.804 m, 4.1 deg of lean, 15.6 deg of left abduction. Prompt sha256 `6221157f1887a2d9`.
- `aim-rifle-walk` - seed 1008, 20 keys
  > a soldier walks forward slowly while aiming a rifle straight ahead with both hands, upper body steady, loopable
- `jump` - seed 2001, 75 keys
  > a person crouches and then jumps straight up off both feet, tucking the knees at the top
- `land` - seed 2002, 60 keys
  > a person lands from a drop, absorbing the impact by bending both knees deeply, then straightens back up
- `turn-left` - seed 2003, 75 keys
  > a person standing still pivots ninety degrees to their left on the spot, feet stepping around
- `turn-right` - seed 2004, 75 keys
  > a person standing still pivots ninety degrees to their right on the spot, feet stepping around
- `fire` (prompt id `fire-recoil`) - seed 2005, 45 keys
  > a soldier firing a rifle absorbs the recoil, the shoulders and head jolting back sharply and then resettling
- `reload` - seed 2006, 100 keys
  > a soldier lowers a rifle slightly, brings his right hand down to his belt and up to the weapon, then raises the rifle again
- `hit-react` - seed 2007, 60 keys
  > a person is struck hard in the chest and staggers backward, torso recoiling, arms flinching
- `death` - seed 2008, 110 keys
  > a person is shot, buckles at the knees and collapses forward onto the ground, ending face down and motionless

### Calibration recorded with the set

- **Up axis: Y, measured.** The brief assumed Kimodo output was Z-up. It is not: the root
  band sits at 0.93 m on Y with centimetres of travel while X and Z carry metres. No axis
  swing is applied, and applying the assumed one would lay every figure on its face.
- **Handedness: the source is mirrored.** SOMA's rest skeleton puts its Left-labelled joints
  at +X while the face, jaw and both toes point +Z; in a right-handed Y-up frame that is a
  mirrored human. The retarget reflects X and keeps the labels. The falsifier is the
  non-shipped clip `calib-right-arm` ("raises their right arm straight up"): OUR RightHand
  peaks at 1.992 m while the left hangs at 0.942 m. Evidence:
  `captures/anim/calib-right-arm.png`.
- **Leg scale 0.8668** - our pelvis rests 0.857 m above the toe against SOMA's
  0.9887 m. Only the root is scaled; rotations are dimensionless.
- **Hip ownership: the CONTROLLER owns root XZ.** It is stripped from every clip and
  republished as `speed` / `stride` metadata. Root Y is kept as a scaled deviation from rest,
  then the clip is grounded on the 10th-percentile toe height of OUR rig.
- **Transfer fidelity.** `scripts/animation/verify-retarget.mjs` compares each baked bone
  direction against the raw SOMA export, per frame. Worst error on a directly mapped pair:
  0.22 deg (`walk`), 0.11 deg (`crouch-walk`). Anything odd in a pose is therefore the model,
  not the retarget.

### Rejected clips - generated, measured, not shipped

A clip whose two allowed seeds both fail its acceptance is left in
`scripts/animation/prompt-library.json` with `"ship": false`. The pipeline still generates
it, still retargets it and still prints its numbers - the rejection has to stay reproducible -
but `retarget-soma.mjs` writes it to the scratch `_rejected/` directory instead of here and
keeps it out of `manifest.json`, so `clips.ts` substitutes nothing and the game uses the
AUTHORED clip of that name from `src/characters/clips.ts`.

| clip | seeds spent | measured | verdict |
|---|---|---|---|
| `idle` | 1001, 1201, 1202 (two in round 2) | surface top 1.633 m in the game (1001), 1.704 m and 1.706 m offline (1201, 1202) against a 1.858 m rest rig | **not shipped** - procedural |

The loss is not a lean: seed 1202 measures 5.9 deg of torso lean, well inside the 12 deg
bar. It is the cervical chain. On every seed the Neck->Head segment measures 0.058-0.097 m
of its 0.140 m rest length - a 46-65 degree bow - so the figure stands straight and looks at
its own boots, and the helmet comes down with the head.

The retarget is not the cause and that is measured, not assumed:
`scripts/animation/verify-retarget.mjs` puts the worst directly-mapped bone error on the
rejected idle at **0.313 deg**, so the pose is the model's.

The brief's fallback for a clip that spends both seeds is a CMU BVH. The authored clip was
chosen instead, for a stated reason: CMU has no standing idle at all (the gap that made this
whole library procedural-first - see the header of `src/characters/clips.ts`), and the
authored idle measures **1.838 m with 0.2-0.7 deg of lean** in the game, which no seed came
near. The procedural route is one of the three named in `docs/LICENCES-ANIMATION.md` and
carries no third-party obligation.

**`public/anim/idle.glb` is still on disk, and is dead.** It holds the seed-1001 bytes that
were committed before the rejection. It is absent from `manifest.json`, so
`kimodo-clips.ts` never fetches it and `clips.ts` never substitutes it - the file is
shipped weight and nothing else. It was briefly deleted on 2026-09-19 and the deletion was
blamed for a 404 every harness was logging; the 404 was **`/favicon.ico`**, in every run
before and after (`captures/anim/f1-audit.json` -> `missing`, which now records the URL).
The bytes were restored rather than left deleted because this lane does not commit and a
stray `D` in someone else's `git status` is a worse artefact than 23 kB. Delete it at
commit time if you want it gone; nothing loads it either way.

### Acceptance (obligation 6)

No clip was accepted from Kimodo's web demo preview. Round 1 photographed `walk` in the game
from four views (`captures/anim/canary-*.png`, by
`scripts/animation/capture-anim-views.mjs`, which refuses to open the shutter on a rig whose
hips are not moving). In-game foot slide for `walk`: 6.78 cm worst stride over 39 strides,
against 3.8 cm measured offline.

Round 2 (2026-09-19) measures the same thing from the **skinned surface** rather than the
bones, because that is where the 20 cm the first round missed was hiding: a helmet is 18 cm
of a figure's height and no bone carries it.
`scripts/animation/surface-audit.mjs` pushes every vertex through `applyBoneTransform` in the
running game and reads the top of the figure, the glove and the rifle off the result;
`scripts/animation/capture-anim-sheets.mjs` photographs both factions in four states from
four views. Measured through the real frame loop, carry layer on:

| state | surface top | torso lean | LeftHand to forestock | barrel vs chest forward |
|---|---|---|---|---|
| idle | 1.838 m | 0.5 deg | 4.0 cm | 18.8 deg |
| walk | 1.802 m | 6.4 deg | 4.0 cm | 18.8 deg |
| run | 1.755 m | 6.5 deg | 4.0 cm | 18.8 deg |
| aim | 1.735 m | 6.1 deg | 4.0 cm | 0.0 deg from the aim ray |

Each clip standalone, played whole through `playExternal` with the carry layer OFF: `walk`
1.816 m / 4.4 deg / 13.3 deg left abduction, `run` 1.776 m / 5.0 deg / 33.2 deg, `aim`
**1.804 m / 4.1 deg / 15.6 deg**, `sprint` 1.626 m / 7.7 deg / **39.0 deg**.

Two of those numbers are worth stating plainly rather than leaving in a table.

- **`aim` measures 1.804 m as a clip and 1.735 m as a state**, and both are right. The
  overlay masks `UPPER_BODY`, which starts at the Chest, so the composed figure is the
  procedural idle's spine carrying the aim clip's chest-and-up. The 7 cm is the head coming
  down to the sights, and it is visible as that in `captures/anim/f3-f{0,1}-aim.png`. The
  1.80 m bar was written for the clip; the clip clears it.
- **`sprint` peaks at 39.0 deg of left abduction in the game**, above the 35 deg the round-2
  bar set for the standing clips. It is a large improvement on seed 1104's 53.2 deg and it is
  a peak over a swing cycle rather than a pose, but it is over, and sprint has now spent
  three seeds (1004, 1104, 1204). Not re-rolled again.

Transfer fidelity of the two re-baked clips, `verify-retarget.mjs` against the raw SOMA
motion: `aim` worst directly-mapped bone error **0.192 deg**, `sprint` **0.202 deg**. Both
poses are the model's, not the arithmetic's.

Sheets (two factions x four states x four views, composed in-page):
`captures/anim/f3-f{0,1}-{idle,walk,run,aim}.png`. Live game frames:
`captures/anim/f3-live-spawnA.png`, `captures/anim/f3-live-figure.png`. Round-2 numbers and
the request log: `captures/anim/f1-audit.json`, budget `captures/anim/f2-audit.json`.

### What the weapon-carry layer does to these numbers

`src/characters/blend.ts` now solves both arms onto the weapon every frame: the right hand
(and therefore the rifle, which `mesh.ts` bakes to the RightHand bone) goes to a carry anchor
in chest space, and the left arm is solved by two-bone IK onto the rifle's forestock. So the
ARM data in these clips is overridden in the shipped path, and the abduction figures above
describe the clip, not the figure. The numbers that show what it is worth: with the layer off,
the left hand sits **75.9 cm** from the forestock in walk and **44.9 cm** in run, and the
barrel points **160.4 deg** away from chest-forward in run - the rifle aims backwards over the
figure's shoulder. With the layer on, 4.0 cm and 18.8 deg in every state.

Nothing below the Chest is touched, and that is measured rather than argued: in-game walk
foot slide over three interleaved runs per arm is 10.23 cm mean with the layer on against
9.90 cm with it off - a 0.33 cm difference inside a 0.63 cm within-arm spread
(`captures/anim/f1-audit.json` -> `skateSummary`; an earlier pair of runs gave 9.85 / 10.29,
same conclusion with the sign of the difference flipped, which is what "inside the noise"
means). In-game walk slide runs ~10 cm against 3.8 cm measured offline for the same clip;
that gap predates this layer and is unchanged by it.

---

## 2. CMU Graphics Lab Motion Capture Database - the `.anim.json` fallback set

Fetched 2026-09-18 by `scripts/fetch-anim.mjs`, before the Kimodo route existed. These files
stay on disk as the per-clip fallback the brief requires, and their record is preserved here
unchanged. They are **not** loaded by the runtime today: `src/characters/kimodo-clips.ts`
reads `manifest.json` and the `.glb` set. The original CMU manifest is kept beside them as
`manifest-cmu.json`.

| clip | file | source | licence |
| --- | --- | --- | --- |
| walk | walk.anim.json | https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/007/07_01.bvh | CMU Graphics Lab Motion Capture Database - free for all uses, no registration (http://mocap.cs.cmu.edu/) |
| run | run.anim.json | https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/009/09_01.bvh | CMU Graphics Lab Motion Capture Database - free for all uses, no registration (http://mocap.cs.cmu.edu/) |
| sprint | sprint.anim.json | https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/009/09_05.bvh | CMU Graphics Lab Motion Capture Database - free for all uses, no registration (http://mocap.cs.cmu.edu/) |
| crouch-walk | crouch-walk.anim.json | https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/136/136_09.bvh | CMU Graphics Lab Motion Capture Database - free for all uses, no registration (http://mocap.cs.cmu.edu/) |
| jump | jump.anim.json | https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/016/16_05.bvh | CMU Graphics Lab Motion Capture Database - free for all uses, no registration (http://mocap.cs.cmu.edu/) |
| turn-left | turn-left.anim.json | https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/016/16_41.bvh | CMU Graphics Lab Motion Capture Database - free for all uses, no registration (http://mocap.cs.cmu.edu/) |
| turn-right | turn-right.anim.json | https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/016/16_43.bvh | CMU Graphics Lab Motion Capture Database - free for all uses, no registration (http://mocap.cs.cmu.edu/) |
| pirouette | pirouette.anim.json | https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/bvh/pirouette.bvh | three.js example model (mrdoob/three.js, MIT licence) - loader/retarget path proof only |

CMU Graphics Lab Motion Capture Database - free for all uses, no registration
(http://mocap.cs.cmu.edu/). `pirouette.anim.json` is a three.js example model (MIT), kept as
a loader-path proof only.

### Where the fallback actually stands

`sprint` is the one clip that spent both of its allowed seeds without reaching its target.
Kimodo would not produce a gait above ~2.9 m/s at either seed, and `blend.ts` only selects
`sprint` above 4.1 m/s, so the shipped sprint will play at roughly 1.5x timeScale. The CMU
replacement (`sprint.anim.json`, CMU 09_05) is on disk and `animJsonToClip` in
`src/characters/retarget.ts` can load it, but the substitution loop in `clips.ts` reads the
`.glb` registry only, so the swap is **not wired**. That is the next step for this clip, not
a claim that it is done.

---

## Deliberately not used (owner constraint: no sign-up, no key, no EULA click-through)

- Mixamo / Adobe - requires an Adobe login. Rejected permanently; do not ask again.
- Reallusion / ActorCore, Meshcapade / SMPL, Ready Player Me, Sketchfab - accounts or keys.
- Kimodo SMPL-X RP checkpoint - internal-R&D licence forbids distributing derivatives.
