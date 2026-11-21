import { useMemo } from 'react';
import {
  buildTin, buildVirtualAlignment, centerlineProfile, formatStation, projectPoints, sideProfile, tinContours, tinProfile,
  toEquationStation,
  type AlignmentGeometry, type ContourLevel, type ProfileVertex, type ProjectedPoint, type SurveyPoint, type Tin,
} from '@tlcad/engine';
import type { Alignment, FeatureCode, Project, SideProfileDef, TerrainPoint } from '@tlcad/model';
import { useApp } from './appStore';
import { computeLineModel, type LineModel } from './lineModel';
import { computeAnalysis, type Analysis } from './analysis';

/**
 * Data derived from the project by the engine: alignment geometry, station /
 * offset of every survey point, ground profiles, the TIN and its contours.
 * Computed once per change of its inputs and shared by all views.
 */

/** Derived data of one alignment of the virtual alignment (manual §6.3.1.2). */
export interface LineDerived {
  alignment: Alignment;
  /** Null while the alignment has fewer than two PIs. */
  geom: AlignmentGeometry | null;
  projected: ProjectedPoint[];
  unprojectable: number;
  centerline: ProfileVertex[];
  sides: { def: SideProfileDef; lines: ProfileVertex[][] }[];
}

export interface Derived {
  lines: LineDerived[];
  /** Active terrain points, parallel to `survey`. */
  points: TerrainPoint[];
  survey: SurveyPoint[];
  codes: Map<number, FeatureCode>;
  centerlineSource: 'points' | 'tin';
  tin: Tin | null;
  contours: ContourLevel[];
  /** Break line segments that could not be enforced in the TIN. */
  breakLinesSkipped: number;
}

const EMPTY: Derived = {
  lines: [], points: [], survey: [], codes: new Map(), centerlineSource: 'points', tin: null, contours: [], breakLinesSkipped: 0,
};

let lastKey: unknown[] = [];
let lastValue: Derived = EMPTY;

export function computeDerived(p: Project | null): Derived {
  if (!p) return EMPTY;
  const key = [p.terrain.points, p.terrain.featureCodes, p.terrain.breakLines, p.alignments, p.settings.terrain];
  if (key.every((k, i) => k === lastKey[i])) return lastValue;

  const codes = new Map(p.terrain.featureCodes.map((f) => [f.code, f]));
  const points = p.terrain.points.filter((q) => q.active);
  const survey: SurveyPoint[] = points.map((q) => ({ x: q.x, y: q.y, z: q.z, h: q.h, onGround: codes.get(q.code)?.onGround ?? true }));
  const ts = p.settings.terrain;
  const report = { breakLinesSkipped: 0 };
  const tin = ts.tinEnabled
    ? buildTin(survey, { ...(ts.tinMaxEdge ? { maxEdge: ts.tinMaxEdge } : {}), breakLines: p.terrain.breakLines, report })
    : null;
  const contours = tin && ts.contourInterval ? tinContours(tin, ts.contourInterval) : [];

  const start = p.alignments[0]?.startStation ?? 0;
  const geoms = buildVirtualAlignment(p.alignments.map((a) => a.pis), start, ts.alignmentGap);
  const withGeom = geoms.map((g, i) => (g ? i : -1)).filter((i) => i >= 0);
  const lines: LineDerived[] = p.alignments.map((alignment, i) => {
    const geom = geoms[i]!;
    if (!geom) return { alignment, geom: null, projected: [], unprojectable: 0, centerline: [], sides: [] };
    // Profiles extend beyond the end PIs (§6.3.1.2). Between two alignments of the virtual
    // profile the extension is limited to half the station gap so that the profiles cannot overlap;
    // the manual does not state the extension distance.
    const ext = {
      before: i === withGeom[0] ? Infinity : ts.alignmentGap / 2,
      after: i === withGeom[withGeom.length - 1] ? Infinity : ts.alignmentGap / 2,
    };
    const { projected, unprojectable } = projectPoints(geom, survey, ext);
    return {
      alignment, geom, projected, unprojectable,
      centerline: tin ? tinProfile(tin, geom, 0) : centerlineProfile(survey, projected, ts.mocgp),
      sides: ts.sideProfiles.map((def) => ({
        def,
        lines: tin
          ? [tinProfile(tin, geom, def.offset)].filter((l) => l.length > 1)
          : sideProfile(survey, projected, def.offset, def.tolerance, def.maxSeparation),
      })),
    };
  });

  lastKey = key;
  lastValue = {
    lines, points, survey, codes, centerlineSource: tin ? 'tin' : 'points', tin, contours,
    breakLinesSkipped: report.breakLinesSkipped,
  };
  return lastValue;
}

/** Index of the active alignment: the one selected by the user, else the first. */
export function activeIndex(p: Project | null, activeId: string | null): number {
  if (!p || p.alignments.length === 0) return -1;
  const i = p.alignments.findIndex((a) => a.id === activeId);
  return i >= 0 ? i : 0;
}

export interface DerivedView extends Derived {
  active: number;
  /** Structures and sections (Phase 3). */
  model: LineModel;
  /** Sag-tension analysis of the sections (Phase 4). */
  analysis: Analysis;
  /** Derived data of the active alignment, if any. */
  line: LineDerived | null;
}

export function useDerived(): DerivedView {
  // Subscribing to the inputs re-renders the caller exactly when the derived data changes.
  useApp((s) => s.project?.terrain.points);
  useApp((s) => s.project?.terrain.featureCodes);
  useApp((s) => s.project?.terrain.breakLines);
  useApp((s) => s.project?.alignments);
  useApp((s) => s.project?.settings.terrain);
  useApp((s) => s.project?.structures);
  useApp((s) => s.project?.structureLibrary);
  useApp((s) => s.project?.sections);
  useApp((s) => s.project?.cableLibrary);
  const activeId = useApp((s) => s.activeAlignmentId);
  const project = useApp.getState().project;
  const d = computeDerived(project);
  const model = computeLineModel(project, d);
  useApp((s) => s.project?.criteria);
  const analysis = computeAnalysis(project, d, model);
  const active = activeIndex(project, activeId);
  // Stable object identity while nothing changed, so that views redraw only when needed.
  return useMemo(() => ({ ...d, active, line: d.lines[active] ?? null, model, analysis }), [d, active, model, analysis]);
}

/** Station text in the project's units, as a true or an equation station (manual §6.11). */
export function stationText(p: Project, station: number): string {
  const s = p.settings.stationDisplay === 'equation' ? toEquationStation(station, p.settings.terrain.stationEquations) : station;
  return formatStation(s, p.settings.unitSystem);
}
