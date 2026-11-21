import {
  distanceToTin, ellipseOutline, gallopingEllipse, iceJump, indexTin, outlineDistance, piercePlane, planeCatenary, pointPolylineDistance,
  polylineDistance, solveSpan, structureFrame, zoneCheck,
  type GallopingParams, type Tin, type TinIndex, type Vec3,
} from '@tlcad/engine';
import type { CableConditionValue, FeatureCode, Project, WeatherCase } from '@tlcad/model';
import type { Derived } from './derived';
import type { LineModel } from './lineModel';
import { stateAt, stateForWeather, type Analysis, type ConditionState, type SectionAnalysis } from './analysis';

/**
 * Clearance checks (Phase 5): survey points (§6.1.1, §11.2.3.1), clearance to
 * the TIN (§11.2.3.4), between wires (§11.2.3.2) and galloping ellipses
 * (§7.3.15, §11.2.3.2.3). Required clearances are the user's feature-code
 * and criteria values; none is supplied by the program.
 */

const COND_SHORT: Record<CableConditionValue, string> = { initial: 'Initial', creep: 'Creep', load: 'Load' };
const SAMPLES = 48;

export interface WireSpan {
  sectionId: string;
  sa: SectionAnalysis;
  phase: number;
  span: number;
  label: string;
  /** Virtual stations of the span ends (ascending). */
  stations: [number, number];
  voltageKV: number;
  diameter: number;
  points: Vec3[];
}

export interface ConditionSpec { weather: WeatherCase | null; condition: CableConditionValue; windSign: -1 | 1; straight?: boolean }

export function conditionLabel(spec: ConditionSpec): string {
  if (spec.straight) return 'Straight line wire';
  const w = spec.weather ? spec.weather.name : 'Sagging condition';
  const wind = spec.weather && spec.weather.windPressure > 0 ? `, wind ${spec.windSign < 0 ? 'left' : 'right'}` : '';
  return `${w}, ${COND_SHORT[spec.condition]}${wind}`;
}

/** Wind sides to check for a weather case: both when it has wind (§7.3.13), one otherwise. */
export const windSides = (wc: WeatherCase | null): (-1 | 1)[] => (wc && wc.windPressure > 0 ? [-1, 1] : [1]);

function spanLabel(sa: SectionAnalysis, i: number) {
  return `${sa.attached[i]?.number ?? '?'}–${sa.attached[i + 1]?.number ?? '?'}`;
}

/** Wire span shapes of one section for a condition, sampled finely for clearance work. */
export function sectionSpans(sa: SectionAnalysis, spec: ConditionSpec, cs?: ConditionState): { ok: true; spans: WireSpan[] } | { ok: false; message: string } {
  const sd = sa.sd;
  const base = (k: number, i: number, points: Vec3[]): WireSpan => {
    const s0 = sd.profile[k]![i]!.station, s1 = sd.profile[k]![i + 1]!.station;
    return {
      sectionId: sd.section.id, sa, phase: k, span: i, label: `${spanLabel(sa, i)} ph ${k + 1}`,
      stations: [Math.min(s0, s1), Math.max(s0, s1)], voltageKV: sd.section.voltageKV, diameter: sa.cable?.diameter ?? 0, points,
    };
  };
  if (spec.straight) {
    if (!sd.wires.length) return { ok: false, message: sa.message ?? 'No wires.' };
    return { ok: true, spans: sa.phases.flatMap((spans, k) => spans.map((g, i) => base(k, i, [g.O, g.E]))) };
  }
  if (sa.status !== 'sagged') return { ok: false, message: `Section ${sd.from}–${sd.to}: ${sa.message ?? 'not sagged'}` };
  const st = cs ?? (spec.weather ? stateForWeather(sa, spec.weather, spec.condition) : null);
  if (!st) return { ok: false, message: 'The sagging-condition state must be given.' };
  if (!st.ok) return { ok: false, message: `Section ${sd.from}–${sd.to}: ${st.message}` };
  const f = st.loads.ur > 0 ? st.loads.urTension / st.loads.ur : 1;
  const load = { uh: st.loads.uh * f, uv: st.loads.uv * f };
  return {
    ok: true,
    spans: sa.phases.flatMap((spans, k) => spans.map((g, i) => base(k, i, solveSpan(g.O, g.E, st.H, load, st.loads.uh > 0 ? spec.windSign : 0, SAMPLES).points))),
  };
}

