import { clipPolyline, type Page, type Prim } from '@tlcad/io';
import { formatDMS, fromSI, profileElevation, projectPoint, unitLabel } from '@tlcad/engine';
import type { Annotation, Project, SheetArea, SheetSettings } from '@tlcad/model';
import { stationText, type DerivedView } from '../store/derived';
import { requiredFor } from '../store/clearances';

/**
 * Plan & profile sheets (manual §13), drawn as page display lists in mm.
 *
 * - Pages run along the virtual profile; each covers the profile length that
 *   fits the profile area at the horizontal scale. When the last structure of
 *   a page is within the allowable overlap of its end, the next page starts at
 *   that structure so it appears on both (§13.2.3).
 * - The plan area uses the Long Axis layout: the centre line is straight and
 *   horizontal, positions are drawn by station and offset, so structures line
 *   up vertically in plan and profile (§13.2.3). The aerial (true plan) layout
 *   and profile elevation breaks are not implemented; content outside the
 *   profile window is cut at the area border.
 */

export interface SheetInfo {
  number: number;
  from: number;
  to: number;
  firstStructure: string;
  lastStructure: string;
  /** Elevation at the bottom of the profile area. */
  zBottom: number;
  cut: boolean;
}

export interface SheetSet {
  pages: Page[];
  sheets: SheetInfo[];
  problems: string[];
}

const C = { ink: '#000000', grid: '#c8c8c8', ground: '#2e7d32', side: '#a1887f', wire: '#c62828', clear: '#e65100', pt: '#455a64', str: '#000000', ann: '#000000' };

interface Rect { x0: number; y0: number; x1: number; y1: number }
function areaRect(s: SheetSettings, a: SheetArea): Rect {
  const sx0 = s.margins.left, sy0 = s.margins.top;
  const sw = s.page.width - s.margins.left - s.margins.right, sh = s.page.height - s.margins.top - s.margins.bottom;
  return { x0: sx0 + (sw * a.xmin) / 100, x1: sx0 + (sw * a.xmax) / 100, y0: sy0 + (sh * a.ymin) / 100, y1: sy0 + (sh * a.ymax) / 100 };
}

/** Station and offset of a plan point on the alignment it is closest to. */
export function stationOffsetOf(d: DerivedView, x: number, y: number): { station: number; offset: number } | null {
  let best: { station: number; offset: number } | null = null;
  for (const l of d.lines) {
    if (!l.geom) continue;
    const r = projectPoint(l.geom, x, y);
    if (r && (!best || Math.abs(r.offset) < Math.abs(best.offset))) best = r;
  }
  return best;
}

/** Substitute the annotation codes of §13.3.2. */
export function substitute(text: string, p: Project, info: SheetInfo | null, total: number, now = new Date()): string {
  return text
    .replace(/%p/g, info ? String(info.number) : '')
    .replace(/%q/g, String(total))
    .replace(/%n/g, p.meta.name)
    .replace(/%L/g, p.meta.lineName || p.meta.name)
    .replace(/%d/g, now.toLocaleDateString())
    .replace(/%t/g, now.toLocaleTimeString())
    .replace(/%s1/g, info ? stationText(p, info.from) : '')
    .replace(/%s2/g, info ? stationText(p, info.to) : '')
    .replace(/%s3/g, info?.firstStructure ?? '')
    .replace(/%s4/g, info?.lastStructure ?? '')
    .replace(/%C(\d+)/g, (_, k) => p.criteria.notes.split(/\r?\n/)[Number(k) - 1] ?? '');
}

