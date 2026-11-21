import type { SqlDb } from './repository';

/** Subset of the sqlite-wasm oo1 database object used by the adapter. */
export interface Oo1Db {
  exec(opts: {
    sql: string;
    bind?: unknown[];
    rowMode?: 'object';
    returnValue?: 'resultRows';
  }): unknown;
}

export function adaptOo1(db: Oo1Db): SqlDb {
  const run = (sql: string, bind?: unknown[]) => {
    db.exec(bind && bind.length ? { sql, bind } : { sql });
  };
  return {
    run,
    all<T>(sql: string, bind?: unknown[]): T[] {
      return db.exec({
        sql,
        ...(bind && bind.length ? { bind } : {}),
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as T[];
    },
    transaction<T>(fn: () => T): T {
      run('BEGIN');
      try {
        const out = fn();
        run('COMMIT');
        return out;
      } catch (e) {
        run('ROLLBACK');
        throw e;
      }
    },
  };
}
