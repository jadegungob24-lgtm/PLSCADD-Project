import { describe, expect, it } from 'vitest';
import { pagesToPdf, reportToCsv } from '@tlcad/io';
import type { Project } from '@tlcad/model';
import { computeDerived, type DerivedView } from '../store/derived';
import { computeLineModel } from '../store/lineModel';
import { computeAnalysis } from '../store/analysis';
import { lineProject, testCable } from '../store/testFixtures';
import { buildSheets, substitute } from './sheets';
import { billOfMaterial, cableLengths } from './bom';
import { buildReport, REPORTS } from './reports';

function project(): Project {
  const p = lineProject();
  p.cableLibrary = [{ ...testCable(), stockNumber: 'CBL-1' }];
  p.sections[0]!.sagging = { condition: 'initial', temperature: 15, H: 20000, rulingSpanOverride: null, src: 'user' };
  p.sections[0]!.steps.forEach((s) => { s.transposition = '123'; });
  return p;
}
function view(p: Project): DerivedView {
  const d = computeDerived(p);
  const model = computeLineModel(p, d);
  return { ...d, active: 0, line: d.lines[0] ?? null, model, analysis: computeAnalysis(p, d, model) };
}

describe('plan & profile sheets (§13)', () => {
  it('pages the line at the horizontal scale and repeats a structure near a page end', () => {
    const p = project();
    const s = p.drafting.sheets;
    s.hScale = 2; // 2 m per cm
    const d = view(p);
    const profileWidth = (s.page.width - s.margins.left - s.margins.right) * (s.areas.profile.xmax - s.areas.profile.xmin) / 100; // 390 mm
    const pageLen = (profileWidth / 10) * s.hScale; // 78 m of line per page
    s.commonOverlap = 10;
    const set = buildSheets(p, d);
    expect(set.sheets[0]!.from).toBe(1000);
    // Line 1000–1300: pages start every 78 m except where a structure lies within 10 m of a page end.
    for (let i = 1; i < set.sheets.length; i++) expect(set.sheets[i]!.from).toBeLessThanOrEqual(set.sheets[i - 1]!.from + pageLen + 1e-9);
    expect(set.sheets[set.sheets.length - 1]!.to).toBeGreaterThanOrEqual(1300 - 1e-6);
    // Sheet 2 runs 1078–1156; structure 2 at 1150 is within 10 m of the end, so sheet 3 starts there.
    expect(set.sheets[2]!.from).toBeCloseTo(1150, 9);
    expect(set.sheets[1]!.lastStructure).toBe('2');
    expect(set.sheets[2]!.firstStructure).toBe('2');
  });

  it('draws a structure at its scaled station and elevation', () => {
    const p = project();
    p.drafting.sheets.vScale = 5; // 1:500, so the 30 m structures fit the profile area
    const d = view(p);
    const set = buildSheets(p, d);
    const s = p.drafting.sheets;
    expect(set.sheets[0]!.cut).toBe(false);
    const x0 = s.margins.left + (s.page.width - s.margins.left - s.margins.right) * s.areas.profile.xmin / 100;
    const expected = x0 + (1150 - set.sheets[0]!.from) * (10 / s.hScale);
    const lines = set.pages[0]!.prims.filter((q) => q.kind === 'polyline' && q.layer === 'STRUCTURES' && Math.abs(q.pts[0]![0] - q.pts[1]![0]) < 1e-9 && q.pts[0]![1] !== q.pts[1]![1]);
    expect(lines.some((q) => q.kind === 'polyline' && Math.abs(q.pts[0]![0] - expected) < 1e-9)).toBe(true);
    // 30 m pole at the vertical scale.
    const pole = lines.find((q) => q.kind === 'polyline' && Math.abs(q.pts[0]![0] - expected) < 1e-9)!;
    if (pole.kind === 'polyline') expect(Math.abs(pole.pts[0]![1] - pole.pts[1]![1])).toBeCloseTo(30 * (10 / s.vScale), 9);
    // The sheets export as a valid multi-page PDF.
    const pdf = Array.from(pagesToPdf(set.pages), (b) => String.fromCharCode(b)).join('');
    expect(pdf).toContain(`/Count ${set.pages.length}`);
  });

  it('drawing one page keeps the information of every sheet', () => {
    const p = project();
    p.drafting.sheets.hScale = 2;
    const d = view(p);
    const all = buildSheets(p, d), one = buildSheets(p, d, { only: 2 });
    expect(one.sheets.map((x) => [x.from, x.firstStructure])).toEqual(all.sheets.map((x) => [x.from, x.firstStructure]));
    expect(one.pages[2]!.prims.length).toBe(all.pages[2]!.prims.length);
    expect(one.pages[0]!.prims).toHaveLength(0);
  });

  it('substitutes the title block codes', () => {
    const p = project();
    p.meta.lineName = 'Line A';
    const t = substitute('%n / %L sheet %p of %q, str %s3–%s4', p, { number: 2, from: 1000, to: 1100, firstStructure: '5', lastStructure: '9', zBottom: 0, cut: false }, 7);
    expect(t).toBe(`${p.meta.name} / Line A sheet 2 of 7, str 5–9`);
  });
});

