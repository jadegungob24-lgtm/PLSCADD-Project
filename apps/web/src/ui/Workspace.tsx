import { useApp, VIEW_LABEL, type ViewKind } from '../store/appStore';
import { Canvas2D } from '../views/Canvas2D';
import { View3D } from '../views/View3D';
import { MapView } from '../views/MapView';
import { StructureView } from '../views/StructureView';
import { SagTensionView } from '../views/SagTensionView';
import { ClearanceView } from '../views/ClearanceView';
import { SheetsView } from '../views/SheetsView';

const VIEWS: ViewKind[] = ['plan', 'profile', '3d', 'map', 'sagtension', 'structure', 'clearance', 'sheets'];

function ViewBody({ view }: { view: ViewKind }) {
  switch (view) {
    case 'plan': return <Canvas2D mode="plan" />;
    case 'profile': return <Canvas2D mode="profile" />;
    case '3d': return <View3D />;
    case 'map': return <MapView />;
    case 'structure': return <StructureView />;
    case 'sagtension': return <SagTensionView />;
    case 'sheets': return <SheetsView />;
    default: return <ClearanceView />;
  }
}

export function Workspace() {
  const panes = useApp((s) => s.panes);
  const tile = useApp((s) => s.tile);
  const activePane = useApp((s) => s.activePane);
  const setPaneView = useApp((s) => s.setPaneView);
  const setActivePane = useApp((s) => s.setActivePane);

  return (
    <div className={`workspace ${tile}`}>
      {panes.map((view, i) => (
        <div key={i} className={`pane ${i === activePane && panes.length > 1 ? 'active' : ''}`} onPointerDownCapture={() => { if (i !== activePane) setActivePane(i); }}>
          <div className="pane-tabs">
            {VIEWS.map((v) => (
              <button key={v} className={`pane-tab ${v === view ? 'active' : ''}`} onClick={() => setPaneView(i, v)}>{VIEW_LABEL[v]}</button>
            ))}
          </div>
          {/* key forces a fresh view instance when the pane switches view type */}
          <div className="pane-body" key={view}><ViewBody view={view} /></div>
        </div>
      ))}
    </div>
  );
}
