import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canRedo, canUndo, CriteriaSchema, ProjectSchema, type FeatureCode } from '@tlcad/model';
import { packArchive, pagesToDxf, pagesToPdf, parseDxf, reportToPdf, unpackArchive } from '@tlcad/io';
import { useApp } from '../store/appStore';
import { importXyzFile, addPi } from '../commands/terrain';
import { addSection, addStructure, importLibrary, spotAtPis } from '../commands/line';
import { autoSagSection, saveCriteria } from '../commands/sag';
import { currentView } from '../commands/drafting';
import { sectionLimitChecks, structureResult, minVerticalProblems } from '../store/analysis';
import { gallopingSpans, surveyClearances, tinClearances, wireClearances } from '../store/clearances';
import { loadTrees } from '../store/loads';
import { buildSheets } from '../drafting/sheets';
import { buildReport, REPORTS } from '../drafting/reports';
import { billOfMaterial } from '../drafting/bom';
import { buildLineKmz } from '../drafting/kmz';

/**
 * End-to-end workflow on the Demo Line sample (samples/demo_line), through the
 * same commands the user interface calls: import survey → alignment → criteria
 * → library → spot → string → sag → checks → sheets → reports → archive, with
 * no manual data fixes. Fails if any step logs an error. A summary of the
 * results is written to docs/validation/demo_line_results.json for the
 * validation report.
 */

// Vitest runs from the repository root (vitest.config.ts).
const root = process.cwd();
const sample = (f: string) => readFileSync(join(root, 'samples', 'demo_line', f), 'utf8');
const app = () => useApp.getState();
const errors = () => app().log.filter((l) => l.level === 'error').map((l) => l.text);

