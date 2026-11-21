import { useState } from 'react';
import { formatDMS, formatQuantity, fromSI, toSI, unitLabel } from '@tlcad/engine';
import type { Project } from '@tlcad/model';
import { useApp } from '../store/appStore';
import { stationText, useDerived } from '../store/derived';
import {
  autoAlignment, deleteAlignment, deleteBreakLines, deleteSmallAngles, moveAlignment, newAlignment, reverseAlignment,
} from '../commands/terrain';
import { Legend, QuantityProp, ReadOnly, SelectProp, SrcTag, TextProp, tidy } from './props';

type Set = (label: string, fn: (d: Project) => void) => void;
const useSet = (): Set => {
  const exec = useApp((s) => s.exec);
  return (label, fn) => exec(label, fn as never);
};

/** Terrain widths, side profiles and TIN settings (manual §6.3.2, §6.10.1, §6.4.2–6.4.3). */
export function TerrainSettingsProps({ project }: { project: Project }) {
  const set = useSet();
  const sys = project.settings.unitSystem;
  const t = project.settings.terrain;
  const pos = (v: number) => (v > 0 ? null : 'Must be greater than zero.');
  return (
    <>
      <h4>Terrain widths</h4>
      <QuantityProp
        label="Max offset, profile view" sys={sys} dim="length" valueSI={t.mopv}
        check={(v) => pos(v) ?? (v < t.mocgp ? 'Must not be smaller than the centerline offset.' : null)}
        onCommit={(v) => { if (v !== null) set('Change profile view width', (d) => { d.settings.terrain.mopv = v; }); }}
      />
      <QuantityProp
        label="Max offset, centerline profile" sys={sys} dim="length" valueSI={t.mocgp}
        check={(v) => pos(v) ?? (v > t.mopv ? 'Must not exceed the profile view offset.' : null)}
        onCommit={(v) => { if (v !== null) set('Change centerline profile width', (d) => { d.settings.terrain.mocgp = v; }); }}
      />
      <h4>Side profiles</h4>
      {t.sideProfiles.map((sp, i) => (
        <div key={i} style={{ borderLeft: '2px solid #c9a54a', paddingLeft: 6, marginBottom: 6 }}>
          <QuantityProp label="Offset" sys={sys} dim="length" valueSI={sp.offset}
            onCommit={(v) => { if (v !== null) set('Edit side profile', (d) => { d.settings.terrain.sideProfiles[i]!.offset = v; }); }} />
          <QuantityProp label="Offset tolerance" sys={sys} dim="length" valueSI={sp.tolerance} check={pos}
            onCommit={(v) => { if (v !== null) set('Edit side profile', (d) => { d.settings.terrain.sideProfiles[i]!.tolerance = v; }); }} />
          <QuantityProp label="Max separation" sys={sys} dim="length" valueSI={sp.maxSeparation} check={pos}
            onCommit={(v) => { if (v !== null) set('Edit side profile', (d) => { d.settings.terrain.sideProfiles[i]!.maxSeparation = v; }); }} />
          <button className="btn small" onClick={() => set('Delete side profile', (d) => { d.settings.terrain.sideProfiles.splice(i, 1); })}>Remove</button>
        </div>
      ))}
      <button
        className="btn small"
        onClick={() => set('Add side profile', (d) => {
          // New side profile at the edge of the centerline band; the values are a starting point for the user to edit.
          d.settings.terrain.sideProfiles.push({ offset: d.settings.terrain.mopv / 2, tolerance: d.settings.terrain.mocgp, maxSeparation: 100 });
        })}
      >
        Add side profile
      </button>
      <h4>TIN ground surface</h4>
      <SelectProp
        label="Use TIN" value={t.tinEnabled ? 'yes' : 'no'} options={[['no', 'No'], ['yes', 'Yes']]}
        onCommit={(v) => set('Toggle TIN', (d) => { d.settings.terrain.tinEnabled = v === 'yes'; })}
      />
      <QuantityProp
        label="Max triangle edge" sys={sys} dim="length" valueSI={t.tinMaxEdge} nullable check={pos}
        onCommit={(v) => set('Change TIN edge limit', (d) => { d.settings.terrain.tinMaxEdge = v; })}
      />
      <QuantityProp
        label="Contour interval" sys={sys} dim="length" valueSI={t.contourInterval} nullable check={pos}
        onCommit={(v) => set('Change contour interval', (d) => { d.settings.terrain.contourInterval = v; })}
      />
      <div className="muted">
        With the TIN on, ground profiles are cut through the triangulated surface and break lines are enforced as triangle edges.
        With it off, the centerline profile joins the ground points within the centerline offset in order of station. Leave the
        edge limit or contour interval blank for none.
      </div>
    </>
  );
}

