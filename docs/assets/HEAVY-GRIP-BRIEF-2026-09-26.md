# Heavy-weapon contact study — Dream/Gauntlet next canary

VERIFIED built-in imagegen created `references/heavy-weapon-grip-v1.png` from
actual `captures/salvage-after-sights-minigun-minigun-hip.png`, retained separately.
SHA256 `e4ead1ecc668985cd92222bf78dc0495dad7e1380b7a03b2ca77fcbeec51ae43`.
It is a contact/material reference, not a mesh, rig, clip or in-game acceptance.

VERIFIED visible reference: opposing thumb/finger contact at rear trigger grip,
left glove around upper support handle, connected forearms and distinct barrel
materials. OPEN: the concept changes some gun details and is more realistic than
the current stylized game. Transfer hand-contact principles only; retain the
original imported gun geometry, period palette and readable game silhouette.
Do not treat imagegen's invented mechanics as a measured source specification.

## Frozen canary

- One Minigun grip/forearm fit first, not a whole-roster hand replacement.
- Preserve editable input GLB, its 13 embedded inactive source clips, eight sockets,
  source hashes, reload/motion bind and fallback. No changes to shot authority.
- Fit visible thumb opposition, trigger-side fingers and support-hand wrap to
  actual decoded handle geometry, not only a coincident palm/socket or broad AABB.
- Retain hand budget at most4,000triangles/12meshes; no added per-frame resource
  allocation, textures or lights. Retain weapon16mesh/16ktriangle caps.
- Compare the same1600x900 hip/ADS views with the retained baseline, neutral
  inspection and a brief firing/reload/turn clip. Do not crop out the grip gap.
- Aim remains visible; existing socket alignment and ADS aperture checks stay.
  Any new aim mark must have its own contrast/size proof, not hide a ray blocker.
- Independent criterion: grasp/contact>=7/10 with no disconnected wrists,
  merged/missing digits or impossible support. Also preserve framing, materials,
  motion, disposal, FPS and memory. Current hands4/10 remain OPEN.
- Initial edit plus at mosttwo named localized repairs; preserve rejected takes.
  Run one actual game canary before extending to other rigs.

## Generation intent

Original standalone six-barrel stylized retro-futurist heavy weapon with two
visible work-gloved hands, right palm seated on rear trigger grip and index
alongside guard, other fingers wrapped with thumb opposition; left glove wraps
upper carrying/support handle. Connected plausible wrists/forearms. Compact
first-person composition, central aiming lane open, restrained worn steel,
tan canvas/dark rubber gloves, neutral grey background and soft daylight.
No HUD, scenery, labels, logos or extra fingers. Actual game frame supplies style
and mechanical silhouette context; reference supplies visible contact targets.
