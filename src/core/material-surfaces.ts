import * as THREE from 'three';

/** The small, shared detail set used by painted props and hard-surface trim. */
export interface SurfaceTextureSet {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

export interface ExternalSurfaceUrls {
  diffuse: string;
  roughness: string;
  normal: string;
}

/**
 * Resolve an authored public asset against the page's base URL. Keeping the
 * manifest paths relative means a GitHub Pages deployment under `/repo/` and
 * a local Vite root both address the same files. The non-DOM fallback is kept
 * deliberately small so importing this module from a check or SSR process
 * never touches browser globals.
 */
export function resolveAssetUrl(path: string): string {
  const relative = path.replace(/^\/+/, '');
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL(relative, document.baseURI).toString();
  }
  const configuredBase = (globalThis as { __NT_ASSET_BASE__?: unknown }).__NT_ASSET_BASE__;
  if (typeof configuredBase === 'string' && configuredBase.length > 0) {
    const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
    try {
      return new URL(relative, base).toString();
    } catch {
      // A test/SSR harness may provide a path-only base. Preserve it without
      // making a browser-only absolute URL requirement for that caller.
      return `${base}${relative}`;
    }
  }
  return relative;
}

type Ctx2D = CanvasRenderingContext2D;

function canvas(size: number, draw: (ctx: Ctx2D, size: number) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('painted surface canvas unavailable');
  draw(ctx, size);
  return cv;
}

function texture(source: HTMLCanvasElement, repeat: number, colorSpace: THREE.ColorSpace): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(source);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = colorSpace;
  return t;
}

function gray(value: number): string {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  return `rgb(${v},${v},${v})`;
}

function normalFromHeight(source: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const width = source.width;
  const height = source.height;
  const src = source.getContext('2d')!.getImageData(0, 0, width, height).data;
  const sample = (x: number, y: number): number => {
    const xx = (x + width) % width;
    const yy = (y + height) % height;
    const k = (yy * width + xx) * 4;
    return (src[k] + src[k + 1] + src[k + 2]) / (3 * 255);
  };
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;
  const out = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = -(sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = -(sample(x, y + 1) - sample(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const k = (y * width + x) * 4;
      out.data[k] = Math.round((dx * inv * 0.5 + 0.5) * 255);
      out.data[k + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255);
      out.data[k + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      out.data[k + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return cv;
}

/**
 * Make one deliberately restrained paint detail set. It is shared by all
 * painted() materials, so introducing surface response does not multiply the
 * number of texture fetches or shader families for every prop colour.
 *
 * The broad cloud is kept below 3% contrast: at gameplay distance it reads as
 * a believable clear-coat/roller variation while the roughness and normal maps
 * carry the close-up information. The callback is seeded by materials.ts, so
 * rebuilding a scene gives the same pixels and does not churn diffs.
 */
export function createPaintedSurfaceMaps(random: () => number): SurfaceTextureSet {
  const size = 128;
  const detail = canvas(size, (ctx, s) => {
    ctx.fillStyle = gray(246);
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const x = random() * s;
      const y = random() * s;
      const r = s * (0.04 + random() * 0.12);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const shade = Math.round(226 + random() * 22);
      g.addColorStop(0, `rgba(${shade},${shade},${shade},${0.10 + random() * 0.09})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 180; i++) {
      const x = random() * s;
      const y = random() * s;
      const length = 1.5 + random() * 8;
      ctx.strokeStyle = `rgba(95,95,95,${0.018 + random() * 0.035})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + length * (0.65 + random() * 0.35), y + (random() - 0.5) * 1.5);
      ctx.stroke();
    }
  });

  const roughness = canvas(size, (ctx, s) => {
    ctx.fillStyle = gray(194);
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 32; i++) {
      const x = random() * s;
      const y = random() * s;
      const r = s * (0.03 + random() * 0.13);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const value = 146 + random() * 70;
      g.addColorStop(0, `rgba(${value},${value},${value},${0.16 + random() * 0.18})`);
      g.addColorStop(1, 'rgba(194,194,194,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = gray(166 + random() * 54);
      ctx.fillRect(random() * s, random() * s, 0.8 + random() * 1.8, 0.8 + random() * 1.8);
    }
  });

  const height = canvas(size, (ctx, s) => {
    ctx.fillStyle = gray(128);
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const v = 92 + random() * 76;
      ctx.fillStyle = gray(v);
      ctx.fillRect(random() * s, random() * s, 0.7 + random() * 2.2, 0.7 + random() * 2.2);
    }
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 44; i++) {
      ctx.strokeStyle = gray(106 + random() * 44);
      const x = random() * s;
      const y = random() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 2 + random() * 7, y + (random() - 0.5) * 2);
      ctx.stroke();
    }
  });

  return {
    map: texture(detail, 5, THREE.SRGBColorSpace),
    roughnessMap: texture(roughness, 5, THREE.NoColorSpace),
    normalMap: texture(normalFromHeight(height, 0.55), 5, THREE.NoColorSpace),
  };
}

/**
 * Start a safe asynchronous upgrade from the procedural fallback to a complete
 * external PBR set. The material library itself remains synchronous: callers get
 * usable fallback maps immediately, and a partial or unavailable download never
 * leaves a material with mismatched colour/roughness/normal channels.
 */
export function loadExternalSurfaceSet(
  urls: ExternalSurfaceUrls,
  repeat: number,
  onReady: (maps: SurfaceTextureSet) => void,
  isDisposed?: () => boolean,
): void {
  const loader = new THREE.TextureLoader();
  const loaded: Partial<SurfaceTextureSet> = {};
  let remaining = 3;
  let failed = false;
  const configure = (t: THREE.Texture, colorSpace: THREE.ColorSpace): THREE.Texture => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    t.colorSpace = colorSpace;
    t.needsUpdate = true;
    return t;
  };
  const disposeLoaded = (): void => {
    for (const candidate of Object.values(loaded)) candidate?.dispose();
    for (const key of Object.keys(loaded) as Array<keyof SurfaceTextureSet>) delete loaded[key];
  };
  const finish = (key: keyof SurfaceTextureSet, t: THREE.Texture, colorSpace: THREE.ColorSpace): void => {
    if (failed || isDisposed?.()) {
      failed = true;
      t.dispose();
      disposeLoaded();
      return;
    }
    loaded[key] = configure(t, colorSpace);
    remaining--;
    if (remaining !== 0) return;
    if (!loaded.map || !loaded.roughnessMap || !loaded.normalMap) {
      failed = true;
      disposeLoaded();
      return;
    }
    if (isDisposed?.()) {
      failed = true;
      disposeLoaded();
      return;
    }
    onReady(loaded as SurfaceTextureSet);
  };
  const reject = (): void => {
    failed = true;
    disposeLoaded();
  };
  loader.load(resolveAssetUrl(urls.diffuse), (t) => finish('map', t, THREE.SRGBColorSpace), undefined, reject);
  loader.load(resolveAssetUrl(urls.roughness), (t) => finish('roughnessMap', t, THREE.NoColorSpace), undefined, reject);
  loader.load(resolveAssetUrl(urls.normal), (t) => finish('normalMap', t, THREE.NoColorSpace), undefined, reject);
}
