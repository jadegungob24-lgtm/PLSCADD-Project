import { describe, expect, it } from 'vitest';
import {
  buildAlignment, buildTin, centerlineProfile, formatDMS, projectPoint, projectPoints, sideProfile,
  stationToXY, tinElevation, tinProfile, type SurveyPoint,
} from '../src';

/**
 * GRID example of the PLS-CADD manual (§6.3): 13 points forming a symmetrical
 * pyramid. Points 1–9 are a 3 × 3 grid at elevation 100, point 5 (centre) is
 * at 300, points 10–13 are at 200. Coordinates follow the status-bar values
 * shown in the manual figures (PNT9 X=1000 Y=1000, PNT8 X=500 Y=1000,
 * PNT13 X=750 Y=750 Z=200).
 */
const G: Record<number, [number, number, number]> = {
  1: [0, 0, 100], 2: [500, 0, 100], 3: [1000, 0, 100],
  4: [0, 500, 100], 5: [500, 500, 300], 6: [1000, 500, 100],
  7: [0, 1000, 100], 8: [500, 1000, 100], 9: [1000, 1000, 100],
  10: [250, 250, 200], 11: [750, 250, 200], 12: [250, 750, 200], 13: [750, 750, 200],
};
const pi = (n: number) => ({ x: G[n]![0], y: G[n]![1] });
const survey: SurveyPoint[] = Object.values(G).map(([x, y, z]) => ({ x, y, z, h: 0, onGround: true }));

describe('alignment geometry — manual GRID example', () => {
  it('alignment 1-8-6 has the line angle 108°26\'06" shown in Fig. 6.3-2', () => {
    const g = buildAlignment([pi(1), pi(8), pi(6)])!;
    expect(formatDMS(g.lineAngles[1]!)).toBe('108°26\'06"');
    expect(g.stations[1]).toBeCloseTo(Math.hypot(500, 1000), 9);
    expect(g.totalLength).toBeCloseTo(Math.hypot(500, 1000) + Math.hypot(500, 500), 9);
  });

  it('alignment 1-2-5-9 has line angles -90° and +45° and end station 1707.11 (Fig. 6.3-7)', () => {
    const g = buildAlignment([pi(1), pi(2), pi(5), pi(9)])!;
    expect(g.lineAngles[1]).toBeCloseTo(-90, 9);
    expect(g.lineAngles[2]).toBeCloseTo(45, 9);
    expect(g.stations[3]).toBeCloseTo(1707.11, 2);
    expect(g.lineAngles[0]).toBe(0);
    expect(g.lineAngles[3]).toBe(0);
  });

  it('positive offsets are to the right when travelling up-station', () => {
    const g = buildAlignment([{ x: 0, y: 0 }, { x: 0, y: 100 }])!; // heading north
    expect(projectPoint(g, 10, 40)).toMatchObject({ station: 40, offset: 10 });
    expect(projectPoint(g, -10, 40)!.offset).toBe(-10);
  });

  it('station/offset and plan coordinates are inverse', () => {
    const g = buildAlignment([pi(1), pi(8), pi(6)], 1000)!;
    for (const [sta, off] of [[1100, 12], [2000, -30], [2300, 5]] as const) {
      const p = stationToXY(g, sta, off);
      const so = projectPoint(g, p.x, p.y)!;
      expect(so.station).toBeCloseTo(sta, 8);
      expect(so.offset).toBeCloseTo(off, 8);
    }
  });

  it('points in the outside wedge of a line angle cannot be projected (§6.3.2)', () => {
    const g = buildAlignment([pi(1), pi(2), pi(5), pi(9)])!;
    // PI 2 turns left (north); the outside wedge is to the south-east of it.
    expect(projectPoint(g, 520, -20)).toBeNull();
    // The PI itself always projects.
    expect(projectPoint(g, 500, 0)).toMatchObject({ offset: 0 });
  });

  it('profiles extend beyond the end alignment points (§6.3.1.2)', () => {
    const g = buildAlignment([{ x: 0, y: 0 }, { x: 100, y: 0 }])!;
    expect(projectPoint(g, -50, 0)!.station).toBeCloseTo(-50, 9);
    expect(projectPoint(g, 180, 3)!.station).toBeCloseTo(180, 9);
  });

  it('rejects fewer than two PIs and coincident PIs', () => {
    expect(buildAlignment([pi(1)])).toBeNull();
    expect(buildAlignment([pi(1), pi(1)])).toBeNull();
  });
});

