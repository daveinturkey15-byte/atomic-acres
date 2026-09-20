"""Run the existing AKP gates; never infer native adoption from a linked directory."""
from pathlib import Path
import subprocess
import sys
from task_contract import ContractError

AKP = Path('C:/Users/david/AppData/Local/hermes/.akephalos')
BOOTSTRAPS = {
    'OMP': 'C:/Users/david/.omp/agent/AGENTS.md',
    'Antigravity': 'C:/Users/david/.gemini/config/AGENTS.md',
}


def require_clean_row(harness, check, audit):
    row = harness + ' on dave-gaming-pc'
    if not any(line.startswith('PASS: ' + row + ' ') for line in check.splitlines()):
        raise ContractError('Native bootstrap check did not pass: ' + row)
    if 'control_digest=' not in audit or any(row in line and line.startswith(('FAIL:', 'AMBER:'))
                                           for line in audit.splitlines()):
        raise ContractError('Native adoption missing, stale, expired or quarantined: ' + row)


def require_native_adoption(route):
    harness = 'Antigravity' if route == 'agy' else 'OMP'
    guard = [sys.executable, str(AKP/'scripts/akp_adoption_guard.py')]
    outputs = []
    for args in (['check', '--harness', harness, '--machine', 'dave-gaming-pc',
                  '--bootstrap', BOOTSTRAPS[harness]], ['audit']):
        result = subprocess.run(guard + args, cwd=AKP, capture_output=True, text=True,
                                encoding='utf-8', timeout=30,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        outputs.append(result.stdout)
    # The global audit may correctly fail for a different harness. Inspect our exact row.
    require_clean_row(harness, *outputs)
