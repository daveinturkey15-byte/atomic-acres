/**
 * TREE CANARY - original procedural broadleaf geometry for the ten yard trees.
 *
 * The caller owns placement and gameplay colliders. This module only emits
 * presentation geometry using shared materials. Five static InstancedMeshes
 * cover all trees: trunk, root flare, branches, compact canopy interiors and
 * alpha-tested leaf cards.
 * There is no frame work, allocation or subscription.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';

export interface TreeBranchSpec {
  angle: number;
  distance: number;
  lobe: number;
  lift: number;
}

/** Values are captured by yards.ts from the pre-canary deterministic sequence. */
export interface TreeSpec {
  x: number;
  z: number;
  scale: number;
  height: number;
  trunkRadius: number;
  canopyRadius: number;
  branches: readonly TreeBranchSpec[];
}

export interface VegetationTreeStats {
  treeCount: number;
  branchCount: number;
  canopyLobeCount: number;
  leafClusterCount: number;
  leafBladeCount: number;
  drawCount: number;
  triangles: number;
  source: 'original deterministic procedural geometry';
}

export interface VegetationTreeResult {
  group: THREE.Group;
  stats: VegetationTreeStats;
}

/** Root may wire the CC0 alpha-tested material through MaterialLibrary. */
export interface VegetationTreeMaterials {
  bark: THREE.Material;
  leaf: THREE.Material;
  leafCards?: THREE.Material;
}

const UP = new THREE.Vector3(0, 1, 0);
const _position = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _end = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _matrix = new THREE.Matrix4();
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const LEAF_CLUSTERS_PER_TREE = 100;

function triangles(geometry: THREE.BufferGeometry): number {
  if (geometry.index) return geometry.index.count / 3;
  return (geometry.getAttribute('position')?.count ?? 0) / 3;
}

function staticMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.userData.farcrysisArt = true;
  return mesh;
}

/**
 * A small four-blade leaf cluster. Each blade is a two-segment, curved card
 * with its own atlas window. The silhouette comes from the CC0 alpha map, not
 * from a faceted solid lobe, and the four crossed blades keep the crown airy
 * from every camera direction. The same geometry is instanced for all trees.
 */
