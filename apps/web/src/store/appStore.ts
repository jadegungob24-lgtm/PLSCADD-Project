import { create } from 'zustand';
import type { Draft } from 'immer';
import {
  canRedo, canUndo, createProject, emptyHistory, execute, newId, redo, undo,
  type History, type HistoryEntry, type NewProjectOptions, type Project,
} from '@tlcad/model';
import { packArchive, unpackArchive, type ArchivedRevision } from '@tlcad/io';
import { DbClient } from '../db/client';
import type { DbInitInfo } from '../db/worker';
import type { ProjectSummary, RevisionSummary } from '../db/repository';

export const APP_VERSION = '0.2.0';

export type LogLevel = 'info' | 'result' | 'warning' | 'error';
export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  text: string;
}

export type ViewKind = 'plan' | 'profile' | '3d' | 'map' | 'sagtension' | 'structure' | 'clearance' | 'sheets';
export const VIEW_LABEL: Record<ViewKind, string> = {
  plan: 'Plan',
  profile: 'Profile',
  '3d': '3D',
  map: 'Map',
  sagtension: 'Sag-Tension',
  structure: 'Structure',
  clearance: 'Clearance',
  sheets: 'Sheets',
};
export type TileMode = 'single' | 'vertical' | 'horizontal' | 'quad';

/** A clearance marker: a point, or a line between two points (e.g. the closest points of two wires). */
export interface Marker {
  status: 'violation' | 'questionable' | 'ok';
  a: { x: number; y: number; z: number };
  b?: { x: number; y: number; z: number };
  /** Virtual stations of a and b for the profile view; null when not on an alignment. */
  sa: number | null;
  sb?: number | null;
  label: string;
}

export type DialogKind =
  | 'new' | 'open' | 'revisions' | 'features' | 'about'
  | 'importCsv' | 'importPfl' | 'featureCodes' | 'terrainPoints'
  | 'importDem' | 'importLas' | 'crs' | 'interpolate'
  | 'cables' | 'structureTypes' | 'spot' | 'structureTable' | 'stringing' | 'criteria' | 'sheetSettings' | 'annotation' | 'attachments' | 'materials' | 'reports' | 'gettingStarted' | null;

/** Interactive tool of the plan view (manual §6.3.1: add, insert, move, delete P.I.). */
export type Tool = 'select' | 'addPi' | 'insertPi' | 'movePi' | 'deletePi' | 'addStructure' | 'moveStructure' | 'deleteStructure' | 'sagSection';
export const TOOL_LABEL: Record<Tool, string> = {
  select: 'Select / Pan', addPi: 'Add P.I.', insertPi: 'Insert P.I.', movePi: 'Move P.I.', deletePi: 'Delete P.I.',
  addStructure: 'Add Structure', moveStructure: 'Move Structure', deleteStructure: 'Delete Structure', sagSection: 'Graphical Sag',
};

/** What the explorer selection points at; drives the Properties panel. */
export type Selection =
  | { kind: 'project' }
  | { kind: 'settings' }
  | { kind: 'node'; id: string; label: string }
  | { kind: 'structure'; id: string }
  | { kind: 'section'; id: string }
  | { kind: 'structureType'; id: string }
  | null;

