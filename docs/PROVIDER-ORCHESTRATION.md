# Provider orchestration

`Invoke-ProviderLane.ps1` is a small, owner-authorized wrapper for one bounded
OMP worker lane. It records process and route evidence for review; a clean
process exit never accepts the worker's changes.

## Current owner hold

Game development and external workers are paused for the September 20 pipeline
audit. Both Python launchers and the PowerShell entrypoint now consult
`CURRENT.json.dispatch_policy`. Missing/malformed policy, disabled workers or an
unlisted route is rejected before a provider or ledger launch. The PowerShell
entrypoint checks before accessing the secret helper. Dry runs also respect the
hold. There is no command-line bypass; do not edit owner policy to make a run pass.

This is local launcher admission, not a machine-wide sandbox or aggregate
cost/concurrency enforcement. Fresh native-harness inheritance tests remain OPEN.
Run `python -m unittest discover -s scripts/orchestration -p test_dispatch_policy.py`
for the offline contract checks. See `docs/handoff/PIPELINE-AUDIT-2026-09-20.md`.

## Routes

| Route | Provider/model | Effort | Secret handling |
|---|---|---|---|
| `glm` | `zai/glm-5.3-flash` | `max` | The PowerShell wrapper assigns `ZAI_API_KEY` from the owner-approved `zai_coding_plan` DPAPI helper for the child lifetime, then restores the previous environment. |
| `muse` | `meta-contributor/muse-spark-1.3-contributor` | `xhigh` | No Z.ai secret is read; the child receives no inherited `ZAI_API_KEY`. |

The Python launcher does not read credentials, helper scripts, provider
configuration, or prompt contents. It receives the prompt path and lets OMP
read it. The only secret assignment is the direct PowerShell assignment:

```powershell
$env:ZAI_API_KEY = & C:/Users/david/.secrets/Get-Secret.ps1 zai_coding_plan
```

The value is kept in the process environment only. It is never printed or
written to a log, receipt, ledger row, or source file. Dry-run mode never calls
the helper.

## Usage

From the recovery worktree:

```powershell
.\scripts\orchestration\Invoke-ProviderLane.ps1 `
  -PromptFile C:\path\to\prompt.md `
  -Worktree C:\Users\david\Desktop\stuff\worktrees\nuketown-recovery-20260919 `
  -Lane audio-check `
  -Route muse `
  -Minutes 10
```

Use `-DryRun` to validate the prompt/worktree paths, route plan, OMP/ledger
paths, and git project identity without reading the secret or invoking OMP:

```powershell
.\scripts\orchestration\Invoke-ProviderLane.ps1 `
  -PromptFile .\scripts\orchestration\run-provider-lane.py `
  -Worktree (Get-Location) `
  -Lane smoke `
  -Route glm `
  -Minutes 1 `
  -DryRun
```

`Minutes` is an inclusive 1–30 minute bound. The wrapper passes the same bound
to OMP and kills only the subprocess tree it started when the bound expires.
OMP runs with `NODE_OPTIONS=--max-old-space-size=1536`. Windows children are
created without a console window.

## Project and receipt boundaries

Before delegation, the launcher resolves `Worktree` through Git and compares
its `--git-common-dir` with this recovery project's common directory. A
different project fails closed. `Lane` is restricted to a safe bounded name so
it cannot escape the runtime directory.

Each live run gets a unique directory under the ignored
`.recovery-runtime/provider-runs/` tree:

```text
.recovery-runtime/provider-runs/<run-id>/transcript.jsonl
.recovery-runtime/provider-runs/<run-id>/summary.json
```

The launcher drains the full OMP stream, drops high-volume
`message_update`/`tool_execution_update` deltas, and retains only bounded
canonical assistant envelopes, terminal run errors, and tool-end metadata.
The retained audit is capped at 8 MiB, 20,000 records, and 1 MiB per input
line. Provider/model attribution is accepted only from an envelope whose
`message.role` is `assistant`; fields nested in tool results or catalogs cannot
attest the route. Recoverable `tool_execution_end` `isError` records are
reported separately, while an assistant `errorMessage` or top-level run error
is terminal. Canonical audit truncation is a failure even when the process
exits zero.

The summary records the requested route, actual assistant-envelope
provider/model fields, bounded audit counters, and terminal errors. It is
always marked `review-required` with `accepted: false`. A terminal transcript
error, route mismatch, missing actual attribution, timeout, non-zero process
exit, canonical audit truncation, or ledger-finalize failure makes the wrapper
fail. A zero exit with no such mechanical failure still requires review of the
transcript and resulting worktree.

The retained transcript is metadata-only: assistant text, tool result bodies,
catalogs, and code payloads are discarded while the stream is drained.

The existing delegated-run ledger is updated for process accounting only at
`C:\Users\david\projects\worktrees\provider-refresh-20260909\scripts\record_delegated_run.py`.
Its completed row is not a quality verdict.

## Scope

This wrapper owns only provider process lifetime, bounded logs, route
attribution, and the review receipt. It does not build, serve, open a browser,
touch GPU state, edit game sources, merge work, or commit changes. The root
integrator remains responsible for reviewing the worktree and running the
appropriate project gates.
