import {
  allowableSpansAt, arcLengthWeightSpans, interactionUsage, checkLimits, rulingSpan, sectionState, solveSection, solveSpan, suspensionSwing,
  twoPartLoadAngle, unitLoads,
  type CableModel, type LimitCheck, type SolvedSection, type SpanSolution, type StateResult, type UnitLoads, type Vec3, type WeatherInput,
} from '@tlcad/engine';
import type { Attachment, Cable, CableConditionValue, ConditionRef, Criteria, Project, Section, TensionLimit, WeatherCase } from '@tlcad/model';
import type { Derived } from './derived';
import type { LineModel, SectionDerived, StructureDerived } from './lineModel';

/**
 * Engineering analysis of the strung sections (Phase 4): Level 1 sag-tension,
 * displayed wire shapes, wind and weight spans, uplift, insulator swing and
 * Method 1 strength. Everything here is calculated from the project data and
 * the engine; nothing is stored.
 */

export function cableModelOf(c: Cable, cr: Criteria): CableModel {
  const oc = c.outerCompression.mode === 'criteria' ? cr.outerCompression
    : c.outerCompression.mode === 'none' ? { mode: 'none' as const, limit: 0 } : { mode: 'limited' as const, limit: c.outerCompression.limit };
  return {
    model: c.model, area: c.area, unitWeight: c.unitWeight, diameter: c.diameter, ultimateTension: c.ultimateTension,
    testTemperature: c.testTemperature, outer: c.outer, core: c.core, creepTemperatureShift: c.creepTemperatureShift,
    outerCompression: oc, independentCables: c.independentCables, gapType: c.gapType,
  };
}

export const weatherInput = (wc: WeatherCase): WeatherInput => ({
  temperature: wc.temperature, windPressure: wc.windPressure, iceThickness: wc.iceThickness, iceDensity: wc.iceDensity,
  iceLoad: wc.iceLoad, weatherLoadFactor: wc.weatherLoadFactor, nescK: wc.nescK, gustFactor: wc.gustFactor,
});

export interface SpanGeom { O: Vec3; E: Vec3; from: StructureDerived; to: StructureDerived }

export interface SectionAnalysis {
  sd: SectionDerived;
  cable: Cable | null;
  model: CableModel | null;
  /** Spans per phase between consecutive attached structures. */
  phases: SpanGeom[][];
  /** Structures attached, in order. */
  attached: StructureDerived[];
  rulingSpanCalc: number;
  rulingSpan: number;
  status: 'sagged' | 'notSagged' | 'error';
  message: string | null;
  solved: SolvedSection | null;
  /** Sagged wire shapes at the display condition (null = draw chords). */
  shape: WireShape | null;
}

export interface WireShape {
  plan: Vec3[][];
  profile: { station: number; z: number }[][];
  label: string;
}

export interface Analysis {
  sections: Map<string, SectionAnalysis>;
}

const EMPTY: Analysis = { sections: new Map() };
let lastKey: unknown[] = [];
let lastValue: Analysis = EMPTY;

const centroid = (pts: Vec3[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
});

/** Weather case by id with its unit loads for a cable. */
function loadsFor(model: CableModel, wc: WeatherCase): { ok: true; loads: UnitLoads } | { ok: false; message: string } {
  return unitLoads(model, weatherInput(wc));
}

