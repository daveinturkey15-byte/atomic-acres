const fs = require('fs');
const b = fs.readFileSync('public/assets/coach.glb');
const L = b.readUInt32LE(12);
const j = JSON.parse(b.toString('utf8', 20, 20 + L));
process.stdout.write('IMAGES ' + JSON.stringify(j.images) + '\n');
const m = j.materials.find((m) => m.name === 'CoachBody');
process.stdout.write('BODYMAT ' + JSON.stringify(m) + '\n');
process.stdout.write('TEXTURES ' + JSON.stringify(j.textures) + '\n');
