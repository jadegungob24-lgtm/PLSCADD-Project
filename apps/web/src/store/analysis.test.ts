import { describe, expect, it } from 'vitest';
import { planeCatenary } from '@tlcad/engine';
import type { Project, WeatherCase } from '@tlcad/model';
import { computeDerived } from './derived';
import { computeLineModel } from './lineModel';
import { computeAnalysis, minVerticalProblems, sectionLimitChecks, structureResult } from './analysis';
import { lineProject, testCable } from './testFixtures';

/**
 * App-level sag-tension analysis on the three-structure test line: 2 spans of
 * about 150 m heading north, a suspension structure in the middle.
 */
const wc = (id: string, over: Partial<WeatherCase>): WeatherCase => ({
  id, name: id, airDensity: 0.613, windPressure: 0, iceThickness: 0, iceDensity: 0, iceLoad: 0, temperature: 15,
  weatherLoadFactor: 1, nescK: 0, gustFactor: 1, src: 'user', ...over,
});

function sagged(H = 20000): Project {
  const p = lineProject();
  p.cableLibrary = [testCable()];
  p.sections[0]!.sagging = { condition: 'initial', temperature: 15, H, rulingSpanOverride: null, src: 'user' };
  p.criteria.weatherCases = [wc('calm', {}), wc('wind', { windPressure: 300 })];
  p.criteria.weightSpanConditions = [{ weatherId: 'calm', condition: 'initial' }, { weatherId: null, condition: 'initial' }, { weatherId: null, condition: 'initial' }];
  p.criteria.swingConditions = [{ weatherId: 'wind', condition: 'initial' }, { weatherId: null, condition: 'initial' }, { weatherId: null, condition: 'initial' }, { weatherId: null, condition: 'initial' }];
  return p;
}

const run = (p: Project) => {
  const d = computeDerived(p);
  const m = computeLineModel(p, d);
  return { m, a: computeAnalysis(p, d, m) };
};

