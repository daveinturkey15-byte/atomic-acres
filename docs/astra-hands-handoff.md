# Pistol hand asset — blocked geometry checkpoint

VERIFIED: `hands=rigged` is an independent opt-in pistol-family asset, authored by
Codex / requested `gpt-6-astra`, xhigh. Its twelve meshes contain 4,836 triangles:
four curved fingers and one thumb per hand, shaped forearms, palms, cuffs and glove
panels. It uses three shared materials and no new textures. Other weapon families
and the default query remain unchanged. Muse0558 supplied no accepted geometry.

VERIFIED: The geometry contract was frozen in b49fc9ab7983fa53fd97c931828d98cb62e7db4f
before authoring. The timestamp correction in this checkpoint matches that commit's
actual 06:29:51 BST time; no numerical acceptance threshold changed.

VERIFIED: r0 failed thumb/weapon penetration and unused pole normals. Repair one
(r1) passed static actual-weapon solid, envelope, four-finger, index contact, normal,
wrist, length and budget checks. Repair two (r2) tried smaller glove panels and an
overlapping cuff; one cuff vertex exceeded the frozen 9cm X envelope. r2 is retained
as failed; source was restored to r1 under the two-repair cap.

VERIFIED: A stronger temporal audit then falsified r1's usable reload: 78 of 241
sampled frames exceed the actual weapon-solid penetration limits, worst 18.998mm
at progress 0.6333. The real palm surface misses the seat by 41.035mm. The earlier
static-only receipt incorrectly treated palm-centre alignment as surface contact;
it is retained as limited evidence, superseded by `geometry-r1-temporal-fail.json`.

OPEN / BLOCKED: This checkpoint is for visual and rig review, not gameplay promotion.
The glove panels are oversized and the cuff seam is visible in the CPU silhouette
study. Actual game comparison, hand-to-hand overlap, moving finger articulation,
extreme camera pitch, material appearance and renderer cost remain unaccepted.

VERIFIED: `node scripts/verify-viewmodel-motion.mjs` still passes 6,970 real-controller
simulation frames and 172 exact action claims; `npm run check` and `npm run build`
pass. The new hand verifier intentionally fails. No browser/GPU job was run here.
Built bundle `index-Dux0RUTq.js` SHA256:
`f46ce5b7df6b0596f6eb81ffabb1078faf9de0f37d783b15f7589889e4600736`.

The parent has integrated motion d4406fd and evidence eb77c1a plus the required
main.ts prone sample. This child viewed the parent's real 03 reload, 15 pistol
reload and 17 prone frames in `captures/astra-motion-0634`: magazine reach is now
readable, while the baseline hands still have round mitten silhouettes.

## Next authorized approach

Keep r1 geometry and the frozen static contract unchanged. Introduce a pistol-only
trajectory that uses the physical palm contact point, withdraws outside the grip
before descending, and approaches the magazine seat from below. Freeze the same
241-frame solid limits (2mm grip/panels, 1mm slide/frame/guard), 8mm physical seat
error and 1mm wrist/length limits before editing. A maximum of two localized motion
repairs is allowed. Preserve every failure and never weaken these gates.
