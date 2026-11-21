import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createProject } from '@tlcad/model';
import { ProjectRepository } from './repository';
import { adaptOo1, type Oo1Db } from './sqliteAdapter';

/** Runs the repository against real SQLite (WASM build, in-memory database). */
let newRepo: () => ProjectRepository;

beforeAll(async () => {
  const sqlite3 = await sqlite3InitModule();
  newRepo = () => new ProjectRepository(adaptOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db));
});

const t0 = new Date('2026-11-15T00:00:00Z');

describe('project repository', () => {
  it('saves, lists, reloads and deletes projects', () => {
    const repo = newRepo();
    const a = createProject({ name: 'Line A', client: 'Utility', unitSystem: 'US', nominalVoltageKV: 230 }, t0);
    const b = createProject({ name: 'Line B' }, new Date('2026-11-16T00:00:00Z'));
    repo.saveProject(a);
    repo.saveProject(b);
    const list = repo.listProjects();
    expect(list.map((p) => p.name)).toEqual(['Line B', 'Line A']);
    expect(list[1]).toMatchObject({ client: 'Utility', unitSystem: 'US', revisionCount: 0 });
    expect(repo.loadProject(a.id)).toEqual(a);

    const a2 = { ...a, meta: { ...a.meta, name: 'Line A rev', modifiedAt: '2026-11-17T00:00:00.000Z' } };
    repo.saveProject(a2);
    expect(repo.listProjects()).toHaveLength(2);
    expect(repo.loadProject(a.id).meta.name).toBe('Line A rev');

    repo.deleteProject(a.id);
    expect(repo.listProjects().map((p) => p.id)).toEqual([b.id]);
    expect(() => repo.loadProject(a.id)).toThrow();
  });

  it('stores revisions as independent snapshots', () => {
    const repo = newRepo();
    const p = createProject({ name: 'Rev test' }, t0);
    expect(() => repo.createRevision(p, 'A', '', t0.toISOString())).toThrow(/Save the project/);
    repo.saveProject(p);
    const id1 = repo.createRevision(p, 'Rev A', 'issued for review', '2026-11-15T01:00:00.000Z');
    const changed = { ...p, meta: { ...p.meta, description: 'changed' } };
    repo.saveProject(changed);
    const id2 = repo.createRevision(changed, 'Rev B', '', '2026-11-15T02:00:00.000Z');

    const revs = repo.listRevisions(p.id);
    expect(revs.map((r) => r.label)).toEqual(['Rev B', 'Rev A']);
    expect(revs[0]!.stats.terrainPoints).toBe(0);
    expect(repo.loadRevision(id1).project.meta.description).toBe('');
    expect(repo.loadRevision(id2).project.meta.description).toBe('changed');
    expect(repo.listProjects()[0]!.revisionCount).toBe(2);

    repo.deleteRevision(id1);
    expect(repo.listRevisions(p.id)).toHaveLength(1);
    repo.deleteProject(p.id);
    expect(repo.listRevisions(p.id)).toHaveLength(0);
  });

  it('stores settings', () => {
    const repo = newRepo();
    expect(repo.getSetting('lastProjectId')).toBeNull();
    repo.setSetting('lastProjectId', 'abc');
    repo.setSetting('lastProjectId', 'def');
    expect(repo.getSetting('lastProjectId')).toBe('def');
    repo.setSetting('lastProjectId', null);
    expect(repo.getSetting('lastProjectId')).toBeNull();
  });
});
