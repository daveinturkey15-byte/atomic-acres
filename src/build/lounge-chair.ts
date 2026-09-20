import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Original small upholstered bucket chair. +Z is the open, seated direction.
 * A closed thick shell replaces the old upward-facing sphere cap. All geometry
 * is static and becomes part of the house's existing material batches. */
export function loungeChair(shell: THREE.Material, cushion: THREE.Material,
  metal: THREE.Material): THREE.Group {
  const group = new THREE.Group(); group.name = 'upholstered-bucket-chair';
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material,
    x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  };
  const positions: number[] = [], indices: number[] = [];
  const columns = 24, rows = 5;
  for (let side = 0; side < 2; side++) {
    for (let row = 0; row <= rows; row++) {
      const v = row / rows;
      for (let col = 0; col <= columns; col++) {
        const angle = (col / columns * 2 - 1) * Math.PI * .61;
        const r = .34 + .025 * v + side * .035;
        const top = .73 + .43 * Math.pow(Math.max(0, Math.cos(angle)), 1.4);
        positions.push(Math.sin(angle) * r, .43 + (top - .43) * v, -Math.cos(angle) * r);
      }
    }
  }
  const stride = columns + 1, surface = stride * (rows + 1);
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a,b,c,a,c,d);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = row * stride + col, b = a + 1, c = b + stride, d = a + stride;
    quad(a,b,c,d); quad(d+surface,c+surface,b+surface,a+surface);
  }
  for (let col = 0; col < columns; col++) {
    quad(col+1,col,col+surface,col+1+surface);
    const a=rows*stride+col; quad(a,a+1,a+1+surface,a+surface);
  }
  for (let row = 0; row < rows; row++) {
    const a=row*stride,b=a+stride;quad(a,b,b+surface,a+surface);
    quad(b+columns,a+columns,a+columns+surface,b+columns+surface);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  add(geometry,shell,0,0,0);
  add(new RoundedBoxGeometry(.66,.13,.61,3,.055),cushion,0,.47,.005);
  const pad = add(new RoundedBoxGeometry(.53,.43,.11,3,.048),cushion,0,.77,-.275);
  pad.rotation.x=-.12;
  add(new THREE.CylinderGeometry(.035,.045,.31,12),metal,0,.25,0);
  add(new THREE.CylinderGeometry(.23,.28,.065,24),metal,0,.065,0);
  return group;
}
