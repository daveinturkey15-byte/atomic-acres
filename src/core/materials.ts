/**
 * Procedural material library. Every texture is drawn in code on a canvas -
 * nothing is downloaded, nothing is imported from another project.
 * Materials are shared singletons: build them ONCE and reuse, so the renderer
 * compiles a small, fixed set of programs.
 */
import * as THREE from 'three';
import { PAL } from './palette';

type Ctx2D = CanvasRenderingContext2D;

function canvas(size: number, draw: (c: Ctx2D, s: number) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  draw(c, size);
  return cv;
}

function tex(
  size: number,
  repeat: number,
  draw: (c: Ctx2D, s: number) => void,
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas(size, draw));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** speckle splatter used to break up flat fills */
function speckle(c: Ctx2D, s: number, n: number, alpha: number, dark = true): void {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = Math.random() * (s / 180) + s / 400;
    const a = (alpha * Math.random()).toFixed(3);
    c.fillStyle = dark ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,255,255,' + a + ')';
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
}

export interface MaterialLibrary {
  concrete: THREE.Material;
  paving: THREE.Material;
  asphalt: THREE.Material;
  kerb: THREE.Material;
  lawn: THREE.Material;
  sand: THREE.Material;
  stuccoCream: THREE.Material;
  stuccoTerracotta: THREE.Material;
  roofWhite: THREE.Material;
  solar: THREE.Material;
  barrelRoof: THREE.Material;
  capsuleWhite: THREE.Material;
  roofGlazing: THREE.Material;
  glass: THREE.Material;
  windowDark: THREE.Material;
  timber: THREE.Material;
  timberDark: THREE.Material;
  deckBoards: THREE.Material;
  hedge: THREE.Material;
  leaf: THREE.Material;
  bark: THREE.Material;
  chrome: THREE.Material;
  steel: THREE.Material;
  painted: (color: number, rough?: number, metal?: number) => THREE.Material;
  emissive: (color: number, strength?: number) => THREE.Material;
  dispose: () => void;
}

