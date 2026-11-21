import { fromArrayBuffer } from 'geotiff';
import { FT, projectPoint, tinElevation, type AlignmentGeometry, type Tin, type Transformer } from '@tlcad/engine';
import { idBatch, type BreakLine, type Project, type TerrainPoint } from '@tlcad/model';
import type { ImportMessage } from './registry';

/**
 * More terrain formats:
 *  - BRK break line file, PLS-CADD manual Appendix D.6
 *  - PFL terrain export, Appendix E.1 / §6.9.1
 *  - DEM grids: ESRI ASCII grid and GeoTIFF (public formats, not in the manual)
 *  - LAS point clouds, uncompressed (ASPRS LAS 1.0–1.4; manual App. D.7 describes the import behaviour)
 */

const msg = (level: ImportMessage['level'], text: string): ImportMessage => ({ level, text });
const num = (v: number, d = 4) => {
  const s = v.toFixed(d);
  return s.replace(/\.?0+$/, '') || '0';
};
const quote = (s: string) => `'${s.replace(/'/g, ' ')}'`;

// ------------------------------------------------------------------ BRK

export function parseBrk(text: string): { lines: BreakLine[]; messages: ImportMessage[] } {
  const messages: ImportMessage[] = [];
  const rows = text.split(/\r?\n/);
  const header: Record<string, string> = {};
  for (const l of rows) for (const m of l.matchAll(/([A-Za-z_]+)\s*=\s*'([^']*)'/g)) header[m[1]!.toUpperCase()] = m[2]!.trim();
  if (header.TYPE && !/BRK/i.test(header.TYPE)) return { lines: [], messages: [msg('error', `File type is "${header.TYPE}", not a BRK break line file.`)] };
  const us = header.UNITS === 'US';
  if (header.UNITS !== 'US' && header.UNITS !== 'SI') messages.push(msg('warning', 'The file has no UNITS header; coordinates were read as metres.'));
  const f = us ? FT : 1;
  const nextId = idBatch();
  const lines: BreakLine[] = [];
  let bad = 0;
  for (const l of rows) {
    const t = l.split(';')[0]!.trim();
    if (t === '' || /^[A-Za-z_]+\s*=/.test(t)) continue;
    const v = t.split(/\s+/).map(Number);
    if (v.length < 6 || v.slice(0, 6).some((k) => !Number.isFinite(k))) { bad++; continue; }
    lines.push({ id: nextId(), ax: v[0]! * f, ay: v[1]! * f, az: v[2]! * f, bx: v[3]! * f, by: v[4]! * f, bz: v[5]! * f, src: 'imported' });
  }
  if (bad) messages.push(msg('warning', `${bad} line(s) were not valid break line records and were skipped.`));
  if (lines.length === 0 && !bad) messages.push(msg('error', 'No break line records were found in the file.'));
  return { lines, messages };
}

