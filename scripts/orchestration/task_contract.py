"""Source-bound task admission and artifact verification, not an OS sandbox.

The lead freezes contracts outside worker trees. Admission refuses stale inputs;
review refuses missing outputs, out-of-scope edits and concept-only promotion.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import subprocess

SKILL_BASELINE = Path('C:/Users/david/AppData/Local/hermes/.akephalos/skill-baseline.json')


class ContractError(RuntimeError):
    pass


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git(root, *args):
    run = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True,
                         encoding='utf-8', timeout=20, check=True,
                         creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    return run.stdout.strip()


def contained(root, name):
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()) or path == root.resolve():
        raise ContractError('Artifact path escapes its declared tree')
    return path


def inventory(tree):
    # Git enumerates tracked and unignored files, not profiles, dependencies or captures.
    names = git(tree, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0')
    return {name: sha(contained(tree, name)) for name in names if name and contained(tree, name).is_file()}


def load_contract(root, lane, route, tree, prompt):
    if not lane or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._' for c in lane) or lane in {'.', '..'}:
        raise ContractError('Invalid lane identifier')
    path = root / 'docs/orchestration/contracts' / (lane + '.json')
    try:
        contract = json.loads(path.read_text(encoding='utf-8-sig'))
        if contract.get('schema_version') != 1 or contract.get('route') != route:
            raise ContractError('Contract schema or route mismatch')
        if Path(contract['tree']).resolve() != tree.resolve() or tree.resolve() == root.resolve():
            raise ContractError('Contract requires its exact isolated worker tree')
        if contract['source_sha'] != git(root, 'rev-parse', 'HEAD'):
            raise ContractError('Contract integration baseline is stale')
        if contract['worker_head'] != git(tree, 'rev-parse', 'HEAD'):
            raise ContractError('Worker Git baseline changed')
        if contract['prompt_sha256'] != sha(prompt):
            raise ContractError('Prompt changed after contract freeze')
        for field in ('task_id', 'objective', 'owner', 'acceptance', 'outputs', 'writable_paths', 'input_hashes', 'before_hashes'):
            if not contract.get(field):
                raise ContractError('Contract field missing: ' + field)
        if type(contract.get('max_attempts')) is not int or not 1 <= contract['max_attempts'] <= 2:
            raise ContractError('At most one attempt and one repair are admitted')
        if type(contract.get('max_minutes')) is not int or not 1 <= contract['max_minutes'] <= 30:
            raise ContractError('Invalid wall-clock budget')
        if contract.get('billing_class') not in {'subscription', 'metered'}:
            raise ContractError('Explicit billing class required')
        if type(contract.get('reserved_usd')) not in (float, int) or not math.isfinite(contract['reserved_usd']) or contract['reserved_usd'] <= 0:
            raise ContractError('Finite positive cost reservation required; unknown is not free')
        if contract['reserved_usd'] > 1:
            raise ContractError('Per-job reservation exceeds this pipeline cap')
        for name in contract['writable_paths'] + contract['outputs']:
            contained(tree, name)
        if set(contract['outputs']) - set(contract['writable_paths']):
            raise ContractError('Outputs must belong to the declared writable scope')
        for name, digest in contract['input_hashes'].items():
            if sha(contained(tree, name)) != digest or sha(contained(root, name)) != digest:
                raise ContractError('Source hash changed: ' + name)
        if inventory(tree) != contract['before_hashes']:
            raise ContractError('Worker content changed after contract freeze')
        validate_skills(contract.get('skills'))
        contract['contract_sha256'] = sha(path)
        return contract
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        raise ContractError('Missing or invalid frozen task contract') from exc


def validate_skills(skills, baseline_path=SKILL_BASELINE):
    if not isinstance(skills, dict):
        raise ContractError('Explicit evaluated skill allowlist required (empty is valid)')
    if not skills:
        return
    baseline = json.loads(baseline_path.read_text(encoding='utf-8-sig'))['skills']
    for name, item in skills.items():
        accepted = baseline.get(name, {})
        if (item.get('sha256') != accepted.get('sha256') or not accepted.get('path') or
                Path(item['path']).resolve() != Path(accepted['path']).resolve() or
                sha(item['path']) != accepted['sha256']):
            raise ContractError('Unevaluated or drifted skill: ' + name)


def freeze_contract(root, spec, prompt):
    """Lead-only preparation. Does not grant dispatch permission or launch anything."""
    c = dict(spec)
    tree = Path(c['tree']).resolve()
    if tree == root.resolve():
        raise ContractError('Root cannot be a worker tree')
    c.update(schema_version=1, source_sha=git(root, 'rev-parse', 'HEAD'),
             worker_head=git(tree, 'rev-parse', 'HEAD'), prompt_sha256=sha(prompt), tree=str(tree))
    c['input_hashes'] = {name: sha(contained(root, name)) for name in c.pop('inputs')}
    for name, digest in c['input_hashes'].items():
        if sha(contained(tree, name)) != digest:
            raise ContractError('Worker input is not the current root source: ' + name)
    c['before_hashes'] = inventory(tree)
    validate_skills(c.get('skills'))
    return c


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Freeze a lead-owned contract; never dispatches work.')
    parser.add_argument('--spec', type=Path, required=True)
    parser.add_argument('--prompt', type=Path, required=True)
    parser.add_argument('--lane', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    if not args.lane.replace('-', '').isalnum():
        parser.error('Use an alphanumeric/hyphen lane')
    contract = freeze_contract(root, json.loads(args.spec.read_text(encoding='utf-8-sig')), args.prompt)
    path = root / 'docs/orchestration/contracts' / (args.lane + '.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as target:
        target.write(json.dumps(contract, indent=2) + '\n')
    # A failed draft remains visible and cannot dispatch. Never silently overwrite it.
    load_contract(root, args.lane, contract['route'], Path(contract['tree']), args.prompt)
    print(json.dumps({'contract': str(path), 'dispatch_authorized': False}))


def verify_artifacts(contract, tree, now=None):
    now = inventory(tree) if now is None else now
    before = contract['before_hashes']
    changes = sorted(name for name in before.keys() | now.keys() if before.get(name) != now.get(name))
    outside = [name for name in changes if name not in contract['writable_paths']]
    missing = [name for name in contract['outputs'] if name not in now]
    if outside or missing:
        raise ContractError(f'Out-of-scope edits={outside}; missing outputs={missing}')
    return {'changed_files': changes, 'artifact_sha256': {name: now[name] for name in contract['outputs']},
            'source_sha': contract['source_sha'], 'contract_sha256': contract['contract_sha256'],
            'accepted': False, 'status': 'lead-review-required'}


def validate_lineage(row):
    """A manifest is not evidence unless every named local artifact matches its hash."""
    stages = ['reference', 'authored', 'integrated', 'verified']
    if row.get('stage') not in stages:
        raise ContractError('Unknown lineage stage')
    for key in ('id', 'source_url', 'code_license', 'model_license', 'output_license'):
        if not row.get(key):
            raise ContractError('Missing provenance field: ' + key)
    required = ['reference']
    if stages.index(row['stage']) >= 1: required += ['model']
    if stages.index(row['stage']) >= 2: required += ['runtime', 'build']
    if row['stage'] == 'verified': required += ['acceptance']
    for key in required:
        item = row.get(key, {})
        if not item.get('path') or sha(item['path']) != item.get('sha256'):
            raise ContractError('Missing or mismatched lineage artifact: ' + key)
    if row['stage'] == 'verified':
        receipt = json.loads(Path(row['acceptance']['path']).read_text(encoding='utf-8-sig'))
        if receipt.get('passed') is not True or receipt.get('build_sha256') != row['build']['sha256']:
            raise ContractError('Acceptance is failed or for a different build')
        if not receipt.get('actual_frame_paths') or not receipt.get('reviewer'):
            raise ContractError('Visual review evidence missing')
        for frame in receipt['actual_frame_paths']:
            if sha(frame['path']) != frame['sha256']:
                raise ContractError('Visual frame changed')
    return True
