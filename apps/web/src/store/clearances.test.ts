import { describe, expect, it } from 'vitest';
import { planeCatenary } from '@tlcad/engine';
import type { Project, WeatherCase } from '@tlcad/model';
import { computeDerived } from './derived';
import { computeLineModel } from './lineModel';
import { computeAnalysis, stateAt, structureResult } from './analysis';
import { gallopingSpans, surveyClearances, wireClearances } from './clearances';
import { loadTrees } from './loads';
import { lineProject, testCable } from './testFixtures';

const wc = (id: string, over: Partial<WeatherCase>): WeatherCase => ({
  id, name: id, airDensity: 0.613, windPressure: 0, iceThickness: 0, iceDensity: 0, iceLoad: 0, temperature: 15,
  weatherLoadFactor: 1, nescK: 0, gustFactor: 1, src: 'user', ...over,
});

/** Test line, sagged at H = 20 kN, no transposition, structure 2 raised so the line is level. */
function project(): Project {
  const p = lineProject();
  p.cableLibrary = [testCable()];
  p.sections[0]!.sagging = { condition: 'initial', temperature: 15, H: 20000, rulingSpanOverride: null, src: 'user' };
  p.sections[0]!.steps.forEach((s) => { s.transposition = '123'; });
  p.structures.find((s) => s.id === 's2')!.heightAdjust = 2;
  p.criteria.weatherCases = [wc('calm', {}), wc('wind', { windPressure: 300 }), wc('ice', { iceThickness: 0.0127, iceDensity: 8820, temperature: 0 })];
  p.terrain.featureCodes = [
    { code: 200, description: 'Ground', onGround: true, aerial: false, color: '#888', clearances: { 230: { rv: 6, rh: null } }, src: 'user' },
    { code: 300, description: 'Building', onGround: false, aerial: false, color: '#c00', clearances: { 230: { rv: 5, rh: 2 } }, src: 'user' },
  ];
  return p;
}
const run = (p: Project) => {
  const d = computeDerived(p);
  const m = computeLineModel(p, d);
  return { d, m, a: computeAnalysis(p, d, m) };
};

describe('survey point clearances (§6.1.1)', () => {
  it('flags a building under the middle phase and reports the margin to the zone', () => {
    const p = project();
    p.criteria.surveyClearance = { conditions: [{ weatherId: 'calm', condition: 'initial' }], type: 'rectangular', maxHorizontal: null };
    // Building 20 m tall at mid-span of span 1, on the centre line.
    p.terrain.points.push({ id: 'b1', desc: 'shed', x: 0, y: 75, z: 100, code: 300, h: 20, profNote: '', planNote: '', active: true, src: 'user' });
    const { d, a } = run(p);
    const r = surveyClearances(p, d, a);
    const b = r.results.find((x) => x.pointId === 'b1')!;
    expect(b.status).toBe('violation');
    expect(b.kind).toBe('rectangle');
    // Middle phase (x = 0) is directly above: the governing edge is the top of the zone, RV above the roof.
    expect(Math.abs(b.lateral!)).toBeLessThan(1e-6);
    expect(b.margin).toBeCloseTo(b.vertical! - 5, 9);
    // Hand check of the wire height with Eq. J-7 / catenary in the vertical plane: chord from the dead-end wire to s2.
    const sa = a.sections.get('sec')!;
    const O = sa.sd.wires[1]![0]!, E = sa.sd.wires[1]![1]!;
    const h = Math.hypot(E.x - O.x, E.y - O.y), C = 20000 / 15;
    const pc = planeCatenary(h, E.z - O.z, C);
    const x = 75 - O.y;
    const z = O.z + C * (Math.cosh((x - pc.a) / C) - Math.cosh(pc.a / C));
    expect(b.vertical! + 120).toBeCloseTo(z, 2);
    // Ground points carry RV = 6 with no RH: a band check, here comfortably clear.
    const g = r.results.find((x) => x.code === 200)!;
    expect(g.kind).toBe('band');
    expect(g.status).toBe('ok');
  });

  it('radial check uses the 3-D distance against RV', () => {
    const p = project();
    p.criteria.surveyClearance = { conditions: [{ weatherId: 'calm', condition: 'initial' }], type: 'radial', maxHorizontal: null };
    p.terrain.points.push({ id: 'b1', desc: '', x: 0, y: 75, z: 100, code: 300, h: 20, profNote: '', planNote: '', active: true, src: 'user' });
    const { d, a } = run(p);
    const b = surveyClearances(p, d, a).results.find((x) => x.pointId === 'b1')!;
    expect(b.kind).toBe('radial');
    expect(b.margin).toBeCloseTo(b.distance! - 5, 12);
    expect(b.status).toBe(b.distance! < 5 ? 'violation' : 'ok');
  });

  it('checks wind from both sides', () => {
    const p = project();
    p.criteria.surveyClearance = { conditions: [{ weatherId: 'wind', condition: 'initial' }], type: 'rectangular', maxHorizontal: null };
    p.terrain.points.push({ id: 'b1', desc: '', x: 6, y: 75, z: 100, code: 300, h: 18, profNote: '', planNote: '', active: true, src: 'user' });
    const { d, a } = run(p);
    const b = surveyClearances(p, d, a).results.find((x) => x.pointId === 'b1')!;
    // The building is east of the line: wind to the right (east) governs.
    expect(b.condition).toContain('wind right');
  });
});

