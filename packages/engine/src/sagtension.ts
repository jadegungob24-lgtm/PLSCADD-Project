import { levelArcLength, levelAverageTension, levelSag } from './catenary';
import type { CalcStep, CalcTrace } from './result';

/**
 * Cable model and Level 1 (ruling span) sag-tension (PLS-CADD manual §9.1,
 * §7.2.2–7.2.3, §7.3.4–7.3.5, App. G, App. I, App. N.4).
 *
 * The manual defines the cable's constitutive model — initial and creep
 * polynomials per material, final unloading slope, thermal shift, permanent
 * stretch after creep and after a heavy load — but not the numerical
 * procedure that finds the tension for a new weather case. This module uses
 * the standard length-compatibility method, consistent with App. N.4 (each
 * cable has a fixed unstressed length; the after-creep and after-load lengths
 * are the initial one plus a permanent elongation):
 *
 *   arc length of the ruling span at H  =  L0 · (1 + ε/100),
 *   ε = cable strain (percent of L0) at the stress σ = T̄(H) / AT,
 *
 * where L0 is the unstressed length at the cable's test temperature, and T̄
 * is the average tension along the arc. The equation is solved by bisection.
 * Every assumption is listed in the calculation trace.
 */

export type CableCondition = 'initial' | 'creep' | 'load';
export const CONDITION_LABEL: Record<CableCondition, string> = { initial: 'Initial', creep: 'Final after creep', load: 'Final after load' };

export interface MaterialModel {
  /** Virtual final modulus (Pa per % strain). */
  finalModulus: number;
  /** Thermal expansion, strain per °C. */
  thermalCoeff: number;
  initial: readonly number[];
  creep: readonly number[];
}

export interface CableModel {
  model: 'nonlinear' | 'linear';
  area: number;
  unitWeight: number;
  diameter: number;
  ultimateTension: number;
  testTemperature: number;
  outer: MaterialModel;
  core: MaterialModel | null;
  /** Linear model: creep as an equivalent temperature increase (°C). */
  creepTemperatureShift: number;
  /** Outer strands in compression: none, up to a limit (Pa, virtual), or unlimited. */
  outerCompression: { mode: 'none' | 'limited' | 'unlimited'; limit: number };
  independentCables: number;
  gapType: boolean;
}

/** Permanent stretch (% strain) of each material for a final condition (§9.1.2, §9.1.3). */
export interface PermanentSet {
  outer: number;
  core: number;
}

/** Curve used for a material: initial loading curve, long-term creep curve, or final curve after a permanent set. */
type Curve = { kind: 'initial' } | { kind: 'creepCurve' } | { kind: 'final'; set: number };

const poly = (c: readonly number[], e: number) => c[0]! + e * (c[1]! + e * (c[2]! + e * (c[3]! + e * c[4]!)));

/**
 * Strain (%) up to which a polynomial keeps rising: the first maximum in (0, 10] %.
 * Fitted polynomials are only meaningful over the test data and often turn down
 * beyond it; past this point the curve is continued along the final modulus,
 * so that the stress-strain relation stays increasing.
 */
const risingLimitCache = new WeakMap<readonly number[], number>();
function risingLimit(c: readonly number[]): number {
  const hit = risingLimitCache.get(c);
  if (hit !== undefined) return hit;
  const d = (e: number) => c[1]! + e * (2 * c[2]! + e * (3 * c[3]! + e * 4 * c[4]!));
  let lim = 10;
  for (let e = 0.001; e <= 10; e += 0.001) {
    if (d(e) <= 0) {
      let lo = e - 0.001, hi = e;
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (d(m) > 0) lo = m; else hi = m; }
      lim = lo;
      break;
    }
  }
  risingLimitCache.set(c, lim);
  return lim;
}

/** Polynomial curve made increasing: final-modulus line below zero strain and beyond the rising limit. */
function curveStress(c: readonly number[], EF: number, e: number): number {
  if (e < 0) return EF * e;
  const lim = risingLimit(c);
  return e <= lim ? poly(c, e) : poly(c, lim) + EF * (e - lim);
}

