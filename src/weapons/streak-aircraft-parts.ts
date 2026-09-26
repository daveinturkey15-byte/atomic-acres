/** Native support silhouettes built into the scene's shared primitive batches. */
export interface AircraftPose { readonly x: number; readonly y: number; readonly z: number; readonly pitch?: number }
export type AircraftPart = 'armor' | 'dark' | 'metal' | 'markings' | 'signal' | 'muzzle';
export type AircraftPartWriter = (material: AircraftPart, pose: AircraftPose, yaw: number,
  x: number, y: number, z: number, sx: number, sy: number, sz: number, rx?: number, ry?: number, rz?: number) => void;
export type AircraftSilhouette = 'yardhawk' | 'piloted-drone' | 'hunter-swarm' | 'chopper' | 'drone-swarm' | 'carpet-bomber';
const SIDES = [-1, 1] as const;
const SKID_SUPPORTS = [-.6, .75] as const;

/** All transforms are relative to the host pose; only propeller rotation is cosmetic. */
export function drawAircraftParts(put: AircraftPartWriter, pose: AircraftPose, yaw: number,
  variant: AircraftSilhouette, timeMs: number, flash: boolean): void {
  const spin = timeMs * .038;
  if (variant === 'yardhawk' || variant === 'carpet-bomber') {
    const bomber = variant === 'carpet-bomber', k = bomber ? 1.45 : 1;
    put('armor', pose, yaw, 0, 0, 0, .65 * k, .48 * k, 2.5 * k);
    put('armor', pose, yaw, 0, -.03 * k, -1.5 * k, .4 * k, .3 * k, .7 * k);
    put('dark', pose, yaw, 0, .22 * k, -.75 * k, .49 * k, .17 * k, .65 * k);
    // Broad main wing, swept outer panels, raised vertical tail and a narrow tailplane.
    put('armor', pose, yaw, 0, -.04 * k, .1 * k, 3.4 * k, .13 * k, .74 * k);
    for (const side of SIDES) {
      put('armor', pose, yaw, side * 2.04 * k, -.035 * k, .36 * k, 1.1 * k, .11 * k, .49 * k, 0, side * .24);
      put('markings', pose, yaw, side * 2.35 * k, .031 * k, .45 * k, .17 * k, .025 * k, .37 * k, 0, side * .24);
      put('signal', pose, yaw, side * 2.53 * k, .07 * k, .5 * k, .06 * k, .035 * k, .05 * k);
      if (bomber) {
        put('dark', pose, yaw, side * 1.1 * k, -.22 * k, .05 * k, .3 * k, .33 * k, .98 * k);
        put('metal', pose, yaw, side * 1.1 * k, -.22 * k, -.46 * k, .14 * k, .12 * k, .14 * k, Math.PI / 2);
      }
    }
    put('armor', pose, yaw, 0, .08 * k, 1.22 * k, 1.7 * k, .09 * k, .45 * k);
    put('dark', pose, yaw, 0, .4 * k, 1.23 * k, .1 * k, .62 * k, .55 * k, -.2);
    put('metal', pose, yaw, 0, -.06 * k, 1.3 * k, .19 * k, .16 * k, .19 * k, Math.PI / 2);
    put('markings', pose, yaw, 0, .251 * k, .14 * k, .32 * k, .012 * k, .15 * k);
    if (flash && !bomber) put('muzzle', pose, yaw, 0, -.16, -1.92, .09, .09, .22);
    return;
  }
  if (variant === 'chopper') {
    put('armor', pose, yaw, 0, 0, 0, 1.32, 1.04, 2.5);
    put('armor', pose, yaw, 0, -.11, -1.36, 1.06, .72, .67);
    put('dark', pose, yaw, 0, .3, -1.17, 1.1, .45, .48, -.25);
    for (const side of SIDES) {
      put('dark', pose, yaw, side * .67, .1, -.35, .025, .49, .82);
      put('metal', pose, yaw, side * .7, -.74, .06, .055, 2.84, .055, Math.PI / 2);
      for (const z of SKID_SUPPORTS) put('metal', pose, yaw, side * .58, -.51, z, .035, .47, .035, 0, 0, side * -.4);
      put('markings', pose, yaw, side * .69, -.24, .61, .025, .13, .4);
      put('signal', pose, yaw, side * .73, .25, .8, .065, .055, .055);
    }
    put('armor', pose, yaw, 0, .21, 2.25, .28, .29, 2.85, -.09);
    put('armor', pose, yaw, 0, .63, 3.52, .12, 1.17, .65, -.2);
    put('armor', pose, yaw, 0, .33, 3.07, 1.45, .09, .35);
    put('dark', pose, yaw, 0, .7, .22, .87, .41, 1.15);
    put('metal', pose, yaw, 0, 1.07, .04, .075, .48, .075);
    for (let blade = 0; blade < 2; blade++) put('dark', pose, yaw, 0, 1.34, .04, 6.2, .055, .19, 0, spin + blade * Math.PI / 2);
    put('metal', pose, yaw, .17, .72, 3.59, .052, .39, .052, 0, 0, Math.PI / 2);
    put('dark', pose, yaw, .39, .72, 3.59, .045, 1.04, .09, spin);
    put('dark', pose, yaw, 0, -.48, -1.12, .26, .25, .42);
    put('metal', pose, yaw, 0, -.5, -1.64, .055, .75, .055, Math.PI / 2);
    if (flash) put('muzzle', pose, yaw, 0, -.5, -2.08, .13, .13, .32);
    return;
  }
  const hunter = variant === 'hunter-swarm';
  const k = hunter ? .72 : variant === 'drone-swarm' ? .87 : 1;
  put('armor', pose, yaw, 0, 0, 0, .56 * k, .25 * k, .76 * k);
  put('dark', pose, yaw, 0, -.15 * k, 0, .41 * k, .12 * k, .51 * k);
  for (const side of SIDES) put('dark', pose, yaw, 0, 0, 0, 2.05 * k, .1 * k, .11 * k, 0, side * Math.PI / 4);
  for (let rotor = 0; rotor < 4; rotor++) {
    const x = (rotor < 2 ? -1 : 1) * .68 * k, z = (rotor % 2 ? -1 : 1) * .68 * k;
    put('metal', pose, yaw, x, .025 * k, z, .13 * k, .17 * k, .13 * k);
    for (let blade = 0; blade < 2; blade++) put('dark', pose, yaw, x, .14 * k, z, .82 * k, .025 * k, .062 * k,
      0, spin * (rotor % 2 ? 1 : -1) + rotor + blade * Math.PI / 2);
  }
  put('dark', pose, yaw, 0, -.12 * k, -.44 * k, .25 * k, .22 * k, .22 * k);
  put('signal', pose, yaw, 0, -.12 * k, -.565 * k, .065 * k, .055 * k, .02 * k);
  put('signal', pose, yaw, 0, .16 * k, .24 * k, .035 * k, .024 * k, .08 * k);
  put('markings', pose, yaw, 0, .135 * k, -.05 * k, .12 * k, .015 * k, .34 * k);
  if (hunter) {
    // A visible strapped explosive charge distinguishes the diving variant.
    put('markings', pose, yaw, 0, -.3 * k, .12 * k, .32 * k, .22 * k, .35 * k);
    put('dark', pose, yaw, 0, -.32 * k, .12 * k, .08 * k, .26 * k, .39 * k);
  } else {
    put('metal', pose, yaw, 0, -.26 * k, -.38 * k, .035 * k, .45 * k, .035 * k, Math.PI / 2);
    if (flash) put('muzzle', pose, yaw, 0, -.26 * k, -.65 * k, .07 * k, .07 * k, .16 * k);
  }
}
