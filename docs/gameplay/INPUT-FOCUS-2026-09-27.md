# Game input and movement repair receipt

VERIFIED: runtime checkpoint `5cc3a2692470a971aeadb7cedf868fd6b6a25cf9`, NEW September17 restart. Held preview `http://127.0.0.1:4361/`. This is source/CPU/build evidence; current browser/gameplay acceptance is OPEN.

## Mouse capture gotcha

VERIFIED symptom: the actual owner4348 in-app browser rendered a match after Deploy without mouse capture. A subsequent native canvas click raised `WrongDocumentError` because the canvas root document could not acquire pointer lock.

VERIFIED cause in source: foot weapons/look required native capture, while multiple raw capture-request owners and an initial unbound click-to-play prompt gave no playable recovery. The embedded-browser rejection is observed; the underlying browser implementation cause is OPEN.

VERIFIED correction: one request owner catches synchronous, asynchronous and missing-API failure. Deploy/Resume directly starts or resumes play; capture denial immediately enables focused canvas RMB-drag look and firing. Native lock is accepted only from the actual document pointer-lock element. Player sensitivity/inversion uses direct setters and preserves fractional mouse motion. Menu input suspension clears horizontal held input while preserving live gravity and independent aircraft possession.

VERIFIED verification: unchanged fresh playflow helper passes7 CPU groups against actual Player/menu/pilot code and explicit inert visual fixtures. Original menu-input leak and first repair's airborne-hover failure are retained. OPEN: owner IAB/native gestures and actual game pixels on5cc3a26 have not been exercised.

## Collision and bot movement

VERIFIED: a permitted50ms Player update could cross the3.15m upstairs slab and fall to ground;60Hz happened to land. Sweeping from the previous feet height closes both cases without changing timestep, gravity, stance or collision dimensions.

VERIFIED: current authored orange-house collider output made bots stop at the front doorway because `groundY` selected the upstairs slab. Point-only movement also admitted a0.4m gap despite the0.6m player body and stalled152/160 ticks in a U-wall fixture without counting complete stalls.

VERIFIED: bot movement now uses a0.6m by1.78m body, relative-feet floors and0.38m steps, complete horizontal body sweeps and head clearance. Cached collision-valid pursuit routes expand at most768 nodes, back off failed attempts for one simulated second and reset across actor life/goal/world changes. Combat aim, sight and authority remain unchanged. The blocked-step counter now includes complete direct-wish stalls.

VERIFIED: root independently reran7 closure groups, including actual house-module geometry, U-wall escape within the original8-second window, narrow-gap refusal, grazing-corner sweep, speed4.3m/s, route bounds and both Player gravity repairs. OPEN: full rendered-map traversal, multiple-bot frame cost, sustained FPS and owner movement feel.

## Focus and desktop ownership

VERIFIED: browser interaction stopped after Dave reported stuck controls/focus and computer-use failure in Dune/WoW. This pass issued no OS input, foreground activation or global key releases and preserved owner processes. The separate accessibility chat owns controller diagnosis.

OPEN: these game-source repairs do not establish a fix for Dune/WoW or machine-wide computer use. Some original movement keys remain aliases while piloting after custom movement rebinding; the new movement/streak collision is separately repaired and CPU-tested.
