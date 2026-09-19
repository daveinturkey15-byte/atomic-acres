const fs = require('fs');
const crypto = require('crypto');

const file = process.argv[2] || 'public/assets/field-case/field-case.glb';
const bytes = fs.readFileSync(file);
if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
const componentBytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const typeWidth = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const triangles = (gltf.meshes || []).flatMap((mesh) => mesh.primitives || [])
  .reduce((total, primitive) => {
    const accessor = gltf.accessors[primitive.indices];
    const count = accessor?.count || 0;
    // glTF defaults primitive.mode to TRIANGLES when omitted.
    return total + ((primitive.mode === undefined || primitive.mode === 4) ? Math.floor(count / 3) : count);
  }, 0);
const images = (gltf.images || []).map((image) => ({
  mimeType: image.mimeType || null,
  embedded: !image.uri,
  bufferView: image.bufferView ?? null,
}));
const bounds = (gltf.meshes || []).flatMap((mesh) => mesh.primitives || [])
  .map((primitive) => gltf.accessors[primitive.attributes?.POSITION])
  .filter(Boolean)
  .reduce((acc, accessor) => {
    for (let i = 0; i < 3; i++) {
      acc.min[i] = Math.min(acc.min[i], accessor.min?.[i] ?? Infinity);
      acc.max[i] = Math.max(acc.max[i], accessor.max?.[i] ?? -Infinity);
    }
    return acc;
  }, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const textures = (gltf.textures || []).length;
const materials = (gltf.materials || []).length;
const externalUris = images.filter((image) => !image.embedded).length;
const result = {
  file,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  triangles,
  meshes: (gltf.meshes || []).length,
  materials,
  textures,
  images,
  externalUris,
  bounds,
  budgets: { triangles: triangles <= 5000, materials: materials <= 4, bytes: bytes.length <= 4000000 },
};
if (!result.budgets.triangles || !result.budgets.materials || !result.budgets.bytes || externalUris > 0) {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
console.log(JSON.stringify(result, null, 2));
