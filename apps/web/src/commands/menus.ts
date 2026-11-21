import { canRedo, canUndo, featureById, redoLabel, undoLabel } from '@tlcad/model';
import { TOOL_LABEL, useApp, type Tool } from '../store/appStore';
import { autoSagSection } from './sag';
import { exportKmz, exportReport, exportSheets } from './drafting';
import { openDemoLine } from './demo';
import { requestSagTab } from '../views/sagTab';
import { requestClearanceTab, type ClearanceTab } from '../views/clearanceTab';
import {
  beginCsvImport, beginDemImport, beginLasImport, beginPflImport, exportBrk, exportPfl, exportXyz, importBrkFile, importXyzFile,
  newAlignment, reverseAlignment,
} from './terrain';

/**
 * Menu and command definitions. A menu item either runs an implemented command
 * or points at a feature-registry entry that is not implemented yet; those are
 * shown disabled with their planned phase, so nothing in the interface pretends
 * to work before it does.
 */

export interface MenuItem {
  label: string;
  /** Display text of the keyboard shortcut. */
  shortcut?: string;
  run?: () => void;
  enabled?: () => boolean;
  /** Feature registry id for a command that is not implemented yet. */
  feature?: string;
  checked?: () => boolean;
}
export type MenuEntry = MenuItem | 'separator';
export interface Menu {
  label: string;
  items: MenuEntry[];
}

const app = () => useApp.getState();
const hasProject = () => app().project !== null;
const hasAlignment = () => (app().project?.alignments.length ?? 0) > 0;
const hasSection = () => (app().project?.sections.length ?? 0) > 0;
/** Runs n on the selected section, or selects the first section; its properties hold the sagging data (§10.3.2). */
function withSection(fn: (id: string) => void) {
  const sel = app().selection;
  const id = sel?.kind === 'section' ? sel.id : app().project?.sections[0]?.id;
  if (!id) return;
  if (sel?.kind !== 'section') app().select({ kind: 'section', id });
  fn(id);
}
function showClearance(tab: ClearanceTab) {
  app().showView('clearance');
  requestClearanceTab(tab);
}
function showSagTab() {
  app().showView('sagtension');
  requestSagTab('structures');
}
const hasPoints = () => (app().project?.terrain.points.length ?? 0) > 0;
const planned = (label: string, feature: string): MenuItem => ({ label, feature });

/** Opens a file picker and passes the chosen file to the handler. */
function pickFile(accept: string, handler: (f: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) handler(f);
  };
  input.click();
}

export const commands = {
  newProject: async () => { if (await app().confirmDiscard()) app().openDialog('new'); },
  openProject: async () => { if (await app().confirmDiscard()) app().openDialog('open'); },
  save: () => { void app().saveProject(); },
  close: () => { void app().closeProject(); },
  importArchive: () => pickFile('.tlcad', (f) => { void app().importArchive(f); }),
  exportArchive: () => { void app().exportArchive(); },
  undo: () => app().undo(),
  redo: () => app().redo(),
};

