import {
  buildAlignment, elevationOnTin, FT, indexTin, isGeographic, makeTransformer, stationToXY, tinProfile, WGS84_GEOGRAPHIC, withoutSmallAngles,
  type Transformer, type XY,
} from '@tlcad/engine';
import { addTerrainPoints, idBatch, missingCodes, newId, type Crs, type Project, type TerrainPoint } from '@tlcad/model';
import {
  demToPoints, parseAsciiGrid, parseBrk, parseDelimited, parseGeoTiff, parseLas, parsePfl, parseXlsx, parseXyz, readLasInfo, sheetToTsv,
  writeBrk, writePfl, writeXyz,
  type DelimitedOptions, type DemGrid, type DemOptions, type ImportMessage, type LasInfo, type LasOptions, type PflOrigin,
} from '@tlcad/io';
import { APP_VERSION, useApp } from '../store/appStore';
import { activeIndex, computeDerived } from '../store/derived';

/** Terrain and alignment commands. Every change goes through exec() and is undoable. */

const app = () => useApp.getState();
/** Upper limit on points created by one DEM or LAS import, to keep the browser responsive. */
export const MAX_IMPORT_POINTS = 1_000_000;

function report(fileName: string, messages: ImportMessage[]) {
  for (const m of messages) app().addLog(m.level, `${fileName}: ${m.text}`);
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileBase = (p: Project) => p.meta.name.replace(/[^\w\-. ]+/g, '_');
const fileUnits = (p: Project) => (p.settings.unitSystem === 'US' ? 'US' : 'SI');

/** Add parsed points (and optionally an alignment) to the project as one undoable command. */
function commitPoints(fileName: string, points: TerrainPoint[], messages: ImportMessage[], alignment?: { pis: XY[]; startStation: number } | null, newCodesOnGround = true) {
  report(fileName, messages);
  const project = app().project;
  if (!project || points.length === 0) {
    if (points.length === 0 && !messages.some((m) => m.level === 'error')) app().addLog('error', `${fileName}: nothing was imported.`);
    return;
  }
  const newCodes = missingCodes(project, points.map((p) => p.code));
  const replaceAlignment = !!alignment && project.alignments.length > 0;
  app().exec(`Import ${points.length} terrain points`, (d) => {
    addTerrainPoints(d as Project, points, newCodesOnGround);
    if (alignment) {
      const nextId = idBatch();
      d.alignments = [{
        id: newId(), name: 'Alignment 1', startStation: alignment.startStation,
        pis: alignment.pis.map((p, i) => ({ id: nextId(), x: p.x, y: p.y, desc: `PI ${i + 1}`, src: 'imported' as const })),
      }];
    }
  });
  app().addLog('info', `${fileName}: imported ${points.length} terrain points.`);
  if (newCodes.length) {
    app().addLog('warning', `${fileName}: feature code(s) ${newCodes.join(', ')} were not in the feature code table and were created as ${newCodesOnGround ? 'ground' : 'non-ground'} codes. Review them in Terrain ▸ Feature Codes and Clearances.`);
  }
  if (alignment) app().addLog(replaceAlignment ? 'warning' : 'info', `${fileName}: ${replaceAlignment ? 'the existing alignments were replaced by' : 'created'} the alignment defined by the file (${alignment.pis.length} PIs).`);
  app().zoomExtents();
}

export async function importXyzFile(file: File) {
  const r = parseXyz(await file.text());
  commitPoints(file.name, r.points, r.messages);
}

/**
 * Delimited text or an Excel workbook (.xlsx): opens the column-mapping dialog. A workbook's
 * sheets are offered as tab-separated text; the first sheet with data is shown first.
 */
export async function beginCsvImport(file: File) {
  if (/\.xlsx$/i.test(file.name)) {
    let sheets;
    try { sheets = parseXlsx(new Uint8Array(await file.arrayBuffer())); } catch (e) { app().addLog('error', `${file.name}: ${e instanceof Error ? e.message : String(e)}`); return; }
    const list = sheets.map((s) => ({ name: s.name, text: sheetToTsv(s) }));
    const first = list.find((s) => s.text.trim() !== '') ?? list[0]!;
    app().setPendingFile({ name: file.name, text: first.text, sheets: list }, 'importCsv');
    return;
  }
  if (/\.xls$/i.test(file.name)) { app().addLog('error', `${file.name}: the old binary Excel format (.xls) is not supported. In Excel use File ▸ Save As ▸ Excel Workbook (.xlsx) or CSV.`); return; }
  app().setPendingFile({ name: file.name, text: await file.text() }, 'importCsv');
}

/** Coordinates pasted from Excel or another table (tab-separated when copied from a spreadsheet). */
export function beginPastedImport(text: string) {
  if (!text.trim()) { app().addLog('warning', 'Nothing was pasted.'); return; }
  app().setPendingFile({ name: 'Pasted coordinates', text }, 'importCsv');
}

/** Transformation from WGS 84 longitude/latitude to the project CRS, or null when the project has none. */
export function fromGeographic(p: Project): Transformer | null {
  return p.settings.crs ? makeTransformer(WGS84_GEOGRAPHIC, p.settings.crs.definition) : null;
}

export function finishCsvImport(options: DelimitedOptions, lonLat: boolean) {
  const f = app().pendingFile;
  const p = app().project;
  if (!f || !p) return;
  // Longitude/latitude columns are read as plain numbers, then projected to the project CRS.
  const r = parseDelimited(f.text, lonLat ? { ...options, unit: 'm' } : options);
  if (lonLat) {
    const t = fromGeographic(p);
    if (!t) { app().addLog('error', `${f.name}: longitude/latitude input needs a project coordinate system.`); return; }
    const zf = options.unit === 'ft' ? FT : 1;
    let bad = 0;
    r.points = r.points.filter((q) => {
      try { [q.x, q.y] = t.forward(q.x, q.y); q.z *= zf; q.h *= zf; return true; } catch { bad++; return false; }
    });
    if (bad) r.messages.push({ level: 'warning', text: `${bad} point(s) lie outside the project coordinate system and were skipped.` });
  }
  if (options.zMode === 'surface') {
    // Elevations from the TIN surface (§6.4); points outside it are left out and reported.
    const tin = computeDerived(p).tin;
    if (!tin) { app().addLog('error', `${f.name}: elevations from the TIN need the TIN (Terrain ▸ Use TIN) and enough ground points.`); return; }
    const ix = indexTin(tin, 25);
    let outside = 0;
    r.points = r.points.filter((q) => { const z = elevationOnTin(ix, q.x, q.y); if (z === null) { outside++; return false; } q.z = z; return true; });
    if (outside) r.messages.push({ level: 'warning', text: `${outside} point(s) lie outside the TIN surface, so they have no elevation, and were skipped.` });
  }
  // Points whose elevations are not surveyed (from the TIN or one value) are plot points: new codes are created off the
  // ground so the TIN and ground profiles do not change.
  const plotOnly = (options.zMode ?? 'column') !== 'column';
  if (plotOnly) {
    const ground = [...new Set(r.points.map((q) => q.code))].filter((c) => p.terrain.featureCodes.find((k) => k.code === c)?.onGround);
    if (ground.length) r.messages.push({ level: 'warning', text: `Feature code(s) ${ground.join(', ')} are ground codes, so these points will become part of the TIN and ground profiles. Use a code that is not on the ground to only plot them.` });
  }
  app().setPendingFile(null, null);
  commitPoints(f.name, r.points, r.messages, null, !plotOnly);
  // Show the imported points in the plan view.
  if (r.points.length) app().showView('plan');
}

export async function beginPflImport(file: File) {
  app().setPendingFile({ name: file.name, text: await file.text() }, 'importPfl');
}

export function finishPflImport(origin: PflOrigin) {
  const f = app().pendingFile;
  if (!f) return;
  const r = parsePfl(f.text, origin);
  app().setPendingFile(null, null);
  commitPoints(f.name, r.points, r.messages, r.alignment);
}

export function exportXyz() {
  const p = app().project;
  if (!p) return;
  const name = `${fileBase(p)}.xyz`;
  download(writeXyz(p, fileUnits(p), APP_VERSION), name);
  const n = p.terrain.points.filter((q) => q.active).length;
  app().addLog('info', `Exported ${name}: ${n} active terrain points, UNITS='${fileUnits(p)}' (PLS-CADD ASCII XYZ format).`);
}

export function exportPfl() {
  const p = app().project;
  if (!p) return;
  const d = computeDerived(p);
  const line = d.lines[activeIndex(p, app().activeAlignmentId)];
  if (!line?.geom) { app().addLog('error', 'PFL export needs an alignment with at least two P.I.s.'); return; }
  // A PFL file holds a single alignment whose stations start at its own origin.
  const g = buildAlignment(line.alignment.pis, p.alignments[0] === line.alignment ? line.alignment.startStation : 0)!;
  const r = writePfl(p, g, d.tin, fileUnits(p), APP_VERSION);
  const name = `${fileBase(p)}.pfl`;
  report(name, r.messages);
  if (!r.text) return;
  download(r.text, name);
  app().addLog('info', `Exported ${name} for "${line.alignment.name}". To re-import it at the same place use origin X ${g.pis[0]!.x.toFixed(3)} m, Y ${g.pis[0]!.y.toFixed(3)} m ` +
    `at station ${g.startStation.toFixed(3)} m and first-leg azimuth ${g.segments[0]!.azimuth.toFixed(6)}°.`);
}

// ------------------------------------------------------------------ Break lines

export async function importBrkFile(file: File) {
  const r = parseBrk(await file.text());
  report(file.name, r.messages);
  if (r.lines.length === 0) return;
  app().exec(`Import ${r.lines.length} break line segments`, (d) => { d.terrain.breakLines.push(...r.lines); });
  app().addLog('info', `${file.name}: imported ${r.lines.length} break line segments.`);
  const p = app().project!;
  if (!p.settings.terrain.tinEnabled) app().addLog('info', 'Break lines shape the TIN; turn the TIN on (Terrain menu) to see their effect.');
  else {
    const skipped = computeDerived(p).breakLinesSkipped;
    if (skipped) app().addLog('warning', `${skipped} break line segment(s) cross another break line or pass through a survey point and could not be enforced in the TIN.`);
  }
}

export function exportBrk() {
  const p = app().project;
  if (!p) return;
  const name = `${fileBase(p)}.brk`;
  download(writeBrk(p, fileUnits(p), APP_VERSION), name);
  app().addLog('info', `Exported ${name}: ${p.terrain.breakLines.length} break line segments.`);
}

export function deleteBreakLines() {
  app().exec('Delete all break lines', (d) => { d.terrain.breakLines = []; });
}

// ------------------------------------------------------------------ DEM and LAS

export interface PendingDem { grid: DemGrid }
export interface PendingLas { buffer: ArrayBuffer; info: LasInfo }

export async function beginDemImport(file: File) {
  const isTiff = /\.tiff?$/i.test(file.name);
  const r = isTiff ? await parseGeoTiff(await file.arrayBuffer()) : parseAsciiGrid(await file.text());
  report(file.name, r.messages);
  if (r.grid) app().setPendingData({ name: file.name, data: { grid: r.grid } satisfies PendingDem }, 'importDem');
}

export function finishDemImport(options: DemOptions) {
  const f = app().pendingData;
  if (!f) return;
  const r = demToPoints((f.data as PendingDem).grid, options);
  if (r.points.length === 0) { report(f.name, r.messages); return; } // keep the dialog open so the options can be corrected
  app().setPendingData(null, null);
  commitPoints(f.name, r.points, r.messages);
}

export async function beginLasImport(file: File) {
  const buffer = await file.arrayBuffer();
  const r = readLasInfo(buffer);
  report(file.name, r.messages);
  if (r.info && !r.messages.some((m) => m.level === 'error')) {
    app().setPendingData({ name: file.name, data: { buffer, info: r.info } satisfies PendingLas }, 'importLas');
  }
}

export function finishLasImport(options: LasOptions) {
  const f = app().pendingData;
  if (!f) return;
  const r = parseLas((f.data as PendingLas).buffer, options);
  if (r.points.length === 0) { report(f.name, r.messages); return; }
  app().setPendingData(null, null);
  commitPoints(f.name, r.points, r.messages);
}

// ------------------------------------------------------------------ Coordinate system

/** Define the project CRS; with `reproject`, transform all coordinates from the current CRS to the new one. */
export function setProjectCrs(crs: Crs, reproject: boolean) {
  const p = app().project;
  if (!p) return;
  if (isGeographic(crs.definition)) {
    app().addLog('error', 'The project coordinate system must be a projected system (coordinates in metres), not longitude/latitude.');
    return;
  }
  if (!reproject || !p.settings.crs) {
    app().exec('Define coordinate system', (d) => { d.settings.crs = crs; });
    app().addLog('info', `Coordinate system set to ${crs.name}. Coordinates were not changed.`);
    return;
  }
  let t: Transformer;
  try { t = makeTransformer(p.settings.crs.definition, crs.definition); } catch (e) {
    app().addLog('error', `Reprojection failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  try {
    // Check every coordinate first so that a failure cannot leave the project half transformed.
    const check = (x: number, y: number) => { t.forward(x, y); };
    for (const q of p.terrain.points) check(q.x, q.y);
    for (const a of p.alignments) for (const q of a.pis) check(q.x, q.y);
    for (const b of p.terrain.breakLines) { check(b.ax, b.ay); check(b.bx, b.by); }
  } catch (e) {
    app().addLog('error', `Reprojection failed, nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const from = p.settings.crs.name;
  app().exec('Reproject project', (d) => {
    for (const q of d.terrain.points) [q.x, q.y] = t.forward(q.x, q.y);
    for (const a of d.alignments) for (const q of a.pis) [q.x, q.y] = t.forward(q.x, q.y);
    for (const b of d.terrain.breakLines) { [b.ax, b.ay] = t.forward(b.ax, b.ay); [b.bx, b.by] = t.forward(b.bx, b.by); }
    d.settings.crs = crs;
  });
  app().addLog('info', `Project reprojected from ${from} to ${crs.name}: plan coordinates of survey points, P.I.s and break lines were transformed; elevations were not changed.`);
  app().zoomExtents();
}

// ------------------------------------------------------------------ Alignments

const ai = (): number => activeIndex(app().project, app().activeAlignmentId);

/** A PI may not coincide with a neighbour: a zero-length leg has no direction. */
function validPis(pis: XY[]): boolean {
  return pis.length < 2 || buildAlignment(pis) !== null;
}

function reject(what: string) {
  app().addLog('warning', `${what}: the point coincides with an adjacent P.I.; nothing was changed.`);
}

/**
 * Start a new alignment (manual §6.3.1.2). It becomes the active one; its P.I.s
 * are then added with Add P.I. A branch starts by clicking a P.I. of an existing
 * alignment, and a loop also ends on one — clicks snap to existing P.I.s.
 */
export function newAlignment() {
  const p = app().project;
  if (!p) return;
  const id = newId();
  app().exec('New alignment', (d) => {
    d.alignments.push({ id, name: `Alignment ${d.alignments.length + 1}`, startStation: 0, pis: [] });
  });
  app().setActiveAlignment(id);
  app().showView('plan');
  app().setTool('addPi');
}

/** Append a PI to the end of the active alignment (created on the first PI). */
export function addPi(x: number, y: number) {
  const p = app().project;
  if (!p) return;
  const i = ai();
  const a = p.alignments[i];
  if (a && !validPis([...a.pis, { x, y }])) { reject('Add P.I.'); return; }
  app().exec('Add P.I.', (d) => {
    if (i < 0) d.alignments.push({ id: newId(), name: 'Alignment 1', startStation: 0, pis: [] });
    const al = d.alignments[Math.max(i, 0)]!;
    al.pis.push({ id: newId(), x, y, desc: `PI ${al.pis.length + 1}`, src: 'user' });
  });
}

/** Insert a PI into the segment of the active alignment closest to the point ("Insert Automatic", §6.3.1.1). */
export function insertPi(x: number, y: number) {
  const p = app().project;
  const i = ai();
  const a = p?.alignments[i];
  if (!a || a.pis.length < 2) { addPi(x, y); return; }
  const g = buildAlignment(a.pis)!;
  // Closest segment by distance to the segment itself (not its extension).
  let best = 0;
  let bestD = Infinity;
  g.segments.forEach((s, k) => {
    const t = Math.min(s.length, Math.max(0, (x - s.ax) * s.dx + (y - s.ay) * s.dy));
    const dist = Math.hypot(x - (s.ax + s.dx * t), y - (s.ay + s.dy * t));
    if (dist < bestD) { bestD = dist; best = k; }
  });
  const next = [...a.pis.slice(0, best + 1), { x, y }, ...a.pis.slice(best + 1)];
  if (!validPis(next)) { reject('Insert P.I.'); return; }
  app().exec('Insert P.I.', (d) => {
    d.alignments[i]!.pis.splice(best + 1, 0, { id: newId(), x, y, desc: 'PI', src: 'user' });
  });
}

export function movePi(id: string, x: number, y: number) {
  const p = app().project;
  const i = ai();
  const a = p?.alignments[i];
  if (!a) return;
  if (!validPis(a.pis.map((q) => (q.id === id ? { x, y } : q)))) { reject('Move P.I.'); return; }
  app().exec('Move P.I.', (d) => {
    const q = d.alignments[i]!.pis.find((k) => k.id === id);
    if (q) { q.x = x; q.y = y; q.src = 'user'; }
  });
}

export function deletePi(id: string) {
  const p = app().project;
  const i = ai();
  const a = p?.alignments[i];
  if (!a) return;
  const next = a.pis.filter((q) => q.id !== id);
  if (!validPis(next)) { app().addLog('warning', 'Delete P.I.: the remaining neighbours coincide; nothing was changed.'); return; }
  app().exec('Delete P.I.', (d) => {
    const al = d.alignments[i]!;
    al.pis = al.pis.filter((q) => q.id !== id);
    if (al.pis.length === 0) d.alignments.splice(i, 1);
  });
}

/** Reverse the direction of the active alignment (§6.3.1.1). */
export function reverseAlignment() {
  const i = ai();
  if (i >= 0) app().exec('Reverse alignment', (d) => { d.alignments[i]!.pis.reverse(); });
}

export function deleteAlignment() {
  const i = ai();
  if (i < 0) return;
  app().exec('Delete alignment', (d) => { d.alignments.splice(i, 1); });
  app().setActiveAlignment(null);
}

/** Move the active alignment earlier or later in the virtual profile (§6.3.1.2 ordering). */
export function moveAlignment(delta: -1 | 1) {
  const i = ai();
  const p = app().project;
  if (!p || i < 0 || i + delta < 0 || i + delta >= p.alignments.length) return;
  // The true station of the first P.I. of the line stays with whichever alignment comes first.
  const first = p.alignments[0]!.startStation;
  app().exec('Reorder alignments', (d) => {
    const [a] = d.alignments.splice(i, 1);
    d.alignments.splice(i + delta, 0, a!);
    d.alignments.forEach((k, n) => { k.startStation = n === 0 ? first : 0; });
  });
}

/** Remove P.I.s with small line angles from the active alignment (§6.3.1.1 "Delete Small Angle PI"). */
export function deleteSmallAngles(maxAngleDeg: number) {
  const p = app().project;
  const i = ai();
  const a = p?.alignments[i];
  if (!a || a.pis.length < 3) return;
  const keep = new Set(withoutSmallAngles(a.pis, maxAngleDeg));
  const removed = a.pis.length - keep.size;
  if (removed === 0) { app().addLog('info', `No P.I. has a line angle of ${maxAngleDeg}° or less.`); return; }
  app().exec(`Delete ${removed} small-angle P.I.s`, (d) => {
    d.alignments[i]!.pis = d.alignments[i]!.pis.filter((_, k) => keep.has(k));
  });
  app().addLog('info', `Removed ${removed} P.I.(s) with line angles of ${maxAngleDeg}° or less. The manual's limit on how far a structure may move is not applied (no structures are spotted yet).`);
}

/**
 * Create an alignment through the survey points with a given feature code
 * (§6.3.1.1 "Automatic Alignment"). The manual does not state the order in
 * which the points are joined; the order of the points in the project is used.
 */
export function autoAlignment(code: number) {
  const p = app().project;
  if (!p) return;
  const pts = p.terrain.points.filter((q) => q.active && q.code === code);
  const pis: XY[] = [];
  for (const q of pts) {
    const last = pis[pis.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) pis.push({ x: q.x, y: q.y });
  }
  if (pis.length < 2) { app().addLog('warning', `Automatic alignment: fewer than two points have feature code ${code}.`); return; }
  const id = newId();
  app().exec('Automatic alignment', (d) => {
    const nextId = idBatch();
    d.alignments.push({
      id, name: `Alignment ${d.alignments.length + 1}`, startStation: 0,
      pis: pis.map((q, k) => ({ id: nextId(), x: q.x, y: q.y, desc: pts[k]?.desc || `PI ${k + 1}`, src: 'calculated' as const })),
    });
  });
  app().setActiveAlignment(id);
  app().addLog('info', `Created an alignment through ${pis.length} points with feature code ${code}, in the order the points are stored. Check the order in the Plan view.`);
}

/**
 * Create terrain points where the TIN triangle sides cross the centerline and
 * the given offset lines of the active alignment (§6.4.4 "Create interpolated
 * points"). The new points lie on the TIN surface and are described "TINPT".
 */
export function createInterpolatedPoints(offsets: number[], code: number) {
  const p = app().project;
  if (!p) return;
  const d = computeDerived(p);
  const line = d.lines[ai()];
  if (!d.tin || !line?.geom) { app().addLog('error', 'Interpolated points need the TIN and an alignment with at least two P.I.s.'); return; }
  const nextId = idBatch();
  const points: TerrainPoint[] = [];
  for (const off of offsets) {
    for (const v of tinProfile(d.tin, line.geom, off, false)) {
      const xy = stationToXY(line.geom, v.station, off);
      points.push({ id: nextId(), desc: 'TINPT', x: xy.x, y: xy.y, z: v.z, code, h: 0, profNote: '', planNote: '', active: true, src: 'calculated' });
    }
  }
  if (points.length === 0) { app().addLog('warning', 'No TIN triangle side crosses the selected lines.'); return; }
  app().exec(`Create ${points.length} interpolated points`, (dr) => { addTerrainPoints(dr as Project, points); });
  app().addLog('result', `Created ${points.length} TIN-interpolated points (TINPT) on ${offsets.length} line(s) of "${line.alignment.name}".`);
}
