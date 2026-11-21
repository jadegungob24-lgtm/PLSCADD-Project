import {
  CONDITION_LABEL, formatDMS, fromSI, toSI, levelSag, planeCatenary, sectionState, unitLabel, type Dimension,
} from '@tlcad/engine';
import type { Report, ReportTable } from '@tlcad/io';
import type { CableConditionValue, Project } from '@tlcad/model';
import { stationText, type DerivedView } from '../store/derived';
import { minVerticalProblems, sectionLimitChecks, stateAt, structureResult } from '../store/analysis';
import { surveyClearances, wireClearances } from '../store/clearances';
import { loadTrees } from '../store/loads';
import { billOfMaterial, cableLengths } from './bom';

/**
 * Report builders (manual §12, App. R). Every value is converted to the
 * project's display units; the unit is given in the column heading.
 */

export type ReportKind = 'staking' | 'summary' | 'sagTension' | 'stringing' | 'structures' | 'loads' | 'clearances' | 'bom';
export const REPORTS: [ReportKind, string][] = [
  ['staking', 'Structure staking table (§12.2.1)'],
  ['summary', 'Line summary'],
  ['sagTension', 'Sag-tension report (§11.2.1)'],
  ['stringing', 'Stringing charts (§11.2.4)'],
  ['structures', 'Wind and weight spans, swing and strength checks'],
  ['loads', 'Structure loads (load trees, §7.3.12)'],
  ['clearances', 'Clearances: survey points and wires (§11.2.3)'],
  ['bom', 'Bill of material (§8.5.6.1)'],
];