export function writeBrk(project: Project, units: 'US' | 'SI', appVersion: string): string {
  const f = units === 'US' ? FT : 1;
  const out = [`TYPE='BRK FILE' VERSION='1' UNITS='${units}' SOURCE='TLCAD ${appVersion}'`];
  for (const b of project.terrain.breakLines) {
    out.push([b.ax, b.ay, b.az, b.bx, b.by, b.bz].map((v) => num(v / f)).join(' '));
  }
  return out.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ PFL export

/**
 * Write a PFL terrain file for one alignment (the PFL model is limited to a
 * single alignment, §6.3). Points that cannot be projected on the alignment
 * are lost, as the manual states (§6.3.2). A line angle can only be carried by
 * a record at the PI: an existing ground point at the PI is used, otherwise a
 * record is added with the TIN elevation; without either the export is refused
 * rather than writing a record with an invented elevation.
 */
export function writePfl(
  project: Project,
  g: AlignmentGeometry,
  tin: Tin | null,
  units: 'US' | 'SI',
  appVersion: string,
): { text: string | null; messages: ImportMessage[] } {
  const messages: ImportMessage[] = [];
  const f = units === 'US' ? FT : 1;
  const codes = new Map(project.terrain.featureCodes.map((c) => [c.code, c]));
  interface Rec { sta: number; off: number; z: number; la: number; code: number; h: number; desc: string; pn: string; ln: string }
  const recs: Rec[] = [];
  let lost = 0;
  for (const p of project.terrain.points) {
    if (!p.active) continue;
    const so = projectPoint(g, p.x, p.y);
    if (!so) { lost++; continue; }
    recs.push({ sta: so.station, off: so.offset, z: p.z, la: 0, code: p.code, h: p.h, desc: p.desc, pn: p.profNote, ln: p.planNote });
  }
  const groundCode = project.terrain.featureCodes.find((c) => c.onGround)?.code;
  const tol = 1e-3;
  for (let i = 1; i < g.pis.length - 1; i++) {
    const sta = g.stations[i]!;
    const seconds = g.lineAngles[i]! * 3600;
    const at = recs.find((r) => Math.abs(r.sta - sta) < tol && Math.abs(r.off) < tol && r.h === 0 && (codes.get(r.code)?.onGround ?? true));
    if (at) { at.la = seconds; continue; }
    const z = tin ? tinElevation(tin, g.pis[i]!.x, g.pis[i]!.y) : null;
    if (z === null || groundCode === undefined) {
      messages.push(msg('error', `P.I. ${i + 1} has no ground survey point and its elevation cannot be taken from a TIN, so the line angle there cannot be written. ` +
        'Add a ground point at the P.I. or enable the TIN, then export again.'));
      return { text: null, messages };
    }
    recs.push({ sta, off: 0, z, la: seconds, code: groundCode, h: 0, desc: `PI ${i + 1}`, pn: '', ln: '' });
    messages.push(msg('info', `P.I. ${i + 1}: a centerline record with the TIN elevation was added to carry the line angle.`));
  }
  recs.sort((a, b) => a.sta - b.sta);
  if (lost) messages.push(msg('warning', `${lost} point(s) cannot be projected on the alignment and were not written (PLS-CADD manual §6.3.2).`));
  const out = [`TYPE='PFL FILE' VERSION='4' UNITS='${units}' SOURCE='TLCAD ${appVersion}' USER='' FILENAME='${project.meta.name.replace(/'/g, ' ')}'`];
  for (const r of recs) {
    const base = `${quote(r.desc)} ${num(r.sta / f)} ${num(r.off / f)} ${num(r.z / f)} ${num(r.la, 3)} ${r.code} ${num(r.h / f)}`;
    out.push(r.pn || r.ln ? `${base} ${quote(r.pn || ' ')} ${quote(r.ln || ' ')}` : base);
  }
  return { text: out.join('\r\n') + '\r\n', messages };
}

// ------------------------------------------------------------------ DEM grids

export interface DemGrid {
  ncols: number;
  nrows: number;
  /** Coordinates of the centre of the top-left cell, in the units and CRS of the file. */
  x0: number;
  y0: number;
  /** Cell size; rows run toward decreasing Y. */
  dx: number;
  dy: number;
  data: ArrayLike<number>;
  nodata: number | null;
}

/** ESRI ASCII grid (.asc). */
export function parseAsciiGrid(text: string): { grid: DemGrid | null; messages: ImportMessage[] } {
  const tokens = text.split(/\s+/).filter((t) => t !== '');
  const head: Record<string, number> = {};
  let i = 0;
  while (i < tokens.length - 1 && /^[A-Za-z_]+$/.test(tokens[i]!)) {
    head[tokens[i]!.toLowerCase()] = Number(tokens[i + 1]);
    i += 2;
  }
  const ncols = head.ncols, nrows = head.nrows, cell = head.cellsize;
  const fail = (t: string) => ({ grid: null, messages: [msg('error', t)] });
  if (!Number.isInteger(ncols) || !Number.isInteger(nrows) || !(ncols! > 0) || !(nrows! > 0) || !(cell! > 0)) {
    return fail('Not an ESRI ASCII grid: ncols, nrows or cellsize is missing from the header.');
  }
  const centre = head.xllcenter !== undefined && head.yllcenter !== undefined;
  const xll = centre ? head.xllcenter! : head.xllcorner;
  const yll = centre ? head.yllcenter! : head.yllcorner;
  if (!Number.isFinite(xll) || !Number.isFinite(yll)) return fail('The grid header has no xllcorner/yllcorner (or xllcenter/yllcenter).');
  const n = ncols! * nrows!;
  if (tokens.length - i < n) return fail(`The grid should hold ${n} values but only ${tokens.length - i} were found.`);
  const data = new Float64Array(n);
  for (let k = 0; k < n; k++) data[k] = Number(tokens[i + k]);
  const half = centre ? 0 : cell! / 2;
  return {
    grid: {
      ncols: ncols!, nrows: nrows!, x0: xll! + half, y0: yll! + half + (nrows! - 1) * cell!, dx: cell!, dy: cell!, data,
      nodata: head.nodata_value !== undefined && Number.isFinite(head.nodata_value) ? head.nodata_value : null,
    },
    messages: [],
  };
}

/** GeoTIFF elevation raster (first band). Rotated or sheared rasters are not supported. */
export async function parseGeoTiff(buffer: ArrayBuffer): Promise<{ grid: DemGrid | null; messages: ImportMessage[] }> {
  try {
    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const [ox, oy] = image.getOrigin() as number[];
    const [rx, ry] = image.getResolution() as number[];
    if (!(rx! > 0) || !(ry! < 0)) return { grid: null, messages: [msg('error', 'The GeoTIFF is not a north-up raster; rotated rasters are not supported.')] };
    const rasters = await image.readRasters({ samples: [0] });
    const nd = image.getGDALNoData();
    return {
      grid: {
        ncols: image.getWidth(), nrows: image.getHeight(), x0: ox! + rx! / 2, y0: oy! + ry! / 2, dx: rx!, dy: -ry!,
        data: rasters[0] as ArrayLike<number>, nodata: nd === null || Number.isNaN(nd) ? null : nd,
      },
      messages: [],
    };
  } catch (e) {
    return { grid: null, messages: [msg('error', `The file could not be read as a GeoTIFF: ${e instanceof Error ? e.message : String(e)}`)] };
  }
}

export interface DemOptions {
  /** Take every n-th row and column. */
  step: number;
  code: number;
  /** Metres per horizontal unit of the file (ignored when a transform is given). */
  xyFactor: number;
  /** Metres per elevation unit of the file. */
  zFactor: number;
  /** Transformation from the file CRS to the project CRS (metres), when they differ. */
  transform?: Transformer;
  /** Keep only cells inside this window of project coordinates. */
  window?: { minX: number; minY: number; maxX: number; maxY: number };
  maxPoints: number;
}

/** Number of points a DEM import would create with the given step (before no-data and window filtering). */
export const demPointCount = (g: DemGrid, step: number) => Math.ceil(g.ncols / step) * Math.ceil(g.nrows / step);

export function demToPoints(g: DemGrid, o: DemOptions): { points: TerrainPoint[]; messages: ImportMessage[] } {
  const messages: ImportMessage[] = [];
  if (!Number.isInteger(o.step) || o.step < 1) return { points: [], messages: [msg('error', 'The sampling step must be a whole number of at least 1.')] };
  const nextId = idBatch();
  const points: TerrainPoint[] = [];
  let skippedNoData = 0, failed = 0;
  for (let r = 0; r < g.nrows; r += o.step) {
    for (let c = 0; c < g.ncols; c += o.step) {
      const z = g.data[r * g.ncols + c]!;
      if (!Number.isFinite(z) || (g.nodata !== null && z === g.nodata)) { skippedNoData++; continue; }
      let x = g.x0 + c * g.dx, y = g.y0 - r * g.dy;
      if (o.transform) {
        try { [x, y] = o.transform.forward(x, y); } catch { failed++; continue; }
      } else { x *= o.xyFactor; y *= o.xyFactor; }
      if (o.window && (x < o.window.minX || x > o.window.maxX || y < o.window.minY || y > o.window.maxY)) continue;
      if (points.length >= o.maxPoints) {
        return { points: [], messages: [msg('error', `The import would create more than ${o.maxPoints} points. Increase the sampling step or limit the area.`)] };
      }
      points.push({ id: nextId(), desc: '', x, y, z: z * o.zFactor, code: o.code, h: 0, profNote: '', planNote: '', active: true, src: 'imported' });
    }
  }
  if (skippedNoData) messages.push(msg('info', `${skippedNoData} no-data cell(s) were skipped.`));
  if (failed) messages.push(msg('warning', `${failed} cell(s) could not be transformed to the project coordinate system and were skipped.`));
  if (points.length === 0) messages.push(msg('error', 'No DEM cells fell inside the selected area.'));
  return { points, messages };
}

// ------------------------------------------------------------------ LAS

export interface LasInfo {
  version: string;
  pointFormat: number;
  pointCount: number;
  compressed: boolean;
  scale: [number, number, number];
  offset: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  /** Number of points per classification code. */
  classes: Map<number, number>;
}

interface LasLayout { info: LasInfo; dataOffset: number; recordLength: number; classByte: number; classMask: number }

function lasLayout(buf: ArrayBuffer): LasLayout | string {
  if (buf.byteLength < 227) return 'The file is too short to be a LAS file.';
  const dv = new DataView(buf);
  const sig = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (sig !== 'LASF') return 'Not a LAS file (missing LASF signature).';
  const major = dv.getUint8(24), minor = dv.getUint8(25);
  const dataOffset = dv.getUint32(96, true);
  const fmtByte = dv.getUint8(104);
  const pointFormat = fmtByte & 0x3f;
  const compressed = (fmtByte & 0x80) !== 0;
  const recordLength = dv.getUint16(105, true);
  let pointCount = dv.getUint32(107, true);
  if (major === 1 && minor >= 4 && buf.byteLength >= 255) {
    const big = Number(dv.getBigUint64(247, true));
    if (big > 0) pointCount = big;
  }
  const d3 = (o: number): [number, number, number] => [dv.getFloat64(o, true), dv.getFloat64(o + 8, true), dv.getFloat64(o + 16, true)];
  if (pointFormat > 10) return `LAS point format ${pointFormat} is not supported.`;
  if (recordLength < (pointFormat >= 6 ? 30 : 20)) return 'The LAS point record length is invalid.';
  const info: LasInfo = {
    version: `${major}.${minor}`, pointFormat, pointCount, compressed,
    scale: d3(131), offset: d3(155),
    // Header order is max X, min X, max Y, min Y, max Z, min Z.
    max: [dv.getFloat64(179, true), dv.getFloat64(195, true), dv.getFloat64(211, true)],
    min: [dv.getFloat64(187, true), dv.getFloat64(203, true), dv.getFloat64(219, true)],
    classes: new Map(),
  };
  return { info, dataOffset, recordLength, classByte: pointFormat >= 6 ? 16 : 15, classMask: pointFormat >= 6 ? 0xff : 0x1f };
}

/** Read the LAS header and count points per classification. LAZ (compressed) files are reported, not read. */
export function readLasInfo(buf: ArrayBuffer): { info: LasInfo | null; messages: ImportMessage[] } {
  const lay = lasLayout(buf);
  if (typeof lay === 'string') return { info: null, messages: [msg('error', lay)] };
  if (lay.info.compressed) {
    return { info: lay.info, messages: [msg('error', 'This file is LAZ-compressed. Only uncompressed LAS files are supported; decompress it to .las first.')] };
  }
  const n = Math.min(lay.info.pointCount, Math.floor((buf.byteLength - lay.dataOffset) / lay.recordLength));
  const messages: ImportMessage[] = [];
  if (n < lay.info.pointCount) messages.push(msg('warning', `The header declares ${lay.info.pointCount} points but the file holds ${n}.`));
  lay.info.pointCount = n;
  const dv = new DataView(buf);
  for (let i = 0; i < n; i++) {
    const c = dv.getUint8(lay.dataOffset + i * lay.recordLength + lay.classByte) & lay.classMask;
    lay.info.classes.set(c, (lay.info.classes.get(c) ?? 0) + 1);
  }
  return { info: lay.info, messages };
}

export interface LasOptions {
  /** Feature code for each LAS class to import; classes not listed are skipped (manual App. D.7). */
  classToCode: Map<number, number>;
  /** Keep one of every n points of each imported class. */
  step: number;
  /** Metres per unit of the file's coordinates (ignored for X, Y when a transform is given). */
  xyFactor: number;
  zFactor: number;
  transform?: Transformer;
  maxPoints: number;
}

export function parseLas(buf: ArrayBuffer, o: LasOptions): { points: TerrainPoint[]; messages: ImportMessage[] } {
  const lay = lasLayout(buf);
  if (typeof lay === 'string') return { points: [], messages: [msg('error', lay)] };
  if (lay.info.compressed) return { points: [], messages: [msg('error', 'LAZ-compressed files are not supported.')] };
  if (!Number.isInteger(o.step) || o.step < 1) return { points: [], messages: [msg('error', 'The thinning step must be a whole number of at least 1.')] };
  const dv = new DataView(buf);
  const n = Math.min(lay.info.pointCount, Math.floor((buf.byteLength - lay.dataOffset) / lay.recordLength));
  const { scale, offset } = lay.info;
  const nextId = idBatch();
  const points: TerrainPoint[] = [];
  const seen = new Map<number, number>();
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const at = lay.dataOffset + i * lay.recordLength;
    const cls = dv.getUint8(at + lay.classByte) & lay.classMask;
    const code = o.classToCode.get(cls);
    if (code === undefined) continue;
    const k = seen.get(cls) ?? 0;
    seen.set(cls, k + 1);
    if (k % o.step !== 0) continue;
    let x = dv.getInt32(at, true) * scale[0] + offset[0];
    let y = dv.getInt32(at + 4, true) * scale[1] + offset[1];
    const z = dv.getInt32(at + 8, true) * scale[2] + offset[2];
    if (o.transform) {
      try { [x, y] = o.transform.forward(x, y); } catch { failed++; continue; }
    } else { x *= o.xyFactor; y *= o.xyFactor; }
    if (points.length >= o.maxPoints) {
      return { points: [], messages: [msg('error', `The import would create more than ${o.maxPoints} points. Increase the thinning step or import fewer classes.`)] };
    }
    points.push({ id: nextId(), desc: '', x, y, z: z * o.zFactor, code, h: 0, profNote: '', planNote: '', active: true, src: 'imported' });
  }
  const messages: ImportMessage[] = [];
  if (failed) messages.push(msg('warning', `${failed} point(s) could not be transformed to the project coordinate system and were skipped.`));
  if (points.length === 0) messages.push(msg('error', 'No points were imported: no LAS class is mapped to a feature code.'));
  return { points, messages };
}
