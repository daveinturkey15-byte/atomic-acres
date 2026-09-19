import * as THREE from 'three';
import type { Builder } from '../core/kit';
import { aabbSlab } from '../core/kit';
import { KERB_HEIGHT, BACK_FENCE, YARD_X_MAX } from '../core/layout';
import { getFieldCase, FIELD_CASE_SIZE } from '../assets/field-case';

/** One original asset canary, clear of spawn, doors and the fence-side route. */
export const FIELD_CASE_PLACEMENT = Object.freeze({
  x: YARD_X_MAX - 3.0, y: KERB_HEIGHT + 0.001, z: BACK_FENCE - 1.8,
});
export const buildFieldCases: Builder = () => {
  const group = new THREE.Group();
  const instance = getFieldCase();
  if (!instance) return { group, colliders: [] };
  const p = FIELD_CASE_PLACEMENT;
  instance.position.set(p.x, p.y, p.z);
  instance.name = 'field-case-white-yard';
  group.add(instance);
  return { group, colliders: [aabbSlab(p.x, p.y, p.z,
    FIELD_CASE_SIZE.x, FIELD_CASE_SIZE.y, FIELD_CASE_SIZE.z)] };
};
