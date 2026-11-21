import { pagesToPdf, textWidth, type Page, type Prim } from './drawing';

/**
 * Report model and writers (manual §12): a report is a title, header lines
 * and sections of tables. Writers: CSV, HTML, Excel 2003 XML (SpreadsheetML,
 * opened by Excel and LibreOffice) and a paginated PDF.
 */

export type Cell = string | number | null;

export interface ReportTable {
  title: string;
  columns: string[];
  /** Columns holding numbers are right-aligned; numbers are written with `decimals` (per column). */
  rows: Cell[][];
  decimals?: (number | null)[];
  /** Row indices drawn in red (violations, failed checks). */
  flagged?: number[];
  notes?: string[];
}

export interface Report {
  title: string;
  header: string[];
  tables: ReportTable[];
}

const fmt = (c: Cell, d: number | null | undefined) => (c === null ? '' : typeof c === 'number' ? (Number.isFinite(c) ? (d === null || d === undefined ? String(c) : c.toFixed(d)) : '—') : c);

export function reportToCsv(r: Report): string {
  const q = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const out: string[] = [q(r.title), ...r.header.map(q), ''];
  for (const t of r.tables) {
    out.push(q(t.title), t.columns.map(q).join(','));
    for (const row of t.rows) out.push(row.map((c, i) => q(fmt(c, t.decimals?.[i]))).join(','));
    for (const n of t.notes ?? []) out.push(q(n));
    out.push('');
  }
  return out.join('\r\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function reportToHtml(r: Report): string {
  const tables = r.tables.map((t) => {
    const head = `<tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
    const rows = t.rows.map((row, k) => `<tr${t.flagged?.includes(k) ? ' class="flag"' : ''}>${row.map((c, i) => `<td${typeof c === 'number' ? ' class="n"' : ''}>${esc(fmt(c, t.decimals?.[i]))}</td>`).join('')}</tr>`).join('\n');
    const notes = (t.notes ?? []).map((n) => `<p class="note">${esc(n)}</p>`).join('');
    return `<h2>${esc(t.title)}</h2><table><thead>${head}</thead><tbody>${rows}</tbody></table>${notes}`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
body{font:12px Helvetica,Arial,sans-serif;margin:16px;color:#111}h1{font-size:18px}h2{font-size:14px;margin:18px 0 6px}
table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:2px 6px}th{background:#eee;text-align:left}td.n{text-align:right;font-family:Consolas,monospace}
tr.flag td{color:#c00;font-weight:bold}.note{color:#555;margin:4px 0}.hdr{color:#333;margin:2px 0}
</style></head><body><h1>${esc(r.title)}</h1>${r.header.map((h) => `<div class="hdr">${esc(h)}</div>`).join('')}${tables}</body></html>`;
}

/** Excel 2003 XML spreadsheet, one worksheet per table. */
export function reportToSpreadsheetXml(r: Report): string {
  const sheetName = (s: string, i: number) => `${i + 1} ${s}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
  const cell = (c: Cell, style?: string) => (c === null ? '<Cell/>' : typeof c === 'number' && Number.isFinite(c)
    ? `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="Number">${c}</Data></Cell>`
    : `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${esc(fmt(c, null))}</Data></Cell>`);
  const sheets = r.tables.map((t, i) => `<Worksheet ss:Name="${esc(sheetName(t.title, i))}"><Table>
<Row>${cell(t.title, 'b')}</Row>${r.header.map((h) => `<Row>${cell(h)}</Row>`).join('')}<Row/>
<Row>${t.columns.map((c) => cell(c, 'h')).join('')}</Row>
${t.rows.map((row, k) => `<Row>${row.map((c) => cell(c, t.flagged?.includes(k) ? 'f' : undefined)).join('')}</Row>`).join('\n')}
${(t.notes ?? []).map((n) => `<Row>${cell(n)}</Row>`).join('')}
</Table></Worksheet>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="b"><Font ss:Bold="1" ss:Size="12"/></Style><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#EEEEEE" ss:Pattern="Solid"/></Style><Style ss:ID="f"><Font ss:Color="#CC0000" ss:Bold="1"/></Style></Styles>
${sheets}
</Workbook>`;
}

/** Paginated report pages (A4 landscape by default) for the PDF writer. */
export function reportToPages(r: Report, page = { width: 297, height: 210 }): Page[] {
  const M = 12, size = 2.4, rowH = 4.6;
  const pages: Page[] = [];
  let cur: Prim[] = [];
  let y = 0;
  const newPage = () => {
    cur = [];
    pages.push({ width: page.width, height: page.height, prims: cur });
    cur.push({ kind: 'text', x: M, y: M, text: r.title, size: 3.2, bold: true, valign: 'top' });
    cur.push({ kind: 'text', x: page.width - M, y: M, text: `Page ${pages.length}`, size: 2.4, anchor: 'end', valign: 'top' });
    y = M + 7;
  };
  newPage();
  for (const h of r.header) { cur.push({ kind: 'text', x: M, y, text: h, size: 2.4, valign: 'top' }); y += 4.2; }
  y += 2;
  for (const t of r.tables) {
    const cols = t.columns.length;
    const cellText = (row: Cell[], i: number) => fmt(row[i] ?? null, t.decimals?.[i]);
    // Column widths from content, scaled to fit the page.
    let widths = t.columns.map((c, i) => Math.max(textWidth(c, size), ...t.rows.slice(0, 500).map((row) => textWidth(cellText(row, i), size))) + 3);
    const total = widths.reduce((a, b) => a + b, 0);
    const avail = page.width - 2 * M;
    const scale = total > avail ? avail / total : 1;
    const sz = size * Math.max(0.6, scale);
    widths = widths.map((w) => w * scale);
    const header = () => {
      cur.push({ kind: 'rect', x: M, y, w: widths.reduce((a, b) => a + b, 0), h: rowH, fill: '#e8e8e8', stroke: '#999999', width: 0.15 });
      let x = M;
      t.columns.forEach((c, i) => { cur.push({ kind: 'text', x: x + 1, y: y + rowH / 2, text: c, size: sz, valign: 'middle', bold: true }); x += widths[i]!; });
      y += rowH;
    };
    if (y + 14 > page.height - M) newPage();
    cur.push({ kind: 'text', x: M, y, text: t.title, size: 2.9, bold: true, valign: 'top' });
    y += 5.5;
    header();
    t.rows.forEach((row, k) => {
      if (y + rowH > page.height - M) { newPage(); header(); }
      let x = M;
      const flag = t.flagged?.includes(k);
      for (let i = 0; i < cols; i++) {
        const s = cellText(row, i);
        const isNum = typeof row[i] === 'number';
        cur.push({ kind: 'text', x: isNum ? x + widths[i]! - 1 : x + 1, y: y + rowH / 2, text: s, size: sz, valign: 'middle', anchor: isNum ? 'end' : 'start', ...(flag ? { color: '#cc0000', bold: true } : {}) });
        x += widths[i]!;
      }
      cur.push({ kind: 'line', x1: M, y1: y + rowH, x2: M + widths.reduce((a, b) => a + b, 0), y2: y + rowH, stroke: '#cccccc', width: 0.1 });
      y += rowH;
    });
    for (const n of t.notes ?? []) {
      if (y + 5 > page.height - M) newPage();
      cur.push({ kind: 'text', x: M, y: y + 1, text: n, size: 2.2, valign: 'top', color: '#444444' });
      y += 4;
    }
    y += 5;
  }
  return pages;
}

export const reportToPdf = (r: Report) => pagesToPdf(reportToPages(r), { title: r.title });
