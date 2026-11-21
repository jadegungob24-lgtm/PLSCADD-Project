import { z } from 'zod';
import { equalSpacing, projectPoint, transpositions } from '@tlcad/engine';
import {
  CableSchema, newId, StructureTypeSchema, structureSets,
  type Cable, type PlacedStructure, type Project, type Section, type StructureType,
} from '@tlcad/model';
import { useApp } from '../store/appStore';
import { computeDerived, activeIndex } from '../store/derived';
import { computeLineModel } from '../store/lineModel';

/** Conductor library, structure library, spotting and stringing commands. All edits are undoable. */

const app = () => useApp.getState();
const log = (level: 'info' | 'warning' | 'error' | 'result', text: string) => app().addLog(level, text);

// ------------------------------------------------------------------ Cable library

export function saveCable(c: Cable) {
  const r = CableSchema.safeParse(c);
  if (!r.success) { log('error', `Cable not saved: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`); return false; }
  const p = app().project!;
  if (p.cableLibrary.some((k) => k.id !== c.id && k.name === c.name)) { log('error', `A cable named "${c.name}" already exists.`); return false; }
  const exists = p.cableLibrary.some((k) => k.id === c.id);
  app().exec(exists ? `Edit cable ${c.name}` : `Add cable ${c.name}`, (d) => {
    const i = d.cableLibrary.findIndex((k) => k.id === c.id);
    if (i >= 0) d.cableLibrary[i] = r.data; else d.cableLibrary.push(r.data);
  });
  return true;
}

export function deleteCable(id: string) {
  const p = app().project!;
  const used = p.sections.filter((s) => s.cableId === id).length;
  if (used) { log('warning', `The cable is used by ${used} section(s); remove or re-string them first.`); return; }
  app().exec('Delete cable', (d) => { d.cableLibrary = d.cableLibrary.filter((k) => k.id !== id); });
}

// ------------------------------------------------------------------ Structure library

export function saveStructureType(t: StructureType) {
  const r = StructureTypeSchema.safeParse(t);
  if (!r.success) { log('error', `Structure not saved: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`); return false; }
  const p = app().project!;
  if (p.structureLibrary.some((k) => k.id !== t.id && k.name === t.name)) { log('error', `A structure named "${t.name}" already exists.`); return false; }
  const exists = p.structureLibrary.some((k) => k.id === t.id);
  app().exec(exists ? `Edit structure ${t.name}` : `Add structure ${t.name}`, (d) => {
    const i = d.structureLibrary.findIndex((k) => k.id === t.id);
    if (i >= 0) d.structureLibrary[i] = r.data; else d.structureLibrary.push(r.data);
  });
  return true;
}

export function deleteStructureType(id: string) {
  const p = app().project!;
  const used = p.structures.filter((s) => s.typeId === id).length;
  if (used) { log('warning', `The structure type is used by ${used} spotted structure(s); change or remove them first.`); return; }
  app().exec('Delete structure type', (d) => { d.structureLibrary = d.structureLibrary.filter((k) => k.id !== id); });
}

/**
 * Structure family (App. F.1.6 "Multiple Save", and the WAPCOS +3/+6/+9 practice): copies of a
 * type with the same top geometry and strength data and a different height. Names are
 * `<base name>+<increment>`; the increment is in the project's display unit.
 */
export function createFamily(baseId: string, increments: { label: string; deltaHeight: number }[]) {
  const p = app().project!;
  const base = p.structureLibrary.find((t) => t.id === baseId);
  if (!base) return;
  const baseName = base.name.replace(/\+\d+(\.\d+)?$/, '');
  const made: StructureType[] = [];
  for (const inc of increments) {
    const name = `${baseName}+${inc.label}`;
    if (p.structureLibrary.some((t) => t.name === name) || made.some((t) => t.name === name)) {
      log('warning', `"${name}" already exists and was not created.`);
      continue;
    }
    if (!(base.height + inc.deltaHeight > 0)) { log('warning', `"${name}" would have no height and was not created.`); continue; }
    made.push({ ...structuredClone(base), id: newId(), name, height: base.height + inc.deltaHeight, src: 'user' });
  }
  if (!made.length) return;
  app().exec(`Create ${made.length} structure(s) of the ${baseName} family`, (d) => { d.structureLibrary.push(...made); });
  log('info', `Created ${made.map((t) => t.name).join(', ')} from ${base.name}: same top geometry and strength data, different height. ` +
    'Allowable spans normally depend on height: review the strength tables of the new structures.');
}

