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
| `idle.glb` | 1001 | 49 | 1.60 s | 0.01 m/s | 1.4 cm | 0.147 | `f22c5865482a1e1f` |
| `walk.glb` | 1102 | 26 | 0.83 s | 1.97 m/s | 3.8 cm | 0.124 | `a55cd27acf3ac3b4` |
| `run.glb` | 1003 | 18 | 0.57 s | 2.67 m/s | 6.2 cm | 0.126 | `e47dbee53455e1b9` |
| `sprint.glb` | 1104 | 20 | 0.63 s | 2.74 m/s | 0 cm | 0.268 | `86036f854e1639e2` |
| `crouch-idle.glb` | 1105 | 53 | 1.73 s | 0.00 m/s | 0.5 cm | 0.030 | `b9deca0259f834d2` |
| `crouch-walk.glb` | 1106 | 31 | 1.00 s | 1.40 m/s | 2.4 cm | 0.138 | `5a0b2dbba4761e8b` |
| `aim.glb` | 1007 | 49 | 1.60 s | 0.00 m/s | 0.5 cm | 0.036 | `ed6f65fb7b97d3fa` |
| `aim-rifle-walk.glb` | 1008 | 20 | 0.63 s | 1.95 m/s | 1.4 cm | 0.081 | `5482a68569fe0b3b` |
| `jump.glb` | 2001 | 75 | 2.47 s | 0.20 m/s | n/a (one-shot) | 0.358 | `e4d55931b19b445b` |
| `land.glb` | 2002 | 60 | 1.97 s | 0.05 m/s | n/a (one-shot) | 1.479 | `6a7fbe86cdfc633a` |
| `turn-left.glb` | 2003 | 75 | 2.47 s | 0.01 m/s | n/a (one-shot) | 1.795 | `9811633424e0dbee` |
| `turn-right.glb` | 2004 | 75 | 2.47 s | 0.00 m/s | n/a (one-shot) | 1.935 | `230111f5332f4453` |
| `fire.glb` | 2005 | 45 | 1.47 s | 0.00 m/s | n/a (one-shot) | 0.202 | `c44e18755b866a71` |
| `reload.glb` | 2006 | 100 | 3.30 s | 0.00 m/s | n/a (one-shot) | 0.881 | `25ab0d44ac461cec` |
| `hit-react.glb` | 2007 | 60 | 1.97 s | 0.00 m/s | n/a (one-shot) | 0.826 | `a393cd38c9c874f9` |
| `death.glb` | 2008 | 110 | 3.63 s | 0.07 m/s | n/a (one-shot) | 7.637 | `d18310d9a27567d7` |

### Prompts

- `idle` - seed 1001, 49 keys
  > a soldier stands still at ease holding a rifle across his chest, weight shifting slightly, small natural sway, breathing
- `walk` - seed 1102, 26 keys
  > a soldier walks forward slowly and casually at an unhurried stroll, short relaxed steps, arms swinging gently, loopable
  **Second seed.** second seed. The first (1002, 'steady relaxed pace') measured 2.14 m/s at the planted foot - a jog, not a walk, and the blend tree would have played it at half timeScale for a 1.1 m/s character.
- `run` - seed 1003, 18 keys
  > a soldier jogs forward at a steady pace holding a rifle at the ready, elbows bent, even strides, loopable
- `sprint` - seed 1104, 20 keys
  > a soldier sprints flat out at top speed, very long powerful bounding strides, both feet leaving the ground, arms driving hard, body low and forward
  **Second seed.** second seed. The first (1004) measured 2.90 m/s, inside the blend tree's RUN band (2.3-4.1); a sprint clip must sit above 4.1 to ever be selected on its own terms.
- `crouch-idle` - seed 1105, 53 keys
  > a soldier holds a half-kneeling combat crouch with his back straight and chest up, knees bent, rifle shouldered, steady
  **Second seed.** second seed. The first (1005) put the pelvis at 0.288 m - sitting on the heels, head at 0.89 m. A combat crouch keeps the torso upright, so the prompt now says so instead of saying 'low'.
- `crouch-walk` - seed 1106, 31 keys
  > a soldier advances in a combat crouch, back straight and chest up, knees bent, taking short steady steps, rifle shouldered, loopable
  **Second seed.** second seed. The first (1006, 'torso low') produced a duck-walk: pelvis 0.52 m with the torso near horizontal. Photographed at captures/anim/crouchwalk-side.png before the re-roll.
- `aim` (prompt id `aim-rifle-idle`) - seed 1007, 49 keys
  > a soldier stands still aiming a rifle straight ahead with both hands, elbows tucked in, holding steady
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

### Acceptance (obligation 6)

No clip was accepted from Kimodo's web demo preview. `walk` was photographed **in the game**,
through the game's own frame loop, from four camera views:

- `captures/anim/canary-front.png`
- `captures/anim/canary-side.png`
- `captures/anim/canary-threequarter.png`
- `captures/anim/canary-low.png`

by `scripts/animation/capture-anim-views.mjs`, which refuses to open the shutter on a rig
whose hips are not moving (it has fired, on a real frozen rig). In-game foot slide for
`walk`: 6.78 cm worst stride over 39 strides, against 3.8 cm measured offline.

---

## 2. CMU Graphics Lab Motion Capture Database - the `.anim.json` fallback set