export function buildMenus(): Menu[] {
  const s = app();
  const u = undoLabel(s.history);
  const r = redoLabel(s.history);
  return [
    {
      label: 'File',
      items: [
        { label: 'New Project…', shortcut: 'Alt+N', run: commands.newProject },
        { label: 'Open Project…', shortcut: 'Ctrl+O', run: commands.openProject },
        { label: 'Save', shortcut: 'Ctrl+S', run: commands.save, enabled: hasProject },
        { label: 'Close Project', run: commands.close, enabled: hasProject },
        'separator',
        { label: 'Import Project Archive (.tlcad)…', run: commands.importArchive },
        { label: 'Export Project Archive (.tlcad)', run: commands.exportArchive, enabled: hasProject },
        'separator',
        { label: 'Revisions…', run: () => app().openDialog('revisions'), enabled: hasProject },
        'separator',
        { label: 'Export KMZ (Google Earth)', run: exportKmz, enabled: hasProject },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: u ? `Undo ${u}` : 'Undo', shortcut: 'Ctrl+Z', run: commands.undo, enabled: () => canUndo(app().history) },
        { label: r ? `Redo ${r}` : 'Redo', shortcut: 'Ctrl+Y', run: commands.redo, enabled: () => canRedo(app().history) },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Plan View', shortcut: 'F2', run: () => app().showView('plan') },
        { label: 'Profile View', shortcut: 'F3', run: () => app().showView('profile') },
        { label: '3D View', shortcut: 'F4', run: () => app().showView('3d') },
        { label: 'Map View', run: () => app().showView('map') },
        { label: 'Sag-Tension Analysis View', run: () => app().showView('sagtension') },
        { label: 'Structure Modeling View', run: () => app().showView('structure') },
        { label: 'Clearance Analysis View', run: () => app().showView('clearance') },
        { label: 'Plan & Profile Sheets View', run: () => app().showView('sheets') },
        'separator',
        { label: 'Single View', run: () => app().setTile('single'), checked: () => app().tile === 'single' },
        { label: 'Tile Vertical', run: () => app().setTile('vertical'), checked: () => app().tile === 'vertical' },
        { label: 'Tile Horizontal', run: () => app().setTile('horizontal'), checked: () => app().tile === 'horizontal' },
        { label: 'Tile Four Views', run: () => app().setTile('quad'), checked: () => app().tile === 'quad' },
        'separator',
        { label: 'Zoom Extents', shortcut: 'Home', run: () => app().zoomExtents() },
        { label: 'Clear Markers', run: () => app().setMarkers([]), enabled: () => app().markers.length > 0 },
      ],
    },
    {
      label: 'Project',
      items: [
        { label: 'Project Information', run: () => app().select({ kind: 'project' }), enabled: hasProject },
        { label: 'Units and Settings', run: () => app().select({ kind: 'settings' }), enabled: hasProject },
        { label: 'Coordinate System…', run: () => app().openDialog('crs'), enabled: hasProject },
      ],
    },
    {
      label: 'Terrain',
      items: [
        { label: 'Import XYZ Terrain…', run: () => pickFile('.xyz,.txt', (f) => { void importXyzFile(f); }), enabled: hasProject },
        { label: 'Import PFL Terrain…', run: () => pickFile('.pfl,.txt', (f) => { void beginPflImport(f); }), enabled: hasProject },
        { label: 'Import CSV / TXT Survey Points…', run: () => pickFile('.csv,.txt,.tsv,.dat,.pts', (f) => { void beginCsvImport(f); }), enabled: hasProject },
        { label: 'Import DEM (ASCII Grid / GeoTIFF)…', run: () => pickFile('.asc,.grd,.tif,.tiff', (f) => { void beginDemImport(f); }), enabled: hasProject },
        { label: 'Import LAS Point Cloud…', run: () => pickFile('.las', (f) => { void beginLasImport(f); }), enabled: hasProject },
        { label: 'Import Break Lines (BRK)…', run: () => pickFile('.brk,.txt', (f) => { void importBrkFile(f); }), enabled: hasProject },
        'separator',
        { label: 'Export XYZ Terrain', run: exportXyz, enabled: hasPoints },
        { label: 'Export PFL Terrain (Active Alignment)', run: exportPfl, enabled: () => hasPoints() && hasAlignment() },
        { label: 'Export Break Lines (BRK)', run: exportBrk, enabled: () => (app().project?.terrain.breakLines.length ?? 0) > 0 },
        'separator',
        { label: 'Feature Codes and Clearances…', run: () => app().openDialog('featureCodes'), enabled: hasProject },
        { label: 'Edit Terrain Points…', run: () => app().openDialog('terrainPoints'), enabled: hasProject },
        {
          label: 'Use TIN (Triangulated Ground Surface)', enabled: hasProject,
          checked: () => !!app().project?.settings.terrain.tinEnabled,
          run: () => app().exec('Toggle TIN', (d) => { d.settings.terrain.tinEnabled = !d.settings.terrain.tinEnabled; }),
        },
        { label: 'Create Interpolated Points from TIN…', run: () => app().openDialog('interpolate'), enabled: () => !!app().project?.settings.terrain.tinEnabled && hasAlignment() },
        'separator',
        ...(['addPi', 'insertPi', 'movePi', 'deletePi'] as Tool[]).map((t): MenuItem => ({
          label: `Alignment: ${TOOL_LABEL[t]}`, enabled: hasProject, checked: () => app().activeTool === t,
          run: () => { app().showView('plan'); app().setTool(t); },
        })),
        { label: 'Alignment: New Alignment (Branch / Loop)', run: newAlignment, enabled: hasProject },
        { label: 'Alignment: Reverse Direction', run: reverseAlignment, enabled: hasAlignment },
        { label: 'Alignments, Station Equations and Tools', run: () => app().select({ kind: 'node', id: 'alignments', label: 'Alignments' }), enabled: hasProject },
        'separator',
        { label: 'Terrain Widths, Side Profiles and TIN Settings', run: () => app().select({ kind: 'settings' }), enabled: hasProject },
      ],
    },
    {
      label: 'Structure',
      items: [
        { label: 'Structure Library (Create / Edit / Families)…', run: () => app().openDialog('structureTypes'), enabled: hasProject },
        'separator',
        { label: 'Spot Structures (Station / N-Paste / Angles / Feature Code)…', run: () => app().openDialog('spot'), enabled: hasProject },
        ...(['addStructure', 'moveStructure', 'deleteStructure'] as Tool[]).map((t): MenuItem => ({
          label: TOOL_LABEL[t] + (t === 'addStructure' ? ' (click in profile)' : t === 'moveStructure' ? ' (drag in profile)' : ' (click in profile)'), enabled: hasProject,
          checked: () => app().activeTool === t,
          run: () => { if (t === 'addStructure' && !app().spotTypeId) { app().openDialog('spot'); return; } app().showView('profile'); app().setTool(t); },
        })),
        { label: 'Structure Table…', run: () => app().openDialog('structureTable'), enabled: hasProject },
        planned('Spotting Constraints…', 'SP3'),
        planned('Optimum Spotting…', 'SP4'),
        'separator',
        { label: 'Structure Checks (Spans, Swing, Uplift, Method 1)', run: () => showSagTab(), enabled: hasProject },
        { label: 'Structure Loads (Load Trees)', run: () => { app().showView('sagtension'); requestSagTab('loads'); }, enabled: hasProject },
      ],
    },
    {
      label: 'Conductor',
      items: [
        { label: 'Cable Library (Create / Edit / Test Data)…', run: () => app().openDialog('cables'), enabled: hasProject },
        'separator',
        { label: 'String Section…', run: () => app().openDialog('stringing'), enabled: hasProject },
        { label: 'Sag Section (Tension / Catenary)…', run: () => withSection(() => {}), enabled: hasSection },
        { label: 'Automatic Sagging', run: () => withSection((id) => autoSagSection(id)), enabled: hasSection },
        { label: 'Graphical Sag (pick point in profile)', run: () => withSection(() => { app().showView('profile'); app().setTool('sagSection'); }), enabled: hasSection },
      ],
    },
    {
      label: 'Criteria',
      items: [
        { label: 'Weather Cases…', run: () => app().openDialog('criteria'), enabled: hasProject },
        planned('Code-Specific Wind and Terrain…', 'E11'),
        { label: 'Creep and Stretch Conditions, Bimetallic Model…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Cable Tension Limits…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Automatic Sagging Limits…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Weight Span Model and Conditions…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Insulator Swing Conditions…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Wire Display Condition…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Survey Point Clearance Conditions, Clearance Line…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Wire (Phase) Clearance Conditions…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Galloping…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Structure Load Cases…', run: () => app().openDialog('criteria'), enabled: hasProject },
        { label: 'Interaction Diagram Conditions (Method 2)…', run: () => app().openDialog('criteria'), enabled: hasProject },
      ],
    },
    {
      label: 'Analysis',
      items: [
        { label: 'Sag-Tension…', run: () => app().showView('sagtension'), enabled: hasProject },
        { label: 'Ruling Span (Section Properties)', run: () => withSection(() => {}), enabled: hasSection },
        { label: 'Wind and Weight Spans, Uplift', run: () => showSagTab(), enabled: hasProject },
        { label: 'Insulator Swing', run: () => showSagTab(), enabled: hasProject },
        { label: 'Tension Limits Check', run: () => app().showView('sagtension'), enabled: hasProject },
        'separator',
        { label: 'Clearances to Survey Points', run: () => showClearance('survey'), enabled: hasProject },
        { label: 'Clearances between Wires', run: () => showClearance('wires'), enabled: hasProject },
        { label: 'Galloping Ellipses', run: () => showClearance('galloping'), enabled: hasProject },
        { label: 'Clearance to TIN', run: () => showClearance('tin'), enabled: hasProject },
        { label: 'Clear Markers', run: () => app().setMarkers([]), enabled: () => app().markers.length > 0 },
        'separator',
        planned('Thermal Rating', 'X1'),
        planned('EMF', 'X2'),
      ],
    },
    {
      label: 'Drafting',
      items: [
        { label: 'Plan & Profile Sheets View', run: () => app().showView('sheets'), enabled: hasProject },
        { label: 'Sheet Setup (Page, Layout, Scales, Title)…', run: () => app().openDialog('sheetSettings'), enabled: hasProject },
        { label: 'Lines and Annotation…', run: () => app().openDialog('annotation'), enabled: hasProject },
        { label: 'Attachments (DXF / SHP / Raster)…', run: () => app().openDialog('attachments'), enabled: hasProject },
        'separator',
        { label: 'Export Sheets to PDF', run: () => exportSheets('pdf'), enabled: hasProject },
        { label: 'Export Sheets to DXF', run: () => exportSheets('dxf'), enabled: hasProject },
      ],
    },
    {
      label: 'Reports',
      items: [
        { label: 'Sag-Tension Tables (workspace)', run: () => app().showView('sagtension'), enabled: hasProject },
        { label: 'Stringing Charts (workspace)', run: () => app().showView('sagtension'), enabled: hasProject },
        { label: 'Reports (Staking, Sag-Tension, Spans, Loads, Clearances, BOM)…', run: () => app().openDialog('reports'), enabled: hasProject },
        { label: 'Staking Table to Excel', run: () => exportReport('staking', 'xls'), enabled: hasProject },
        { label: 'Sag-Tension Report to PDF', run: () => exportReport('sagTension', 'pdf'), enabled: hasProject },
        { label: 'Bill of Material to Excel', run: () => exportReport('bom', 'xls'), enabled: hasProject },
        'separator',
        { label: 'Parts, Assemblies and Material Lists…', run: () => app().openDialog('materials'), enabled: hasProject },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Getting Started (Workflow)…', run: () => app().openDialog('gettingStarted') },
        { label: 'Open Demo Line Sample', run: () => { void openDemoLine(); } },
        'separator',
        { label: 'Feature Status…', run: () => app().openDialog('features') },
        { label: 'About TLCAD…', run: () => app().openDialog('about') },
      ],
    },
  ];
}

