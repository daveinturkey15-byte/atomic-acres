/** Actual installed r180 counter lifetime; CPU only, no GPU/renderer claim. */
import assert from 'node:assert/strict';
import Info from '../node_modules/three/src/renderers/common/Info.js';
import Animation from '../node_modules/three/src/renderers/common/Animation.js';

function fixture(manual) {
  const info = new Info();
  if (manual) info.autoReset = false;
  let tick;
  const nodes = { nodeFrame: { frameId: 0, update() { this.frameId++; } } };
  const animation = new Animation(nodes, info);
  animation.setContext({ requestAnimationFrame(fn) { tick = fn; return 1; }, cancelAnimationFrame() {} });
  animation.start();
  const draw = () => {
    info.reset();
    info.render.calls++;
    info.update({ isMesh: true }, 36, 1);
    return { calls: info.render.calls, drawCalls: info.render.drawCalls, triangles: info.render.triangles };
  };
  return { info, draw, tick: () => tick(16), close: () => animation.stop() };
}
const old = fixture(false), before = old.draw();
assert.equal(before.triangles, 12);
old.tick();
assert.equal(old.info.render.triangles, 0, 'negative control: internal RAF clears metrics without any new user render');
assert.equal(old.info.render.calls, 1, 'cumulative calls survive; they do not establish latest rendered triangles');
assert.equal(before.triangles, 12, 'completed draw receipt remains immutable');
old.close();
const fixed = fixture(true), completed = fixed.draw();
fixed.tick();
assert.equal(fixed.info.render.triangles, 12);
assert.equal(fixed.info.render.drawCalls, 1);
const second = fixed.draw();
assert.equal(second.calls, 2);
assert.equal(second.triangles, 12, 'explicit per-draw reset prevents accumulation');
assert.equal(second.drawCalls, 1);
assert.deepEqual(completed, { calls: 1, drawCalls: 1, triangles: 12 });
fixed.close();
console.log(JSON.stringify({ status: 'PASS CPU counter-lifetime proof', oldLateTriangles: 0,
  fixedLateTriangles: 12, negativeControl: 'unchanged actual Info/Animation APIs',
  open: 'Prior neutral capture lacks failing numeric state; exact original failure cause and fresh pixels require live verification.' }));