function materialStress(m: MaterialModel, eps: number, curve: Curve): number {
  // Below zero strain the polynomials are not defined (they are fitted to test data); the
  // final-modulus line is used there, which is the manual's unloading path (Fig. 9.1-1).
  const init = (e: number) => curveStress(m.initial, m.finalModulus, e);
  if (curve.kind === 'initial') return init(eps);
  if (curve.kind === 'creepCurve') return eps >= 0 ? Math.max(curveStress(m.creep, m.finalModulus, eps), Math.min(init(eps), 0)) : m.finalModulus * eps;
  // Final: unloading / reloading line from the permanent set, capped by the initial curve (path O-P-3-I, Fig. 9.1-3).
  return Math.min(m.finalModulus * (eps - curve.set), init(Math.max(eps, 0)) + (eps < 0 ? m.finalModulus * eps : 0));
}

export interface StressSplit {
  total: number;
  outer: number;
  core: number;
}

/**
 * Virtual stresses (Pa) of the cable at total strain ε (% of L0) and temperature T,
 * for a curve state. Each material's mechanical strain is ε minus its thermal
 * strain from the test temperature (Eq. 9-12, Fig. 9.1-5).
 */
export function cableStress(c: CableModel, eps: number, T: number, state: { kind: 'initial' } | { kind: 'creepCurve' } | { kind: 'final'; set: PermanentSet }): StressSplit {
  if (c.model === 'linear') {
    const em = eps - 100 * c.outer.thermalCoeff * (T - c.testTemperature);
    const s = Math.max(0, c.outer.finalModulus * em);
    return { total: s, outer: s, core: 0 };
  }
  const curveOf = (which: 'outer' | 'core'): Curve =>
    state.kind === 'final' ? { kind: 'final', set: state.set[which] } : state;
  const eo = eps - 100 * c.outer.thermalCoeff * (T - c.testTemperature);
  let so = materialStress(c.outer, eo, curveOf('outer'));
  if (c.outerCompression.mode === 'none') so = Math.max(0, so);
  else if (c.outerCompression.mode === 'limited') so = Math.max(-c.outerCompression.limit, so);
  let sc = 0;
  if (c.core) {
    const ec = eps - 100 * c.core.thermalCoeff * (T - c.testTemperature);
    sc = Math.max(0, materialStress(c.core, ec, curveOf('core')));
  }
  // A cable cannot carry compression as a whole: it goes slack.
  return { total: Math.max(0, so + sc), outer: so, core: sc };
}

/** Strain (%) at which the cable carries stress σ; bisection on a nondecreasing stress-strain function. */
function strainAtStress(c: CableModel, sigma: number, T: number, state: Parameters<typeof cableStress>[3]): number {
  let lo = -5, hi = 5;
  for (let k = 0; k < 6 && cableStress(c, hi, T, state).total < sigma; k++) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cableStress(c, mid, T, state).total < sigma) lo = mid; else hi = mid;
    if (hi - lo < 1e-13) break;
  }
  return (lo + hi) / 2;
}

/** Weather-dependent loads per unit length of one (sub)conductor (Eqs. 7-3, 7-6; §7.2.3). */
export interface WeatherInput {
  temperature: number;
  /** Reference wind pressure (Pa), Eq. 7-1. */
  windPressure: number;
  iceThickness: number;
  /** Ice density as weight per volume (N/m³). */
  iceDensity: number;
  /** Ice load per unit length, WICE (N/m). */
  iceLoad: number;
  weatherLoadFactor: number;
  /** NESC constant K (N/m), District case only (§7.2.3.1). */
  nescK: number;
  /** Wire gust response factor, drag coefficient included (§7.2.1.2). */
  gustFactor: number;
}

export interface UnitLoads {
  uh: number;
  ui: number;
  uv: number;
  ur: number;
  /** Load used for tensions: UR + K (§7.2.3.1). */
  urTension: number;
}

export type LoadResult = { ok: true; loads: UnitLoads } | { ok: false; message: string };

