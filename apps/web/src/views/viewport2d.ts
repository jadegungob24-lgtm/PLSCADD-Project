/**
 * 2D viewport transform shared by the Plan and Profile views.
 *
 * World coordinates are SI metres (X east / Y north in plan; station /
 * elevation in profile). Screen Y points down, world Y points up. The profile
 * view uses a vertical exaggeration (aspect ratio) so that sy = aspect * sx.
 */

export interface Viewport {
  /** World coordinate at the centre of the canvas. */
  cx: number;
  cy: number;
  /** Pixels per metre along X. */
  scale: number;
  /** Vertical exaggeration: pixels per metre along Y = scale * aspect. */
  aspect: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const worldToScreen = (v: Viewport, s: Size, x: number, y: number): [number, number] => [
  s.w / 2 + (x - v.cx) * v.scale,
  s.h / 2 - (y - v.cy) * v.scale * v.aspect,
];

export const screenToWorld = (v: Viewport, s: Size, px: number, py: number): [number, number] => [
  v.cx + (px - s.w / 2) / v.scale,
  v.cy - (py - s.h / 2) / (v.scale * v.aspect),
];

/** Zoom by `factor` keeping the world point under the cursor fixed. */
export function zoomAt(v: Viewport, s: Size, px: number, py: number, factor: number): Viewport {
  const [wx, wy] = screenToWorld(v, s, px, py);
  const scale = Math.min(1e6, Math.max(1e-6, v.scale * factor));
  return {
    ...v,
    scale,
    cx: wx - (px - s.w / 2) / scale,
    cy: wy + (py - s.h / 2) / (scale * v.aspect),
  };
}

export function panBy(v: Viewport, dxPx: number, dyPx: number): Viewport {
  return { ...v, cx: v.cx - dxPx / v.scale, cy: v.cy + dyPx / (v.scale * v.aspect) };
}

/** Fit bounds into the canvas with a margin (fraction of the canvas size). */
export function fitBounds(b: Bounds, s: Size, aspect: number, margin = 0.08): Viewport {
  const w = Math.max(b.maxX - b.minX, 1e-9);
  const h = Math.max(b.maxY - b.minY, 1e-9);
  const availW = Math.max(s.w * (1 - 2 * margin), 1);
  const availH = Math.max(s.h * (1 - 2 * margin), 1);
  const scale = Math.min(availW / w, availH / (h * aspect));
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale, aspect };
}

/** "Nice" grid step (1, 2 or 5 × 10ⁿ) giving roughly `targetPx` between lines. */
export function niceStep(pxPerUnit: number, targetPx = 90): number {
  const raw = targetPx / pxPerUnit;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

/** Grid line positions covering [min, max]. */
export function gridLines(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let i = 0; i < 2000; i++) {
    const v = start + i * step;
    if (v > max) break;
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

/** Decimals needed to print grid labels for a step. */
export const stepDecimals = (step: number) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
