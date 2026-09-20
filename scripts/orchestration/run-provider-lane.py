"""Run one bounded, owner-authorized OMP provider lane.

This launcher owns process lifetime and provenance only.  It does not read
credentials, provider configuration, or the prompt contents.  The PowerShell
entrypoint supplies ``ZAI_API_KEY`` for the GLM route from the owner-approved
DPAPI helper for the lifetime of this child process and restores the parent
environment afterwards.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from typing import Any
from dispatch_policy import DispatchHold, require_external_dispatch
from task_contract import ContractError, load_contract, verify_artifacts
from run_limits import RunLease
from adoption_gate import require_native_adoption


REPO_ROOT = Path(__file__).resolve().parents[2]
LEDGER = Path(r"C:\Users\david\projects\worktrees\provider-refresh-20260909\scripts\record_delegated_run.py")
OMP = Path(r"C:\Users\david\AppData\Roaming\npm\omp.exe")
RUNTIME_ROOT = REPO_ROOT / ".recovery-runtime" / "provider-runs"
MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024
MAX_TRANSCRIPT_LINES = 20_000
MAX_TRANSCRIPT_LINE_BYTES = 1 * 1024 * 1024
LANE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

ROUTES: dict[str, dict[str, str]] = {
    "glm": {
        "provider": "zai",
        "model": "zai/glm-5.3-flash",
        "effort": "max",
    },
    "muse": {
        "provider": "meta-contributor",
        "model": "meta-contributor/muse-spark-1.3-contributor",
        "effort": "xhigh",
    },
}


class LaneError(RuntimeError):
    """A fail-closed launcher or provenance error."""


def _flags() -> int:
    return subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _resolve_path(raw: str) -> Path:
    return Path(raw).expanduser().resolve()


def _git_value(worktree: Path, *args: str) -> Path:
    result = subprocess.run(
        ["git", "-C", str(worktree), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_flags(),
        check=False,
        timeout=20,
    )
    if result.returncode != 0:
        raise LaneError(f"git verification failed for {worktree}: {args[0]}")
    value = result.stdout.strip()
    if not value:
        raise LaneError(f"git returned no value for {args[0]}: {worktree}")
    return Path(value).resolve()


def _validate_inputs(prompt_file: Path, worktree: Path, lane: str, route: str) -> dict[str, Any]:
    try:
        require_external_dispatch(REPO_ROOT, route)
    except DispatchHold as exc:
        raise LaneError(str(exc)) from exc
    if not LANE_RE.fullmatch(lane):
        raise LaneError("Lane must be 1-64 characters of letters, digits, '.', '_' or '-'.")
    if route not in ROUTES:
        raise LaneError(f"Unsupported route {route!r}; choose glm or muse.")
    require_native_adoption(route)
    if not prompt_file.is_file():
        raise LaneError(f"PromptFile is not a regular file: {prompt_file}")
    if not worktree.is_dir():
        raise LaneError(f"Worktree is not a directory: {worktree}")
    if not LEDGER.is_file():
        raise LaneError(f"Delegated-run ledger is missing: {LEDGER}")
    if not OMP.is_file():
        raise LaneError(f"OMP executable is missing: {OMP}")

    project_common = _git_value(REPO_ROOT, "rev-parse", "--git-common-dir")
    candidate_common = _git_value(worktree, "rev-parse", "--git-common-dir")
    if project_common != candidate_common:
        raise LaneError(
            "Worktree is not from this project's git common directory: "
            f"{candidate_common} != {project_common}"
        )
    candidate_root = _git_value(worktree, "rev-parse", "--show-toplevel")
    if not candidate_root.is_dir():
        raise LaneError(f"Worktree root could not be resolved: {candidate_root}")

    planned = dict(ROUTES[route])
    planned.update(
        {
            "route": route,
            "lane": lane,
            "promptFile": str(prompt_file),
            "worktree": str(worktree),
            "projectCommonDir": str(project_common),
        }
    )
    planned['contract'] = load_contract(REPO_ROOT, lane, route, worktree, prompt_file)
    return planned


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _run_ledger(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(LEDGER), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_flags(),
        check=False,
        timeout=30,
    )


def _start_ledger(run_id: str, plan: dict[str, Any], transcript: Path) -> str:
    result = _run_ledger(
        [
            "start",
            "--run-id",
            run_id,
            "--harness",
            "omp",
            "--provider",
            plan["provider"],
            "--model",
            plan["model"],
            "--reasoning",
            plan["effort"],
            "--worktree",
            plan["worktree"],
            "--prompt-file",
            plan["promptFile"],
            "--log",
            str(transcript),
            "--lane",
            plan["lane"],
            "--summary",
            f"owner-authorized provider lane: {plan['route']}/{plan['lane']}",
        ]
    )
    if result.returncode != 0:
        raise LaneError(f"Delegated-run ledger start failed ({result.returncode}).")
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines or lines[-1] != run_id:
        raise LaneError("Delegated-run ledger did not return the requested run id.")
    return lines[-1]


def _finish_ledger(run_id: str, exit_code: int, failed: bool) -> int:
    status = "failed" if failed else "completed"
    result = _run_ledger(
        [
            "finish",
            "--run-id",
            run_id,
            "--exit-code",
            str(exit_code),
            "--status",
            status,
            "--notes",
            "Process completion is recorded separately; provider attribution and artifact quality remain review-required.",
            "--keep-state",
        ]
    )
    return result.returncode


ASSISTANT_EVENTS = {"message_start", "message_end", "turn_start", "turn_end", "response_start", "response_end"}
TOOL_END_EVENTS = {"tool_execution_end", "tool_end"}
TERMINAL_EVENTS = {"error", "run_error", "response_error", "turn_error"}
DELTA_EVENTS = {"message_update", "tool_execution_update"}


def _short_scalar(value: Any) -> Any:
    if isinstance(value, str):
        return value[:256]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return None


def _assistant_audit_record(event: dict[str, Any]) -> dict[str, Any] | None:
    event_type = event.get("type")
    message = event.get("message")
    if event_type not in ASSISTANT_EVENTS or not isinstance(message, dict) or message.get("role") != "assistant":
        return None
    record: dict[str, Any] = {"type": event_type, "message": {"role": "assistant"}}
    for key in ("api", "provider", "model", "stopReason", "status", "errorMessage"):
        if key in message:
            if key == "errorMessage":
                record["message"][key] = "present" if message[key] else None
            else:
                scalar = _short_scalar(message[key])
                if scalar is not None:
                    record["message"][key] = scalar
    for key in ("status", "stopReason", "responseId", "id"):
        scalar = _short_scalar(event.get(key))
        if scalar is not None:
            record[key] = scalar
    if event_type == 'message_end' and isinstance(message.get('usage'), dict):
        usage = message['usage']
        safe = {k: v for k, v in usage.items() if k in {'input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'}
                and type(v) in (int, float) and math.isfinite(v) and v >= 0}
        if isinstance(usage.get('cost'), dict):
            safe['cost'] = {k: v for k, v in usage['cost'].items() if k in {'input', 'output', 'cacheRead', 'cacheWrite', 'total'}
                            and type(v) in (int, float) and math.isfinite(v) and v >= 0}
        record['message']['usage'] = safe
    if message.get("errorMessage") or any(
        isinstance(message.get(key), str) and message[key].lower() in {"error", "failed", "failure", "errored"}
        for key in ("status", "stopReason")
    ):
        record["terminalError"] = True
    return record


def _tool_audit_record(event: dict[str, Any]) -> dict[str, Any] | None:
    if event.get("type") not in TOOL_END_EVENTS:
        return None
    record: dict[str, Any] = {"type": event.get("type")}
    for key in ("toolName", "toolCallId", "status", "isError"):
        scalar = _short_scalar(event.get(key))
        if scalar is not None:
            record[key] = scalar
    if event.get("error") not in (None, "", [], {}):
        record["errorPresent"] = True
    return record


def _terminal_audit_record(event: dict[str, Any]) -> dict[str, Any] | None:
    if event.get("type") not in TERMINAL_EVENTS:
        return None
    record: dict[str, Any] = {"type": event.get("type"), "terminalError": True}
    for key in ("status", "errorMessage", "id"):
        scalar = _short_scalar(event.get(key))
        if scalar is not None:
            record[key] = "present" if key == "errorMessage" and scalar else scalar
    if event.get("error") not in (None, "", [], {}):
        record["errorPresent"] = True
    return record


class _BoundedCapture:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.written = 0
        self.lines = 0
        self.json_lines = 0
        self.non_json_lines = 0
        self.oversize_lines = 0
        self.delta_events_dropped = 0
        self.canonical_records_seen = 0
        self.retained_records = 0
        self.truncated = False
        self.thread: threading.Thread | None = None

    def start(self, stream: Any) -> None:
        def copy() -> None:
            with self.path.open("wb") as out:
                while True:
                    chunk = stream.readline()
                    if not chunk:
                        return
                    self.lines += 1
                    if len(chunk) > MAX_TRANSCRIPT_LINE_BYTES:
                        self.oversize_lines += 1
                        continue
                    try:
                        event = json.loads(chunk.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        self.non_json_lines += 1
                        continue
                    self.json_lines += 1
                    if not isinstance(event, dict):
                        self.non_json_lines += 1
                        continue
                    event_type = event.get("type")
                    if event_type in DELTA_EVENTS:
                        self.delta_events_dropped += 1
                        continue
                    record = (
                        _assistant_audit_record(event)
                        or _tool_audit_record(event)
                        or _terminal_audit_record(event)
                    )
                    if record is None:
                        continue
                    self.canonical_records_seen += 1
                    encoded = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
                    if self.written + len(encoded) > MAX_TRANSCRIPT_BYTES or self.retained_records >= MAX_TRANSCRIPT_LINES:
                        self.truncated = True
                        continue
                    out.write(encoded)
                    self.written += len(encoded)
                    self.retained_records += 1

        self.thread = threading.Thread(target=copy, name="provider-lane-log", daemon=True)
        self.thread.start()

    def join(self, stream: Any) -> None:
        if self.thread:
            self.thread.join(timeout=5)
            if self.thread.is_alive():
                try:
                    stream.close()
                except OSError:
                    pass
                self.thread.join(timeout=5)


def _terminate_tree(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True,
            creationflags=_flags(),
            check=False,
            timeout=20,
        )
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


def _run_omp(plan: dict[str, Any], minutes: int, transcript: Path) -> tuple[int, bool, dict[str, Any]]:
    env = os.environ.copy()
    env["NODE_OPTIONS"] = "--max-old-space-size=1536"
    if plan["route"] != "glm":
        env.pop("ZAI_API_KEY", None)
    command = [
        str(OMP),
        "-p",
        "@" + plan["promptFile"],
        "--model",
        plan["model"],
        "--thinking",
        plan["effort"],
        "--mode",
        "json",
        "--no-session",
        "--no-title",
        "--no-prewalk",
        "--no-pty",
        "--max-time",
        f"{minutes}m",
        "--cwd",
        plan["worktree"],
    ]
    admitted_skills = plan['contract']['skills']
    command += ['--skills=' + ','.join(admitted_skills)] if admitted_skills else ['--no-skills']
    try:
        proc = subprocess.Popen(
            command,
            cwd=plan["worktree"],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=_flags(),
            start_new_session=os.name != "nt",
        )
    except OSError as exc:
        transcript.write_text(
            json.dumps({"type": "launcher_error", "event": "spawn", "errorType": type(exc).__name__}) + "\n",
            encoding="utf-8",
        )
        return 1, False, {
            "truncated": False,
            "retainedRecords": 0,
            "canonicalRecordsSeen": 0,
            "deltaEventsDropped": 0,
            "nonJsonLines": 0,
            "oversizeLines": 0,
        }

    capture = _BoundedCapture(transcript)
    assert proc.stdout is not None
    capture.start(proc.stdout)
    timed_out = False
    try:
        code = proc.wait(timeout=minutes * 60)
    except subprocess.TimeoutExpired:
        timed_out = True
        _terminate_tree(proc)
        try:
            code = proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
            code = 124
    finally:
        capture.join(proc.stdout)
        try:
            proc.stdout.close()
        except OSError:
            pass
    return code, timed_out, {
        "truncated": capture.truncated,
        "retainedRecords": capture.retained_records,
        "canonicalRecordsSeen": capture.canonical_records_seen,
        "deltaEventsDropped": capture.delta_events_dropped,
        "nonJsonLines": capture.non_json_lines,
        "oversizeLines": capture.oversize_lines,
    }


def _transcript_facts(path: Path) -> dict[str, Any]:
    providers: set[str] = set()
    models: set[str] = set()
    terminal_errors: list[dict[str, Any]] = []
    recoverable_tool_errors: list[dict[str, Any]] = []
    parsed = 0
    bytes_seen = 0
    lines_seen = 0
    bounded = False
    usage_records = []

    with path.open("rb") as source:
        while True:
            raw = source.readline()
            if not raw:
                break
            lines_seen += 1
            bytes_seen += len(raw)
            if lines_seen > MAX_TRANSCRIPT_LINES or bytes_seen > MAX_TRANSCRIPT_BYTES:
                bounded = True
                break
            try:
                value = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            parsed += 1
            if not isinstance(value, dict):
                continue
            event_type = value.get("type")
            message = value.get("message")
            if event_type in ASSISTANT_EVENTS and isinstance(message, dict) and message.get("role") == "assistant":
                if event_type == 'message_end' and message.get('usage'):
                    usage_records.append(message['usage'])
                provider = message.get("provider")
                model = message.get("model")
                if isinstance(provider, str) and provider.strip():
                    providers.add(provider.strip())
                if isinstance(model, str) and model.strip():
                    models.add(model.strip())
                if message.get("errorMessage"):
                    terminal_errors.append({"line": lines_seen, "kind": "assistant-errorMessage"})
                elif value.get("terminalError"):
                    terminal_errors.append({"line": lines_seen, "kind": "assistant-terminal-status"})
            elif value.get("terminalError") or event_type in TERMINAL_EVENTS:
                terminal_errors.append({"line": lines_seen, "kind": str(event_type or "terminal")})
            if event_type in TOOL_END_EVENTS and (value.get("isError") is True or value.get("errorPresent") is True):
                recoverable_tool_errors.append({"line": lines_seen, "kind": "tool-error"})
    return {
        "providers": sorted(providers),
        "models": sorted(models),
        "terminalErrors": terminal_errors[:32],
        "recoverableToolErrors": recoverable_tool_errors[:32],
        "retainedRecords": parsed,
        "canonicalRecordsSeen": parsed,
        "deltaEventsDropped": 0,
        "nonJsonLines": 0,
        "oversizeLines": 0,
        "parsedJsonLines": parsed,
        "seenLines": lines_seen,
        "seenBytes": bytes_seen,
        "boundedRead": bounded,
        "usage": usage_records,
    }


def _model_matches(actual: set[str], requested: str) -> bool:
    suffix = requested.split("/", 1)[-1]
    return any(value == requested or value == suffix or value.endswith("/" + suffix) for value in actual)


def _dry_run(plan: dict[str, Any], minutes: int) -> int:
    print(json.dumps({
        "status": "dry-run",
        "reviewRequired": True,
        "route": plan["route"],
        "provider": plan["provider"],
        "model": plan["model"],
        "effort": plan["effort"],
        "minutes": minutes,
        "promptFile": plan["promptFile"],
        "worktree": plan["worktree"],
        "projectCommonDir": plan["projectCommonDir"],
        "ledger": str(LEDGER),
        "omp": str(OMP),
        "secretRead": False,
        "modelInvoked": False,
    }, ensure_ascii=False, sort_keys=True))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one bounded OMP provider lane.")
    parser.add_argument("--prompt-file", required=True, dest="prompt_file")
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--lane", required=True)
    parser.add_argument("--route", required=True, choices=sorted(ROUTES))
    parser.add_argument("--minutes", required=True, type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.minutes <= 30:
        parser.error("--minutes must be between 1 and 30")

    lease = None
    ledger_run_id = None
    try:
        prompt_file = _resolve_path(args.prompt_file)
        worktree = _resolve_path(args.worktree)
        plan = _validate_inputs(prompt_file, worktree, args.lane, args.route)
        contract = plan['contract']
        if args.minutes > contract['max_minutes']:
            raise ContractError('Requested runtime exceeds contract')
        if args.dry_run:
            return _dry_run(plan, args.minutes)

        run_id = f"delegated-omp-{args.lane}-{uuid.uuid4().hex}"
        lease = RunLease(REPO_ROOT/'.recovery-runtime/dispatch-limits.sqlite', run_id, contract)
        lease.__enter__()
        run_dir = RUNTIME_ROOT / run_id
        run_dir.mkdir(parents=True, exist_ok=False)
        transcript = run_dir / "transcript.jsonl"
        receipt = run_dir / "summary.json"
        state: dict[str, Any] = {
            "schema": "provider-lane/1",
            "runId": run_id,
            "status": "review-required",
            "accepted": False,
            "route": plan["route"],
            "requestedProvider": plan["provider"],
            "requestedModel": plan["model"],
            "requestedEffort": plan["effort"],
            "minutes": args.minutes,
            "lane": plan["lane"],
            "promptFile": plan["promptFile"],
            "worktree": plan["worktree"],
            "projectCommonDir": plan["projectCommonDir"],
            "transcript": str(transcript),
            "startedAt": _utc_now(),
            "reviewNote": "Process exit is not acceptance; inspect the transcript and resulting worktree.",
            "secretPolicy": "ZAI_API_KEY is supplied by the PowerShell wrapper only for the GLM child and is never persisted.",
        }
        _write_json(receipt, state)
        ledger_run_id = _start_ledger(run_id, plan, transcript)
        state["ledgerRunId"] = ledger_run_id
        _write_json(receipt, state)
        state['contract'] = contract
        _write_json(receipt, state)
        exit_code, timed_out, audit = _run_omp(plan, args.minutes, transcript)
        try:
            state['artifactReview'] = verify_artifacts(contract, worktree)
        except ContractError as exc:
            state['artifactReview'] = {'status': 'failed', 'reason': str(exc), 'accepted': False}
        facts = _transcript_facts(transcript)
        facts.update(audit)
        truncated = bool(audit["truncated"])
        actual_providers = set(facts["providers"])
        actual_models = set(facts["models"])
        attribution_present = bool(actual_providers) and bool(actual_models)
        route_mismatch = attribution_present and (
            plan["provider"] not in actual_providers or not _model_matches(actual_models, plan["model"])
        )
        failure_reasons: list[str] = []
        if state['artifactReview']['status'] == 'failed':
            failure_reasons.append('artifact contract failed')
        if exit_code != 0:
            failure_reasons.append(f"provider process exited {exit_code}")
        if timed_out:
            failure_reasons.append("launcher timeout killed its own subprocess tree")
        if facts["terminalErrors"]:
            failure_reasons.append("transcript reported a terminal error")
        if truncated:
            failure_reasons.append("canonical transcript audit was truncated")
        if not attribution_present:
            failure_reasons.append("actual provider/model attribution missing from bounded JSONL")
        if route_mismatch:
            failure_reasons.append("actual provider/model does not match the planned route")
        state.update({
            "endedAt": _utc_now(),
            "outcome": "failed" if failure_reasons else "process-completed",
            "exitCode": exit_code,
            "timedOut": timed_out,
            "transcriptTruncated": truncated,
            "actualProvider": facts["providers"][0] if len(facts["providers"]) == 1 else None,
            "actualProviders": facts["providers"],
            "actualModel": facts["models"][0] if len(facts["models"]) == 1 else None,
            "actualModels": facts["models"],
            "attribution": {
                "status": "observed" if attribution_present else "missing",
                "boundedJsonl": True,
                "parsedJsonLines": facts["parsedJsonLines"],
                "seenLines": facts["seenLines"],
                "seenBytes": facts["seenBytes"],
            },
            "transcriptErrors": facts["terminalErrors"],
            "recoverableToolErrors": facts["recoverableToolErrors"],
            "audit": {
                "retainedRecords": facts["retainedRecords"],
                "canonicalRecordsSeen": facts["canonicalRecordsSeen"],
                "deltaEventsDropped": facts["deltaEventsDropped"],
                "nonJsonLines": facts["nonJsonLines"],
                "oversizeLines": facts["oversizeLines"],
                "bounded": True,
                "truncated": truncated,
            },
            "failureReasons": failure_reasons,
            "usage": facts['usage'],
            "costAuthority": "OMP estimates only; not subscription quota or provider invoice",
            "billingClass": contract['billing_class'],
            "reservedUsd": contract['reserved_usd'],
            "ledgerStatus": "failed" if failure_reasons else "completed",
        })
        _write_json(receipt, state)
        ledger_finish_exit = _finish_ledger(run_id, exit_code, bool(failure_reasons))
        ledger_run_id = None
        state["ledgerFinishExit"] = ledger_finish_exit
        if ledger_finish_exit != 0:
            state["failureReasons"].append("delegated-run ledger finish failed")
            state["outcome"] = "failed"
        _write_json(receipt, state)
        print(json.dumps({
            "status": "review-required",
            "outcome": state["outcome"],
            "runId": run_id,
            "receipt": str(receipt),
            "transcript": str(transcript),
            "actualProvider": state["actualProvider"],
            "actualModel": state["actualModel"],
        }, ensure_ascii=False, sort_keys=True))
        return 1 if state["failureReasons"] else 0
    except (LaneError, ContractError, OSError, subprocess.SubprocessError) as exc:
        if ledger_run_id:
            _finish_ledger(ledger_run_id, 2, True)
        print(f"provider-lane failed closed: {exc}", file=sys.stderr)
        return 2
    finally:
        if lease is not None:
            lease.finish()


if __name__ == "__main__":
    raise SystemExit(main())