export function computeAnalysis(p: Project | null, _d: Derived, m: LineModel): Analysis {
  if (!p) return EMPTY;
  const key = [m, p.criteria, p.cableLibrary];
  if (key.every((k, i) => k === lastKey[i])) return lastValue;
  const cr = p.criteria;
  const wcById = new Map(cr.weatherCases.map((w) => [w.id, w]));
  const sections = new Map<string, SectionAnalysis>();
  for (const sd of m.sections) {
    const s = sd.section;
    const attached = s.steps.filter((st) => st.set !== null).map((st) => m.byId.get(st.structureId)!).filter(Boolean);
    const phases: SpanGeom[][] = sd.wires.map((w) => w.slice(1).map((E, i) => ({ O: w[i]!, E, from: attached[i]!, to: attached[i + 1]! })));
    // Ruling span of the set from the spans between the centres of its attachment points (§10.2.2 note, Eq. I-1).
    const cents = sd.wires.length ? sd.wires[0]!.map((_, i) => centroid(sd.wires.map((w) => w[i]!))) : [];
    const spans = cents.slice(1).map((E, i) => {
      const O = cents[i]!;
      const h = Math.hypot(E.x - O.x, E.y - O.y);
      return { horizontal: h, chord: Math.hypot(h, E.z - O.z) };
    });
    const rulingSpanCalc = spans.length ? rulingSpan(spans) : NaN;
    const RS = s.sagging.rulingSpanOverride ?? rulingSpanCalc;
    const cable = sd.cable;
    const model = cable ? cableModelOf(cable, cr) : null;
    const base = { sd, cable, model, phases, attached, rulingSpanCalc, rulingSpan: RS };
    if (sd.problems.length || !model || !sd.wires.length) {
      sections.set(s.id, { ...base, status: 'error', message: sd.problems.join(' ') || 'The section has no wires to analyse.', solved: null, shape: null });
      continue;
    }
    if (s.sagging.H === null) {
      sections.set(s.id, { ...base, status: 'notSagged', message: 'The section is not sagged yet.', solved: null, shape: null });
      continue;
    }
    const weatherState = (id: string | null) => {
      const wc = id ? wcById.get(id) : undefined;
      if (!wc) return { ok: true as const, state: null };
      const l = loadsFor(model, wc);
      return l.ok ? { ok: true as const, state: { temperature: wc.temperature, w: l.loads.urTension } } : { ok: false as const, message: `${wc.name}: ${l.message}` };
    };
    const creep = weatherState(cr.creepWeatherId);
    const load = weatherState(cr.loadWeatherId);
    if (!creep.ok || !load.ok) {
      sections.set(s.id, { ...base, status: 'error', message: (!creep.ok ? creep.message : '') + (!load.ok ? load.message : ''), solved: null, shape: null });
      continue;
    }
    const r = solveSection({
      cable: model, rulingSpan: RS, reference: { condition: s.sagging.condition, temperature: s.sagging.temperature, H: s.sagging.H },
      creep: creep.state, load: load.state,
    });
    if (!r.ok) { sections.set(s.id, { ...base, status: 'error', message: r.message, solved: null, shape: null }); continue; }
    const sa: SectionAnalysis = { ...base, status: 'sagged', message: null, solved: r.section, shape: null };
    sa.shape = displayShape(p, sa);
    sections.set(s.id, sa);
  }
  lastKey = key;
  lastValue = { sections };
  return lastValue;
}

export type ConditionState =
  | { ok: true; H: number; loads: UnitLoads; temperature: number; state: StateResult & { ok: true } | null; weather: WeatherCase | null }
  | { ok: false; message: string };

/**
 * Tension and loads of a sagged section for a weather case (null = the sagging condition itself, bare cable)
 * and cable condition.
 */
export function stateAt(p: Project, sa: SectionAnalysis, weatherId: string | null, condition: CableConditionValue): ConditionState {
  if (!sa.solved || !sa.model) return { ok: false, message: sa.message ?? 'The section is not solved.' };
  const sag = sa.sd.section.sagging;
  if (weatherId === null) {
    const loads: UnitLoads = { uh: 0, ui: 0, uv: sa.model.unitWeight, ur: sa.model.unitWeight, urTension: sa.model.unitWeight };
    if (condition === sag.condition) return { ok: true, H: sag.H!, loads, temperature: sag.temperature, state: null, weather: null };
    const st = sectionState(sa.solved, condition, { temperature: sag.temperature, w: loads.urTension });
    return st.ok ? { ok: true, H: st.state.H, loads, temperature: sag.temperature, state: st, weather: null } : { ok: false, message: st.message };
  }
  const wc = p.criteria.weatherCases.find((w) => w.id === weatherId);
  if (!wc) return { ok: false, message: 'The weather case no longer exists.' };
  return stateForWeather(sa, wc, condition);
}

/** As stateAt, for a weather case given directly (e.g. a case with its ice removed for ice jumping). */
export function stateForWeather(sa: SectionAnalysis, wc: WeatherCase, condition: CableConditionValue): ConditionState {
  if (!sa.solved || !sa.model) return { ok: false, message: sa.message ?? 'The section is not solved.' };
  const l = loadsFor(sa.model, wc);
  if (!l.ok) return { ok: false, message: l.message };
  const st = sectionState(sa.solved, condition, { temperature: wc.temperature, w: l.loads.urTension });
  return st.ok ? { ok: true, H: st.state.H, loads: l.loads, temperature: wc.temperature, state: st, weather: wc } : { ok: false, message: st.message };
}

