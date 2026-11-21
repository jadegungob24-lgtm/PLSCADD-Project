import { formatQuantity, UNIT_SYSTEM_LABEL, type UnitSystem } from '@tlcad/engine';
import { featureById, FEATURE_STATUS_LABEL, type Project } from '@tlcad/model';
import { useApp } from '../store/appStore';
import { Legend, NumProp, ReadOnly, SelectProp, TextProp } from './props';
import { AlignmentProps, TerrainSettingsProps, TerrainSummary } from './TerrainProps';
import { LineSummary, SectionProps, StructureProps } from './LineProps';

function ProjectInfo({ project }: { project: Project }) {
  const exec = useApp((s) => s.exec);
  const m = project.meta;
  const set = (label: string, fn: (d: Project) => void) => exec(label, fn as never);
  return (
    <div className="props">
      <h4>Project information</h4>
      <TextProp label="Name" value={m.name} required onCommit={(v) => set('Rename project', (d) => { d.meta.name = v.trim(); })} />
      <TextProp label="Line name" value={m.lineName} onCommit={(v) => set('Edit line name', (d) => { d.meta.lineName = v; })} />
      <TextProp label="Client" value={m.client} onCommit={(v) => set('Edit client', (d) => { d.meta.client = v; })} />
      <TextProp label="Engineer" value={m.engineer} onCommit={(v) => set('Edit engineer', (d) => { d.meta.engineer = v; })} />
      <NumProp
        label="Nominal voltage" unit="kV" nullable value={m.nominalVoltageKV?.v ?? null} src={m.nominalVoltageKV?.src ?? 'user'}
        check={(v) => (v > 0 && v <= 1500 ? null : 'Voltage must be between 0 and 1500 kV.')}
        onCommit={(v) => set('Edit nominal voltage', (d) => { d.meta.nominalVoltageKV = v === null ? null : { v, src: 'user' }; })}
      />
      <TextProp label="Description" multiline value={m.description} onCommit={(v) => set('Edit description', (d) => { d.meta.description = v; })} />
      <h4>Record</h4>
      <ReadOnly label="Created" value={new Date(m.createdAt).toLocaleString()} />
      <ReadOnly label="Last saved" value={new Date(m.modifiedAt).toLocaleString()} />
      <ReadOnly label="Project id" value={project.id} />
      <ReadOnly label="Schema" value={`v${project.schemaVersion}`} />
      <Legend />
    </div>
  );
}

function Settings({ project }: { project: Project }) {
  const exec = useApp((s) => s.exec);
  const openDialog = useApp((s) => s.openDialog);
  const s = project.settings;
  const set = (label: string, fn: (d: Project) => void) => exec(label, fn as never);
  return (
    <div className="props">
      <h4>Units</h4>
      <SelectProp<UnitSystem>
        label="Unit system" value={s.unitSystem}
        options={(Object.keys(UNIT_SYSTEM_LABEL) as UnitSystem[]).map((k) => [k, UNIT_SYSTEM_LABEL[k]])}
        onCommit={(v) => set('Change unit system', (d) => { d.settings.unitSystem = v; })}
      />
      <div className="muted" style={{ margin: '2px 0 6px' }}>
        Values are stored in SI units; changing the unit system only changes how they are displayed and entered.
      </div>
      <h4>Preferences</h4>
      <SelectProp
        label="Stations" value={s.stationDisplay} options={[['true', 'True stations'], ['equation', 'Equation stations']]}
        onCommit={(v) => set('Change station display', (d) => { d.settings.stationDisplay = v; })}
      />
      <SelectProp
        label="Sag wires by" value={s.sagBy} options={[['tension', 'Horizontal tension'], ['catenary', 'Catenary constant']]}
        onCommit={(v) => set('Change sagging preference', (d) => { d.settings.sagBy = v; })}
      />
      <NumProp
        label="Profile aspect" value={s.profileAspectRatio} src="user"
        check={(v) => (v >= 1 && v <= 100 ? null : 'Aspect ratio must be between 1 and 100.')}
        onCommit={(v) => { if (v !== null) set('Change profile aspect ratio', (d) => { d.settings.profileAspectRatio = v; }); }}
      />
      <TerrainSettingsProps project={project} />
      <h4>Coordinate system</h4>
      <ReadOnly label="CRS" value={s.crs ? s.crs.name : 'Not defined'} />
      <button className="btn small" onClick={() => openDialog('crs')}>Define or reproject…</button>
      <Legend />
    </div>
  );
}

