# Atomic Acres restart — feature and art refinement

Status on 2026-09-24. This is the September17 restart in `Desktop/stuff/nuketown`,
branch `layout-boii-proportions`. The older `atomic-acres-browser-arena` tree is a
behavior and measurement reference. Nothing from its assets, code, or history is
copied into this repository.

## Verified first increment

- LAN WebRTC: two real Chrome profiles joined, readied, entered a match,
  exchanged movement and an authoritative kill, and stayed connected for 120 s
  on this machine. Eleven connection samples were good. The host tracked the
  guest's pose within the frozen 200 ms bound.
- Signal ordering: ICE candidates can arrive before an offer or answer because
  signalling requests are independent. `src/net/rtc.ts` now retains up to 64
  early candidates per peer until remote SDP is set. It also preserves an
  already-connected game channel when the signalling EventSource reconnects,
  closes a replaced peer, and reports HTTP signalling refusal accurately.
  With SDP held 500 ms by the relay's QA mode, the two-browser match passed;
  the relay measured six ICE candidates delivered before SDP.
- Pure network proof: the Node entrypoint was stale under extensionless
  TypeScript imports. `scripts/_verify-net-proof.mjs` bundles it as the game
  build does. Its 120 s virtual loss/jitter proof passed, including authority,
  interpolation, cleanup, and bounded prediction error.
- The Stampede LMG and Varmint marksman rifle now have distinct first-person
  silhouettes and muzzle/ejection anchors. Actual match captures show the two
  models and their ammo. Draw calls were 753/750 at the capture point; the
  unchanged four-view gameplay gate passed at 1161/761/1158/972 calls.
- The HUD streak strip now follows the current catalog's four-slot contract,
  shows full names and the `3`–`6` keys, and has a legible backing panel. The
  duplicate debug ammo line over the minimap was removed. Eighteen menu
  screens passed, including a real match end and 1280×720 layouts.
- `npm run check` and `npm run build` passed. The visual captures were opened.

## Remaining feature work

The current roster has seven playable gun definitions against the old game's
21 named weapons. This is an archetype and feature gap, not an instruction to
copy proprietary names or meshes. Projectile, flame, pickup, and specialist
archetypes need their own authority, presentation, and balance checks. The
current streak catalog has ten rows, of which five have arena effects; the
  remaining rows must gain honest in-world behaviors or be removed from player
  selection. Tracker Dart has pure host logic but no minimap blip consumer;
  that consumer needs a host-to-client reveal field so solo and LAN guests
  share the same rule.

The current menu already ships solo rules, room hosting/joining, options and
credits. It does not yet offer a weapon and streak loadout picker comparable
to the older project's feature set. HUD and menu additions must follow the
same host-owned state and survive the existing eighteen-screen capture.

The network evidence is one machine using two browsers plus a deterministic
loss/jitter simulation. It does not establish two physical machines, LAN
interference, cross-household WAN, NAT traversal, or TURN operation. Rejoin,
host departure, long sessions and actual device/connection diversity need
separate acceptance. A public signal URL alone cannot prove WAN play.

The game already loads baked Kimodo clips. The sprint clip was captured in
four in-game views; its worst measured foot skate is 5.9 cm, so animation art
acceptance remains open. A new Trellis.2/Pixal3D asset cannot be claimed:
ComfyUI was not listening on the checked local ports in this pass, and no
running ComfyUI process was found. The pipeline must establish the server's
actual model root and route weights, then pass scale, topology, material,
performance, licence, and in-game visual gates before an asset ships.

## Delivery estimate and acceptance order

This is a planning estimate for one focused developer, assuming a working
local generation service and timely visual review. Work can overlap where
contracts are stable, but quality gates cannot be skipped.

1. **Combat and menus — 8–12 working days.** Build the missing weapon
   archetypes in small groups, finish/select the remaining streak effects,
   add loadout controls, then prove host authority and the matching HUD.
2. **Multiplayer — 5–8 working days.** Exercise reconnect, room teardown,
   loss and jitter, long sessions and two physical LAN machines. A reliable
   cross-household WAN tier with an owned STUN/TURN service adds roughly
   **4–7 working days** and needs its own security and cost decision.
3. **Graphics and animation — 10–18 working days.** Choose original hero
   concepts, run one bounded Trellis.2/Pixal3D mesh canary, retopologize and
   bake only accepted assets, integrate them at scale in the game, and improve
   Kimodo retarget/contact until in-game motion passes measured foot-slide
   and visual review. Keep the procedural map/colliders authoritative.
4. **Integrated acceptance — 3–5 working days.** Run the exact built preview,
   combat, menu, traversal, multiplayer, soak and representative visual gates
   together, then fix issues found by playtesting.

**ETA:** about **5–8 focused working weeks** for the requested polished local
version; a WAN-ready multiplayer release may take **1–2 more weeks**. A
playable preview with a substantially expanded combat roster is possible in
**2–3 weeks**. These are
estimates, not completion claims; ComfyUI availability, asset quality and
real-network test access are the largest schedule risks.