/**
 * Span shapes of a sagged section for a state. With an NESC constant K the
 * geometry uses the increased load UR + K (§7.2.3.1, Level 1).
 */
export function spanShapes(sa: SectionAnalysis, cs: ConditionState & { ok: true }, windSign: -1 | 1): SpanSolution[][] {
  const f = cs.loads.ur > 0 ? cs.loads.urTension / cs.loads.ur : 1;
  const load = { uh: cs.loads.uh * f, uv: cs.loads.uv * f };
  return sa.phases.map((spans) => spans.map((s) => solveSpan(s.O, s.E, cs.H, load, cs.loads.uh > 0 ? windSign : 0)));
}

/** Displayed wire points per phase in plan and profile, or null to draw straight chords (not solvable). */
function displayShape(p: Project, sa: SectionAnalysis): WireShape | null {
  const disp = p.criteria.display;
  const cs = stateAt(p, sa, disp.weatherId, disp.weatherId === null ? sa.sd.section.sagging.condition : disp.condition);
  if (!cs.ok) return null;
  const shapes = spanShapes(sa, cs, disp.wind === 'left' ? -1 : 1);
  const profile = shapes.map((spans, k) => spans.flatMap((s, i) => {
    // Stations by horizontal fraction along the span between the end stations of the chord.
    const g = sa.phases[k]![i]!;
    const s0 = sa.sd.profile[k]![i]!.station, s1 = sa.sd.profile[k]![i + 1]!.station;
    const hl = Math.hypot(g.E.x - g.O.x, g.E.y - g.O.y) || 1;
    const pts = s.points.map((q) => {
      const t = ((q.x - g.O.x) * (g.E.x - g.O.x) + (q.y - g.O.y) * (g.E.y - g.O.y)) / (hl * hl);
      return { station: s0 + (s1 - s0) * t, z: q.z };
    });
    return i === 0 ? pts : pts.slice(1);
  }));
  return {
    plan: shapes.map((spans) => spans.flatMap((s, i) => (i === 0 ? s.points : s.points.slice(1)))),
    profile,
    label: cs.weather ? `${cs.weather.name}, ${disp.condition}` : 'sagging condition',
  };
}

/** Tension limits that apply to a section's cable, as engine limits. */
export function limitsFor(p: Project, sa: SectionAnalysis, list: TensionLimit[]): { src: TensionLimit; engine: Parameters<typeof checkLimits>[1][number] | null; message?: string }[] {
  return list.filter((l) => l.cableIds.length === 0 || (sa.cable && l.cableIds.includes(sa.cable.id))).map((l) => {
    const wc = p.criteria.weatherCases.find((w) => w.id === l.weatherId);
    if (!wc || !sa.model) return { src: l, engine: null, message: 'The weather case no longer exists.' };
    const lo = loadsFor(sa.model, wc);
    if (!lo.ok) return { src: l, engine: null, message: lo.message };
    return {
      src: l,
      engine: { weather: { temperature: wc.temperature, w: lo.loads.urTension }, condition: l.condition, maxPercentUltimate: l.maxPercentUltimate, maxTension: l.maxTension, maxCatenary: l.maxCatenary },
    };
  });
}

/** Tension-limit checks of a section (§11.2.2), with the maximum tension per the criteria (§7.3.8). */
export function sectionLimitChecks(p: Project, sa: SectionAnalysis): { src: TensionLimit; check: LimitCheck | null; message?: string }[] {
  if (!sa.solved) return [];
  const items = limitsFor(p, sa, p.criteria.tensionLimits);
  const valid = items.filter((i) => i.engine);
  const actual = p.criteria.maxTension === 'actual'
    ? (st: { H: number }, lim: { weather: { w: number } }) => {
      // Largest end tension over the actual spans, with the load of the limit's weather case (no wind side dependence on magnitude).
      let mx = 0;
      for (const spans of sa.phases) for (const s of spans) mx = Math.max(mx, solveSpan(s.O, s.E, st.H, { uh: 0, uv: lim.weather.w }, 0).tmax);
      return mx;
    }
    : undefined;
  const checks = checkLimits(sa.solved, valid.map((v) => v.engine!), actual);
  let k = 0;
  return items.map((i) => (i.engine ? { src: i.src, check: checks[k++]! } : { src: i.src, check: null, message: i.message }));
}