describe('ground profiles', () => {
  it('centerline profile joins ground points within MOCGP in station order', () => {
    const g = buildAlignment([pi(1), pi(9)])!; // diagonal through 10, 5, 13
    const { projected, unprojectable } = projectPoints(g, survey);
    expect(unprojectable).toBe(0);
    const prof = centerlineProfile(survey, projected, 10);
    expect(prof.map((v) => v.z)).toEqual([100, 200, 300, 200, 100]);
    expect(prof[2]!.station).toBeCloseTo(Math.hypot(500, 500), 9);
    // Non-ground points are excluded.
    const withObstacle = [...survey, { x: 600, y: 600, z: 999, h: 0, onGround: false }];
    const p2 = projectPoints(g, withObstacle);
    expect(centerlineProfile(withObstacle, p2.projected, 10)).toHaveLength(5);
  });

  it('side profile breaks where points are farther apart than the maximum separation', () => {
    const g = buildAlignment([{ x: 0, y: 0 }, { x: 1000, y: 0 }])!;
    const pts: SurveyPoint[] = [0, 50, 100, 600, 650].map((x) => ({ x, y: -20, z: x / 10, h: 0, onGround: true }));
    const { projected } = projectPoints(g, pts);
    const lines = sideProfile(pts, projected, 20, 2, 200);
    expect(lines.map((l) => l.length)).toEqual([3, 2]);
    expect(sideProfile(pts, projected, -20, 2, 200)).toEqual([]);
  });
});

describe('TIN — manual GRID example', () => {
  it('triangulates the 13 points into 16 triangles (§6.4.4)', () => {
    const tin = buildTin(survey)!;
    expect(tin.triangles.length / 3).toBe(16);
  });

  it('interpolates elevations on the surface and returns null outside it', () => {
    const tin = buildTin(survey)!;
    expect(tinElevation(tin, 500, 500)).toBeCloseTo(300, 9);
    expect(tinElevation(tin, 375, 375)).toBeCloseTo(250, 9); // midway between points 10 and 5
    expect(tinElevation(tin, 0, 250)).toBeCloseTo(100, 9);   // on the base edge
    expect(tinElevation(tin, -1, 500)).toBeNull();
  });

  it('TIN profile along the diagonal reproduces the pyramid exactly', () => {
    const tin = buildTin(survey)!;
    const g = buildAlignment([pi(1), pi(9)])!;
    const prof = tinProfile(tin, g);
    const d = Math.hypot(250, 250);
    expect(prof.map((v) => [Math.round(v.station * 1e6) / 1e6, Math.round(v.z * 1e6) / 1e6])).toEqual([
      [0, 100], [Math.round(d * 1e6) / 1e6, 200], [Math.round(2 * d * 1e6) / 1e6, 300],
      [Math.round(3 * d * 1e6) / 1e6, 200], [Math.round(4 * d * 1e6) / 1e6, 100],
    ]);
  });

  it('every TIN profile vertex lies on the surface', () => {
    const tin = buildTin(survey)!;
    const g = buildAlignment([pi(1), pi(8), pi(6)])!;
    for (const off of [-40, 0, 40]) {
      const prof = tinProfile(tin, g, off);
      expect(prof.length).toBeGreaterThan(3);
      for (const v of prof) {
        // At a PI an offset line has two end points (one per adjacent segment) with the same
        // station, so the station → plan mapping is not unique there; skip that station.
        if (Math.abs(v.station - g.stations[1]!) < 1e-6) continue;
        const p = stationToXY(g, v.station, off);
        expect(tinElevation(tin, p.x, p.y)).toBeCloseTo(v.z, 6);
      }
    }
  });

  it('maximum edge length removes long triangles; fewer than 3 ground points gives no TIN', () => {
    expect(buildTin(survey, { maxEdge: 100 })).toBeNull();
    expect(buildTin(survey.slice(0, 2))).toBeNull();
  });
});