/** Spans of every sagged section for a condition; problems collected per section. */
export function allSpans(p: Project, a: Analysis, spec: ConditionSpec, filter?: (sa: SectionAnalysis) => boolean) {
  const spans: WireSpan[] = [];
  const problems: string[] = [];
  for (const sa of a.sections.values()) {
    if (filter && !filter(sa)) continue;
    const cs = spec.straight ? undefined : spec.weather ? stateForWeather(sa, spec.weather, spec.condition) : stateAt(p, sa, null, spec.condition);
    const r = sectionSpans(sa, spec, cs);
    if (r.ok) spans.push(...r.spans); else problems.push(r.message);
  }
  return { spans, problems };
}

/** Required clearance of a feature code for a voltage (§6.1); null when the table has no entry. */
export function requiredFor(fc: FeatureCode | undefined, kv: number): { rv: number; rh: number } | null {
  if (!fc) return null;
  const key = Object.keys(fc.clearances).find((k) => Math.abs(Number(k) - kv) < 1e-6);
  const c = key !== undefined ? fc.clearances[key] : undefined;
  if (!c || c.rv === null) return null;
  return { rv: c.rv, rh: c.rh ?? 0 };
}

/** Condition specs for the survey-point clearance conditions (used also for the TIN check). */
export function surveySpecs(p: Project): { specs: ConditionSpec[]; problems: string[] } {
  const specs: ConditionSpec[] = [];
  const problems: string[] = [];
  for (const c of p.criteria.surveyClearance.conditions) {
    const wc = c.weatherId ? p.criteria.weatherCases.find((w) => w.id === c.weatherId) ?? null : null;
    if (c.weatherId && !wc) { problems.push('A survey point clearance condition refers to a deleted weather case.'); continue; }
    for (const s of windSides(wc)) specs.push({ weather: wc, condition: c.condition, windSign: s });
  }
  return { specs, problems };
}

// ------------------------------------------------------------------ Survey points (CL1)

export type ClearanceStatus = 'violation' | 'questionable' | 'ok';

export interface PointClearance {
  pointId: string;
  code: number;
  description: string;
  x: number;
  y: number;
  top: number;
  /** Ground elevation under the point and whether it is an aerial obstacle (lower edge of the zone). */
  ground: number;
  aerial: boolean;
  station: number;
  offset: number;
  status: ClearanceStatus;
  kind: 'rectangle' | 'band' | 'radial';
  required: { rv: number; rh: number };
  /** Signed distance to the edge of the zone (rectangle/band) or radial distance minus RV. */
  margin: number;
  lateral: number | null;
  vertical: number | null;
  distance: number | null;
  wire: Vec3;
  condition: string;
  span: string;
  sectionId: string;
}

export interface SurveyClearanceResult {
  results: PointClearance[];
  checkedPoints: number;
  noRequirement: number;
  problems: string[];
}

