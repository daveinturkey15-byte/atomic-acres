# Astra contribution record — September 20

VERIFIED authorization: Dave explicitly permitted two Astra xhigh implementation specialists until 09:00 Europe/London today. Both were dispatched as gpt-6-astra / xhigh. They self-stop by 08:58; the quarter-hour continuation checks enforce the 09:00 cutoff. Non-OpenAI authoring continues afterwards.

| Specialist | Authored scope | Source | Acceptance |
|---|---|---|---|
| astra_shading | Optional thin glazing, layout-derived reflection probes, post-chain refresh and disposal | Native 37badd00fb139a6d51d0cf7614363c7b6fd84008; root de788b5 | VERIFIED root CPU ownership/cache checks and build; actual GPU review running. Approximate static probes, not dynamic scene reflections. |
| astra_motion | Time-based reload/inspection transforms, ADS endpoint, look/recoil settling, palm/wrist/sleeve motion and prone clearance | Native d4406fdbfb62e8f7424f4378aab2cb8f3803da72; evidence eb77c1acc922b4f01d23ff4f9c92b4ae7ecb7fde | CLAIMED worker CPU equivalence and rig checks; root integration and moving-frame acceptance pending. |
| astra_motion, second slice | New hand/forearm geometry under an independently frozen contact/clearance contract | In progress | OPEN. Earlier Muse hand geometry remains rejected; its failed bounds/contact checks are retained. |

VERIFIED root's role remains orchestration, review, acceptance and mechanical integration. Other model contributions are recorded in VISUAL-OVERHAUL-2026-09-20.md and CURRENT.json. No native OpenAI image generation is authorized.

VERIFIED root review 06:39: shading passed eight matched-camera WebGPU frames, source/HTTP parity and zero console errors. House glass is clearer; vehicle glass remains too flat. Bounded visual repair 1 is assigned, including compatibility with the external half-float HDR lighting candidate. Initial candidate remains optional and unpromoted.

VERIFIED motion source integrated as fa4c7f5, evidence 8f4ea3e. Root reran 6,970 controller frames and 172 exact action comparisons successfully. Seventeen real-game pose frames passed with zero console errors in captures/astra-motion-0634. Viewed rifle reload, prone and pistol reload show a visible tilt/reach change. Temporal playback and improved mesh acceptance remain OPEN. New hands r2 exceeded its fixed cuff envelope; preserve failure and return to passing r1 rather than attempt a third repair.