// ------------------------------------------------------------------ Library files

const LibraryFileSchema = z.object({
  format: z.literal('tlcad-library'),
  version: z.literal(1),
  cables: z.array(CableSchema),
  structures: z.array(StructureTypeSchema),
});

/** Export the cable and structure libraries as a JSON file (own format: PLS-CADD cable and structure file formats are not documented). */
export function exportLibrary() {
  const p = app().project!;
  const text = JSON.stringify({ format: 'tlcad-library', version: 1, cables: p.cableLibrary, structures: p.structureLibrary }, null, 1);
  const name = `${p.meta.name.replace(/[^\w\-. ]+/g, '_')} library.json`;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log('info', `Exported ${name}: ${p.cableLibrary.length} cable(s), ${p.structureLibrary.length} structure type(s).`);
}

/** Import cables and structure types from a library file; items whose name already exists are skipped. */
export async function importLibrary(file: File) {
  let data: unknown;
  try { data = JSON.parse(await file.text()); } catch { log('error', `${file.name}: not a JSON file.`); return; }
  const r = LibraryFileSchema.safeParse(data);
  if (!r.success) { log('error', `${file.name}: not a valid TLCAD library file (${r.error.issues[0]?.path.join('.')}: ${r.error.issues[0]?.message}).`); return; }
  const p = app().project!;
  const cables = r.data.cables.filter((c) => !p.cableLibrary.some((k) => k.name === c.name)).map((c) => ({ ...c, id: newId(), src: 'imported' as const }));
  const types = r.data.structures.filter((t) => !p.structureLibrary.some((k) => k.name === t.name)).map((t) => ({ ...t, id: newId(), src: 'imported' as const }));
  const skipped = r.data.cables.length - cables.length + r.data.structures.length - types.length;
  if (!cables.length && !types.length) { log('warning', `${file.name}: every item already exists in the project; nothing was imported.`); return; }
  app().exec(`Import library ${file.name}`, (d) => { d.cableLibrary.push(...cables); d.structureLibrary.push(...types); });
  log('info', `${file.name}: imported ${cables.length} cable(s) and ${types.length} structure type(s)${skipped ? `; ${skipped} with existing names were skipped` : ''}.`);
}

// ------------------------------------------------------------------ Spotting

function newPlaced(typeId: string, alignmentId: string, station: number, offset = 0): PlacedStructure {
  return {
    id: newId(), typeId, alignmentId, station, offset, heightAdjust: 0, orientation: 0, label: '',
    counterweights: {}, comment: '', material: [], src: 'user',
  };
}

/** Alignment geometry by alignment id, and the local station of a virtual-profile station. */
function lineOf(p: Project, alignmentId: string) {
  const d = computeDerived(p);
  const i = p.alignments.findIndex((a) => a.id === alignmentId);
  return i >= 0 ? d.lines[i] ?? null : null;
}

/** Add a structure at a virtual-profile station of an alignment (Structures/ Add, §10.2.2). */
export function addStructure(typeId: string, alignmentId: string, virtualStation: number, offset = 0, extra: Partial<PlacedStructure> = {}) {
  const p = app().project!;
  const line = lineOf(p, alignmentId);
  if (!line?.geom) { log('error', 'The alignment needs at least two P.I.s before structures can be spotted on it.'); return null; }
  const local = virtualStation - line.geom.startStation;
  if (local < -1e-6 || local > line.geom.totalLength + 1e-6) { log('warning', 'Structures can only be spotted between the first and last P.I. of an alignment.'); return null; }
  const s = { ...newPlaced(typeId, alignmentId, Math.min(line.geom.totalLength, Math.max(0, local)), offset), ...extra };
  app().exec('Add structure', (d) => { d.structures.push(s); });
  const m = computeLineModel(app().project, computeDerived(app().project));
  const sd = m.byId.get(s.id);
  if (sd?.problems.length) log('warning', `Structure ${sd.number}: ${sd.problems.join(' ')}`);
  return s.id;
}

