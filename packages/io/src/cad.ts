import { strToU8, zipSync } from 'fflate';

/**
 * CAD and GIS exchange: DXF and shapefile readers for attachments (manual
 * §6.6.1, §6.6.3) and a KML / KMZ writer for Google Earth.
 */

export type Vertex = [number, number, number];

export type CadEntity =
  | { kind: 'polyline'; pts: Vertex[]; closed: boolean; layer: string }
  | { kind: 'text'; x: number; y: number; z: number; text: string; height: number; angle: number; layer: string }
  | { kind: 'point'; x: number; y: number; z: number; layer: string };

export interface CadDrawing {
  entities: CadEntity[];
  layers: string[];
  /** Entity types found but not drawn (e.g. block inserts, hatches). */
  skipped: Record<string, number>;
}

// ------------------------------------------------------------------ DXF

/**
 * ASCII DXF reader for the ENTITIES section: LINE, LWPOLYLINE, POLYLINE
 * (with VERTEX / SEQEND), CIRCLE, ARC, POINT, TEXT and MTEXT (formatting codes
 * removed). Block inserts and other entities are counted as skipped.
 */
export function parseDxf(text: string): CadDrawing {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = Number(lines[i]!.trim());
    if (!Number.isFinite(c)) { i--; continue; }
    pairs.push([c, lines[i + 1]!.replace(/\s+$/, '')]);
  }
  const entities: CadEntity[] = [];
  const skipped: Record<string, number> = {};
  const layers = new Set<string>();
  // Locate the ENTITIES section.
  let i = pairs.findIndex((p, k) => p[0] === 2 && p[1].trim() === 'ENTITIES' && pairs[k - 1]?.[1].trim() === 'SECTION');
  if (i < 0) return { entities, layers: [], skipped };
  i++;
  // Group entities: each starts with a code-0 pair.
  const groups: [number, string][][] = [];
  for (; i < pairs.length; i++) {
    const [c, v] = pairs[i]!;
    if (c === 0) {
      if (v.trim() === 'ENDSEC') break;
      groups.push([[c, v.trim()]]);
    } else groups[groups.length - 1]?.push([c, v]);
  }
  const num = (g: [number, string][], code: number, d = 0) => { const p = g.find((q) => q[0] === code); return p ? Number(p[1]) : d; };
  const str = (g: [number, string][], code: number, d = '') => g.find((q) => q[0] === code)?.[1] ?? d;
  for (let k = 0; k < groups.length; k++) {
    const g = groups[k]!;
    const type = g[0]![1];
    const layer = str(g, 8, '0').trim();
    const add = (e: CadEntity) => { entities.push(e); layers.add(layer); };
    switch (type) {
      case 'LINE':
        add({ kind: 'polyline', pts: [[num(g, 10), num(g, 20), num(g, 30)], [num(g, 11), num(g, 21), num(g, 31)]], closed: false, layer });
        break;
      case 'LWPOLYLINE': {
        const pts: Vertex[] = [];
        const elev = num(g, 38);
        for (const [c, v] of g) { if (c === 10) pts.push([Number(v), 0, elev]); else if (c === 20 && pts.length) pts[pts.length - 1]![1] = Number(v); }
        add({ kind: 'polyline', pts, closed: (num(g, 70) & 1) === 1, layer });
        break;
      }
      case 'POLYLINE': {
        const closed = (num(g, 70) & 1) === 1;
        const pts: Vertex[] = [];
        while (k + 1 < groups.length && groups[k + 1]![0]![1] === 'VERTEX') { k++; const vg = groups[k]!; pts.push([num(vg, 10), num(vg, 20), num(vg, 30)]); }
        if (groups[k + 1]?.[0]![1] === 'SEQEND') k++;
        add({ kind: 'polyline', pts, closed, layer });
        break;
      }
      case 'CIRCLE': case 'ARC': {
        const cx = num(g, 10), cy = num(g, 20), cz = num(g, 30), r = num(g, 40);
        const a0 = type === 'ARC' ? num(g, 50) : 0;
        let a1 = type === 'ARC' ? num(g, 51) : 360;
        if (a1 <= a0) a1 += 360;
        const nSeg = Math.max(8, Math.ceil((a1 - a0) / 10));
        const pts: Vertex[] = [];
        for (let s = 0; s <= nSeg; s++) { const a = ((a0 + ((a1 - a0) * s) / nSeg) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), cz]); }
        add({ kind: 'polyline', pts, closed: type === 'CIRCLE', layer });
        break;
      }
      case 'POINT': add({ kind: 'point', x: num(g, 10), y: num(g, 20), z: num(g, 30), layer }); break;
      case 'TEXT': case 'MTEXT': {
        let t = type === 'MTEXT' ? g.filter((q) => q[0] === 3 || q[0] === 1).map((q) => q[1]).join('') : str(g, 1);
        t = t.replace(/%%d/gi, '°').replace(/%%p/gi, '±').replace(/%%c/gi, 'Ø').replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
        add({ kind: 'text', x: num(g, 10), y: num(g, 20), z: num(g, 30), text: t, height: num(g, 40, 1), angle: num(g, 50), layer });
        break;
      }
      case 'VERTEX': case 'SEQEND': break;
      default: skipped[type] = (skipped[type] ?? 0) + 1;
    }
  }
  return { entities, layers: [...layers].sort(), skipped };
}