export function surveyClearances(p: Project, d: Derived, a: Analysis): SurveyClearanceResult {
  const { specs, problems } = surveySpecs(p);
  if (specs.length === 0) return { results: [], checkedPoints: 0, noRequirement: 0, problems: [...problems, 'No survey point clearance conditions are defined in the criteria (§7.3.13).'] };
  const radial = p.criteria.surveyClearance.type === 'radial';
  const maxH = p.criteria.surveyClearance.maxHorizontal;
  const sets = specs.map((spec) => ({ spec, label: conditionLabel(spec), ...allSpans(p, a, spec) }));
  for (const s of sets) for (const m of s.problems) if (!problems.includes(m)) problems.push(m);
  // Spans indexed by station bins, so each point only meets the spans over it (radial: within the largest RV).
  const BIN = 50;
  const maxRv = radial ? Math.max(0, ...p.terrain.featureCodes.flatMap((c) => Object.values(c.clearances).map((r) => r.rv ?? 0))) : 0;
  const index = sets.map((set) => {
    const m = new Map<number, WireSpan[]>();
    for (const sp of set.spans) {
      for (let b = Math.floor((sp.stations[0] - maxRv) / BIN); b <= Math.floor((sp.stations[1] + maxRv) / BIN); b++) {
        let l = m.get(b);
        if (!l) m.set(b, (l = []));
        l.push(sp);
      }
    }
    return m;
  });
  const reqCache = new Map<string, { rv: number; rh: number } | null>();
  const reqOf = (fc: FeatureCode, kv: number) => {
    const k = `${fc.code}|${kv}`;
    if (!reqCache.has(k)) reqCache.set(k, requiredFor(fc, kv));
    return reqCache.get(k)!;
  };
  const best = new Map<string, PointClearance>();
  let noRequirement = 0, checked = 0;
  const seen = new Set<number>();
  d.lines.forEach((line) => {
    const g = line.geom;
    if (!g) return;
    for (const q of line.projected) {
      const pt = d.points[q.i]!;
      const fc = d.codes.get(pt.code);
      if (!fc || Object.values(fc.clearances).every((c) => c.rv === null)) { if (!seen.has(q.i)) { seen.add(q.i); noRequirement++; } continue; }
      let frame: ReturnType<typeof structureFrame> | null = null;
      const top = pt.z + pt.h;
      for (let si = 0; si < sets.length; si++) {
        const set = sets[si]!;
        for (const sp of index[si]!.get(Math.floor(q.station / BIN)) ?? []) {
          const req = reqOf(fc, sp.voltageKV);
          if (!req) continue;
          const reach = radial ? req.rv : 0;
          if (q.station < sp.stations[0] - reach - 1e-6 || q.station > sp.stations[1] + reach + 1e-6) continue;
          if (!seen.has(q.i)) { seen.add(q.i); checked++; }
          let cand: Omit<PointClearance, 'pointId' | 'code' | 'description' | 'x' | 'y' | 'top' | 'ground' | 'aerial' | 'station' | 'offset' | 'required'> | null = null;
          if (radial) {
            const r = pointPolylineDistance({ x: pt.x, y: pt.y, z: top }, sp.points);
            if (maxH !== null && Math.hypot(r.at.x - pt.x, r.at.y - pt.y) > maxH) continue;
            cand = { status: r.d < req.rv ? 'violation' : 'ok', kind: 'radial', margin: r.d - req.rv, lateral: null, vertical: r.at.z - top, distance: r.d, wire: r.at, condition: set.label, span: sp.label, sectionId: sp.sectionId };
          } else {
            frame ??= structureFrame(g, q.station, 0, 0);
            const dir = { x: -frame.ts.n, y: frame.ts.e };
            for (const w of piercePlane(sp.points, pt, dir)) {
              const zc = zoneCheck({ x: pt.x, y: pt.y, top, ground: pt.z, aerial: fc.aerial, rv: req.rv, rh: req.rh }, w, dir);
              if (maxH !== null && Math.abs(zc.lateral) > maxH) continue;
              const c = {
                status: (zc.inside ? (zc.kind === 'band' ? 'questionable' : 'violation') : 'ok') as ClearanceStatus,
                kind: zc.kind, margin: zc.margin, lateral: zc.lateral, vertical: zc.vertical, distance: null, wire: w,
                condition: set.label, span: sp.label, sectionId: sp.sectionId,
              };
              if (!cand || c.margin < cand.margin) cand = c;
            }
          }
          if (!cand) continue;
          const prev = best.get(pt.id);
          if (!prev || cand.margin < prev.margin) {
            best.set(pt.id, {
              pointId: pt.id, code: pt.code, description: pt.desc || fc.description, x: pt.x, y: pt.y, top, ground: pt.z, aerial: fc.aerial, station: q.station, offset: q.offset,
              required: req, ...cand,
            });
          }
        }
      }
    }
  });
  const results = [...best.values()].sort((x, y) => x.margin - y.margin);
  return { results, checkedPoints: checked, noRequirement, problems };
}

// ------------------------------------------------------------------ Clearance to TIN (CL2)

let tinIndexCache: { tin: Tin; ix: TinIndex } | null = null;
function tinIndex(tin: Tin): TinIndex {
  if (tinIndexCache?.tin !== tin) tinIndexCache = { tin, ix: indexTin(tin, 20) };
  return tinIndexCache.ix;
}

export interface TinClearance {
  span: string;
  sectionId: string;
  condition: string;
  distance: number;
  wire: Vec3;
  ground: Vec3;
  required: number | null;
  status: ClearanceStatus;
}