describe('sag-tension analysis of sections', () => {
  it('leaves an unsagged section as chords', () => {
    const p = sagged();
    p.sections[0]!.sagging.H = null;
    const sa = run(p).a.sections.get('sec')!;
    expect(sa.status).toBe('notSagged');
    expect(sa.shape).toBeNull();
    expect(sa.rulingSpanCalc).toBeGreaterThan(145);
    expect(sa.rulingSpanCalc).toBeLessThan(150.5);
  });

  it('draws sagged catenaries through the attachment points with the App. J sag', () => {
    const p = sagged(20000);
    const sa = run(p).a.sections.get('sec')!;
    expect(sa.status).toBe('sagged');
    const w = sa.shape!.plan[0]!;
    const chord = sa.sd.wires[0]!;
    expect(w[0]!.z).toBeCloseTo(chord[0]!.z, 9);
    expect(w[w.length - 1]!.z).toBeCloseTo(chord[2]!.z, 9);
    // Mid-span of span 1 (sample 12 of 24) lies the catenary sag below the chord.
    const O = chord[0]!, E = chord[1]!;
    const h = Math.hypot(E.x - O.x, E.y - O.y);
    const C = 20000 / 15;
    const pc = planeCatenary(h, E.z - O.z, C);
    const mid = w[12]!;
    const chordMid = (O.z + E.z) / 2;
    // Hand check of the vertical-plane catenary: the drop below the chord at mid-span equals the J-3 sag.
    expect(chordMid - mid.z).toBeCloseTo(pc.sag, 6);
    expect(pc.sag).toBeCloseTo(C * (Math.cosh(h / (2 * C)) - 1), 2); // nearly level span
    // Profile coordinates run from station 1000 to 1300.
    const pr = sa.shape!.profile[0]!;
    expect(pr[0]!.station).toBeGreaterThan(999);
    expect(pr[pr.length - 1]!.station).toBeLessThan(1301);
  });

  it('gives wind and weight spans; exact and arc-length models agree with no wind', () => {
    const p = sagged();
    const { m, a } = run(p);
    const r = structureResult(p, a, m.byId.get('s2')!);
    const set = r.sets[0]!;
    expect(set.windSpan).toBeGreaterThan(147);
    expect(set.windSpan).toBeLessThan(151);
    const exact = set.weightSpans[0]!;
    p.criteria.weightSpanModel = 'arcLength';
    const r2 = structureResult(p, run(p).a, m.byId.get('s2')!);
    expect(r2.sets[0]!.weightSpans[0]!).toBeCloseTo(exact, 3);
    // Hand check with Eq. J-7: the low point of each span lies a = h/2 − C·asinh(v / (2C·sinh(h/2C))) from its near end;
    // the weight span at s2 is the horizontal distance between the low points of the adjacent spans (no wind, bare cable).
    // The suspension wire hangs 2 m lower than the dead-end wires, so the low points move toward s2.
    const C = 20000 / 15;
    const sa = run(p).a.sections.get('sec')!;
    let hand = 0;
    for (const w of sa.sd.wires) {
      const lowFromNear = (O: NonNullable<typeof w[0]>, E: NonNullable<typeof w[0]>) => {
        const h = Math.hypot(E.x - O.x, E.y - O.y), v = E.z - O.z;
        return { h, a: h / 2 - C * Math.asinh(v / (2 * C * Math.sinh(h / (2 * C)))) };
      };
      const b = lowFromNear(w[0]!, w[1]!), f = lowFromNear(w[1]!, w[2]!);
      // Arc lengths from the low points: C·sinh(x/C).
      hand += (C * Math.sinh((b.h - b.a) / C) + C * Math.sinh(f.a / C)) / sa.sd.wires.length;
    }
    expect(exact).toBeCloseTo(hand, 6);
    expect(exact).toBeGreaterThan(105);
    expect(exact).toBeLessThan(120);
    expect(set.weightSpans[1]).toBeNull();
  });

  it('swings a weightless suspension insulator to atan(UH / UV) on a straight level line', () => {
    const p = sagged();
    // Raise s2 by the insulator length so that its wire is level with the dead-end wires.
    p.structures.find((s) => s.id === 's2')!.heightAdjust = 2;
    const { m, a } = run(p);
    const r = structureResult(p, a, m.byId.get('s2')!);
    const sw = r.sets[0]!.swings;
    expect(sw).toHaveLength(3);
    // The middle phase is not transposed, so its two spans are collinear: T / V = UH / UV for a level line.
    const s = sw.find((x) => x.attachment.phase === 2)!;
    const expected = (Math.atan2(300 * 0.025, 15) * 180) / Math.PI; // 26.565°
    // The dead-end strain insulators rise 3 cm along their chords, so the line is level to within 0.15°.
    expect(Math.abs(s.max - expected)).toBeLessThan(0.15);
    expect(Math.abs(s.min + expected)).toBeLessThan(0.15);
    expect(s.ok).toBe(true);
    // With an allowable range narrower than the swing the check fails.
    p.structureLibrary.find((t) => t.id === 'T-S')!.attachments.forEach((at) => { at.swing = [[-20, 20], [-90, 90], [-90, 90], [-90, 90]]; });
    const r2 = structureResult(p, run(p).a, run(p).m.byId.get('s2')!);
    expect(r2.sets[0]!.swings.find((x) => x.attachment.phase === 2)!.ok).toBe(false);
  });

  it('detects uplift at a low structure', () => {
    const p = sagged(30000);
    p.structures.find((s) => s.id === 's2')!.heightAdjust = -25;
    for (const at of p.structureLibrary.find((t) => t.id === 'T-S')!.attachments) at.minVertical = { kind: 'noUplift', value: 0 };
    const { m, a } = run(p);
    const r = structureResult(p, a, m.byId.get('s2')!);
    expect(r.sets[0]!.weightSpans[0]!).toBeLessThan(0);
    const probs = minVerticalProblems(r);
    expect(probs).toHaveLength(3);
    expect(probs[0]).toContain('uplift');
  });

  it('checks tension limits against the ruling span support tension', () => {
    const p = sagged(20000);
    p.criteria.tensionLimits = [{ id: 'L', weatherId: 'calm', condition: 'initial', maxPercentUltimate: 50, maxTension: null, maxCatenary: null, cableIds: [] }];
    const sa = run(p).a.sections.get('sec')!;
    const [c] = sectionLimitChecks(p, sa);
    expect(c!.check!.ok).toBe(true);
    // Support tension of the level ruling span: H + UW × sag (exact for a catenary).
    const C = 20000 / 15;
    const S = sa.rulingSpan;
    const T = 20000 + 15 * C * (Math.cosh(S / (2 * C)) - 1);
    // Usage is the tension as a percentage of the limit (50 % of ULT).
    expect(c!.check!.usage).toBeCloseTo((100 * T) / (0.5 * 1e5), 6);
  });

  it('displays blown-out wires for a wind weather case', () => {
    const p = sagged();
    p.criteria.display = { weatherId: 'wind', condition: 'initial', wind: 'right' };
    const sa = run(p).a.sections.get('sec')!;
    const w = sa.shape!.plan[0]!;
    const O = sa.sd.wires[0]![0]!, E = sa.sd.wires[0]![1]!;
    // Heading north, the right-hand side is east (+x).
    expect(w[12]!.x).toBeGreaterThan((O.x + E.x) / 2 + 0.5);
    expect(sa.shape!.label).toContain('wind');
  });
});