export function buildReport(kind: ReportKind, p: Project, d: DerivedView): Report {
  const sys = p.settings.unitSystem;
  const u = (dim: Dimension) => unitLabel(sys, dim);
  const v = (x: number | null | undefined, dim: Dimension) => (x === null || x === undefined || !Number.isFinite(x) ? null : fromSI(x, sys, dim));
  const header = [`Project: ${p.meta.name}${p.meta.lineName ? ` — ${p.meta.lineName}` : ''}`, `Generated ${new Date().toLocaleString()} by TLCAD`, `Units: ${sys === 'US' ? 'US customary' : sys === 'SI_N' ? 'SI (N)' : 'SI (daN)'}`];
  const title = REPORTS.find((r) => r[0] === kind)![1].replace(/ \(.*\)$/, '');
  const tables: ReportTable[] = [];
  const structs = d.model.structures;
  const label = (x: (typeof structs)[number]) => x.s.label || String(x.number);

  if (kind === 'staking') {
    const rows = structs.map((x, i) => {
      const next = structs[i + 1];
      const ahead = next && x.frame && next.frame && next.line === x.line ? Math.hypot(next.frame.baseX - x.frame.baseX, next.frame.baseY - x.frame.baseY) : null;
      const az = x.frame ? ((Math.atan2(x.frame.ts.e, x.frame.ts.n) * 180) / Math.PI + 360) % 360 : null;
      return [label(x), Number.isFinite(x.station) ? stationText(p, x.station) : '', v(x.s.offset, 'length'), v(x.s.heightAdjust, 'length'), x.s.orientation,
        v(x.frame?.baseX, 'length'), v(x.frame?.baseY, 'length'), v(x.ground, 'length'), x.groundSource ?? '', v(ahead, 'length'),
        x.frame ? formatDMS(x.frame.lineAngle) : '', az, x.type?.name ?? '(missing)', x.type?.description ?? '', v(x.type?.height, 'length'), v(x.type?.embedment, 'length'),
        Object.entries(x.s.counterweights).map(([k, w]) => `set ${k}: ${fromSI(w, sys, 'force').toFixed(0)}`).join('; ')];
    });
    tables.push({
      title: 'Structures', rows, flagged: structs.map((x, i) => (x.problems.length ? i : -1)).filter((i) => i >= 0),
      columns: ['Str', 'Station', `Offset adj. (${u('length')})`, `Height adj. (${u('length')})`, 'Orientation (°)', `X (${u('length')})`, `Y (${u('length')})`, `Ground Z (${u('length')})`, 'Ground from', `Ahead span (${u('length')})`, 'Line angle', 'TS azimuth (°)', 'Structure', 'Description', `Height (${u('length')})`, `Embedment (${u('length')})`, `Counterweights (${u('force')})`],
      decimals: [null, null, 2, 2, 1, 3, 3, 2, null, 2, null, 2, null, null, 2, 2, null],
      notes: ['Ahead span: horizontal distance between the bases of consecutive structures on the same alignment. Flagged rows have problems (see the Properties panel).'],
    });
  }

  if (kind === 'summary') {
    const lens = d.lines.filter((l) => l.geom).map((l) => [l.alignment.name, stationText(p, l.geom!.startStation), stationText(p, l.geom!.startStation + l.geom!.totalLength), v(l.geom!.totalLength, 'length'), l.alignment.pis.length]);
    tables.push({ title: 'Alignments', columns: ['Alignment', 'Start', 'End', `Length (${u('length')})`, 'P.I.s'], rows: lens, decimals: [null, null, null, 2, 0] });
    const byType = new Map<string, number>();
    for (const x of structs) byType.set(x.type?.name ?? '(missing)', (byType.get(x.type?.name ?? '(missing)') ?? 0) + 1);
    tables.push({ title: 'Structures by type', columns: ['Structure', 'Count'], rows: [...byType.entries()].sort().map(([k, n]) => [k, n]), decimals: [null, 0] });
    tables.push({
      title: 'Tension sections', columns: ['Section', 'Cable', 'kV', 'Cond./phase', `Ruling span (${u('length')})`, 'Sagging', `H (${u('force')})`, 'Status'],
      rows: [...d.analysis.sections.values()].map((sa) => [`${sa.sd.from}–${sa.sd.to}`, sa.cable?.name ?? '(missing)', sa.sd.section.voltageKV, sa.sd.section.conductorsPerPhase, v(sa.rulingSpan, 'length'),
        `${CONDITION_LABEL[sa.sd.section.sagging.condition]} ${fromSI(sa.sd.section.sagging.temperature, sys, 'temperature').toFixed(1)} ${u('temperature')}`, v(sa.sd.section.sagging.H, 'force'), sa.status === 'sagged' ? 'sagged' : sa.message ?? sa.status]),
      decimals: [null, null, 0, 0, 2, null, 0, null],
    });
    tables.push({ title: 'Cable quantities', columns: ['Cable', 'Description', `Length (${u('length')})`, 'Basis'], rows: cableLengths(p, d.analysis).map((c) => [c.stock, c.description, v(c.length, 'length'), c.note]), decimals: [null, null, 1, null] });
  }

  if (kind === 'sagTension' || kind === 'stringing') {
    for (const sa of d.analysis.sections.values()) {
      const name = `Section ${sa.sd.from}–${sa.sd.to} (${sa.cable?.name ?? 'no cable'})`;
      if (sa.status !== 'sagged' || !sa.solved || !sa.model) { tables.push({ title: name, columns: ['Status'], rows: [[sa.message ?? 'not sagged']] }); continue; }
      if (kind === 'sagTension') {
        const conds: CableConditionValue[] = ['initial', 'creep', 'load'];
        const rows = p.criteria.weatherCases.flatMap((w) => conds.map((c) => {
          const cs = stateAt(p, sa, w.id, c);
          if (!cs.ok || !cs.state) return [w.name, CONDITION_LABEL[c], v(w.temperature, 'temperature'), null, null, null, null, null, cs.ok ? '' : cs.message];
          const st = cs.state.state;
          return [w.name, CONDITION_LABEL[c], v(w.temperature, 'temperature'), v(cs.loads.urTension, 'forcePerLength'), v(st.H, 'force'), v(st.C, 'length'), v(st.sag, 'length'), v(st.tmax, 'force'), `${((100 * st.tmax) / sa.model!.ultimateTension).toFixed(1)} % ULT`];
        }));
        const lim = sectionLimitChecks(p, sa);
        tables.push({
          title: `${name} — ruling span ${fromSI(sa.rulingSpan, sys, 'length').toFixed(2)} ${u('length')}`,
          columns: ['Weather case', 'Condition', `Temp (${u('temperature')})`, `UR (${u('forcePerLength')})`, `H (${u('force')})`, `C (${u('length')})`, `RS sag (${u('length')})`, `Tmax (${u('force')})`, 'Tension / note'],
          rows, decimals: [null, null, 1, 3, 0, 1, 2, 0, null],
          notes: [
            'Level 1 ruling span method (§7.2.3); the change-of-state solver is the standard length-compatibility method (the manual does not specify one).',
            ...lim.map((l) => `Limit ${p.criteria.weatherCases.find((w) => w.id === l.src.weatherId)?.name ?? '?'} ${CONDITION_LABEL[l.src.condition]}: ${l.check ? `${l.check.usage.toFixed(1)} % of limit — ${l.check.ok ? 'OK' : 'EXCEEDED'}` : l.message}`),
          ],
        });
      } else {
        const temps = sys === 'US' ? [0, 20, 40, 60, 80, 100, 120] : [-20, -10, 0, 10, 20, 30, 40, 50];
        const uw = sa.model.unitWeight;
        const rows = temps.map((tDisp) => {
          const T = toSI(tDisp, sys, 'temperature');
          const st = sectionState(sa.solved!, 'initial', { temperature: T, w: uw });
          if (!st.ok) return [tDisp, null, ...sa.phases[0]!.map(() => null)];
          const C = st.state.H / uw;
          return [tDisp, v(st.state.H, 'force'), ...sa.phases[0]!.map((_, i) => v(sa.phases.reduce((s, ph) => { const g = ph[i]!; return s + planeCatenary(Math.hypot(g.E.x - g.O.x, g.E.y - g.O.y), g.E.z - g.O.z, C).sag; }, 0) / sa.phases.length, 'length'))];
        });
        tables.push({
          title: `${name} — stringing chart, initial condition`,
          columns: [`Temp (${u('temperature')})`, `H (${u('force')})`, ...sa.phases[0]!.map((g, i) => `Span ${sa.attached[i]?.number}–${sa.attached[i + 1]?.number} sag (${u('length')}), ${fromSI(Math.hypot(g.E.x - g.O.x, g.E.y - g.O.y), sys, 'length').toFixed(1)}`)],
          rows, decimals: [0, 0, ...sa.phases[0]!.map(() => 2)],
          notes: [`Ruling span ${fromSI(sa.rulingSpan, sys, 'length').toFixed(2)} ${u('length')}, ruling span sag at the sagging condition ${fromSI(levelSag(sa.rulingSpan, sa.sd.section.sagging.H! / uw), sys, 'length').toFixed(2)} ${u('length')}. Mid-span sags from the chord, bare cable, average of the phases (§11.2.4).`],
        });
      }
    }
  }

  if (kind === 'structures') {
    const rows: (string | number | null)[][] = [];
    const flagged: number[] = [];
    for (const sd of structs) {
      const r = structureResult(p, d.analysis, sd);
      const vp = minVerticalProblems(r);
      for (const s of r.sets) {
        const swing = s.swings.map((w) => `S${w.condition + 1} ph${w.attachment.phase} ${w.uplift ? 'UPLIFT' : `${w.min.toFixed(1)}/${w.max.toFixed(1)}`}${!w.uplift && w.allowMin !== null ? ` [${w.allowMin}…${w.allowMax}]` : ''}`).join('; ');
        const strength = [r.method1 ? `M1 ${Number.isFinite(r.method1.usage) ? r.method1.usage.toFixed(1) : '—'} %` : '', r.method2 ? `M2 ${r.method2.rows.map((q) => (Number.isFinite(q.usage) ? q.usage.toFixed(1) : '—')).join('/')} %` : ''].filter(Boolean).join(' ');
        const bad = s.swings.some((w) => !w.ok) || vp.length > 0 || (r.method1 && !r.method1.ok) || (r.method2 && !r.method2.ok);
        if (bad) flagged.push(rows.length);
        rows.push([label(sd), sd.type?.name ?? '', s.set, v(s.windSpan, 'length'), ...[0, 1, 2].map((i) => v(s.weightSpans[i] ?? null, 'length')), swing, strength, [...vp, ...s.notes].join(' ') || (bad ? 'check' : 'OK')]);
      }
    }
    tables.push({
      title: 'Wind and weight spans, insulator swing, strength', rows, flagged,
      columns: ['Str', 'Type', 'Set', `Wind span (${u('length')})`, `Weight span 1 (${u('length')})`, `Weight span 2 (${u('length')})`, `Weight span 3 (${u('length')})`, 'Swing min/max [allowed] (°)', 'Strength usage', 'Remarks'],
      decimals: [null, null, 0, 1, 1, 1, 1, null, null, null],
      notes: ['Wind span App. I.2; weight span App. I.3 (negative = uplift); swing Eqs. 7-37/7-38; Method 1 §8.3.1; Method 2 §8.3.2.'],
    });
  }

  if (kind === 'loads') {
    for (const sd of structs) {
      const r = loadTrees(p, d, d.analysis, sd);
      if (!r.results.length) continue;
      const rows = r.results.flatMap((lc) => lc.attachments.map((at) => [lc.loadCase.name, lc.loadCase.windDirection, `${at.attachment.set}:${at.attachment.phase}`, v(at.vertical, 'force'), v(at.transverse, 'force'), v(at.longitudinal, 'force'), v(lc.sprt, 'pressure'), v(lc.sprl, 'pressure')]));
      tables.push({
        title: `Structure ${label(sd)} (${sd.type?.name ?? ''})`, rows,
        columns: ['Load case', 'Wind', 'Set:Phase', `Vertical (${u('force')})`, `Transverse (${u('force')})`, `Longitudinal (${u('force')})`, `SPRT (${u('pressure')})`, `SPRL (${u('pressure')})`],
        decimals: [null, null, null, 0, 0, 0, 1, 1],
        notes: r.problems,
      });
    }
    if (!tables.length) tables.push({ title: 'Structure loads', columns: ['Note'], rows: [['No load cases or no strung structures.']] });
  }

  if (kind === 'clearances') {
    const sc = surveyClearances(p, d, d.analysis);
    const rows = sc.results.filter((x) => x.status !== 'ok').map((x) => [stationText(p, x.station), v(x.offset, 'length'), x.code, x.description, x.span, x.condition, x.kind, v(x.vertical, 'length'), v(x.lateral === null ? null : Math.abs(x.lateral), 'length'), v(x.required.rv, 'length'), v(x.margin, 'length'), x.status]);
    tables.push({
      title: `Survey point clearances — ${sc.checkedPoints} points checked`, rows, flagged: rows.map((r, i) => (r[11] === 'violation' ? i : -1)).filter((i) => i >= 0),
      columns: ['Station', `Offset (${u('length')})`, 'Code', 'Description', 'Span', 'Condition', 'Zone', `Vertical (${u('length')})`, `Horizontal (${u('length')})`, `RV (${u('length')})`, `Margin (${u('length')})`, 'Status'],
      decimals: [null, 2, 0, null, null, null, null, 2, 2, 2, 2, null],
      notes: [...sc.problems, rows.length ? 'Only violations and questionable points are listed.' : 'No violations or questionable points.'],
    });
    const wc = wireClearances(p, d.analysis);
    tables.push({
      title: `Clearances between wires — source: ${wc.sourceLabel}; target: ${wc.targetLabel}`,
      rows: wc.results.map((x) => [x.source, x.target, v(x.distance, 'length'), v(x.clearance, 'length'), v(x.required, 'length'), x.required === null ? '—' : x.status]),
      flagged: wc.results.map((x, i) => (x.status === 'violation' ? i : -1)).filter((i) => i >= 0),
      columns: ['Source span', 'Closest target', `Centre distance (${u('length')})`, `Clearance (${u('length')})`, `Required (${u('length')})`, 'Status'], decimals: [null, null, 3, 3, 2, null], notes: wc.problems,
    });
  }

  if (kind === 'bom') {
    const b = billOfMaterial(p, d.model, d.analysis);
    const totM = b.rows.reduce((s, r) => s + (r.materialCost ?? 0), 0), totL = b.rows.reduce((s, r) => s + (r.laborCost ?? 0), 0);
    tables.push({
      title: 'Bill of material', columns: ['Stock number', 'Description', 'Unit', 'Quantity', 'Material cost', 'Install labor cost', 'Source'],
      rows: [...b.rows.map((r) => [r.stock, r.description, r.unit, r.qty, r.materialCost, r.laborCost, r.sources.join(', ')]), ['TOTAL', '', '', null, totM, totL, '']],
      decimals: [null, null, null, 2, 2, 2, null],
      flagged: b.rows.map((r, i) => (r.materialCost === null ? i : -1)).filter((i) => i >= 0),
      notes: [...b.problems, 'Assemblies are expanded into their parts. Cable lengths are in metres. Item status (new/existing/retired/transferred) is not implemented.'],
    });
  }
  return { title, header, tables };
}
