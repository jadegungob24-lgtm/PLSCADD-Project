import { useMemo, useState } from 'react';
import { checkStringing, formatDMS, formatQuantity, fromSI, toSI, transpositions, unitLabel } from '@tlcad/engine';
import { structureSets } from '@tlcad/model';
import { useApp } from '../store/appStore';
import { stationText, useDerived } from '../store/derived';
import {
  activeAlignmentId, addSection, addStructure, deleteStructures, editStructure, setUsage, spotAtFeatureCode, spotAtPis, spotEqual,
} from '../commands/line';
import { Modal } from './Dialogs';

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** Structure spotting: single structure, equal spacing (N-paste), angle structures at P.I.s, at a feature code (§10.2). */
export function SpotDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const setSpotType = useApp((s) => s.setSpotType);
  const setTool = useApp((s) => s.setTool);
  const showView = useApp((s) => s.showView);
  const openDialog = useApp((s) => s.openDialog);
  const d = useDerived();
  const sys = project.settings.unitSystem;
  const lu = unitLabel(sys, 'length');
  const types = project.structureLibrary;
  const lines = d.lines.filter((l) => l.geom);
  const [mode, setMode] = useState<'single' | 'equal' | 'pis' | 'code'>('single');
  const [typeId, setTypeId] = useState(useApp.getState().spotTypeId ?? types[0]?.id ?? '');
  const [alId, setAlId] = useState(activeAlignmentId() ?? lines[0]?.alignment.id ?? '');
  const line = lines.find((l) => l.alignment.id === alId);
  const g = line?.geom;
  const show = (v: number) => String(Number(fromSI(v, sys, 'length').toFixed(3)));
  const [sta, setSta] = useState(g ? show(g.startStation) : '0');
  const [off, setOff] = useState('0');
  const [hadj, setHadj] = useState('0');
  const [orient, setOrient] = useState('0');
  const [from, setFrom] = useState(g ? show(g.startStation) : '0');
  const [to, setTo] = useState(g ? show(g.startStation + g.totalLength) : '0');
  const [spans, setSpans] = useState('4');
  const [code, setCode] = useState<number | ''>(project.terrain.featureCodes[0]?.code ?? '');
  const [useOffset, setUseOffset] = useState(false);

  if (types.length === 0 || lines.length === 0) {
    return (
      <Modal title="Spot Structures" onClose={close} width={520} footer={<button className="btn" onClick={close}>Close</button>}>
        {types.length === 0 && <p>The structure library is empty. Define at least one structure type first.<br /><button className="link-btn" onClick={() => openDialog('structureTypes')}>Open the structure library</button></p>}
        {lines.length === 0 && <p>Structures are spotted on an alignment. Define an alignment with at least two P.I.s first (Terrain ▸ Alignment).</p>}
      </Modal>
    );
  }
  const si = (s: string) => toSI(num(s), sys, 'length');
  const inRange = (v: number) => g && v >= g.startStation - 1e-6 && v <= g.startStation + g.totalLength + 1e-6;
  let error: string | null = null;
  if (!typeId) error = 'Choose a structure type.';
  else if (mode === 'single') {
    if ([sta, off, hadj, orient].some((s) => !Number.isFinite(num(s)))) error = 'Enter numbers in every field.';
    else if (!inRange(si(sta))) error = 'The station must lie on the alignment.';
  } else if (mode === 'equal') {
    const n = num(spans);
    if (![from, to].every((s) => Number.isFinite(num(s))) || !Number.isInteger(n) || n < 1) error = 'Enter both stations and a whole number of spans.';
    else if (!inRange(si(from)) || !inRange(si(to))) error = 'Both stations must lie on the alignment.';
    else if (si(to) <= si(from)) error = 'The end station must be after the start station.';
  } else if (mode === 'code' && code === '') error = 'Choose a feature code.';

  const run = () => {
    if (error) return;
    if (mode === 'single') {
      const id = addStructure(typeId, alId, si(sta), si(off), { heightAdjust: si(hadj), orientation: num(orient) });
      if (id) useApp.getState().select({ kind: 'structure', id });
    } else if (mode === 'equal') spotEqual(typeId, alId, si(from), si(to), num(spans));
    else if (mode === 'pis') spotAtPis(typeId, alId);
    else if (code !== '') spotAtFeatureCode(typeId, alId, code, useOffset);
    setSpotType(typeId);
    close();
  };

  // A plain function, not a component: a component defined here would remount (and lose focus) on every keystroke.
  const F = ({ label, v, set }: { label: string; v: string; set: (s: string) => void }) => (
    <div className="field" key={label}><label>{label}</label><input value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" /></div>
  );

  return (
    <Modal
      title="Spot Structures" onClose={close} width={560}
      footer={<>
        {error && <span style={{ color: 'var(--err)', marginRight: 'auto' }}>{error}</span>}
        <button className="btn" onClick={() => { setSpotType(typeId); setTool('addStructure'); showView('profile'); close(); }} disabled={!typeId}
          title="Click in the Profile view to add this structure type">Add by clicking in profile</button>
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!!error} onClick={run}>Spot</button>
      </>}
    >
      <div className="chips">
        {([['single', 'One structure'], ['equal', 'Equal spacing (N-paste)'], ['pis', 'At line angles'], ['code', 'At feature code']] as const).map(([k, l]) => (
          <button key={k} className={`chip ${mode === k ? 'on' : ''}`} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
      <div className="field">
        <label>Structure type</label>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>)}</select>
      </div>
      <div className="field">
        <label>Alignment</label>
        <select value={alId} onChange={(e) => setAlId(e.target.value)}>
          {lines.map((l) => <option key={l.alignment.id} value={l.alignment.id}>{l.alignment.name} ({stationText(project, l.geom!.startStation)} to {stationText(project, l.geom!.startStation + l.geom!.totalLength)})</option>)}
        </select>
      </div>
      {mode === 'single' && (
        <>
          {F({ label: `Station (${lu})`, v: sta, set: setSta })}
          {F({ label: `Offset (${lu})`, v: off, set: setOff })}
          {F({ label: `Height adjustment (${lu})`, v: hadj, set: setHadj })}
          {F({ label: "Orientation (°)", v: orient, set: setOrient })}
          <div className="muted">Stations are true stations. A structure within 1 cm of a P.I. stands on the line angle and is oriented to its bisector.</div>
        </>
      )}
      {mode === 'equal' && (
        <>
          {F({ label: `From station (${lu})`, v: from, set: setFrom })}
          {F({ label: `To station (${lu})`, v: to, set: setTo })}
          {F({ label: "Number of spans", v: spans, set: setSpans })}
          <div className="muted">Spots structures at both stations and at equal spacing between them.</div>
        </>
      )}
      {mode === 'pis' && (
        <div className="muted">
          Spots this structure at every P.I. of the alignment, including both ends, skipping P.I.s that already have a structure (Angle Structures, §10.2.1.2).
          Then change each structure to the type suited to its line angle in the Structure Table.
        </div>
      )}
      {mode === 'code' && (
        <>
          <div className="field">
            <label>Feature code</label>
            <select value={code} onChange={(e) => setCode(Number(e.target.value))}>{project.terrain.featureCodes.map((f) => <option key={f.code} value={f.code}>{f.code} {f.description}</option>)}</select>
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={useOffset} onChange={(e) => setUseOffset(e.target.checked)} /> Use the point's offset from the centerline (otherwise on the centerline)</label>
          <div className="muted" style={{ marginTop: 6 }}>Spots a structure at the station of every point with this code (§10.2.1.1). The point description is copied to the structure comment.</div>
        </>
      )}
    </Modal>
  );
}

