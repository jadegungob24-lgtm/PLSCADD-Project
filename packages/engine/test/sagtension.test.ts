import { describe, expect, it } from 'vitest';
import {
  arcLengthWeightSpans, autoSag, cableStress, checkLimits, levelArcLength, levelAverageTension, levelSag, planeCatenary,
  rulingSpan, sectionState, solveRulingSpan, solveSection, solveSpan, suspensionSwing, unitLoads,
  type CableModel, type SectionSetup,
} from '../src';

/**
 * Test cable: values chosen for testing, not a real conductor. Elastic modulus
 * E = 6.0e8 Pa per % strain (60 GPa), area 400 mm², 15 N/m, 100 kN ultimate.
 */
const E = 6.0e8, A = 400e-6, w = 15, alpha = 23e-6;
const linear = (shift = 0): CableModel => ({
  model: 'linear', area: A, unitWeight: w, diameter: 0.025, ultimateTension: 100e3, testTemperature: 15,
  outer: { finalModulus: E, thermalCoeff: alpha, initial: [0, 0, 0, 0, 0], creep: [0, 0, 0, 0, 0] },
  core: null, creepTemperatureShift: shift, outerCompression: { mode: 'none', limit: 0 }, independentCables: 1, gapType: false,
});
/** The same elastic cable written as a nonlinear (polynomial) cable, with a constant creep elongation PC (%). */
const polyCable = (PC: number): CableModel => ({
  ...linear(), model: 'nonlinear',
  outer: { finalModulus: E, thermalCoeff: alpha, initial: [0, E, 0, 0, 0], creep: [-E * PC, E, 0, 0, 0] },
});

describe('catenary (App. J)', () => {
  it('level span identities', () => {
    const S = 300, C = 1500;
    expect(levelArcLength(S, C)).toBeCloseTo(2 * C * Math.sinh(S / (2 * C)), 9);
    expect(levelSag(S, C)).toBeCloseTo(C * (Math.cosh(0.1) - 1), 9);
    // Average tension lies between H and the support tension.
    const H = C * w;
    const avg = levelAverageTension(S, H, C);
    expect(avg).toBeGreaterThan(H);
    expect(avg).toBeLessThan(H * Math.cosh(S / (2 * C)));
  });

  it('inclined span: J-3 sag and J-7 low point agree with the curve itself', () => {
    const h = 400, v = 30, C = 1200;
    const pc = planeCatenary(h, v, C);
    const y = (x: number) => C * (Math.cosh((x - pc.a) / C) - Math.cosh(pc.a / C));
    expect(y(h)).toBeCloseTo(v, 6);                        // passes through the far end
    expect(v / 2 - y(h / 2)).toBeCloseTo(pc.sag / Math.sqrt(1 + (v / (2 * C * Math.sinh(h / (2 * C)))) ** 2) * Math.sqrt(1 + 0) , 0);
    // Vertical sag at mid-span from the chord, J-3 relation (mid-span sag ≈ vertical offset for small slopes).
    expect(Math.abs(v / 2 - y(h / 2) - pc.sag) / pc.sag).toBeLessThan(0.01);
  });

  it('span end forces satisfy statics, with and without wind (J.1.2)', () => {
    const O = { x: 0, y: 0, z: 100 }, E2 = { x: 30, y: 350, z: 120 };
    for (const sign of [0, 1, -1] as const) {
      const s = solveSpan(O, E2, 20000, { uh: 8, uv: 15 }, sign);
      const ur = sign === 0 ? 15 : Math.hypot(8, 15);
      // Sum of the forces on the supports equals the total load: UR × arc in the load direction.
      const total = { x: s.forceO.x + s.forceE.x, y: s.forceO.y + s.forceE.y, z: s.forceO.z + s.forceE.z };
      expect(Math.hypot(total.x, total.y, total.z)).toBeCloseTo(ur * s.arc, 6);
      expect(total.z).toBeCloseTo(-15 * s.arc, 6);           // vertical part: UV × arc, downward
      // The drawn points start and end at the supports.
      const last = s.points[s.points.length - 1]!;
      expect(last.x).toBeCloseTo(E2.x, 6); expect(last.y).toBeCloseTo(E2.y, 6); expect(last.z).toBeCloseTo(E2.z, 6);
    }
  });

  it('no-wind level span: each support carries half the weight; weight spans by arc length', () => {
    const s = solveSpan({ x: 0, y: 0, z: 0 }, { x: 0, y: 300, z: 0 }, 22500, { uh: 0, uv: 15 }, 0);
    expect(-s.forceO.z).toBeCloseTo((15 * s.arc) / 2, 6);
    const ws = arcLengthWeightSpans(300, 0, 1500);
    expect(ws.atNear).toBeCloseTo(s.arc / 2, 6);
    expect(ws.atFar).toBeCloseTo(s.arc / 2, 6);
    // Steep span: the low point lies outside, so the upper support's contribution exceeds the arc and the lower's is negative.
    const steep = arcLengthWeightSpans(300, 80, 600);
    expect(steep.atNear).toBeLessThan(0);
    expect(steep.atNear + steep.atFar).toBeCloseTo(planeCatenary(300, 80, 600).arc, 6);
  });

  it('ruling span: Eq. I-1, S²/C for one inclined span', () => {
    expect(rulingSpan([{ horizontal: 300, chord: 310 }])).toBeCloseTo(300 * 300 / 310, 9);
    const rs = rulingSpan([{ horizontal: 200, chord: 200 }, { horizontal: 400, chord: 400 }]);
    expect(rs).toBeCloseTo(Math.sqrt((200 ** 3 + 400 ** 3) / 600), 9);
  });

  it('insulator swing, Eq. 7-37', () => {
    expect(suspensionSwing(1000, 1000, 0, 0, 0)).toBeCloseTo(45, 9);
    expect(suspensionSwing(900, 1000, 200, 400, 300)).toBeCloseTo(Math.atan(1000 / 1500) * 180 / Math.PI, 9);
  });
});

