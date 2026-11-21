import { describe, expect, it } from 'vitest';
import { buildAlignment, formatDMS, projectPoint } from '@tlcad/engine';
import { createProject } from '@tlcad/model';
import { parseDelimited, parsePfl, parseXyz, sniffDelimited, splitDelimited, writeXyz } from '../src';

describe('XYZ terrain file (manual App. D.1)', () => {
  it('reads the record quoted in the manual', () => {
    const r = parseXyz("TYPE='XYZ FILE' VERSION='4' UNITS='SI'\n'12345' 1000. 500. 100. 200 0 ' '   ' Hydrant '\n");
    expect(r.messages).toEqual([]);
    expect(r.units).toBe('SI');
    expect(r.points[0]).toMatchObject({ desc: '12345', x: 1000, y: 500, z: 100, code: 200, h: 0, profNote: '', planNote: 'Hydrant', src: 'imported' });
  });

  it('converts US files with the international foot and accepts a multi-line header', () => {
    const r = parseXyz("TYPE= ' XYZ FILE '\nVERSION= ' 4 '\nUNITS= ' US '\nSOURCE= ' PLS-CADD Version 12 '\n'a' 100 200 300 200 10\n");
    expect(r.units).toBe('US');
    expect(r.points[0]).toMatchObject({ x: 30.48, y: 60.96, h: 3.048 });
    expect(r.points[0]!.z).toBeCloseTo(91.44, 9);
  });

  it('reports bad lines, missing units and wrong file types without inventing data', () => {
    const r = parseXyz("'ok' 1 2 3 200 0\n'bad' 1 2 x 200 0\n'short' 1 2 3\n; comment\n");
    expect(r.points).toHaveLength(1);
    expect(r.messages.map((m) => m.level)).toEqual(['warning', 'warning', 'warning']);
    expect(parseXyz("TYPE='PFL FILE'\n'a' 1 2 3 4 5 6\n").messages[0]!.level).toBe('error');
    expect(parseXyz('').messages.some((m) => m.level === 'error')).toBe(true);
  });

  it('write then read returns the same points, in either unit system', () => {
    const p = createProject({ name: "O'Brien line" });
    p.terrain.points = parseXyz("UNITS='SI'\n'P 1' 591549.81 5318909.74 716.594 200 0\n'tree' 10.5 -20.25 3 510 12.5 'tall' 'oak'\n'off' 1 1 1 200 0\n").points;
    p.terrain.points[2]!.active = false;
    for (const u of ['SI', 'US'] as const) {
      const back = parseXyz(writeXyz(p, u, '0.2.0'));
      expect(back.units).toBe(u);
      expect(back.points).toHaveLength(2); // inactive point is not written
      back.points.forEach((q, i) => {
        const o = p.terrain.points[i]!;
        expect(q.desc).toBe(o.desc);
        expect(q.code).toBe(o.code);
        expect(q.profNote).toBe(o.profNote);
        expect(q.planNote).toBe(o.planNote);
        for (const k of ['x', 'y', 'z', 'h'] as const) expect(q[k]).toBeCloseTo(o[k], 3);
      });
    }
  });
});

