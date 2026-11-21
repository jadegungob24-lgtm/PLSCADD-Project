import { useEffect, useMemo, useState } from 'react';
import { sagTabRequest, type SagTab } from './sagTab';
import {
  cableStress, CONDITION_LABEL as CONDITION_LABEL_UI, formatQuantity, fromSI, levelSag, planeCatenary, sectionState, toSI, unitLabel,
  type UnitSystem,
} from '@tlcad/engine';
import { useApp } from '../store/appStore';
import { useDerived } from '../store/derived';
import {
  minVerticalProblems, sectionLimitChecks, stateAt, structureResult, type Analysis, type SectionAnalysis,
} from '../store/analysis';
import type { CableConditionValue, Project } from '@tlcad/model';
import { loadTrees } from '../store/loads';

/**
 * Sag-Tension workspace (§11): ruling-span sag and tension for every weather
 * case and cable condition of a section, tension-limit checks, stringing
 * chart, sag-temperature and tension-elongation charts, structure checks and
 * the calculation trace. Everything shown is calculated; nothing is stored.
 */

type Tab = SagTab;
const TABS: [Tab, string][] = [
  ['table', 'Sag-tension'], ['limits', 'Tension limits'], ['stringing', 'Stringing chart'], ['charts', 'Charts'],
  ['structures', 'Structure checks'], ['loads', 'Structure loads'], ['trace', 'Calculation trace'],
];
const CONDS: CableConditionValue[] = ['initial', 'creep', 'load'];

