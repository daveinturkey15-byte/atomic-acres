# Astra contribution record — 20 September 2026

VERIFIED: exactly two gpt-6-astra xhigh implementation specialists were authorized until09:00 Europe/London. Both completed and stopped by08:47; root verified completed states at08:51. No further native implementation is authorized. Root continues orchestration/review/mechanical integration. External models continue implementation; no OpenAI image generation was used.

| Specialist | Authored contribution | Verified evidence and limits |
|---|---|---|
| astra_shading | Glazing/static reflection probes/vehicle cabin shading | VERIFIED roots de788b5/fd4a2f3/508d63c/439df6e, eight paired WebGPU views. Approximate reflections, not live ray tracing. |
| astra_shading | Scanned architectural plaster/timber across seven identities | VERIFIED final root4f23513/native25b2c96 fixes reproduced Three r180 shader-cache collision after two rejected trials. Four maps, no extra draws; actual interior bands gone. 210s/53.1fps resource run. Regression guard retained. |
| astra_shading | Detailed yard-tree foliage | VERIFIED root14d3af2/natived3dcf6d:30 opaque lobes on10trees replaced by12,800 scanned alpha leaves and120twigs. Eight matched actual views, unchanged draws, +19,200 measured multipass triangles. Other trees remain unfinished. |
| astra_shading | Curved street lamps | VERIFIED root3b2615b/native6dc9cab: eight continuous poles, recessed lenses/shaped caps; unchanged collider positions. Eight actual views, no new materials/textures/lights, +22,016 multipass triangles. |
| astra_shading | Geometry correction of Muse-authored Blender coach | VERIFIED native dd2fc072/22e5604b; root4327d97. Fixed twisted glass, off-origin lamp cylinders, disconnected arch boxes. Root bake12.35s/338MiB private;9,824tris/sixdraws/4,789,512B. Eight WebGPU views and exact collider envelope pass. Narrow geometry gain, still stylized. Exact baked recipe preserved separately from an unbaked BMesh compatibility edit. |
| astra_motion | Look/recoil settling, reload reach/roll, ADS/sleeves | VERIFIED rootfa4c7f5/8f4ea3e,6,970controller frames/172unchanged actions,17liveposes and actual sprint. |
| astra_motion | Pistol hand anatomy/contact rig | VERIFIED rootc033ade/ed9dd26/b59a64a,241reload/1,205offhand/980stance CPU samples. OPEN actual temporal coverage5/6; optional pistol hand variant remains outside recommended flags. |
| astra_motion | Rifle-family hand contact/reload | VERIFIED rootaaeb7f5/native02217fc, frozen contractae4ee65. Two rifle modes6/6actual reload phases; real shots/refill/sprint and four other weapon families checked. Foliage/rifle210s soak52.3fps. Anatomy remains stylized. |
| astra_motion | Muzzle gas and impact dust/sparks | VERIFIED rootc935b6a/native9202248 final repair2/2 prevents transparent particles writing opaque auxiliary MRT surfaces.16CPU checks/four negative controls;192fixedslots/threebatches384tris. Final actual WebGPU/host shots/camera parity pass and viewed dark cards gone. OPEN floor temporal coverage3/5 and live disposal counters; old bright flash retained. Optional FX excluded from recommended review flags. |
| astra_motion | Actual-action observers | VERIFIED menu recovery, temporal reload and real-shot CDP observers preserve exact build/camera identity and actual timing. Missing phases remain OPEN; no authoritative kills synthesized. |

VERIFIED external attribution: GLM authored weapon surface maps and narrow HUD repair; AGY supplied finish flag correction, loader wiring and responsive HUD layout (requested Gemini3.8Flash high, serving model UNKNOWN). Muse authored underlying coach/operator recipes. GLM supplied coach consolidation; Muse corrected JSON padding. These are not Astra-original assets.

VERIFIED receipts: captures/gauntlet/foliage/round-0801; captures/gauntlet/street-lamps/round-0824; captures/gauntlet/coach/round-geometry-0840; captures/weapon-fx-temporal-2026-09-20T07-48-36-689Z-N051Rf; captures/leak/astra-canaries-0812-soak.json; work/coach-geometry-0824/root-acceptance-receipt.json.

OPEN: complete map-wide visual overhaul and60fps remain unmet. Operator-shape0800 passes technical gates but remains too cylindrical, with poor knee seams, so it is withheld. External anatomy, sedan and fence lanes continue. CURRENT.json records current build identity, resource verdict and ownership.
