import { autoSag, catenaryRise, planeCatenary, unitLoads } from '@tlcad/engine';
import { CriteriaSchema, type Criteria, type Sagging } from '@tlcad/model';
import { useApp } from '../store/appStore';
import { computeDerived } from '../store/derived';
import { computeLineModel } from '../store/lineModel';
import { computeAnalysis, limitsFor, weatherInput, type SectionAnalysis } from '../store/analysis';

/** Criteria and sagging commands (Phase 4). All edits are undoable. */

const app = () => useApp.getState();
const log = (level: 'info' | 'warning' | 'error' | 'result', text: string) => app().addLog(level, text);

export function saveCriteria(cr: Criteria) {
  const r = CriteriaSchema.safeParse(cr);
  if (!r.success) { log('error', `Criteria not saved: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`); return false; }
  const names = new Set<string>();
  for (const w of r.data.weatherCases) {
    if (names.has(w.name)) { log('error', `Two weather cases are named "${w.name}".`); return false; }
    names.add(w.name);
  }
  const ids = new Set(r.data.weatherCases.map((w) => w.id));
  const dangling = [...r.data.tensionLimits, ...r.data.autosagLimits].filter((l) => !ids.has(l.weatherId)).length;
  if (dangling) { log('error', `${dangling} tension limit(s) refer to a weather case that does not exist.`); return false; }
  app().exec('Edit criteria', (d) => { d.criteria = r.data; });
  return true;
}

export function setSagging(sectionId: string, patch: Partial<Sagging>, label = 'Edit section sagging') {
  app().exec(label, (d) => {
    const s = d.sections.find((x) => x.id === sectionId);
    if (s) s.sagging = { ...s.sagging, ...patch };
  });
}

/** Current analysis of one section, computed from the store (for commands). */
export function analysisOf(sectionId: string): SectionAnalysis | undefined {
  const p = app().project;
  if (!p) return undefined;
  const d = computeDerived(p);
  return computeAnalysis(p, d, computeLineModel(p, d)).sections.get(sectionId);
}

/** Automatic sagging (§10.3.2.1.3): the largest H at the sagging condition that meets every automatic sagging limit. */
export function autoSagSection(sectionId: string) {
  const p = app().project!;
  const sa = analysisOf(sectionId);
  if (!sa || !sa.model) { log('error', `Automatic sagging not possible: ${sa?.message ?? 'section not found.'}`); return; }
  if (sa.status === 'error' && sa.sd.problems.length) { log('error', `Automatic sagging not possible: ${sa.message}`); return; }
  const items = limitsFor(p, sa, p.criteria.autosagLimits);
  const bad = items.find((i) => !i.engine);
  if (bad) { log('error', `Automatic sagging limit not usable: ${bad.message}`); return; }
  const ws = (id: string | null) => {
    const wc = id ? p.criteria.weatherCases.find((w) => w.id === id) : undefined;
    if (!wc) return null;
    const l = unitLoads(sa.model!, weatherInput(wc));
    return l.ok ? { temperature: wc.temperature, w: l.loads.urTension } : null;
  };
  const sag = sa.sd.section.sagging;
  const r = autoSag({
    cable: sa.model, rulingSpan: sa.rulingSpan, reference: { condition: sag.condition, temperature: sag.temperature, H: 1 },
    creep: ws(p.criteria.creepWeatherId), load: ws(p.criteria.loadWeatherId),
  }, items.map((i) => i.engine!));
  if (!r.ok) { log('error', `Automatic sagging failed: ${r.message}`); return; }
  setSagging(sectionId, { H: r.H, src: 'calculated' }, 'Automatic sagging');
  log('result', `Section sagged automatically: H = ${r.H.toFixed(1)} N at the sagging condition; controlling limit ${r.controlling + 1} at ${r.checks[r.controlling]!.usage.toFixed(1)} %.`);
}

/**
 * Graphical sagging (§10.3.2.1.4): the sagging tension for which the wire of a
 * span passes through a picked profile point, with the bare cable at the
 * sagging condition. The span shape in the vertical plane is the catenary of
 * App. J with C = H / UW; bisection on C.
 */
export function sagThroughPoint(sectionId: string, station: number, z: number): boolean {
  const sa = analysisOf(sectionId);
  if (!sa || !sa.model || !sa.sd.profile.length) { log('error', 'Graphical sagging: the section cannot be analysed.'); return false; }
  // The phase and span under the picked station whose chord is closest to the point.
  let best: { k: number; i: number; d: number } | null = null;
  sa.sd.profile.forEach((ph, k) => ph.slice(1).forEach((E, i) => {
    const O = ph[i]!;
    if ((station - O.station) * (station - E.station) > 0) return;
    const t = (station - O.station) / (E.station - O.station || 1);
    const dz = Math.abs(O.z + t * (E.z - O.z) - z);
    if (!best || dz < best.d) best = { k, i, d: dz };
  }));
  if (!best) { log('error', 'Graphical sagging: pick a point inside a span of the section.'); return false; }
  const { k, i } = best as { k: number; i: number };
  const g = sa.phases[k]![i]!;
  const O = sa.sd.profile[k]![i]!, E = sa.sd.profile[k]![i + 1]!;
  const h = Math.hypot(g.E.x - g.O.x, g.E.y - g.O.y);
  const v = g.E.z - g.O.z;
  const x = h * (station - O.station) / (E.station - O.station);
  const zAt = (C: number) => g.O.z + catenaryRise(planeCatenary(h, v, C).a, C, x);
  const chordZ = g.O.z + (v * x) / h;
  if (z >= chordZ) { log('error', 'Graphical sagging: the picked point must lie below the chord of the span.'); return false; }
  let lo = h / 1000, hi = h * 1e4;
  if (zAt(lo) > z || zAt(hi) < z) { log('error', 'Graphical sagging: no catenary of this span passes through the picked point.'); return false; }
  for (let n = 0; n < 200; n++) {
    const mid = Math.sqrt(lo * hi);
    if (zAt(mid) < z) lo = mid; else hi = mid;
  }
  const C = (lo + hi) / 2;
  const sag = sa.sd.section.sagging;
  // The sagging condition is the bare cable (§10.3.2), so H = C × UW.
  const H = C * sa.model.unitWeight;
  setSagging(sectionId, { H, src: 'user' }, 'Graphical sagging');
  log('result', `Section sagged graphically through the picked point: C = ${C.toFixed(1)} m, H = ${H.toFixed(1)} N at ${sag.condition} ${sag.temperature} °C.`);
  return true;
}
