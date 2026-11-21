import { buildAlignment, stationToXY, FT, type XY } from '@tlcad/engine';
import { idBatch, type Project, type TerrainPoint } from '@tlcad/model';
import type { ImportMessage } from './registry';

/**
 * Terrain file formats.
 *
 *  - XYZ terrain file, PLS-CADD manual Appendix D.1
 *  - PFL terrain file, Appendix E.1, converted to XYZ as described in §6.9.2
 *  - Delimited text (CSV / TXT) with user-defined column mapping, Appendix D.3
 *
 * Parsers convert lengths to metres. US files use the international foot.
 */

export interface ParsedTerrain {
  points: TerrainPoint[];
  messages: ImportMessage[];
  /** Units declared by the file header, when present. */
  units?: 'US' | 'SI';
}

const msg = (level: ImportMessage['level'], text: string): ImportMessage => ({ level, text });

/** Split a record into tokens: single-quoted strings (kept with a flag) and blank-separated words. */
function tokenize(line: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  const re = /'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) out.push({ text: m[1], quoted: true });
    else out.push({ text: m[2]!, quoted: false });
  }
  return out;
}

const isHeaderLine = (line: string) => /^\s*[A-Za-z_]+\s*=/.test(line);

function readHeader(lines: string[]): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of lines) {
    if (!isHeaderLine(line)) continue;
    for (const m of line.matchAll(/([A-Za-z_]+)\s*=\s*'([^']*)'/g)) h[m[1]!.toUpperCase()] = m[2]!.trim();
  }
  return h;
}

function limitMessages(errors: string[], messages: ImportMessage[], what: string) {
  for (const e of errors.slice(0, 8)) messages.push(msg('warning', e));
  if (errors.length > 8) messages.push(msg('warning', `… and ${errors.length - 8} more ${what} skipped.`));
}

// ------------------------------------------------------------------ XYZ

export function parseXyz(text: string, src: TerrainPoint['src'] = 'imported'): ParsedTerrain {
  const lines = text.split(/\r?\n/);
  const header = readHeader(lines);
  const messages: ImportMessage[] = [];
  if (header.TYPE && !/XYZ/i.test(header.TYPE)) {
    return { points: [], messages: [msg('error', `File type is "${header.TYPE}", not an XYZ terrain file.`)] };
  }
  let units: 'US' | 'SI' | undefined;
  if (header.UNITS === 'US' || header.UNITS === 'SI') units = header.UNITS;
  else messages.push(msg('warning', 'The file has no UNITS header; coordinates were read as metres.'));
  const f = units === 'US' ? FT : 1;

  const nextId = idBatch();
  const points: TerrainPoint[] = [];
  const errors: string[] = [];
  lines.forEach((line, n) => {
    const t = line.trim();
    if (t === '' || t.startsWith(';') || isHeaderLine(line)) return;
    const tok = tokenize(t);
    // Record: 'description' x y z code h ['profile note' ['plan note']]
    const desc = tok[0]?.quoted ? tok[0].text : null;
    const nums = tok.slice(desc === null ? 0 : 1, (desc === null ? 0 : 1) + 5);
    const vals = nums.map((k) => (k.quoted ? NaN : Number(k.text)));
    if (desc === null || vals.length < 5 || vals.some((v) => !Number.isFinite(v)) || !Number.isInteger(vals[3]!)) {
      errors.push(`Line ${n + 1}: not a valid XYZ record.`);
      return;
    }
    const notes = tok.slice(6).filter((k) => k.quoted).map((k) => k.text.trim());
    points.push({
      id: nextId(), desc: desc.trim(), x: vals[0]! * f, y: vals[1]! * f, z: vals[2]! * f, code: vals[3]!, h: vals[4]! * f,
      profNote: notes[0] ?? '', planNote: notes[1] ?? '', active: true, src,
    });
  });
  limitMessages(errors, messages, 'lines');
  if (points.length === 0 && errors.length === 0) messages.push(msg('error', 'No terrain records were found in the file.'));
  return units ? { points, messages, units } : { points, messages };
}

const quote = (s: string) => `'${s.replace(/'/g, ' ')}'`;
const num = (v: number) => {
  const s = v.toFixed(4);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
};