export function buildSheets(p: Project, d: DerivedView, opts: { only?: number } = {}): SheetSet {
  const s = p.drafting.sheets;
  const problems: string[] = [];
  const lines = d.lines.filter((l) => l.geom);
  if (!lines.length) return { pages: [], sheets: [], problems: ['There is no alignment to draw.'] };
  const start = Math.min(...lines.map((l) => l.geom!.startStation));
  const end = Math.max(...lines.map((l) => l.geom!.startStation + l.geom!.totalLength));
  const plan = areaRect(s, s.areas.plan), prof = areaRect(s, s.areas.profile), sta = areaRect(s, s.areas.stations), title = areaRect(s, s.areas.title);
  const mmPerM = 10 / s.hScale, mmPerMV = 10 / s.vScale;
  const len = (prof.x1 - prof.x0) / mmPerM;
  if (len <= 0) return { pages: [], sheets: [], problems: ['The profile area has no width.'] };
  const structs = d.model.structures.filter((x) => Number.isFinite(x.station)).sort((a, b) => a.station - b.station);
  const label = (x: (typeof structs)[number]) => x.s.label || String(x.number);

  // ---- paging
  const ranges: [number, number][] = [];
  let a = start;
  for (let guard = 0; a < end - 1e-6 && guard < 2000; guard++) {
    const b = Math.min(a + len, Math.max(end, a + len));
    ranges.push([a, a + len]);
    const inPage = structs.filter((x) => x.station > a + 1e-6 && x.station <= b + 1e-6);
    const last = inPage[inPage.length - 1];
    const next = last && b - last.station <= s.commonOverlap && last.station > a + 1e-6 ? last.station : b;
    a = next;
  }
  const total = ranges.length;
  const sheets: SheetInfo[] = [];
  const pages: Page[] = [];
  const disp = (v: number, dim: 'length') => fromSI(v, p.settings.unitSystem, dim);
  const lu = unitLabel(p.settings.unitSystem, 'length');

  ranges.forEach(([from, to], idx) => {
    if (opts.only !== undefined && opts.only !== idx) {
      // Not drawn: keep its sheet information so that numbering and ranges stay correct.
      const onP = structs.filter((x) => x.station >= from - 1e-6 && x.station <= to + 1e-6);
      sheets.push({ number: idx + 1, from, to: Math.min(to, end), zBottom: 0, cut: false, firstStructure: onP[0] ? label(onP[0]) : '', lastStructure: onP[onP.length - 1] ? label(onP[onP.length - 1]!) : '' });
      pages.push({ width: s.page.width, height: s.page.height, prims: [] });
      return;
    }
    const prims: Prim[] = [];
    const X = (st: number) => prof.x0 + (st - from) * mmPerM;
    // Profile window: from the lowest ground in the range less the bottom margin.
    let zMin = Infinity, zMax = -Infinity;
    for (const l of lines) for (const v of l.centerline) if (v.station >= from - 1 && v.station <= to + 1) { zMin = Math.min(zMin, v.z); zMax = Math.max(zMax, v.z); }
    for (const x of structs) if (x.station >= from && x.station <= to && x.baseZ !== null) { zMin = Math.min(zMin, x.baseZ); zMax = Math.max(zMax, x.topZ ?? x.baseZ); }
    if (!Number.isFinite(zMin)) { zMin = 0; zMax = 10; }
    const zBottom = Math.floor((zMin - s.profileBottomMargin) / s.elevationGrid) * s.elevationGrid;
    const zTop = zBottom + (prof.y1 - prof.y0) / mmPerMV;
    const cut = zMax > zTop;
    const Y = (z: number) => prof.y1 - (z - zBottom) * mmPerMV;
    const planC = (plan.y0 + plan.y1) / 2;
    const PY = (off: number) => planC + off * mmPerM;
    const halfPlan = (plan.y1 - plan.y0) / 2 / mmPerM;
    const clip = (pts: [number, number][], r: Rect, st: Omit<Extract<Prim, { kind: 'polyline' }>, 'kind' | 'pts'>) => {
      for (const part of clipPolyline(pts, r.x0, r.y0, r.x1, r.y1)) prims.push({ kind: 'polyline', pts: part, ...st });
    };
    /** Vertices inside the page's station range plus one neighbour on each side, so lines run to the area border. */
    const win = <T extends { station: number }>(input: T[]): T[] => {
      // Wires strung against the stationing run backwards: order by station first.
      const vs = input.length > 1 && input[0]!.station > input[input.length - 1]!.station ? [...input].reverse() : input;
      let i0 = vs.findIndex((v) => v.station >= from), i1 = -1;
      for (let i = vs.length - 1; i >= 0; i--) if (vs[i]!.station <= to) { i1 = i; break; }
      if (i0 < 0) i0 = vs.length;
      if (i1 < i0 - 1) { const k = vs.findIndex((v) => v.station > to); return k > 0 ? vs.slice(k - 1, k + 1) : []; }
      return vs.slice(Math.max(0, i0 - 1), Math.min(vs.length, i1 + 2));
    };
    const inRect = (x: number, y: number, r: Rect) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
    const text = (t: Omit<Extract<Prim, { kind: 'text' }>, 'kind'>, r?: Rect) => { if (!r || inRect(t.x, t.y, r)) prims.push({ kind: 'text', ...t }); };

    // ---- sheet frame and area borders
    prims.push({ kind: 'rect', x: s.margins.left, y: s.margins.top, w: s.page.width - s.margins.left - s.margins.right, h: s.page.height - s.margins.top - s.margins.bottom, stroke: C.ink, width: 0.5, layer: 'BORDER' });
    for (const r of [plan, prof, sta, title]) prims.push({ kind: 'rect', x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0, stroke: C.ink, width: 0.25, layer: 'BORDER' });

    // ---- profile grid and labels
    const g0 = Math.ceil(from / s.stationGrid) * s.stationGrid;
    for (let st = g0; st <= to + 1e-6; st += s.stationGrid) prims.push({ kind: 'line', x1: X(st), y1: prof.y0, x2: X(st), y2: prof.y1, stroke: C.grid, width: 0.1, layer: 'GRID' });
    for (let z = Math.ceil(zBottom / s.elevationGrid) * s.elevationGrid; z <= zTop + 1e-6; z += s.elevationGrid) prims.push({ kind: 'line', x1: prof.x0, y1: Y(z), x2: prof.x1, y2: Y(z), stroke: C.grid, width: 0.1, layer: 'GRID' });
    for (let z = Math.ceil(zBottom / s.elevationLabelInterval) * s.elevationLabelInterval; z <= zTop + 1e-6; z += s.elevationLabelInterval) {
      text({ x: prof.x0 + 1, y: Y(z) - 0.6, text: String(Number(disp(z, 'length').toFixed(1))), size: 1.8, layer: 'TEXT' });
    }
    for (let st = Math.ceil(from / s.stationLabelInterval) * s.stationLabelInterval; st <= to + 1e-6; st += s.stationLabelInterval) {
      prims.push({ kind: 'line', x1: X(st), y1: sta.y0, x2: X(st), y2: sta.y0 + 1.5, stroke: C.ink, width: 0.2, layer: 'TEXT' });
      text({ x: X(st), y: (sta.y0 + sta.y1) / 2, text: stationText(p, st), size: 2, anchor: 'middle', valign: 'middle', layer: 'TEXT' });
    }
    text({ x: prof.x1 - 1, y: prof.y0 + 3, text: `Elevation (${lu}) — H 1:${Math.round(s.hScale * 100)}, V 1:${Math.round(s.vScale * 100)}`, size: 1.8, anchor: 'end', layer: 'TEXT' });

    // ---- ground, side profiles, clearance line, survey points (profile)
    for (const l of lines) {
      const sel = (vs: { station: number; z: number }[], dz = 0) => win(vs).map((v) => [X(v.station), Y(v.z + dz)] as [number, number]);
      clip(sel(l.centerline), prof, { stroke: C.ground, width: 0.35, layer: 'GROUND' });
      if (s.show.sideProfiles) for (const sp of l.sides) for (const ln of sp.lines) clip(sel(ln), prof, { stroke: C.side, width: 0.2, dash: [1.5, 1], layer: 'GROUND' });
      const cl = p.criteria.clearanceLine;
      if (s.show.clearanceLine && cl.voltageKV !== null && cl.groundCode !== null) {
        const base = requiredFor(d.codes.get(cl.groundCode), cl.voltageKV)?.rv;
        if (base !== undefined) {
          clip(sel(l.centerline, base), prof, { stroke: C.clear, width: 0.2, dash: [0.6, 0.8], layer: 'CLEARANCE' });
          for (const q of l.projected) {
            if (q.station < from || q.station > to || Math.abs(q.offset) > p.settings.terrain.mopv) continue;
            const pt = d.points[q.i]!;
            const fc = d.codes.get(pt.code);
            const req = requiredFor(fc, cl.voltageKV);
            if (!req) continue;
            const top = pt.z + pt.h, g = profileElevation(l.centerline, q.station);
            if (g === null || top + req.rv > g + base + 1e-6) clip([[X(q.station), Y(top)], [X(q.station), Y(top + req.rv)]], prof, { stroke: C.clear, width: 0.2, dash: [0.6, 0.8], layer: 'CLEARANCE' });
            if (fc?.aerial) clip([[X(q.station), Y(top)], [X(q.station), Y(top - req.rv)]], prof, { stroke: C.clear, width: 0.2, dash: [0.6, 0.8], layer: 'CLEARANCE' });
          }
        }
      }
      if (s.show.surveyPoints) {
        for (const q of l.projected) {
          if (q.station < from || q.station > to) continue;
          const pt = d.points[q.i]!;
          if (Math.abs(q.offset) <= p.settings.terrain.mopv && pt.h > 0) clip([[X(q.station), Y(pt.z)], [X(q.station), Y(pt.z + pt.h)]], prof, { stroke: C.pt, width: 0.25, layer: 'POINTS' });
          // Plan: points within the plan width.
          if (Math.abs(q.offset) <= halfPlan) {
            const px = X(q.station), py = PY(q.offset);
            if (inRect(px, py, plan)) prims.push({ kind: 'circle', cx: px, cy: py, r: 0.25, stroke: C.pt, width: 0.1, fill: C.pt, layer: 'POINTS' });
          }
        }
      }
    }

    // ---- plan: centre line, P.I.s, station ticks
    clip([[plan.x0, planC], [plan.x1, planC]], plan, { stroke: C.ink, width: 0.3, dash: [4, 1, 0.5, 1], layer: 'ALIGNMENT' });
    for (let st = Math.ceil(from / s.planTickInterval) * s.planTickInterval; st <= to + 1e-6; st += s.planTickInterval) {
      prims.push({ kind: 'line', x1: X(st), y1: planC - 1, x2: X(st), y2: planC + 1, stroke: C.ink, width: 0.2, layer: 'ALIGNMENT' });
    }
    for (const l of lines) {
      l.geom!.stations.forEach((st, i) => {
        if (st < from || st > to) return;
        const ang = l.geom!.lineAngles[i]!;
        prims.push({ kind: 'polyline', pts: [[X(st) - 1.2, planC - 1.2], [X(st) + 1.2, planC - 1.2], [X(st), planC + 1.2]], closed: true, stroke: C.ink, width: 0.2, layer: 'ALIGNMENT' });
        text({ x: X(st), y: planC - 2.2, text: `PI ${i + 1}${ang ? `  ${formatDMS(ang)}` : ''}`, size: 1.8, anchor: 'middle', layer: 'TEXT' }, plan);
      });
    }

    // ---- wires (plan and profile)
    if (s.show.wires) {
      for (const sec of d.model.sections) {
        const shape = d.analysis.sections.get(sec.section.id)?.shape;
        const profW = shape?.profile ?? sec.profile;
        const dash = shape ? undefined : [1.5, 1];
        for (const ph of profW) clip(win(ph).map((q) => [X(q.station), Y(q.z)]), prof, { stroke: C.wire, width: 0.25, layer: 'WIRES', ...(dash ? { dash } : {}) });
        const planW = shape?.plan ?? sec.wires;
        for (const ph of planW) {
          const pts: [number, number][] = [];
          for (const q of ph) { const so = stationOffsetOf(d, q.x, q.y); if (so && so.station >= from - 400 && so.station <= to + 400) pts.push([X(so.station), PY(so.offset)]); }
          clip(pts, plan, { stroke: C.wire, width: 0.2, layer: 'WIRES', ...(dash ? { dash } : {}) });
        }
      }
    }

    // ---- structures
    const onPage = structs.filter((x) => x.station >= from - 1e-6 && x.station <= to + 1e-6);
    for (const x of onPage) {
      const sx = X(x.station);
      if (x.baseZ !== null && x.topZ !== null) {
        clip([[sx, Y(x.baseZ)], [sx, Y(x.topZ)]], prof, { stroke: C.str, width: 0.5, layer: 'STRUCTURES' });
        for (const q of x.points) {
          const so = stationOffsetOf(d, q.top.x, q.top.y);
          if (so) clip([[sx, Y(q.top.z)], [X(so.station), Y(q.top.z)]], prof, { stroke: C.str, width: 0.3, layer: 'STRUCTURES' });
        }
        if (s.show.structureLabels) {
          const ty = Math.max(prof.y0 + 3, Math.min(prof.y1 - 1, Y(x.topZ) - 2));
          text({ x: sx, y: ty, text: label(x), size: 2.2, anchor: 'middle', bold: true, layer: 'TEXT' });
          text({ x: sx + 0.8, y: Math.min(prof.y1 - 1, ty + 3), text: `${x.type?.name ?? ''}`, size: 1.6, angle: 90, layer: 'TEXT' }, prof);
        }
      }
      if (x.frame) {
        const so = stationOffsetOf(d, x.frame.baseX, x.frame.baseY);
        if (so) {
          const px = X(so.station), py = PY(so.offset);
          if (inRect(px, py, plan)) {
            prims.push({ kind: 'circle', cx: px, cy: py, r: 0.9, stroke: C.str, width: 0.3, fill: '#ffffff', layer: 'STRUCTURES' });
            text({ x: px, y: py + 3.2, text: label(x), size: 2, anchor: 'middle', layer: 'TEXT' }, plan);
          }
        }
      }
    }
    if (cut) text({ x: prof.x0 + 2, y: prof.y0 + 3, text: 'Profile cut at the top of the area (elevation breaks are not drawn)', size: 1.8, color: '#c62828', layer: 'TEXT' });

    const info: SheetInfo = {
      number: idx + 1, from, to: Math.min(to, end), zBottom, cut,
      firstStructure: onPage[0] ? label(onPage[0]) : '', lastStructure: onPage[onPage.length - 1] ? label(onPage[onPage.length - 1]!) : '',
    };
    sheets.push(info);

    // ---- attachments (§6.6)
    if (s.show.attachments) {
      for (const at of p.attachments) {
        if (!at.visible || at.kind === 'image') continue;
        const tr = (x: number, y: number): [number, number] | null => {
          const gx = x * at.unitScale + at.dx, gy = y * at.unitScale + at.dy;
          if (at.view === 'sheets') return [gx * 1000, s.page.height - gy * 1000];
          if (at.view === 'profile') return [X(gx), Y(gy)];
          const so = stationOffsetOf(d, gx, gy);
          return so ? [X(so.station), PY(so.offset)] : null;
        };
        const area: Rect = at.view === 'sheets' ? { x0: 0, y0: 0, x1: s.page.width, y1: s.page.height } : at.view === 'profile' ? prof : plan;
        for (const e of at.entities) {
          if (at.hiddenLayers.includes(e.layer)) continue;
          if (e.kind === 'polyline') {
            const pts = e.pts.map((v) => tr(v[0], v[1])).filter((q): q is [number, number] => q !== null);
            if (e.closed && pts.length) pts.push(pts[0]!);
            clip(pts, area, { stroke: at.color, width: 0.15, layer: `ATT_${at.name}` });
          } else {
            const q = tr(e.x, e.y);
            if (!q || !inRect(q[0], q[1], area)) continue;
            if (e.kind === 'text') prims.push({ kind: 'text', x: q[0], y: q[1], text: e.text, size: Math.max(0.8, at.view === 'sheets' ? e.height * at.unitScale * 1000 : e.height * at.unitScale * mmPerM), angle: e.angle, color: at.color, layer: `ATT_${at.name}` });
            else prims.push({ kind: 'circle', cx: q[0], cy: q[1], r: 0.3, stroke: at.color, width: 0.1, layer: `ATT_${at.name}` });
          }
        }
      }
    }

    // ---- title block
    const lh = Math.min(5, (title.y1 - title.y0) / Math.max(1, s.title.length + 0.5));
    s.title.forEach((t, k) => text({ x: title.x0 + 2, y: title.y0 + lh * (k + 0.9), text: substitute(t, p, info, total), size: Math.min(lh * 0.62, k === 0 ? 3.5 : 2.6), bold: k === 0, layer: 'TITLE' }));

    // ---- annotation (§13.3)
    for (const an of p.drafting.annotations) {
      if (an.target === 'sheet' && an.sheet !== idx + 1) continue;
      drawAnnotation(an, prims, (x, y) => {
        if (an.target === 'allSheets' || an.target === 'sheet') return [x * s.page.width, y * s.page.height];
        if (an.target === 'profile') return [X(x), Y(y)];
        const so = stationOffsetOf(d, x, y);
        return so ? [X(so.station), PY(so.offset)] : null;
      }, an.target === 'profile' ? prof : an.target === 'plan' ? plan : null, (t) => substitute(t, p, info, total));
    }

    pages.push({ width: s.page.width, height: s.page.height, prims });
  });
  return { pages, sheets, problems };
}

