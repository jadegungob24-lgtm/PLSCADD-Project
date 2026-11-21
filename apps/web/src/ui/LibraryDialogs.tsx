import { useEffect, useMemo, useState } from 'react';
import {
  fitCableTestData, fromSI, polyval, toSI, unitLabel, type CableFit, type Dimension, type UnitSystem,
} from '@tlcad/engine';
import {
  checkStructureType, INSULATOR_LABEL, newAttachment, newId, newMaterial,
  type Attachment, type Cable, type CableMaterial, type InsulatorType, type StructureType,
} from '@tlcad/model';
import { useApp } from '../store/appStore';
import {
  createFamily, deleteCable, deleteStructureType, exportLibrary, importLibrary, saveCable, saveStructureType,
} from '../commands/line';
import { Modal } from './Dialogs';
import { StructureSketch } from './StructureSketch';

/** Number input in display units, holding an SI value. Commits on blur or Enter; reverts on Escape. */
export function UnitInput(p: {
  value: number | null; sys: UnitSystem; dim: Dimension; onChange: (si: number | null) => void;
  width?: number; nullable?: boolean; min?: number; decimals?: number; disabled?: boolean;
}) {
  const show = (v: number | null) => (v === null ? '' : String(Number(fromSI(v, p.sys, p.dim).toFixed(p.decimals ?? 6))));
  const [draft, setDraft] = useState(show(p.value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setDraft(show(p.value)); setBad(false); }, [p.value, p.sys]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const t = draft.trim();
    if (t === '') { if (p.nullable) { p.onChange(null); setBad(false); } else { setDraft(show(p.value)); } return; }
    const v = Number(t);
    if (!Number.isFinite(v) || (p.min !== undefined && v < p.min)) { setBad(true); return; }
    setBad(false);
    p.onChange(toSI(v, p.sys, p.dim));
  };
  return (
    <input
      className={`mono ${bad ? 'invalid' : ''}`} style={{ width: p.width ?? 90, textAlign: 'right', ...(bad ? { borderColor: 'var(--err)', background: '#fdecea' } : {}) }}
      value={draft} disabled={p.disabled} inputMode="decimal" onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); if (e.key === 'Escape') { setDraft(show(p.value)); setBad(false); } }}
    />
  );
}

export const Row = ({ label, children, unit }: { label: string; children: React.ReactNode; unit?: string }) => (
  <div className="field" style={{ gridTemplateColumns: '170px 1fr', margin: '3px 0' }}>
    <label>{label}{unit ? ` (${unit})` : ''}</label>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{children}</div>
  </div>
);

