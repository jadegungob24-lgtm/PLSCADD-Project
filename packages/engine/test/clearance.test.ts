import { describe, expect, it } from 'vitest';
import {
  distanceToTin, ellipseOutline, gallopingEllipse, iceJump, indexTin, interactionUsage, outlineDistance, piercePlane, pointTriangle,
  polylineDistance, segmentDistance, zoneCheck,
} from '../src';

describe('survey point clearance zones (Fig. 6.1-3)', () => {
  const north = { x: 0, y: 1 };
  const P = { x: 0, y: 0, top: 10, ground: 10, aerial: false, rv: 5, rh: 3 };

  it('finds where a wire pierces the plane perpendicular to the alignment', () => {
    expect(piercePlane([{ x: 0, y: -10, z: 0 }, { x: 0, y: 10, z: 10 }], { x: 0, y: 0 }, north)).toEqual([{ x: 0, y: 0, z: 5 }]);
    expect(piercePlane([{ x: 0, y: 1, z: 0 }, { x: 0, y: 10, z: 10 }], { x: 0, y: 0 }, north)).toEqual([]);
  });

  it('rectangle: violation inside, margin to the nearest edge', () => {
    const c = zoneCheck(P, { x: 2, y: 0, z: 14 }, north);
    expect(c.kind).toBe('rectangle');
    expect(c.inside).toBe(true);
    expect(c.lateral).toBe(2);           // to the right of the northbound line (east)
    expect(c.vertical).toBe(4);
    expect(c.margin).toBe(-1);           // 1 below the top edge and 1 inside the side edge
    const o = zoneCheck(P, { x: 4, y: 0, z: 12 }, north);
    expect(o.inside).toBe(false);
    expect(o.margin).toBe(1);
    const corner = zoneCheck(P, { x: 6, y: 0, z: 19 }, north);
    expect(corner.margin).toBeCloseTo(5, 12); // √(3² + 4²) beyond the corner
  });

  it('band when RH = 0: questionable anywhere between the ground and RV above the point', () => {
    const b = zoneCheck({ ...P, rh: 0 }, { x: 100, y: 0, z: 14 }, north);
    expect(b.kind).toBe('band');
    expect(b.inside).toBe(true);
    expect(b.margin).toBe(-1);
  });

  it('aerial obstacle: the zone extends RV below the point', () => {
    expect(zoneCheck({ ...P, aerial: true }, { x: 0, y: 0, z: 6 }, north).inside).toBe(true);
    expect(zoneCheck({ ...P, aerial: true }, { x: 0, y: 0, z: 4 }, north).inside).toBe(false);
    expect(zoneCheck(P, { x: 0, y: 0, z: 9 }, north).inside).toBe(true); // ground point: a wire below the ground is reported
  });
});

describe('3-D distances', () => {
  it('skew segments', () => {
    const r = segmentDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0.5, y: -1, z: 1 }, { x: 0.5, y: 1, z: 1 });
    expect(r.d).toBeCloseTo(1, 12);
    expect(r.pa.x).toBeCloseTo(0.5, 12);
    expect(r.pb.y).toBeCloseTo(0, 12);
  });

  it('parallel wires and horizontal measure', () => {
    const a = [{ x: 0, y: 0, z: 10 }, { x: 0, y: 100, z: 10 }];
    const b = [{ x: 3, y: 0, z: 14 }, { x: 3, y: 100, z: 14 }];
    expect(polylineDistance(a, b)!.d).toBeCloseTo(5, 12);
    expect(polylineDistance(a, b, true)!.d).toBeCloseTo(3, 12);
  });

  it('point to triangle and to a TIN', () => {
    const A = { x: 0, y: 0, z: 0 }, B = { x: 10, y: 0, z: 0 }, C = { x: 0, y: 10, z: 0 };
    expect(pointTriangle({ x: 2, y: 2, z: 5 }, A, B, C)).toEqual({ x: 2, y: 2, z: 0 });
    expect(pointTriangle({ x: -3, y: -4, z: 0 }, A, B, C)).toEqual(A);
    const tin = { vertices: new Float64Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0]), triangles: new Uint32Array([0, 1, 2, 1, 3, 2]) };
    const ix = indexTin(tin, 4);
    const r = distanceToTin(ix, { x: 7, y: 7, z: 6 }, 5)!;
    expect(r.d).toBeCloseTo(6, 12);
    expect(distanceToTin(ix, { x: 50, y: 50, z: 6 }, 5)).toBeNull();
  });

  it('ice jump reflects the iced shape about the un-iced shape', () => {
    expect(iceJump([{ x: 0, y: 0, z: 8 }], [{ x: 0, y: 0, z: 10 }])).toEqual([{ x: 0, y: 0, z: 12 }]);
  });
});

describe('galloping ellipses (Eqs. 7-22 to 7-36)', () => {
  const base = { sag: 10, ssw: 30, span: 300, dia: 0.03, gsf: 1, eswZero: false };
  it('REA single loop', () => {
    const r = gallopingEllipse('reaSingle', base);
    if (!r.ok) throw new Error(r.message);
    expect(r.value.major).toBeCloseTo(12.8048, 10);
    expect(r.value.minor).toBeCloseTo(5.12192, 10);
    expect(r.value.b).toBeCloseTo(2.5, 12);
    expect(r.value.esw).toBe(15);
  });
  it('REA double loop (hand calculation)', () => {
    // A = √(150² + 10²) = 150.33296; (3A/8)(L + 8·SAG²/(3L) − 2A) = 12.56937; √ + 0.3048 = 3.85013
    const r = gallopingEllipse('reaDouble', base);
    if (!r.ok) throw new Error(r.message);
    expect(r.value.major).toBeCloseTo(3.85013, 4);
    expect(r.value.minor).toBeCloseTo(1.104 * Math.sqrt(3.85013 - 0.3048), 4);
    expect(r.value.b).toBeCloseTo(0.2 * 3.85013, 4);
  });
  it('CIGRE single wire and the safety factor', () => {
    const r = gallopingEllipse('cigreSingle', base);
    if (!r.ok) throw new Error(r.message);
    expect(r.value.major).toBeCloseTo(0.03 * 80 * Math.log(80 / 1.5), 10); // 9.54375
    expect(r.value.esw).toBe(0);
    const g = gallopingEllipse('cigreSingle', { ...base, gsf: 1.5 });
    expect(g.ok && g.value.major).toBeCloseTo(1.5 * 9.543753, 4);
    expect(gallopingEllipse('cigreBundle', { ...base, sag: 1 }).ok).toBe(false); // 8·1/(500·0.03) < 1
  });
  it('distance between ellipses and overlap', () => {
    const a = ellipseOutline(0, 0, 4, 2, 0), b = ellipseOutline(5, 0, 4, 2, 0), c = ellipseOutline(1, 0, 4, 2, 0);
    expect(outlineDistance(a, b)).toBeCloseTo(3, 2); // half-minor axes of 1: 5 − 1 − 1
    expect(outlineDistance(a, c)).toBe(0);
  });
});

describe('Method 2 interaction diagram (Fig. 8.3-2)', () => {
  const box: [number, number][] = [[0, 0], [200, 0], [200, 300], [0, 300]];
  it('inside, with usage along the ray from the origin', () => {
    const r = interactionUsage(box, 150, 112);
    expect(r.inside).toBe(true);
    expect(r.usage).toBeCloseTo(75, 9);
  });
  it('outside', () => {
    const r = interactionUsage(box, 100, 450);
    expect(r.inside).toBe(false);
    expect(r.usage).toBeCloseTo(150, 9);
  });
});
