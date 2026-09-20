# Standalone game pipeline

Owner: Dave. September 20, 2026. Canonical general authority:
`C:/Users/david/AppData/Local/hermes/.akephalos/rules/evidence-bound-pipeline.md`.
The shared helper and API contract live in `<AKP>/scripts/pipeline/README.md`.
This document implements that policy for this standalone project; it does not
change Skills Lab's no-OpenRouter policy or the older game's release machinery.

## Current operating mode

Dave's September20 16:45 usage correction resumes the specified economical
external implementation routes, initially with two independent source writers.
At17:00 he requested two of each route. Explicit CURRENT authorization now permits
up to six source writers, subject to measured12GiB reserve plus2GiB per total
admitted worker, and3GiB VRAM reserve. Unknown/low readings hold new launches.
Astra coordinates, reviews and mechanically integrates. No native OpenAI workers.
CURRENT records exact authorizations, ownership and requested/observed providers.
The shared Blender route is `<AKP>/scripts/blender/bridge.py`; read its README,
preflight resource headroom and keep one writer for the MCP scene. Saved client
entries and transport checks do not imply native reload, adoption or subagent
tool inheritance. The repair report is `../handoff/RESUMPTION-2026-09-20-1500.md`.

The lead completed a scoped room furniture and baked-visibility successor with
same-camera review and the unchanged active-game gate; full visual quality remains
open. Authoring can proceed in two isolated scopes. Workers cannot accept their work.
Retain failed candidates and frozen inspection builds. See
`../handoff/PIPELINE-COMPLETION-2026-09-20.md` for measured results and limitations.

## Source-bound dispatch

The existing OMP and AGY launchers now require, before dispatch:

1. CURRENT's explicit permission for that route.
2. Fresh native AKP `check` **and** `audit` for the actual harness.
3. A lead-owned contract under `docs/orchestration/contracts/<lane>.json`.
4. Exact integration HEAD, worker HEAD, current root/worker input hashes, frozen
   prompt and worker content inventory. A different source or dirty input refuses.
5. Explicit file scope, outputs, acceptance, billing class, time and attempt limits.
6. An evaluated skill allowlist checked against the canonical baseline and current
   SKILL.md hashes. An empty allowlist is explicit. OMP filters discovery to those
   names; AGY does not have a verified equivalent filter, so its author must obey
   the contract and the lead must inspect used skills. Neither route is an OS sandbox.
7. A local atomic lease: no overlapping tree writers, default two active launches
   (up to six only under the explicit owner expansion and fresh resource gate),
   at most two attempts for the same task ID, 1–30 minutes per worker and positive
   finite reservation of at most $1 per launch. Campaign reservations total $1.50.

Create a JSON specification with `task_id`, `owner`, `objective`, `route`, `tree`,
`inputs` (relative current-root paths), `writable_paths`, `outputs`, `acceptance`,
`skills` (name -> absolute path and sha256), `max_attempts`, `max_minutes`,
`billing_class` and `reserved_usd`. Freeze it without launching:

```powershell
python scripts/orchestration/task_contract.py --spec <lead-spec.json> --prompt <prompt.md> --lane <lane>
```

Use a fresh small seeded tree containing the actual input source. Keep the task ID
unchanged for a repair even if its contract changes. Never renew IDs, erase SQLite
ledgers or move directories to evade limits. A failed draft is preserved. Contracts
live outside the worker tree. File mutation checks cover tracked and unignored
files; ignored-file or process isolation is not provided by these checks.

The existing launchers record the shared run ID, planned and observed identities,
time, errors and artifact hashes. OMP retains numeric terminal usage and cost
estimates without assistant text. AGY identity and invoice cost remain unknown
unless exposed. Unknown cost retains the reservation; estimates are not invoices
or subscription quota readings. Local admission limits are not billing caps.
The separate synthetic-probe ledger also caps reservations at $1.50 and two
attempts per exact prompt/route; probe timeout is 195 seconds. These are separate
scope envelopes, not permission to spend both automatically.

Pending or crashed leases require human/lead reconciliation of the exact owned
process before release. A process ending is not acceptance. Verify declared outputs,
reject unrelated edits, inspect the patch, run the fixed relevant gate and boot the
actual candidate. One attempt plus one evidence-led repair; then preserve and
change approach with the lead. Do not weaken tests or silently retry providers.

## Optional Jev advice

All harnesses call the same AKP helper; this project's adapter only supplies its
root. Jev receives sanitized small decision state, never credentials or source
transcripts. Its pinned typed API supports routing and evidence-support advice.
Hard policy runs first, missing facts hold, failures hold and identical requests
use the shared cache. The fixed ledger allows 20 distinct calls and $0.04 local
reservations. Single-lead mode bypasses paid advice. Jev never dispatches a worker,
changes permissions, accepts an artifact or converts probabilities into test passes.

## Asset lineage and acceptance

Keep reference, authored, integrated and verified stages separate. Record the
source URL and snapshot, reference hash, authoring source, model and export hashes,
tool/model identity, runtime adapter, build hash and actual acceptance/frame hashes.
Distinguish code, generative model and output licences. Verify changing upstream
terms at use. `validate_lineage` checks these bindings; it cannot judge the art.

The production catalogue's carbine now links actual reference/model/runtime hashes.
Its old handoff names a different model hash and size, so it remains **unaccepted**.
A discovered authoring script is a candidate provenance link, not proof that it
reproduces the current GLB. Do not claim a generated image is deployed 3D.

## Verification and transfer

```powershell
python -m unittest discover -s scripts/orchestration -p test_*.py
node scripts/orchestration/verify_provider_probe.mjs
```

The Node command rechecks only three reviewed synthetic answers in local audit
storage. Its VM is not a security boundary for arbitrary worker code. Native AKP
adoption is distinct from this test. Current receipt hashes must be refreshed after
relevant control changes; linking files or a successful CLI exit is not parity.
Other projects may reuse the shared policy/helper, but must wire and test their own
launcher controls before claiming executable enforcement. No old session is
assumed to have hot-reloaded new instructions.
