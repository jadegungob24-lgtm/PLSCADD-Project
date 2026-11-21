/**
 * Vector drawing display list and writers (SVG, PDF, DXF R12).
 *
 * Pages are in millimetres with the origin at the top-left corner and y down
 * (screen convention). The PDF and DXF writers convert to their y-up systems.
 * The PDF writer is self-contained: one standard font (Helvetica, WinAnsi
 * encoding), vector lines, fills and text — enough for plan & profile sheets
 * and tabular reports, with no external dependency.
 */

export interface Style {
  stroke?: string;
  /** Line width in mm. */
  width?: number;
  /** Dash pattern in mm. */
  dash?: number[];
  fill?: string;
  /** DXF layer name. */
  layer?: string;
}

export type Prim =
  | ({ kind: 'line'; x1: number; y1: number; x2: number; y2: number } & Style)
  | ({ kind: 'polyline'; pts: [number, number][]; closed?: boolean } & Style)
  | ({ kind: 'rect'; x: number; y: number; w: number; h: number } & Style)
  | ({ kind: 'circle'; cx: number; cy: number; r: number } & Style)
  | ({
    kind: 'text'; x: number; y: number; text: string;
    /** Character height in mm. */
    size: number;
    anchor?: 'start' | 'middle' | 'end';
    /** Baseline placement: 'base' (default), 'middle' or 'top' of the capital height. */
    valign?: 'base' | 'middle' | 'top';
    /** Rotation in degrees, counter-clockwise on the page. */
    angle?: number;
    bold?: boolean;
    color?: string;
    layer?: string;
  })
  | ({ kind: 'image'; x: number; y: number; w: number; h: number; href: string; layer?: string });

export interface Page {
  width: number;
  height: number;
  prims: Prim[];
}

// ------------------------------------------------------------------ Text metrics (Helvetica AFM widths, 1/1000 em)

const HELV: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // 32–47
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 48–63
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // 64–79
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 80–95
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // 96–111
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,      // 112–126
];
/** Width of a string in mm at a character height of `size` mm (cap height ≈ 0.72 em). */
export function textWidth(s: string, size: number): number {
  const em = size / 0.72;
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? HELV[c - 32]! : 556;
  }
  return (w / 1000) * em;
}

// ------------------------------------------------------------------ Clipping

