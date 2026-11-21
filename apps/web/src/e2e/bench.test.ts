import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CriteriaSchema, newAttachment, type Project, type StructureType } from '@tlcad/model';
import { createProject } from '@tlcad/model';
import { computeDerived, type DerivedView } from '../store/derived';
import { computeLineModel } from '../store/lineModel';
import { computeAnalysis, structureResult } from '../store/analysis';
import { surveyClearances, tinClearances, wireClearances } from '../store/clearances';
import { buildSheets } from '../drafting/sheets';
import { buildReport } from '../drafting/reports';

/**
 * Performance benchmark on a large synthetic line (run with TLCAD_BENCH=1):
 * 30 km, 100 000 survey points with a TIN, 100 structures, 10 sections.
 * Results go to docs/validation/benchmark.json.
 */
const run = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TLCAD_BENCH === '1';

function bigProject(): Project {
  const p = createProject({ name: 'Benchmark line', unitSystem: 'SI_N' });
  const L = 30000, nPts = 100000;
  const pts = [];
  for (let i = 0; i < nPts; i++) {
    const s = (i / nPts) * L;
    const o = ((i * 7919) % 241) - 120;
    pts.push({ id: `p${i}`, desc: '', x: o, y: s, z: 200 + 15 * Math.sin(s / 400) + 0.05 * o + ((i * 31) % 7) * 0.1, code: 2, h: 0, profNote: '', planNote: '', active: true, src: 'user' as const });
  }
  p.terrain.points = pts;
  p.terrain.voltages = [230];
  p.terrain.featureCodes = [{ code: 2, description: 'Ground', onGround: true, aerial: false, color: '#7fd08a', clearances: { 230: { rv: 7, rh: null } }, src: 'user' }];
  p.settings.terrain.tinEnabled = true;
  p.alignments = [{ id: 'A', name: 'Main', startStation: 0, pis: [{ id: 'a', x: 0, y: 0, desc: '', src: 'user' }, { id: 'b', x: 0, y: L, desc: '', src: 'user' }] }];
  const mk = (id: string, insulator: 'suspension' | 'strain', deadEnd: boolean): StructureType => ({
    id, name: id, description: '', height: 30, embedment: null, cost: null, autoSpotMinAngle: 0, material: [], src: 'user',
    strength: { method: 'method1', validity: '', rows: [{ lineAngle: 0, maxWindSpan: 400, maxWeightSpan: [500, 500, 500], minWeightSpan: 0 }], ranges: [] },
    attachments: [-6, 0, 6].map((x, i) => ({ ...newAttachment(1, i + 1), insulator, deadEnd, length: 2.5, weight: 500, windArea: 0.2, x, y: 2, swing: insulator === 'suspension' ? [[-60, 60], [-60, 60], [-60, 60], [-60, 60]] as [number, number][] : null })),
  });
  p.structureLibrary = [mk('T', 'suspension', false), mk('D', 'strain', true)];
  const n = 100;
  p.structures = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, typeId: i % 10 === 0 || i === n - 1 ? 'D' : 'T', alignmentId: 'A', station: (i * L) / (n - 1), offset: 0, heightAdjust: 0, orientation: 0,
    label: '', counterweights: {}, comment: '', material: [], src: 'user' as const,
  }));
  p.cableLibrary = [{
    id: 'c', name: 'Bench cable', description: '', stockNumber: 'C', model: 'linear', area: 4e-4, diameter: 0.026, unitWeight: 15, ultimateTension: 1.2e5,
    independentCables: 1, gapType: false, testTemperature: 20, outer: { finalModulus: 7e8, thermalCoeff: 19e-6, initial: [0, 0, 0, 0, 0], creep: [0, 0, 0, 0, 0] },
    core: null, creepTemperatureShift: 10, outerCompression: { mode: 'criteria', limit: 0 }, color: '#f00', testData: null, src: 'user',
  }];
  const dead = p.structures.map((s, i) => (s.typeId === 'D' ? i : -1)).filter((i) => i >= 0);
  p.sections = dead.slice(1).map((b, k) => ({
    id: `sec${k}`, cableId: 'c', voltageKV: 230, conductorsPerPhase: 1, src: 'user' as const,
    sagging: { condition: 'initial' as const, temperature: 15, H: 22000, rulingSpanOverride: null, src: 'user' as const },
    steps: p.structures.slice(dead[k]!, b + 1).map((s) => ({ structureId: s.id, set: 1, transposition: '123' })),
  }));
  const w = (id: string, T: number, P = 0) => ({ id, name: id, airDensity: 0.613, windPressure: P, iceThickness: 0, iceDensity: 0, iceLoad: 0, temperature: T, weatherLoadFactor: 1, nescK: 0, gustFactor: 1, src: 'user' as const });
  p.criteria = CriteriaSchema.parse({
    notes: '', weatherCases: [w('ed', 15), w('hot', 75), w('wind', 10, 600)], creepWeatherId: 'ed',
    weightSpanConditions: [{ weatherId: 'ed', condition: 'initial' }, { weatherId: 'wind', condition: 'initial' }, { weatherId: 'hot', condition: 'initial' }],
    swingConditions: [{ weatherId: 'wind', condition: 'initial' }, { weatherId: null, condition: 'initial' }, { weatherId: null, condition: 'initial' }, { weatherId: null, condition: 'initial' }],
    surveyClearance: { conditions: [{ weatherId: 'hot', condition: 'creep' }, { weatherId: 'wind', condition: 'initial' }], type: 'rectangular', maxHorizontal: null },
    clearanceLine: { voltageKV: 230, groundCode: 2 },
  });
  return p;
}

describe.skipIf(!run)('benchmark', () => {
  it('large line', () => {
    const t: Record<string, number> = {};
    const time = <T,>(k: string, f: () => T): T => { const a = performance.now(); const r = f(); t[k] = Math.round(performance.now() - a); return r; };
    const p = time('build data', bigProject);
    const d = time('terrain + TIN + profiles', () => computeDerived(p));
    const model = time('line model', () => computeLineModel(p, d));
    const analysis = time('sag-tension (10 sections)', () => computeAnalysis(p, d, model));
    const v: DerivedView = { ...d, active: 0, line: d.lines[0]!, model, analysis };
    time('structure checks (100)', () => model.structures.forEach((sd) => structureResult(p, analysis, sd)));
    const sc = time('survey clearances (100k points)', () => surveyClearances(p, v, analysis));
    time('clearance to TIN', () => tinClearances(p, v, analysis));
    time('wire clearances', () => wireClearances(p, analysis));
    const sheets = time('P&P sheets', () => buildSheets(p, v));
    time('staking + sag-tension reports', () => { buildReport('staking', p, v); buildReport('sagTension', p, v); });
    expect(sc.checkedPoints).toBeGreaterThan(50000);
    mkdirSync(join(process.cwd(), 'docs', 'validation'), { recursive: true });
    writeFileSync(join(process.cwd(), 'docs', 'validation', 'benchmark.json'), JSON.stringify({ generated: new Date().toISOString(), points: p.terrain.points.length, triangles: (d.tin?.triangles.length ?? 0) / 3, structures: model.structures.length, sections: p.sections.length, sheets: sheets.pages.length, timesMs: t }, null, 1));
  }, 600000);
});
