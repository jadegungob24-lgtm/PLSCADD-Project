import { useMemo, useState } from 'react';
import {
  fromSI, makeTransformer, toSI, unitLabel, utmDefinition, validateCrsDefinition, WGS84_GEOGRAPHIC, FT, type Transformer,
} from '@tlcad/engine';
import { makeFeatureCode, newId, type FeatureCode, type Project, type TerrainPoint } from '@tlcad/model';
import { demPointCount, guessColumns, sniffDelimited, splitDelimited, type Delimiter, type DelimitedOptions } from '@tlcad/io';
import { useApp } from '../store/appStore';
import {
  beginPastedImport, createInterpolatedPoints, finishCsvImport, finishDemImport, finishLasImport, finishPflImport, MAX_IMPORT_POINTS, setProjectCrs,
  type PendingDem, type PendingLas,
} from '../commands/terrain';
import { computeDerived, activeIndex } from '../store/derived';
import { Modal } from './Dialogs';
import { tidy } from './props';

const DELIMS: [Delimiter, string][] = [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], [' ', 'Spaces']];

/** Column mapping for delimited survey files and Excel sheets (manual App. D.3). Re-created when another sheet is chosen. */
export function CsvImportDialog({ close }: { close: () => void }) {
  const file = useApp((s) => s.pendingFile);
  if (!file) return null;
  return <CsvImportForm key={file.text} close={close} />;
}

