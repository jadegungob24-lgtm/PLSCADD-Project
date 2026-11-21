import { unzipSync, strFromU8 } from 'fflate';

/**
 * Minimal Excel workbook (.xlsx, Office Open XML) reader for importing
 * coordinate tables. Reads every worksheet's cell values as text: shared
 * strings, inline strings, numbers (as stored, full precision) and booleans.
 * Formulas give their cached result. Formatting, dates as dates, merged cells
 * and the legacy binary .xls format are not supported.
 */

export interface XlsxSheet {
  name: string;
  /** Rows of cell text, in sheet order; empty cells are ''. */
  rows: string[][];
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/** Text of all <t> elements inside a fragment (plain or rich text). */
const textOf = (frag: string) => [...frag.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => decode(m[1]!)).join('');

/** Column index (0-based) from a cell reference such as "AB12". */
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

export function parseXlsx(bytes: Uint8Array): XlsxSheet[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('Not an Excel .xlsx workbook (the file cannot be unzipped). Save it as .xlsx or CSV.'); }
  const get = (p: string) => (files[p] ? strFromU8(files[p]!) : null);
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('Not an Excel .xlsx workbook (xl/workbook.xml is missing).');
  const shared = [...(get('xl/sharedStrings.xml') ?? '').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1]!));
  // Sheet names and their part paths through the workbook relationships.
  const rels = new Map<string, string>();
  for (const m of (get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1]!)?.[1], target = /\bTarget="([^"]+)"/.exec(m[1]!)?.[1];
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  const sheets: XlsxSheet[] = [];
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const name = decode(/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? `Sheet${sheets.length + 1}`);
    const rid = /\br:id="([^"]+)"/.exec(m[1]!)?.[1] ?? /\bid="([^"]+)"/.exec(m[1]!)?.[1];
    const path = (rid && rels.get(rid)) ?? `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = get(path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
      const rowNo = Number(/\br="(\d+)"/.exec(r[1]!)?.[1] ?? rows.length + 1);
      const cells: string[] = [];
      let next = 0;
      for (const c of r[2]!.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const attrs = c[1]!, body = c[2] ?? '';
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const col = ref ? colIndex(ref) : next;
        next = col + 1;
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
        const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1];
        let text = '';
        if (type === 's') text = v !== undefined ? shared[Number(v)] ?? '' : '';
        else if (type === 'inlineStr') text = textOf(body);
        else if (type === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else text = v !== undefined ? decode(v) : '';
        while (cells.length < col) cells.push('');
        cells[col] = text;
      }
      while (rows.length < rowNo - 1) rows.push([]);
      rows[rowNo - 1] = cells;
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error('The workbook has no worksheets.');
  return sheets;
}

/** A sheet as tab-separated text (tabs and line breaks inside cells become spaces). */
export const sheetToTsv = (s: XlsxSheet) => s.rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
