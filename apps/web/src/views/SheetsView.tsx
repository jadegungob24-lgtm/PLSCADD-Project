import { useMemo, useState } from 'react';
import { pageToSvg } from '@tlcad/io';
import { useApp } from '../store/appStore';
import { stationText, useDerived } from '../store/derived';
import { buildSheets } from '../drafting/sheets';
import { exportSheets } from '../commands/drafting';

/**
 * Sheets workspace (manual §13): the plan & profile sheets of the line,
 * redrawn from the design as it changes (§13.2), with page navigation and
 * export to PDF, DXF and SVG.
 */
export function SheetsView() {
  const project = useApp((s) => s.project);
  const openDialog = useApp((s) => s.openDialog);
  const d = useDerived();
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  // Only the page shown is drawn; paging itself is cheap (§13.2: sheets are redrawn as the design changes).
  const k0 = page;
  const set = useMemo(() => (project ? buildSheets(project, d, { only: k0 }) : null), [project, d, k0]);
  if (!project || !set) return <div className="placeholder"><div className="box">No project is open.</div></div>;
  const n = set.pages.length;
  const k = Math.min(page, Math.max(0, n - 1));
  if (k !== page) setPage(k);
  const info = set.sheets[k];
  const svg = n ? pageToSvg(set.pages[k]!, { pixelWidth: 1 }).replace(' width="1"', ' width="100%"') : '';
  const s = project.drafting.sheets;
  return (
    <div className="st-view">
      <div className="st-head">
        <button className="btn small" disabled={k <= 0} onClick={() => setPage(k - 1)}>◀</button>
        <span>Sheet {n ? k + 1 : 0} of {n}</span>
        <button className="btn small" disabled={k >= n - 1} onClick={() => setPage(k + 1)}>▶</button>
        {info && <span className="muted">{stationText(project, info.from)} – {stationText(project, info.to)} · structures {info.firstStructure || '—'} to {info.lastStructure || '—'}{info.cut ? ' · profile cut' : ''}</span>}
        <div style={{ flex: 1 }} />
        <label className="muted">Zoom <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{[0.5, 0.75, 1, 1.5, 2, 3].map((z) => <option key={z} value={z}>{z * 100} %</option>)}</select></label>
        <button className="btn small" onClick={() => openDialog('sheetSettings')}>Sheet setup…</button>
        <button className="btn small" onClick={() => openDialog('annotation')}>Annotation…</button>
        <button className="btn small" disabled={!n} onClick={() => exportSheets('pdf')}>PDF (all)</button>
        <button className="btn small" disabled={!n} onClick={() => exportSheets('dxf')}>DXF (all)</button>
        <button className="btn small" disabled={!n} onClick={() => exportSheets('dxf', k)}>DXF (this)</button>
        <button className="btn small" disabled={!n} onClick={() => exportSheets('svg', k)}>SVG (this)</button>
      </div>
      <div className="st-body" style={{ background: '#8a9099' }}>
        {set.problems.length > 0 && <ul className="err-list" style={{ background: '#fff', padding: '6px 20px' }}>{set.problems.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        {n > 0 && (
          <div style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? 1400 * zoom : undefined, margin: '0 auto', boxShadow: '0 2px 10px rgba(0,0,0,.4)', background: '#fff', aspectRatio: `${s.page.width} / ${s.page.height}` }}
            dangerouslySetInnerHTML={{ __html: svg }} />
        )}
        <div className="muted" style={{ color: '#f2f4f6', marginTop: 8, fontSize: 11 }}>
          Page {s.page.width} × {s.page.height} mm, H 1:{Math.round(s.hScale * 100)}, V 1:{Math.round(s.vScale * 100)}. Long-axis plan layout; aerial plan layout and profile elevation breaks are not implemented.
        </div>
      </div>
    </div>
  );
}
