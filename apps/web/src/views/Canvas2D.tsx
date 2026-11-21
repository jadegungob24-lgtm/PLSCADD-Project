import { useCallback, useEffect, useRef } from 'react';
import {
  buildAlignment, formatDMS, profileElevation, projectPoint, tinElevation, toSI, unitLabel,
  type AlignmentGeometry, type UnitSystem, type XY,
} from '@tlcad/engine';
import { useApp, type Tool } from '../store/appStore';
import { stationText, useDerived, type DerivedView } from '../store/derived';
import { stationOfPoint } from '../store/lineModel';
import { addStructureAtProfile, deleteStructures, moveStructure } from '../commands/line';
import { sagThroughPoint } from '../commands/sag';
import { requiredFor } from '../store/clearances';
import { addPi, deletePi, insertPi, movePi } from '../commands/terrain';
import {
  fitBounds, gridLines, niceStep, panBy, screenToWorld, stepDecimals, worldToScreen, zoomAt,
  type Bounds, type Size, type Viewport,
} from './viewport2d';

/**
 * Canvas workspace for the Plan view (X east, Y north) and the Profile view
 * (station, elevation with vertical exaggeration).
 *
 * Plan: survey points coloured by feature code, optional TIN triangles,
 * contour lines and break lines, every alignment with its PIs and line angles,
 * and the two terrain widths of manual §6.3.2 (MOPV outer, MOCGP inner). The
 * PI tools act on the active alignment.
 * Profile: the virtual alignment (§6.3.1.2) — the profiles of all alignments
 * one after the other, separated by the station gap — with ground and obstacle
 * points within MOPV, centerline and side profiles and the PI locations.
 */

const COL = {
  bg: '#14181d', grid: '#222a32', gridMajor: '#2f3944', axis: '#4b5967', label: '#8593a1',
  point: '#7fd08a', tin: '#2c5a3a', contour: '#8a7a4a', brk: '#3fbf6a', align: '#f2d14b', alignOther: '#9c8a45',
  width: '#3f78c9', ground: '#6fd67d', side: '#c9a54a', text: '#d7dee6',
  structure: '#b9c4cf', wire: '#e05d4f', bad: '#ff5c4d', clearance: '#e8a33d',
};
const HIT_PX = 9;

/** Decoded raster attachments, shared by all canvases; a redraw is requested when one finishes loading. */
const images = new Map<string, HTMLImageElement>();
function imageFor(href: string, onLoad: () => void): HTMLImageElement {
  let im = images.get(href);
  if (!im) { im = new Image(); im.onload = () => onLoad(); im.src = href; images.set(href, im); }
  return im;
}

interface DragPi { id: string; x: number; y: number }

