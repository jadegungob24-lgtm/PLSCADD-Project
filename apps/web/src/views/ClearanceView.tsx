import { useEffect, useState } from 'react';
import { clearanceTabRequest, type ClearanceTab } from './clearanceTab';
import { formatQuantity, fromSI, unitLabel, type UnitSystem } from '@tlcad/engine';
import type { Project } from '@tlcad/model';
import { useApp, type Marker } from '../store/appStore';
import { computeDerived, stationText, useDerived, type DerivedView } from '../store/derived';
import { computeLineModel, stationOfPoint } from '../store/lineModel';
import { computeAnalysis } from '../store/analysis';
import {
  gallopingSpans, surveyClearances, tinClearances, wireClearances,
  type GallopingSpan, type PointClearance, type SurveyClearanceResult, type TinClearance, type WirePairClearance,
} from '../store/clearances';

/**
 * Clearance Analysis workspace (§11.2.3): survey point clearances, clearance
 * to the TIN, clearances between wires and galloping ellipses. Each check is
 * run on request; results can be shown as markers in the plan, profile and
 * 3-D views.
 */

type Tab = ClearanceTab;
const TABS: [Tab, string][] = [['survey', 'Survey points'], ['tin', 'Clearance to TIN'], ['wires', 'Between wires'], ['galloping', 'Galloping ellipses']];
const STATUS_COLOR = { violation: 'var(--err)', questionable: '#2a64c9', ok: 'var(--ok, #2a7a3a)' } as const;
const STATUS_TEXT = { violation: 'VIOLATION', questionable: 'QUESTIONABLE', ok: 'OK' } as const;

type Results =
  | { tab: 'survey'; r: SurveyClearanceResult }
  | { tab: 'tin'; r: { results: TinClearance[]; problems: string[] } }
  | { tab: 'wires'; r: ReturnType<typeof wireClearances> }
  | { tab: 'galloping'; r: { results: GallopingSpan[]; problems: string[] } };

/** Last results per check, kept while the workspace is switched away. */
const cache: Partial<Record<Tab, Results>> = {};

export function ClearanceView() {
  const project = useApp((s) => s.project);
  const openDialog = useApp((s) => s.openDialog);
  const setMarkers = useApp((s) => s.setMarkers);
  const d = useDerived();
  const [tab, setTab] = useState<Tab>(() => { const t = clearanceTabRequest.next ?? 'survey'; clearanceTabRequest.next = null; return t; });
  useEffect(() => {
    const on = (e: Event) => { setTab((e as CustomEvent<Tab>).detail); clearanceTabRequest.next = null; };
    window.addEventListener('tlcad:cleartab', on);
    return () => window.removeEventListener('tlcad:cleartab', on);
  }, []);
  const [, force] = useState(0);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  if (!project) return <div className="placeholder"><div className="box">No project is open.</div></div>;
  const sys = project.settings.unitSystem;
  const res = cache[tab];

  const run = () => {
    const p = useApp.getState().project!;
    const dd = computeDerived(p);
    const a = computeAnalysis(p, dd, computeLineModel(p, dd));
    const t0 = performance.now();
    if (tab === 'survey') cache.survey = { tab, r: surveyClearances(p, dd, a) };
    else if (tab === 'tin') cache.tin = { tab, r: tinClearances(p, dd, a) };
    else if (tab === 'wires') cache.wires = { tab, r: wireClearances(p, a) };
    else cache.galloping = { tab, r: gallopingSpans(p, a) };
    const ms = performance.now() - t0;
    useApp.getState().addLog('info', `${TABS.find((x) => x[0] === tab)![1]} checked in ${ms.toFixed(0)} ms.`);
    setSel(null);
    force((n) => n + 1);
    showMarkers(cache[tab]!, d, setMarkers, onlyProblems);
  };

  return (
    <div className="st-view">
      <div className="st-head">
        <button className="btn small primary" onClick={run}>Run check</button>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyProblems} onChange={(e) => { setOnlyProblems(e.target.checked); if (res) showMarkers(res, d, setMarkers, e.target.checked); }} /> problems only
        </label>
        <button className="btn small" onClick={() => setMarkers([])}>Clear markers</button>
        <div style={{ flex: 1 }} />
        <button className="btn small" onClick={() => openDialog('criteria')}>Criteria…</button>
      </div>
      <div className="tabbar" style={{ padding: '0 8px' }}>
        {TABS.map(([k, l]) => <button key={k} className={`tabbtn ${tab === k ? 'on' : ''}`} onClick={() => { setTab(k); setSel(null); }}>{l}</button>)}
      </div>
      <div className="st-body">
        {!res ? <div className="muted">Choose Run check to compute the {TABS.find((x) => x[0] === tab)![1].toLowerCase()} for the conditions in the criteria.</div>
          : res.tab === 'survey' ? <SurveyTable p={project} r={res.r} sys={sys} only={onlyProblems} sel={sel} setSel={setSel} />
          : res.tab === 'tin' ? <TinTable r={res.r} sys={sys} only={onlyProblems} />
          : res.tab === 'wires' ? <WireTable r={res.r} sys={sys} only={onlyProblems} />
          : <GallopingTable r={res.r} sys={sys} sel={sel} setSel={setSel} />}
      </div>
    </div>
  );
}