/** Station equations editor (manual §6.11). */
function StationEquations({ project }: { project: Project }) {
  const set = useSet();
  const sys = project.settings.unitSystem;
  const eqs = project.settings.terrain.stationEquations;
  const [ts, setTs] = useState('');
  const [es, setEs] = useState('');
  const [dir, setDir] = useState<'ahead' | 'back'>('ahead');
  const tv = Number(ts), ev = Number(es);
  const ok = ts.trim() !== '' && es.trim() !== '' && Number.isFinite(tv) && Number.isFinite(ev);
  const show = (v: number) => tidy(fromSI(v, sys, 'length'), 3);
  return (
    <>
      <h4>Station equations</h4>
      {eqs.length === 0 ? <div className="muted">None. Stations are true stations throughout.</div> : (
        <table className="grid">
          <thead><tr><th>From true sta.</th><th>Equation sta.</th><th>Counting</th><th /></tr></thead>
          <tbody>
            {eqs.map((e, i) => (
              <tr key={i}>
                <td className="mono">{show(e.trueStation)}</td>
                <td className="mono">{show(e.equationStation)}</td>
                <td>{e.direction === 'ahead' ? 'Forward' : 'Backward'}</td>
                <td><button className="btn small" onClick={() => set('Delete station equation', (d) => { d.settings.terrain.stationEquations.splice(i, 1); })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 4, margin: '6px 0', alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ width: 74 }} placeholder={`true (${unitLabel(sys, 'length')})`} value={ts} onChange={(e) => setTs(e.target.value)} inputMode="decimal" />
        <input style={{ width: 74 }} placeholder="equation" value={es} onChange={(e) => setEs(e.target.value)} inputMode="decimal" />
        <select value={dir} onChange={(e) => setDir(e.target.value as 'ahead' | 'back')}><option value="ahead">Forward</option><option value="back">Backward</option></select>
        <button
          className="btn small" disabled={!ok}
          onClick={() => {
            set('Add station equation', (d) => {
              d.settings.terrain.stationEquations.push({ trueStation: toSI(tv, sys, 'length'), equationStation: toSI(ev, sys, 'length'), direction: dir });
              d.settings.terrain.stationEquations.sort((a, b) => a.trueStation - b.trueStation);
            });
            setTs(''); setEs('');
          }}
        >Add</button>
      </div>
      <SelectProp
        label="Show stations as" value={project.settings.stationDisplay} options={[['true', 'True stations'], ['equation', 'Equation stations']]}
        onCommit={(v) => set('Change station display', (d) => { d.settings.stationDisplay = v; })}
      />
    </>
  );
}

/** Alignments: list, P.I. table of the active one, ordering in the virtual profile, station equations and tools. */
export function AlignmentProps({ project }: { project: Project }) {
  const set = useSet();
  const setTool = useApp((s) => s.setTool);
  const showView = useApp((s) => s.showView);
  const setActive = useApp((s) => s.setActiveAlignment);
  const d = useDerived();
  const sys = project.settings.unitSystem;
  const [angle, setAngle] = useState('1');
  const codes = project.terrain.featureCodes;
  const [autoCode, setAutoCode] = useState<number | ''>('');
  const len = (v: number) => formatQuantity(v, sys, 'length', 2, false);
  const line = d.line;

  const tools = (
    <>
      <h4>Create</h4>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn small" onClick={newAlignment}>New alignment</button>
        {line && <button className="btn small" onClick={() => { showView('plan'); setTool('addPi'); }}>Add PI</button>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <span className="muted">Through points with code</span>
        <select value={autoCode} onChange={(e) => setAutoCode(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">—</option>
          {codes.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
        </select>
        <button className="btn small" disabled={autoCode === ''} onClick={() => { if (autoCode !== '') autoAlignment(autoCode); }}>Create</button>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        A branch starts on a P.I. of an existing alignment and a loop also ends on one: with Add PI, clicks snap to existing P.I.s.
      </div>
    </>
  );

  if (!line) {
    return (
      <div className="props">
        <h4>Alignments</h4>
        <div className="muted" style={{ marginBottom: 8 }}>
          No alignment is defined. Choose Add PI and click the P.I. points in the Plan view; clicks snap to survey points.
        </div>
        <button className="btn small" onClick={() => { showView('plan'); setTool('addPi'); }}>Add PI</button>
        {tools}
      </div>
    );
  }
  const a = line.alignment;
  const g = line.geom;
  const many = d.lines.length > 1;
  return (
    <div className="props">
      <h4>Alignments ({d.lines.length})</h4>
      <table className="grid">
        <thead><tr><th>#</th><th>Name</th><th>P.I.s</th><th>From sta.</th><th>Length</th></tr></thead>
        <tbody>
          {d.lines.map((l, i) => (
            <tr key={l.alignment.id} className={i === d.active ? 'rowsel' : ''} onClick={() => setActive(l.alignment.id)} style={{ cursor: 'pointer' }}>
              <td className="mono">A{i + 1}</td>
              <td>{l.alignment.name}</td>
              <td className="mono">{l.alignment.pis.length}</td>
              <td className="mono">{l.geom ? stationText(project, l.geom.startStation) : '—'}</td>
              <td className="mono">{l.geom ? len(l.geom.totalLength) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ margin: '4px 0' }}>
        {many
          ? 'The profile view shows the alignments in this order as one virtual alignment, separated by the station gap. Click a row to make it active.'
          : 'The P.I. tools act on this alignment.'}
      </div>

      <h4>Active: A{d.active + 1}</h4>
      <TextProp label="Name" value={a.name} required onCommit={(v) => set('Rename alignment', (dr) => { dr.alignments[d.active]!.name = v.trim(); })} />
      <QuantityProp
        label="Station of first P.I. (A1)" sys={sys} dim="length" valueSI={project.alignments[0]!.startStation}
        onCommit={(v) => { if (v !== null) set('Change start station', (dr) => { dr.alignments[0]!.startStation = v; }); }}
      />
      {many && (
        <QuantityProp
          label="Station gap between alignments" sys={sys} dim="length" valueSI={project.settings.terrain.alignmentGap}
          check={(v) => (v > 0 ? null : 'Must be greater than zero.')}
          onCommit={(v) => { if (v !== null) set('Change alignment gap', (dr) => { dr.settings.terrain.alignmentGap = v; }); }}
        />
      )}
      <ReadOnly label="Total length" value={g ? formatQuantity(g.totalLength, sys, 'length') : '— (needs 2 P.I.s)'} src="calculated" />
      {!many && <ReadOnly label="Points not projectable" value={String(line.unprojectable)} src="calculated" />}
      <div style={{ overflowX: 'auto', marginTop: 6 }}>
        <table className="grid">
          <thead><tr><th>#</th><th>X</th><th>Y</th><th>Station</th><th>Line angle</th><th>Leg ahead</th><th /></tr></thead>
          <tbody>
            {a.pis.map((p, i) => (
              <tr key={p.id}>
                <td className="mono">{i + 1}</td>
                <td className="mono">{len(p.x)}</td>
                <td className="mono">{len(p.y)}</td>
                <td className="mono">{g ? stationText(project, g.stations[i]!) : '—'}</td>
                <td className="mono">{g && i > 0 && i < a.pis.length - 1 ? formatDMS(g.lineAngles[i]!) : '—'}</td>
                <td className="mono">{g && g.segments[i] ? len(g.segments[i]!.length) : '—'}</td>
                <td><SrcTag src={p.src} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ margin: '6px 0' }}>
        Stations, line angles and leg lengths are calculated. Line angles are positive clockwise (right turn); offsets are positive to the right.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn small" onClick={reverseAlignment} disabled={a.pis.length < 2}>Reverse direction</button>
        {many && <button className="btn small" disabled={d.active === 0} onClick={() => moveAlignment(-1)}>Earlier in profile</button>}
        {many && <button className="btn small" disabled={d.active === d.lines.length - 1} onClick={() => moveAlignment(1)}>Later in profile</button>}
        <button className="btn small" onClick={deleteAlignment}>Delete alignment</button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <span className="muted">Delete P.I.s with line angle ≤</span>
        <input style={{ width: 54 }} value={angle} onChange={(e) => setAngle(e.target.value)} inputMode="decimal" />
        <span className="muted">°</span>
        <button
          className="btn small" disabled={!(Number(angle) > 0 && Number(angle) < 180) || a.pis.length < 3}
          onClick={() => deleteSmallAngles(Number(angle))}
        >Delete</button>
      </div>
      <StationEquations project={project} />
      {tools}
      <Legend />
    </div>
  );
}

/** Terrain summary: counts by feature code and extents, with shortcuts to the editors. */
export function TerrainSummary({ project }: { project: Project }) {
  const openDialog = useApp((s) => s.openDialog);
  const d = useDerived();
  const sys = project.settings.unitSystem;
  const all = project.terrain.points;
  const counts = new Map<number, number>();
  let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of d.points) {
    counts.set(p.code, (counts.get(p.code) ?? 0) + 1);
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const q = (v: number) => formatQuantity(v, sys, 'length', 2);
  const src = (s: string) => all.filter((p) => p.src === s).length;
  const nb = project.terrain.breakLines.length;
  return (
    <div className="props">
      <h4>Terrain</h4>
      <ReadOnly label="Survey points" value={`${d.points.length} active${all.length > d.points.length ? `, ${all.length - d.points.length} inactive` : ''}`} />
      <ReadOnly label="Imported / user / calc." value={`${src('imported')} / ${src('user')} / ${src('calculated')}`} />
      {d.points.length > 0 && (
        <>
          <ReadOnly label="Elevation range" value={`${q(minZ)} to ${q(maxZ)}`} src="calculated" />
          <ReadOnly label="Extent E–W" value={q(maxX - minX)} src="calculated" />
          <ReadOnly label="Extent N–S" value={q(maxY - minY)} src="calculated" />
        </>
      )}
      <ReadOnly label="TIN" value={d.tin ? `${d.tin.triangles.length / 3} triangles` : project.settings.terrain.tinEnabled ? 'not enough ground points' : 'off'} src="calculated" />
      <ReadOnly label="Break lines" value={`${nb} segment${nb === 1 ? '' : 's'}${d.breakLinesSkipped ? `, ${d.breakLinesSkipped} not enforced` : ''}`} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
        <button className="btn small" onClick={() => openDialog('terrainPoints')}>Edit points…</button>
        <button className="btn small" onClick={() => openDialog('featureCodes')}>Feature codes…</button>
        <button className="btn small" disabled={!d.tin || !d.line?.geom} title="Needs the TIN and an alignment" onClick={() => openDialog('interpolate')}>Interpolated points…</button>
        {nb > 0 && <button className="btn small" onClick={deleteBreakLines}>Delete break lines</button>}
      </div>
      <h4>Points by feature code</h4>
      {project.terrain.featureCodes.length === 0 ? <div className="muted">No feature codes are defined.</div> : (
        <table className="grid">
          <thead><tr><th>Code</th><th>Description</th><th>Ground</th><th>Points</th></tr></thead>
          <tbody>
            {project.terrain.featureCodes.map((f) => (
              <tr key={f.code}>
                <td className="mono"><span style={{ display: 'inline-block', width: 8, height: 8, background: f.color, marginRight: 5 }} />{f.code}</td>
                <td>{f.description}</td>
                <td>{f.onGround ? 'Yes' : 'No'}</td>
                <td className="mono">{counts.get(f.code) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Legend />
    </div>
  );
}
