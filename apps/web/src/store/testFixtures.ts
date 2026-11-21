import { createProject, newAttachment, type Attachment, type Cable, type Project, type StructureType } from '@tlcad/model';

/**
 * Line model of a small line built by hand: a straight alignment heading north
 * over flat ground at elevation 100, a dead end at each end and a suspension
 * structure in the middle, strung with one 3-phase section.
 */
function att(set: number, phase: number, over: Partial<Attachment>): Attachment {
  return { ...newAttachment(set, phase), ...over };
}

export function lineProject(): Project {
  const p = createProject({ name: 'Line model test' }, new Date('2026-11-18T00:00:00Z'));
  p.terrain.points = [0, 100, 200, 300].map((y, i) => ({
    id: `g${i}`, desc: '', x: 0, y, z: 100, code: 200, h: 0, profNote: '', planNote: '', active: true, src: 'user' as const,
  }));
  p.alignments = [{ id: 'A', name: 'Main', startStation: 1000, pis: [{ id: 'p1', x: 0, y: 0, desc: '', src: 'user' }, { id: 'p2', x: 0, y: 300, desc: '', src: 'user' }] }];
  const susp: StructureType = {
    id: 'T-S', name: 'S', description: '', height: 30, embedment: null, cost: null, autoSpotMinAngle: 0, material: [], src: 'user',
    strength: { method: 'none', validity: '', rows: [], ranges: [] },
    attachments: [-4, 0, 4].map((x, i) => att(1, i + 1, { insulator: 'suspension', length: 2, x, y: 3, swing: [[-90, 90], [-90, 90], [-90, 90], [-90, 90]] })),
  };
  const de: StructureType = {
    ...susp, id: 'T-D', name: 'D',
    attachments: [-4, 0, 4].map((x, i) => att(1, i + 1, { insulator: 'strain', deadEnd: true, length: 2.5, x, y: 3, swing: null })),
  };
  p.structureLibrary = [susp, de];
  const place = (id: string, typeId: string, station: number) => ({
    id, typeId, alignmentId: 'A', station, offset: 0, heightAdjust: 0, orientation: 0, label: '', counterweights: {}, comment: '', material: [], src: 'user' as const,
  });
  // Stored out of order: numbering must follow the stations.
  p.structures = [place('s2', 'T-S', 150), place('s3', 'T-D', 300), place('s1', 'T-D', 0)];
  p.cableLibrary = [];
  p.sections = [{
    id: 'sec', cableId: 'c', voltageKV: 230, conductorsPerPhase: 1, src: 'user',
    sagging: { condition: 'initial', temperature: 15, H: null, rulingSpanOverride: null, src: 'default' },
    steps: [{ structureId: 's1', set: 1, transposition: '123' }, { structureId: 's2', set: 1, transposition: '321' }, { structureId: 's3', set: 1, transposition: '123' }],
  }];
  return p;
}

/** A simple linear-model cable (illustrative values for tests only). */
export function testCable(): Cable {
  return {
    id: 'c', name: 'Test', description: '', stockNumber: '', model: 'linear', area: 4e-4, diameter: 0.025, unitWeight: 15, ultimateTension: 1e5,
    independentCables: 1, gapType: false, testTemperature: 15, outer: { finalModulus: 6e8, thermalCoeff: 23e-6, initial: [0, 0, 0, 0, 0], creep: [0, 0, 0, 0, 0] },
    core: null, creepTemperatureShift: 0, outerCompression: { mode: 'criteria', limit: 0 }, color: '#f00', testData: null, src: 'user',
  };
}