export function unitLoads(c: CableModel, w: WeatherInput): LoadResult {
  if (c.independentCables > 1 && (w.iceThickness > 0)) {
    return { ok: false, message: 'Ice on a messenger with several independent cables: the manual does not give the formula it uses (§9.2.1.4), so this case is not calculated.' };
  }
  const t = w.iceThickness;
  // Eq. 7-3 with the wind normal to the span (cos² WA = 1) and no height adjustment (the code-specific models are not available).
  const uh = w.weatherLoadFactor * w.windPressure * w.gustFactor * (c.diameter + 2 * t);
  // Eq. 7-6.
  const ui = w.weatherLoadFactor * Math.PI * (c.diameter + t) * t * w.iceDensity + w.iceLoad;
  const uv = c.unitWeight + ui;
  const ur = Math.hypot(uh, uv);
  return { ok: true, loads: { uh, ui, uv, ur, urTension: ur + w.nescK } };
}

/** One level-span state: tension and geometry in the ruling span. */
export interface RulingSpanState {
  H: number;
  C: number;
  /** Mid-span sag of the level ruling span. */
  sag: number;
  /** Tension at the supports of the level ruling span. */
  tmax: number;
  averageTension: number;
  strain: number;
  stress: StressSplit;
}

/** Find H in the ruling span for a fixed unstressed length (length compatibility). */
export function solveRulingSpan(
  c: CableModel, L0: number, S: number, w: number, T: number, state: Parameters<typeof cableStress>[3],
): RulingSpanState {
  const g = (H: number) => {
    const C = H / w;
    const L = levelArcLength(S, C);
    if (!Number.isFinite(L)) return Infinity;
    const eps = strainAtStress(c, levelAverageTension(S, H, C) / c.area, T, state);
    return L - L0 * (1 + eps / 100);
  };
  // g decreases with H: very slack → positive, very tight → negative.
  let lo = w * S * 1e-4, hi = Math.max(c.ultimateTension, w * S) * 10;
  for (let k = 0; k < 20 && g(lo) < 0; k++) lo /= 10;
  for (let k = 0; k < 20 && g(hi) > 0; k++) hi *= 10;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) lo = mid; else hi = mid;
    if ((hi - lo) / hi < 1e-14) break;
  }
  const H = (lo + hi) / 2;
  const C = H / w;
  const avg = levelAverageTension(S, H, C);
  const strain = strainAtStress(c, avg / c.area, T, state);
  return {
    H, C, sag: levelSag(S, C), tmax: H * Math.cosh(S / (2 * C)), averageTension: avg, strain,
    stress: cableStress(c, strain, T, state),
  };
}

/** Arc-length and strain identity used to derive L0 from a known state. */
function unstressedLength(c: CableModel, S: number, H: number, w: number, T: number, state: Parameters<typeof cableStress>[3]): number {
  const C = H / w;
  const eps = strainAtStress(c, levelAverageTension(S, H, C) / c.area, T, state);
  return levelArcLength(S, C) / (1 + eps / 100);
}

export interface WeatherState {
  temperature: number;
  /** Load per unit length used for tension (UR, or UR + K). */
  w: number;
}

export interface SectionSetup {
  cable: CableModel;
  rulingSpan: number;
  /** Sagging condition: cable condition, temperature, horizontal tension, with bare-cable weight (no wind, no ice). */
  reference: { condition: CableCondition; temperature: number; H: number };
  /** Weather case for final after creep (§7.3.4); null if none is defined. */
  creep: WeatherState | null;
  /** Weather case for final after load ("common point"); null if none is defined. */
  load: WeatherState | null;
}

export interface SolvedSection {
  setup: SectionSetup;
  /** Unstressed length of the ruling span at the test temperature, initial condition. */
  L0: number;
  creepSet: PermanentSet | null;
  loadSet: PermanentSet | null;
  /** Ruling span state at the creep and load weather cases (initial curve for load, creep curve for creep). */
  creepState: RulingSpanState | null;
  loadState: RulingSpanState | null;
  trace: CalcTrace;
}

export type SolveResult = { ok: true; section: SolvedSection } | { ok: false; reason: 'not-implemented' | 'invalid-input' | 'no-convergence'; message: string };

