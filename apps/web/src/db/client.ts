import type { ProjectRepository, RepoMethod } from './repository';
import type { DbInitInfo, DbRequest, DbResponse } from './worker';

type Fn = (...args: never[]) => unknown;
type Asyncify<T> = {
  [K in keyof T as T[K] extends Fn ? K : never]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<R> : never;
};

export type DbApi = Asyncify<ProjectRepository>;

/** Promise-based client for the database worker. */
export class DbClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly api: DbApi;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<DbResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = (ev) => {
      const err = new Error(`Database worker failed: ${ev.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    this.api = new Proxy({} as DbApi, {
      get: (_t, method: string) => (...args: unknown[]) =>
        this.send({ id: ++this.seq, op: 'call', method: method as RepoMethod, args }),
    });
  }

  private send(msg: DbRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject });
      this.worker.postMessage(msg);
    });
  }

  init(): Promise<DbInitInfo> {
    return this.send({ id: ++this.seq, op: 'init' }) as Promise<DbInitInfo>;
  }
}
