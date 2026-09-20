# Active-game memory diagnosis, September 20

VERIFIED: unchanged noon port4242 served `index-DUiBXw9V.js`, SHA256
`5b3556df86914c62113b347788cb737ebc867f9c60388a55e82e8e099ce0f628`.
Canonical Play solo -> Deploy -> active scenario,210.8seconds,11,330frames,
53.7fps average,313,348 observed game render calls. No thresholds were edited.
The additional snapshot diagnostic passed: JS floor slope-0.355MiB/min,r2=.057;
renderer process slope4.356MiB/min,r2=.065,nonmonotonic. Snapshots at61/181seconds
retained only158,636 additional self-size bytes net, mostly compiled-code/native
timing bookkeeping. No growing gameplay container was identified in this interval.

Evidence: `captures/leak/noon-memory-1525-soak.json`, `*-t61.heapsnapshot`,
`*-t181.heapsnapshot`, `*-net-analysis.json`; guarded runner receipt in
`.recovery-runtime/noon-memory-1525-guard.json`. Minimum freeRAM32.05GiB,
freeVRAM11,145MiB. Owned browser exited; no owner workload was terminated.

OPEN: the original noon+0.7MiB/min,r2=.313 failure remains valid and preserved.
This diagnostic did not reproduce it and is not a proven leak repair. Heap
snapshots perturb the process footprint. Any successor must pass the original
uninstrumented gameplay gate and actual frame review before promotion. Noon4242
remains inspection-only. Accepted4240 and the two earlier frozen views remain.

INFERENCE: early code warm-up is a plausible contributor, supported by prior
30/90-second and current61/181-second heap totals. It is not a demonstrated sole
cause. Do not silently lengthen warm-up, average away a failing run or change the
gate. New room work is isolated behind `room=authored` for same-bundle A/B.

Diagnostic correction: initial HTTP identity helper misjoined `./assets` to the
base URL. Proper URI resolution independently verified the expected hash while
the probe was active. No successful hash result was claimed from the failed call.