// ------------------------------------------------------------------ Structure results

export interface SwingResult {
  attachment: Attachment;
  condition: number;
  min: number;
  max: number;
  allowMin: number | null;
  allowMax: number | null;
  /**
   * The net vertical load on the insulator (wire load + counterweight + insulator weight) is upward for at least one
   * wind direction: the insulator is pulled up and a swing angle has no meaning (reported as a failure).
   */
  uplift: boolean;
  ok: boolean;
}

export interface SetResult {
  set: number;
  sectionIds: string[];
  /** Weight per length × conductors, used to pick the heaviest set for Method 1. */
  weight: number;
  windSpan: number;
  /** Weight spans for the three weight-span conditions; null where not available. */
  weightSpans: (number | null)[];
  /** Vertical load per phase (N, all subconductors) at the three conditions, for minimum-load checks. */
  verticalLoads: (number | null)[][];
  swings: SwingResult[];
  notes: string[];
}

export interface StructureResult {
  sd: StructureDerived;
  sets: SetResult[];
  method1: { usage: number; ok: boolean; detail: string } | null;
  /** Method 2 (§8.3.2): one check per interaction condition of the criteria. */
  method2: { rows: { condition: number; windSpan: number; weightSpan: number | null; inside: boolean; usage: number; message?: string }[]; ok: boolean; detail: string } | null;
  problems: string[];
}

/** Wind on a span: a plan direction (incidence by Eq. 7-3, cos² WA) or full wind normal to the span toward its right (+1) or left (−1). */
export type SpanWind = { kind: 'vector'; x: number; y: number } | { kind: 'normal'; sign: -1 | 1 } | null;

export interface EndReaction {
  /** Force of the wire on the support, global x, y, z (z up). */
  force: Vec3;
  /** Span coordinate components (§7.3.12.3): V down, T horizontal normal to the span (toward its right), L horizontal toward the span. */
  V: number;
  T: number;
  L: number;
  /** Plan unit vectors of the span axes at this end: along the span (toward it) and normal (right of O→E). */
  along: { x: number; y: number };
  normal: { x: number; y: number };
}

/**
 * Reaction of one span at one end (App. J, Eqs. J-11 to J-13). With an NESC
 * constant K the geometry uses UR + K and the vertical and transverse
 * reactions are scaled back by UR / (UR + K); the longitudinal component is
 * not scaled (§7.3.12.4).
 */
export function endReaction(span: SpanGeom, side: 'O' | 'E', cs: ConditionState & { ok: true }, wind: SpanWind): EndReaction {
  const f = cs.loads.ur > 0 ? cs.loads.urTension / cs.loads.ur : 1;
  const hx = span.E.x - span.O.x, hy = span.E.y - span.O.y, hl = Math.hypot(hx, hy) || 1;
  const n = { x: hy / hl, y: -hx / hl };
  let k = 0;
  if (wind?.kind === 'vector') k = wind.x * n.x + wind.y * n.y;
  else if (wind?.kind === 'normal') k = wind.sign;
  const uh = cs.loads.uh * k * k * f;
  const sol = solveSpan(span.O, span.E, cs.H, { uh, uv: cs.loads.uv * f }, uh > 0 ? (k > 0 ? 1 : -1) : 0);
  const raw = side === 'E' ? sol.forceE : sol.forceO;
  const along = side === 'O' ? { x: hx / hl, y: hy / hl } : { x: -hx / hl, y: -hy / hl };
  const L = raw.x * along.x + raw.y * along.y;
  const T = (raw.x * n.x + raw.y * n.y) / f;
  const V = -raw.z / f;
  const force = { x: along.x * L + n.x * T, y: along.y * L + n.y * T, z: -V };
  return { force, V, T, L, along, normal: n };
}

/** Forces of the phase wires on a structure, summed over the spans meeting there. */
function wireForces(sa: SectionAnalysis, cs: ConditionState & { ok: true }, idx: number, phase: number, wind: { x: number; y: number } | null) {
  const spans = sa.phases[phase]!;
  const sum = { x: 0, y: 0, z: 0 };
  const parts: { span: SpanGeom; side: 'back' | 'ahead' }[] = [];
  if (idx > 0) parts.push({ span: spans[idx - 1]!, side: 'back' });
  if (idx < spans.length) parts.push({ span: spans[idx]!, side: 'ahead' });
  for (const { span, side } of parts) {
    const r = endReaction(span, side === 'back' ? 'E' : 'O', cs, wind ? { kind: 'vector', ...wind } : null);
    sum.x += r.force.x; sum.y += r.force.y; sum.z += r.force.z;
  }
  return { sum, parts };
}

