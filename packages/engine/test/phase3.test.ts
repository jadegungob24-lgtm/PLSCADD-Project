import { describe, expect, it } from 'vitest';
import {
  allowableSpansAt, buildAlignment, checkStringing, equalSpacing, fitCableTestData, localToGlobal, polyfit, polyval,
  profileElevation, structureFrame, toSI, fromSI, transpositions, twoPartPoint, type StringingStep,
} from '../src';

describe('structure placement (manual §8.2, §7.3.12.1)', () => {
  // Line heading north, then turning 90° right (east) at P.I. 2.
  const g = buildAlignment([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }])!;

  it('on a tangent, TS points to positive offsets (right) and LS is TS turned 90° clockwise', () => {
    const f = structureFrame(g, 40, 0, 0);
    expect(f.ts.e).toBeCloseTo(1, 12); expect(f.ts.n).toBeCloseTo(0, 12);   // east = right of a northbound line
    expect(f.ls.e).toBeCloseTo(0, 12); expect(f.ls.n).toBeCloseTo(-1, 12);  // south
    expect(f.lineAngle).toBe(0);
    expect(f.piIndex).toBeNull();
  });

  it('places attachment points in global coordinates', () => {
    // Structure at station 40, offset 3, top 30 m above a base at elevation 100.
    const f = structureFrame(g, 40, 3, 0);
    expect(f.baseX).toBeCloseTo(3, 12); expect(f.baseY).toBeCloseTo(40, 12);
    // Attachment 2 m right of the axis, 1.5 m below TOP, 0.5 m along LS.
    const p = localToGlobal(f, 130, { x: 2, y: 1.5, z: 0.5 });
    expect(p.x).toBeCloseTo(5, 12);
    expect(p.y).toBeCloseTo(39.5, 12);
    expect(p.z).toBeCloseTo(128.5, 12);
  });

  it('at a P.I. the transverse axis follows the bisector and the line angle is reported', () => {
    const f = structureFrame(g, 100, 0, 0);
    expect(f.piIndex).toBe(1);
    expect(f.lineAngle).toBeCloseTo(90, 9);
    expect(f.ts.e).toBeCloseTo(Math.SQRT1_2, 12); expect(f.ts.n).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(f.baseX).toBeCloseTo(0, 12); expect(f.baseY).toBeCloseTo(100, 12);
    // An offset is measured along the bisector.
    const o = structureFrame(g, 100, Math.SQRT2, 0);
    expect(o.baseX).toBeCloseTo(1, 12); expect(o.baseY).toBeCloseTo(99, 12);
  });

  it('orientation rotates the structure clockwise seen from above', () => {
    const f = structureFrame(g, 40, 0, 90);
    expect(f.ts.e).toBeCloseTo(0, 12); expect(f.ts.n).toBeCloseTo(-1, 12);  // east turned 90° clockwise = south
    expect(f.ls.e).toBeCloseTo(-1, 12); expect(f.ls.n).toBeCloseTo(0, 12);
  });
});

