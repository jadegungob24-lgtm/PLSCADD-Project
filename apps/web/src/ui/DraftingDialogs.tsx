import { useMemo, useState } from 'react';
import { reportToHtml } from '@tlcad/io';
import { type Annotation, type Assembly, type Materials, type MaterialItem, type Part, type SheetArea, type SheetSettings, defaultSheetSettings } from '@tlcad/model';
import { useApp } from '../store/appStore';
import { useDerived } from '../store/derived';
import {
  applyWorldFile, attachFile, deleteAttachment, exportReport, newAnnotation, saveAnnotations, saveMaterials, saveSheetSettings,
  setStructureSiteMaterial, setStructureTypeMaterial, updateAttachment,
} from '../commands/drafting';
import { buildReport, REPORTS, type ReportKind } from '../drafting/reports';
import { Modal } from './Dialogs';
import { Row } from './LibraryDialogs';

/** Phase 6 dialogs: sheet setup (§13.2), annotation (§13.3), attachments (§6.6), materials (§8.5), reports (§12). */

function Num(p: { value: number; onChange: (v: number) => void; width?: number; min?: number; max?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input className="mono" style={{ width: p.width ?? 70, textAlign: 'right' }} value={draft ?? String(Number(p.value.toPrecision(8)))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft === null) return; const v = Number(draft); if (draft.trim() !== '' && Number.isFinite(v) && (p.min === undefined || v >= p.min) && (p.max === undefined || v <= p.max)) p.onChange(v); setDraft(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); if (e.key === 'Escape') setDraft(null); }} />
  );
}

function pickFile(accept: string, fn: (f: File) => void) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept;
  i.onchange = () => { const f = i.files?.[0]; if (f) fn(f); };
  i.click();
}

// ------------------------------------------------------------------ Sheet setup

const PAGES: [string, number, number][] = [['A4 landscape', 297, 210], ['A3 landscape', 420, 297], ['A2 landscape', 594, 420], ['A1 landscape', 841, 594], ['Letter landscape', 279.4, 215.9], ['Tabloid (11×17) landscape', 431.8, 279.4], ['ANSI D (22×34) landscape', 863.6, 558.8]];

