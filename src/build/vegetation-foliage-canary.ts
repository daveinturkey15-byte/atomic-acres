/** Static branch-led foliage. All geometry is owned here; materials are borrowed. */
import * as THREE from 'three';
import type { TreeSpec, VegetationTreeResult } from './vegetation-tree';

export const FOLIAGE_SPRAYS_PER_TREE = 320;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function isFoliageCanaryEnabled(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('foliage') === 'canary';
}

/** Actual vertices, rather than transformed sphere/box approximations. Build time only. */
function instanceBounds(mesh: THREE.InstancedMesh, first: number, count: number): THREE.Box3 {
  const box = new THREE.Box3(), matrix = new THREE.Matrix4(), p = new THREE.Vector3();
  const positions = mesh.geometry.getAttribute('position');
  for (let i = first; i < first + count; i++) {
    mesh.getMatrixAt(i, matrix);
    for (let v = 0; v < positions.count; v++) {
      box.expandByPoint(p.fromBufferAttribute(positions, v).applyMatrix4(matrix));
    }
  }
  return box;
}

/** Four thin leaves at different inclinations, with the scan's true aspect ratio.
 * A full rectangular UV window lets the alpha map make the leaf outline. The old
 * geometry pinched the image a second time and widened it to nearly square.
 */
function sprayGeometry(): THREE.BufferGeometry {
  const windows = [
    [0.018, 0.515, 0.158, 0.982], [0.365, 0.515, 0.500, 0.982],
    [0.024, 0.025, 0.165, 0.475], [0.405, 0.025, 0.575, 0.475],
  ];
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let leaf = 0; leaf < 4; leaf++) {
    const [u0, v0, u1, v1] = windows[leaf];
    const width = (u1 - u0) / (v1 - v0);
    const angle = leaf * GOLDEN_ANGLE;
    q.setFromEuler(e.set(0.65 + leaf * 0.33, angle, (leaf % 2 ? -1 : 1) * 0.42));
    const first = positions.length / 3;
    for (const [x, y, u, v] of [
      [-0.5, -0.5, u0, v0], [0.5, -0.5, u1, v0],
      [-0.5, 0.5, u0, v1], [0.5, 0.5, u1, v1],
    ]) {
      p.set(x * width, y, 0).applyQuaternion(q);
      p.x += Math.cos(angle) * 0.20;
      p.z += Math.sin(angle) * 0.20;
      p.y += leaf % 2 ? 0.12 : -0.07;
      positions.push(p.x, p.y, p.z); uvs.push(u, v);
    }
    indices.push(first, first + 1, first + 3, first, first + 3, first + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material,
  count: number, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name; mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.farcrysisArt = true;
  return mesh;
}

/** Called exactly once, before the group reaches a renderer. No live topology edit.
 * Keeping the baseline build first freezes its real crown envelope and preserves
 * the established trunk/root/major-branch matrices, independent of future specs.
 */
export function refineTreeFoliage(result: VegetationTreeResult, specs: readonly TreeSpec[]): VegetationTreeResult {
  const { group, stats } = result;
  const oldLeaves = group.getObjectByName('tree-leaf-cards-alpha') as THREE.InstancedMesh;
  const oldCrowns = group.getObjectByName('tree-canopy-interior') as THREE.InstancedMesh;
  const oldBranches = group.getObjectByName('tree-branches') as THREE.InstancedMesh;
  const material = oldLeaves?.material as THREE.Material | undefined;
  // A missing cutout material must not turn a whole crown into opaque rectangles.
  if (!oldLeaves || !oldCrowns || !oldBranches || !material || material.alphaTest <= 0 || material.transparent) {
    group.userData.foliageCanary = 'unavailable-cutout-material';
    return result;
  }
  const bounds = specs.map((_, tree) => instanceBounds(oldCrowns, tree * 3, 3)
    .union(instanceBounds(oldLeaves, tree * 100, 100)));
  const leafGeometry = sprayGeometry();
  const twigGeometry = new THREE.CylinderGeometry(0.20, 0.50, 1, 5, 1);
  const leaves = instanced(leafGeometry, material, specs.length * FOLIAGE_SPRAYS_PER_TREE,
    'tree-leaf-sprays-alpha');
  const twigs = instanced(twigGeometry, oldBranches.material as THREE.Material,
    stats.branchCount * 4, 'tree-secondary-twigs');
  const p = new THREE.Vector3(), direction = new THREE.Vector3(), scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4(), lobeMatrix = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(), up = new THREE.Vector3(0, 1, 0);
  const safe = new THREE.Box3(), colour = new THREE.Color();
  // Radius about the origin covers every rotated vertex, including off-centre sprays.
  const sphere = leafGeometry.boundingSphere!;
  const originRadius = sphere.radius + sphere.center.length();
  let twigIndex = 0;
  for (let tree = 0; tree < specs.length; tree++) {
    const spec = specs[tree], box = bounds[tree];
    for (let spray = 0; spray < FOLIAGE_SPRAYS_PER_TREE; spray++) {
      const lobe = spray % 3, local = Math.floor(spray / 3);
      oldCrowns.getMatrixAt(tree * 3 + lobe, lobeMatrix);
      // Irrational phases and an irregular radial shell prevent latitude rows.
      // The lower-density interior leaves allow glimpses of actual woody forks.
      const vertical = ((local * 47 + tree * 19 + lobe * 13) % 107) / 106 * 2 - 1;
      const theta = spray * GOLDEN_ANGLE + tree * 0.83;
      const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const radius = 0.22 + 0.38 * Math.cbrt(((spray * 61 + tree * 17) % 109) / 108);
      p.set(Math.cos(theta) * radial * radius, vertical * radius * 0.92,
        Math.sin(theta) * radial * radius).applyMatrix4(lobeMatrix);
      const size = (0.36 + ((spray * 29 + tree * 7) % 19) / 18 * 0.14) * Math.sqrt(spec.scale);
      const guard = size * originRadius + 0.0001;
      safe.copy(box); safe.min.addScalar(guard); safe.max.addScalar(-guard);
      p.clamp(safe.min, safe.max);
      q.setFromEuler(e.set(theta * 0.37, theta, vertical * 1.2));
      matrix.compose(p, q, scale.setScalar(size));
      leaves.setMatrixAt(tree * FOLIAGE_SPRAYS_PER_TREE + spray, matrix);
      // Modest per-spray pigment variation; no material mutation or fake AO.
      const tint = 0.86 + ((spray * 37 + tree * 11) % 23) / 22 * 0.14;
      leaves.setColorAt(tree * FOLIAGE_SPRAYS_PER_TREE + spray, colour.setRGB(tint, tint, tint * 0.97));
    }
    for (let branch = 0; branch < spec.branches.length; branch++) {
      const b = spec.branches[branch];
      const start = new THREE.Vector3(spec.x + Math.cos(b.angle) * b.distance * 0.72,
        spec.height + spec.canopyRadius * (0.05 + b.lift * 0.16),
        spec.z + Math.sin(b.angle) * b.distance * 0.72);
      oldCrowns.getMatrixAt(tree * 3 + branch % 3, lobeMatrix);
      const centre = new THREE.Vector3().setFromMatrixPosition(lobeMatrix);
      for (const side of [-1, 1]) {
        const mid = centre.clone().add(new THREE.Vector3(
          Math.cos(b.angle + 1.1 * side) * b.lobe * 0.18, -b.lobe * 0.16,
          Math.sin(b.angle + 1.1 * side) * b.lobe * 0.18));
        const tip = centre.clone().add(new THREE.Vector3(
          Math.cos(b.angle + 0.85 * side) * b.lobe * 0.40, b.lobe * (side > 0 ? 0.21 : 0.08),
          Math.sin(b.angle + 0.85 * side) * b.lobe * 0.40));
        safe.copy(box); safe.min.addScalar(0.06); safe.max.addScalar(-0.06);
        mid.clamp(safe.min, safe.max); tip.clamp(safe.min, safe.max);
        for (const [a, z, radius] of [[start, mid, spec.trunkRadius * 0.16],
          [mid, tip, spec.trunkRadius * 0.075]] as const) {
          direction.subVectors(z, a); const length = direction.length();
          q.setFromUnitVectors(up, direction.multiplyScalar(1 / Math.max(length, 0.0001)));
          p.copy(a).add(z).multiplyScalar(0.5);
          twigs.setMatrixAt(twigIndex++, matrix.compose(p, q, scale.set(radius / 0.50, length, radius / 0.50)));
        }
      }
    }
  }
  for (const mesh of [leaves, twigs]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) { mesh.instanceColor.setUsage(THREE.StaticDrawUsage); mesh.instanceColor.needsUpdate = true; }
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  }
  group.remove(oldLeaves, oldCrowns);
  // These baseline geometries are private to this build, never shared library assets.
  oldLeaves.dispose(); oldLeaves.geometry.dispose(); oldCrowns.dispose(); oldCrowns.geometry.dispose();
  group.add(twigs, leaves);
  const oldLeafTriangles = oldLeaves.geometry.index!.count / 3 * oldLeaves.count;
  const oldCrownTriangles = oldCrowns.geometry.index!.count / 3 * oldCrowns.count;
  const next = { ...stats, branchCount: stats.branchCount + twigs.count, canopyLobeCount: 0,
    leafClusterCount: leaves.count, leafBladeCount: leaves.count * 4,
    triangles: stats.triangles - oldLeafTriangles - oldCrownTriangles
      + leafGeometry.index!.count / 3 * leaves.count + twigGeometry.index!.count / 3 * twigs.count };
  group.userData.vegetationStats = next;
  group.userData.foliageCanary = 'branch-sprays-v1';
  group.userData.foliageFrozenBounds = bounds.map(b => ({ min: b.min.toArray(), max: b.max.toArray() }));
  return { group, stats: next };
}