/** Add a structure where the user clicked in the profile view: on the active alignment, offset 0. */
export function addStructureAtProfile(virtualStation: number) {
  const p = app().project!;
  const typeId = app().spotTypeId;
  if (!typeId || !p.structureLibrary.some((t) => t.id === typeId)) { app().openDialog('spot'); return; }
  // In the virtual profile the click may fall on any alignment's station range.
  const d = computeDerived(p);
  const hit = d.lines.find((l) => l.geom && virtualStation >= l.geom.startStation - 1e-6 && virtualStation <= l.geom.startStation + l.geom.totalLength + 1e-6);
  if (!hit) { log('warning', 'Click within the station range of an alignment.'); return; }
  const id = addStructure(typeId, hit.alignment.id, virtualStation);
  if (id) app().select({ kind: 'structure', id });
}

export function moveStructure(id: string, virtualStation: number) {
  const p = app().project!;
  const s = p.structures.find((k) => k.id === id);
  if (!s) return;
  const line = lineOf(p, s.alignmentId);
  if (!line?.geom) return;
  const local = Math.min(line.geom.totalLength, Math.max(0, virtualStation - line.geom.startStation));
  // Snap to a P.I. within 0.5 % of the leg so that angle structures land exactly on the line angle.
  let snapped = local;
  for (let i = 0; i < line.geom.stations.length; i++) {
    const piLocal = line.geom.stations[i]! - line.geom.startStation;
    if (Math.abs(piLocal - local) < Math.max(0.05, line.geom.totalLength * 0.002)) snapped = piLocal;
  }
  app().exec('Move structure', (d) => {
    const k = d.structures.find((q) => q.id === id);
    if (k) { k.station = snapped; k.src = 'user'; }
  });
}

/** Edit placed-structure fields (Structure Modify box). */
export function editStructure(id: string, label: string, patch: Partial<PlacedStructure>) {
  app().exec(label, (d) => {
    const k = d.structures.find((q) => q.id === id);
    if (k) Object.assign(k, patch, { src: 'user' });
  });
}

/** Sections that use a structure. */
export function sectionsUsing(p: Project, structureIds: Set<string>): Section[] {
  return p.sections.filter((s) => s.steps.some((st) => structureIds.has(st.structureId)));
}

/** Remove structures; sections strung through them are removed in the same undoable step (§10.2.2 Remove). */
export async function deleteStructures(ids: string[]) {
  const p = app().project!;
  const set = new Set(ids);
  const affected = sectionsUsing(p, set);
  if (affected.length) {
    const ok = await app().ask({
      title: 'Remove structures',
      message: `${affected.length} tension section(s) are strung through the structure(s) and will be removed as well. You can undo this.`,
      confirmLabel: 'Remove', danger: true,
    });
    if (!ok) return;
  }
  const secIds = new Set(affected.map((s) => s.id));
  app().exec(ids.length === 1 ? 'Remove structure' : `Remove ${ids.length} structures`, (d) => {
    d.structures = d.structures.filter((s) => !set.has(s.id));
    d.sections = d.sections.filter((s) => !secIds.has(s.id));
  });
  if (app().selection?.kind === 'structure' && set.has((app().selection as { id: string }).id)) app().select(null);
}

/** Spot structures at equal spacing between two stations, both ends included (N-paste, §10.2.3.2). */
export function spotEqual(typeId: string, alignmentId: string, from: number, to: number, spans: number) {
  const p = app().project!;
  const line = lineOf(p, alignmentId);
  if (!line?.geom) return;
  const g = line.geom;
  const stations = equalSpacing(from, to, spans).map((s) => s - g.startStation);
  if (stations.some((s) => s < -1e-6 || s > g.totalLength + 1e-6)) { log('error', 'Both stations must lie on the alignment.'); return; }
  const list = stations.map((s) => newPlaced(typeId, alignmentId, Math.min(g.totalLength, Math.max(0, s))));
  app().exec(`Spot ${list.length} structures`, (d) => { d.structures.push(...list); });
  log('info', `Spotted ${list.length} structures at a spacing of ${((to - from) / spans).toFixed(3)} m.`);
}

/**
 * Spot one structure type at every line angle and at both ends of an alignment
 * (Structures/ Automatic Spotting/ Angle Structures, §10.2.1.2). P.I.s that
 * already carry a structure are skipped. Change the types afterwards to suit each angle.
 */