describe('unit loads (Eqs. 7-3, 7-6)', () => {
  it('wind on iced conductor and NESC K', () => {
    const r = unitLoads(linear(), { temperature: -10, windPressure: 190, iceThickness: 0.0127, iceDensity: 8950, iceLoad: 0, weatherLoadFactor: 1, nescK: 4.4, gustFactor: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.loads.uh).toBeCloseTo(190 * (0.025 + 2 * 0.0127), 9);
    expect(r.loads.ui).toBeCloseTo(Math.PI * (0.025 + 0.0127) * 0.0127 * 8950, 9);
    expect(r.loads.uv).toBeCloseTo(15 + r.loads.ui, 9);
    expect(r.loads.urTension).toBeCloseTo(Math.hypot(r.loads.uh, r.loads.uv) + 4.4, 9);
  });

  it('refuses ice on a multi-cable messenger, where the manual gives no formula', () => {
    expect(unitLoads({ ...linear(), independentCables: 3 }, { temperature: 0, windPressure: 0, iceThickness: 0.01, iceDensity: 9000, iceLoad: 0, weatherLoadFactor: 1, nescK: 0, gustFactor: 1 }).ok).toBe(false);
  });
});

describe('change of state, elastic cable', () => {
  const S = 200;
  const setup = (cable: CableModel, H: number, T = 15): SectionSetup => ({ cable, rulingSpan: S, reference: { condition: 'initial', temperature: T, H }, creep: null, load: null });

  it('reproduces the sagging condition and conserves length', () => {
    const r = solveSection(setup(linear(), 20000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = sectionState(r.section, 'initial', { temperature: 15, w });
    expect(back.ok && back.state.H).toBeCloseTo(20000, 3);
    // At another state the arc length equals L0 (1 + ε/100).
    const hot = sectionState(r.section, 'initial', { temperature: 75, w });
    if (!hot.ok) throw new Error();
    expect(levelArcLength(S, hot.state.C)).toBeCloseTo(r.section.L0 * (1 + hot.state.strain / 100), 9);
    expect(hot.state.H).toBeLessThan(20000);
  });

  it('agrees with the independent parabolic state-change equation within 0.2 %', () => {
    // Parabolic equation: H2² [H2 − H1 + w1² S² EA / (24 H1²) + EA α ΔT] = w2² S² EA / 24, with EA in N (E per unit strain).
    const EA = E * 100 * A;
    const H1 = 20000;
    const r = solveSection(setup(linear(), H1));
    if (!r.ok) throw new Error(r.message);
    for (const [T2, w2] of [[75, w], [-20, w], [-5, 30]] as const) {
      const K = H1 - (w * w * S * S * EA) / (24 * H1 * H1) - EA * alpha * (T2 - 15);
      const rhs = (w2 * w2 * S * S * EA) / 24;
      let lo = 1, hi = 1e6;
      for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (m * m * (m - K) < rhs) lo = m; else hi = m; }
      const st = sectionState(r.section, 'initial', { temperature: T2, w: w2 });
      if (!st.ok) throw new Error();
      expect(Math.abs(st.state.H - lo) / lo).toBeLessThan(0.002);
    }
  });

  it('linear creep equals the initial state at a higher temperature (App. G.2)', () => {
    const r = solveSection(setup(linear(20), 20000));
    if (!r.ok) throw new Error();
    const creep = sectionState(r.section, 'creep', { temperature: 15, w });
    const shifted = sectionState(r.section, 'initial', { temperature: 35, w });
    expect(creep.ok && shifted.ok && creep.state.H).toBeCloseTo(shifted.ok ? shifted.state.H : 0, 6);
  });

  it('polynomial cable with constant creep elongation behaves like the linear model shifted by the same strain', () => {
    // PC = α × ΔT × 100 % (the manual's equivalence, App. G.2).
    const PC = 0.05, dT = PC / (100 * alpha);
    const nl: SectionSetup = { ...setup(polyCable(PC), 20000), creep: { temperature: 15, w } };
    const r1 = solveSection(nl);
    const r2 = solveSection(setup(linear(dT), 20000));
    if (!r1.ok || !r2.ok) throw new Error();
    for (const T of [-10, 15, 60]) {
      const a = sectionState(r1.section, 'creep', { temperature: T, w });
      const b = sectionState(r2.section, 'creep', { temperature: T, w });
      if (!a.ok || !b.ok) throw new Error();
      expect(Math.abs(a.state.H - b.state.H) / b.state.H).toBeLessThan(1e-6);
    }
  });

  it('a sagging condition given after creep is matched exactly', () => {
    const PC = 0.05;
    const r = solveSection({ ...setup(polyCable(PC), 18000), reference: { condition: 'creep', temperature: 15, H: 18000 }, creep: { temperature: 15, w } });
    if (!r.ok) throw new Error(r.message);
    const st = sectionState(r.section, 'creep', { temperature: 15, w });
    expect(st.ok && st.state.H).toBeCloseTo(18000, 2);
    // Initial tension is higher than after creep.
    const ini = sectionState(r.section, 'initial', { temperature: 15, w });
    expect(ini.ok && ini.state.H).toBeGreaterThan(18000);
  });

  it('final after load: a heavy load stretches the cable, so later tensions are lower than initial', () => {
    // Nonlinear cable whose initial curve softens: a = [0, E, −E, 0, 0] (stress falls below E·ε), final modulus E.
    const soft: CableModel = { ...polyCable(0), outer: { finalModulus: E, thermalCoeff: alpha, initial: [0, E, -E, 0, 0], creep: [0, E, -E, 0, 0] } };
    const r = solveSection({ ...setup(soft, 20000), load: { temperature: -10, w: 45 } });
    if (!r.ok) throw new Error(r.message);
    expect(r.section.loadSet!.outer).toBeGreaterThan(0);
    const ini = sectionState(r.section, 'initial', { temperature: 15, w });
    const aft = sectionState(r.section, 'load', { temperature: 15, w });
    if (!ini.ok || !aft.ok) throw new Error();
    expect(aft.state.H).toBeLessThan(ini.state.H);
    expect(aft.state.sag).toBeGreaterThan(ini.state.sag);
  });

  it('bimetallic cable: at high temperature the core carries a growing share; outer cannot go into compression', () => {
    const bi: CableModel = {
      ...polyCable(0), area: 400e-6,
      outer: { finalModulus: 0.6 * E, thermalCoeff: 23e-6, initial: [0, 0.6 * E, 0, 0, 0], creep: [0, 0.6 * E, 0, 0, 0] },
      core: { finalModulus: 0.4 * E * 3, thermalCoeff: 11.5e-6, initial: [0, 0.4 * E * 3, 0, 0, 0], creep: [0, 0.4 * E * 3, 0, 0, 0] },
    };
    const r = solveSection(setup(bi, 20000));
    if (!r.ok) throw new Error();
    const cool = sectionState(r.section, 'initial', { temperature: 15, w });
    const hot = sectionState(r.section, 'initial', { temperature: 150, w });
    if (!cool.ok || !hot.ok) throw new Error();
    const share = (s: typeof cool.state) => s.stress.core / s.stress.total;
    expect(share(hot.state)).toBeGreaterThan(share(cool.state));
    expect(hot.state.stress.outer).toBeGreaterThanOrEqual(0);
    expect(cableStress(bi, -0.5, 15, { kind: 'initial' }).outer).toBe(0);
  });

  it('refuses incomplete cables and GAP conductors', () => {
    expect(solveSection(setup({ ...linear(), outer: { ...linear().outer, finalModulus: 0 } }, 20000)).ok).toBe(false);
    const g = solveSection(setup({ ...linear(), gapType: true }, 20000));
    expect(!g.ok && g.reason).toBe('not-implemented');
  });
});

describe('tension limits and automatic sagging (§7.3.6, §7.3.7)', () => {
  const base: SectionSetup = { cable: linear(), rulingSpan: 300, reference: { condition: 'initial', temperature: 15, H: 15000 }, creep: null, load: null };
  const cold = { temperature: -20, w };
  const iced = { temperature: -5, w: 40 };

  it('reports usage of each limit', () => {
    const r = solveSection(base);
    if (!r.ok) throw new Error();
    const [c] = checkLimits(r.section, [{ weather: iced, condition: 'initial', maxPercentUltimate: 50, maxTension: null, maxCatenary: null }]);
    const st = sectionState(r.section, 'initial', iced);
    if (!st.ok) throw new Error();
    expect(c!.usage).toBeCloseTo((100 * st.state.tmax) / 50000, 9);
  });

  it('autosag pulls the cable to exactly the controlling limit', () => {
    const limits = [
      { weather: iced, condition: 'initial' as const, maxPercentUltimate: 50, maxTension: null, maxCatenary: null },
      { weather: cold, condition: 'initial' as const, maxPercentUltimate: null, maxTension: null, maxCatenary: 1400 },
    ];
    const r = autoSag(base, limits);
    if (!r.ok) throw new Error(r.message);
    expect(r.checks[r.controlling]!.usage).toBeCloseTo(100, 4);
    expect(r.checks.every((k) => k.usage <= 100 + 1e-6)).toBe(true);
    // Slightly tighter violates the controlling limit.
    const tighter = solveSection({ ...base, reference: { ...base.reference, H: r.H * 1.001 } });
    if (!tighter.ok) throw new Error();
    expect(Math.max(...checkLimits(tighter.section, limits).map((k) => k.usage))).toBeGreaterThan(100);
    expect(autoSag(base, []).ok).toBe(false);
  });

  it('solves one ruling-span state directly', () => {
    const st = solveRulingSpan(linear(), 300.5, 300, w, 15, { kind: 'initial' });
    expect(levelArcLength(300, st.C)).toBeCloseTo(300.5 * (1 + st.strain / 100), 9);
  });
});
