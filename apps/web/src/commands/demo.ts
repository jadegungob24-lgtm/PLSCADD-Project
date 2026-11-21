import { CriteriaSchema, type FeatureCode } from '@tlcad/model';
import terrainXyz from '../../../../samples/demo_line/terrain.xyz?raw';
import featureCodes from '../../../../samples/demo_line/feature_codes.json?raw';
import alignment from '../../../../samples/demo_line/alignment.json?raw';
import library from '../../../../samples/demo_line/library.json?raw';
import criteria from '../../../../samples/demo_line/criteria.json?raw';
import { useApp } from '../store/appStore';
import { addPi, importXyzFile } from './terrain';
import { addSection, addStructure, importLibrary, spotAtPis } from './line';
import { autoSagSection, saveCriteria } from './sag';
import { currentView } from './drafting';

/**
 * Help ▸ Open Demo Line Sample: builds the Demo Line (samples/demo_line) as a
 * new project through the same commands a user would run, step by step. The
 * sample data are illustrative only (synthetic terrain, made-up cable,
 * structures and criteria). The line deliberately has a structure in a
 * valley, so the checks have problems to find.
 */
export async function openDemoLine() {
  const app = () => useApp.getState();
  if (!(await app().confirmDiscard())) return;
  await app().newProject({ name: 'Demo Line', unitSystem: 'SI_N', lineName: 'Demo 230 kV (illustrative data)' });
  await importXyzFile(new File([terrainXyz], 'terrain.xyz'));
  const fc = JSON.parse(featureCodes) as { voltages: number[]; codes: Omit<FeatureCode, 'src'>[] };
  app().exec('Demo: feature codes and TIN', (d) => {
    d.terrain.voltages = fc.voltages;
    d.terrain.featureCodes = fc.codes.map((c) => ({ ...c, src: 'user' as const }));
    d.settings.terrain.tinEnabled = true;
    d.settings.terrain.tinMaxEdge = 60;
  });
  for (const q of (JSON.parse(alignment) as { pis: { x: number; y: number }[] }).pis) addPi(q.x, q.y);
  const alignmentId = app().project!.alignments[0]!.id;
  await importLibrary(new File([library], 'library.json'));
  saveCriteria(CriteriaSchema.parse(JSON.parse(criteria)));
  const p = app().project!;
  const tangent = p.structureLibrary.find((x) => x.name.startsWith('Demo tangent'))!;
  const deadEnd = p.structureLibrary.find((x) => x.name.startsWith('Demo dead end'))!;
  spotAtPis(deadEnd.id, alignmentId);
  const st = currentView()!.lines[0]!.geom!.stations;
  for (let k = 0; k + 1 < st.length; k++) for (const f of [1 / 3, 2 / 3]) addStructure(tangent.id, alignmentId, st[k]! + (st[k + 1]! - st[k]!) * f);
  const structs = currentView()!.model.structures;
  for (const [a, b] of [[0, 3], [3, 6]] as const) {
    addSection({ cableId: p.cableLibrary[0]!.id, voltageKV: 230, conductorsPerPhase: 1, steps: structs.slice(a, b + 1).map((s) => ({ structureId: s.s.id, set: 1, transposition: '123' })) });
  }
  for (const s of app().project!.sections) autoSagSection(s.id);
  app().showView('profile');
  app().zoomExtents();
  app().addLog('info', 'Demo Line built: survey import, feature codes, alignment, library, criteria, spotting, stringing and automatic sagging. All its data are illustrative. Try Sag-Tension ▸ Structure checks, the Clearance workspace and the Sheets view.');
}