// ------------------------------------------------------------------ Shapefile (.shp)

/**
 * ESRI shapefile geometry reader (point, polyline, polygon, multipoint and
 * their Z / M variants). Attributes (.dbf) are not read.
 */
export function parseShapefile(buf: ArrayBuffer): CadDrawing {
  const dv = new DataView(buf);
  if (buf.byteLength < 100 || dv.getInt32(0, false) !== 9994) throw new Error('Not a shapefile (.shp): the file code is not 9994.');
  const fileLen = dv.getInt32(24, false) * 2;
  const entities: CadEntity[] = [];
  const skipped: Record<string, number> = {};
  let off = 100;
  const layer = 'SHP';
  while (off + 8 <= Math.min(fileLen, buf.byteLength)) {
    const len = dv.getInt32(off + 4, false) * 2;
    const r = off + 8;
    off = r + len;
    if (r + 4 > buf.byteLength) break;
    const type = dv.getInt32(r, true);
    const base = type % 10; // 1 point, 3 polyline, 5 polygon, 8 multipoint
    const hasZ = type > 10 && type < 20;
    if (type === 0) continue;
    if (base === 1) {
      entities.push({ kind: 'point', x: dv.getFloat64(r + 4, true), y: dv.getFloat64(r + 12, true), z: hasZ ? dv.getFloat64(r + 20, true) : 0, layer });
    } else if (base === 3 || base === 5) {
      const nParts = dv.getInt32(r + 36, true), nPts = dv.getInt32(r + 40, true);
      const parts: number[] = [];
      for (let k = 0; k < nParts; k++) parts.push(dv.getInt32(r + 44 + 4 * k, true));
      const p0 = r + 44 + 4 * nParts;
      const z0 = p0 + 16 * nPts + 16;
      for (let k = 0; k < nParts; k++) {
        const a = parts[k]!, b = k + 1 < nParts ? parts[k + 1]! : nPts;
        const pts: Vertex[] = [];
        for (let q = a; q < b; q++) pts.push([dv.getFloat64(p0 + 16 * q, true), dv.getFloat64(p0 + 16 * q + 8, true), hasZ ? dv.getFloat64(z0 + 8 * q, true) : 0]);
        entities.push({ kind: 'polyline', pts, closed: base === 5, layer });
      }
    } else if (base === 8) {
      const nPts = dv.getInt32(r + 36, true);
      for (let q = 0; q < nPts; q++) entities.push({ kind: 'point', x: dv.getFloat64(r + 40 + 16 * q, true), y: dv.getFloat64(r + 48 + 16 * q, true), z: 0, layer });
    } else skipped[`type ${type}`] = (skipped[`type ${type}`] ?? 0) + 1;
  }
  return { entities, layers: entities.length ? [layer] : [], skipped };
}

// ------------------------------------------------------------------ KML / KMZ

export interface KmlPlacemark {
  name: string;
  description?: string;
  folder: string;
  /** Longitude, latitude (degrees), altitude (m above the ellipsoid/geoid as given). */
  point?: [number, number, number];
  line?: [number, number, number][];
  color?: string;
  width?: number;
  /** Draped on the ground instead of the document altitude mode. */
  clamp?: boolean;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** KML colour aabbggrr from #rrggbb. */
const kmlColor = (c = '#ff0000') => { const h = c.replace('#', '').padEnd(6, '0'); return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`; };

export function buildKml(name: string, placemarks: KmlPlacemark[], altitudeMode: 'absolute' | 'clampToGround' = 'absolute'): string {
  const folders = [...new Set(placemarks.map((p) => p.folder))];
  const body = folders.map((f) => `<Folder><name>${xml(f)}</name>\n${placemarks.filter((p) => p.folder === f).map((p) => {
    const mode = p.clamp ? 'clampToGround' : altitudeMode;
    const geom = p.point
      ? `<Point><altitudeMode>${mode}</altitudeMode><coordinates>${p.point.join(',')}</coordinates></Point>`
      : `<LineString><altitudeMode>${mode}</altitudeMode><tessellate>${p.clamp ? 1 : 0}</tessellate><coordinates>${p.line!.map((c) => c.map((v) => Number(v.toFixed(8))).join(',')).join(' ')}</coordinates></LineString>`;
    const style = p.line ? `<Style><LineStyle><color>${kmlColor(p.color)}</color><width>${p.width ?? 2}</width></LineStyle></Style>` : '';
    return `<Placemark><name>${xml(p.name)}</name>${p.description ? `<description>${xml(p.description)}</description>` : ''}${style}${geom}</Placemark>`;
  }).join('\n')}</Folder>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>\n${body}\n</Document></kml>\n`;
}

export function buildKmz(kml: string): Uint8Array {
  return zipSync({ 'doc.kml': strToU8(kml) });
}