/** Text shown at the right of a not-yet-implemented menu item. */
export function plannedTag(item: MenuItem): string | null {
  if (!item.feature) return null;
  const f = featureById(item.feature);
  if (!f) return 'planned';
  if (f.status === 'gap') return 'needs reference';
  return f.phase ? `Phase ${f.phase}` : 'planned';
}

/** Global keyboard shortcuts. Returns true when the event was handled. */
export function handleShortcut(e: KeyboardEvent): boolean {
  // While a dialog is open the model must not change behind it.
  if (app().dialog || app().confirm) return false;
  const t = e.target as HTMLElement | null;
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 's') { commands.save(); return true; }
  if (ctrl && k === 'o') { void commands.openProject(); return true; }
  if (e.altKey && k === 'n') { void commands.newProject(); return true; }
  if (typing) return false; // let text fields keep their own undo and navigation keys
  if (ctrl && k === 'z' && !e.shiftKey) { commands.undo(); return true; }
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { commands.redo(); return true; }
  if (e.key === 'F2') { app().showView('plan'); return true; }
  if (e.key === 'F3') { app().showView('profile'); return true; }
  if (e.key === 'F4') { app().showView('3d'); return true; }
  if (e.key === 'Home') { app().zoomExtents(); return true; }
  if (e.key === 'Escape' && app().activeTool !== 'select') { app().setTool('select'); return true; }
  return false;
}
