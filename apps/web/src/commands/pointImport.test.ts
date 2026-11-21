import { describe, expect, it } from 'vitest';
import { useApp } from '../store/appStore';
import { beginPastedImport, finishCsvImport } from './terrain';

/**
 * Import of coordinates pasted from Excel through the store commands: the
 * dialog's options are applied, the points are added and the plan view is shown.
 */
const app = () => useApp.getState();

async function projectWithTin() {
  await app().newProject({ name: 'Point import test', unitSystem: 'SI_N' });
  // A plane z = 100 + 0.01 x over a 1 km square, as ground points (code 2) with the TIN on.
  app().exec('Ground', (d) => {
    d.terrain.points = [[0, 0], [1000, 0], [0, 1000], [1000, 1000]].map(([x, y], i) => ({
      id: `g${i}`, desc: '', x: x!, y: y!, z: 100 + 0.01 * x!, code: 2, h: 0, profNote: '', planNote: '', active: true, src: 'user' as const,
    }));
    d.terrain.featureCodes = [{ code: 2, description: 'Ground', onGround: true, aerial: false, color: '#0a0', clearances: {}, src: 'user' }];
    d.settings.terrain.tinEnabled = true;
  });
  app().showView('profile');
}

const pasted = 'Pole\tEasting\tNorthing\nA\t250\t500\nB\t1,000\t1,000\nOutside\t2,000\t500\n';
const base = { delimiter: '\t' as const, skipLines: 1, colX: 2, colY: 3, colZ: 0, colDesc: 1, colCode: 0, colH: 0, defaultCode: 900, unit: 'm' as const };

describe('importing points pasted from Excel', () => {
  it('takes elevations from the TIN, skips points outside it, and shows the plan view', async () => {
    await projectWithTin();
    beginPastedImport(pasted);
    expect(app().dialog).toBe('importCsv');
    finishCsvImport({ ...base, zMode: 'surface' }, false);
    const pts = app().project!.terrain.points.filter((p) => p.code === 900);
    expect(pts.map((p) => [p.desc, p.x, p.y])).toEqual([['A', 250, 500], ['B', 1000, 1000]]);
    expect(pts[0]!.z).toBeCloseTo(102.5, 9);   // 100 + 0.01 × 250 on the TIN plane
    expect(pts[1]!.z).toBeCloseTo(110, 9);
    expect(app().log.some((l) => l.level === 'warning' && /outside the TIN/.test(l.text))).toBe(true);
    expect(app().panes[app().activePane]).toBe('plan');
    // Plot points: the new code is off the ground, so the TIN keeps its 4 ground vertices.
    expect(app().project!.terrain.featureCodes.find((c) => c.code === 900)!.onGround).toBe(false);
    expect(app().dialog).toBeNull();
  });

  it('points at one elevation get a feature code that is not on the ground', async () => {
    await projectWithTin();
    beginPastedImport(pasted);
    finishCsvImport({ ...base, zMode: 'constant', zConstant: 0 }, false);
    const p = app().project!;
    expect(p.terrain.points.filter((q) => q.code === 900)).toHaveLength(3);
    expect(p.terrain.featureCodes.find((c) => c.code === 900)!.onGround).toBe(false);
  });
});