export function structureResult(p: Project, a: Analysis, sd: StructureDerived): StructureResult {
  const cr = p.criteria;
  const problems: string[] = [];
  const bySet = new Map<number, { sa: SectionAnalysis; idx: number }[]>();
  for (const sa of a.sections.values()) {
    const idx = sa.attached.findIndex((x) => x.s.id === sd.s.id);
    if (idx < 0) continue;
    const step = sa.sd.section.steps.filter((st) => st.set !== null)[idx]!;
    if (!bySet.has(step.set!)) bySet.set(step.set!, []);
    bySet.get(step.set!)!.push({ sa, idx });
  }
  const sets: SetResult[] = [];
  const weightFns = new Map<number, (cond: ConditionRef) => { vs: number | null; vPhase: number[] }>();
  for (const [set, uses] of [...bySet.entries()].sort((x, y) => x[0] - y[0])) {
    const notes: string[] = [];
    const sagged = uses.filter((u) => u.sa.status === 'sagged');
    if (sagged.length < uses.length) notes.push('A section at this set is not sagged; its spans are not included.');
    const first = sagged[0];
    const nc = (u: { sa: SectionAnalysis }) => u.sa.sd.section.conductorsPerPhase;
    // Wind span: average of the adjacent chord lengths (App. I.2), from the set centre.
    let chordSum = 0;
    for (const u of sagged) {
      const nP = u.sa.phases.length;
      for (const side of [u.idx - 1, u.idx]) {
        if (side < 0 || side >= u.sa.phases[0]!.length) continue;
        let c = 0;
        for (let k = 0; k < nP; k++) { const s = u.sa.phases[k]![side]!; c += Math.hypot(s.E.x - s.O.x, s.E.y - s.O.y, s.E.z - s.O.z); }
        chordSum += c / nP;
      }
    }
    const windSpan = chordSum / 2;
    const weightSpans: (number | null)[] = [];
    const verticalLoads: (number | null)[][] = [];
    const weightAt = (cond: ConditionRef): { vs: number | null; vPhase: number[] } => {
      if (!cond.weatherId || !first) return { vs: null, vPhase: [] };
      let vs = 0, okAll = true;
      const vPhase: number[] = [];
      for (const u of sagged) {
        const cs = stateAt(p, u.sa, cond.weatherId, cond.condition);
        if (!cs.ok) { okAll = false; notes.push(cs.message); break; }
        const nP = u.sa.phases.length;
        const stepTr = u.sa.sd.section.steps.filter((st) => st.set !== null)[u.idx]!.transposition;
        for (let k = 0; k < nP; k++) {
          // Vertical loads are kept per attachment phase of the structure (wire k attaches to phase transposition[k]).
          const ap = Number(stepTr[k]) - 1;
          // Vertical support force of the bare-weight shape (uh = 0) at the condition's tension; for the exact model WS = V / UV (App. I.3).
          if (cr.weightSpanModel === 'exact') {
            const { sum } = wireForces(u.sa, cs, u.idx, k, null);
            vs += -sum.z / cs.loads.uv / nP;
            vPhase[ap] = (vPhase[ap] ?? 0) + -sum.z * nc(u);
          } else {
            const spans = u.sa.phases[k]!;
            const C = cs.H / cs.loads.urTension;
            const contrib = (s: SpanGeom, end: 'near' | 'far') => {
              const h = Math.hypot(s.E.x - s.O.x, s.E.y - s.O.y);
              const w = arcLengthWeightSpans(h, s.E.z - s.O.z, C);
              return end === 'near' ? w.atNear : w.atFar;
            };
            let v = 0;
            if (u.idx > 0) v += contrib(spans[u.idx - 1]!, 'far');
            if (u.idx < spans.length) v += contrib(spans[u.idx]!, 'near');
            vs += v / nP;
            vPhase[ap] = (vPhase[ap] ?? 0) + v * cs.loads.uv * nc(u);
          }
        }
      }
      return okAll ? { vs, vPhase } : { vs: null, vPhase: [] };
    };
    weightFns.set(set, weightAt);
    for (const cond of cr.weightSpanConditions) {
      const w = weightAt(cond);
      weightSpans.push(w.vs);
      verticalLoads.push(w.vPhase);
    }
    // Insulator swing (§7.3.16, Eq. 7-37 / 7-38): wind normal to each adjacent span, both directions.
    const swings: SwingResult[] = [];
    const atts = sd.type?.attachments.filter((x) => x.set === set && (x.insulator === 'suspension' || x.insulator === '2part')) ?? [];
    const fr = sd.frame;
    if (atts.length && first && fr) {
      cr.swingConditions.forEach((cond, ci) => {
        if (!cond.weatherId) return;
        const u = first;
        const cs = stateAt(p, u.sa, cond.weatherId, cond.condition);
        if (!cs.ok) { notes.push(cs.message); return; }
        const step = u.sa.sd.section.steps.filter((st) => st.set !== null)[u.idx]!;
        for (const att of atts) {
          // Wire phase attached to this attachment (transposition).
          const k = step.transposition.indexOf(String(att.phase));
          if (k < 0) continue;
          const spans = u.sa.phases[k]!;
          const dirs: ({ x: number; y: number } | null)[] = [];
          if (cs.loads.uh > 0) {
            for (const s of [spans[u.idx - 1], spans[u.idx]]) {
              if (!s) continue;
              const hx = s.E.x - s.O.x, hy = s.E.y - s.O.y, hl = Math.hypot(hx, hy) || 1;
              dirs.push({ x: hy / hl, y: -hx / hl }, { x: -hy / hl, y: hx / hl });
            }
          } else dirs.push(null);
          let mn = Infinity, mx = -Infinity, uplift = false;
          for (const wd of dirs) {
            const { sum } = wireForces(u.sa, cs, u.idx, k, wd);
            const ncs = nc(u);
            const T = (sum.x * fr.ts.e + sum.y * fr.ts.n) * ncs;
            const V = -sum.z * ncs;
            const tIns = wd && cs.weather ? cs.weather.windPressure * att.windArea * (wd.x * fr.ts.e + wd.y * fr.ts.n) : 0;
            const vcw = sd.s.counterweights[String(set)] ?? 0;
            const ang = att.insulator === '2part'
              ? twoPartLoadAngle(T, V, tIns + (att.part2 && wd && cs.weather ? cs.weather.windPressure * att.part2.windArea * (wd.x * fr.ts.e + wd.y * fr.ts.n) : 0), att.weight + (att.part2?.weight ?? 0), vcw)
              : suspensionSwing(T, V, tIns, att.weight, vcw);
            const vNet = att.insulator === '2part' ? V + vcw + att.weight + (att.part2?.weight ?? 0) : V + vcw + att.weight / 2;
            if (vNet <= 0) uplift = true;
            mn = Math.min(mn, ang); mx = Math.max(mx, ang);
          }
          const allow = att.swing?.[ci] ?? null;
          swings.push({
            attachment: att, condition: ci, min: mn, max: mx, allowMin: allow?.[0] ?? null, allowMax: allow?.[1] ?? null, uplift,
            ok: !uplift && (!allow || (mn >= allow[0] - 1e-9 && mx <= allow[1] + 1e-9)),
          });
        }
      });
    }
    const weight = Math.max(0, ...uses.map((u) => (u.sa.cable?.unitWeight ?? 0) * u.sa.sd.section.conductorsPerPhase));
    sets.push({ set, sectionIds: uses.map((u) => u.sa.sd.section.id), weight, windSpan, weightSpans, verticalLoads, swings, notes });
  }
  // Method 1 strength (§8.3.1, App. F.1.4.1): heaviest set's wind span and weight spans against the allowable values at the line angle.
  let method1: StructureResult['method1'] = null;
  const t = sd.type;
  if (t?.strength.method === 'method1' && sets.length && sd.frame) {
    const heavy = [...sets].sort((x, y) => y.weight - x.weight)[0]!;
    const allow = allowableSpansAt(t.strength.rows, sd.frame.lineAngle);
    if (!allow) method1 = { usage: Infinity, ok: false, detail: `Line angle ${Math.abs(sd.frame.lineAngle).toFixed(2)}° is beyond the largest angle in the allowable spans table.` };
    else {
      const parts: string[] = [];
      let usage = (100 * heavy.windSpan) / allow.maxWindSpan;
      parts.push(`wind span ${heavy.windSpan.toFixed(1)} / ${allow.maxWindSpan.toFixed(1)}`);
      let minViolated = false;
      heavy.weightSpans.forEach((vs, i) => {
        if (vs === null) return;
        usage = Math.max(usage, (100 * vs) / allow.maxWeightSpan[i]!);
        parts.push(`weight span ${i + 1}: ${vs.toFixed(1)} / ${allow.maxWeightSpan[i]!.toFixed(1)}`);
        if (vs < allow.minWeightSpan) minViolated = true;
      });
      if (heavy.weightSpans.some((v) => v === null)) parts.push('some weight-span conditions are not defined in the criteria');
      method1 = { usage, ok: usage <= 100 + 1e-9 && !minViolated, detail: parts.join('; ') + (minViolated ? `; below the minimum weight span ${allow.minWeightSpan.toFixed(1)}` : '') };
    }
  }
  // Method 2 (§8.3.2, App. F.1.4.2): the heaviest set's wind and weight spans for each interaction condition,
  // inside the allowable diagram of the angle range containing the line angle.
  let method2: StructureResult['method2'] = null;
  if (t?.strength.method === 'method2' && sets.length && sd.frame) {
    const heavy = [...sets].sort((x, y) => y.weight - x.weight)[0]!;
    const angle = Math.abs(sd.frame.lineAngle);
    const ranges = [...t.strength.ranges].sort((x, y) => x.maxAngle - y.maxAngle);
    const range = ranges.find((r) => angle <= r.maxAngle + 1e-9);
    if (!range) method2 = { rows: [], ok: false, detail: `Line angle ${angle.toFixed(2)}° is beyond the largest angle range of the structure.` };
    else if (cr.interactionConditions.length === 0) method2 = { rows: [], ok: false, detail: 'No interaction diagram conditions are defined in the criteria (§7.3.11).' };
    else {
      const wf = weightFns.get(heavy.set)!;
      const rows = cr.interactionConditions.map((cond, j) => {
        const diagram = range.diagrams[j];
        const w = wf(cond);
        if (!diagram || diagram.length < 3) return { condition: j, windSpan: heavy.windSpan, weightSpan: w.vs, inside: false, usage: NaN, message: 'No interaction diagram for this condition and angle range.' };
        if (w.vs === null) return { condition: j, windSpan: heavy.windSpan, weightSpan: null, inside: false, usage: NaN, message: 'The weight span is not available for this condition.' };
        const r = interactionUsage(diagram, heavy.windSpan, w.vs);
        return { condition: j, windSpan: heavy.windSpan, weightSpan: w.vs, inside: r.inside, usage: r.usage };
      });
      const ok = rows.every((r) => r.inside);
      method2 = { rows, ok, detail: rows.map((r) => `condition ${r.condition + 1}: ${r.message ?? `${Number.isFinite(r.usage) ? r.usage.toFixed(1) : '—'} %${r.inside ? '' : ' outside'}`}`).join('; ') };
    }
  }
  return { sd, sets, method1, method2, problems };
}

/** Minimum vertical load checks of an attachment at the weight-span conditions (App. F.1.1). */
export function minVerticalProblems(r: StructureResult): string[] {
  const out: string[] = [];
  for (const s of r.sets) {
    const atts = r.sd.type?.attachments.filter((a) => a.set === s.set) ?? [];
    s.verticalLoads.forEach((vp, ci) => {
      vp.forEach((v, k) => {
        const a = atts.find((x) => x.phase === k + 1);
        if (!a || v === undefined || v === null) return;
        const min = a.minVertical.kind === 'noUplift' ? 0 : a.minVertical.kind === 'value' ? a.minVertical.value : null;
        if (min !== null && v < min) out.push(`Set ${s.set} phase ${k + 1}: vertical load ${v.toFixed(0)} N below the minimum ${min.toFixed(0)} N at weight-span condition ${ci + 1}${v < 0 ? ' (uplift)' : ''}.`);
      });
    });
  }
  return out;
}

export function sectionById(a: Analysis, id: string): SectionAnalysis | undefined {
  return a.sections.get(id);
}

export type { Section };