describe('bill of material (§8.5)', () => {
  it('expands assemblies, counts structure and line material and adds cable lengths', () => {
    const p = project();
    p.materials = {
      parts: [
        { stock: 'INS', description: 'Insulator', unit: 'each', materialCost: 50, laborCost: 10 },
        { stock: 'CLAMP', description: 'Clamp', unit: 'each', materialCost: 20, laborCost: 5 },
        { stock: 'CBL-1', description: 'Test cable', unit: 'm', materialCost: 2, laborCost: 0 },
      ],
      assemblies: [{ stock: 'SUSP', description: 'Suspension assembly', unit: 'each', items: [{ stock: 'INS', qty: 4 }, { stock: 'CLAMP', qty: 1 }] }],
      line: [{ stock: 'CLAMP', qty: 2 }],
    };
    p.structureLibrary.find((t) => t.id === 'T-S')!.material = [{ stock: 'SUSP', qty: 3 }];
    p.structures.find((s) => s.id === 's1')!.material = [{ stock: 'MISSING', qty: 1 }];
    const d = view(p);
    const b = billOfMaterial(p, d.model, d.analysis);
    const row = (k: string) => b.rows.find((r) => r.stock === k)!;
    expect(row('INS').qty).toBe(12);                 // 3 assemblies × 4 on the one tangent structure
    expect(row('CLAMP').qty).toBe(3 + 2);             // assemblies + line-specific
    expect(row('INS').materialCost).toBe(600);
    expect(b.problems.some((m) => m.includes('"MISSING"'))).toBe(true);
    // Cable: 3 phases × 2 spans of arc length, a little longer than the chords.
    const sa = d.analysis.sections.get('sec')!;
    const chords = sa.phases.flat().reduce((s, g) => s + Math.hypot(g.E.x - g.O.x, g.E.y - g.O.y, g.E.z - g.O.z), 0);
    const L = cableLengths(p, d.analysis)[0]!.length;
    expect(L).toBeGreaterThan(chords);
    expect(L).toBeLessThan(chords * 1.002);
    expect(row('CBL-1').qty).toBeCloseTo(L, 9);
  });
});

describe('reports (§12)', () => {
  it('builds every report without error', () => {
    const p = project();
    const d = view(p);
    for (const [k] of REPORTS) {
      const r = buildReport(k, p, d);
      expect(r.tables.length).toBeGreaterThan(0);
      expect(reportToCsv(r).length).toBeGreaterThan(10);
    }
    const st = buildReport('staking', p, d).tables[0]!;
    expect(st.rows).toHaveLength(3);
    expect(st.rows[1]![1]).toBe('1+150.00');
  });
});
