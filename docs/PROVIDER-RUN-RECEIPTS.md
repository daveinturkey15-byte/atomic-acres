# Provider run receipts

This is a metadata-only reconciliation of the bounded provider summaries under
`.recovery-runtime/provider-runs/`, the provider launcher contract in
`docs/PROVIDER-ORCHESTRATION.md`, and the campaign record in
`docs/handoff/CAMPAIGN-2026-09-19.md`. No credential, session, raw log, or
transcript body was read. The launcher always writes `status=review-required`
and `accepted=false`; that is an immutable receipt convention, not a claim that
root has accepted nothing. The separate root-review column records independent
artifact decisions and evidence.

## Recorded OMP lanes

| Run / artifact lane | Planned route | Returned attribution | Bound | Process result | Launcher receipt | Root-reviewed artifact outcome |
|---|---|---|---:|---|---|---|
| `delegated-omp-glm-fence-texture-cdf46fbcd3384a56b02f5f083d74ee04` · `glm-fence-texture` · `nuketown-glm-turf-20260919` | `zai/glm-5.3-flash` · max | `zai/glm-5.3-flash` | 15 min | **PROCESS_COMPLETED**, exit 0, ledger completed | `review-required; accepted=false` | **ROOT REVIEWED:** fence intake hashes and CC0 evidence accepted; runtime/visual fence review remains scoped separately |
| `delegated-omp-glm-render-budget-audit-bd26e75c13bd43c9b5bf9cd3354f54fe` · `glm-render-budget-audit` · `nuketown-recovery-20260919` | `zai/glm-5.3-flash` · max | `zai/glm-5.3-flash` | 12 min | **PROCESS_COMPLETED**, exit 0, ledger completed | `review-required; accepted=false` | **ROOT REVIEWED:** F1 independently source-reviewed; runtime acceptance remains OPEN |
| `delegated-omp-glm-resume-repair-3317eff729d74b4481d54566413b4f1d` · `glm-resume-repair` · `nuketown-glm-resume-20260919` | `zai/glm-5.3-flash` · max | `zai/glm-5.3-flash` | 27 min | **PROCESS_COMPLETED**, exit 0, ledger completed | `review-required; accepted=false` | **ROOT REVIEWED/REPAIRED:** resume base integrated at root commit `fc8c4c8`; H3 16/16 passed. This does not accept the untouched draft wholesale. |
| `delegated-omp-muse-resume-audit-a45805314a764874afd811e0c7211be4` · `muse-resume-audit` · `nuketown-muse-vehicle-20260919` | `meta-contributor/muse-spark-1.3-contributor` · xhigh | `meta-contributor/muse-spark-1.3-contributor` | 12 min | **PROCESS_COMPLETED**, exit 0, ledger completed | `review-required; accepted=false` | **ROOT REVIEWED:** findings confirmed by the GLM negative control; the audit itself is evidence, not an integrated artifact |
| `delegated-omp-muse-lighting-critic-g-cb16c074f5f7487bade0debcdadae323` · `muse-lighting-critic-g` · `nuketown-recovery-20260919` | `meta-contributor/muse-spark-1.3-contributor` · xhigh | `meta-contributor/muse-spark-1.3-contributor` | 12 min | **FAILED**; process exit 0 but terminal assistant error, ledger failed | `review-required; accepted=false` | **ROOT REVIEWED:** lighting critique rejected |
| `delegated-omp-glm-fence-finalize-ef124b5d980c496889d7a8bbf707b549` · `glm-fence-finalize` · `nuketown-glm-turf-20260919` | `zai/glm-5.3-flash` · max | `zai/glm-5.3-flash` | 12 min | **FAILED/TIMEOUT**; exit 1, launcher timeout killed its subprocess tree | `review-required; accepted=false` | **RAW RECEIPT ONLY:** no root-reviewed artifact acceptance |
| `delegated-omp-glm-fence-uv-canary-c5d926cd897b49f49362e12d671d3898` · `glm-fence-uv-canary` · `nuketown-glm-turf-20260919` | `zai/glm-5.3-flash` · max | `zai/glm-5.3-flash` | 18 min | **FAILED/TIMEOUT**; exit 1, launcher timeout killed its subprocess tree | `review-required; accepted=false` | **ROOT REVIEWED:** first UV visual I1 rejected for oversized grain; refinement remains in progress |
| `delegated-omp-glm-orange-batch-23dccff14dfa42b3aa676213a31296ac` · `glm-orange-batch` · `nuketown-glm-orange-batch-20260919` | `zai/glm-5.3-flash` · max | `zai/glm-5.3-flash` | 25 min | **PROCESS_COMPLETED**, exit 0, ledger completed | `review-required; accepted=false` | **ROOT REVIEWED CANDIDATE:** checkpoint J measured worst play calls 1189→891, zero errors across all four views, 13-station QA max 864 calls, and a 210.7s soak. This is bounded candidate evidence, not a release/public acceptance claim. |
| `delegated-omp-glm-resume-edges-8194d75546b94923923ae4ffc25d6fc6` · `glm-resume-edges` · `nuketown-recovery-20260919` | `zai/glm-5.3-flash` · max | `zai/glm-5.3-flash` | 20 min | **FAILED/TIMEOUT**, exit 1, launcher timeout killed its subprocess tree | `review-required; accepted=false` | **ROOT REVIEWED PARTIAL:** root salvaged the partial harness and its CPU proof passed. The provider lane did not complete; no claim is made that its draft or runtime edge behavior was accepted wholesale. | 
| `delegated-omp-glm-searsia-canary-61732419f2e742dfaa6f3d697fac2f8b` · `glm-searsia-canary` · `nuketown-agy-desert-tree-20260919` | `zai/glm-5.3-flash` · max | **ACTIVE**; no returned attribution yet | 25 min | **ACTIVE**, started 2026-09-19 15:03 UTC | `review-required; accepted=false` | **OPEN:** provider process and root review are pending; no acceptance claim is made. |

