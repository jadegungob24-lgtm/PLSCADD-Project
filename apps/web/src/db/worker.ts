/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { ProjectRepository, type RepoMethod } from './repository';
import { adaptOo1, type Oo1Db } from './sqliteAdapter';

/**
 * Database worker. Opens the project database in the browser's origin-private
 * file system (OPFS) using the SAH-pool VFS, which needs no special HTTP
 * headers. If OPFS is unavailable the database is kept in memory and the
 * application is told so, so the user is warned that projects will not persist.
 */

export interface DbInitInfo {
  persistent: boolean;
  storage: string;
  sqliteVersion: string;
  warning?: string;
}

export type DbRequest =
  | { id: number; op: 'init' }
  | { id: number; op: 'call'; method: RepoMethod; args: unknown[] };

export type DbResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

let repo: ProjectRepository | null = null;
let initInfo: DbInitInfo | null = null;

/**
 * Take the exclusive cross-tab lock on the project database and hold it for the
 * life of this worker. Waits briefly, because during a page reload the previous
 * page's worker may still be shutting down. Returns false if another tab keeps it.
 */
function acquireDbLock(): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    navigator.locks
      .request('tlcad-project-db', { signal: ctl.signal }, () => {
        clearTimeout(timer);
        resolve(true);
        return new Promise<never>(() => {}); // never released while the worker lives
      })
      .catch(() => resolve(false));
  });
}

async function init(): Promise<DbInitInfo> {
  if (initInfo) return initInfo;
  const sqlite3 = await sqlite3InitModule();
  let db: Oo1Db;
  let persistent = false;
  let storage = 'memory';
  let warning: string | undefined;
  const memory = (why: string) => {
    warning = `${why} Projects are held in memory only for this session; export a .tlcad archive to keep your work.`;
    return new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db;
  };
  if (!(await acquireDbLock())) {
    // Never touch the storage while another tab holds it: a failed open makes
    // sqlite-wasm remove its storage directory, which would destroy the other tab's database.
    db = memory('TLCAD is already open in another tab or window, which holds the project database. Close the other one and reload.');
  } else {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'tlcad-pool' });
      db = new pool.OpfsSAHPoolDb('/tlcad.sqlite3') as unknown as Oo1Db;
      persistent = true;
      storage = 'OPFS (browser private file system)';
    } catch (e) {
      db = memory(`Persistent storage is unavailable (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  repo = new ProjectRepository(adaptOo1(db));
  initInfo = { persistent, storage, sqliteVersion: sqlite3.version.libVersion, ...(warning ? { warning } : {}) };
  return initInfo;
}

self.onmessage = async (ev: MessageEvent<DbRequest>) => {
  const msg = ev.data;
  const reply = (r: DbResponse) => (self as DedicatedWorkerGlobalScope).postMessage(r);
  try {
    if (msg.op === 'init') {
      reply({ id: msg.id, ok: true, result: await init() });
      return;
    }
    if (!repo) await init();
    const fn = (repo as unknown as Record<string, (...a: unknown[]) => unknown>)[msg.method];
    if (typeof fn !== 'function') throw new Error(`Unknown database method: ${msg.method}`);
    reply({ id: msg.id, ok: true, result: fn.apply(repo, msg.args) });
  } catch (e) {
    reply({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