/** Structure table: every spotted structure with its placement and calculated position (staking table basis, §12.2.1). */
export function StructureTableDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const select = useApp((s) => s.select);
  const d = useDerived();
  const sys = project.settings.unitSystem;
  const lu = unitLabel(sys, 'length');
  const len = (v: number | null) => (v === null ? '—' : formatQuantity(v, sys, 'length', 2, false));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const input = (id: string, value: number, label: string, apply: (si: number) => object, valid: (si: number) => boolean = () => true) => (
    <input
      key={`${id}${value}${sys}`} className="mono" style={{ width: 80, textAlign: 'right' }} defaultValue={Number(fromSI(value, sys, 'length').toFixed(3))}
      onBlur={(e) => {
        const v = num(e.target.value);
        const s = toSI(v, sys, 'length');
        if (!Number.isFinite(v) || !valid(s)) { e.target.value = String(Number(fromSI(value, sys, 'length').toFixed(3))); return; }
        if (Math.abs(s - value) > 1e-9) editStructure(id, label, apply(s));
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
    />
  );
  return (
    <Modal
      title="Structure Table" onClose={close} width={1180}
      footer={<>
        <button className="btn" disabled={sel.size === 0} onClick={() => { void deleteStructures([...sel]).then(() => setSel(new Set())); }}>Remove selected ({sel.size})</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={close}>Close</button>
      </>}
    >
      {d.model.structures.length === 0 ? <div className="muted">No structures are spotted yet.</div> : (
        <div className="scroll" style={{ maxHeight: '62vh' }}>
          <table className="grid">
            <thead>
              <tr>
                <th /><th>#</th><th>Label</th><th>Type</th><th>Alignment</th><th>Station ({lu})</th><th>Offset ({lu})</th><th>Height adj. ({lu})</th>
                <th>Orient. (°)</th><th>Line angle</th><th>Ground ({lu})</th><th>Top ({lu})</th><th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {d.model.structures.map((x) => {
                const g = d.lines[x.line]?.geom ?? null;
                return (
                  <tr key={x.s.id} className={sel.has(x.s.id) ? 'rowsel' : ''}>
                    <td><input type="checkbox" checked={sel.has(x.s.id)} onChange={() => { const n = new Set(sel); if (n.has(x.s.id)) n.delete(x.s.id); else n.add(x.s.id); setSel(n); }} /></td>
                    <td className="mono"><button className="link-btn" onClick={() => { select({ kind: 'structure', id: x.s.id }); close(); }}>{x.number}</button></td>
                    <td><input key={`${x.s.id}l${x.s.label}`} style={{ width: 70 }} defaultValue={x.s.label} onBlur={(e) => { if (e.target.value !== x.s.label) editStructure(x.s.id, 'Edit structure label', { label: e.target.value }); }} /></td>
                    <td>
                      <select value={x.s.typeId} onChange={(e) => editStructure(x.s.id, 'Change structure type', { typeId: e.target.value })}>
                        {!x.type && <option value={x.s.typeId}>— missing —</option>}
                        {project.structureLibrary.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                    <td>{d.lines[x.line]?.alignment.name ?? '—'}</td>
                    <td>{g ? input(x.s.id, g.startStation + x.s.station, 'Change structure station', (s) => ({ station: s - g.startStation }), (s) => s - g.startStation >= -1e-6 && s - g.startStation <= g.totalLength + 1e-6) : '—'}</td>
                    <td>{input(x.s.id, x.s.offset, 'Change structure offset', (s) => ({ offset: s }))}</td>
                    <td>{input(x.s.id, x.s.heightAdjust, 'Change height adjustment', (s) => ({ heightAdjust: s }))}</td>
                    <td>
                      <input key={`${x.s.id}o${x.s.orientation}`} className="mono" style={{ width: 54, textAlign: 'right' }} defaultValue={x.s.orientation}
                        onBlur={(e) => { const v = num(e.target.value); if (Number.isFinite(v) && v !== x.s.orientation) editStructure(x.s.id, 'Change structure orientation', { orientation: v }); else e.target.value = String(x.s.orientation); }} />
                    </td>
                    <td className="mono">{x.frame?.piIndex != null ? formatDMS(x.frame.lineAngle) : x.frame ? '0' : '—'}</td>
                    <td className="mono">{len(x.ground)}</td>
                    <td className="mono">{len(x.topZ)}</td>
                    <td style={{ color: 'var(--err)', maxWidth: 220 }}>{x.problems.join(' ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ marginTop: 6 }}>
        Station, offset, height adjustment and orientation are your inputs; line angle, ground and top elevations are calculated. Structure numbers follow the order of the profile.
      </div>
    </Modal>
  );
}

interface RowChoice { set: number | null; transposition: string }

/** String a tension section: start at a dead-end set, attach or bypass each following structure, end at the next dead end (§10.3.1). */
export function StringingDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const select = useApp((s) => s.select);
  const openDialog = useApp((s) => s.openDialog);
  const d = useDerived();
  const usage = useMemo(() => setUsage(project), [project]);
  const all = d.model.structures.filter((x) => x.type && x.topZ !== null);
  const [cableId, setCableId] = useState(project.cableLibrary[0]?.id ?? '');
  const [kv, setKv] = useState(String(project.meta.nominalVoltageKV?.v ?? ''));
  const [cpp, setCpp] = useState('1');
  // Start: a structure with a dead-end set not yet used as a section start.
  const starts = all.flatMap((x) => structureSets(x.type!).filter((s) => s.deadEnd && !usage.isUsed(x.s.id, s.number, 'start')).map((s) => ({ x, s })));
  const [startKey, setStartKey] = useState(starts[0] ? `${starts[0].x.s.id}:${starts[0].s.number}` : '');
  const start = starts.find((k) => `${k.x.s.id}:${k.s.number}` === startKey);
  const n = start?.s.phaseCount ?? 0;
  const following = start ? all.filter((x) => x.number > start.x.number) : [];

  // Default choice per structure: an unused compatible suspension set, else an unused compatible dead-end set (which ends the section), else bypass.
  const defaults = useMemo(() => {
    const m: Record<string, RowChoice> = {};
    for (const x of following) {
      const sets = structureSets(x.type!).filter((s) => s.phaseCount === n);
      const mid = sets.find((s) => !s.deadEnd && !usage.isUsed(x.s.id, s.number, 'middle'));
      const end = sets.find((s) => s.deadEnd && !usage.isUsed(x.s.id, s.number, 'end'));
      m[x.s.id] = { set: mid?.number ?? end?.number ?? null, transposition: transpositions(n)[0] ?? '1' };
    }
    return m;
  }, [startKey, project]); // eslint-disable-line react-hooks/exhaustive-deps
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const choice = (id: string) => choices[id] ?? defaults[id] ?? { set: null, transposition: '1' };

  // The section ends at the first structure where a dead-end set is chosen.
  const rows: { x: (typeof all)[number]; c: RowChoice; inSection: boolean; isEnd: boolean }[] = [];
  let ended = false;
  for (const x of following) {
    const c = choice(x.s.id);
    const set = c.set !== null ? structureSets(x.type!).find((s) => s.number === c.set) : undefined;
    const isEnd = !ended && !!set?.deadEnd;
    rows.push({ x, c, inSection: !ended, isEnd });
    if (isEnd) ended = true;
  }
  const inRows = rows.filter((r) => r.inSection);
  const startTrans = transpositions(n)[0] ?? '1';
  const steps = start ? [
    { structureNumber: start.x.number, set: { number: start.s.number, deadEnd: true, phaseCount: n }, transposition: startTrans },
    ...inRows.map((r) => {
      const s = r.c.set !== null ? structureSets(r.x.type!).find((k) => k.number === r.c.set) : undefined;
      return { structureNumber: r.x.number, set: s ? { number: s.number, deadEnd: s.deadEnd, phaseCount: s.phaseCount } : null, transposition: r.c.transposition };
    }),
  ] : [];
  const errors = start ? checkStringing(steps) : [];
  const kvN = num(kv), cppN = num(cpp);
  if (!cableId) errors.unshift('Choose a cable.');
  if (!(kvN > 0)) errors.unshift('Enter the circuit voltage.');
  if (!Number.isInteger(cppN) || cppN < 1) errors.unshift('Conductors per phase must be a whole number of at least 1.');
  for (const r of inRows) {
    if (r.c.set !== null && usage.isUsed(r.x.s.id, r.c.set, r.isEnd ? 'end' : 'middle')) errors.push(`Structure ${r.x.number}: set ${r.c.set} is already strung.`);
  }

  if (project.cableLibrary.length === 0 || starts.length === 0) {
    return (
      <Modal title="String Section" onClose={close} width={520} footer={<button className="btn" onClick={close}>Close</button>}>
        {project.cableLibrary.length === 0 && <p>The cable library is empty. <button className="link-btn" onClick={() => openDialog('cables')}>Add a cable</button> first.</p>}
        {starts.length === 0 && <p>A section starts at a dead-end set of a spotted structure that has a ground elevation. No such free dead-end set exists yet: spot dead-end structures first.</p>}
      </Modal>
    );
  }

  return (
    <Modal
      title="String Section" onClose={close} width={780}
      footer={<>
        {errors.length > 0 && <span style={{ color: 'var(--err)', marginRight: 'auto', maxWidth: 420 }}>{errors[0]}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={errors.length > 0} onClick={() => {
          const id = addSection({
            cableId, voltageKV: kvN, conductorsPerPhase: cppN,
            steps: [{ structureId: start!.x.s.id, set: start!.s.number, transposition: startTrans }, ...inRows.map((r) => ({ structureId: r.x.s.id, set: r.c.set, transposition: r.c.set === null ? '' : r.c.transposition }))],
          });
          select({ kind: 'section', id });
          close();
        }}>String</button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
        <div className="field"><label>Cable</label><select value={cableId} onChange={(e) => setCableId(e.target.value)}>{project.cableLibrary.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>Voltage (kV)</label><input value={kv} onChange={(e) => setKv(e.target.value)} inputMode="decimal" /></div>
        <div className="field"><label>Conductors per phase</label><input value={cpp} onChange={(e) => setCpp(e.target.value)} inputMode="numeric" /></div>
        <div className="field">
          <label>Start at</label>
          <select value={startKey} onChange={(e) => { setStartKey(e.target.value); setChoices({}); }}>
            {starts.map((k) => <option key={`${k.x.s.id}:${k.s.number}`} value={`${k.x.s.id}:${k.s.number}`}>Structure {k.x.number} ({k.x.type!.name}) set {k.s.number}{k.s.description ? ` ${k.s.description}` : ''}, {k.s.phaseCount} phase(s)</option>)}
          </select>
        </div>
      </div>
      <div className="scroll" style={{ maxHeight: '44vh', marginTop: 6 }}>
        <table className="grid">
          <thead><tr><th>Structure</th><th>Type</th><th>Attach to set</th><th>Phase order</th><th /></tr></thead>
          <tbody>
            {rows.map(({ x, c, inSection, isEnd }) => {
              const sets = structureSets(x.type!).filter((s) => s.phaseCount === n);
              return (
                <tr key={x.s.id} style={inSection ? undefined : { opacity: 0.4 }}>
                  <td className="mono">{x.number}</td>
                  <td>{x.type!.name}</td>
                  <td>
                    <select value={c.set ?? ''} disabled={!inSection} onChange={(e) => setChoices({ ...choices, [x.s.id]: { ...c, set: e.target.value === '' ? null : Number(e.target.value) } })}>
                      <option value="">Bypass</option>
                      {sets.map((s) => <option key={s.number} value={s.number}>Set {s.number}{s.description ? ` ${s.description}` : ''}{s.deadEnd ? ' — dead end' : ''}</option>)}
                    </select>
                  </td>
                  <td>
                    {c.set !== null && n > 1 && (
                      <select value={c.transposition} disabled={!inSection} onChange={(e) => setChoices({ ...choices, [x.s.id]: { ...c, transposition: e.target.value } })}>
                        {transpositions(n).map((t) => <option key={t}>{t}</option>)}
                      </select>
                    )}
                  </td>
                  <td>{isEnd ? <b>section ends here</b> : inSection ? '' : 'not in section'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        Stringing runs toward higher structure numbers. Choose Bypass to pass over a structure (e.g. a lower circuit's structure). The section ends at the first
        dead-end set chosen. Phase order 321 connects wire phase 1 to attachment 3, wire 2 to 2 and wire 3 to 1. A new section is not sagged: give it a sagging tension in its properties.
      </div>
    </Modal>
  );
}