function drawAnnotation(an: Annotation, prims: Prim[], map: (x: number, y: number) => [number, number] | null, area: Rect | null, sub: (t: string) => string) {
  const pts = an.pts.map(([x, y]) => map(x, y)).filter((q): q is [number, number] => q !== null);
  if (!pts.length) return;
  const keep = (part: [number, number][]) => (area ? clipPolyline(part, area.x0, area.y0, area.x1, area.y1) : [part]);
  if (an.kind === 'text') {
    const [x, y] = pts[0]!;
    if (area && (x < area.x0 || x > area.x1 || y < area.y0 || y > area.y1)) return;
    sub(an.text).split('\\n').forEach((t, k) => prims.push({ kind: 'text', x, y: y + k * an.height * 1.5, text: t, size: an.height, angle: an.angle, color: an.color, layer: 'ANNOTATION' }));
    return;
  }
  const line = an.kind === 'polygon' && pts.length > 2 ? [...pts, pts[0]!] : pts;
  for (const part of keep(line)) prims.push({ kind: 'polyline', pts: part, stroke: an.color, width: 0.3, layer: 'ANNOTATION' });
  if (an.kind === 'arrow' && pts.length > 1) {
    const [x2, y2] = pts[pts.length - 1]!, [x1, y1] = pts[pts.length - 2]!;
    const a = Math.atan2(y2 - y1, x2 - x1), h = Math.max(1.5, an.height);
    prims.push({ kind: 'polyline', pts: [[x2, y2], [x2 - h * Math.cos(a - 0.4), y2 - h * Math.sin(a - 0.4)], [x2 - h * Math.cos(a + 0.4), y2 - h * Math.sin(a + 0.4)]], closed: true, stroke: an.color, fill: an.color, width: 0.2, layer: 'ANNOTATION' });
  }
}
