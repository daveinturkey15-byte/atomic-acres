"""Read-only Comfy inspection + editable HELD graph. No upload, submit or service control.
Writes only the adjacent openpass-workbench-prepare.json; refuses overwrite.
Image pixels are inspected, never modified. The existing graph builder is parsed,
and only its pure template/function definition is evaluated in a limited namespace.
"""
from __future__ import annotations
import ast
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).with_suffix('.json')
BASE = 'http://127.0.0.1:8188'
SOURCES = {
    'nodes.py': 'https://raw.githubusercontent.com/Comfy-Org/ComfyUI/v0.37.0/nodes.py',
    'nodes_mask.py': 'https://raw.githubusercontent.com/Comfy-Org/ComfyUI/v0.37.0/comfy_extras/nodes_mask.py',
    'nodes_images.py': 'https://raw.githubusercontent.com/Comfy-Org/ComfyUI/v0.37.0/comfy_extras/nodes_images.py',
    'validation.py': 'https://raw.githubusercontent.com/Comfy-Org/ComfyUI/v0.37.0/comfy_execution/validation.py',
}
def get(path):
    with urllib.request.urlopen(BASE + path, timeout=15) as response:
        return json.load(response)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def image_info(relative, expected):
    path = ROOT / relative
    data = path.read_bytes()
    assert sha(data) == expected, 'preserved image identity changed'
    image = Image.open(path)
    result = {'path': relative, 'sha256': sha(data), 'bytes': len(data), 'mode': image.mode, 'size': image.size}
    if image.mode != 'RGBA':
        return result
    a = np.array(image.getchannel('A'))
    near = np.array(Image.fromarray((a >= 250).astype('uint8') * 255).filter(ImageFilter.MaxFilter(17))) > 0
    def bbox(mask):
        y, x = np.where(mask)
        return [int(x.min()), int(y.min()), int(x.max()), int(y.max())] if len(x) else None
    result['alpha'] = {'min': int(a.min()), 'max': int(a.max()), 'zero': int((a == 0).sum()),
        'le8': int((a <= 8).sum()), 'partial1to249': int(((a > 0) & (a < 250)).sum()),
        'ge250': int((a >= 250).sum()), 'bboxPositive': bbox(a > 0), 'bboxGE205': bbox(a >= 205),
        'partialBeyond8pxOfOpaque': int(((a > 0) & (a < 250) & ~near).sum()),
        'alpha9to249Beyond8pxOfOpaque': int(((a > 8) & (a < 250) & ~near).sum())}
    regions = {'open_leg_lower': [300, 690, 900, 860], 'left_exterior': [0, 400, 120, 900],
        'floor': [300, 880, 900, 1024], 'above_object': [900, 0, 1536, 150]}
    result['alphaRegions'] = {}
    for name, (x0, y0, x1, y1) in regions.items():
        roi = a[y0:y1, x0:x1]
        result['alphaRegions'][name] = {'xyxy': [x0, y0, x1, y1], 'max': int(roi.max()),
            'mean': float(roi.mean()), 'positive': int((roi > 0).sum()), 'pixels': int(roi.size)}
    return result

def draft_graph():
    path = ROOT / 'scripts/art-gen/comfy_trellis.py'
    source = path.read_text(encoding='utf8')
    tree = ast.parse(source)
    template = next(n.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'TPL' for t in n.targets))
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'trellis_workflow')
    namespace = {'json': json, 'TPL': ast.literal_eval(template), '__builtins__': {'dict': dict, 'str': str, 'int': int, 'float': float}}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), namespace)
    graph = namespace['trellis_workflow']('__NOT_UPLOADED_WORKBENCH_CUTOUT__', 'atomic-acres-workbench-openpass-draft', 700000, 20000, 1024)
    del graph['11']
    graph['12'] = {'class_type': 'InvertMask', 'inputs': {'mask': ['10', 1]}}
    graph['13']['inputs']['masks'] = ['12', 0]
    graph['13']['inputs']['pad_factor'] = 1.0
    graph['106']['inputs']['resolution'] = 512
    graph['107']['inputs']['resolution'] = 512
    return graph, {'path': str(path.relative_to(ROOT)).replace('\\', '/'), 'sha256': sha(path.read_bytes())}

def validate(graph, schemas):
    errors, deferred = [], []
    for node_id, node in graph.items():
        spec = schemas[node['class_type']]
        fields = dict(spec['input'].get('required', {}))
        optional = dict(spec['input'].get('optional', {}))
        # Current v3 dynamic combo selected subfields use flattened dotted API keys.
        for key, description in list(fields.items()) + list(optional.items()):
            if description[0] == 'COMFY_DYNAMICCOMBO_V3':
                selected = next((v for v in description[1]['options'] if v['key'] == node['inputs'].get(key)), None)
                if selected is None:
                    errors.append(f'{node_id}.{key}: invalid dynamic choice')
                else:
                    fields.update({f'{key}.{k}': v for k, v in selected['inputs'].get('required', {}).items()})
        for key in fields:
            if key not in node['inputs']:
                errors.append(f'{node_id}.{key}: missing required input')
        for key, value in node['inputs'].items():
            desc = fields.get(key, optional.get(key))
            if desc is None:
                errors.append(f'{node_id}.{key}: unknown input'); continue
            kind, options = desc[0], desc[1] if len(desc) > 1 else {}
            if isinstance(value, list):
                if len(value) != 2 or value[0] not in graph:
                    errors.append(f'{node_id}.{key}: invalid edge'); continue
                outputs = schemas[graph[value[0]]['class_type']]['output']
                if not isinstance(value[1], int) or not 0 <= value[1] < len(outputs):
                    errors.append(f'{node_id}.{key}: missing source socket')
                elif kind != '*' and not set(outputs[value[1]].split(',')).intersection(str(kind).split(',')):
                    errors.append(f'{node_id}.{key}: edge type {outputs[value[1]]} != {kind}')
                continue
            if node['class_type'] == 'LoadImage' and key == 'image':
                deferred.append('Input placeholder deliberately not resolved/uploaded; LoadImage file validation OPEN'); continue
            choices = kind if isinstance(kind, list) else options.get('options') if kind == 'COMBO' else None
            if choices is not None and value not in choices:
                errors.append(f'{node_id}.{key}: unavailable enum/model')
            if kind in ('INT', 'FLOAT'):
                if isinstance(value, bool) or not isinstance(value, (int, float)) or (kind == 'INT' and not isinstance(value, int)):
                    errors.append(f'{node_id}.{key}: invalid numeric type')
                elif value < options.get('min', -float('inf')) or value > options.get('max', float('inf')):
                    errors.append(f'{node_id}.{key}: out of range')
            if kind == 'BOOLEAN' and not isinstance(value, bool): errors.append(f'{node_id}.{key}: invalid boolean')
    return {'result': 'FIELDS_MATCH_LIVE_SCHEMA' if not errors else 'MISMATCH', 'errors': errors, 'deferred': deferred,
        'limitation': 'No server prompt validation, load, generation or output execution; node names are not readiness.'}