export function Canvas2D({ mode }: { mode: 'plan' | 'profile' }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const vp = useRef<Viewport>({ cx: 0, cy: 0, scale: 1, aspect: 1 });
  const size = useRef<Size>({ w: 0, h: 0 });
  const raf = useRef(0);
  const fitted = useRef(false);
  const dragPi = useRef<DragPi | null>(null);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const dragStr = useRef<{ id: string; station: number } | null>(null);

  const project = useApp((s) => s.project);
  const fitSignal = useApp((s) => s.fitSignal);
  const tool = useApp((s) => s.activeTool);
  const setCursor = useApp((s) => s.setCursor);
  const selection = useApp((s) => s.selection);
  const d = useDerived();
  const dRef = useRef<DerivedView>(d);
  dRef.current = d;
  const pRef = useRef(project);
  pRef.current = project;

  const sys: UnitSystem = project?.settings.unitSystem ?? 'SI_N';
  const aspect = mode === 'profile' ? project?.settings.profileAspectRatio ?? 10 : 1;
  const mopv = project?.settings.terrain.mopv ?? 0;
  const mocgp = project?.settings.terrain.mocgp ?? 0;
  const anyGeom = d.lines.some((l) => l.geom);

  const bounds = useCallback((): Bounds => {
    const dd = dRef.current;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x: number, y: number) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    if (mode === 'plan') {
      for (const p of dd.points) grow(p.x, p.y);
      for (const l of dd.lines) for (const p of l.alignment.pis) grow(p.x, p.y);
      for (const b of pRef.current?.terrain.breakLines ?? []) { grow(b.ax, b.ay); grow(b.bx, b.by); }
      if (minX > maxX) return { minX: -500, minY: -500, maxX: 500, maxY: 500 };
    } else {
      for (const l of dd.lines) {
        if (!l.geom) continue;
        for (const q of l.projected) {
          if (Math.abs(q.offset) > mopv) continue;
          const p = dd.points[q.i]!;
          grow(q.station, p.z); grow(q.station, p.z + p.h);
        }
        for (const v of l.centerline) grow(v.station, v.z);
        const s0 = l.geom.startStation, s1 = s0 + l.geom.totalLength;
        if (minY > maxY) { grow(s0, 0); grow(s1, 50); } else { minX = Math.min(minX, s0); maxX = Math.max(maxX, s1); }
      }
      if (minX > maxX) return { minX: 0, minY: 0, maxX: 1000, maxY: 60 };
    }
    const padX = Math.max(maxX - minX, 1) * 0.03;
    const padY = Math.max(maxY - minY, mode === 'plan' ? maxX - minX : 1, 1) * (mode === 'plan' ? 0.03 : 0.15);
    return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
  }, [mode, mopv]);

  const draw = useCallback(() => {
    const c = canvas.current;
    const s = size.current;
    if (!c || s.w === 0 || s.h === 0) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dd = dRef.current;
    const proj = pRef.current;
    const sel = useApp.getState().selection;
    const selId = sel && (sel.kind === 'structure' || sel.kind === 'section') ? sel.id : null;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, s.w, s.h);

    const v = vp.current;
    const W = (x: number, y: number) => worldToScreen(v, s, x, y);
    const f = toSI(1, sys, 'length'); // metres per display length unit
    const [x0, y1] = screenToWorld(v, s, 0, 0);
    const [x1, y0] = screenToWorld(v, s, s.w, s.h);
    const stepX = niceStep(v.scale * f);
    const stepY = niceStep(v.scale * v.aspect * f, 60);
    const xs = gridLines(x0 / f, x1 / f, stepX);
    const ys = gridLines(y0 / f, y1 / f, stepY);

    // ---- grid
    ctx.lineWidth = 1;
    const major = (val: number, step: number) => Math.abs(Math.round(val / (step * 5)) * step * 5 - val) < step * 1e-6;
    for (const xv of xs) {
      const px = Math.round(W(xv * f, 0)[0]) + 0.5;
      ctx.strokeStyle = xv === 0 ? COL.axis : major(xv, stepX) ? COL.gridMajor : COL.grid;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, s.h); ctx.stroke();
    }
    for (const yv of ys) {
      const py = Math.round(W(0, yv * f)[1]) + 0.5;
      ctx.strokeStyle = yv === 0 ? COL.axis : major(yv, stepY) ? COL.gridMajor : COL.grid;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(s.w, py); ctx.stroke();
    }

    const polyline = (pts: [number, number][], color: string, width = 1.5, dash: number[] = []) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke(); ctx.setLineDash([]);
    };
    const colorOf = (code: number) => dd.codes.get(code)?.color ?? COL.point;
    const many = dd.lines.length > 1;

    // ---- attachments (§6.6) and annotation (§13.3) of this view, under the line model
    if (proj) {
      for (const at of proj.attachments) {
        if (!at.visible || at.view !== mode) continue;
        if (at.kind === 'image' && at.image && mode === 'plan') {
          const im = imageFor(at.image.href, schedule);
          if (im.complete && im.naturalWidth > 0) {
            const [ux, uy] = W(at.image.x, at.image.y);
            const pxPerM = v.scale;
            ctx.save();
            ctx.translate(ux, uy);
            ctx.rotate((-at.image.rotation * Math.PI) / 180);
            ctx.globalAlpha = 0.85;
            ctx.drawImage(im, 0, 0, at.image.width * pxPerM, at.image.height * pxPerM);
            ctx.restore();
          }
          continue;
        }
        ctx.font = '10px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        for (const e of at.entities) {
          if (at.hiddenLayers.includes(e.layer)) continue;
          const T = (x: number, y: number) => W(x * at.unitScale + at.dx, y * at.unitScale + at.dy);
          if (e.kind === 'polyline') {
            const pts = e.pts.map((q) => T(q[0], q[1]));
            if (e.closed && pts.length) pts.push(pts[0]!);
            polyline(pts, at.color, 1);
          } else if (e.kind === 'text') {
            const [tx, ty] = T(e.x, e.y);
            ctx.fillStyle = at.color; ctx.save(); ctx.translate(tx, ty); ctx.rotate((-e.angle * Math.PI) / 180); ctx.fillText(e.text, 0, 0); ctx.restore();
          } else { const [tx, ty] = T(e.x, e.y); ctx.fillStyle = at.color; ctx.fillRect(tx - 1.5, ty - 1.5, 3, 3); }
        }
      }
      for (const an of proj.drafting.annotations) {
        if (an.target !== mode) continue;
        const pts = an.pts.map(([x, y]) => W(x, y));
        ctx.strokeStyle = an.color; ctx.fillStyle = an.color;
        if (an.kind === 'text') {
          ctx.font = '12px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          an.text.split('\\n').forEach((line, k) => ctx.fillText(line, pts[0]![0], pts[0]![1] + k * 14));
        } else polyline(an.kind === 'polygon' && pts.length > 2 ? [...pts, pts[0]!] : pts, an.color, 1.4);
      }
    }
    if (mode === 'plan') {
      // ---- TIN triangle outlines
      if (dd.tin) {
        const tv = dd.tin.vertices, tr = dd.tin.triangles;
        ctx.strokeStyle = COL.tin; ctx.lineWidth = 1;
        // Large TINs: triangles that are off screen or smaller than a few pixels are not outlined
        // (they would only fill the area solid), and the rest are stroked in batches — a single
        // path with hundreds of thousands of segments stalls the browser.
        let inPath = 0;
        ctx.beginPath();
        for (let t = 0; t < tr.length; t += 3) {
          const ax = tv[tr[t]! * 3]!, ay = tv[tr[t]! * 3 + 1]!;
          const bx = tv[tr[t + 1]! * 3]!, by = tv[tr[t + 1]! * 3 + 1]!;
          const cx = tv[tr[t + 2]! * 3]!, cy = tv[tr[t + 2]! * 3 + 1]!;
          const loX = Math.min(ax, bx, cx), hiX = Math.max(ax, bx, cx), loY = Math.min(ay, by, cy), hiY = Math.max(ay, by, cy);
          if (hiX < x0 || loX > x1 || hiY < y0 || loY > y1) continue;
          if ((hiX - loX) * v.scale < 4 && (hiY - loY) * v.scale < 4) continue;
          const a = W(ax, ay), b = W(bx, by), cc = W(cx, cy);
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(cc[0], cc[1]); ctx.closePath();
          if (++inPath >= 2000) { ctx.stroke(); ctx.beginPath(); inPath = 0; }
        }
        ctx.stroke();
      }
      // ---- contour lines (§6.4.3)
      if (dd.contours.length) {
        ctx.strokeStyle = COL.contour; ctx.lineWidth = 1;
        let inPath = 0;
        ctx.beginPath();
        for (const lvl of dd.contours) {
          const sg = lvl.segments;
          for (let i = 0; i < sg.length; i += 4) {
            const sx0 = sg[i]!, sy0 = sg[i + 1]!, sx1 = sg[i + 2]!, sy1 = sg[i + 3]!;
            if (Math.max(sx0, sx1) < x0 || Math.min(sx0, sx1) > x1 || Math.max(sy0, sy1) < y0 || Math.min(sy0, sy1) > y1) continue;
            const a = W(sx0, sy0), b = W(sx1, sy1);
            ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
            if (++inPath >= 4000) { ctx.stroke(); ctx.beginPath(); inPath = 0; }
          }
        }
        ctx.stroke();
      }
      // ---- break lines (§6.5), drawn as thick green lines like the manual's TIN display
      const brk = proj?.terrain.breakLines ?? [];
      if (brk.length) {
        ctx.strokeStyle = COL.brk; ctx.lineWidth = 2;
        ctx.beginPath();
        for (const b of brk) { const a = W(b.ax, b.ay), e = W(b.bx, b.by); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); }
        ctx.stroke();
      }
      // ---- survey points; obstacle points (h > 0 or not on ground) drawn larger
      const labelled: [number, number, string, string][] = [];
      for (const p of dd.points) {
        const [px, py] = W(p.x, p.y);
        if (px < -4 || py < -4 || px > s.w + 4 || py > s.h + 4) continue;
        ctx.fillStyle = colorOf(p.code);
        const offGround = dd.codes.get(p.code)?.onGround === false;
        if (offGround) {
          // Plotted (non-ground) points: a ring marker, labelled with the description.
          ctx.strokeStyle = colorOf(p.code); ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.stroke();
          ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
          if (p.desc) labelled.push([px, py, p.desc, colorOf(p.code)]);
          continue;
        }
        const r = p.h > 0 ? 2.5 : 1.5;
        ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
      }
      // Labels only while they stay readable.
      if (labelled.length && labelled.length <= 400) {
        ctx.font = '11px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        for (const [px, py, text, col] of labelled) { ctx.fillStyle = col; ctx.fillText(text, px + 6, py - 4); }
      }
      // ---- alignments (the PI being dragged is shown at its new place)
      const drag = dragPi.current;
      ctx.font = '11px Segoe UI, sans-serif';
      dd.lines.forEach((line, li) => {
        const isActive = li === dd.active;
        const pis: (XY & { id: string })[] = line.alignment.pis.map((p) => (drag && isActive && p.id === drag.id ? { ...p, x: drag.x, y: drag.y } : p));
        const g: AlignmentGeometry | null = drag && isActive ? (pis.length > 1 ? buildAlignment(pis) : null) : line.geom;
        const col = isActive ? COL.align : COL.alignOther;
        if (g) {
          // Terrain widths: MOPV (outer pair, dashed) and MOCGP (inner pair), §6.3.2.
          for (const [w, dash] of [[mopv, [6, 4]], [mocgp, []]] as [number, number[]][]) {
            for (const side of [-1, 1]) {
              for (const seg of g.segments) {
                const ox = seg.dy * w * side, oy = -seg.dx * w * side;
                polyline([W(seg.ax + ox, seg.ay + oy), W(seg.ax + seg.dx * seg.length + ox, seg.ay + seg.dy * seg.length + oy)], COL.width, 1, dash);
              }
            }
          }
          polyline(pis.map((p) => W(p.x, p.y)), col, isActive ? 2 : 1.5);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        pis.forEach((p, i) => {
          const [px, py] = W(p.x, p.y);
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.fillStyle = COL.bg;
          ctx.fillRect(px - 4.5, py - 4.5, 9, 9); ctx.strokeRect(px - 4.5, py - 4.5, 9, 9);
          ctx.fillStyle = isActive ? COL.text : COL.label;
          const ang = g && i > 0 && i < pis.length - 1 ? `  ${formatDMS(g.lineAngles[i]!)}` : '';
          ctx.fillText(`${many ? `A${li + 1} ` : ''}PI ${i + 1}${ang}`, px + 8, py - 6 - (many ? (li % 2) * 12 : 0));
        });
      });
      // ---- wires (sagged shapes where the section is sagged, else dashed straight chords) and structures
      for (const sec of dd.model.sections) {
        const hot = sec.section.id === selId;
        const shape = dd.analysis.sections.get(sec.section.id)?.shape;
        if (shape) for (const ph of shape.plan) polyline(ph.map((p) => W(p.x, p.y)), sec.cable?.color ?? COL.wire, hot ? 2.4 : 1.2);
        else for (const ph of sec.wires) polyline(ph.map((p) => W(p.x, p.y)), sec.cable?.color ?? COL.wire, hot ? 2.4 : 1.2, [7, 4]);
      }
      ctx.font = '11px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      for (const sd of dd.model.structures) {
        if (!sd.frame) continue;
        const [bx, by] = W(sd.frame.baseX, sd.frame.baseY);
        if (bx < -40 || by < -40 || bx > s.w + 40 || by > s.h + 40) continue;
        const hot = sd.s.id === selId;
        ctx.strokeStyle = sd.problems.length ? COL.bad : hot ? '#ffffff' : COL.structure;
        ctx.lineWidth = hot ? 2.2 : 1.4;
        for (const q of sd.points) {
          const [ax, ay] = W(q.top.x, q.top.y);
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ay); ctx.stroke();
        }
        ctx.fillStyle = COL.bg;
        ctx.beginPath(); ctx.arc(bx, by, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = hot ? '#ffffff' : COL.text;
        ctx.fillText(sd.s.label || String(sd.number), bx + 7, by + 5);
      }
    } else {
      dd.lines.forEach((line, li) => {
        const g = line.geom;
        if (!g) return;
        // ---- points within MOPV
        for (const q of line.projected) {
          if (Math.abs(q.offset) > mopv) continue;
          const p = dd.points[q.i]!;
          const [px, py] = W(q.station, p.z);
          if (px < -4 || px > s.w + 4) continue;
          ctx.fillStyle = colorOf(p.code);
          if (p.h > 0) {
            const top = W(q.station, p.z + p.h)[1];
            ctx.strokeStyle = colorOf(p.code); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(px + 0.5, py); ctx.lineTo(px + 0.5, top); ctx.stroke();
            ctx.fillRect(px - 2.5, top - 2.5, 5, 5);
          }
          ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
        }
        // ---- side profiles and centerline ground profile
        for (const sp of line.sides) for (const ln of sp.lines) polyline(ln.map((p) => W(p.station, p.z)), COL.side, 1, [5, 3]);
        polyline(line.centerline.map((p) => W(p.station, p.z)), COL.ground, 1.6);
        // ---- PI locations
        ctx.font = '11px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        g.stations.forEach((sta, i) => {
          const px = Math.round(W(sta, 0)[0]) + 0.5;
          ctx.strokeStyle = li === dd.active ? COL.align : COL.alignOther; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.moveTo(px, 24); ctx.lineTo(px, s.h - 16); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = COL.text;
          const inner = i > 0 && i < g.stations.length - 1;
          ctx.fillText(`${many ? `A${li + 1} ` : ''}PI ${i + 1}${inner ? `  ${formatDMS(g.lineAngles[i]!)}` : ''}`, px + 4, 26 + (i % 2) * 28);
          ctx.fillStyle = COL.label;
          if (proj) ctx.fillText(stationText(proj, sta), px + 4, 40 + (i % 2) * 28);
        });
      });
      // ---- wires (sagged shapes; dashed straight chords where not sagged or while a structure is dragged) and structures
      const drag = dragStr.current;
      const shiftOf = (id: string, station: number) => (drag && drag.id === id ? drag.station - station : 0);
      for (const sec of dd.model.sections) {
        const hot = sec.section.id === selId;
        const shape = dd.analysis.sections.get(sec.section.id)?.shape;
        if (shape && !(drag && sec.section.steps.some((st) => st.structureId === drag.id))) {
          for (const ph of shape.profile) polyline(ph.map((p) => W(p.station, p.z)), sec.cable?.color ?? COL.wire, hot ? 2.6 : 1.3);
          continue;
        }
        for (const ph of sec.profile) {
          polyline(ph.map((p, i) => {
            const sid = sec.section.steps.filter((st) => st.set !== null)[i]?.structureId;
            const sd = sid ? dd.model.byId.get(sid) : undefined;
            return W(p.station + (sd ? shiftOf(sd.s.id, sd.station) : 0), p.z);
          }), sec.cable?.color ?? COL.wire, hot ? 2.6 : 1.3, [7, 4]);
        }
      }
      ctx.font = '11px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      for (const sd of dd.model.structures) {
        if (sd.baseZ === null || sd.topZ === null || !Number.isFinite(sd.station)) continue;
        const sh = shiftOf(sd.s.id, sd.station);
        const [x, yb] = W(sd.station + sh, sd.baseZ);
        const yt = W(sd.station + sh, sd.topZ)[1];
        if (x < -40 || x > s.w + 40) continue;
        const hot = sd.s.id === selId || (drag?.id === sd.s.id);
        ctx.strokeStyle = sd.problems.length ? COL.bad : hot ? '#ffffff' : COL.structure;
        ctx.lineWidth = hot ? 3 : 2;
        ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x, yt); ctx.stroke();
        for (const q of sd.points) {
          const st = (stationOfPoint(dd, sd.line, q.top.x, q.top.y) ?? sd.station) + sh;
          const [ax, ay] = W(st, q.top.z);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(ax, ay); ctx.stroke();
          if (q.wire && q.wire !== q.top) {
            const [wx, wy] = W((stationOfPoint(dd, sd.line, q.wire.x, q.wire.y) ?? sd.station) + sh, q.wire.z);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(wx, wy); ctx.stroke();
          }
          ctx.fillStyle = ctx.strokeStyle as string;
          ctx.fillRect(ax - 2, ay - 2, 4, 4);
        }
        ctx.fillStyle = hot ? '#ffffff' : COL.text;
        ctx.fillText(sd.s.label || String(sd.number), x, yt - 4);
      }
    }

    // ---- ground clearance line and spikes (profile, §6.10.2)
    const cl = proj?.criteria.clearanceLine;
    if (mode === 'profile' && cl && cl.voltageKV !== null && cl.groundCode !== null) {
      const base = requiredFor(dd.codes.get(cl.groundCode), cl.voltageKV)?.rv ?? null;
      if (base !== null) {
        dd.lines.forEach((line) => {
          if (!line.geom) return;
          polyline(line.centerline.map((p) => W(p.station, p.z + base)), COL.clearance, 1, [2, 3]);
          for (const sp of line.sides) for (const ln of sp.lines) polyline(ln.map((p) => W(p.station, p.z + base)), COL.clearance, 1, [2, 3]);
          // Spikes: required clearances above (and below aerial obstacles) points within MOPV, where larger than the basic line.
          ctx.strokeStyle = COL.clearance; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
          for (const q of line.projected) {
            if (Math.abs(q.offset) > mopv) continue;
            const pt = dd.points[q.i]!;
            const fc = dd.codes.get(pt.code);
            const req = requiredFor(fc, cl.voltageKV!);
            if (!req) continue;
            const top = pt.z + pt.h;
            const g = profileElevation(line.centerline, q.station);
            const [px, pyTop] = W(q.station, top);
            if (px < -4 || px > s.w + 4) continue;
            if (g === null || top + req.rv > g + base + 1e-6) { const py = W(q.station, top + req.rv)[1]; ctx.beginPath(); ctx.moveTo(px, pyTop); ctx.lineTo(px, py); ctx.stroke(); }
            if (fc?.aerial) { const py = W(q.station, top - req.rv)[1]; ctx.beginPath(); ctx.moveTo(px, pyTop); ctx.lineTo(px, py); ctx.stroke(); }
          }
          ctx.setLineDash([]);
        });
      }
    }

    // ---- clearance markers (§11.2.3)
    const markers = useApp.getState().markers;
    for (const mk of markers) {
      const col = mk.status === 'violation' ? COL.bad : mk.status === 'questionable' ? '#4f8ff7' : '#5bc06b';
      const A = mode === 'plan' ? (mk.a ? W(mk.a.x, mk.a.y) : null) : mk.sa !== null ? W(mk.sa, mk.a.z) : null;
      if (!A) continue;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6;
      if (mk.b) {
        const Bp = mode === 'plan' ? W(mk.b.x, mk.b.y) : mk.sb !== null && mk.sb !== undefined ? W(mk.sb, mk.b.z) : null;
        if (Bp) { ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Bp[0], Bp[1]); ctx.stroke(); }
      }
      ctx.beginPath(); ctx.arc(A[0], A[1], 5, 0, Math.PI * 2); ctx.stroke();
      if (mk.label) { ctx.font = '10px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(mk.label, A[0] + 7, A[1] - 3); }
    }

    // ---- axis labels in display units    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = COL.label;
    const dx = stepDecimals(stepX), dy = stepDecimals(stepY);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const xv of xs) {
      const px = W(xv * f, 0)[0];
      if (px > 46 && px < s.w - 20) ctx.fillText(xv.toFixed(dx), px, s.h - 3);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const yv of ys) {
      const py = W(0, yv * f)[1];
      if (py > 22 && py < s.h - 18) ctx.fillText(yv.toFixed(dy), 4, py);
    }
    if (mode === 'plan') {
      const barPx = stepX * f * v.scale;
      const bx = s.w - 16, by = s.h - 22;
      ctx.strokeStyle = '#c9d2db'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx - barPx, by - 4); ctx.lineTo(bx - barPx, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by - 4); ctx.stroke();
      ctx.fillStyle = '#c9d2db'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${stepX.toFixed(dx)} ${unitLabel(sys, 'length')}`, bx, by - 6);
    }
  }, [mode, sys, mopv, mocgp]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    if (size.current.w === 0) return;
    vp.current = fitBounds(bounds(), size.current, aspect);
    fitted.current = true;
    schedule();
  }, [aspect, bounds, schedule]);

  useEffect(() => {
    const el = wrap.current;
    const c = canvas.current;
    if (!el || !c) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: r.width, h: r.height };
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      if (!fitted.current) fit(); else schedule();
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); };
  }, [fit, schedule]);

  // Zoom extents on request, when another project is opened, and when the profile first becomes available.
  const hasProfile = mode === 'profile' && anyGeom;
  useEffect(() => { fit(); }, [fitSignal, project?.id, hasProfile]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { vp.current = { ...vp.current, aspect }; schedule(); }, [aspect, schedule]);
  const breakLines = project?.terrain.breakLines;
  const stationDisplay = project?.settings.stationDisplay;
  const markers = useApp((s) => s.markers);
  const clearanceLine = useApp((s) => s.project?.criteria.clearanceLine);
  const attachments = useApp((s) => s.project?.attachments);
  const annotations = useApp((s) => s.project?.drafting.annotations);
  useEffect(() => { schedule(); }, [d, breakLines, stationDisplay, selection, markers, clearanceLine, attachments, annotations, schedule]);

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const report = (px: number, py: number) => {
    const [wx, wy] = screenToWorld(vp.current, size.current, px, py);
    const dd = dRef.current;
    if (mode === 'plan') {
      const so = dd.line?.geom ? projectPoint(dd.line.geom, wx, wy) : null;
      setCursor({ x: wx, y: wy, station: so?.station ?? null, offset: so?.offset ?? null, elevation: dd.tin ? tinElevation(dd.tin, wx, wy) : null });
    } else if (dd.lines.some((l) => l.geom)) setCursor({ x: null, y: null, station: wx, offset: null, elevation: wy });
  };

  const toScreen = (p: XY) => worldToScreen(vp.current, size.current, p.x, p.y);

  /**
   * World position of a click: an existing P.I. within reach (so that branches and loops
   * connect exactly, §6.3.1.2), else a survey point within reach, else the cursor position.
   */
  const snapped = (px: number, py: number, exceptPi?: string): XY => {
    let best: XY | null = null;
    let bestD = HIT_PX;
    for (const l of dRef.current.lines) {
      for (const p of l.alignment.pis) {
        if (p.id === exceptPi) continue;
        const [qx, qy] = toScreen(p);
        const dist = Math.hypot(qx - px, qy - py);
        if (dist < bestD) { bestD = dist; best = { x: p.x, y: p.y }; }
      }
    }
    if (best) return best;
    for (const p of dRef.current.points) {
      const [qx, qy] = toScreen(p);
      const dist = Math.hypot(qx - px, qy - py);
      if (dist < bestD) { bestD = dist; best = { x: p.x, y: p.y }; }
    }
    if (best) return best;
    const [x, y] = screenToWorld(vp.current, size.current, px, py);
    return { x, y };
  };

  /** P.I. under the cursor: of the active alignment, or (anyAlignment) of any alignment. */
  const piAt = (px: number, py: number, anyAlignment = false): { id: string; alignmentId: string } | null => {
    const dd = dRef.current;
    const order = anyAlignment ? dd.lines : dd.line ? [dd.line] : [];
    for (const l of order) {
      for (const p of l.alignment.pis) {
        const [qx, qy] = toScreen(p);
        if (Math.hypot(qx - px, qy - py) <= HIT_PX) return { id: p.id, alignmentId: l.alignment.id };
      }
    }
    return null;
  };

  /** Structure under the cursor: its base in plan, its vertical in profile. */
  const structureAt = (px: number, py: number): string | null => {
    let best: string | null = null;
    let bestD = HIT_PX;
    for (const sd of dRef.current.model.structures) {
      if (mode === 'plan') {
        if (!sd.frame) continue;
        const [qx, qy] = worldToScreen(vp.current, size.current, sd.frame.baseX, sd.frame.baseY);
        const dist = Math.hypot(qx - px, qy - py);
        if (dist < bestD) { bestD = dist; best = sd.s.id; }
      } else {
        if (sd.baseZ === null || sd.topZ === null || !Number.isFinite(sd.station)) continue;
        const [qx, yb] = worldToScreen(vp.current, size.current, sd.station, sd.baseZ);
        const yt = worldToScreen(vp.current, size.current, sd.station, sd.topZ)[1];
        if (py < yt - 14 || py > yb + 6) continue;
        const dist = Math.abs(qx - px);
        if (dist < bestD) { bestD = dist; best = sd.s.id; }
      }
    }
    return best;
  };

  /** Section whose wire chord passes within reach of the cursor. */
  const sectionAt = (px: number, py: number): string | null => {
    const toPx = (a: number, b: number) => worldToScreen(vp.current, size.current, a, b);
    for (const sec of dRef.current.model.sections) {
      const shape = dRef.current.analysis.sections.get(sec.section.id)?.shape;
      const lines = mode === 'plan' ? (shape?.plan ?? sec.wires).map((w) => w.map((p) => toPx(p.x, p.y))) : (shape?.profile ?? sec.profile).map((w) => w.map((p) => toPx(p.station, p.z)));
      for (const l of lines) {
        for (let i = 1; i < l.length; i++) {
          const [ax, ay] = l[i - 1]!, [bx, by] = l[i]!;
          const vx = bx - ax, vy = by - ay;
          const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
          if (Math.hypot(px - (ax + vx * t), py - (ay + vy * t)) < 5) return sec.section.id;
        }
      }
    }
    return null;
  };

  const isPiTool = tool === 'addPi' || tool === 'insertPi' || tool === 'movePi' || tool === 'deletePi';
  const isStrTool = tool === 'addStructure' || tool === 'moveStructure' || tool === 'deleteStructure' || tool === 'sagSection';
  // P.I. tools work in the plan view and structure tools in the profile view, as in PLS-CADD.
  const planTool: Tool = (mode === 'plan' && isPiTool) || (mode === 'profile' && isStrTool) ? tool : 'select';
  const unprojectable = d.lines.reduce((n, l) => n + l.unprojectable, 0);

  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvas}
        style={{ cursor: planTool === 'select' ? 'grab' : 'crosshair', touchAction: 'none' }}
        onWheel={(e) => {
          const [px, py] = local(e);
          vp.current = zoomAt(vp.current, size.current, px, py, Math.pow(1.0015, -e.deltaY));
          schedule();
          report(px, py);
        }}
        onPointerDown={(e) => {
          const [px, py] = local(e);
          if (e.button === 2) { if (planTool !== 'select') useApp.getState().setTool('select'); return; }
          if (e.button !== 0) return;
          press.current = { x: px, y: py, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
          if (planTool === 'moveStructure') {
            const id = structureAt(px, py);
            const sd = id ? dRef.current.model.byId.get(id) : undefined;
            if (sd) dragStr.current = { id: sd.s.id, station: sd.station };
          }
          if (planTool === 'movePi') {
            const hit = piAt(px, py);
            const pi = dRef.current.line?.alignment.pis.find((p) => p.id === hit?.id);
            if (pi) dragPi.current = { id: pi.id, x: pi.x, y: pi.y };
          }
        }}
        onPointerMove={(e) => {
          const [px, py] = local(e);
          const pr = press.current;
          if (pr) {
            if (!pr.moved && Math.hypot(px - pr.x, py - pr.y) > 3) pr.moved = true;
            if (dragStr.current) {
              dragStr.current = { ...dragStr.current, station: screenToWorld(vp.current, size.current, px, py)[0] };
              schedule();
            } else if (dragPi.current) {
              const w = snapped(px, py, dragPi.current.id);
              dragPi.current = { ...dragPi.current, x: w.x, y: w.y };
              schedule();
            } else if (pr.moved) {
              vp.current = panBy(vp.current, e.movementX, e.movementY);
              schedule();
            }
          }
          report(px, py);
        }}
        onPointerUp={(e) => {
          const [px, py] = local(e);
          const pr = press.current;
          press.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          if (!pr) return;
          const ds = dragStr.current;
          dragStr.current = null;
          if (ds) {
            if (pr.moved) moveStructure(ds.id, ds.station);
            schedule();
            return;
          }
          const drag = dragPi.current;
          dragPi.current = null;
          if (drag) {
            if (pr.moved) movePi(drag.id, drag.x, drag.y);
            schedule();
            return;
          }
          if (pr.moved) return;
          if (planTool === 'addStructure') { addStructureAtProfile(screenToWorld(vp.current, size.current, px, py)[0]); return; }
          if (planTool === 'deleteStructure') { const id = structureAt(px, py); if (id) void deleteStructures([id]); return; }
          if (planTool === 'sagSection') {
            const sel = useApp.getState().selection;
            if (sel?.kind !== 'section') { useApp.getState().addLog('warning', 'Graphical sag: select the section first (click one of its wires).'); return; }
            const [st, z] = screenToWorld(vp.current, size.current, px, py);
            if (sagThroughPoint(sel.id, st, z)) useApp.getState().setTool('select');
            return;
          }
          if (planTool === 'select') {
            // Select tool: a structure or a section under the cursor becomes the selection.
            const sid = structureAt(px, py);
            if (sid) { useApp.getState().select({ kind: 'structure', id: sid }); return; }
            const secId = sectionAt(px, py);
            if (secId) { useApp.getState().select({ kind: 'section', id: secId }); return; }
          }
          if (mode !== 'plan') return;
          if (planTool === 'addPi') { const w = snapped(px, py); addPi(w.x, w.y); }
          else if (planTool === 'insertPi') { const w = snapped(px, py); insertPi(w.x, w.y); }
          else if (planTool === 'deletePi') { const hit = piAt(px, py); if (hit) deletePi(hit.id); }
          else {
            // Select tool: clicking a P.I. makes its alignment the active one.
            const hit = piAt(px, py, true);
            if (hit) {
              useApp.getState().setActiveAlignment(hit.alignmentId);
              useApp.getState().select({ kind: 'node', id: 'alignments', label: 'Alignments' });
            }
          }
        }}
        onPointerLeave={() => { if (!press.current) setCursor({ x: null, y: null, station: null, offset: null, elevation: null }); }}
        onDoubleClick={() => { if (planTool === 'select') fit(); }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="view-top">
        <div className="view-hint">
          {mode === 'profile'
            ? (planTool === 'addStructure' ? 'Click to add the selected structure type at that station · right-click to finish'
              : planTool === 'moveStructure' ? 'Drag a structure along the line (snaps to P.I.s) · right-click to finish'
              : planTool === 'deleteStructure' ? 'Click a structure to remove it · right-click to finish'
              : planTool === 'sagSection' ? 'Click the point the wire of the selected section must pass through (sagging condition) · right-click to cancel'
              : anyGeom
              ? `Click a structure or wire to select it · centerline ground profile: ${d.centerlineSource === 'tin' ? 'cut through the TIN' : 'ground points within MOCGP, joined by station (§6.3.2)'}`
              : 'No alignment yet — define P.I. points in the Plan view (Add PI) to see the ground profile')
            : planTool === 'select' ? 'Drag to pan · wheel to zoom · double-click to zoom extents · click a P.I. to select its alignment'
              : planTool === 'addPi' ? 'Click to add a P.I. at the end of the active alignment (snaps to P.I.s and survey points) · right-click to finish'
                : planTool === 'insertPi' ? 'Click to insert a P.I. into the nearest segment of the active alignment · right-click to finish'
                  : planTool === 'movePi' ? 'Drag a P.I. of the active alignment (snaps to P.I.s and survey points) · right-click to finish'
                    : 'Click a P.I. of the active alignment to delete it · right-click to finish'}
        </div>
        <div className="view-badge">
          {mode === 'plan'
            ? `N ↑${d.points.length ? ` · ${d.points.length} pts` : ''}${d.tin ? ` · TIN ${d.tin.triangles.length / 3} tri` : ''}`
            : `Sta → · Elev ↑ (${unitLabel(sys, 'length')}) · ${aspect}:1${d.lines.length === 1 && unprojectable ? ` · ${unprojectable} pts not projectable` : ''}`}
        </div>
      </div>
    </div>
  );
}