describe('2-part insulator point C (manual App. F.1.3)', () => {
  it('symmetric V-string hangs midway below the two attachments', () => {
    const c = twoPartPoint({ x: -2, y: 0, z: 0 }, Math.sqrt(8), { x: 2, y: 0, z: 0 }, Math.sqrt(8), true)!;
    expect(c.x).toBeCloseTo(0, 12); expect(c.y).toBeCloseTo(2, 12); expect(c.z).toBeCloseTo(0, 12);
    const up = twoPartPoint({ x: -2, y: 0, z: 0 }, Math.sqrt(8), { x: 2, y: 0, z: 0 }, Math.sqrt(8), false)!;
    expect(up.y).toBeCloseTo(-2, 12);
  });

  it('unequal parts match the two-circle solution', () => {
    const A = { x: -1, y: 0.5, z: 0.3 }, B = { x: 3, y: 0, z: 0.3 };
    const c = twoPartPoint(A, 3, B, 4, true)!;
    const dist = (p: typeof A, q: typeof A) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    expect(dist(c, A)).toBeCloseTo(3, 10);
    expect(dist(c, B)).toBeCloseTo(4, 10);
    expect(c.z).toBeCloseTo(0.3, 12);       // stays in the vertical plane of A and B
    expect(c.y).toBeGreaterThan(0.5);       // the lower solution (y is down)
  });

  it('horizontal V (A above B) takes the right or left solution', () => {
    const r = twoPartPoint({ x: 1, y: 0, z: 0 }, 3, { x: 1, y: 4, z: 0 }, 3, true)!;
    expect(r.x).toBeCloseTo(1 + Math.sqrt(5), 12); expect(r.y).toBeCloseTo(2, 12);
    expect(twoPartPoint({ x: 1, y: 0, z: 0 }, 3, { x: 1, y: 4, z: 0 }, 3, false)!.x).toBeCloseTo(1 - Math.sqrt(5), 12);
  });

  it('returns null when the parts cannot meet', () => {
    expect(twoPartPoint({ x: 0, y: 0, z: 0 }, 1, { x: 5, y: 0, z: 0 }, 1, true)).toBeNull();
    expect(twoPartPoint({ x: 0, y: 0, z: 0 }, 10, { x: 1, y: 0, z: 0 }, 1, true)).toBeNull();
  });
});

describe('ground profile elevation, equal spacing, allowable spans', () => {
  it('interpolates the profile and refuses to extrapolate', () => {
    const prof = [{ station: 0, z: 100 }, { station: 50, z: 110 }, { station: 150, z: 90 }];
    expect(profileElevation(prof, 25)).toBeCloseTo(105, 12);
    expect(profileElevation(prof, 100)).toBeCloseTo(100, 12);
    expect(profileElevation(prof, 150)).toBeCloseTo(90, 12);
    expect(profileElevation(prof, 151)).toBeNull();
    expect(profileElevation([], 0)).toBeNull();
  });

  it('spaces structures evenly, ends included (N-paste)', () => {
    expect(equalSpacing(100, 400, 3)).toEqual([100, 200, 300, 400]);
    expect(equalSpacing(0, 10, 0)).toEqual([]);
  });

  it('interpolates Method 1 allowable spans by line angle; none beyond the largest angle (App. F.1.4.1)', () => {
    const rows = [
      { lineAngle: 0, maxWindSpan: 400, maxWeightSpan: [600, 650, 500] as [number, number, number], minWeightSpan: 50 },
      { lineAngle: 4, maxWindSpan: 300, maxWeightSpan: [500, 550, 400] as [number, number, number], minWeightSpan: 100 },
    ];
    expect(allowableSpansAt(rows, 2)).toEqual({ maxWindSpan: 350, maxWeightSpan: [550, 600, 450], minWeightSpan: 75 });
    expect(allowableSpansAt(rows, -4)!.maxWindSpan).toBe(300);
    expect(allowableSpansAt(rows, 4.5)).toBeNull();
    expect(allowableSpansAt([], 0)).toBeNull();
  });
});