export function SheetSettingsDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const [s, setS] = useState<SheetSettings>(() => structuredClone(project.drafting.sheets));
  const set = <K extends keyof SheetSettings>(k: K, v: SheetSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify(project.drafting.sheets);
  const area = (k: keyof SheetSettings['areas'], label: string) => {
    const a = s.areas[k];
    const up = (patch: Partial<SheetArea>) => set('areas', { ...s.areas, [k]: { ...a, ...patch } });
    return (
      <tr key={k}><td>{label}</td>
        <td><Num value={a.xmin} min={0} max={100} width={50} onChange={(v) => up({ xmin: v })} /></td><td><Num value={a.xmax} min={0} max={100} width={50} onChange={(v) => up({ xmax: v })} /></td>
        <td><Num value={a.ymin} min={0} max={100} width={50} onChange={(v) => up({ ymin: v })} /></td><td><Num value={a.ymax} min={0} max={100} width={50} onChange={(v) => up({ ymax: v })} /></td></tr>
    );
  };
  const show = s.show;
  const chk = (k: keyof SheetSettings['show'], label: string) => (
    <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={show[k]} onChange={(e) => set('show', { ...show, [k]: e.target.checked })} />{label}</label>
  );
  return (
    <Modal title="Plan & Profile Sheet Setup" onClose={close} width={860}
      footer={<>
        <button className="btn" onClick={() => setS(defaultSheetSettings())}>Defaults</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={close}>Close</button>
        <button className="btn primary" disabled={!dirty} onClick={() => { if (saveSheetSettings(s)) close(); }}>Save</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, maxHeight: '64vh', overflow: 'auto' }}>
        <div>
          <h4 style={{ margin: '0 0 6px' }}>Page (§13.2.1)</h4>
          <Row label="Page size">
            <select value="" onChange={(e) => { const pg = PAGES.find((x) => x[0] === e.target.value); if (pg) set('page', { width: pg[1], height: pg[2] }); }}>
              <option value="">Choose a standard size…</option>{PAGES.map((x) => <option key={x[0]}>{x[0]}</option>)}
            </select>
          </Row>
          <Row label="Width × height (mm)"><Num value={s.page.width} min={50} onChange={(v) => set('page', { ...s.page, width: v })} /> × <Num value={s.page.height} min={50} onChange={(v) => set('page', { ...s.page, height: v })} /></Row>
          <Row label="Margins L / R / T / B (mm)">
            {(['left', 'right', 'top', 'bottom'] as const).map((k) => <Num key={k} value={s.margins[k]} min={0} width={45} onChange={(v) => set('margins', { ...s.margins, [k]: v })} />)}
          </Row>
          <h4 style={{ margin: '12px 0 6px' }}>Areas, % of the sheet (§13.2.2)</h4>
          <table className="grid" style={{ width: 'auto' }}>
            <thead><tr><th>Area</th><th>X min</th><th>X max</th><th>Y min (top)</th><th>Y max</th></tr></thead>
            <tbody>{area('plan', 'Plan')}{area('profile', 'Profile')}{area('stations', 'Station labels')}{area('title', 'Title block')}</tbody>
          </table>
          <h4 style={{ margin: '12px 0 6px' }}>Title block lines</h4>
          <textarea style={{ width: '100%', height: 90 }} value={s.title.join('\n')} onChange={(e) => set('title', e.target.value.split('\n'))} />
          <div className="muted">Codes: %p sheet, %q sheets, %n project, %L line, %d date, %t time, %s1/%s2 start/end station, %s3/%s4 first/last structure, %C1… criteria notes (§13.3.2).</div>
        </div>
        <div>
          <h4 style={{ margin: '0 0 6px' }}>Scales (§13.2.3) — metres per cm of paper</h4>
          <Row label="Horizontal"><Num value={s.hScale} min={0.01} onChange={(v) => set('hScale', v)} /><span className="muted">1:{Math.round(s.hScale * 100)}</span></Row>
          <Row label="Vertical"><Num value={s.vScale} min={0.01} onChange={(v) => set('vScale', v)} /><span className="muted">1:{Math.round(s.vScale * 100)}</span></Row>
          <Row label="Station labels / grid (m)"><Num value={s.stationLabelInterval} min={1} onChange={(v) => set('stationLabelInterval', v)} /> <Num value={s.stationGrid} min={1} onChange={(v) => set('stationGrid', v)} /></Row>
          <Row label="Elevation labels / grid (m)"><Num value={s.elevationLabelInterval} min={0.1} onChange={(v) => set('elevationLabelInterval', v)} /> <Num value={s.elevationGrid} min={0.1} onChange={(v) => set('elevationGrid', v)} /></Row>
          <Row label="Plan station ticks (m)"><Num value={s.planTickInterval} min={1} onChange={(v) => set('planTickInterval', v)} /></Row>
          <Row label="Overlap for common structure (m)"><Num value={s.commonOverlap} min={0} onChange={(v) => set('commonOverlap', v)} /></Row>
          <Row label="Profile bottom margin (m)"><Num value={s.profileBottomMargin} min={0} onChange={(v) => set('profileBottomMargin', v)} /></Row>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Distances in metres regardless of the display units. Only the Long Axis plan layout is available.</div>
          <h4 style={{ margin: '12px 0 6px' }}>Show</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {chk('surveyPoints', 'Survey points')}{chk('sideProfiles', 'Side profiles')}{chk('clearanceLine', 'Clearance line')}{chk('wires', 'Wires')}
            {chk('structureLabels', 'Structure labels')}{chk('attachments', 'Attachments')}{chk('sheetRectanglesInPlan', 'Sheet rectangles in plan view')}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Annotation table (§13.3.2)

export function AnnotationDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const [list, setList] = useState<Annotation[]>(() => structuredClone(project.drafting.annotations));
  const up = (i: number, patch: Partial<Annotation>) => setList((l) => l.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const dirty = JSON.stringify(list) !== JSON.stringify(project.drafting.annotations);
  const ptsText = (a: Annotation) => a.pts.map((q) => q.join(' ')).join('; ');
  const parsePts = (s: string): [number, number][] | null => {
    const r = s.split(';').map((x) => x.trim()).filter(Boolean).map((x) => x.split(/[\s,]+/).map(Number));
    return r.length && r.every((q) => q.length === 2 && q.every(Number.isFinite)) ? (r as [number, number][]) : null;
  };
  return (
    <Modal title="Lines and Annotation" onClose={close} width={1100}
      footer={<>
        <button className="btn" onClick={() => setList((l) => [...l, newAnnotation()])}>Add</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={close}>Close</button>
        <button className="btn primary" disabled={!dirty} onClick={() => { if (saveAnnotations(list)) close(); }}>Save</button>
      </>}>
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <table className="grid">
          <thead><tr><th>Drawn on</th><th>Sheet</th><th>Kind</th><th>Points (x y; x y …)</th><th>Text</th><th>Height (mm)</th><th>Angle (°)</th><th>Colour</th><th /></tr></thead>
          <tbody>
            {list.map((a, i) => (
              <tr key={a.id}>
                <td><select value={a.target} onChange={(e) => up(i, { target: e.target.value as Annotation['target'], sheet: e.target.value === 'sheet' ? a.sheet ?? 1 : null })}>
                  <option value="allSheets">All sheets</option><option value="sheet">One sheet</option><option value="plan">Plan (X, Y)</option><option value="profile">Profile (station, elevation)</option>
                </select></td>
                <td>{a.target === 'sheet' ? <Num value={a.sheet ?? 1} min={1} width={40} onChange={(v) => up(i, { sheet: Math.round(v) })} /> : ''}</td>
                <td><select value={a.kind} onChange={(e) => up(i, { kind: e.target.value as Annotation['kind'] })}><option value="text">Text</option><option value="line">Line</option><option value="arrow">Arrow</option><option value="polygon">Polygon</option></select></td>
                <td><input key={ptsText(a)} defaultValue={ptsText(a)} style={{ width: 220 }} className="mono" onBlur={(e) => { const p = parsePts(e.target.value); if (p) up(i, { pts: p }); else e.target.value = ptsText(a); }} /></td>
                <td><input value={a.text} style={{ width: 200 }} onChange={(e) => up(i, { text: e.target.value })} /></td>
                <td><Num value={a.height} min={0.5} width={45} onChange={(v) => up(i, { height: v })} /></td>
                <td><Num value={a.angle} width={45} onChange={(v) => up(i, { angle: v })} /></td>
                <td><input type="color" value={a.color} onChange={(e) => up(i, { color: e.target.value })} style={{ width: 34, height: 20, padding: 0 }} /></td>
                <td><button className="btn small" onClick={() => setList((l) => l.filter((_, k) => k !== i))}>Delete</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={9} className="muted">No annotation.</td></tr>}
          </tbody>
        </table>
        <div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
          Sheet coordinates are fractions of the page width and height from the top-left corner (§13.3.1.2); plan coordinates are global X, Y in metres;
          profile coordinates are station and elevation in metres. "\n" starts a new text line; the codes of the title block are substituted.
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Attachments (§6.6)

export function AttachmentsDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const [view, setView] = useState<'plan' | 'profile' | 'sheets'>('plan');
  const list = project.attachments;
  return (
    <Modal title="Attachment Manager" onClose={close} width={1000}
      footer={<>
        <span>Attach to</span>
        <select value={view} onChange={(e) => setView(e.target.value as typeof view)}><option value="plan">Plan view (X, Y)</option><option value="profile">Profile view (station, elevation)</option><option value="sheets">P&P sheets (page coordinates)</option></select>
        <button className="btn" onClick={() => pickFile('.dxf,.shp,.png,.jpg,.jpeg,.gif,.webp,.bmp', (f) => { void attachFile(f, view); })}>Attach file…</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={close}>Close</button>
      </>}>
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <table className="grid">
          <thead><tr><th>Show</th><th>File</th><th>Type</th><th>View</th><th>Metres per unit</th><th>Move ΔX / ΔY (m)</th><th>Colour</th><th>Image: upper-left X, Y, width, height (m), rotation (°)</th><th /></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td><input type="checkbox" checked={a.visible} onChange={(e) => updateAttachment(a.id, { visible: e.target.checked })} /></td>
                <td>{a.name}<div className="muted">{a.kind === 'image' ? 'raster' : `${a.entities.length} entities`}</div></td>
                <td>{a.kind.toUpperCase()}</td>
                <td>{a.view}</td>
                <td>{a.kind !== 'image' && <Num value={a.unitScale} min={1e-9} width={70} onChange={(v) => updateAttachment(a.id, { unitScale: v })} />}</td>
                <td>{a.kind !== 'image' && <><Num value={a.dx} width={70} onChange={(v) => updateAttachment(a.id, { dx: v })} /> <Num value={a.dy} width={70} onChange={(v) => updateAttachment(a.id, { dy: v })} /></>}</td>
                <td><input type="color" value={a.color} onChange={(e) => updateAttachment(a.id, { color: e.target.value })} style={{ width: 34, height: 20, padding: 0 }} /></td>
                <td>{a.image && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(['x', 'y', 'width', 'height', 'rotation'] as const).map((k) => <Num key={k} value={a.image![k]} width={78} onChange={(v) => updateAttachment(a.id, { image: { ...a.image!, [k]: v } })} />)}
                    <button className="btn small" onClick={() => pickFile('.tfw,.jgw,.pgw,.gfw,.bpw,.wld,.txt', (f) => { void applyWorldFile(a.id, f); })}>World file…</button>
                  </div>
                )}</td>
                <td><button className="btn small" onClick={() => deleteAttachment(a.id)}>Remove</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={9} className="muted">No attachments.</td></tr>}
          </tbody>
        </table>
        <div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
          DXF (lines, polylines, circles, arcs, points, text) and shapefile geometry must be in the project coordinate system for plan attachments, in station and
          elevation for profile attachments, and in page coordinates (origin at the lower-left corner, y up) for sheet attachments (§6.6.1). Images are drawn in
          the plan view; set their placement here or read a world file. Block inserts, hatches, shapefile attributes and reprojection of attachments are not
          supported. Images are stored in the project file.
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Materials (§8.5)

function ItemsEditor({ items, onChange }: { items: MaterialItem[]; onChange: (i: MaterialItem[]) => void }) {
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, margin: '2px 0' }}>
          <input value={it.stock} placeholder="stock number" style={{ width: 150 }} onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, stock: e.target.value } : x)))} />
          <Num value={it.qty} width={60} onChange={(v) => onChange(items.map((x, k) => (k === i ? { ...x, qty: v } : x)))} />
          <button className="btn small" onClick={() => onChange(items.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <button className="btn small" onClick={() => onChange([...items, { stock: '', qty: 1 }])}>Add item</button>
    </div>
  );
}

