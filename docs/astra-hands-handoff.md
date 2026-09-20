# Pistol hand asset — CPU-passing opt-in candidate

VERIFIED: Final source `8c0549e5268d213005462e5f33de1f4768f37b15` adds a
contact-aware path to the fixed r1 geometry. The unchanged frozen verifier passes
241 reload samples. An additional audit passes 1,205 reload/offhand combinations
and 980 crouch/prone/ADS/offhand poses (level camera), minimum worldY 34.981mm
against the unchanged 20mm floor threshold. Physical palm seat error is numerical
noise. No geometry or verifier threshold was relaxed. Default controller regression
passes 6,970 frames and 172 exact claims; typecheck and build pass.

OPEN: Actual game art and temporal acceptance remain with root. Use
`?motion=canary&hands=rigged`; the candidate remains opt-in. Integration order after
the parent's motion commits is b49fc9a, 6a76a9e, cb3bed8, 8c0549e and this evidence
commit. See the machine-readable `astra-hands-handoff.json` and recording recipe.

The contact-aware approach was frozen before source changes in cb3bed8. Initial
attempt r0 used the real palm surface and a clear withdrawal/vertical seat path but
left 3.013mm thumb penetration at the seat. Motion repair one pitched that wrist
-0.10 radians, selected from measured fixed-geometry clearance. The reload gate
passed, but an added offhand audit exposed the legacy straight pose blend cutting
through the grip. Repair two rewinds along the same clear contact path as offhand
ownership increases, only for the new rig. All final gates then passed. Both motion
repairs are spent. Any next change needs a new pixel-led approach.

The first extra floor diagnostic used crouched=false with prone=true and failed;
actual main.ts supplies crouched=getStance()!=='stand'. That invalid-input diagnostic
is retained and named explicitly. The corrected additional harness uses the actual
runtime input. The original frozen 241-frame verifier was never edited.

The frozen geometry-region hash is computed with normalized LF. The verifier raw
hash was unchanged in this author worktree; the JSON also provides a normalized LF
hash so Windows checkout line endings cannot be mistaken for a semantic change.
Reported zero maximum excess penetration means no sample exceeded the frozen
limit; it does not mean every sample has zero penetration. Samples include actual
mesh vertices and triangle centres, not a formal continuous swept-volume proof.

Final bundle `index-D6-0J-w2.js` SHA256:
`497a3233e521e23c5c83a5622aafaa816ba39d987dc67a77a2d617fd63728aa1`.

## Preserved geometry checkpoint and failed trials

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

OPEN / BLOCKED at 6a76a9e: That checkpoint alone is for visual and rig review, not gameplay promotion.
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

## Frozen approach followed by the final candidate

Keep r1 geometry and the frozen static contract unchanged. Introduce a pistol-only
trajectory that uses the physical palm contact point, withdraws outside the grip
before descending, and approaches the magazine seat from below. Freeze the same
241-frame solid limits (2mm grip/panels, 1mm slide/frame/guard), 8mm physical seat
error and 1mm wrist/length limits before editing. A maximum of two localized motion
repairs is allowed. Preserve every failure and never weaken these gates.
