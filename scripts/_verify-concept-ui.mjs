import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const menu = read('src/ui/menu-views.ts');
const css = read('src/ui/concept-polish.css');
const docs = read('docs/assets/POLISH-UI-2026-09-27.md');
const errors = [];

function requireText(source, label, text) {
  if (!source.includes(text)) errors.push(`${label}: missing ${JSON.stringify(text)}`);
}

for (const handle of [
  'return { root, solo, multiplayer, options, credits, maps };',
  'return { root, resume, options, leave };',
  'return { root, back };',
  'return { root, rematch, leave, update };',
]) requireText(menu, 'menu handles', handle);

for (const semanticClass of [
  'aa-command-view', 'aa-command-rail', 'aa-mission-strip', 'aa-map-deck',
  'aa-control-strip', 'aa-outcome-block', 'aa-scoreboard-frame', 'aa-legal-copy',
]) requireText(menu, 'menu semantic classes', semanticClass);

for (const preserved of [
  'Play solo', 'Multiplayer', 'Options', 'Credits', 'FAN_LINE', 'LICENCE_LINES',
  'Rematch', 'Leave', 'Something broke',
]) requireText(menu, 'menu semantics', preserved);

for (const required of [
  '#start {', '--aa-ivory:', '--aa-charcoal:', '--aa-teal:', '--aa-amber:',
  '.aa-main .aa-menu-row', '.aa-scoreboard-frame', ':focus-visible',
  '@media (max-width: 600px)', '@media (prefers-reduced-motion: reduce)',
  '#hud .hud-matchbar', '#hud .hud-ammo', '#hud .hud-streak-card',
  '#hud .hud-streak-card .hud-streak-key',
  '#start:has(.aa-main:not(.aa-hidden))', 'margin-left: 0;',
]) requireText(css, 'concept stylesheet', required);

for (const forbidden of ['backdrop-filter', '@keyframes', 'infinite', 'canvas', 'url(']) {
  if (css.toLowerCase().includes(forbidden.toLowerCase())) errors.push(`concept stylesheet: forbidden ${JSON.stringify(forbidden)}`);
}

requireText(docs, 'polish note', 'menu-hud-concept-polish-v1.png');
requireText(docs, 'polish note', 'Actual pixels remain OPEN');

if (errors.length > 0) {
  console.error('[concept-ui] FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('[concept-ui] PASS - semantic handles, scoped palette, responsive/focus/reduced-motion guards present');
}