/** Write an ASCII XYZ terrain file (Appendix D.1) in the requested units. */
export function writeXyz(project: Project, units: 'US' | 'SI', appVersion: string): string {
  const f = units === 'US' ? FT : 1;
  const out = [
    `TYPE='XYZ FILE' VERSION='4' UNITS='${units}' SOURCE='TLCAD ${appVersion}' USER='' FILENAME='${project.meta.name.replace(/'/g, ' ')}'`,
  ];
  for (const p of project.terrain.points) {
    if (!p.active) continue;
    const base = `${quote(p.desc)} ${num(p.x / f)} ${num(p.y / f)} ${num(p.z / f)} ${p.code} ${num(p.h / f)}`;
    out.push(p.profNote || p.planNote ? `${base} ${quote(p.profNote || ' ')} ${quote(p.planNote || ' ')}` : base);
  }
  return out.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ PFL

export interface PflOrigin {
  /** Plan coordinates of the point with zero station (metres). */
  x: number;
  y: number;
  /** Azimuth of the first alignment leg, degrees clockwise from north (§6.9.2). */
  azimuth: number;
}

export interface ParsedPfl extends ParsedTerrain {
  /** PIs of the alignment implied by the file, and the true station of the first one. */
  alignment: { pis: XY[]; startStation: number } | null;
}

/**
 * Read a PFL terrain file and convert it to plan coordinates (§6.9.2). The
 * alignment implied by the file runs from the smallest to the largest station,
 * turning at every centerline record that carries a non-zero line angle
 * (seconds of arc, positive clockwise).
 */
export function parsePfl(text: string, origin: PflOrigin, src: TerrainPoint['src'] = 'imported'): ParsedPfl {
  const lines = text.split(/\r?\n/);
  const header = readHeader(lines);
  const messages: ImportMessage[] = [];
  if (header.TYPE && !/PFL/i.test(header.TYPE)) {
    return { points: [], alignment: null, messages: [msg('error', `File type is "${header.TYPE}", not a PFL terrain file.`)] };
  }
  let units: 'US' | 'SI' | undefined;
  if (header.UNITS === 'US' || header.UNITS === 'SI') units = header.UNITS;
  else messages.push(msg('warning', 'The file has no UNITS header; lengths were read as metres.'));
  const f = units === 'US' ? FT : 1;

  interface Rec { desc: string; sta: number; off: number; z: number; la: number; code: number; h: number; notes: string[] }
  const recs: Rec[] = [];
  const errors: string[] = [];
  lines.forEach((line, n) => {
    const t = line.trim();
    if (t === '' || t.startsWith(';') || isHeaderLine(line)) return;
    const tok = tokenize(t);
    const desc = tok[0]?.quoted ? tok[0].text : null;
    const vals = tok.slice(1, 7).map((k) => (k.quoted ? NaN : Number(k.text)));
    if (desc === null || vals.length < 6 || vals.some((v) => !Number.isFinite(v)) || !Number.isInteger(vals[4]!)) {
      errors.push(`Line ${n + 1}: not a valid PFL record.`);
      return;
    }
    recs.push({
      desc: desc.trim(), sta: vals[0]! * f, off: vals[1]! * f, z: vals[2]! * f, la: vals[3]! / 3600, code: vals[4]!, h: vals[5]! * f,
      notes: tok.slice(7).filter((k) => k.quoted).map((k) => k.text.trim()),
    });
  });
  limitMessages(errors, messages, 'lines');
  if (recs.length === 0) {
    if (errors.length === 0) messages.push(msg('error', 'No terrain records were found in the file.'));
    return { points: [], alignment: null, messages };
  }

  const staMin = Math.min(...recs.map((r) => r.sta));
  const staMax = Math.max(...recs.map((r) => r.sta));
  if (!(staMax > staMin)) {
    messages.push(msg('error', 'All records have the same station; an alignment cannot be derived.'));
    return { points: [], alignment: null, messages };
  }
  // Turning points: one per station, strictly inside the station range.
  const turns = new Map<number, number>();
  for (const r of recs) {
    if (r.la === 0) continue;
    if (r.off !== 0) messages.push(msg('warning', `Record "${r.desc}" has a line angle but is not on the centerline; the angle was applied at its station.`));
    if (r.sta <= staMin || r.sta >= staMax) {
      messages.push(msg('warning', `Line angle at station ${r.sta.toFixed(2)} m is at an end of the profile and was ignored.`));
      continue;
    }
    if (turns.has(r.sta) && turns.get(r.sta) !== r.la) {
      messages.push(msg('warning', `Conflicting line angles at station ${r.sta.toFixed(2)} m; the first was used.`));
      continue;
    }
    turns.set(r.sta, r.la);
  }
  const rad = Math.PI / 180;
  let az = origin.azimuth;
  // Station zero is at the origin; the first leg is extended back or forward to the first station.
  let cur: XY = { x: origin.x + Math.sin(az * rad) * staMin, y: origin.y + Math.cos(az * rad) * staMin };
  let curSta = staMin;
  const pis: XY[] = [cur];
  for (const sta of [...turns.keys()].sort((a, b) => a - b)) {
    cur = { x: cur.x + Math.sin(az * rad) * (sta - curSta), y: cur.y + Math.cos(az * rad) * (sta - curSta) };
    pis.push(cur);
    curSta = sta;
    az += turns.get(sta)!;
  }
  pis.push({ x: cur.x + Math.sin(az * rad) * (staMax - curSta), y: cur.y + Math.cos(az * rad) * (staMax - curSta) });

  const g = buildAlignment(pis, staMin)!;
  const nextId = idBatch();
  const points: TerrainPoint[] = recs.map((r) => {
    const p = stationToXY(g, r.sta, r.off);
    return {
      id: nextId(), desc: r.desc, x: p.x, y: p.y, z: r.z, code: r.code, h: r.h,
      profNote: r.notes[0] ?? '', planNote: r.notes[1] ?? '', active: true, src,
    };
  });
  messages.push(msg('info', `PFL converted to plan coordinates: origin (${origin.x}, ${origin.y}) m, first-leg azimuth ${origin.azimuth}°, ${pis.length} PIs.`));
  return units ? { points, alignment: { pis, startStation: staMin }, messages, units } : { points, alignment: { pis, startStation: staMin }, messages };
}

// ------------------------------------------------------------------ Delimited text

export type Delimiter = ',' | ';' | '\t' | ' ';
export type LengthUnit = 'm' | 'ft';

export interface DelimitedOptions {
  delimiter: Delimiter;
  /** Number of leading lines to skip (titles, column headings). */
  skipLines: number;
  /** 1-based column numbers; 0 = not present. */
  colX: number;
  colY: number;
  colZ: number;
  colDesc: number;
  colCode: number;
  colH: number;
  /** Feature code given to every point when no code column is mapped or the cell is empty. */
  defaultCode: number;
  unit: LengthUnit;
}

/** Split one line of delimited text. A blank delimiter means any run of spaces or tabs. */
export function splitDelimited(line: string, d: Delimiter): string[] {
  if (d === ' ') return line.trim().split(/\s+/);
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (c === d && !inQ) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Guess the delimiter and the number of heading lines of a text file. */
export function sniffDelimited(text: string): { delimiter: Delimiter; skipLines: number; columns: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 30);
  let best: Delimiter = ' ';
  let bestScore = -1;
  for (const d of [',', ';', '\t', ' '] as Delimiter[]) {
    const counts = lines.map((l) => splitDelimited(l, d).length);
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0;
    const score = mode >= 3 ? counts.filter((c) => c === mode).length * 10 + (d === ' ' ? 0 : 1) : -1;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  // Heading lines: leading lines with fewer than three numeric cells.
  let skip = 0;
  for (const l of lines) {
    const numeric = splitDelimited(l, best).filter((c) => c !== '' && Number.isFinite(Number(c))).length;
    if (numeric >= 3) break;
    skip++;
  }
  const first = lines[skip];
  return { delimiter: best, skipLines: skip, columns: first ? splitDelimited(first, best).length : 0 };
}

export function parseDelimited(text: string, o: DelimitedOptions, src: TerrainPoint['src'] = 'imported'): ParsedTerrain {
  const messages: ImportMessage[] = [];
  if (o.colX < 1 || o.colY < 1 || o.colZ < 1) {
    return { points: [], messages: [msg('error', 'Columns for X, Y and Z must be selected.')] };
  }
  const f = o.unit === 'ft' ? FT : 1;
  const nextId = idBatch();
  const points: TerrainPoint[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, n) => {
    if (n < o.skipLines || line.trim() === '') return;
    const c = splitDelimited(line, o.delimiter);
    const cell = (col: number) => (col > 0 ? c[col - 1] ?? '' : '');
    const number = (col: number) => (cell(col) === '' ? NaN : Number(cell(col)));
    const x = number(o.colX), y = number(o.colY), z = number(o.colZ);
    const h = o.colH > 0 && cell(o.colH) !== '' ? number(o.colH) : 0;
    const code = o.colCode > 0 && cell(o.colCode) !== '' ? number(o.colCode) : o.defaultCode;
    if (![x, y, z, h].every(Number.isFinite) || !Number.isInteger(code)) {
      errors.push(`Line ${n + 1}: X, Y, Z, height or feature code is not a valid number.`);
      return;
    }
    if (h < 0) { errors.push(`Line ${n + 1}: obstacle height is negative.`); return; }
    points.push({
      id: nextId(), desc: cell(o.colDesc), x: x * f, y: y * f, z: z * f, code, h: h * f,
      profNote: '', planNote: '', active: true, src,
    });
  });
  limitMessages(errors, messages, 'lines');
  if (points.length === 0 && errors.length === 0) messages.push(msg('error', 'No data lines were found.'));
  return { points, messages };
}
