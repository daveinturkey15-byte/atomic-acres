"""Deterministic technical channel packing of the recorded CC0 source scans.

R = locally normalized linear diffuse luminance / 2; G = source roughness; B = 0;
A = 255. OpenGL normal slopes are high-pass filtered, then renormalized.
No authored lighting, fake AO, shadows, cracks or painted geometry are added.
"""
from pathlib import Path
import hashlib
import json
import math
import sys
from io import BytesIO
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parents[1] / 'public/assets/architecture-pbr'
manifest = json.loads((ROOT / 'provenance.json').read_text())
manifest['derivations'] = []
check_only = '--check' in sys.argv
quality = []
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
    # Raw diffuse contains captured metre-scale staining/clouds. Remove that
    # scale rather than repeating it as authored wall weathering. Grain and
    # fine plaster colour remain; broad application wear belongs in world space.
    blur_pixels = (24, 36) if timber else (24, 24)
    local_mean = gaussian_filter(luminance, sigma=blur_pixels, mode='wrap')
    relative = np.clip(luminance / np.maximum(local_mean, 1e-4) * 0.5, 0.22, 0.78)
    packed = np.zeros((*luminance.shape, 4), dtype=np.uint8)
    packed[:, :, 0] = np.rint(relative * 255).astype(np.uint8)
    packed[:, :, 1] = np.rint(channels['Rough'][:, :, 0] * 255).astype(np.uint8)
    packed[:, :, 3] = 255
    source_normal = channels['nor_gl'] * 2 - 1
    slopes = source_normal[:, :, :2] / np.maximum(source_normal[:, :, 2:], 0.25)
    # The plaster's source mean XY slope is about (-.077,-.079). Preserving that
    # plus broad scan undulations caused the repeated scalloped bands in round
    # 0715. Remove wavelengths above ~4 cm, keeping real millimetre relief.
    broad_slopes = gaussian_filter(slopes, sigma=(*blur_pixels, 0), mode='wrap')
    detail_slopes = slopes - broad_slopes
    normal = np.concatenate([detail_slopes, np.ones((*luminance.shape, 1), dtype=np.float32)], axis=2)
    normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-6)
    normal = np.rint(np.clip(normal * 0.5 + 0.5, 0, 1) * 255).astype(np.uint8)
    # Frozen repair-1 negative controls: reject the raw scan's broad normal tilt
    # and dirty low-frequency luminance, but also reject a flattened/no-grain map.
    decoded = normal.astype(np.float64) / 255 * 2 - 1
    decoded_slopes = decoded[:, :, :2] / np.maximum(decoded[:, :, 2:], .25)
    low_slope_rms = float(np.sqrt(np.mean(gaussian_filter(decoded_slopes, (32,32,0), mode='wrap') ** 2)))
    detail_slope_rms = float(np.sqrt(np.mean(decoded_slopes ** 2)))
    low_luminance_std = float(gaussian_filter(packed[:,:,0].astype(np.float64)/255, 32, mode='wrap').std())
    raw_low_slope_rms = float(np.sqrt(np.mean(gaussian_filter(slopes, (32,32,0), mode='wrap') ** 2)))
    raw_low_luminance_std = float(gaussian_filter(luminance/luminance.mean()/2, 32, mode='wrap').std())
    assert low_slope_rms < .005, (name, 'broad normal bands')
    assert low_luminance_std < .016, (name, 'repeating colour clouds')
    assert detail_slope_rms > .015, (name, 'fine relief lost')
    assert packed[:,:,0].std()/255 > .04, (name, 'fine colour variation lost')
    assert raw_low_slope_rms > .005 and raw_low_luminance_std > .016, (name, 'negative control stopped rejecting raw scan')
    if timber:
        grain = packed[:,:,0].astype(np.float64)/255
        along = np.diff(grain,axis=1).std()/(700/1024/1024)
        across = np.diff(grain,axis=0).std()/(123/1024/256)
        assert across/along > 1.3, 'timber lost directional grain'
    quality.append({'material': name, 'lowSlopeRms': low_slope_rms,
        'fineSlopeRms': detail_slope_rms, 'lowLuminanceStd': low_luminance_std,
        'rawLowSlopeRmsRejected': raw_low_slope_rms,
        'rawLowLuminanceStdRejected': raw_low_luminance_std})
    for suffix, array in [('surface', packed), ('normal', normal)]:
        path = ROOT / f'{name}-{suffix}.png'
        encoded = BytesIO(); Image.fromarray(array).save(encoded, format='PNG', optimize=True)
        if check_only:
            assert path.read_bytes() == encoded.getvalue(), f'{path.name} does not match source recipe'
        else:
            path.write_bytes(encoded.getvalue())
        manifest['derivations'].append({'path': path.name, 'source': source['id'],
            'operation': 'local linear-luminance normalization and roughness packing' if suffix == 'surface' else 'OpenGL normal slope high-pass and renormalization',
            'localNormalizationSigmaPixels': blur_pixels,
            'sourceCropPixels': crop, 'edgeFeatherPixels': [16,32] if timber else None, 'dimensions': size,
            'physicalTileMeters': [(crop[2]-crop[0])/1024, (crop[3]-crop[1])/1024],
            'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
manifest['packedRuntimeBytesWithMipmaps'] = math.ceil(sum(d['dimensions'][0]*d['dimensions'][1]*4*4/3 for d in manifest['derivations']))
manifest['totalAssetBytes'] = sum(p.stat().st_size for p in ROOT.glob('*') if p.name != 'provenance.json')
assert manifest['totalAssetBytes'] < 8_000_000
assert manifest['packedRuntimeBytesWithMipmaps'] <= 24*1024*1024
manifest['repair1QualityControls'] = quality
if not check_only:
    (ROOT / 'provenance.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps({'status': 'PASS', 'checkOnly': check_only,
    **{k: manifest[k] for k in ['totalAssetBytes', 'packedRuntimeBytesWithMipmaps']}, 'quality': quality}))