describe('wire clearances (§11.2.3.2)', () => {
  it('phase-to-phase separation minus the conductor diameter', () => {
    const p = project();
    p.criteria.wireClearance = {
      source: { voltageKV: null, weatherId: 'calm', condition: 'initial', wind: 'right', straight: false, iceJump: false },
      target: { voltageKV: null, weatherId: 'calm', condition: 'initial', wind: 'right', straight: false, iceJump: false },
      measure: '3d', required: [{ sourceKV: 230, targetKV: 230, distance: 5 }],
    };
    const r = wireClearances(p, run(p).a);
    const worst = r.results[0]!;
    // Phases 4 m apart at equal height and sag: the closest pair is 4 m centre to centre.
    expect(worst.distance).toBeCloseTo(4, 2);
    expect(worst.clearance).toBeCloseTo(4 - 0.025, 2);
    expect(worst.status).toBe('violation');
  });

  it('ice jump raises the source wire above its un-iced position', () => {
    const p = project();
    p.criteria.wireClearance = {
      source: { voltageKV: null, weatherId: 'ice', condition: 'initial', wind: 'right', straight: false, iceJump: true },
      target: { voltageKV: null, weatherId: 'ice', condition: 'initial', wind: 'right', straight: false, iceJump: false },
      measure: '3d', required: [],
    };
    const r = wireClearances(p, run(p).a);
    expect(r.sourceLabel).toContain('ice jump');
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((x) => x.required === null && x.status === 'ok')).toBe(true);
  });
});

describe('galloping ellipses (§7.3.15)', () => {
  it('uses the span sag of the sag condition in Eq. 7-23', () => {
    const p = project();
    p.criteria.galloping = { method: 'reaSingle', sag: { weatherId: 'ice', condition: 'initial' }, swing: { weatherId: 'wind', condition: 'initial' }, gsf: 1, eswZero: false };
    const { a } = run(p);
    const r = gallopingSpans(p, a);
    const first = r.results[0]!;
    const ph = first.phases[1]!;
    expect(ph.params.major).toBeCloseTo(1.25 * ph.sag + 0.3048, 10);
    expect(ph.ssw).toBeCloseTo((Math.atan2(300 * 0.025, 15) * 180) / Math.PI, 9); // bare cable under 300 Pa
    expect(ph.params.esw).toBeCloseTo(ph.ssw / 2, 12);
    // Phases 4 m apart with ellipses about 2 m wide or more: neighbours overlap or nearly so.
    expect(first.pairs).toHaveLength(3);
  });
});

describe('structure load trees (§7.3.12)', () => {
  it('NA+ wind on a straight level line: factored V and T by statics, no net longitudinal load', () => {
    const p = project();
    // Clamp-height wires at structure 2 (zero-length insulators, no height adjustment): exactly level spans.
    p.structures.find((s) => s.id === 's2')!.heightAdjust = 0;
    p.structureLibrary.find((x) => x.id === 'T-S')!.attachments.forEach((at) => { at.length = 0; });
    p.criteria.loadCases = [{ id: 'L1', name: 'NESC-like', weatherId: 'wind', condition: 'initial', windDirection: 'NA+', wb: 0, lfv: 1.5, lfw: 2.5, lft: 1.65, lfs: 1 }];
    const { d, m, a } = run(p);
    const r = loadTrees(p, d, a, m.byId.get('s2')!);
    const lc = r.results[0]!;
    const mid = lc.attachments.find((x) => x.attachment.phase === 2)!;
    // Each level span carries UR × arc; half goes to each support (symmetry), split into UH and UV.
    const sa = a.sections.get('sec')!;
    const cs = stateAt(p, sa, 'wind', 'initial');
    if (!cs.ok) throw new Error(cs.message);
    const C = cs.H / cs.loads.ur;
    // The line is exactly level, so each support takes half of each span's arc: UR × arc / 2, split into UV and UH.
    let arcs = 0;
    for (const s of [sa.phases[1]![0]!, sa.phases[1]![1]!]) { expect(s.E.z - s.O.z).toBeCloseTo(0, 12); arcs += planeCatenary(Math.hypot(s.E.x - s.O.x, s.E.y - s.O.y), 0, C).arc / 2; }
    expect(mid.vertical).toBeCloseTo(1.5 * 15 * arcs, 6);
    expect(mid.transverse).toBeCloseTo(2.5 * 300 * 0.025 * arcs, 6);
    expect(Math.abs(mid.longitudinal)).toBeLessThan(1e-6);
    // Structure pressure: wind along TS.
    expect(lc.sprt).toBeCloseTo(2.5 * 300, 9);
    expect(lc.sprl).toBeCloseTo(0, 9);
  });
});

describe('Method 2 interaction diagrams (§8.3.2)', () => {
  it('checks the wind and weight spans of each interaction condition', () => {
    const p = project();
    p.criteria.interactionConditions = [{ weatherId: 'calm', condition: 'initial' }];
    const t = p.structureLibrary.find((x) => x.id === 'T-S')!;
    t.strength = { method: 'method2', validity: '', rows: [], ranges: [{ maxAngle: 5, diagrams: [[[0, 0], [200, 0], [200, 300], [0, 300]]] }] };
    const { m, a } = run(p);
    const r = structureResult(p, a, m.byId.get('s2')!);
    const row = r.method2!.rows[0]!;
    expect(row.inside).toBe(true);
    // Weight span / wind span < 1.5, so the ray leaves the box through HS = 200.
    expect(row.usage).toBeCloseTo((100 * row.windSpan) / 200, 9);
    expect(r.method2!.ok).toBe(true);
  });
});