/** Markers for the results, with profile stations on the alignment of the nearest structure. */
function showMarkers(res: Results, d: DerivedView, setMarkers: (m: Marker[]) => void, only: boolean) {
  const st = (x: number, y: number) => {
    for (let li = 0; li < d.lines.length; li++) { const s = stationOfPoint(d, li, x, y); if (s !== null) return s; }
    return null;
  };
  const keep = (s: string) => !only || s !== 'ok';
  const m: Marker[] = [];
  if (res.tab === 'survey') for (const r of res.r.results) { if (keep(r.status)) m.push({ status: r.status, a: { x: r.x, y: r.y, z: r.top }, b: r.wire, sa: r.station, sb: st(r.wire.x, r.wire.y), label: r.status === 'ok' ? '' : r.code.toString() }); }
  if (res.tab === 'tin') for (const r of res.r.results) { if (keep(r.status)) m.push({ status: r.status, a: r.ground, b: r.wire, sa: st(r.ground.x, r.ground.y), sb: st(r.wire.x, r.wire.y), label: '' }); }
  if (res.tab === 'wires') for (const r of res.r.results) { if (keep(r.status)) m.push({ status: r.status, a: r.pa, b: r.pb, sa: st(r.pa.x, r.pa.y), sb: st(r.pb.x, r.pb.y), label: '' }); }
  setMarkers(m);
}

const Problems = ({ list }: { list: string[] }) => (list.length ? <ul className="err-list">{list.map((m, i) => <li key={i}>{m}</li>)}</ul> : null);
const len = (v: number | null, sys: UnitSystem, dec = 2) => (v === null ? '—' : formatQuantity(v, sys, 'length', dec, false));