Fetched 2026-09-18 by `scripts/fetch-anim.mjs`, before the Kimodo route existed. These files
stay on disk as the per-clip fallback the brief requires, and their record is preserved here
unchanged. They are **not** loaded by the runtime today: `src/characters/kimodo-clips.ts`
reads `manifest.json` and the `.glb` set. The original CMU manifest is kept beside them as
`manifest-cmu.json`.

| clip | seed | keys | duration | speed | foot slide | loop seam | embedding sha256 |
|---|---|---|---|---|---|---|---|
| `idle.glb` | 1001 | 49 | 1.60 s | 0.01 m/s | 1.4 cm | 0.147 | `f22c5865482a1e1f` |
| `walk.glb` | 1102 | 26 | 0.83 s | 1.97 m/s | 3.8 cm | 0.124 | `a55cd27acf3ac3b4` |
| `run.glb` | 1003 | 18 | 0.57 s | 2.67 m/s | 6.2 cm | 0.126 | `e47dbee53455e1b9` |
| `sprint.glb` | 1104 | 20 | 0.63 s | 2.74 m/s | 0 cm | 0.268 | `86036f854e1639e2` |
| `crouch-idle.glb` | 1005 | 49 | 1.60 s | 0.00 m/s | 2.2 cm | 0.225 | `ae8a9eb59d82fff0` |
| `crouch-walk.glb` | 1006 | 31 | 1.00 s | 1.44 m/s | 7.9 cm | 0.131 | `6fcb7975ce1a66a1` |
| `aim.glb` | 1007 | 49 | 1.60 s | 0.00 m/s | 0.5 cm | 0.036 | `ed6f65fb7b97d3fa` |
| `aim-rifle-walk.glb` | 1008 | 20 | 0.63 s | 1.95 m/s | 1.4 cm | 0.081 | `5482a68569fe0b3b` |
| `jump.glb` | 2001 | 75 | 2.47 s | 0.20 m/s | n/a (one-shot) | 0.358 | `e4d55931b19b445b` |
| `land.glb` | 2002 | 60 | 1.97 s | 0.05 m/s | n/a (one-shot) | 1.479 | `6a7fbe86cdfc633a` |
| `turn-left.glb` | 2003 | 75 | 2.47 s | 0.01 m/s | n/a (one-shot) | 1.795 | `9811633424e0dbee` |
| `turn-right.glb` | 2004 | 75 | 2.47 s | 0.00 m/s | n/a (one-shot) | 1.935 | `230111f5332f4453` |
| `fire.glb` | 2005 | 45 | 1.47 s | 0.00 m/s | n/a (one-shot) | 0.202 | `c44e18755b866a71` |
| `reload.glb` | 2006 | 100 | 3.30 s | 0.00 m/s | n/a (one-shot) | 0.881 | `25ab0d44ac461cec` |
| `hit-react.glb` | 2007 | 60 | 1.97 s | 0.00 m/s | n/a (one-shot) | 0.826 | `a393cd38c9c874f9` |
| `death.glb` | 2008 | 110 | 3.63 s | 0.07 m/s | n/a (one-shot) | 7.637 | `d18310d9a27567d7` |

### Prompts

- `idle` - seed 1001, 49 keys
  > a soldier stands still at ease holding a rifle across his chest, weight shifting slightly, small natural sway, breathing
- `walk` - seed 1102, 26 keys
  > a soldier walks forward slowly and casually at an unhurried stroll, short relaxed steps, arms swinging gently, loopable
  **Second seed.** second seed. The first (1002, 'steady relaxed pace') measured 2.14 m/s at the planted foot - a jog, not a walk, and the blend tree would have played it at half timeScale for a 1.1 m/s character.
- `run` - seed 1003, 18 keys
  > a soldier jogs forward at a steady pace holding a rifle at the ready, elbows bent, even strides, loopable
- `sprint` - seed 1104, 20 keys
  > a soldier sprints flat out at top speed, very long powerful bounding strides, both feet leaving the ground, arms driving hard, body low and forward
  **Second seed.** second seed. The first (1004) measured 2.90 m/s, inside the blend tree's RUN band (2.3-4.1); a sprint clip must sit above 4.1 to ever be selected on its own terms.
- `crouch-idle` - seed 1005, 49 keys
  > a soldier crouches down low on bent knees and holds still, torso upright, rifle held ready
- `crouch-walk` - seed 1006, 31 keys
  > a soldier moves forward in a low crouch with deeply bent knees, torso low, short careful steps, loopable
- `aim` (prompt id `aim-rifle-idle`) - seed 1007, 49 keys
  > a soldier stands still aiming a rifle straight ahead with both hands, elbows tucked in, holding steady
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

### Acceptance (obligation 6)

No clip was accepted from Kimodo's web demo preview. `walk` was photographed **in the game**,
through the game's own frame loop, from four camera views:

- `captures/anim/canary-front.png`
- `captures/anim/canary-side.png`
- `captures/anim/canary-threequarter.png`
- `captures/anim/canary-low.png`

by `scripts/animation/capture-anim-views.mjs`, which refuses to open the shutter on a rig
whose hips are not moving (it has fired, on a real frozen rig). In-game foot slide for
`walk`: 6.78 cm worst stride over 39 strides, against 3.8 cm measured offline.

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
