import { useState } from 'react';
import { fromSI, toSI, unitLabel, type UnitSystem } from '@tlcad/engine';
import {
  newId, Q_US_TO_SI, WIND_DIRECTIONS, type CableConditionValue, type ConditionRef, type Criteria, type LoadCase, type TensionLimit, type WeatherCase,
} from '@tlcad/model';
import { useApp } from '../store/appStore';
import { saveCriteria } from '../commands/sag';
import { Modal } from './Dialogs';
import { Row, UnitInput } from './LibraryDialogs';

/** Design criteria (§7.3): weather cases, cable condition definitions, tension limits, spans and swing, display. */

const COND: [CableConditionValue, string][] = [['initial', 'Initial'], ['creep', 'Final after creep'], ['load', 'Final after load']];
type Tab = 'weather' | 'condition' | 'limits' | 'autosag' | 'structures' | 'clearance' | 'wires' | 'galloping' | 'loads' | 'display';
const TABS: [Tab, string][] = [
  ['weather', 'Weather cases'], ['condition', 'Cable condition'], ['limits', 'Tension limits'], ['autosag', 'Automatic sagging'],
  ['structures', 'Spans, swing, Method 2'], ['clearance', 'Survey point clearance'], ['wires', 'Wire clearance'], ['galloping', 'Galloping'],
  ['loads', 'Structure loads'], ['display', 'Display'],
];

/** Q in display units: US psf/(mph)², SI Pa/(m/s)². */
const qShow = (q: number, sys: UnitSystem) => (sys === 'US' ? q / Q_US_TO_SI : q);
const qSI = (q: number, sys: UnitSystem) => (sys === 'US' ? q * Q_US_TO_SI : q);

function blankWeather(n: number): WeatherCase {
  return {
    id: newId(), name: `Weather ${n}`, airDensity: 0, windPressure: 0, iceThickness: 0, iceDensity: 0, iceLoad: 0, temperature: 0,
    weatherLoadFactor: 1, nescK: 0, gustFactor: 1, src: 'user',
  };
}

function NumCell(p: { value: number; onChange: (v: number) => void; width?: number; min?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Number(p.value.toPrecision(8)));
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(v) && (p.min === undefined || v >= p.min)) p.onChange(v);
    setDraft(null);
  };
  return (
    <input className="mono" style={{ width: p.width ?? 70, textAlign: 'right' }} value={shown} inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); if (e.key === 'Escape') setDraft(null); }} />
  );
}

