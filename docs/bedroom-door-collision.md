# White upstairs bedroom doorway repair

The preserved Fable scratch artifact described the bedroom hall door as blocked by the bed. That report is historical evidence; the current builder, actual controller and live browser decide acceptance.

VERIFIED: The complete bed/headboard/rug set now moves 1.25 m toward the curved wall using BED_SET_X. Both authored door openings stay in place. The headboard was the limiting obstruction: the initial 1.10 m move still snagged a direct hall approach in the browser. The final move adds 0.15 m of clearance without changing the room or player collision rules.

Run `node scripts/_bedroom-collision-proof.mjs` and `node scripts/_verify-bedroom-live.mjs` against candidate :4192.

The CPU proof builds the actual white house, uses its returned AABBs, the real 0.30 m player halfwidth, 1.78 m height and 3.15 m floor height. It uses rectangular overlap matching Player.hits. Hall and green-room floods are independently bounded so neither can borrow the other doorway. All four actual-player routes pass. The original BED_SET_X=0 negative control fails both hall routes. The 0.42 m sensitivity still fails the hall pinch and remains recorded as a conservative stress result.

The live browser proof drives the real walk controller through both openings in both directions, with four eight-centimetre endpoint checks rather than the general traversal harness's 0.7 m arrival tolerance. All four routes pass at the correct floor height with zero runtime errors. Initial failed evidence is retained in captures/bedroom-live/run.txt; final result is captures/bedroom-live/result.json and run-tight.txt. The hall-door image was opened and inspected.

The CPU JSON is docs/handoff/checkpoints/2026-09-19-bedroom-door/collision-proof.json. This focused result does not replace the full map's traversal gate.