def main():
    assert not OUT.exists(), 'Preserve prior receipt; overwrite refused'
    graph, builder = draft_graph()
    names = sorted({n['class_type'] for n in graph.values()})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        values = list(pool.map(lambda name: get('/object_info/' + name)[name], names))
    schemas = dict(zip(names, values))
    # Remove unrelated owner filenames before serializing anything.
    schemas['LoadImage']['input']['required']['image'] = ['COMBO', {'options': [], 'image_upload': True, 'redacted': 'owner input filenames not retained'}]
    checks = validate(graph, schemas)
    model_requirements = {'diffusion_models': ['trellis_2_int8_convrot.safetensors', 'pixal3d_int8_convrot.safetensors'],
        'vae': ['trellis_2_shape_vae_bf16.safetensors', 'trellis_2_texture_vae_bf16.safetensors'],
        'clip_vision': ['dino_v3_vit_l.safetensors'], 'geometry_estimation': ['moge_2_vitl_normal_fp16.safetensors'],
        'background_removal': ['birefnet.safetensors']}
    available = {folder: get('/models/' + folder) for folder in model_requirements}
    models = {folder: {name: name in available[folder] for name in selected} for folder, selected in model_requirements.items()}
    for name, spec in schemas.items():
        for field, desc in spec['input'].get('required', {}).items():
            if name in ('UNETLoader', 'VAELoader', 'CLIPVisionLoader') and isinstance(desc[0], list):
                used = [n['inputs'][field] for n in graph.values() if n['class_type'] == name and field in n['inputs']]
                desc[0] = [v for v in desc[0] if v in used]
    system = get('/system_stats')['system']; queue = get('/queue')
    pinned_sources = {}
    for name, url in SOURCES.items():
        with urllib.request.urlopen(url, timeout=20) as response: data = response.read()
        pinned_sources[name] = {'url': url, 'sha256': sha(data), 'bytes': len(data)}
    gpu = subprocess.run(['nvidia-smi.exe', '--query-gpu=memory.free,memory.used,utilization.gpu', '--format=csv,noheader,nounits'],
        capture_output=True, text=True, timeout=15, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    receipt = {'status': 'HELD_NOT_SUBMITTED', 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'submissionAdmitted': False, 'endpoint': BASE, 'server': {k: system.get(k) for k in ['comfyui_version', 'pytorch_version', 'ram_free']},
        'queue': {key: len(queue.get(key, [])) for key in ['queue_running', 'queue_pending']},
        'gpuSnapshot': gpu.stdout.strip(), 'gpuFields': ['freeMiB', 'usedMiB', 'utilizationPercent'],
        'images': [image_info('docs/assets/references/garden-workbench-v1.png', '374f50678c055d14a85a5341537e8247e696e13b2dcecb0a933e470fde638612'),
            image_info('docs/assets/references/garden-workbench-cutout-openpass-take1.png', '906f891a1968a3877b0aa94cc69a8927c6f39a57f803323a955d846abf6d9ad7')],
        'modelNamePresenceOnly': models, 'modelRootsHashesLicenses': 'OPEN', 'builder': builder,
        'pinnedOfficialSources': pinned_sources, 'schemaChecks': checks,
        'schemas': {name: {k: spec[k] for k in ['input', 'output', 'python_module']} for name, spec in schemas.items()},
        'changesFromExistingDraft': ['BiRefNet branch replaced by explicit LoadImage inverse-alpha -> InvertMask',
            'TRELLIS crop pad_factor 1.0 matches live tooltip; 1024x1024 black composite retained',
            'Game decimation target 20000; 1024 atlas/base, 512 normal and AO; raw sculpt target 700000 retained'],
        'holds': ['Free VRAM below project reserve and historic profile needs almost the whole 16GiB GPU',
            'Actual model roots, content hashes, loading and component licenses unresolved',
            'Input alpha edge/halo and exact object preservation not art-accepted',
            'Mesh hidden surfaces, leaf/leg retention, UVs and <=12MiB runtime budget unexecuted',
            'Full feed graph resource admission and AO/cage scale parameters require review'],
        'editableApiGraphDraft': graph}
    OUT.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'file': str(OUT), 'status': receipt['status'], 'nodes': len(graph), 'schemaChecks': checks, 'queue': receipt['queue'], 'gpu': receipt['gpuSnapshot']}))

if __name__ == '__main__': main()
