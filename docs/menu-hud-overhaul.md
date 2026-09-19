# Menu and HUD refinement K

The map selector now shows an actual game capture. The menu has clearer type and action hierarchy; the HUD separates equipment, weapon and ammunition, with consistent health and streak readouts. The current game still needs a substantial art-quality improvement; this change does not claim photoreal graphics.

Authorship: AGY authored the initial CSS/map candidate with Gemini 3.8 Flash high requested; serving-model attribution was not returned. Luna independently reviewed it. Astra integrated and repaired browser-measured defects.

Root corrections: the image URL respects the Vite base; failed images restore the existing schematic. Desktop weapon/ammo overlap was fixed after actual DOM rectangles failed the first browser run. Narrow scoreboard/banner and minimap/match-bar overlaps were fixed. The legacy duplicate ammo debug line now obeys the debug visibility control. No damage, network or match-state authority changed.

VERIFIED: npm run check passes. scripts/ui/verify-menu-hud-live.mjs opens installed Chrome with stock WebGPU support, exercises main/options/solo/deploy, checks keyboard focus, and measures layouts at 1920x1080, 1280x720, 2560x1080, 390x844 and a 390x600 scoreboard stress fixture. The final run passes all 18 checks with zero browser errors. The scoreboard stress fixture is a layout test, not proof of a real match outcome. Root opened the menu, gameplay and narrow-screen images under captures/menu-hud-k/.

VERIFIED: public/ui-art/map-preview.png is byte-identical to captures/checkpoint-j-live/street.png, SHA-256 52a9b306cfb4987089bde41d7a7c5cf7624639b02709eff4ddd68dcbece5cee9. It is an actual engine capture, not generated artwork.

OPEN: subjective owner review; complete loadout redesign for the planned 20-weapon roster; new floating combat text integration. Existing network and ordnance sources remain unchanged and retain J's earlier bounded evidence. This UI proof is not a new WAN or long-duration multiplayer test.
