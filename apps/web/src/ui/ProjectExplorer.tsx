import { openDemoLine } from '../commands/demo';
import { useState } from 'react';
import { projectStats } from '@tlcad/model';
import { useApp, type Selection } from '../store/appStore';
import { commands } from '../commands/menus';

interface Node {
  id: string;
  label: string;
  count?: number;
  children?: Node[];
}

export function ProjectExplorer() {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const select = useApp((s) => s.select);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!project) {
    return (
      <>
        <div className="panel-title">Project Explorer</div>
        <div className="panel-body">
          <div className="empty-note">
            No project is open.<br />
            <button className="link-btn" onClick={() => { void commands.newProject(); }}>Create a new project</button>
            {' or '}
            <button className="link-btn" onClick={() => { void commands.openProject(); }}>open an existing one</button>.
            <div style={{ marginTop: 10 }}>
              New to TLCAD? <button className="link-btn" onClick={() => useApp.getState().openDialog('gettingStarted')}>Getting started</button>{' · '}
              <button className="link-btn" onClick={() => { void openDemoLine(); }}>open the Demo Line sample</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const st = projectStats(project);
  const tree: Node[] = [
    { id: 'terrain', label: 'Terrain', children: [
      { id: 'terrain.points', label: 'Survey Points', count: st.terrainPoints },
      { id: 'terrain.features', label: 'Feature Codes', count: st.featureCodes },
      { id: 'terrain.breaklines', label: 'Break Lines', count: project.terrain.breakLines.length },
    ] },
    { id: 'alignments', label: 'Alignments', count: st.alignments },
    { id: 'criteria', label: 'Design Criteria', children: [
      { id: 'criteria.weather', label: 'Weather Cases', count: st.weatherCases },
    ] },
    { id: 'cables', label: 'Conductors and Ground Wires', count: st.cables },
    { id: 'structureLibrary', label: 'Structure Library', count: st.structureTypes },
    { id: 'structures', label: 'Structures on Line', count: st.structures },
    { id: 'sections', label: 'Tension Sections', count: st.sections },
    { id: 'constraints', label: 'Spotting Constraints', count: project.constraints.length },
    { id: 'drawings', label: 'Drawings', count: st.drawings },
  ];

  const isSel = (s: Selection) =>
    selection !== null && s !== null && selection.kind === s.kind &&
    (selection.kind !== 'node' || (s.kind === 'node' && selection.id === s.id));

  const row = (label: string, sel: Selection, depth: number, opts: { count?: number; root?: boolean; twist?: string; onTwist?: () => void } = {}) => (
    <div
      key={label + depth}
      className={`tree-row ${opts.root ? 'root' : ''} ${isSel(sel) ? 'sel' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => select(sel)}
    >
      <span className="twist" onClick={(e) => { if (opts.onTwist) { e.stopPropagation(); opts.onTwist(); } }}>{opts.twist ?? ''}</span>
      <span>{label}</span>
      {opts.count !== undefined && <span className="count">{opts.count}</span>}
    </div>
  );

  const render = (n: Node, depth: number): React.ReactNode => {
    const closed = collapsed[n.id];
    return (
      <div key={n.id}>
        {row(n.label, { kind: 'node', id: n.id, label: n.label }, depth, {
          ...(n.count !== undefined ? { count: n.count } : {}),
          ...(n.children ? { twist: closed ? '▶' : '▼', onTwist: () => setCollapsed((c) => ({ ...c, [n.id]: !closed })) } : {}),
        })}
        {!closed && n.children?.map((c) => render(c, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <div className="panel-title">Project Explorer</div>
      <div className="panel-body">
        <div className="tree">
          {row(project.meta.name, { kind: 'project' }, 0, { root: true })}
          {row('Units and Settings', { kind: 'settings' }, 1)}
          {tree.map((n) => render(n, 1))}
        </div>
      </div>
    </>
  );
}
