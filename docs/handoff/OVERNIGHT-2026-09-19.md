# Overnight integration — September 19 to 20

Owner inspection: **2026-09-20 05:45 Europe/London (04:45 UTC)**. Begin consolidation at 04:45 local and target a verified inspection artifact/report by 05:30 local. The owner explicitly authorized continuing overnight and asked to conserve OpenAI usage.

## Ownership and execution

OpenAI/Astra owns orchestration, source review, focused acceptance tests, mechanical integration of externally authored patches, and local artifact promotion. It does not author new game features or generate images in this wave. Native coding workers have stopped at preserved checkpoints. Implementation uses the owner's existing ZAI GLM5.3Flash max, Meta Muse Spark1.3 Contributor xhigh and AGY Gemini3.8Flash high routes. Requested and observed models remain separate; AGY has not exposed verified serving-model attribution.

Four independent jobs were dispatched at 17:44 local, with recorded run IDs and 25–30 minute bounds:

| Lane | Provider | Worktree | Concrete result |
|---|---|---|---|
| Combat feedback | Muse Contributor xhigh | nuketown-combat-feedback-20260919 | Finish preserved admitted-event integration, fatal/head/body anchors, reset/disposal and focused tests |
| First original catalogue weapon | GLM5.3Flash max | nuketown-prop-20260919 | Resume image-guided CPU Blender carbine, material/UV/socket/geometry verification |
| Video-guided animation | Muse Contributor xhigh | nuketown-animation-polish-20260919 | Intake owner's H3 references, preserve hands/gait improvements, author one supported motion improvement on the actual rig |
| Environment | AGY requested Gemini3.8Flash high | nuketown-environment-20260919 | Independently switchable ground PBR and distant mountains integrated into an isolated candidate |

Prompts are in `docs/orchestration/overnight-20260919/`. Receipts are under `.recovery-runtime/provider-runs/` and `.recovery-runtime/agy-overnight-environment/`. The run ledger records all CLI dispatches. A running process proves launch; an actual model record proves route attribution; source/tests/real game frames determine acceptance. None of these jobs is accepted merely by finishing.

One writer owns each lane. Root must not replace its newer main.ts with an older lane's whole file. Review scoped diffs and mechanically integrate the intended hunks. Ask the external worker to fix implementation defects. Root's unaccepted facade experiment is only two main.ts lines plus its new module; keep it out of an accepted build unless separately reviewed.

## Provider failover and bounded continuation

On actual quota/rate/auth failure, preserve partial outputs and terminalize the run honestly. Transfer the same scope and exact current state to another authorized route, with no overlapping writer: Muse → GLM → AGY, GLM → Muse → AGY, AGY → Muse → GLM. The order may change with observed availability. Do not silently use OpenAI implementation, alter shared credentials, or repeatedly retry a failed route. At most one attempt per route per lane per cycle; use reported cooldowns. If all routes fail, retain the latest playable build and report the concrete blocker.

The existing 15-minute thread heartbeat resumes integration and dispatches the next bounded useful task. It reads CURRENT and changed receipts first, avoiding repeated broad audits and large unchanged outputs. Routine healthy/pending checks are quiet. It must report meaningful accepted milestones and the morning inspection build, with actual contributor/status evidence.

## Resource control

The earlier carbine job was safely stopped when free RAM fell below 12 GiB during the owner's other workload. Source partials were preserved. The owner subsequently released resources and authorized resumption. At 17:46 local, approximately 29 GiB RAM was free and GPU use was 4,339/16,303 MiB; resample before every heavy job.

Keep at least 12 GiB free RAM and 3 GiB free VRAM plus headroom for the proposed task. Unknown measurements fail closed. Serialize GPU/model inference and game browsers. CPU Blender uses two threads and the repaired runner with a 2 GiB RSS/private-commit stop, typed Windows metrics, preflight and owned-tree cancellation. Never terminate owner processes. The guard's seven focused CPU tests passed without launching Blender. Trellis remains pending a verified lower-footprint run and owned cancellation; do not restart it blindly. Visible proof is required for art acceptance, but performance gates stay fixed.

## Owner's H3 soldier references

Source directory: `C:/Users/david/Desktop/stuff/h3-soldier-study-20260919`.
Root freshly verified both final MP4s with ffprobe: 8.000 seconds, 1920×1080, 24 fps, H.264 video and AAC audio. Root visually inspected the supplied first/third-person contact sheets. They show useful pose, grip, stance, aiming and throw references. This is not yet inspection of every moving frame or a skeletal reconstruction.

Exclude the source's `review-chrome-profile` entirely. Preserve the source media. Its historical generation-only scope is evidence; the owner's current request now authorizes using the videos to develop independent game animations. The illustrated HUD and approximate shot timestamps are not authoritative ammunition, cadence or damage data. First-person views cannot reconstruct invisible full-body joints. Label authored keyframes guided by video honestly; reserve “mocap” for an actually extracted, retargeted and tested skeletal result. Use the shared game-animation asset pipeline, current provenance, exact destination axes/rig, grounded contacts and real browser playback.

## Acceptance and remaining catalogue

Accepted inspection build remains **K** at `http://127.0.0.1:4191/`, source `2139d697434bf97bf38683eb0ed25e554096fd71`, JS `index-BUrZzgR1.js`, SHA256 `e8cb3f4fa86437ef164deded998e3613d5220d2115e52335096545af1ab13a91`. K improves menus/HUD and passed 18 actual-Chrome checks; its world/gameplay remains J. Preserve K and J immutable fallbacks. Major visual fidelity remains OPEN.

The production gallery `http://127.0.0.1:4193/#production-catalog` has 39 verified original 2D references: 20 guns, 11 old-reference streak storyboards, four grenades and four operator/pose sheets. The manifest has 38 logical delivery rows; zero newly authored/integrated/verified catalogue runtime assets so far. The gate's 62 self-tests and positive reference check passed; runtime-required mode correctly fails. The gallery's 39 HTTP images and selection/search/decode checks passed. Never report this as 39 shipped assets.

After the first integrations, continue the full catalogue and behavior contracts: 20 weapon families and profiles/FP/world/drop LODs; 11 old-reference streak behaviors compared to current dispatch; frag/smoke/flash plus missing semtex; bot +Z yaw/weapon socket alignment; prone/crouch/turn/throw/floor contacts; menu/loadout/critical feedback; audio and visual effects. Retain unresolved network mid-reload/rejoin, two-device WAN proof, bedroom stress clearance and reflection lifetime separately. Current frag/flash/smoke implementation is source-confirmed; semtex is OPEN. Do not let generating more reference art substitute for deploying these items.

Before morning promotion: matching-camera visual review, source checks and relevant behavior/net checks, actual game boot/play, resource/disposal soak where touched, clean browser errors, exact fresh-build/live payload identity, immutable rollback, and concise contributor/accepted/pending report. Do not weaken failing gates. A rejected visual candidate remains rejected even when its draw calls pass.
