# Independent Minigun stills critique — 2026-09-26

**OPEN — Decision: refine-code.** The canary is visibly improved, but does not meet the frozen requirement that every criterion reach 7/10 with no unresolved critical contact/anatomy/support/aim blocker. Do not promote this as accepted hands or extend it across the roster on these stills.

VERIFIED — Independent critic inspected the frozen `HEAVY-GRIP-BRIEF-2026-09-26.md`, `references/heavy-weapon-grip-v1.png`, and all six paired Minigun PNGs in `captures/overnight-heavy-grip-baseline-attempt2/` and `captures/overnight-heavy-grip-canary-attempt1/`: hip, ADS, neutral-sky, firing, reload and turn. Each PNG was opened through `view_image` at original detail and independently measured as 1600×900; no crop or altered lighting was used. No builder source, proof, implementation rationale or self-grades were read before grading. Magnum is outside this critique.

CLAIMED — Integrator supplies capture identity as baseline `ac3…` versus canary `2f4…`, with `heavy-hands=canary`, one actual Recruit and unchanged life. VERIFIED — Current checkout is `salvage/full-game-20260926` at `2f4d577227416c0f1a52dc65002534e019d11947`. This checkout read alone does not bind the screenshots to that build; retained PNG hashes below bind the critique to inspected pixels.

| Canary criterion | /10 | Judgment from inspected stills |
|---|---:|---|
| Right trigger grasp/contact | 4 | OPEN — Rear housing conceals the grasp in hip, firing and turn. ADS exposes a tan side lobe, but not a readable index/trigger/thumb relationship. |
| Left support grasp/contact | 6 | OPEN — Palm sits over the support bar and four dark finger shapes are distinct in ADS. A separate opposing thumb and a convincing curl around the bar are not readable. |
| Connected wrists and digit plausibility | 6 | OPEN — The visible left sleeve/cuff/palm is continuous. Four fingers can be counted; four fingers **plus** a distinct opposing thumb cannot be established. Most right-hand anatomy is occluded. No assertion of an actually missing digit or disconnected hidden wrist is made. |
| Framing and original gun identity | 8 | VERIFIED — Acceptable in these stills. Smaller coverage exposes the arm and more scene; the original barrel cluster, round receiver, rails and rear silhouette remain recognizable. |
| Aim-reference visibility | 7 | VERIFIED — Acceptable in these stills. Hip crosshair remains clear and the small ADS chevron is visible above the glove/bar; no observed central aim occlusion. OPEN — Contrast across other backgrounds and exact alignment remain outside pixel-only proof. |
| Material/palette coherence | 7 | VERIFIED — Acceptable for the existing stylized game. Olive sleeve, tan glove and dark rubber sit reasonably with the retained dark steel/silver weapon. The reference's photoreal fabric detail is not required or copied. |
| Reload sampled pose | 5 | OPEN — Left glove becomes almost entirely concealed at the receiver/drum junction; the visible tan cap does not communicate a usable contact. One sampled pose cannot establish whether the reload motion is correct. |
| Turn sampled pose | 6 | OPEN — Visible left wrist remains connected and aiming space remains open, but the same unresolved support-thumb and hidden trigger-grasp defects persist. |

VERIFIED — Against baseline, the conspicuous improvement is visible support-arm involvement and more compact framing. Baseline hip/ADS/firing/turn show no assessable visible hand contact, so absence of a visible baseline hand is not proof that the underlying rig lacked one. Gun material character remains broadly consistent.

## Two localized repair targets only

1. **OPEN — Left support glove shape and seating.** In canary ADS, approximately x620–790/y465–620, four blunt dark fingers hang below a single tan palm mass; the thumb does not oppose them visibly. In reload, approximately x960–1025/y603–662, almost the whole glove is hidden at the body/drum junction. Fit the existing glove locally to show a separate thumb opposing curved fingers around the real support bar; at the retained reload sample, expose a legible hand-to-part contact. Preserve the gun mesh, camera and palette. This is one local hand-contact repair, not a redesign.
2. **OPEN — Right trigger grasp visibility/fit.** In canary ADS, approximately x1030–1150/y739–866, only a tan lobe and dark cuff edge emerge beside the housing; hip and turn conceal the grasp behind the large rear block. Adjust the right-hand pose/fit so the seated palm, trigger-side index and opposing thumb can be read at the actual grip without changing the original gun or hiding the problem through a new camera. A neutral side/three-quarter view must distinguish legitimate occlusion from poor seating before claiming geometry is wrong.

OPEN — True neutral front/side/three-quarter inspection and a firing/reload/turn motion clip are still required. The sky view is the gameplay orientation against sky, not an independent neutral inspection. Temporal contact, recoil/reload transitions, clipping between samples, performance, memory/disposal, socket correctness and owner acceptance are not established by this critique. The unresolved contact/anatomy bar blocks acceptance even though no definite impossible support or disconnected wrist is proven by these limited views.

## Retained image identity

VERIFIED — SHA-256 values read from the inspected originals; all are 1600×900.

| Minigun view | Baseline attempt2 SHA-256 | Canary attempt1 SHA-256 |
|---|---|---|
| ADS | `85d9373e75e58f53cb53510b37ce93a36311724301b1c843a5d2cda20420f37f` | `f9714af976ebfdc34e12bc9aeb02fc7378d768439f65bc84e974e5c6615911e6` |
| Firing | `e9c6065befd8aee87416edb40d8b034a653240ef88ab23a871bcaa70f9a1c18d` | `36e4e19639ca7ed5c8e5281459b5e912c704df99407d1f4cd285c4e95b65f2fc` |
| Hip | `2a8a7168b5f0962ca67190e02308adc6d5757d4ac74f18858db4cad95d0a2c0a` | `57f1b4a63a254b7831f2b39d64ea4a239e50540b263b33cbf15d13d8c3fcbaa9` |
| Neutral-sky | `32f72cb3f8071701338f6464495b44041fe55a1fdad5ea8cc4210414c79f9e5e` | `85a7b82eb38606a8629d2f51d80bd1e00ba1ad48cd04039ed3613abf4fbc33c5` |
| Reload | `a4ff20408926f822dec4824a5a42a04a763832dcbc9611e158ef8c57b50507b4` | `cc09d0a003362af4018cacd8a9ee03faa6e41fdde94ddfb495415f815100b4f1` |
| Turn | `a62e53b9388ddda93bd995e07d1c6c98f6c53b990a414bd8fa253734f4d59c86` | `3e5f5e9b2d1072db26affa29ee892d6f73fa8cc1fe14ccc8c4f70118a759e9f7` |
