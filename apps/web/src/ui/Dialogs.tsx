import { GettingStartedDialog } from './GettingStarted';
import { AnnotationDialog, AttachmentsDialog, MaterialsDialog, ReportsDialog, SheetSettingsDialog } from './DraftingDialogs';
import { CriteriaDialog } from './CriteriaDialog';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { UNIT_SYSTEM_LABEL, type UnitSystem } from '@tlcad/engine';
import { FEATURES, FEATURE_STATUS_LABEL, featureSummary, type FeatureStatus } from '@tlcad/model';
import { APP_VERSION, useApp } from '../store/appStore';
import type { ProjectSummary, RevisionSummary } from '../db/repository';
import { commands } from '../commands/menus';
import {
  CrsDialog, CsvImportDialog, PastePointsDialog, DemImportDialog, FeatureCodesDialog, InterpolateDialog, LasImportDialog, PflImportDialog, TerrainPointsDialog,
} from './TerrainDialogs';
import { CableLibraryDialog, StructureLibraryDialog } from './LibraryDialogs';
import { SpotDialog, StringingDialog, StructureTableDialog } from './LineDialogs';

export function Modal(p: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; isConfirm?: boolean }) {
  useEffect(() => {
    // Escape closes only the top-most dialog: a confirmation shown over another dialog takes it first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (p.isConfirm || !useApp.getState().confirm)) p.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="overlay">
      <div className="dialog" style={p.width ? { width: p.width } : undefined} role="dialog" aria-label={p.title}>
        <div className="dialog-title">{p.title}<button className="x" onClick={p.onClose} aria-label="Close">×</button></div>
        <div className="dialog-body">{p.children}</div>
        {p.footer && <div className="dialog-foot">{p.footer}</div>}
      </div>
    </div>
  );
}

function NewProjectDialog({ close }: { close: () => void }) {
  const newProject = useApp((s) => s.newProject);
  const [f, setF] = useState({ name: '', lineName: '', client: '', engineer: '', voltage: '', description: '', unitSystem: 'SI_N' as UnitSystem });
  const kv = f.voltage.trim() === '' ? null : Number(f.voltage);
  const nameErr = f.name.trim() === '' ? 'A project name is required.' : null;
  const kvErr = kv !== null && !(Number.isFinite(kv) && kv > 0 && kv <= 1500) ? 'Enter a voltage between 0 and 1500 kV, or leave blank.' : null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const create = () => {
    if (nameErr || kvErr) return;
    void newProject({
      name: f.name.trim(), lineName: f.lineName, client: f.client, engineer: f.engineer,
      description: f.description, unitSystem: f.unitSystem, nominalVoltageKV: kv,
    });
  };
  return (
    <Modal
      title="New Project" onClose={close} width={500}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!nameErr || !!kvErr} onClick={create}>Create</button></>}
    >
      <div className="field"><label>Project name *</label><input autoFocus value={f.name} onChange={set('name')} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} /></div>
      <div className="field"><label>Line name</label><input value={f.lineName} onChange={set('lineName')} /></div>
      <div className="field"><label>Client</label><input value={f.client} onChange={set('client')} /></div>
      <div className="field"><label>Engineer</label><input value={f.engineer} onChange={set('engineer')} /></div>
      <div className="field">
        <label>Nominal voltage (kV)</label><input value={f.voltage} onChange={set('voltage')} inputMode="decimal" />
        {kvErr && <div className="err">{kvErr}</div>}
      </div>
      <div className="field">
        <label>Unit system</label>
        <select value={f.unitSystem} onChange={set('unitSystem')}>
          {(Object.keys(UNIT_SYSTEM_LABEL) as UnitSystem[]).map((k) => <option key={k} value={k}>{UNIT_SYSTEM_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="field"><label>Description</label><textarea value={f.description} onChange={set('description')} /></div>
      <div className="muted">The project is created in memory. Use File ▸ Save to store it in the project database.</div>
    </Modal>
  );
}

function OpenProjectDialog({ close }: { close: () => void }) {
  const app = useApp.getState;
  const currentId = useApp((s) => s.project?.id);
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setList(await app().listProjects()); } catch { setList([]); }
  }, [app]);
  useEffect(() => { void refresh(); }, [refresh]);

  const del = async (p: ProjectSummary) => {
    const ok = await app().ask({
      title: 'Delete project', danger: true, confirmLabel: 'Delete',
      message: `Permanently delete "${p.name}" and its ${p.revisionCount} revision(s) from the database? This cannot be undone.`,
    });
    if (!ok) return;
    await app().deleteProject(p.id);
    setSel(null);
    await refresh();
  };

  return (
    <Modal
      title="Open Project" onClose={close} width={760}
      footer={<>
        <button className="btn" onClick={() => { close(); commands.importArchive(); }}>Import .tlcad…</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!sel} onClick={() => { if (sel) void app().openProject(sel); }}>Open</button>
      </>}
    >
      {list === null ? <div className="muted">Reading the project database…</div> : list.length === 0 ? (
        <div className="muted">The project database is empty. Create a project with File ▸ New Project, or import a .tlcad archive.</div>
      ) : (
        <div className="scroll">
          <table className="grid">
            <thead><tr><th>Project</th><th>Line</th><th>Client</th><th>Units</th><th>Revisions</th><th>Last saved</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={sel === p.id ? 'rowsel' : ''} onClick={() => setSel(p.id)} onDoubleClick={() => { void app().openProject(p.id); }}>
                  <td><b>{p.name}</b>{p.id === currentId ? ' (open)' : ''}</td>
                  <td>{p.lineName}</td>
                  <td>{p.client}</td>
                  <td>{p.unitSystem.replace('_', '-')}</td>
                  <td className="mono">{p.revisionCount}</td>
                  <td className="mono">{new Date(p.modifiedAt).toLocaleString()}</td>
                  <td><button className="btn small" onClick={(e) => { e.stopPropagation(); void del(p); }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function RevisionsDialog({ close }: { close: () => void }) {
  const app = useApp.getState;
  const dirty = useApp((s) => s.dirty);
  const stored = useApp((s) => s.stored);
  const [list, setList] = useState<RevisionSummary[] | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const refresh = useCallback(async () => {
    try { setList(await app().listRevisions()); } catch { setList([]); }
  }, [app]);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!label.trim()) return;
    await app().createRevision(label.trim(), note.trim());
    setLabel(''); setNote('');
    await refresh();
  };
  const summary = (st: Record<string, number>) =>
    `${st.terrainPoints ?? 0} pts · ${st.alignments ?? 0} align · ${st.structures ?? 0} str · ${st.sections ?? 0} sect`;

  return (
    <Modal title="Project Revisions" onClose={close} width={720} footer={<button className="btn" onClick={close}>Close</button>}>
      <div className="field"><label>Revision label *</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Rev A — issued for review" /></div>
      <div className="field"><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 12px' }}>
        <button className="btn primary" disabled={!label.trim()} onClick={() => { void create(); }}>Create revision</button>
        <span className="muted">
          {dirty || !stored ? 'The project is saved first, then a snapshot of it is stored.' : 'Stores a snapshot of the saved project.'}
        </span>
      </div>
      {list === null ? <div className="muted">Reading revisions…</div> : list.length === 0 ? (
        <div className="muted">No revisions yet.</div>
      ) : (
        <div className="scroll">
          <table className="grid">
            <thead><tr><th>Label</th><th>Created</th><th>Contents</th><th>Note</th><th /></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.label}</b></td>
                  <td className="mono">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="mono">{summary(r.stats)}</td>
                  <td>{r.note}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small" onClick={async () => { await app().restoreRevision(r.id); }}>Restore</button>{' '}
                    <button className="btn small" onClick={async () => {
                      const ok = await app().ask({ title: 'Delete revision', message: `Delete revision "${r.label}"?`, confirmLabel: 'Delete', danger: true });
                      if (ok) { await app().deleteRevision(r.id); await refresh(); }
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function FeatureStatusDialog({ close }: { close: () => void }) {
  const [filter, setFilter] = useState<FeatureStatus | 'all'>('all');
  const sum = featureSummary();
  const rows = filter === 'all' ? FEATURES : FEATURES.filter((f) => f.status === filter);
  const chips: (FeatureStatus | 'all')[] = ['all', 'implemented', 'partial', 'planned', 'gap'];
  return (
    <Modal title="Feature Status" onClose={close} width={920} footer={<button className="btn" onClick={close}>Close</button>}>
      <div className="chips">
        {chips.map((c) => (
          <button key={c} className={`chip ${filter === c ? 'on' : ''}`} onClick={() => setFilter(c)}>
            {c === 'all' ? `All (${FEATURES.length})` : `${FEATURE_STATUS_LABEL[c]} (${sum[c]})`}
          </button>
        ))}
      </div>
      <div className="scroll">
        <table className="grid">
          <thead><tr><th>ID</th><th>Module</th><th>Function</th><th>Status</th><th>Phase</th><th>Manual ref.</th><th>Note</th></tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td className="mono">{f.id}</td>
                <td>{f.module}</td>
                <td>{f.name}</td>
                <td><span className={`pill ${f.status}`}>{FEATURE_STATUS_LABEL[f.status]}</span></td>
                <td className="mono">{f.phase ?? '—'}</td>
                <td className="mono">{f.ref}</td>
                <td className="muted">{f.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        Functions marked “Awaiting reference data” cannot be implemented from the available manuals without inventing engineering methods; they stay disabled until the missing reference is supplied.
      </div>
    </Modal>
  );
}

function AboutDialog({ close }: { close: () => void }) {
  const dbInfo = useApp((s) => s.dbInfo);
  return (
    <Modal title="About TLCAD" onClose={close} width={520} footer={<button className="btn" onClick={close}>Close</button>}>
      <p><b>TLCAD {APP_VERSION}</b> — browser-based transmission line design platform.</p>
      <p>Development phases 1 and 2 (in progress): project management, project database, revisions, undo/redo, units, terrain import (XYZ, PFL, delimited text), feature codes, TIN, alignment and ground profiles.</p>
      <p className="muted">
        Engineering methods follow the PLS-CADD Version 12.3 user manual where it documents them. This build contains terrain and alignment
        geometry only: no conductor, structure or clearance calculations yet. See Help ▸ Feature Status for what is implemented.
      </p>
      <p className="muted">Database: {dbInfo ? `SQLite ${dbInfo.sqliteVersion}, ${dbInfo.storage}` : 'not available'}</p>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const confirm = useApp((s) => s.confirm);
  const hasProject = useApp((s) => s.project !== null);
  const close = () => useApp.getState().openDialog(null);
  const closeImport = () => useApp.getState().setPendingFile(null, null);
  const closeData = () => useApp.getState().setPendingData(null, null);
  return (
    <>
      {dialog === 'new' && <NewProjectDialog close={close} />}
      {dialog === 'open' && <OpenProjectDialog close={close} />}
      {dialog === 'revisions' && hasProject && <RevisionsDialog close={close} />}
      {dialog === 'features' && <FeatureStatusDialog close={close} />}
      {dialog === 'about' && <AboutDialog close={close} />}
      {dialog === 'importCsv' && <CsvImportDialog close={closeImport} />}
      {dialog === 'pastePoints' && hasProject && <PastePointsDialog close={close} />}
      {dialog === 'importPfl' && <PflImportDialog close={closeImport} />}
      {dialog === 'featureCodes' && hasProject && <FeatureCodesDialog close={close} />}
      {dialog === 'terrainPoints' && hasProject && <TerrainPointsDialog close={close} />}
      {dialog === 'importDem' && hasProject && <DemImportDialog close={closeData} />}
      {dialog === 'importLas' && hasProject && <LasImportDialog close={closeData} />}
      {dialog === 'crs' && hasProject && <CrsDialog close={close} />}
      {dialog === 'interpolate' && hasProject && <InterpolateDialog close={close} />}
      {dialog === 'cables' && hasProject && <CableLibraryDialog close={close} />}
      {dialog === 'structureTypes' && hasProject && <StructureLibraryDialog close={close} />}
      {dialog === 'spot' && hasProject && <SpotDialog close={close} />}
      {dialog === 'structureTable' && hasProject && <StructureTableDialog close={close} />}
      {dialog === 'stringing' && hasProject && <StringingDialog close={close} />}
      {dialog === 'criteria' && hasProject && <CriteriaDialog close={close} />}
      {dialog === 'sheetSettings' && hasProject && <SheetSettingsDialog close={close} />}
      {dialog === 'annotation' && hasProject && <AnnotationDialog close={close} />}
      {dialog === 'attachments' && hasProject && <AttachmentsDialog close={close} />}
      {dialog === 'materials' && hasProject && <MaterialsDialog close={close} />}
      {dialog === 'reports' && hasProject && <ReportsDialog close={close} />}
      {dialog === 'gettingStarted' && <GettingStartedDialog close={close} />}
      {confirm && (
        <Modal
          title={confirm.title} onClose={() => confirm.resolve(false)} width={440} isConfirm
          footer={<>
            <button className="btn" onClick={() => confirm.resolve(false)}>Cancel</button>
            <button className={`btn ${confirm.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => confirm.resolve(true)}>{confirm.confirmLabel}</button>
          </>}
        >
          {confirm.message}
        </Modal>
      )}
    </>
  );
}