export interface CursorStatus {
  x: number | null;
  y: number | null;
  station: number | null;
  offset: number | null;
  elevation: number | null;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface AppState {
  db: DbClient | null;
  dbInfo: DbInitInfo | null;
  ready: boolean;

  project: Project | null;
  history: History;
  dirty: boolean;
  /** True once the open project has been written to the database at least once. */
  stored: boolean;
  /**
   * Undo-stack entry that was on top at the last save (null = empty stack).
   * undefined means the saved state cannot be reached by undo/redo.
   */
  savedMark: HistoryEntry | null | undefined;

  log: LogEntry[];
  selection: Selection;
  dialog: DialogKind;
  confirm: ConfirmRequest | null;
  panes: ViewKind[];
  tile: TileMode;
  activePane: number;
  activeTool: Tool;
  /** Text of a file chosen for an import that needs options (CSV mapping, PFL origin). */
  pendingFile: { name: string; text: string } | null;
  /** Parsed binary file waiting for import options (DEM grid, LAS point cloud). */
  pendingData: { name: string; data: unknown } | null;
  /** Alignment that the P.I. tools act on (manual: the profile of every alignment is always shown). */
  activeAlignmentId: string | null;
  /** Structure type used by the Add Structure tool. */
  spotTypeId: string | null;
  /** Clearance markers shown in the plan, profile and 3-D views (§11.2.3); cleared with View ▸ Clear Markers. */
  markers: Marker[];
  cursor: CursorStatus;
  /** Incremented by View ▸ Zoom Extents; views listen and refit. */
  fitSignal: number;

  init(): Promise<void>;
  addLog(level: LogLevel, text: string): void;
  clearLog(): void;
  ask(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean>;
  confirmDiscard(): Promise<boolean>;

  newProject(opts: NewProjectOptions): Promise<void>;
  listProjects(): Promise<ProjectSummary[]>;
  openProject(id: string): Promise<void>;
  saveProject(): Promise<boolean>;
  closeProject(): Promise<void>;
  deleteProject(id: string): Promise<void>;

  exec(label: string, recipe: (d: Draft<Project>) => void): void;
  undo(): void;
  redo(): void;

  listRevisions(): Promise<RevisionSummary[]>;
  createRevision(label: string, note: string): Promise<void>;
  restoreRevision(id: number): Promise<void>;
  deleteRevision(id: number): Promise<void>;

  exportArchive(): Promise<void>;
  importArchive(file: File): Promise<void>;

  select(s: Selection): void;
  openDialog(d: DialogKind): void;
  setTile(mode: TileMode): void;
  setPaneView(pane: number, view: ViewKind): void;
  showView(view: ViewKind): void;
  setActivePane(i: number): void;
  setCursor(c: Partial<CursorStatus>): void;
  setTool(t: Tool): void;
  setPendingFile(f: { name: string; text: string } | null, dialog: DialogKind): void;
  setPendingData(f: { name: string; data: unknown } | null, dialog: DialogKind): void;
  setActiveAlignment(id: string | null): void;
  setSpotType(id: string | null): void;
  setMarkers(m: Marker[]): void;
  zoomExtents(): void;
}

const emptyCursor: CursorStatus = { x: null, y: null, station: null, offset: null, elevation: null };
let logSeq = 0;

function download(data: Uint8Array | string, fileName: string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeFileName = (s: string) => s.replace(/[^\w\-. ]+/g, '_').trim() || 'project';
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PANE_DEFAULTS: ViewKind[] = ['plan', 'profile', '3d', 'sagtension'];

export const useApp = create<AppState>((set, get) => {
  const db = () => {
    const d = get().db;
    if (!d) throw new Error('Database is not initialised.');
    return d.api;
  };

  const top = (h: History) => h.past[h.past.length - 1] ?? null;
  /** The project differs from the saved one unless the undo stack is back at the saved entry. */
  const dirtyFor = (h: History) => top(h) !== get().savedMark;

  const setOpen = (project: Project | null, stored: boolean, dirty: boolean) =>
    set({
      project, stored, dirty, history: emptyHistory(), savedMark: dirty ? undefined : null, activeTool: 'select', activeAlignmentId: null, spotTypeId: null, markers: [],
      selection: project ? { kind: 'project' } : null, cursor: emptyCursor,
    });

  return {
    db: null,
    dbInfo: null,
    ready: false,
    project: null,
    history: emptyHistory(),
    dirty: false,
    stored: false,
    savedMark: null,
    log: [],
    selection: null,
    dialog: null,
    confirm: null,
    panes: ['plan'],
    tile: 'single',
    activePane: 0,
    activeTool: 'select',
    pendingFile: null,
    pendingData: null,
    activeAlignmentId: null,
    spotTypeId: null,
  markers: [],
    cursor: emptyCursor,
    fitSignal: 0,

    async init() {
      if (get().db) return;
      const client = new DbClient();
      set({ db: client });
      try {
        const info = await client.init();
        set({ dbInfo: info });
        get().addLog('info', `Project database ready: SQLite ${info.sqliteVersion}, storage: ${info.storage}.`);
        if (info.warning) get().addLog('warning', info.warning);
        const last = await client.api.getSetting('lastProjectId');
        if (last && (await client.api.projectExists(last))) await get().openProject(last);
      } catch (e) {
        get().addLog('error', `Database initialisation failed: ${errText(e)}`);
      }
      set({ ready: true });
    },

    addLog(level, text) {
      const entry: LogEntry = { id: ++logSeq, time: new Date().toLocaleTimeString(), level, text };
      set((s) => ({ log: [...s.log.slice(-999), entry] }));
    },
    clearLog: () => set({ log: [] }),

    ask(req) {
      return new Promise<boolean>((resolve) => {
        set({ confirm: { ...req, resolve: (ok) => { set({ confirm: null }); resolve(ok); } } });
      });
    },

    async confirmDiscard() {
      const { project, dirty } = get();
      if (!project || !dirty) return true;
      return get().ask({
        title: 'Unsaved changes',
        message: `"${project.meta.name}" has unsaved changes. Discard them?`,
        confirmLabel: 'Discard changes',
        danger: true,
      });
    },

    async newProject(opts) {
      const p = createProject(opts);
      setOpen(p, false, true);
      set({ dialog: null });
      get().addLog('info', `Created project "${p.meta.name}" (${p.settings.unitSystem}). Not yet saved.`);
      get().zoomExtents();
    },

    listProjects: () => db().listProjects(),

    async openProject(id) {
      try {
        const p = await db().loadProject(id);
        setOpen(p, true, false);
        set({ dialog: null });
        await db().setSetting('lastProjectId', id);
        get().addLog('info', `Opened project "${p.meta.name}".`);
        get().zoomExtents();
      } catch (e) {
        get().addLog('error', `Open failed: ${errText(e)}`);
      }
    },

    async saveProject() {
      const { project } = get();
      if (!project) return false;
      const toSave: Project = { ...project, meta: { ...project.meta, modifiedAt: new Date().toISOString() } };
      try {
        await db().saveProject(toSave);
        await db().setSetting('lastProjectId', toSave.id);
        // Keep undo history: only the timestamp changed, outside the command stack.
        set({ project: toSave, dirty: false, stored: true, savedMark: top(get().history) });
        const persistent = get().dbInfo?.persistent;
        get().addLog('info', `Saved "${toSave.meta.name}"${persistent ? '' : ' (in-memory database: export an archive to keep it)'}.`);
        return true;
      } catch (e) {
        get().addLog('error', `Save failed: ${errText(e)}`);
        return false;
      }
    },

    async closeProject() {
      const p = get().project;
      if (!p) return;
      if (!(await get().confirmDiscard())) return;
      setOpen(null, false, false);
      try { await db().setSetting('lastProjectId', null); } catch { /* database unavailable */ }
      get().addLog('info', `Closed project "${p.meta.name}".`);
    },

    async deleteProject(id) {
      try {
        await db().deleteProject(id);
        if (get().project?.id === id) setOpen(null, false, false);
        get().addLog('info', 'Project deleted from the database.');
      } catch (e) {
        get().addLog('error', `Delete failed: ${errText(e)}`);
      }
    },

    exec(label, recipe) {
      const { project, history } = get();
      if (!project) return;
      const r = execute(project, history, label, recipe);
      if (!r.changed) return;
      // Once the oldest entries are dropped, an empty-stack save point can no longer be reached by undo.
      if (history.past.length >= history.limit && get().savedMark === null) set({ savedMark: undefined });
      set({ project: r.state, history: r.history, dirty: dirtyFor(r.history) });
    },

    undo() {
      const { project, history } = get();
      if (!project || !canUndo(history)) return;
      const label = history.past[history.past.length - 1]!.label;
      const r = undo(project, history);
      set({ project: r.state, history: r.history, dirty: dirtyFor(r.history) });
      get().addLog('info', `Undo: ${label}`);
    },

    redo() {
      const { project, history } = get();
      if (!project || !canRedo(history)) return;
      const label = history.future[0]!.label;
      const r = redo(project, history);
      set({ project: r.state, history: r.history, dirty: dirtyFor(r.history) });
      get().addLog('info', `Redo: ${label}`);
    },

    async listRevisions() {
      const p = get().project;
      if (!p || !get().stored) return [];
      return db().listRevisions(p.id);
    },

    async createRevision(label, note) {
      if (!get().project) return;
      // A revision records the saved state, so save first.
      if (get().dirty || !get().stored) {
        if (!(await get().saveProject())) return;
      }
      const p = get().project!;
      try {
        await db().createRevision(p, label, note, new Date().toISOString());
        get().addLog('info', `Revision "${label}" created.`);
      } catch (e) {
        get().addLog('error', `Revision failed: ${errText(e)}`);
      }
    },

    async restoreRevision(id) {
      const current = get().project;
      if (!current) return;
      try {
        const rev = await db().loadRevision(id);
        const ok = await get().ask({
          title: 'Restore revision',
          message: `Replace the current project contents with revision "${rev.label}"? ` +
            'Undo history is cleared. The restored state is not saved until you save.',
          confirmLabel: 'Restore',
        });
        if (!ok) return;
        set({
          project: { ...rev.project, id: current.id },
          history: emptyHistory(), dirty: true, savedMark: undefined, selection: { kind: 'project' },
        });
        get().addLog('info', `Restored revision "${rev.label}" (unsaved).`);
        get().zoomExtents();
      } catch (e) {
        get().addLog('error', `Restore failed: ${errText(e)}`);
      }
    },

    async deleteRevision(id) {
      try {
        await db().deleteRevision(id);
        get().addLog('info', 'Revision deleted.');
      } catch (e) {
        get().addLog('error', `Delete revision failed: ${errText(e)}`);
      }
    },

    async exportArchive() {
      const p = get().project;
      if (!p) return;
      try {
        const revisions: ArchivedRevision[] = [];
        if (get().stored) {
          for (const r of await db().listRevisions(p.id)) revisions.push(await db().loadRevision(r.id));
          revisions.reverse();
        }
        const bytes = packArchive(p, revisions, APP_VERSION);
        const name = `${safeFileName(p.meta.name)}.tlcad`;
        download(bytes, name, 'application/zip');
        get().addLog('info', `Exported ${name} (${(bytes.length / 1024).toFixed(1)} kB, ${revisions.length} revision(s))` +
          `${get().dirty ? ' including unsaved changes' : ''}.`);
      } catch (e) {
        get().addLog('error', `Export failed: ${errText(e)}`);
      }
    },

    async importArchive(file) {
      try {
        const r = unpackArchive(new Uint8Array(await file.arrayBuffer()));
        if (!r.ok) {
          get().addLog('error', `Import of ${file.name} failed: ${r.errors.join(' ')}`);
          return;
        }
        if (!(await get().confirmDiscard())) return;
        let project = r.content.project;
        if (await db().projectExists(project.id)) {
          project = { ...project, id: newId(), meta: { ...project.meta, name: `${project.meta.name} (imported)` } };
          get().addLog('warning', 'A project with the same identity already exists; the archive was imported as a copy.');
        }
        await db().saveProject(project);
        for (const rev of r.content.revisions) {
          await db().createRevision({ ...rev.project, id: project.id }, rev.label, rev.note, rev.createdAt);
        }
        setOpen(project, true, false);
        set({ dialog: null });
        await db().setSetting('lastProjectId', project.id);
        get().addLog('info', `Imported "${project.meta.name}" from ${file.name} with ${r.content.revisions.length} revision(s).`);
        get().zoomExtents();
      } catch (e) {
        get().addLog('error', `Import failed: ${errText(e)}`);
      }
    },

    select: (selection) => set({ selection }),
    openDialog: (dialog) => set({ dialog }),

    setTile(mode) {
      const n = mode === 'single' ? 1 : mode === 'quad' ? 4 : 2;
      const cur = get().panes;
      const panes: ViewKind[] = [];
      for (let i = 0; i < n; i++) {
        const want = cur[i] ?? PANE_DEFAULTS.find((v) => !panes.includes(v) && !cur.slice(0, n).includes(v)) ?? 'plan';
        panes.push(want);
      }
      set({ tile: mode, panes, activePane: Math.min(get().activePane, n - 1) });
    },

    setPaneView(pane, view) {
      set((s) => ({ panes: s.panes.map((v, i) => (i === pane ? view : v)), activePane: pane }));
    },

    showView(view) {
      const { panes, activePane } = get();
      const existing = panes.indexOf(view);
      if (existing >= 0) set({ activePane: existing });
      else get().setPaneView(activePane, view);
    },

    setActivePane: (activePane) => set({ activePane }),
    setCursor: (c) => set((s) => ({ cursor: { ...s.cursor, ...c } })),
    setTool: (activeTool) => set({ activeTool }),
    setPendingFile: (pendingFile, dialog) => set({ pendingFile, dialog }),
    setPendingData: (pendingData, dialog) => set({ pendingData, dialog }),
    setActiveAlignment: (activeAlignmentId) => set({ activeAlignmentId }),
    setSpotType: (spotTypeId) => set({ spotTypeId }),
  setMarkers: (markers) => set({ markers }),
    zoomExtents: () => set((s) => ({ fitSignal: s.fitSignal + 1 })),
  };
});