export function SagTensionView() {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const select = useApp((s) => s.select);
  const openDialog = useApp((s) => s.openDialog);
  const d = useDerived();
  const [tab, setTab] = useState<Tab>(() => { const t = sagTabRequest.next ?? 'table'; sagTabRequest.next = null; return t; });
  useEffect(() => {
    const on = (e: Event) => { setTab((e as CustomEvent<Tab>).detail); sagTabRequest.next = null; };
    window.addEventListener('tlcad:sagtab', on);
    return () => window.removeEventListener('tlcad:sagtab', on);
  }, []);
  const [pick, setPick] = useState<string | null>(null);
  if (!project) return <div className="placeholder"><div className="box">No project is open.</div></div>;
  const secs = d.model.sections;
  const selId = selection?.kind === 'section' ? selection.id : pick;
  const sa = d.analysis.sections.get(selId ?? '') ?? (secs[0] ? d.analysis.sections.get(secs[0].section.id) : undefined);
  const sys = project.settings.unitSystem;

  return (
    <div className="st-view">
      <div className="st-head">
        <label>Section&nbsp;</label>
        <select value={sa?.sd.section.id ?? ''} onChange={(e) => { setPick(e.target.value); select({ kind: 'section', id: e.target.value }); }}>
          {secs.length === 0 && <option value="">(no sections)</option>}
          {secs.map((s) => <option key={s.section.id} value={s.section.id}>{s.from}–{s.to} · {s.cable?.name ?? 'missing cable'}</option>)}
        </select>
        {sa && <SectionSummary p={project} sa={sa} />}
        <div style={{ flex: 1 }} />
        <button className="btn small" onClick={() => openDialog('criteria')}>Criteria…</button>
      </div>
      <div className="tabbar" style={{ padding: '0 8px' }}>
        {TABS.map(([k, l]) => <button key={k} className={`tabbtn ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="st-body">
        {tab === 'structures' ? <StructureChecks p={project} a={d.analysis} />
          : tab === 'loads' ? <LoadTrees p={project} />
          : !sa ? <div className="muted">String a tension section first (Sections ▸ String Section).</div>
          : sa.status !== 'sagged' ? <div className={sa.status === 'error' ? 'err-box' : 'muted'}>{sa.message} {sa.status === 'notSagged' && 'Enter its sagging tension in the Properties panel, or use Automatic sagging / Graphical sag.'}</div>
          : tab === 'table' ? <SagTable p={project} sa={sa} sys={sys} />
          : tab === 'limits' ? <LimitTable p={project} sa={sa} sys={sys} />
          : tab === 'stringing' ? <StringingChart sa={sa} sys={sys} numbers={sa.attached.map((x) => x.number)} />
          : tab === 'charts' ? <Charts p={project} sa={sa} sys={sys} />
          : <Trace sa={sa} />}
      </div>
    </div>
  );
}

function SectionSummary({ p, sa }: { p: Project; sa: SectionAnalysis }) {
  const sys = p.settings.unitSystem;
  const sag = sa.sd.section.sagging;
  return (
    <span className="muted" style={{ marginLeft: 10 }}>
      Ruling span {Number.isFinite(sa.rulingSpan) ? formatQuantity(sa.rulingSpan, sys, 'length', 2) : '—'}{sag.rulingSpanOverride !== null ? ' (override)' : ''}
      {' · '}sagged {CONDITION_LABEL_UI[sag.condition]} at {formatQuantity(sag.temperature, sys, 'temperature', 1)}
      {sag.H !== null ? `, H = ${formatQuantity(sag.H, sys, 'force', 0)}` : ', not sagged'}
    </span>
  );
}

// ------------------------------------------------------------------ Sag-tension table (§11.2.1)

function SagTable({ p, sa, sys }: { p: Project; sa: SectionAnalysis; sys: UnitSystem }) {
  const ult = sa.model!.ultimateTension;
  const bim = !!sa.model!.core;
  const f = (v: number, dim: Parameters<typeof formatQuantity>[2], dec: number) => formatQuantity(v, sys, dim, dec, false);
  if (p.criteria.weatherCases.length === 0) return <div className="muted">Define weather cases in the criteria to tabulate sag and tension.</div>;
  return (
    <>
      <table className="grid st-table">
        <thead>
          <tr>
            <th rowSpan={2}>Weather case</th><th rowSpan={2}>Temp ({unitLabel(sys, 'temperature')})</th><th rowSpan={2}>Load UR ({unitLabel(sys, 'forcePerLength')})</th>
            {CONDS.map((c) => <th key={c} colSpan={bim ? 6 : 5} style={{ textAlign: 'center' }}>{CONDITION_LABEL_UI[c]}</th>)}
          </tr>
          <tr>
            {CONDS.map((c) => (
              <FragmentCols key={c} cols={['H', 'C', 'Sag', 'Tmax', '% ULT', ...(bim ? ['Outer %'] : [])]} />
            ))}
          </tr>
        </thead>
        <tbody>
          {p.criteria.weatherCases.map((w) => (
            <tr key={w.id}>
              <td>{w.name}</td>
              <td className="mono">{f(w.temperature, 'temperature', 1)}</td>
              {(() => { const cs = stateAt(p, sa, w.id, 'initial'); return <td className="mono">{cs.ok ? f(cs.loads.urTension, 'forcePerLength', 3) : '—'}</td>; })()}
              {CONDS.map((c) => {
                const cs = stateAt(p, sa, w.id, c);
                if (!cs.ok || !cs.state) return <td key={c} colSpan={bim ? 6 : 5} className="muted" title={cs.ok ? '' : cs.message}>{cs.ok ? '' : 'not available'}</td>;
                const st = cs.state.state;
                return (
                  <FragmentCells key={c} cells={[
                    f(st.H, 'force', 0), f(st.C, 'length', 1), f(st.sag, 'length', 2), f(st.tmax, 'force', 0), ((100 * st.tmax) / ult).toFixed(1),
                    ...(bim ? [st.stress.total > 0 ? ((100 * st.stress.outer) / st.stress.total).toFixed(1) : '—'] : []),
                  ]} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
        Level 1 ruling span method (§7.2.3): H, catenary constant C = H/UR, mid-span sag and support tension of the level ruling span of
        {' '}{formatQuantity(sa.rulingSpan, sys, 'length', 2)}. Actual span sags follow from H in each span's own geometry (App. J).
        {sa.solved?.creepSet === null && sa.model?.model === 'nonlinear' && ' No creep weather case is defined, so "Final after creep" is not available.'}
        {sa.solved?.loadSet === null && sa.model?.model === 'nonlinear' && ' No load weather case is defined, so "Final after load" is not available.'}
      </div>
    </>
  );
}
const FragmentCols = ({ cols }: { cols: string[] }) => <>{cols.map((c) => <th key={c}>{c}</th>)}</>;
const FragmentCells = ({ cells }: { cells: string[] }) => <>{cells.map((c, i) => <td key={i} className="mono">{c}</td>)}</>;

// ------------------------------------------------------------------ Tension limits (§11.2.2)

function LimitTable({ p, sa, sys }: { p: Project; sa: SectionAnalysis; sys: UnitSystem }) {
  const checks = sectionLimitChecks(p, sa);
  if (checks.length === 0) return <div className="muted">No cable tension limits apply to this cable. Add them in Criteria ▸ Tension limits.</div>;
  const wn = (id: string) => p.criteria.weatherCases.find((w) => w.id === id)?.name ?? '?';
  return (
    <>
      <table className="grid st-table">
        <thead><tr><th>Weather case</th><th>Condition</th><th>Tension ({unitLabel(sys, 'force')})</th><th>H/UW ({unitLabel(sys, 'length')})</th><th>Limits</th><th>Usage %</th><th>Status</th></tr></thead>
        <tbody>
          {checks.map(({ src, check, message }) => (
            <tr key={src.id}>
              <td>{wn(src.weatherId)}</td><td>{CONDITION_LABEL_UI[src.condition]}</td>
              {check && !check.error ? (
                <>
                  <td className="mono">{formatQuantity(check.tension, sys, 'force', 0, false)}</td>
                  <td className="mono">{formatQuantity(check.catenary, sys, 'length', 1, false)}</td>
                  <td>{[src.maxPercentUltimate !== null && `${src.maxPercentUltimate}% ULT`, src.maxTension !== null && formatQuantity(src.maxTension, sys, 'force', 0), src.maxCatenary !== null && `C ≤ ${formatQuantity(src.maxCatenary, sys, 'length', 1)}`].filter(Boolean).join(', ')}</td>
                  <td className="mono">{check.usage.toFixed(1)}</td>
                  <td style={{ color: check.ok ? 'var(--ok, #2a7a3a)' : 'var(--err)', fontWeight: 600 }}>{check.ok ? 'OK' : 'EXCEEDED'}</td>
                </>
              ) : <td colSpan={5} className="muted">{check?.error ?? message}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 8 }}>
        Tension compared: {p.criteria.maxTension === 'actual' ? 'largest end tension over the actual spans of the section' : 'support tension of the level ruling span'} (§7.3.8).
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Stringing chart (§11.3.3)

function StringingChart({ sa, sys, numbers }: { sa: SectionAnalysis; sys: UnitSystem; numbers: number[] }) {
  const tu = unitLabel(sys, 'temperature');
  const [range, setRange] = useState(() => (sys === 'US' ? { from: 0, to: 120, step: 20 } : { from: -20, to: 50, step: 10 }));
  const [cond, setCond] = useState<CableConditionValue>('initial');
  const temps: number[] = [];
  if (range.step > 0 && range.to >= range.from) for (let t = range.from; t <= range.to + 1e-9 && temps.length < 40; t += range.step) temps.push(t);
  const uw = sa.model!.unitWeight;
  const rows = temps.map((tDisp) => {
    const T = toSI(tDisp, sys, 'temperature');
    const st = sectionState(sa.solved!, cond, { temperature: T, w: uw });
    if (!st.ok) return { tDisp, H: NaN, sags: [] as number[], err: st.message };
    const C = st.state.H / uw;
    // Sag of each actual span (average over the phases), App. J-3 in the span's own geometry.
    const sags = sa.phases[0]!.map((_, i) => sa.phases.reduce((s, ph) => {
      const g = ph[i]!;
      return s + planeCatenary(Math.hypot(g.E.x - g.O.x, g.E.y - g.O.y), g.E.z - g.O.z, C).sag;
    }, 0) / sa.phases.length);
    return { tDisp, H: st.state.H, sags, err: null as string | null };
  });
  const spans = sa.phases[0]!.map((g, i) => ({ label: `${numbers[i]}–${numbers[i + 1]}`, len: Math.hypot(g.E.x - g.O.x, g.E.y - g.O.y) }));
  const num = (v: string, k: 'from' | 'to' | 'step') => { const x = Number(v); if (Number.isFinite(x)) setRange((r) => ({ ...r, [k]: x })); };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        Condition <select value={cond} onChange={(e) => setCond(e.target.value as CableConditionValue)}>{CONDS.map((c) => <option key={c} value={c}>{CONDITION_LABEL_UI[c]}</option>)}</select>
        Temperatures from <input className="mono" style={{ width: 60 }} defaultValue={range.from} onBlur={(e) => num(e.target.value, 'from')} />
        to <input className="mono" style={{ width: 60 }} defaultValue={range.to} onBlur={(e) => num(e.target.value, 'to')} />
        step <input className="mono" style={{ width: 50 }} defaultValue={range.step} onBlur={(e) => num(e.target.value, 'step')} /> {tu}
      </div>
      <div style={{ overflow: 'auto' }}>
        <table className="grid st-table">
          <thead>
            <tr><th>Temp ({tu})</th><th>H ({unitLabel(sys, 'force')})</th>{spans.map((s) => <th key={s.label} title={`horizontal span ${formatQuantity(s.len, sys, 'length', 1)}`}>Span {s.label}</th>)}</tr>
            <tr><th /><th />{spans.map((s) => <th key={s.label} className="muted" style={{ fontWeight: 400 }}>{formatQuantity(s.len, sys, 'length', 1)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tDisp}>
                <td className="mono">{r.tDisp}</td>
                {r.err ? <td colSpan={spans.length + 1} className="muted">{r.err}</td> : (
                  <>
                    <td className="mono">{formatQuantity(r.H, sys, 'force', 0, false)}</td>
                    {r.sags.map((s, i) => <td key={i} className="mono">{formatQuantity(s, sys, 'length', 2, false)}</td>)}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        Mid-span sags (from the chord, average of the phases) of the bare cable for clipping-in at each temperature, with the ruling span tension (§11.3.3).
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Charts

interface Series { name: string; color: string; pts: [number, number][] }

function LineChart({ title, xLabel, yLabel, series, width = 520, height = 300 }: { title: string; xLabel: string; yLabel: string; series: Series[]; width?: number; height?: number }) {
  const all = series.flatMap((s) => s.pts).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (!all.length) return <div className="muted">{title}: no data.</div>;
  const [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const [y0r, y1r] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  const y0 = Math.min(0, y0r), y1 = y1r + (y1r - y0) * 0.05 || 1;
  const m = { l: 62, r: 12, t: 26, b: 40 };
  const W = width - m.l - m.r, H = height - m.t - m.b;
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * W;
  const sy = (y: number) => m.t + H - ((y - y0) / (y1 - y0 || 1)) * H;
  const ticks = (a: number, b: number, n = 5) => {
    const step = Math.pow(10, Math.floor(Math.log10((b - a) / n || 1)));
    const k = [1, 2, 5, 10].find((f) => (b - a) / (f * step) <= n) ?? 10;
    const s = k * step;
    const out: number[] = [];
    for (let v = Math.ceil(a / s) * s; v <= b + 1e-9; v += s) out.push(Number(v.toPrecision(10)));
    return out;
  };
  return (
    <svg width={width} height={height} className="chart">
      <text x={m.l} y={16} className="chart-title">{title}</text>
      {ticks(y0, y1).map((v) => (
        <g key={`y${v}`}><line x1={m.l} x2={m.l + W} y1={sy(v)} y2={sy(v)} className="grid-line" /><text x={m.l - 6} y={sy(v) + 4} textAnchor="end">{v}</text></g>
      ))}
      {ticks(x0, x1).map((v) => (
        <g key={`x${v}`}><line x1={sx(v)} x2={sx(v)} y1={m.t} y2={m.t + H} className="grid-line" /><text x={sx(v)} y={m.t + H + 14} textAnchor="middle">{v}</text></g>
      ))}
      <rect x={m.l} y={m.t} width={W} height={H} fill="none" stroke="#9aa3ad" />
      {series.map((s) => (
        <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={1.8}
          points={s.pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} />
      ))}
      <text x={m.l + W / 2} y={height - 6} textAnchor="middle">{xLabel}</text>
      <text x={12} y={m.t + H / 2} textAnchor="middle" transform={`rotate(-90 12 ${m.t + H / 2})`}>{yLabel}</text>
      {series.map((s, i) => (
        <g key={s.name} transform={`translate(${m.l + 8 + i * 130}, ${m.t + 12})`}>
          <line x1={0} x2={16} y1={0} y2={0} stroke={s.color} strokeWidth={2.5} /><text x={20} y={4}>{s.name}</text>
        </g>
      ))}
    </svg>
  );
}

const COLORS: Record<CableConditionValue, string> = { initial: '#2a6fdb', creep: '#d9822b', load: '#c23b3b' };

function Charts({ p, sa, sys }: { p: Project; sa: SectionAnalysis; sys: UnitSystem }) {
  const uw = sa.model!.unitWeight;
  const tempsSI = useMemo(() => {
    const ts = p.criteria.weatherCases.map((w) => w.temperature);
    const lo = Math.min(-20, ...ts), hi = Math.max(50, ...ts);
    return Array.from({ length: 41 }, (_, i) => lo + ((hi - lo) * i) / 40);
  }, [p.criteria.weatherCases]);
  // Sag of the level ruling span vs temperature, bare cable (§11.3.2).
  const sagSeries: Series[] = CONDS.map((c) => ({
    name: CONDITION_LABEL_UI[c], color: COLORS[c],
    pts: tempsSI.map((T) => {
      const st = sectionState(sa.solved!, c, { temperature: T, w: uw });
      return [fromSI(T, sys, 'temperature'), st.ok ? fromSI(levelSag(sa.rulingSpan, st.state.H / uw), sys, 'length') : NaN] as [number, number];
    }),
  })).filter((s) => s.pts.some(([, y]) => Number.isFinite(y)));
  // Tension-elongation: virtual stress × area vs strain at the test temperature (§9.1, Fig. 9.1-1).
  const c = sa.model!;
  const Tt = c.testTemperature;
  const maxEps = 0.6;
  const eps = Array.from({ length: 61 }, (_, i) => (maxEps * i) / 60);
  const teSeries: Series[] = [
    { name: 'Initial', color: COLORS.initial, pts: eps.map((e) => [e, fromSI(cableStress(c, e, Tt, { kind: 'initial' }).total * c.area, sys, 'force')]) },
  ];
  if (c.model === 'nonlinear') {
    teSeries.push({ name: 'Creep', color: '#7b5ea7', pts: eps.map((e) => [e, fromSI(cableStress(c, e, Tt, { kind: 'creepCurve' }).total * c.area, sys, 'force')]) });
    if (sa.solved!.creepSet) teSeries.push({ name: 'After creep', color: COLORS.creep, pts: eps.map((e) => [e, fromSI(cableStress(c, e, Tt, { kind: 'final', set: sa.solved!.creepSet! }).total * c.area, sys, 'force')]) });
    if (sa.solved!.loadSet) teSeries.push({ name: 'After load', color: COLORS.load, pts: eps.map((e) => [e, fromSI(cableStress(c, e, Tt, { kind: 'final', set: sa.solved!.loadSet! }).total * c.area, sys, 'force')]) });
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      <LineChart title="Ruling span sag vs temperature (bare cable)" xLabel={`Temperature (${unitLabel(sys, 'temperature')})`} yLabel={`Sag (${unitLabel(sys, 'length')})`} series={sagSeries} />
      <LineChart title={`Tension vs elongation at ${formatQuantity(Tt, sys, 'temperature', 0)}`} xLabel="Strain (%)" yLabel={`Tension (${unitLabel(sys, 'force')})`} series={teSeries} />
    </div>
  );
}

// ------------------------------------------------------------------ Structure checks (§11.3, App. F.1, §7.3.16)

function StructureChecks({ p, a }: { p: Project; a: Analysis }) {
  const d = useDerived();
  const select = useApp((s) => s.select);
  const sys = p.settings.unitSystem;
  const lu = unitLabel(sys, 'length');
  const rows = d.model.structures.map((sd) => {
    const r = structureResult(p, a, sd);
    return { sd, r, vprob: minVerticalProblems(r) };
  }).filter((x) => x.r.sets.length > 0);
  if (!rows.length) return <div className="muted">No strung structures yet.</div>;
  const len = (v: number | null) => (v === null ? '—' : formatQuantity(v, sys, 'length', 1, false));
  const conds = p.criteria.weightSpanConditions;
  return (
    <>
      <table className="grid st-table">
        <thead>
          <tr>
            <th>Str</th><th>Type</th><th>Set</th><th>Wind span ({lu})</th>
            {conds.map((_, i) => <th key={i}>Weight span {i + 1} ({lu})</th>)}
            <th>Insulator swing (°): min / max / allowed</th><th>Method 1 / 2 usage</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(({ sd, r, vprob }) => r.sets.map((s, si) => {
            const swingBad = s.swings.some((w) => !w.ok);
            const bad = swingBad || vprob.length > 0 || (r.method1 && !r.method1.ok) || (r.method2 && !r.method2.ok);
            return (
              <tr key={`${sd.s.id}-${s.set}`} onClick={() => select({ kind: 'structure', id: sd.s.id })} style={{ cursor: 'pointer' }}>
                <td className="mono">{si === 0 ? sd.number : ''}</td>
                <td>{si === 0 ? sd.type?.name : ''}</td>
                <td className="mono">{s.set}</td>
                <td className="mono">{len(s.windSpan)}</td>
                {s.weightSpans.map((w, i) => <td key={i} className="mono" style={w !== null && w < 0 ? { color: 'var(--err)', fontWeight: 600 } : undefined}>{w === null ? '—' : `${len(w)}${w < 0 ? ' uplift' : ''}`}</td>)}
                <td className="mono" style={{ whiteSpace: 'normal' }}>
                  {s.swings.length === 0 ? '—' : s.swings.map((w, i) => (
                    <div key={i} style={w.ok ? undefined : { color: 'var(--err)' }}>
                      S{w.condition + 1} ph {w.attachment.phase}: {w.uplift ? 'UPLIFT — insulator pulled up' : `${w.min.toFixed(1)} / ${w.max.toFixed(1)}`}{!w.uplift && w.allowMin !== null ? ` / ${w.allowMin}…${w.allowMax}` : ''}
                    </div>
                  ))}
                </td>
                <td className="mono" title={r.method1?.detail ?? r.method2?.detail ?? ''}>{si === 0 && r.method1 ? (Number.isFinite(r.method1.usage) ? `M1 ${r.method1.usage.toFixed(1)} %` : '—') : ''}{si === 0 && r.method2 ? (r.method2.rows.length ? r.method2.rows.map((q) => `M2-${q.condition + 1} ${Number.isFinite(q.usage) ? q.usage.toFixed(1) + ' %' : '—'}${q.inside ? '' : ' out'}`).join(' · ') : 'M2 —') : ''}</td>
                <td style={{ color: bad ? 'var(--err)' : 'var(--ok, #2a7a3a)', fontWeight: 600 }} title={[...vprob, ...s.notes, r.method1 && !r.method1.ok ? r.method1.detail : '', r.method2 && !r.method2.ok ? r.method2.detail : ''].filter(Boolean).join('\n')}>
                  {bad ? 'CHECK' : 'OK'}{s.notes.length ? ' *' : ''}
                </td>
              </tr>
            );
          }))}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
        Wind span: half the sum of the adjacent chord lengths (App. I.2). Weight span: {p.criteria.weightSpanModel === 'exact' ? 'vertical support force ÷ unit vertical load' : 'arc length between the adjacent low points'} (App. I.3), negative = uplift.
        Swing: wind normal to each adjacent span from both sides (Eqs. 7-37, 7-38). Method 1: largest of wind and weight spans as % of the allowable values interpolated at the line angle (§8.3.1).
        Hover the status for details; * marks notes.
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Structure load trees (§7.3.12)

function LoadTrees({ p }: { p: Project }) {
  const d = useDerived();
  const selection = useApp((s) => s.selection);
  const select = useApp((s) => s.select);
  const sys = p.settings.unitSystem;
  const strung = d.model.structures.filter((sd) => [...d.analysis.sections.values()].some((sa) => sa.attached.some((x) => x.s.id === sd.s.id)));
  const id = selection?.kind === 'structure' ? selection.id : strung[0]?.s.id;
  const sd = id ? d.model.byId.get(id) : undefined;
  const fu = unitLabel(sys, 'force');
  const res = sd ? loadTrees(p, d, d.analysis, sd) : null;
  return (
    <>
      <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        Structure
        <select value={sd?.s.id ?? ''} onChange={(e) => select({ kind: 'structure', id: e.target.value })}>
          {strung.map((x) => <option key={x.s.id} value={x.s.id}>{x.number} · {x.type?.name}</option>)}
        </select>
      </div>
      {!res ? <div className="muted">No strung structure.</div> : (
        <>
          {res.problems.length > 0 && <ul className="err-list">{res.problems.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          {res.results.map((lc) => (
            <div key={lc.loadCase.id} style={{ marginBottom: 14 }}>
              <h4 style={{ margin: '4px 0' }}>{lc.loadCase.name} — {lc.loadCase.windDirection}{lc.loadCase.windDirection.startsWith('BI') || lc.loadCase.windDirection === 'GLB' ? ` ${lc.loadCase.wb}°` : ''} · LFV {lc.loadCase.lfv} · LFW {lc.loadCase.lfw} · LFT {lc.loadCase.lft} · LFS {lc.loadCase.lfs}</h4>
              {lc.problems.length > 0 && <ul className="err-list">{lc.problems.map((m, i) => <li key={i}>{m}</li>)}</ul>}
              <table className="grid st-table">
                <thead><tr><th>Set:Phase</th><th>Span reactions (V / T / L, {fu}, factored)</th><th>Vertical ({fu}, down +)</th><th>Transverse TS ({fu})</th><th>Longitudinal LS ({fu})</th></tr></thead>
                <tbody>
                  {lc.attachments.map((a, i) => (
                    <tr key={i}>
                      <td className="mono">{a.attachment.set}:{a.attachment.phase}</td>
                      <td className="mono">{a.spans.map((s) => `${s.span}: ${formatQuantity(s.V, sys, 'force', 0, false)} / ${formatQuantity(s.T, sys, 'force', 0, false)} / ${formatQuantity(s.L, sys, 'force', 0, false)}`).join(' · ')}</td>
                      <td className="mono">{formatQuantity(a.vertical, sys, 'force', 0, false)}</td>
                      <td className="mono">{formatQuantity(a.transverse, sys, 'force', 0, false)}</td>
                      <td className="mono">{formatQuantity(a.longitudinal, sys, 'force', 0, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted">Structure design pressures: SPRT = {formatQuantity(lc.sprt, sys, 'pressure', 1)}, SPRL = {formatQuantity(lc.sprl, sys, 'pressure', 1)} (Eqs. 7-13, 7-14).</div>
            </div>
          ))}
          <div className="muted" style={{ lineHeight: 1.5 }}>
            Loads at the structure attachment points in the structure axes (TS transverse, LS = TS turned 90° clockwise, §7.3.12.1), from the factored span
            reactions of Eqs. 7-7 to 7-12 plus LFS × (insulator + counterweight weights). Span T is positive toward the positive bisector; L is the horizontal
            tension. With an NESC constant K, V and T are scaled by UR / (UR + K) (§7.3.12.4). Not implemented: unbalanced loading, MAX wind, taps.
          </div>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Trace

function Trace({ sa }: { sa: SectionAnalysis }) {
  const t = sa.solved!.trace;
  return (
    <div className="trace">
      <div><b>Method:</b> {t.method}</div>
      <div><b>Basis:</b> {t.basis}</div>
      <h4>Inputs (SI)</h4>
      <table className="grid st-table"><tbody>{Object.entries(t.inputs).map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{typeof v === 'number' ? v.toPrecision(8) : v}</td></tr>)}</tbody></table>
      <h4>Steps</h4>
      <ol>{t.steps.map((s, i) => (
        <li key={i}>{s.label}{s.ref ? <span className="muted"> — {s.ref}</span> : null}
          {s.values && <div className="mono muted">{Object.entries(s.values).map(([k, v]) => `${k} = ${typeof v === 'number' ? v.toPrecision(8) : v}`).join(';  ')}</div>}
        </li>
      ))}</ol>
      {t.assumptions.length > 0 && <><h4>Assumptions</h4><ul>{t.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
      {t.warnings.length > 0 && <><h4>Warnings</h4><ul>{t.warnings.map((a, i) => <li key={i} style={{ color: 'var(--err)' }}>{a}</li>)}</ul></>}
    </div>
  );
}