describe('PFL terrain file (manual App. E.1, §6.9.2)', () => {
  // GRID alignment 1-8-6 expressed as a PFL: line angle 108°26'06" = 390366 seconds at station 1118.034.
  const sec = Math.round(108.43494882292201 * 3600 * 1000) / 1000;
  const pfl = [
    "TYPE='PFL FILE' VERSION='4' UNITS='SI'",
    "'1' 0 0 100 0 200 0",
    `'8' 1118.0339887 0 100 ${sec} 200 0`,
    "'side' 1500 25 150 0 200 0 'note'",
    "'6' 1825.1407699 0 100 0 200 0",
  ].join('\n');

  it('rebuilds the alignment and plan coordinates from stations, offsets and line angles', () => {
    // First leg of 1-8-6 has azimuth atan2(500, 1000).
    const az = Math.atan2(500, 1000) * 180 / Math.PI;
    const r = parsePfl(pfl, { x: 0, y: 0, azimuth: az });
    expect(r.messages.filter((m) => m.level !== 'info')).toEqual([]);
    const pis = r.alignment!.pis;
    expect(pis).toHaveLength(3);
    expect(pis[1]!.x).toBeCloseTo(500, 4); expect(pis[1]!.y).toBeCloseTo(1000, 4);
    expect(pis[2]!.x).toBeCloseTo(1000, 3); expect(pis[2]!.y).toBeCloseTo(500, 3);
    const g = buildAlignment(pis, r.alignment!.startStation)!;
    expect(formatDMS(g.lineAngles[1]!)).toBe('108°26\'06"');
    // Every point maps back to its own station and offset.
    const side = r.points[2]!;
    const so = projectPoint(g, side.x, side.y)!;
    expect(so.station).toBeCloseTo(1500, 6);
    expect(so.offset).toBeCloseTo(25, 6);
    expect(side.profNote).toBe('note');
  });

  it('ignores a line angle at the end of the profile and reports it', () => {
    const r = parsePfl("UNITS='SI'\n'a' 0 0 10 3600 200 0\n'b' 100 0 12 0 200 0\n", { x: 0, y: 0, azimuth: 90 });
    expect(r.alignment!.pis).toHaveLength(2);
    expect(r.alignment!.pis[1]!.x).toBeCloseTo(100, 9);
    expect(r.messages.some((m) => m.level === 'warning' && m.text.includes('end of the profile'))).toBe(true);
  });

  it('rejects files without a usable station range', () => {
    expect(parsePfl("'a' 5 0 1 0 200 0\n", { x: 0, y: 0, azimuth: 0 }).alignment).toBeNull();
    expect(parsePfl("TYPE='XYZ FILE'\n", { x: 0, y: 0, azimuth: 0 }).messages[0]!.level).toBe('error');
  });
});

describe('delimited survey text (manual App. D.3)', () => {
  const csv = 'Point,Easting,Northing,Elev,Code,Desc\n1,591549.81,5318909.74,716.594,400,"ML, start"\n2,592725.25,5319328.82,613.347,,VS\nx,bad,1,2,200,\n';

  it('detects the delimiter and heading lines', () => {
    expect(sniffDelimited(csv)).toEqual({ delimiter: ',', skipLines: 1, columns: 6 });
    expect(sniffDelimited('100 200 30\n110 210 31\n')).toMatchObject({ delimiter: ' ', skipLines: 0, columns: 3 });
    expect(sniffDelimited('a\tb\tc\n1\t2\t3\n4\t5\t6\n').delimiter).toBe('\t');
    expect(splitDelimited('1,"a ""b"", c",3', ',')).toEqual(['1', 'a "b", c', '3']);
  });

  it('maps columns, applies the default code, converts units and reports bad lines', () => {
    const r = parseDelimited(csv, { delimiter: ',', skipLines: 1, colX: 2, colY: 3, colZ: 4, colDesc: 6, colCode: 5, colH: 0, defaultCode: 200, unit: 'm' });
    expect(r.points).toHaveLength(2);
    expect(r.points[0]).toMatchObject({ x: 591549.81, y: 5318909.74, z: 716.594, code: 400, desc: 'ML, start', h: 0 });
    expect(r.points[1]!.code).toBe(200);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.text).toContain('Line 4');
    const ft = parseDelimited('10 20 30\n', { delimiter: ' ', skipLines: 0, colX: 1, colY: 2, colZ: 3, colDesc: 0, colCode: 0, colH: 0, defaultCode: 200, unit: 'ft' });
    expect(ft.points[0]).toMatchObject({ x: 3.048, y: 6.096 });
  });

  it('requires X, Y and Z columns', () => {
    const r = parseDelimited(csv, { delimiter: ',', skipLines: 1, colX: 0, colY: 3, colZ: 4, colDesc: 0, colCode: 0, colH: 0, defaultCode: 200, unit: 'm' });
    expect(r.points).toEqual([]);
    expect(r.messages[0]!.level).toBe('error');
  });
});
