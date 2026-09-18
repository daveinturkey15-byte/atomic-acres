/**
 * Atomic Acres — the ONE minimap renderer.
 *
 * Geometry, orientation and the reveal rule all come from `game/minimap.ts`;
 * this file only chooses colours and issues canvas calls. It serves both the
 * live HUD minimap (player-up, zoomed, with blips) and the map-select
 * thumbnail (north-up, whole arena, no blips), which is how the two duplicate
 * projections IMPORT-PLAN §5.12 names were collapsed into one.
 *
 * Cost: the footprints are painted ONCE into an offscreen layer at construction
 * and composited with a single `drawImage` under the player-up affine. A redraw
 * is therefore one clear, one blit, and a handful of blips — not thirteen
 * rect/arc/stroke calls — and it creates no DOM node, ever.
 *
 * The rule the old project paid for twice: the reflection and the rotation are
 * applied to the LAYER. Blips, the player arrow and the north pip are placed by
 * the scalar form of the same chain (`viewPoint`) and then drawn in unrotated
 * screen space, so a marker is never mirrored and never upside down.
 */

import {
  MAP_BOUNDS,
  MAP_FOOTPRINTS,
  mapView,
  mapScale,
  northMarker,
  playerUpTransform,
  worldToMap,
  worldToView,
  type MapBlip,
  type MapFootprint,
  type MapView,
} from '../game/minimap';
import { PAL } from '../core/palette';
import { palRgba, palCss, UI_ACCENT } from './layout';

/**
 * The frame backdrop, painted in FRAME space before the layer is composited.
 *
 * It is not a footprint and must not be: the first version filled the arena
 * rectangle inside the rotating layer, so the four corners of the round frame
 * showed the world through the minimap and the dark panel visibly swung as the
 * player turned. The backdrop belongs to the frame; the arena belongs to the
 * map.
 */
const FRAME_BACKDROP = 'rgba(8,12,8,0.82)';

/** Colour per footprint class. The only place map colour is decided. */
const FILL: Partial<Record<MapFootprint['kind'], string>> = {
  bounds: 'rgba(24,30,24,0.55)',
  yard: palRgba(PAL.lawn, 0.3),
  road: palRgba(PAL.concreteDark, 0.6),
  circle: palRgba(PAL.concreteDark, 0.55),
  garage: palRgba(PAL.barrelRoof, 0.8),
};

const STROKE: Partial<Record<MapFootprint['kind'], string>> = {
  bounds: 'rgba(220,230,220,0.22)',
  yard: 'rgba(220,230,220,0.3)',
  fence: palRgba(PAL.fenceRail, 0.85),
};

/** Houses are keyed by side so the two read apart at a glance, as in-world. */
function houseFill(side: -1 | 1 | undefined): string {
  return side === -1 ? palRgba(PAL.terracotta, 0.85) : palRgba(PAL.capsuleWhite, 0.85);
}

const BLIP_FILL: Record<MapBlip['kind'], string> = {
  self: palCss(UI_ACCENT),
  ally: palCss(PAL.signTeal),
  enemy: palCss(PAL.applianceRed),
};

/** Blip radius and arrow length in px. Small: the frame is 148 px across. */
const BLIP_R = 2.6;
const ARROW_R = 6.5;

type Ctx2D = CanvasRenderingContext2D;

