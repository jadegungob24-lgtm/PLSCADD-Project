import type { ReactNode } from 'react';
import { canRedo, canUndo } from '@tlcad/model';
import { TOOL_LABEL, useApp, VIEW_LABEL, type TileMode, type Tool, type ViewKind } from '../store/appStore';
import { commands } from '../commands/menus';

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ICON = {
  new: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
  open: 'M1.5 4.5h4l1.5 1.5h7.5v7h-13zM1.5 4.5v8.5',
  save: 'M2.5 2.5h9l2 2v9h-11zM5 2.5v4h5v-4M5 13.5v-4h6v4',
  undo: 'M6 4L2.5 7.5 6 11M2.5 7.5H10a3.5 3.5 0 010 7H8',
  redo: 'M10 4l3.5 3.5L10 11M13.5 7.5H6a3.5 3.5 0 000 7h2',
  fit: 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4M5.5 5.5h5v5h-5z',
  single: 'M2.5 2.5h11v11h-11z',
  vertical: 'M2.5 2.5h11v11h-11zM8 2.5v11',
  horizontal: 'M2.5 2.5h11v11h-11zM2.5 8h11',
  quad: 'M2.5 2.5h11v11h-11zM8 2.5v11M2.5 8h11',
  rev: 'M8 4v4l2.5 2M2.5 8a5.5 5.5 0 105.5-5.5H5.5M5.5 2.5L3 5M5.5 2.5V5.5',
};

function Btn(p: { title: string; icon?: keyof typeof ICON; onClick: () => void; disabled?: boolean; active?: boolean; children?: ReactNode }) {
  return (
    <button className={`tb-btn ${p.active ? 'active' : ''}`} title={p.title} onClick={p.onClick} disabled={p.disabled}>
      {p.icon && <Icon d={ICON[p.icon]} />}
      {p.children}
    </button>
  );
}

export function Toolbar() {
  const project = useApp((s) => s.project);
  const history = useApp((s) => s.history);
  const tile = useApp((s) => s.tile);
  const panes = useApp((s) => s.panes);
  const activePane = useApp((s) => s.activePane);
  const tool = useApp((s) => s.activeTool);
  const app = useApp.getState;
  const has = project !== null;
  const tiles: TileMode[] = ['single', 'vertical', 'horizontal', 'quad'];
  const views: ViewKind[] = ['plan', 'profile', '3d', 'map', 'sagtension', 'structure', 'clearance', 'sheets'];

  return (
    <div className="toolbar">
      <Btn title="New project (Alt+N)" icon="new" onClick={() => { void commands.newProject(); }} />
      <Btn title="Open project (Ctrl+O)" icon="open" onClick={() => { void commands.openProject(); }} />
      <Btn title="Save (Ctrl+S)" icon="save" onClick={commands.save} disabled={!has} />
      <Btn title="Revisions" icon="rev" onClick={() => app().openDialog('revisions')} disabled={!has} />
      <div className="tb-sep" />
      <Btn title="Undo (Ctrl+Z)" icon="undo" onClick={commands.undo} disabled={!canUndo(history)} />
      <Btn title="Redo (Ctrl+Y)" icon="redo" onClick={commands.redo} disabled={!canRedo(history)} />
      <div className="tb-sep" />
      <Btn title="Zoom extents (Home)" icon="fit" onClick={() => app().zoomExtents()} />
      <div className="tb-sep" />
      {(['select', 'addPi', 'insertPi', 'movePi', 'deletePi', 'addStructure', 'moveStructure', 'deleteStructure'] as Tool[]).map((t) => (
        <Btn
          key={t} title={`${TOOL_LABEL[t]}${t === 'select' ? '' : ` — ${t.endsWith('Structure') ? 'profile' : 'plan'} view; right-click or Esc to finish`}`}
          active={tool === t} disabled={!has}
          onClick={() => {
            if (t === 'addStructure' && !app().spotTypeId) { app().openDialog('spot'); return; }
            if (t.endsWith('Structure')) app().showView('profile'); else if (t !== 'select') app().showView('plan');
            app().setTool(t);
          }}
        >
          {t === 'select' ? 'Select' : TOOL_LABEL[t].replace(' P.I.', ' PI').replace(' Structure', ' Str')}
        </Btn>
      ))}
      <div className="tb-sep" />
      {views.map((v) => (
        <Btn key={v} title={`Show ${VIEW_LABEL[v]} view`} active={panes[activePane] === v} onClick={() => app().showView(v)}>
          {VIEW_LABEL[v]}
        </Btn>
      ))}
      <div className="tb-sep" />
      {tiles.map((t) => (
        <Btn key={t} title={`Layout: ${t}`} icon={t} active={tile === t} onClick={() => app().setTile(t)} />
      ))}
      <div className="tb-spacer" />
    </div>
  );
}
