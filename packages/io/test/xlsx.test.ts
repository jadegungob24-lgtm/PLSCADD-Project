import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { cellNumber, guessColumns, parseDelimited, parseXlsx, sheetToTsv, sniffDelimited } from '../src';

/** A minimal .xlsx as Excel writes it: workbook, relationships, shared strings and two sheets. */
function workbook(): Uint8Array {
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Notes" sheetId="1" r:id="rId1"/><sheet name="Poles &amp; towers" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="sharedStrings" Target="sharedStrings.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8('<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5"><si><t>Point</t></si><si><t>Easting</t></si><si><r><t>North</t></r><r><t>ing</t></r></si><si><t>P1</t></si><si><t>Tower &lt;A&gt;</t></si></sst>'),
    'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'),
    'xl/worksheets/sheet2.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>500120.123456789</v></c><c r="C2"><f>1650000+340.2</f><v>1650340.2</v></c></row>'
      + '<row r="4"><c r="A4" t="inlineStr"><is><t>P2</t></is></c><c r="C4"><v>1650400</v></c><c r="B4"><v>500200</v></c><c r="D4" t="s"><v>4</v></c></row>'
      + '</sheetData></worksheet>'),
  };
  return zipSync(files);
}

describe('Excel .xlsx reader', () => {
  it('reads sheet names, shared, rich and inline strings, numbers at full precision and formula results', () => {
    const sheets = parseXlsx(workbook());
    expect(sheets.map((s) => s.name)).toEqual(['Notes', 'Poles & towers']);
    expect(sheets[0]!.rows).toEqual([]);
    const r = sheets[1]!.rows;
    expect(r[0]).toEqual(['Point', 'Easting', 'Northing']);
    expect(r[1]).toEqual(['P1', '500120.123456789', '1650340.2']);
    expect(r[2]).toEqual([]);                                   // missing row 3 kept as a blank row
    expect(r[3]).toEqual(['P2', '500200', '1650400', 'Tower <A>']); // cells placed by reference, not by order
  });

  it('feeds the delimited-text importer through tab-separated text', () => {
    const tsv = sheetToTsv(parseXlsx(workbook())[1]!);
    const sn = sniffDelimited(tsv);
    expect(sn.delimiter).toBe('\t');
    expect(sn.skipLines).toBe(1);
    const r = parseDelimited(tsv, { ...sn, colX: 2, colY: 3, colZ: 0, colDesc: 1, colCode: 0, colH: 0, defaultCode: 900, unit: 'm', zMode: 'constant', zConstant: 0 });
    expect(r.points.map((p) => [p.desc, p.x, p.y, p.z])).toEqual([['P1', 500120.123456789, 1650340.2, 0], ['P2', 500200, 1650400, 0]]);
  });

  it('rejects files that are not .xlsx', () => {
    expect(() => parseXlsx(strToU8('a,b,c'))).toThrow(/xlsx/i);
  });
});

describe('coordinates pasted from Excel', () => {
  const pasted = 'Pole\tEasting\tNorthing\nA\t1,234.50\t5,678.25\nB\t1,300\t5,700.75\n';
  it('reads two-column X/Y data and thousands separators', () => {
    const sn = sniffDelimited(pasted);
    expect(sn).toEqual({ delimiter: '\t', skipLines: 1, columns: 3 });
    const r = parseDelimited(pasted, { ...sn, colX: 2, colY: 3, colZ: 0, colDesc: 1, colCode: 0, colH: 0, defaultCode: 900, unit: 'm', zMode: 'surface' });
    expect(r.points.map((p) => [p.desc, p.x, p.y])).toEqual([['A', 1234.5, 5678.25], ['B', 1300, 5700.75]]);
    expect(Number.isNaN(r.points[0]!.z)).toBe(true); // filled from the TIN by the caller
  });
  it('guesses the column roles from which columns hold numbers', () => {
    expect(guessColumns(pasted, '\t', 1)).toEqual({ colX: 2, colY: 3, colZ: 0, colDesc: 1 });
    expect(guessColumns('1,100,200,50\n2,110,210,51', ',', 0)).toEqual({ colX: 2, colY: 3, colZ: 4, colDesc: 1 });
    expect(guessColumns('100,200,50\n110,210,51', ',', 0)).toEqual({ colX: 1, colY: 2, colZ: 3, colDesc: 0 });
  });
  it('a comma delimiter keeps commas as separators; decimal commas are not guessed', () => {
    expect(cellNumber('1,234.5', ',')).toBeNaN();
    expect(cellNumber('1,234.5', '\t')).toBe(1234.5);
    expect(cellNumber('12,5', ';')).toBeNaN();
  });
  it('still requires a Z column when elevations come from a column', () => {
    const r = parseDelimited(pasted, { delimiter: '\t', skipLines: 1, colX: 2, colY: 3, colZ: 0, colDesc: 0, colCode: 0, colH: 0, defaultCode: 1, unit: 'm' });
    expect(r.points).toHaveLength(0);
    expect(r.messages[0]!.text).toMatch(/X, Y and Z/);
  });
});
