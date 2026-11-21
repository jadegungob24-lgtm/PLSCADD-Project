import { projectStats, validateProject, type Project } from '@tlcad/model';

/**
 * Project database repository (SQLite).
 *
 * The repository talks to SQLite through a minimal interface so the same code
 * runs in the browser worker (sqlite-wasm on OPFS) and in Node tests
 * (sqlite-wasm in memory).
 */

export interface SqlDb {
  run(sql: string, bind?: unknown[]): void;
  all<T = Record<string, unknown>>(sql: string, bind?: unknown[]): T[];
  transaction<T>(fn: () => T): T;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  client: string;
  lineName: string;
  unitSystem: string;
  createdAt: string;
  modifiedAt: string;
  revisionCount: number;
}

export interface RevisionSummary {
  id: number;
  projectId: string;
  label: string;
  note: string;
  createdAt: string;
  stats: Record<string, number>;
}

export const DB_SCHEMA_VERSION = 1;

export function migrate(db: SqlDb): void {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = db.all<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`)[0];
  const current = row ? Number(row.value) : 0;
  if (current > DB_SCHEMA_VERSION) {
    throw new Error(`Database schema ${current} is newer than this application supports (${DB_SCHEMA_VERSION}).`);
  }
  if (current < 1) {
    db.transaction(() => {
      db.run(`CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        client TEXT NOT NULL DEFAULT '',
        line_name TEXT NOT NULL DEFAULT '',
        unit_system TEXT NOT NULL,
        created_at TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        data TEXT NOT NULL
      )`);
      db.run(`CREATE TABLE revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        stats TEXT NOT NULL,
        data TEXT NOT NULL
      )`);
      db.run(`CREATE INDEX revisions_project ON revisions(project_id, created_at)`);
      db.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '1')`);
    });
  }
  db.run(`PRAGMA foreign_keys = ON`);
}

export class ProjectRepository {
  constructor(private db: SqlDb) {
    migrate(db);
  }

  listProjects(): ProjectSummary[] {
    return this.db.all<ProjectSummary>(
      `SELECT p.id, p.name, p.description, p.client, p.line_name AS lineName, p.unit_system AS unitSystem,
              p.created_at AS createdAt, p.modified_at AS modifiedAt,
              (SELECT COUNT(*) FROM revisions r WHERE r.project_id = p.id) AS revisionCount
       FROM projects p ORDER BY p.modified_at DESC`,
    );
  }

  projectExists(id: string): boolean {
    return this.db.all(`SELECT 1 FROM projects WHERE id = ?`, [id]).length > 0;
  }

  saveProject(p: Project): void {
    this.db.run(
      `INSERT INTO projects (id, name, description, client, line_name, unit_system, created_at, modified_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
         client = excluded.client, line_name = excluded.line_name, unit_system = excluded.unit_system,
         modified_at = excluded.modified_at, data = excluded.data`,
      [p.id, p.meta.name, p.meta.description, p.meta.client, p.meta.lineName, p.settings.unitSystem,
        p.meta.createdAt, p.meta.modifiedAt, JSON.stringify(p)],
    );
  }

  loadProject(id: string): Project {
    const row = this.db.all<{ data: string }>(`SELECT data FROM projects WHERE id = ?`, [id])[0];
    if (!row) throw new Error('Project not found in the database.');
    const v = validateProject(JSON.parse(row.data));
    if (!v.ok) throw new Error(`Stored project is invalid: ${v.errors.slice(0, 3).join('; ')}`);
    return v.project;
  }

  deleteProject(id: string): void {
    this.db.transaction(() => {
      this.db.run(`DELETE FROM revisions WHERE project_id = ?`, [id]);
      this.db.run(`DELETE FROM projects WHERE id = ?`, [id]);
    });
  }

  listRevisions(projectId: string): RevisionSummary[] {
    return this.db
      .all<{ id: number; projectId: string; label: string; note: string; createdAt: string; stats: string }>(
        `SELECT id, project_id AS projectId, label, note, created_at AS createdAt, stats
         FROM revisions WHERE project_id = ? ORDER BY id DESC`,
        [projectId],
      )
      .map((r) => ({ ...r, stats: JSON.parse(r.stats) as Record<string, number> }));
  }

  /** Store a snapshot of the project. The project row must already exist. */
  createRevision(p: Project, label: string, note: string, createdAt: string): number {
    if (!this.projectExists(p.id)) throw new Error('Save the project before creating a revision.');
    this.db.run(
      `INSERT INTO revisions (project_id, label, note, created_at, stats, data) VALUES (?, ?, ?, ?, ?, ?)`,
      [p.id, label, note, createdAt, JSON.stringify(projectStats(p)), JSON.stringify(p)],
    );
    return this.db.all<{ id: number }>(`SELECT last_insert_rowid() AS id`)[0]!.id;
  }

  loadRevision(id: number): { label: string; note: string; createdAt: string; project: Project } {
    const row = this.db.all<{ label: string; note: string; createdAt: string; data: string }>(
      `SELECT label, note, created_at AS createdAt, data FROM revisions WHERE id = ?`,
      [id],
    )[0];
    if (!row) throw new Error('Revision not found.');
    const v = validateProject(JSON.parse(row.data));
    if (!v.ok) throw new Error('Stored revision is invalid.');
    return { label: row.label, note: row.note, createdAt: row.createdAt, project: v.project };
  }

  deleteRevision(id: number): void {
    this.db.run(`DELETE FROM revisions WHERE id = ?`, [id]);
  }

  getSetting(key: string): string | null {
    return this.db.all<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [key])[0]?.value ?? null;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) this.db.run(`DELETE FROM settings WHERE key = ?`, [key]);
    else this.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  }
}

/** Methods callable through the worker RPC. */
export type RepoMethod = Exclude<keyof ProjectRepository, 'constructor'>;