The orange lane is finalized in metadata with observed `zai/glm-5.3-flash`
attribution and a completed process receipt; its bounded root evidence is listed
separately from the immutable launcher `accepted=false` field. The resume-edges
lane is finalized as a timed-out process with observed `zai/glm-5.3-flash`
attribution; only the independently salvaged CPU proof is reviewed, and the
timed-out provider draft remains incomplete.

## Checkpoint J root-reviewed evidence

- **VERIFIED ROOT CHECKPOINT J:** the orange candidate reduced worst play calls
  from 1189 to 891, held zero errors across all four views, stayed at or below
  864 calls across 13 QA stations, and completed a 210.7s soak.
- **ROOT REVIEWED:** fence I1 and I2 remain rejected; I3 was accepted as a
  modest three-view refinement only.
- **ROOT REVIEWED:** Quiver G was accepted for actual placement proof and
  colliders plus a 420s G soak. This remains bounded asset/lifecycle evidence,
  not a broad scene or photorealism acceptance claim.

## Evidence outside the OMP receipts

- **CAMPAIGN-RECORDED:** an AGY/Gemini 3.8 Flash high-requested four-image
  critique is recorded as completed and its output reviewed under run
  `delegated-agy-25acf42f-6887-4781-8d51-f90d81f7322d`. This campaign entry is
  not a provider-lane summary, so it does not establish a separate accepted
  implementation.
- **AGY TREE INTAKE METADATA RECEIPT:** the thread work requested
  `gemini-3.8-flash-high`; serving attribution is **UNKNOWN** because no
  provider-lane summary was emitted for that intake. This metadata does not
  establish that Gemini served the thread or that the resulting asset was
  accepted.
- **VERIFIED campaign evidence:** the Quiver Tree 02 licensed-asset canary used
  Blender with two CPU threads, passed two native-scale placement/render frames,
  and was viewed. Checkpoint J additionally recorded root acceptance of actual
  placement proof/colliders and a 420s G soak. It is one bounded asset
  conversion; final scene quality and full Blender gauntlet acceptance remain
  open.
- **VERIFIED EXISTING KIMODO ASSETS:** the asset library records 15 integrated
  runtime Kimodo GLB clips on the 21-bone rig plus one retained rejected idle
  comparison. Their provenance and licence evidence are recorded in
  `docs/assets/library.md`, `docs/assets/library.json`, and the animation
  licence records. There is no new Kimodo provider run in this receipt; that
  does not erase or reclassify the existing integrated clips.
- **RESOURCE-DEFERRED:** no local Trellis or H3 inference was launched; the
  campaign records defer it because the model peak would exceed the available
  VRAM reserve. No asset or animation result is attributed to those models.
- **UNAVAILABLE:** Union Alpha was absent from the refreshed local catalog. No
  Union run or output is claimed.

## Reading rule

The launcher contract records route attribution only from an assistant
envelope and deliberately marks every run review-required. `exitCode=0`,
`outcome=process-completed`, and a completed ledger row prove process and
accounting completion only. They do not prove that a worker changed the right
artifact, that the artifact was integrated, or that gameplay, visual, memory,
or release gates passed.