describe('stringing rules (manual §10.3.1)', () => {
  const de = (n: number, p = 3) => ({ number: n, deadEnd: true, phaseCount: p });
  const su = (n: number, p = 3) => ({ number: n, deadEnd: false, phaseCount: p });
  const step = (structureNumber: number, set: StringingStep['set'], transposition = '123'): StringingStep => ({ structureNumber, set, transposition });

  it('accepts dead end → suspension / bypass → dead end', () => {
    expect(checkStringing([step(6, de(5)), step(7, su(8)), step(8, null), step(9, su(8), '321'), step(10, de(5))])).toEqual([]);
  });

  it('rejects a section that does not start or end at a dead end, or passes a dead end', () => {
    expect(checkStringing([step(1, su(1)), step(2, de(1))])[0]).toContain('must start at a dead-end');
    expect(checkStringing([step(1, de(1)), step(2, su(1))])[0]).toContain('must end at a dead-end');
    expect(checkStringing([step(1, de(1)), step(2, de(2)), step(3, de(1))])[0]).toContain('must end there');
  });

  it('rejects mixed phase counts, bad transpositions, wrong order and too few structures', () => {
    expect(checkStringing([step(1, de(1)), step(2, de(1, 2), '12')]).some((e) => e.includes('phase(s)'))).toBe(true);
    expect(checkStringing([step(1, de(1)), step(2, de(1), '113')]).some((e) => e.includes('phase order'))).toBe(true);
    expect(checkStringing([step(2, de(1)), step(1, de(1))])[0]).toContain('increasing order');
    expect(checkStringing([step(1, de(1))])[0]).toContain('at least two');
  });

  it('lists transpositions', () => {
    expect(transpositions(3)).toEqual(['123', '132', '213', '231', '312', '321']);
    expect(transpositions(1)).toEqual(['1']);
  });
});

describe('cable coefficients from test data (manual App. G.1)', () => {
  it('polyfit recovers an exact 4th-degree polynomial', () => {
    const c = [-1000, 2.5e9, -1.2e9, 4e8, -5e7];
    const x = [0.001, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
    const fit = polyfit(x, x.map((v) => polyval(c, v)), 4)!;
    x.forEach((v) => expect(polyval(fit, v)).toBeCloseTo(polyval(c, v), -2));
    expect(fit[1]! / c[1]!).toBeCloseTo(1, 6);
    expect(polyfit([1, 1, 1, 1, 1], [1, 2, 3, 4, 5], 4)).toBeNull();
  });

  it('linear elastic cable with constant creep reproduces the manual linear model (Eqs. 9-10, 9-11)', () => {
    // App. G.2: creep PC = 0.0005 strain = 0.05 %, E in Pa per % strain.
    const area = 400e-6, E = 6.0e8, PC = 0.05;
    const initial: [number, number][] = [0.001, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((e) => [E * e * area, e]);
    const creep: [number, number][] = [0.05, 0.1, 0.15, 0.2, 0.25].map((e) => [E * e * area, PC]);
    const r = fitCableTestData({ area, initial, creep });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fit.initial[0]! / E).toBeCloseTo(0, 6);
    expect(r.fit.initial[1]! / E).toBeCloseTo(1, 6);
    expect(r.fit.creep[0]! / (-E * PC)).toBeCloseTo(1, 5);  // c0 = −E·PC
    expect(r.fit.creep[1]! / E).toBeCloseTo(1, 5);          // c1 = E
    expect(Math.abs(r.fit.creep[2]!) / E).toBeLessThan(1e-4);
    expect(r.fit.rmsInitial / (E * 0.3)).toBeLessThan(1e-9);
    expect(r.fit.warnings).toEqual([]);
  });

  it('reports insufficient or out-of-range data instead of fitting', () => {
    const r1 = fitCableTestData({ area: 1e-4, initial: [[1, 0.1], [2, 0.2]], creep: [] });
    expect(r1.ok).toBe(false);
    const initial: [number, number][] = [0.001, 0.1, 0.2, 0.3, 0.4].map((e) => [1e8 * e * 1e-4, e]);
    const creep: [number, number][] = [1, 2, 3, 4, 1e9].map((T) => [T, 0.01]);
    const r2 = fitCableTestData({ area: 1e-4, initial, creep });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.message).toContain('outside the fitted initial curve');
  });

  it('thermal expansion coefficient converts between °C and °F', () => {
    expect(toSI(12.8, 'US', 'expansion')).toBeCloseTo(23.04e-6, 12);
    expect(fromSI(23e-6, 'SI_N', 'expansion')).toBeCloseTo(23, 9);
  });
});