export function buildMaterials(): MaterialLibrary {
  const cache = new Map<string, THREE.Material>();
  const owned: { dispose: () => void }[] = [];

  const std = (p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial(p);
    owned.push(m);
    if (p.map) owned.push(p.map);
    return m;
  };

  // ---- big paving slabs, the dominant surround surface
  const pavingTex = tex(512, 14, (c, s) => {
    c.fillStyle = hex(PAL.concrete);
    c.fillRect(0, 0, s, s);
    const n = 4;
    const cell = s / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = (0.04 + Math.random() * 0.1).toFixed(3);
        c.fillStyle = 'rgba(255,255,255,' + v + ')';
        c.fillRect(i * cell + 1.5, j * cell + 1.5, cell - 3, cell - 3);
      }
    }
    c.strokeStyle = 'rgba(0,0,0,0.20)';
    c.lineWidth = 2.5;
    for (let i = 0; i <= n; i++) {
      c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell, s); c.stroke();
      c.beginPath(); c.moveTo(0, i * cell); c.lineTo(s, i * cell); c.stroke();
    }
    speckle(c, s, 900, 0.045);
  });

  // ---- mown lawn with alternating stripes (very visible in the aerial)
  const lawnTex = tex(512, 10, (c, s) => {
    c.fillStyle = hex(PAL.lawn);
    c.fillRect(0, 0, s, s);
    const band = s / 8;
    c.fillStyle = hex(PAL.lawnLight);
    for (let i = 0; i < 8; i += 2) c.fillRect(i * band, 0, band, s);
    c.globalAlpha = 0.35;
    for (let i = 0; i < 8; i += 2) c.fillRect(0, i * band, s, band);
    c.globalAlpha = 1;
    speckle(c, s, 1500, 0.11);
    speckle(c, s, 900, 0.07, false);
  });

  const asphaltTex = tex(512, 22, (c, s) => {
    c.fillStyle = hex(PAL.asphalt);
    c.fillRect(0, 0, s, s);
    speckle(c, s, 9000, 0.35);
    speckle(c, s, 3500, 0.14, false);
  });

  const stucco = (color: number) => tex(256, 6, (c, s) => {
    c.fillStyle = hex(color);
    c.fillRect(0, 0, s, s);
    speckle(c, s, 5000, 0.1);
    speckle(c, s, 2000, 0.07, false);
  });

  // ---- vertical timber boarding for fences and decks
  const boardTex = (color: number, dark: number, n: number) => tex(256, 4, (c, s) => {
    c.fillStyle = hex(color);
    c.fillRect(0, 0, s, s);
    const w = s / n;
    for (let i = 0; i < n; i++) {
      const v = (Math.random() * 0.18).toFixed(3);
      c.fillStyle = 'rgba(0,0,0,' + v + ')';
      c.fillRect(i * w, 0, w, s);
      c.strokeStyle = hex(dark);
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(i * w, 0); c.lineTo(i * w, s); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.10)';
      c.lineWidth = 1;
      for (let g = 0; g < 5; g++) {
        const gx = i * w + Math.random() * w;
        c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx + (Math.random() - 0.5) * 6, s); c.stroke();
      }
    }
  });

  const hedgeTex = tex(256, 5, (c, s) => {
    c.fillStyle = hex(PAL.hedge);
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 4500; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const a = (Math.random() * 0.3).toFixed(3);
      c.fillStyle = Math.random() > 0.5
        ? 'rgba(120,170,90,' + a + ')'
        : 'rgba(0,0,0,' + a + ')';
      c.fillRect(x, y, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
  });

  const solarTex = tex(256, 1, (c, s) => {
    c.fillStyle = hex(PAL.solarPanel);
    c.fillRect(0, 0, s, s);
    const n = 8;
    const cell = s / n;
    c.strokeStyle = 'rgba(190,210,235,0.42)';
    c.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell, s); c.stroke();
      c.beginPath(); c.moveTo(0, i * cell); c.lineTo(s, i * cell); c.stroke();
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = (0.02 + Math.random() * 0.05).toFixed(3);
        c.fillStyle = 'rgba(255,255,255,' + a + ')';
        c.fillRect(i * cell + 2, j * cell + 2, cell - 4, cell - 4);
      }
    }
  });

  const lib: MaterialLibrary = {
    concrete: std({ color: PAL.concrete, roughness: 0.93, metalness: 0 }),
    paving: std({ map: pavingTex, roughness: 0.9, metalness: 0 }),
    asphalt: std({ map: asphaltTex, roughness: 0.96, metalness: 0 }),
    kerb: std({ color: PAL.kerb, roughness: 0.88, metalness: 0 }),
    lawn: std({ map: lawnTex, roughness: 0.98, metalness: 0 }),
    sand: std({ color: PAL.sand, roughness: 1, metalness: 0 }),
    stuccoCream: std({ map: stucco(PAL.houseCream), roughness: 0.85, metalness: 0 }),
    stuccoTerracotta: std({ map: stucco(PAL.terracotta), roughness: 0.82, metalness: 0 }),
    roofWhite: std({ color: PAL.roofWhite, roughness: 0.6, metalness: 0.05 }),
    solar: std({ map: solarTex, roughness: 0.25, metalness: 0.35 }),
    barrelRoof: std({ color: PAL.barrelRoof, roughness: 0.55, metalness: 0.15 }),
    capsuleWhite: std({ map: stucco(PAL.capsuleWhite), roughness: 0.72, metalness: 0.02 }),
    roofGlazing: std({
      color: PAL.roofGlazing, roughness: 0.14, metalness: 0.1,
      transparent: true, opacity: 0.86,
    }),
    glass: std({
      color: PAL.glass, roughness: 0.06, metalness: 0,
      transparent: true, opacity: 0.42, envMapIntensity: 1.4,
    }),
    windowDark: std({
      color: 0x56707e, roughness: 0.11, metalness: 0.68, envMapIntensity: 1.7,
    }),
    timber: std({ map: boardTex(PAL.timber, PAL.timberDark, 8), roughness: 0.9, metalness: 0 }),
    timberDark: std({ map: boardTex(PAL.timberDark, 0x4d3116, 8), roughness: 0.92, metalness: 0 }),
    deckBoards: std({ map: boardTex(0xc08a50, PAL.timberDark, 10), roughness: 0.86, metalness: 0 }),
    hedge: std({ map: hedgeTex, roughness: 1, metalness: 0 }),
    leaf: std({ color: PAL.treeLeaf, roughness: 0.92, metalness: 0 }),
    bark: std({ color: PAL.treeTrunk, roughness: 0.95, metalness: 0 }),
    chrome: std({ color: PAL.chrome, roughness: 0.16, metalness: 0.95 }),
    steel: std({ color: PAL.steel, roughness: 0.42, metalness: 0.7 }),

    painted(color: number, rough = 0.42, metal = 0.25) {
      const key = 'p' + color + '_' + rough + '_' + metal;
      let m = cache.get(key);
      if (!m) {
        m = std({ color, roughness: rough, metalness: metal });
        cache.set(key, m);
      }
      return m;
    },
    emissive(color: number, strength = 1.4) {
      const key = 'e' + color + '_' + strength;
      let m = cache.get(key);
      if (!m) {
        m = std({ color, emissive: color, emissiveIntensity: strength, roughness: 0.5 });
        cache.set(key, m);
      }
      return m;
    },
    dispose() {
      for (const o of owned) o.dispose();
      for (const m of cache.values()) m.dispose();
      cache.clear();
      owned.length = 0;
    },
  };
  return lib;
}
