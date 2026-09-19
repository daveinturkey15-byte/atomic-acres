"""One bounded, recorded AGY authoring run; root alone accepts its output."""
import json
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
LANE = ROOT.parent / 'nuketown-environment-20260919'
PROMPT = ROOT / 'docs/orchestration/overnight-20260919/agy-environment-integration.md'
RUNTIME = ROOT / '.recovery-runtime/agy-overnight-environment'
LEDGER = pathlib.Path(r'C:\Users\david\projects\worktrees\provider-refresh-20260909\scripts\record_delegated_run.py')
AGY = pathlib.Path(r'C:\Users\david\AppData\Local\agy\bin\agy.exe')
FLAGS = subprocess.CREATE_NO_WINDOW


def main():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    receipt = RUNTIME / 'summary.json'
    log = RUNTIME / 'output.txt'
    if receipt.exists():
        raise SystemExit('Existing attempt retained; reconcile it before a new dispatch.')
    rid = subprocess.check_output([
        sys.executable, str(LEDGER), 'start', '--harness', 'agy', '--provider',
        'google-antigravity', '--model', 'gemini-3.8-flash-high', '--reasoning', 'high',
        '--worktree', str(LANE), '--prompt-file', str(PROMPT), '--log', str(log),
        '--lane', 'overnight-environment-integration', '--summary',
        'Integrate ground PBR and mountains as separately reviewable candidates',
    ], creationflags=FLAGS, text=True).strip().splitlines()[-1]
    state = dict(run_id=rid, start=time.time(), requested_model='gemini-3.8-flash-high',
                 requested_effort='high', status='running', worktree=str(LANE),
                 actual_model=None, accepted=False, prompt_file=str(PROMPT))

    def save():
        tmp = receipt.with_suffix('.tmp')
        tmp.write_text(json.dumps(state, indent=2), encoding='utf-8')
        tmp.replace(receipt)

    code = 1
    try:
        with log.open('w', encoding='utf-8') as out:
            child = subprocess.Popen([
                str(AGY), '--print', PROMPT.read_text(encoding='utf-8'), '--model',
                'gemini-3.8-flash-high', '--effort', 'high',
                '--dangerously-skip-permissions', '--print-timeout', '1500s',
            ], cwd=LANE, stdout=out, stderr=subprocess.STDOUT, creationflags=FLAGS)
            state['pid'] = child.pid
            save()
            try:
                code = child.wait(timeout=1530)
            except subprocess.TimeoutExpired:
                subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'],
                               creationflags=FLAGS, capture_output=True)
                code = 124
    except Exception as exc:
        state['launcher_error_type'] = type(exc).__name__
    finally:
        artifact = (LANE / 'docs/environment-integration-handoff.md').is_file()
        state.update(exit_code=code, end=time.time(), artifact_exists=artifact,
                     status='review-required' if code == 0 and artifact else 'failed')
        save()
        subprocess.run([
            sys.executable, str(LEDGER), 'finish', '--run-id', rid, '--exit-code', str(code),
            '--status', 'completed' if code == 0 and artifact else 'failed',
            '--task-type', 'implementation', '--notes',
            'Candidate requires independent root acceptance; serving model unknown.', '--keep-state',
        ], creationflags=FLAGS, capture_output=True)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