function permanentSet(c: CableModel, st: RulingSpanState, T: number, from: 'creep' | 'load'): PermanentSet {
  if (c.model === 'linear') {
    // Linear model: creep is an equivalent temperature increase, applied directly in stateFor();
    // an elastic cable has no permanent stretch after load (App. G.2).
    return { outer: 0, core: 0 };
  }
  const set = (m: MaterialModel, which: 'outer' | 'core') => {
    const em = st.strain - 100 * m.thermalCoeff * (T - c.testTemperature);
    const s = which === 'outer' ? st.stress.outer : st.stress.core;
    void from;
    return m.finalModulus > 0 ? Math.max(0, em - s / m.finalModulus) : Math.max(0, em);
  };
  return { outer: set(c.outer, 'outer'), core: c.core ? set(c.core, 'core') : 0 };
}

/** Stress-strain state to use for a cable condition, with the linear model's creep shift folded into the temperature. */
function stateFor(sec: { creepSet: PermanentSet | null; loadSet: PermanentSet | null; setup: SectionSetup }, cond: CableCondition, T: number) {
  const c = sec.setup.cable;
  if (cond === 'initial') return { T, state: { kind: 'initial' as const } };
  if (c.model === 'linear') return { T: cond === 'creep' ? T + c.creepTemperatureShift : T, state: { kind: 'initial' as const } };
  const set = cond === 'creep' ? sec.creepSet : sec.loadSet;
  if (!set) return null;
  return { T, state: { kind: 'final' as const, set } };
}

function validate(c: CableModel, S: number): string | null {
  if (!(c.area > 0) || !(c.unitWeight > 0) || !(c.ultimateTension > 0)) return 'The cable data are incomplete (area, unit weight, ultimate tension).';
  if (!(c.outer.finalModulus > 0)) return 'The cable has no final modulus of elasticity.';
  if (c.model === 'nonlinear' && c.outer.initial.every((v) => v === 0)) return 'The cable has no stress-strain coefficients.';
  if (c.core && !(c.core.finalModulus > 0)) return 'The cable core has no final modulus of elasticity.';
  if (!(S > 0)) return 'The ruling span is not defined.';
  return null;
}

/**
 * Solve a tension section: the unstressed length from the sagging condition,
 * then the permanent stretch after creep (creep weather case on the creep
 * curve) and after load (load weather case on the initial curve). When the
 * sagging condition is itself a final condition, the unstressed length and the
 * permanent stretch depend on each other and are found together.
 */
