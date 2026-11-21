import { describe, expect, it } from 'vitest';
import { lineProject } from './testFixtures';
import { computeDerived } from './derived';
import { computeLineModel } from './lineModel';

describe('line model', () => {
  it('numbers structures in station order and places them on the ground', () => {
    const p = lineProject();
    const m = computeLineModel(p, computeDerived(p));
    expect(m.structures.map((s) => [s.s.id, s.number])).toEqual([['s1', 1], ['s2', 2], ['s3', 3]]);
    const s2 = m.byId.get('s2')!;
    expect(s2.station).toBe(1150);
    expect(s2.ground).toBe(100);
    expect(s2.groundSource).toBe('profile');
    expect(s2.topZ).toBe(130);
    expect(s2.problems).toEqual([]);
  });

  it('gives attachment points in global coordinates (hand check)', () => {
    const p = lineProject();
    const s2 = computeLineModel(p, computeDerived(p)).byId.get('s2')!;
    // Line heads north: TS points east (positive offsets), so x = -4 is 4 m west of the axis.
    const ph1 = s2.points.find((q) => q.a.phase === 1)!;
    expect(ph1.top.x).toBeCloseTo(-4, 12);
    expect(ph1.top.y).toBeCloseTo(150, 12);
    expect(ph1.top.z).toBeCloseTo(127, 12);   // 100 + 30 − 3
    expect(ph1.wire!.z).toBeCloseTo(125, 12); // plumb suspension insulator, 2 m long
  });

  it('strings the section with transposition and lays strain insulators along the chord', () => {
    const p = lineProject();
    const m = computeLineModel(p, computeDerived(p));
    const sec = m.sections[0]!;
    // A missing cable is reported; the stringing itself is valid and the wires are still drawn.
    expect(sec.problems).toEqual(['Its cable is no longer in the library.']);
    expect(sec.wires).toHaveLength(3);
    expect(sec.from).toBe(1);
    expect(sec.to).toBe(3);
  });

  it('draws wires once the section is valid', () => {
    const p = lineProject();
    p.cableLibrary = [{
      id: 'c', name: 'Test', description: '', stockNumber: '', model: 'linear', area: 4e-4, diameter: 0.025, unitWeight: 15, ultimateTension: 1e5,
      independentCables: 1, gapType: false, testTemperature: 15, outer: { finalModulus: 6e8, thermalCoeff: 23e-6, initial: [0, 0, 0, 0, 0], creep: [0, 0, 0, 0, 0] },
      core: null, creepTemperatureShift: 0, outerCompression: { mode: 'criteria', limit: 0 }, color: '#f00', testData: null, src: 'user',
    }];
    const sec = computeLineModel(p, computeDerived(p)).sections[0]!;
    expect(sec.problems).toEqual([]);
    expect(sec.wires).toHaveLength(3);
    const w1 = sec.wires[0]!;
    // Wire phase 1 attaches to phase 1 at the dead ends and, transposed "321", to phase 3 (x = +4) at structure 2.
    expect(w1[1]!.x).toBeCloseTo(4, 9);
    // Strain insulator at structure 1 runs 2.5 m along the chord toward the attachment it connects to at structure 2 (x = +4).
    const dx = 8, dy = 150, dz = 0, l = Math.hypot(dx, dy, dz);
    expect(w1[0]!.x).toBeCloseTo(-4 + (dx / l) * 2.5, 9);
    expect(w1[0]!.y).toBeCloseTo(0 + (dy / l) * 2.5, 9);
    expect(w1[0]!.z).toBeCloseTo(127, 9);
    // Profile coordinates: virtual station of each wire point.
    expect(sec.profile[0]![1]!.station).toBeCloseTo(1150, 9);
  });

  it('reports a dead end in the middle of a section and missing ground', () => {
    const p = lineProject();
    p.sections[0]!.steps[1] = { structureId: 's2', set: 1, transposition: '123' };
    p.structures.find((s) => s.id === 's2')!.typeId = 'T-D';
    const sec = computeLineModel(p, computeDerived(p)).sections[0]!;
    expect(sec.problems.some((e) => e.includes('must end there'))).toBe(true);
    const q = lineProject();
    q.terrain.points = [];
    const s1 = computeLineModel(q, computeDerived(q)).byId.get('s1')!;
    expect(s1.ground).toBeNull();
    expect(s1.problems[0]).toContain('no ground elevation');
  });
});
