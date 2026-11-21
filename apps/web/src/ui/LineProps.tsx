import { formatDMS, formatQuantity, levelSag, unitLabel } from '@tlcad/engine';
import { INSULATOR_LABEL, type Project, type Sagging } from '@tlcad/model';
import { autoSagSection, setSagging } from '../commands/sag';
import { minVerticalProblems, structureResult } from '../store/analysis';
import { useApp } from '../store/appStore';
import { stationText, useDerived } from '../store/derived';
import { deleteSection, deleteStructures, editStructure } from '../commands/line';
import { Legend, QuantityProp, ReadOnly, SelectProp, SrcTag, TextProp, NumProp } from './props';
import { StructureSketch } from './StructureSketch';

/** Properties of a spotted structure (Structure Modify box, §10.2.2) and its calculated position. */
export function StructureProps({ project, id }: { project: Project; id: string }) {
  const d = useDerived();
  const openDialog = useApp((s) => s.openDialog);
  const sd = d.model.byId.get(id);
  if (!sd) return <div className="props"><div className="muted">The structure no longer exists.</div></div>;
  const s = sd.s;
  const sys = project.settings.unitSystem;
  const lu = unitLabel(sys, 'length');
  const len = (v: number | null) => (v === null ? '—' : formatQuantity(v, sys, 'length', 2, false));
  const line = d.lines[sd.line];
  const g = line?.geom ?? null;
  return (
    <div className="props">
      <h4>Structure {sd.number}{s.label ? ` — ${s.label}` : ''}</h4>
      {sd.problems.length > 0 && <div style={{ color: 'var(--err)', marginBottom: 6 }}>{sd.problems.join(' ')}</div>}
      <SelectProp
        label="Structure type" value={s.typeId}
        options={project.structureLibrary.map((t) => [t.id, t.name] as [string, string])}
        onCommit={(v) => editStructure(id, 'Change structure type', { typeId: v })}
      />
      <TextProp label="Label" value={s.label} onCommit={(v) => editStructure(id, 'Edit structure label', { label: v })} />
      <QuantityProp
        label="Station" sys={sys} dim="length" valueSI={g ? g.startStation + s.station : null}
        check={(v) => (g && (v - g.startStation < -1e-6 || v - g.startStation > g.totalLength + 1e-6) ? 'The station must lie on the alignment.' : null)}
        onCommit={(v) => { if (v !== null && g) editStructure(id, 'Change structure station', { station: v - g.startStation }); }}
      />
      <QuantityProp label="Offset adjustment" sys={sys} dim="length" valueSI={s.offset} onCommit={(v) => { if (v !== null) editStructure(id, 'Change structure offset', { offset: v }); }} />
      <QuantityProp label="Height adjustment" sys={sys} dim="length" valueSI={s.heightAdjust} onCommit={(v) => { if (v !== null) editStructure(id, 'Change height adjustment', { heightAdjust: v }); }} />
      <NumProp label="Orientation" unit="°" src={s.src} value={s.orientation} onCommit={(v) => { if (v !== null) editStructure(id, 'Change structure orientation', { orientation: v }); }} />
      <TextProp label="Comment" multiline value={s.comment} onCommit={(v) => editStructure(id, 'Edit structure comment', { comment: v })} />
      <h4>Calculated</h4>
      <ReadOnly label="Alignment" value={line ? `A${sd.line + 1} ${line.alignment.name}` : '—'} />
      <ReadOnly label="Line angle" value={sd.frame ? (sd.frame.piIndex !== null ? formatDMS(sd.frame.lineAngle) : '0 (not at a P.I.)') : '—'} src="calculated" />
      <ReadOnly label={`Ground (${lu})`} value={sd.ground === null ? '—' : `${len(sd.ground)} (${sd.groundSource === 'tin' ? 'TIN' : 'centerline profile'})`} src="calculated" />
      <ReadOnly label={`Base / top (${lu})`} value={`${len(sd.baseZ)} / ${len(sd.topZ)}`} src="calculated" />
      <ReadOnly label={`Base X, Y (${lu})`} value={sd.frame ? `${len(sd.frame.baseX)}, ${len(sd.frame.baseY)}` : '—'} src="calculated" />
      <SpanResults project={project} sd={sd} />
      {sd.type && (
        <>
          <h4>Attachment points ({lu})</h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead><tr><th>Set:Ph</th><th>Insulator</th><th>X</th><th>Y</th><th>Z</th><th>Wire Z</th></tr></thead>
              <tbody>
                {sd.points.map((q, i) => (
                  <tr key={i}>
                    <td className="mono">{q.a.set}:{q.a.phase}</td>
                    <td>{INSULATOR_LABEL[q.a.insulator]}</td>
                    <td className="mono">{len(q.top.x)}</td>
                    <td className="mono">{len(q.top.y)}</td>
                    <td className="mono">{len(q.top.z)}</td>
                    <td className="mono">{q.wire ? len(q.wire.z) : q.a.insulator === 'strain' ? 'per section' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ margin: '4px 0' }}>
            Structure attachment points. Suspension insulators are shown hanging plumb; their swing under the criteria swing conditions is in Sag-Tension ▸ Structure checks.
          </div>
          <StructureSketch t={sd.type} sys={sys} height={220} />
        </>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn small" onClick={() => openDialog('structureTable')}>Structure table…</button>
        <button className="btn small" onClick={() => { void deleteStructures([id]); }}>Remove structure</button>
      </div>
      <Legend />
    </div>
  );
}

/** Properties of a strung tension section. */
/** Wind and weight spans, swing and Method 1 usage of a strung structure (App. I, §7.3.16, §8.3.1). */
function SpanResults({ project, sd }: { project: Project; sd: NonNullable<ReturnType<typeof useDerived>['model']['structures'][number]> }) {
  const d = useDerived();
  const sys = project.settings.unitSystem;
  const r = structureResult(project, d.analysis, sd);
  if (!r.sets.length) return null;
  const len = (v: number | null) => (v === null ? '—' : formatQuantity(v, sys, 'length', 1));
  const vprob = minVerticalProblems(r);
  return (
    <>
      <h4>Spans and swing</h4>
      {r.sets.map((s) => (
        <div key={s.set} style={{ marginBottom: 4 }}>
          <ReadOnly label={`Set ${s.set} wind span`} value={len(s.windSpan)} src="calculated" />
          {s.weightSpans.map((w, i) => w !== null && <ReadOnly key={i} label={`Set ${s.set} weight span ${i + 1}`} value={`${len(w)}${w < 0 ? ' (uplift)' : ''}`} src="calculated" />)}
          {s.swings.map((w, i) => (
            <ReadOnly key={`sw${i}`} label={`Swing ${w.condition + 1}, phase ${w.attachment.phase}`} value={w.uplift ? 'UPLIFT — insulator pulled up' : `${w.min.toFixed(1)}° … ${w.max.toFixed(1)}°${w.allowMin !== null ? ` (allowed ${w.allowMin}…${w.allowMax})` : ''}${w.ok ? '' : ' EXCEEDED'}`} src="calculated" />
          ))}
          {s.notes.map((n, i) => <div key={i} className="muted">{n}</div>)}
        </div>
      ))}
      {r.method1 && <ReadOnly label="Method 1 usage" value={Number.isFinite(r.method1.usage) ? `${r.method1.usage.toFixed(1)} %${r.method1.ok ? '' : ' — CHECK'}` : r.method1.detail} src="calculated" />}
      {r.method2 && <ReadOnly label="Method 2" value={r.method2.ok ? `OK — ${r.method2.detail}` : `CHECK — ${r.method2.detail}`} src="calculated" />}
      {vprob.map((m, i) => <div key={i} style={{ color: 'var(--err)' }}>{m}</div>)}
    </>
  );
}

/** Sagging data of a section (Section Modify, §10.3.2): condition, temperature, tension or catenary constant, ruling span. */
function SaggingProps({ sd }: { sd: NonNullable<ReturnType<typeof useDerived>['model']['sections'][number]> }) {
  const project = useApp((s) => s.project)!;
  const d = useDerived();
  const setTool = useApp((s) => s.setTool);
  const showView = useApp((s) => s.showView);
  const openDialog = useApp((s) => s.openDialog);
  const sys = project.settings.unitSystem;
  const s = sd.section;
  const sag = s.sagging;
  const sa = d.analysis.sections.get(s.id);
  const uw = sd.cable?.unitWeight ?? null;
  const byCat = project.settings.sagBy === 'catenary';
  const len = (v: number) => formatQuantity(v, sys, 'length', 2);
  return (
    <>
      <h4 style={{ marginTop: 8 }}>Sagging</h4>
      <SelectProp label="Cable condition" value={sag.condition} options={[['initial', 'Initial'], ['creep', 'Final after creep'], ['load', 'Final after load']]}
        onCommit={(v) => setSagging(s.id, { condition: v as Sagging['condition'] })} />
      <QuantityProp label="Temperature" valueSI={sag.temperature} sys={sys} dim="temperature" src="user" onCommit={(v) => v !== null && setSagging(s.id, { temperature: v })} />
      {byCat && uw ? (
        <QuantityProp label="Catenary constant H/UW" valueSI={sag.H === null ? null : sag.H / uw} sys={sys} dim="length" src={sag.H === null ? 'default' : sag.src} nullable
          check={(v) => (v > 0 ? null : 'Must be positive.')} onCommit={(v) => setSagging(s.id, { H: v === null ? null : v * uw, src: 'user' })} />
      ) : (
        <QuantityProp label="Horizontal tension H" valueSI={sag.H} sys={sys} dim="force" src={sag.H === null ? 'default' : sag.src} nullable
          check={(v) => (v > 0 ? null : 'Must be positive.')} onCommit={(v) => setSagging(s.id, { H: v, src: 'user' })} />
      )}
      <ReadOnly label="Ruling span (calculated)" value={sa && Number.isFinite(sa.rulingSpanCalc) ? len(sa.rulingSpanCalc) : '—'} src="calculated" />
      <QuantityProp label="Ruling span override" valueSI={sag.rulingSpanOverride} sys={sys} dim="length" src="user" nullable
        check={(v) => (v > 0 ? null : 'Must be positive.')} onCommit={(v) => setSagging(s.id, { rulingSpanOverride: v })} />
      {sa?.status === 'sagged' && sa.solved && (
        <ReadOnly label="Ruling span sag" value={len(levelSag(sa.rulingSpan, sag.H! / sa.model!.unitWeight))} src="calculated" />
      )}
      {sa?.message && <div style={{ color: sa.status === 'error' ? 'var(--err)' : 'var(--muted, #666)', margin: '4px 0' }}>{sa.message}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
        <button className="btn small" disabled={!sd.cable || sd.problems.length > 0} onClick={() => autoSagSection(s.id)} title="Largest tension meeting every automatic sagging limit in the criteria (§7.3.7)">Automatic sagging</button>
        <button className="btn small" disabled={!sd.cable || sd.problems.length > 0} onClick={() => { showView('profile'); setTool('sagSection'); }} title="Pick a point in the profile view that the wire must pass through (§10.3.2.1.4)">Graphical sag…</button>
        <button className="btn small" onClick={() => openDialog('criteria')}>Criteria…</button>
      </div>
    </>
  );
}

export function SectionProps({ id }: { id: string }) {
  const d = useDerived();
  const sd = d.model.sections.find((k) => k.section.id === id);
  if (!sd) return <div className="props"><div className="muted">The section no longer exists.</div></div>;
  const s = sd.section;
  const att = s.steps.filter((st) => st.set !== null);
  return (
    <div className="props">
      <h4>Section {sd.from}–{sd.to}</h4>
      {sd.problems.length > 0 && <div style={{ color: 'var(--err)', marginBottom: 6 }}>{sd.problems.join(' ')}</div>}
      <ReadOnly label="Cable" value={sd.cable?.name ?? '— missing —'} />
      <ReadOnly label="Voltage" value={`${s.voltageKV} kV`} />
      <ReadOnly label="Conductors / phase" value={String(s.conductorsPerPhase)} />
      <ReadOnly label="Phases" value={String(sd.wires.length)} />
      <SaggingProps sd={sd} />
      <table className="grid" style={{ marginTop: 6 }}>
        <thead><tr><th>Structure</th><th>Set</th><th>Phase order</th></tr></thead>
        <tbody>
          {s.steps.map((st, i) => (
            <tr key={i}>
              <td className="mono">{d.model.byId.get(st.structureId)?.number ?? '?'}</td>
              <td>{st.set === null ? 'bypassed' : st.set}</td>
              <td className="mono">{st.set === null ? '' : st.transposition}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ margin: '6px 0' }}>
        {att.length} attached structure(s). {d.analysis.sections.get(id)?.status === 'sagged' ? 'Wires are drawn as catenaries at the display condition of the criteria.' : 'Until the section is sagged its wires are drawn as dashed straight chords.'}
      </div>
      <button className="btn small" onClick={() => deleteSection(id)}>Remove section</button>
      <span style={{ marginLeft: 6 }}><SrcTag src={s.src} /></span>
    </div>
  );
}

/** Summary used for the explorer nodes "Structures on Line" and "Tension Sections". */
export function LineSummary({ project, kind }: { project: Project; kind: 'structures' | 'sections' }) {
  const d = useDerived();
  const select = useApp((s) => s.select);
  const openDialog = useApp((s) => s.openDialog);
  if (kind === 'structures') {
    return (
      <div className="props">
        <h4>Structures on line ({d.model.structures.length})</h4>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <button className="btn small" onClick={() => openDialog('spot')}>Spot structures…</button>
          <button className="btn small" onClick={() => openDialog('structureTable')}>Structure table…</button>
        </div>
        <table className="grid">
          <thead><tr><th>#</th><th>Type</th><th>Station</th><th /></tr></thead>
          <tbody>
            {d.model.structures.map((x) => (
              <tr key={x.s.id} onClick={() => select({ kind: 'structure', id: x.s.id })} style={{ cursor: 'pointer' }}>
                <td className="mono">{x.number}</td>
                <td>{x.type?.name ?? '?'}</td>
                <td className="mono">{Number.isFinite(x.station) ? stationText(project, x.station) : '—'}</td>
                <td style={{ color: 'var(--err)' }}>{x.problems.length ? '⚠' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="props">
      <h4>Tension sections ({d.model.sections.length})</h4>
      <button className="btn small" onClick={() => openDialog('stringing')} style={{ marginBottom: 6 }}>String a section…</button>
      <table className="grid">
        <thead><tr><th>From–to</th><th>Cable</th><th>kV</th><th /></tr></thead>
        <tbody>
          {d.model.sections.map((x) => (
            <tr key={x.section.id} onClick={() => select({ kind: 'section', id: x.section.id })} style={{ cursor: 'pointer' }}>
              <td className="mono">{x.from}–{x.to}</td>
              <td>{x.cable?.name ?? '?'}</td>
              <td className="mono">{x.section.voltageKV}</td>
              <td style={{ color: 'var(--err)' }}>{x.problems.length ? '⚠' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
