/**
 * NUKETOWN 2025 palette. Colour FAMILIES read off BO2-2025 reference frames
 * (nt2025-street-boii, nt2025-sniper-boii, nt2025-aerial-boii, nt2025-loadscreen-boii).
 * The references are compressed JPEG/PNG at unknown gamma - these are picks WITHIN the
 * observed family, not droppers. Do not treat any value here as colour-calibrated.
 * All values are sRGB hex; materials convert on assignment.
 */
export const PAL = {
  // --- ground planes
  concrete:      0xc9c6bd,   // pale warm paving slabs, the dominant surround
  concreteDark:  0xa8a59c,
  asphalt:       0x4a4a4d,
  asphaltLight:  0x5c5c60,
  kerb:          0xb4b0a6,
  lawn:          0x4c7a33,   // saturated mown green
  lawnLight:     0x5d8d3d,   // mow-stripe alternate
  dirt:          0x8a7a5e,
  sand:          0xc4ab7e,

  // --- orange house (the -z house)
  terracotta:    0xbe6a46,   // upper-storey wall
  terracottaDk:  0x9a5134,
  houseCream:    0xe6dfd0,   // ground floor + garage box
  roofWhite:     0xeae6dc,   // swooping butterfly roof
  solarPanel:    0x39455a,
  barrelRoof:    0x585c64,   // dark garage barrel vaults

  // --- white house (the +z house)
  capsuleWhite:  0xf0ece2,
  capsuleTrim:   0x6d93ad,   // blue trim accent
  roofGlazing:   0x93b3c6,   // pale blue-grey glazed roof
  rooftopDrum:   0x565b63,

  // --- third house, beyond the cul-de-sac
  thirdRoof:     0x585d65,   // dark pitched roof
  thirdWall:     0xd8d2c6,
  windowBand:    0xf2f4f3,

  // --- props and vehicles
  coachCream:    0xe8e0cd,
  coachMaroon:   0x7c2a33,
  truckWhite:    0xe4e2dd,
  truckCab:      0x2e3238,
  carTeal:       0x2f8f8a,
  carRed:        0xa8302c,
  carBlue:       0x28374f,
  chrome:        0xc8ccd0,
  glass:         0x9fc0cf,
  timber:        0xb0763f,   // tan picket fence / deck boards
  timberDark:    0x7d5228,
  hedge:         0x2f4a24,
  treeLeaf:      0x3f6b30,
  treeTrunk:     0x594733,
  signMaroon:    0x8e2540,   // the Nuketown pylon sign script
  signTeal:      0x2c8d93,
  steel:         0x8b9099,
  applianceRed:  0xb8322e,   // orange-house lawn appliance bank
  applianceBlue: 0x2f5c96,   // white-house lawn appliance bank
  mannequin:     0xd9cfc0,

  // --- sky / atmosphere
  skyTop:        0x6f9cc8,
  skyHorizon:    0xcdd9df,
  sunColor:      0xfff2dc,
  bounce:        0xa8a08c,   // ground bounce into shadow
  mountain:      0xa6b4c4,
  mountainFar:   0xc6d0dc,
  cityFar:       0xc6cfd9,
  fog:           0xccd4d4,

  // --- FOOTAGE CORRECTIONS (docs/REAL-REFERENCE.md, from 422 gameplay frames).
  // Added centrally so the implementation lanes never contend on this file.
  rubbleStone:   0x9d9384,   // random polygonal masonry veneer - skirts, piers, plinths
  rubbleMortar:  0xc2bcae,
  pavingWarm:    0xcfc4ad,   // sunlit slabs read warm tan, not cool grey
  pavingStain:   0xb3a894,
  flagstone:     0xc6bba6,
  fenceRail:     0xb98a52,   // scalloped top rail on the low front runs
  busNavy:       0x27354d,   // the second, building-liveried bus
  busBlack:      0x22242a,
  trailerBody:   0xd8d4c8,   // towed trailer: cream body, blue-grey roof, red trim
  trailerRoof:   0x8f9aa4,
  trailerTrim:   0xa8392f,
  interiorTeal:  0x6d8d8b,   // signature living/dining room
  interiorPlum:  0x5b3f63,   // signature bedroom
  interiorGold:  0xc9a24a,
  interiorMint:  0x9dc7b4,
  saucerSoffit:  0x7a6783,   // mauve underside with recessed downlights
  hazardYellow:  0xd8b23a,   // mailbox, markings, DO NOT STACK crates

  // --- ATMOSPHERE (src/core/atmosphere.ts): time-of-day and weather families.
  // Noon keeps skyTop / skyHorizon / sunColor / bounce / fog above, untouched; these
  // are the OTHER rows of the preset table. Same rule as everything else here: picks
  // within a family, sRGB hex, not calibrated. Weather rows are what the clear rows
  // slide toward (a lerp weight per weather), so overcast/rain need no per-tod entry.
  sunMorning:         0xffd6a4,  // low warm sun, still yellow not orange
  skyMorningTop:      0x5a8dc0,  // cooler, deeper zenith while the air is clear
  skyMorningHorizon:  0xd8dee2,  // pale, faintly warm
  fogMorning:         0xd3d9dc,  // mist pooling low: a touch cooler than PAL.fog
  sunGolden:          0xffb46a,  // golden hour key
  sunGoldenGlow:      0xffc48a,  // the dome/env glow around it, paler than the key
  skyGoldenTop:       0x5a86b6,
  skyGoldenHorizon:   0xe8c8a2,  // warm band the sun sits in
  bounceGolden:       0xb09a78,  // ground bounce warms with the key
  fogGolden:          0xdcc6a8,
  sunDusk:            0xff9658,  // sun under 10 deg: orange, dim
  sunDuskGlow:        0xff8a62,  // magenta-orange glow at the horizon
  skyDuskTop:         0x22386a,  // deep blue zenith
  skyDuskHorizon:     0xe08c74,  // magenta-orange horizon band
  skyDuskFill:        0x56668f,  // what the hemisphere still gives: dim blue
  bounceDusk:         0x6a5a56,
  fogDusk:            0xa8889a,
  sunOvercast:        0xdfe3e6,  // a sun you cannot see: near-neutral, weak
  sunOvercastGlow:    0xe8ebee,
  skyOvercastTop:     0x9ea8b0,  // flat grey lid
  skyOvercastHorizon: 0xc3c9ce,
  bounceOvercast:     0x8f8f8a,
  fogOvercast:        0xbfc5c9,
  skyRainTop:         0x7c868e,  // darker lid still, when it is actually raining
  skyRainHorizon:     0xa9b0b6,

  // --- moved in from inline literals (same values, now palette-owned per contract)
  windowDark:    0x66808e,   // shaded glazing that still reflects sky, not black
  deckBoard:     0xc08a50,   // warm mid-timber deck boards
  timberGap:     0x4d3116,   // dark board gaps / shadowed timber

  // --- OPERATORS (src/characters). Families read off the gameplay frames
  // f-aICKIbuo8zQ-162 (running operator, side on), f-FKQOEO-1ceE-055 (operator
  // at ~12 m, sunlit) and f-aICKIbuo8zQ-030 (two at mid distance): one side in
  // sand/khaki, one in olive-drab, near-black webbing on both, warm exposed
  // skin. VISUAL-BAR S7 - nothing neon. Deliberately NOT PAL.signTeal and NOT
  // PAL.mannequin: those are the set-dressing dummies, and a bot wearing them
  // is indistinguishable from a shop window at 20 m.
  opSkin:         0xb07a52,  // warm mid skin - face and rolled-sleeve forearms
  opFatigueTan:   0xa8966b,  // faction A fatigues, sand/khaki
  opHelmetTan:    0x8e7f5a,  // faction A ballistic helmet shell
  opFatigueOlive: 0x5c6248,  // faction B fatigues, olive drab / grey-green
  opHelmetOlive:  0x3f4539,  // faction B patrol cap
  opWebbing:      0x4a4236,  // faction A carrier and pouches, dark earth
  opWebbingDark:  0x2c2923,  // faction B carrier and pouches, near black
  opBoot:         0x26241f,  // boots, gloves, kneepads, belt - the value break
} as const;

export type PaletteKey = keyof typeof PAL;