export function solveSection(setup: SectionSetup): SolveResult {
  const c = setup.cable;
  const S = setup.rulingSpan;
  const bad = validate(c, S);
  if (bad) return { ok: false, reason: 'invalid-input', message: bad };
  if (c.gapType) return { ok: false, reason: 'not-implemented', message: 'GAP-type conductors are not calculated: the manual describes the behaviour (§9.2.2) but not the installation procedure needed to model it.' };
  const { condition, temperature, H } = setup.reference;
  if (condition === 'creep' && !setup.creep && c.model === 'nonlinear') return { ok: false, reason: 'invalid-input', message: 'The sagging condition is "after creep" but no creep weather case is defined.' };
  if (condition === 'load' && !setup.load) return { ok: false, reason: 'invalid-input', message: 'The sagging condition is "after load" but no load weather case is defined.' };
  const w0 = c.unitWeight;
  const steps: CalcStep[] = [];

  const setsFor = (L0: number) => {
    const creepState = setup.creep && c.model === 'nonlinear'
      ? solveRulingSpan(c, L0, S, setup.creep.w, setup.creep.temperature, { kind: 'creepCurve' }) : null;
    const loadState = setup.load ? solveRulingSpan(c, L0, S, setup.load.w, setup.load.temperature, { kind: 'initial' }) : null;
    return {
      creepState, loadState,
      creepSet: creepState ? permanentSet(c, creepState, setup.creep!.temperature, 'creep') : c.model === 'linear' ? { outer: 0, core: 0 } : null,
      loadSet: loadState ? permanentSet(c, loadState, setup.load!.temperature, 'load') : null,
    };
  };

  let L0: number;
  let sets: ReturnType<typeof setsFor>;
  if (condition === 'initial') {
    L0 = unstressedLength(c, S, H, w0, temperature, { kind: 'initial' });
    sets = setsFor(L0);
  } else {
    // L0 such that the ruling span has tension H at the sagging condition in the final state.
    const Hfor = (L: number) => {
      const s = setsFor(L);
      const st = stateFor({ ...s, setup }, condition, temperature)!;
      return solveRulingSpan(c, L, S, w0, st.T, st.state).H;
    };
    let lo = S * 0.98, hi = S * 1.02;
    for (let k = 0; k < 30 && Hfor(lo) < H; k++) lo -= (S - lo) + S * 0.01;
    for (let k = 0; k < 30 && Hfor(hi) > H; k++) hi += (hi - S) + S * 0.01;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (Hfor(mid) > H) lo = mid; else hi = mid;
      if ((hi - lo) / S < 1e-15) break;
    }
    L0 = (lo + hi) / 2;
    sets = setsFor(L0);
    const check = Hfor(L0);
    if (Math.abs(check - H) / H > 1e-6) return { ok: false, reason: 'no-convergence', message: `The sagging condition could not be matched (H ${check.toFixed(1)} N instead of ${H.toFixed(1)} N).` };
  }
  steps.push({ label: 'Unstressed length of the ruling span at the test temperature (initial)', values: { L0, rulingSpan: S } });
  if (sets.creepState) steps.push({ label: 'Creep weather case on the long-term creep curve (§9.1.2)', values: { H: sets.creepState.H, strainPct: sets.creepState.strain, outerSetPct: sets.creepSet!.outer, coreSetPct: sets.creepSet!.core } });
  if (sets.loadState) steps.push({ label: 'Load ("common point") weather case on the initial curve (§9.1.3)', values: { H: sets.loadState.H, strainPct: sets.loadState.strain, outerSetPct: sets.loadSet!.outer, coreSetPct: sets.loadSet!.core } });

  const trace: CalcTrace = {
    method: 'Level 1 ruling span sag-tension by length compatibility',
    basis: 'Cable model: PLS-CADD manual §9.1, Eqs. 9-1 to 9-12; ruling span App. I Eq. I-1; catenary App. J. Numerical procedure: standard length-compatibility method (not specified by the manual).',
    inputs: { rulingSpan: S, referenceCondition: condition, referenceTemperature: temperature, referenceH: H, cableModel: c.model },
    steps,
    assumptions: [
      'Strain is computed from the average tension along the arc of the level ruling span.',
      'Unstressed length is taken at the cable test temperature; thermal strain is applied per material (Eq. 9-12).',
      'Below zero mechanical strain a material follows its final-modulus line.',
      'Where a fitted polynomial stops rising (beyond its test data), the curve continues along the final modulus.',
      'Final after creep: the creep weather case is applied on the long-term creep curve and each material unloads along its final modulus (Fig. 9.1-3).',
      'Final after load: the load weather case is applied on the initial curve and each material unloads along its final modulus (Fig. 9.1-4); creep and load stretches are computed independently, as the manual compares them (§9.1.3).',
      ...(c.model === 'linear' ? ['Linear model: creep is applied as a temperature increase; there is no permanent stretch after load (App. G.2).'] : []),
    ],
    warnings: [],
  };
  return { ok: true, section: { setup, L0, creepSet: sets.creepSet, loadSet: sets.loadSet, creepState: sets.creepState, loadState: sets.loadState, trace } };
}

export type StateResult = { ok: true; state: RulingSpanState } | { ok: false; message: string };

/** Ruling span state of a solved section for a weather case and cable condition. */
export function sectionState(sec: SolvedSection, condition: CableCondition, weather: WeatherState): StateResult {
  const st = stateFor(sec, condition, weather.temperature);
  if (!st) return { ok: false, message: `No ${condition === 'creep' ? 'creep' : 'load'} weather case is defined in the criteria, so the "${CONDITION_LABEL[condition]}" condition is not available.` };
  return { ok: true, state: solveRulingSpan(sec.setup.cable, sec.L0, sec.setup.rulingSpan, weather.w, st.T, st.state) };
}

export interface TensionLimit {
  weather: WeatherState;
  condition: CableCondition;
  maxPercentUltimate: number | null;
  maxTension: number | null;
  /** Maximum catenary constant H / w (§7.3.6). */
  maxCatenary: number | null;
  /** Bare-cable weight per length used for the catenary constant H / UW. */
}

