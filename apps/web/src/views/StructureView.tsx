import { useState } from 'react';
import { formatQuantity, unitLabel } from '@tlcad/engine';
import { checkStructureType, INSULATOR_LABEL, structureSets } from '@tlcad/model';
import { useApp } from '../store/appStore';
import { useDerived } from '../store/derived';
import { StructureSketch } from '../ui/StructureSketch';

/**
 * Structure Modeling workspace: the top geometry of a structure type as an
 * elevation drawing with its sets and attachment table. Shows the type of the
 * selected structure, or a type chosen here.
 */
export function StructureView() {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const openDialog = useApp((s) => s.openDialog);
  const d = useDerived();
  const [pick, setPick] = useState<string | null>(null);
  if (!project) return <div className="placeholder"><div className="box">No project is open.</div></div>;
  const lib = project.structureLibrary;
  const fromSel = selection?.kind === 'structure' ? d.model.byId.get(selection.id)?.type?.id : undefined;
  const t = lib.find((k) => k.id === (fromSel ?? pick)) ?? lib[0];
  if (!t) {
    return (
      <div className="placeholder">
        <div className="box">
          <h3>Structure Modeling</h3>
          The structure library is empty.
          <div style={{ marginTop: 10 }}><button className="link-btn" style={{ color: '#8fb8ee' }} onClick={() => openDialog('structureTypes')}>Open the structure library</button></div>
        </div>
      </div>
    );
  }
  const sys = project.settings.unitSystem;
  const len = (v: number) => formatQuantity(v, sys, 'length', 3, false);
  const problems = checkStructureType(t);
  const used = project.structures.filter((s) => s.typeId === t.id).length;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#f6f7f8', color: 'var(--text)', padding: 10, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
      <div style={{ width: 360, maxWidth: '100%', flex: 'none' }}>
        <StructureSketch t={t} sys={sys} height={Math.max(260, 460)} />
      </div>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <select value={t.id} onChange={(e) => setPick(e.target.value)} disabled={!!fromSel} title={fromSel ? 'Showing the type of the selected structure' : ''}>
            {lib.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <button className="btn small" onClick={() => openDialog('structureTypes')}>Edit in library…</button>
          <span className="muted">{used} spotted</span>
        </div>
        <div><b>{t.name}</b> {t.description}</div>
        <div className="muted">Height {len(t.height)} {unitLabel(sys, 'length')}{t.embedment !== null ? `, embedment ${len(t.embedment)}` : ''} · strength: {t.strength.method === 'method1' ? `Method 1, ${t.strength.rows.length} line angle(s), up to ${Math.max(...t.strength.rows.map((r) => r.lineAngle), 0)}°` : 'none'}</div>
        {problems.length > 0 && <ul style={{ color: 'var(--err)' }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        <h4 style={{ margin: '10px 0 4px' }}>Sets</h4>
        <table className="grid">
          <thead><tr><th>Set</th><th>Description</th><th>Phases</th><th>Dead end</th></tr></thead>
          <tbody>{structureSets(t).map((s) => <tr key={s.number}><td className="mono">{s.number}</td><td>{s.description}</td><td className="mono">{s.phaseCount}</td><td>{s.deadEnd ? 'Yes' : 'No'}</td></tr>)}</tbody>
        </table>
        <h4 style={{ margin: '10px 0 4px' }}>Attachments ({unitLabel(sys, 'length')})</h4>
        <table className="grid">
          <thead><tr><th>Set:Ph</th><th>Insulator</th><th>Length</th><th>x</th><th>y below top</th><th>z</th></tr></thead>
          <tbody>
            {t.attachments.map((a, i) => (
              <tr key={i}><td className="mono">{a.set}:{a.phase}</td><td>{INSULATOR_LABEL[a.insulator]}</td><td className="mono">{a.insulator === 'clamp' || a.insulator === 'post' ? '—' : len(a.length)}</td><td className="mono">{len(a.x)}</td><td className="mono">{len(a.y)}</td><td className="mono">{len(a.z)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="muted" style={{ marginTop: 8 }}>
          Drawn from the top geometry (a "stick" structure, §8.4.1). Detailed tower and pole models need the external TOWER / PLS-POLE programs and are not available.
        </div>
      </div>
    </div>
  );
}
