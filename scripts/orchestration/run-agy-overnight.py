"""One bounded, recorded AGY authoring run; root alone accepts its output."""
import json
import argparse
import pathlib
import subprocess
import sys
import time
from dispatch_policy import DispatchHold, require_external_dispatch
from task_contract import ContractError, load_contract, verify_artifacts, git
from run_limits import RunLease
from adoption_gate import require_native_adoption

ROOT = pathlib.Path(__file__).resolve().parents[2]
LANE = ROOT.parent / 'nuketown-environment-20260919'
PROMPT = ROOT / 'docs/orchestration/overnight-20260919/agy-environment-integration.md'
RUNTIME = ROOT / '.recovery-runtime/agy-overnight-environment'
LEDGER = pathlib.Path(r'C:\Users\david\projects\worktrees\provider-refresh-20260909\scripts\record_delegated_run.py')
AGY = pathlib.Path(r'C:\Users\david\AppData\Local\agy\bin\agy.exe')
FLAGS = subprocess.CREATE_NO_WINDOW


def main():
    global PROMPT, RUNTIME, LANE
    parser = argparse.ArgumentParser()
    parser.add_argument('--prompt', type=pathlib.Path)
    parser.add_argument('--attempt', default='agy-overnight-environment')
    parser.add_argument('--worktree', type=pathlib.Path)
    args = parser.parse_args()
    try:
        require_external_dispatch(ROOT, 'agy')
    except DispatchHold as exc:
        raise SystemExit(str(exc)) from exc
    require_native_adoption('agy')
    if not args.attempt.replace('-', '').isalnum():
        raise SystemExit('Attempt must be a simple alphanumeric/hyphen identifier.')
    if args.prompt:
        PROMPT = args.prompt.resolve(strict=True)
    if args.worktree:
        LANE = args.worktree.resolve(strict=True)
    if pathlib.Path(git(LANE, 'rev-parse', '--git-common-dir')).resolve() != pathlib.Path(git(ROOT, 'rev-parse', '--git-common-dir')).resolve():
        raise SystemExit('AGY tree is not from this project Git database')
    contract = load_contract(ROOT, args.attempt, 'agy', LANE, PROMPT)
    RUNTIME = ROOT / '.recovery-runtime' / args.attempt
    RUNTIME.mkdir(parents=True, exist_ok=True)
    receipt = RUNTIME / 'summary.json'
    log = RUNTIME / 'output.txt'
    if receipt.exists():
        raise SystemExit('Existing attempt retained; reconcile it before a new dispatch.')
    rid = subprocess.check_output([
        sys.executable, str(LEDGER), 'start', '--harness', 'agy', '--provider',
        'google-antigravity', '--model', 'gemini-3.8-flash-high', '--reasoning', 'high',
        '--worktree', str(LANE), '--prompt-file', str(PROMPT), '--log', str(log),
        '--lane', args.attempt, '--summary',
        'Bounded external authoring: ' + PROMPT.stem,
    ], creationflags=FLAGS, text=True).strip().splitlines()[-1]
    state = dict(run_id=rid, start=time.time(), requested_model='gemini-3.8-flash-high',
                 requested_effort='high', status='running', worktree=str(LANE),
                 actual_model=None, accepted=False, prompt_file=str(PROMPT))
    state['contract'] = contract

    def save():
        tmp = receipt.with_suffix('.tmp')
        tmp.write_text(json.dumps(state, indent=2), encoding='utf-8')
        tmp.replace(receipt)

    code = 1
    try:
        with RunLease(ROOT/'.recovery-runtime/dispatch-limits.sqlite', rid, contract), log.open('w', encoding='utf-8') as out:
            child = subprocess.Popen([
                str(AGY), '--print', PROMPT.read_text(encoding='utf-8'), '--model',
                'gemini-3.8-flash-high', '--effort', 'high',
                '--dangerously-skip-permissions', '--print-timeout', str(contract['max_minutes']*60)+'s',
            ], cwd=LANE, stdout=out, stderr=subprocess.STDOUT, creationflags=FLAGS)
            state['pid'] = child.pid
            save()
            try:
                code = child.wait(timeout=contract['max_minutes']*60+30)
            except subprocess.TimeoutExpired:
                subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'],
                               creationflags=FLAGS, capture_output=True)
                code = 124
    except Exception as exc:
        state['launcher_error_type'] = type(exc).__name__
    finally:
        try:
            state['artifactReview'] = verify_artifacts(contract, LANE)
        except ContractError as exc:
            state['artifactReview'] = {'status': 'failed', 'reason': str(exc), 'accepted': False}
            code = code or 1
        state.update(exit_code=code, end=time.time(),
                     artifact_check='source-bound-contract',
                     status='review-required' if code == 0 else 'failed')
        save()
        ledger_finish = subprocess.run([
            sys.executable, str(LEDGER), 'finish', '--run-id', rid, '--exit-code', str(code),
            '--status', 'completed' if code == 0 else 'failed',
            '--task-type', 'implement', '--notes',
            'Candidate requires independent root acceptance; serving model unknown.', '--keep-state',
        ], creationflags=FLAGS, capture_output=True)
        state['ledger_finish_exit'] = ledger_finish.returncode
        save()
    return code


if __name__ == '__main__':
    raise SystemExit(main())
