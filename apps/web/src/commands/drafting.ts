import {
  pageToSvg, pagesToDxf, pagesToPdf, parseDxf, parseShapefile, reportToCsv, reportToHtml, reportToPdf, reportToSpreadsheetXml,
} from '@tlcad/io';
import {
  AnnotationSchema, AttachmentFileSchema, MaterialsSchema, SheetSettingsSchema, newId,
  type Annotation, type AttachmentFile, type Materials, type MaterialItem, type SheetSettings,
} from '@tlcad/model';
import { useApp } from '../store/appStore';
import { computeDerived, activeIndex, type DerivedView } from '../store/derived';
import { computeLineModel } from '../store/lineModel';
import { computeAnalysis } from '../store/analysis';
import { buildSheets } from '../drafting/sheets';
import { buildReport, type ReportKind } from '../drafting/reports';
import { buildLineKmz } from '../drafting/kmz';

/** Drafting, reports, attachments and materials commands (Phase 6). Edits are undoable. */

const app = () => useApp.getState();
const log = (level: 'info' | 'warning' | 'error' | 'result', text: string) => app().addLog(level, text);

export function downloadBytes(data: Uint8Array | string, fileName: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const base = () => (app().project?.meta.name ?? 'project').replace(/[^\w\-. ]+/g, '_');

/** The derived view (lines, model, analysis) computed from the store, for commands. */
export function currentView(): DerivedView | null {
  const p = app().project;
  if (!p) return null;
  const d = computeDerived(p);
  const model = computeLineModel(p, d);
  const active = activeIndex(p, app().activeAlignmentId);
  return { ...d, active, line: d.lines[active] ?? null, model, analysis: computeAnalysis(p, d, model) };
}

// ------------------------------------------------------------------ Sheets

export function exportSheets(format: 'pdf' | 'dxf' | 'svg', page?: number) {
  const p = app().project, d = currentView();
  if (!p || !d) return;
  const set = buildSheets(p, d);
  if (!set.pages.length) { log('error', `No sheets: ${set.problems.join(' ')}`); return; }
  const pages = page === undefined ? set.pages : [set.pages[page]!];
  if (format === 'pdf') downloadBytes(pagesToPdf(pages, { title: `${p.meta.name} — plan and profile` }), `${base()}_P&P.pdf`, 'application/pdf');
  else if (format === 'dxf') downloadBytes(pagesToDxf(pages), `${base()}_P&P${page === undefined ? '' : `_${page + 1}`}.dxf`, 'application/dxf');
  else downloadBytes(pageToSvg(pages[0]!), `${base()}_P&P_${(page ?? 0) + 1}.svg`, 'image/svg+xml');
  log('result', `Exported ${pages.length} plan & profile sheet(s) as ${format.toUpperCase()}.`);
}

export function saveSheetSettings(s: SheetSettings) {
  const r = SheetSettingsSchema.safeParse(s);
  if (!r.success) { log('error', `Sheet settings not saved: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`); return false; }
  const a = r.data.areas;
  for (const [k, v] of Object.entries(a)) if (v.xmin >= v.xmax || v.ymin >= v.ymax) { log('error', `The ${k} area has no size.`); return false; }
  app().exec('Edit sheet settings', (d) => { d.drafting.sheets = r.data; });
  return true;
}

export function saveAnnotations(list: Annotation[]) {
  for (const a of list) {
    const r = AnnotationSchema.safeParse(a);
    if (!r.success) { log('error', `Annotation not saved: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`); return false; }
    if (a.target === 'sheet' && a.sheet === null) { log('error', 'An annotation for one sheet needs its sheet number.'); return false; }
  }
  app().exec('Edit annotation', (d) => { d.drafting.annotations = list; });
  return true;
}

export const newAnnotation = (): Annotation => ({ id: newId(), target: 'allSheets', sheet: null, kind: 'text', pts: [[0.05, 0.05]], text: 'Text', height: 3, angle: 0, color: '#000000' });

// ------------------------------------------------------------------ Reports

export function exportReport(kind: ReportKind, format: 'pdf' | 'csv' | 'xls' | 'html') {
  const p = app().project, d = currentView();
  if (!p || !d) return;
  const r = buildReport(kind, p, d);
  const name = `${base()}_${kind}`;
  if (format === 'pdf') downloadBytes(reportToPdf(r), `${name}.pdf`, 'application/pdf');
  else if (format === 'csv') downloadBytes('﻿' + reportToCsv(r), `${name}.csv`, 'text/csv');
  else if (format === 'xls') downloadBytes(reportToSpreadsheetXml(r), `${name}.xml`, 'application/vnd.ms-excel');
  else downloadBytes(reportToHtml(r), `${name}.html`, 'text/html');
  log('result', `Exported the ${r.title.toLowerCase()} report as ${format.toUpperCase()}.`);
}

export function exportKmz() {
  const p = app().project, d = currentView();
  if (!p || !d) return;
  const r = buildLineKmz(p, d);
  if (!r.ok) { log('error', `KMZ not exported: ${r.message}`); return; }
  downloadBytes(r.bytes, `${base()}.kmz`, 'application/vnd.google-earth.kmz');
  log('result', `Exported ${r.count} placemarks to KMZ. Elevations are written as project elevations ("absolute" altitude).`);
}

// ------------------------------------------------------------------ Attachments (§6.6)

const MAX_IMAGE = 20 * 1024 * 1024;

export async function attachFile(file: File, view: AttachmentFile['view']) {
  const name = file.name;
  const ext = name.split('.').pop()?.toLowerCase();
  const baseAtt = { id: newId(), name, view, visible: true, color: view === 'sheets' ? '#000000' : '#5aa0ff', unitScale: view === 'sheets' ? 0.001 : 1, dx: 0, dy: 0, hiddenLayers: [], image: null };
  let att: AttachmentFile;
  try {
    if (ext === 'dxf') {
      const r = parseDxf(await file.text());
      att = { ...baseAtt, kind: 'dxf', entities: r.entities };
      const sk = Object.entries(r.skipped);
      log(sk.length ? 'warning' : 'info', `${name}: ${r.entities.length} entities in ${r.layers.length} layer(s).${sk.length ? ` Not drawn: ${sk.map(([k, n]) => `${n} ${k}`).join(', ')} (block inserts and hatches are not supported).` : ''}`);
    } else if (ext === 'shp') {
      const r = parseShapefile(await file.arrayBuffer());
      att = { ...baseAtt, kind: 'shp', entities: r.entities };
      log('info', `${name}: ${r.entities.length} shapes. Attributes (.dbf) are not read; coordinates must be in the project coordinate system.`);
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext ?? '')) {
      if (file.size > MAX_IMAGE) { log('error', `${name} is larger than 20 MB; reduce or tile the image first.`); return; }
      const href = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
      const dims = await new Promise<{ w: number; h: number }>((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 1, h: 1 }); im.src = href; });
      const d = currentView();
      // Initial placement: over the survey points' extent, keeping the aspect ratio; adjust in the attachment manager.
      const xs = d?.points.map((q) => q.x) ?? [], ys = d?.points.map((q) => q.y) ?? [];
      const x0 = xs.length ? Math.min(...xs) : 0, y1 = ys.length ? Math.max(...ys) : 0;
      const w = xs.length ? Math.max(10, Math.max(...xs) - x0) : 100;
      att = { ...baseAtt, view: 'plan', kind: 'image', entities: [], image: { href, x: x0, y: y1, width: w, height: (w * dims.h) / dims.w, rotation: 0 } };
      log('info', `${name}: ${dims.w}×${dims.h} px. Set its upper-left corner, size and rotation (or the world-file values) in the attachment manager.`);
    } else { log('error', `${name}: only DXF, SHP and PNG/JPG/GIF/WebP/BMP images can be attached.`); return; }
  } catch (e) { log('error', `${name}: ${e instanceof Error ? e.message : String(e)}`); return; }
  const r = AttachmentFileSchema.safeParse(att);
  if (!r.success) { log('error', `${name}: ${r.error.issues[0]?.message}`); return; }
  app().exec(`Attach ${name}`, (d) => { d.attachments.push(r.data); });
}

