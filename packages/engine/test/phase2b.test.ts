import { describe, expect, it } from 'vitest';
import {
  buildAlignment, buildTin, buildVirtualAlignment, makeTransformer, projectPoint, tinContours, tinElevation,
  toEquationStation, utmDefinition, utmZoneForLongitude, validateCrsDefinition, WGS84_GEOGRAPHIC, withoutSmallAngles,
  type StationEquation, type SurveyPoint,
} from '../src';

const G: Record<number, [number, number, number]> = {
  1: [0, 0, 100], 2: [500, 0, 100], 3: [1000, 0, 100], 4: [0, 500, 100], 5: [500, 500, 300], 6: [1000, 500, 100],
  7: [0, 1000, 100], 8: [500, 1000, 100], 9: [1000, 1000, 100], 10: [250, 250, 200], 11: [750, 250, 200],
  12: [250, 750, 200], 13: [750, 750, 200],
};
const pi = (n: number) => ({ x: G[n]![0], y: G[n]![1] });
const survey: SurveyPoint[] = Object.values(G).map(([x, y, z]) => ({ x, y, z, h: 0, onGround: true }));

describe('virtual alignment (manual §6.3.1.2)', () => {
  it('reproduces Fig. 6.3-8: main 1-2-5-13-9, gap, branch 5-8 with point 8 at station 2507.11', () => {
    const v = buildVirtualAlignment([[pi(1), pi(2), pi(5), pi(13), pi(9)], [pi(5), pi(8)]], 0, 300);
    const main = v[0]!, branch = v[1]!;
    expect(main.totalLength).toBeCloseTo(1707.11, 2);
    expect(branch.startStation).toBeCloseTo(2007.11, 2);
    expect(projectPoint(branch, 500, 1000)!.station).toBeCloseTo(2507.11, 2);
  });

  it('an alignment with fewer than two PIs has no geometry and takes no stations', () => {
    const v = buildVirtualAlignment([[pi(1), pi(2)], [pi(5)], [pi(4), pi(7)]], 100, 50);
    expect(v[1]).toBeNull();
    expect(v[2]!.startStation).toBeCloseTo(100 + 500 + 50, 9);
  });

  it('end extension can be limited so that adjacent profiles do not overlap', () => {
    const g = buildAlignment([{ x: 0, y: 0 }, { x: 100, y: 0 }])!;
    expect(projectPoint(g, 120, 0, { before: 30, after: 30 })!.station).toBeCloseTo(120, 9);
    expect(projectPoint(g, 140, 0, { before: 30, after: 30 })).toBeNull();
    expect(projectPoint(g, -31, 0, { before: 30, after: 30 })).toBeNull();
  });
});

describe('equation stations (manual §6.11)', () => {
  // The manual's example: true stations 1000–2000 run backward from 5000 to 4000; beyond 2000 they run forward from 15000.
  const eq: StationEquation[] = [
    { trueStation: 1000, equationStation: 5000, direction: 'back' },
    { trueStation: 2000, equationStation: 15000, direction: 'ahead' },
  ];
  it('matches the manual example', () => {
    expect(toEquationStation(500, eq)).toBe(500);
    expect(toEquationStation(1000, eq)).toBe(5000);
    expect(toEquationStation(1500, eq)).toBe(4500);
    expect(toEquationStation(1999.5, eq)).toBeCloseTo(4000.5, 9);
    expect(toEquationStation(2000, eq)).toBe(15000);
    expect(toEquationStation(2750, eq)).toBe(15750);
    expect(toEquationStation(123, [])).toBe(123);
  });
});

describe('delete small-angle PIs (manual §6.3.1.1)', () => {
  it('removes PIs at or below the angle limit and keeps the ends and real corners', () => {
    const pis = [{ x: 0, y: 0 }, { x: 100, y: 1 }, { x: 200, y: 0 }, { x: 300, y: 100 }, { x: 400, y: 100 }];
    expect(withoutSmallAngles(pis, 2)).toEqual([0, 2, 3, 4]);
    expect(withoutSmallAngles(pis, 0.1)).toEqual([0, 1, 2, 3, 4]);
    expect(withoutSmallAngles(pis, 90)).toEqual([0, 4]);
  });
});

