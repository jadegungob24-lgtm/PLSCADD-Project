import { describe, expect, it } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { buildAlignment, buildTin, formatDMS, makeTransformer, utmDefinition, WGS84_GEOGRAPHIC, type SurveyPoint } from '@tlcad/engine';
import { createProject, makeFeatureCode } from '@tlcad/model';
import {
  demPointCount, demToPoints, parseAsciiGrid, parseBrk, parseGeoTiff, parseLas, parsePfl, parseXyz, readLasInfo, writeBrk, writePfl,
} from '../src';

describe('BRK break line file (manual App. D.6)', () => {
  it('reads segments, converts US units and survives a write/read round trip', () => {
    const r = parseBrk("TYPE = 'BRK FILE'\nVERSION = '1'\nUNITS = 'US'\n; comment\n0 0 100 100 0 110\n100 0 110 100 100 120 ; second\nbad line\n");
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ ax: 0, az: 30.48, bx: 30.48, src: 'imported' });
    expect(r.lines[0]!.bz).toBeCloseTo(33.528, 9);
    expect(r.messages).toHaveLength(1);
    const p = createProject({ name: 'b' });
    p.terrain.breakLines = r.lines;
    const back = parseBrk(writeBrk(p, 'US', '0.2.0'));
    expect(back.messages).toEqual([]);
    back.lines.forEach((l, i) => {
      for (const k of ['ax', 'ay', 'az', 'bx', 'by', 'bz'] as const) expect(l[k]).toBeCloseTo(r.lines[i]![k], 4);
    });
    expect(parseBrk("TYPE='XYZ FILE'\n").messages[0]!.level).toBe('error');
  });
});

describe('PFL export (manual App. E.1, §6.9.1)', () => {
  const grid = "UNITS='SI'\n'1' 0 0 100 200 0\n'5' 500 500 300 200 0\n'8' 500 1000 100 200 0\n'6' 1000 500 100 200 0\n'13' 750 750 200 200 0 'p' 'q'\n'out' 520 1040 100 200 0\n";
  const project = () => {
    const p = createProject({ name: 'g' });
    p.terrain.points = parseXyz(grid).points;
    p.terrain.featureCodes = [makeFeatureCode(200, 'Ground')];
    return p;
  };
  const g = buildAlignment([{ x: 0, y: 0 }, { x: 500, y: 1000 }, { x: 1000, y: 500 }])!;

  it('exported PFL re-imports to the same alignment and point positions', () => {
    const p = project();
    const w = writePfl(p, g, null, 'SI', '0.2.0');
    expect(w.text).not.toBeNull();
    // The point in the outside wedge of the PI cannot be projected and is reported as lost.
    expect(w.messages.some((m) => m.level === 'warning' && m.text.startsWith('1 point'))).toBe(true);
    const back = parsePfl(w.text!, { x: 0, y: 0, azimuth: g.segments[0]!.azimuth });
    const g2 = buildAlignment(back.alignment!.pis, back.alignment!.startStation)!;
    expect(formatDMS(g2.lineAngles[1]!)).toBe('108°26\'06"');
    expect(back.points).toHaveLength(5);
    for (const q of back.points) {
      const o = p.terrain.points.find((k) => k.desc === q.desc)!;
      expect(q.x).toBeCloseTo(o.x, 2); expect(q.y).toBeCloseTo(o.y, 2); expect(q.z).toBeCloseTo(o.z, 3);
    }
    expect(back.points.find((q) => q.desc === '13')).toMatchObject({ profNote: 'p', planNote: 'q' });
  });

  it('uses the TIN elevation for a PI without a survey point, and refuses to invent one without a TIN', () => {
    const p = project();
    p.terrain.points = p.terrain.points.filter((q) => q.desc !== '8');
    const refused = writePfl(p, g, null, 'SI', '0.2.0');
    expect(refused.text).toBeNull();
    expect(refused.messages[0]!.level).toBe('error');
    const survey: SurveyPoint[] = [[0, 0, 100], [0, 1000, 100], [1000, 1000, 100], [1000, 0, 100]].map(([x, y, z]) => ({ x: x!, y: y!, z: z!, h: 0, onGround: true }));
    const ok = writePfl(p, g, buildTin(survey), 'SI', '0.2.0');
    expect(ok.text).toContain("'PI 2' 1118.034 0 100 390365.816 200 0"); // 108.4349488° in seconds of arc
  });
});