/** Shortest 3-D distance from each wire span to the TIN, for the survey clearance conditions (§11.2.3.4). */
export function tinClearances(p: Project, d: Derived, a: Analysis): { results: TinClearance[]; problems: string[] } {
  if (!d.tin) return { results: [], problems: ['The TIN is not enabled (Terrain ▸ Use TIN).'] };
  const { specs, problems } = surveySpecs(p);
  if (!specs.length) return { results: [], problems: [...problems, 'No survey point clearance conditions are defined in the criteria (§7.3.13).'] };
  const ix = tinIndex(d.tin);
  const gc = p.criteria.clearanceLine.groundCode;
  const fc = gc !== null ? d.codes.get(gc) : undefined;
  if (gc === null) problems.push('No feature code for ground clearance is chosen (Criteria ▸ Clearances), so TIN distances are not compared with a requirement.');
  const results: TinClearance[] = [];
  for (const spec of specs) {
    const { spans, problems: pr } = allSpans(p, a, spec);
    for (const m of pr) if (!problems.includes(m)) problems.push(m);
    for (const sp of spans) {
      let best: { d: number; wire: Vec3; at: Vec3 } | null = null;
      for (const w of sp.points) {
        let reach = 30, r = distanceToTin(ix, w, reach);
        while ((!r || r.d > reach) && reach < 2000) { reach = r ? r.d * 1.01 : reach * 2; r = distanceToTin(ix, w, reach); }
        if (r && (!best || r.d < best.d)) best = { d: r.d, wire: w, at: r.at };
      }
      if (!best) continue;
      const req = requiredFor(fc, sp.voltageKV)?.rv ?? null;
      results.push({
        span: sp.label, sectionId: sp.sectionId, condition: conditionLabel(spec), distance: best.d, wire: best.wire, ground: best.at, required: req,
        status: req === null ? 'ok' : best.d < req ? 'violation' : 'ok',
      });
    }
  }
  // Keep the worst condition per span.
  const worst = new Map<string, TinClearance>();
  for (const r of results) {
    const k = `${r.sectionId}|${r.span}`;
    const prev = worst.get(k);
    const m = (x: TinClearance) => x.distance - (x.required ?? 0);
    if (!prev || m(r) < m(prev)) worst.set(k, r);
  }
  return { results: [...worst.values()].sort((x, y) => x.distance - (x.required ?? 0) - (y.distance - (y.required ?? 0))), problems };
}

// ------------------------------------------------------------------ Between wires (CL3)

export interface WirePairClearance {
  source: string;
  target: string;
  distance: number;
  /** Distance between surfaces: centre-line distance minus the two radii (§11.2.3.2.2). */
  clearance: number;
  required: number | null;
  status: ClearanceStatus;
  pa: Vec3;
  pb: Vec3;
}