const ListPane = <T extends { id: string; name: string }>(p: {
  items: T[]; sel: string | null; onSel: (id: string) => void; children?: React.ReactNode;
}) => (
  <div style={{ width: 190, flex: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div className="scroll" style={{ flex: 1, maxHeight: 'none', minHeight: 260 }}>
      {p.items.length === 0 && <div className="muted" style={{ padding: 8 }}>The library is empty.</div>}
      {p.items.map((it) => (
        <div key={it.id} className={`tree-row ${it.id === p.sel ? 'sel' : ''}`} onClick={() => p.onSel(it.id)}>{it.name}</div>
      ))}
    </div>
    {p.children}
  </div>
);

function pickFile(accept: string, fn: (f: File) => void) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept;
  input.onchange = () => { const f = input.files?.[0]; if (f) fn(f); };
  input.click();
}

// ================================================================== Cables

function blankCable(): Cable {
  return {
    id: newId(), name: 'New cable', description: '', stockNumber: '', model: 'nonlinear',
    // Placeholder dimensions are not engineering data: the cable cannot be saved until real values replace them.
    area: 0, diameter: 0, unitWeight: 0, ultimateTension: 0, independentCables: 1, gapType: false, testTemperature: 15,
    outer: newMaterial(), core: null, creepTemperatureShift: 0, outerCompression: { mode: 'criteria', limit: 0 },
    color: '#c4572a', testData: null, src: 'user',
  } as unknown as Cable;
}

function PolyRow({ label, values, sys, onChange }: { label: string; values: number[]; sys: UnitSystem; onChange: (v: CableMaterial['initial']) => void }) {
  return (
    <Row label={label} unit={unitLabel(sys, 'stress')}>
      {values.map((v, i) => (
        <UnitInput key={i} value={v} sys={sys} dim="stress" width={86} decimals={4}
          onChange={(si) => { const next = [...values] as CableMaterial['initial']; next[i] = si ?? 0; onChange(next); }} />
      ))}
    </Row>
  );
}

function MaterialEditor({ title, m, sys, linear, onChange }: { title: string; m: CableMaterial; sys: UnitSystem; linear: boolean; onChange: (m: CableMaterial) => void }) {
  const isOuter = title.startsWith('Outer');
  return (
    <fieldset style={{ border: '1px solid var(--border-soft)', margin: '8px 0', padding: '4px 10px 8px' }}>
      <legend className="muted">{title}</legend>
      <Row label={linear ? 'Modulus of elasticity' : 'Final modulus × area ratio'} unit={`${unitLabel(sys, 'stress')} per % strain`}>
        <UnitInput value={m.finalModulus} sys={sys} dim="stress" min={0} decimals={4} onChange={(v) => onChange({ ...m, finalModulus: v ?? 0 })} />
      </Row>
      <Row label="Thermal expansion" unit={unitLabel(sys, 'expansion')}>
        <UnitInput value={m.thermalCoeff} sys={sys} dim="expansion" decimals={4} onChange={(v) => onChange({ ...m, thermalCoeff: v ?? 0 })} />
      </Row>
      {!linear && (
        <>
          <PolyRow label={`Stress-strain ${isOuter ? 'a0…a4' : 'b0…b4'}`} values={m.initial} sys={sys} onChange={(v) => onChange({ ...m, initial: v })} />
          <PolyRow label={`Creep ${isOuter ? 'c0…c4' : 'd0…d4'}`} values={m.creep} sys={sys} onChange={(v) => onChange({ ...m, creep: v })} />
        </>
      )}
    </fieldset>
  );
}

/** Test data entry and polynomial fit (App. G.1). */
function TestDataPanel({ cable, sys, onApply, onClose }: { cable: Cable; sys: UnitSystem; onApply: (fit: CableFit, data: Cable['testData']) => void; onClose: () => void }) {
  const fu = unitLabel(sys, 'force');
  const toRows = (pairs: [number, number][] | undefined) => (pairs ?? []).map(([T, e]) => `${Number(fromSI(T, sys, 'force').toFixed(3))}\t${e}`).join('\n');
  const [ini, setIni] = useState(toRows(cable.testData?.initial));
  const [crp, setCrp] = useState(toRows(cable.testData?.creep));
  const parse = (s: string): [number, number][] | null => {
    const rows = s.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
    const out: [number, number][] = [];
    for (const r of rows) {
      const v = r.split(/[\s,;]+/).map(Number);
      if (v.length < 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) return null;
      out.push([toSI(v[0]!, sys, 'force'), v[1]!]);
    }
    return out;
  };
  const pi = parse(ini), pc = parse(crp);
  const result = useMemo(
    () => (pi && pc && cable.area > 0 ? fitCableTestData({ area: cable.area, initial: pi, creep: pc }) : null),
    [ini, crp, cable.area], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const su = unitLabel(sys, 'stress');
  const stress = (v: number) => Number(fromSI(v, sys, 'stress').toFixed(1));
  // Chart: tension (as stress) against elongation, test points and fitted curves.
  let chart: React.ReactNode = null;
  if (result?.ok && pi && pc) {
    const f = result.fit;
    const maxE = Math.max(...pi.map((q) => q[1]), ...f.creepTotalStrain) * 1.05;
    const maxS = Math.max(...pi.map((q) => q[0] / cable.area), ...pc.map((q) => q[0] / cable.area)) * 1.1;
    const W = 360, H = 200, X = (e: number) => 34 + (e / maxE) * (W - 44), Y = (s: number) => H - 22 - (s / maxS) * (H - 32);
    const curve = (c: number[], upTo: number) => Array.from({ length: 60 }, (_, i) => { const e = (upTo * i) / 59; return `${X(e)},${Y(polyval(c, e))}`; }).join(' ');
    chart = (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H, background: '#fff', border: '1px solid var(--border-soft)' }}>
        <line x1={34} y1={H - 22} x2={W - 6} y2={H - 22} stroke="#999" /><line x1={34} y1={6} x2={34} y2={H - 22} stroke="#999" />
        <text x={W - 8} y={H - 8} fontSize={10} textAnchor="end" fill="#555">elongation %  (max {maxE.toFixed(3)})</text>
        <text x={38} y={14} fontSize={10} fill="#555">stress {su} (max {stress(maxS)})</text>
        <polyline points={curve(f.initial, Math.max(...pi.map((q) => q[1])))} fill="none" stroke="#2f6fbd" strokeWidth={1.5} />
        <polyline points={curve(f.creep, Math.max(...f.creepTotalStrain))} fill="none" stroke="#c4572a" strokeWidth={1.5} />
        {pi.map(([T, e], i) => <rect key={`i${i}`} x={X(e) - 2.5} y={Y(T / cable.area) - 2.5} width={5} height={5} fill="#2f6fbd" />)}
        {pc.map(([T], i) => <rect key={`c${i}`} x={X(f.creepTotalStrain[i]!) - 2.5} y={Y(T / cable.area) - 2.5} width={5} height={5} fill="#c4572a" />)}
        <text x={40} y={H - 30} fontSize={10} fill="#2f6fbd">■ initial</text><text x={95} y={H - 30} fontSize={10} fill="#c4572a">■ after creep (10 years)</text>
      </svg>
    );
  }
  return (
    <fieldset style={{ border: '1px solid var(--accent)', margin: '8px 0', padding: '6px 10px 10px', background: '#f5f8fc' }}>
      <legend><b>Coefficients from test data</b> (manual App. G.1)</legend>
      <div className="muted" style={{ marginBottom: 6 }}>
        One pair per line: tension ({fu}) and elongation (%). Creep elongation is the elongation beyond the initial elongation after the
        tension is held for ten years. Start the initial data with a small non-zero point. The cable is treated as one material: enter its
        composite thermal expansion as the outer-strand coefficient.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>Initial: tension, elongation %<br /><textarea style={{ width: 210, height: 140, fontFamily: 'var(--mono)' }} value={ini} onChange={(e) => setIni(e.target.value)} /></label>
        <label>Creep: tension, creep elongation %<br /><textarea style={{ width: 210, height: 140, fontFamily: 'var(--mono)' }} value={crp} onChange={(e) => setCrp(e.target.value)} /></label>
        {chart}
      </div>
      {!(cable.area > 0) && <div style={{ color: 'var(--err)' }}>Enter the cross-section area first: tensions are divided by it to get stresses.</div>}
      {(!pi || !pc) && <div style={{ color: 'var(--err)' }}>Each line needs two numbers.</div>}
      {result && !result.ok && <div style={{ color: 'var(--err)' }}>{result.message}</div>}
      {result?.ok && (
        <div style={{ marginTop: 6 }}>
          <div className="mono">a = [{result.fit.initial.map(stress).join(', ')}] {su}</div>
          <div className="mono">c = [{result.fit.creep.map(stress).join(', ')}] {su}</div>
          <div className="muted">
            RMS stress residual: initial {stress(result.fit.rmsInitial)}, creep {stress(result.fit.rmsCreep)} {su}. Slope at the origin a1 = {stress(result.fit.slopeAtOrigin)} {su} per %:
            the manual says the final modulus should be equal or close to it — enter the final modulus yourself.
            Fit: unweighted least squares of all five coefficients; creep total elongation = initial elongation at that tension + creep elongation (method not specified by the manual).
          </div>
          {result.fit.warnings.map((w, i) => <div key={i} style={{ color: 'var(--warn)' }}>⚠ {w}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button className="btn small primary" disabled={!result?.ok} onClick={() => { if (result?.ok) onApply(result.fit, { initial: pi!, creep: pc! }); }}>Use these coefficients</button>
        <button className="btn small" onClick={onClose}>Close</button>
      </div>
    </fieldset>
  );
}

export function CableLibraryDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const sys = project.settings.unitSystem;
  const lib = project.cableLibrary;
  const [selId, setSelId] = useState<string | null>(lib[0]?.id ?? null);
  const [draft, setDraft] = useState<Cable | null>(lib[0] ? structuredClone(lib[0]) : null);
  const [testOpen, setTestOpen] = useState(false);
  const saved = lib.find((c) => c.id === draft?.id);
  const dirty = !!draft && JSON.stringify(saved) !== JSON.stringify(draft);
  const choose = (id: string) => { const c = lib.find((k) => k.id === id); setSelId(id); setDraft(c ? structuredClone(c) : null); setTestOpen(false); };
  const set = <K extends keyof Cable>(k: K, v: Cable[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const errors: string[] = [];
  if (draft) {
    if (!draft.name.trim()) errors.push('Name is required.');
    for (const [k, lbl] of [['area', 'area'], ['diameter', 'diameter'], ['unitWeight', 'unit weight'], ['ultimateTension', 'ultimate tension']] as const) {
      if (!(draft[k] > 0)) errors.push(`Enter the ${lbl}.`);
    }
    if (!(draft.outer.finalModulus > 0)) errors.push(`Enter the ${draft.model === 'linear' ? 'modulus of elasticity' : 'final modulus of the outer strands'}.`);
    if (draft.model === 'nonlinear' && draft.outer.initial.every((v) => v === 0)) errors.push('Enter the stress-strain coefficients a0…a4 or fit them from test data.');
    if (draft.core && !(draft.core.finalModulus > 0)) errors.push('Enter the final modulus of the core strands.');
  }
  const uw = unitLabel(sys, 'forcePerLength'), fu = unitLabel(sys, 'force');

  return (
    <Modal
      title="Cable Library — Conductors and Ground Wires" onClose={close} width={1060}
      footer={<>
        <button className="btn" onClick={() => pickFile('.json', (f) => { void importLibrary(f); })}>Import library…</button>
        <button className="btn" onClick={exportLibrary} disabled={!lib.length && !project.structureLibrary.length}>Export library</button>
        <div style={{ flex: 1 }} />
        {errors.length > 0 && dirty && <span style={{ color: 'var(--err)' }}>{errors[0]}</span>}
        <button className="btn" onClick={close}>Close</button>
        <button className="btn primary" disabled={!draft || !dirty || errors.length > 0} onClick={() => { if (draft && saveCable({ ...draft, name: draft.name.trim() })) setSelId(draft.id); }}>Save cable</button>
      </>}
    >
      <div style={{ display: 'flex', gap: 14 }}>
        <ListPane items={[...lib, ...(draft && !saved ? [draft] : [])]} sel={selId} onSel={choose}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button className="btn small" onClick={() => { const c = blankCable(); setSelId(c.id); setDraft(c); }}>New</button>
            <button className="btn small" disabled={!saved} onClick={() => { if (saved) { const c = { ...structuredClone(saved), id: newId(), name: `${saved.name} copy`, src: 'user' as const }; setSelId(c.id); setDraft(c); } }}>Duplicate</button>
            <button className="btn small" disabled={!saved} onClick={() => { if (saved) { deleteCable(saved.id); } }}>Delete</button>
          </div>
        </ListPane>
        {!draft ? <div className="muted" style={{ padding: 20 }}>No cables yet. Choose New to enter conductor data from the manufacturer or from a cable file.</div> : (
          <div style={{ flex: 1, minWidth: 0, maxHeight: '64vh', overflow: 'auto', paddingRight: 6 }}>
            <Row label="Name"><input value={draft.name} onChange={(e) => set('name', e.target.value)} style={{ width: 220 }} /></Row>
            <Row label="Description"><input value={draft.description} onChange={(e) => set('description', e.target.value)} style={{ width: 360 }} /></Row>
            <Row label="Stock number"><input value={draft.stockNumber} onChange={(e) => set('stockNumber', e.target.value)} style={{ width: 160 }} /></Row>
            <Row label="Cable model">
              <select value={draft.model} onChange={(e) => set('model', e.target.value as Cable['model'])}>
                <option value="nonlinear">Nonlinear with creep (polynomials, §9.1)</option>
                <option value="linear">Simplified linear, creep as temperature increase (App. G.2)</option>
              </select>
              <span className="muted">The improved linear model (App. G.3) is not available: its definition is not in the reference set.</span>
            </Row>
            <Row label="Cross-section area AT" unit={unitLabel(sys, 'area')}><UnitInput value={draft.area} sys={sys} dim="area" min={0} onChange={(v) => set('area', v ?? 0)} /></Row>
            <Row label="Outside diameter D" unit={unitLabel(sys, 'smallLength')}><UnitInput value={draft.diameter} sys={sys} dim="smallLength" min={0} onChange={(v) => set('diameter', v ?? 0)} /></Row>
            <Row label="Unit weight UW" unit={uw}><UnitInput value={draft.unitWeight} sys={sys} dim="forcePerLength" min={0} onChange={(v) => set('unitWeight', v ?? 0)} /></Row>
            <Row label="Ultimate tension ULT" unit={fu}><UnitInput value={draft.ultimateTension} sys={sys} dim="force" min={0} onChange={(v) => set('ultimateTension', v ?? 0)} /></Row>
            <Row label="Independent cables"><input type="number" min={1} value={draft.independentCables} style={{ width: 70 }} onChange={(e) => set('independentCables', Math.max(1, Math.floor(Number(e.target.value) || 1)))} /><span className="muted">more than 1 only for spaced cables on a messenger (§9.2.1)</span></Row>
            <Row label="GAP-type conductor"><input type="checkbox" checked={draft.gapType} onChange={(e) => set('gapType', e.target.checked)} /></Row>
            {draft.model === 'nonlinear' && (
              <Row label="Test data temperature" unit={unitLabel(sys, 'temperature')}><UnitInput value={draft.testTemperature} sys={sys} dim="temperature" onChange={(v) => set('testTemperature', v ?? 0)} /></Row>
            )}
            <Row label="Display colour"><input type="color" value={draft.color} onChange={(e) => set('color', e.target.value)} style={{ width: 40, height: 22, padding: 0 }} /></Row>
            <MaterialEditor title="Outer strands (or all strands of a single-material cable)" m={draft.outer} sys={sys} linear={draft.model === 'linear'} onChange={(m) => set('outer', m)} />
            {draft.model === 'linear' ? (
              <Row label="Creep as temperature increase" unit={unitLabel(sys, 'temperature').replace('°', 'Δ°')}>
                <input className="mono" style={{ width: 90, textAlign: 'right' }} value={String(Number((draft.creepTemperatureShift * (sys === 'US' ? 1.8 : 1)).toFixed(4)))}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) set('creepTemperatureShift', v / (sys === 'US' ? 1.8 : 1)); }} />
              </Row>
            ) : (
              <>
                <Row label="Bimetallic (core strands)">
                  <input type="checkbox" checked={draft.core !== null} onChange={(e) => set('core', e.target.checked ? newMaterial() : null)} />
                  <span className="muted">e.g. the steel core of ACSR; leave off for a homogeneous cable</span>
                </Row>
                {draft.core && <MaterialEditor title="Core strands" m={draft.core} sys={sys} linear={false} onChange={(m) => set('core', m)} />}
                {draft.core && (
                  <Row label="Outer strands in compression">
                    <select value={draft.outerCompression.mode} onChange={(e) => set('outerCompression', { ...draft.outerCompression, mode: e.target.value as Cable['outerCompression']['mode'] })}>
                      <option value="criteria">Use the project criteria setting (§7.3.5)</option>
                      <option value="none">Cannot carry compression</option>
                      <option value="limited">Can carry compression up to a limit</option>
                    </select>
                    {draft.outerCompression.mode === 'limited' && (
                      <><UnitInput value={draft.outerCompression.limit} sys={sys} dim="stress" min={0} onChange={(v) => set('outerCompression', { ...draft.outerCompression, limit: v ?? 0 })} /><span className="muted">{unitLabel(sys, 'stress')} (virtual stress)</span></>
                    )}
                  </Row>
                )}
                {!testOpen && <button className="btn small" onClick={() => setTestOpen(true)}>Coefficients from test data…</button>}
                {testOpen && (
                  <TestDataPanel cable={draft} sys={sys} onClose={() => setTestOpen(false)} onApply={(fit, data) => {
                    setDraft((d) => d && ({
                      ...d, core: null, testData: data,
                      outer: { ...d.outer, initial: fit.initial as CableMaterial['initial'], creep: fit.creep as CableMaterial['creep'] },
                    }));
                    setTestOpen(false);
                  }} />
                )}
              </>
            )}
            <div className="muted" style={{ marginTop: 8 }}>
              Strain is in percent, as in the manual's cable model: polynomial coefficients and moduli are stresses per percent of strain, already
              multiplied by the material's share of the total area (Eqs. 9-3 to 9-6). Thermal-rating data (resistance, emissivity, heat capacity) are not
              collected because thermal rating is not implemented.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ================================================================== Structures

function blankStructure(): StructureType {
  return {
    id: newId(), name: 'New structure', description: '', height: 0, embedment: null, attachments: [],
    strength: { method: 'none', validity: '', rows: [], ranges: [] }, autoSpotMinAngle: 0, cost: null, material: [], src: 'user',
  } as unknown as StructureType;
}

const INSULATORS: InsulatorType[] = ['clamp', 'strain', 'suspension', 'post', '2part'];

function AttachmentRow({ a, sys, onChange, onDelete }: { a: Attachment; sys: UnitSystem; onChange: (a: Attachment) => void; onDelete: () => void }) {
  const L = (v: number, k: keyof Attachment) => <UnitInput value={v} sys={sys} dim="length" width={64} decimals={4} onChange={(si) => onChange({ ...a, [k]: si ?? 0 })} />;
  const usesLength = a.insulator === 'strain' || a.insulator === 'suspension' || a.insulator === '2part';
  const setType = (t: InsulatorType) => {
    const next: Attachment = { ...a, insulator: t };
    if (t === 'strain') next.deadEnd = true;
    if (t === 'suspension' || t === '2part') next.deadEnd = false;
    if ((t === 'suspension' || t === '2part') && !next.swing) next.swing = [[-90, 90], [-90, 90], [-90, 90], [-90, 90]];
    if (t !== 'suspension' && t !== '2part') next.swing = null;
    if (t === '2part' && !next.part2) next.part2 = { weight: 0, windArea: 0, length: a.length || 1, x: -a.x, y: a.y, z: a.z, bottomOrRight: true, tensionOnly1: false, tensionOnly2: false };
    if (t !== '2part') next.part2 = null;
    onChange(next);
  };
  return (
    <>
      <tr>
        <td><input type="number" min={1} style={{ width: 44 }} value={a.set} onChange={(e) => onChange({ ...a, set: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></td>
        <td><select value={a.phase} onChange={(e) => onChange({ ...a, phase: Number(e.target.value) })}>{[1, 2, 3].map((p) => <option key={p}>{p}</option>)}</select></td>
        <td><input type="checkbox" checked={a.deadEnd} disabled={a.insulator !== 'clamp' && a.insulator !== 'post'} onChange={(e) => onChange({ ...a, deadEnd: e.target.checked })} /></td>
        <td><input style={{ width: 70 }} value={a.setDescription} onChange={(e) => onChange({ ...a, setDescription: e.target.value })} /></td>
        <td><select value={a.insulator} onChange={(e) => setType(e.target.value as InsulatorType)}>{INSULATORS.map((t) => <option key={t} value={t}>{INSULATOR_LABEL[t]}</option>)}</select></td>
        <td><UnitInput value={a.weight} sys={sys} dim="force" width={60} min={0} decimals={3} onChange={(v) => onChange({ ...a, weight: v ?? 0 })} /></td>
        <td><UnitInput value={a.windArea} sys={sys} dim="area" width={60} min={0} decimals={1} onChange={(v) => onChange({ ...a, windArea: v ?? 0 })} disabled={a.insulator === 'clamp'} /></td>
        <td>{usesLength ? L(a.length, 'length') : <span className="muted">—</span>}</td>
        <td>{L(a.x, 'x')}</td>
        <td>{L(a.y, 'y')}</td>
        <td>{L(a.z, 'z')}</td>
        <td>
          <select value={a.minVertical.kind} onChange={(e) => onChange({ ...a, minVertical: { ...a.minVertical, kind: e.target.value as Attachment['minVertical']['kind'] } })}>
            <option value="noLimit">No limit</option><option value="noUplift">No uplift</option><option value="value">Value</option>
          </select>
          {a.minVertical.kind === 'value' && <UnitInput value={a.minVertical.value} sys={sys} dim="force" width={60} decimals={3} onChange={(v) => onChange({ ...a, minVertical: { kind: 'value', value: v ?? 0 } })} />}
        </td>
        <td><button className="btn small" onClick={onDelete} title="Remove this attachment">×</button></td>
      </tr>
      {(a.swing || a.part2) && (
        <tr>
          <td colSpan={13} style={{ background: '#f6f8fa', paddingLeft: 30 }}>
            {a.swing && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="muted">{a.insulator === '2part' ? 'Allowable load angle' : 'Allowable swing'} min / max (°) for swing conditions 1–4:</span>
                {a.swing.map(([mn, mx], i) => (
                  <span key={i} className="mono">
                    {i + 1}:
                    <input style={{ width: 42 }} value={mn} onChange={(e) => { const s = a.swing!.map((r) => [...r] as [number, number]); s[i]![0] = Number(e.target.value) || 0; onChange({ ...a, swing: s }); }} />
                    <input style={{ width: 42 }} value={mx} onChange={(e) => { const s = a.swing!.map((r) => [...r] as [number, number]); s[i]![1] = Number(e.target.value) || 0; onChange({ ...a, swing: s }); }} />
                  </span>
                ))}
              </div>
            )}
            {a.part2 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                <span className="muted">Side 2 ({unitLabel(sys, 'length')}):</span>
                weight <UnitInput value={a.part2.weight} sys={sys} dim="force" width={60} min={0} decimals={3} onChange={(v) => onChange({ ...a, part2: { ...a.part2!, weight: v ?? 0 } })} />
                length <UnitInput value={a.part2.length} sys={sys} dim="length" width={60} min={0} decimals={4} onChange={(v) => onChange({ ...a, part2: { ...a.part2!, length: v ?? 0 } })} />
                x <UnitInput value={a.part2.x} sys={sys} dim="length" width={60} decimals={4} onChange={(v) => onChange({ ...a, part2: { ...a.part2!, x: v ?? 0 } })} />
                y <UnitInput value={a.part2.y} sys={sys} dim="length" width={60} decimals={4} onChange={(v) => onChange({ ...a, part2: { ...a.part2!, y: v ?? 0 } })} />
                z <UnitInput value={a.part2.z} sys={sys} dim="length" width={60} decimals={4} onChange={(v) => onChange({ ...a, part2: { ...a.part2!, z: v ?? 0 } })} />
                <label><input type="checkbox" checked={a.part2.bottomOrRight} onChange={(e) => onChange({ ...a, part2: { ...a.part2!, bottomOrRight: e.target.checked } })} /> bottom / right solution</label>
                <label><input type="checkbox" checked={a.part2.tensionOnly1} onChange={(e) => onChange({ ...a, part2: { ...a.part2!, tensionOnly1: e.target.checked } })} /> side 1 tension only</label>
                <label><input type="checkbox" checked={a.part2.tensionOnly2} onChange={(e) => onChange({ ...a, part2: { ...a.part2!, tensionOnly2: e.target.checked } })} /> side 2 tension only</label>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Method 2 data (App. F.1.4.2): angle ranges, each with one interaction diagram per criteria interaction condition. */
function Method2Editor({ strength, sys, conditions, onChange }: { strength: StructureType['strength']; sys: UnitSystem; conditions: number; onChange: (s: StructureType['strength']) => void }) {
  const lu = unitLabel(sys, 'length');
  const ranges = strength.ranges;
  const setRange = (i: number, r: (typeof ranges)[number]) => onChange({ ...strength, ranges: ranges.map((x, j) => (j === i ? r : x)) });
  const show = (d: [number, number][]) => d.map(([h, v]) => `${Number(fromSI(h, sys, 'length').toFixed(3))} ${Number(fromSI(v, sys, 'length').toFixed(3))}`).join('\n');
  const parse = (s: string): [number, number][] | null => {
    const rows = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[\s,;]+/).map(Number));
    if (rows.some((r) => r.length !== 2 || r.some((x) => !Number.isFinite(x)))) return null;
    return rows.map(([h, v]) => [toSI(h!, sys, 'length'), toSI(v!, sys, 'length')]);
  };
  return (
    <>
      <Row label="Limits of validity"><textarea style={{ width: 420, height: 46 }} value={strength.validity} onChange={(e) => onChange({ ...strength, validity: e.target.value })} /></Row>
      {conditions === 0 && <div style={{ color: 'var(--err)', margin: '6px 0' }}>Define the interaction diagram conditions in Criteria ▸ Spans, swing, Method 2 first: diagram n belongs to condition n.</div>}
      {ranges.map((r, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', padding: 6, margin: '6px 0' }}>
          <Row label="Maximum line angle (°)">
            <input style={{ width: 60 }} value={r.maxAngle} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 180) setRange(i, { ...r, maxAngle: v }); }} />
            <button className="btn small" onClick={() => onChange({ ...strength, ranges: ranges.filter((_, j) => j !== i) })}>Remove range</button>
          </Row>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Array.from({ length: Math.max(conditions, r.diagrams.length) }, (_, j) => (
              <label key={j} style={{ display: 'flex', flexDirection: 'column', fontSize: 11 }}>
                Condition {j + 1}: wind span, weight span ({lu}), one point per line
                <textarea className="mono" style={{ width: 200, height: 90 }} defaultValue={show(r.diagrams[j] ?? [])}
                  onBlur={(e) => { const d = parse(e.target.value); if (!d) { e.target.style.borderColor = 'var(--err)'; return; } e.target.style.borderColor = ''; const ds = [...r.diagrams]; while (ds.length <= j) ds.push([]); ds[j] = d; setRange(i, { ...r, diagrams: ds }); }} />
              </label>
            ))}
          </div>
        </div>
      ))}
      <button className="btn small" onClick={() => onChange({ ...strength, ranges: [...ranges, { maxAngle: (ranges[ranges.length - 1]?.maxAngle ?? -1) + 1, diagrams: [] }] })}>Add angle range</button>
      <div className="muted" style={{ marginTop: 6 }}>
        Each diagram is the closed polygon through its points in order (the last joined to the first). A structure passes a condition when its wind and weight spans
        fall inside; usage is the distance to the point over the distance to the diagram edge along the same ray from the origin. The range used is the first whose
        maximum angle is not less than the line angle.
      </div>
    </>
  );
}

export function StructureLibraryDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const sys = project.settings.unitSystem;
  const lu = unitLabel(sys, 'length');
  const lib = project.structureLibrary;
  const [selId, setSelId] = useState<string | null>(lib[0]?.id ?? null);
  const [draft, setDraft] = useState<StructureType | null>(lib[0] ? structuredClone(lib[0]) : null);
  const [tab, setTab] = useState<'geometry' | 'strength' | 'family'>('geometry');
  const [famText, setFamText] = useState(sys === 'US' ? '10 20 30' : '3 6 9');
  const saved = lib.find((t) => t.id === draft?.id);
  const dirty = !!draft && JSON.stringify(saved) !== JSON.stringify(draft);
  const choose = (id: string) => { const t = lib.find((k) => k.id === id); setSelId(id); setDraft(t ? structuredClone(t) : null); };
  const set = <K extends keyof StructureType>(k: K, v: StructureType[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const errors = draft ? [...(draft.name.trim() ? [] : ['Name is required.']), ...(draft.height > 0 ? [] : ['Enter the structure height.']), ...checkStructureType(draft)] : [];
  const setAtt = (i: number, a: Attachment) => setDraft((d) => d && { ...d, attachments: d.attachments.map((k, j) => (j === i ? a : k)) });
  const rows = draft?.strength.rows ?? [];
  const setRow = (i: number, r: (typeof rows)[number]) => setDraft((d) => d && { ...d, strength: { ...d.strength, rows: d.strength.rows.map((k, j) => (j === i ? r : k)) } });
  const famIncs = famText.split(/[\s,;]+/).filter((t) => t !== '').map(Number);
  const famOk = famIncs.length > 0 && famIncs.every((v) => Number.isFinite(v) && v !== 0);

  return (
    <Modal
      title="Structure Library" onClose={close} width={1180}
      footer={<>
        <button className="btn" onClick={() => pickFile('.json', (f) => { void importLibrary(f); })}>Import library…</button>
        <button className="btn" onClick={exportLibrary} disabled={!lib.length && !project.cableLibrary.length}>Export library</button>
        <div style={{ flex: 1 }} />
        {errors.length > 0 && dirty && <span style={{ color: 'var(--err)', maxWidth: 420 }}>{errors[0]}{errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}</span>}
        <button className="btn" onClick={close}>Close</button>
        <button className="btn primary" disabled={!draft || !dirty || errors.length > 0} onClick={() => { if (draft && saveStructureType({ ...draft, name: draft.name.trim() })) setSelId(draft.id); }}>Save structure</button>
      </>}
    >
      <div style={{ display: 'flex', gap: 14 }}>
        <ListPane items={[...lib, ...(draft && !saved ? [draft] : [])]} sel={selId} onSel={choose}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button className="btn small" onClick={() => { const t = blankStructure(); setSelId(t.id); setDraft(t); setTab('geometry'); }}>New</button>
            <button className="btn small" disabled={!saved} onClick={() => { if (saved) { const t = { ...structuredClone(saved), id: newId(), name: `${saved.name} copy`, src: 'user' as const }; setSelId(t.id); setDraft(t); } }}>Duplicate</button>
            <button className="btn small" disabled={!saved} onClick={() => { if (saved) deleteStructureType(saved.id); }}>Delete</button>
          </div>
        </ListPane>
        {!draft ? <div className="muted" style={{ padding: 20 }}>No structure types yet. Choose New and enter the top geometry from the structure drawings (manual App. F.1).</div> : (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0, maxHeight: '66vh', overflow: 'auto' }}>
              <Row label="Name (file name)"><input value={draft.name} onChange={(e) => set('name', e.target.value)} style={{ width: 160 }} /></Row>
              <Row label="Description"><input value={draft.description} onChange={(e) => set('description', e.target.value)} style={{ width: 320 }} /></Row>
              <Row label="Height, ground to top HT" unit={lu}><UnitInput value={draft.height} sys={sys} dim="length" min={0} onChange={(v) => set('height', v ?? 0)} /></Row>
              <Row label="Embedment length" unit={lu}><UnitInput value={draft.embedment} sys={sys} dim="length" min={0} nullable onChange={(v) => set('embedment', v)} /><span className="muted">reporting only</span></Row>
              <div className="chips" style={{ marginTop: 8 }}>
                {(['geometry', 'strength', 'family'] as const).map((k) => (
                  <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
                    {k === 'geometry' ? `Top geometry (${draft.attachments.length})` : k === 'strength' ? 'Strength (Method 1 / 2)' : 'Family of heights'}
                  </button>
                ))}
              </div>
              {tab === 'geometry' && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="grid">
                      <thead>
                        <tr>
                          <th>Set</th><th>Ph</th><th title="Dead end set: end of a tension section">DE</th><th>Set desc.</th><th>Insulator</th>
                          <th>Weight ({unitLabel(sys, 'force')})</th><th>Wind area ({unitLabel(sys, 'area')})</th><th>Length ({lu})</th>
                          <th title="Transverse offset x">x ({lu})</th><th title="Distance below top y">y below top ({lu})</th><th title="Longitudinal offset z">z ({lu})</th>
                          <th>Min. vertical load</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {draft.attachments.map((a, i) => (
                          <AttachmentRow key={i} a={a} sys={sys} onChange={(n) => setAtt(i, n)} onDelete={() => set('attachments', draft.attachments.filter((_, j) => j !== i))} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="btn small" style={{ marginTop: 6 }} onClick={() => {
                    const last = draft.attachments[draft.attachments.length - 1];
                    const set_ = last ? (last.phase < 3 && draft.attachments.filter((k) => k.set === last.set).length < 3 ? last.set : last.set + 1) : 1;
                    const phase = draft.attachments.filter((k) => k.set === set_).length + 1;
                    set('attachments', [...draft.attachments, { ...(last && last.set === set_ ? { ...structuredClone(last), phase } : newAttachment(set_, phase)) }]);
                  }}>Add attachment</button>
                  <div className="muted" style={{ marginTop: 6 }}>
                    x: transverse offset from the structure axis (positive toward positive line offsets); y: distance below the top; z: longitudinal offset.
                    For posts, x/y/z locate the insulator tip; for clamps, the clamp; otherwise the point where the insulator hangs from the structure.
                    Strain insulators are always dead ends and suspension / 2-part insulators never are; for clamps and posts it is your choice (§8.2.3).
                  </div>
                  {errors.length > 0 && <ul style={{ color: 'var(--err)', margin: '6px 0' }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                </>
              )}
              {tab === 'strength' && (
                <>
                  <Row label="Strength method">
                    <select value={draft.strength.method} onChange={(e) => set('strength', { ...draft.strength, method: e.target.value as StructureType['strength']['method'] })}>
                      <option value="none">None (no strength check)</option>
                      <option value="method1">Method 1 — allowable wind and weight spans</option>
                      <option value="method2">Method 2 — wind and weight span interaction diagrams</option>
                    </select>
                    <span className="muted">Methods 3 and 4 need external structural analysis (TOWER / PLS-POLE).</span>
                  </Row>
                  {draft.strength.method === 'method2' && <Method2Editor strength={draft.strength} sys={sys} conditions={project.criteria.interactionConditions.length} onChange={(s) => set('strength', s)} />}
                  {draft.strength.method === 'method1' && (
                    <>
                      <Row label="Limits of validity"><textarea style={{ width: 420, height: 46 }} value={draft.strength.validity} onChange={(e) => set('strength', { ...draft.strength, validity: e.target.value })} placeholder="e.g. criteria, conductor and tension these allowable spans were derived for" /></Row>
                      <table className="grid" style={{ marginTop: 6 }}>
                        <thead><tr><th>Line angle (°)</th><th>Max wind span ({lu})</th><th>Max weight span 1</th><th>Max weight span 2</th><th>Max weight span 3</th><th>Min weight span</th><th /></tr></thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i}>
                              <td><input style={{ width: 60 }} value={r.lineAngle} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 180) setRow(i, { ...r, lineAngle: v }); }} /></td>
                              <td><UnitInput value={r.maxWindSpan} sys={sys} dim="length" width={70} min={0} decimals={3} onChange={(v) => setRow(i, { ...r, maxWindSpan: v ?? 0 })} /></td>
                              {[0, 1, 2].map((k) => (
                                <td key={k}><UnitInput value={r.maxWeightSpan[k]!} sys={sys} dim="length" width={70} decimals={3} onChange={(v) => { const w = [...r.maxWeightSpan] as [number, number, number]; w[k] = v ?? 0; setRow(i, { ...r, maxWeightSpan: w }); }} /></td>
                              ))}
                              <td><UnitInput value={r.minWeightSpan} sys={sys} dim="length" width={70} decimals={3} onChange={(v) => setRow(i, { ...r, minWeightSpan: v ?? 0 })} /></td>
                              <td><button className="btn small" onClick={() => set('strength', { ...draft.strength, rows: rows.filter((_, j) => j !== i) })}>×</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button className="btn small" style={{ marginTop: 6 }} onClick={() => {
                        const last = rows[rows.length - 1];
                        set('strength', { ...draft.strength, rows: [...rows, last ? { ...structuredClone(last), lineAngle: Math.min(180, last.lineAngle + 1) } : { lineAngle: 0, maxWindSpan: 0, maxWeightSpan: [0, 0, 0], minWeightSpan: 0 }] });
                      }}>Add line angle</button>
                      <div className="muted" style={{ marginTop: 6 }}>
                        Weight spans 1–3 correspond to the three weight-span conditions of the criteria (§7.3.10). Values between line angles are interpolated
                        linearly; the largest angle in the table is the largest line angle the structure may be used at (App. F.1.4.1). A negative minimum
                        weight span permits uplift. The check is shown in Sag-Tension ▸ Structure checks.
                      </div>
                    </>
                  )}
                  <Row label="Auto-spot minimum angle" unit="°"><input style={{ width: 70 }} value={draft.autoSpotMinAngle} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) set('autoSpotMinAngle', v); }} /></Row>
                  <Row label="Cost for optimization"><input style={{ width: 100 }} value={draft.cost ?? ''} placeholder="blank = not given" onChange={(e) => { const t = e.target.value.trim(); const v = Number(t); set('cost', t === '' ? null : Number.isFinite(v) && v >= 0 ? v : draft.cost); }} /><span className="muted">used by optimum spotting (Phase 5)</span></Row>
                </>
              )}
              {tab === 'family' && (
                <>
                  <p className="muted" style={{ marginTop: 4 }}>
                    Creates copies of the saved structure with the same top geometry and strength data and a greater (or smaller) height, named
                    {' '}<b>{(saved?.name ?? draft.name).replace(/\+\d+(\.\d+)?$/, '')}+n</b> — as in the WAPCOS step-by-step guide (+3, +6, +9 m) and the manual's Multiple Save (App. F.1.6).
                  </p>
                  <Row label="Height increments" unit={lu}><input value={famText} onChange={(e) => setFamText(e.target.value)} style={{ width: 200 }} /></Row>
                  <button className="btn small primary" disabled={!saved || dirty || !famOk} title={dirty ? 'Save the structure first' : ''}
                    onClick={() => createFamily(saved!.id, famIncs.map((v) => ({ label: String(v), deltaHeight: toSI(v, sys, 'length') })))}>Create family</button>
                  {dirty && <span className="muted" style={{ marginLeft: 8 }}>Save the structure first.</span>}
                </>
              )}
            </div>
            <div style={{ width: 300, flex: 'none' }}>
              {draft.height > 0 ? <StructureSketch t={draft} sys={sys} height={420} /> : <div className="muted">Enter the height to see the structure.</div>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