const WeatherSelect = ({ cr, value, onChange, none }: { cr: Criteria; value: string | null; onChange: (id: string | null) => void; none?: string }) => (
  <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
    {none !== undefined && <option value="">{none}</option>}
    {none === undefined && value === null && <option value="">— choose —</option>}
    {cr.weatherCases.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
  </select>
);

const CondSelect = ({ value, onChange }: { value: CableConditionValue; onChange: (c: CableConditionValue) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value as CableConditionValue)}>
    {COND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
  </select>
);

function LimitsTable({ cr, list, sys, onChange, cables }: { cr: Criteria; list: TensionLimit[]; sys: UnitSystem; onChange: (l: TensionLimit[]) => void; cables: { id: string; name: string }[] }) {
  const set = (i: number, patch: Partial<TensionLimit>) => onChange(list.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <>
      <table className="grid">
        <thead><tr><th>Weather case</th><th>Cable condition</th><th>Max % ULT</th><th>Max tension ({unitLabel(sys, 'force')})</th><th>Max catenary H/UW ({unitLabel(sys, 'length')})</th><th>Cables</th><th /></tr></thead>
        <tbody>
          {list.map((l, i) => (
            <tr key={l.id}>
              <td><WeatherSelect cr={cr} value={l.weatherId || null} onChange={(id) => set(i, { weatherId: id ?? '' })} /></td>
              <td><CondSelect value={l.condition} onChange={(c) => set(i, { condition: c })} /></td>
              <td><UnitInput value={l.maxPercentUltimate} sys={sys} dim="ratio" nullable min={0} width={70} onChange={(v) => set(i, { maxPercentUltimate: v && v > 0 ? v : null })} /></td>
              <td><UnitInput value={l.maxTension} sys={sys} dim="force" nullable min={0} width={90} onChange={(v) => set(i, { maxTension: v && v > 0 ? v : null })} /></td>
              <td><UnitInput value={l.maxCatenary} sys={sys} dim="length" nullable min={0} width={90} onChange={(v) => set(i, { maxCatenary: v && v > 0 ? v : null })} /></td>
              <td>
                <select value={l.cableIds[0] ?? ''} onChange={(e) => set(i, { cableIds: e.target.value ? [e.target.value] : [] })}>
                  <option value="">All cables</option>
                  {cables.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </td>
              <td><button className="btn small" onClick={() => onChange(list.filter((_, k) => k !== i))}>Delete</button></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={7} className="muted">No limits.</td></tr>}
        </tbody>
      </table>
      <button className="btn small" style={{ marginTop: 6 }} disabled={!cr.weatherCases.length}
        onClick={() => onChange([...list, { id: newId(), weatherId: cr.weatherCases[0]!.id, condition: 'initial', maxPercentUltimate: null, maxTension: null, maxCatenary: null, cableIds: [] }])}>
        Add limit
      </button>
      <div className="muted" style={{ marginTop: 6 }}>Empty cells are not checked. A limit is met when the tension (and catenary constant) is within every value given.</div>
    </>
  );
}

function RefTable({ cr, refs, labels, onChange }: { cr: Criteria; refs: ConditionRef[]; labels: string[]; onChange: (r: ConditionRef[]) => void }) {
  return (
    <table className="grid" style={{ width: 'auto' }}>
      <thead><tr><th /><th>Weather case</th><th>Cable condition</th></tr></thead>
      <tbody>
        {refs.map((r, i) => (
          <tr key={i}>
            <td>{labels[i]}</td>
            <td><WeatherSelect cr={cr} value={r.weatherId} none="(not used)" onChange={(id) => onChange(refs.map((x, k) => (k === i ? { ...x, weatherId: id } : x)))} /></td>
            <td><CondSelect value={r.condition} onChange={(c) => onChange(refs.map((x, k) => (k === i ? { ...x, condition: c } : x)))} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RefList({ cr, refs, onChange, label, allowSagging }: { cr: Criteria; refs: ConditionRef[]; onChange: (r: ConditionRef[]) => void; label: string; allowSagging?: boolean }) {
  return (
    <>
      <table className="grid" style={{ width: 'auto' }}>
        <thead><tr><th /><th>Weather case</th><th>Cable condition</th><th /></tr></thead>
        <tbody>
          {refs.map((r, i) => (
            <tr key={i}>
              <td>{label} {i + 1}</td>
              <td><WeatherSelect cr={cr} value={r.weatherId} {...(allowSagging ? { none: 'Sagging condition' } : {})} onChange={(id) => onChange(refs.map((x, k) => (k === i ? { ...x, weatherId: id } : x)))} /></td>
              <td><CondSelect value={r.condition} onChange={(c) => onChange(refs.map((x, k) => (k === i ? { ...x, condition: c } : x)))} /></td>
              <td><button className="btn small" onClick={() => onChange(refs.filter((_, k) => k !== i))}>Delete</button></td>
            </tr>
          ))}
          {refs.length === 0 && <tr><td colSpan={4} className="muted">None.</td></tr>}
        </tbody>
      </table>
      <button className="btn small" style={{ marginTop: 6 }} disabled={!cr.weatherCases.length && !allowSagging} onClick={() => onChange([...refs, { weatherId: cr.weatherCases[0]?.id ?? null, condition: 'initial' }])}>Add {label.toLowerCase()}</button>
    </>
  );
}

export function CriteriaDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const sys = project.settings.unitSystem;
  const [cr, setCr] = useState<Criteria>(() => structuredClone(project.criteria));
  const [tab, setTab] = useState<Tab>('weather');
  const dirty = JSON.stringify(cr) !== JSON.stringify(project.criteria);
  const set = <K extends keyof Criteria>(k: K, v: Criteria[K]) => setCr((c) => ({ ...c, [k]: v }));
  const setW = (i: number, patch: Partial<WeatherCase>) => set('weatherCases', cr.weatherCases.map((w, k) => (k === i ? { ...w, ...patch } : w)));
  const errors: string[] = [];
  cr.weatherCases.forEach((w) => { if (!(w.airDensity > 0)) errors.push(`${w.name}: enter the air density factor Q.`); if (!w.name.trim()) errors.push('Every weather case needs a name.'); });
  for (const l of [...cr.tensionLimits, ...cr.autosagLimits]) if (!cr.weatherCases.some((w) => w.id === l.weatherId)) errors.push('A limit has no weather case.');
  const removeWeather = (id: string) => {
    const used = [...cr.tensionLimits, ...cr.autosagLimits].some((l) => l.weatherId === id);
    if (used) { useApp.getState().addLog('warning', 'The weather case is used by a tension limit; delete the limit first.'); return; }
    const others = { s: cr.surveyClearance, w: cr.wireClearance, g: cr.galloping, l: cr.loadCases, i: cr.interactionConditions };
    if (JSON.stringify(others).includes(JSON.stringify(id))) { useApp.getState().addLog('warning', 'The weather case is used by clearance, galloping, load case or Method 2 criteria; change those first.'); return; }
    setCr((c) => ({
      ...c, weatherCases: c.weatherCases.filter((w) => w.id !== id),
      creepWeatherId: c.creepWeatherId === id ? null : c.creepWeatherId, loadWeatherId: c.loadWeatherId === id ? null : c.loadWeatherId,
      weightSpanConditions: c.weightSpanConditions.map((r) => (r.weatherId === id ? { ...r, weatherId: null } : r)),
      swingConditions: c.swingConditions.map((r) => (r.weatherId === id ? { ...r, weatherId: null } : r)),
      display: c.display.weatherId === id ? { ...c.display, weatherId: null } : c.display,
    }));
  };
  const qLabel = sys === 'US' ? 'psf/mph²' : 'Pa/(m/s)²';
  const cables = project.cableLibrary.map((c) => ({ id: c.id, name: c.name }));

  return (
    <Modal
      title="Criteria — Weather, Cable Conditions, Tension Limits" onClose={close} width={1120}
      footer={<>
        {errors.length > 0 && <span style={{ color: 'var(--err)' }}>{errors[0]}</span>}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={close}>Close</button>
        <button className="btn primary" disabled={!dirty || errors.length > 0} onClick={() => { if (saveCriteria(cr)) close(); }}>Save criteria</button>
      </>}
    >
      <div className="tabbar">
        {TABS.map(([k, l]) => <button key={k} className={`tabbtn ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div style={{ maxHeight: '62vh', overflow: 'auto', paddingTop: 8 }}>
        {tab === 'weather' && (
          <>
            <table className="grid">
              <thead><tr>
                <th>Description</th><th title="Eq. 7-1">Air density Q ({qLabel})</th><th>Wind velocity ({unitLabel(sys, 'velocity')})</th><th>Wind pressure ({unitLabel(sys, 'pressure')})</th>
                <th>Ice thickness ({unitLabel(sys, 'smallLength')})</th><th>Ice density ({unitLabel(sys, 'density')})</th><th>Ice load ({unitLabel(sys, 'forcePerLength')})</th>
                <th>Wire temp ({unitLabel(sys, 'temperature')})</th><th>Weather load factor</th><th>NESC K ({unitLabel(sys, 'forcePerLength')})</th><th>Gust factor GRFC</th><th />
              </tr></thead>
              <tbody>
                {cr.weatherCases.map((w, i) => {
                  const v = w.airDensity > 0 ? Math.sqrt(w.windPressure / w.airDensity) : 0;
                  return (
                    <tr key={w.id}>
                      <td><input value={w.name} style={{ width: 130 }} onChange={(e) => setW(i, { name: e.target.value })} /></td>
                      <td><NumCell value={qShow(w.airDensity, sys)} min={0} width={80} onChange={(q) => setW(i, { airDensity: qSI(q, sys), windPressure: qSI(q, sys) * v * v })} /></td>
                      <td><NumCell value={fromSI(v, sys, 'velocity')} min={0} onChange={(x) => { const vs = toSI(x, sys, 'velocity'); setW(i, { windPressure: w.airDensity * vs * vs }); }} /></td>
                      <td><UnitInput value={w.windPressure} sys={sys} dim="pressure" min={0} width={70} onChange={(x) => setW(i, { windPressure: x ?? 0 })} /></td>
                      <td><UnitInput value={w.iceThickness} sys={sys} dim="smallLength" min={0} width={60} onChange={(x) => setW(i, { iceThickness: x ?? 0 })} /></td>
                      <td><UnitInput value={w.iceDensity} sys={sys} dim="density" min={0} width={70} onChange={(x) => setW(i, { iceDensity: x ?? 0 })} /></td>
                      <td><UnitInput value={w.iceLoad} sys={sys} dim="forcePerLength" min={0} width={60} onChange={(x) => setW(i, { iceLoad: x ?? 0 })} /></td>
                      <td><UnitInput value={w.temperature} sys={sys} dim="temperature" width={60} onChange={(x) => setW(i, { temperature: x ?? 0 })} /></td>
                      <td><NumCell value={w.weatherLoadFactor} min={0} width={55} onChange={(x) => x > 0 && setW(i, { weatherLoadFactor: x })} /></td>
                      <td><UnitInput value={w.nescK} sys={sys} dim="forcePerLength" min={0} width={60} onChange={(x) => setW(i, { nescK: x ?? 0 })} /></td>
                      <td><NumCell value={w.gustFactor} min={0} width={55} onChange={(x) => x > 0 && setW(i, { gustFactor: x })} /></td>
                      <td><button className="btn small" onClick={() => removeWeather(w.id)}>Delete</button></td>
                    </tr>
                  );
                })}
                {cr.weatherCases.length === 0 && <tr><td colSpan={12} className="muted">No weather cases. Add them from the governing code or specification.</td></tr>}
              </tbody>
            </table>
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => set('weatherCases', [...cr.weatherCases, blankWeather(cr.weatherCases.length + 1)])}>Add weather case</button>
            <div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
              Enter wind velocity or pressure; the other follows from Eq. 7-1, P = Q·V². No values are pre-filled: the air density factor, wind, ice and
              temperature come from the governing code. Wire loads use Eqs. 7-3 to 7-6: wind load = WLF·P·GRFC·(D + 2t); ice load from DENS·π·t·(D + t) plus WICE.
              The wire wind-height adjustment models of §7.2.1.1 are not implemented: the input wind applies at every height (the manual's "None" option).
            </div>
          </>
        )}
        {tab === 'condition' && (
          <>
            <h4 style={{ margin: '4px 0 8px' }}>Weather cases defining the final conditions (§7.3.4)</h4>
            <Row label="Final after creep"><WeatherSelect cr={cr} value={cr.creepWeatherId} none="(not defined)" onChange={(id) => set('creepWeatherId', id)} /><span className="muted">long-term everyday condition at which creep is computed</span></Row>
            <Row label="Final after load"><WeatherSelect cr={cr} value={cr.loadWeatherId} none="(not defined)" onChange={(id) => set('loadWeatherId', id)} /><span className="muted">heaviest loading that permanently stretches the cable</span></Row>
            <h4 style={{ margin: '14px 0 8px' }}>Bimetallic conductor model (§7.3.5)</h4>
            <Row label="Outer strands in compression">
              <select value={cr.outerCompression.mode} onChange={(e) => set('outerCompression', { ...cr.outerCompression, mode: e.target.value as Criteria['outerCompression']['mode'] })}>
                <option value="none">Cannot carry compression</option>
                <option value="limited">Can carry compression up to a limit</option>
                <option value="unlimited">Unlimited compression</option>
              </select>
              {cr.outerCompression.mode === 'limited' && <><UnitInput value={cr.outerCompression.limit} sys={sys} dim="stress" min={0} onChange={(v) => set('outerCompression', { ...cr.outerCompression, limit: v ?? 0 })} /><span className="muted">{unitLabel(sys, 'stress')}</span></>}
            </Row>
            <h4 style={{ margin: '14px 0 8px' }}>Maximum tension (§7.3.8)</h4>
            <Row label="Tension compared with limits">
              <select value={cr.maxTension} onChange={(e) => set('maxTension', e.target.value as Criteria['maxTension'])}>
                <option value="rulingSpan">Ruling span support tension</option>
                <option value="actual">Largest end tension of the actual spans</option>
              </select>
            </Row>
            <div className="muted" style={{ marginTop: 8 }}>Sag-tension uses the Level 1 ruling span method (§7.2.3): all spans of a section share the horizontal tension of the ruling span.</div>
          </>
        )}
        {tab === 'limits' && <LimitsTable cr={cr} list={cr.tensionLimits} sys={sys} cables={cables} onChange={(l) => set('tensionLimits', l)} />}
        {tab === 'autosag' && (
          <>
            <div className="muted" style={{ marginBottom: 8 }}>Automatic sagging (§7.3.7) finds the largest sagging tension at which every limit below is met.</div>
            <LimitsTable cr={cr} list={cr.autosagLimits} sys={sys} cables={cables} onChange={(l) => set('autosagLimits', l)} />
          </>
        )}
        {tab === 'structures' && (
          <>
            <h4 style={{ margin: '4px 0 8px' }}>Weight span model (§7.3.9, App. I.3)</h4>
            <Row label="Weight span">
              <select value={cr.weightSpanModel} onChange={(e) => set('weightSpanModel', e.target.value as Criteria['weightSpanModel'])}>
                <option value="exact">Vertical load ÷ unit vertical load (exact)</option>
                <option value="arcLength">Arc length to the low points</option>
              </select>
            </Row>
            <h4 style={{ margin: '14px 0 8px' }}>Weight span conditions for Method 1 structures (§7.3.10)</h4>
            <RefTable cr={cr} refs={cr.weightSpanConditions} labels={['Condition 1', 'Condition 2', 'Condition 3']} onChange={(r) => set('weightSpanConditions', r)} />
            <h4 style={{ margin: '14px 0 8px' }}>Insulator swing conditions (§7.3.16)</h4>
            <RefTable cr={cr} refs={cr.swingConditions} labels={['Swing 1', 'Swing 2', 'Swing 3', 'Swing 4']} onChange={(r) => set('swingConditions', r)} />
            <div className="muted" style={{ marginTop: 8 }}>Swing is computed with the wind normal to each adjacent span, from both sides (Eqs. 7-37 and 7-38); the allowable angles are entered per attachment in the structure library.</div>
          </>
        )}
        {tab === 'structures' && (
          <>
            <h4 style={{ margin: '14px 0 8px' }}>Interaction diagram conditions for Method 2 structures (§7.3.11)</h4>
            <RefList cr={cr} refs={cr.interactionConditions} onChange={(r) => set('interactionConditions', r)} label="Diagram" />
            <div className="muted" style={{ marginTop: 6 }}>Row n of this table must match diagram n of every angle range in the Method 2 structure files (App. F.1.4.2).</div>
          </>
        )}
        {tab === 'clearance' && (
          <>
            <h4 style={{ margin: '4px 0 8px' }}>Conditions for checking survey point clearances (§7.3.13)</h4>
            <RefList cr={cr} refs={cr.surveyClearance.conditions} onChange={(r) => set('surveyClearance', { ...cr.surveyClearance, conditions: r })} label="Condition" allowSagging />
            <div className="muted" style={{ margin: '6px 0' }}>Weather cases with wind are checked with the wind from the left and from the right. The continuous range of wind positions is not implemented.</div>
            <Row label="Clearance zone">
              <select value={cr.surveyClearance.type} onChange={(e) => set('surveyClearance', { ...cr.surveyClearance, type: e.target.value as 'rectangular' | 'radial' })}>
                <option value="rectangular">Rectangular (RV, RH) — band when RH is blank (§6.1.1)</option>
                <option value="radial">Radial — 3-D distance against RV</option>
              </select>
            </Row>
            <Row label="Max. horizontal distance from wire" unit={unitLabel(sys, 'length')}>
              <UnitInput value={cr.surveyClearance.maxHorizontal} sys={sys} dim="length" nullable min={0} onChange={(v) => set('surveyClearance', { ...cr.surveyClearance, maxHorizontal: v && v > 0 ? v : null })} />
              <span className="muted">blank = no limit</span>
            </Row>
            <h4 style={{ margin: '14px 0 8px' }}>Ground clearance line and ground feature code (§6.10.2, §11.2.3.1)</h4>
            <Row label="Voltage (kV)">
              <select value={cr.clearanceLine.voltageKV ?? ''} onChange={(e) => set('clearanceLine', { ...cr.clearanceLine, voltageKV: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">(no clearance line)</option>
                {project.terrain.voltages.map((v) => <option key={v} value={v}>{v} kV</option>)}
              </select>
            </Row>
            <Row label="Feature code for ground">
              <select value={cr.clearanceLine.groundCode ?? ''} onChange={(e) => set('clearanceLine', { ...cr.clearanceLine, groundCode: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">(none)</option>
                {project.terrain.featureCodes.map((c) => <option key={c.code} value={c.code}>{c.code} {c.description}</option>)}
              </select>
              <span className="muted">its RV is the basic ground clearance and the requirement for the clearance to TIN</span>
            </Row>
          </>
        )}
        {tab === 'wires' && (
          <>
            <h4 style={{ margin: '4px 0 8px' }}>Clearances between cables (§7.3.14, §11.2.3.2.2)</h4>
            <table className="grid" style={{ width: 'auto' }}>
              <thead><tr><th /><th>Voltage</th><th>Weather case</th><th>Cable condition</th><th>Wind toward</th><th>Straight line wire</th><th>Ice jump</th></tr></thead>
              <tbody>
                {(['source', 'target'] as const).map((k) => {
                  const s = cr.wireClearance[k];
                  const up = (patch: Partial<typeof s>) => set('wireClearance', { ...cr.wireClearance, [k]: { ...s, ...patch } });
                  return (
                    <tr key={k}>
                      <td>{k === 'source' ? 'Source wires' : 'Target wires'}</td>
                      <td>
                        <select value={s.voltageKV ?? ''} onChange={(e) => up({ voltageKV: e.target.value === '' ? null : Number(e.target.value) })}>
                          <option value="">All</option>
                          {[...new Set(project.sections.map((x) => x.voltageKV))].map((v) => <option key={v} value={v}>{v} kV</option>)}
                        </select>
                      </td>
                      <td><WeatherSelect cr={cr} value={s.weatherId} none="Sagging condition" onChange={(id) => up({ weatherId: id })} /></td>
                      <td><CondSelect value={s.condition} onChange={(c) => up({ condition: c })} /></td>
                      <td><select value={s.wind} onChange={(e) => up({ wind: e.target.value as 'left' | 'right' })}><option value="left">Left</option><option value="right">Right</option></select></td>
                      <td><input type="checkbox" checked={s.straight} onChange={(e) => up({ straight: e.target.checked })} /></td>
                      <td>{k === 'source' ? <input type="checkbox" checked={s.iceJump} onChange={(e) => up({ iceJump: e.target.checked })} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Row label="Measure">
              <select value={cr.wireClearance.measure} onChange={(e) => set('wireClearance', { ...cr.wireClearance, measure: e.target.value as '3d' | 'horizontal' })}>
                <option value="3d">3-D (radial)</option>
                <option value="horizontal">Horizontal only</option>
              </select>
            </Row>
            <h4 style={{ margin: '12px 0 6px' }}>Required separation ({unitLabel(sys, 'length')}, surface to surface)</h4>
            <table className="grid" style={{ width: 'auto' }}>
              <thead><tr><th>Source kV</th><th>Target kV</th><th>Required</th><th /></tr></thead>
              <tbody>
                {cr.wireClearance.required.map((r, i) => {
                  const up = (patch: Partial<typeof r>) => set('wireClearance', { ...cr.wireClearance, required: cr.wireClearance.required.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                  return (
                    <tr key={i}>
                      <td><NumCell value={r.sourceKV} min={0} onChange={(v) => up({ sourceKV: v })} /></td>
                      <td><NumCell value={r.targetKV} min={0} onChange={(v) => up({ targetKV: v })} /></td>
                      <td><UnitInput value={r.distance} sys={sys} dim="length" min={0} onChange={(v) => up({ distance: v ?? 0 })} /></td>
                      <td><button className="btn small" onClick={() => set('wireClearance', { ...cr.wireClearance, required: cr.wireClearance.required.filter((_, j) => j !== i) })}>Delete</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => set('wireClearance', { ...cr.wireClearance, required: [...cr.wireClearance.required, { sourceKV: project.sections[0]?.voltageKV ?? 0, targetKV: project.sections[0]?.voltageKV ?? 0, distance: 0 }] })}>Add requirement</button>
            <div className="muted" style={{ marginTop: 6 }}>Ice jump: each point of the source wire is reflected about its position with the ice removed at the same temperature (§11.2.3.2.2). Code-specific asynchronous-wind increases are not implemented.</div>
          </>
        )}
        {tab === 'galloping' && (
          <>
            <Row label="Method">
              <select value={cr.galloping.method} onChange={(e) => set('galloping', { ...cr.galloping, method: e.target.value as Criteria['galloping']['method'] })}>
                <option value="reaSingle">REA single loop (Eqs. 7-22 to 7-25)</option>
                <option value="reaDouble">REA double loop (Eqs. 7-26 to 7-28)</option>
                <option value="cigreSingle">CIGRE TB 322, single wire (Eqs. 7-29 to 7-32)</option>
                <option value="cigreBundle">CIGRE TB 322, bundle (Eqs. 7-33 to 7-36)</option>
              </select>
            </Row>
            <Row label="Sag condition"><WeatherSelect cr={cr} value={cr.galloping.sag.weatherId} none="(not defined)" onChange={(id) => set('galloping', { ...cr.galloping, sag: { ...cr.galloping.sag, weatherId: id } })} /><CondSelect value={cr.galloping.sag.condition} onChange={(c) => set('galloping', { ...cr.galloping, sag: { ...cr.galloping.sag, condition: c } })} /></Row>
            <Row label="Swing condition"><WeatherSelect cr={cr} value={cr.galloping.swing.weatherId} none="(not defined)" onChange={(id) => set('galloping', { ...cr.galloping, swing: { ...cr.galloping.swing, weatherId: id } })} /><CondSelect value={cr.galloping.swing.condition} onChange={(c) => set('galloping', { ...cr.galloping, swing: { ...cr.galloping.swing, condition: c } })} /></Row>
            <Row label="Galloping safety factor"><NumCell value={cr.galloping.gsf} min={0} onChange={(v) => v > 0 && set('galloping', { ...cr.galloping, gsf: v })} /><span className="muted">multiplies MAJOR</span></Row>
            <Row label="Set ESW to zero"><input type="checkbox" checked={cr.galloping.eswZero} onChange={(e) => set('galloping', { ...cr.galloping, eswZero: e.target.checked })} /></Row>
            <div className="muted" style={{ marginTop: 6 }}>The REA bulletin specifies the sag and swing conditions; enter them as weather cases. Suspension insulator swing is not included in the ellipse position.</div>
          </>
        )}
        {tab === 'loads' && (
          <>
            <table className="grid">
              <thead><tr><th>Description</th><th>Weather case</th><th>Cable condition</th><th>Wind direction</th><th title="BI±: angle from the bisector; GLB: azimuth from north">WB (°)</th><th>LFV</th><th>LFW</th><th>LFT</th><th>LFS</th><th /></tr></thead>
              <tbody>
                {cr.loadCases.map((l, i) => {
                  const up = (patch: Partial<LoadCase>) => set('loadCases', cr.loadCases.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <tr key={l.id}>
                      <td><input value={l.name} style={{ width: 130 }} onChange={(e) => up({ name: e.target.value })} /></td>
                      <td><WeatherSelect cr={cr} value={l.weatherId} none="Sagging condition" onChange={(id) => up({ weatherId: id })} /></td>
                      <td><CondSelect value={l.condition} onChange={(c) => up({ condition: c })} /></td>
                      <td><select value={l.windDirection} onChange={(e) => up({ windDirection: e.target.value as LoadCase['windDirection'] })}>{WIND_DIRECTIONS.map((w) => <option key={w} value={w}>{w}</option>)}</select></td>
                      <td><NumCell value={l.wb} width={55} onChange={(v) => up({ wb: v })} /></td>
                      <td><NumCell value={l.lfv} min={0} width={50} onChange={(v) => up({ lfv: v })} /></td>
                      <td><NumCell value={l.lfw} min={0} width={50} onChange={(v) => up({ lfw: v })} /></td>
                      <td><NumCell value={l.lft} min={0} width={50} onChange={(v) => up({ lft: v })} /></td>
                      <td><NumCell value={l.lfs} min={0} width={50} onChange={(v) => up({ lfs: v })} /></td>
                      <td><button className="btn small" onClick={() => set('loadCases', cr.loadCases.filter((_, j) => j !== i))}>Delete</button></td>
                    </tr>
                  );
                })}
                {cr.loadCases.length === 0 && <tr><td colSpan={10} className="muted">No load cases.</td></tr>}
              </tbody>
            </table>
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => set('loadCases', [...cr.loadCases, { id: newId(), name: `Load case ${cr.loadCases.length + 1}`, weatherId: cr.weatherCases[0]?.id ?? null, condition: 'initial', windDirection: 'NA+', wb: 0, lfv: 1, lfw: 1, lft: 1, lfs: 1 }])}>Add load case</button>
            <div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
              Wire loads at the structure attachment points with Eqs. 7-7 to 7-12 and §7.3.12.4, and structure pressures with Eqs. 7-13 and 7-14.
              Load factors are entered by you from the governing code; new rows start at 1. Not implemented: the MAX wind option,
              unbalanced loading (§7.3.12.7), taps, strength factors and the LCA/LIC export for TOWER and PLS-POLE.
            </div>
          </>
        )}        {tab === 'display' && (
          <>
            <Row label="Draw wires at">
              <WeatherSelect cr={cr} value={cr.display.weatherId} none="Sagging condition of each section" onChange={(id) => set('display', { ...cr.display, weatherId: id })} />
              {cr.display.weatherId && <CondSelect value={cr.display.condition} onChange={(c) => set('display', { ...cr.display, condition: c })} />}
            </Row>
            <Row label="Wind blows wires to the">
              <select value={cr.display.wind} onChange={(e) => set('display', { ...cr.display, wind: e.target.value as 'left' | 'right' })}>
                <option value="left">Left (looking ahead along the line)</option>
                <option value="right">Right (looking ahead along the line)</option>
              </select>
            </Row>
            <Row label="Notes"><textarea value={cr.notes} rows={4} style={{ width: 480 }} onChange={(e) => set('notes', e.target.value)} /></Row>
          </>
        )}
      </div>
    </Modal>
  );
}
