/** First surface-finish canary: coated exterior finishes and a small, dry grade
 * film. Existing scan samples supply all fine detail; no noise/texture job. */
import { float, normalWorldGeometry, positionWorld, smoothstep } from 'three/tsl';
import { FRONT_LAWN_OUTER, HOUSE_BACK, HOUSE_HALF_LEN, KERB_HEIGHT } from './layout';

export interface SurfaceFinishProfile {
  readonly normal: number;
  readonly contrast: number;
  readonly roughMin: number;
  readonly roughMax: number;
  readonly macroRoughness: number;
  readonly dustDarkening: number;
  readonly dustRoughness: number;
  readonly side: -1 | 1;
}

// Authored proposals from CONCEPT-BAR §§1–2, not measured physical properties.
// The three distinct lobes remain nonmetallic; colour still uses the old palette.
const PROFILES: Readonly<Record<string, SurfaceFinishProfile>> = Object.freeze({
  stuccoCream: Object.freeze({ normal: .55, contrast: .24, roughMin: .52, roughMax: .64,
    macroRoughness: .012, dustDarkening: .045, dustRoughness: .025, side: -1 }),
  stuccoTerracotta: Object.freeze({ normal: .75, contrast: .38, roughMin: .70, roughMax: .85,
    macroRoughness: .012, dustDarkening: 0, dustRoughness: 0, side: -1 }),
  capsuleWhite: Object.freeze({ normal: .20, contrast: .14, roughMin: .36, roughMax: .50,
    macroRoughness: .012, dustDarkening: .035, dustRoughness: .030, side: 1 }),
});

export function surfaceFinishProfile(key: string): SurfaceFinishProfile | null {
  return Object.hasOwn(PROFILES, key) ? PROFILES[key] : null;
}

export function isSurfaceFinishEnabled(search = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('surface-finish') === 'canary';
}

/** Surface coverage, not AO or a baked shadow. World grade is the lawn/pavement
 * plateau at .151 m. This first canary covers only the main house plans: garage
 * extensions, pod, props, inside faces and horizontal roofs receive no dust.
 * Outward normals distinguish the two faces of shared exterior-wall boxes. */
export function surfaceDustNode(side: -1 | 1) {
  const p = positionWorld, n = normalWorldGeometry;
  const grade = KERB_HEIGHT + .001;
  const z = p.z.mul(side);
  const plan = smoothstep(FRONT_LAWN_OUTER - .24, FRONT_LAWN_OUTER - .14, z)
    .mul(float(1).sub(smoothstep(HOUSE_BACK + .14, HOUSE_BACK + .24, z)))
    .mul(float(1).sub(smoothstep(HOUSE_HALF_LEN + .14, HOUSE_HALF_LEN + .24, p.x.abs())));
  const outward = smoothstep(.05, .35,
    n.x.mul(p.x).add(n.z.mul(p.z.sub(side * (FRONT_LAWN_OUTER + HOUSE_BACK) / 2))));
  const vertical = float(1).sub(smoothstep(.10, .35, n.y.abs()));
  const aboveGrade = smoothstep(grade - .025, grade, p.y);
  const rise = float(1).sub(smoothstep(grade + .025, grade + .150, p.y));
  return plan.mul(outward).mul(vertical).mul(aboveGrade).mul(rise).toVar();
}
