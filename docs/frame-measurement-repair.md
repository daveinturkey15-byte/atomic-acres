# Capture measurement repair, September 19

Symptom: the recovery capture reported 2 draws and 2 triangles at some stations,
while real play rendered hundreds of draws. The old result remains invalid evidence.

Cause: Three 0.180 PassNode updates once per renderer frame. A second synchronous
QA render within that frame can reuse the scene pass and draw only post quads.
The earlier same-evaluate delta fix prevented counter resets but did not prevent
this cached-frame measurement.

Correction: schedule the synchronous render/read delta on a fresh animation frame.
Reject reset/zero and post-only (2 draw / 2 triangle) samples. The 1200 draw and
900000 triangle budgets and the independent real-play harness are unchanged.

Verification: `_verify-frame-measure.mjs` retains negative controls. Actual camera
station measurements must also pass before this repair is accepted.

VERIFIED on the 4192 candidate: aerial 1142 draws / 340k triangles and yardWhite 1070 draws / 326k triangles. Both now include the scene and are within unchanged budgets. The requested 'street' name was not a station; it was skipped and is not claimed as measured.