const NODE_FEATURE: Record<string, string> = {
  criteria: 'E1', 'criteria.weather': 'E1', constraints: 'SP3', drawings: 'D1',
};

function NodeInfo({ id, label, project }: { id: string; label: string; project: Project }) {
  if (id === 'alignments') return <AlignmentProps project={project} />;
  if (id === 'structures') return <LineSummary project={project} kind="structures" />;
  if (id === 'sections') return <LineSummary project={project} kind="sections" />;
  if (id === 'cables' || id === 'structureLibrary') return <LibrarySummary project={project} kind={id} />;
  if (id === 'terrain' || id === 'terrain.points' || id === 'terrain.features' || id === 'terrain.breaklines') return <TerrainSummary project={project} />;
  const f = featureById(NODE_FEATURE[id] ?? '');
  return (
    <div className="props">
      <h4>{label}</h4>
      {f ? (
        <>
          <ReadOnly label="Function" value={f.name} />
          <ReadOnly label="Status" value={FEATURE_STATUS_LABEL[f.status]} />
          <ReadOnly label="Planned phase" value={f.phase ? `Phase ${f.phase}` : '—'} />
          <ReadOnly label="Reference" value={`PLS-CADD manual ${f.ref}`} />
          <div className="muted" style={{ marginTop: 8 }}>
            This part of the project is empty. Its editing tools are added in the phase shown above.
          </div>
        </>
      ) : <div className="muted">No properties.</div>}
    </div>
  );
}

export function PropertiesPanel() {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  let body: React.ReactNode = <div className="empty-note">Select an item in the Project Explorer or a view to see its properties.</div>;
  if (project && selection) {
    if (selection.kind === 'project') body = <ProjectInfo project={project} />;
    else if (selection.kind === 'settings') body = <Settings project={project} />;
    else if (selection.kind === 'structure') body = <StructureProps project={project} id={selection.id} />;
    else if (selection.kind === 'section') body = <SectionProps id={selection.id} />;
    else if (selection.kind === 'structureType') body = <NodeInfo id="structureLibrary" label="Structure Library" project={project} />;
    else body = <NodeInfo id={selection.id} label={selection.label} project={project} />;
  }
  return (
    <>
      <div className="panel-title">Properties</div>
      <div className="panel-body">{body}</div>
    </>
  );
}

function LibrarySummary({ project, kind }: { project: Project; kind: 'cables' | 'structureLibrary' }) {
  const openDialog = useApp((s) => s.openDialog);
  const sys = project.settings.unitSystem;
  if (kind === 'cables') {
    return (
      <div className="props">
        <h4>Conductors and ground wires ({project.cableLibrary.length})</h4>
        <button className="btn small" onClick={() => openDialog('cables')} style={{ marginBottom: 6 }}>Cable library…</button>
        <table className="grid">
          <thead><tr><th>Name</th><th>Model</th><th>Diameter</th></tr></thead>
          <tbody>
            {project.cableLibrary.map((c) => (
              <tr key={c.id}><td>{c.name}</td><td>{c.model === 'nonlinear' ? (c.core ? 'Nonlinear, bimetallic' : 'Nonlinear') : 'Linear'}</td><td className="mono">{formatQuantity(c.diameter, sys, 'smallLength')}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="props">
      <h4>Structure library ({project.structureLibrary.length})</h4>
      <button className="btn small" onClick={() => openDialog('structureTypes')} style={{ marginBottom: 6 }}>Structure library…</button>
      <table className="grid">
        <thead><tr><th>Name</th><th>Height</th><th>Sets</th><th>Strength</th></tr></thead>
        <tbody>
          {project.structureLibrary.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td className="mono">{formatQuantity(t.height, sys, 'length')}</td>
              <td className="mono">{new Set(t.attachments.map((a) => a.set)).size}</td>
              <td>{t.strength.method === 'method1' ? 'Method 1' : 'none'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}