function SurveyTable({ p, r, sys, only, sel, setSel }: { p: Project; r: SurveyClearanceResult; sys: UnitSystem; only: boolean; sel: number | null; setSel: (i: number | null) => void }) {
  const rows = r.results.filter((x) => !only || x.status !== 'ok');
  const counts = { violation: r.results.filter((x) => x.status === 'violation').length, questionable: r.results.filter((x) => x.status === 'questionable').length };
  const lu = unitLabel(sys, 'length');
  const chosen = sel !== null ? rows[sel] : undefined;
  return (
    <>
      <Problems list={r.problems} />
      <div style={{ marginBottom: 6 }}>
        {r.checkedPoints} point(s) checked · <b style={{ color: STATUS_COLOR.violation }}>{counts.violation} violation(s)</b> · <b style={{ color: STATUS_COLOR.questionable }}>{counts.questionable} questionable</b>
        {r.noRequirement > 0 && <span className="muted"> · {r.noRequirement} point(s) have no required clearance in the feature code table</span>}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <table className="grid st-table">
          <thead><tr><th>Station</th><th>Offset ({lu})</th><th>Code</th><th>Description</th><th>Span</th><th>Condition</th><th>Zone</th><th>Vertical ({lu})</th><th>Horizontal ({lu})</th><th>RV / RH</th><th>Margin ({lu})</th><th>Status</th></tr></thead>
          <tbody>
            {rows.slice(0, 2000).map((x, i) => (
              <tr key={x.pointId} className={i === sel ? 'rowsel' : ''} style={{ cursor: 'pointer' }} onClick={() => setSel(i)}>
                <td className="mono">{stationText(p, x.station)}</td>
                <td className="mono">{len(x.offset, sys)}</td>
                <td className="mono">{x.code}</td>
                <td>{x.description}</td>
                <td>{x.span}</td>
                <td>{x.condition}</td>
                <td>{x.kind}</td>
                <td className="mono">{len(x.vertical, sys)}</td>
                <td className="mono">{x.kind === 'radial' ? `${len(x.distance, sys)} (3-D)` : len(x.lateral === null ? null : Math.abs(x.lateral), sys)}</td>
                <td className="mono">{len(x.required.rv, sys)} / {x.kind === 'rectangle' ? len(x.required.rh, sys) : '—'}</td>
                <td className="mono">{len(x.margin, sys)}</td>
                <td style={{ color: STATUS_COLOR[x.status], fontWeight: 600 }}>{STATUS_TEXT[x.status]}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={12} className="muted">{only ? 'No violations or questionable points.' : 'No points with a required clearance near the wires.'}</td></tr>}
          </tbody>
        </table>
        {chosen && <CrossSection x={chosen} sys={sys} />}
      </div>
      <div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
        Each point is reported with its governing wire and condition. Margin: distance from the wire to the edge of the required zone (negative = inside).
        Rectangle (RH given): violation; band (RH blank): questionable — look at it in detail (§6.1.1). Radial: 3-D distance against RV.
      </div>
    </>
  );
}

/** Cross-section through the survey point perpendicular to the alignment (Fig. 11.2-4c). */
function CrossSection({ x, sys }: { x: PointClearance; sys: UnitSystem }) {
  const W = 300, H = 260;
  const rv = x.required.rv, rh = x.kind === 'rectangle' ? x.required.rh : 0;
  const lat = x.lateral ?? 0;
  const span = Math.max(Math.abs(lat) + 4, rh + 4, rv);
  const lower = x.aerial ? x.top - rv : x.ground; // drawn to the ground; the check also reports a wire below it
  const zLow = Math.min(lower, x.wire.z, x.top) - 1;
  const sx = (u: number) => W / 2 + (u / span) * (W / 2 - 20);
  const sc = (W / 2 - 20) / span;
  const sy = (z: number) => H - 20 - (z - zLow) * sc;
  const f = (v: number) => fromSI(v, sys, 'length').toFixed(1);
  return (
    <svg width={W} height={Math.min(H, sy(zLow) + 30)} className="chart" style={{ flex: 'none' }}>
      <text x={8} y={14} className="chart-title">Cross-section at the point (looking ahead)</text>
      {x.kind === 'radial'
        ? <circle cx={sx(0)} cy={sy(x.top)} r={rv * sc} fill="none" stroke="#c97a1a" strokeDasharray="4 3" />
        : x.kind === 'rectangle'
          ? <rect x={sx(-rh)} y={sy(x.top + rv)} width={2 * rh * sc} height={sy(lower) - sy(x.top + rv)} fill="rgba(201,122,26,0.12)" stroke="#c97a1a" strokeDasharray="4 3" />
          : <rect x={8} y={sy(x.top + rv)} width={W - 16} height={sy(lower) - sy(x.top + rv)} fill="rgba(42,100,201,0.10)" stroke="#2a64c9" strokeDasharray="4 3" />}
      <line x1={sx(0)} x2={sx(0)} y1={sy(x.top)} y2={sy(x.ground)} stroke="#555" />
      <line x1={8} x2={W - 8} y1={sy(x.ground)} y2={sy(x.ground)} stroke="#6a9a5a" />
      <circle cx={sx(0)} cy={sy(x.top)} r={4} fill="#222" />
      <circle cx={sx(x.kind === 'radial' ? 0 : lat)} cy={sy(x.wire.z)} r={5} fill={x.status === 'ok' ? '#2a7a3a' : x.status === 'questionable' ? '#2a64c9' : '#d33'} />
      <text x={sx(0) + 6} y={sy(x.top) + 14}>point {f(x.top)}</text>
      <text x={sx(x.kind === 'radial' ? 0 : lat) + 8} y={sy(x.wire.z) - 6}>wire {f(x.wire.z)}</text>
      <text x={8} y={Math.min(H, sy(zLow) + 30) - 6}>{x.condition} · span {x.span}</text>
    </svg>
  );
}

function TinTable({ r, sys, only }: { r: { results: TinClearance[]; problems: string[] }; sys: UnitSystem; only: boolean }) {
  const rows = r.results.filter((x) => !only || x.status !== 'ok' || x.required === null);
  const lu = unitLabel(sys, 'length');
  return (
    <>
      <Problems list={r.problems} />
      <table className="grid st-table">
        <thead><tr><th>Span / phase</th><th>Governing condition</th><th>Shortest distance to TIN ({lu})</th><th>Required ({lu})</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={i}>
              <td>{x.span}</td><td>{x.condition}</td><td className="mono">{len(x.distance, sys)}</td><td className="mono">{len(x.required, sys)}</td>
              <td style={{ color: STATUS_COLOR[x.status], fontWeight: 600 }}>{x.required === null ? '—' : STATUS_TEXT[x.status]}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="muted">No violations.</td></tr>}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 8 }}>
        Shortest 3-D distance from each wire span (sampled at {48} points) to the TIN surface, for the survey point clearance conditions (§11.2.3.4). Isoclearance TINs are not implemented.
      </div>
    </>
  );
}

