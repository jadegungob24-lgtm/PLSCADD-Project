import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  buildKml, buildKmz, clipPolyline, pageToSvg, pagesToDxf, pagesToPdf, parseDxf, parseShapefile, reportToCsv, reportToHtml,
  reportToPages, reportToSpreadsheetXml, textWidth, type Page, type Report,
} from '../src';

const page: Page = {
  width: 100, height: 50,
  prims: [
    { kind: 'line', x1: 10, y1: 10, x2: 90, y2: 10, stroke: '#ff0000', width: 0.5, layer: 'WIRES' },
    { kind: 'polyline', pts: [[0, 0], [10, 5], [20, 0]], stroke: '#000000', dash: [1, 1] },
    { kind: 'rect', x: 5, y: 5, w: 20, h: 10, stroke: '#000', fill: '#eeeeee' },
    { kind: 'circle', cx: 50, cy: 25, r: 3, stroke: '#00f' },
    { kind: 'text', x: 50, y: 40, text: 'Str 12 (a) 30°', size: 3, anchor: 'middle', layer: 'TEXT' },
  ],
};

describe('drawing writers', () => {
  it('SVG keeps millimetre page units', () => {
    const s = pageToSvg(page);
    expect(s).toContain('viewBox="0 0 100 50"');
    expect(s).toContain('width="100mm"');
    expect(s).toContain('text-anchor="middle"');
    expect(s).toContain('Str 12 (a) 30°');
  });

  it('PDF has a consistent cross-reference table and escaped text', () => {
    const bytes = pagesToPdf([page, page], { title: 'Test' });
    const s = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 2');
    expect(s).toContain('(Str 12 \\(a\\) 30\\260)'); // parentheses escaped, ° as WinAnsi octal 260
    // Every xref offset points at "n 0 obj".
    const xrefAt = Number(/startxref\n(\d+)/.exec(s)![1]);
    const xref = s.slice(xrefAt).split('\n');
    const count = Number(xref[1]!.split(' ')[1]);
    for (let i = 1; i < count; i++) {
      const off = Number(xref[2 + i]!.slice(0, 10));
      expect(s.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    }
    // Stream lengths match their content.
    for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = m.index! + m[0].length;
      expect(s.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe('\nendstream');
    }
  });

  it('DXF R12 round trip through the DXF reader (y flipped to up, pages side by side)', () => {
    const dxf = pagesToDxf([page, page], 20);
    expect(dxf).toContain('AC1009');
    const r = parseDxf(dxf);
    const lines = r.entities.filter((e) => e.kind === 'polyline' && e.layer === 'WIRES');
    expect(lines).toHaveLength(2);
    const l0 = lines[0]!, l1 = lines[1]!;
    if (l0.kind !== 'polyline' || l1.kind !== 'polyline') throw new Error();
    expect(l0.pts[0]).toEqual([10, 40, 0]);   // y = 50 − 10
    expect(l1.pts[0]![0]).toBe(130);          // second page offset by 100 + 20
    const t = r.entities.find((e) => e.kind === 'text')!;
    expect(t.kind === 'text' && t.text).toBe('Str 12 (a) 30°');
    expect(r.layers).toContain('TEXT');
  });

  it('clips polylines to a rectangle', () => {
    const parts = clipPolyline([[-10, 5], [5, 5], [5, 20], [5, 30], [20, 30]], 0, 0, 10, 10);
    expect(parts).toEqual([[[0, 5], [5, 5], [5, 10]]]);
    expect(clipPolyline([[20, 20], [30, 30]], 0, 0, 10, 10)).toEqual([]);
  });

  it('text width from Helvetica metrics', () => {
    expect(textWidth('0', 0.72)).toBeCloseTo(0.556, 6); // 1 em = 1 mm when cap height is 0.72 mm
  });
});

describe('CAD readers and KMZ', () => {
  it('reads LWPOLYLINE, CIRCLE and MTEXT and counts skipped entities', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'ROADS', '90', '3', '70', '1', '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '5',
      '0', 'CIRCLE', '8', 'POLES', '10', '5', '20', '5', '30', '0', '40', '1',
      '0', 'MTEXT', '8', 'NOTES', '10', '1', '20', '2', '40', '2', '1', '{\\fArial;Main\\PRoad}',
      '0', 'INSERT', '8', '0', '2', 'BLOCK1',
      '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const r = parseDxf(dxf);
    const pl = r.entities[0]!;
    expect(pl.kind === 'polyline' && pl.closed).toBe(true);
    expect(pl.kind === 'polyline' && pl.pts).toEqual([[0, 0, 0], [10, 0, 0], [10, 5, 0]]);
    const c = r.entities[1]!;
    expect(c.kind === 'polyline' && Math.hypot(c.pts[0]![0] - 5, c.pts[0]![1] - 5)).toBeCloseTo(1, 12);
    const t = r.entities[2]!;
    expect(t.kind === 'text' && t.text).toBe('Main Road');
    expect(r.skipped).toEqual({ INSERT: 1 });
  });

  it('reads a polyline shapefile', () => {
    // Header (100 bytes) + one PolyLine record with 1 part and 2 points.
    const recLen = 4 + 32 + 4 + 4 + 4 + 2 * 16;
    const buf = new ArrayBuffer(100 + 8 + recLen);
    const dv = new DataView(buf);
    dv.setInt32(0, 9994, false); dv.setInt32(24, buf.byteLength / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, 3, true);
    dv.setInt32(100, 1, false); dv.setInt32(104, recLen / 2, false);
    const r = 108;
    dv.setInt32(r, 3, true); dv.setInt32(r + 36, 1, true); dv.setInt32(r + 40, 2, true); dv.setInt32(r + 44, 0, true);
    dv.setFloat64(r + 48, 100, true); dv.setFloat64(r + 56, 200, true); dv.setFloat64(r + 64, 110, true); dv.setFloat64(r + 72, 220, true);
    const s = parseShapefile(buf);
    expect(s.entities).toEqual([{ kind: 'polyline', pts: [[100, 200, 0], [110, 220, 0]], closed: false, layer: 'SHP' }]);
    expect(() => parseShapefile(new ArrayBuffer(120))).toThrow();
  });

  it('KMZ holds doc.kml with KML colours aabbggrr', () => {
    const kml = buildKml('Line', [
      { name: 'Str 1', folder: 'Structures', point: [-75.1, 40.2, 120] },
      { name: 'Ph 1', folder: 'Wires', line: [[-75.1, 40.2, 130], [-75.0, 40.2, 128]], color: '#ff8000' },
    ]);
    expect(kml).toContain('<color>ff0080ff</color>');
    const files = unzipSync(buildKmz(kml));
    expect(strFromU8(files['doc.kml']!)).toBe(kml);
  });
});

describe('report writers', () => {
  const r: Report = {
    title: 'Staking', header: ['Project: test'],
    tables: [{ title: 'Structures', columns: ['No.', 'Station', 'Note'], rows: [[1, 0, 'a,b'], [2, 150.256, null]], decimals: [0, 2, null], flagged: [1], notes: ['n'] }],
  };
  it('CSV quotes separators and formats numbers', () => {
    const c = reportToCsv(r).split('\r\n');
    expect(c).toContain('1,0.00,"a,b"');
    expect(c).toContain('2,150.26,');
  });
  it('HTML flags rows and Excel XML has a numeric cell', () => {
    expect(reportToHtml(r)).toContain('<tr class="flag">');
    expect(reportToSpreadsheetXml(r)).toContain('<Data ss:Type="Number">150.256</Data>');
  });
  it('paginates long tables', () => {
    const big: Report = { ...r, tables: [{ ...r.tables[0]!, rows: Array.from({ length: 120 }, (_, i) => [i, i * 10, 'x']) }] };
    const pages = reportToPages(big);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[1]!.prims.some((p) => p.kind === 'text' && p.text === 'Station')).toBe(true); // header repeated
  });
});