describe('TIN contours and break lines', () => {
  it('contours of the pyramid are closed rings at the right elevations', () => {
    const tin = buildTin(survey)!;
    const levels = tinContours(tin, 50);
    expect(levels.map((l) => l.z)).toEqual([150, 200, 250]);
    for (const l of levels) {
      // Every contour end point lies on the surface at the contour elevation.
      for (let i = 0; i < l.segments.length; i += 2) {
        expect(tinElevation(tin, l.segments[i]!, l.segments[i + 1]!)).toBeCloseTo(l.z, 6);
      }
      // Closed rings: every end point is shared by exactly two segments.
      const count = new Map<string, number>();
      for (let i = 0; i < l.segments.length; i += 2) {
        const k = `${l.segments[i]!.toFixed(6)},${l.segments[i + 1]!.toFixed(6)}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      expect([...count.values()].every((c) => c === 2)).toBe(true);
    }
    expect(tinContours(tin, 0)).toEqual([]);
  });

  it('a break line forces a triangle edge and changes the interpolated surface', () => {
    // Square with one high corner pair: the diagonal chosen decides the elevation at the centre.
    const sq: SurveyPoint[] = [
      { x: 0, y: 0, z: 0, h: 0, onGround: true }, { x: 10, y: 0, z: 10, h: 0, onGround: true },
      { x: 10, y: 10.001, z: 0, h: 0, onGround: true }, { x: 0, y: 10, z: 10, h: 0, onGround: true },
    ];
    const low = buildTin(sq, { breakLines: [{ ax: 0, ay: 0, az: 0, bx: 10, by: 10.001, bz: 0 }] })!;
    const high = buildTin(sq, { breakLines: [{ ax: 10, ay: 0, az: 10, bx: 0, by: 10, bz: 10 }] })!;
    expect(tinElevation(low, 5, 5.0005)).toBeCloseTo(0, 6);
    expect(tinElevation(high, 5, 5)).toBeCloseTo(10, 6);
  });

  it('break line end points that are not survey points become TIN vertices; crossing break lines are reported', () => {
    const report = { breakLinesSkipped: 0 };
    const tin = buildTin(survey, {
      report,
      breakLines: [
        { ax: 100, ay: 100, az: 555, bx: 400, by: 100, bz: 555 },
        { ax: 250, ay: 50, az: 1, bx: 250, by: 150, bz: 1 }, // crosses the first
      ],
    })!;
    expect(tinElevation(tin, 100, 100)).toBeCloseTo(555, 9);
    expect(report.breakLinesSkipped).toBe(1);
  });
});

describe('coordinate systems (manual §6.2.1)', () => {
  it('generates UTM definitions and zones', () => {
    expect(utmDefinition(18, true)).toMatchObject({ name: 'WGS 84 / UTM zone 18S', epsg: 32718 });
    expect(utmDefinition(51, false).epsg).toBe(32651);
    expect(() => utmDefinition(61, false)).toThrow();
    expect(utmZoneForLongitude(-73.5)).toBe(18);
    expect(utmZoneForLongitude(121)).toBe(51);
  });

  it('projects a known point: the central meridian on the equator is E 500000, N 0', () => {
    const t = makeTransformer(WGS84_GEOGRAPHIC, utmDefinition(31, false).definition);
    const [e, n] = t.forward(3, 0);
    expect(e).toBeCloseTo(500000, 3);
    expect(n).toBeCloseTo(0, 3);
    // One degree of latitude along the central meridian at scale 0.9996: 110574.389 m × 0.9996.
    expect(t.forward(3, 1)[1]).toBeCloseTo(110574.389 * 0.9996, 0);
    // The southern-hemisphere zone adds the 10 000 000 m false northing.
    const s = makeTransformer(WGS84_GEOGRAPHIC, utmDefinition(31, true).definition);
    expect(s.forward(3, 0)[1]).toBeCloseTo(10000000, 3);
  });

  it('forward then inverse returns the starting coordinates', () => {
    const t = makeTransformer(utmDefinition(18, true).definition, WGS84_GEOGRAPHIC);
    const [lon, lat] = t.forward(591549.81, 5318909.74);
    const [e, n] = t.inverse(lon, lat);
    expect(e).toBeCloseTo(591549.81, 4);
    expect(n).toBeCloseTo(5318909.74, 4);
    expect(lat).toBeLessThan(0);
  });

  it('validates definitions', () => {
    expect(validateCrsDefinition(utmDefinition(10, false).definition)).toBeNull();
    expect(validateCrsDefinition('')).not.toBeNull();
    expect(validateCrsDefinition('not a projection')).not.toBeNull();
  });
});