/** Clip a polyline to a rectangle (Liang–Barsky per segment); returns the visible pieces. */
export function clipPolyline(pts: [number, number][], x0: number, y0: number, x1: number, y1: number): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  const flush = () => { if (cur.length > 1) out.push(cur); cur = []; };
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1, ok = true;
    const test = (p: number, q: number) => {
      if (p === 0) { if (q < 0) ok = false; return; }
      const r = q / p;
      if (p < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else { if (r < t0) ok = false; else if (r < t1) t1 = r; }
    };
    test(-dx, ax - x0); test(dx, x1 - ax); test(-dy, ay - y0); test(dy, y1 - ay);
    if (!ok) { flush(); continue; }
    const s: [number, number] = [ax + t0 * dx, ay + t0 * dy], e: [number, number] = [ax + t1 * dx, ay + t1 * dy];
    const last = cur[cur.length - 1];
    if (!last || Math.abs(last[0] - s[0]) > 1e-9 || Math.abs(last[1] - s[1]) > 1e-9) { flush(); cur.push(s); }
    cur.push(e);
    if (t1 < 1) flush();
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ SVG

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => Number(v.toFixed(3));

function svgStyle(p: Style): string {
  return `stroke="${p.stroke ?? 'none'}" stroke-width="${n(p.width ?? 0.25)}" fill="${p.fill ?? 'none'}"${p.dash?.length ? ` stroke-dasharray="${p.dash.map(n).join(' ')}"` : ''}`;
}

export function pageToSvg(page: Page, opts: { pixelWidth?: number } = {}): string {
  const body = page.prims.map((p) => {
    switch (p.kind) {
      case 'line': return `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" ${svgStyle(p)} stroke-linecap="round"/>`;
      case 'polyline': return `<${p.closed ? 'polygon' : 'polyline'} points="${p.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" ${svgStyle(p)} stroke-linejoin="round"/>`;
      case 'rect': return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" ${svgStyle(p)}/>`;
      case 'circle': return `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.r)}" ${svgStyle(p)}/>`;
      case 'image': return `<image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" href="${esc(p.href)}" preserveAspectRatio="none"/>`;
      case 'text': {
        const em = p.size / 0.72;
        const dy = p.valign === 'top' ? p.size : p.valign === 'middle' ? p.size / 2 : 0;
        const rot = p.angle ? ` transform="rotate(${n(-p.angle)} ${n(p.x)} ${n(p.y)})"` : '';
        return `<text x="${n(p.x)}" y="${n(p.y + dy)}" font-family="Helvetica, Arial, sans-serif" font-size="${n(em)}" text-anchor="${p.anchor ?? 'start'}"${p.bold ? ' font-weight="bold"' : ''} fill="${p.color ?? '#000'}"${rot} xml:space="preserve">${esc(p.text)}</text>`;
      }
    }
  }).join('\n');
  const w = opts.pixelWidth ? ` width="${opts.pixelWidth}"` : ` width="${n(page.width)}mm" height="${n(page.height)}mm"`;
  return `<svg xmlns="http://www.w3.org/2000/svg"${w} viewBox="0 0 ${n(page.width)} ${n(page.height)}">\n<rect width="100%" height="100%" fill="#fff"/>\n${body}\n</svg>`;
}

// ------------------------------------------------------------------ PDF

const MM = 72 / 25.4;
const rgb = (c: string | undefined): [number, number, number] | null => {
  if (!c || c === 'none') return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (m) { const v = parseInt(m[1]!, 16); return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }
  const s = /^#?([0-9a-f]{3})$/i.exec(c.trim());
  if (s) { const [r, g, b] = s[1]!.split('').map((h) => parseInt(h + h, 16) / 255); return [r!, g!, b!]; }
  return [0, 0, 0];
};
/** WinAnsi encoding of a string as a PDF literal (non-encodable characters become '?'). */
const WIN: Record<string, number> = { '€': 128, '–': 150, '—': 151, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '…': 133 };
function pdfString(s: string): string {
  let out = '(';
  for (const ch of s) {
    let c = ch.charCodeAt(0);
    if (WIN[ch] !== undefined) c = WIN[ch]!;
    else if (c > 255) c = 63;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += String.fromCharCode(c);
  }
  return out + ')';
}

function pdfContent(page: Page): string {
  const H = page.height;
  const X = (x: number) => (x * MM).toFixed(3), Y = (y: number) => ((H - y) * MM).toFixed(3);
  const ops: string[] = ['1 J 1 j'];
  const stroke = (p: Style) => {
    const s = rgb(p.stroke), f = rgb(p.fill);
    if (s) ops.push(`${s.map((v) => v.toFixed(3)).join(' ')} RG ${((p.width ?? 0.25) * MM).toFixed(3)} w [${(p.dash ?? []).map((d) => (d * MM).toFixed(2)).join(' ')}] 0 d`);
    if (f) ops.push(`${f.map((v) => v.toFixed(3)).join(' ')} rg`);
    return s && f ? 'B' : f ? 'f' : s ? 'S' : 'n';
  };
  for (const p of page.prims) {
    switch (p.kind) {
      case 'line': { const op = stroke(p); ops.push(`${X(p.x1)} ${Y(p.y1)} m ${X(p.x2)} ${Y(p.y2)} l ${op}`); break; }
      case 'polyline': {
        if (p.pts.length < 2) break;
        const op = stroke(p);
        ops.push(p.pts.map(([x, y], i) => `${X(x)} ${Y(y)} ${i ? 'l' : 'm'}`).join(' ') + (p.closed ? ' h ' : ' ') + (p.closed ? op : op === 'B' || op === 'f' ? 'S' : op));
        break;
      }
      case 'rect': { const op = stroke(p); ops.push(`${X(p.x)} ${Y(p.y + p.h)} ${(p.w * MM).toFixed(3)} ${(p.h * MM).toFixed(3)} re ${op}`); break; }
      case 'circle': {
        const op = stroke(p), k = 0.5523 * p.r;
        const c = (x: number, y: number) => `${X(x)} ${Y(y)}`;
        ops.push(`${c(p.cx + p.r, p.cy)} m ${c(p.cx + p.r, p.cy - k)} ${c(p.cx + k, p.cy - p.r)} ${c(p.cx, p.cy - p.r)} c ${c(p.cx - k, p.cy - p.r)} ${c(p.cx - p.r, p.cy - k)} ${c(p.cx - p.r, p.cy)} c ${c(p.cx - p.r, p.cy + k)} ${c(p.cx - k, p.cy + p.r)} ${c(p.cx, p.cy + p.r)} c ${c(p.cx + k, p.cy + p.r)} ${c(p.cx + p.r, p.cy + k)} ${c(p.cx + p.r, p.cy)} c h ${op}`);
        break;
      }
      case 'text': {
        const col = rgb(p.color ?? '#000')!;
        const em = (p.size / 0.72) * MM;
        const w = textWidth(p.text, p.size);
        const dx = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0;
        const dy = p.valign === 'top' ? p.size : p.valign === 'middle' ? p.size / 2 : 0;
        const a = ((p.angle ?? 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
        // Offset along the rotated text axes (page y down: a positive dy moves down the page).
        const ox = p.x + dx * ca + dy * sa, oy = p.y - dx * sa + dy * ca;
        ops.push(`BT /${p.bold ? 'F2' : 'F1'} ${em.toFixed(3)} Tf ${col.map((v) => v.toFixed(3)).join(' ')} rg ${ca.toFixed(5)} ${sa.toFixed(5)} ${(-sa).toFixed(5)} ${ca.toFixed(5)} ${X(ox)} ${Y(oy)} Tm ${pdfString(p.text)} Tj ET`);
        break;
      }
      case 'image': break; // raster images are not embedded in the PDF writer
    }
  }
  return ops.join('\n');
}

/** Multi-page PDF (PDF 1.4) as bytes. */
export function pagesToPdf(pages: Page[], info: { title?: string; author?: string } = {}): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  const enc = new TextEncoder();
  for (const pg of pages) {
    const content = pdfContent(pg);
    const len = latin1Length(content);
    const c = add(`<< /Length ${len} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${(pg.width * MM).toFixed(2)} ${(pg.height * MM).toFixed(2)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const infoObj = add(`<< /Producer (TLCAD) ${info.title ? `/Title ${pdfString(info.title)}` : ''} ${info.author ? `/Author ${pdfString(info.author)}` : ''} >>`);
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(latin1Length(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = latin1Length(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  void enc;
  return latin1Bytes(out);
}
// The PDF body is built from characters 0–255 only (strings are escaped), so each char is one byte.
const latin1Length = (s: string) => s.length;
function latin1Bytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
}

// ------------------------------------------------------------------ DXF (R12, ASCII)

const ACI: [number, [number, number, number]][] = [
  [1, [1, 0, 0]], [2, [1, 1, 0]], [3, [0, 1, 0]], [4, [0, 1, 1]], [5, [0, 0, 1]], [6, [1, 0, 1]], [7, [0, 0, 0]], [8, [0.5, 0.5, 0.5]], [9, [0.75, 0.75, 0.75]],
  [30, [1, 0.5, 0]], [140, [0, 0.5, 1]], [94, [0, 0.5, 0]],
];
function aci(c: string | undefined): number {
  const v = rgb(c);
  if (!v) return 7;
  let best = 7, bd = Infinity;
  for (const [i, k] of ACI) { const d = (k[0] - v[0]) ** 2 + (k[1] - v[1]) ** 2 + (k[2] - v[2]) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

/**
 * DXF R12 of one or more pages. Pages are placed side by side (x offset =
 * page width + gap) in one drawing; coordinates are in millimetres, y up.
 */
export function pagesToDxf(pages: Page[], gap = 20): string {
  const L: string[] = [];
  const g = (code: number, v: string | number) => { L.push(String(code), typeof v === 'number' ? Number(v.toFixed(4)).toString() : v); };
  const layers = new Set<string>(['0']);
  for (const p of pages) for (const q of p.prims) if (q.layer) layers.add(q.layer.replace(/[^A-Za-z0-9_-]/g, '_'));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, 'Dashed'); g(72, 65); g(73, 2); g(40, 3); g(49, 2); g(49, -1);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.size);
  for (const l of layers) { g(0, 'LAYER'); g(2, l); g(70, 0); g(62, 7); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1); g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, ''); g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  pages.forEach((pg, k) => {
    const ox = k * (pg.width + gap);
    const X = (x: number) => ox + x, Y = (y: number) => pg.height - y;
    const head = (type: string, p: { layer?: string; stroke?: string; color?: string; dash?: number[] }) => {
      g(0, type); g(8, (p.layer ?? '0').replace(/[^A-Za-z0-9_-]/g, '_'));
      if (p.dash?.length) g(6, 'DASHED');
      g(62, aci(p.stroke ?? p.color));
    };
    const poly = (pts: [number, number][], closed: boolean, p: Style) => {
      head('POLYLINE', p); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
      for (const [x, y] of pts) { g(0, 'VERTEX'); g(8, (p.layer ?? '0').replace(/[^A-Za-z0-9_-]/g, '_')); g(10, X(x)); g(20, Y(y)); g(30, 0); }
      g(0, 'SEQEND');
    };
    // Sheet border of each page so that pages stay apart in the drawing.
    poly([[0, 0], [pg.width, 0], [pg.width, pg.height], [0, pg.height]], true, { stroke: '#888888', layer: 'PAGE' });
    for (const p of pg.prims) {
      switch (p.kind) {
        case 'line': head('LINE', p); g(10, X(p.x1)); g(20, Y(p.y1)); g(30, 0); g(11, X(p.x2)); g(21, Y(p.y2)); g(31, 0); break;
        case 'polyline': if (p.pts.length > 1) poly(p.pts, !!p.closed, p); break;
        case 'rect': poly([[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]], true, p); break;
        case 'circle': head('CIRCLE', p); g(10, X(p.cx)); g(20, Y(p.cy)); g(30, 0); g(40, p.r); break;
        case 'text': {
          if (!p.text.trim()) break;
          head('TEXT', p);
          const h = p.anchor === 'middle' ? 1 : p.anchor === 'end' ? 2 : 0;
          const v = p.valign === 'top' ? 3 : p.valign === 'middle' ? 2 : 0;
          g(10, X(p.x)); g(20, Y(p.y)); g(30, 0); g(40, p.size); g(1, p.text.replace(/[\r\n]/g, ' ').replace(/°/g, '%%d').replace(/±/g, '%%p').replace(/Ø/g, '%%c')); if (p.angle) g(50, p.angle);
          if (h || v) { g(72, h); g(11, X(p.x)); g(21, Y(p.y)); g(31, 0); g(73, v); }
          break;
        }
        case 'image': break; // DXF R12 has no raster entities
      }
    }
  });
  g(0, 'ENDSEC'); g(0, 'EOF');
  return L.join('\r\n') + '\r\n';
}
