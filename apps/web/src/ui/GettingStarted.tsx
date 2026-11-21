import type { Project } from '@tlcad/model';
import { useApp, type DialogKind, type Tool, type ViewKind } from '../store/appStore';
import { useDerived, type DerivedView } from '../store/derived';
import { openDemoLine } from '../commands/demo';
import { Modal } from './Dialogs';

/**
 * Help ▸ Getting Started: the design workflow in order (manual §5), each step
 * with the command that performs it and whether the open project has done it.
 */

interface Step {
  title: string;
  where: string;
  done: (p: Project | null, d: DerivedView) => boolean;
  dialog?: DialogKind;
  view?: ViewKind;
  tool?: Tool;
  optional?: boolean;
}

const STEPS: Step[] = [
  { title: 'Create a project and choose its units', where: 'File ▸ New Project', dialog: 'new', done: (p) => !!p },
  { title: 'Set the coordinate system', where: 'Project ▸ Coordinate System', dialog: 'crs', optional: true, done: (p) => !!p?.settings.crs },
  { title: 'Import the survey', where: 'Terrain ▸ Import XYZ / CSV / Excel / PFL / DEM / LAS, or Paste Points from Excel', view: 'plan', done: (p) => (p?.terrain.points.length ?? 0) > 0 },
  { title: 'Feature codes and required clearances', where: 'Terrain ▸ Feature Codes and Clearances', dialog: 'featureCodes', done: (p) => !!p?.terrain.featureCodes.some((c) => Object.values(c.clearances).some((r) => r.rv !== null)) },
  { title: 'Draw the alignment (P.I.s)', where: 'Plan view ▸ Add P.I. tool', view: 'plan', tool: 'addPi', done: (_p, d) => d.lines.some((l) => l.geom) },
  { title: 'Cables (conductors and ground wires)', where: 'Conductor ▸ Cable Library', dialog: 'cables', done: (p) => (p?.cableLibrary.length ?? 0) > 0 },
  { title: 'Structure types', where: 'Structure ▸ Structure Library', dialog: 'structureTypes', done: (p) => (p?.structureLibrary.length ?? 0) > 0 },
  { title: 'Design criteria: weather, limits, conditions', where: 'Criteria ▸ Weather Cases…', dialog: 'criteria', done: (p) => (p?.criteria.weatherCases.length ?? 0) > 0 },
  { title: 'Spot structures', where: 'Structure ▸ Spot Structures, or Add Str in the profile', dialog: 'spot', done: (p) => (p?.structures.length ?? 0) > 0 },
  { title: 'String tension sections', where: 'Conductor ▸ String Section', dialog: 'stringing', done: (p) => (p?.sections.length ?? 0) > 0 },
  { title: 'Sag the sections', where: 'Section properties ▸ Automatic sagging / Graphical sag', view: 'profile', done: (_p, d) => d.analysis.sections.size > 0 && [...d.analysis.sections.values()].every((s) => s.status === 'sagged') },
  { title: 'Check sag-tension, spans, swing and strength', where: 'Sag-Tension workspace', view: 'sagtension', done: () => false },
  { title: 'Check clearances', where: 'Clearance workspace ▸ Run check', view: 'clearance', done: () => false },
  { title: 'Plan & profile sheets', where: 'Sheets workspace, Drafting ▸ Sheet Setup', view: 'sheets', done: () => false },
  { title: 'Reports and bill of material', where: 'Reports ▸ Reports', dialog: 'reports', done: () => false },
];

export function GettingStartedDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project);
  const d = useDerived();
  const go = (s: Step) => {
    const a = useApp.getState();
    close();
    if (s.view) a.showView(s.view);
    if (s.tool) a.setTool(s.tool);
    if (s.dialog) a.openDialog(s.dialog);
  };
  return (
    <Modal title="Getting Started — Design Workflow" onClose={close} width={760}
      footer={<>
        <button className="btn" onClick={() => { close(); void openDemoLine(); }}>Open the Demo Line sample</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={close}>Close</button>
      </>}>
      <table className="grid">
        <thead><tr><th /><th>Step</th><th>Where</th><th /></tr></thead>
        <tbody>
          {STEPS.map((s, i) => {
            const done = s.done(project, d);
            const needsProject = i > 0 && !project;
            return (
              <tr key={s.title}>
                <td style={{ color: done ? 'var(--ok, #2a7a3a)' : '#999', fontWeight: 700 }}>{done ? '✓' : i + 1}</td>
                <td>{s.title}{s.optional ? <span className="muted"> (optional)</span> : null}</td>
                <td className="muted">{s.where}</td>
                <td><button className="btn small" disabled={needsProject} onClick={() => go(s)}>Go</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
        Every engineering value is entered by you from the governing code, specification or manufacturer data; the program supplies none.
        The Demo Line sample builds a short line through these steps with illustrative data only. Help ▸ Feature Status lists what is
        implemented, partial, or not available.
      </div>
    </Modal>
  );
}
