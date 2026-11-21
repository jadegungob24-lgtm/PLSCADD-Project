import { describe, expect, it } from 'vitest';
import { fitBounds, gridLines, niceStep, panBy, screenToWorld, stepDecimals, worldToScreen, zoomAt, type Viewport } from './viewport2d';

const size = { w: 800, h: 600 };

describe('2D viewport', () => {
  it('world/screen transforms are inverse, including vertical exaggeration', () => {
    const v: Viewport = { cx: 591549.81, cy: 5318909.74, scale: 0.37, aspect: 10 };
    const [px, py] = worldToScreen(v, size, 591600, 5318950);
    const [x, y] = screenToWorld(v, size, px, py);
    expect(x).toBeCloseTo(591600, 6);
    expect(y).toBeCloseTo(5318950, 6);
  });

  it('screen Y decreases as world Y increases', () => {
    const v: Viewport = { cx: 0, cy: 0, scale: 1, aspect: 1 };
    expect(worldToScreen(v, size, 0, 10)[1]).toBeLessThan(worldToScreen(v, size, 0, 0)[1]);
  });

  it('zoom keeps the point under the cursor fixed', () => {
    const v: Viewport = { cx: 100, cy: 50, scale: 2, aspect: 5 };
    const before = screenToWorld(v, size, 123, 456);
    const z = zoomAt(v, size, 123, 456, 1.7);
    const after = screenToWorld(z, size, 123, 456);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    expect(z.scale).toBeCloseTo(3.4, 12);
  });

  it('pan moves the world by the dragged pixel distance', () => {
    const v: Viewport = { cx: 0, cy: 0, scale: 2, aspect: 1 };
    const p = panBy(v, 20, 10);
    expect(p.cx).toBe(-10);
    expect(p.cy).toBe(5);
  });

  it('fit shows the whole bounds inside the margins', () => {
    const b = { minX: 1000, minY: 100, maxX: 9000, maxY: 300 };
    const v = fitBounds(b, size, 10);
    const [x0, y0] = worldToScreen(v, size, b.minX, b.minY);
    const [x1, y1] = worldToScreen(v, size, b.maxX, b.maxY);
    for (const x of [x0, x1]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(size.w); }
    for (const y of [y0, y1]) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(size.h); }
    expect(v.cx).toBe(5000);
  });

  it('grid steps are 1-2-5 multiples', () => {
    expect(niceStep(1)).toBe(100);
    expect(niceStep(0.5)).toBe(200);
    expect(niceStep(20)).toBe(5);
    expect(niceStep(900)).toBeCloseTo(0.1, 12);
    expect(gridLines(-250, 250, 100)).toEqual([-200, -100, 0, 100, 200]);
    expect(stepDecimals(0.1)).toBe(1);
    expect(stepDecimals(50)).toBe(0);
  });
});
