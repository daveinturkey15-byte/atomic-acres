# Atomic Acres - September17 restart, September26 salvage

Dave's active isolated salvage candidate is the **new Atomic Acres repository**,
`daveinturkey15-byte/atomic-acres`, branch `salvage/full-game-20260926`.
Start with [the current handoff](docs/handoff/START_HERE.md),
[CURRENT.json](docs/handoff/CURRENT.json), and [AGENTS.md](AGENTS.md).

This candidate recovers this repository's richer September20 source: authored
PBR scenery, camera-local hands, Kimodo animation clips, persistent classes, twenty
weapon mechanics, four chosen streak slots, and authoritative multiplayer.
VERIFIED local menu, gameplay, reconnect, two-browser delayed-SDP, traversal,
lighting and 210-second soak gates passed. Final art, sustained 60 FPS and physical
LAN/WAN remain OPEN; see the source-bound evidence in the handoff.

Local candidate preview: http://localhost:4348/ (when running).
Use **Play solo**, choose your class/streaks, then **Deploy**.
Click the game to capture the pointer. WASD moves, mouse looks, left click fires,
right click aims, Shift sprints, Space jumps, C/Ctrl crouches, and Z toggles prone.
R reloads; 1/2 select primary/sidearm; 3–6 use earned streaks and 7 the banked bonus.
Escape opens the menu.
The served `preview-identity.json` binds source SHA and built script bytes.
The simpler `layout-boii-proportions` branch/4188 preview is preserved separately.
Production/master/Pages have not been replaced.

The older `atomic-acres-browser-arena` project supports reference measurements
and lessons. Dave's September26 evening update also permits useful asset reuse
with source hashes/provenance and actual in-game review. Do not import old
modules, build scripts or Git history. Keep this restart as the active game.

Run `npm run check`, `npm run build`, and the focused gameplay gates recorded
in the current handoff. Look at actual game frames; a successful build is not
visual acceptance. Commit reviewed runtime inputs before stamping a preview.
