import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createProject } from '@tlcad/model';
import { FormatRegistry, packArchive, unpackArchive } from '../src';

const now = new Date('2026-11-15T00:00:00Z');

function sample() {
  const p = createProject({ name: 'Archive test', client: 'ACME', nominalVoltageKV: 138, unitSystem: 'US' }, now);
  p.terrain.points.push({
    id: 'a', desc: 'PT 1', x: 591549.81, y: 5318909.74, z: 716.594, code: 200, h: 0,
    profNote: '', planNote: 'Hydrant', active: true, src: 'imported',
  });
  return p;
}

describe('.tlcad archive', () => {
  it('round-trips a project and its revisions identically', () => {
    const p = sample();
    const rev = { label: 'Rev A', note: 'first issue', createdAt: now.toISOString(), project: createProject({ name: 'older' }, now) };
    const r = unpackArchive(packArchive(p, [rev], '0.1.0', now));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.project).toEqual(p);
    expect(r.content.revisions).toEqual([rev]);
    expect(r.content.manifest.projectName).toBe('Archive test');
    expect(r.content.manifest.revisionCount).toBe(1);
  });

  it('rejects non-zip data', () => {
    const r = unpackArchive(strToU8('not a zip'));
    expect(r.ok).toBe(false);
  });

  it('rejects an archive whose project fails schema validation', () => {
    const bad = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'tlcad-project', version: 1 })),
      'project.json': strToU8(JSON.stringify({ schemaVersion: 1, id: 'x' })),
    });
    const r = unpackArchive(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('project.json');
  });

  it('rejects archives from a newer format version', () => {
    const p = sample();
    const z = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'tlcad-project', version: 99 })),
      'project.json': strToU8(JSON.stringify(p)),
    });
    expect(unpackArchive(z).ok).toBe(false);
  });
});

describe('format registry', () => {
  it('registers handlers and finds importers by extension', () => {
    const reg = new FormatRegistry();
    reg.register({ id: 'a', name: 'A', kind: 'terrain', extensions: ['xyz'], import: () => ({ label: 'x', messages: [] }) });
    reg.register({ id: 'b', name: 'B', kind: 'terrain', extensions: ['csv', 'txt'], import: () => ({ label: 'x', messages: [] }) });
    reg.register({ id: 'c', name: 'C', kind: 'drawing', extensions: ['dxf'], export: () => ({ fileName: 'a.dxf', mimeType: 'x', data: '', messages: [] }) });
    expect(reg.importersFor('Survey.XYZ').map((h) => h.id)).toEqual(['a']);
    expect(reg.importersFor('a.dxf')).toEqual([]);
    expect(reg.exporters('drawing').map((h) => h.id)).toEqual(['c']);
    expect(reg.acceptString('terrain')).toBe('.xyz,.csv,.txt');
    expect(() => reg.register({ id: 'a', name: 'dup', kind: 'terrain', extensions: [] })).toThrow();
  });
});
