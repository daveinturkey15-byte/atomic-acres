"""Deterministic technical channel packing of the recorded CC0 source scans.

R = linear diffuse luminance / tile mean / 2; G = source roughness; B = 0;
A = 255. Normals remain OpenGL tangent-space, renormalized after downsampling.
No authored lighting, fake AO, shadows, cracks or painted geometry are added.
"""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'public/assets/architecture-pbr'
manifest = json.loads((ROOT / 'provenance.json').read_text())
manifest['derivations'] = []
for source in manifest['sources']:
    timber = source['id'] == 'brown_planks_09'
    name = 'timber' if timber else 'plaster'
    # Crop inside one plank, avoiding both board gaps and the nail column. World
    # scale derives from the publisher's measured 1 m tile, not the output size.
    crop = (0, 82, 700, 205) if timber else (0, 0, 1024, 1024)
    size = (1024, 256) if timber else (1024, 1024)
    channels = {}
    for f in source['files']:
        path = ROOT / f['path']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == f['sha256']
        channels[f['channel']] = np.asarray(Image.open(path).convert('RGB')
            .crop(crop).resize(size, Image.Resampling.LANCZOS), dtype=np.float32) / 255
    if timber:
        # Feather both boundaries to the same values so the cropped plank can
        # repeat without painting a new joint. Apply the identical operation to
        # all scan channels, then renormalize the normal vectors below.
        for array in channels.values():
            for axis, band in [(0, 16), (1, 32)]:
                view = np.swapaxes(array, 0, axis)
                seam = (view[0].copy() + view[-1].copy()) * 0.5
                for distance in range(band):
                    amount = (1 - distance / band) ** 2
                    view[distance] = view[distance] * (1-amount) + seam * amount
                    view[-1-distance] = view[-1-distance] * (1-amount) + seam * amount
    diffuse = channels['Diffuse']
    linear = np.where(diffuse <= 0.04045, diffuse / 12.92, ((diffuse + 0.055) / 1.055) ** 2.4)
    luminance = linear @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    relative = np.clip(luminance / luminance.mean() * 0.5, 0.08, 0.92)
    packed = np.zeros((*luminance.shape, 4), dtype=np.uint8)
    packed[:, :, 0] = np.rint(relative * 255).astype(np.uint8)
    packed[:, :, 1] = np.rint(channels['Rough'][:, :, 0] * 255).astype(np.uint8)
    packed[:, :, 3] = 255
    normal = channels['nor_gl'] * 2 - 1
    normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-6)
    normal = np.rint(np.clip(normal * 0.5 + 0.5, 0, 1) * 255).astype(np.uint8)
    for suffix, array in [('surface', packed), ('normal', normal)]:
        path = ROOT / f'{name}-{suffix}.png'
        Image.fromarray(array).save(path, optimize=True)
        manifest['derivations'].append({'path': path.name, 'source': source['id'],
            'operation': 'linear luminance and roughness packing' if suffix == 'surface' else 'OpenGL normal resize and renormalize',
            'sourceCropPixels': crop, 'edgeFeatherPixels': [16,32] if timber else None, 'dimensions': size,
            'physicalTileMeters': [(crop[2]-crop[0])/1024, (crop[3]-crop[1])/1024],
            'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
manifest['packedRuntimeBytesWithMipmaps'] = math.ceil(sum(d['dimensions'][0]*d['dimensions'][1]*4*4/3 for d in manifest['derivations']))
manifest['totalAssetBytes'] = sum(p.stat().st_size for p in ROOT.glob('*') if p.name != 'provenance.json')
assert manifest['totalAssetBytes'] < 8_000_000
assert manifest['packedRuntimeBytesWithMipmaps'] <= 24*1024*1024
(ROOT / 'provenance.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps({k: manifest[k] for k in ['totalAssetBytes', 'packedRuntimeBytesWithMipmaps']}))