export interface LimitCheck {
  limit: TensionLimit;
  /** Tension compared (RS support tension or actual maximum). */
  tension: number;
  H: number;
  catenary: number;
  /** Usage in percent of each specified limit; the largest is `usage`. */
  usage: number;
  controlling: 'percent' | 'tension' | 'catenary' | null;
  ok: boolean;
  error?: string;
}

/**
 * Check cable tension limits (§7.3.6, §11.2.2). Tension is the support tension
 * of the ruling span, or, with `actualMaxTension`, the largest end tension over
 * the actual spans supplied by the caller. The catenary constant is H divided
 * by the bare cable weight (CIGRE practice the manual refers to).
 */
export function checkLimits(
  sec: SolvedSection, limits: readonly TensionLimit[], actualMaxTension?: (state: RulingSpanState, limit: TensionLimit) => number,
): LimitCheck[] {
  const c = sec.setup.cable;
  return limits.map((limit) => {
    const r = sectionState(sec, limit.condition, limit.weather);
    if (!r.ok) return { limit, tension: NaN, H: NaN, catenary: NaN, usage: NaN, controlling: null, ok: false, error: r.message };
    const tension = actualMaxTension ? actualMaxTension(r.state, limit) : r.state.tmax;
    const catenary = r.state.H / c.unitWeight;
    const parts: [LimitCheck['controlling'], number][] = [];
    if (limit.maxPercentUltimate !== null) parts.push(['percent', (100 * tension) / ((limit.maxPercentUltimate / 100) * c.ultimateTension)]);
    if (limit.maxTension !== null) parts.push(['tension', (100 * tension) / limit.maxTension]);
    if (limit.maxCatenary !== null) parts.push(['catenary', (100 * catenary) / limit.maxCatenary]);
    let usage = 0, controlling: LimitCheck['controlling'] = null;
    for (const [k, u] of parts) if (u > usage) { usage = u; controlling = k; }
    return { limit, tension, H: r.state.H, catenary, usage, controlling, ok: usage <= 100 + 1e-9 };
  });
}

export type AutosagResult =
  | { ok: true; H: number; checks: LimitCheck[]; controlling: number }
  | { ok: false; message: string };

/**
 * Automatic sagging (§7.3.7, §10.3.2.1.3): the largest sagging tension H at the
 * reference condition for which every automatic sagging limit is satisfied.
 */
export function autoSag(setup: SectionSetup, limits: readonly TensionLimit[]): AutosagResult {
  if (limits.length === 0) return { ok: false, message: 'No automatic sagging limits are defined in the criteria.' };
  if (limits.every((l) => l.maxPercentUltimate === null && l.maxTension === null && l.maxCatenary === null)) {
    return { ok: false, message: 'The automatic sagging limits have no values.' };
  }
  const c = setup.cable;
  const usageAt = (H: number) => {
    const s = solveSection({ ...setup, reference: { ...setup.reference, H } });
    if (!s.ok) return { s, checks: [] as LimitCheck[], max: NaN };
    const checks = checkLimits(s.section, limits);
    const err = checks.find((k) => k.error);
    return { s, checks, max: err ? NaN : Math.max(...checks.map((k) => k.usage)) };
  };
  const first = usageAt(c.unitWeight * setup.rulingSpan);
  if (!first.s.ok) return { ok: false, message: first.s.message };
  if (!Number.isFinite(first.max)) return { ok: false, message: first.checks.find((k) => k.error)?.error ?? 'A limit could not be evaluated.' };
  // Lower bound: a very slack but physical cable (catenary constant a quarter of the span, sag about 0.7 × span);
  // slacker cables carry large support tensions from their own hanging weight.
  let lo = (c.unitWeight * setup.rulingSpan) / 4, hi = c.ultimateTension;
  if (!(usageAt(lo).max <= 100)) return { ok: false, message: 'No sagging tension satisfies the limits, even a very slack one.' };
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (usageAt(mid).max <= 100) lo = mid; else hi = mid;
    if ((hi - lo) / hi < 1e-9) break;
  }
  const res = usageAt(lo);
  const controlling = res.checks.reduce((best, k, i) => (k.usage > (res.checks[best]?.usage ?? -1) ? i : best), 0);
  return { ok: true, H: lo, checks: res.checks, controlling };
}