export function MaterialsDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const d = useDerived();
  const [m, setM] = useState<Materials>(() => structuredClone(project.materials));
  const [tab, setTab] = useState<'parts' | 'assemblies' | 'structures' | 'line'>('parts');
  const [typeId, setTypeId] = useState(project.structureLibrary[0]?.id ?? '');
  const [siteId, setSiteId] = useState(project.structures[0]?.id ?? '');
  const dirty = JSON.stringify(m) !== JSON.stringify(project.materials);
  const upPart = (i: number, patch: Partial<Part>) => setM((x) => ({ ...x, parts: x.parts.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const upAsm = (i: number, patch: Partial<Assembly>) => setM((x) => ({ ...x, assemblies: x.assemblies.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const t = project.structureLibrary.find((x) => x.id === typeId);
  const site = project.structures.find((x) => x.id === siteId);
  const clean = (items: MaterialItem[]) => items.filter((it) => it.stock.trim());
  return (
    <Modal title="Parts, Assemblies and Material Lists" onClose={close} width={1000}
      footer={<><div style={{ flex: 1 }} /><button className="btn" onClick={close}>Close</button><button className="btn primary" disabled={!dirty} onClick={() => { if (saveMaterials({ ...m, line: clean(m.line), assemblies: m.assemblies.map((a) => ({ ...a, items: clean(a.items) })) })) close(); }}>Save parts and assemblies</button></>}>
      <div className="tabbar">
        {([['parts', 'Parts'], ['assemblies', 'Assemblies'], ['structures', 'Structure material'], ['line', 'Line-specific material']] as const).map(([k, l]) => <button key={k} className={`tabbtn ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div style={{ maxHeight: '58vh', overflow: 'auto', paddingTop: 8 }}>
        {tab === 'parts' && (
          <>
            <table className="grid">
              <thead><tr><th>Stock number</th><th>Description</th><th>Unit</th><th>Material unit cost</th><th>Install labor unit cost</th><th /></tr></thead>
              <tbody>{m.parts.map((p, i) => (
                <tr key={i}>
                  <td><input value={p.stock} style={{ width: 130 }} onChange={(e) => upPart(i, { stock: e.target.value })} /></td>
                  <td><input value={p.description} style={{ width: 280 }} onChange={(e) => upPart(i, { description: e.target.value })} /></td>
                  <td><input value={p.unit} style={{ width: 60 }} onChange={(e) => upPart(i, { unit: e.target.value })} /></td>
                  <td><Num value={p.materialCost} min={0} onChange={(v) => upPart(i, { materialCost: v })} /></td>
                  <td><Num value={p.laborCost} min={0} onChange={(v) => upPart(i, { laborCost: v })} /></td>
                  <td><button className="btn small" onClick={() => setM((x) => ({ ...x, parts: x.parts.filter((_, k) => k !== i) }))}>Delete</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => setM((x) => ({ ...x, parts: [...x.parts, { stock: `PART-${x.parts.length + 1}`, description: '', unit: 'each', materialCost: 0, laborCost: 0 }] }))}>Add part</button>
            <div className="muted" style={{ marginTop: 6 }}>Give a cable part the cable's stock number to price the cable length (metres). Retire/transfer labour and item status are not implemented.</div>
          </>
        )}
        {tab === 'assemblies' && (
          <>
            <table className="grid">
              <thead><tr><th>Stock number</th><th>Description</th><th>Unit</th><th>Parts and assemblies (stock, quantity)</th><th /></tr></thead>
              <tbody>{m.assemblies.map((a, i) => (
                <tr key={i}>
                  <td><input value={a.stock} style={{ width: 130 }} onChange={(e) => upAsm(i, { stock: e.target.value })} /></td>
                  <td><input value={a.description} style={{ width: 220 }} onChange={(e) => upAsm(i, { description: e.target.value })} /></td>
                  <td><input value={a.unit} style={{ width: 60 }} onChange={(e) => upAsm(i, { unit: e.target.value })} /></td>
                  <td><ItemsEditor items={a.items} onChange={(items) => upAsm(i, { items })} /></td>
                  <td><button className="btn small" onClick={() => setM((x) => ({ ...x, assemblies: x.assemblies.filter((_, k) => k !== i) }))}>Delete</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => setM((x) => ({ ...x, assemblies: [...x.assemblies, { stock: `ASM-${x.assemblies.length + 1}`, description: '', unit: 'each', items: [] }] }))}>Add assembly</button>
          </>
        )}
        {tab === 'structures' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <div>
              <h4 style={{ margin: '0 0 6px' }}>Structure file material</h4>
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>{project.structureLibrary.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              {t && <ItemsEditor items={t.material} onChange={(items) => setStructureTypeMaterial(t.id, items)} />}
              <div className="muted">Counted once for every structure of this type.</div>
            </div>
            <div>
              <h4 style={{ margin: '0 0 6px' }}>Structure-specific material (§8.5.4.1)</h4>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>{d.model.structures.map((x) => <option key={x.s.id} value={x.s.id}>{x.s.label || x.number} · {x.type?.name}</option>)}</select>
              {site && <ItemsEditor items={site.material} onChange={(items) => setStructureSiteMaterial(site.id, items)} />}
            </div>
          </div>
        )}
        {tab === 'line' && <><ItemsEditor items={m.line} onChange={(line) => setM((x) => ({ ...x, line }))} /><div className="muted" style={{ marginTop: 6 }}>Material for the line as a whole (§8.5.4.2). Cable lengths are added automatically in the bill of material.</div></>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Reports (§12)

export function ReportsDialog({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!;
  const d = useDerived();
  const [kind, setKind] = useState<ReportKind>('staking');
  const html = useMemo(() => {
    try { return reportToHtml(buildReport(kind, project, d)); } catch (e) { return `<p style="color:#c00">Report failed: ${e instanceof Error ? e.message : String(e)}</p>`; }
  }, [kind, project, d]);
  return (
    <Modal title="Reports" onClose={close} width={1150}
      footer={<>
        <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => exportReport(kind, 'pdf')}>PDF</button>
        <button className="btn" onClick={() => exportReport(kind, 'xls')}>Excel (XML)</button>
        <button className="btn" onClick={() => exportReport(kind, 'csv')}>CSV</button>
        <button className="btn" onClick={() => exportReport(kind, 'html')}>HTML</button>
        <button className="btn" onClick={close}>Close</button>
      </>}>
      <iframe title="report" srcDoc={html} style={{ width: '100%', height: '64vh', border: '1px solid var(--border)', background: '#fff' }} />
    </Modal>
  );
}
