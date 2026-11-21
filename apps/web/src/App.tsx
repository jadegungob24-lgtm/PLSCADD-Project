import { useEffect, useRef, useState } from 'react';
import { useApp } from './store/appStore';
import { handleShortcut } from './commands/menus';
import { MenuBar } from './ui/MenuBar';
import { Toolbar } from './ui/Toolbar';
import { StatusBar } from './ui/StatusBar';
import { ProjectExplorer } from './ui/ProjectExplorer';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { LogPanel } from './ui/LogPanel';
import { Workspace } from './ui/Workspace';
import { Dialogs } from './ui/Dialogs';

/** Drag handle that resizes a neighbouring panel. */
function Splitter({ dir, onDrag }: { dir: 'v' | 'h'; onDrag: (deltaPx: number) => void }) {
  const last = useRef(0);
  return (
    <div
      className={`splitter ${dir}`}
      onPointerDown={(e) => {
        last.current = dir === 'v' ? e.clientX : e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const pos = dir === 'v' ? e.clientX : e.clientY;
        onDrag(pos - last.current);
        last.current = pos;
      }}
    />
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function App() {
  const init = useApp((s) => s.init);
  const dirty = useApp((s) => s.dirty);
  const projectName = useApp((s) => s.project?.meta.name);
  const [leftW, setLeftW] = useState(230);
  const [rightW, setRightW] = useState(280);
  const [bottomH, setBottomH] = useState(150);

  useEffect(() => { void init(); }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (handleShortcut(e)) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (useApp.getState().dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useEffect(() => {
    document.title = projectName ? `${dirty ? '● ' : ''}${projectName} — TLCAD` : 'TLCAD';
  }, [projectName, dirty]);

  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      <div className="main">
        <div className="side left" style={{ width: leftW }}>
          <ProjectExplorer />
        </div>
        <Splitter dir="v" onDrag={(d) => setLeftW((w) => clamp(w + d, 150, 480))} />
        <div className="center">
          <Workspace />
          <Splitter dir="h" onDrag={(d) => setBottomH((h) => clamp(h - d, 60, 480))} />
          <div className="bottom" style={{ height: bottomH }}>
            <LogPanel />
          </div>
        </div>
        <Splitter dir="v" onDrag={(d) => setRightW((w) => clamp(w - d, 200, 520))} />
        <div className="side right" style={{ width: rightW }}>
          <PropertiesPanel />
        </div>
      </div>
      <StatusBar />
      <Dialogs />
    </div>
  );
}