describe('Demo Line end-to-end workflow', () => {
  it('runs the whole design workflow without errors', async () => {
    const t0 = performance.now();
    const times: Record<string, number> = {};
    const lap = (k: string, t: number) => { times[k] = Math.round((performance.now() - t) * 10) / 10; };

    // 1. New project, survey import.
    await app().newProject({ name: 'Demo Line', unitSystem: 'SI_N', lineName: 'Demo 230 kV' });
    let t = performance.now();
    await importXyzFile(new File([sample('terrain.xyz')], 'terrain.xyz'));
    lap('import', t);
    expect(app().project!.terrain.points).toHaveLength(648);

    // 2. Feature code clearances (Terrain ▸ Feature Codes) and TIN.
    const fc = JSON.parse(sample('feature_codes.json')) as { voltages: number[]; codes: Omit<FeatureCode, 'src'>[] };
    app().exec('Feature codes', (d) => {
      d.terrain.voltages = fc.voltages;
      d.terrain.featureCodes = fc.codes.map((c) => ({ ...c, src: 'user' as const }));
      d.settings.terrain.tinEnabled = true;
    });

    // 3. Alignment: P.I.s entered in the plan view.
    const al = JSON.parse(sample('alignment.json')) as { pis: { x: number; y: number }[] };
    for (const q of al.pis) addPi(q.x, q.y);
    const alignmentId = app().project!.alignments[0]!.id;

    // 4. Library and criteria.
    await importLibrary(new File([sample('library.json')], 'library.json'));
    const lib = app().project!;
    const tangent = lib.structureLibrary.find((x) => x.name.startsWith('Demo tangent'))!;
    const deadEnd = lib.structureLibrary.find((x) => x.name.startsWith('Demo dead end'))!;
    const cable = lib.cableLibrary[0]!;
    expect(saveCriteria(CriteriaSchema.parse(JSON.parse(sample('criteria.json'))))).toBe(true);

    // 5. Spotting: dead ends at the P.I.s, tangents equally spaced between them.
    spotAtPis(deadEnd.id, alignmentId);
    let v = currentView()!;
    const piSt = v.lines[0]!.geom!.stations;
    for (let k = 0; k + 1 < piSt.length; k++) for (const f of [1 / 3, 2 / 3]) addStructure(tangent.id, alignmentId, piSt[k]! + (piSt[k + 1]! - piSt[k]!) * f);
    v = currentView()!;
    expect(v.model.structures).toHaveLength(7);
    expect(v.model.structures.every((s) => s.problems.length === 0)).toBe(true);

    // 6. Stringing: one section between each pair of dead ends.
    const byNo = v.model.structures;
    for (const [a, b] of [[0, 3], [3, 6]] as const) {
      addSection({
        cableId: cable.id, voltageKV: 230, conductorsPerPhase: 1,
        steps: byNo.slice(a, b + 1).map((s) => ({ structureId: s.s.id, set: 1, transposition: '123' })),
      });
    }

    // 7. Automatic sagging of every section.
    t = performance.now();
    for (const s of app().project!.sections) autoSagSection(s.id);
    lap('autosag', t);
    expect(errors()).toEqual([]);
    v = currentView()!;
    const sections = [...v.analysis.sections.values()];
    expect(sections.every((s) => s.status === 'sagged')).toBe(true);

    // 8. Checks.
    t = performance.now();
    const limits = sections.flatMap((sa) => sectionLimitChecks(app().project!, sa).map((c) => ({ section: `${sa.sd.from}-${sa.sd.to}`, limit: c.src.id, usage: c.check?.usage ?? null, ok: c.check?.ok ?? false })));
    const structs = v.model.structures.map((sd) => {
      const r = structureResult(app().project!, v.analysis, sd);
      return {
        no: sd.number, type: sd.type!.name, windSpan: r.sets[0]?.windSpan ?? null, weightSpans: r.sets[0]?.weightSpans ?? [],
        swingMax: Math.max(...(r.sets[0]?.swings.map((w) => Math.abs(w.max)) ?? [0])), swingOk: r.sets.every((s) => s.swings.every((w) => w.ok)),
        method1: r.method1?.usage ?? null, uplift: minVerticalProblems(r).length,
      };
    });
    const survey = surveyClearances(app().project!, v, v.analysis);
    const tin = tinClearances(app().project!, v, v.analysis);
    const wires = wireClearances(app().project!, v.analysis);
    const gallop = gallopingSpans(app().project!, v.analysis);
    const loads = loadTrees(app().project!, v, v.analysis, v.model.structures[1]!);
    lap('checks', t);
    expect(limits.length).toBe(6);
    expect(limits.every((l) => l.usage !== null)).toBe(true);
    expect(survey.problems).toEqual([]);
    expect(survey.checkedPoints).toBeGreaterThan(600);
    expect(tin.problems).toEqual([]);
    expect(tin.results.length).toBe(sections.length * 3 * 3); // 3 spans × 3 phases per section
    expect(wires.problems).toEqual([]);
    expect(gallop.problems).toEqual([]);
    expect(loads.results).toHaveLength(3);
    expect(loads.results.every((r) => r.attachments.length === 3 && r.problems.length === 0)).toBe(true);

    // 9. Sheets, reports, bill of material, KMZ.
    t = performance.now();
    const sheets = buildSheets(app().project!, v);
    lap('sheets', t);
    expect(sheets.problems).toEqual([]);
    expect(sheets.pages.length).toBeGreaterThan(1);
    const pdf = pagesToPdf(sheets.pages);
    expect(String.fromCharCode(...pdf.slice(0, 8))).toBe('%PDF-1.4');
    const dxf = parseDxf(pagesToDxf(sheets.pages));
    expect(dxf.entities.length).toBeGreaterThan(100);
    t = performance.now();
    for (const [k] of REPORTS) {
      const r = buildReport(k, app().project!, v);
      expect(r.tables.length).toBeGreaterThan(0);
      expect(reportToPdf(r).length).toBeGreaterThan(500);
    }
    lap('reports', t);
    const bom = billOfMaterial(app().project!, v.model, v.analysis);
    const cableLen = bom.rows.find((r) => r.stock === 'DEMO-COND')!.qty;
    app().exec('Coordinate system', (d) => { d.settings.crs = { name: 'WGS 84 / UTM zone 18N', epsg: 32618, definition: '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs' }; });
    const kmz = buildLineKmz(app().project!, currentView()!);
    expect(kmz.ok).toBe(true);

    // 10. Archive round trip and the undo stack.
    const p = app().project!;
    const back = unpackArchive(packArchive(p));
    expect(back.ok).toBe(true);
    if (back.ok) expect(ProjectSchema.parse(back.content.project)).toEqual(ProjectSchema.parse(p));
    const before = JSON.stringify(p);
    let undos = 0;
    while (canUndo(app().history)) { app().undo(); undos++; }
    expect(app().project!.structures).toHaveLength(0);
    while (canRedo(app().history)) app().redo();
    expect(JSON.stringify(app().project)).toBe(before);
    expect(errors()).toEqual([]);

    // Summary for the validation report.
    times.total = Math.round(performance.now() - t0);
    const summary = {
      generated: new Date().toISOString(), points: p.terrain.points.length, structures: v.model.structures.length, sheets: sheets.pages.length,
      sections: sections.map((sa) => ({ span: `${sa.sd.from}-${sa.sd.to}`, rulingSpan: sa.rulingSpan, H: sa.sd.section.sagging.H })),
      limits, structures_: structs,
      survey: { checked: survey.checkedPoints, violations: survey.results.filter((x) => x.status === 'violation').map((x) => [x.code, x.description, x.condition, x.margin]), questionable: survey.results.filter((x) => x.status === 'questionable').length },
      tinMin: Math.min(...tin.results.map((x) => x.distance)), wiresMin: Math.min(...wires.results.map((x) => x.clearance)),
      gallopingOverlaps: gallop.results.filter((g) => g.pairs.some((q) => q.overlap)).length,
      cableLength: cableLen, undoSteps: undos, timesMs: times,
    };
    mkdirSync(join(root, 'docs', 'validation'), { recursive: true });
    writeFileSync(join(root, 'docs', 'validation', 'demo_line_results.json'), JSON.stringify(summary, null, 1));
  }, 60000);
});
