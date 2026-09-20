/** Original furniture, authored at real scale inside the existing room envelopes.
 * Materials belong to the scene library. These parts never generate authority.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { InteriorMaterials } from '../core/interior-materials';

/** Metric UVs on the six faces; each channel keeps the source's real tile size. */
export function metricUVs(g: THREE.BufferGeometry, tile: number): void {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
    else if (ax >= az) uv.setXY(i, p.getZ(i) / tile, p.getY(i) / tile);
    else uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
  }
  uv.needsUpdate = true;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, name: string, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(g, m); o.name = name; o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true; o.userData.presentationOnly = true; return o;
}

function softBox(m: THREE.Material, name: string, w: number, h: number, d: number,
  x: number, y: number, z: number, radius: number, tile = 0.5): THREE.Mesh {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2));
  metricUVs(g, tile); return mesh(g, m, name, x, y, z);
}

/** +X is the back against the wall; length runs in Z. The solid seat stays .85 x .42 x 2.2. */
export function livingSofa(m: InteriorMaterials): THREE.Group {
  const g = new THREE.Group(); g.name = 'orange-room/sofa'; g.userData.presentationOnly = true;
  g.add(softBox(m.walnut, 'sofa/walnut-plinth', .85, .20, 2.2, 0, .24, 0, .026, 1.5));
  for (const z of [-.96, .96]) {
    for (const x of [-.31, .31]) g.add(mesh(new THREE.CylinderGeometry(.035, .025, .12, 10), m.brass, 'sofa/foot', x, .17, z));
    g.add(softBox(m.leather, 'sofa/arm', .85, .25, .21, 0, .48, z, .065));
  }
  for (const z of [-.46, .46]) {
    g.add(softBox(m.leather, 'sofa/seat-cushion', .68, .14, .88, -.055, .35, z, .055));
    const back = softBox(m.leather, 'sofa/back-cushion', .20, .43, .89, .31, .62, z, .065);
    back.rotation.z = -.08; g.add(back);
    // Inset piping follows a rounded cushion outline and casts fine contact shadows.
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 48; j++) {
      const t = j / 48 * Math.PI * 2;
      pts.push(new THREE.Vector3(-.055 + .303 * Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), .3),
        .406, z + .402 * Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), .3)));
    }
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, .0035, 4, false), m.seam, 'sofa/piping', 0, 0, 0));
    for (const dz of [-.20, .20]) g.add(mesh(new THREE.SphereGeometry(.018, 8, 6).scale(.2, 1, 1), m.seam, 'sofa/tuft', .202, .64, z + dz));
  }
  const pillow = softBox(m.linen, 'sofa/linen-pillow', .16, .31, .32, .105, .53, .65, .075, .08);
  pillow.rotation.set(.08, -.18, .17); g.add(pillow);
  return g;
}

/** Original walnut veneer casework within the existing tall closet footprint. */
export function livingCabinet(m: InteriorMaterials, height: number): THREE.Group {
  const g = new THREE.Group(); g.name = 'orange-room/cabinet';
  g.add(softBox(m.walnut, 'cabinet/case', .60, height, 1.3, 0, height / 2, 0, .015, 1.5));
  // Door faces look toward -X; separation is a physical recess, not a painted black stripe.
  for (const z of [-.318, .318]) {
    g.add(softBox(m.walnut, 'cabinet/door', .025, height - .16, .625, -.306, height / 2 + .015, z, .006, 1.5));
    g.add(softBox(m.brass, 'cabinet/pull', .035, .19, .015, -.336, 1.17, z * .17, .004));
  }
  return g;
}

/** Detailed cabinet and curved CRT screen. Facing into the room along -Z. */
export function livingTelevision(m: InteriorMaterials, screen: THREE.Material): THREE.Group {
  const g = new THREE.Group(); g.name = 'orange-room/television';
  g.add(softBox(m.walnut, 'tv/console', .50, .43, 1.1, 0, .32, 0, .018, 1.5));
  for (const z of [-.42, .42]) for (const x of [-.17, .17])
    g.add(mesh(new THREE.CylinderGeometry(.025, .017, .14, 8), m.brass, 'tv/console-foot', x, .12, z));
  g.add(softBox(m.walnut, 'tv/case', .43, .40, .70, 0, .77, 0, .065, 1.5));
  g.add(softBox(screen, 'tv/curved-screen', .018, .30, .53, -.222, .78, -.025, .008));
  for (const y of [.69, .84]) {
    const dial = mesh(new THREE.CylinderGeometry(.025, .025, .014, 12), m.brass, 'tv/dial', -.233, y, .295);
    dial.rotation.z = Math.PI / 2; g.add(dial);
  }
  return g;
}