export function spotAtPis(typeId: string, alignmentId: string) {
  const p = app().project!;
  const line = lineOf(p, alignmentId);
  if (!line?.geom) { log('error', 'The alignment needs at least two P.I.s.'); return; }
  const g = line.geom;
  const occupied = p.structures.filter((s) => s.alignmentId === alignmentId).map((s) => s.station);
  const list = g.stations
    .map((s) => s - g.startStation)
    .filter((s) => !occupied.some((o) => Math.abs(o - s) < 0.01))
    .map((s) => newPlaced(typeId, alignmentId, s));
  if (!list.length) { log('info', 'Every P.I. of the alignment already has a structure.'); return; }
  app().exec(`Spot ${list.length} angle structures`, (d) => { d.structures.push(...list); });
  log('info', `Spotted ${list.length} structure(s) at the P.I.s of "${line.alignment.name}". Change each to the type suited to its line angle (Structure Table).`);
}

/**
 * Spot a structure at every survey point with a feature code (Structures/ Automatic Spotting/
 * Spot at Feature Code, §10.2.1.1), at the point's station and offset on the alignment.
 */
export function spotAtFeatureCode(typeId: string, alignmentId: string, code: number, useOffset: boolean) {
  const p = app().project!;
  const line = lineOf(p, alignmentId);
  if (!line?.geom) return;
  const g = line.geom;
  const list: PlacedStructure[] = [];
  let outside = 0;
  for (const q of p.terrain.points) {
    if (!q.active || q.code !== code) continue;
    const so = projectPoint(g, q.x, q.y);
    const local = so ? so.station - g.startStation : NaN;
    if (!so || local < -1e-6 || local > g.totalLength + 1e-6) { outside++; continue; }
    list.push({ ...newPlaced(typeId, alignmentId, Math.min(g.totalLength, Math.max(0, local)), useOffset ? so.offset : 0), comment: q.desc });
  }
  if (outside) log('warning', `${outside} point(s) with code ${code} are not alongside the alignment and were skipped.`);
  if (!list.length) { log('warning', `No point with feature code ${code} lies alongside the alignment.`); return; }
  app().exec(`Spot ${list.length} structures at feature code ${code}`, (d) => { d.structures.push(...list); });
  log('info', `Spotted ${list.length} structure(s) at points with feature code ${code}.`);
}

/** Active alignment id, for dialogs. */
export function activeAlignmentId(): string | null {
  const p = app().project;
  const i = activeIndex(p, app().activeAlignmentId);
  return i >= 0 ? p!.alignments[i]!.id : null;
}

// ------------------------------------------------------------------ Stringing

/** Sets already used at a structure, by role, so a set is not strung twice (§10.3.1). */
export function setUsage(p: Project) {
  const m = computeLineModel(p, computeDerived(p));
  const use = new Map<string, { start: boolean; end: boolean; middle: boolean }>();
  const key = (sid: string, set: number) => `${sid}:${set}`;
  for (const s of p.sections) {
    const att = s.steps.filter((st) => st.set !== null);
    att.forEach((st, i) => {
      const k = key(st.structureId, st.set!);
      const u = use.get(k) ?? { start: false, end: false, middle: false };
      if (i === 0) u.start = true; else if (i === att.length - 1) u.end = true; else u.middle = true;
      use.set(k, u);
    });
  }
  return { model: m, isUsed: (sid: string, set: number, role: 'start' | 'end' | 'middle') => {
    const u = use.get(key(sid, set));
    if (!u) return false;
    // A dead-end set may end one section and start the next; any other use is exclusive.
    if (u.middle) return true;
    return role === 'start' ? u.start : role === 'end' ? u.end : u.start || u.end;
  } };
}

export function addSection(s: Omit<Section, 'id' | 'src' | 'sagging'>) {
  const id = newId();
  const sagging: Section['sagging'] = { condition: 'initial', temperature: 15, H: null, rulingSpanOverride: null, src: 'default' };
  app().exec('String section', (d) => { d.sections.push({ ...s, id, sagging, src: 'user' }); });
  const sd = computeLineModel(app().project, computeDerived(app().project)).sections.find((k) => k.section.id === id);
  if (sd?.problems.length) log('warning', `New section: ${sd.problems.join(' ')}`);
  else log('info', `Strung a section from structure ${sd?.from} to ${sd?.to}. It is not sagged yet: enter its sagging tension in the section properties (or use Automatic sagging); until then its wires are dashed straight chords.`);
  return id;
}

export function deleteSection(id: string) {
  app().exec('Remove section', (d) => { d.sections = d.sections.filter((s) => s.id !== id); });
  if (app().selection?.kind === 'section') app().select(null);
}

export { structureSets, transpositions };
