import { formatQuantity, unitLabel, UNIT_SYSTEM_LABEL } from '@tlcad/engine';
import { stationText } from '../store/derived';
import { TOOL_LABEL, useApp } from '../store/appStore';

export function StatusBar() {
  const project = useApp((s) => s.project);
  const cursor = useApp((s) => s.cursor);
  const tool = useApp((s) => s.activeTool);
  const dirty = useApp((s) => s.dirty);
  const stored = useApp((s) => s.stored);
  const dbInfo = useApp((s) => s.dbInfo);
  const ready = useApp((s) => s.ready);

  const sys = project?.settings.unitSystem ?? 'SI_N';
  const len = (v: number | null) => (v === null ? '—' : formatQuantity(v, sys, 'length', 2, false));
  const lu = unitLabel(sys, 'length');

  const state = !project
    ? { dot: 'off', text: 'No project' }
    : dirty
      ? { dot: 'warn', text: stored ? 'Modified' : 'Not saved' }
      : { dot: 'ok', text: 'Saved' };

  return (
    <div className="statusbar">
      <div className="sb-cell"><span className="k">X</span><span className="v">{len(cursor.x)}</span></div>
      <div className="sb-cell"><span className="k">Y</span><span className="v">{len(cursor.y)}</span></div>
      <div className="sb-cell">
        <span className="k">Sta</span>
        <span className="v">{cursor.station === null || !project ? '—' : stationText(project, cursor.station)}</span>
      </div>
      <div className="sb-cell"><span className="k">Off</span><span className="v">{len(cursor.offset)}</span></div>
      <div className="sb-cell"><span className="k">Z</span><span className="v">{len(cursor.elevation)}</span></div>
      <div className="sb-cell"><span className="k">{lu}</span></div>
      <div className="sb-cell"><span className="k">Tool</span>{TOOL_LABEL[tool]}</div>
      <div className="sb-grow" />
      {project && <div className="sb-cell" title={project.settings.crs?.definition ?? 'No coordinate system defined'}>{project.settings.crs?.name ?? 'No CRS'}</div>}
      {project && <div className="sb-cell">{UNIT_SYSTEM_LABEL[sys]}</div>}
      <div className="sb-cell" title={dbInfo?.storage ?? ''}>
        <span className={`dot ${!ready ? 'off' : dbInfo?.persistent ? 'ok' : 'warn'}`} />
        {!ready ? 'Database starting…' : dbInfo ? (dbInfo.persistent ? 'Database: persistent' : 'Database: memory only') : 'Database unavailable'}
      </div>
      <div className="sb-cell"><span className={`dot ${state.dot}`} />{state.text}</div>
    </div>
  );
}