export function wireClearances(p: Project, a: Analysis): { results: WirePairClearance[]; problems: string[]; sourceLabel: string; targetLabel: string } {
  const wc = p.criteria.wireClearance;
  const problems: string[] = [];
  const specOf = (s: typeof wc.source): ConditionSpec | null => {
    if (s.straight) return { weather: null, condition: s.condition, windSign: 1, straight: true };
    const w = s.weatherId ? p.criteria.weatherCases.find((x) => x.id === s.weatherId) ?? null : null;
    if (s.weatherId && !w) { problems.push('A wire clearance condition refers to a deleted weather case.'); return null; }
    return { weather: w, condition: s.condition, windSign: s.wind === 'left' ? -1 : 1 };
  };
  const sSpec = specOf(wc.source), tSpec = specOf(wc.target);
  if (!sSpec || !tSpec) return { results: [], problems, sourceLabel: '', targetLabel: '' };
  const byKV = (kv: number | null) => (sa: SectionAnalysis) => kv === null || Math.abs(sa.sd.section.voltageKV - kv) < 1e-6;
  const src = allSpans(p, a, sSpec, byKV(wc.source.voltageKV));
  const tgt = allSpans(p, a, tSpec, byKV(wc.target.voltageKV));
  problems.push(...src.problems, ...tgt.problems.filter((m) => !src.problems.includes(m)));
  let sourceLabel = conditionLabel(sSpec);
  if (wc.source.iceJump && !sSpec.straight) {
    if (!sSpec.weather || (sSpec.weather.iceThickness === 0 && sSpec.weather.iceLoad === 0)) problems.push('Ice jumping needs a source weather case with ice; it was not applied.');
    else {
      // Un-iced position at the same temperature: the same weather case with its ice removed (§11.2.3.2.2).
      const bare = { ...sSpec.weather, iceThickness: 0, iceLoad: 0 };
      const un = allSpans(p, a, { ...sSpec, weather: bare }, byKV(wc.source.voltageKV));
      const key = (s: WireSpan) => `${s.sectionId}|${s.phase}|${s.span}`;
      const unMap = new Map(un.spans.map((s) => [key(s), s]));
      for (const s of src.spans) { const u = unMap.get(key(s)); if (u) s.points = iceJump(s.points, u.points); }
      sourceLabel += ', ice jump';
    }
  }
  const horizontal = wc.measure === 'horizontal';
  const results: WirePairClearance[] = [];
  const done = new Set<string>();
  for (const s of src.spans) {
    for (const t of tgt.spans) {
      // A wire is not compared with itself (same section and phase).
      if (s.sectionId === t.sectionId && s.phase === t.phase) continue;
      const pairKey = [`${s.sectionId}|${s.phase}|${s.span}`, `${t.sectionId}|${t.phase}|${t.span}`].sort().join('#');
      if (sSpec === tSpec || JSON.stringify(wc.source) === JSON.stringify(wc.target)) { if (done.has(pairKey)) continue; done.add(pairKey); }
      const r = polylineDistance(s.points, t.points, horizontal, 200);
      if (!r) continue;
      const clearance = r.d - (s.diameter + t.diameter) / 2;
      const reqRow = wc.required.find((q) => (Math.abs(q.sourceKV - s.voltageKV) < 1e-6 && Math.abs(q.targetKV - t.voltageKV) < 1e-6)
        || (Math.abs(q.sourceKV - t.voltageKV) < 1e-6 && Math.abs(q.targetKV - s.voltageKV) < 1e-6));
      const required = reqRow?.distance ?? null;
      results.push({
        source: s.label + ` (${s.voltageKV} kV)`, target: t.label + ` (${t.voltageKV} kV)`, distance: r.d, clearance, required,
        status: required !== null && clearance < required ? 'violation' : 'ok', pa: r.pa, pb: r.pb,
      });
    }
  }
  // Keep, for each source span, its closest target.
  const bySource = new Map<string, WirePairClearance>();
  for (const r of results) {
    const prev = bySource.get(r.source);
    if (!prev || r.clearance - (r.required ?? 0) < prev.clearance - (prev.required ?? 0)) bySource.set(r.source, r);
  }
  return { results: [...bySource.values()].sort((x, y) => x.clearance - (x.required ?? 0) - (y.clearance - (y.required ?? 0))), problems, sourceLabel, targetLabel: conditionLabel(tSpec) };
}

// ------------------------------------------------------------------ Galloping (CL4)

export interface GallopingPhase {
  phase: number;
  sag: number;
  ssw: number;
  params: GallopingParams;
  /** Cross-section coordinates at mid-span: u horizontal (toward the right of the span), z elevation. */
  conductor: { u: number; z: number };
  outline: { u: number; z: number }[];
}

export interface GallopingSpan {
  sectionId: string;
  span: string;
  side: 'left' | 'right';
  phases: GallopingPhase[];
  pairs: { a: number; b: number; distance: number; overlap: boolean }[];
  problems: string[];
}

/**
 * Galloping ellipses of every span (§7.3.15). The span hangs at SAG below the
 * chord mid-point, rotated by the span swing SSW about the chord (§11.2.3.1
 * describes the span rotating about the line joining its supports); suspension
 * insulator swing is not included. As drawn in Fig. 7.3-13, the conductor lies
 * on the major axis (tilted ESW toward the swing) at distance B above the lower
 * end of the ellipse.
 */
