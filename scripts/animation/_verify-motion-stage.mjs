#!/usr/bin/env node
/**
 * CPU falsifier for the live motion proof's staging contract.
 *
 * BROWSER-FREE (pure node: motion-stage.mjs imports nothing but Math). Run
 * before any browser is spent:
 *
 *   node scripts/animation/_verify-motion-stage.mjs
 *
 * It fails when:
 * - any front-hemisphere lens sits at dz <= 0 (the revision-2 2124 bug: lenses
 *   parked BEHIND a +Z-forward actor, 17/21 "back" cells);
 * - any lens yaw does not aim back at the subject (atan2(dx, dz) per the
 *   stations.ts convention);
 * - the design-side chestDotCam disagrees with the facing gate (front must
 *   read > 0.35, side must stay inside +/-0.35);
 * - the stage probe set is missing a family (footprint / lens column / LOS);
 * - the bounded plan is not exactly stand x front/side/threequarter x 3 beats
 *   (9 frames) or the full plan is not 21;
 * - verify-motion-live.mjs drifts from its contract (still carries the old
 *   dz-negative lenses, the synthetic overlay shortcut, a :4188 default, no
 *   Play-solo/Deploy + await-active flow, no pose gate, or no owned-Chrome
 *   close in its finally).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BEATS,
  LENS_HEIGHT,
  SCENARIOS,
  STAGE_ANCHORS,
  VIEWS,
  designChestDot,
  designFacingLabel,
  expectedFacingLabel,
  lensYaw,
  pickPlan,
  stagePoints,
} from './motion-stage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fails = [];
const ok = (name, cond, value) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + JSON.stringify(value)}`);
  if (!cond) fails.push(name);
};

// 1. Axis contract: actor yaw 0 faces +Z, so every front-ish lens has dz > 0.
for (const v of VIEWS) {
  if (v.facing === 'side') {
    ok(`lens ${v.name} is truly lateral (dz ~ 0)`, Math.abs(v.dz) < 1e-9, v);
  } else {
    ok(`lens ${v.name} sits in the +Z front hemisphere (dz > 0)`, v.dz > 0, v);
  }
  const derived = lensYaw(v);
  const err = Math.atan2(Math.sin(derived - v.yaw), Math.cos(derived - v.yaw));
  ok(`lens ${v.name} yaw aims back at the subject`, Math.abs(err) < 1e-9, { yaw: v.yaw, derived });
}

// 2. Design-side facing agrees with the gate the harness enforces.
for (const v of VIEWS) {
  const dot = designChestDot(v);
  const label = designFacingLabel(dot);
  if (v.facing === 'side') {
    ok(`design chestDotCam for ${v.name} reads side`, label === 'side', { dot });
  } else {
    ok(`design chestDotCam for ${v.name} reads front (>${0.35})`, dot > 0.35 && label === 'front', { dot });
  }
  ok(`expectedFacingLabel(stand, ${v.name}) is strict`, expectedFacingLabel('stand', v) === v.facing, expectedFacingLabel('stand', v));
  if (v.facing !== 'side') {
    ok(`expectedFacingLabel(crouch, ${v.name}) is reject-back`, expectedFacingLabel('crouch', v) === null, expectedFacingLabel('crouch', v));
  }
}

// 3. Stage probe set covers the whole subject, every lens column, and the LOS.
ok('named stage anchors exist in order', STAGE_ANCHORS.length >= 2 && STAGE_ANCHORS[0].x === 0 && STAGE_ANCHORS[0].z === 0, STAGE_ANCHORS);
for (const a of STAGE_ANCHORS) {
  const pts = stagePoints(a);
  const tags = new Set(pts.map((p) => p.tag.split(':')[0]));
  ok(`anchor "${a.name}" probes footprint + lens + los`, tags.has('stage-footprint') && tags.has('lens') && tags.has('los'), [...tags]);
  ok(`anchor "${a.name}" probe set is non-trivial`, pts.length > 50, pts.length);
}
ok('lens height matches layout eye height', LENS_HEIGHT === 1.68, LENS_HEIGHT);

// 4. Plans: bounded 9 frames to establish staging, full 21 without weak gates.
const bounded = pickPlan('bounded');
const boundedFrames = bounded.reduce((n, s) => n + s.views.length * BEATS.length, 0);
ok('bounded plan is stand x front/side/threequarter x 3 beats (9)', boundedFrames === 9
  && bounded.length === 1 && bounded[0].name === 'stand'
  && bounded[0].views.join(',') === 'front,side,threequarter', bounded);
const full = pickPlan('full');
const fullFrames = full.reduce((n, s) => n + s.views.length * BEATS.length, 0);
ok('full plan is 21 frames', fullFrames === 21, fullFrames);
ok('full plan keeps every SCENARIOS entry', full.length === SCENARIOS.length, full.map((s) => s.name));

// 5. Harness wiring: the live file must carry the new-stage contract.
const live = readFileSync(join(HERE, 'verify-motion-live.mjs'), 'utf8');
ok('harness imports the shared stage math (no second convention)', /from '\.\/motion-stage\.mjs'/.test(live) && /STAGE_ANCHORS/.test(live) && /stagePoints/.test(live), 'import');
ok('harness carries no dz-negative lens (revision-2 bug)', !/dz:\s*-D/.test(live), 'dz<0 lens');
ok('harness takes the real menu path (Play solo -> Deploy)', /Play solo/.test(live) && /Deploy/.test(live), 'menu');
ok('harness awaits the active phase before staging', /snapshot\(\)\?\.match\?\.phase === 'active'/.test(live), 'await-active');
ok('harness gates projected points on live pose match', /poseMismatch|poses match expected/.test(live) && /playerPose/.test(live), 'pose-gate');
ok('harness keeps frozen thresholds', /ELAPSED_TOL = 0\.05/.test(live) && /DARK_THRESHOLD = 40/.test(live) && /CALL_BUDGET = 1200/.test(live), 'thresholds');
ok('harness refuses :4188 and accepts explicit --url/--tag', /:4188/.test(live) && /--url/.test(live) && /--tag/.test(live), 'url/tag');
ok('harness always closes the owned stock Chrome', /finally[\s\S]*owned\.close\(\)/.test(live), 'close');
ok('harness claims visual playback only (no mocap/grenade-event synthesis)', /VISUAL clip playback only/.test(live) && !/mocap/i.test(live), 'claim');

console.log(fails.length ? `\n_motion-stage: ${fails.length} FAILING` : '\n_motion-stage: all CPU assertions pass');
process.exit(fails.length ? 1 : 0);