function WireTable({ r, sys, only }: { r: ReturnType<typeof wireClearances>; sys: UnitSystem; only: boolean }) {
  const rows = r.results.filter((x: WirePairClearance) => !only || x.status !== 'ok' || x.required === null);
  const lu = unitLabel(sys, 'length');
  return (
    <>
      <Problems list={r.problems} />
      <div style={{ marginBottom: 6 }}>Source: {r.sourceLabel || '—'} · Target: {r.targetLabel || '—'}</div>
      <table className="grid st-table">
        <thead><tr><th>Source span</th><th>Closest target</th><th>Centre distance ({lu})</th><th>Clearance ({lu})</th><th>Required ({lu})</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={i}>
              <td>{x.source}</td><td>{x.target}</td><td className="mono">{len(x.distance, sys, 3)}</td><td className="mono">{len(x.clearance, sys, 3)}</td><td className="mono">{len(x.required, sys)}</td>
              <td style={{ color: STATUS_COLOR[x.status], fontWeight: 600 }}>{x.required === null ? '—' : STATUS_TEXT[x.status]}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted">No violations.</td></tr>}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 8 }}>Clearance = centre-line distance minus half of each conductor diameter (§11.2.3.2.2). Wires of the same section and phase are not compared with each other.</div>
    </>
  );
}

function GallopingTable({ r, sys, sel, setSel }: { r: { results: GallopingSpan[]; problems: string[] }; sys: UnitSystem; sel: number | null; setSel: (i: number | null) => void }) {
  const lu = unitLabel(sys, 'length');
  const chosen = sel !== null ? r.results[sel] : undefined;
  return (
    <>
      <Problems list={r.problems} />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <table className="grid st-table">
          <thead><tr><th>Span</th><th>Swing to</th><th>Phase</th><th>SAG ({lu})</th><th>SSW (°)</th><th>MAJOR ({lu})</th><th>MINOR ({lu})</th><th>B ({lu})</th><th>ESW (°)</th><th>Closest ellipses</th></tr></thead>
          <tbody>
            {r.results.flatMap((s, i) => s.phases.map((ph, k) => (
              <tr key={`${i}-${k}`} className={i === sel ? 'rowsel' : ''} style={{ cursor: 'pointer' }} onClick={() => setSel(i)}>
                <td>{k === 0 ? s.span : ''}</td><td>{k === 0 ? s.side : ''}</td><td className="mono">{ph.phase}</td>
                <td className="mono">{len(ph.sag, sys)}</td><td className="mono">{ph.ssw.toFixed(1)}</td>
                <td className="mono">{len(ph.params.major, sys)}</td><td className="mono">{len(ph.params.minor, sys)}</td><td className="mono">{len(ph.params.b, sys)}</td><td className="mono">{ph.params.esw.toFixed(1)}</td>
                <td>{k === 0 ? s.pairs.map((q) => `${q.a}–${q.b}: ${q.overlap ? 'OVERLAP' : len(q.distance, sys)}`).join(', ') : ''}</td>
              </tr>
            )))}
            {r.results.length === 0 && <tr><td colSpan={10} className="muted">No spans.</td></tr>}
          </tbody>
        </table>
        {chosen && <EllipseDrawing s={chosen} sys={sys} />}
      </div>
      <div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
        Each span is drawn at mid-span, looking ahead, with the span swung by SSW to each side about the line of its supports; the conductor lies on the
        major axis at B above the lower end of the ellipse (Fig. 7.3-13). Insulator swing is not included. Overlap areas are not computed.
      </div>
    </>
  );
}

function EllipseDrawing({ s, sys }: { s: GallopingSpan; sys: UnitSystem }) {
  const pts = s.phases.flatMap((p) => p.outline);
  if (!pts.length) return null;
  const u0 = Math.min(...pts.map((p) => p.u)), u1 = Math.max(...pts.map((p) => p.u));
  const z0 = Math.min(...pts.map((p) => p.z)), z1 = Math.max(...pts.map((p) => p.z));
  const W = 320, H = 300, pad = 20;
  const sc = Math.min((W - 2 * pad) / (u1 - u0 || 1), (H - 2 * pad - 20) / (z1 - z0 || 1));
  const X = (u: number) => pad + (u - u0) * sc, Y = (z: number) => H - pad - (z - z0) * sc;
  const cols = ['#c23b3b', '#2a6fdb', '#2a8a4a', '#9a6ad1', '#d9822b', '#555'];
  return (
    <svg width={W} height={H} className="chart" style={{ flex: 'none' }}>
      <text x={8} y={14} className="chart-title">Span {s.span}, swung to the {s.side} ({unitLabel(sys, 'length')})</text>
      {s.phases.map((p, i) => (
        <g key={p.phase}>
          <polyline fill="none" stroke={cols[i % cols.length]} strokeWidth={1.5} points={p.outline.map((q) => `${X(q.u)},${Y(q.z)}`).join(' ')} />
          <circle cx={X(p.conductor.u)} cy={Y(p.conductor.z)} r={3} fill={cols[i % cols.length]} />
          <text x={X(p.conductor.u) + 5} y={Y(p.conductor.z) + 12}>{p.phase}</text>
        </g>
      ))}
    </svg>
  );
}