describe('DEM grids', () => {
  const asc = 'ncols 4\nnrows 3\nxllcorner 1000\nyllcorner 2000\ncellsize 10\nNODATA_value -9999\n1 2 3 4\n5 -9999 7 8\n9 10 11 12\n';

  it('reads an ESRI ASCII grid with cell-centre coordinates, top row first', () => {
    const { grid, messages } = parseAsciiGrid(asc);
    expect(messages).toEqual([]);
    expect(grid).toMatchObject({ ncols: 4, nrows: 3, x0: 1005, y0: 2025, dx: 10, dy: 10, nodata: -9999 });
    const r = demToPoints(grid!, { step: 1, code: 200, xyFactor: 1, zFactor: 1, maxPoints: 1000 });
    expect(r.points).toHaveLength(11); // one no-data cell skipped
    expect(r.points[0]).toMatchObject({ x: 1005, y: 2025, z: 1, code: 200, src: 'imported' });
    expect(r.points[r.points.length - 1]).toMatchObject({ x: 1035, y: 2005, z: 12 });
    expect(parseAsciiGrid('ncols 2\nnrows 2\nxllcenter 0\nyllcenter 0\ncellsize 5\n1 2\n3 4\n').grid).toMatchObject({ x0: 0, y0: 5, nodata: null });
  });

  it('samples by step, converts units, clips to a window and enforces the point limit', () => {
    const grid = parseAsciiGrid(asc).grid!;
    expect(demPointCount(grid, 2)).toBe(4);
    const r = demToPoints(grid, { step: 2, code: 200, xyFactor: 0.3048, zFactor: 0.3048, maxPoints: 1000 });
    expect(r.points.map((p) => +(p.z / 0.3048).toFixed(6))).toEqual([1, 3, 9, 11]);
    expect(r.points[0]!.x).toBeCloseTo(1005 * 0.3048, 9);
    const w = demToPoints(grid, { step: 1, code: 200, xyFactor: 1, zFactor: 1, maxPoints: 1000, window: { minX: 1000, maxX: 1020, minY: 2020, maxY: 2030 } });
    expect(w.points.map((p) => p.z)).toEqual([1, 2]);
    expect(demToPoints(grid, { step: 1, code: 200, xyFactor: 1, zFactor: 1, maxPoints: 5 }).messages[0]!.level).toBe('error');
    expect(parseAsciiGrid('hello world').grid).toBeNull();
    expect(parseAsciiGrid('ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 2 3\n').grid).toBeNull();
  });

  it('reads a GeoTIFF and reprojects geographic cells to the project CRS', async () => {
    // 3 × 2 raster in WGS 84 degrees, origin (top-left corner) at lon 3.0, lat 0.2, 0.1° cells.
    const values = [10, 20, 30, 40, 50, 60];
    const buf = await writeArrayBuffer(Float32Array.from(values), {
      width: 3, height: 2, ModelPixelScale: [0.1, 0.1, 0], ModelTiepoint: [0, 0, 0, 3.0, 0.2, 0], GeographicTypeGeoKey: 4326,
    });
    const { grid, messages } = await parseGeoTiff(buf as ArrayBuffer);
    expect(messages).toEqual([]);
    expect(grid!.ncols).toBe(3);
    expect(grid!.x0).toBeCloseTo(3.05, 9);
    expect(grid!.y0).toBeCloseTo(0.15, 9);
    const t = makeTransformer(WGS84_GEOGRAPHIC, utmDefinition(31, false).definition);
    const r = demToPoints(grid!, { step: 1, code: 200, xyFactor: 1, zFactor: 1, maxPoints: 100, transform: t });
    expect(r.points.map((p) => p.z)).toEqual(values);
    const [e, n] = t.forward(3.05, 0.15);
    expect(r.points[0]!.x).toBeCloseTo(e, 6);
    expect(r.points[0]!.y).toBeCloseTo(n, 6);
    expect((await parseGeoTiff(new ArrayBuffer(16))).grid).toBeNull();
  });
});