function paintLayer(ctx: Ctx2D, view: MapView, ox: number, oy: number): void {
  const s = mapScale(view);
  const X = (x: number): number => worldToMap(x, 0, view)[0] - ox;
  const Z = (z: number): number => worldToMap(0, z, view)[1] - oy;
  for (const f of MAP_FOOTPRINTS) {
    if (f.shape === 'rect') {
      const fill = f.kind === 'house' ? houseFill(f.side) : FILL[f.kind];
      const w = (f.maxX - f.minX) * s;
      const h = (f.maxZ - f.minZ) * s;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(X(f.minX), Z(f.minZ), w, h);
      }
      const stroke = STROKE[f.kind];
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(X(f.minX), Z(f.minZ), w, h);
      }
    } else if (f.shape === 'disc') {
      ctx.beginPath();
      ctx.arc(X(f.cx), Z(f.cz), f.r * s, 0, Math.PI * 2);
      ctx.fillStyle = FILL[f.kind] ?? 'rgba(255,255,255,0.1)';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(X(f.x1), Z(f.z1));
      ctx.lineTo(X(f.x2), Z(f.z2));
      ctx.strokeStyle = STROKE[f.kind] ?? 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

/** A triangle pointing along +screenAngle, used for the player and for allies. */
function arrow(ctx: Ctx2D, x: number, y: number, angle: number, r: number, fill: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.62, r * 0.7);
  ctx.lineTo(-r * 0.62, r * 0.7);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

export interface MapPainter {
  /** Whole arena, north up, no player. The map-select thumbnail. */
  drawNorthUp(): void;
  /** Player-centred, camera-forward up, with blips. The live minimap. */
  drawPlayerUp(x: number, z: number, yaw: number, blips: readonly MapBlip[]): void;
}

const NO_BLIPS: readonly MapBlip[] = [];

/**
 * Build a painter for a canvas. The static layer is rasterised here, once.
 * Returns null when no 2D context exists (headless, or a lost context): the
 * caller keeps working without a map rather than throwing on a frame.
 */
export function createMapPainter(canvas: HTMLCanvasElement, zoom = 1, pad?: number): MapPainter | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const view = mapView(canvas.width, canvas.height, pad, zoom);
  const s = mapScale(view);
  const [ox, oy] = worldToMap(MAP_BOUNDS.minX, MAP_BOUNDS.minZ, view);
  const layerW = Math.max(1, Math.ceil((MAP_BOUNDS.maxX - MAP_BOUNDS.minX) * s));
  const layerH = Math.max(1, Math.ceil((MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) * s));

  const layer = document.createElement('canvas');
  layer.width = layerW;
  layer.height = layerH;
  const lctx = layer.getContext('2d');
  if (lctx) paintLayer(lctx, view, ox, oy);

  /** Frame backdrop then the static layer. Backdrop never rotates. */
  const backdrop = (): void => {
    ctx.fillStyle = FRAME_BACKDROP;
    ctx.fillRect(0, 0, view.width, view.height);
  };
  const blit = (): void => {
    if (lctx) ctx.drawImage(layer, ox, oy);
  };

  return {
    drawNorthUp(): void {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, view.width, view.height);
      backdrop();
      blit();
    },
    drawPlayerUp(x: number, z: number, yaw: number, blips: readonly MapBlip[] = NO_BLIPS): void {
      const t = playerUpTransform(yaw, { ...view, playerX: x, playerZ: z });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, view.width, view.height);
      backdrop();

      ctx.save();
      ctx.translate(t.centerX, t.centerY);
      ctx.rotate(t.rotation);
      ctx.scale(t.scaleX, 1);
      ctx.translate(-t.playerPx, -t.playerPy);
      blit();
      ctx.restore();

      // Markers: positioned by the same chain, drawn upright.
      for (const b of blips) {
        if (b.kind === 'self') continue;
        const [bx, by] = worldToView(t, view, b.x, b.z);
        ctx.beginPath();
        ctx.arc(bx, by, BLIP_R, 0, Math.PI * 2);
        ctx.fillStyle = BLIP_FILL[b.kind];
        ctx.fill();
      }
      const [nx, ny] = northMarker(yaw, view.width, view.height);
      ctx.beginPath();
      ctx.arc(nx, ny, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240,236,226,0.8)';
      ctx.fill();

      // The player sits at the centre facing up, by construction.
      arrow(ctx, t.centerX, t.centerY, 0, ARROW_R, BLIP_FILL.self);
    },
  };
}

/** One-shot north-up render, for a thumbnail that never changes. */
export function paintMapThumb(canvas: HTMLCanvasElement): void {
  createMapPainter(canvas, 1)?.drawNorthUp();
}
