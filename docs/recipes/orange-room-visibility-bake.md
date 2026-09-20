# Bounded room visibility bake

September20 16:10BST, single Astra. The analytical aperture approximation plateaued
and is rejected. This is a different artifact route: export the actual authored
house triangles, raycast those triangles with Blender's BVH on CPU, and sample a
six-direction visibility volume in the game's existing indirect-lighting term.
It is static ambient visibility, **not** global illumination, path-traced gameplay
or a generated mesh. Direct lighting, collision and game events remain authoritative.

Frozen first proof:32x28x24 voxels,64 deterministic directions,8m ray distance;
two RGBA8 volumes (172,032 bytes total). No runtime raycasting or frame allocations.
The bake excludes transparent glazing and uses actual furniture/wall triangles.
The positive and negative cosine lobes preserve orientation. A bounded distance
term approximates diffuse room fill; this is explicitly not a measured bounce.

Accept only after same-camera orangeLiving/interiorOrange/orangeUpper gameplay
frames show stronger contact and daylight falloff without crushed navigation,
exterior changes, texture banding, material-cache aliasing or runtime errors.
Run existing collider/cache tests and unchanged active-game210s gate. Two repairs
maximum after first proof; preserve4245 if it fails. Full frozen visual bar remains
binding and cannot be inferred from a passing bake.

Primary API references: https://threejs.org/docs/pages/Data3DTexture.html and
https://docs.blender.org/api/current/mathutils.bvhtree.html . Runtime API is checked
against installed Three r180 and local Blender5.1.2, not assumed from upstream HEAD.
Use AKP scripts/blender/bridge.py cli with its2threads/180seconds/2GiB guard.
