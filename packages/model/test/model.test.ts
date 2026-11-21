import { describe, expect, it } from 'vitest';
import {
  createProject, validateProject, emptyHistory, execute, undo, redo, canUndo, canRedo,
  FEATURES, featureSummary, type Project,
} from '../src';

const fixedDate = new Date('2026-11-15T00:00:00Z');

describe('project model', () => {
  it('creates a project that validates against the schema', () => {
    const p = createProject({ name: 'Test 230 kV', nominalVoltageKV: 230 }, fixedDate);
    const r = validateProject(p);
    expect(r.ok).toBe(true);
    expect(p.meta.nominalVoltageKV).toEqual({ v: 230, src: 'user' });
    expect(p.settings.unitSystem).toBe('SI_N');
  });

  it('survives a JSON round trip unchanged', () => {
    const p = createProject({ name: 'RT' }, fixedDate);
    const back = validateProject(JSON.parse(JSON.stringify(p)));
    expect(back.ok && back.project).toEqual(p);
  });

  it('opens a project saved before Phase 2 by filling the new terrain settings with the manual defaults', () => {
    const p = JSON.parse(JSON.stringify(createProject({ name: 'old' }, fixedDate)));
    delete p.settings.terrain;
    delete p.terrain.voltages;
    const r = validateProject(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.settings.terrain.mopv).toBeCloseTo(15.24, 9);   // 50 ft
    expect(r.project.settings.terrain.mocgp).toBeCloseTo(3.048, 9);  // 10 ft
    expect(r.project.terrain.voltages).toEqual([]);
  });

  it('rejects malformed data with readable errors', () => {
    const r = validateProject({ schemaVersion: 1, id: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.startsWith('meta'))).toBe(true);
  });
});

describe('undo / redo', () => {
  it('undoes and redoes 25 sequential edits exactly', () => {
    let state: Project = createProject({ name: 'H' }, fixedDate);
    let hist = emptyHistory();
    const original = state;
    const snapshots: Project[] = [state];
    for (let i = 0; i < 25; i++) {
      const r = execute(state, hist, `add point ${i}`, (d) => {
        d.terrain.points.push({
          id: `p${i}`, desc: '', x: i, y: 2 * i, z: 100 + i, code: 200, h: 0,
          profNote: '', planNote: '', active: true, src: 'user',
        });
        d.meta.description = `edit ${i}`;
      });
      state = r.state; hist = r.history;
      snapshots.push(state);
    }
    expect(state.terrain.points).toHaveLength(25);
    for (let i = 24; i >= 0; i--) {
      const r = undo(state, hist); state = r.state; hist = r.history;
      expect(state).toEqual(snapshots[i]);
    }
    expect(state).toEqual(original);
    expect(canUndo(hist)).toBe(false);
    for (let i = 1; i <= 25; i++) {
      const r = redo(state, hist); state = r.state; hist = r.history;
      expect(state).toEqual(snapshots[i]);
    }
    expect(canRedo(hist)).toBe(false);
  });

  it('a new edit clears the redo stack; no-op edits are not recorded', () => {
    let state = createProject({ name: 'H' }, fixedDate);
    let hist = emptyHistory();
    ({ state, history: hist } = execute(state, hist, 'a', (d) => { d.meta.client = 'A'; }));
    ({ state, history: hist } = undo(state, hist));
    expect(canRedo(hist)).toBe(true);
    ({ state, history: hist } = execute(state, hist, 'b', (d) => { d.meta.client = 'B'; }));
    expect(canRedo(hist)).toBe(false);
    const noop = execute(state, hist, 'noop', (d) => { d.meta.client = 'B'; });
    expect(noop.changed).toBe(false);
    expect(noop.history.past).toHaveLength(1);
  });
});

describe('feature registry', () => {
  it('has unique ids and every status is counted', () => {
    const ids = new Set(FEATURES.map((f) => f.id));
    expect(ids.size).toBe(FEATURES.length);
    const s = featureSummary();
    expect(s.implemented + s.partial + s.planned + s.gap).toBe(FEATURES.length);
  });
});