function leafCardGeometry(): THREE.BufferGeometry {
  // UV windows are inset from the eight leaf silhouettes in the Poly Haven
  // island_tree_01 atlas, avoiding the loose twig marks between the leaves.
  const regions = [
    [0.018, 0.515, 0.158, 0.982],
    [0.170, 0.515, 0.348, 0.982],
    [0.365, 0.515, 0.500, 0.982],
    [0.515, 0.515, 0.684, 0.982],
    [0.700, 0.515, 0.865, 0.982],
    [0.024, 0.025, 0.165, 0.475],
    [0.195, 0.025, 0.375, 0.475],
    [0.405, 0.025, 0.575, 0.475],
  ] as const;
  const blades = [
    { angle: 0.10, x: 0.00, y: 0.00, z: 0.00, sx: 1.00, sy: 1.00, region: 0 },
    { angle: 1.66, x: -0.11, y: 0.10, z: 0.05, sx: 0.92, sy: 0.92, region: 2 },
    { angle: 3.18, x: 0.08, y: -0.02, z: -0.07, sx: 0.94, sy: 0.98, region: 5 },
    { angle: 4.76, x: 0.01, y: 0.13, z: 0.06, sx: 0.88, sy: 0.90, region: 7 },
  ] as const;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const blade of blades) {
    const side = new THREE.Vector3(Math.cos(blade.angle), 0, Math.sin(blade.angle));
    const normal = new THREE.Vector3(-Math.sin(blade.angle), 0, Math.cos(blade.angle));
    const [u0, v0, u1, v1] = regions[blade.region];
    const rowY = [-0.48, 0.06, 0.56];
    const rowWidth = [0.16, 0.46, 0.11];
    const rowBend = [0.00, 0.045, -0.018];
    const first = positions.length / 3;
    for (let row = 0; row < rowY.length; row++) {
      for (const sign of [-1, 1]) {
        const p = new THREE.Vector3(
          blade.x + side.x * rowWidth[row] * sign * blade.sx + normal.x * rowBend[row],
          blade.y + rowY[row] * blade.sy,
          blade.z + side.z * rowWidth[row] * sign * blade.sx + normal.z * rowBend[row],
        );
        positions.push(p.x, p.y, p.z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(sign < 0 ? u0 : u1, v0 + (v1 - v0) * row / 2);
      }
    }
    // Two quads per blade. DoubleSide handles the rear-facing side while the
    // alpha-tested material keeps the silhouette cut out of the shadow pass.
    indices.push(
      first, first + 1, first + 3,
      first, first + 3, first + 2,
      first + 2, first + 3, first + 5,
      first + 2, first + 5, first + 4,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A softly shaded interior volume for each branch-led crown. It is deliberately
 * a perturbed low-resolution sphere, not an icosahedron or a perfect blob: the
 * shared vertex deformation gives the alpha leaves a continuous green base while
 * retaining small height/width breaks between the three overlapping lobes.
 */
function canopyInteriorGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(0.5, 8, 6);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const wobble = 1 + 0.075 * Math.sin(i * 2.17 + 0.4);
    position.setXYZ(
      i,
      x * wobble + 0.028 * Math.sin(y * 17 + i * 0.31),
      y * (1 + 0.055 * Math.cos(i * 1.73)) + 0.018 * Math.sin(x * 19 + z * 7),
      z * (1 + 0.065 * Math.cos(i * 2.41 + 0.7)) + 0.022 * Math.cos(y * 13 + i * 0.27),
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Orient a unit cylinder between endpoints without aliasing the start vector. */
function orientBetween(start: THREE.Vector3, end: THREE.Vector3, radius: number, baseRadius: number): void {
  // `_position` is a shared scratch vector. Compute the direction before
  // overwriting it with the midpoint; otherwise start aliases the scratch
  // vector and the branch collapses toward its midpoint.
  _direction.subVectors(end, start);
  const length = _direction.length() || 0.001;
  _direction.multiplyScalar(1 / length);
  _position.copy(start).add(end).multiplyScalar(0.5);
  _quaternion.setFromUnitVectors(UP, _direction);
  _scale.set(radius / baseRadius, length, radius / baseRadius);
}

export function buildVegetationTrees(
  materials: VegetationTreeMaterials | Pick<MaterialLibrary, 'bark' | 'leaf'>,
  specs: readonly TreeSpec[],
): VegetationTreeResult {
  const group = new THREE.Group();
  group.name = 'vegetation-tree-canary';
  if (specs.length === 0) {
    return {
      group,
      stats: {
        treeCount: 0,
        branchCount: 0,
        canopyLobeCount: 0,
        leafClusterCount: 0,
        leafBladeCount: 0,
        drawCount: 0,
        triangles: 0,
        source: 'original deterministic procedural geometry',
      },
    };
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.48, 0.78, 1, 8, 1);
  const rootGeometry = new THREE.CylinderGeometry(0.50, 0.80, 1, 8, 1);
  const branchGeometry = new THREE.CylinderGeometry(0.20, 0.50, 1, 6, 1);
  const canopyGeometry = canopyInteriorGeometry();
  const leavesGeometry = leafCardGeometry();

  const branchCount = specs.reduce((total, spec) => total + spec.branches.length, 0);
  const canopyLobeCount = specs.length * 3;
  // One hundred small volume clusters per tree gives 400 individual leaf blades
  // per tree without changing the captured branch descriptors. Every cluster
  // remains one instanced transform; the four atlas leaves live in its shared
  // geometry, so density does not add scene draws.
  const leafClusterCount = specs.length * LEAF_CLUSTERS_PER_TREE;
  const leafBladeCount = leafClusterCount * 4;
  const trunks = staticMesh(trunkGeometry, materials.bark, specs.length, 'tree-trunk-tapered');
  const roots = staticMesh(rootGeometry, materials.bark, specs.length, 'tree-root-flare');
  const branches = staticMesh(branchGeometry, materials.bark, branchCount, 'tree-branches');
  const canopies = staticMesh(canopyGeometry, materials.leaf, canopyLobeCount, 'tree-canopy-interior');
  const leaves = staticMesh(
    leavesGeometry,
    'leafCards' in materials && materials.leafCards ? materials.leafCards : materials.leaf,
    leafClusterCount,
    'tree-leaf-cards-alpha',
  );
  let branchIndex = 0;
  let canopyIndex = 0;
  let leafIndex = 0;

  for (let treeIndex = 0; treeIndex < specs.length; treeIndex++) {
    const spec = specs[treeIndex];
    _matrix.compose(
      _position.set(spec.x, spec.height / 2, spec.z),
      _quaternion.identity(),
      _scale.set(spec.trunkRadius / 0.78, spec.height, spec.trunkRadius / 0.78),
    );
    trunks.setMatrixAt(treeIndex, _matrix);
    _matrix.compose(
      _position.set(spec.x, 0.26 * spec.scale, spec.z),
      _quaternion.identity(),
      _scale.set(spec.trunkRadius * 1.45 / 0.80, 0.60 * spec.scale, spec.trunkRadius * 1.45 / 0.80),
    );
    roots.setMatrixAt(treeIndex, _matrix);

    for (let branch = 0; branch < spec.branches.length; branch++) {
      const b = spec.branches[branch];
      const baseY = spec.height * (0.55 + branch * 0.10);
      const endY = spec.height + spec.canopyRadius * (0.05 + b.lift * 0.16);
      const start = _position.set(
        spec.x + Math.cos(b.angle) * spec.trunkRadius * 0.25,
        baseY,
        spec.z + Math.sin(b.angle) * spec.trunkRadius * 0.25,
      );
      _end.set(
        spec.x + Math.cos(b.angle) * b.distance * 0.72,
        endY,
        spec.z + Math.sin(b.angle) * b.distance * 0.72,
      );
      orientBetween(start, _end, spec.trunkRadius * (0.48 - branch * 0.055), 0.50);
      branches.setMatrixAt(branchIndex++, _matrix.compose(_position, _quaternion, _scale));
    }

    // Three overlapping, branch-led volumes create the contiguous upper crown.
    // Their centres stay close to the captured branch anchors and their shared
    // 8x6 geometry has 80 triangles, so this draw is 2,400 triangles for all
    // ten trees. The alpha cards remain responsible for the outer silhouette.
    for (let lobe = 0; lobe < 3; lobe++) {
      const b = spec.branches[lobe % spec.branches.length];
      const t = 0.36 + lobe * 0.045;
      const x = spec.x + Math.cos(b.angle) * b.distance * t;
      const z = spec.z + Math.sin(b.angle) * b.distance * t;
      const y = spec.height + spec.canopyRadius * (0.34 + b.lift * 0.20);
      const yaw = b.angle + (lobe - 1) * 0.34;
      _matrix.compose(
        _position.set(x, y, z),
        _quaternion.setFromEuler(_euler.set(
          (lobe - 1) * 0.08,
          yaw,
          (lobe === 1 ? -0.07 : 0.06),
        )),
        _scale.set(
          b.lobe * (1.02 + lobe * 0.035),
          b.lobe * (0.82 + (lobe === 1 ? 0.08 : 0)),
          b.lobe * (0.96 - lobe * 0.025),
        ),
      );
      canopies.setMatrixAt(canopyIndex++, _matrix);
    }

    // Distribute small clusters through a deterministic crown volume. Three
    // quarters are anchored to the captured branch directions so the foliage
    // grows out of the branch structure; the remaining quarter fills the hub.
    // The local offsets stay inside the old lobe envelope and use no rand() calls,
    // so the ten authored positions and the original gameplay RNG sequence stay
    // byte-for-byte unchanged.
    for (let cluster = 0; cluster < LEAF_CLUSTERS_PER_TREE; cluster++) {
      const group = cluster % (spec.branches.length + 1);
      const local = Math.floor(cluster / (spec.branches.length + 1));
      const theta = cluster * GOLDEN_ANGLE + treeIndex * 0.73;
      const vertical = ((local * 37 + cluster * 11 + treeIndex * 7) % 101) / 100 * 2 - 1;
      const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      let anchorX = 0;
      let anchorZ = 0;
      let anchorY = spec.canopyRadius * 0.43;
      let offsetRadius = spec.canopyRadius * 0.34;
      if (group > 0) {
        const b = spec.branches[group - 1];
        const t = 0.44 + ((local * 17 + cluster * 3) % 43) / 42 * 0.40;
        anchorX = Math.cos(b.angle) * b.distance * t;
        anchorZ = Math.sin(b.angle) * b.distance * t;
        anchorY = spec.canopyRadius * (b.lift * 0.88 + 0.08);
        offsetRadius = spec.canopyRadius * 0.19;
      }
      const ox = Math.cos(theta) * radial * offsetRadius;
      const oz = Math.sin(theta) * radial * offsetRadius;
      const oy = vertical * (group === 0 ? spec.canopyRadius * 0.26 : spec.canopyRadius * 0.13);
      const size = 0.15 + ((cluster * 29 + treeIndex * 7) % 12) / 11 * 0.11;
      const yaw = theta + ((cluster * 19 + treeIndex * 5) % 9) * 0.13;
      const pitch = (((cluster * 23 + treeIndex) % 7) - 3) * 0.055;
      const roll = (((cluster * 31 + treeIndex * 3) % 9) - 4) * 0.045;
      _matrix.compose(
        _position.set(spec.x + anchorX + ox, spec.height + anchorY + oy, spec.z + anchorZ + oz),
        _quaternion.setFromEuler(_euler.set(pitch, yaw, roll)),
        _scale.setScalar(size),
      );
      leaves.setMatrixAt(leafIndex++, _matrix);
    }
  }

  trunks.instanceMatrix.needsUpdate = true;
  roots.instanceMatrix.needsUpdate = true;
  branches.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  trunks.computeBoundingSphere();
  roots.computeBoundingSphere();
  branches.computeBoundingSphere();
  canopies.computeBoundingSphere();
  leaves.computeBoundingSphere();
  group.add(trunks, roots, branches, canopies, leaves);

  const stats: VegetationTreeStats = {
    treeCount: specs.length,
    branchCount,
    canopyLobeCount,
    leafClusterCount,
    leafBladeCount,
    drawCount: 5,
    triangles: Math.round(
      triangles(trunkGeometry) * specs.length
      + triangles(rootGeometry) * specs.length
      + triangles(branchGeometry) * branchCount
      + triangles(canopyGeometry) * canopyLobeCount
      + triangles(leavesGeometry) * leafClusterCount,
    ),
    source: 'original deterministic procedural geometry',
  };
  group.userData.vegetationStats = stats;
  return { group, stats };
}
