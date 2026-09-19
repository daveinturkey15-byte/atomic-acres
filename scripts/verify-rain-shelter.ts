import * as THREE from 'three';
import { RainShelter } from '../src/core/rain-shelter';

const assert = {
  ok(value: unknown, message = 'rain shelter assertion failed'): void {
    if (!value) throw new Error(message);
  },
  equal(actual: unknown, expected: unknown, message = 'rain shelter equality failed'): void {
    if (!Object.is(actual, expected)) throw new Error(message);
  },
};

const shelter = new RainShelter();
const material = new THREE.MeshBasicMaterial();
const roof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 6), material);
roof.position.set(0, 4, 0);
shelter.build([roof]);
assert.ok(Math.abs(shelter.heightAt(0, 0) - 4.1) < 1e-5);
assert.equal(shelter.heightAt(8, 0), 0, 'uncovered street must remain open');
assert.equal(shelter.heightAt(1000, 0), 0, 'out-of-map queries are uncovered');

const slope = new THREE.BufferGeometry();
slope.setAttribute('position', new THREE.Float32BufferAttribute([-3, 2, -3, 3, 5, -3, -3, 2, 3], 3));
const slopedRoof = new THREE.Mesh(slope, material);
shelter.build([slopedRoof]);
assert.ok(shelter.heightAt(-1, -1) > 2.8 && shelter.heightAt(-1, -1) < 3.2, 'sloped triangle interpolates roof height');
assert.equal(shelter.heightAt(2, 2), 0, 'triangle bbox must not fill the open corner');

const group = new THREE.Group();
group.position.set(7, 0, 9);
const roofs = new THREE.InstancedMesh(roof.geometry, material, 2);
roofs.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 6, 0));
roofs.setMatrixAt(1, new THREE.Matrix4().makeTranslation(-12, 3, 0));
group.add(roofs);
shelter.build([group]);
assert.ok(Math.abs(shelter.heightAt(7, 9) - 6.1) < 1e-5, 'instance and parent transforms compose');
assert.ok(Math.abs(shelter.heightAt(-5, 9) - 3.1) < 1e-5);
assert.equal(shelter.heightAt(0, 0), 0, 'rebuild clears the old roof');

const leaves = new THREE.Mesh(roof.geometry, new THREE.MeshBasicMaterial({ alphaTest: 0.5 }));
leaves.position.y = 8;
shelter.build([leaves]);
assert.equal(shelter.heightAt(0, 0), 0, 'alpha-cutout foliage must not become a solid rectangle');
const texture = shelter.texture, pixels = texture.image.data;
for (let i = 0; i < 3; i++) shelter.build([roof]);
assert.equal(shelter.texture, texture);
assert.equal(shelter.texture.image.data, pixels, 'rebuild reuses the fixed upload buffer');
console.log(JSON.stringify({ pass: true, ...shelter.stats() }));
shelter.dispose();
roof.geometry.dispose(); slope.dispose(); material.dispose(); leaves.material.dispose();