/** Build a minimal LAS file (version 1.2, point format 0 or 1.4 format 6). */
function makeLas(points: [number, number, number, number][], opts: { v14?: boolean; laz?: boolean } = {}): ArrayBuffer {
  const headerSize = opts.v14 ? 375 : 227;
  const rec = opts.v14 ? 30 : 20;
  const buf = new ArrayBuffer(headerSize + rec * points.length);
  const dv = new DataView(buf);
  'LASF'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  dv.setUint8(24, 1); dv.setUint8(25, opts.v14 ? 4 : 2);
  dv.setUint16(94, headerSize, true);
  dv.setUint32(96, headerSize, true);
  dv.setUint8(104, (opts.v14 ? 6 : 0) | (opts.laz ? 0x80 : 0));
  dv.setUint16(105, rec, true);
  if (opts.v14) dv.setBigUint64(247, BigInt(points.length), true); else dv.setUint32(107, points.length, true);
  [0.01, 0.01, 0.01].forEach((s, i) => dv.setFloat64(131 + 8 * i, s, true));
  [500000, 4000000, 0].forEach((o, i) => dv.setFloat64(155 + 8 * i, o, true));
  points.forEach(([x, y, z, cls], i) => {
    const at = headerSize + i * rec;
    dv.setInt32(at, Math.round((x - 500000) / 0.01), true);
    dv.setInt32(at + 4, Math.round((y - 4000000) / 0.01), true);
    dv.setInt32(at + 8, Math.round(z / 0.01), true);
    dv.setUint8(at + (opts.v14 ? 16 : 15), opts.v14 ? cls : cls | 0x60); // high bits are flags in formats 0–5
  });
  return buf;
}

describe('LAS point cloud (ASPRS LAS; manual App. D.7)', () => {
  const pts: [number, number, number, number][] = [
    [500010.12, 4000020.34, 101.5, 2], [500011, 4000021, 102, 2], [500012, 4000022, 103, 2],
    [500013, 4000023, 125.25, 5], [500014, 4000024, 99, 7],
  ];

  it('reads the header and counts classes, ignoring flag bits', () => {
    const { info, messages } = readLasInfo(makeLas(pts));
    expect(messages).toEqual([]);
    expect(info).toMatchObject({ version: '1.2', pointFormat: 0, pointCount: 5, compressed: false });
    expect([...info!.classes.entries()].sort()).toEqual([[2, 3], [5, 1], [7, 1]]);
  });

  it('imports mapped classes with scale and offset applied, thinning per class', () => {
    const r = parseLas(makeLas(pts), { classToCode: new Map([[2, 200], [5, 510]]), step: 2, xyFactor: 1, zFactor: 1, maxPoints: 100 });
    expect(r.messages).toEqual([]);
    expect(r.points.map((p) => [p.code, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)])).toEqual([
      [200, 500010.12, 4000020.34, 101.5], [200, 500012, 4000022, 103], [510, 500013, 4000023, 125.25],
    ]);
  });

  it('reads LAS 1.4 point format 6', () => {
    const buf = makeLas(pts, { v14: true });
    expect(readLasInfo(buf).info).toMatchObject({ version: '1.4', pointFormat: 6, pointCount: 5 });
    const r = parseLas(buf, { classToCode: new Map([[7, 950]]), step: 1, xyFactor: 1, zFactor: 0.3048, maxPoints: 100 });
    expect(r.points).toHaveLength(1);
    expect(r.points[0]!.z).toBeCloseTo(99 * 0.3048, 9);
  });

  it('refuses LAZ, non-LAS data, unmapped imports and imports over the point limit', () => {
    expect(readLasInfo(makeLas(pts, { laz: true })).messages[0]!.text).toContain('LAZ');
    expect(readLasInfo(new ArrayBuffer(300)).info).toBeNull();
    expect(parseLas(makeLas(pts), { classToCode: new Map(), step: 1, xyFactor: 1, zFactor: 1, maxPoints: 100 }).messages[0]!.level).toBe('error');
    expect(parseLas(makeLas(pts), { classToCode: new Map([[2, 200]]), step: 1, xyFactor: 1, zFactor: 1, maxPoints: 2 }).points).toEqual([]);
  });
});