/** World file (.tfw/.jgw/.pgw/.wld): pixel size, rotation terms and the centre of the upper-left pixel (§6.6.2). */
export async function applyWorldFile(id: string, file: File) {
  const nums = (await file.text()).split(/\s+/).filter(Boolean).map(Number);
  if (nums.length < 6 || nums.some((v) => !Number.isFinite(v))) { log('error', 'The world file must hold six numbers.'); return; }
  const [a, d, b, e, c, f] = nums as [number, number, number, number, number, number];
  const att = app().project?.attachments.find((x) => x.id === id);
  if (!att?.image) return;
  const im = await new Promise<{ w: number; h: number }>((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = att.image!.href; });
  const px = Math.hypot(a, d), py = Math.hypot(b, e);
  const rot = (Math.atan2(d, a) * 180) / Math.PI;
  // c, f are the centre of the upper-left pixel; the corner is half a pixel up and left.
  const x = c - (a + b) / 2, y = f - (d + e) / 2;
  updateAttachment(id, { image: { ...att.image, x, y, width: px * im.w, height: py * im.h, rotation: rot } }, 'Apply world file');
}

export function updateAttachment(id: string, patch: Partial<AttachmentFile>, label = 'Edit attachment') {
  app().exec(label, (d) => { const a = d.attachments.find((x) => x.id === id); if (a) Object.assign(a, patch); });
}
export function deleteAttachment(id: string) {
  app().exec('Remove attachment', (d) => { d.attachments = d.attachments.filter((x) => x.id !== id); });
}

// ------------------------------------------------------------------ Materials (§8.5)

export function saveMaterials(m: Materials) {
  const r = MaterialsSchema.safeParse(m);
  if (!r.success) { log('error', `Materials not saved: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`); return false; }
  const stocks = [...r.data.parts.map((x) => x.stock), ...r.data.assemblies.map((x) => x.stock)];
  const dup = stocks.find((s, i) => stocks.indexOf(s) !== i);
  if (dup) { log('error', `Stock number "${dup}" is used twice.`); return false; }
  app().exec('Edit parts and assemblies', (d) => { d.materials = r.data; });
  return true;
}

export function setStructureTypeMaterial(typeId: string, items: MaterialItem[]) {
  app().exec('Edit structure material', (d) => { const t = d.structureLibrary.find((x) => x.id === typeId); if (t) t.material = items; });
}
export function setStructureSiteMaterial(id: string, items: MaterialItem[]) {
  app().exec('Edit structure-specific material', (d) => { const s = d.structures.find((x) => x.id === id); if (s) s.material = items; });
}
