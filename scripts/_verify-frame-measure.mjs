import assert from 'node:assert/strict';
import { sceneWasMeasured } from './lib/measure-frame.mjs';
// Negative controls reproduce the two historical false measurements. No
// production draw/triangle budget is changed by this measurement validity check.
assert.equal(sceneWasMeasured({ calls: 0, triangles: 0, renders: 0 }), false);
assert.equal(sceneWasMeasured({ calls: 2, triangles: 2, renders: 2 }), false);
assert.equal(sceneWasMeasured({ calls: NaN, triangles: 9000, renders: 3 }), false);
assert.equal(sceneWasMeasured({ calls: 886, triangles: 330000, renders: 3 }), true);
console.log('PASS: zero/reset and post-only frames rejected; scene frame accepted');