export function gallopingSpans(p: Project, a: Analysis): { results: GallopingSpan[]; problems: string[] } {
  const g = p.criteria.galloping;
  const problems: string[] = [];
  const wcOf = (id: string | null) => (id ? p.criteria.weatherCases.find((w) => w.id === id) ?? null : null);
  const sagW = wcOf(g.sag.weatherId), swW = wcOf(g.swing.weatherId);
  if (!g.sag.weatherId || !g.swing.weatherId) return { results: [], problems: ['Define the galloping sag and swing conditions in the criteria (§7.3.15).'] };
  const results: GallopingSpan[] = [];
  for (const sa of a.sections.values()) {
    if (sa.status !== 'sagged' || !sa.model) { problems.push(`Section ${sa.sd.from}–${sa.sd.to}: ${sa.message ?? 'not sagged'}`); continue; }
    const csSag = sagW ? stateForWeather(sa, sagW, g.sag.condition) : stateAt(p, sa, null, g.sag.condition);
    const csSw = swW ? stateForWeather(sa, swW, g.swing.condition) : stateAt(p, sa, null, g.swing.condition);
    if (!csSag.ok) { problems.push(csSag.message); continue; }
    if (!csSw.ok) { problems.push(csSw.message); continue; }
    const bundle = sa.sd.section.conductorsPerPhase > 1;
    if ((g.method === 'cigreSingle' && bundle) || (g.method === 'cigreBundle' && !bundle)) {
      problems.push(`Section ${sa.sd.from}–${sa.sd.to}: the CIGRE ${g.method === 'cigreSingle' ? 'single-wire' : 'bundle'} equations do not match its ${sa.sd.section.conductorsPerPhase} conductor(s) per phase.`);
    }
    const nSpans = sa.phases[0]?.length ?? 0;
    for (let i = 0; i < nSpans; i++) {
      for (const sideSign of [-1, 1] as const) {
        const ref = sa.phases[0]![i]!;
        const hx = ref.E.x - ref.O.x, hy = ref.E.y - ref.O.y, hl = Math.hypot(hx, hy) || 1;
        const n = { x: hy / hl, y: -hx / hl };
        const M0 = { x: (ref.O.x + ref.E.x) / 2, y: (ref.O.y + ref.E.y) / 2 };
        const phases: GallopingPhase[] = [];
        const probs: string[] = [];
        sa.phases.forEach((spans, k) => {
          const s = spans[i]!;
          const h = Math.hypot(s.E.x - s.O.x, s.E.y - s.O.y), v = s.E.z - s.O.z;
          const fS = csSag.loads.ur > 0 ? csSag.loads.urTension / csSag.loads.ur : 1;
          const sag = planeCatenary(h, v, csSag.H / (csSag.loads.ur * fS)).sag;
          const ssw = (Math.atan2(csSw.loads.uh, csSw.loads.uv) * 180) / Math.PI;
          const L = Math.hypot(h, v);
          const r = gallopingEllipse(g.method, { sag, ssw, span: L, dia: sa.model!.diameter, gsf: g.gsf, eswZero: g.eswZero });
          if (!r.ok) { probs.push(`Phase ${k + 1}: ${r.message}`); return; }
          const M = { x: (s.O.x + s.E.x) / 2, y: (s.O.y + s.E.y) / 2, z: (s.O.z + s.E.z) / 2 };
          const u0 = (M.x - M0.x) * n.x + (M.y - M0.y) * n.y;
          const sw = (ssw * Math.PI) / 180 * sideSign;
          const c = { u: u0 + sag * Math.sin(sw), z: M.z - sag * Math.cos(sw) };
          const incl = r.value.esw * sideSign;
          const ti = (incl * Math.PI) / 180;
          const off = r.value.major / 2 - r.value.b; // centre above the conductor along the major axis
          const centre = { u: c.u + off * Math.sin(ti), z: c.z + off * Math.cos(ti) };
          phases.push({ phase: k + 1, sag, ssw, params: r.value, conductor: c, outline: ellipseOutline(centre.u, centre.z, r.value.major, r.value.minor, incl) });
        });
        const pairs: GallopingSpan['pairs'] = [];
        for (let x = 0; x < phases.length; x++) for (let y = x + 1; y < phases.length; y++) {
          const dd = outlineDistance(phases[x]!.outline, phases[y]!.outline);
          pairs.push({ a: phases[x]!.phase, b: phases[y]!.phase, distance: dd, overlap: dd === 0 });
        }
        results.push({ sectionId: sa.sd.section.id, span: spanLabel(sa, i), side: sideSign < 0 ? 'left' : 'right', phases, pairs, problems: probs });
      }
    }
  }
  return { results, problems };
}

export type { LineModel };