function CsvImportForm({ close }: { close: () => void }) {
  const file = useApp((s) => s.pendingFile);
  const sys = useApp((s) => s.project?.settings.unitSystem ?? 'SI_N');
  const hasCrs = useApp((s) => !!s.project?.settings.crs);
  const hasTin = useApp((s) => !!s.project?.settings.terrain.tinEnabled);
  const sniff = useMemo(() => sniffDelimited(file?.text ?? ''), [file]);
  const [o, setO] = useState<DelimitedOptions>(() => {
    // Starting guess only, from which columns hold numbers: X, Y, then Z if there is a third numeric column.
    const g = guessColumns(file?.text ?? '', sniff.delimiter, sniff.skipLines);
    return {
      delimiter: sniff.delimiter, skipLines: sniff.skipLines, ...g, colCode: 0, colH: 0, defaultCode: 200, unit: sys === 'US' ? 'ft' : 'm',
      zMode: g.colZ ? 'column' : hasTin ? 'surface' : 'constant', zConstant: 0,
    };
  });
  const [lonLat, setLonLat] = useState(false);
  const [zText, setZText] = useState('0');
  if (!file) return null;
  const zMode = o.zMode ?? 'column';

  const lines = file.text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows = lines.slice(0, 9).map((l) => splitDelimited(l, o.delimiter));
  const ncol = Math.max(0, ...rows.map((r) => r.length));
  const colOptions = (allowNone: boolean) => [
    ...(allowNone ? [<option key={0} value={0}>— none —</option>] : []),
    ...Array.from({ length: ncol }, (_, i) => <option key={i + 1} value={i + 1}>Column {i + 1}</option>),
  ];
  const sel = (label: string, key: 'colX' | 'colY' | 'colZ' | 'colDesc' | 'colCode' | 'colH', allowNone: boolean) => (
    <div className="field" style={{ gridTemplateColumns: '150px 1fr' }}>
      <label>{label}</label>
      <select value={o[key]} onChange={(e) => setO({ ...o, [key]: Number(e.target.value) })}>{colOptions(allowNone)}</select>
    </div>
  );
  const role = (c: number) =>
    c === o.colX ? 'X' : c === o.colY ? 'Y' : zMode === 'column' && c === o.colZ ? 'Z' : c === o.colDesc ? 'Desc' : c === o.colCode ? 'Code' : c === o.colH ? 'Height' : '';
  const picked = [o.colX, o.colY, zMode === 'column' ? o.colZ : 0, o.colDesc, o.colCode, o.colH].filter((c) => c > 0);
  const error = [o.colX, o.colY, ...(zMode === 'column' ? [o.colZ] : [])].some((c) => c < 1 || c > ncol) ? (zMode === 'column' ? 'Select columns for X, Y and Z, or take elevations from the TIN or one value.' : 'Select columns for X and Y.')
    : zMode === 'constant' && !Number.isFinite(Number(zText)) ? 'Enter the elevation as a number.'
    : zMode === 'surface' && !hasTin ? 'Elevations from the TIN need the TIN (Terrain ▸ Use TIN).'
    : new Set(picked).size !== picked.length ? 'A column is selected for more than one field.'
      : !Number.isInteger(o.defaultCode) ? 'The default feature code must be a whole number.' : null;

  return (
    <Modal
      title={`Import Points — ${file.name}`} onClose={close} width={860}
      footer={<>
        {error && <span style={{ color: 'var(--err)', marginRight: 'auto' }}>{error}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!!error} onClick={() => finishCsvImport({ ...o, colZ: zMode === 'column' ? o.colZ : 0, zConstant: Number(zText) }, lonLat)}>Import and show in plan</button>
      </>}
    >
      {file.sheets && file.sheets.length > 1 && (
        <div className="field" style={{ gridTemplateColumns: '150px 1fr', marginBottom: 6 }}>
          <label>Excel sheet</label>
          <select value={file.sheets.find((s) => s.text === file.text)?.name ?? ''} onChange={(e) => { const s = file.sheets!.find((k) => k.name === e.target.value); if (s) useApp.getState().setPendingFile({ ...file, text: s.text }, 'importCsv'); }}>
            {file.sheets.map((s) => <option key={s.name} value={s.name}>{s.name}{s.text.trim() ? '' : ' (empty)'}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        <div>
          <div className="field" style={{ gridTemplateColumns: '150px 1fr' }}>
            <label>Delimiter</label>
            <select value={o.delimiter} onChange={(e) => setO({ ...o, delimiter: e.target.value as Delimiter })}>
              {DELIMS.map(([d, l]) => <option key={l} value={d}>{l}</option>)}
            </select>
          </div>
          <div className="field" style={{ gridTemplateColumns: '150px 1fr' }}>
            <label>Heading lines to skip</label>
            <input type="number" min={0} value={o.skipLines} onChange={(e) => setO({ ...o, skipLines: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </div>
          <div className="field" style={{ gridTemplateColumns: '150px 1fr' }}>
            <label>Units of X, Y, Z, height</label>
            <select value={o.unit} onChange={(e) => setO({ ...o, unit: e.target.value as 'm' | 'ft' })}>
              <option value="m">Metres</option><option value="ft">Feet (international)</option>
            </select>
          </div>
          <div className="field" style={{ gridTemplateColumns: '150px 1fr' }}>
            <label>Default feature code</label>
            <input type="number" value={o.defaultCode} onChange={(e) => setO({ ...o, defaultCode: Number(e.target.value) })} />
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }} title={hasCrs ? '' : 'Define the project coordinate system first (Project menu)'}>
            <input type="checkbox" checked={lonLat} disabled={!hasCrs} onChange={(e) => setLonLat(e.target.checked)} />
            X and Y are longitude and latitude in degrees (WGS 84){hasCrs ? '; the unit above then applies to Z and height only' : ' — needs a project coordinate system'}
          </label>
        </div>
        <div>
          {sel('X (easting)', 'colX', false)}
          {sel('Y (northing)', 'colY', false)}
          <div className="field" style={{ gridTemplateColumns: '150px 1fr' }}>
            <label>Elevation from</label>
            <select value={zMode} onChange={(e) => setO({ ...o, zMode: e.target.value as 'column' | 'constant' | 'surface', colZ: e.target.value === 'column' && o.colZ === 0 ? Math.min(3, ncol) : o.colZ })}>
              <option value="column">A column of the file</option>
              <option value="surface" disabled={!hasTin}>The TIN surface{hasTin ? '' : ' (TIN not enabled)'}</option>
              <option value="constant">One value for all points</option>
            </select>
          </div>
          {zMode === 'column' && sel('Z (elevation)', 'colZ', false)}
          {zMode === 'constant' && (
            <div className="field" style={{ gridTemplateColumns: '150px 1fr' }}>
              <label>Elevation ({o.unit})</label>
              <input value={zText} onChange={(e) => setZText(e.target.value)} inputMode="decimal" />
            </div>
          )}
          {sel('Description', 'colDesc', true)}
          {sel('Feature code', 'colCode', true)}
          {sel('Obstacle height', 'colH', true)}
        </div>
      </div>
      <div className="muted" style={{ margin: '8px 0 4px' }}>
        First lines ({lines.length} non-blank lines). Check that the column roles are right before importing; the delimiter,
        heading lines and columns above are a first guess from the contents. Numbers copied from Excel with thousands separators
        (1,234.56) are read when the delimiter is not a comma.{zMode !== 'column' ? ' Points without surveyed elevations are plot points: new feature codes are created off the ground, so the TIN and ground profiles do not change, and they are drawn as labelled rings in the plan view.' : ''}{zMode === 'surface' ? ' Each point takes the TIN elevation at its X, Y; points outside the TIN are skipped.' : ''}
      </div>
      <div className="scroll" style={{ maxHeight: 220 }}>
        <table className="grid">
          <thead><tr><th>Line</th>{Array.from({ length: ncol }, (_, i) => <th key={i}>{i + 1}{role(i + 1) ? ` · ${role(i + 1)}` : ''}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={i < o.skipLines ? { opacity: 0.45 } : undefined}>
                <td className="mono">{i + 1}{i < o.skipLines ? ' (skipped)' : ''}</td>
                {Array.from({ length: ncol }, (_, c) => <td key={c} className="mono">{r[c] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Coordinates pasted from Excel (or any table): the cells are then mapped like a file. */
export function PastePointsDialog({ close }: { close: () => void }) {
  const [text, setText] = useState('');
  const rows = text.split(/\r?\n/).filter((l) => l.trim() !== '').length;
  return (
    <Modal title="Paste Points from Excel" onClose={close} width={640}
      footer={<>
        <span className="muted" style={{ marginRight: 'auto' }}>{rows ? `${rows} row(s)` : ''}</span>
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!rows} onClick={() => beginPastedImport(text)}>Next: map columns</button>
      </>}>
      <div style={{ marginBottom: 6 }}>
        In Excel, select the cells with the coordinates (a heading row is fine), copy them with Ctrl+C, and paste them here with Ctrl+V.
        Columns can be in any order: you choose which is X (easting), Y (northing) and, if present, elevation, description and feature code next.
      </div>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        placeholder={'Point\tEasting\tNorthing\tElevation\nP1\t500120.5\t1650340.2\t152.3'}
        style={{ width: '100%', height: 260, fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre' }} />
    </Modal>
  );
}

/** Terrain origin for PFL to XYZ conversion (manual §6.9.2). */
export function PflImportDialog({ close }: { close: () => void }) {
  const file = useApp((s) => s.pendingFile);
  const sys = useApp((s) => s.project?.settings.unitSystem ?? 'SI_N');
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const [az, setAz] = useState('90');
  if (!file) return null;
  const vals = [Number(x), Number(y), Number(az)];
  const error = [x, y, az].some((t) => t.trim() === '') || vals.some((v) => !Number.isFinite(v)) ? 'Enter numbers in all three fields.'
    : vals[2]! < 0 || vals[2]! >= 360 ? 'Azimuth must be from 0 up to (not including) 360 degrees.' : null;
  const u = unitLabel(sys, 'length');
  return (
    <Modal
      title={`Import PFL Terrain — ${file.name}`} onClose={close} width={520}
      footer={<>
        {error && <span style={{ color: 'var(--err)', marginRight: 'auto' }}>{error}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!!error}
          onClick={() => finishPflImport({ x: toSI(vals[0]!, sys, 'length'), y: toSI(vals[1]!, sys, 'length'), azimuth: vals[2]! })}>Import</button>
      </>}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        A PFL file locates points by station and offset, so it has no plan position of its own. Give the plan coordinates of the
        point with zero station and the azimuth of the first alignment leg (clockwise from north). The alignment in the file
        replaces any existing alignment.
      </p>
      <div className="field"><label>X of station zero ({u})</label><input value={x} onChange={(e) => setX(e.target.value)} inputMode="decimal" /></div>
      <div className="field"><label>Y of station zero ({u})</label><input value={y} onChange={(e) => setY(e.target.value)} inputMode="decimal" /></div>
      <div className="field"><label>Azimuth of first leg (°)</label><input value={az} onChange={(e) => setAz(e.target.value)} inputMode="decimal" /></div>
    </Modal>
  );
}

/** Feature codes and required clearances by voltage (manual §6.1). Edits are applied together as one undoable change. */
export function FeatureCodesDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const exec = useApp((s) => s.exec);
  const sys = project.settings.unitSystem;
  const u = unitLabel(sys, 'length');
  const [codes, setCodes] = useState<FeatureCode[]>(() => project.terrain.featureCodes.map((f) => ({ ...f, clearances: { ...f.clearances } })));
  const [voltages, setVoltages] = useState<number[]>(() => [...project.terrain.voltages]);
  const [newCode, setNewCode] = useState('');
  const [newKv, setNewKv] = useState('');
  const used = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of project.terrain.points) m.set(p.code, (m.get(p.code) ?? 0) + 1);
    return m;
  }, [project.terrain.points]);

  const patch = (i: number, f: Partial<FeatureCode>) => setCodes(codes.map((c, k) => (k === i ? { ...c, ...f, src: 'user' } : c)));
  const setClr = (i: number, kv: number, key: 'rv' | 'rh', text: string) => {
    const t = text.trim();
    const v = t === '' ? null : Number(t);
    if (v !== null && !(Number.isFinite(v) && v >= 0)) return;
    const c = codes[i]!;
    const cur = c.clearances[String(kv)] ?? { rv: null, rh: null };
    patch(i, { clearances: { ...c.clearances, [String(kv)]: { ...cur, [key]: v === null ? null : toSI(v, sys, 'length') } } });
  };
  const clr = (c: FeatureCode, kv: number, key: 'rv' | 'rh') => {
    const v = c.clearances[String(kv)]?.[key];
    return v === null || v === undefined ? '' : String(tidy(fromSI(v, sys, 'length')));
  };
  const codeNum = Number(newCode);
  const codeOk = newCode.trim() !== '' && Number.isInteger(codeNum) && !codes.some((c) => c.code === codeNum);
  const kvNum = Number(newKv);
  const kvOk = newKv.trim() !== '' && Number.isFinite(kvNum) && kvNum > 0 && !voltages.includes(kvNum) && voltages.length < 20;

  const apply = () => {
    exec('Edit feature codes', (d) => {
      (d as Project).terrain.featureCodes = [...codes].sort((a, b) => a.code - b.code);
      (d as Project).terrain.voltages = [...voltages].sort((a, b) => a - b);
    });
    close();
  };

  return (
    <Modal
      title="Feature Codes and Required Clearances" onClose={close} width={Math.min(1150, 640 + voltages.length * 150)}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={apply}>Apply</button></>}
    >
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span>
          Add code <input style={{ width: 70 }} value={newCode} onChange={(e) => setNewCode(e.target.value)} inputMode="numeric" />{' '}
          <button className="btn small" disabled={!codeOk} onClick={() => { setCodes([...codes, makeFeatureCode(codeNum, '', true, 'user', codes.length)]); setNewCode(''); }}>Add</button>
        </span>
        <span>
          Add clearance voltage (kV) <input style={{ width: 70 }} value={newKv} onChange={(e) => setNewKv(e.target.value)} inputMode="decimal" />{' '}
          <button className="btn small" disabled={!kvOk} onClick={() => { setVoltages([...voltages, kvNum].sort((a, b) => a - b)); setNewKv(''); }}>Add</button>
        </span>
        <span className="muted">{voltages.length}/20 voltages</span>
      </div>
      <div className="scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Code</th><th>Description</th><th title="Point is on Ground: used for ground profiles and the TIN">On ground</th>
              <th title="Aerial obstacle: wires may pass above or below">Aerial</th><th>Colour</th>
              {voltages.map((kv) => (
                <th key={kv} colSpan={2}>
                  {kv} kV — vert. / horiz. ({u}){' '}
                  <button className="btn small" title="Remove this voltage" onClick={() => setVoltages(voltages.filter((v) => v !== kv))}>×</button>
                </th>
              ))}
              <th>Points</th><th />
            </tr>
          </thead>
          <tbody>
            {codes.map((c, i) => (
              <tr key={c.code}>
                <td className="mono">{c.code}</td>
                <td><input style={{ width: 210 }} value={c.description} onChange={(e) => patch(i, { description: e.target.value })} /></td>
                <td><input type="checkbox" checked={c.onGround} onChange={(e) => patch(i, { onGround: e.target.checked })} /></td>
                <td><input type="checkbox" checked={c.aerial} onChange={(e) => patch(i, { aerial: e.target.checked })} /></td>
                <td><input type="color" value={c.color} onChange={(e) => patch(i, { color: e.target.value })} style={{ width: 34, height: 20, padding: 0 }} /></td>
                {voltages.flatMap((kv) => (['rv', 'rh'] as const).map((k) => (
                  <td key={`${kv}${k}`}>
                    <input className="mono" style={{ width: 62, textAlign: 'right' }} inputMode="decimal" defaultValue={clr(c, kv, k)} onBlur={(e) => setClr(i, kv, k, e.target.value)} />
                  </td>
                )))}
                <td className="mono">{used.get(c.code) ?? 0}</td>
                <td>
                  <button className="btn small" disabled={(used.get(c.code) ?? 0) > 0} title={(used.get(c.code) ?? 0) > 0 ? 'In use by survey points' : 'Delete code'}
                    onClick={() => setCodes(codes.filter((_, k) => k !== i))}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        Required clearances are your design criteria: none are pre-filled. A blank or zero horizontal clearance means “not defined”
        (manual §6.1.1). Clearance checking against these values is added in Phase 5. Symbols and label options of the feature code
        table are not implemented.
      </div>
    </Modal>
  );
}

const PAGE = 100;

/** Terrain point table: view, edit, add, deactivate and delete survey points (manual App. D.2, D.5). */
export function TerrainPointsDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const exec = useApp((s) => s.exec);
  const ask = useApp((s) => s.ask);
  const sys = project.settings.unitSystem;
  const u = unitLabel(sys, 'length');
  const [filter, setFilter] = useState<number | 'all'>('all');
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const rows = useMemo(
    () => (filter === 'all' ? project.terrain.points : project.terrain.points.filter((p) => p.code === filter)),
    [project.terrain.points, filter],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const view = rows.slice(pg * PAGE, pg * PAGE + PAGE);
  const codes = project.terrain.featureCodes;

  const edit = (id: string, label: string, fn: (p: TerrainPoint) => void) =>
    exec(label, (d) => { const p = (d as Project).terrain.points.find((q) => q.id === id); if (p) { fn(p); p.src = 'user'; } });
  const lenCell = (p: TerrainPoint, key: 'x' | 'y' | 'z' | 'h') => (
    <td>
      <input
        key={`${p.id}${key}${p[key]}${sys}`} className="mono" style={{ width: 108, textAlign: 'right' }} inputMode="decimal"
        defaultValue={tidy(fromSI(p[key], sys, 'length'), 3)}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (e.target.value.trim() === '' || !Number.isFinite(v) || (key === 'h' && v < 0)) { e.target.value = String(tidy(fromSI(p[key], sys, 'length'), 3)); return; }
          const si = toSI(v, sys, 'length');
          if (Math.abs(si - p[key]) > 1e-9) edit(p.id, 'Edit terrain point', (q) => { q[key] = si; });
        }}
      />
    </td>
  );
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const withSel = (label: string, fn: (d: Project) => void) => { exec(label, fn as never); setSel(new Set()); };

  return (
    <Modal title="Terrain Points" onClose={close} width={1040} footer={<button className="btn" onClick={close}>Close</button>}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span>Feature code</span>
        <select value={filter} onChange={(e) => { setFilter(e.target.value === 'all' ? 'all' : Number(e.target.value)); setPage(0); }}>
          <option value="all">All ({project.terrain.points.length})</option>
          {codes.map((c) => <option key={c.code} value={c.code}>{c.code} {c.description}</option>)}
        </select>
        <button
          className="btn small" disabled={codes.length === 0}
          onClick={() => exec('Add terrain point', (d) => {
            (d as Project).terrain.points.push({ id: newId(), desc: '', x: 0, y: 0, z: 0, code: filter === 'all' ? codes[0]!.code : filter, h: 0, profNote: '', planNote: '', active: true, src: 'user' });
          })}
          title={codes.length === 0 ? 'Define a feature code first' : 'Adds a point at 0, 0, 0 at the end of the table for you to edit'}
        >Add point</button>
        <button className="btn small" disabled={sel.size === 0}
          onClick={() => withSel(`Deactivate ${sel.size} terrain points`, (d) => { for (const p of d.terrain.points) if (sel.has(p.id)) p.active = false; })}>Deactivate</button>
        <button className="btn small" disabled={sel.size === 0}
          onClick={() => withSel(`Reactivate ${sel.size} terrain points`, (d) => { for (const p of d.terrain.points) if (sel.has(p.id)) p.active = true; })}>Reactivate</button>
        <button className="btn small" disabled={sel.size === 0}
          onClick={() => withSel(`Delete ${sel.size} terrain points`, (d) => { d.terrain.points = d.terrain.points.filter((p) => !sel.has(p.id)); })}>Delete selected</button>
        <button className="btn small" disabled={rows.length === 0}
          onClick={async () => {
            const ok = await ask({ title: 'Delete terrain points', danger: true, confirmLabel: 'Delete', message: `Delete all ${rows.length} listed terrain points? This can be undone with Edit ▸ Undo.` });
            if (ok) { const ids = new Set(rows.map((p) => p.id)); withSel(`Delete ${rows.length} terrain points`, (d) => { d.terrain.points = d.terrain.points.filter((p) => !ids.has(p.id)); }); }
          }}>Delete all listed</button>
        <span style={{ marginLeft: 'auto' }} className="muted">{sel.size} selected</span>
      </div>
      <div className="scroll" style={{ maxHeight: '54vh' }}>
        <table className="grid">
          <thead><tr><th /><th>#</th><th>Description</th><th>X ({u})</th><th>Y ({u})</th><th>Z ({u})</th><th>Code</th><th>Obstacle height ({u})</th><th>Active</th><th>Source</th></tr></thead>
          <tbody>
            {view.map((p, i) => (
              <tr key={p.id} className={sel.has(p.id) ? 'rowsel' : ''} style={p.active ? undefined : { opacity: 0.5 }}>
                <td><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>
                <td className="mono">{pg * PAGE + i + 1}</td>
                <td><input key={`${p.id}d${p.desc}`} style={{ width: 150 }} defaultValue={p.desc} onBlur={(e) => { if (e.target.value !== p.desc) edit(p.id, 'Edit terrain point', (q) => { q.desc = e.target.value; }); }} /></td>
                {lenCell(p, 'x')}{lenCell(p, 'y')}{lenCell(p, 'z')}
                <td>
                  <select value={p.code} onChange={(e) => edit(p.id, 'Change feature code', (q) => { q.code = Number(e.target.value); })}>
                    {codes.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                  </select>
                </td>
                {lenCell(p, 'h')}
                <td>{p.active ? 'Yes' : 'No'}</td>
                <td>{p.src}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button className="btn small" disabled={pg === 0} onClick={() => setPage(pg - 1)}>◀ Previous</button>
        <span className="muted">Page {pg + 1} of {pages} · {rows.length} points</span>
        <button className="btn small" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next ▶</button>
        <span className="muted" style={{ marginLeft: 'auto' }}>Inactive points are kept in the project but excluded from views, profiles, the TIN and XYZ export.</span>
      </div>
    </Modal>
  );
}

/** How the coordinates of a DEM or LAS file relate to the project. */
type FileCrs = 'project-m' | 'project-ft' | 'wgs84';

function FileCrsField({ value, onChange, hasCrs }: { value: FileCrs; onChange: (v: FileCrs) => void; hasCrs: boolean }) {
  return (
    <div className="field" style={{ gridTemplateColumns: '190px 1fr' }}>
      <label>Horizontal coordinates of file</label>
      <select value={value} onChange={(e) => onChange(e.target.value as FileCrs)}>
        <option value="project-m">Project coordinate system, metres</option>
        <option value="project-ft">Project coordinate system, feet</option>
        <option value="wgs84" disabled={!hasCrs}>Longitude / latitude, WGS 84{hasCrs ? '' : ' (needs a project CRS)'}</option>
      </select>
    </div>
  );
}

function fileTransform(project: Project, crs: FileCrs): { xyFactor: number; transform?: Transformer } {
  if (crs === 'wgs84' && project.settings.crs) return { xyFactor: 1, transform: makeTransformer(WGS84_GEOGRAPHIC, project.settings.crs.definition) };
  return { xyFactor: crs === 'project-ft' ? FT : 1 };
}

/** DEM import: sampling step, units, feature code and optional corridor limit. */
export function DemImportDialog({ close }: { close: () => void }) {
  const pending = useApp((s) => s.pendingData);
  const project = useApp((s) => s.project)!;
  const activeId = useApp((s) => s.activeAlignmentId);
  const [step, setStep] = useState(1);
  const [crs, setCrs] = useState<FileCrs>('project-m');
  const [zUnit, setZUnit] = useState<'m' | 'ft'>('m');
  const [code, setCode] = useState(200);
  const [corridor, setCorridor] = useState('');
  if (!pending) return null;
  const grid = (pending.data as PendingDem).grid;
  const sys = project.settings.unitSystem;
  const line = computeDerived(project).lines[activeIndex(project, activeId)];
  const count = demPointCount(grid, Math.max(1, step));
  const cw = corridor.trim() === '' ? null : Number(corridor);
  const error = !Number.isInteger(step) || step < 1 ? 'The sampling step must be a whole number of at least 1.'
    : !Number.isInteger(code) ? 'The feature code must be a whole number.'
      : cw !== null && !(cw > 0) ? 'The corridor half-width must be a positive number, or blank.'
        : cw === null && count > MAX_IMPORT_POINTS ? `That is more than ${MAX_IMPORT_POINTS.toLocaleString()} points; increase the step or limit the area.` : null;

  const run = () => {
    const t = fileTransform(project, crs);
    let window: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
    if (cw !== null && line?.geom) {
      // Bounding box of the alignment grown by the half-width: a quick limit on the imported area.
      const w = toSI(cw, sys, 'length');
      const xs = line.alignment.pis.map((p) => p.x), ys = line.alignment.pis.map((p) => p.y);
      window = { minX: Math.min(...xs) - w, maxX: Math.max(...xs) + w, minY: Math.min(...ys) - w, maxY: Math.max(...ys) + w };
    }
    finishDemImport({ step, code, zFactor: zUnit === 'ft' ? FT : 1, maxPoints: MAX_IMPORT_POINTS, ...t, ...(window ? { window } : {}) });
  };

  return (
    <Modal
      title={`Import DEM — ${pending.name}`} onClose={close} width={600}
      footer={<>
        {error && <span style={{ color: 'var(--err)', marginRight: 'auto' }}>{error}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!!error} onClick={run}>Import</button>
      </>}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Grid of {grid.ncols} × {grid.nrows} cells, cell size {grid.dx} × {grid.dy} (file units), top-left cell centre at
        ({grid.x0}, {grid.y0}){grid.nodata !== null ? `, no-data value ${grid.nodata}` : ''}. Each sampled cell becomes one ground
        survey point at the cell centre.
      </p>
      <div className="field" style={{ gridTemplateColumns: '190px 1fr' }}>
        <label>Take every n-th row and column</label>
        <input type="number" min={1} value={step} onChange={(e) => setStep(Math.floor(Number(e.target.value)))} />
      </div>
      <FileCrsField value={crs} onChange={setCrs} hasCrs={!!project.settings.crs} />
      <div className="field" style={{ gridTemplateColumns: '190px 1fr' }}>
        <label>Elevation unit of file</label>
        <select value={zUnit} onChange={(e) => setZUnit(e.target.value as 'm' | 'ft')}><option value="m">Metres</option><option value="ft">Feet (international)</option></select>
      </div>
      <div className="field" style={{ gridTemplateColumns: '190px 1fr' }}>
        <label>Feature code for the points</label>
        <input type="number" value={code} onChange={(e) => setCode(Number(e.target.value))} />
      </div>
      <div className="field" style={{ gridTemplateColumns: '190px 1fr' }}>
        <label>Only within ({unitLabel(sys, 'length')}) of the active alignment</label>
        <input value={corridor} disabled={!line?.geom} placeholder={line?.geom ? 'blank = whole grid' : 'needs an alignment'} onChange={(e) => setCorridor(e.target.value)} inputMode="decimal" />
      </div>
      <div className="muted">
        Up to {count.toLocaleString()} points with this step{cw !== null ? ' before the area limit' : ''}. The area limit is the
        bounding rectangle of the alignment enlarged by the distance given. The file's coordinate system is not read from the
        file: choose it above.
      </div>
    </Modal>
  );
}

/** LAS import: map point classes to feature codes (manual App. D.7). */
export function LasImportDialog({ close }: { close: () => void }) {
  const pending = useApp((s) => s.pendingData);
  const project = useApp((s) => s.project)!;
  const info = pending ? (pending.data as PendingLas).info : null;
  const classes = useMemo(() => (info ? [...info.classes.entries()].sort((a, b) => a[0] - b[0]) : []), [info]);
  const [map, setMap] = useState<Record<number, string>>({});
  const [step, setStep] = useState(1);
  const [crs, setCrs] = useState<FileCrs>('project-m');
  const [zUnit, setZUnit] = useState<'m' | 'ft'>('m');
  if (!pending || !info) return null;
  const mapped = classes.filter(([c]) => (map[c] ?? '').trim() !== '');
  const bad = mapped.some(([c]) => !Number.isInteger(Number(map[c])));
  const total = mapped.reduce((n, [, cnt]) => n + Math.ceil(cnt / Math.max(1, step)), 0);
  const error = bad ? 'Feature codes must be whole numbers.'
    : mapped.length === 0 ? 'Enter a feature code for at least one class.'
      : !Number.isInteger(step) || step < 1 ? 'The thinning step must be a whole number of at least 1.'
        : total > MAX_IMPORT_POINTS ? `That is more than ${MAX_IMPORT_POINTS.toLocaleString()} points; increase the thinning step.` : null;
  return (
    <Modal
      title={`Import LAS — ${pending.name}`} onClose={close} width={620}
      footer={<>
        {error && <span style={{ color: 'var(--err)', marginRight: 'auto' }}>{error}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!!error}
          onClick={() => finishLasImport({
            classToCode: new Map(mapped.map(([c]) => [c, Number(map[c])])), step, zFactor: zUnit === 'ft' ? FT : 1,
            maxPoints: MAX_IMPORT_POINTS, ...fileTransform(project, crs),
          })}>Import {error ? '' : `${total.toLocaleString()} points`}</button>
      </>}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        LAS {info.version}, point format {info.pointFormat}, {info.pointCount.toLocaleString()} points. Extent X {info.min[0]} to {info.max[0]},
        Y {info.min[1]} to {info.max[1]}, Z {info.min[2]} to {info.max[2]} (file units). Give a feature code to each class you want to
        import; classes left blank are skipped.
      </p>
      <div className="scroll" style={{ maxHeight: 220, marginBottom: 8 }}>
        <table className="grid">
          <thead><tr><th>LAS class</th><th>Points</th><th>Feature code</th></tr></thead>
          <tbody>
            {classes.map(([c, n]) => (
              <tr key={c}>
                <td className="mono">{c}</td>
                <td className="mono">{n.toLocaleString()}</td>
                <td><input style={{ width: 90 }} inputMode="numeric" value={map[c] ?? ''} onChange={(e) => setMap({ ...map, [c]: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="field" style={{ gridTemplateColumns: '190px 1fr' }}>
        <label>Keep one of every n points</label>
        <input type="number" min={1} value={step} onChange={(e) => setStep(Math.floor(Number(e.target.value)))} />
      </div>
      <FileCrsField value={crs} onChange={setCrs} hasCrs={!!project.settings.crs} />
      <div className="field" style={{ gridTemplateColumns: '190px 1fr' }}>
        <label>Elevation unit of file</label>
        <select value={zUnit} onChange={(e) => setZUnit(e.target.value as 'm' | 'ft')}><option value="m">Metres</option><option value="ft">Feet (international)</option></select>
      </div>
      <div className="muted">Class numbers are those stored in the file; their meaning depends on who classified the data. LAZ files are not supported.</div>
    </Modal>
  );
}

/** Project coordinate system: a WGS 84 / UTM zone or a PROJ / WKT definition (manual §6.2.1). */
export function CrsDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const cur = project.settings.crs;
  const [kind, setKind] = useState<'utm' | 'custom'>(cur && !cur.epsg ? 'custom' : 'utm');
  const [zone, setZone] = useState(cur?.epsg ? cur.epsg % 100 : 31);
  const [south, setSouth] = useState(cur?.epsg ? cur.epsg >= 32700 : false);
  const [name, setName] = useState(cur && !cur.epsg ? cur.name : '');
  const [def, setDef] = useState(cur && !cur.epsg ? cur.definition : '');
  const [reproject, setReproject] = useState(false);
  const zoneOk = Number.isInteger(zone) && zone >= 1 && zone <= 60;
  const defError = kind === 'custom' ? validateCrsDefinition(def) : null;
  const error = kind === 'utm' ? (zoneOk ? null : 'UTM zone must be a whole number from 1 to 60.')
    : name.trim() === '' ? 'Enter a name for the coordinate system.' : defError ? `Definition not usable: ${defError}` : null;
  const apply = () => {
    setProjectCrs(kind === 'utm' ? utmDefinition(zone, south) : { name: name.trim(), definition: def.trim() }, reproject);
    close();
  };
  return (
    <Modal
      title="Project Coordinate System" onClose={close} width={600}
      footer={<>
        {error && <span style={{ color: 'var(--err)', marginRight: 'auto' }}>{error}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!!error} onClick={apply}>Apply</button>
      </>}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Current: {cur ? cur.name : 'not defined'}. The coordinate system says what the project's X and Y mean; it is needed for the map
        view, longitude/latitude input and reprojection. If you do not know which system your survey uses, ask the supplier of the
        survey data.
      </p>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={kind === 'utm'} onChange={() => setKind('utm')} />WGS 84 / UTM zone</label>
      <div className="field" style={{ marginLeft: 22 }}>
        <label>Zone (1–60)</label>
        <input type="number" min={1} max={60} disabled={kind !== 'utm'} value={zone} onChange={(e) => setZone(Number(e.target.value))} />
      </div>
      <div className="field" style={{ marginLeft: 22 }}>
        <label>Hemisphere</label>
        <select disabled={kind !== 'utm'} value={south ? 's' : 'n'} onChange={(e) => setSouth(e.target.value === 's')}><option value="n">North</option><option value="s">South</option></select>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}><input type="radio" checked={kind === 'custom'} onChange={() => setKind('custom')} />Other system, from a PROJ string or WKT (.prj file contents)</label>
      <div className="field" style={{ marginLeft: 22 }}><label>Name</label><input disabled={kind !== 'custom'} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field" style={{ marginLeft: 22 }}>
        <label>Definition</label>
        <textarea disabled={kind !== 'custom'} style={{ height: 80, fontFamily: 'var(--mono)' }} value={def} onChange={(e) => setDef(e.target.value)} placeholder="+proj=tmerc +lat_0=… or PROJCS[…]" />
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 10 }} title={cur ? '' : 'There is no current coordinate system to reproject from'}>
        <input type="checkbox" checked={reproject} disabled={!cur} onChange={(e) => setReproject(e.target.checked)} />
        <span>
          Reproject the project: transform all survey points, P.I.s and break lines from the current system to this one.
          Leave unticked to only state (or correct) which system the existing coordinates are in.
        </span>
      </label>
      <div className="muted" style={{ marginTop: 8 }}>
        No EPSG database or datum grid-shift files are included. Systems other than WGS 84 / UTM are entered as PROJ or WKT text;
        datum changes that need grid files are therefore approximate or unavailable.
      </div>
    </Modal>
  );
}

/** Create TIN-interpolated points along the centerline and offset lines (manual §6.4.4). */
export function InterpolateDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const sys = project.settings.unitSystem;
  const codes = project.terrain.featureCodes.filter((c) => c.onGround);
  const [text, setText] = useState('0');
  const [code, setCode] = useState<number>(codes[0]?.code ?? 200);
  const vals = text.split(/[\s,;]+/).filter((t) => t !== '').map(Number);
  const error = vals.length === 0 || vals.some((v) => !Number.isFinite(v)) ? 'Enter one or more offsets separated by spaces or commas.'
    : new Set(vals).size !== vals.length ? 'An offset is listed twice.'
      : codes.length === 0 ? 'Define a ground feature code first.' : null;
  return (
    <Modal
      title="Create Interpolated Points" onClose={close} width={520}
      footer={<>
        {error && <span style={{ color: 'var(--err)', marginRight: 'auto' }}>{error}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!!error} onClick={() => { createInterpolatedPoints(vals.map((v) => toSI(v, sys, 'length')), code); close(); }}>Create</button>
      </>}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Adds a ground point wherever a side of a TIN triangle crosses the centerline of the active alignment or a line at the given
        offsets. The points lie on the TIN surface and are described TINPT.
      </p>
      <div className="field"><label>Offsets ({unitLabel(sys, 'length')})</label><input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. -40 -20 0 20 40" /></div>
      <div className="field">
        <label>Feature code</label>
        <select value={code} onChange={(e) => setCode(Number(e.target.value))}>{codes.map((c) => <option key={c.code} value={c.code}>{c.code} {c.description}</option>)}</select>
      </div>
      <div className="muted">Positive offsets are to the right of the line. The triangle-side length and elevation-change limits of the manual's dialog are not implemented; use the TIN edge limit.</div>
    </Modal>
  );
}